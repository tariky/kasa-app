// Integracija nad pravom SQLite bazom sa produkcijskom šemom (testnaBaza).
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import {
  collectPriceChanges, upisiCijene,
  cijeneArtikala, promjeneUProdaji, artikliPrimke, brojeviNivelacijaPrimke, napomenaProtunivelacije,
  revertPrimkaPrices, stareCijeneStavki, datumKretanjaPrimke,
  zapisiPromjeneCijena,
  isDobavljacUsed, istiPregled, validirajPrimku, TOLERANCIJA_ZALIHE,
} from './skladiste';
import { stanje } from './zaliha';
import type { PregledCijenaUlaza } from '../types';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
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

  upisiCijene(db, bezZaliha);
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

test('materijal nikad ne ide u nivelaciju ni u promjenu cijene', () => {
  const id = dodajArtikal('IV18', 0, 'materijal');
  dodajZalihu(id, 5);
  const { nivelacija, bezZaliha } = collectPriceChanges(db, [
    { productId: id, cijena: 12, pdvStopa: 'E' },
  ]);
  expect(nivelacija).toEqual([]);
  expect(bezZaliha).toEqual([]);
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

/** Nivelacija primke upisana SQL-om (kao stara verzija, bez historije cijena). */
function dodajNivelaciju(primkaId: number, productId: number, stara: number, nova: number, naPrimci = true): void {
  db.prepare("INSERT INTO primke (id, brojPrimke, datum) VALUES (?, ?, '2026-01-01') ON CONFLICT DO NOTHING")
    .run(primkaId, `U-${primkaId}`);
  if (naPrimci) {
    db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, ?, 'E')").run(primkaId, productId, nova);
  }
  const niv = db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, '2026-01-01', ?)")
    .run(`NIV-${primkaId}-${productId}`, primkaId);
  db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, ?, ?, ?, ?, 'E')")
    .run(Number(niv.lastInsertRowid), productId, stara, nova, nova - stara, nova - stara);
}

// ── Protunivelacija: promjene cijene u prodaji ─────────────────────────

test('promjeneUProdaji: razlika od snimka do trenutne cijene, na trenutnoj zalihi', () => {
  const sa = dodajArtikal('040', 12);
  const bez = dodajArtikal('041', 12);
  const ista = dodajArtikal('042', 12);
  const mat = dodajArtikal('043', 12, 'materijal');
  for (const id of [sa, ista, mat]) dodajZalihu(id, 4);
  const prije = cijeneArtikala(db, [sa, bez, ista, mat, sa]);
  expect([...prije]).toEqual([[sa, 12], [bez, 12], [ista, 12], [mat, 12]]);

  db.prepare('UPDATE products SET cijena = 10 WHERE id IN (?, ?, ?)').run(sa, bez, mat);
  expect(promjeneUProdaji(db, prije)).toEqual([
    { productId: sa, kolicina: 4, staraCijena: 12, novaCijena: 10, pdvStopa: 'E' },
  ]);
});

test('artikliPrimke: stavke i artikli iz historije primke, bez duplikata', () => {
  const a = dodajArtikal('050', 10);
  const b2 = dodajArtikal('051', 10);
  dodajStavku(1, a, 12, null);
  dodajStavku(1, a, 13, null);
  zapisiPromjeneCijena(db, 'primka', 1, [{ productId: b2, staraCijena: 10, novaCijena: 11 }]);
  zapisiPromjeneCijena(db, 'primka', 2, [{ productId: a, staraCijena: 10, novaCijena: 11 }]);
  expect(artikliPrimke(db, 1).sort()).toEqual([a, b2].sort());
});

test('brojeviNivelacijaPrimke i napomena protunivelacije', () => {
  const a = dodajArtikal('060', 12);
  const c = dodajArtikal('061', 12);
  dodajNivelaciju(1, a, 10, 12);
  dodajNivelaciju(1, c, 10, 12);
  dodajNivelaciju(2, a, 12, 14);
  expect(brojeviNivelacijaPrimke(db, 1, [a])).toEqual(['NIV-1-' + a]);
  expect(brojeviNivelacijaPrimke(db, 1, [a, c])).toEqual(['NIV-1-' + a, 'NIV-1-' + c]);
  expect(brojeviNivelacijaPrimke(db, 1, [])).toEqual([]);
  expect(napomenaProtunivelacije('Poništenje primke U-5', ['NIV-2026-003'])).toBe('Poništenje primke U-5 (NIV-2026-003)');
  expect(napomenaProtunivelacije('Poništenje primke U-5', [])).toBe('Poništenje primke U-5');
});

// ── Stara cijena artikla bez zalihe (primka_stavke.staraCijena) ────────

function dodajStavku(primkaId: number, productId: number, cijena: number, staraCijena: number | null): void {
  db.prepare("INSERT INTO primke (id, brojPrimke, datum) VALUES (?, ?, '2026-01-01') ON CONFLICT DO NOTHING")
    .run(primkaId, `U-${primkaId}`);
  db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa, staraCijena) VALUES (?, ?, 1, ?, 'E', ?)")
    .run(primkaId, productId, cijena, staraCijena);
}

