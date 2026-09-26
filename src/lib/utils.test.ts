import { test, expect } from 'bun:test';
import { parseDecimal, mnozina, porukaGreske, formatKolicina } from './utils';

test('parsira tačku kao decimalni separator', () => {
  expect(parseDecimal('12.50')).toBe(12.5);
});

test('parsira zarez kao decimalni separator', () => {
  expect(parseDecimal('12,50')).toBe(12.5);
});

test('parsira cijele brojeve', () => {
  expect(parseDecimal('2000')).toBe(2000);
});

test('podržava razmake oko broja', () => {
  expect(parseDecimal(' 3,4 ')).toBe(3.4);
});

test('broj prosljeđuje nepromijenjen', () => {
  expect(parseDecimal(7.25)).toBe(7.25);
});

test('vraća NaN za prazan ili neispravan unos', () => {
  expect(parseDecimal('')).toBeNaN();
  expect(parseDecimal(',')).toBeNaN();
  expect(parseDecimal('abc')).toBeNaN();
});

test('mnozina bira oblik po broju', () => {
  const r = (n: number) => mnozina(n, ['račun', 'računa', 'računa']);
  const red = (n: number) => mnozina(n, ['red', 'reda', 'redova']);
  expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map(red)).toEqual([
    'redova', 'red', 'reda', 'reda', 'redova', 'redova', 'redova', 'redova', 'red', 'reda', 'redova', 'red', 'redova', 'redova',
  ]);
  expect(r(1)).toBe('račun');
  expect(r(3)).toBe('računa');
});

test('porukaGreske: poruka bez Electron omota, i za ne-Error vrijednosti', () => {
  expect(porukaGreske(new Error("Error invoking remote method 'order:finalize': Error: Račun ne postoji"))).toBe('Račun ne postoji');
  expect(porukaGreske(new Error('Račun ne postoji'))).toBe('Račun ne postoji');
  expect(porukaGreske('tekst')).toBe('tekst');
  expect(porukaGreske(undefined)).toBe('Nepoznata greška');
});

test('formatKolicina: zarez, najviše 3 decimale, bez suvišnih nula', () => {
  expect(formatKolicina(2)).toBe('2');
  expect(formatKolicina(2.5)).toBe('2,5');
  expect(formatKolicina(0.1 + 0.2)).toBe('0,3');
  expect(formatKolicina(1.23456)).toBe('1,235');
  expect(formatKolicina(10.0271)).toBe('10,027');
  expect(formatKolicina(0)).toBe('0');
  expect(formatKolicina(-1.5)).toBe('-1,5');
});
