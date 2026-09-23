import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  nextBrojNaloga, formatBrojNaloga, createNalog, createNalogIzPonude, updateNalog,
  replaceStavke, getNalog, listNalozi, deleteNalog, getNormativ, saveNormativ, nalogZaPonudu,
} from './proizvodnja';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Admin', '0000', 'admin')").run();
});

// ── pomoćne ──────────────────────────────────────────────
export function dodajMaterijal(db: SqlDb, sifra: string, jm = 'kom', dim?: [number, number]): number {
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, plocaSirina, plocaVisina) VALUES (?, ?, ?, 0, 'E', 'materijal', ?, ?)"
  ).run(sifra, `Materijal ${sifra}`, jm, dim?.[0] ?? null, dim?.[1] ?? null);
  return Number(r.lastInsertRowid);
}
export function dodajArtikal(db: SqlDb, sifra: string, cijena = 100): number {
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', ?, 'E', 'artikal')"
  ).run(sifra, `Proizvod ${sifra}`, cijena);
  return Number(r.lastInsertRowid);
}
export function dodajKupca(db: SqlDb, naziv = 'Kupac d.o.o.'): number {
  const r = db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES (?, '4200000000001')").run(naziv);
  return Number(r.lastInsertRowid);
}
export function primka(db: SqlDb, productId: number, kolicina: number, nabavna: number): void {
  const p = db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES (?, '2026-09-01')")
    .run(`U-${Math.random()}`);
  db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, pdvStopa) VALUES (?, ?, ?, 0, ?, 'E')")
    .run(p.lastInsertRowid, productId, kolicina, nabavna);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)")
    .run(productId, kolicina, p.lastInsertRowid);
}

// ── numeracija ───────────────────────────────────────────
test('broj naloga kreće od 1 svake godine', () => {
  expect(nextBrojNaloga(db, 2026)).toBe(1);
  const k = dodajKupca(db);
  createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', datum: '2026-09-23' });
  expect(nextBrojNaloga(db, 2026)).toBe(2);
  expect(nextBrojNaloga(db, 2027)).toBe(1);
  expect(formatBrojNaloga({ broj: 2, godina: 2026 })).toBe('RN-2/2026');
});

// ── kreiranje ────────────────────────────────────────────
test('narudžba traži kupca i opis', () => {
  expect(() => createNalog(db, { vrsta: 'narudzba', korisnikId: 1, opis: 'X' })).toThrow('Kupac');
  expect(() => createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: dodajKupca(db), opis: '  ' })).toThrow('Opis');
});

test('zaliha traži proizvod tipa artikal i količinu > 0', () => {
  const mat = dodajMaterijal(db, 'IV18');
  expect(() => createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: mat, kolicina: 2 })).toThrow('artikal');
  const art = dodajArtikal(db, 'LINA');
  expect(() => createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 0 })).toThrow('Količina');
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 3 });
  const n = getNalog(db, r.id);
  expect(n.opis).toBe('Proizvod LINA'); // opis default = naziv proizvoda
  expect(n.status).toBe('otvoren');
  expect(n.kolicina).toBe(3);
});

test('zaliha sa normativom popuni stavke normativ × količina', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const kant = dodajMaterijal(db, 'KANT', 'm');
  saveNormativ(db, art, [
    { materijalId: iv, kolicina: 1.25, napomena: 'korpus' },
    { materijalId: kant, kolicina: 6 },
  ]);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 4 });
  const n = getNalog(db, r.id);
  expect(n.stavke!.map(s => [s.materijalId, s.kolicina])).toEqual([[iv, 5], [kant, 24]]);
  expect(n.stavke![0].napomena).toBe('korpus');
  expect(n.stavke![0].nabavnaCijena).toBeNull();
});

