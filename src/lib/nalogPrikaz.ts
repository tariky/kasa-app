// src/lib/nalogPrikaz.ts
// Čisti pomoćnici za prikaz radnog naloga — bez baze, bez React-a.
import type { NalogStatus, NalogVrsta } from '@/types';
import { danaIzmedju } from './ponuda';

export type RokTon = 'ok' | 'warn' | 'late';

/** Ljudska oznaka roka u odnosu na `danas`. Null kad roka nema ili je nalog već zatvoren. */
export function rokOznaka(rok: string | null | undefined, danas: string, zatvoren = false): { label: string; tone: RokTon } | null {
  if (!rok || zatvoren) return null;
  const d = danaIzmedju(danas, rok);
  if (d < 0) {
    const n = -d;
    return { label: `kasni ${n} ${n === 1 ? 'dan' : 'dana'}`, tone: 'late' };
  }
  if (d === 0) return { label: 'danas', tone: 'warn' };
  if (d === 1) return { label: 'sutra', tone: 'warn' };
  return { label: `za ${d} dana`, tone: d <= 3 ? 'warn' : 'ok' };
}

export interface NalogKorak { status: NalogStatus; label: string }

/** Koraci kroz koje nalog stvarno prolazi — narudžba završava fakturom, zaliha ulazom na stanje. */
export function nalogKoraci(vrsta: NalogVrsta): NalogKorak[] {
  const k: NalogKorak[] = [
    { status: 'otvoren', label: 'Otvoren' },
    { status: 'u_izradi', label: 'U izradi' },
    { status: 'zavrsen', label: 'Završen' },
  ];
  if (vrsta === 'narudzba') k.push({ status: 'fakturisan', label: 'Fakturisan' });
  return k;
}

export function korakIndex(vrsta: NalogVrsta, status: NalogStatus): number {
  return nalogKoraci(vrsta).findIndex(k => k.status === status);
}
