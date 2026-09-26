// Orkestracija primke (lib/primka.ts) nad pravom SQLite bazom sa
// produkcijskom šemom — obrazac iz skladiste.test.ts (bun:sqlite, isti SQL).
// Ugovor oba backenda (src/ipc/ugovor/skladiste.ugovor.test.ts) pokriva kanale;
// ovdje je modul sam, s audit-om u istoj bazi.
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { napraviPrimke, upisiNivelaciju, type PrimkaUnos } from './primka';
import { zapisiPromjeneCijena } from './skladiste';
import { zapisiAudit } from './audit';
import { localDateStr } from './novac';
import type { PregledCijenaUlaza, PromijenjenoOdPregleda } from '../types';

let db: TestnaBaza;
let primke: ReturnType<typeof napraviPrimke>;

beforeEach(() => {
  db = testnaBaza();
  primke = napraviPrimke({
    db,
    audit: (akcija, detalji) => zapisiAudit(db, 1, akcija, detalji),
    transaction: fn => db.transaction(fn),
  });
});

// ── Pomoćne ───────────────────────────────────────────────────────────

function dodajArtikal(sifra: string, cijena: number, opts: { tip?: string; stanje?: number } = {}): number {
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, ?, 'E', ?)")
    .run(sifra, `Artikal ${sifra}`, cijena, opts.tip ?? 'artikal');
  const id = Number(r.lastInsertRowid);
  if (opts.stanje) kretanje(id, 'ulaz', opts.stanje);
  return id;
}

function kretanje(productId: number, tip: 'ulaz' | 'izlaz', kolicina: number): void {
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, ?, ?, 'test', 0)")
    .run(productId, tip, kolicina);
}

function red(sql: string, ...params: unknown[]): any {
  return db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: unknown[]): any[] {
  return db.prepare(sql).all(...params);
}

function cijena(productId: number): number {
  return red('SELECT cijena FROM products WHERE id = ?', productId).cijena;
}

function stanje(productId: number): number {
  return red("SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s FROM stock_movements WHERE productId = ?", productId).s;
}

function stavka(productId: number, kolicina: number, cijena: number) {
  return { productId, kolicina, cijena, nabavnaCijena: 5, rabat: 0, pdvStopa: 'E' };
}

function unos(brojPrimke: string, stavke: PrimkaUnos['stavke']): PrimkaUnos {
  return { brojPrimke, datum: '2026-03-10', stavke };
}

/** Broj nivelacije tekuće godine: niv(3) → 'NIV-2026-003'. */
function niv(n: number): string {
  return `NIV-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`;
}

/** Sve nivelacije redom sa stavkama (dokument se nikad ne briše). */
function nivelacije() {
  return redovi('SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije ORDER BY id').map(n => ({
    broj: n.brojNivelacije, datum: n.datum, primkaId: n.primkaId, napomena: n.napomena,
    stavke: redovi('SELECT productId, kolicina, staraCijena AS stara, novaCijena AS nova, ukupnaRazlika AS ukupno FROM nivelacija_stavke WHERE nivelacijaId = ? ORDER BY id', n.id),
  }));
}

/** Nivelacije nastale poslije `zadnja` u obliku `PregledCijenaUlaza['dokumenti']`. */
function dokumentiPoslije(zadnja: number): PregledCijenaUlaza['dokumenti'] {
  return redovi('SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije WHERE id > ? ORDER BY id', zadnja).map(n => ({
    vrsta: n.primkaId === null ? 'protunivelacija' : 'nivelacija',
    brojNivelacije: n.brojNivelacije, datum: n.datum, napomena: n.napomena,
    stavke: redovi(`
      SELECT ns.productId, p.naziv AS productNaziv, ns.kolicina, ns.staraCijena, ns.novaCijena, ns.razlika, ns.ukupnaRazlika
      FROM nivelacija_stavke ns JOIN products p ON p.id = ns.productId
      WHERE ns.nivelacijaId = ? ORDER BY ns.id
    `, n.id),
  }));
}