test('nalog iz ponude nasljeđuje kupca, opis i cijenu; druga konverzija odbijena', () => {
  const k = dodajKupca(db, 'Mujić');
  const a1 = dodajArtikal(db, 'KUH', 3000);
  const a2 = dodajArtikal(db, 'MONT', 200);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (7, 1, 2026, ?, 1, '2026-09-01', '2026-09-09', 'prihvacena', 3200, 465.81)`).run(k);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 3000, 0, 'E')").run(a1);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 200, 0, 'E')").run(a2);

  const r = createNalogIzPonude(db, 7, 1);
  const n = getNalog(db, r.id);
  expect(n.vrsta).toBe('narudzba');
  expect(n.kupacId).toBe(k);
  expect(n.ponudaId).toBe(7);
  expect(n.opis).toBe('Proizvod KUH, Proizvod MONT');
  expect(n.dogovorenaCijena).toBe(3200);
  expect(n.ponudaBroj).toBe(1);
  expect(nalogZaPonudu(db, 7)).toEqual({ id: r.id, broj: 1, godina: 2026 });

  expect(() => createNalogIzPonude(db, 7, 1)).toThrow('već');
});

test('nalog iz ponude koja nije prihvaćena je odbijen', () => {
  const k = dodajKupca(db);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (8, 2, 2026, ?, 1, '2026-09-01', '2026-09-09', 'poslana', 100, 14.53)`).run(k);
  expect(() => createNalogIzPonude(db, 8, 1)).toThrow('prihvaćena');
  expect(nalogZaPonudu(db, 8)).toBeNull();
});

// ── izmjene ──────────────────────────────────────────────
test('update i replaceStavke rade samo dok nalog nije završen', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Plakar' });
  updateNalog(db, r.id, { opis: 'Plakar klizni', dogovorenaCijena: 1500, rok: '2026-10-15', trosakRada: 200 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2.5, napomena: '600×720 ×2' }]);
  const n = getNalog(db, r.id);
  expect(n.opis).toBe('Plakar klizni');
  expect(n.dogovorenaCijena).toBe(1500);
  expect(n.trosakRada).toBe(200);
  expect(n.stavke!.length).toBe(1);
  expect(n.stavke![0].materijalJm).toBe('m²');
  expect(n.stavke![0].plocaSirina).toBe(2800);

  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen' WHERE id = ?").run(r.id);
  expect(() => updateNalog(db, r.id, { opis: 'X' })).toThrow('završen');
  expect(() => replaceStavke(db, r.id, [])).toThrow('završen');
});

test('stavka mora biti materijal sa količinom > 0', () => {
  const k = dodajKupca(db);
  const art = dodajArtikal(db, 'A');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  expect(() => replaceStavke(db, r.id, [{ materijalId: art, kolicina: 1 }])).toThrow('materijal');
  const iv = dodajMaterijal(db, 'IV');
  expect(() => replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 0 }])).toThrow('Količina');
});

test('lista: filter aktivni isključuje fakturisane, redoslijed najnoviji prvi', () => {
  const k = dodajKupca(db);
  const a = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'A', datum: '2026-09-01' });
  const b = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'B', datum: '2026-09-02' });
  db.prepare("UPDATE radni_nalozi SET status = 'fakturisan' WHERE id = ?").run(a.id);
  expect(listNalozi(db).map(n => n.id)).toEqual([b.id, a.id]);
  expect(listNalozi(db, { status: 'aktivni' }).map(n => n.id)).toEqual([b.id]);
  expect(listNalozi(db, { status: 'fakturisan' }).map(n => n.id)).toEqual([a.id]);
  expect(listNalozi(db)[0].kupacNaziv).toBe('Kupac d.o.o.');
});

test('brisanje samo dok nalog nije završen; briše i stavke', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  deleteNalog(db, r.id);
  expect(db.prepare('SELECT COUNT(*) AS c FROM radni_nalog_stavke').get()).toEqual({ c: 0 });
  expect(() => getNalog(db, r.id)).toThrow('ne postoji');

  const r2 = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Y' });
  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen' WHERE id = ?").run(r2.id);
  expect(() => deleteNalog(db, r2.id)).toThrow('završen');
});

// ── normativi ────────────────────────────────────────────
test('saveNormativ zamjenjuje cijeli set i vraća JOIN polja', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²');
  const kant = dodajMaterijal(db, 'KANT', 'm');
  saveNormativ(db, art, [{ materijalId: iv, kolicina: 1.2 }, { materijalId: kant, kolicina: 5 }]);
  saveNormativ(db, art, [{ materijalId: kant, kolicina: 6 }]);
  const n = getNormativ(db, art);
  expect(n.length).toBe(1);
  expect(n[0].kolicina).toBe(6);
  expect(n[0].materijalNaziv).toBe('Materijal KANT');
  expect(n[0].materijalJm).toBe('m');
  expect(() => saveNormativ(db, iv, [])).toThrow('artikal');
});
