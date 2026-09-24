import { round2 } from './novac';
import { parseDecimal } from './utils';

/**
 * Konverzija između netto i bruto cijene pri *unosu* artikla ili usluge.
 * U bazi se cijena uvijek čuva kao bruto (sa PDV-om) — ove funkcije samo
 * prevode ono što korisnik ukuca kad upisuje cijenu bez PDV-a.
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

/** Cijena za koju se zna tačan bruto iznos — spremljeni artikal ili zadnja promjena režima. */
export interface Sidro {
  cijena: number;
  pdvStopa: 'E' | 'K';
}

/** Tekst koji polje cijene prikazuje za bruto iznos u datom režimu unosa. */
export function prikazCijene(bruto: number, stopa: 'E' | 'K', bezPdv: boolean): string {
  return String(bezPdv ? uNetto(bruto, stopa) : bruto);
}

/**
 * Bruto cijena (ono što ide u bazu i što kupac plaća) iz onoga što je upisano.
 *
 * Pravilo 2 (sigurnost novca): dok polje prikazuje tačno ono što je izvedeno
 * iz sidra (ista stopa, isti tekst), vraća se NEPROMIJENJENA bruto vrijednost
 * sidra — jer bruto→netto→bruto konverzija nije povratna za svaku vrijednost
 * (npr. 100,00 → 85,47 → 99,99), pa bi inače sama izmjena naziva artikla ili
 * prebacivanje "sa PDV / bez PDV" tiho pomjerilo cijenu za fening.
 *
 * `bezPdv` je namjerno `boolean`, a ne `boolean | null` — stanje "postavka
 * se još učitava" mora biti blokirano prije poziva ove funkcije.
 */
export function brutoIzUnosa(args: {
  unos: string;
  stopa: 'E' | 'K';
  bezPdv: boolean;
  sidro: Sidro | null;
}): number {
  const { unos, stopa, bezPdv, sidro } = args;
  if (sidro && stopa === sidro.pdvStopa && unos === prikazCijene(sidro.cijena, stopa, bezPdv)) {
    return sidro.cijena;
  }
  return bezPdv ? uBruto(parseDecimal(unos), stopa) : parseDecimal(unos);
}

/**
 * Prebacivanje "sa PDV / bez PDV" čuva cijenu, a ne tekst: 117 sa PDV-om
 * postaje 100 bez PDV-a. Novo sidro pamti tačan bruto, pa povratak nazad
 * vraća isti broj umjesto fening pomjerenog.
 */
export function promijeniRezim(
  stanje: { unos: string; stopa: 'E' | 'K'; bezPdv: boolean; sidro: Sidro | null },
  noviBezPdv: boolean,
): { unos: string; sidro: Sidro | null } {
  const { unos, stopa, sidro } = stanje;
  const bruto = brutoIzUnosa(stanje);
  if (unos.trim() === '' || isNaN(bruto)) return { unos, sidro };
  return { unos: prikazCijene(bruto, stopa, noviBezPdv), sidro: { cijena: bruto, pdvStopa: stopa } };
}
