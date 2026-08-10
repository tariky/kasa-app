import { test, expect } from 'bun:test';
import { parseFiskalniBroj, izracunajPraznine, MAX_PRAZNINA } from './fiskalni';

test('parseFiskalniBroj parsira numeričke brojeve', () => {
  expect(parseFiskalniBroj('1234')).toBe(1234);
  expect(parseFiskalniBroj('  42 ')).toBe(42);
});

test('parseFiskalniBroj ignoriše reklamacije i prazne', () => {
  expect(parseFiskalniBroj('R-5')).toBeNull();
  expect(parseFiskalniBroj(null)).toBeNull();
  expect(parseFiskalniBroj(undefined)).toBeNull();
  expect(parseFiskalniBroj('')).toBeNull();
  expect(parseFiskalniBroj('12a')).toBeNull();
});

test('izracunajPraznine bez rupa daje prazno', () => {
  expect(izracunajPraznine([1, 2, 3, 4])).toEqual([]);
});

test('izracunajPraznine nalazi jednu rupu', () => {
  expect(izracunajPraznine([100, 101, 103])).toEqual([102]);
});

test('izracunajPraznine nalazi više rupa i ignoriše redoslijed/duplikate', () => {
  expect(izracunajPraznine([10, 13, 13, 16])).toEqual([11, 12, 14, 15]);
});

test('izracunajPraznine sa manje od 2 broja daje prazno', () => {
  expect(izracunajPraznine([])).toEqual([]);
  expect(izracunajPraznine([7])).toEqual([]);
});

test('izracunajPraznine ograničava rezultat kod pogrešno ukucanog broja', () => {
  // Tipfeler 1234567 umjesto 1234 bi inače nabrojao preko milion "praznina".
  const start = Date.now();
  const gaps = izracunajPraznine([1, 2, 3, 1234567]);
  expect(gaps.length).toBe(MAX_PRAZNINA);
  expect(gaps[0]).toBe(4);
  expect(Date.now() - start).toBeLessThan(200);
});

test('izracunajPraznine preskače odbačene brojeve bez trošenja limita', () => {
  const gaps = izracunajPraznine([10, 16], 2, new Set([11, 12]));
  expect(gaps).toEqual([13, 14]);
});
