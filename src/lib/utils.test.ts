import { test, expect } from 'bun:test';
import { parseDecimal, mnozina } from './utils';

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
