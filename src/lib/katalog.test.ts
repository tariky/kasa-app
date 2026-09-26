// lib/katalog.ts nad pravom SQLite bazom s produkcijskom šemom. Kanali
// šifarnika (product:*, dobavljac:*, kupac:*) su u ugovoru oba backenda
// (src/ipc/ugovor/katalog.ugovor.test.ts); ovdje je modul sam.
import { test, expect, beforeEach, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '../database/schema';
import {
  azuriraj, normalizujTip, validirajArtikal, provjeriBrisanjeArtikla, slobodnaStavka, validirajDobavljaca, validirajKupca,
  KOLONE_ARTIKLA, KOLONE_KUPCA, SLOBODAN_NAZIV_MAX,
} from './katalog';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
});

function artikal(sifra: string, opts: { barkod?: string; cijena?: number } = {}): number {
  return Number(db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa, barkod) VALUES (?, ?, ?, 'E', ?)")
    .run(sifra, `Artikal ${sifra}`, opts.cijena ?? 10, opts.barkod ?? null).lastInsertRowid);
}

function red(sql: string, ...params: unknown[]): any {
  return db.prepare(sql).get(...params);
}

const greska = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };

describe('azuriraj', () => {
  test('mijenja samo dozvoljene kolone s poslanom vrijednošću; null briše', () => {
    const id = artikal('A1', { barkod: '123' });
    const r = azuriraj(db, 'products', id, { naziv: 'Novi', barkod: null, jm: undefined, slobodan: 1, id: 99 }, KOLONE_ARTIKLA);
    expect(r).toEqual({ changes: 1 });
    expect(red('SELECT id, naziv, barkod, jm, slobodan FROM products WHERE id = ?', id))
      .toEqual({ id, naziv: 'Novi', barkod: null, jm: 'kom', slobodan: 0 });
  });

  test('bez ijedne kolone baza se ne dira, ni dodatna dodjela', () => {
    const id = artikal('A1');
    db.prepare("UPDATE products SET updatedAt = '2020-01-01 00:00:00' WHERE id = ?").run(id);
    const uzIzmjenu = "updatedAt = datetime('now','localtime')";
    expect(azuriraj(db, 'products', id, {}, KOLONE_ARTIKLA, { uzIzmjenu })).toEqual({ changes: 0 });
    expect(azuriraj(db, 'products', id, { nepoznata: 'x', cijena: undefined }, KOLONE_ARTIKLA, { uzIzmjenu })).toEqual({ changes: 0 });
    expect(red('SELECT updatedAt FROM products WHERE id = ?', id).updatedAt).toBe('2020-01-01 00:00:00');
    expect(azuriraj(db, 'products', id, { cijena: 12 }, KOLONE_ARTIKLA, { uzIzmjenu })).toEqual({ changes: 1 });
    expect(red('SELECT updatedAt FROM products WHERE id = ?', id).updatedAt).not.toBe('2020-01-01 00:00:00');
  });

  test('nepostojeći id daje changes 0', () => {
    expect(azuriraj(db, 'kupci', 404, { naziv: 'X' }, KOLONE_KUPCA)).toEqual({ changes: 0 });
  });
});

describe('normalizujTip', () => {
  test('artikal, usluga i materijal ostaju; sve ostalo je artikal', () => {
    expect(['artikal', 'usluga', 'materijal', 'nesto', '', undefined].map(normalizujTip))
      .toEqual(['artikal', 'usluga', 'materijal', 'artikal', 'artikal', 'artikal']);
  });
});

