import { test, expect } from 'bun:test';
import { procitajSkalu } from './skala';

test('procitajSkalu prihvata samo ponuđene skale', () => {
  expect(procitajSkalu('1.25')).toBe(1.25);
  expect(procitajSkalu('0.9')).toBe(0.9);
  expect(procitajSkalu('1')).toBe(1);
});

test('procitajSkalu: nepoznato ili prazno je 100 %', () => {
  expect(procitajSkalu(null)).toBe(1);
  expect(procitajSkalu('')).toBe(1);
  expect(procitajSkalu('3')).toBe(1);
  expect(procitajSkalu('abc')).toBe(1);
});
