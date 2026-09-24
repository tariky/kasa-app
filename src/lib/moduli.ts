// Licencirani moduli. Katalog (lista, nazivi, kanal → moduli) je u
// moduliKatalog.json da ga Rust backend čita isti (`include_str!`).
// Jezgro — Kasa, Šifarnik, Računi, Izvještaji — nije ovdje: uvijek je uključeno.
import katalog from './moduliKatalog.json';
import type { StanjeLicence } from './licencaTipovi';

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

export type SkupModula = Record<Modul, boolean>;

/** Šta licenca dozvoljava. Stari token bez liste i stanje bez licence daju sve. */
export function licenciraniModuli(s: StanjeLicence): SkupModula {
  const lista = 'licenca' in s ? s.licenca.moduli : undefined;
  return Object.fromEntries(LICENCIRANI_MODULI.map(m => [m, lista ? lista.includes(m) : true])) as SkupModula;
}

/** Prvi modul koji kanal traži a licenca ga nema; null = kanal je dozvoljen. */
export function modulVanLicence(s: StanjeLicence, kanal: string): Modul | null {
  // Object.hasOwn: ključevi s prototipa (`constructor`, `toString`) nisu kanali.
  if (!Object.hasOwn(KANALI_MODULA, kanal)) return null;
  const l = licenciraniModuli(s);
  return KANALI_MODULA[kanal].find(m => !l[m]) ?? null;
}

export interface PostavkeModula {
  proizvodnja: boolean;
  generator: boolean;
}

export interface StanjeModula {
  licencirani: SkupModula;
  ukljuceni: SkupModula;
  /** Radni nalog iz ponude — samo kad su uključene i Ponude i Proizvodnja. */
  vezaPonudaNalog: boolean;
}

/** Licenca kaže šta je dozvoljeno; Proizvodnja i Generator traže i uključenu postavku. */
export function stanjeModula(licencirani: SkupModula, p: PostavkeModula): StanjeModula {
  const ukljuceni: SkupModula = {
    skladiste: licencirani.skladiste,
    ponude: licencirani.ponude,
    proizvodnja: licencirani.proizvodnja && p.proizvodnja,
    generator: licencirani.generator && p.generator,
  };
  return { licencirani, ukljuceni, vezaPonudaNalog: ukljuceni.ponude && ukljuceni.proizvodnja };
}

/** "Skladište, Ponude" / "samo osnovni" / "svi (bez ograničenja)" za stari token. */
export function opisModula(moduli?: Modul[]): string {
  if (!moduli) return 'svi (bez ograničenja)';
  if (!moduli.length) return 'samo osnovni';
  return moduli.map(m => NAZIV_MODULA[m]).join(', ');
}