describe('validirajArtikal', () => {
  const novi = { sifra: ' A1 ', naziv: ' Čaj ', cijena: 0, pdvStopa: 'E', barkod: ' 385 ', plu: '12' };

  test('create: sva polja obavezna; vraća trimovane šifru, naziv i barkod te PLU kao broj', () => {
    expect(validirajArtikal(db, novi, null)).toEqual({ sifra: 'A1', naziv: 'Čaj', barkod: '385', plu: 12 });
    expect(validirajArtikal(db, { ...novi, barkod: ' ', plu: undefined }, null)).toEqual({ sifra: 'A1', naziv: 'Čaj', barkod: null, plu: null });
    expect(greska(() => validirajArtikal(db, { ...novi, sifra: ' ' }, null))).toBe('Šifra artikla je obavezna');
    expect(greska(() => validirajArtikal(db, { ...novi, naziv: undefined }, null))).toBe('Naziv artikla je obavezan');
    expect(greska(() => validirajArtikal(db, { ...novi, cijena: -1 }, null))).toBe('Cijena mora biti pozitivan broj');
    expect(greska(() => validirajArtikal(db, { ...novi, cijena: undefined }, null))).toBe('Cijena mora biti pozitivan broj');
    expect(greska(() => validirajArtikal(db, { ...novi, pdvStopa: 'A' }, null))).toBe('PDV stopa mora biti E ili K');
  });

  test('update: provjerava samo poslano; barkod samo kad je ključ poslan', () => {
    const id = artikal('A1');
    expect(validirajArtikal(db, {}, id)).toEqual({});
    expect(validirajArtikal(db, { naziv: ' X ' }, id)).toEqual({ naziv: 'X' });
    expect(validirajArtikal(db, { barkod: null }, id)).toEqual({ barkod: null });
    expect(validirajArtikal(db, { sifra: 'A1' }, id)).toEqual({ sifra: 'A1' });
    expect(greska(() => validirajArtikal(db, { cijena: undefined, pdvStopa: 'X' }, id))).toBe('PDV stopa mora biti E ili K');
  });

  test('PLU: cijeli broj od 0 do 999999 ili prazno', () => {
    const id = artikal('A1');
    for (const [plu, ocekivano] of [[0, 0], [999_999, 999_999], [' 7 ', 7], ['', null], [null, null]] as const) {
      expect(validirajArtikal(db, { plu }, id).plu).toBe(ocekivano);
    }
    for (const plu of [1_000_000, -1, 1.5, 'abc', '1e3', true]) {
      expect(greska(() => validirajArtikal(db, { plu }, id))).toBe('PLU mora biti cijeli broj od 0 do 999999');
    }
  });

  test('duplikat šifre ili barkoda drugog artikla; poruka nosi poslanu vrijednost', () => {
    artikal('A1', { barkod: '385' });
    const drugi = artikal('A2');
    expect(greska(() => validirajArtikal(db, { ...novi, barkod: '' }, null))).toBe('Artikal sa šifrom " A1 " već postoji');
    expect(greska(() => validirajArtikal(db, { barkod: ' 385 ' }, drugi))).toBe('Artikal sa barkodom " 385 " već postoji');
    expect(validirajArtikal(db, { sifra: 'A2' }, drugi)).toEqual({ sifra: 'A2' });
  });
});

describe('provjeriBrisanjeArtikla', () => {
  test('artikal koji se nigdje ne koristi prolazi', () => {
    expect(() => provjeriBrisanjeArtikla(db, artikal('A1'))).not.toThrow();
    expect(() => provjeriBrisanjeArtikla(db, 404)).not.toThrow();
  });

  test('poruka kaže gdje se artikal koristi; račun ima prednost pred kretanjima zalihe', () => {
    const id = artikal('A1');
    db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 1, 'test', 0)").run(id);
    expect(greska(() => provjeriBrisanjeArtikla(db, id))).toBe('Artikal ima kretanja zalihe i ne može biti obrisan');

    const u = Number(db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('A', 'x', 'admin')").run().lastInsertRowid);
    const o = Number(db.prepare("INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (?, 1, 0, 'Gotovina', 'completed')").run(u).lastInsertRowid);
    db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 1, 0, 'E')").run(o, id);
    // Račun ima prednost pred kretanjima (račun ih i sam pravi).
    expect(greska(() => provjeriBrisanjeArtikla(db, id))).toBe('Artikal se koristi u računima i ne može biti obrisan');
  });

  test('normativ proizvodnje', () => {
    const proizvod = artikal('P1');
    const materijal = artikal('M1');
    db.prepare('INSERT INTO normativi (productId, materijalId, kolicina) VALUES (?, ?, 1)').run(proizvod, materijal);
    expect(greska(() => provjeriBrisanjeArtikla(db, materijal)))
      .toBe('Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan');
  });
});

