// src/lib/ulaz.ts
// Čista logika forme ulaza robe: šta redu fali, totali, payload za bazu. Bez React-a.
import type { Product } from '@/types';
import { parseDecimal } from './utils';
import { round2 } from './novac';
import { prikazCijene, uBruto, uNetto } from './pdvUnos';
import { jePloca, uBazuPrimke } from './ploca';
import { kalkulacijaPrimke, rasporediZavisne, type KalkulacijaPrimke } from './kalkulacija';

export interface UlazRed {
  productId: number | null;
  kolicina: string;
  nabavnaCijena: string;
  rabat: string;
  /** Prodajna cijena SA PDV-om — uvijek bruto, bez obzira na režim unosa. */
  cijena: string;
  /**
   * Tekst koji je operator ukucao u polje prodajne, u trenutnom režimu
   * ("sa PDV / bez PDV"). Kad ga nema, polje prikazuje `cijena` preračunatu
   * za režim — zato prebacivanje režima briše ovo polje i ne pomjera cijenu.
   */
  cijenaUnos?: string;
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

/** Prodajna cijena se kuca bez PDV-a samo kad to režim traži i stopa ima PDV. */
const nettoZa = (p: Product | undefined, bezPdv: boolean) => bezPdv && p?.pdvStopa === 'E';

/** Tekst u polju prodajne za dati režim unosa. */
export function prodajnaPrikaz(r: UlazRed, p: Product | undefined, bezPdv: boolean): string {
  if (r.cijenaUnos != null) return r.cijenaUnos;
  if (!jeBroj(r.cijena)) return r.cijena;
  return prikazCijene(broj(r.cijena), p?.pdvStopa ?? 'E', nettoZa(p, bezPdv));
}

/** Izmjena reda kad operator kuca prodajnu: pamti se tekst, a `cijena` ostaje bruto. */
export function prodajnaIzUnosa(text: string, p: Product | undefined, bezPdv: boolean): Pick<UlazRed, 'cijena' | 'cijenaUnos'> {
  if (!nettoZa(p, bezPdv)) return { cijena: text, cijenaUnos: text };
  return { cijena: jeBroj(text) ? String(uBruto(broj(text), 'E')) : '', cijenaUnos: text };
}

/**
 * Razlika u cijeni (RUC) reda u % na nabavnu, prije zavisnih troškova — orijentacija
 * dok se kuca, da se odmah vidi prodajna upisana u pogrešnoj jedinici. Ploča se
 * kuca po komadu a prodaje po m², pa za nju nema smislenog broja.
 */
export function redRucPosto(r: UlazRed, p: Product | undefined): number | null {
  if (!p || !trebaProdajnu(p) || jePloca(p) || !jeBroj(r.cijena)) return null;
  const nab = redNabavnaPoJed(r);
  if (!(nab > 0)) return null;
  return round2(((uNetto(broj(r.cijena), p.pdvStopa) - nab) / nab) * 100);
}
