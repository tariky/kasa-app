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

/**
 * PDV sadržan u iznosu jedne stavke. Cijene su sa uračunatim PDV-om, pa se PDV
 * izlučuje iz iznosa. Stopa 'K' je oslobođena PDV-a → 0.
 *
 * Nezaokruženo namjerno: zbir se zaokružuje jednom, u `izracunajTotale`.
 * Za prikaz po stavci zaokružuje sam formatter, pa se kolona PDV-a na
 * dokumentu može razlikovati od ukupnog PDV-a za fening.
 */
export function pdvStavke(s: RacunStavka): number {
  if (s.pdvStopa !== 'E') return 0;
  const iznos = iznosStavke(s);
  return iznos - iznos / 1.17;
}

export function izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number } {
  const ukupno = round2(stavke.reduce((sum, s) => sum + iznosStavke(s), 0));
  const pdvIznos = round2(stavke.reduce((sum, s) => sum + pdvStavke(s), 0));
  return { ukupno, pdvIznos };
}
