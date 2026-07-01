import { test, expect } from 'bun:test';
import { izracunajTotale } from './racun';

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
