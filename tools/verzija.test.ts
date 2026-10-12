import { test, expect } from 'bun:test';
import { sljedecaVerzija } from './verzija';

test('patch je zadan; minor i major nuliraju niže dijelove', () => {
  expect(sljedecaVerzija('1.0.0')).toBe('1.0.1');
  expect(sljedecaVerzija('1.0.9', 'patch')).toBe('1.0.10');
  expect(sljedecaVerzija('1.0.3', 'minor')).toBe('1.1.0');
  expect(sljedecaVerzija('1.4.2', 'major')).toBe('2.0.0');
});

test('izričita verzija mora biti veća od trenutne', () => {
  expect(sljedecaVerzija('1.0.0', '1.2.0')).toBe('1.2.0');
  expect(sljedecaVerzija('1.9.0', '1.10.0')).toBe('1.10.0');
  expect(() => sljedecaVerzija('1.2.0', '1.2.0')).toThrow('mora biti veća');
  expect(() => sljedecaVerzija('1.2.0', '1.1.9')).toThrow('mora biti veća');
  expect(() => sljedecaVerzija('1.2.0', 'v1.3')).toThrow('Nepoznat zahtjev');
  expect(() => sljedecaVerzija('1.2', 'patch')).toThrow('X.Y.Z');
});
