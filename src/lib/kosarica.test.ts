import { test, expect } from 'bun:test';
import { dodajUKosaricu, restoreCart, postaviRabat, postaviRabatNaSve } from './kosarica';
import type { Product, CartItem } from '@/types';

function artikal(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sifra: '001', naziv: 'Test artikal', jm: 'kom', cijena: 10,
    pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', stanje: 5,
    ...overrides,
  };
}

// --- dodajUKosaricu ---

test('dodaje novi artikal u praznu košaricu', () => {
  const p = artikal();
  const cart = dodajUKosaricu([], p, 1, false);
  expect(cart).toEqual([{ product: p, kolicina: 1, rabat: 0 }]);
});

test('ponovno dodavanje istog artikla uvećava količinu', () => {
  const p = artikal();
  let cart = dodajUKosaricu([], p, 1, false);
  cart = dodajUKosaricu(cart, p, 1, false);
  expect(cart).toEqual([{ product: p, kolicina: 2, rabat: 0 }]);
});

test('ne prelazi stanje kad allowZeroStock nije uključen', () => {
  const p = artikal({ stanje: 2 });
  let cart = dodajUKosaricu([], p, 2, false);
  cart = dodajUKosaricu(cart, p, 1, false);
  expect(cart[0].kolicina).toBe(2);
});

test('prelazi stanje kad je allowZeroStock uključen', () => {
  const p = artikal({ stanje: 2 });
  const cart = dodajUKosaricu([], p, 5, true);
  expect(cart[0].kolicina).toBe(5);
});

test('usluga ignoriše stanje', () => {
  const p = artikal({ tip: 'usluga', stanje: 0 });
  const cart = dodajUKosaricu([], p, 3, false);
  expect(cart[0].kolicina).toBe(3);
});

test('količina <= 0 ne mijenja košaricu', () => {
  const p = artikal();
  expect(dodajUKosaricu([], p, 0, false)).toEqual([]);
});

// --- restoreCart ---

function lookupFrom(products: Product[]): (id: number) => Product | undefined {
  return (id) => products.find(p => p.id === id);
}

test('vraća sve stavke kad je stanje dovoljno', () => {
  const p = artikal({ id: 1, stanje: 5 });
  const { cart, upozorenja } = restoreCart(
    [{ productId: 1, kolicina: 3, rabat: 0 }], lookupFrom([p]), false
  );
  expect(cart).toEqual([{ product: p, kolicina: 3, rabat: 0 }]);
  expect(upozorenja).toEqual([]);
});

test('obrisani proizvod se preskače uz upozorenje', () => {
  const { cart, upozorenja } = restoreCart(
    [{ productId: 99, kolicina: 1, rabat: 0 }], lookupFrom([]), false
  );
  expect(cart).toEqual([]);
  expect(upozorenja.length).toBe(1);
  expect(upozorenja[0]).toContain('ne postoji');
});

test('nedovoljno stanje se sreže na dostupno uz upozorenje', () => {
  const p = artikal({ id: 1, naziv: 'Sok', stanje: 2 });
  const { cart, upozorenja } = restoreCart(
    [{ productId: 1, kolicina: 5, rabat: 0 }], lookupFrom([p]), false
  );
  expect(cart).toEqual([{ product: p, kolicina: 2, rabat: 0 }]);
  expect(upozorenja.length).toBe(1);
  expect(upozorenja[0]).toContain('Sok');
});

test('stanje 0 izbacuje stavku uz upozorenje', () => {
  const p = artikal({ id: 1, stanje: 0 });
  const { cart, upozorenja } = restoreCart(
    [{ productId: 1, kolicina: 2, rabat: 0 }], lookupFrom([p]), false
  );
  expect(cart).toEqual([]);
  expect(upozorenja.length).toBe(1);
});

test('allowZeroStock učitava punu količinu bez upozorenja', () => {
  const p = artikal({ id: 1, stanje: 0 });
  const { cart, upozorenja } = restoreCart(
    [{ productId: 1, kolicina: 4, rabat: 0 }], lookupFrom([p]), true
  );
  expect(cart).toEqual([{ product: p, kolicina: 4, rabat: 0 }]);
  expect(upozorenja).toEqual([]);
});

test('usluga se učitava bez provjere stanja', () => {
  const p = artikal({ id: 1, tip: 'usluga', stanje: 0 });
  const { cart, upozorenja } = restoreCart(
    [{ productId: 1, kolicina: 2, rabat: 0 }], lookupFrom([p]), false
  );
  expect(cart).toEqual([{ product: p, kolicina: 2, rabat: 0 }]);
  expect(upozorenja).toEqual([]);
});

test('rabat se čuva pri vraćanju', () => {
  const p = artikal({ id: 1, stanje: 5 });
  const { cart } = restoreCart(
    [{ productId: 1, kolicina: 1, rabat: 10 }], lookupFrom([p]), false
  );
  expect(cart[0].rabat).toBe(10);
});

// --- rabat ---

test('postavlja rabat na jednu stavku', () => {
  const a = artikal({ id: 1 });
  const b = artikal({ id: 2, sifra: '002' });
  let cart = dodajUKosaricu([], a, 1, false);
  cart = dodajUKosaricu(cart, b, 1, false);
  cart = postaviRabat(cart, 1, 15);
  expect(cart.find(i => i.product.id === 1)?.rabat).toBe(15);
  expect(cart.find(i => i.product.id === 2)?.rabat).toBe(0);
});

test('postavlja rabat na sve stavke', () => {
  const a = artikal({ id: 1 });
  const b = artikal({ id: 2, sifra: '002' });
  let cart = dodajUKosaricu([], a, 1, false);
  cart = dodajUKosaricu(cart, b, 1, false);
  cart = postaviRabatNaSve(cart, 20);
  expect(cart.every(i => i.rabat === 20)).toBe(true);
});

test('rabat se ograničava na 0–100', () => {
  const a = artikal({ id: 1 });
  let cart = dodajUKosaricu([], a, 1, false);
  expect(postaviRabat(cart, 1, 150)[0].rabat).toBe(100);
  expect(postaviRabat(cart, 1, -5)[0].rabat).toBe(0);
});
