import { test, expect } from 'bun:test';
import { generirajRacune } from './batchRacuni';
import type { Product } from '@/types';

// Deterministički RNG (mulberry32) za ponovljive testove.
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function proizvod(over: Partial<Product>): Product {
  return {
    id: 1,
    sifra: '001',
    naziv: 'Artikal',
    jm: 'kom',
    cijena: 10,
    pdvStopa: 'E',
    tip: 'artikal',
    createdAt: '',
    updatedAt: '',
    stanje: 100,
    ...over,
  };
}

const katalog: Product[] = [
  proizvod({ id: 1, sifra: '001', naziv: 'Hljeb', cijena: 1.5, stanje: 200 }),
  proizvod({ id: 2, sifra: '002', naziv: 'Mlijeko', cijena: 2.3, stanje: 150 }),
  proizvod({ id: 3, sifra: '003', naziv: 'Kafa', cijena: 8.9, stanje: 80, pdvStopa: 'K' }),
  proizvod({ id: 4, sifra: '004', naziv: 'Čokolada', cijena: 3.75, stanje: 120 }),
  proizvod({ id: 5, sifra: '005', naziv: 'Sok', cijena: 2.0, stanje: 90 }),
];

test('zbir nikad ne prelazi target (stani-ispod)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const res = generirajRacune(katalog, { target: 2000, rng: seededRng(seed) });
    expect(res.ukupnoGenerisano).toBeLessThanOrEqual(2000);
  }
});

test('dostiže cilj razumno blizu kad ima dovoljno zaliha', () => {
  // Ukupna vrijednost zaliha kataloga je ~1987 BAM, pa je 1500 lako dostižno.
  const res = generirajRacune(katalog, { target: 1500, rng: seededRng(7) });
  // Najjeftiniji artikal je 1.5, pa manjak mora biti manji od toga.
  expect(res.manjak).toBeLessThan(1.5);
  expect(res.ukupnoGenerisano).toBeGreaterThan(1498.5);
});

test('nikad ne prodaje više od raspoložive zalihe', () => {
  const res = generirajRacune(katalog, { target: 5000, rng: seededRng(3) });
  const prodano = new Map<number, number>();
  for (const r of res.racuni) {
    for (const s of r.stavke) {
      prodano.set(s.productId, (prodano.get(s.productId) ?? 0) + s.kolicina);
    }
  }
  for (const p of katalog) {
    expect(prodano.get(p.id) ?? 0).toBeLessThanOrEqual(Math.floor(p.stanje!));
  }
});

test('svaki račun ima 1–4 stavke bez duplih artikala', () => {
  const res = generirajRacune(katalog, { target: 2000, maxStavki: 4, rng: seededRng(11) });
  for (const r of res.racuni) {
    expect(r.stavke.length).toBeGreaterThanOrEqual(1);
    expect(r.stavke.length).toBeLessThanOrEqual(4);
    const ids = r.stavke.map(s => s.productId);
    expect(new Set(ids).size).toBe(ids.length);
  }
});

test('sve količine su cijeli brojevi >= 1, rabat 0', () => {
  const res = generirajRacune(katalog, { target: 1000, rng: seededRng(5) });
  for (const r of res.racuni) {
    for (const s of r.stavke) {
      expect(Number.isInteger(s.kolicina)).toBe(true);
      expect(s.kolicina).toBeGreaterThanOrEqual(1);
      expect(s.rabat).toBe(0);
    }
  }
});

test('ukupno računa odgovara zbiru stavki', () => {
  const res = generirajRacune(katalog, { target: 500, rng: seededRng(9) });
  for (const r of res.racuni) {
    const rucno = r.stavke.reduce((s, x) => s + x.cijena * x.kolicina, 0);
    expect(r.ukupno).toBeCloseTo(rucno, 2);
  }
});

test('manjak kad zalihe ne mogu dostići cilj', () => {
  const oskudno: Product[] = [proizvod({ id: 1, cijena: 10, stanje: 5 })];
  const res = generirajRacune(oskudno, { target: 1000, rng: seededRng(1) });
  // Max moguće = 5 * 10 = 50.
  expect(res.ukupnoGenerisano).toBeLessThanOrEqual(50);
  expect(res.manjak).toBeGreaterThan(900);
});

test('preskače usluge i artikle bez zalihe', () => {
  const mix: Product[] = [
    proizvod({ id: 1, naziv: 'Usluga', tip: 'usluga', cijena: 20, stanje: 0 }),
    proizvod({ id: 2, naziv: 'Bez zalihe', cijena: 5, stanje: 0 }),
    proizvod({ id: 3, naziv: 'Dostupno', cijena: 4, stanje: 100 }),
  ];
  const res = generirajRacune(mix, { target: 200, rng: seededRng(2) });
  const prodaniIds = new Set(res.racuni.flatMap(r => r.stavke.map(s => s.productId)));
  expect(prodaniIds.has(1)).toBe(false);
  expect(prodaniIds.has(2)).toBe(false);
  expect(prodaniIds.has(3)).toBe(true);
});

test('prazan katalog daje prazan rezultat', () => {
  const res = generirajRacune([], { target: 1000 });
  expect(res.racuni).toEqual([]);
  expect(res.ukupnoGenerisano).toBe(0);
  expect(res.manjak).toBe(1000);
});
