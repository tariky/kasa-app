// src/lib/ulaz.ts
// Čista logika forme ulaza robe: šta redu fali, totali, payload za bazu. Bez React-a.
import type { Product } from '@/types';
import { parseDecimal } from './utils';
import { uBazuPrimke } from './ploca';

export interface UlazRed {
  productId: number | null;
  kolicina: string;
  nabavnaCijena: string;
  rabat: string;
  cijena: string;
}

export type Nedostaje = 'artikal' | 'kolicina' | 'nabavna' | 'prodajna';
export type RedStatus = { stanje: 'prazan' } | { stanje: 'ok' } | { stanje: 'nepotpun'; nedostaje: Nedostaje[] };

export const praznaStavka = (): UlazRed => ({ productId: null, kolicina: '', nabavnaCijena: '', rabat: '', cijena: '' });

const broj = (s: string) => parseDecimal(s);
const jeBroj = (s: string) => s.trim() !== '' && !isNaN(broj(s));

/** Materijal nema prodajnu cijenu — ne prodaje se na kasi, troši se na nalozima. */
export const trebaProdajnu = (p: Product | undefined) => !!p && p.tip !== 'materijal';

export function redStatus(r: UlazRed, products: Product[]): RedStatus {
  const p = r.productId != null ? products.find(x => x.id === r.productId) : undefined;
  const nistaUpisano = !r.kolicina && !r.nabavnaCijena && !r.rabat;
  if (!p && nistaUpisano) return { stanje: 'prazan' };
  // Bez artikla ne znamo ni jedinicu ni treba li prodajna — prvo to, ostalo poslije.
  if (!p) return { stanje: 'nepotpun', nedostaje: ['artikal'] };
  const nedostaje: Nedostaje[] = [];
  if (!(broj(r.kolicina) > 0)) nedostaje.push('kolicina');
  if (!jeBroj(r.nabavnaCijena)) nedostaje.push('nabavna');
  if (trebaProdajnu(p) && !jeBroj(r.cijena)) nedostaje.push('prodajna');
  return nedostaje.length ? { stanje: 'nepotpun', nedostaje } : { stanje: 'ok' };
}

export const potpuniRedovi = (rows: UlazRed[], products: Product[]) => rows.filter(r => redStatus(r, products).stanje === 'ok');

const LABELA: Record<Nedostaje, string> = { artikal: 'Artikal', kolicina: 'Količina', nabavna: 'Nabavna cijena', prodajna: 'Prodajna cijena' };
const stavki = (n: number) => `${n} ${n === 1 ? 'stavke' : n < 5 ? 'stavke' : 'stavki'}`;

/** Jedna rečenica za podnožje: zašto se ulaz još ne može spremiti. Null kad može. */
export function nedostajeOpis(rows: UlazRed[], products: Product[]): string | null {
  const statusi = rows.map(r => redStatus(r, products));
  const nepotpuni = statusi.filter((s): s is Extract<RedStatus, { stanje: 'nepotpun' }> => s.stanje === 'nepotpun');
  if (nepotpuni.length === 0) return statusi.some(s => s.stanje === 'ok') ? null : 'Dodajte bar jednu stavku';
  // Prvo što fali po redoslijedu unosa — artikal, količina, pa cijene.
  for (const kljuc of ['artikal', 'kolicina', 'nabavna', 'prodajna'] as Nedostaje[]) {
    const n = nepotpuni.filter(s => s.nedostaje.includes(kljuc)).length;
    if (n > 0) return `${LABELA[kljuc]} fali kod ${stavki(n)}`;
  }
  return null;
}

/** RUC se računa samo nad artiklima koji se prodaju — materijal nema prodajnu pa bi rušio postotak. */
export function ulazTotali(rows: UlazRed[], products: Product[]): { nabavna: number; prodajna: number; ruc: number; rucPct: number } {
  let nabavna = 0, prodajna = 0, nabavnaArtikala = 0;
  for (const r of potpuniRedovi(rows, products)) {
    const p = products.find(x => x.id === r.productId);
    const nab = broj(r.kolicina) * broj(r.nabavnaCijena);
    nabavna += nab;
    if (trebaProdajnu(p)) { prodajna += broj(r.kolicina) * broj(r.cijena); nabavnaArtikala += nab; }
  }
  const ruc = prodajna - nabavnaArtikala;
  return { nabavna, prodajna, ruc, rucPct: nabavnaArtikala > 0 ? (ruc / nabavnaArtikala) * 100 : 0 };
}

export interface UlazStavkaPayload { productId: number; kolicina: number; nabavnaCijena: number; rabat: number; cijena: number; pdvStopa: string }

export function uPayload(rows: UlazRed[], products: Product[]): UlazStavkaPayload[] {
  return potpuniRedovi(rows, products).map(r => {
    const p = products.find(x => x.id === r.productId);
    const baza = uBazuPrimke(p, broj(r.kolicina), broj(r.nabavnaCijena));
    return {
      productId: r.productId!,
      kolicina: baza.kolicina,
      nabavnaCijena: baza.nabavnaCijena,
      rabat: broj(r.rabat) || 0,
      cijena: trebaProdajnu(p) ? broj(r.cijena) : 0,
      pdvStopa: p?.pdvStopa ?? 'E',
    };
  });
}

export interface NivelacijaRazlika {
  productId: number; productNaziv: string; kolicina: number;
  staraCijena: number; novaCijena: number; razlika: number; ukupnaRazlika: number;
}

/** Artikli sa zalihom kojima ulaz mijenja prodajnu cijenu — spremanje će kreirati nivelaciju. */
export function nivelacijaRazlike(rows: UlazRed[], products: Product[]): NivelacijaRazlika[] {
  const out: NivelacijaRazlika[] = [];
  const seen = new Set<number>();
  for (const r of potpuniRedovi(rows, products)) {
    const p = products.find(x => x.id === r.productId);
    if (!p || !trebaProdajnu(p) || seen.has(p.id)) continue;
    seen.add(p.id);
    const nova = broj(r.cijena);
    if (Math.abs(p.cijena - nova) <= 0.001) continue;
    const zaliha = p.stanje ?? 0;
    if (zaliha <= 0) continue;
    const razlika = nova - p.cijena;
    out.push({ productId: p.id, productNaziv: p.naziv, kolicina: zaliha, staraCijena: p.cijena, novaCijena: nova, razlika, ukupnaRazlika: razlika * zaliha });
  }
  return out;
}
