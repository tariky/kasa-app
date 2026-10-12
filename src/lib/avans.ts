import { round2 } from './novac';

/**
 * Avans iz unosa (ponuda, radni nalog): bez vrijednosti 0, inače nenegativan
 * broj zaokružen na pfening. Avans je samo podatak za dokument — ne dira kasu.
 * Rust: `ponude::avans_iz_unosa`.
 */
export function avansIzUnosa(v: unknown): number {
  if (v == null) return 0;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Avans nije ispravan broj');
  if (v < 0) throw new Error('Avans ne može biti negativan');
  return round2(v);
}

/** Ostatak za uplatu poslije avansa. */
export function ostatakPoslijeAvansa(iznos: number, avans: number): number {
  return round2(iznos - avans);
}
