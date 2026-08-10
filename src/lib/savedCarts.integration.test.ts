// Integracija nad pravom SQLite bazom sa produkcijskom šemom (bun:sqlite).
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import { saveCart, listSavedCarts, deleteSavedCart } from './savedCarts';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
});

const items = [{ productId: 1, kolicina: 2, rabat: 0 }];

test('save → list round-trip vraća stavke i iznos', () => {
  const id = saveCart(db, '10:30 — 1 art.', items, 20);
  const carts = listSavedCarts(db);
  expect(carts.length).toBe(1);
  expect(carts[0].id).toBe(id);
  expect(carts[0].naziv).toBe('10:30 — 1 art.');
  expect(carts[0].ukupno).toBe(20);
  expect(JSON.parse(carts[0].items)).toEqual(items);
  expect(carts[0].createdAt).toBeTruthy();
});

test('delete briše košaricu', () => {
  const id = saveCart(db, 'test', items, 20);
  deleteSavedCart(db, id);
  expect(listSavedCarts(db)).toEqual([]);
});

test('list vraća najnovije prvo', () => {
  const a = saveCart(db, 'prva', items, 10);
  const b = saveCart(db, 'druga', items, 20);
  const carts = listSavedCarts(db);
  expect(carts.map(c => c.id)).toEqual([b, a]);
});
