// src/lib/nalogPrikaz.ts
// Čisti pomoćnici za prikaz radnog naloga — bez baze, bez React-a.
import type { NalogStatus, NalogVrsta, ProizvodPonude } from '@/types';
import { danaIzmedju } from './ponuda';
import { TOLERANCIJA_ZALIHE } from './tolerancije';

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
 * Spremljeni izbor naloga prema trenutnim stavkama ponude: proizvod označi stavku
 * istog artikla i iste količine. Proizvod bez takve stavke (ponuda je mijenjana
 * nakon izbora) ostaje neusklađen i prikazuje se posebno — završetak ga odbija.
 */
export function uskladiIzbor<P extends { productId: number; kolicina: number }>(
  linije: StavkaPonude[], proizvodi: P[]
): { oznacene: Set<number>; neuskladjeni: P[] } {
  const slobodne = [...linije];
  const oznacene = new Set<number>();
  const neuskladjeni: P[] = [];
  for (const p of proizvodi) {
    const i = slobodne.findIndex(l => l.productId === p.productId && Math.abs(l.kolicina - p.kolicina) < TOLERANCIJA_ZALIHE);
    if (i < 0) { neuskladjeni.push(p); continue; }
    oznacene.add(slobodne[i].ponudaStavkaId);
    slobodne.splice(i, 1);
  }
  return { oznacene, neuskladjeni };
}

/** Izbor za backend: po jedan proizvod za svaku označenu stavku, redom ponude. */
export function proizvodiIzIzbora(linije: StavkaPonude[], oznacene: Set<number>): Array<{ productId: number; kolicina: number }> {
  return linije.filter(l => oznacene.has(l.ponudaStavkaId)).map(l => ({ productId: l.productId, kolicina: l.kolicina }));
}
