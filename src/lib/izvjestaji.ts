// src/lib/izvjestaji.ts
// Sume izvještaja (Promet, Ulaz robe, Nivelacije) na jednom mjestu — za ekran
// Izvještaja i njegove PDF-ove. Sume prometa i nivelacija su zaokružene na fening
// (round2); sume primki nisu — vidi sumePrimke.

import { kalkulacijaPrimke, type StavkaZaKalkulaciju } from './kalkulacija';
import { round2 } from './novac';
import { izluciPdv, PDV_STOPA_E_PCT } from './pdv';

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
 *
 * Namjerno bez zaokruživanja: za jednu primku to su tačno brojevi kalkulacije, pa
 * ih ekran i PDF (formatKM / formatRucPct) prikazuju isto kao UlazDialog. round2
 * prije prikaza je davao drugi broj (nabavna 11,495 → 11,50 umjesto 11,49; stopa
 * 6,749 → 6,75 → „6,8“ umjesto „6,7“).
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
    nabavna, nabavnaArtikala, prodajnaBezPdv, prodajnaSaPdv, ruc,
    rucPct: nabavnaArtikala > 0 ? (ruc / nabavnaArtikala) * 100 : 0,
  };
}

/** Stopa RUC-a za prikaz: jedna decimala, zarez — isti zapis u Izvještajima i u UlazDialogu. */
export function formatRucPct(rucPct: number): string {
  return rucPct.toFixed(1).replace('.', ',');
}

export interface SumePrometa {
  /** Zbir izvršenih računa, sa PDV-om. */
  ukupno: number;
  pdv: number;
  /** Osnovica: ukupno − PDV. */
  bezPdv: number;
  brojRacuna: number;
  /** Zbir storniranih računa. */
  reklamacije: number;
  brojReklamacija: number;
}

/** Sume prometa za period: izvršeni računi (`completed`) i, odvojeno, stornirani (`refunded`). */
export function sumePrometa(orders: Array<{ ukupno: number; pdvIznos: number; status?: string }>): SumePrometa {
  let ukupno = 0, pdv = 0, brojRacuna = 0, reklamacije = 0, brojReklamacija = 0;
  for (const o of orders) {
    if (o.status === 'completed') {
      ukupno += o.ukupno; pdv += o.pdvIznos; brojRacuna++;
    } else if (o.status === 'refunded') {
      reklamacije += o.ukupno; brojReklamacija++;
    }
  }
  ukupno = round2(ukupno);
  pdv = round2(pdv);
  return { ukupno, pdv, bezPdv: round2(ukupno - pdv), brojRacuna, reklamacije: round2(reklamacije), brojReklamacija };
}

/** Zbir pozitivnih i zbir negativnih iznosa, na fening. */
export function razlikePoZnaku(iznosi: number[]): { pozitivna: number; negativna: number } {
  let pozitivna = 0, negativna = 0;
  for (const x of iznosi) {
    if (x > 0) pozitivna += x;
    else if (x < 0) negativna += x;
  }
  return { pozitivna: round2(pozitivna), negativna: round2(negativna) };
}

export interface SumeNivelacija {
  /** Neto razlika u prodajnoj vrijednosti: Σ količina × (nova − stara), sa PDV-om. */
  razlika: number;
  /** Zbir stavki kojima je vrijednost porasla. */
  pozitivna: number;
  /** Zbir stavki kojima je vrijednost pala (negativan broj). */
  negativna: number;
  /** PDV sadržan u razlici stavki sa stopom E. */
  pdvRazlike: number;
}

/** Sume nivelacija po stavkama; razlika stavke je ista kao `ukupnaRazlika` koju upisuje backend. */
export function sumeNivelacija(
  nivelacije: Array<{ stavke?: Array<{ kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string }> }>,
): SumeNivelacija {
  const razlike: number[] = [];
  let razlikaE = 0;
  for (const n of nivelacije) {
    for (const s of n.stavke ?? []) {
      const r = (s.novaCijena - s.staraCijena) * s.kolicina;
      razlike.push(r);
      if (s.pdvStopa === 'E') razlikaE += r;
    }
  }
  return {
    razlika: round2(razlike.reduce((a, r) => a + r, 0)),
    ...razlikePoZnaku(razlike),
    pdvRazlike: izluciPdv(razlikaE, PDV_STOPA_E_PCT),
  };
}
