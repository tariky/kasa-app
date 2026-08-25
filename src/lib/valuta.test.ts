import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import { postaviDatumValute, formatDatumValute } from './valuta';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajOrder(status: 'completed' | 'refunded' = 'completed'): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status)
    VALUES (1, 10, 1.45, 'Gotovina', ?)
  `).run(status);
  return Number(r.lastInsertRowid);
}

function citaj(id: number): string | null {
  return (db.prepare('SELECT datumValute FROM orders WHERE id = ?').get(id) as any).datumValute;
}

test('novi račun nema datum valute', () => {
  expect(citaj(dodajOrder())).toBeNull();
});

test('postavlja datum valute na izdati račun', () => {
  const id = dodajOrder();
  expect(postaviDatumValute(db, id, '2026-09-10')).toBe('2026-09-10');
  expect(citaj(id)).toBe('2026-09-10');
});

test('datum valute se može promijeniti', () => {
  const id = dodajOrder();
  postaviDatumValute(db, id, '2026-09-10');
  postaviDatumValute(db, id, '2026-09-30');
  expect(citaj(id)).toBe('2026-09-30');
});

test('null uklanja datum valute', () => {
  const id = dodajOrder();
  postaviDatumValute(db, id, '2026-09-10');
  expect(postaviDatumValute(db, id, null)).toBeNull();
  expect(citaj(id)).toBeNull();
});

test('stornirani račun također može dobiti datum valute', () => {
  const id = dodajOrder('refunded');
  postaviDatumValute(db, id, '2026-09-10');
  expect(citaj(id)).toBe('2026-09-10');
});

test('odbija datum koji nije YYYY-MM-DD', () => {
  const id = dodajOrder();
  expect(() => postaviDatumValute(db, id, '10.09.2026.')).toThrow('Neispravan datum valute');
  expect(() => postaviDatumValute(db, id, '2026-9-10')).toThrow('Neispravan datum valute');
  expect(() => postaviDatumValute(db, id, '')).toThrow('Neispravan datum valute');
  expect(citaj(id)).toBeNull();
});

test('odbija kalendarski nepostojeći datum', () => {
  const id = dodajOrder();
  expect(() => postaviDatumValute(db, id, '2026-02-30')).toThrow('Neispravan datum valute');
});

test('odbija nepostojeći račun', () => {
  expect(() => postaviDatumValute(db, 999, '2026-09-10')).toThrow('Račun ne postoji');
});

test('formatira datum valute u dd.mm.yyyy.', () => {
  expect(formatDatumValute('2026-09-10')).toBe('10.09.2026.');
});

test('formatiranje ne pomjera dan (ne ide kroz UTC Date)', () => {
  expect(formatDatumValute('2026-01-01')).toBe('01.01.2026.');
  expect(formatDatumValute('2026-12-31')).toBe('31.12.2026.');
});

test('prazan ili neispravan datum valute nema formatiran prikaz', () => {
  expect(formatDatumValute(null)).toBeNull();
  expect(formatDatumValute(undefined)).toBeNull();
  expect(formatDatumValute('')).toBeNull();
  expect(formatDatumValute('10.09.2026.')).toBeNull();
});
