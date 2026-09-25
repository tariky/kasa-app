import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { schema } from './schema';

// Minimalni podskup drivera koji uvoz koristi — omogućava testiranje bez
// Electrona (better-sqlite3 je kompajliran za Electron ABI).
export interface RestoreDb {
  prepare(sql: string): { get(): unknown; all(): unknown[] };
  exec(sql: string): unknown;
  close(): void;
}

export interface RestoreDeps {
  /**
   * Otvara postojeći fajl read-write (bez kreiranja). Koristi se samo nad
   * kopijama koje ovaj modul pravi — korisnikov backup se nikad ne otvara.
   */
  open: (filePath: string) => RestoreDb;
  /** Zatvara aktivnu bazu (closeDb). */
  closeActive: () => void;
  /** Otvara aktivnu bazu i primjenjuje schemu + migracije (getDb). */
  openActive: () => void;
  /** Flush WAL-a aktivne baze prije kopiranja. */
  checkpointActive: () => void;
}

const REQUIRED_TABLES = ['users', 'products', 'orders'];

/**
 * Tabele koje program pravi — sve iz `schema.ts` (migracije ne prave nijednu
 * koje tamo nema). Uz njih backup smije imati samo interne `sqlite_*` tabele.
 */
export const TABELE_SHEME: ReadonlySet<string> = new Set(
  [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1])
);

/**
 * Odbija objekte koje program ne pravi: trigger i view (program nema
 * nijedan — izvršili bi se nad podacima programa) i tabele kojih nema u
 * shemi (uključujući virtuelne). Indeksi se ne provjeravaju.
 */
function provjeriObjekte(db: RestoreDb): void {
  const objekti = db.prepare(
    "SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view', 'table') ORDER BY type DESC, rowid"
  ).all() as { type: string; name: string }[];
  const izvrsni = objekti.filter(o => o.type === 'trigger' || o.type === 'view');
  if (izvrsni.length > 0) {
    throw new Error(`Fajl sadrži trigger ili view (${izvrsni.map(o => `${o.type} ${o.name}`).join(', ')}), a Kasa baza ih nema.`);
  }
  const strane = objekti
    .filter(o => o.type === 'table' && !TABELE_SHEME.has(o.name) && !o.name.startsWith('sqlite_'))
    .map(o => o.name)
    .sort();
  if (strane.length > 0) throw new Error(`Fajl sadrži tabele kojih nema u Kasa bazi: ${strane.join(', ')}.`);
}

/**
 * Provjerava da je fajl ispravna SQLite baza ovog programa.
 * Baca grešku s objašnjenjem; ne dira ništa na disku.
 */
export function validateBackup(filePath: string, deps: RestoreDeps): void {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kasa-uvoz-'));
  try {
    pripremiKopiju(filePath, tmp, deps);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Kopira backup (i njegov -wal, ako postoji) u `folder`, prebaci kopiju u
 * DELETE journal mode i provjeri je. Vraća putanju provjerene kopije.
 *
 * Kopija baze u WAL modu bez -shm ne može se pouzdano otvoriti read-only
 * (SQLITE_CANTOPEN, ili "attempt to write a readonly database" kad je folder
 * read-only), a read-write otvaranje originala bi pored njega ostavilo
 * -wal/-shm. Zato se radi nad kopijom.
 */
function pripremiKopiju(filePath: string, folder: string, deps: RestoreDeps): string {
  const kopija = path.join(folder, 'backup.db');
  let db: RestoreDb | null = null;
  try {
    if (!existsSync(filePath)) throw new Error('Fajl ne postoji.');
    copyFileSync(filePath, kopija);
    if (existsSync(`${filePath}-wal`)) copyFileSync(`${filePath}-wal`, `${kopija}-wal`);
    db = deps.open(kopija);
    // Shema iz tuđeg fajla ne smije pozivati funkcije koje nisu bezopasne.
    db.exec('PRAGMA trusted_schema = OFF');
    uDeleteMode(db);
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('Baza je oštećena.');
    }
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = new Set(rows.map(r => r.name));
    const missing = REQUIRED_TABLES.filter(t => !names.has(t));
    if (missing.length > 0) {
      throw new Error(`Fajl nije backup Kasa baze (nedostaje: ${missing.join(', ')}).`);
    }
    provjeriObjekte(db);
  } catch (error: any) {
    throw new Error(`Neispravan backup fajl: ${error.message}`);
  } finally {
    try {
      db?.close();
    } catch {
      // Fajl koji se nije mogao ni otvoriti nema šta da se zatvara.
    }
  }
  return kopija;
}

/** Upiše sve iz -wal u glavni fajl i prebaci bazu u DELETE journal mode. */
function uDeleteMode(db: RestoreDb): void {
  const r = db.prepare('PRAGMA journal_mode = DELETE').get() as { journal_mode?: string } | undefined;
  if (r?.journal_mode !== 'delete') {
    throw new Error(`Baza se ne može prebaciti iz ${r?.journal_mode ?? 'nepoznatog'} journal moda.`);
  }
}

/**
 * Kopija aktivne baze kao jedan samostalan fajl (DELETE journal mode), koji
 * SQLite otvara bilo kako, i read-only, bez -wal/-shm pored njega.
 */
export function samostalnaKopija(dbPath: string, cilj: string, deps: RestoreDeps): void {
  deps.checkpointActive();
  // Ostaci ranijeg fajla na istoj putanji bi se primijenili na novu kopiju.
  rmSync(`${cilj}-wal`, { force: true });
  rmSync(`${cilj}-shm`, { force: true });
  copyFileSync(dbPath, cilj);
  const db = deps.open(cilj);
  try {
    uDeleteMode(db);
  } finally {
    db.close();
  }
  // Neki SQLite buildovi (npr. sistemski na macOS-u) ostave prazan -shm i
  // nakon prelaska u DELETE mode; baza ga više ne koristi.
  rmSync(`${cilj}-shm`, { force: true });
}

/**
 * Zamjenjuje aktivnu bazu backup fajlom. Prije zamjene sprema kopiju zatečene
 * baze na `safetyPath`; ako zamjena ili migracije puknu, vraća to stanje i baca
 * grešku, tako da program ostaje upotrebljiv.
 */
export function swapInBackup(
  sourcePath: string,
  dbPath: string,
  safetyPath: string,
  deps: RestoreDeps,
): void {
  if (path.resolve(sourcePath) === path.resolve(dbPath)) {
    throw new Error('Odabrana je trenutno aktivna baza, ne backup fajl.');
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'kasa-uvoz-'));
  try {
    // Uvozi se provjerena kopija: transakcije iz -wal uz backup su već
    // upisane u nju, pa se prenosi samo jedan fajl.
    const kopija = pripremiKopiju(sourcePath, tmp, deps);

    samostalnaKopija(dbPath, safetyPath, deps);
    deps.closeActive();

    try {
      replaceDbFile(kopija, dbPath);
      // Otvaranje pokreće schemu + migracije, pa se backup iz starije verzije
      // programa podiže na aktuelnu strukturu.
      deps.openActive();
    } catch (error: any) {
      deps.closeActive();
      replaceDbFile(safetyPath, dbPath);
      deps.openActive();
      throw new Error(`Uvoz nije uspio, vraćena je prethodna baza: ${error.message}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function replaceDbFile(sourcePath: string, dbPath: string): void {
  // WAL/SHM prethodne baze moraju otići, inače se miješaju s novim fajlom.
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  copyFileSync(sourcePath, dbPath);
}
