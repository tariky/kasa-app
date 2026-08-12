import { round2 } from './novac';
import { parseDecimal } from './utils';

/**
 * Konverzija između netto i bruto cijene pri *unosu* artikla ili usluge.
 * U bazi se cijena uvijek čuva kao bruto (sa PDV-om) — ove funkcije samo
 * prevode ono što korisnik ukuca kad je uključena postavka
 * `cijene.unosBezPdv`.
 *
 * Stopa 'E' je 17 %, stopa 'K' je oslobođena PDV-a pa se ne dira. Faktor
 * 1.17 se namjerno drži u istom obliku kao u `src/lib/racun.ts`.
 */
const FAKTOR_E = 1.17;

/** Netto (bez PDV-a) → bruto (sa PDV-om). */
export function uBruto(netto: number, pdvStopa: 'E' | 'K'): number {
  if (pdvStopa !== 'E') return netto;
  return round2(netto * FAKTOR_E);
}

/** Bruto (sa PDV-om) → netto (bez PDV-a). */
export function uNetto(bruto: number, pdvStopa: 'E' | 'K'): number {
  if (pdvStopa !== 'E') return bruto;
  return round2(bruto / FAKTOR_E);
}

/**
 * Odlučuje koja cijena ide u bazu pri spremanju artikla/usluge.
 *
 * Pravilo 2 (sigurnost novca): ako korisnik uopšte nije dirao polje cijene
 * niti promijenio PDV stopu, u bazu ide NEPROMIJENJENA originalna bruto
 * vrijednost — jer bruto→netto→bruto konverzija nije povratna za svaku
 * vrijednost (npr. 100,00 → 85,47 → 99,99), pa bi inače sama izmjena naziva
 * artikla mogla tiho pomjeriti cijenu za fening.
 *
 * `bezPdv` je namjerno `boolean`, a ne `boolean | null` — stanje "postavka
 * se još učitava" mora biti blokirano prije poziva ove funkcije (dijalozi to
 * rade preko `disabled` na dugmetu Spremi i ranim `return`-om u handleru),
 * da ova funkcija ne bi mogla tiho progutati nerazriješenu postavku.
 */
export function cijenaZaSpremanje(args: {
  unos: string;
  unosInit: string;
  stopa: 'E' | 'K';
  original: { cijena: number; pdvStopa: 'E' | 'K' } | null;
  bezPdv: boolean;
}): number {
  const { unos, unosInit, stopa, original, bezPdv } = args;
  if (original && unos === unosInit && stopa === original.pdvStopa) {
    return original.cijena;
  }
  return bezPdv ? uBruto(parseDecimal(unos), stopa) : parseDecimal(unos);
}
