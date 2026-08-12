import type Database from 'better-sqlite3';

// Idempotentne migracije za baze iz starijih verzija programa (uključujući
// uvezene backup-e). Pokreću se nakon `schema` pri svakom otvaranju baze.
export function runMigrations(database: Database.Database): void {
  // primka_stavke migrations
  const stavkeCols = database.prepare("PRAGMA table_info(primka_stavke)").all() as { name: string }[];
  if (!stavkeCols.find(c => c.name === 'nabavnaCijena')) {
    database.exec("ALTER TABLE primka_stavke ADD COLUMN nabavnaCijena REAL NOT NULL DEFAULT 0");
  }
  if (!stavkeCols.find(c => c.name === 'rabat')) {
    database.exec("ALTER TABLE primka_stavke ADD COLUMN rabat REAL NOT NULL DEFAULT 0");
  }

  // primke header migrations — dobavljač fields
  const primkeCols = database.prepare("PRAGMA table_info(primke)").all() as { name: string }[];
  if (!primkeCols.find(c => c.name === 'dobavljacNaziv')) {
    database.exec("ALTER TABLE primke ADD COLUMN dobavljacNaziv TEXT");
  }
  if (!primkeCols.find(c => c.name === 'dobavljacId')) {
    database.exec("ALTER TABLE primke ADD COLUMN dobavljacId TEXT");
  }
  if (!primkeCols.find(c => c.name === 'dobavljacAdresa')) {
    database.exec("ALTER TABLE primke ADD COLUMN dobavljacAdresa TEXT");
  }

  // Create dobavljaci table if missing (for existing DBs)
  database.exec(`
    CREATE TABLE IF NOT EXISTS dobavljaci (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naziv TEXT NOT NULL,
      idBroj TEXT,
      pdvBroj TEXT,
      adresa TEXT,
      kontakt TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Add tip column to products (artikal vs usluga)
  const productCols = database.prepare("PRAGMA table_info(products)").all() as { name: string }[];
  if (!productCols.find(c => c.name === 'tip')) {
    database.exec("ALTER TABLE products ADD COLUMN tip TEXT NOT NULL DEFAULT 'artikal'");
  }

  // Create kupci table if missing
  database.exec(`
    CREATE TABLE IF NOT EXISTS kupci (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naziv TEXT NOT NULL,
      idBroj TEXT NOT NULL,
      pdvBroj TEXT,
      adresa TEXT,
      postanskiBroj TEXT,
      grad TEXT,
      kontakt TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // Add brojFakture column to primke
  if (!primkeCols.find(c => c.name === 'brojFakture')) {
    database.exec("ALTER TABLE primke ADD COLUMN brojFakture TEXT");
  }

  // Add kupac columns to orders
  const orderCols = database.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  if (!orderCols.find(c => c.name === 'kupacNaziv')) {
    database.exec("ALTER TABLE orders ADD COLUMN kupacNaziv TEXT");
    database.exec("ALTER TABLE orders ADD COLUMN kupacIdBroj TEXT");
    database.exec("ALTER TABLE orders ADD COLUMN kupacAdresa TEXT");
    database.exec("ALTER TABLE orders ADD COLUMN kupacGrad TEXT");
    database.exec("ALTER TABLE orders ADD COLUMN kupacPostanskiBroj TEXT");
  }

  if (!orderCols.find(c => c.name === 'isManual')) {
    database.exec("ALTER TABLE orders ADD COLUMN isManual INTEGER NOT NULL DEFAULT 0");
  }

  if (!orderCols.find(c => c.name === 'refundedAt')) {
    database.exec("ALTER TABLE orders ADD COLUMN refundedAt TEXT");
  }

  // Create pending_receipts table if missing (write-ahead intent log)
  database.exec(`
    CREATE TABLE IF NOT EXISTS pending_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      korisnikId INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (korisnikId) REFERENCES users(id)
    )
  `);
}
