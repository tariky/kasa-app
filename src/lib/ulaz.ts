// src/lib/ulaz.ts
// Čista logika forme ulaza robe: šta redu fali, totali, payload za bazu. Bez React-a.
import type { Product } from '@/types';
import { parseDecimal } from './utils';
import { uBazuPrimke } from './ploca';
import { kalkulacijaPrimke, rasporediZavisne, type KalkulacijaPrimke } from './kalkulacija';

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

const LABELA: Record<Nedostaje, string> = { artikal: 'Artikal', kolicina: 'Količina', nabavna: 'Fakturna cijena', prodajna: 'Prodajna cijena' };
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

/** Vrijednost reda nakon rabata (fakturna − rabat), u KM — ista je bez obzira na jedinicu unosa. */
export const redVrijednost = (r: UlazRed) => broj(r.kolicina) * broj(r.nabavnaCijena) * (1 - (broj(r.rabat) || 0) / 100);

/** Nabavna po jedinici u kojoj se red kuca (po ploči za ploču), nakon rabata. Zavisni nisu uključeni. */
export const redNabavnaPoJed = (r: UlazRed) => broj(r.nabavnaCijena) * (1 - (broj(r.rabat) || 0) / 100);

export interface UlazStavkaPayload { productId: number; kolicina: number; nabavnaCijena: number; rabat: number; zavisniTroskovi: number; cijena: number; pdvStopa: string }

/**
 * Stavke za bazu: ploča se preračuna u m², materijalu se briše prodajna, a zavisni troškovi
 * dokumenta se rasporede po stavkama srazmjerno vrijednosti (fakturna − rabat).
 */
export function uPayload(rows: UlazRed[], products: Product[], zavisniUkupno: string): UlazStavkaPayload[] {
  const potpuni = potpuniRedovi(rows, products);
  const zavisni = rasporediZavisne(potpuni.map(redVrijednost), broj(zavisniUkupno) || 0);
  return potpuni.map((r, i) => {
    const p = products.find(x => x.id === r.productId);
    const baza = uBazuPrimke(p, broj(r.kolicina), broj(r.nabavnaCijena));
    return {
      productId: r.productId!,
      kolicina: baza.kolicina,
      nabavnaCijena: baza.nabavnaCijena,
      rabat: broj(r.rabat) || 0,
      zavisniTroskovi: zavisni[i],
      cijena: trebaProdajnu(p) ? broj(r.cijena) : 0,
      pdvStopa: p?.pdvStopa ?? 'E',
    };
  });
}

/** Sume forme — ista kalkulacija kao za spremljeni dokument, nad potpunim redovima. */
export function ulazTotali(rows: UlazRed[], products: Product[], zavisniUkupno: string): KalkulacijaPrimke {
  return kalkulacijaPrimke(uPayload(rows, products, zavisniUkupno));
}

export interface NivelacijaRazlika {
  productId: number; productNaziv: string; kolicina: number;
  staraCijena: number; novaCijena: number; razlika: number; ukupnaRazlika: number;
}

/** Stavka ulaza kakav je spremljen (za izmjenu) — iz `primka:get`. */
export interface IzvornaStavka { productId: number; cijena: number; kolicina: number; cijenaKasnijeMijenjana?: boolean }

/**
 * Prodajna cijena po artiklu iz potpunih redova (važi prva stavka artikla, kao
 * u bazi), uz podjelu na redove koji pri izmjeni ulaza stvarno mijenjaju cijenu
 * (`djeluje`) i one kojima je cijenu poslije ovog ulaza promijenilo nešto drugo.
 * Nepromijenjena cijena u odnosu na spremljeni ulaz ne mijenja ništa.
 */
function promjeneCijena(rows: UlazRed[], products: Product[], izvorne: IzvornaStavka[]) {
  const out: Array<{ p: Product; nova: number; djeluje: boolean }> = [];
  const seen = new Set<number>();
  for (const r of potpuniRedovi(rows, products)) {
    const p = products.find(x => x.id === r.productId);
    if (!p || !trebaProdajnu(p) || seen.has(p.id)) continue;
    seen.add(p.id);
    const nova = broj(r.cijena);
    const izvorna = izvorne.find(s => s.productId === p.id);
    if (izvorna) {
      if (Math.abs(izvorna.cijena - nova) <= 0.001) continue;
      if (izvorna.cijenaKasnijeMijenjana) { out.push({ p, nova, djeluje: false }); continue; }
    }
    if (Math.abs(p.cijena - nova) <= 0.001) continue;
    out.push({ p, nova, djeluje: true });
  }
  return out;
}

/**
 * Artikli sa zalihom kojima ulaz mijenja prodajnu cijenu — spremanje će kreirati nivelaciju.
 * Pri izmjeni (`izvorne` = spremljene stavke) zaliha je bez robe iz ovog ulaza, kao u bazi.
 */
export function nivelacijaRazlike(rows: UlazRed[], products: Product[], izvorne: IzvornaStavka[] = []): NivelacijaRazlika[] {
  const out: NivelacijaRazlika[] = [];
  for (const { p, nova, djeluje } of promjeneCijena(rows, products, izvorne)) {
    if (!djeluje) continue;
    const izUlaza = izvorne.filter(s => s.productId === p.id).reduce((s, x) => s + x.kolicina, 0);
    const zaliha = (p.stanje ?? 0) - izUlaza;
    if (zaliha <= 0) continue;
    const razlika = nova - p.cijena;
    out.push({ productId: p.id, productNaziv: p.naziv, kolicina: zaliha, staraCijena: p.cijena, novaCijena: nova, razlika, ukupnaRazlika: razlika * zaliha });
  }
  return out;
}

/**
 * Izmjena ulaza: artikli kojima je prodajna cijena promijenjena, ali je poslije
 * ovog ulaza cijenu promijenio drugi ulaz ili ručna izmjena — cijena u prodaji
 * ostaje `cijena`, a nova vrijednost se pamti samo na ovom ulazu.
 */
export function cijeneBezUcinka(rows: UlazRed[], products: Product[], izvorne: IzvornaStavka[]) {
  return promjeneCijena(rows, products, izvorne)
    .filter(x => !x.djeluje)
    .map(({ p }) => ({ productId: p.id, productNaziv: p.naziv, cijena: p.cijena }));
}
