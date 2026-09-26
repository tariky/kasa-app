// Tabela `settings`: jedan ključ, grupa ključeva s istim prefiksom i upis s
// tragom promjena. Ko smije čitati i mijenjati koji ključ odlučuje
// src/ipc/sesija.ts (pristup.json) — ovdje nema provjere pristupa.
import type { SqlDb } from './sqldb';
import { promjenePostavki, type PromjenaPostavke } from './audit';

/** Vrijednost ključa; null kad ključa nema (ili je NULL). */
export function procitajPostavku(db: SqlDb, kljuc: string): string | null {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(kljuc) as { value: string | null } | undefined)?.value ?? null;
}

/**
 * Svi ključevi `<prefiks>.*` bez prefiksa (`firma.naziv` → `naziv`). SQLite
 * LIKE ne razlikuje velika slova, pa se prefiks skida kao i dosad (samo
 * tačan `<prefiks>.`) — ključ drugih slova ne prepiše pravi.
 */
export function procitajGrupu(db: SqlDb, prefiks: string): Record<string, string> {
  const redovi = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all(`${prefiks}.%`) as
    Array<{ key: string; value: string }>;
  const grupa: Record<string, string> = {};
  for (const r of redovi) grupa[r.key.replace(`${prefiks}.`, '')] = r.value;
  return grupa;
}

/** Trag upisa u audit_log: jedan zapis `akcija` s `{ promjene }`, samo kad se nešto promijenilo. */
export interface TragUpisaPostavki {
  audit: (akcija: string, detalji: Record<string, unknown>) => void;
  akcija: string;
  /** Ključevi čija vrijednost ne ulazi u trag (lozinka, logo) — samo `promijenjena: true`. */
  bezVrijednosti?: ReadonlySet<string>;
}

/**
 * Upiše (INSERT ili prepiše) sve parove redom. Stare vrijednosti se čitaju
 * prije upisa; vraća promjene (vidi `promjenePostavki`), pa pozivalac može i
 * sam složiti trag. Transakciju otvara pozivalac.
 */
export function upisiPostavke(
  db: SqlDb, nove: ReadonlyArray<[kljuc: string, vrijednost: string]>, trag?: TragUpisaPostavki,
): PromjenaPostavke[] {
  const promjene = promjenePostavki(k => procitajPostavku(db, k), [...nove], trag?.bezVrijednosti);
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of nove) upsert.run(k, v);
  if (trag && promjene.length > 0) trag.audit(trag.akcija, { promjene });
  return promjene;
}
