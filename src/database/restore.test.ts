import { test, expect, beforeEach, afterEach } from 'bun:test';
// Vidi migrations.test.ts — better-sqlite3 ne učitava se van Electrona, pa se
// driver injektira kroz RestoreDeps i testovi voze bun:sqlite.
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { schema } from './schema';
import { runMigrations } from './migrations';
import { validateBackup, swapInBackup, type RestoreDeps } from './restore';

let dir: string;
let dbPath: string;
let active: any = null;
let openActiveCalls = 0;
let failNextOpen = false;

function openActive(): void {
  openActiveCalls++;
  if (failNextOpen) {
    failNextOpen = false;
    throw new Error('simulirani pad migracija');
  }
  active = new Database(dbPath);
  active.exec('PRAGMA foreign_keys = ON');
  active.exec(schema);
  runMigrations(active);
}

const deps: RestoreDeps = {
  openReadonly: (filePath) => new Database(filePath, { readonly: true }) as any,
  closeActive: () => {
    active?.close();
    active = null;
  },
  openActive,
  checkpointActive: () => {
    active?.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  },
};

/** Baza kakvu bi imala starija verzija programa — bez `tip` kolone. */
function writeLegacyBackup(filePath: string, productName: string): void {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, ime TEXT NOT NULL,
      pin TEXT NOT NULL UNIQUE, uloga TEXT NOT NULL CHECK(uloga IN ('admin','kasir')),
      createdAt TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, sifra TEXT NOT NULL UNIQUE,
      naziv TEXT NOT NULL, jm TEXT DEFAULT 'kom', cijena REAL NOT NULL,
      pdvStopa TEXT NOT NULL CHECK(pdvStopa IN ('E','K')), plu INTEGER, barkod TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      updatedAt TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, korisnikId INTEGER NOT NULL,
      ukupno REAL NOT NULL, pdvIznos REAL NOT NULL, nacinPlacanja TEXT NOT NULL,
      brojFiskalnogRacuna TEXT, brojReklamacije TEXT,
      status TEXT NOT NULL CHECK(status IN ('completed','refunded')),
      createdAt TEXT DEFAULT (datetime('now','localtime')));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare('INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES (?, ?, 1, ?)').run(
    '001', productName, 'E'
  );
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'kasa-restore-'));
  dbPath = path.join(dir, 'kasa.db');
  openActiveCalls = 0;
  failNextOpen = false;
  // Zatečena, aktuelna baza s prepoznatljivim podatkom.
  openActive();
  active.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('999','TRENUTNI',1,'E')").run();
});

afterEach(() => {
  try {
    active?.close();
  } catch {
    // već zatvorena
  }
  active = null;
  rmSync(dir, { recursive: true, force: true });
});

function productNames(filePath: string): string[] {
  const db = new Database(filePath, { readonly: true });
  const rows = db.prepare('SELECT naziv FROM products ORDER BY sifra').all() as { naziv: string }[];
  db.close();
  return rows.map(r => r.naziv);
}

test('odbija fajl koji nije SQLite baza', () => {
  const junk = path.join(dir, 'slika.db');
  writeFileSync(junk, 'ovo nije baza nego obican tekst');
  expect(() => validateBackup(junk, deps)).toThrow(/Neispravan backup fajl/);
});

test('odbija ispravnu SQLite bazu koja nije Kasa baza', () => {
  const foreign = path.join(dir, 'tudja.db');
  const db = new Database(foreign);
  db.exec('CREATE TABLE nesto (a INTEGER)');
  db.close();
  expect(() => validateBackup(foreign, deps)).toThrow(/nije backup Kasa baze/);
});

test('odbija odabir trenutno aktivne baze', () => {
  expect(() => swapInBackup(dbPath, dbPath, path.join(dir, 'safety.db'), deps)).toThrow(
    /trenutno aktivna baza/
  );
});

test('neispravan backup ne dira aktivnu bazu', () => {
  const junk = path.join(dir, 'junk.db');
  writeFileSync(junk, 'smece');
  const safety = path.join(dir, 'safety.db');

  expect(() => swapInBackup(junk, dbPath, safety, deps)).toThrow();
  expect(existsSync(safety)).toBe(false);
  expect(productNames(dbPath)).toEqual(['TRENUTNI']);
});

test('uvoz zamjenjuje bazu i nadograđuje staru schemu', () => {
  const backup = path.join(dir, 'kasa-backup-2024.db');
  writeLegacyBackup(backup, 'IZ BACKUPA');
  const safety = path.join(dir, 'safety.db');

  swapInBackup(backup, dbPath, safety, deps);

  expect(productNames(dbPath)).toEqual(['IZ BACKUPA']);
  // Migracije su odrađene nad uvezenom bazom.
  const db = new Database(dbPath, { readonly: true });
  const cols = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map(c => c.name);
  expect(cols).toContain('tip');
  db.close();
});

test('sigurnosna kopija sadrži zatečene podatke prije zamjene', () => {
  const backup = path.join(dir, 'backup.db');
  writeLegacyBackup(backup, 'IZ BACKUPA');
  const safety = path.join(dir, 'safety.db');

  swapInBackup(backup, dbPath, safety, deps);

  expect(existsSync(safety)).toBe(true);
  expect(productNames(safety)).toEqual(['TRENUTNI']);
});

test('stari WAL/SHM se ne prenose na uvezenu bazu', () => {
  writeFileSync(`${dbPath}-wal`, 'ostatak starog wal-a');
  writeFileSync(`${dbPath}-shm`, 'ostatak starog shm-a');
  const backup = path.join(dir, 'backup.db');
  writeLegacyBackup(backup, 'IZ BACKUPA');

  swapInBackup(backup, dbPath, path.join(dir, 'safety.db'), deps);

  expect(existsSync(`${dbPath}-shm`)).toBe(false);
  if (existsSync(`${dbPath}-wal`)) {
    expect(readFileSync(`${dbPath}-wal`, 'utf8')).not.toContain('ostatak starog wal-a');
  }
});

test('WAL uz backup fajl se prenosi zajedno s bazom', () => {
  const backup = path.join(dir, 'backup.db');
  writeLegacyBackup(backup, 'IZ BACKUPA');
  writeFileSync(`${backup}-wal`, 'sadrzaj wal-a');

  swapInBackup(backup, dbPath, path.join(dir, 'safety.db'), deps);

  expect(existsSync(`${dbPath}-wal`)).toBe(true);
});

test('pad migracija vraća prethodnu bazu i javlja grešku', () => {
  const backup = path.join(dir, 'backup.db');
  writeLegacyBackup(backup, 'IZ BACKUPA');
  const safety = path.join(dir, 'safety.db');
  failNextOpen = true;

  expect(() => swapInBackup(backup, dbPath, safety, deps)).toThrow(
    /Uvoz nije uspio, vraćena je prethodna baza/
  );

  // Zatečeni podaci su vraćeni i baza je ponovo otvorena.
  expect(productNames(dbPath)).toEqual(['TRENUTNI']);
  expect(active).not.toBeNull();
});
