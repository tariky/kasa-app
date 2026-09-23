import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  nextBrojNaloga, formatBrojNaloga, createNalog, createNalogIzPonude, updateNalog,
  replaceStavke, getNalog, listNalozi, deleteNalog, getNormativ, saveNormativ, nalogZaPonudu,
  getProsjecnaNabavna, kalkulacija, kalkulacijaNaloga, setStatusNaloga, zavrsiNalog, vratiUIzradu, fakturisiNalog,
  izdajRacunZaNalog, osigurajProdajnuUslugu, PRODAJNA_USLUGA,
} from './proizvodnja';
import { getProductStock } from './skladiste';

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

test('kolicina naloga se zaokružuje na 4 decimale', () => {
  const art = dodajArtikal(db, 'LINA');
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 2.00004 });
  expect(getNalog(db, r.id).kolicina).toBe(2);
  updateNalog(db, r.id, { kolicina: 3.000049 });
  expect(getNalog(db, r.id).kolicina).toBe(3);
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

// ── prosječna nabavna ────────────────────────────────────
test('prosječna nabavna je ponderisana po količini; bez primki 0', () => {
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  expect(getProsjecnaNabavna(db, iv)).toBe(0);
  primka(db, iv, 10, 10);   // 100
  primka(db, iv, 30, 14);   // 420 → 520 / 40 = 13
  expect(getProsjecnaNabavna(db, iv)).toBe(13);
});

// ── kalkulacija ──────────────────────────────────────────
test('kalkulacija za narudžbu: marža prema neto dogovorene cijene', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 1170, trosakRada: 100, status: 'otvoren' },
    [
      { id: 1, radniNalogId: 1, materijalId: 1, kolicina: 10, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 13, stanje: 20 } as any,
      { id: 2, radniNalogId: 1, materijalId: 2, kolicina: 4, nabavnaCijena: null, naziv: 'Kant', trenutnaCijena: 0.5, stanje: 1 } as any,
    ]
  );
  expect(k.materijal).toBe(132);
  expect(k.rad).toBe(100);
  expect(k.ukupno).toBe(232);
  expect(k.neto).toBe(1000);
  expect(k.marza).toBe(768);
  expect(k.marzaPct).toBe(76.8);
  expect(k.upozorenja).toEqual(['Kant: utrošak 4 prelazi stanje 1']);
  expect(k.stavke[0].zamrznuto).toBe(false);
});

test('kalkulacija: materijal bez primke daje upozorenje', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 117, trosakRada: 0, status: 'otvoren' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 2, nabavnaCijena: null, naziv: 'Staklo', trenutnaCijena: 0, stanje: 5 } as any]
  );
  expect(k.materijal).toBe(0);
  expect(k.upozorenja).toEqual(['Staklo: nema nabavne cijene (nema primke)']);
});

test('kalkulacija za zalihu: trošak po komadu; zamrznuta cijena ima prednost', () => {
  const k = kalkulacija(
    { vrsta: 'zaliha', kolicina: 4, dogovorenaCijena: null, trosakRada: 40, status: 'zavrsen' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 8, nabavnaCijena: 12, naziv: 'IV', trenutnaCijena: 99, stanje: 0 } as any]
  );
  expect(k.materijal).toBe(96);
  expect(k.ukupno).toBe(136);
  expect(k.poKomadu).toBe(34);
  expect(k.neto).toBeUndefined();
  expect(k.stavke[0].zamrznuto).toBe(true);
  expect(k.upozorenja).toEqual([]); // završen nalog ne upozorava na stanje
});

// ── statusi i knjiženje ──────────────────────────────────
test('prelazi statusa: otvoren → u_izradi, ostalo odbijeno', () => {
  const k = dodajKupca(db);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  setStatusNaloga(db, r.id, 'u_izradi');
  expect(getNalog(db, r.id).status).toBe('u_izradi');
  expect(() => setStatusNaloga(db, r.id, 'u_izradi')).toThrow();
  expect(() => zavrsiNalog(db, r.id)).toThrow('stavk'); // nema stavki
});

