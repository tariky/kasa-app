//! Otvaranje baze: schema + migracije + početni podaci (`database/db.ts`).

use std::path::Path;
use std::sync::{Arc, OnceLock};

use serde_json::Value;

use crate::greska::R;
use crate::provjera_racuna::{kanonski_nacin_placanja, NACINI_PLACANJA};
use crate::{korisnici, p};
use crate::petlja::Petlja;
use crate::sql::Db;

/// Schema je ista ona iz `src/database/schema.ts` — jedan izvor istine za
/// oba backenda. Uzima se tekst između prva dva backticka.
pub fn schema() -> &'static str {
    const TS: &str = include_str!("../../../src/database/schema.ts");
    TS.split('`').nth(1).expect("schema.ts mora imati template string")
}

/// Aktivna baza programa (`getDb()`): WAL, strani ključevi, schema,
/// migracije i početni podaci — pri svakom otvaranju.
pub fn otvori(putanja: &Path, petlja: Arc<Petlja>) -> R<Db> {
    Db::aktivna(putanja, petlja)
}

/// Tabele koje program pravi — sve iz schema.ts (migracije ne prave nijednu
/// koje tamo nema; `TABELE_SHEME` u database/restore.ts). Uz njih backup
/// smije imati samo interne `sqlite_*` tabele.
pub fn tabele_sheme() -> Vec<String> {
    let re = regex::Regex::new(r"CREATE TABLE IF NOT EXISTS (\w+)").unwrap();
    re.captures_iter(schema()).map(|m| m[1].to_string()).collect()
}

/// Pragme aktivne konekcije, redom (`PRAGME_KONEKCIJE` iz database/konekcija.ts):
/// WAL, strani ključevi, i shema ne smije pozivati nebezbjedne funkcije.
pub const PRAGME_KONEKCIJE: [&str; 3] = ["journal_mode = WAL", "foreign_keys = ON", "trusted_schema = OFF"];

/// Priprema tek otvorene konekcije aktivne baze (poziva je `Db`).
pub(crate) fn inicijalizuj(db: &Db) -> R<()> {
    for p in PRAGME_KONEKCIJE {
        db.pragma(p)?;
    }
    db.exec(schema())?;
    // Uključujući heširanje PIN-ova iz starijih verzija (migracije.json).
    run_migrations(db)?;
    seed_defaults(db)?;
    Ok(())
}

fn kolone(db: &Db, tabela: &str) -> R<Vec<String>> {
    Ok(db
        .all(&format!("PRAGMA table_info({tabela})"), &[])?
        .into_iter()
        .filter_map(|r| r["name"].as_str().map(str::to_string))
        .collect())
}

/// Korak iz `src/database/migracije.json` — isti fajl čita migrations.ts, pa su
/// migracije i njihov redoslijed isti u oba backenda (`KorakMigracije`).
enum Korak {
    /// Izvrši `sql` kad tabeli nedostaje `kolona` (bez nje uvijek: CREATE … IF NOT
    /// EXISTS); `samo_ako_tabela_postoji` preskače korak kad tabele nema.
    Sql { tabela: String, kolona: Option<String>, sql: Vec<String>, samo_ako_tabela_postoji: bool },
    /// Migracija koja nije čist SQL (čita podatke) — funkcija iz `KOD_MIGRACIJA`.
    Kod(Migracija),
}

type Migracija = fn(&Db) -> R<()>;

const MIGRACIJE_JSON: &str = include_str!("../../../src/database/migracije.json");

/// Koraci koji nisu čist SQL: ime iz migracije.json → funkcija (`KOD_MIGRACIJA` u migrations.ts).
const KOD_MIGRACIJA: [(&str, Migracija); 2] = [
    ("normalizujNacinPlacanja", normalizuj_nacin_placanja),
    ("hesirajStarePinove", |db| korisnici::hesiraj_stare_pinove(db).map(|_| ())),
];

fn koraci() -> &'static [Korak] {
    static K: OnceLock<Vec<Korak>> = OnceLock::new();
    K.get_or_init(|| {
        let v: Value = serde_json::from_str(MIGRACIJE_JSON).expect("ispravan migracije.json");
        v.as_array().expect("migracije.json mora biti lista koraka").iter().map(korak).collect()
    })
}

fn korak(k: &Value) -> Korak {
    if let Some(ime) = k.get("kod") {
        let ime = ime.as_str().unwrap_or_else(|| panic!("migracije.json: kod {ime} nije string"));
        let (_, f) = KOD_MIGRACIJA.iter().find(|(i, _)| *i == ime).unwrap_or_else(|| panic!("migracije.json: nema funkcije za korak {ime}"));
        return Korak::Kod(*f);
    }
    let sql = k["sql"].as_array().unwrap_or_else(|| panic!("migracije.json: korak {k} nema sql"));
    Korak::Sql {
        tabela: k["tabela"].as_str().unwrap_or_else(|| panic!("migracije.json: korak {k} nema tabelu")).to_owned(),
        kolona: k["kolona"].as_str().map(str::to_owned),
        sql: sql.iter().map(|s| s.as_str().unwrap_or_else(|| panic!("migracije.json: {s} nije SQL")).to_owned()).collect(),
        samo_ako_tabela_postoji: k["samoAkoTabelaPostoji"].as_bool().unwrap_or(false),
    }
}

