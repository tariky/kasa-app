// Ugovor za kanale primka:*, nivelacija:* i report:getData — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
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

  test('vraća cijenu iz stare nivelacije i pravi novu prema novim stavkama', async () => {
    const p = dodajArtikal('E4', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(cijena(p)).toBe(12);

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 4, 15)]) });
    expect(r.nivelacijaCreated).toBe(true);
    expect(cijena(p)).toBe(15);
    expect(stanje(p)).toBe(9);
    const niv = redovi('SELECT id, brojNivelacije FROM nivelacije WHERE primkaId = ?', id);
    expect(niv).toHaveLength(1);
    // Stara nivelacija je obrisana; nova dobija sljedeći broj.
    expect(niv[0].brojNivelacije).toBe(`NIV-${new Date().getFullYear()}-001`);
    expect(redovi('SELECT kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika FROM nivelacija_stavke'))
      .toEqual([{ kolicina: 5, staraCijena: 10, novaCijena: 15, razlika: 5, ukupnaRazlika: 25 }]);
  });

  test('vraćanjem na staru cijenu nestaje nivelacija i cijena se vraća', async () => {
    const p = dodajArtikal('E5', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));

    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 3, 10)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(10);
    expect(broj('nivelacije')).toBe(0);
    expect(broj('nivelacija_stavke')).toBe(0);
  });

  test('ne vraća cijenu koju je u međuvremenu promijenila kasnija primka', async () => {
    const p = dodajArtikal('E6', 10, { stanje: 5 });
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]))).id;
    await b.call('primka:create', primka('U-2', [stavka(p, 1, 14)]));
    expect(cijena(p)).toBe(14);

    await b.call('primka:update', { id: prva, ...primka('U-1', [stavka(p, 1, 14)]) });
    expect(cijena(p)).toBe(14);
    // Cijena primke se poklapa sa trenutnom, pa za prvu primku više nema nivelacije.
    expect(red('SELECT COUNT(*) AS n FROM nivelacije WHERE primkaId = ?', prva).n).toBe(0);
    expect(broj('nivelacije')).toBe(1);
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
  test('briše primku, stavke, ulaz na zalihu i njenu nivelaciju', async () => {
    const p = dodajArtikal('X1', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    const ostaje = (await b.call('primka:create', primka('U-2', [stavka(p, 1, 12)]))).id;

    expect(await b.call('primka:delete', id)).toBeNull();
    expect(red('SELECT COUNT(*) AS n FROM primke WHERE id = ?', id).n).toBe(0);
    expect(red('SELECT COUNT(*) AS n FROM primka_stavke WHERE primkaId = ?', id).n).toBe(0);
    expect(broj('nivelacije')).toBe(0);
    expect(broj('nivelacija_stavke')).toBe(0);
    expect(stanje(p)).toBe(6);
    expect(red('SELECT COUNT(*) AS n FROM primke WHERE id = ?', ostaje).n).toBe(1);
  });

  test('nepostojeća primka se tiho ignoriše', async () => {
    expect(await b.call('primka:delete', 999)).toBeNull();
  });

  test('vraća cijenu iz nivelacije obrisane primke', async () => {
    const p = dodajArtikal('X2', 10, { stanje: 5 });
    const { id } = await b.call('primka:create', primka('U-1', [stavka(p, 3, 12)]));
    expect(cijena(p)).toBe(12);

    await b.call('primka:delete', id);
    expect(cijena(p)).toBe(10);
    expect(stanje(p)).toBe(5);
    expect(broj('nivelacije')).toBe(0);
  });

  test('ne vraća cijenu koju je u međuvremenu promijenila kasnija primka', async () => {
    const p = dodajArtikal('X3', 10, { stanje: 5 });
    const prva = (await b.call('primka:create', primka('U-1', [stavka(p, 1, 12)]))).id;
    await b.call('primka:create', primka('U-2', [stavka(p, 1, 14)]));

    await b.call('primka:delete', prva);
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacije')).toBe(1);
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
    expect(broj('nivelacije')).toBe(0);
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

    // Stara nivelacija se vraća (12 → 10); nova cijena ide bez nivelacije jer zalihe nema.
    const r = await b.call('primka:update', { id, ...primka('U-1', [stavka(p, 1, 14)]) });
    expect(r.nivelacijaCreated).toBe(false);
    expect(cijena(p)).toBe(14);
    expect(broj('nivelacije')).toBe(0);
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

    await b.call('primka:delete', a);
    expect(cijena(p)).toBe(14);
    await b.call('primka:delete', bId);
    expect(cijena(p)).toBe(10);
    expect(broj('nivelacije')).toBe(0);
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

  test('update koji u sredini lanca mijenja cijenu: nova cijena važi odmah, brisanjem se lanac vraća bez nje', async () => {
    const p = dodajArtikal('L9', 10);
    const a = await primkaCijene('U-A', p, 12, 'sa');
    const bId = await primkaCijene('U-B', p, 14, 'bez');
    const c = await primkaCijene('U-C', p, 16, 'sa');

    // Izmjena = poništi staru primku pa upiši novu: nova cijena se upisuje sada.
    await b.call('primka:update', { id: bId, ...primka('U-B', [stavka(p, 1, 15)]) });
    expect(cijena(p)).toBe(15);
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
