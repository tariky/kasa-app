// Knjiga zalihe nad pravom SQLite bazom sa produkcijskom šemom (bun:sqlite).
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { knjizi, ponisti, stanje, STANJE_SQL, TOLERANCIJA_ZALIHE } from './zaliha';
import { TOLERANCIJA_ZALIHE as IZ_TOLERANCIJA } from './tolerancije';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
});

function artikal(sifra: string, tip = 'artikal'): number {
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, 10, 'E', ?)")
    .run(sifra, `Artikal ${sifra}`, tip);
  return Number(r.lastInsertRowid);
}

interface Kretanje { productId: number; tip: string; kolicina: number; referenceType: string; referenceId: number; createdAt: string }

function kretanja(): Kretanje[] {
  return db.prepare('SELECT productId, tip, kolicina, referenceType, referenceId, createdAt FROM stock_movements ORDER BY id').all() as Kretanje[];
}

test('stanje: bez kretanja 0, inače ulazi minus izlazi', () => {
  const a = artikal('A');
  expect(stanje(db, a)).toBe(0);
  expect(stanje(db, 999)).toBe(0);
  knjizi(db, { vrsta: 'primka', id: 1 }, 'ulaz', [{ productId: a, kolicina: 10 }]);
  knjizi(db, { vrsta: 'order', id: 1 }, 'izlaz', [{ productId: a, kolicina: 2.5 }]);
  expect(stanje(db, a)).toBe(7.5);
});

test('knjizi: jedno kretanje po stavci, redom, s datumom dokumenta', () => {
  const a = artikal('A');
  const b = artikal('B', 'materijal');
  knjizi(db, { vrsta: 'primka', id: 7 }, 'ulaz', [{ productId: a, kolicina: 3 }, { productId: b, kolicina: 1.25 }, { productId: a, kolicina: 2 }],
    { datum: '2026-03-10 00:00:00' });
  expect(kretanja()).toEqual([
    { productId: a, tip: 'ulaz', kolicina: 3, referenceType: 'primka', referenceId: 7, createdAt: '2026-03-10 00:00:00' },
    { productId: b, tip: 'ulaz', kolicina: 1.25, referenceType: 'primka', referenceId: 7, createdAt: '2026-03-10 00:00:00' },
    { productId: a, tip: 'ulaz', kolicina: 2, referenceType: 'primka', referenceId: 7, createdAt: '2026-03-10 00:00:00' },
  ]);
});

test('knjizi bez datuma: lokalno vrijeme sada, kao zadana vrijednost kolone', () => {
  const a = artikal('A');
  knjizi(db, { vrsta: 'radni_nalog', id: 3 }, 'izlaz', [{ productId: a, kolicina: 1 }]);
  const { createdAt } = db.prepare('SELECT createdAt FROM stock_movements').get() as { createdAt: string };
  expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const { danas } = db.prepare("SELECT date('now','localtime') AS danas").get() as { danas: string };
  expect(createdAt.slice(0, 10)).toBe(danas);
});

test('usluga ne razdužuje: izlaz računa i priloga preskače uslugu, ostalo knjiži', () => {
  const a = artikal('A');
  const u = artikal('U', 'usluga');
  const m = artikal('M', 'materijal');
  for (const vrsta of ['order', 'prilog']) {
    knjizi(db, { vrsta, id: 1 }, 'izlaz', [{ productId: a, kolicina: 1 }, { productId: u, kolicina: 1 }, { productId: m, kolicina: 1 }]);
  }
  expect(kretanja().map(k => [k.referenceType, k.productId])).toEqual([['order', a], ['order', m], ['prilog', a], ['prilog', m]]);
  expect(stanje(db, u)).toBe(0);
});

test('usluga ne razdužuje: artikal kojeg nema u bazi se knjiži (preskače se samo poznata usluga)', () => {
  knjizi(db, { vrsta: 'order', id: 1 }, 'izlaz', [{ productId: 404, kolicina: 2 }]);
  expect(stanje(db, 404)).toBe(-2);
});

test('pravilo usluge važi samo za prodaju: storno, korekcija i nalog knjiže i uslugu', () => {
  // Storno vraća ono što je račun skinuo, i kad je artikal u međuvremenu
  // postao usluga; korekcija i utrošak naloga knjiže tačno zadanu količinu.
  const u = artikal('U', 'usluga');
  knjizi(db, { vrsta: 'refund', id: 1 }, 'ulaz', [{ productId: u, kolicina: 2 }]);
  knjizi(db, { vrsta: 'adjustment', id: 0 }, 'izlaz', [{ productId: u, kolicina: 0.5 }]);
  knjizi(db, { vrsta: 'radni_nalog', id: 4 }, 'izlaz', [{ productId: u, kolicina: 0.25 }]);
  expect(kretanja().map(k => [k.referenceType, k.tip])).toEqual([['refund', 'ulaz'], ['adjustment', 'izlaz'], ['radni_nalog', 'izlaz']]);
  expect(stanje(db, u)).toBe(1.25);
});

test('ponisti briše samo kretanja tog dokumenta', () => {
  const a = artikal('A');
  knjizi(db, { vrsta: 'primka', id: 1 }, 'ulaz', [{ productId: a, kolicina: 10 }]);
  knjizi(db, { vrsta: 'primka', id: 2 }, 'ulaz', [{ productId: a, kolicina: 5 }]);
  knjizi(db, { vrsta: 'radni_nalog', id: 1 }, 'izlaz', [{ productId: a, kolicina: 1 }]);
  ponisti(db, { vrsta: 'primka', id: 1 });
  expect(kretanja().map(k => [k.referenceType, k.referenceId])).toEqual([['primka', 2], ['radni_nalog', 1]]);
  expect(stanje(db, a)).toBe(4);
});

test('STANJE_SQL je stanje artikla p u upitu nad artiklima', () => {
  const a = artikal('A');
  const b = artikal('B');
  knjizi(db, { vrsta: 'primka', id: 1 }, 'ulaz', [{ productId: a, kolicina: 0.1 }, { productId: a, kolicina: 0.2 }]);
  knjizi(db, { vrsta: 'order', id: 1 }, 'izlaz', [{ productId: a, kolicina: 0.3 }]);
  const redovi = db.prepare(`SELECT p.id, ${STANJE_SQL} AS stanje FROM products p ORDER BY p.id`).all() as Array<{ id: number; stanje: number }>;
  expect(redovi.map(r => r.id)).toEqual([a, b]);
  for (const r of redovi) expect(r.stanje).toBe(stanje(db, r.id));
  // Šum zbira u REAL-u je ispod tolerancije.
  expect(Math.abs(stanje(db, a))).toBeLessThan(TOLERANCIJA_ZALIHE);
});

test('jedna tolerancija zalihe (lib/tolerancije.ts)', () => {
  expect(TOLERANCIJA_ZALIHE).toBe(IZ_TOLERANCIJA);
  expect(TOLERANCIJA_ZALIHE).toBe(1e-9);
});

test('Rust (zaliha.rs) čita STANJE_SQL kao jedini tekst između backtickova u zaliha.ts', () => {
  const dijelovi = readFileSync(path.join(__dirname, 'zaliha.ts'), 'utf8').split('`');
  expect(dijelovi.length).toBe(3);
  expect(dijelovi[1]).toBe(STANJE_SQL);
});
