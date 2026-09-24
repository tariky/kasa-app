// Ugovor za kanale primka:*, nivelacija:* i report:getData — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach, setSystemTime } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina s PIN-om 0000

function dodajArtikal(sifra: string, cijena: number, opts: { tip?: string; stanje?: number } = {}): number {
  const r = b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', ?, 'E', 1, ?)"
  ).run(sifra, `Artikal ${sifra}`, cijena, opts.tip ?? 'artikal');
  const id = Number(r.lastInsertRowid);
  if (opts.stanje) {
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
      .run(id, opts.stanje);
  }
  return id;
}

function stanje(productId: number): number {
  const r = b.db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `).get(productId) as { s: number };
  return r.s;
}

function cijena(productId: number): number {
  return red('SELECT cijena FROM products WHERE id = ?', productId).cijena;
}

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: any[]): any[] {
  return b.db.prepare(sql).all(...params);
}

function broj(tabela: string): number {
  return red(`SELECT COUNT(*) AS n FROM ${tabela}`).n;
}

function stavka(productId: number, kolicina: number, cijena: number, extra: Record<string, unknown> = {}) {
  return { productId, kolicina, cijena, nabavnaCijena: 5, rabat: 0, pdvStopa: 'E', ...extra };
}

function primka(brojPrimke: string, stavke: ReturnType<typeof stavka>[], extra: Record<string, unknown> = {}) {
  return { brojPrimke, datum: '2026-03-10', stavke, ...extra };
}

/** Današnji datum po lokalnom vremenu (YYYY-MM-DD) — tako ga upisuje backend. */
function danas(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Broj nivelacije tekuće godine: niv(3) → 'NIV-2026-003'. */
function niv(n: number): string {
  return `NIV-${new Date().getFullYear()}-${String(n).padStart(3, '0')}`;
}

/**
 * Sve nivelacije redom sa stavkama — nivelacija je knjigovodstveni dokument i
 * nikad ne nestaje; poništenje cijene ide novom nivelacijom (protunivelacija).
 */
function nivelacijeDok(): Array<{ broj: string; datum: string; primkaId: number | null; napomena: string | null; stavke: Array<{ productId: number; kolicina: number; stara: number; nova: number; ukupno: number }> }> {
  return redovi('SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije ORDER BY id').map(n => ({
    broj: n.brojNivelacije, datum: n.datum, primkaId: n.primkaId, napomena: n.napomena,
    stavke: redovi('SELECT productId, kolicina, staraCijena AS stara, novaCijena AS nova, ukupnaRazlika AS ukupno FROM nivelacija_stavke WHERE nivelacijaId = ? ORDER BY id', n.id),
  }));
}

function dodajPrimku(brojPrimke: string, datum: string): number {
  return Number(b.db.prepare('INSERT INTO primke (brojPrimke, datum) VALUES (?, ?)').run(brojPrimke, datum).lastInsertRowid);
}

function dodajRacun(ukupno: number, createdAt: string, status = 'completed'): number {
  return Number(b.db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, createdAt) VALUES (?, ?, 0, 'Gotovina', ?, ?)"
  ).run(ADMIN, ukupno, status, createdAt).lastInsertRowid);
}

// ─── primka:create ──────────────────────────────────────────

describe('primka:create', () => {
  test('upisuje zaglavlje, stavke i ulaz na zalihu', async () => {
    const p = dodajArtikal('A1', 10);
    const r = await b.call('primka:create', primka('U-1', [stavka(p, 4, 10, { nabavnaCijena: 6, rabat: 5, zavisniTroskovi: 0.5 })], {
      napomena: 'Napomena', brojFakture: 'F-7',
      dobavljacNaziv: 'Dobavljač d.o.o.', dobavljacId: '4200000000009', dobavljacAdresa: 'Ulica 1',
    }));

    expect(r).toEqual({ id: r.id, nivelacijaCreated: false });
    expect(typeof r.id).toBe('number');
    expect(red('SELECT brojPrimke, datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture FROM primke WHERE id = ?', r.id))
      .toEqual({
        brojPrimke: 'U-1', datum: '2026-03-10', dobavljacNaziv: 'Dobavljač d.o.o.', dobavljacId: '4200000000009',
        dobavljacAdresa: 'Ulica 1', napomena: 'Napomena', brojFakture: 'F-7',
      });
    expect(redovi('SELECT productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa FROM primka_stavke WHERE primkaId = ?', r.id))
      .toEqual([{ productId: p, kolicina: 4, cijena: 10, nabavnaCijena: 6, rabat: 5, zavisniTroskovi: 0.5, pdvStopa: 'E' }]);
    // Ulaz na zalihu nosi datum primke (ne datum unosa); primka nema vrijeme pa je ponoć.
    expect(redovi("SELECT productId, tip, kolicina, referenceType, referenceId, createdAt FROM stock_movements WHERE referenceType = 'primka'"))
      .toEqual([{ productId: p, tip: 'ulaz', kolicina: 4, referenceType: 'primka', referenceId: r.id, createdAt: '2026-03-10 00:00:00' }]);
    expect(stanje(p)).toBe(4);
    expect(broj('nivelacije')).toBe(0);
  });

  test('neobavezna polja postaju null, zavisni troškovi 0, bez datuma uzima današnji', async () => {
    const p = dodajArtikal('A2', 10);
    const { id } = await b.call('primka:create', { brojPrimke: 'U-2', stavke: [stavka(p, 1, 10)] });

    expect(red('SELECT datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture FROM primke WHERE id = ?', id))
      .toEqual({ datum: danas(), dobavljacNaziv: null, dobavljacId: null, dobavljacAdresa: null, napomena: null, brojFakture: null });
    expect(red('SELECT zavisniTroskovi FROM primka_stavke WHERE primkaId = ?', id).zavisniTroskovi).toBe(0);
    expect(red("SELECT createdAt FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?", id).createdAt)
      .toBe(`${danas()} 00:00:00`);
  });

  test('ista cijena kao u šifarniku ne mijenja cijenu niti pravi nivelaciju', async () => {
    const p = dodajArtikal('A3', 10, { stanje: 5 });
    const r = await b.call('primka:create', primka('U-3', [stavka(p, 2, 10.0005)]));
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(7);
  });

  test('nova cijena za artikal sa zalihom pravi nivelaciju na postojećoj zalihi', async () => {
    const p = dodajArtikal('N1', 10, { stanje: 5 });
    const r = await b.call('primka:create', primka('U-4', [stavka(p, 3, 12)]));

    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(12);
    expect(stanje(p)).toBe(8);
    const niv = red('SELECT * FROM nivelacije WHERE primkaId = ?', r.id);
    expect(niv.brojNivelacije).toBe(`NIV-${new Date().getFullYear()}-001`);
    expect(niv.datum).toBe(danas()); // nivelacija nosi datum izmjene cijene, ne datum primke
    expect(redovi("SELECT createdAt FROM stock_movements WHERE referenceType = 'primka'")).toEqual([{ createdAt: '2026-03-10 00:00:00' }]);
    expect(niv.napomena).toBeNull();
    // Količina je zaliha PRIJE ove primke — nova roba dolazi već po novoj cijeni.
    expect(redovi('SELECT productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa FROM nivelacija_stavke WHERE nivelacijaId = ?', niv.id))
      .toEqual([{ productId: p, kolicina: 5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 10, pdvStopa: 'E' }]);
  });

  test('nova cijena za artikal bez zalihe samo se upiše u šifarnik, bez nivelacije', async () => {
    const p = dodajArtikal('N2', 10);
    const r = await b.call('primka:create', primka('U-5', [stavka(p, 3, 8)]));
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(8);
    expect(broj('nivelacije')).toBe(0);
  });

  test('materijalu se ne dira prodajna cijena', async () => {
    const p = dodajArtikal('MAT', 10, { tip: 'materijal', stanje: 5 });
    const r = await b.call('primka:create', primka('U-6', [stavka(p, 3, 15)]));
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(8);
  });

  test('isti artikal u više stavki: jedna nivelacija po prvoj cijeni, ulaz za svaku stavku', async () => {
    const p = dodajArtikal('D1', 10, { stanje: 2 });
    const q = dodajArtikal('D2', 4, { stanje: 1 });
    const r = await b.call('primka:create', primka('U-7', [stavka(p, 1, 11), stavka(p, 2, 13), stavka(q, 1, 5)]));

    expect(cijena(p)).toBe(11);
    expect(cijena(q)).toBe(5);
    expect(stanje(p)).toBe(5);
    const niv = red('SELECT id FROM nivelacije WHERE primkaId = ?', r.id);
    expect(redovi('SELECT productId, kolicina, staraCijena, novaCijena, ukupnaRazlika FROM nivelacija_stavke WHERE nivelacijaId = ? ORDER BY id', niv.id))
      .toEqual([
        { productId: p, kolicina: 2, staraCijena: 10, novaCijena: 11, ukupnaRazlika: 2 },
        { productId: q, kolicina: 1, staraCijena: 4, novaCijena: 5, ukupnaRazlika: 1 },
      ]);
    expect(redovi("SELECT kolicina FROM stock_movements WHERE referenceType = 'primka' AND productId = ? ORDER BY id", p).map(x => x.kolicina))
      .toEqual([1, 2]);
  });

  test('broj nivelacije raste unutar godine', async () => {
    const p = dodajArtikal('B1', 10, { stanje: 1 });
    await b.call('primka:create', primka('U-8', [stavka(p, 1, 11)]));
    await b.call('primka:create', primka('U-9', [stavka(p, 1, 12)]));
    const god = new Date().getFullYear();
    expect(redovi('SELECT brojNivelacije FROM nivelacije ORDER BY id').map(x => x.brojNivelacije))
      .toEqual([`NIV-${god}-001`, `NIV-${god}-002`]);
  });

  test('validacije: broj primke, stavke, duplikat', async () => {
    const p = dodajArtikal('V1', 10);
    await expect(b.call('primka:create', primka('  ', [stavka(p, 1, 10)]))).rejects.toThrow('Broj primke je obavezan');
    await expect(b.call('primka:create', { datum: '2026-03-10', stavke: [stavka(p, 1, 10)] })).rejects.toThrow('Broj primke je obavezan');
    await expect(b.call('primka:create', primka('U-10', []))).rejects.toThrow('Primka mora imati najmanje jednu stavku');
    await expect(b.call('primka:create', { brojPrimke: 'U-10' })).rejects.toThrow('Primka mora imati najmanje jednu stavku');

    await b.call('primka:create', primka('U-10', [stavka(p, 1, 10)]));
    await expect(b.call('primka:create', primka('U-10', [stavka(p, 1, 10)]))).rejects.toThrow('Primka sa brojem "U-10" već postoji');
    // Provjera duplikata ide po trimovanom broju, poruka nosi broj kako je poslan.
    await expect(b.call('primka:create', primka(' U-10 ', [stavka(p, 1, 10)]))).rejects.toThrow('Primka sa brojem " U-10 " već postoji');
    expect(broj('primke')).toBe(1);
    expect(stanje(p)).toBe(1);
  });

  test('nepostojeći artikal: greška i ništa se ne upiše', async () => {
    const p = dodajArtikal('V2', 10);
    await expect(b.call('primka:create', primka('U-11', [stavka(p, 1, 10), stavka(9999, 1, 10)]))).rejects.toThrow();
    expect(broj('primke')).toBe(0);
    expect(broj('primka_stavke')).toBe(0);
    expect(broj('stock_movements')).toBe(0);
  });

  test('broj primke se upisuje trimovan', async () => {
    const p = dodajArtikal('T1', 10);
    const { id } = await b.call('primka:create', primka(' U-1 ', [stavka(p, 1, 10)]));
    expect(red('SELECT brojPrimke FROM primke WHERE id = ?', id).brojPrimke).toBe('U-1');
  });

  test('nepostojeći artikal: jasna poruka', async () => {
    const p = dodajArtikal('V3', 10);
    await expect(b.call('primka:create', primka('U-12', [stavka(p, 1, 10), stavka(9999, 1, 10)])))
      .rejects.toThrow('Artikal (ID 9999) ne postoji');
  });
});

// ─── primka:getAll / primka:get ─────────────────────────────

describe('primka:getAll', () => {
  test('prazna lista', async () => {
    expect(await b.call('primka:getAll')).toEqual([]);
  });

  test('sve primke od najnovijeg datuma, bez stavki', async () => {
    const p = dodajArtikal('L1', 10);
    const stara = (await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)], { datum: '2026-01-05' }))).id;
    const nova = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 10)], { datum: '2026-02-05', dobavljacNaziv: 'Dob' }))).id;
    const srednja = (await b.call('primka:create', primka('U-3', [stavka(p, 1, 10)], { datum: '2026-01-20' }))).id;

    const lista: any[] = await b.call('primka:getAll');
    expect(lista.map(x => x.id)).toEqual([nova, srednja, stara]);
    expect(lista[0]).toMatchObject({ brojPrimke: 'U-2', datum: '2026-02-05', dobavljacNaziv: 'Dob', napomena: null, brojFakture: null });
    expect(typeof lista[0].createdAt).toBe('string');
    expect(lista[0].stavke).toBeUndefined();
  });
});

describe('primka:get', () => {
  test('primka sa stavkama i podacima artikla', async () => {
    const p = dodajArtikal('G1', 10);
    const q = dodajArtikal('G2', 3);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 2, 10), stavka(q, 5, 3, { nabavnaCijena: 1.5 })], { brojFakture: 'F-1' }));

    const r = await b.call('primka:get', id);
    expect(r).toMatchObject({ id, brojPrimke: 'U-1', datum: '2026-03-10', brojFakture: 'F-1' });
    expect(r.stavke).toHaveLength(2);
    expect(r.stavke[0]).toMatchObject({
      primkaId: id, productId: p, kolicina: 2, cijena: 10, nabavnaCijena: 5, rabat: 0, zavisniTroskovi: 0, pdvStopa: 'E',
      productNaziv: 'Artikal G1', productJm: 'kom', productSifra: 'G1',
    });
    expect(r.stavke[1]).toMatchObject({ productId: q, kolicina: 5, nabavnaCijena: 1.5, productSifra: 'G2' });
  });

  test('nepostojeća primka je greška', async () => {
    await expect(b.call('primka:get', 999)).rejects.toThrow('Primka ne postoji');
  });
});

// ─── primka:nextBroj ────────────────────────────────────────

describe('primka:nextBroj', () => {
  const god = new Date().getFullYear();

  test('prvi broj u godini', async () => {
    expect(await b.call('primka:nextBroj')).toBe(`U-${god}-001`);
  });

  test('najveći broj tekuće godine + 1; druge godine i drugi formati se ne broje', async () => {
    dodajPrimku(`U-${god}-007`, '2026-01-01');
    dodajPrimku(`U-${god}-012`, '2026-01-02');
    dodajPrimku(`U-${god - 1}-099`, '2025-12-31');
    dodajPrimku('PR-500', '2026-01-03');
    expect(await b.call('primka:nextBroj')).toBe(`U-${god}-013`);
  });

  test('preko tri cifre nema paddinga', async () => {
    dodajPrimku(`U-${god}-999`, '2026-01-01');
    expect(await b.call('primka:nextBroj')).toBe(`U-${god}-1000`);
  });
});

// ─── primka:update ──────────────────────────────────────────

describe('primka:update', () => {
  test('zamjenjuje zaglavlje, stavke i ulaz na zalihu', async () => {
    const p = dodajArtikal('E1', 10);
    const q = dodajArtikal('E2', 20);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 5, 10)], { napomena: 'stara', dobavljacNaziv: 'Dob' }));

    const r = await b.call('primka:update', { id, ...primka('U-1b', [stavka(q, 2, 20)], { datum: '2026-03-11', brojFakture: 'F-2' }) });
    expect(r).toEqual({ id, nivelacijaCreated: false });

    expect(red('SELECT brojPrimke, datum, dobavljacNaziv, napomena, brojFakture FROM primke WHERE id = ?', id))
      .toEqual({ brojPrimke: 'U-1b', datum: '2026-03-11', dobavljacNaziv: null, napomena: null, brojFakture: 'F-2' });
    expect(redovi('SELECT productId, kolicina FROM primka_stavke WHERE primkaId = ?', id)).toEqual([{ productId: q, kolicina: 2 }]);
    expect(stanje(p)).toBe(0);
    expect(stanje(q)).toBe(2);
    expect(redovi("SELECT productId FROM stock_movements WHERE referenceType = 'primka'")).toEqual([{ productId: q }]);
  });

  test('promjena datuma primke pomjera i ulaz na zalihu; nivelacija ostaje današnja', async () => {
    const p = dodajArtikal('E11', 10, { stanje: 2 });
    const q = dodajArtikal('E12', 5);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12), stavka(q, 3, 5)]));

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 1, 13), stavka(q, 4, 5)], { datum: '2026-02-01' }) });
    expect(redovi("SELECT productId, kolicina, createdAt FROM stock_movements WHERE referenceType = 'primka' ORDER BY productId"))
      .toEqual([
        { productId: p, kolicina: 1, createdAt: '2026-02-01 00:00:00' },
        { productId: q, kolicina: 4, createdAt: '2026-02-01 00:00:00' },
      ]);
    expect(red('SELECT datum FROM nivelacije WHERE primkaId = ?', id).datum).toBe(danas());
    expect(red('SELECT kolicina FROM nivelacija_stavke').kolicina).toBe(2);
  });

  test('bez datuma uzima današnji', async () => {
    const p = dodajArtikal('E3', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)]));
    await b.call('primka:update', { id, brojPrimke: 'U-1', stavke: [stavka(p, 1, 10)] });
    expect(red('SELECT datum FROM primke WHERE id = ?', id).datum).toBe(danas());
    expect(red("SELECT createdAt FROM stock_movements WHERE referenceType = 'primka'").createdAt).toBe(`${danas()} 00:00:00`);
  });

  test('stara nivelacija ostaje, nova nivelira od cijene u prodaji (12 → 15), ne od cijene prije primke', async () => {
    const p = dodajArtikal('E4', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(cijena(p)).toBe(12);

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 4, 15)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(15);
    expect(stanje(p)).toBe(9);
    // Stara nivelacija (10 → 12) je dokument po kojem se prodavalo i ostaje;
    // nova dobija sljedeći broj i nivelira zalihu bez ove primke sa 12 na 15.
    const niv = redovi('SELECT id, brojNivelacije FROM nivelacije WHERE primkaId = ? ORDER BY id', id);
    expect(niv.map(n => n.brojNivelacije)).toEqual([`NIV-${new Date().getFullYear()}-001`, `NIV-${new Date().getFullYear()}-002`]);
    expect(redovi('SELECT kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika FROM nivelacija_stavke ORDER BY id'))
      .toEqual([
        { kolicina: 5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 10 },
        { kolicina: 5, staraCijena: 12, novaCijena: 15, razlika: 3, ukupnaRazlika: 15 },
      ]);
    // Historija (za poništavanje) i dalje vodi cijenu prije primke.
    expect(redovi("SELECT staraCijena, novaCijena FROM cijena_historija WHERE izvorId = ?", id)).toEqual([{ staraCijena: 10, novaCijena: 15 }]);
  });

  test('vraćanjem na staru cijenu stara nivelacija ostaje, a protunivelacija vraća cijenu', async () => {
    const p = dodajArtikal('E5', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 10)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok()).toEqual([
      { broj: niv(1), datum: danas(), primkaId: id, napomena: null, stavke: [{ productId: p, kolicina: 5, stara: 10, nova: 12, ukupno: 10 }] },
      { broj: niv(2), datum: danas(), primkaId: null, napomena: `Izmjena primke U-1: poništenje cijene (${niv(1)})`, stavke: [{ productId: p, kolicina: 5, stara: 12, nova: 10, ukupno: -10 }] },
    ]);

    // Brisanje primke ne vraća cijenu ponovo — primka je više ne mijenja.
    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(broj('nivelacije')).toBe(2);
  });

  test('ne vraća cijenu koju je u međuvremenu promijenila kasnija primka', async () => {
    const p = dodajArtikal('E6', 10, { stanje: 5 });
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]))).id;
    const druga = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 14)]))).id;
    expect(cijena(p)).toBe(14);

    await b.call('primka:update', { id: prva, ...primka('U-1', [stavka(p, 1, 14)]) });
    expect(cijena(p)).toBe(14);
    // Cijena u prodaji se ne mijenja, pa nivelacija prve primke (10 → 12, stvarna
    // promjena u svoje vrijeme) ostaje; ispravlja se samo lanac za poništavanje.
    expect(red('SELECT COUNT(*) AS n FROM nivelacije WHERE primkaId = ?', prva).n).toBe(1);
    expect(broj('nivelacije')).toBe(2);

    await b.call('primka:delete', druga);
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(10);
  });

  test('duplikat broja druge primke: greška i ništa se ne mijenja', async () => {
    const p = dodajArtikal('E7', 10);
    await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)]));
    const { id } = await b.call('primka:create', primka('U-2', [stavka(p, 2, 10)]));

    await expect(b.call('primka:update', { id, ...primka('U-1', [stavka(p, 7, 10)]) })).rejects.toThrow();
    expect(red('SELECT brojPrimke FROM primke WHERE id = ?', id).brojPrimke).toBe('U-2');
    expect(stanje(p)).toBe(3);
  });

  test('nepostojeća primka: greška i ništa se ne upiše', async () => {
    const p = dodajArtikal('E8', 10);
    await expect(b.call('primka:update', { id: 999, ...primka('U-9', [stavka(p, 1, 10)]) })).rejects.toThrow();
    expect(broj('primka_stavke')).toBe(0);
    expect(broj('stock_movements')).toBe(0);
  });

  test('validacije kao kod primka:create; ništa se ne mijenja', async () => {
    const p = dodajArtikal('E9', 10, { stanje: 5 });
    await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)]));
    const { id } = await b.call('primka:create', primka('U-2', [stavka(p, 2, 12)]));
    const prije = { primka: red('SELECT * FROM primke WHERE id = ?', id), stanje: stanje(p), cijena: cijena(p), niv: broj('nivelacija_stavke') };

    await expect(b.call('primka:update', { id, ...primka('  ', [stavka(p, 1, 10)]) })).rejects.toThrow('Broj primke je obavezan');
    await expect(b.call('primka:update', { id, datum: '2026-03-10', stavke: [stavka(p, 1, 10)] })).rejects.toThrow('Broj primke je obavezan');
    await expect(b.call('primka:update', { id, ...primka('U-2', []) })).rejects.toThrow('Primka mora imati najmanje jednu stavku');
    await expect(b.call('primka:update', { id, brojPrimke: 'U-2' })).rejects.toThrow('Primka mora imati najmanje jednu stavku');
    await expect(b.call('primka:update', { id, ...primka('U-1', [stavka(p, 1, 10)]) })).rejects.toThrow('Primka sa brojem "U-1" već postoji');
    await expect(b.call('primka:update', { id, ...primka(' U-1 ', [stavka(p, 1, 10)]) })).rejects.toThrow('Primka sa brojem " U-1 " već postoji');
    await expect(b.call('primka:update', { id, ...primka('U-2', [stavka(p, 1, 10), stavka(9999, 1, 10)]) }))
      .rejects.toThrow('Artikal (ID 9999) ne postoji');

    expect(red('SELECT * FROM primke WHERE id = ?', id)).toEqual(prije.primka);
    expect(stanje(p)).toBe(prije.stanje);
    expect(cijena(p)).toBe(prije.cijena);
    expect(broj('nivelacija_stavke')).toBe(prije.niv);
  });

  test('vlastiti broj nije duplikat; broj se upisuje trimovan', async () => {
    const p = dodajArtikal('E10', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)]));
    await b.call('primka:update', { id, ...primka(' U-1 ', [stavka(p, 2, 10)]) });
    expect(red('SELECT brojPrimke FROM primke WHERE id = ?', id).brojPrimke).toBe('U-1');
    expect(stanje(p)).toBe(2);
  });
});

// ─── primka:delete ──────────────────────────────────────────

describe('primka:delete', () => {
  test('briše primku, stavke i ulaz na zalihu; njena nivelacija ostaje bez veze na primku', async () => {
    const p = dodajArtikal('X1', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const ostaje = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 12)]))).id;

    expect(await b.call('primka:delete', id)).toBeNull();
    expect(red('SELECT COUNT(*) AS n FROM primke WHERE id = ?', id).n).toBe(0);
    expect(red('SELECT COUNT(*) AS n FROM primka_stavke WHERE primkaId = ?', id).n).toBe(0);
    expect(stanje(p)).toBe(6);
    expect(red('SELECT COUNT(*) AS n FROM primke WHERE id = ?', ostaje).n).toBe(1);
    // U-2 cijenu nije mijenjala (zatekla je 12), pa se vraća na 10 — na zalihi
    // koja ostaje (5 + 1 iz U-2).
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok()).toEqual([
      { broj: niv(1), datum: danas(), primkaId: null, napomena: `Primka U-1 obrisana; cijena vraćena nivelacijom ${niv(2)}`, stavke: [{ productId: p, kolicina: 5, stara: 10, nova: 12, ukupno: 10 }] },
      { broj: niv(2), datum: danas(), primkaId: null, napomena: `Poništenje primke U-1 (${niv(1)})`, stavke: [{ productId: p, kolicina: 6, stara: 12, nova: 10, ukupno: -12 }] },
    ]);
  });

  test('nepostojeća primka se tiho ignoriše', async () => {
    expect(await b.call('primka:delete', 999)).toBeNull();
  });

  test('vraća cijenu protunivelacijom današnjeg datuma na zalihi koja ostaje bez robe iz primke', async () => {
    const p = dodajArtikal('X2', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(cijena(p)).toBe(12);
    izlaz(p, 2); // prodano 2 po 12 → zaliha 6

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(3);
    const [original, protu] = nivelacijeDok();
    expect(original).toEqual({ broj: niv(1), datum: danas(), primkaId: null, napomena: `Primka U-1 obrisana; cijena vraćena nivelacijom ${niv(2)}`, stavke: [{ productId: p, kolicina: 5, stara: 10, nova: 12, ukupno: 10 }] });
    // Cijena se mijenja na robi koja ostaje u prodavnici: 6 − 3 iz obrisane primke.
    expect(protu).toEqual({ broj: niv(2), datum: danas(), primkaId: null, napomena: `Poništenje primke U-1 (${niv(1)})`, stavke: [{ productId: p, kolicina: 3, stara: 12, nova: 10, ukupno: -6 }] });
  });

  test('bez zalihe poslije uklanjanja ulaza: cijena se vraća bez protunivelacije', async () => {
    const p = dodajArtikal('X4', 10, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    izlaz(p, 2); // zaliha 3 — sve iz ove primke

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(0);
    expect(nivelacijeDok().map(n => n.broj)).toEqual([niv(1)]);
  });

  test('ne vraća cijenu koju je u međuvremenu promijenila kasnija primka; nema protunivelacije', async () => {
    const p = dodajArtikal('X3', 10, { stanje: 5 });
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]))).id;
    const druga = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 14)]))).id;

    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(14);
    expect(nivelacijeDok().map(n => [n.broj, n.primkaId, n.napomena])).toEqual([
      [niv(1), null, 'Primka U-1 obrisana'],
      [niv(2), druga, null],
    ]);
  });

  test('obrisana primka: nivelacija ostaje čitljiva kroz nivelacija:get i nivelacija:getAll', async () => {
    const p = dodajArtikal('X5', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const nivId = red('SELECT id FROM nivelacije WHERE primkaId = ?', id).id;
    await b.call('primka:delete', id);

    const n = await b.call('nivelacija:get', nivId);
    expect(n).toMatchObject({ brojNivelacije: niv(1), primkaId: null, primkaBroj: null, napomena: `Primka U-1 obrisana; cijena vraćena nivelacijom ${niv(2)}` });
    expect(n.stavke).toHaveLength(1);
    expect(n.stavke[0]).toMatchObject({ productId: p, kolicina: 5, staraCijena: 10, novaCijena: 12, productNaziv: 'Artikal X5' });

    const lista: any[] = await b.call('nivelacija:getAll');
    expect(lista.map(x => [x.brojNivelacije, x.primkaBroj, x.stavkiCount, x.ukupnaRazlika]).sort()).toEqual([
      [niv(1), null, 1, 10],
      [niv(2), null, 1, -10],
    ]);
    expect(await b.call('nivelacija:getAll', danas(), danas())).toHaveLength(2);
  });
});

// ─── nivelacija:getAll / nivelacija:get ─────────────────────

describe('nivelacija:getAll', () => {
  function dodajNivelaciju(brojNiv: string, datum: string, primkaId: number | null, stavke: Array<[number, number, number]>): number {
    const id = Number(b.db.prepare('INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, ?, ?)').run(brojNiv, datum, primkaId).lastInsertRowid);
    for (const [productId, kolicina, razlika] of stavke) {
      b.db.prepare(`INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa)
        VALUES (?, ?, ?, 10, ?, ?, ?, 'E')`).run(id, productId, kolicina, 10 + razlika, razlika, kolicina * razlika);
    }
    return id;
  }

  test('prazna lista', async () => {
    expect(await b.call('nivelacija:getAll')).toEqual([]);
  });

  test('sve nivelacije od najnovije, sa brojem primke, brojem stavki i zbirom razlike', async () => {
    const p = dodajArtikal('NV1', 10);
    const q = dodajArtikal('NV2', 10);
    const pr = dodajPrimku('U-1', '2026-02-01');
    const a = dodajNivelaciju('NIV-2026-001', '2026-02-01', pr, [[p, 5, 2], [q, 3, -1]]);
    const c = dodajNivelaciju('NIV-2026-002', '2026-03-15', null, []);

    const lista: any[] = await b.call('nivelacija:getAll');
    expect(lista.map(x => x.id)).toEqual([c, a]);
    expect(lista[1]).toMatchObject({ brojNivelacije: 'NIV-2026-001', datum: '2026-02-01', primkaId: pr, primkaBroj: 'U-1', stavkiCount: 2, ukupnaRazlika: 7 });
    expect(lista[0]).toMatchObject({ primkaId: null, primkaBroj: null, stavkiCount: 0, ukupnaRazlika: 0 });
  });

  test('filter po periodu uključuje obje granice', async () => {
    dodajNivelaciju('NIV-A', '2026-01-31', null, []);
    const b1 = dodajNivelaciju('NIV-B', '2026-02-01', null, []);
    const b2 = dodajNivelaciju('NIV-C', '2026-02-28', null, []);
    dodajNivelaciju('NIV-D', '2026-03-01', null, []);

    const lista: any[] = await b.call('nivelacija:getAll', '2026-02-01', '2026-02-28');
    expect(lista.map(x => x.id)).toEqual([b2, b1]);
    // Samo jedna granica = bez filtera.
    expect(await b.call('nivelacija:getAll', '2026-02-01')).toHaveLength(4);
  });

  test('nivelacija nastala iz primke je u listi', async () => {
    const p = dodajArtikal('NV3', 10, { stanje: 4 });
    const { id } = await b.call('primka:create', primka('U-7', [stavka(p, 1, 10.5)]));
    const lista: any[] = await b.call('nivelacija:getAll', danas(), danas());
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ primkaId: id, primkaBroj: 'U-7', stavkiCount: 1, ukupnaRazlika: 2 });
  });
});

describe('nivelacija:get', () => {
  test('nivelacija sa stavkama i podacima artikla', async () => {
    const p = dodajArtikal('NG1', 10, { stanje: 5 });
    const { id: primkaId } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const nivId = red('SELECT id FROM nivelacije WHERE primkaId = ?', primkaId).id;

    const n = await b.call('nivelacija:get', nivId);
    expect(n).toMatchObject({ id: nivId, primkaId, primkaBroj: 'U-1', datum: danas(), napomena: null });
    expect(n.stavke).toHaveLength(1);
    expect(n.stavke[0]).toMatchObject({
      nivelacijaId: nivId, productId: p, kolicina: 5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 10, pdvStopa: 'E',
      productNaziv: 'Artikal NG1', productSifra: 'NG1', productJm: 'kom',
    });
  });

  test('nepostojeća nivelacija je greška', async () => {
    await expect(b.call('nivelacija:get', 999)).rejects.toThrow('Nivelacija ne postoji');
  });
});

// ─── report:getData ─────────────────────────────────────────

describe('report:getData', () => {
  test('dnevni: računi u periodu (obje granice), od najnovijeg, s imenom korisnika, i stornirani', async () => {
    dodajRacun(1, '2026-01-31 23:59:59');
    const a = dodajRacun(10.5, '2026-02-01 00:00:00');
    const c = dodajRacun(20, '2026-02-10 12:00:00', 'refunded');
    const d = dodajRacun(4.25, '2026-02-28 23:59:59');
    dodajRacun(100, '2026-03-01 00:00:00');

    const r: any[] = await b.call('report:getData', 'dnevni', '2026-02-01', '2026-02-28');
    expect(r.map(x => x.id)).toEqual([d, c, a]);
    expect(r.map(x => x.ukupno)).toEqual([4.25, 20, 10.5]);
    expect(r[1]).toMatchObject({ status: 'refunded', korisnikIme: 'Admin', nacinPlacanja: 'Gotovina' });
    expect(r.reduce((s, x) => s + x.ukupno, 0)).toBe(34.75);
  });

  test('dnevni: prazan period', async () => {
    dodajRacun(5, '2026-01-10 10:00:00');
    expect(await b.call('report:getData', 'dnevni', '2025-01-01', '2025-12-31')).toEqual([]);
  });

  test('primke: primke u periodu po datumu primke, sa sirovim stavkama', async () => {
    const p = dodajArtikal('R1', 10);
    const q = dodajArtikal('R2', 2);
    await b.call('primka:create', primka('U-0', [stavka(p, 1, 10)], { datum: '2026-01-31' }));
    const a = (await b.call('primka:create', primka('U-1', [stavka(p, 4, 10, { nabavnaCijena: 6 }), stavka(q, 10, 2, { nabavnaCijena: 1.2, rabat: 10 })], { datum: '2026-02-01' }))).id;
    const c = (await b.call('primka:create', primka('U-2', [stavka(q, 5, 2, { nabavnaCijena: 1 })], { datum: '2026-02-28' }))).id;
    await b.call('primka:create', primka('U-3', [stavka(p, 1, 10)], { datum: '2026-03-01' }));

    const r: any[] = await b.call('report:getData', 'primke', '2026-02-01', '2026-02-28');
    expect(r.map(x => x.id)).toEqual([c, a]);
    expect(r[1]).toMatchObject({ brojPrimke: 'U-1', datum: '2026-02-01' });
    expect(r[1].stavke.map((s: any) => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, nabavnaCijena: s.nabavnaCijena, rabat: s.rabat })))
      .toEqual([
        { productId: p, kolicina: 4, cijena: 10, nabavnaCijena: 6, rabat: 0 },
        { productId: q, kolicina: 10, cijena: 2, nabavnaCijena: 1.2, rabat: 10 },
      ]);
    // Stavke su sirovi redovi primka_stavke — bez podataka artikla.
    expect(r[1].stavke[0].productNaziv).toBeUndefined();
    expect(r[1].stavke[0].primkaId).toBe(a);
    expect(r[0].stavke).toHaveLength(1);
    const prodajna = r.flatMap(x => x.stavke).reduce((s: number, x: any) => s + x.kolicina * x.cijena, 0);
    expect(prodajna).toBe(70);
  });

  test('nepoznat tip izvještaja je greška', async () => {
    await expect(b.call('report:getData', 'mjesecni', '2026-01-01', '2026-01-31')).rejects.toThrow('Nepoznat tip izvještaja: mjesecni');
  });
});

// ─── Cijena artikla bez zalihe: primka pamti staru cijenu ───
//
// Artiklu bez zalihe primka mijenja cijenu bez nivelacije, pa staru cijenu
// pamti sama stavka primke (primka_stavke.staraCijena). Brisanje ili izmjena
// primke je vraća po istom pravilu kao nivelaciju: samo ako artikal još stoji
// na cijeni koju je ta primka postavila.

function izlaz(productId: number, kolicina: number): void {
  b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'test', 0)")
    .run(productId, kolicina);
}

describe('primka: stara cijena artikla bez zalihe', () => {
  test('create pamti staru cijenu samo na stavci koja je promijenila cijenu bez nivelacije', async () => {
    const bez = dodajArtikal('S1', 10);
    const sa = dodajArtikal('S2', 20, { stanje: 2 });
    const ista = dodajArtikal('S3', 5);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(bez, 1, 12), stavka(bez, 1, 13), stavka(sa, 1, 25), stavka(ista, 1, 5)]));

    expect(redovi('SELECT productId, cijena, staraCijena FROM primka_stavke WHERE primkaId = ? ORDER BY id', id)).toEqual([
      { productId: bez, cijena: 12, staraCijena: 10 },
      { productId: bez, cijena: 13, staraCijena: null },
      { productId: sa, cijena: 25, staraCijena: null },
      { productId: ista, cijena: 5, staraCijena: null },
    ]);
    expect(cijena(bez)).toBe(12);
    expect(broj('nivelacija_stavke')).toBe(1);
  });

  test('delete vraća cijenu artiklu bez zalihe, bez ikakve nivelacije', async () => {
    const p = dodajArtikal('S4', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(cijena(p)).toBe(12);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(0);
    expect(broj('nivelacije')).toBe(0);
  });

  test('update s novom cijenom: cijena je nova, a stara ostaje zapamćena kao prvobitna', async () => {
    const p = dodajArtikal('S5', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 15)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(15);
    expect(red('SELECT staraCijena FROM primka_stavke WHERE primkaId = ?', id).staraCijena).toBe(10);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(broj('nivelacije')).toBe(0);
  });

  test('update koji uklanja stavku vraća cijenu tom artiklu', async () => {
    const p = dodajArtikal('S6', 10);
    const q = dodajArtikal('S7', 20);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12), stavka(q, 1, 22)]));

    await b.call('primka:update', { id, ...primka('U-1', [stavka(q, 1, 22)]) });
    expect(cijena(p)).toBe(10);
    expect(cijena(q)).toBe(22);
    expect(stanje(p)).toBe(0);
  });

  test('update koji vrati cijenu na staru ne ostavlja zapamćenu cijenu', async () => {
    const p = dodajArtikal('S8', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 10)]) });
    expect(cijena(p)).toBe(10);
    expect(red('SELECT staraCijena FROM primka_stavke WHERE primkaId = ?', id).staraCijena).toBeNull();
  });

  test('delete ne vraća cijenu koju je kasnije promijenila druga primka; brisanjem i nje cijena je prvobitna (obje bez zalihe)', async () => {
    const p = dodajArtikal('S9', 10);
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 2, 12)]))).id;
    izlaz(p, 2);
    const druga = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 14)]))).id;
    expect(broj('nivelacije')).toBe(0);
    expect(cijena(p)).toBe(14);

    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(14);

    // Druga primka je cijenu zatekla na 12, ali tu cijenu je postavila prva
    // primka koje više nema — ispravna cijena je prvobitna.
    await b.call('primka:delete', druga);
    expect(cijena(p)).toBe(10);
  });

  test('update ne vraća cijenu koju je u međuvremenu promijenilo nešto drugo', async () => {
    const p = dodajArtikal('S10', 10);
    const q = dodajArtikal('S11', 20);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 2, 12), stavka(q, 1, 20)]));
    b.db.prepare('UPDATE products SET cijena = 13 WHERE id = ?').run(p);

    await b.call('primka:update', { id, ...primka('U-1', [stavka(q, 1, 20)]) });
    expect(cijena(p)).toBe(13);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(13);
  });

  test('miješano: prva primka bez zalihe, druga s nivelacijom — brisanje unazad vraća obje cijene', async () => {
    const p = dodajArtikal('S12', 10);
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 5, 12)]))).id;
    const druga = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 15)]))).id;
    expect(redovi('SELECT kolicina, staraCijena, novaCijena FROM nivelacija_stavke'))
      .toEqual([{ kolicina: 5, staraCijena: 12, novaCijena: 15 }]);

    await b.call('primka:delete', druga);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(10);
    // 15 → 12 protunivelacijom na zalihi od prve primke; brisanjem prve zalihe
    // više nema, pa povratak na 10 ide bez dokumenta.
    expect(nivelacijeDok().map(n => [n.primkaId, n.stavke.map(s => [s.kolicina, s.stara, s.nova])])).toEqual([
      [null, [[5, 12, 15]]],
      [null, [[5, 15, 12]]],
    ]);
  });

  test('miješano: brisanje prve primke (bez zalihe) ne dira cijenu iz kasnije nivelacije', async () => {
    const p = dodajArtikal('S13', 10);
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 5, 12)]))).id;
    await b.call('primka:create', primka('U-2', [stavka(p, 1, 15)]));

    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(15);
    expect(broj('nivelacije')).toBe(1);
  });

  test('miješano: izmjena primke s nivelacijom na artikal koji je u međuvremenu ostao bez zalihe', async () => {
    const p = dodajArtikal('S14', 10, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]));
    expect(broj('nivelacije')).toBe(1);
    izlaz(p, 3);

    // Stara nivelacija ostaje; nova cijena ide bez nivelacije jer zalihe (bez ove primke) nema.
    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 1, 14)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacije')).toBe(1);
    expect(red('SELECT staraCijena FROM primka_stavke WHERE primkaId = ?', id).staraCijena).toBe(10);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
  });

  test('stara primka bez zapamćene cijene: delete i update ne mijenjaju cijenu', async () => {
    const p = dodajArtikal('S15', 12);
    const id = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 2, 12, 'E')").run(id, p);
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 2, 'primka', ?)").run(p, id);
    const q = dodajArtikal('S16', 20);
    const id2 = dodajPrimku('U-OLD2', '2025-01-11');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 20, 'E')").run(id2, q);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(12);
    expect(stanje(p)).toBe(0);

    await b.call('primka:update', { id: id2, ...primka('U-OLD2', [stavka(p, 1, 12)]) });
    expect(cijena(q)).toBe(20);
  });
});

// ─── Lanac promjena cijena ─────────────────────────────────
//
// Više primki uzastopno mijenja cijenu istog artikla (A 10→12, B 12→14...).
// Kad se jedna poništi (delete ili update), cijena mora biti ona koju bi
// artikal imao da ta primka nikad nije postojala — gledajući samo primke koje
// još postoje. Ručna izmjena cijene (product:update) se nikad ne gazi.

type Zaliha = 'sa' | 'bez';

/** Postavi zalihu artikla prije primke: 'sa' = ima robe (nivelacija), 'bez' = nula. */
function zaliha(productId: number, z: Zaliha): void {
  const s = stanje(productId);
  if (z === 'bez' && s > 0) izlaz(productId, s);
  if (z === 'sa' && s <= 0) {
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
      .run(productId, 3 - s);
  }
}

async function primkaCijene(broj: string, productId: number, nova: number, z: Zaliha): Promise<number> {
  zaliha(productId, z);
  return (await b.call('primka:create', primka(broj, [stavka(productId, 1, nova)]))).id;
}

const KOMBINACIJE: Array<[string, Zaliha, Zaliha]> = [
  ['obje bez zalihe', 'bez', 'bez'],
  ['obje sa zalihom', 'sa', 'sa'],
  ['A bez zalihe, B sa zalihom', 'bez', 'sa'],
  ['A sa zalihom, B bez zalihe', 'sa', 'bez'],
];

describe('primka: lanac promjena cijena', () => {
  test.each(KOMBINACIJE)('%s: obriši A pa B → prvobitna cijena', async (_, za, zb) => {
    const p = dodajArtikal('L1', 10);
    const a = await primkaCijene('U-A', p, 12, za);
    const bId = await primkaCijene('U-B', p, 14, zb);
    expect(cijena(p)).toBe(14);

    const dokumentiPrije = nivelacijeDok().map(n => n.broj);

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(10);
    // Nijedna nivelacija ne nestaje; nove su samo protunivelacije.
    const dokumenti = nivelacijeDok();
    expect(dokumenti.slice(0, dokumentiPrije.length).map(n => n.broj)).toEqual(dokumentiPrije);
    expect(dokumenti.every(n => n.primkaId === null)).toBe(true);
  });

  test.each(KOMBINACIJE)('%s: obriši B pa A → prvobitna cijena', async (_, za, zb) => {
    const p = dodajArtikal('L2', 10);
    const a = await primkaCijene('U-A', p, 12, za);
    const bId = await primkaCijene('U-B', p, 14, zb);

    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test.each([['bez' as Zaliha], ['sa' as Zaliha]])('A, B, C (zaliha: %s): brisanje srednje ostavlja cijenu od C, pa brisanje C vraća cijenu od A', async (z) => {
    const p = dodajArtikal('L3', 10);
    const a = await primkaCijene('U-A', p, 12, z);
    const bId = await primkaCijene('U-B', p, 14, z);
    const c = await primkaCijene('U-C', p, 16, z);

    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(16);
    await b.call('primka:delete', c);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test('ručna izmjena cijene između primki se ne gazi — ni nakon brisanja cijelog lanca', async () => {
    const p = dodajArtikal('L4', 10);
    const a = await primkaCijene('U-A', p, 12, 'bez');
    await b.call('product:update', p, { cijena: 13 });
    const bId = await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(13);
  });

  test('ručna izmjena između primki: brisanje unazad staje na ručnoj cijeni', async () => {
    const p = dodajArtikal('L5', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await b.call('product:update', p, { cijena: 13 });
    const bId = await primkaCijene('U-B', p, 14, 'bez');

    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(13);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(13);
  });

  test('ručna izmjena nakon lanca ostaje nakon brisanja svih primki', async () => {
    const p = dodajArtikal('L6', 10);
    const a = await primkaCijene('U-A', p, 12, 'bez');
    const bId = await primkaCijene('U-B', p, 14, 'sa');
    await b.call('product:update', p, { cijena: 20 });

    await b.call('primka:delete', a);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(20);
  });

  test('update koji u sredini lanca uklanja stavku: cijena ostaje od C, lanac se kasnije ispravno vraća', async () => {
    const p = dodajArtikal('L7', 10);
    const q = dodajArtikal('L8', 50);
    const a = await primkaCijene('U-A', p, 12, 'bez');
    zaliha(p, 'sa');
    const bId = (await b.call('primka:create', primka('U-B', [stavka(p, 1, 14), stavka(q, 1, 50)]))).id;
    const c = await primkaCijene('U-C', p, 16, 'bez');

    await b.call('primka:update', { id: bId, ...primka('U-B', [stavka(q, 1, 50)]) });
    expect(cijena(p)).toBe(16);
    await b.call('primka:delete', c);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test('update koji u sredini lanca mijenja cijenu: trenutna cijena ostaje od C, brisanjem se lanac vraća bez B', async () => {
    const p = dodajArtikal('L9', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    const bId = await primkaCijene('U-B', p, 14, 'bez');
    const c = await primkaCijene('U-C', p, 16, 'sa');

    // C je kasnija promjena i određuje trenutnu cijenu; B se ispravlja samo u lancu.
    await b.call('primka:update', { id: bId, ...primka('U-B', [stavka(p, 1, 15)]) });
    expect(cijena(p)).toBe(16);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(16);
    await b.call('primka:delete', c);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test('update prve primke u lancu: brisanje ostatka vraća prvobitnu cijenu', async () => {
    const p = dodajArtikal('L10', 10);
    const a = await primkaCijene('U-A', p, 12, 'bez');
    const bId = await primkaCijene('U-B', p, 14, 'bez');

    // A više ne mijenja cijenu artikla p (stavka uklonjena).
    const q = dodajArtikal('L11', 5);
    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(q, 1, 5)]) });
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(10);
  });

  test('artikal s ručno mijenjanom cijenom se može obrisati', async () => {
    const p = dodajArtikal('L12', 10);
    await b.call('product:update', p, { cijena: 11 });
    expect(await b.call('product:delete', p)).toEqual({ changes: 1 });
  });

  test('stare primke bez zapamćene historije: ponašanje kao prije (nema ispravke lanca)', async () => {
    // Stara primka A (nivelacija 10 → 12, upisana SQL-om kao starom verzijom), pa nova primka B 12 → 14.
    const p = dodajArtikal('L13', 12, { stanje: 2 });
    const a = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 12, 'E')").run(a, p);
    const niv = Number(b.db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES ('NIV-OLD', '2025-01-10', ?)").run(a).lastInsertRowid);
    b.db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, 10, 12, 2, 2, 'E')").run(niv, p);
    const bId = await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(14);
    // Historija prije nadogradnje nije poznata: B vraća cijenu koju je zatekla.
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(12);
  });

  test('stara primka bez zalihe sa zapamćenom cijenom (bez historije) se vraća kao prije', async () => {
    const p = dodajArtikal('L14', 12);
    const a = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa, staraCijena) VALUES (?, ?, 1, 12, 'E', 10)").run(a, p);

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });
});

// ─── Izmjena primke: cijena se mijenja samo gdje je korisnik mijenja ─────
//
// Izmjena primke ne smije ponovo "nametnuti" njene prodajne cijene. Stavka
// kojoj prodajna cijena nije promijenjena ne dira cijenu artikla, historiju
// ni nivelacije. Promijenjena cijena važi odmah samo ako je ova primka zadnja
// promjena cijene artikla; inače trenutna cijena ostaje, a ispravlja se samo
// lanac (kasnija promjena dobija novu "staru" cijenu).

/** Nivelacije i historija cijena — dokumenti koje izmjena ne smije dirati bez razloga. */
function dokumentiCijena() {
  return {
    nivelacije: redovi('SELECT * FROM nivelacije ORDER BY id'),
    stavke: redovi('SELECT * FROM nivelacija_stavke ORDER BY id'),
    historija: redovi('SELECT id, productId, izvor, izvorId, staraCijena, novaCijena FROM cijena_historija ORDER BY id'),
  };
}

describe('primka:update — cijena samo za stavke s promijenjenom cijenom', () => {
  test.each([['sa' as Zaliha], ['bez' as Zaliha]])('A 12, B 14 (zaliha: %s): na A samo količina → cijena 14, bez nove nivelacije, zaliha ispravna', async (z) => {
    const p = dodajArtikal('U1', 10);
    const a = await primkaCijene('U-A', p, 12, z);
    const bId = await primkaCijene('U-B', p, 14, z);
    const prije = dokumentiCijena();
    const stanjePrije = stanje(p);

    const r = await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 5, 12)]) });
    expect(r).toEqual({ id: a, nivelacijaCreated: false });
    expect(cijena(p)).toBe(14);
    expect(dokumentiCijena()).toEqual(prije);
    expect(stanje(p)).toBe(stanjePrije + 4);

    // Lanac je netaknut: brisanje unazad i dalje vraća ispravne cijene.
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test('na A samo zaglavlje (datum, dobavljač, faktura, zavisni troškovi) → cijena i nivelacije netaknute', async () => {
    const p = dodajArtikal('U2', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await primkaCijene('U-B', p, 14, 'sa');
    const prije = dokumentiCijena();
    const stanjePrije = stanje(p);

    await b.call('primka:update', { id: a, ...primka('U-A1', [stavka(p, 1, 12, { zavisniTroskovi: 3, nabavnaCijena: 6 })], {
      datum: '2026-02-01', dobavljacNaziv: 'Novi dobavljač', brojFakture: 'F-99',
    }) });
    expect(cijena(p)).toBe(14);
    expect(dokumentiCijena()).toEqual(prije);
    expect(stanje(p)).toBe(stanjePrije);
    expect(red('SELECT brojPrimke, datum, dobavljacNaziv, brojFakture FROM primke WHERE id = ?', a))
      .toEqual({ brojPrimke: 'U-A1', datum: '2026-02-01', dobavljacNaziv: 'Novi dobavljač', brojFakture: 'F-99' });
    expect(red("SELECT createdAt FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?", a).createdAt)
      .toBe('2026-02-01 00:00:00');
    expect(red('SELECT zavisniTroskovi, nabavnaCijena FROM primka_stavke WHERE primkaId = ?', a)).toEqual({ zavisniTroskovi: 3, nabavnaCijena: 6 });
  });

  test('izmjena zadnje primke bez promjene cijene: ista nivelacija (broj, datum, količina), cijena ista', async () => {
    const p = dodajArtikal('U3', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const prije = dokumentiCijena();

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 7, 12)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(12);
    expect(dokumentiCijena()).toEqual(prije);
    expect(stanje(p)).toBe(12);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
  });

  test('izmjena zadnje primke bez zalihe, bez promjene cijene: zapamćena stara cijena ostaje', async () => {
    const p = dodajArtikal('U4', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 4, 12)]) });
    expect(cijena(p)).toBe(12);
    expect(red('SELECT staraCijena FROM primka_stavke WHERE primkaId = ?', id).staraCijena).toBe(10);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
  });

  test('zadnja primka: promijenjena stavka dobija novu nivelaciju, nepromijenjena zadržava staru', async () => {
    const p = dodajArtikal('U5', 10, { stanje: 5 });
    const q = dodajArtikal('U6', 20, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12), stavka(q, 1, 22)]));
    const staraNiv = red('SELECT * FROM nivelacije WHERE primkaId = ?', id);
    const staraQ = red('SELECT * FROM nivelacija_stavke WHERE productId = ?', q);

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 1, 15), stavka(q, 4, 22)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(15);
    expect(cijena(q)).toBe(22);
    // q: stari dokument ostaje kakav jeste.
    expect(red('SELECT * FROM nivelacije WHERE id = ?', staraNiv.id)).toEqual(staraNiv);
    expect(red('SELECT * FROM nivelacija_stavke WHERE productId = ?', q)).toEqual(staraQ);
    // p: stara stavka ostaje, nova nivelacija s današnjim datumom od cijene u
    // prodaji (12), na zalihi bez ove primke.
    expect(redovi('SELECT n.datum, ns.kolicina, ns.staraCijena, ns.novaCijena FROM nivelacija_stavke ns JOIN nivelacije n ON n.id = ns.nivelacijaId WHERE ns.productId = ? ORDER BY ns.id', p))
      .toEqual([{ datum: danas(), kolicina: 5, staraCijena: 10, novaCijena: 12 }, { datum: danas(), kolicina: 5, staraCijena: 12, novaCijena: 15 }]);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(cijena(q)).toBe(20);
    // Obje nivelacije primke ostaju; jedna protunivelacija vraća obje cijene.
    const dok = nivelacijeDok();
    expect(dok).toHaveLength(3);
    expect(dok[2]).toEqual({
      broj: niv(3), datum: danas(), primkaId: null, napomena: `Poništenje primke U-1 (${niv(1)}, ${niv(2)})`,
      stavke: [{ productId: p, kolicina: 5, stara: 15, nova: 10, ukupno: -25 }, { productId: q, kolicina: 2, stara: 22, nova: 20, ukupno: -4 }],
    });
  });

  test.each(KOMBINACIJE)('%s: promjena cijene na A (nije zadnja) → cijena ostaje 14; brisanje B vodi na novu cijenu A', async (_, za, zb) => {
    const p = dodajArtikal('U7', 10);
    const a = await primkaCijene('U-A', p, 12, za);
    const bId = await primkaCijene('U-B', p, 14, zb);
    const prije = dokumentiCijena();

    const r = await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 1, 13)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(14);
    // Cijena u prodaji se ne mijenja: nivelacije ostaju kakve jesu.
    expect(dokumentiCijena().nivelacije).toEqual(prije.nivelacije);
    expect(dokumentiCijena().stavke).toEqual(prije.stavke);
    expect(redovi('SELECT izvorId, staraCijena, novaCijena FROM cijena_historija ORDER BY id'))
      .toEqual([{ izvorId: a, staraCijena: 10, novaCijena: 13 }, { izvorId: bId, staraCijena: 13, novaCijena: 14 }]);

    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(13);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
  });

  test('promjena cijene na A u sredini lanca, pa vraćanje na izvornu: lanac je kao na početku', async () => {
    const p = dodajArtikal('U8', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    const bId = await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 1, 13)]) });
    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 1, 12)]) });
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(12);
  });

  test('ručna izmjena poslije primke se ne gazi — ni izmjenom količine ni cijene na primci', async () => {
    const p = dodajArtikal('U9', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await b.call('product:update', p, { cijena: 13 });

    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 4, 12)]) });
    expect(cijena(p)).toBe(13);
    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 4, 15)]) });
    expect(cijena(p)).toBe(13);
    expect(red('SELECT COUNT(*) AS n FROM nivelacije WHERE primkaId = ?', a).n).toBe(1);

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(13);
  });

  test('ručna izmjena između primki: izmjena A ne gazi ni ručnu ni B', async () => {
    const p = dodajArtikal('U10', 10);
    const a = await primkaCijene('U-A', p, 12, 'bez');
    await b.call('product:update', p, { cijena: 13 });
    const bId = await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 3, 11)]) });
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(13);
  });

  test('isti artikal više puta: važi prva stavka — promjena cijene kasnije stavke ne dira cijenu', async () => {
    const p = dodajArtikal('U11', 10, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12), stavka(p, 1, 13)]));
    const prije = dokumentiCijena();

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 2, 12), stavka(p, 1, 16)]) });
    expect(cijena(p)).toBe(12);
    expect(dokumentiCijena()).toEqual(prije);
  });

  test('starija primka: dodana stavka novog artikla ide kao create, postojeći artikal ne dira', async () => {
    const p = dodajArtikal('U12', 10);
    const q = dodajArtikal('U13', 5, { stanje: 1 });
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await primkaCijene('U-B', p, 14, 'sa');

    const r = await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 1, 12), stavka(q, 2, 7)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(14);
    expect(cijena(q)).toBe(7);
    expect(redovi('SELECT productId, kolicina, staraCijena, novaCijena FROM nivelacija_stavke ORDER BY id').filter(x => x.productId === q))
      .toEqual([{ productId: q, kolicina: 1, staraCijena: 5, novaCijena: 7 }]);
    expect(stanje(q)).toBe(3);
  });

  test('stavka čija cijena nije mijenjala cijenu artikla, a kasnije je to učinila druga primka: promjena cijene ne dira trenutnu', async () => {
    const p = dodajArtikal('U14', 10, { stanje: 2 });
    const a = (await b.call('primka:create', primka('U-A', [stavka(p, 1, 10)]))).id;
    await b.call('primka:create', primka('U-B', [stavka(p, 1, 14)]));
    const nivPrije = broj('nivelacija_stavke');

    await b.call('primka:update', { id: a, ...primka('U-A', [stavka(p, 1, 12)]) });
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacija_stavke')).toBe(nivPrije);
  });

  test('stara primka bez historije: promjena samo količine ne dira cijenu ni staru nivelaciju', async () => {
    const p = dodajArtikal('U15', 12, { stanje: 2 });
    const a = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 12, 'E')").run(a, p);
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 1, 'primka', ?)").run(p, a);
    const niv = Number(b.db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES ('NIV-OLD', '2025-01-10', ?)").run(a).lastInsertRowid);
    b.db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 1, 10, 12, 2, 2, 'E')").run(niv, p);
    const prije = dokumentiCijena();

    // Artikal još stoji na cijeni stare primke — ranije bi se vratio na 10 pa ponovo nivelisao na 12.
    await b.call('primka:update', { id: a, ...primka('U-OLD', [stavka(p, 3, 12)]) });
    expect(cijena(p)).toBe(12);
    expect(dokumentiCijena()).toEqual(prije);
    expect(stanje(p)).toBe(5);
  });

  test('stara primka bez historije: kasnija primka postavila cijenu — izmjena količine je ne gazi', async () => {
    const p = dodajArtikal('U16', 12);
    const a = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa, staraCijena) VALUES (?, ?, 1, 12, 'E', 10)").run(a, p);
    await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:update', { id: a, ...primka('U-OLD', [stavka(p, 2, 12)]) });
    expect(cijena(p)).toBe(14);
    expect(red('SELECT staraCijena FROM primka_stavke WHERE primkaId = ?', a).staraCijena).toBe(10);
  });
});

describe('primka:get — oznaka kasnije promjene cijene', () => {
  test('stavka starije primke čiju je cijenu kasnije promijenilo nešto drugo je označena', async () => {
    const p = dodajArtikal('K1', 10);
    const q = dodajArtikal('K2', 5);
    const a = (await b.call('primka:create', primka('U-A', [stavka(p, 1, 12), stavka(q, 1, 6)]))).id;
    const bId = await primkaCijene('U-B', p, 14, 'bez');

    const ga = await b.call('primka:get', a);
    expect(ga.stavke.map((s: any) => [s.productId, s.cijenaKasnijeMijenjana])).toEqual([[p, true], [q, false]]);
    const gb = await b.call('primka:get', bId);
    expect(gb.stavke.map((s: any) => s.cijenaKasnijeMijenjana)).toEqual([false]);
  });
});

// ─── Protunivelacija umjesto brisanja nivelacije ────────────
//
// Nivelacija je knjigovodstveni dokument: roba se prodavala po cijeni iz nje,
// pa se nikad ne briše. Kad brisanje ili izmjena primke vrati/promijeni cijenu
// u prodaji artiklu sa zalihom, nastaje nova nivelacija (protunivelacija) s
// današnjim datumom: stara = cijena u prodaji, nova = cijena na koju se vraća,
// količina = zaliha bez robe iz te primke (roba koja ostaje u prodavnici).

describe('primka: protunivelacija', () => {
  test('lanac A, B sa zalihom: obriši A pa B → jedna protunivelacija 14 → 10', async () => {
    const p = dodajArtikal('P1', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa'); // zaliha 3 → NIV-1 10→12 (3)
    const bId = await primkaCijene('U-B', p, 14, 'sa'); // zaliha 4 → NIV-2 12→14 (4)

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacije')).toBe(2);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(3);
    expect(nivelacijeDok()).toEqual([
      { broj: niv(1), datum: danas(), primkaId: null, napomena: 'Primka U-A obrisana', stavke: [{ productId: p, kolicina: 3, stara: 10, nova: 12, ukupno: 6 }] },
      { broj: niv(2), datum: danas(), primkaId: null, napomena: `Primka U-B obrisana; cijena vraćena nivelacijom ${niv(3)}`, stavke: [{ productId: p, kolicina: 4, stara: 12, nova: 14, ukupno: 8 }] },
      { broj: niv(3), datum: danas(), primkaId: null, napomena: `Poništenje primke U-B (${niv(2)})`, stavke: [{ productId: p, kolicina: 3, stara: 14, nova: 10, ukupno: -12 }] },
    ]);
  });

  test('lanac A, B sa zalihom: obriši B pa A → protunivelacije 14 → 12 i 12 → 10', async () => {
    const p = dodajArtikal('P2', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    const bId = await primkaCijene('U-B', p, 14, 'sa');

    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(12);
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok().slice(2)).toEqual([
      { broj: niv(3), datum: danas(), primkaId: null, napomena: `Poništenje primke U-B (${niv(2)})`, stavke: [{ productId: p, kolicina: 4, stara: 14, nova: 12, ukupno: -8 }] },
      { broj: niv(4), datum: danas(), primkaId: null, napomena: `Poništenje primke U-A (${niv(1)})`, stavke: [{ productId: p, kolicina: 3, stara: 12, nova: 10, ukupno: -6 }] },
    ]);
  });

  test('izmjena zadnje primke 12 → 15: nivelacija 12 → 15, stara 10 → 12 ostaje; UI najavljuje isto', async () => {
    const p = dodajArtikal('P3', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    // Ono što bi ekran izmjene ulaza pokazao prije spremanja.
    const najava = (await b.call('primka:pregledIzmjene', { id, ...primka('U-1', [stavka(p, 3, 15)]) })).dokumenti[0].stavke;

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 15)]) });
    expect(cijena(p)).toBe(15);
    const dok = nivelacijeDok();
    expect(dok).toEqual([
      { broj: niv(1), datum: danas(), primkaId: id, napomena: null, stavke: [{ productId: p, kolicina: 5, stara: 10, nova: 12, ukupno: 10 }] },
      { broj: niv(2), datum: danas(), primkaId: id, napomena: 'Izmjena primke U-1', stavke: [{ productId: p, kolicina: 5, stara: 12, nova: 15, ukupno: 15 }] },
    ]);
    expect(najava.map((r: any) => ({ productId: r.productId, kolicina: r.kolicina, stara: r.staraCijena, nova: r.novaCijena, ukupno: r.ukupnaRazlika })))
      .toEqual(dok[1].stavke);

    // Brisanje vraća 15 → 10 jednom protunivelacijom.
    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok()[2].stavke).toEqual([{ productId: p, kolicina: 5, stara: 15, nova: 10, ukupno: -25 }]);
  });

  test('izmjena koja uklanja stavku: protunivelacija za taj artikal, ostali netaknuti', async () => {
    const p = dodajArtikal('P4', 10, { stanje: 5 });
    const q = dodajArtikal('P5', 20, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12), stavka(q, 1, 22)]));

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(q, 1, 22)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(10);
    expect(cijena(q)).toBe(22);
    expect(stanje(p)).toBe(5);
    expect(nivelacijeDok()).toEqual([
      { broj: niv(1), datum: danas(), primkaId: id, napomena: null, stavke: [
        { productId: p, kolicina: 5, stara: 10, nova: 12, ukupno: 10 },
        { productId: q, kolicina: 2, stara: 20, nova: 22, ukupno: 4 },
      ] },
      { broj: niv(2), datum: danas(), primkaId: null, napomena: `Izmjena primke U-1: poništenje cijene (${niv(1)})`, stavke: [{ productId: p, kolicina: 5, stara: 12, nova: 10, ukupno: -10 }] },
    ]);

    // Protunivelacija nije nivelacija primke: brisanje primke vraća samo q.
    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(cijena(q)).toBe(20);
    expect(nivelacijeDok()[2]).toEqual({ broj: niv(3), datum: danas(), primkaId: null, napomena: `Poništenje primke U-1 (${niv(1)})`, stavke: [{ productId: q, kolicina: 2, stara: 22, nova: 20, ukupno: -4 }] });
  });

  test('izmjena koja uklanja stavku s primke koja nije zadnja promjena cijene: nema protunivelacije', async () => {
    const p = dodajArtikal('P6', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await primkaCijene('U-B', p, 14, 'sa');

    const r = await b.call('primka:update', { id: a, ...primka('U-A', [stavka(q0(), 1, 1)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacije')).toBe(2);
  });

  test('broj primke promijenjen istom izmjenom: napomena nosi novi broj', async () => {
    const p = dodajArtikal('P7', 10, { stanje: 1 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]));
    await b.call('primka:update', { id, ...primka('U-1a', [stavka(p, 1, 10)]) });
    expect(nivelacijeDok()[1].napomena).toBe(`Izmjena primke U-1a: poništenje cijene (${niv(1)})`);
  });
});

/** Pomoćni artikal bez veze s testom (primka mora imati bar jednu stavku). */
function q0(): number {
  return dodajArtikal(`Q${Math.random().toString(36).slice(2, 8)}`, 1);
}

/** Primka iz vremena prije historije cijena: nivelacija upisana SQL-om kao starom verzijom. */
function staraPrimka(broj: string, stavke: Array<{ productId: number; kolicina: number; stara: number; nova: number; zaliha: number }>): number {
  const id = dodajPrimku(broj, '2025-01-10');
  const nivId = Number(b.db.prepare("INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, '2025-01-10', ?)").run(`NIV-OLD-${broj}`, id).lastInsertRowid);
  for (const s of stavke) {
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, ?, ?, 'E')").run(id, s.productId, s.kolicina, s.nova);
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)").run(s.productId, s.kolicina, id);
    b.db.prepare("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, 'E')")
      .run(nivId, s.productId, s.zaliha, s.stara, s.nova, s.nova - s.stara, (s.nova - s.stara) * s.zaliha);
  }
  return id;
}

// Stare primke (prije historije cijena) poništavaju se starim putem — iz
// svoje nivelacije. I one dobijaju protunivelaciju umjesto brisanja.
describe('primka: stare primke bez historije — protunivelacija', () => {
  test('brisanje: stara nivelacija ostaje, protunivelacija vraća cijenu', async () => {
    const p = dodajArtikal('O1', 12, { stanje: 4 });
    const a = staraPrimka('U-OLD', [{ productId: p, kolicina: 2, stara: 10, nova: 12, zaliha: 4 }]);

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(4);
    expect(nivelacijeDok()).toEqual([
      { broj: 'NIV-OLD-U-OLD', datum: '2025-01-10', primkaId: null, napomena: `Primka U-OLD obrisana; cijena vraćena nivelacijom ${niv(1)}`, stavke: [{ productId: p, kolicina: 4, stara: 10, nova: 12, ukupno: 8 }] },
      { broj: niv(1), datum: danas(), primkaId: null, napomena: 'Poništenje primke U-OLD (NIV-OLD-U-OLD)', stavke: [{ productId: p, kolicina: 4, stara: 12, nova: 10, ukupno: -8 }] },
    ]);
  });

  test('izmjena cijene 12 → 15: nivelacija 12 → 15, stara ostaje', async () => {
    const p = dodajArtikal('O2', 12, { stanje: 4 });
    const a = staraPrimka('U-OLD', [{ productId: p, kolicina: 2, stara: 10, nova: 12, zaliha: 4 }]);

    await b.call('primka:update', { id: a, ...primka('U-OLD', [stavka(p, 2, 15)]) });
    expect(cijena(p)).toBe(15);
    expect(nivelacijeDok().map(n => [n.broj, n.primkaId, n.stavke.map(s => [s.kolicina, s.stara, s.nova])])).toEqual([
      ['NIV-OLD-U-OLD', a, [[4, 10, 12]]],
      [niv(1), a, [[4, 12, 15]]],
    ]);

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok()[2].stavke).toEqual([{ productId: p, kolicina: 4, stara: 15, nova: 10, ukupno: -20 }]);
  });

  test('uklonjena stavka se vraća jednom: kasnije brisanje primke ne gazi novu cijenu', async () => {
    const p = dodajArtikal('O3', 12, { stanje: 4 });
    const q = dodajArtikal('O4', 20);
    const a = staraPrimka('U-OLD', [{ productId: p, kolicina: 2, stara: 10, nova: 12, zaliha: 4 }, { productId: q, kolicina: 1, stara: 20, nova: 20, zaliha: 0 }]);

    await b.call('primka:update', { id: a, ...primka('U-OLD', [stavka(q, 1, 20)]) });
    expect(cijena(p)).toBe(10);
    expect(nivelacijeDok()[1]).toEqual({ broj: niv(1), datum: danas(), primkaId: null, napomena: 'Izmjena primke U-OLD: poništenje cijene (NIV-OLD-U-OLD)', stavke: [{ productId: p, kolicina: 4, stara: 12, nova: 10, ukupno: -8 }] });

    // Ručno ponovo 12 — stara nivelacija primke (10 → 12) je već poništena.
    await b.call('product:update', p, { cijena: 12 });
    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(12);
    expect(broj('nivelacije')).toBe(2);
  });
});

// ─── Pregled promjena cijena prije spremanja/brisanja ───────
//
// primka:pregledUnosa / pregledIzmjene / pregledBrisanja pokrenu istu logiku
// kao create / update / delete i ponište je. Ekran ulaza iz njih najavljuje
// nivelacije, protunivelacije i promjene cijena bez dokumenta — pa pregled
// mora opisati TAČNO ono što prava operacija zatim napravi, i ne smije ostaviti
// nikakav trag u bazi.

/** Sve tabele baze (i sqlite_sequence — brojači id-eva) redom po rowid. */
function snimakBaze(): Record<string, unknown[]> {
  const tabele = redovi("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(t => t.name as string);
  return Object.fromEntries(tabele.map(t => [t, redovi(`SELECT * FROM "${t}" ORDER BY rowid`)]));
}

type Operacija =
  | { kanal: 'primka:create'; data: Record<string, unknown> }
  | { kanal: 'primka:update'; data: Record<string, unknown> }
  | { kanal: 'primka:delete'; id: number };

const KANAL_PREGLEDA = { 'primka:create': 'primka:pregledUnosa', 'primka:update': 'primka:pregledIzmjene', 'primka:delete': 'primka:pregledBrisanja' } as const;

/** Zadnja nivelacija i sve cijene — polazište za `ocekujUpisanPregled`. */
function stanjeCijena(): { zadnjaNiv: number; cijenePrije: Map<number, number> } {
  return {
    zadnjaNiv: red('SELECT COALESCE(MAX(id), 0) AS m FROM nivelacije').m,
    cijenePrije: new Map<number, number>(redovi('SELECT id, cijena FROM products').map(p => [p.id, p.cijena])),
  };
}

/**
 * Operacija poslije `prije` je napravila tačno dokumente i promjene cijena iz
 * `pregled` (broj, datum, napomena, stavke; svaka promijenjena cijena je u
 * dokumentu ili bez zalihe; "cijena ostaje" stvarno ostaje).
 */
function ocekujUpisanPregled(pregled: any, { zadnjaNiv, cijenePrije }: ReturnType<typeof stanjeCijena>): void {
  const nastali = redovi('SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije WHERE id > ? ORDER BY id', zadnjaNiv).map(n => ({
    vrsta: n.primkaId === null ? 'protunivelacija' : 'nivelacija',
    brojNivelacije: n.brojNivelacije, datum: n.datum, napomena: n.napomena,
    stavke: redovi(`
      SELECT ns.productId, p.naziv AS productNaziv, ns.kolicina, ns.staraCijena, ns.novaCijena, ns.razlika, ns.ukupnaRazlika
      FROM nivelacija_stavke ns JOIN products p ON p.id = ns.productId
      WHERE ns.nivelacijaId = ? ORDER BY ns.id
    `, n.id),
  }));
  expect(pregled.dokumenti).toEqual(nastali);

  const promjene = redovi('SELECT id, cijena FROM products ORDER BY id')
    .filter(p => Math.abs(p.cijena - cijenePrije.get(p.id)!) > 0.001)
    .map(p => ({ productId: p.id, stara: cijenePrije.get(p.id), nova: p.cijena }));
  const najavljene = [...pregled.dokumenti.flatMap((d: any) => d.stavke), ...pregled.bezZalihe]
    .map((s: any) => ({ productId: s.productId, stara: s.staraCijena, nova: s.novaCijena }))
    .sort((x: any, y: any) => x.productId - y.productId);
  expect(najavljene).toEqual(promjene);

  // "Cijena u prodaji ostaje" — i stvarno ostaje.
  for (const o of pregled.cijenaOstaje) {
    expect(cijenePrije.get(o.productId)).toBe(o.cijena);
    expect(cijena(o.productId)).toBe(o.cijena);
  }
}

/**
 * Pregled pa prava operacija: pregled ne mijenja bazu, a dokumenti i promjene
 * cijena koje najavi su tačno one koje operacija napravi (broj, datum,
 * napomena, stavke; svaka promijenjena cijena je u dokumentu ili bez zalihe).
 */
async function pregledPaOperacija(op: Operacija): Promise<any> {
  const arg = op.kanal === 'primka:delete' ? op.id : op.data;
  const snimak = snimakBaze();
  const pregled = await b.call(KANAL_PREGLEDA[op.kanal], arg);
  expect(snimakBaze()).toEqual(snimak);
  // Ponovljiv: drugi pregled vidi istu bazu.
  expect(await b.call(KANAL_PREGLEDA[op.kanal], arg)).toEqual(pregled);

  // Spremanje kao iz ekrana: s potvrđenim pregledom — baza je ista, pa prolazi.
  const prije = stanjeCijena();
  const r = await b.call(op.kanal, arg, pregled);
  expect(r?.promijenjeno).toBeUndefined();
  ocekujUpisanPregled(pregled, prije);
  return pregled;
}

const naziv = (productId: number) => red('SELECT naziv FROM products WHERE id = ?', productId).naziv as string;

describe('primka: pregled promjena cijena', () => {
  test('nova primka: nivelacija za artikal sa zalihom, promjena bez dokumenta za artikal bez zalihe', async () => {
    const p = dodajArtikal('V1', 10, { stanje: 5 });
    const q = dodajArtikal('V2', 20);
    const m = dodajArtikal('V3', 0, { tip: 'materijal', stanje: 2 });
    const pregled = await pregledPaOperacija({ kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12), stavka(q, 1, 25), stavka(m, 1, 0)]) });
    expect(pregled).toEqual({
      dokumenti: [{ vrsta: 'nivelacija', brojNivelacije: niv(1), datum: danas(), napomena: null, stavke: [
        { productId: p, productNaziv: naziv(p), kolicina: 5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 10 },
      ] }],
      bezZalihe: [{ productId: q, productNaziv: naziv(q), staraCijena: 20, novaCijena: 25 }],
      cijenaOstaje: [],
    });
  });

  test('izmjena: uklonjena stavka sa zalihom → protunivelacija (zaliha bez robe iz primke)', async () => {
    const p = dodajArtikal('V4', 10, { stanje: 5 });
    const q = dodajArtikal('V5', 20, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12), stavka(q, 1, 22)]));

    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(q, 1, 22)]) } });
    expect(pregled).toEqual({
      dokumenti: [{ vrsta: 'protunivelacija', brojNivelacije: niv(2), datum: danas(), napomena: `Izmjena primke U-1: poništenje cijene (${niv(1)})`, stavke: [
        { productId: p, productNaziv: naziv(p), kolicina: 5, staraCijena: 12, novaCijena: 10, razlika: -2, ukupnaRazlika: -10 },
      ] }],
      bezZalihe: [],
      cijenaOstaje: [],
    });
  });

  test('izmjena: uklonjena stavka bez zalihe → cijena se vraća bez dokumenta', async () => {
    const p = dodajArtikal('V6', 10);
    const q = dodajArtikal('V7', 20);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12), stavka(q, 1, 20)]));

    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(q, 1, 20)]) } });
    expect(pregled).toEqual({ dokumenti: [], bezZalihe: [{ productId: p, productNaziv: naziv(p), staraCijena: 12, novaCijena: 10 }], cijenaOstaje: [] });
  });

  test('izmjena zadnje primke 12 → 15: nivelacija primke od cijene u prodaji', async () => {
    const p = dodajArtikal('V8', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(p, 3, 15)]) } });
    expect(pregled.dokumenti).toEqual([{ vrsta: 'nivelacija', brojNivelacije: niv(2), datum: danas(), napomena: 'Izmjena primke U-1', stavke: [
      { productId: p, productNaziv: naziv(p), kolicina: 5, staraCijena: 12, novaCijena: 15, razlika: 3, ukupnaRazlika: 15 },
    ] }]);
  });

  test('izmjena: nova cijena i uklonjena stavka zajedno → nivelacija i protunivelacija', async () => {
    const p = dodajArtikal('V9', 10, { stanje: 5 });
    const q = dodajArtikal('V10', 20, { stanje: 2 });
    const r = dodajArtikal('V11', 30);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12), stavka(q, 1, 22), stavka(r, 1, 33)]));

    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(q, 1, 25), stavka(r, 2, 35)]) } });
    expect(pregled.dokumenti.map((d: any) => [d.vrsta, d.stavke.map((s: any) => [s.productId, s.staraCijena, s.novaCijena])])).toEqual([
      ['nivelacija', [[q, 22, 25]]],
      ['protunivelacija', [[p, 12, 10]]],
    ]);
    expect(pregled.bezZalihe).toEqual([{ productId: r, productNaziv: naziv(r), staraCijena: 33, novaCijena: 35 }]);
  });

  test('izmjena samo količine: ništa se ne najavljuje', async () => {
    const p = dodajArtikal('V12', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(await pregledPaOperacija({ kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(p, 7, 12)]) } }))
      .toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('izmjena u sredini lanca: bez dokumenta, cijena u prodaji ostaje od C', async () => {
    const p = dodajArtikal('V13', 10);
    await primkaCijene('U-A', p, 12, 'sa');
    const bId = await primkaCijene('U-B', p, 14, 'bez');
    await primkaCijene('U-C', p, 16, 'sa');

    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id: bId, ...primka('U-B', [stavka(p, 1, 15)]) } });
    expect(pregled).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [{ productId: p, productNaziv: naziv(p), cijena: 16 }] });
  });

  test('izmjena koja u sredini lanca uklanja stavku: ništa se ne mijenja u prodaji', async () => {
    const p = dodajArtikal('V14', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    await primkaCijene('U-B', p, 14, 'sa');
    expect(await pregledPaOperacija({ kanal: 'primka:update', data: { id: a, ...primka('U-A', [stavka(q0(), 1, 1)]) } }))
      .toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('brisanje primke sa zalihom: protunivelacija na zalihi koja ostaje', async () => {
    const p = dodajArtikal('V15', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    expect(await pregledPaOperacija({ kanal: 'primka:delete', id })).toEqual({
      dokumenti: [{ vrsta: 'protunivelacija', brojNivelacije: niv(2), datum: danas(), napomena: `Poništenje primke U-1 (${niv(1)})`, stavke: [
        { productId: p, productNaziv: naziv(p), kolicina: 5, staraCijena: 12, novaCijena: 10, razlika: -2, ukupnaRazlika: -10 },
      ] }],
      bezZalihe: [],
      cijenaOstaje: [],
    });
  });

  test('brisanje primke bez zalihe: cijena se vraća bez dokumenta', async () => {
    const p = dodajArtikal('V16', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(await pregledPaOperacija({ kanal: 'primka:delete', id }))
      .toEqual({ dokumenti: [], bezZalihe: [{ productId: p, productNaziv: naziv(p), staraCijena: 12, novaCijena: 10 }], cijenaOstaje: [] });
  });

  test.each(KOMBINACIJE)('lanac A, B (%s): obriši A pa B — pregled svakog koraka je tačan', async (_, za, zb) => {
    const p = dodajArtikal('V17', 10);
    const a = await primkaCijene('U-A', p, 12, za);
    const bId = await primkaCijene('U-B', p, 14, zb);

    const prvi = await pregledPaOperacija({ kanal: 'primka:delete', id: a });
    expect(prvi).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
    const drugi = await pregledPaOperacija({ kanal: 'primka:delete', id: bId });
    expect([...drugi.dokumenti.flatMap((d: any) => d.stavke), ...drugi.bezZalihe].map((s: any) => [s.staraCijena, s.novaCijena])).toEqual([[14, 10]]);
  });

  test.each(KOMBINACIJE)('lanac A, B (%s): obriši B pa A — pregled svakog koraka je tačan', async (_, za, zb) => {
    const p = dodajArtikal('V18', 10);
    const a = await primkaCijene('U-A', p, 12, za);
    const bId = await primkaCijene('U-B', p, 14, zb);

    const prvi = await pregledPaOperacija({ kanal: 'primka:delete', id: bId });
    expect([...prvi.dokumenti.flatMap((d: any) => d.stavke), ...prvi.bezZalihe].map((s: any) => [s.staraCijena, s.novaCijena])).toEqual([[14, 12]]);
    const drugi = await pregledPaOperacija({ kanal: 'primka:delete', id: a });
    expect([...drugi.dokumenti.flatMap((d: any) => d.stavke), ...drugi.bezZalihe].map((s: any) => [s.staraCijena, s.novaCijena])).toEqual([[12, 10]]);
  });

  test('ručna izmjena poslije primke: brisanje ne mijenja cijenu, pregled je prazan', async () => {
    const p = dodajArtikal('V19', 10, { stanje: 2 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]));
    await b.call('product:update', p, { cijena: 13 });
    expect(await pregledPaOperacija({ kanal: 'primka:delete', id })).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('stara primka bez historije: brisanje → protunivelacija iz stare nivelacije', async () => {
    const p = dodajArtikal('V20', 12, { stanje: 4 });
    const a = staraPrimka('U-OLD', [{ productId: p, kolicina: 2, stara: 10, nova: 12, zaliha: 4 }]);
    const pregled = await pregledPaOperacija({ kanal: 'primka:delete', id: a });
    expect(pregled.dokumenti.map((d: any) => [d.vrsta, d.napomena, d.stavke.map((s: any) => [s.kolicina, s.staraCijena, s.novaCijena])])).toEqual([
      ['protunivelacija', 'Poništenje primke U-OLD (NIV-OLD-U-OLD)', [[4, 12, 10]]],
    ]);
  });

  test('stara primka bez historije: izmjena cijene 12 → 15 i uklonjena stavka', async () => {
    const p = dodajArtikal('V21', 12, { stanje: 4 });
    const q = dodajArtikal('V22', 22, { stanje: 1 });
    const a = staraPrimka('U-OLD', [{ productId: p, kolicina: 2, stara: 10, nova: 12, zaliha: 4 }, { productId: q, kolicina: 1, stara: 20, nova: 22, zaliha: 1 }]);
    const pregled = await pregledPaOperacija({ kanal: 'primka:update', data: { id: a, ...primka('U-OLD', [stavka(p, 2, 15)]) } });
    expect(pregled.dokumenti.map((d: any) => [d.vrsta, d.stavke.map((s: any) => [s.productId, s.kolicina, s.staraCijena, s.novaCijena])])).toEqual([
      ['nivelacija', [[p, 4, 12, 15]]],
      ['protunivelacija', [[q, 1, 22, 20]]],
    ]);
  });

  test('stara primka bez zapamćene cijene: pregled je prazan kao i promjena', async () => {
    const p = dodajArtikal('V23', 12);
    const id = dodajPrimku('U-OLD', '2025-01-10');
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 2, 12, 'E')").run(id, p);
    expect(await pregledPaOperacija({ kanal: 'primka:delete', id })).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('nepostojeća primka: pregled brisanja je prazan', async () => {
    expect(await pregledPaOperacija({ kanal: 'primka:delete', id: 999 })).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('pregled ne troši broj nivelacije ni id-eve: prava operacija dobija iste brojeve', async () => {
    const p = dodajArtikal('V24', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const seq = () => redovi('SELECT name, seq FROM sqlite_sequence ORDER BY name');
    const prije = seq();

    for (let i = 0; i < 3; i++) {
      await b.call('primka:pregledIzmjene', { id, ...primka('U-1', [stavka(p, 3, 15)]) });
      await b.call('primka:pregledBrisanja', id);
      await b.call('primka:pregledUnosa', primka('U-2', [stavka(p, 1, 20)]));
    }
    expect(seq()).toEqual(prije);
    expect(broj('nivelacije')).toBe(1);
    expect(broj('cijena_historija')).toBe(1);
    expect(stanje(p)).toBe(8);
    expect(cijena(p)).toBe(12);

    await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 15)]) });
    expect(nivelacijeDok().map(n => n.broj)).toEqual([niv(1), niv(2)]);
  });

  test('neispravni podaci: pregled vraća istu grešku kao operacija i ništa ne upisuje', async () => {
    const p = dodajArtikal('V25', 10, { stanje: 5 });
    await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const { id } = await b.call('primka:create', primka('U-2', [stavka(p, 1, 12)]));
    const snimak = snimakBaze();

    await expect(b.call('primka:pregledUnosa', primka('U-1', [stavka(p, 1, 15)]))).rejects.toThrow('Primka sa brojem "U-1" već postoji');
    await expect(b.call('primka:pregledIzmjene', { id, ...primka('U-1', [stavka(p, 1, 15)]) })).rejects.toThrow('Primka sa brojem "U-1" već postoji');
    await expect(b.call('primka:pregledIzmjene', { id, ...primka('U-2', []) })).rejects.toThrow('Primka mora imati najmanje jednu stavku');
    expect(snimakBaze()).toEqual(snimak);
  });
});

// ─── Spremanje tačno onoga što je korisnik potvrdio ─────────
//
// Pregled i spremanje nisu ista transakcija: između njih prodaja promijeni
// zalihu, druga primka ili ručna izmjena cijenu, prođe ponoć, neko uzme broj
// nivelacije. Ekran zato uz create/update/delete šalje potvrđeni pregled;
// backend u istoj transakciji izvrši operaciju, izračuna pregled nad
// rezultatom i uporedi. Razlika → ništa se ne upisuje, a vraća se
// { promijenjeno: true, pregled } s novim pregledom za ponovnu potvrdu.

/**
 * Spremanje s potvrđenim pregledom koje backend mora odbiti: ništa se ne
 * upiše, a vraćeni pregled je onaj koji bi pregled sada pokazao.
 */
async function ocekujOdbijeno(op: Operacija, potvrda: unknown): Promise<any> {
  const arg = op.kanal === 'primka:delete' ? op.id : op.data;
  const snimak = snimakBaze();
  const r = await b.call(op.kanal, arg, potvrda);
  expect(snimakBaze()).toEqual(snimak);
  expect(r).toEqual({ promijenjeno: true, pregled: await b.call(KANAL_PREGLEDA[op.kanal], arg) });
  expect(r.pregled).not.toEqual(potvrda);
  return r.pregled;
}

/** Ponovna potvrda novog pregleda: spremljeno, i to tačno taj pregled. */
async function ocekujSpremljeno(op: Operacija, potvrda: any): Promise<any> {
  const arg = op.kanal === 'primka:delete' ? op.id : op.data;
  const prije = stanjeCijena();
  const r = await b.call(op.kanal, arg, potvrda);
  expect(r?.promijenjeno).toBeUndefined();
  ocekujUpisanPregled(potvrda, prije);
  return r;
}

const pregledZa = (op: Operacija) => b.call(KANAL_PREGLEDA[op.kanal], op.kanal === 'primka:delete' ? op.id : op.data);

describe('primka: spremanje potvrđenog pregleda', () => {
  afterEach(() => { setSystemTime(); });

  test('create: ništa se ne mijenja → spremljeno, dokumenti jednaki pregledu', async () => {
    const p = dodajArtikal('P1', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);
    const r = await ocekujSpremljeno(op, pregled);
    expect(r).toEqual({ id: r.id, nivelacijaCreated: true });
    expect(pregled.dokumenti.map((d: any) => [d.brojNivelacije, d.stavke[0].kolicina])).toEqual([[niv(1), 5]]);
  });

  test('create: prodaja promijeni zalihu → odbijeno, ništa upisano; ponovna potvrda → spremljeno', async () => {
    const p = dodajArtikal('P2', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);

    izlaz(p, 2);
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].stavke[0]).toMatchObject({ kolicina: 3, staraCijena: 10, novaCijena: 12, ukupnaRazlika: 6 });

    await ocekujSpremljeno(op, novi);
    expect(broj('primke')).toBe(1);
  });

  test('create: druga primka promijeni cijenu između pregleda i spremanja → odbijeno', async () => {
    const p = dodajArtikal('P3', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);

    await b.call('primka:create', primka('U-2', [stavka(p, 1, 11)]));
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti.map((d: any) => [d.brojNivelacije, d.stavke[0].staraCijena, d.stavke[0].novaCijena])).toEqual([[niv(2), 11, 12]]);
    await ocekujSpremljeno(op, novi);
  });

  test('create: ručna izmjena cijene između pregleda i spremanja → odbijeno', async () => {
    const p = dodajArtikal('P4', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);

    await b.call('product:update', p, { cijena: 11 });
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].stavke[0]).toMatchObject({ staraCijena: 11, novaCijena: 12 });
  });

  test('create: zaliha prodana do nule → nivelacija se više ne pravi → odbijeno', async () => {
    const p = dodajArtikal('P5', 10, { stanje: 2 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti).toHaveLength(1);

    izlaz(p, 2);
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi).toEqual({ dokumenti: [], bezZalihe: [{ productId: p, productNaziv: naziv(p), staraCijena: 10, novaCijena: 12 }], cijenaOstaje: [] });
    await ocekujSpremljeno(op, novi);
  });

  test('create: zaliha bila 0 pa stigla roba → nivelacija sada nastaje → odbijeno', async () => {
    const p = dodajArtikal('P6', 10);
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti).toEqual([]);

    zaliha(p, 'sa');
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti.map((d: any) => d.vrsta)).toEqual(['nivelacija']);
    await ocekujSpremljeno(op, novi);
  });

  test('create: najavljeno "bez promjena cijena", a sada bi nastala nivelacija → odbijeno', async () => {
    const p = dodajArtikal('P7', 12, { stanje: 4 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 1, 12)]) };
    const pregled = await pregledZa(op);
    expect(pregled).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });

    await b.call('product:update', p, { cijena: 11 });
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].stavke[0]).toMatchObject({ staraCijena: 11, novaCijena: 12 });
  });

  test('create: najavljena nivelacija, a sada nema promjene cijene → odbijeno', async () => {
    const p = dodajArtikal('P8', 10, { stanje: 4 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 1, 12)]) };
    const pregled = await pregledZa(op);

    await b.call('product:update', p, { cijena: 12 });
    expect(await ocekujOdbijeno(op, pregled)).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('broj nivelacije pomjeren tuđom nivelacijom (sadržaj isti) → odbijeno, novi broj u pregledu', async () => {
    const p = dodajArtikal('P9', 10, { stanje: 5 });
    const q = dodajArtikal('P10', 20, { stanje: 1 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti[0].brojNivelacije).toBe(niv(1));

    await b.call('primka:create', primka('U-2', [stavka(q, 1, 22)]));
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].brojNivelacije).toBe(niv(2));
    expect(novi.dokumenti[0].stavke).toEqual(pregled.dokumenti[0].stavke);
    await ocekujSpremljeno(op, novi);
  });

  test('ponoć između pregleda i spremanja: datum nivelacije drugi → odbijeno', async () => {
    const p = dodajArtikal('P11', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    setSystemTime(new Date(2026, 4, 12, 23, 59, 50));
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti[0].datum).toBe('2026-05-12');

    setSystemTime(new Date(2026, 4, 13, 0, 0, 5));
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].datum).toBe('2026-05-13');
    await ocekujSpremljeno(op, novi);
  });

  test('nova godina između pregleda i spremanja: datum i broj nivelacije drugi → odbijeno', async () => {
    const p = dodajArtikal('P12', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    setSystemTime(new Date(2026, 11, 31, 23, 59, 50));
    await b.call('primka:create', primka('U-0', [stavka(dodajArtikal('P13', 1, { stanje: 1 }), 1, 2)]));
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti.map((d: any) => [d.brojNivelacije, d.datum])).toEqual([['NIV-2026-002', '2026-12-31']]);

    setSystemTime(new Date(2027, 0, 1, 0, 0, 5));
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti.map((d: any) => [d.brojNivelacije, d.datum])).toEqual([['NIV-2027-001', '2027-01-01']]);
  });

  test('update: prodaja promijeni zalihu → odbijeno; ponovna potvrda → spremljeno', async () => {
    const p = dodajArtikal('P14', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const op: Operacija = { kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(p, 3, 15)]) } };
    const pregled = await pregledZa(op);

    izlaz(p, 1);
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].stavke[0]).toMatchObject({ kolicina: 4, staraCijena: 12, novaCijena: 15 });
    expect(red('SELECT cijena FROM primka_stavke WHERE primkaId = ?', id).cijena).toBe(12);

    const r = await ocekujSpremljeno(op, novi);
    expect(r).toEqual({ id, nivelacijaCreated: true });
    expect(cijena(p)).toBe(15);
  });

  test('update: kasnija primka promijeni cijenu → izmjena više ne mijenja cijenu u prodaji → odbijeno', async () => {
    const p = dodajArtikal('P15', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const op: Operacija = { kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(p, 3, 15)]) } };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti).toHaveLength(1);

    await b.call('primka:create', primka('U-2', [stavka(p, 1, 13)]));
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [{ productId: p, productNaziv: naziv(p), cijena: 13 }] });
    await ocekujSpremljeno(op, novi);
    expect(cijena(p)).toBe(13);
  });

  test('update: prazan pregled (samo količina), a zaliha u međuvremenu stigla — i dalje prazno → spremljeno', async () => {
    const p = dodajArtikal('P16', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const op: Operacija = { kanal: 'primka:update', data: { id, ...primka('U-1', [stavka(p, 7, 12)]) } };
    const pregled = await pregledZa(op);
    expect(pregled).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
    izlaz(p, 1);
    await ocekujSpremljeno(op, pregled);
    expect(red('SELECT kolicina FROM primka_stavke WHERE primkaId = ?', id).kolicina).toBe(7);
  });

  test('delete: prodaja promijeni zalihu → odbijeno, primka ostaje; ponovna potvrda → obrisano', async () => {
    const p = dodajArtikal('P17', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const op: Operacija = { kanal: 'primka:delete', id };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti[0].stavke[0]).toMatchObject({ kolicina: 5, staraCijena: 12, novaCijena: 10 });

    izlaz(p, 2);
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti[0].stavke[0]).toMatchObject({ kolicina: 3, staraCijena: 12, novaCijena: 10 });
    expect(broj('primke')).toBe(1);

    await ocekujSpremljeno(op, novi);
    expect(broj('primke')).toBe(0);
    expect(cijena(p)).toBe(10);
  });

  test('delete: najavljena cijena bez dokumenta, a stigla roba → sada protunivelacija → odbijeno', async () => {
    const p = dodajArtikal('P18', 10);
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    izlaz(p, 3);
    const op: Operacija = { kanal: 'primka:delete', id };
    const pregled = await pregledZa(op);
    expect(pregled.dokumenti).toEqual([]);

    // Roba s ulaza je prodana; stiglo je 5 drugim putem — bez ove primke ostaje 2.
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 5, 'test', 0)").run(p);
    const novi = await ocekujOdbijeno(op, pregled);
    expect(novi.dokumenti.map((d: any) => [d.vrsta, d.stavke[0].kolicina])).toEqual([['protunivelacija', 2]]);
  });

  test('delete: ručna izmjena cijene poslije pregleda → brisanje više ne vraća cijenu → odbijeno', async () => {
    const p = dodajArtikal('P19', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const op: Operacija = { kanal: 'primka:delete', id };
    const pregled = await pregledZa(op);

    await b.call('product:update', p, { cijena: 13 });
    expect(await ocekujOdbijeno(op, pregled)).toEqual({ dokumenti: [], bezZalihe: [], cijenaOstaje: [] });
  });

  test('delete: ništa se ne mijenja → obrisano; povratna vrijednost ista kao bez potvrde', async () => {
    const p = dodajArtikal('P20', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const pregled = await pregledZa({ kanal: 'primka:delete', id });
    expect(await ocekujSpremljeno({ kanal: 'primka:delete', id }, pregled)).toBeNull();
  });

  test('naziv artikla nije dio poređenja: preimenovanje između pregleda i spremanja ne traži novu potvrdu', async () => {
    const p = dodajArtikal('P21', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    const pregled = await pregledZa(op);
    await b.call('product:update', p, { naziv: 'Novi naziv' });
    const r = await b.call(op.kanal, op.data, pregled);
    expect(r?.promijenjeno).toBeUndefined();
    expect(broj('nivelacije')).toBe(1);
  });

  test('neispravan potvrđeni pregled se tretira kao drugačiji: odbijeno, ništa upisano', async () => {
    const p = dodajArtikal('P22', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    await ocekujOdbijeno(op, {});
    await ocekujOdbijeno(op, { dokumenti: 'x' });
  });

  test('greška operacije ima prednost nad poređenjem: ista poruka kao bez potvrde', async () => {
    const p = dodajArtikal('P23', 10, { stanje: 5 });
    await b.call('primka:create', primka('U-1', [stavka(p, 1, 10)]));
    await expect(b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]), { dokumenti: [], bezZalihe: [], cijenaOstaje: [] }))
      .rejects.toThrow('Primka sa brojem "U-1" već postoji');
  });

  test('bez potvrđenog pregleda (stari klijent): sprema prema trenutnom stanju, bez provjere', async () => {
    const p = dodajArtikal('P24', 10, { stanje: 5 });
    const op: Operacija = { kanal: 'primka:create', data: primka('U-1', [stavka(p, 3, 12)]) };
    await pregledZa(op);
    izlaz(p, 2);
    const r = await b.call('primka:create', op.data);
    expect(r).toEqual({ id: r.id, nivelacijaCreated: true });
    expect(nivelacijeDok()[0].stavke[0].kolicina).toBe(3);
  });
});
