import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { schema } from './schema';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'kasa.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(schema);

  // Migrations for existing databases
  runMigrations(db);

  seedDefaults(db);

  return db;
}

function runMigrations(database: Database.Database): void {
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
}

function seedDefaults(database: Database.Database): void {
  // Seed default admin user
  const adminExists = database
    .prepare("SELECT id FROM users WHERE pin = '0000'")
    .get();

  if (!adminExists) {
    database
      .prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Admin', '0000', 'admin')")
      .run();
  }

  // Seed default Tring settings
  const defaults: Record<string, string> = {
    'tring.host': 'localhost',
    'tring.port': '8085',
    'tring.operatorId': '0',
    'tring.operatorPassword': '0',
  };

  const upsert = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  for (const [key, value] of Object.entries(defaults)) {
    upsert.run(key, value);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