/** Sve tabele (i sqlite_sequence — brojači id-eva) redom po rowid. */
function snimakBaze(): Record<string, unknown[]> {
  const tabele = redovi("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(t => t.name as string);
  return Object.fromEntries(tabele.map(t => [t, redovi(`SELECT * FROM "${t}" ORDER BY rowid`)]));
}

function audit(): Array<{ akcija: string; detalji: Record<string, unknown> }> {
  return redovi('SELECT akcija, detalji FROM audit_log ORDER BY id').map(r => ({ akcija: r.akcija, detalji: JSON.parse(r.detalji) }));
}

/** Historija cijena artikla — svi redovi, i poništeni (ono što čita izvoz). */
function historija(productId: number) {
  return redovi('SELECT izvor, izvorId, staraCijena, novaCijena, ponistena FROM cijena_historija WHERE productId = ? ORDER BY id', productId);
}

/** Stara primka (prije historije cijena): stavke, ulaz i nivelacija upisani SQL-om kao starom verzijom. */
function staraPrimka(brojPrimke: string, stavke: Array<{ productId: number; cijena: number; staraCijena?: number | null; nivelacija?: [number, number] }>): number {
  const id = Number(db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES (?, '2025-01-10')").run(brojPrimke).lastInsertRowid);
  for (const s of stavke) {
    db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa, staraCijena) VALUES (?, ?, 1, ?, 'E', ?)")
      .run(id, s.productId, s.cijena, s.staraCijena ?? null);
    if (s.nivelacija) {
      const [stara, nova] = s.nivelacija;
      const n = Number(db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, '2025-01-10', ?)")
        .run(`NIV-OLD-${brojPrimke}-${s.productId}`, id).lastInsertRowid);
      db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, ?, ?, ?, ?, 'E')")
        .run(n, s.productId, stara, nova, nova - stara, nova - stara);
    }
  }
  return id;
}

const jePromijenjeno = (r: unknown): r is PromijenjenoOdPregleda =>
  typeof r === 'object' && r !== null && (r as PromijenjenoOdPregleda).promijenjeno === true;

// ── Unos ──────────────────────────────────────────────────────────────

test('unos s promjenom prodajne cijene pravi nivelaciju i historiju cijena', () => {
  const sa = dodajArtikal('001', 10, { stanje: 5 });
  const bez = dodajArtikal('002', 20);

  const r = primke.unesi(unos('U-1', [stavka(sa, 2, 12), stavka(bez, 1, 25)]));
  expect(jePromijenjeno(r)).toBe(false);
  const { id } = r as { id: number; nivelacijaCreated: boolean };
  expect(r).toEqual({ id, nivelacijaCreated: true });

  expect(cijena(sa)).toBe(12);
  expect(cijena(bez)).toBe(25);
  // Nivelacija samo za artikal sa zalihom, na zalihi prije ulaza, s današnjim datumom.
  expect(nivelacije()).toEqual([
    { broj: niv(1), datum: localDateStr(), primkaId: id, napomena: null, stavke: [{ productId: sa, kolicina: 5, stara: 10, nova: 12, ukupno: 10 }] },
  ]);
  expect(historija(sa)).toEqual([{ izvor: 'primka', izvorId: id, staraCijena: 10, novaCijena: 12, ponistena: 0 }]);
  expect(historija(bez)).toEqual([{ izvor: 'primka', izvorId: id, staraCijena: 20, novaCijena: 25, ponistena: 0 }]);
  // Artikal bez zalihe pamti staru cijenu na stavci; ulaz nosi datum primke.
  expect(redovi('SELECT productId, staraCijena FROM primka_stavke WHERE primkaId = ? ORDER BY id', id))
    .toEqual([{ productId: sa, staraCijena: null }, { productId: bez, staraCijena: 20 }]);
  expect(redovi("SELECT productId, kolicina, createdAt FROM stock_movements WHERE referenceType = 'primka' ORDER BY id"))
    .toEqual([{ productId: sa, kolicina: 2, createdAt: '2026-03-10 00:00:00' }, { productId: bez, kolicina: 1, createdAt: '2026-03-10 00:00:00' }]);
  expect(audit()).toEqual([
    { akcija: 'artikal:cijena', detalji: { productId: sa, staraCijena: 10, novaCijena: 12, izvor: 'primka', primkaId: id } },
    { akcija: 'artikal:cijena', detalji: { productId: bez, staraCijena: 20, novaCijena: 25, izvor: 'primka', primkaId: id } },
  ]);
});

