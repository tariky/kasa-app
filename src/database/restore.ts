import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

// Minimalni podskup drivera koji uvoz koristi — omogućava testiranje bez
// Electrona (better-sqlite3 je kompajliran za Electron ABI).
export interface RestoreDb {
  prepare(sql: string): { get(): unknown; all(): unknown[] };
  close(): void;
}

export interface RestoreDeps {
  /** Otvara backup fajl read-only, samo radi provjere. */
  openReadonly: (filePath: string) => RestoreDb;
  /** Zatvara aktivnu bazu (closeDb). */
  closeActive: () => void;
  /** Otvara aktivnu bazu i primjenjuje schemu + migracije (getDb). */
  openActive: () => void;
  /** Flush WAL-a aktivne baze prije kopiranja. */
  checkpointActive: () => void;
}

const REQUIRED_TABLES = ['users', 'products', 'orders'];

/**
 * Provjerava da je fajl ispravna SQLite baza ovog programa.
 * Baca grešku s objašnjenjem; ne dira ništa na disku.
 */
export function validateBackup(filePath: string, deps: RestoreDeps): void {
  let db: RestoreDb | null = null;
  try {
    db = deps.openReadonly(filePath);
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
  } catch (error: any) {
    throw new Error(`Neispravan backup fajl: ${error.message}`);
  } finally {
    try {
      db?.close();
    } catch {
      // Fajl koji se nije mogao ni otvoriti nema šta da se zatvara.
    }
  }
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

  validateBackup(sourcePath, deps);

  deps.checkpointActive();
  copyFileSync(dbPath, safetyPath);
  deps.closeActive();

  try {
    replaceDbFiles(sourcePath, dbPath);
    // Otvaranje pokreće schemu + migracije, pa se backup iz starije verzije
    // programa podiže na aktuelnu strukturu.
    deps.openActive();
  } catch (error: any) {
    deps.closeActive();
    replaceDbFiles(safetyPath, dbPath);
    deps.openActive();
    throw new Error(`Uvoz nije uspio, vraćena je prethodna baza: ${error.message}`);
  }
}

function replaceDbFiles(sourcePath: string, dbPath: string): void {
  // WAL/SHM prethodne baze moraju otići, inače se miješaju s novim fajlom.
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  copyFileSync(sourcePath, dbPath);
  // Ako je backup ručno kopiran uz svoj WAL, prenesi i njega da se ne izgube
  // transakcije koje nisu bile checkpointane.
  if (existsSync(`${sourcePath}-wal`)) {
    copyFileSync(`${sourcePath}-wal`, `${dbPath}-wal`);
  }
}
