import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import { refundOrderInTransaction } from './refund';
import { getProductStock } from './skladiste';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajArtikal(id: number, tip = 'artikal'): void {
  db.prepare("INSERT INTO products (id, sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, ?, 10, 'E', ?)")
    .run(id, `S-${id}`, `Artikal ${id}`, tip);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 100, 'test', 0)")
    .run(id);
}

function dodajRacun(stavke: Array<{ productId: number; kolicina: number }>): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status)
    VALUES (1, 100, 17, 'Gotovina', '555', 'completed')
  `).run();
  const orderId = Number(r.lastInsertRowid);
  for (const s of stavke) {
    db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, 10, 0, 'E')")
      .run(orderId, s.productId, s.kolicina);
    db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)")
      .run(s.productId, s.kolicina, orderId);
  }
  return orderId;
}

test('storno mijenja status, vraća zalihu i upisuje broj reklamacije', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 3 }]);
  expect(getProductStock(db, 1)).toBe(97);

  refundOrderInTransaction(db, orderId, 'R-77');

  const order = db.prepare('SELECT status, brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('refunded');
  expect(order.brojReklamacije).toBe('R-77');
  expect(getProductStock(db, 1)).toBe(100);
});

test('drugi storno istog računa ne prolazi', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 2 }]);
  refundOrderInTransaction(db, orderId, 'R-1');

  expect(() => refundOrderInTransaction(db, orderId, 'R-2')).toThrow('već storniran');
  // Zaliha se ne smije vratiti dvaput.
  expect(getProductStock(db, 1)).toBe(100);
});

test('storno bez broja reklamacije ne briše postojeći broj', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  db.prepare("UPDATE orders SET brojReklamacije = 'ranije-upisan' WHERE id = ?").run(orderId);

  refundOrderInTransaction(db, orderId, null);

  const order = db.prepare('SELECT brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.brojReklamacije).toBe('ranije-upisan');
});

test('usluge se ne vraćaju na zalihu', () => {
  dodajArtikal(1);
  dodajArtikal(2, 'usluga');
  const orderId = dodajRacun([{ productId: 1, kolicina: 2 }, { productId: 2, kolicina: 1 }]);
  const uslugaPrije = getProductStock(db, 2);

  refundOrderInTransaction(db, orderId, 'R-9');

  expect(getProductStock(db, 1)).toBe(100);
  expect(getProductStock(db, 2)).toBe(uslugaPrije);
});

test('storno upisuje refundedAt — bez njega se dnevni obračun ladice ne može izvesti', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);

  refundOrderInTransaction(db, orderId, 'R-5');

  const order = db.prepare('SELECT refundedAt FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.refundedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('storno nepostojećeg računa baca grešku', () => {
  expect(() => refundOrderInTransaction(db, 999, null)).toThrow('ne postoji');
});

test('decimalna količina se vraća u cijelosti', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 2.5 }]);
  expect(getProductStock(db, 1)).toBe(97.5);

  refundOrderInTransaction(db, orderId, 'R-3');
  expect(getProductStock(db, 1)).toBe(100);
});