test('pregledUnosa ne upisuje ništa (ni primku, ni nivelaciju, ni audit) i najavljuje tačno ono što unesi napravi', () => {
  const sa = dodajArtikal('003', 10, { stanje: 5 });
  const bez = dodajArtikal('004', 20);
  const data = unos('U-1', [stavka(sa, 2, 12), stavka(bez, 1, 25)]);

  const snimak = snimakBaze();
  const pregled = primke.pregledUnosa(data);
  expect(snimakBaze()).toEqual(snimak);
  expect(primke.pregledUnosa(data)).toEqual(pregled);
  expect(pregled).toEqual({
    dokumenti: [{
      vrsta: 'nivelacija', brojNivelacije: niv(1), datum: localDateStr(), napomena: null,
      stavke: [{ productId: sa, productNaziv: 'Artikal 003', kolicina: 5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 10 }],
    }],
    bezZalihe: [{ productId: bez, productNaziv: 'Artikal 004', staraCijena: 20, novaCijena: 25 }],
    cijenaOstaje: [],
    upozorenja: [],
  });

  // Spremanje s potvrđenim pregledom: stanje isto → upisano, dokumenti kao u pregledu.
  const r = primke.unesi(data, pregled);
  expect(jePromijenjeno(r)).toBe(false);
  expect(r).toEqual({ id: expect.any(Number), nivelacijaCreated: true });
  expect(dokumentiPoslije(0)).toEqual(pregled.dokumenti);
  expect(cijena(bez)).toBe(25);
  expect(audit().map(a => a.akcija)).toEqual(['artikal:cijena', 'artikal:cijena']);
});

test('unesi s potvrdom koja ne odgovara stanju vraća PromijenjenoOdPregleda i ništa ne upisuje', () => {
  const sa = dodajArtikal('005', 10, { stanje: 5 });
  const data = unos('U-1', [stavka(sa, 2, 12)]);
  const pregled = primke.pregledUnosa(data);

  // Prodaja između pregleda i spremanja: nivelacija bi sada išla na 4 komada.
  kretanje(sa, 'izlaz', 1);
  const snimak = snimakBaze();
  const r = primke.unesi(data, pregled);
  expect(jePromijenjeno(r)).toBe(true);
  const novi = (r as PromijenjenoOdPregleda).pregled;
  expect(novi.dokumenti[0].stavke[0]).toMatchObject({ productId: sa, kolicina: 4, staraCijena: 10, novaCijena: 12 });
  expect(snimakBaze()).toEqual(snimak);

  // Ponovna potvrda novog pregleda → upisano.
  const r2 = primke.unesi(data, novi);
  expect(jePromijenjeno(r2)).toBe(false);
  expect(dokumentiPoslije(0)).toEqual(novi.dokumenti);

  // Neispravan oblik potvrde nije potvrda ničega.
  expect(jePromijenjeno(primke.unesi(unos('U-2', [stavka(sa, 1, 12)]), {}))).toBe(true);
  expect(red('SELECT COUNT(*) AS n FROM primke').n).toBe(1);
});

test('greška usred operacije poništi sve — i bez potvrde, i s potvrdom, i u pregledu', () => {
  const sa = dodajArtikal('006', 10, { stanje: 5 });
  // pdvStopa null prolazi validaciju, a pada tek na upisu stavke (NOT NULL) —
  // poslije upisa zaglavlja primke.
  const data = unos('U-1', [{ ...stavka(sa, 2, 12), pdvStopa: null as unknown as string }]);
  const snimak = snimakBaze();

  expect(() => primke.unesi(data)).toThrow(/NOT NULL/);
  expect(snimakBaze()).toEqual(snimak);
  expect(() => primke.unesi(data, { dokumenti: [], bezZalihe: [], cijenaOstaje: [], upozorenja: [] })).toThrow(/NOT NULL/);
  expect(snimakBaze()).toEqual(snimak);
  expect(() => primke.pregledUnosa(data)).toThrow(/NOT NULL/);
  expect(snimakBaze()).toEqual(snimak);

  // Validacija: ista poruka iz pregleda i iz spremanja.
  expect(() => primke.pregledUnosa(unos(' ', [stavka(sa, 1, 12)]))).toThrow('Broj primke je obavezan');
  expect(() => primke.unesi(unos(' ', [stavka(sa, 1, 12)]))).toThrow('Broj primke je obavezan');
});

