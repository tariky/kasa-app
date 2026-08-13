import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  PRILOG_SIFRA, prilogNaziv, sljedeciPrilogBroj,
  sumaPriloga, prilogKompletan, buildPrilogFiskalnaStavka,
} from './prilog';

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

test('prilogNaziv formira tačan naziv stavke', () => {
  expect(prilogNaziv(17)).toBe('Stavke po računu br. 17');
});

test('sljedeciPrilogBroj počinje od 1 na praznoj bazi', () => {
  expect(sljedeciPrilogBroj(db)).toBe(1);
});

test('sljedeciPrilogBroj ignorira obične račune i nastavlja od maksimuma', () => {
  dodajOrder({ ukupno: 10 });                    // običan račun, prilogBroj NULL
  dodajOrder({ ukupno: 20, prilogBroj: 4 });
  expect(sljedeciPrilogBroj(db)).toBe(5);
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
