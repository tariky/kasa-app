// Licencirani moduli. Katalog (lista, nazivi, kanal → moduli) je u
// moduliKatalog.json da ga Rust backend čita isti (`include_str!`).
// Jezgro — Kasa, Šifarnik, Računi, Izvještaji — nije ovdje: uvijek je uključeno.
import katalog from './moduliKatalog.json';

export type Modul = 'skladiste' | 'ponude' | 'proizvodnja' | 'generator';

export const LICENCIRANI_MODULI = katalog.moduli as readonly Modul[];
export const NAZIV_MODULA = katalog.nazivi as Record<Modul, string>;
export const KANALI_MODULA = katalog.kanali as Record<string, Modul[]>;

/**
 * Sirovo `m` polje tokena → poznati moduli, bez duplikata, redom iz kataloga.
 * Nepoznati ID se ignoriše (token iz novijeg generatora). null = nije niz stringova.
 */
export function normalizujModule(m: unknown): Modul[] | null {
  if (!Array.isArray(m) || !m.every(x => typeof x === 'string')) return null;
  return LICENCIRANI_MODULI.filter(x => m.includes(x));
}
