// src/lib/izvjestaji.ts
// Sume izvještaja (Promet, Ulaz robe, Nivelacije) na jednom mjestu — za ekran
// Izvještaja i njegove PDF-ove. Iznosi su zaokruženi na fening (round2).

import { kalkulacijaPrimke, type StavkaZaKalkulaciju } from './kalkulacija';
import { round2 } from './novac';

export interface SumePrimki {
  /** Nabavna vrijednost svih stavki (fakturna − rabat + zavisni), i materijala. */
  nabavna: number;
  /** Nabavna samo stavki koje se prodaju — osnova za RUC. */
  nabavnaArtikala: number;
  prodajnaBezPdv: number;
  /** Maloprodajna vrijednost sa PDV-om. */
  prodajnaSaPdv: number;
  /** Razlika u cijeni: prodajna bez PDV-a − nabavna, samo artikli (kao na kalkulaciji). */
  ruc: number;
  /** RUC / nabavna artikala × 100. */
  rucPct: number;
}

/**
 * Sume primki po obrascu kalkulacije (`kalkulacijaPrimke`): RUC je bez PDV-a i
 * samo nad stavkama koje se prodaju — materijal je u nabavnoj, ali ne u RUC-u.
 * Stopa RUC se računa iz zbira, ne kao prosjek stopa primki.
 */
export function sumePrimke(primke: Array<{ stavke?: StavkaZaKalkulaciju[] }>): SumePrimki {
  let nabavna = 0, nabavnaArtikala = 0, prodajnaBezPdv = 0, prodajnaSaPdv = 0, ruc = 0;
  for (const p of primke) {
    const k = kalkulacijaPrimke(p.stavke ?? []);
    nabavna += k.nabavna;
    nabavnaArtikala += k.nabavnaArtikala;
    prodajnaBezPdv += k.prodajnaBezPdv;
    prodajnaSaPdv += k.prodajna;
    ruc += k.ruc;
  }
  return {
    nabavna: round2(nabavna),
    nabavnaArtikala: round2(nabavnaArtikala),
    prodajnaBezPdv: round2(prodajnaBezPdv),
    prodajnaSaPdv: round2(prodajnaSaPdv),
    ruc: round2(ruc),
    rucPct: nabavnaArtikala > 0 ? round2((ruc / nabavnaArtikala) * 100) : 0,
  };
}

/** RUC jedne primke — isti broj koji pokazuje kalkulacija te primke. */
export function rucPrimke(primka: { stavke?: StavkaZaKalkulaciju[] }): { ruc: number; rucPct: number } {
  const { ruc, rucPct } = sumePrimke([primka]);
  return { ruc, rucPct };
}
