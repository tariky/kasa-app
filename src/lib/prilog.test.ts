import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  PRILOG_SIFRA, prilogNaziv, sljedeciPrilogBroj,
  sumaPriloga, prilogKompletan, buildPrilogFiskalnaStavka,
  savePrilogStavkeInTransaction, postaviPocetniPrilogBroj, pocetniPrilogBroj,
} from './prilog';
import { getProductStock } from './skladiste';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajOrder(opts: { ukupno: number; prilogBroj?: number | null }): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, prilogBroj)
    VALUES (1, ?, 0, 'Gotovina', 'completed', ?)
  `).run(opts.ukupno, opts.prilogBroj ?? null);
  return Number(r.lastInsertRowid);
}

function dodajArtikal(id: number, cijena: number, tip = 'artikal', pdvStopa = 'E'): void {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, ?, 'kom', ?, ?, ?)")
    .run(id, `A${id}`, `Artikal ${id}`, cijena, pdvStopa, tip);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 100, 'test', 0)")
    .run(id);
}

test('prilogNaziv formira tačan naziv stavke', () => {
  expect(prilogNaziv(17)).toBe('Stavke po računu br. 17');
});

test('prilogNaziv koristi zadani uvod i vezu iz unosa', () => {
  expect(prilogNaziv(5, 'CNC obrada', 'fakturi')).toBe('CNC obrada po fakturi br. 5');
});

test('prilogNaziv pada na zadane dijelove kad je unos prazan', () => {
  expect(prilogNaziv(5, '   ', '')).toBe('Stavke po računu br. 5');
});

test('buildPrilogFiskalnaStavka preuzima zadani naziv', () => {
  expect(buildPrilogFiskalnaStavka(5, 100, 'CNC obrada po fakturi br. 5').naziv)
    .toBe('CNC obrada po fakturi br. 5');
});

test('sljedeciPrilogBroj počinje od 1 na praznoj bazi', () => {
  expect(sljedeciPrilogBroj(db)).toBe(1);
});

test('sljedeciPrilogBroj ignorira obične račune i nastavlja od maksimuma', () => {
  dodajOrder({ ukupno: 10 });                    // običan račun, prilogBroj NULL
  dodajOrder({ ukupno: 20, prilogBroj: 4 });
  expect(sljedeciPrilogBroj(db)).toBe(5);
});

test('postaviPocetniPrilogBroj pomjera numeraciju na nastavak stare serije', () => {
  // Klijent je prije programa izdao 20 priloga — sljedeći mora biti 21.
  expect(postaviPocetniPrilogBroj(db, 21)).toBe(21);
  expect(sljedeciPrilogBroj(db)).toBe(21);
  expect(pocetniPrilogBroj(db)).toBe(21);
});

test('numeracija se nakon podešavanja vodi sama', () => {
  postaviPocetniPrilogBroj(db, 21);
  dodajOrder({ ukupno: 10, prilogBroj: 21 });
  expect(sljedeciPrilogBroj(db)).toBe(22);
});

test('postaviPocetniPrilogBroj odbija broj koji je već izdat', () => {
  dodajOrder({ ukupno: 10, prilogBroj: 7 });
  expect(() => postaviPocetniPrilogBroj(db, 7)).toThrow(/već iskorišten/);
  expect(() => postaviPocetniPrilogBroj(db, 3)).toThrow(/već iskorišten/);
  expect(() => postaviPocetniPrilogBroj(db, 0)).toThrow(/veći od 0/);
  expect(sljedeciPrilogBroj(db)).toBe(8);
});

test('sumaPriloga zaokružuje po stavci pa zbir', () => {
  const stavke = [
    { productId: 1, kolicina: 3, cijena: 0.335, pdvStopa: 'E' },  // 1.005 → 1.01 po stavci
    { productId: 2, kolicina: 1, cijena: 2,     pdvStopa: 'E' },
  ];
  expect(sumaPriloga(stavke)).toBe(3.01);
});

test('prilogKompletan poredi na 2 decimale', () => {
  const stavke = [{ productId: 1, kolicina: 2, cijena: 75, pdvStopa: 'E' }];
  expect(prilogKompletan(150, stavke)).toBe(true);
  expect(prilogKompletan(150.01, stavke)).toBe(false);
});

test('buildPrilogFiskalnaStavka gradi zbirnu stavku', () => {
  const s = buildPrilogFiskalnaStavka(17, 150);
  expect(s).toEqual({
    productId: 0, sifra: PRILOG_SIFRA, naziv: 'Stavke po računu br. 17',
    jm: 'kom', plu: 0, cijena: 150, kolicina: 1, rabat: 0, pdvStopa: 'E',
  });
});

test('savePrilogStavke upisuje stavke i skida stanje artiklima', () => {
  dodajArtikal(1, 30);
  dodajArtikal(2, 90, 'usluga');
  const orderId = dodajOrder({ ukupno: 150, prilogBroj: 1 });

  savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
    { productId: 2, kolicina: 1, cijena: 90, pdvStopa: 'E' },
  ]);

  const rows = db.prepare('SELECT * FROM prilog_stavke WHERE orderId = ?').all(orderId);
  expect(rows.length).toBe(2);
  expect(getProductStock(db, 1)).toBe(98);   // artikal skinut
  expect(getProductStock(db, 2)).toBe(100);  // usluga ne dira stanje
});

test('ponovni upis radi diff: stara kretanja se zamijene, bez duplog skidanja', () => {
  dodajArtikal(1, 30);
  dodajArtikal(3, 50);
  const orderId = dodajOrder({ ukupno: 150, prilogBroj: 1 });

  savePrilogStavkeInTransaction(db, orderId, [{ productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' }]);
  savePrilogStavkeInTransaction(db, orderId, [{ productId: 3, kolicina: 3, cijena: 50, pdvStopa: 'E' }]);

  expect(getProductStock(db, 1)).toBe(100);  // vraćeno nakon zamjene
  expect(getProductStock(db, 3)).toBe(97);
  const rows = db.prepare('SELECT productId FROM prilog_stavke WHERE orderId = ?').all(orderId) as any[];
  expect(rows.map(r => r.productId)).toEqual([3]);
});

test('odbija stavku sa PDV stopom različitom od E', () => {
  dodajArtikal(1, 30, 'artikal', 'K');
  const orderId = dodajOrder({ ukupno: 60, prilogBroj: 1 });
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'K' },
  ])).toThrow(/PDV stopom/);
});

test('odbija običan račun (bez prilogBroj) i storniran račun', () => {
  dodajArtikal(1, 30);
  const obican = dodajOrder({ ukupno: 60 });
  expect(() => savePrilogStavkeInTransaction(db, obican, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/nije račun po prilogu/);

  const prilog = dodajOrder({ ukupno: 60, prilogBroj: 2 });
  db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(prilog);
  expect(() => savePrilogStavkeInTransaction(db, prilog, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/storniran/);
});

test('odbija količinu <= 0 i negativnu cijenu', () => {
  dodajArtikal(1, 30);
  const orderId = dodajOrder({ ukupno: 60, prilogBroj: 1 });
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 0, cijena: 30, pdvStopa: 'E' },
  ])).toThrow();
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 1, cijena: -5, pdvStopa: 'E' },
  ])).toThrow();
});

test('odbija nepostojeći proizvod prije upisa ijedne stavke', () => {
  dodajArtikal(1, 30);
  const orderId = dodajOrder({ ukupno: 60, prilogBroj: 1 });
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 1, cijena: 30, pdvStopa: 'E' },
    { productId: 99, kolicina: 1, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/ne postoji/);
  expect(db.prepare('SELECT * FROM prilog_stavke WHERE orderId = ?').all(orderId).length).toBe(0);
  expect(getProductStock(db, 1)).toBe(100);
});
