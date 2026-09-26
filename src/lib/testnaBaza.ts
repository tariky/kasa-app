// Baza za lib testove: prazna SQLite baza u memoriji s produkcijskom šemom.
// (better-sqlite3 je buildan za Electron ABI i ne učitava se pod Bun-om, pa
// testovi koriste bun:sqlite — isti SQLite engine, isti SQL.)
import { Database } from 'bun:sqlite';
import { schema } from '../database/schema';
import type { SqlDb } from './sqldb';

/** Baza koju poslovna logika prima kao `SqlDb`, a test koristi i kao bun:sqlite (`transaction`, `exec`). */
export type TestnaBaza = SqlDb & Database;

export interface OpcijeTestneBaze {
  /** Korisnik id 1 (Kasir, uloga kasir) — računi, prilozi i nalozi ga nose kao korisnikId. */
  kasir?: boolean;
}

export function testnaBaza(opcije: OpcijeTestneBaze = {}): TestnaBaza {
  const db = new Database(':memory:') as TestnaBaza;
  db.exec(schema);
  if (opcije.kasir) db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
  return db;
}