function cijenaArtikla(id: number): number {
  return (db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number }).cijena;
}

test('stareCijeneStavki: stara cijena ide samo na prvu stavku artikla bez zalihe', () => {
  const bez = dodajArtikal('020', 10);
  const sa = dodajArtikal('021', 20);
  dodajZalihu(sa, 3);
  const stavke = [
    { productId: bez, cijena: 12, pdvStopa: 'E' },
    { productId: sa, cijena: 25, pdvStopa: 'E' },
    { productId: bez, cijena: 13, pdvStopa: 'E' },
  ];
  const { bezZaliha } = collectPriceChanges(db, stavke);

  expect(stareCijeneStavki(stavke, bezZaliha)).toEqual([10, null, null]);
  expect(stareCijeneStavki(stavke, [])).toEqual([null, null, null]);
});

test('revertPrimkaPrices vraća i nivelaciju i cijene bez zalihe iste primke', () => {
  const sa = dodajArtikal('025', 15);
  const bez = dodajArtikal('026', 7);
  dodajNivelaciju(1, sa, 12, 15);
  dodajStavku(1, bez, 7, 5);

  expect(revertPrimkaPrices(db, 1)).toBe(2);
  expect(cijenaArtikla(sa)).toBe(12);
  expect(cijenaArtikla(bez)).toBe(5);
});

// ── Historija cijena (cijena_historija) ────────────────────────────────

/** Lanac promjena cijena (ono po čemu se poništava) — bez poništenih redova koji ostaju samo za izvoz. */
function historija(productId: number): Array<{ izvor: string; izvorId: number | null; staraCijena: number; novaCijena: number }> {
  return db.prepare('SELECT izvor, izvorId, staraCijena, novaCijena FROM cijena_historija WHERE productId = ? AND ponistena = 0 ORDER BY id')
    .all(productId) as any;
}

test('revertPrimkaPrices: artikal iz historije ne ide i starim putem (nivelacija)', () => {
  const id = dodajArtikal('033', 14);
  dodajNivelaciju(1, id, 10, 12);
  zapisiPromjeneCijena(db, 'primka', 1, [{ productId: id, staraCijena: 10, novaCijena: 12 }]);
  zapisiPromjeneCijena(db, 'primka', 2, [{ productId: id, staraCijena: 12, novaCijena: 14 }]);

  revertPrimkaPrices(db, 1);
  expect(cijenaArtikla(id)).toBe(14);
  expect(historija(id)[0].staraCijena).toBe(10);
});

// ── Tolerancija zalihe ────────────────────────────────────────────────

function dodajIzlaz(productId: number, kolicina: number): void {
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'test', 0)")
    .run(productId, kolicina);
}

test('ostatak zaokruživanja (0,1 + 0,2 − 0,3) je prazna zaliha: nema nivelacije, cijena ide bez dokumenta', () => {
  expect(TOLERANCIJA_ZALIHE).toBe(1e-9);
  const id = dodajArtikal('037', 10);
  dodajZalihu(id, 0.1); dodajZalihu(id, 0.2); dodajIzlaz(id, 0.3);
  expect(stanje(db, id)).not.toBe(0);
  expect(Math.abs(stanje(db, id))).toBeLessThan(TOLERANCIJA_ZALIHE);

  const { nivelacija, bezZaliha } = collectPriceChanges(db, [{ productId: id, cijena: 12, pdvStopa: 'E' }]);
  expect(nivelacija).toEqual([]);
  expect(bezZaliha.map(c => c.productId)).toEqual([id]);

  upisiCijene(db, bezZaliha);
  expect(promjeneUProdaji(db, new Map([[id, 10]]))).toEqual([]);
});

// ── validirajPrimku ───────────────────────────────────────────────────

test('validirajPrimku: količina i cijene stavke moraju biti ispravni brojevi', () => {
  const id = dodajArtikal('038', 10);
  const s = { productId: id, kolicina: 2, cijena: 12, nabavnaCijena: 5 };
  const probaj = (x: Record<string, unknown>) => () => validirajPrimku(db, { brojPrimke: 'U-1', stavke: [{ ...s, ...x }] as any });

  expect(probaj({})()).toBe('U-1');
  expect(probaj({ cijena: 0, nabavnaCijena: 0 })()).toBe('U-1');
  for (const kolicina of [0, -1, NaN, Infinity, '2', null, undefined]) {
    expect(probaj({ kolicina })).toThrow('Količina za "Artikal 038" mora biti veća od nule');
  }
  for (const cijena of [-0.01, NaN, Infinity, '12', null, undefined]) {
    expect(probaj({ cijena })).toThrow('Prodajna cijena za "Artikal 038" nije ispravna');
  }
  for (const nabavnaCijena of [-1, NaN, -Infinity, '5', null, undefined]) {
    expect(probaj({ nabavnaCijena })).toThrow('Nabavna cijena za "Artikal 038" nije ispravna');
  }
});

