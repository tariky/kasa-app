// src/lib/stavkeDokumenta.ts
// Stavke dokumenta koji se kuca na ekranu (ponuda, faktura, stavke priloga, ručni račun):
// dodavanje proizvoda, izmjena, uklanjanje, učitavanje iz baze i payload. Bez React-a.
import type { Product } from '@/types';
import { izracunajTotale } from './racun';

/** Red dokumenta u formi — isti oblik čuva i skica fakture (JSON). */
export interface StavkaDokumenta {
  productId: number;
  naziv: string;
  jm: string;
  sifra: string;
  tip: string;
  kolicina: number;
  cijena: number;
  /** Postotak 0–100. */
  rabat: number;
  pdvStopa: string;
  /** Stanje u trenutku dodavanja; null = nepoznato ili usluga. */
  stanje: number | null;
}

/** Stavka dokumenta kako je vraća baza (ponuda:get, prilog:getStavke) — uz podatke artikla. */
export interface RedStavke {
  productId: number;
  productNaziv?: string | null;
  productJm?: string | null;
  productSifra?: string | null;
  productTip?: string | null;
  kolicina: number;
  cijena: number;
  rabat?: number | null;
  pdvStopa: string;
}

/** Stavka onako kako je traže kanali ponude, priloga i računa. */
export interface StavkaPayload {
  productId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
}

/**
 * Dodaj proizvod: isti proizvod se spaja (količina se sabira, zaokružena na 3
 * decimale), novi ide na kraj s rabatom kupca (bez njega 0). Bez količine (null) dodaje 1.
 */
export function dodajProizvod(
  stavke: StavkaDokumenta[], p: Product, kol: number | null, opcije: { rabat?: number } = {},
): StavkaDokumenta[] {
  const k = kol ?? 1;
  if (stavke.some(s => s.productId === p.id)) {
    return stavke.map(s => s.productId === p.id ? { ...s, kolicina: Math.round((s.kolicina + k) * 1000) / 1000 } : s);
  }
  return [...stavke, {
    productId: p.id, naziv: p.naziv, jm: p.jm || 'kom', sifra: p.sifra, tip: p.tip,
    kolicina: k, cijena: p.cijena, rabat: opcije.rabat ?? 0, pdvStopa: p.pdvStopa,
    stanje: p.tip === 'usluga' || p.slobodan ? null : p.stanje ?? null,
  }];
}

export function izmijeni(stavke: StavkaDokumenta[], productId: number, izmjena: Partial<StavkaDokumenta>): StavkaDokumenta[] {
  return stavke.map(s => s.productId === productId ? { ...s, ...izmjena } : s);
}

export function ukloni(stavke: StavkaDokumenta[], productId: number): StavkaDokumenta[] {
  return stavke.filter(s => s.productId !== productId);
}

/** Red iz baze → stavka forme. Obrisan artikal ostaje kao „#id“; stanje se ne zna. */
export function izReda(r: RedStavke): StavkaDokumenta {
  return {
    productId: r.productId,
    naziv: r.productNaziv || `#${r.productId}`,
    jm: r.productJm || 'kom',
    sifra: r.productSifra || '',
    tip: r.productTip || 'artikal',
    kolicina: r.kolicina,
    cijena: r.cijena,
    rabat: r.rabat ?? 0,
    pdvStopa: r.pdvStopa,
    stanje: null,
  };
}

export function uPayload(stavke: StavkaDokumenta[]): StavkaPayload[] {
  return stavke.map(s => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.pdvStopa }));
}

/** Ukupno i PDV forme; polje koje se još kuca (NaN) broji se kao 0. */
export function totaliStavki(stavke: StavkaDokumenta[]): { ukupno: number; pdvIznos: number } {
  return izracunajTotale(stavke.map(s => ({
    cijena: s.cijena || 0, kolicina: s.kolicina || 0, rabat: s.rabat || 0, pdvStopa: s.pdvStopa,
  })));
}
