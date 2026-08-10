import { test, expect } from 'bun:test';
import { izracunajTotale, iznosStavke } from './racun';

test('sabira ukupno preko stavki sa rabatom', () => {
  const { ukupno } = izracunajTotale([
    { cijena: 100, kolicina: 2, rabat: 0, pdvStopa: 'E' },
    { cijena: 50, kolicina: 1, rabat: 10, pdvStopa: 'K' },
  ]);
  expect(ukupno).toBeCloseTo(245, 2);
});

test('PDV samo za E stavke (17% uračunat u cijenu)', () => {
  const { pdvIznos } = izracunajTotale([
    { cijena: 117, kolicina: 1, rabat: 0, pdvStopa: 'E' },
    { cijena: 100, kolicina: 1, rabat: 0, pdvStopa: 'K' },
  ]);
  expect(pdvIznos).toBeCloseTo(17, 2);
});

test('prazna lista daje nule', () => {
  expect(izracunajTotale([])).toEqual({ ukupno: 0, pdvIznos: 0 });
});

test('ukupno je zaokruženo na fene, bez float repa', () => {
  // Bez zaokruživanja ovo daje 5.549999999999999 i takvo ide u <Iznos> i u bazu.
  const { ukupno } = izracunajTotale([
    { cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
    { cijena: 0.70, kolicina: 3, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(ukupno).toBe(5.55);
});

test('pdvIznos je zaokružen na fene', () => {
  const { pdvIznos } = izracunajTotale([
    { cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(pdvIznos).toBe(0.5);
});

test('iznosStavke zaokružuje po stavci kao fiskalni uređaj', () => {
  expect(iznosStavke({ cijena: 3.33, kolicina: 3, rabat: 10, pdvStopa: 'E' })).toBe(8.99);
});

test('decimalna količina se ne siječe', () => {
  const { ukupno } = izracunajTotale([
    { cijena: 4, kolicina: 2.5, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(ukupno).toBe(10);
});