test('materijal nikad ne ide u nivelaciju ni u promjenu cijene', () => {
  const mat = dodajArtikal('IV18', 0, { tip: 'materijal', stanje: 5 });

  const pregled = primke.pregledUnosa(unos('U-1', [stavka(mat, 2, 12)]));
  expect(pregled).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [], upozorenja: [] });

  const r = primke.unesi(unos('U-1', [stavka(mat, 2, 12)]), pregled) as { id: number; nivelacijaCreated: boolean };
  expect(r.nivelacijaCreated).toBe(false);
  expect(cijena(mat)).toBe(0);
  expect(stanje(mat)).toBe(7);
  expect(nivelacije()).toEqual([]);
  expect(historija(mat)).toEqual([]);
  expect(audit()).toEqual([]);

  // Ni izmjena ni brisanje ne pravi dokument za materijal.
  primke.izmijeni({ id: r.id, ...unos('U-1', [stavka(mat, 3, 15)]) });
  expect(cijena(mat)).toBe(0);
  primke.obrisi(r.id);
  expect(cijena(mat)).toBe(0);
  expect(stanje(mat)).toBe(5);
  expect(nivelacije()).toEqual([]);
});

// ── Izmjena ───────────────────────────────────────────────────────────

test('izmjena primke: nova cijena ide nivelacijom od cijene u prodaji, uklonjena stavka protunivelacijom', () => {
  const a = dodajArtikal('010', 10, { stanje: 4 });
  const bArt = dodajArtikal('011', 20, { stanje: 3 });
  const { id } = primke.unesi(unos('U-1', [stavka(a, 2, 12), stavka(bArt, 1, 25)])) as { id: number };
  expect(nivelacije()).toHaveLength(1);

  const izmjena = { id, ...unos('U-1', [stavka(a, 2, 15)]) };
  const snimak = snimakBaze();
  const pregled = primke.pregledIzmjene(izmjena);
  expect(snimakBaze()).toEqual(snimak);

  const r = primke.izmijeni(izmjena, pregled);
  expect(r).toEqual({ id, nivelacijaCreated: true });
  expect(cijena(a)).toBe(15);
  expect(cijena(bArt)).toBe(20);
  expect(dokumentiPoslije(1)).toEqual(pregled.dokumenti);
  expect(nivelacije()).toEqual([
    // Stara nivelacija ostaje netaknuta — po njoj se prodavalo.
    { broj: niv(1), datum: localDateStr(), primkaId: id, napomena: null, stavke: [
      { productId: a, kolicina: 4, stara: 10, nova: 12, ukupno: 8 },
      { productId: bArt, kolicina: 3, stara: 20, nova: 25, ukupno: 15 },
    ] },
    // 12 → 15 (cijena koja je bila u prodaji), ne 10 → 15.
    { broj: niv(2), datum: localDateStr(), primkaId: id, napomena: 'Izmjena primke U-1', stavke: [{ productId: a, kolicina: 4, stara: 12, nova: 15, ukupno: 12 }] },
    // Protunivelacija bez veze na primku, s tragom nivelacije čiju cijenu poništava.
    { broj: niv(3), datum: localDateStr(), primkaId: null, napomena: `Izmjena primke U-1: poništenje cijene (${niv(1)})`, stavke: [{ productId: bArt, kolicina: 3, stara: 25, nova: 20, ukupno: -15 }] },
  ]);
  expect(stanje(a)).toBe(6);
  expect(stanje(bArt)).toBe(3);
  expect(audit().slice(2)).toEqual([
    { akcija: 'artikal:cijena', detalji: { productId: a, staraCijena: 12, novaCijena: 15, izvor: 'primka:izmjena', primkaId: id } },
    { akcija: 'artikal:cijena', detalji: { productId: bArt, staraCijena: 25, novaCijena: 20, izvor: 'primka:izmjena', primkaId: id } },
  ]);
});

