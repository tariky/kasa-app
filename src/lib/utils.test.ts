import { test, expect } from 'bun:test';
import { parseDecimal } from './utils';

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
