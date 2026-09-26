import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { schema } from './schema';
import { runMigrations } from './migrations';
import { podesiKonekciju } from './konekcija';
import { osigurajZadanogAdmina } from '../lib/korisnici';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'kasa.db');
  db = new Database(dbPath);

  podesiKonekciju(db);

  db.exec(schema);

  // Migracije za baze iz starijih verzija (migracije.json) — uključujući
  // heširanje PIN-ova koji su bili čist tekst.
  runMigrations(db);

  seedDefaults(db);

  return db;
}

function seedDefaults(database: Database.Database): void {
  // Zadani Admin/0000 samo u praznoj bazi — inače bi se vraćao pri svakom
  // pokretanju i nakon što ga korisnik obriše ili mu promijeni PIN.
  osigurajZadanogAdmina(database);

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