test('izmjena samo količine ne dira cijene, historiju ni nivelacije; pregled je prazan', () => {
  const a = dodajArtikal('012', 10, { stanje: 4 });
  const { id } = primke.unesi(unos('U-1', [stavka(a, 2, 12)])) as { id: number };
  const prije = { nivelacije: nivelacije(), historija: historija(a) };

  const izmjena = { id, ...unos('U-1', [stavka(a, 5, 12)]) };
  expect(primke.pregledIzmjene(izmjena)).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [], upozorenja: [] });
  expect(primke.izmijeni(izmjena)).toEqual({ id, nivelacijaCreated: false });
  expect({ nivelacije: nivelacije(), historija: historija(a) }).toEqual(prije);
  expect(stanje(a)).toBe(9);
});

test('izmjena cijene koju je poslije primke mijenjala ručna izmjena: cijena ostaje (cijenaOstaje)', () => {
  const a = dodajArtikal('013', 10);
  const { id } = primke.unesi(unos('U-1', [stavka(a, 2, 12)])) as { id: number };
  db.prepare('UPDATE products SET cijena = 13 WHERE id = ?').run(a);
  zapisiPromjeneCijena(db, 'rucno', null, [{ productId: a, staraCijena: 12, novaCijena: 13 }]);

  const izmjena = { id, ...unos('U-1', [stavka(a, 2, 15)]) };
  const pregled = primke.pregledIzmjene(izmjena);
  expect(pregled.cijenaOstaje).toEqual([{ productId: a, productNaziv: 'Artikal 013', cijena: 13 }]);
  expect(primke.izmijeni(izmjena, pregled)).toEqual({ id, nivelacijaCreated: false });
  expect(cijena(a)).toBe(13);
});

// ── Brisanje ──────────────────────────────────────────────────────────

test('brisanje primke vraća cijene: protunivelacija za zalihu koja ostaje, bez dokumenta za artikal bez zalihe', () => {
  const sa = dodajArtikal('020', 10, { stanje: 4 });
  const bez = dodajArtikal('021', 20);
  const { id } = primke.unesi(unos('U-1', [stavka(sa, 2, 12), stavka(bez, 1, 25)])) as { id: number };

  const snimak = snimakBaze();
  const pregled = primke.pregledBrisanja(id);
  expect(snimakBaze()).toEqual(snimak);
  expect(pregled.bezZalihe).toEqual([{ productId: bez, productNaziv: 'Artikal 021', staraCijena: 25, novaCijena: 20 }]);

  // Uspjeh bez povratne vrijednosti (kao kanal primka:delete).
  expect(primke.obrisi(id, pregled)).toBeUndefined();
  expect(cijena(sa)).toBe(10);
  expect(cijena(bez)).toBe(20);
  expect(stanje(sa)).toBe(4);
  expect(stanje(bez)).toBe(0);
  expect(red('SELECT COUNT(*) AS n FROM primke').n).toBe(0);
  expect(red('SELECT COUNT(*) AS n FROM primka_stavke').n).toBe(0);
  expect(dokumentiPoslije(1)).toEqual(pregled.dokumenti);
  expect(nivelacije()).toEqual([
    { broj: niv(1), datum: localDateStr(), primkaId: null, napomena: `Primka U-1 obrisana; cijena vraćena nivelacijom ${niv(2)}`, stavke: [{ productId: sa, kolicina: 4, stara: 10, nova: 12, ukupno: 8 }] },
    { broj: niv(2), datum: localDateStr(), primkaId: null, napomena: `Poništenje primke U-1 (${niv(1)})`, stavke: [{ productId: sa, kolicina: 4, stara: 12, nova: 10, ukupno: -8 }] },
  ]);
  expect(audit().slice(2)).toEqual([
    { akcija: 'artikal:cijena', detalji: { productId: sa, staraCijena: 12, novaCijena: 10, izvor: 'primka:brisanje', primkaId: id } },
    { akcija: 'artikal:cijena', detalji: { productId: bez, staraCijena: 25, novaCijena: 20, izvor: 'primka:brisanje', primkaId: id } },
  ]);
});