test('validirajPrimku: usluga i slobodna stavka ne idu na ulaz robe', () => {
  const usluga = dodajArtikal('039', 10, 'usluga');
  const slobodan = dodajArtikal('040', 10);
  db.prepare('UPDATE products SET slobodan = 1 WHERE id = ?').run(slobodan);
  const stavke = (productId: number) => [{ productId, kolicina: 1, cijena: 10, nabavnaCijena: 5 }];

  expect(() => validirajPrimku(db, { brojPrimke: 'U-1', stavke: stavke(usluga) })).toThrow('"Artikal 039" je usluga i ne ide na ulaz robe');
  expect(() => validirajPrimku(db, { brojPrimke: 'U-1', stavke: stavke(slobodan) })).toThrow('"Artikal 040" je slobodna stavka i ne ide na ulaz robe');
});

test('datumKretanjaPrimke: datum primke u formatu kretanja zalihe (ponoć)', () => {
  expect(datumKretanjaPrimke('2026-03-10')).toBe('2026-03-10 00:00:00');
  // Ako datum već nosi vrijeme, ostaje kakav jeste.
  expect(datumKretanjaPrimke('2026-03-10 14:20:00')).toBe('2026-03-10 14:20:00');
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

// ── Otisak potvrđenog pregleda ─────────────────────────────────────────

const pregledPrimjer = () => ({
  dokumenti: [{ vrsta: 'nivelacija' as const, brojNivelacije: 'NIV-2026-001', datum: '2026-05-12', napomena: null, stavke: [
    { productId: 2, productNaziv: 'B', kolicina: 1.5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 3 },
    { productId: 1, productNaziv: 'A', kolicina: 5, staraCijena: 1, novaCijena: 1.1, razlika: 0.1, ukupnaRazlika: 0.5 },
  ] }],
  bezZalihe: [{ productId: 3, productNaziv: 'C', staraCijena: 20, novaCijena: 25 }],
  cijenaOstaje: [],
  upozorenja: [{ vrsta: 'minus' as const, productId: 1, productNaziv: 'A', stanjePrije: 2, stanjePoslije: -8 }],
});

test('otisak: isti sadržaj s drugim nazivom, redom stavki i šumom zaokruživanja je isti', () => {
  const b = pregledPrimjer();
  b.dokumenti[0].stavke.reverse();
  b.dokumenti[0].stavke[0].productNaziv = 'Drugi naziv';
  b.dokumenti[0].stavke[0].razlika = 0.1 + 1e-12;
  expect(istiPregled(b, pregledPrimjer())).toBe(true);
});

test('otisak: svako polje dokumenta je u poređenju', () => {
  const izmjene: Array<(p: ReturnType<typeof pregledPrimjer>) => void> = [
    p => { (p.dokumenti[0] as any).vrsta = 'protunivelacija'; },
    p => { p.dokumenti[0].brojNivelacije = 'NIV-2026-002'; },
    p => { p.dokumenti[0].datum = '2026-05-13'; },
    p => { (p.dokumenti[0] as any).napomena = 'x'; },
    p => { p.dokumenti[0].stavke[0].kolicina = 2; },
    p => { p.dokumenti[0].stavke[0].staraCijena = 11; },
    p => { p.dokumenti[0].stavke[0].novaCijena = 13; },
    p => { p.dokumenti[0].stavke[0].ukupnaRazlika = 4; },
    p => { p.dokumenti[0].stavke[0].productId = 9; },
    p => { p.dokumenti = []; },
    p => { p.bezZalihe[0].novaCijena = 26; },
    p => { p.bezZalihe = []; },
    p => { (p.cijenaOstaje as any) = [{ productId: 4, productNaziv: 'D', cijena: 1 }]; },
    p => { (p.upozorenja[0] as any).vrsta = 'prodano'; },
    p => { p.upozorenja[0].productId = 2; },
    p => { p.upozorenja[0].stanjePrije = 3; },
    p => { p.upozorenja[0].stanjePoslije = -7; },
    p => { p.upozorenja = []; },
  ];
  for (const izmijeni of izmjene) {
    const p = pregledPrimjer();
    izmijeni(p);
    expect(istiPregled(p, pregledPrimjer())).toBe(false);
  }
});

test('otisak: neispravan oblik nije nikad isti', () => {
  // Neispravan oblik nema otisak, pa nije isti ni sam sebi.
  const nijeIstiSebi = (p: unknown) => istiPregled(p, p as PregledCijenaUlaza);
  expect(nijeIstiSebi(null)).toBe(false);
  expect(nijeIstiSebi({})).toBe(false);
  expect(nijeIstiSebi({ dokumenti: [], bezZalihe: [], cijenaOstaje: [{ productId: 1, cijena: 'x' }], upozorenja: [] })).toBe(false);
  expect(istiPregled({}, pregledPrimjer())).toBe(false);
  expect(istiPregled(pregledPrimjer(), pregledPrimjer())).toBe(true);
  // Pregled bez upozorenja (stari oblik) nije potvrda ničega.
  const bezUpozorenja: Partial<ReturnType<typeof pregledPrimjer>> = pregledPrimjer();
  delete bezUpozorenja.upozorenja;
  expect(nijeIstiSebi(bezUpozorenja)).toBe(false);
});
