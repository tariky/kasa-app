// Integracija nad pravom SQLite bazom sa produkcijskom šemom.
// (better-sqlite3 je buildan za Electron ABI i ne učitava se pod Bun-om, pa
// testovi koriste bun:sqlite — isti SQLite engine, isti SQL.)
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import {
  collectPriceChanges, applyPricesWithoutStock, revertNivelacijaPrices,
  getProductStock, isDobavljacUsed,
} from './skladiste';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
});

function dodajArtikal(sifra: string, cijena: number, tip = 'artikal'): number {
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, ?, 'E', ?)")
    .run(sifra, `Artikal ${sifra}`, cijena, tip);
  return Number(r.lastInsertRowid);
}

function dodajZalihu(productId: number, kolicina: number): void {
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
    .run(productId, kolicina);
}

test('artikal sa zalihom ide u nivelaciju', () => {
  const id = dodajArtikal('001', 10);
  dodajZalihu(id, 5);

  const { nivelacija, bezZaliha } = collectPriceChanges(db, [
    { productId: id, cijena: 12, pdvStopa: 'E' },
  ]);

  expect(bezZaliha).toEqual([]);
  expect(nivelacija).toEqual([
    { productId: id, kolicina: 5, staraCijena: 10, novaCijena: 12, pdvStopa: 'E' },
  ]);
});

test('artikal bez zalihe dobija novu cijenu iako nema nivelacije', () => {
  // Ovo je bio bug: cijena se upisivala samo kroz nivelaciju, a nivelacija se
  // pravila samo kad je stanje > 0 — pa se rasprodat artikal i dalje prodavao
  // po staroj cijeni.
  const id = dodajArtikal('002', 10);

  const { nivelacija, bezZaliha } = collectPriceChanges(db, [
    { productId: id, cijena: 12, pdvStopa: 'E' },
  ]);
  expect(nivelacija).toEqual([]);
  expect(bezZaliha.length).toBe(1);

  applyPricesWithoutStock(db, bezZaliha);
  const p = db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number };
  expect(p.cijena).toBe(12);
});

test('ista cijena ne pravi nikakvu izmjenu', () => {
  const id = dodajArtikal('003', 10);
  dodajZalihu(id, 3);
  const res = collectPriceChanges(db, [{ productId: id, cijena: 10, pdvStopa: 'E' }]);
  expect(res.nivelacija).toEqual([]);
  expect(res.bezZaliha).toEqual([]);
});

test('isti artikal na više stavki se broji jednom', () => {
  const id = dodajArtikal('004', 10);
  dodajZalihu(id, 2);
  const { nivelacija } = collectPriceChanges(db, [
    { productId: id, cijena: 12, pdvStopa: 'E' },
    { productId: id, cijena: 15, pdvStopa: 'E' },
  ]);
  expect(nivelacija.length).toBe(1);
  expect(nivelacija[0].novaCijena).toBe(12);
});

test('getProductStock sabira ulaze i oduzima izlaze', () => {
  const id = dodajArtikal('005', 10);
  dodajZalihu(id, 10);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', 2.5, 'order', 1)").run(id);
  expect(getProductStock(db, id)).toBe(7.5);
});

// ── revertNivelacijaPrices ────────────────────────────────────────────

function dodajNivelaciju(primkaId: number, productId: number, stara: number, nova: number): void {
  db.prepare("INSERT INTO primke (id, brojPrimke, datum) VALUES (?, ?, '2026-01-01') ON CONFLICT DO NOTHING")
    .run(primkaId, `U-${primkaId}`);
  const niv = db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, '2026-01-01', ?)")
    .run(`NIV-${primkaId}-${productId}`, primkaId);
  db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, ?, ?, ?, ?, 'E')")
    .run(Number(niv.lastInsertRowid), productId, stara, nova, nova - stara, nova - stara);
}

test('revert vraća staru cijenu kad je primka posljednja mijenjala cijenu', () => {
  const id = dodajArtikal('010', 12);
  dodajNivelaciju(1, id, 10, 12);

  expect(revertNivelacijaPrices(db, 1)).toBe(1);
  const p = db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number };
  expect(p.cijena).toBe(10);
});

test('revert ne gazi kasniju nivelaciju druge primke', () => {
  // Primka A: 10 → 12, primka B kasnije: 12 → 15. Izmjena primke A ne smije
  // vratiti artikal na 10 — na snazi je cijena koju je postavila primka B.
  const id = dodajArtikal('011', 15);
  dodajNivelaciju(1, id, 10, 12);
  dodajNivelaciju(2, id, 12, 15);

  expect(revertNivelacijaPrices(db, 1)).toBe(0);
  const p = db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number };
  expect(p.cijena).toBe(15);
});

// ── isDobavljacUsed ───────────────────────────────────────────────────

test('dobavljač u upotrebi se prepoznaje po JIB-u upisanom u primku', () => {
  // primke.dobavljacId čuva JIB, ne rowid — stara provjera po rowid-u nikad
  // nije pogađala, pa se dobavljač sa primkama mogao obrisati.
  db.prepare("INSERT INTO dobavljaci (id, naziv, idBroj, pdvBroj) VALUES (3, 'Veletrgovina', '4200000000000', '200000000000')").run();
  db.prepare("INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId) VALUES ('U-1', '2026-01-01', 'Veletrgovina', '4200000000000')").run();

  const d = db.prepare('SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = 3').get() as any;
  expect(isDobavljacUsed(db, d)).toBe(true);
});

test('dobavljač bez primki se može obrisati', () => {
  db.prepare("INSERT INTO dobavljaci (id, naziv, idBroj, pdvBroj) VALUES (4, 'Novi', '4200000000001', NULL)").run();
  const d = db.prepare('SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = 4').get() as any;
  expect(isDobavljacUsed(db, d)).toBe(false);
});

test('dobavljač bez JIB-a se prepoznaje po nazivu', () => {
  db.prepare("INSERT INTO dobavljaci (id, naziv, idBroj, pdvBroj) VALUES (5, 'Bez JIB-a', NULL, NULL)").run();
  db.prepare("INSERT INTO primke (brojPrimke, datum, dobavljacNaziv) VALUES ('U-2', '2026-01-01', 'Bez JIB-a')").run();
  const d = db.prepare('SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = 5').get() as any;
  expect(isDobavljacUsed(db, d)).toBe(true);
});