/// Idempotentne migracije za baze iz starijih verzija programa (uključujući
/// uvezene backup-e) — `database/migrations.ts`, redom iz migracije.json.
pub fn run_migrations(db: &Db) -> R<()> {
    for k in koraci() {
        match k {
            Korak::Kod(migracija) => migracija(db)?,
            Korak::Sql { tabela, kolona, sql, samo_ako_tabela_postoji } => {
                if treba_izvrsiti(db, tabela, kolona.as_deref(), *samo_ako_tabela_postoji)? {
                    for s in sql {
                        db.exec(s)?;
                    }
                }
            }
        }
    }
    Ok(())
}

fn treba_izvrsiti(db: &Db, tabela: &str, kolona: Option<&str>, samo_ako_tabela_postoji: bool) -> R<bool> {
    if kolona.is_none() && !samo_ako_tabela_postoji {
        return Ok(true);
    }
    let kolone = kolone(db, tabela)?;
    if samo_ako_tabela_postoji && kolone.is_empty() {
        return Ok(false);
    }
    Ok(kolona.is_none_or(|c| !kolone.iter().any(|x| x == c)))
}

/// Stari zapisi načina plaćanja ('gotovina', ' Gotovina ', 'cek',
/// '{"Gotovina":5}') u kanonski oblik (`kanonski_nacin_placanja`), da ladica,
/// izvoz i ekran vide isto. Oblik koji parser ne razumije ostaje kakav jeste.
/// Idempotentno (`normalizujNacinPlacanja` u migrations.ts).
fn normalizuj_nacin_placanja(db: &Db) -> R<()> {
    let lista: Vec<Value> = NACINI_PLACANJA.iter().map(|n| Value::from(*n)).collect();
    let mjesta = vec!["?"; lista.len()].join(", ");
    let redovi = db.all(&format!("SELECT id, nacinPlacanja FROM orders WHERE nacinPlacanja NOT IN ({mjesta})"), &lista)?;
    db.tx(|| {
        for r in &redovi {
            let Some(nacin) = r["nacinPlacanja"].as_str() else { continue };
            let kanonski = kanonski_nacin_placanja(nacin);
            if kanonski != nacin {
                db.run("UPDATE orders SET nacinPlacanja = ? WHERE id = ?", p![kanonski, r["id"]])?;
            }
        }
        Ok(())
    })
}

fn seed_defaults(db: &Db) -> R<()> {
    // Zadani Admin/0000 samo u praznoj bazi — inače bi se vraćao pri svakom
    // pokretanju i nakon što ga korisnik obriše ili mu promijeni PIN.
    korisnici::osiguraj_zadanog_admina(db)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Stara baza iz `src/ipc/ugovor/staraBaza.ts` — ista polazna tačka kao TS testovi.
    fn stara_shema() -> &'static str {
        const TS: &str = include_str!("../../../src/ipc/ugovor/staraBaza.ts");
        TS.split('`').nth(1).expect("staraBaza.ts mora imati template string")
    }

    #[test]
    fn svaki_kod_korak_ima_funkciju_i_svaka_funkcija_je_korak() {
        let v: Value = serde_json::from_str(MIGRACIJE_JSON).unwrap();
        let mut u_jsonu: Vec<&str> = v.as_array().unwrap().iter().filter_map(|k| k.get("kod")?.as_str()).collect();
        let mut funkcije: Vec<&str> = KOD_MIGRACIJA.iter().map(|(ime, _)| *ime).collect();
        u_jsonu.sort();
        funkcije.sort();
        assert_eq!(u_jsonu, funkcije);
        // Svaki korak se parsira (nepoznat kod ili neispravan korak = panic).
        assert_eq!(koraci().len(), v.as_array().unwrap().len());
    }

    #[test]
    fn stara_baza_postaje_nova_a_drugi_prolaz_ne_mijenja_nista() {
        let dir = std::env::temp_dir().join(format!("kasa-migracije-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let putanja = dir.join("kasa.db");
        {
            let c = rusqlite::Connection::open(&putanja).unwrap();
            c.execute_batch(stara_shema()).unwrap();
            c.execute_batch(
                "INSERT INTO users (ime, pin, uloga) VALUES ('Stari Kasir', '1234', 'kasir');
                 INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (1, 8, 0, 'cek', 'completed');",
            )
            .unwrap();
        }

        let db = Db::aktivna(&putanja, Arc::new(Petlja::nova())).unwrap();
        // Kolone se dodaju redom migracija (migracije.json).
        assert_eq!(
            kolone(&db, "orders").unwrap(),
            [
                "id", "korisnikId", "ukupno", "pdvIznos", "nacinPlacanja", "brojFiskalnogRacuna", "brojReklamacije", "status",
                "createdAt", "kupacNaziv", "kupacIdBroj", "kupacAdresa", "kupacGrad", "kupacPostanskiBroj", "isManual",
                "refundedAt", "prilogBroj", "prilogNaziv", "datumValute", "napomena",
            ]
        );
        assert_eq!(kolone(&db, "products").unwrap()[10..], ["tip", "plocaSirina", "plocaVisina", "slobodan"]);
        // Koraci u kodu: način plaćanja kanonski, PIN heš.
        assert_eq!(db.val("SELECT nacinPlacanja FROM orders", p![]).unwrap(), "Ček");
        let pin = db.val("SELECT pin FROM users", p![]).unwrap();
        assert!(korisnici::provjeri_pin(&json!("1234"), pin.as_str().unwrap()));

        let stanje = || {
            (
                db.all("SELECT type, name, sql FROM sqlite_master ORDER BY type, name", p![]).unwrap(),
                db.val("SELECT total_changes()", p![]).unwrap(),
            )
        };
        let prije = stanje();
        inicijalizuj(&db).unwrap();
        assert_eq!(stanje(), prije);

        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
