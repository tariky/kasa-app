// Pragme aktivne konekcije (getDb). Odvojeno od db.ts da se mogu testirati
// bez Electrona; Rust backend (src-tauri/backend/src/baza.rs) postavlja iste.

/** Redom: WAL, strani ključevi, i shema ne smije pozivati nebezbjedne funkcije. */
export const PRAGME_KONEKCIJE = ['journal_mode = WAL', 'foreign_keys = ON', 'trusted_schema = OFF'] as const;

export function podesiKonekciju(db: { pragma(izraz: string): unknown }): void {
  for (const p of PRAGME_KONEKCIJE) db.pragma(p);
}
