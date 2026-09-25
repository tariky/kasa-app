// Kanal izvoz:knjigovodja: rezultati upita iz upiti.ts za period od–do.
// Rust parnjak: src-tauri/backend/src/izvoz.rs.
import type { SqlDb } from '../sqldb';
import { UPITI } from './upiti';
import type { KnjigovodjaPodaci } from './tipovi';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export function dohvatiKnjigovodja(db: SqlDb, od: unknown, doDatum: unknown): KnjigovodjaPodaci {
  if (typeof od !== 'string' || typeof doDatum !== 'string' || !DATUM.test(od) || !DATUM.test(doDatum) || od > doDatum) {
    throw new Error('Neispravan period');
  }
  const vrijednosti = { od, do: doDatum };
  const out: Record<string, unknown> = { od, do: doDatum };
  for (const [ime, sql] of Object.entries(UPITI)) {
    // Samo parametri koje upit spominje — bun:sqlite (strict) ne voli višak.
    const p = Object.fromEntries(Object.entries(vrijednosti).filter(([k]) => sql.includes(`:${k}`)));
    out[ime] = db.prepare(sql).all(p);
  }
  return out as unknown as KnjigovodjaPodaci;
}
