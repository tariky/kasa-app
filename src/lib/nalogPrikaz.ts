// src/lib/nalogPrikaz.ts
// Čisti pomoćnici za prikaz radnog naloga — bez baze, bez React-a.
import type { NalogStatus, NalogVrsta, ProizvodPonude } from '@/types';
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

// ── proizvodi naloga iz ponude ───────────────────────────

type StavkaPonude = Pick<ProizvodPonude, 'ponudaStavkaId' | 'productId' | 'kolicina'>;

/** Zadani izbor: stavke čijeg artikla nema dovoljno na zalihi. */
export function zadaniIzbor(linije: ProizvodPonude[]): Set<number> {
  return new Set(linije.filter(l => l.zadano).map(l => l.ponudaStavkaId));
}

/**
 * Stavke ponude koje odgovaraju spremljenom izboru naloga: svaki proizvod označi
 * jednu stavku istog artikla — prvo onu s istom količinom, inače prvu slobodnu.
 */
export function oznaceneStavke(linije: StavkaPonude[], proizvodi: Array<{ productId: number; kolicina: number }>): Set<number> {
  const slobodne = [...linije];
  const out = new Set<number>();
  for (const p of proizvodi) {
    let i = slobodne.findIndex(l => l.productId === p.productId && Math.abs(l.kolicina - p.kolicina) < 1e-9);
    if (i < 0) i = slobodne.findIndex(l => l.productId === p.productId);
    if (i < 0) continue;
    out.add(slobodne[i].ponudaStavkaId);
    slobodne.splice(i, 1);
  }
  return out;
}

/** Izbor za backend: po jedan proizvod za svaku označenu stavku, redom ponude. */
export function proizvodiIzIzbora(linije: StavkaPonude[], oznacene: Set<number>): Array<{ productId: number; kolicina: number }> {
  return linije.filter(l => oznacene.has(l.ponudaStavkaId)).map(l => ({ productId: l.productId, kolicina: l.kolicina }));
}