test('završetak knjiži izlaz materijala i zamrzava prosječnu cijenu', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const kant = dodajMaterijal(db, 'KANT', 'm');
  primka(db, iv, 40, 13);
  primka(db, kant, 100, 0.5);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', dogovorenaCijena: 2340 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 10 }, { materijalId: kant, kolicina: 20 }]);

  zavrsiNalog(db, r.id);

  const n = getNalog(db, r.id);
  expect(n.status).toBe('zavrsen');
  expect(n.zavrsenAt).toBeTruthy();
  expect(n.stavke!.map(s => s.nabavnaCijena)).toEqual([13, 0.5]);
  expect(getProductStock(db, iv)).toBe(30);
  expect(getProductStock(db, kant)).toBe(80);
  const mv = db.prepare("SELECT * FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?").all(r.id) as any[];
  expect(mv.length).toBe(2);
  expect(mv.every(m => m.tip === 'izlaz')).toBe(true);

  // kasnija primka po drugoj cijeni ne mijenja završenu kalkulaciju
  primka(db, iv, 40, 20);
  expect(kalkulacijaNaloga(db, r.id).materijal).toBe(140);
  expect(() => replaceStavke(db, r.id, [])).toThrow('završen');
});

test('završetak naloga za zalihu knjiži i ulaz gotovog proizvoda', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 40, 13);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 3 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 6 }]);
  zavrsiNalog(db, r.id);
  expect(getProductStock(db, art)).toBe(3);
  expect(getProductStock(db, iv)).toBe(34);
  const ulaz = db.prepare("SELECT * FROM stock_movements WHERE productId = ? AND tip = 'ulaz'").get(art) as any;
  expect(ulaz.referenceType).toBe('radni_nalog');
  expect(ulaz.referenceId).toBe(r.id);
});

test('završetak ne blokira kad stanja nema, ali kalkulacija upozorava', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 2, 13);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 5 }]);
  expect(kalkulacijaNaloga(db, r.id).upozorenja).toEqual(['Materijal IV18: utrošak 5 prelazi stanje 2']);
  zavrsiNalog(db, r.id);
  expect(getProductStock(db, iv)).toBe(-3);
});

test('vraćanje u izradu briše knjiženja; ponovni završetak uzima novu prosječnu cijenu', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 10, 10);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 1 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2 }]);
  zavrsiNalog(db, r.id);

  vratiUIzradu(db, r.id);
  const n = getNalog(db, r.id);
  expect(n.status).toBe('u_izradi');
  expect(n.zavrsenAt).toBeNull();
  expect(n.stavke![0].nabavnaCijena).toBeNull();
  expect(getProductStock(db, iv)).toBe(10);
  expect(getProductStock(db, art)).toBe(0);

  primka(db, iv, 10, 20); // prosjek sad 15
  zavrsiNalog(db, r.id);
  expect(getNalog(db, r.id).stavke![0].nabavnaCijena).toBe(15);
  expect(getProductStock(db, iv)).toBe(18);
});

test('fakturisan nalog se ne može vratiti u izradu; fakturisiNalog samo za završenu narudžbu', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  expect(() => fakturisiNalog(db, r.id, 1)).toThrow('završen');
  zavrsiNalog(db, r.id);
  db.prepare("INSERT INTO orders (id, korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (55, 1, 100, 14.53, 'Gotovina', 'completed')").run();
  fakturisiNalog(db, r.id, 55);
  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(55);
  expect(() => vratiUIzradu(db, r.id)).toThrow('fakturisan');

  const art = dodajArtikal(db, 'A');
  const z = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 1 });
  replaceStavke(db, z.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, z.id);
  expect(() => fakturisiNalog(db, z.id, 55)).toThrow('narudžb');
});

