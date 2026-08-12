import { round2 } from './novac';

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
export function uBruto(netto: number, pdvStopa: string): number {
  if (pdvStopa !== 'E') return netto;
  return round2(netto * FAKTOR_E);
}

/** Bruto (sa PDV-om) → netto (bez PDV-a). */
export function uNetto(bruto: number, pdvStopa: string): number {
  if (pdvStopa !== 'E') return bruto;
  return round2(bruto / FAKTOR_E);
}