test('brisanje: prodaja poslije pregleda → PromijenjenoOdPregleda, primka ostaje; nepostojeća primka se tiho ignoriše', () => {
  const sa = dodajArtikal('022', 10, { stanje: 4 });
  const { id } = primke.unesi(unos('U-1', [stavka(sa, 2, 12)])) as { id: number };
  const pregled = primke.pregledBrisanja(id);

  kretanje(sa, 'izlaz', 1);
  const snimak = snimakBaze();
  const r = primke.obrisi(id, pregled);
  expect(jePromijenjeno(r)).toBe(true);
  expect(snimakBaze()).toEqual(snimak);
  expect(primke.obrisi(id, (r as PromijenjenoOdPregleda).pregled)).toBeUndefined();
  expect(red('SELECT COUNT(*) AS n FROM primke').n).toBe(0);

  expect(primke.pregledBrisanja(999)).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [], upozorenja: [] });
  expect(primke.obrisi(999)).toBeUndefined();
});

// ── Lanac promjena cijena (historija) ─────────────────────────────────

test('lanac A, B: brisanje A premošćuje historiju (B preuzima staru cijenu), brisanje B vraća prvobitnu s poništenim tragom', () => {
  const p = dodajArtikal('030', 10);
  const a = (primke.unesi(unos('U-A', [stavka(p, 1, 12)])) as { id: number }).id;
  kretanje(p, 'izlaz', 1);
  const bId = (primke.unesi(unos('U-B', [stavka(p, 1, 14)])) as { id: number }).id;
  kretanje(p, 'izlaz', 1);

  primke.obrisi(a);
  expect(cijena(p)).toBe(14);
  // Poništen red ostaje (izvoz zna koja je cijena tada važila); cijena se ne mijenja, pa nema traga vraćanja.
  expect(historija(p)).toEqual([
    { izvor: 'primka', izvorId: a, staraCijena: 10, novaCijena: 12, ponistena: 1 },
    { izvor: 'primka', izvorId: bId, staraCijena: 10, novaCijena: 14, ponistena: 0 },
  ]);

  primke.obrisi(bId);
  expect(cijena(p)).toBe(10);
  expect(historija(p).slice(1)).toEqual([
    { izvor: 'primka', izvorId: bId, staraCijena: 10, novaCijena: 14, ponistena: 1 },
    { izvor: 'primka', izvorId: bId, staraCijena: 14, novaCijena: 10, ponistena: 1 },
  ]);
});

test('ručna izmjena poslije primke preuzima njenu staru cijenu i ostaje; cijena promijenjena mimo historije se ne gazi', () => {
  const p = dodajArtikal('031', 10);
  const a = (primke.unesi(unos('U-A', [stavka(p, 1, 12)])) as { id: number }).id;
  kretanje(p, 'izlaz', 1);
  db.prepare('UPDATE products SET cijena = 13 WHERE id = ?').run(p);
  zapisiPromjeneCijena(db, 'rucno', null, [{ productId: p, staraCijena: 12, novaCijena: 13 }]);

  primke.obrisi(a);
  expect(cijena(p)).toBe(13);
  expect(historija(p).filter(h => h.ponistena === 0)).toEqual([{ izvor: 'rucno', izvorId: null, staraCijena: 10, novaCijena: 13, ponistena: 0 }]);

  // Mimo historije (npr. stara verzija): primka je zadnja u lancu, ali artikal ne stoji na njenoj cijeni.
  const q = dodajArtikal('032', 10);
  const c = (primke.unesi(unos('U-C', [stavka(q, 1, 12)])) as { id: number }).id;
  kretanje(q, 'izlaz', 1);
  db.prepare('UPDATE products SET cijena = 13 WHERE id = ?').run(q);
  primke.obrisi(c);
  expect(cijena(q)).toBe(13);
  // Cijena se ne vraća, pa nema ni traga vraćanja; promjena primke je ipak poništena (izlazi iz lanca).
  expect(historija(q)).toEqual([{ izvor: 'primka', izvorId: c, staraCijena: 10, novaCijena: 12, ponistena: 1 }]);
});

// ── Stare primke (prije historije cijena) — stari put ─────────────────

test('stara primka: brisanje ne gazi kasniju nivelaciju druge stare primke', () => {
  const p = dodajArtikal('040', 15);
  const a = staraPrimka('U-A', [{ productId: p, cijena: 12, nivelacija: [10, 12] }]);
  staraPrimka('U-B', [{ productId: p, cijena: 15, nivelacija: [12, 15] }]);

  primke.obrisi(a);
  expect(cijena(p)).toBe(15);
});