// ── izdajRacunZaNalog ────────────────────────────────────

function printOk(broj = '91') {
  const calls: any[] = [];
  const print = async (racun: any) => {
    calls.push(racun);
    return { success: true, odgovori: { BrojFiskalnogRacuna: broj } } as any;
  };
  return { print, calls };
}
const printFail = async () => ({ success: false, error: 'Štampač ne odgovara', odgovori: {} } as any);
function deps(print: any) {
  return { db, print, transaction: (fn: any) => db.transaction(fn) };
}

test('osigurajProdajnuUslugu kreira uslugu NAMJ jednom', () => {
  const a = osigurajProdajnuUslugu(db);
  const b = osigurajProdajnuUslugu(db);
  expect(a).toBe(b);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(a) as any;
  expect(p.sifra).toBe(PRODAJNA_USLUGA.sifra);
  expect(p.tip).toBe('usluga');
  expect(p.pdvStopa).toBe('E');
});

test('samostalni nalog: račun sa jednom stavkom po dogovorenoj cijeni, nalog fakturisan', async () => {
  const k = dodajKupca(db, 'Mujić');
  const iv = dodajMaterijal(db, 'IV');
  primka(db, iv, 10, 10);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', dogovorenaCijena: 2340 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2 }]);
  zavrsiNalog(db, r.id);

  const { print, calls } = printOk('91');
  const res = await izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Kartica' });
  expect(res.success).toBe(true);
  expect(res.brojFiskalnogRacuna).toBe('91');

  expect(calls[0].stavke.length).toBe(1);
  expect(calls[0].stavke[0].artikal.naziv).toBe(PRODAJNA_USLUGA.naziv);
  expect(calls[0].stavke[0].artikal.cijena).toBe(2340);
  expect(calls[0].kupac.naziv).toBe('Mujić');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.racunId) as any;
  expect(order.ukupno).toBe(2340);
  expect(order.nacinPlacanja).toBe('Kartica');
  expect(order.kupacNaziv).toBe('Mujić');
  const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(res.racunId) as any[];
  expect(items.length).toBe(1);
  // usluga ne dira skladište
  expect(db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE referenceType = 'order'").get()).toEqual({ c: 0 });

  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(res.racunId);
  expect(n.racunBroj).toBe('91');
});

test('nalog bez dogovorene cijene ili nezavršen ne ide na štampu', async () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  const { print, calls } = printOk();
  await expect(izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' })).rejects.toThrow('završen');
  zavrsiNalog(db, r.id);
  await expect(izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' })).rejects.toThrow('Dogovorena cijena');
  expect(calls.length).toBe(0);
});

test('neuspjela štampa ne mijenja nalog ni bazu', async () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, r.id);
  const res = await izdajRacunZaNalog(deps(printFail), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' });
  expect(res.success).toBe(false);
  expect(db.prepare('SELECT COUNT(*) AS c FROM orders').get()).toEqual({ c: 0 });
  expect(getNalog(db, r.id).status).toBe('zavrsen');
});

test('nalog iz ponude: račun ide kroz konverziju ponude, nalog pokupi racunId', async () => {
  const k = dodajKupca(db);
  const a1 = dodajArtikal(db, 'KUH', 1000);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (7, 1, 2026, ?, 1, '2026-09-01', '2026-09-09', 'prihvacena', 1000, 145.30)`).run(k);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 1000, 0, 'E')").run(a1);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalogIzPonude(db, 7, 1);
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, r.id);

  const { print, calls } = printOk('92');
  const res = await izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' });
  expect(res.success).toBe(true);
  expect(calls[0].stavke[0].artikal.naziv).toBe('Proizvod KUH'); // stavke sa ponude, ne NAMJ
  const p = db.prepare('SELECT status, racunId FROM ponude WHERE id = 7').get() as any;
  expect(p.status).toBe('konvertovana');
  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(p.racunId);
});
