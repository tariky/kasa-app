import type Database from 'better-sqlite3';
import { kanonskiNacinPlacanja, NACINI_PLACANJA } from '../lib/placanje';
import { hesirajStarePinove } from '../lib/korisnici';
import migracije from './migracije.json';

/**
 * Korak iz migracije.json — isti fajl čita Rust backend (baza.rs), pa su
 * migracije i njihov redoslijed isti u oba. SQL korak se izvrši kad tabeli
 * nedostaje `kolona` (bez nje uvijek: CREATE … IF NOT EXISTS), a
 * `samoAkoTabelaPostoji` ga preskače kad tabele nema. Korak `kod` je migracija
 * koja nije čist SQL (čita podatke): funkcija iz KOD_MIGRACIJA. `opis` je komentar.
 */
export type KorakMigracije =
  | { tabela: string; kolona?: string; sql: string[]; samoAkoTabelaPostoji?: boolean; opis?: string }
  | { kod: string; opis?: string };

export const KORACI_MIGRACIJA = migracije as KorakMigracije[];

/** Koraci koji nisu čist SQL: ime iz migracije.json → funkcija (Rust: `KOD_MIGRACIJA` u baza.rs). */
export const KOD_MIGRACIJA: ReadonlyMap<string, (database: Database.Database) => void> = new Map([
  ['normalizujNacinPlacanja', normalizujNacinPlacanja],
  ['hesirajStarePinove', (database: Database.Database) => { hesirajStarePinove(database); }],
]);

// Idempotentne migracije za baze iz starijih verzija programa (uključujući
// uvezene backup-e). Pokreću se nakon `schema` pri svakom otvaranju baze.
export function runMigrations(database: Database.Database): void {
  for (const korak of KORACI_MIGRACIJA) {
    if ('kod' in korak) {
      const migracija = KOD_MIGRACIJA.get(korak.kod);
      if (!migracija) throw new Error(`Nepoznat korak migracije: ${korak.kod}`);
      migracija(database);
    } else if (trebaIzvrsiti(database, korak)) {
      for (const sql of korak.sql) database.exec(sql);
    }
  }
}

function trebaIzvrsiti(database: Database.Database, korak: Exclude<KorakMigracije, { kod: string }>): boolean {
  if (korak.kolona === undefined && !korak.samoAkoTabelaPostoji) return true;
  const kolone = (database.prepare(`PRAGMA table_info(${korak.tabela})`).all() as { name: string }[]).map(c => c.name);
  if (korak.samoAkoTabelaPostoji && kolone.length === 0) return false;
  return korak.kolona === undefined || !kolone.includes(korak.kolona);
}

/**
 * Stari zapisi načina plaćanja ('gotovina', ' Gotovina ', 'cek',
 * '{"Gotovina":5}') u kanonski oblik (placanje.ts), da ladica, izvoz i ekran
 * vide isto. Oblik koji parser ne razumije ostaje kakav jeste. Idempotentno.
 */
function normalizujNacinPlacanja(database: Database.Database): void {
  const redovi = database.prepare(
    `SELECT id, nacinPlacanja FROM orders WHERE nacinPlacanja NOT IN (${NACINI_PLACANJA.map(() => '?').join(', ')})`
  ).all(...NACINI_PLACANJA) as Array<{ id: number; nacinPlacanja: unknown }>;
  const upis = database.prepare('UPDATE orders SET nacinPlacanja = ? WHERE id = ?');
  database.transaction(() => {
    for (const r of redovi) {
      if (typeof r.nacinPlacanja !== 'string') continue;
      const kanonski = kanonskiNacinPlacanja(r.nacinPlacanja);
      if (kanonski !== r.nacinPlacanja) upis.run(kanonski, r.id);
    }
  })();
}
