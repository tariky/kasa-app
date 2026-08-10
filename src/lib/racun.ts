import { round2 } from './novac';

export interface RacunStavka {
  cijena: number;
  kolicina: number;
  rabat: number; // postotak 0–100
  pdvStopa: string; // 'E' | 'K'
}

/**
 * Iznos jedne stavke, zaokružen na fene. Fiskalni uređaj računa i zaokružuje
 * po stavci, pa se i ovdje mora zaokruživati po stavci — inače zbir koji
 * šaljemo u <Iznos> ne odgovara zbiru koji uređaj sam ispiše.
 */
export function iznosStavke(s: RacunStavka): number {
  return round2(s.cijena * s.kolicina * (1 - s.rabat / 100));
}

export function izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number } {
  const ukupno = round2(stavke.reduce((sum, s) => sum + iznosStavke(s), 0));
  const pdvIznos = round2(
    stavke.reduce((sum, s) => {
      if (s.pdvStopa !== 'E') return sum;
      const iznos = iznosStavke(s);
      return sum + (iznos - iznos / 1.17);
    }, 0)
  );
  return { ukupno, pdvIznos };
}