describe('slobodnaStavka', () => {
  const trag: Array<[string, Record<string, unknown>]> = [];
  const audit = (akcija: string, detalji: Record<string, unknown>) => { trag.push([akcija, detalji]); };
  beforeEach(() => { trag.length = 0; });

  test('pravi skriveni artikal (usluga, slobodan) s automatskom šifrom i vraća ga sa stanjem 0', () => {
    const s = slobodnaStavka(db, { naziv: ' Šivenje ', cijena: 5, pdvStopa: 'E' }, audit);
    expect(s).toMatchObject({ sifra: 'S000001', naziv: 'Šivenje', jm: 'kom', cijena: 5, pdvStopa: 'E', tip: 'usluga', slobodan: 1, stanje: 0 });
    expect(trag).toEqual([]);
  });

  test('isti naziv (bez obzira na velika slova, i Š/š), stopa i JM → isti artikal, samo nova cijena', () => {
    const prvi = slobodnaStavka(db, { naziv: 'Šivenje', cijena: 5, pdvStopa: 'E' }, audit);
    const drugi = slobodnaStavka(db, { naziv: 'šIVENJE', cijena: 7, pdvStopa: 'E', jm: ' kom ' }, audit);
    expect(drugi.id).toBe(prvi.id);
    expect(drugi.cijena).toBe(7);
    expect(trag).toEqual([['artikal:cijena', { productId: prvi.id, staraCijena: 5, novaCijena: 7, izvor: 'slobodan' }]]);
    expect(slobodnaStavka(db, { naziv: 'Šivenje', cijena: 7, pdvStopa: 'K' }, audit).id).not.toBe(prvi.id);
    expect(slobodnaStavka(db, { naziv: 'Šivenje', cijena: 7, pdvStopa: 'E', jm: 'h' }, audit).id).not.toBe(prvi.id);
  });

  test('preskače šifru koju već ima obični artikal', () => {
    artikal('S000001');
    expect(slobodnaStavka(db, { naziv: 'X', cijena: 1, pdvStopa: 'E' }, audit).sifra).toBe('S000002');
  });

  test('naziv do 32 znaka, cijena 0,01–9.999.999,99, stopa E ili K — prije upisa', () => {
    const upis = (data: Parameters<typeof slobodnaStavka>[1]) => greska(() => slobodnaStavka(db, data, audit));
    expect(upis({ naziv: ' ', cijena: 1, pdvStopa: 'E' })).toBe('Naziv stavke je obavezan');
    expect(upis({ naziv: 'x'.repeat(SLOBODAN_NAZIV_MAX + 1), cijena: 1, pdvStopa: 'E' })).toBe('Naziv stavke može imati najviše 32 znaka');
    expect(upis({ naziv: 'x'.repeat(SLOBODAN_NAZIV_MAX), cijena: 1, pdvStopa: 'E' })).toBe('');
    for (const cijena of [0, 10_000_000, undefined]) {
      expect(upis({ naziv: 'Y', cijena, pdvStopa: 'E' })).toBe('Cijena mora biti između 0,01 i 9.999.999,99');
    }
    expect(upis({ naziv: 'Y', cijena: 1, pdvStopa: 'A' })).toBe('PDV stopa mora biti E ili K');
    expect(red('SELECT COUNT(*) AS n FROM products').n).toBe(1);
  });
});

describe('validirajDobavljaca', () => {
  test('naziv obavezan i trimovan; na update-u samo ako je poslan', () => {
    expect(validirajDobavljaca({ naziv: ' D ' }, null)).toEqual({ naziv: 'D' });
    expect(validirajDobavljaca({}, 1)).toEqual({});
    expect(greska(() => validirajDobavljaca({}, null))).toBe('Naziv dobavljača je obavezan');
    expect(greska(() => validirajDobavljaca({ naziv: ' ' }, 1))).toBe('Naziv dobavljača je obavezan');
  });
});

describe('validirajKupca', () => {
  test('create: naziv i JIB obavezni i trimovani; duplikat JIB-a po trimovanoj vrijednosti', () => {
    expect(validirajKupca(db, { naziv: ' K ', idBroj: ' 42 ' }, null)).toEqual({ naziv: 'K', idBroj: '42' });
    expect(greska(() => validirajKupca(db, { idBroj: '42' }, null))).toBe('Naziv kupca je obavezan');
    expect(greska(() => validirajKupca(db, { naziv: 'K' }, null))).toBe('ID broj (JIB) kupca je obavezan');
    const id = Number(db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('K', '42')").run().lastInsertRowid);
    expect(greska(() => validirajKupca(db, { naziv: 'L', idBroj: ' 42 ' }, null))).toBe('Kupac sa JIB-om " 42 " već postoji');
    expect(validirajKupca(db, { idBroj: '42' }, id)).toEqual({ idBroj: '42' });
    expect(validirajKupca(db, {}, id)).toEqual({});
  });

  test('zadano za dokumente: samo poslana polja; prazno i null brišu', () => {
    const id = 1;
    expect(validirajKupca(db, { rokPlacanjaDana: 15, nacinPlacanja: 'Virman', rabat: 5.126 }, id))
      .toEqual({ rokPlacanjaDana: 15, nacinPlacanja: 'Virman', rabat: 5.13 });
    expect(validirajKupca(db, { rokPlacanjaDana: '', nacinPlacanja: null, rabat: '' }, id))
      .toEqual({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null });
  });

  test('zadano za dokumente: validacija', () => {
    const id = 1;
    for (const rokPlacanjaDana of [-1, 366, 1.5, '10']) {
      expect(greska(() => validirajKupca(db, { rokPlacanjaDana }, id))).toBe('Rok plaćanja mora biti cijeli broj dana od 0 do 365');
    }
    for (const nacinPlacanja of ['gotovina', 'Kompenzacija', 5]) {
      expect(greska(() => validirajKupca(db, { nacinPlacanja }, id))).toBe(`Nepoznat način plaćanja "${String(nacinPlacanja)}"`);
    }
    for (const rabat of [-0.5, 100, 99.996, NaN, '5']) {
      expect(greska(() => validirajKupca(db, { rabat }, id))).toBe('Rabat kupca mora biti od 0 do manje od 100 %');
    }
    expect(validirajKupca(db, { nacinPlacanja: 'Ček', rabat: 99.99 }, id)).toEqual({ nacinPlacanja: 'Ček', rabat: 99.99 });
  });
});
