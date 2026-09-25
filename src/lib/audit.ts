import type { SqlDb } from './sqldb';

// Audit log (tabela audit_log): trag osjetljivih radnji. Samo upis — nijedan
// kanal ga ne čita, ne mijenja i ne briše. Pozivalac bira akciju i detalje;
// ovdje je samo zaštitna mreža da PIN, lozinka ili heš nikad ne uđu u detalje.

/** Ključevi koji se izbacuju iz detalja, na bilo kojoj dubini. */
const TAJNI_KLJUCEVI = /^(pin|adminPin|operatorPassword|lozinka|password)$/i;

/** Tekst koji liči na heš PIN-a (lib/korisnici.ts) se zamijeni ovim. */
export const SKRIVENO = '[skriveno]';

function ocisti(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith('pbkdf2$') ? SKRIVENO : v;
  if (Array.isArray(v)) return v.map(ocisti);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !TAJNI_KLJUCEVI.test(k)).map(([k, x]) => [k, ocisti(x)]));
  }
  return v;
}

/** Upiše jednu radnju. `korisnikId` je prijavljeni korisnik (null = niko). */
export function zapisiAudit(db: SqlDb, korisnikId: number | null, akcija: string, detalji: Record<string, unknown>): void {
  db.prepare('INSERT INTO audit_log (korisnikId, akcija, detalji) VALUES (?, ?, ?)')
    .run(korisnikId, akcija, JSON.stringify(ocisti(detalji)));
}

export interface PromjenaPostavke {
  kljuc: string;
  staraVrijednost?: string | null;
  novaVrijednost?: string;
  /** Umjesto vrijednosti, za tajne (lozinka) i velike (logo) postavke. */
  promijenjena?: true;
}

/**
 * Promjene postavki za audit: samo ključevi čija se vrijednost promijenila,
 * redom kako su dati. Za ključeve iz `bezVrijednosti` ide samo
 * `{ kljuc, promijenjena: true }`.
 */
export function promjenePostavki(
  stare: (kljuc: string) => string | null,
  nove: Array<[kljuc: string, vrijednost: string]>,
  bezVrijednosti: ReadonlySet<string> = new Set(),
): PromjenaPostavke[] {
  const promjene: PromjenaPostavke[] = [];
  for (const [kljuc, novaVrijednost] of nove) {
    const staraVrijednost = stare(kljuc);
    if (staraVrijednost === novaVrijednost) continue;
    promjene.push(bezVrijednosti.has(kljuc) ? { kljuc, promijenjena: true } : { kljuc, staraVrijednost, novaVrijednost });
  }
  return promjene;
}
