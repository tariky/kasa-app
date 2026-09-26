import { test, expect } from 'bun:test';
import { nemaNaStanju } from './izborArtikala';
import type { Product } from '@/types';

function artikal(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sifra: '001', naziv: 'Test artikal', jm: 'kom', cijena: 10,
    pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', stanje: 5,
    ...overrides,
  };
}

test('artikal sa stanjem 0 nema na stanju osim kad je dozvoljena prodaja bez zalihe', () => {
  const prazan = artikal({ stanje: 0 });
  expect(nemaNaStanju(prazan, false)).toBe(true);
  expect(nemaNaStanju(prazan, true)).toBe(false);
});

test('usluge i artikli bez podatka o stanju su uvijek dostupni', () => {
  expect(nemaNaStanju(artikal({ tip: 'usluga', stanje: 0 }), false)).toBe(false);
  expect(nemaNaStanju(artikal({ stanje: undefined }), false)).toBe(false);
});
