import { test, expect } from 'bun:test';
// `better-sqlite3` je kompajliran za Electron ABI i ne učitava se van Electrona,
// pa testovi voze isti SQL kroz bun:sqlite (API koji migracije koriste —
// prepare().all() i exec() — je identičan).
import { Database } from 'bun:sqlite';
import { schema } from './schema';
import { runMigrations } from './migrations';

type Db = any;

// Baza kakvu bi imao backup iz starije verzije programa: sve kolone i tabele
// koje `runMigrations` naknadno dodaje ovdje nedostaju. Ako se doda nova
// migracija, ovdje se NE dodaje ništa — poenta je da ostane star.
const LEGACY_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ime TEXT NOT NULL,
    pin TEXT NOT NULL UNIQUE,
    uloga TEXT NOT NULL CHECK(uloga IN ('admin', 'kasir')),
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sifra TEXT NOT NULL UNIQUE,
    naziv TEXT NOT NULL,
    jm TEXT DEFAULT 'kom',
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL CHECK(pdvStopa IN ('E', 'K')),
    plu INTEGER,
    barkod TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE primke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brojPrimke TEXT NOT NULL UNIQUE,
    datum TEXT NOT NULL,
    napomena TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE primka_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primkaId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    ukupno REAL NOT NULL,
    pdvIznos REAL NOT NULL,
    nacinPlacanja TEXT NOT NULL,
    brojFiskalnogRacuna TEXT,
    brojReklamacije TEXT,
    status TEXT NOT NULL CHECK(status IN ('completed', 'refunded')),
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// Sve što migracije moraju doraditi na staroj bazi.
const ADDED_COLUMNS: Array<[string, string]> = [
  ['products', 'tip'],
  ['primka_stavke', 'nabavnaCijena'],
  ['primka_stavke', 'rabat'],
  ['primke', 'dobavljacNaziv'],
  ['primke', 'dobavljacId'],
  ['primke', 'dobavljacAdresa'],
  ['primke', 'brojFakture'],
  ['orders', 'kupacNaziv'],
  ['orders', 'kupacIdBroj'],
  ['orders', 'kupacAdresa'],
  ['orders', 'kupacGrad'],
  ['orders', 'kupacPostanskiBroj'],
  ['orders', 'isManual'],
  ['orders', 'refundedAt'],
  ['orders', 'prilogBroj'],
  ['orders', 'datumValute'],
];
const ADDED_TABLES = ['dobavljaci', 'kupci', 'pending_receipts', 'prilog_stavke'];

function columns(db: Db, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map(r => r.name));
}

function tables(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map(r => r.name));
}

// Ono što `db:restore` radi nakon zamjene fajla: getDb() → schema + migracije.
function openAsCurrentVersion(db: Db): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  runMigrations(db);
}

function legacyDbWithData(): Db {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Stari Kasir', '1234', 'kasir')").run();
  db.prepare(
    "INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('001', 'Kafa', 2.5, 'E')"
  ).run();
  db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (1, 2.5, 0.36, 'gotovina', 'completed')"
  ).run();
  return db;
}

// Test bi bio bezvrijedan da stara schema slučajno već sadrži migrirane kolone.
test('polazna baza zaista nema ništa što migracije dodaju', () => {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  for (const [table, column] of ADDED_COLUMNS) {
    expect(columns(db, table)).not.toContain(column);
  }
  for (const table of ADDED_TABLES) {
    expect(tables(db)).not.toContain(table);
  }
  db.close();
});

test('backup iz starije verzije dobija sve kolone i tabele', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  for (const [table, column] of ADDED_COLUMNS) {
    expect(columns(db, table)).toContain(column);
  }
  for (const table of ADDED_TABLES) {
    expect(tables(db)).toContain(table);
  }
  db.close();
});

test('podaci iz backup-a preživljavaju nadogradnju', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  const user = db.prepare("SELECT ime, uloga FROM users WHERE pin = '1234'").get() as any;
  expect(user).toEqual({ ime: 'Stari Kasir', uloga: 'kasir' });

  // Nove kolone dobijaju defaulte, stare vrijednosti ostaju.
  const product = db
    .prepare("SELECT naziv, cijena, tip FROM products WHERE sifra = '001'")
    .get() as any;
  expect(product).toEqual({ naziv: 'Kafa', cijena: 2.5, tip: 'artikal' });

  const order = db.prepare('SELECT ukupno, isManual, refundedAt FROM orders WHERE id = 1').get() as any;
  expect(order).toEqual({ ukupno: 2.5, isManual: 0, refundedAt: null });

  expect((db.prepare('PRAGMA integrity_check').get() as any).integrity_check).toBe('ok');
  db.close();
});

test('nakon nadogradnje se u staru bazu može pisati kroz nove kolone', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  db.prepare(
    "INSERT INTO dobavljaci (naziv, idBroj) VALUES ('Novi Dobavljač', '4200000000001')"
  ).run();
  db.prepare(
    "INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, brojFakture) VALUES ('P-1', '2026-08-11', 'Novi Dobavljač', 'F-1')"
  ).run();
  db.prepare(
    'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (1, 1, 10, 2.5, 1.8, 5, ?)'
  ).run('E');

  const stavka = db.prepare('SELECT nabavnaCijena, rabat FROM primka_stavke WHERE id = 1').get() as any;
  expect(stavka).toEqual({ nabavnaCijena: 1.8, rabat: 5 });
  db.close();
});

test('nakon nadogradnje se prilog može upisati na stari račun', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  db.prepare('UPDATE orders SET prilogBroj = 1 WHERE id = 1').run();
  db.prepare(
    "INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 2, 2.5, 'E')"
  ).run();

  const stavka = db.prepare('SELECT orderId, kolicina, cijena FROM prilog_stavke WHERE id = 1').get() as any;
  expect(stavka).toEqual({ orderId: 1, kolicina: 2, cijena: 2.5 });
  expect((db.prepare('SELECT prilogBroj FROM orders WHERE id = 1').get() as any).prilogBroj).toBe(1);
  db.close();
});

test('migracije su idempotentne — ponovljeni uvoz iste baze ne puca', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);
  const first = [...tables(db)].sort().join(',');

  expect(() => openAsCurrentVersion(db)).not.toThrow();
  expect(() => openAsCurrentVersion(db)).not.toThrow();
  expect([...tables(db)].sort().join(',')).toBe(first);
  db.close();
});

test('aktuelna baza prolazi kroz migracije bez promjena', () => {
  const db: Db = new Database(':memory:');
  openAsCurrentVersion(db);
  const before = [...tables(db)].sort().join(',');
  runMigrations(db);
  expect([...tables(db)].sort().join(',')).toBe(before);
  db.close();
});
