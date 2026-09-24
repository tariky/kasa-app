//! Otvaranje baze: schema + migracije + početni podaci (`database/db.ts`).

use std::path::Path;

use crate::greska::R;
use crate::p;
use crate::sql::Db;

/// Schema je ista ona iz `src/database/schema.ts` — jedan izvor istine za
/// oba backenda. Uzima se tekst između prva dva backticka.
fn schema() -> &'static str {
    const TS: &str = include_str!("../../../src/database/schema.ts");
    TS.split('`').nth(1).expect("schema.ts mora imati template string")
}

pub fn otvori(putanja: &Path) -> R<Db> {
    let db = Db::otvori(putanja)?;
    db.pragma("journal_mode = WAL")?;
    db.pragma("foreign_keys = ON")?;
    db.exec(schema())?;
    run_migrations(&db)?;
    seed_defaults(&db)?;
    Ok(db)
}

fn kolone(db: &Db, tabela: &str) -> R<Vec<String>> {
    Ok(db
        .all(&format!("PRAGMA table_info({tabela})"), &[])?
        .into_iter()
        .filter_map(|r| r["name"].as_str().map(str::to_string))
        .collect())
}

/// Idempotentne migracije za baze iz starijih verzija programa (uključujući
/// uvezene backup-e) — `database/migrations.ts`.
pub fn run_migrations(db: &Db) -> R<()> {
    let ima = |k: &Vec<String>, c: &str| k.iter().any(|x| x == c);

    let stavke = kolone(db, "primka_stavke")?;
    if !ima(&stavke, "nabavnaCijena") {
        db.exec("ALTER TABLE primka_stavke ADD COLUMN nabavnaCijena REAL NOT NULL DEFAULT 0")?;
    }
    if !ima(&stavke, "rabat") {
        db.exec("ALTER TABLE primka_stavke ADD COLUMN rabat REAL NOT NULL DEFAULT 0")?;
    }
    if !ima(&stavke, "zavisniTroskovi") {
        db.exec("ALTER TABLE primka_stavke ADD COLUMN zavisniTroskovi REAL NOT NULL DEFAULT 0")?;
    }
    if !ima(&stavke, "staraCijena") {
        db.exec("ALTER TABLE primka_stavke ADD COLUMN staraCijena REAL")?;
    }

    let primke = kolone(db, "primke")?;
    if !ima(&primke, "dobavljacNaziv") {
        db.exec("ALTER TABLE primke ADD COLUMN dobavljacNaziv TEXT")?;
    }
    if !ima(&primke, "dobavljacId") {
        db.exec("ALTER TABLE primke ADD COLUMN dobavljacId TEXT")?;
    }
    if !ima(&primke, "dobavljacAdresa") {
        db.exec("ALTER TABLE primke ADD COLUMN dobavljacAdresa TEXT")?;
    }

    db.exec(
        "CREATE TABLE IF NOT EXISTS dobavljaci (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naziv TEXT NOT NULL,
      idBroj TEXT,
      pdvBroj TEXT,
      adresa TEXT,
      kontakt TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    )",
    )?;

    let products = kolone(db, "products")?;
    if !ima(&products, "tip") {
        db.exec("ALTER TABLE products ADD COLUMN tip TEXT NOT NULL DEFAULT 'artikal'")?;
    }

    db.exec(
        "CREATE TABLE IF NOT EXISTS kupci (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naziv TEXT NOT NULL,
      idBroj TEXT NOT NULL,
      pdvBroj TEXT,
      adresa TEXT,
      postanskiBroj TEXT,
      grad TEXT,
      kontakt TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    )",
    )?;

    if !ima(&primke, "brojFakture") {
        db.exec("ALTER TABLE primke ADD COLUMN brojFakture TEXT")?;
    }

    let orders = kolone(db, "orders")?;
    if !ima(&orders, "kupacNaziv") {
        db.exec("ALTER TABLE orders ADD COLUMN kupacNaziv TEXT")?;
        db.exec("ALTER TABLE orders ADD COLUMN kupacIdBroj TEXT")?;
        db.exec("ALTER TABLE orders ADD COLUMN kupacAdresa TEXT")?;
        db.exec("ALTER TABLE orders ADD COLUMN kupacGrad TEXT")?;
        db.exec("ALTER TABLE orders ADD COLUMN kupacPostanskiBroj TEXT")?;
    }
    if !ima(&orders, "isManual") {
        db.exec("ALTER TABLE orders ADD COLUMN isManual INTEGER NOT NULL DEFAULT 0")?;
    }
    if !ima(&orders, "refundedAt") {
        db.exec("ALTER TABLE orders ADD COLUMN refundedAt TEXT")?;
    }
    if !ima(&orders, "prilogBroj") {
        db.exec("ALTER TABLE orders ADD COLUMN prilogBroj INTEGER")?;
    }
    if !ima(&orders, "prilogNaziv") {
        db.exec("ALTER TABLE orders ADD COLUMN prilogNaziv TEXT")?;
    }
    if !ima(&orders, "datumValute") {
        db.exec("ALTER TABLE orders ADD COLUMN datumValute TEXT")?;
    }

    db.exec(
        "CREATE TABLE IF NOT EXISTS prilog_stavke (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      productId INTEGER NOT NULL,
      kolicina REAL NOT NULL,
      cijena REAL NOT NULL,
      pdvStopa TEXT NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )",
    )?;
    db.exec("CREATE INDEX IF NOT EXISTS idx_prilog_stavke_orderId ON prilog_stavke(orderId)")?;

    db.exec(
        "CREATE TABLE IF NOT EXISTS pending_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      korisnikId INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (korisnikId) REFERENCES users(id)
    )",
    )?;

    let products2 = kolone(db, "products")?;
    if !ima(&products2, "plocaSirina") {
        db.exec("ALTER TABLE products ADD COLUMN plocaSirina INTEGER")?;
    }
    if !ima(&products2, "plocaVisina") {
        db.exec("ALTER TABLE products ADD COLUMN plocaVisina INTEGER")?;
    }
    Ok(())
}

fn seed_defaults(db: &Db) -> R<()> {
    if !db.ima("SELECT id FROM users WHERE pin = '0000'", p![])? {
        db.run("INSERT INTO users (ime, pin, uloga) VALUES ('Admin', '0000', 'admin')", p![])?;
    }
    for (k, v) in [
        ("tring.host", "localhost"),
        ("tring.port", "8085"),
        ("tring.operatorId", "0"),
        ("tring.operatorPassword", "0"),
    ] {
        db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", p![k, v])?;
    }
    Ok(())
}
