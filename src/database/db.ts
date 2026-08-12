import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { schema } from './schema';
import { runMigrations } from './migrations';

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
