import { test, expect } from 'bun:test';
import { round2, localDateStr, prijedloziApoena } from './novac';

test('prijedloziApoena nudi tačan iznos pa zaokruženja na novčanice', () => {
  expect(prijedloziApoena(12.6)).toEqual([12.6, 13, 15, 20, 50]);
  expect(prijedloziApoena(0.85)).toEqual([0.85, 1, 5, 10, 20]);
  expect(prijedloziApoena(47)).toEqual([47, 50, 60, 100]);
});

test('prijedloziApoena ne duplira kad je iznos već okrugao', () => {
  expect(prijedloziApoena(20)).toEqual([20, 50, 100]);
  expect(prijedloziApoena(100)).toEqual([100]);
});

test('prijedloziApoena vraća prazno za nulu i negativno', () => {
  expect(prijedloziApoena(0)).toEqual([]);
  expect(prijedloziApoena(-5)).toEqual([]);
});

test('round2 zaokružuje na fene', () => {
  expect(round2(5.549999999999999)).toBe(5.55);
  expect(round2(0.1 + 0.2)).toBe(0.3);
  expect(round2(2.345)).toBe(2.35);
  expect(round2(-1.005)).toBe(-1);
});

test('localDateStr koristi lokalnu zonu, ne UTC', () => {
  // 1. januar 2026. u 00:30 lokalno — toISOString() bi u UTC+1 dao 2025-12-31.
  const ponoc = new Date(2026, 0, 1, 0, 30, 0);
  expect(localDateStr(ponoc)).toBe('2026-01-01');
});

test('localDateStr pada na nule ispred jednocifrenih', () => {
  expect(localDateStr(new Date(2026, 8, 5))).toBe('2026-09-05');
});