test('stara primka: ručna izmjena poslije primke se ne gazi, i kad je ista kao cijena primke', () => {
  const p = dodajArtikal('041', 12);
  const a = staraPrimka('U-A', [{ productId: p, cijena: 12, nivelacija: [10, 12] }]);
  zapisiPromjeneCijena(db, 'rucno', null, [{ productId: p, staraCijena: 10, novaCijena: 12 }]);

  primke.obrisi(a);
  expect(cijena(p)).toBe(12);
});

test('stara primka: artikal uklonjen izmjenom se pri brisanju ne vraća ponovo (nivelacija ostaje)', () => {
  const p = dodajArtikal('045', 12);
  const q = dodajArtikal('046', 20);
  const a = staraPrimka('U-A', [{ productId: p, cijena: 12, nivelacija: [10, 12] }, { productId: q, cijena: 20 }]);
  primke.izmijeni({ id: a, ...unos('U-A', [stavka(q, 1, 20)]) });
  expect(cijena(p)).toBe(10);

  // Ponovo 12 mimo historije: nivelacija primke (10 → 12) je već poništena izmjenom.
  db.prepare('UPDATE products SET cijena = 12 WHERE id = ?').run(p);
  primke.obrisi(a);
  expect(cijena(p)).toBe(12);
});

test('stara primka: protunivelacija (bez primkaId) se ne čita kao nivelacija primke', () => {
  const p = dodajArtikal('042', 10);
  const a = staraPrimka('U-A', [{ productId: p, cijena: 12, nivelacija: [10, 12] }]);
  // Protunivelacija 12 → 10: da je pročitana kao nivelacija primke, vratila bi 12.
  const protu = db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES ('NIV-P', '2026-01-02', NULL)").run();
  db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, 12, 10, -2, -2, 'E')")
    .run(Number(protu.lastInsertRowid), p);

  primke.obrisi(a);
  expect(cijena(p)).toBe(10);
});

test('stara primka bez zalihe: zapamćena cijena se vraća s poništenim tragom u historiji, ali ne preko tuđe cijene', () => {
  const p = dodajArtikal('043', 12);
  const a = staraPrimka('U-A', [{ productId: p, cijena: 12, staraCijena: 10 }]);
  primke.obrisi(a);
  expect(cijena(p)).toBe(10);
  expect(historija(p)).toEqual([{ izvor: 'primka', izvorId: a, staraCijena: 12, novaCijena: 10, ponistena: 1 }]);
  expect(red("SELECT date(createdAt) = date('now','localtime') AS danas FROM cijena_historija")).toEqual({ danas: 1 });

  // Cijenu je u međuvremenu promijenilo nešto drugo (14): ostaje.
  const q = dodajArtikal('044', 14);
  const bId = staraPrimka('U-B', [{ productId: q, cijena: 12, staraCijena: 10 }]);
  primke.obrisi(bId);
  expect(cijena(q)).toBe(14);
});

// ── upisiNivelaciju ───────────────────────────────────────────────────

test('upisiNivelaciju: bez stavki ništa; inače sljedeći broj, današnji datum, razlike po stavci', () => {
  const p = dodajArtikal('050', 10);
  expect(upisiNivelaciju(db, null, [], 'x')).toBeNull();
  expect(nivelacije()).toEqual([]);

  expect(upisiNivelaciju(db, null, [{ productId: p, kolicina: 3, staraCijena: 10, novaCijena: 12.5, pdvStopa: 'E' }], 'Ručno')).toBe(niv(1));
  expect(upisiNivelaciju(db, null, [{ productId: p, kolicina: 1, staraCijena: 12.5, novaCijena: 12, pdvStopa: 'E' }], null)).toBe(niv(2));
  expect(nivelacije()).toEqual([
    { broj: niv(1), datum: localDateStr(), primkaId: null, napomena: 'Ručno', stavke: [{ productId: p, kolicina: 3, stara: 10, nova: 12.5, ukupno: 7.5 }] },
    { broj: niv(2), datum: localDateStr(), primkaId: null, napomena: null, stavke: [{ productId: p, kolicina: 1, stara: 12.5, nova: 12, ukupno: -0.5 }] },
  ]);
  expect(red('SELECT razlika, pdvStopa FROM nivelacija_stavke ORDER BY id LIMIT 1')).toEqual({ razlika: 2.5, pdvStopa: 'E' });
});
