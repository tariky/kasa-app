// Ugovor za kanale product:*, materijal:search, dobavljac:* i kupac:* — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, prijavi, ADMIN_PIN, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina s PIN-om 0000

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function broj(sql: string, ...params: any[]): number {
  return (b.db.prepare(sql).get(...params) as { n: number }).n;
}

function dodajArtikal(
  sifra: string,
  opts: { naziv?: string; cijena?: number; tip?: string; barkod?: string | null; stanje?: number } = {},
): number {
  const r = b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip) VALUES (?, ?, 'kom', ?, 'E', 1, ?, ?)"
  ).run(sifra, opts.naziv ?? `Artikal ${sifra}`, opts.cijena ?? 10, opts.barkod ?? null, opts.tip ?? 'artikal');
  const id = Number(r.lastInsertRowid);
  if (opts.stanje) {
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
      .run(id, opts.stanje);
  }
  return id;
}

function stanje(productId: number): number {
  return red(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `, productId).s;
}

function dodajDobavljaca(naziv: string, idBroj: string | null = null, pdvBroj: string | null = null): number {
  const r = b.db.prepare('INSERT INTO dobavljaci (naziv, idBroj, pdvBroj) VALUES (?, ?, ?)').run(naziv, idBroj, pdvBroj);
  return Number(r.lastInsertRowid);
}

function dodajKupca(naziv: string, idBroj: string, kontakt: string | null = null): number {
  const r = b.db.prepare('INSERT INTO kupci (naziv, idBroj, kontakt) VALUES (?, ?, ?)').run(naziv, idBroj, kontakt);
  return Number(r.lastInsertRowid);
}

function dodajPrimku(brojPrimke: string, dobavljacNaziv: string | null, dobavljacId: string | null, productId?: number): number {
  const r = b.db.prepare("INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId) VALUES (?, '2026-01-10', ?, ?)")
    .run(brojPrimke, dobavljacNaziv, dobavljacId);
  const id = Number(r.lastInsertRowid);
  if (productId) {
    b.db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 5, 'E')")
      .run(id, productId);
  }
  return id;
}

function dodajRacun(productId: number | null, kupacIdBroj: string | null = null): number {
  const r = b.db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, kupacIdBroj) VALUES (?, 10, 0, 'Gotovina', 'completed', ?)"
  ).run(ADMIN, kupacIdBroj);
  const id = Number(r.lastInsertRowid);
  if (productId) {
    b.db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 10, 'E')").run(id, productId);
  }
  return id;
}

function sifre(lista: any[]): string[] {
  return lista.map(p => p.sifra);
}

const noviArtikal = (extra: Record<string, unknown> = {}) =>
  ({ sifra: 'N1', naziv: 'Novi artikal', cijena: 12.5, pdvStopa: 'E', ...extra });

// ─── product:create ─────────────────────────────────────────

describe('product:create', () => {
  test('upisuje artikal i vraća samo id', async () => {
    const r = await b.call('product:create', noviArtikal({ plu: 7, barkod: '3871234567890' }));

    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    expect(red('SELECT sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip, plocaSirina, plocaVisina FROM products WHERE id = ?', r.id))
      .toEqual({
        sifra: 'N1', naziv: 'Novi artikal', jm: 'kom', cijena: 12.5, pdvStopa: 'E', plu: 7,
        barkod: '3871234567890', tip: 'artikal', plocaSirina: null, plocaVisina: null,
      });
    // Novi artikal nema kretanja zalihe; kanal ne dira fiskalni uređaj.
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements')).toBe(0);
    expect(b.tring.zahtjevi).toHaveLength(0);
  });

  test('podrazumijevana jedinica mjere zavisi od tipa, nepoznat tip postaje artikal', async () => {
    const u = await b.call('product:create', noviArtikal({ sifra: 'U1', tip: 'usluga' }));
    const m = await b.call('product:create', noviArtikal({ sifra: 'M1', tip: 'materijal', jm: 'm2', plocaSirina: 2800, plocaVisina: 2070 }));
    const x = await b.call('product:create', noviArtikal({ sifra: 'X1', tip: 'nešto' }));

    expect(red('SELECT tip, jm FROM products WHERE id = ?', u.id)).toEqual({ tip: 'usluga', jm: 'usl' });
    expect(red('SELECT tip, jm, plocaSirina, plocaVisina FROM products WHERE id = ?', m.id))
      .toEqual({ tip: 'materijal', jm: 'm2', plocaSirina: 2800, plocaVisina: 2070 });
    expect(red('SELECT tip, jm, plu, barkod FROM products WHERE id = ?', x.id))
      .toEqual({ tip: 'artikal', jm: 'kom', plu: null, barkod: null });
  });

  test('cijena nula je dozvoljena', async () => {
    const r = await b.call('product:create', noviArtikal({ cijena: 0 }));
    expect(red('SELECT cijena FROM products WHERE id = ?', r.id).cijena).toBe(0);
  });

  test('validira obavezna polja', async () => {
    await expect(b.call('product:create', noviArtikal({ sifra: '  ' }))).rejects.toThrow('Šifra artikla je obavezna');
    await expect(b.call('product:create', noviArtikal({ sifra: undefined }))).rejects.toThrow('Šifra artikla je obavezna');
    await expect(b.call('product:create', noviArtikal({ naziv: '' }))).rejects.toThrow('Naziv artikla je obavezan');
    await expect(b.call('product:create', noviArtikal({ cijena: -1 }))).rejects.toThrow('Cijena mora biti pozitivan broj');
    await expect(b.call('product:create', noviArtikal({ cijena: null }))).rejects.toThrow('Cijena mora biti pozitivan broj');
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(0);
  });

  test('odbija nepoznatu PDV stopu (samo E i K)', async () => {
    await expect(b.call('product:create', noviArtikal({ pdvStopa: 'A' }))).rejects.toThrow('PDV stopa mora biti E ili K');
    await expect(b.call('product:create', noviArtikal({ pdvStopa: undefined }))).rejects.toThrow('PDV stopa mora biti E ili K');
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(0);
  });

  test('PLU: cijeli broj od 0 do 999999 (Tringovo pravilo) ili prazno', async () => {
    const PLU = 'PLU mora biti cijeli broj od 0 do 999999';
    for (const los of [-1, 1_000_000, 1.5, 'abc', '12a', '1e3', true, [1], { n: 1 }]) {
      await expect(b.call('product:create', noviArtikal({ plu: los }))).rejects.toThrow(PLU);
    }
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(0);

    const plu = async (sifra: string, v: unknown) =>
      red('SELECT plu FROM products WHERE id = ?', (await b.call('product:create', noviArtikal({ sifra, plu: v }))).id).plu;
    expect(await plu('A0', 0)).toBe(0);
    expect(await plu('A1', 999_999)).toBe(999_999);
    expect(await plu('A2', ' 42 ')).toBe(42);
    expect(await plu('A3', '')).toBeNull();
    expect(await plu('A4', null)).toBeNull();

    const id = dodajArtikal('U1');
    await expect(b.call('product:update', id, { plu: 1_000_000 })).rejects.toThrow(PLU);
    await expect(b.call('product:update', id, { plu: '7.5' })).rejects.toThrow(PLU);
    expect(red('SELECT plu FROM products WHERE id = ?', id).plu).toBe(1);
    await b.call('product:update', id, { plu: '12' });
    expect(red('SELECT plu FROM products WHERE id = ?', id).plu).toBe(12);
    await b.call('product:update', id, { plu: '' });
    expect(red('SELECT plu FROM products WHERE id = ?', id).plu).toBeNull();
    await b.call('product:update', id, { naziv: 'Bez PLU-a u izmjeni' });
    expect(red('SELECT plu FROM products WHERE id = ?', id).plu).toBeNull();
  });

  test('odbija duplikat šifre i barkoda', async () => {
    dodajArtikal('D1', { barkod: '111' });
    await expect(b.call('product:create', noviArtikal({ sifra: 'D1' }))).rejects.toThrow('Artikal sa šifrom "D1" već postoji');
    // Poruka prenosi unos kakav je poslan, a provjera ide po trimovanoj vrijednosti.
    await expect(b.call('product:create', noviArtikal({ sifra: ' D1 ' }))).rejects.toThrow('Artikal sa šifrom " D1 " već postoji');
    await expect(b.call('product:create', noviArtikal({ barkod: '111' }))).rejects.toThrow('Artikal sa barkodom "111" već postoji');
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(1);
  });

  test('prazan barkod ne provjerava duplikate', async () => {
    dodajArtikal('B1', { barkod: '' });
    const r = await b.call('product:create', noviArtikal({ barkod: '' }));
    expect(typeof r.id).toBe('number');
  });

  test('trimuje šifru, naziv i barkod pri upisu, pa ih provjera duplikata vidi', async () => {
    const r = await b.call('product:create', noviArtikal({ sifra: ' N1 ', naziv: '  Novi artikal ', barkod: ' 555 ' }));
    expect(red('SELECT sifra, naziv, barkod FROM products WHERE id = ?', r.id))
      .toEqual({ sifra: 'N1', naziv: 'Novi artikal', barkod: '555' });

    await expect(b.call('product:create', noviArtikal({ sifra: 'N1' }))).rejects.toThrow('Artikal sa šifrom "N1" već postoji');
    await expect(b.call('product:create', noviArtikal({ sifra: ' N1 ' }))).rejects.toThrow('Artikal sa šifrom " N1 " već postoji');
    await expect(b.call('product:create', noviArtikal({ sifra: 'N2', barkod: '555' }))).rejects.toThrow('Artikal sa barkodom "555" već postoji');
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(1);
  });
});

// ─── product:get ────────────────────────────────────────────

describe('product:get', () => {
  test('vraća red iz products bez stanja', async () => {
    const id = dodajArtikal('G1', { naziv: 'Čokolada', cijena: 3.2, barkod: '999', stanje: 5 });
    const p = await b.call('product:get', id);

    expect(p).toMatchObject({
      id, sifra: 'G1', naziv: 'Čokolada', jm: 'kom', cijena: 3.2, pdvStopa: 'E', plu: 1,
      barkod: '999', tip: 'artikal', plocaSirina: null, plocaVisina: null,
    });
    expect(typeof p.createdAt).toBe('string');
    expect(typeof p.updatedAt).toBe('string');
    expect('stanje' in p).toBe(false);
  });

  test('nepostojeći id ne vraća artikal', async () => {
    // Electron (better-sqlite3) vraća undefined, bun:sqlite null — renderer oboje tretira kao "nema".
    expect((await b.call('product:get', 999)) ?? null).toBeNull();
  });
});

// ─── product:getAll ─────────────────────────────────────────

describe('product:getAll', () => {
  test('vraća sve artikle sortirane po nazivu, sa izračunatim stanjem', async () => {
    const a = dodajArtikal('A1', { naziv: 'Zeleni', stanje: 10 });
    dodajArtikal('A2', { naziv: 'Bijeli' });
    dodajArtikal('U1', { naziv: 'Montaža', tip: 'usluga' });
    dodajArtikal('M1', { naziv: 'Iverica', tip: 'materijal', stanje: 3 });
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', 4, 'test', 0)").run(a);

    const lista = await b.call('product:getAll');
    expect(lista.map((p: any) => [p.naziv, p.stanje])).toEqual([
      ['Bijeli', 0], ['Iverica', 3], ['Montaža', 0], ['Zeleni', 6],
    ]);
    expect(lista[0]).toMatchObject({ sifra: 'A2', jm: 'kom', cijena: 10, pdvStopa: 'E', tip: 'artikal' });
  });

  test('filtrira po tipu; nepoznat tip se tretira kao artikal', async () => {
    dodajArtikal('A1', { naziv: 'A' });
    dodajArtikal('U1', { naziv: 'U', tip: 'usluga' });
    dodajArtikal('M1', { naziv: 'M', tip: 'materijal' });

    expect(sifre(await b.call('product:getAll', 'usluga'))).toEqual(['U1']);
    expect(sifre(await b.call('product:getAll', 'materijal'))).toEqual(['M1']);
    expect(sifre(await b.call('product:getAll', 'artikal'))).toEqual(['A1']);
    expect(sifre(await b.call('product:getAll', 'nepoznat'))).toEqual(['A1']);
    // Prazan string = bez filtera.
    expect(sifre(await b.call('product:getAll', ''))).toEqual(['A1', 'M1', 'U1']);
  });

  test('prazna baza vraća prazan niz', async () => {
    expect(await b.call('product:getAll')).toEqual([]);
  });
});

// ─── product:update ─────────────────────────────────────────

describe('product:update', () => {
  test('mijenja samo poslana polja i osvježava updatedAt', async () => {
    const id = dodajArtikal('P1', { naziv: 'Staro', cijena: 5, barkod: '123' });
    b.db.prepare("UPDATE products SET updatedAt = '2000-01-01 00:00:00' WHERE id = ?").run(id);

    const r = await b.call('product:update', id, { naziv: 'Novo', cijena: 7.5, pdvStopa: 'K', jm: 'l', plu: 9 });
    expect(r).toEqual({ changes: 1 });
    const p = red('SELECT * FROM products WHERE id = ?', id);
    expect(p).toMatchObject({ sifra: 'P1', naziv: 'Novo', cijena: 7.5, pdvStopa: 'K', jm: 'l', plu: 9, barkod: '123', tip: 'artikal' });
    expect(p.updatedAt).not.toBe('2000-01-01 00:00:00');
  });

  test('prazan objekat ne radi ništa', async () => {
    const id = dodajArtikal('P1');
    b.db.prepare("UPDATE products SET updatedAt = '2000-01-01 00:00:00' WHERE id = ?").run(id);
    expect(await b.call('product:update', id, {})).toEqual({ changes: 0 });
    expect(red('SELECT updatedAt FROM products WHERE id = ?', id).updatedAt).toBe('2000-01-01 00:00:00');
  });

  test('nepostojeći id vraća changes 0', async () => {
    expect(await b.call('product:update', 999, { naziv: 'X' })).toEqual({ changes: 0 });
  });

  test('barkod se može obrisati sa null, a tip se normalizuje', async () => {
    const id = dodajArtikal('P1', { barkod: '123' });
    await b.call('product:update', id, { barkod: null, tip: 'usluga' });
    expect(red('SELECT barkod, tip FROM products WHERE id = ?', id)).toEqual({ barkod: null, tip: 'usluga' });
    await b.call('product:update', id, { tip: 'svašta' });
    expect(red('SELECT tip FROM products WHERE id = ?', id).tip).toBe('artikal');
  });

  test('dimenzije ploče se postavljaju i brišu', async () => {
    const id = dodajArtikal('M1', { tip: 'materijal' });
    await b.call('product:update', id, { plocaSirina: 2800, plocaVisina: 2070 });
    expect(red('SELECT plocaSirina, plocaVisina FROM products WHERE id = ?', id)).toEqual({ plocaSirina: 2800, plocaVisina: 2070 });
    await b.call('product:update', id, { plocaSirina: null, plocaVisina: null });
    expect(red('SELECT plocaSirina, plocaVisina FROM products WHERE id = ?', id)).toEqual({ plocaSirina: null, plocaVisina: null });
  });

  test('odbija šifru ili barkod koji ima drugi artikal, a dozvoljava vlastite', async () => {
    dodajArtikal('P1', { barkod: '111' });
    const id = dodajArtikal('P2', { barkod: '222' });

    await expect(b.call('product:update', id, { sifra: 'P1' })).rejects.toThrow('Artikal sa šifrom "P1" već postoji');
    await expect(b.call('product:update', id, { barkod: '111' })).rejects.toThrow('Artikal sa barkodom "111" već postoji');
    expect(await b.call('product:update', id, { sifra: 'P2', barkod: '222' })).toEqual({ changes: 1 });
    expect(red('SELECT sifra, barkod FROM products WHERE id = ?', id)).toEqual({ sifra: 'P2', barkod: '222' });
  });

  test('greška u validaciji ne mijenja ništa', async () => {
    dodajArtikal('P1');
    const id = dodajArtikal('P2', { naziv: 'Original' });
    await expect(b.call('product:update', id, { naziv: 'Promijenjeno', sifra: 'P1' })).rejects.toThrow('već postoji');
    expect(red('SELECT naziv FROM products WHERE id = ?', id).naziv).toBe('Original');
  });

  test('validira poslana polja kao create i ništa ne mijenja kad odbije', async () => {
    const id = dodajArtikal('P1', { naziv: 'Original', cijena: 5 });

    await expect(b.call('product:update', id, { sifra: '  ' })).rejects.toThrow('Šifra artikla je obavezna');
    await expect(b.call('product:update', id, { sifra: null })).rejects.toThrow('Šifra artikla je obavezna');
    await expect(b.call('product:update', id, { naziv: '' })).rejects.toThrow('Naziv artikla je obavezan');
    await expect(b.call('product:update', id, { cijena: -1 })).rejects.toThrow('Cijena mora biti pozitivan broj');
    await expect(b.call('product:update', id, { cijena: null })).rejects.toThrow('Cijena mora biti pozitivan broj');
    await expect(b.call('product:update', id, { pdvStopa: 'A' })).rejects.toThrow('PDV stopa mora biti E ili K');
    await expect(b.call('product:update', id, { naziv: 'Novo', cijena: -1 })).rejects.toThrow('Cijena mora biti pozitivan broj');

    expect(red('SELECT sifra, naziv, cijena, pdvStopa FROM products WHERE id = ?', id))
      .toEqual({ sifra: 'P1', naziv: 'Original', cijena: 5, pdvStopa: 'E' });
  });

  test('trimuje šifru, naziv i barkod; duplikat se traži po trimovanoj vrijednosti', async () => {
    dodajArtikal('P1', { barkod: '111' });
    const id = dodajArtikal('P2');

    await expect(b.call('product:update', id, { sifra: ' P1 ' })).rejects.toThrow('Artikal sa šifrom " P1 " već postoji');
    await expect(b.call('product:update', id, { barkod: ' 111 ' })).rejects.toThrow('Artikal sa barkodom " 111 " već postoji');
    expect(await b.call('product:update', id, { sifra: ' P3 ', naziv: '  Novi naziv ', barkod: ' 222 ' })).toEqual({ changes: 1 });
    expect(red('SELECT sifra, naziv, barkod FROM products WHERE id = ?', id)).toEqual({ sifra: 'P3', naziv: 'Novi naziv', barkod: '222' });
    // Nedirana polja ne smetaju: update samo cijene ne traži šifru ni naziv.
    expect(await b.call('product:update', id, { cijena: 0 })).toEqual({ changes: 1 });
  });
});

// ─── product:delete ─────────────────────────────────────────

describe('product:delete', () => {
  test('briše artikal koji se nigdje ne koristi', async () => {
    const id = dodajArtikal('D1');
    expect(await b.call('product:delete', id)).toEqual({ changes: 1 });
    expect(red('SELECT id FROM products WHERE id = ?', id)).toBeNull();
  });

  test('nepostojeći id vraća changes 0', async () => {
    expect(await b.call('product:delete', 999)).toEqual({ changes: 0 });
  });

  test('ne briše artikal sa računa', async () => {
    const id = dodajArtikal('D1');
    dodajRacun(id);
    await expect(b.call('product:delete', id)).rejects.toThrow('Artikal se koristi u računima i ne može biti obrisan');
    expect(red('SELECT id FROM products WHERE id = ?', id)).not.toBeNull();
  });

  test('ne briše artikal sa primke', async () => {
    const id = dodajArtikal('D1');
    dodajPrimku('P-1', 'Dobavljač', null, id);
    await expect(b.call('product:delete', id)).rejects.toThrow('Artikal se koristi u primkama i ne može biti obrisan');
  });

  test('ne briše artikal iz normativa ili radnog naloga', async () => {
    const poruka = 'Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan';
    const proizvod = dodajArtikal('PR1');
    const materijal = dodajArtikal('MT1', { tip: 'materijal' });
    b.db.prepare('INSERT INTO normativi (productId, materijalId, kolicina) VALUES (?, ?, 2)').run(proizvod, materijal);
    await expect(b.call('product:delete', proizvod)).rejects.toThrow(poruka);
    await expect(b.call('product:delete', materijal)).rejects.toThrow(poruka);

    const materijal2 = dodajArtikal('MT2', { tip: 'materijal' });
    const proizvod2 = dodajArtikal('PR2');
    const nalog = Number(b.db.prepare(
      "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, opis, productId, korisnikId) VALUES (1, 2026, '2026-01-10', 'zaliha', 'Test', ?, ?)"
    ).run(proizvod2, ADMIN).lastInsertRowid);
    b.db.prepare('INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina) VALUES (?, ?, 1)').run(nalog, materijal2);
    await expect(b.call('product:delete', materijal2)).rejects.toThrow(poruka);
    await expect(b.call('product:delete', proizvod2)).rejects.toThrow(poruka);
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(4);
  });

  test('ne briše artikal s kretanjima zalihe, stavkom ponude, nivelacije ili priloga — i ništa ne briše kaskadno', async () => {
    const saKorekcijom = dodajArtikal('K1');
    await b.call('product:adjustStock', saKorekcijom, 5);
    await expect(b.call('product:delete', saKorekcijom)).rejects.toThrow('Artikal ima kretanja zalihe i ne može biti obrisan');

    const uPonudi = dodajArtikal('PO1');
    const kupac = dodajKupca('Kupac', '4200000000001');
    const ponuda = Number(b.db.prepare(
      "INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos) VALUES (1, 2026, ?, ?, '2026-01-10', '2026-02-10', 10, 0)"
    ).run(kupac, ADMIN).lastInsertRowid);
    b.db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 10, 'E')").run(ponuda, uPonudi);
    await expect(b.call('product:delete', uPonudi)).rejects.toThrow('Artikal se koristi u ponudama i ne može biti obrisan');

    const uNivelaciji = dodajArtikal('NI1');
    const nivelacija = Number(b.db.prepare("INSERT INTO nivelacije (brojNivelacije, datum) VALUES ('N-1', '2026-01-10')").run().lastInsertRowid);
    b.db.prepare(
      "INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 0, 10, 12, 2, 0, 'E')"
    ).run(nivelacija, uNivelaciji);
    await expect(b.call('product:delete', uNivelaciji)).rejects.toThrow('Artikal se koristi u nivelacijama i ne može biti obrisan');

    const uPrilogu = dodajArtikal('PL1');
    const racun = dodajRacun(null);
    b.db.prepare("INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 1, 10, 'E')").run(racun, uPrilogu);
    await expect(b.call('product:delete', uPrilogu)).rejects.toThrow('Artikal se koristi u prilozima i ne može biti obrisan');

    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(4);
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements')).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke')).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM nivelacija_stavke')).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM prilog_stavke')).toBe(1);
  });
});

// ─── product:adjustStock ────────────────────────────────────

describe('product:adjustStock', () => {
  test('povećanje stanja upisuje ulaz za razliku', async () => {
    const id = dodajArtikal('S1', { stanje: 4 });
    expect(await b.call('product:adjustStock', id, 10)).toEqual({ changes: 1 });
    expect(red("SELECT tip, kolicina, referenceType, referenceId FROM stock_movements WHERE referenceType = 'adjustment'"))
      .toEqual({ tip: 'ulaz', kolicina: 6, referenceType: 'adjustment', referenceId: 0 });
    expect(stanje(id)).toBe(10);
  });

  test('smanjenje stanja upisuje izlaz, i ispod nule', async () => {
    const id = dodajArtikal('S1', { stanje: 4 });
    await b.call('product:adjustStock', id, 1.5);
    expect(red("SELECT tip, kolicina FROM stock_movements WHERE referenceType = 'adjustment'")).toEqual({ tip: 'izlaz', kolicina: 2.5 });
    expect(stanje(id)).toBe(1.5);

    await b.call('product:adjustStock', id, -2);
    expect(stanje(id)).toBe(-2);
  });

  test('isto stanje ne upisuje ništa', async () => {
    const id = dodajArtikal('S1', { stanje: 4 });
    expect(await b.call('product:adjustStock', id, 4)).toEqual({ changes: 0 });
    expect(broj("SELECT COUNT(*) AS n FROM stock_movements WHERE referenceType = 'adjustment'")).toBe(0);
  });

  test('nepostojeći artikal se odbija jasnom porukom', async () => {
    await expect(b.call('product:adjustStock', 999, 5)).rejects.toThrow('Artikal ne postoji');
    await expect(b.call('product:adjustStock', 999, 0)).rejects.toThrow('Artikal ne postoji');
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements')).toBe(0);
  });
});

// ─── product:search ─────────────────────────────────────────

describe('product:search', () => {
  test('traži po nazivu, šifri i barkodu (podstring), sa stanjem', async () => {
    dodajArtikal('KAF-01', { naziv: 'Kafa mljevena', barkod: '3870001', stanje: 7 });
    dodajArtikal('CAJ-01', { naziv: 'Čaj od nane', barkod: '3870002' });
    dodajArtikal('SEC-01', { naziv: 'Šećer', barkod: '5550003' });

    const poNazivu = await b.call('product:search', 'mljev');
    expect(sifre(poNazivu)).toEqual(['KAF-01']);
    expect(poNazivu[0].stanje).toBe(7);
    expect(sifre(await b.call('product:search', 'CAJ'))).toEqual(['CAJ-01']);
    expect(sifre(await b.call('product:search', '5550'))).toEqual(['SEC-01']);
    // Više pogodaka dolazi sortirano po nazivu, binarno (UTF-8): "Kafa" ide prije "Čaj".
    expect(sifre(await b.call('product:search', '387'))).toEqual(['KAF-01', 'CAJ-01']);
  });

  test('ASCII pretraga ne razlikuje velika i mala slova', async () => {
    dodajArtikal('A1', { naziv: 'Kafa' });
    expect(sifre(await b.call('product:search', 'KAFA'))).toEqual(['A1']);
    expect(sifre(await b.call('product:search', 'a1'))).toEqual(['A1']);
  });

  test('ne vraća materijal, ali vraća usluge', async () => {
    dodajArtikal('A1', { naziv: 'Ploča artikal' });
    dodajArtikal('U1', { naziv: 'Ploča rezanje', tip: 'usluga' });
    dodajArtikal('M1', { naziv: 'Ploča iverica', tip: 'materijal' });
    expect(sifre(await b.call('product:search', 'Ploča'))).toEqual(['A1', 'U1']);
  });

  test('prazan upit vraća sve osim materijala; bez pogodaka vraća prazan niz', async () => {
    dodajArtikal('A1', { naziv: 'B' });
    dodajArtikal('A2', { naziv: 'A' });
    dodajArtikal('M1', { naziv: 'C', tip: 'materijal' });
    expect(sifre(await b.call('product:search', ''))).toEqual(['A2', 'A1']);
    expect(await b.call('product:search', 'nema')).toEqual([]);
  });
});

// ─── product:slobodan ───────────────────────────────────────

describe('product:slobodan', () => {
  const slobodna = (extra: Record<string, unknown> = {}) =>
    ({ naziv: 'Popravak rajsferšlusa', cijena: 7.5, pdvStopa: 'E', ...extra });

  test('pravi skriveni artikal bez zalihe s automatskom šifrom i vraća ga sa stanjem', async () => {
    const p = await b.call('product:slobodan', slobodna({ naziv: '  Popravak rajsferšlusa ' }));

    expect(p).toMatchObject({
      sifra: 'S000001', naziv: 'Popravak rajsferšlusa', jm: 'kom', cijena: 7.5, pdvStopa: 'E',
      plu: null, barkod: null, tip: 'usluga', slobodan: 1, stanje: 0,
    });
    expect(red('SELECT id FROM products WHERE sifra = ?', 'S000001').id).toBe(p.id);
    // Artikal se upisuje u uređaj tek s računom; kanal ne dira fiskalni uređaj.
    expect(b.tring.zahtjevi).toHaveLength(0);
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements')).toBe(0);
  });

  test('isti naziv, stopa i JM koriste postojeći artikal — samo se cijena mijenja, bez historije cijena', async () => {
    const prvi = await b.call('product:slobodan', slobodna());
    const drugi = await b.call('product:slobodan', slobodna({ naziv: 'popravak RAJSFERŠLUSA', cijena: 9 }));

    expect(drugi.id).toBe(prvi.id);
    // Naziv ostaje kako je prvi put upisan: uređaj ne smije dobiti drugi naziv na istom artiklu.
    expect(drugi).toMatchObject({ sifra: 'S000001', naziv: 'Popravak rajsferšlusa', cijena: 9 });
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM cijena_historija')).toBe(0);
  });

  test('druga stopa ili JM daju novi artikal', async () => {
    const e = await b.call('product:slobodan', slobodna());
    const k = await b.call('product:slobodan', slobodna({ pdvStopa: 'K' }));
    const m = await b.call('product:slobodan', slobodna({ jm: 'm' }));

    expect(new Set([e.id, k.id, m.id]).size).toBe(3);
    expect([e.sifra, k.sifra, m.sifra]).toEqual(['S000001', 'S000002', 'S000003']);
    expect(m.jm).toBe('m');
  });

  test('ne dira obične artikle istog naziva', async () => {
    const obican = dodajArtikal('A1', { naziv: 'Popravak rajsferšlusa', tip: 'usluga' });
    const p = await b.call('product:slobodan', slobodna());
    expect(p.id).not.toBe(obican);
    expect(red('SELECT cijena FROM products WHERE id = ?', obican).cijena).toBe(10);
  });

  test('preskače šifru koju već ima obični artikal', async () => {
    dodajArtikal('S000001');
    const p = await b.call('product:slobodan', slobodna());
    expect(p.sifra).toBe('S000002');
    const q = await b.call('product:slobodan', slobodna({ naziv: 'Drugo' }));
    expect(q.sifra).toBe('S000003');
  });

  test('validira naziv, cijenu i stopu prije upisa', async () => {
    await expect(b.call('product:slobodan', slobodna({ naziv: '   ' }))).rejects.toThrow('Naziv stavke je obavezan');
    await expect(b.call('product:slobodan', slobodna({ naziv: 'x'.repeat(33) }))).rejects.toThrow('Naziv stavke može imati najviše 32 znaka');
    await expect(b.call('product:slobodan', slobodna({ cijena: 0 }))).rejects.toThrow('Cijena mora biti između 0,01 i 9.999.999,99');
    await expect(b.call('product:slobodan', slobodna({ cijena: 10_000_000 }))).rejects.toThrow('Cijena mora biti između 0,01 i 9.999.999,99');
    await expect(b.call('product:slobodan', slobodna({ cijena: null }))).rejects.toThrow('Cijena mora biti između 0,01 i 9.999.999,99');
    await expect(b.call('product:slobodan', slobodna({ pdvStopa: 'A' }))).rejects.toThrow('PDV stopa mora biti E ili K');
    expect(broj('SELECT COUNT(*) AS n FROM products')).toBe(0);
  });

  test('slobodni artikli se ne vide u šifarniku ni pretrazi, ali product:get ih vraća', async () => {
    dodajArtikal('U1', { naziv: 'Popravak jakne', tip: 'usluga' });
    const p = await b.call('product:slobodan', slobodna());

    expect(sifre(await b.call('product:getAll'))).toEqual(['U1']);
    expect(sifre(await b.call('product:getAll', 'usluga'))).toEqual(['U1']);
    expect(sifre(await b.call('product:search', 'popravak'))).toEqual(['U1']);
    expect((await b.call('product:get', p.id)).naziv).toBe('Popravak rajsferšlusa');
  });
});

// ─── Šifre dobavljača ───────────────────────────────────────

function dodajSifru(productId: number, dobavljacId: number, sifra: string | null): void {
  b.db.prepare('INSERT INTO artikal_dobavljac_sifre (productId, dobavljacId, sifra) VALUES (?, ?, ?)')
    .run(productId, dobavljacId, sifra);
}

function sifreArtikla(productId: number): any[] {
  return b.db.prepare('SELECT dobavljacId, sifra FROM artikal_dobavljac_sifre WHERE productId = ? ORDER BY dobavljacId')
    .all(productId);
}

describe('product:getDobavljacSifre', () => {
  test('vraća šifre artikla s nazivom dobavljača, sortirano po dobavljaču', async () => {
    const a = dodajArtikal('A1');
    const drugi = dodajArtikal('A2');
    const zeta = dodajDobavljaca('Zeta');
    const alfa = dodajDobavljaca('Alfa');
    dodajSifru(a, zeta, 'Z-100');
    dodajSifru(a, alfa, null);
    dodajSifru(drugi, alfa, 'A-7');

    expect(await b.call('product:getDobavljacSifre', a)).toEqual([
      { dobavljacId: alfa, dobavljacNaziv: 'Alfa', sifra: null },
      { dobavljacId: zeta, dobavljacNaziv: 'Zeta', sifra: 'Z-100' },
    ]);
    expect(await b.call('product:getDobavljacSifre', 999)).toEqual([]);
  });
});

describe('product:setDobavljacSifre', () => {
  test('zamjenjuje cijelu listu; šifra se trimuje, prazna postaje null', async () => {
    const a = dodajArtikal('A1');
    const alfa = dodajDobavljaca('Alfa');
    const beta = dodajDobavljaca('Beta');
    const gama = dodajDobavljaca('Gama');
    dodajSifru(a, gama, 'STARO');

    expect(await b.call('product:setDobavljacSifre', a, [
      { dobavljacId: alfa, sifra: '  A-1 ' },
      { dobavljacId: beta, sifra: '   ' },
    ])).toEqual({ changes: 2 });
    expect(sifreArtikla(a)).toEqual([
      { dobavljacId: alfa, sifra: 'A-1' },
      { dobavljacId: beta, sifra: null },
    ]);

    expect(await b.call('product:setDobavljacSifre', a, [])).toEqual({ changes: 0 });
    expect(sifreArtikla(a)).toEqual([]);
  });

  test('ne dira šifre drugih artikala', async () => {
    const a = dodajArtikal('A1');
    const drugi = dodajArtikal('A2');
    const alfa = dodajDobavljaca('Alfa');
    dodajSifru(drugi, alfa, 'X-1');
    await b.call('product:setDobavljacSifre', a, [{ dobavljacId: alfa, sifra: 'X-2' }]);
    expect(sifreArtikla(drugi)).toEqual([{ dobavljacId: alfa, sifra: 'X-1' }]);
  });

  test('isti dobavljač ne može istu šifru dati za dva artikla', async () => {
    const a = dodajArtikal('A1', { naziv: 'Kafa' });
    const drugi = dodajArtikal('A2');
    const alfa = dodajDobavljaca('Alfa');
    const beta = dodajDobavljaca('Beta');
    dodajSifru(a, alfa, 'K-1');

    await expect(b.call('product:setDobavljacSifre', drugi, [{ dobavljacId: alfa, sifra: ' K-1 ' }]))
      .rejects.toThrow('Dobavljač "Alfa" već ima šifru "K-1" na artiklu "Kafa" (A1)');
    // Isti kod kod drugog dobavljača je u redu, kao i više artikala bez šifre.
    await b.call('product:setDobavljacSifre', drugi, [{ dobavljacId: beta, sifra: 'K-1' }]);
    await b.call('product:setDobavljacSifre', a, [{ dobavljacId: alfa, sifra: 'K-1' }, { dobavljacId: beta, sifra: null }]);
    const treci = dodajArtikal('A3');
    await b.call('product:setDobavljacSifre', treci, [{ dobavljacId: alfa }]);
    expect(sifreArtikla(treci)).toEqual([{ dobavljacId: alfa, sifra: null }]);
  });

  test('odbija nepostojeći artikal, nepostojećeg i ponovljenog dobavljača bez ikakvog upisa', async () => {
    const a = dodajArtikal('A1');
    const alfa = dodajDobavljaca('Alfa');
    dodajSifru(a, alfa, 'OSTAJE');

    await expect(b.call('product:setDobavljacSifre', 999, [])).rejects.toThrow('Artikal ne postoji');
    await expect(b.call('product:setDobavljacSifre', a, [{ dobavljacId: 999, sifra: 'X' }]))
      .rejects.toThrow('Dobavljač ne postoji');
    await expect(b.call('product:setDobavljacSifre', a, [{ dobavljacId: alfa, sifra: 'X' }, { dobavljacId: alfa, sifra: 'Y' }]))
      .rejects.toThrow('Dobavljač "Alfa" je naveden više puta');
    expect(sifreArtikla(a)).toEqual([{ dobavljacId: alfa, sifra: 'OSTAJE' }]);
  });
});

describe('product:findByDobavljacSifra', () => {
  test('nalazi artikal po tačnoj šifri dobavljača, sa stanjem', async () => {
    const a = dodajArtikal('A1', { naziv: 'Kafa', stanje: 4 });
    const alfa = dodajDobavljaca('Alfa');
    const beta = dodajDobavljaca('Beta');
    dodajSifru(a, alfa, 'K-1');

    expect(await b.call('product:findByDobavljacSifra', alfa, ' K-1 ')).toMatchObject({ id: a, sifra: 'A1', stanje: 4 });
    expect(await b.call('product:findByDobavljacSifra', beta, 'K-1')).toBeNull();
    expect(await b.call('product:findByDobavljacSifra', alfa, 'K-')).toBeNull();
    expect(await b.call('product:findByDobavljacSifra', alfa, '')).toBeNull();
  });
});

describe('dobavljac:getSifre', () => {
  test('vraća artikle i šifre dobavljača, bez veza koje nemaju šifru', async () => {
    const a = dodajArtikal('A1');
    const c = dodajArtikal('A2');
    const alfa = dodajDobavljaca('Alfa');
    const beta = dodajDobavljaca('Beta');
    dodajSifru(a, alfa, 'K-2');
    dodajSifru(c, alfa, null);
    dodajSifru(c, beta, 'B-1');

    expect(await b.call('dobavljac:getSifre', alfa)).toEqual([{ productId: a, sifra: 'K-2' }]);
    expect(await b.call('dobavljac:getSifre', 999)).toEqual([]);
  });
});

describe('šifre dobavljača u pretrazi i šifarniku', () => {
  test('product:getAll i product:search nose šifre dobavljača; pretraga ih pretražuje', async () => {
    const a = dodajArtikal('A1', { naziv: 'Kafa' });
    dodajArtikal('A2', { naziv: 'Čaj' });
    const alfa = dodajDobavljaca('Alfa');
    const beta = dodajDobavljaca('Beta');
    dodajSifru(a, alfa, 'XK-100');
    dodajSifru(a, beta, null);

    const lista = await b.call('product:getAll');
    expect(lista.map((p: any) => [p.sifra, p.sifreDobavljaca])).toEqual([['A1', 'XK-100'], ['A2', null]]);
    expect(sifre(await b.call('product:search', 'xk-1'))).toEqual(['A1']);
    expect((await b.call('product:search', 'xk-1'))[0].sifreDobavljaca).toBe('XK-100');
  });

  test('product:delete briše i šifre dobavljača artikla', async () => {
    const a = dodajArtikal('A1');
    const alfa = dodajDobavljaca('Alfa');
    dodajSifru(a, alfa, 'K-1');
    expect(await b.call('product:delete', a)).toEqual({ changes: 1 });
    expect(broj('SELECT COUNT(*) AS n FROM artikal_dobavljac_sifre')).toBe(0);
  });

  test('dobavljac:delete ne briše dobavljača vezanog za artikle', async () => {
    const a = dodajArtikal('A1');
    const alfa = dodajDobavljaca('Alfa');
    dodajSifru(a, alfa, null);
    await expect(b.call('dobavljac:delete', alfa)).rejects.toThrow('Dobavljač je vezan za artikle i ne može biti obrisan');
    expect(broj('SELECT COUNT(*) AS n FROM dobavljaci')).toBe(1);
  });
});

// ─── materijal:search ───────────────────────────────────────

describe('materijal:search', () => {
  test('traži samo materijal po nazivu i šifri, sa stanjem', async () => {
    dodajArtikal('IV-18', { naziv: 'Iverica 18mm', tip: 'materijal', barkod: '777', stanje: 12 });
    dodajArtikal('KS-1', { naziv: 'Kant traka', tip: 'materijal' });
    dodajArtikal('A1', { naziv: 'Iverica komad', tip: 'artikal' });

    const r = await b.call('materijal:search', 'iverica');
    expect(sifre(r)).toEqual(['IV-18']);
    expect(r[0]).toMatchObject({ naziv: 'Iverica 18mm', tip: 'materijal', stanje: 12 });
    expect(sifre(await b.call('materijal:search', 'ks-'))).toEqual(['KS-1']);
    // Barkod se ne pretražuje.
    expect(await b.call('materijal:search', '777')).toEqual([]);
  });

  test('vraća najviše 30 rezultata, sortirano po nazivu', async () => {
    for (let i = 0; i < 35; i++) dodajArtikal(`M${String(i).padStart(2, '0')}`, { naziv: `Mat ${String(34 - i).padStart(2, '0')}`, tip: 'materijal' });
    const r = await b.call('materijal:search', '');
    expect(r).toHaveLength(30);
    expect(r[0].naziv).toBe('Mat 00');
    expect(r[29].naziv).toBe('Mat 29');
  });
});

// ─── dobavljac:getAll / create ──────────────────────────────

describe('dobavljac:getAll', () => {
  test('vraća sve dobavljače sortirane po nazivu', async () => {
    expect(await b.call('dobavljac:getAll')).toEqual([]);
    dodajDobavljaca('Zeta d.o.o.');
    dodajDobavljaca('Alfa d.o.o.', '4200000000001');
    const lista = await b.call('dobavljac:getAll');
    expect(lista.map((d: any) => d.naziv)).toEqual(['Alfa d.o.o.', 'Zeta d.o.o.']);
    expect(lista[0]).toMatchObject({ naziv: 'Alfa d.o.o.', idBroj: '4200000000001', pdvBroj: null, adresa: null, kontakt: null });
    expect(typeof lista[0].id).toBe('number');
    expect(typeof lista[0].createdAt).toBe('string');
  });
});

describe('dobavljac:create', () => {
  test('upisuje dobavljača, trimuje naziv, ostala polja čuva kako su poslana', async () => {
    const r = await b.call('dobavljac:create', {
      naziv: '  Alfa d.o.o. ', idBroj: '4200000000001', pdvBroj: '200000000001', adresa: 'Titova 1', kontakt: '033 111 222',
    });
    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    expect(red('SELECT naziv, idBroj, pdvBroj, adresa, kontakt FROM dobavljaci WHERE id = ?', r.id)).toEqual({
      naziv: 'Alfa d.o.o.', idBroj: '4200000000001', pdvBroj: '200000000001', adresa: 'Titova 1', kontakt: '033 111 222',
    });
  });

  test('neobavezna polja postaju null', async () => {
    const r = await b.call('dobavljac:create', { naziv: 'Beta' });
    expect(red('SELECT idBroj, pdvBroj, adresa, kontakt FROM dobavljaci WHERE id = ?', r.id))
      .toEqual({ idBroj: null, pdvBroj: null, adresa: null, kontakt: null });
  });

  test('naziv je obavezan; duplikati nisu zabranjeni', async () => {
    await expect(b.call('dobavljac:create', { naziv: '   ' })).rejects.toThrow('Naziv dobavljača je obavezan');
    await expect(b.call('dobavljac:create', {})).rejects.toThrow('Naziv dobavljača je obavezan');
    await b.call('dobavljac:create', { naziv: 'Isti', idBroj: '1' });
    await b.call('dobavljac:create', { naziv: 'Isti', idBroj: '1' });
    expect(broj('SELECT COUNT(*) AS n FROM dobavljaci')).toBe(2);
  });
});

// ─── dobavljac:update ───────────────────────────────────────

describe('dobavljac:update', () => {
  test('mijenja samo poslana polja', async () => {
    const id = dodajDobavljaca('Alfa', '1', '2');
    expect(await b.call('dobavljac:update', id, { naziv: 'Alfa Plus', kontakt: 'info@alfa.ba' })).toEqual({ changes: 1 });
    expect(red('SELECT naziv, idBroj, pdvBroj, adresa, kontakt FROM dobavljaci WHERE id = ?', id))
      .toEqual({ naziv: 'Alfa Plus', idBroj: '1', pdvBroj: '2', adresa: null, kontakt: 'info@alfa.ba' });
  });

  test('prazan objekat i nepostojeći id vraćaju changes 0', async () => {
    const id = dodajDobavljaca('Alfa');
    expect(await b.call('dobavljac:update', id, {})).toEqual({ changes: 0 });
    expect(await b.call('dobavljac:update', 999, { naziv: 'X' })).toEqual({ changes: 0 });
  });

  test('validira naziv kao create: prazan se odbija, poslani se trimuje', async () => {
    const id = dodajDobavljaca('Alfa', '1');
    await expect(b.call('dobavljac:update', id, { naziv: '   ' })).rejects.toThrow('Naziv dobavljača je obavezan');
    await expect(b.call('dobavljac:update', id, { naziv: null, kontakt: 'x' })).rejects.toThrow('Naziv dobavljača je obavezan');
    expect(red('SELECT naziv, kontakt FROM dobavljaci WHERE id = ?', id)).toEqual({ naziv: 'Alfa', kontakt: null });

    expect(await b.call('dobavljac:update', id, { naziv: '  Alfa Plus ' })).toEqual({ changes: 1 });
    expect(red('SELECT naziv, idBroj FROM dobavljaci WHERE id = ?', id)).toEqual({ naziv: 'Alfa Plus', idBroj: '1' });
  });
});

// ─── dobavljac:delete ───────────────────────────────────────

describe('dobavljac:delete', () => {
  test('briše dobavljača bez primki', async () => {
    const id = dodajDobavljaca('Alfa', '1');
    dodajPrimku('P-1', 'Neko drugi', '9');
    expect(await b.call('dobavljac:delete', id)).toEqual({ changes: 1 });
    expect(broj('SELECT COUNT(*) AS n FROM dobavljaci')).toBe(0);
  });

  test('nepostojeći id vraća changes 0', async () => {
    expect(await b.call('dobavljac:delete', 999)).toEqual({ changes: 0 });
  });

  test('ne briše dobavljača čiji naziv, JIB ili PDV broj stoji na primci', async () => {
    const poruka = 'Dobavljač se koristi u primkama i ne može biti obrisan';
    const poNazivu = dodajDobavljaca('Alfa');
    const poJib = dodajDobavljaca('Beta', '4200000000001');
    const poPdv = dodajDobavljaca('Gama', null, '200000000009');
    dodajPrimku('P-1', 'Alfa', null);
    dodajPrimku('P-2', 'Beta stari naziv', '4200000000001');
    dodajPrimku('P-3', 'Gama stari naziv', '200000000009');

    await expect(b.call('dobavljac:delete', poNazivu)).rejects.toThrow(poruka);
    await expect(b.call('dobavljac:delete', poJib)).rejects.toThrow(poruka);
    await expect(b.call('dobavljac:delete', poPdv)).rejects.toThrow(poruka);
    expect(broj('SELECT COUNT(*) AS n FROM dobavljaci')).toBe(3);
  });

  test('JIB/PDV sa razmacima se trimuje prije poređenja s primkom', async () => {
    const id = dodajDobavljaca('Delta', ' 4200000000002 ');
    dodajPrimku('P-1', 'Drugi naziv', '4200000000002');
    await expect(b.call('dobavljac:delete', id)).rejects.toThrow('Dobavljač se koristi u primkama i ne može biti obrisan');
  });
});

// ─── kupac:getAll / search ──────────────────────────────────

describe('kupac:getAll', () => {
  test('vraća sve kupce sortirane po nazivu', async () => {
    expect(await b.call('kupac:getAll')).toEqual([]);
    dodajKupca('Zeta', '4200000000002');
    dodajKupca('Alfa', '4200000000001');
    const lista = await b.call('kupac:getAll');
    expect(lista.map((k: any) => k.naziv)).toEqual(['Alfa', 'Zeta']);
    expect(lista[0]).toMatchObject({
      naziv: 'Alfa', idBroj: '4200000000001', pdvBroj: null, adresa: null, postanskiBroj: null, grad: null, kontakt: null,
    });
    expect(typeof lista[0].id).toBe('number');
  });
});

describe('kupac:search', () => {
  test('traži po nazivu, JIB-u i kontaktu, sortirano po nazivu', async () => {
    dodajKupca('Zeta d.o.o.', '4200000000002', 'zeta@mail.ba');
    dodajKupca('Alfa d.o.o.', '4200000000001', '061 222 333');
    dodajKupca('Beta', '4300000000001');

    expect((await b.call('kupac:search', 'd.o.o')).map((k: any) => k.naziv)).toEqual(['Alfa d.o.o.', 'Zeta d.o.o.']);
    expect((await b.call('kupac:search', '43000')).map((k: any) => k.naziv)).toEqual(['Beta']);
    expect((await b.call('kupac:search', 'ZETA@')).map((k: any) => k.naziv)).toEqual(['Zeta d.o.o.']);
    expect((await b.call('kupac:search', '222 3')).map((k: any) => k.naziv)).toEqual(['Alfa d.o.o.']);
    expect(await b.call('kupac:search', 'nema')).toEqual([]);
    expect(await b.call('kupac:search', '')).toHaveLength(3);
  });
});

// ─── kupac:create ───────────────────────────────────────────

describe('kupac:create', () => {
  test('upisuje kupca, trimuje naziv i JIB', async () => {
    const r = await b.call('kupac:create', {
      naziv: ' Firma d.o.o. ', idBroj: ' 4200000000001 ', pdvBroj: '200000000001',
      adresa: 'Titova 1', postanskiBroj: '71000', grad: 'Sarajevo', kontakt: '033 111',
    });
    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    expect(red('SELECT naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt FROM kupci WHERE id = ?', r.id)).toEqual({
      naziv: 'Firma d.o.o.', idBroj: '4200000000001', pdvBroj: '200000000001',
      adresa: 'Titova 1', postanskiBroj: '71000', grad: 'Sarajevo', kontakt: '033 111',
    });
  });

  test('neobavezna polja postaju null', async () => {
    const r = await b.call('kupac:create', { naziv: 'K', idBroj: '1' });
    expect(red('SELECT pdvBroj, adresa, postanskiBroj, grad, kontakt FROM kupci WHERE id = ?', r.id))
      .toEqual({ pdvBroj: null, adresa: null, postanskiBroj: null, grad: null, kontakt: null });
  });

  test('naziv i JIB su obavezni', async () => {
    await expect(b.call('kupac:create', { naziv: ' ', idBroj: '1' })).rejects.toThrow('Naziv kupca je obavezan');
    await expect(b.call('kupac:create', { naziv: 'K', idBroj: '  ' })).rejects.toThrow('ID broj (JIB) kupca je obavezan');
    await expect(b.call('kupac:create', { naziv: 'K' })).rejects.toThrow('ID broj (JIB) kupca je obavezan');
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(0);
  });

  test('odbija duplikat JIB-a (i sa razmacima)', async () => {
    dodajKupca('Postojeći', '4200000000001');
    await expect(b.call('kupac:create', { naziv: 'Novi', idBroj: '4200000000001' }))
      .rejects.toThrow('Kupac sa JIB-om "4200000000001" već postoji');
    await expect(b.call('kupac:create', { naziv: 'Novi', idBroj: ' 4200000000001 ' }))
      .rejects.toThrow('Kupac sa JIB-om " 4200000000001 " već postoji');
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(1);
  });
});

// ─── kupac:update ───────────────────────────────────────────

describe('kupac:update', () => {
  test('mijenja samo poslana polja', async () => {
    const id = dodajKupca('Alfa', '1', 'stari');
    expect(await b.call('kupac:update', id, { naziv: 'Alfa 2', grad: 'Mostar', postanskiBroj: '88000' })).toEqual({ changes: 1 });
    expect(red('SELECT naziv, idBroj, grad, postanskiBroj, kontakt, adresa FROM kupci WHERE id = ?', id))
      .toEqual({ naziv: 'Alfa 2', idBroj: '1', grad: 'Mostar', postanskiBroj: '88000', kontakt: 'stari', adresa: null });
  });

  test('odbija JIB drugog kupca, a dozvoljava vlastiti', async () => {
    dodajKupca('Alfa', '1');
    const id = dodajKupca('Beta', '2');
    await expect(b.call('kupac:update', id, { idBroj: '1' })).rejects.toThrow('Kupac sa JIB-om "1" već postoji');
    expect(await b.call('kupac:update', id, { idBroj: '2', pdvBroj: '22' })).toEqual({ changes: 1 });
    expect(red('SELECT idBroj, pdvBroj FROM kupci WHERE id = ?', id)).toEqual({ idBroj: '2', pdvBroj: '22' });
  });

  test('prazan objekat i nepostojeći id vraćaju changes 0', async () => {
    const id = dodajKupca('Alfa', '1');
    expect(await b.call('kupac:update', id, {})).toEqual({ changes: 0 });
    expect(await b.call('kupac:update', 999, { naziv: 'X' })).toEqual({ changes: 0 });
  });

  test('validira naziv i JIB kao create: prazni se odbijaju, trimuju se, duplikat JIB-a se traži po trimovanoj vrijednosti', async () => {
    dodajKupca('Alfa', '1');
    const id = dodajKupca('Beta', '2');

    await expect(b.call('kupac:update', id, { naziv: ' ' })).rejects.toThrow('Naziv kupca je obavezan');
    await expect(b.call('kupac:update', id, { idBroj: '  ' })).rejects.toThrow('ID broj (JIB) kupca je obavezan');
    await expect(b.call('kupac:update', id, { idBroj: null })).rejects.toThrow('ID broj (JIB) kupca je obavezan');
    await expect(b.call('kupac:update', id, { idBroj: ' 1 ' })).rejects.toThrow('Kupac sa JIB-om " 1 " već postoji');
    expect(red('SELECT naziv, idBroj FROM kupci WHERE id = ?', id)).toEqual({ naziv: 'Beta', idBroj: '2' });

    expect(await b.call('kupac:update', id, { naziv: ' Beta 2 ', idBroj: ' 3 ' })).toEqual({ changes: 1 });
    expect(red('SELECT naziv, idBroj FROM kupci WHERE id = ?', id)).toEqual({ naziv: 'Beta 2', idBroj: '3' });
  });
});

// ─── kupac: zadane vrijednosti za dokumente ─────────────────

describe('kupac: zadano za dokumente', () => {
  test('create upisuje rok, način plaćanja i rabat; bez njih su null', async () => {
    const a = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5.5 });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', a.id))
      .toEqual({ rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5.5 });
    const bez = await b.call('kupac:create', { naziv: 'B', idBroj: '2' });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', bez.id))
      .toEqual({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null });
  });

  test('prazno i null brišu vrijednost na update-u', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5 });
    expect(await b.call('kupac:update', r.id, { rokPlacanjaDana: null, nacinPlacanja: '', rabat: null })).toEqual({ changes: 1 });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', r.id))
      .toEqual({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null });
  });

  test('update mijenja samo poslana zadana polja', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, rabat: 5 });
    await b.call('kupac:update', r.id, { rabat: 7.25 });
    expect(red('SELECT rokPlacanjaDana, rabat FROM kupci WHERE id = ?', r.id)).toEqual({ rokPlacanjaDana: 30, rabat: 7.25 });
  });

  test('validacija', async () => {
    const rok = 'Rok plaćanja mora biti cijeli broj dana od 0 do 365';
    const rab = 'Rabat kupca mora biti od 0 do manje od 100 %';
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: -1 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 366 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 2.5 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 100 })).rejects.toThrow(rab);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: -0.5 })).rejects.toThrow(rab);
    // Provjera ide nakon zaokruživanja: 99.995 bi se upisao kao 100.
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 99.995 })).rejects.toThrow(rab);
    // Negativan unos se odbija prije zaokruživanja (-0.005 bi se zaokružio na -0).
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: -0.005 })).rejects.toThrow(rab);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', nacinPlacanja: 'Bitcoin' })).rejects.toThrow('Nepoznat način plaćanja "Bitcoin"');
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(0);
    const id = dodajKupca('B', '2');
    await expect(b.call('kupac:update', id, { rabat: 150 })).rejects.toThrow(rab);
  });

  test('rabat se zaokružuje na 2 decimale', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 3.14159 });
    expect(red('SELECT rabat FROM kupci WHERE id = ?', r.id)).toEqual({ rabat: 3.14 });
  });

  test('getAll vraća nova polja', async () => {
    await b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 5 });
    const [k] = await b.call('kupac:getAll');
    expect(k.rabat).toBe(5);
    expect(k.rokPlacanjaDana).toBeNull();
    expect(k.nacinPlacanja).toBeNull();
  });

  test('stara baza bez novih kolona: migracija ih dodaje kao null, update ih postavlja', async () => {
    const id = dodajKupca('Stari', '1', '033 111');
    for (const kol of ['rokPlacanjaDana', 'nacinPlacanja', 'rabat']) b.db.exec(`ALTER TABLE kupci DROP COLUMN ${kol}`);
    await b.ponovoPokreni();
    await prijavi(b, ADMIN_PIN);

    const [k] = await b.call('kupac:getAll');
    expect(k).toMatchObject({ id, naziv: 'Stari', idBroj: '1', kontakt: '033 111' });
    expect(k.rokPlacanjaDana).toBeNull();
    expect(k.nacinPlacanja).toBeNull();
    expect(k.rabat).toBeNull();

    expect(await b.call('kupac:update', id, { rokPlacanjaDana: 15, nacinPlacanja: 'Virman', rabat: 2.5 })).toEqual({ changes: 1 });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', id))
      .toEqual({ rokPlacanjaDana: 15, nacinPlacanja: 'Virman', rabat: 2.5 });
  });
});

// ─── kupac:delete ───────────────────────────────────────────

describe('kupac:delete', () => {
  test('briše kupca koji nije na računima', async () => {
    const id = dodajKupca('Alfa', '1');
    dodajRacun(null, '2');
    expect(await b.call('kupac:delete', id)).toEqual({ changes: 1 });
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(0);
  });

  test('nepostojeći id vraća changes 0', async () => {
    expect(await b.call('kupac:delete', 999)).toEqual({ changes: 0 });
  });

  test('ne briše kupca čiji JIB stoji na računu', async () => {
    const id = dodajKupca('Alfa', '4200000000001');
    dodajRacun(null, '4200000000001');
    await expect(b.call('kupac:delete', id)).rejects.toThrow('Kupac se koristi u računima i ne može biti obrisan');
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(1);
  });

  test('ne briše kupca vezanog za ponudu ili radni nalog', async () => {
    const saPonudom = dodajKupca('Alfa', '1');
    b.db.prepare(
      "INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos) VALUES (1, 2026, ?, ?, '2026-01-10', '2026-02-10', 10, 0)"
    ).run(saPonudom, ADMIN);
    await expect(b.call('kupac:delete', saPonudom)).rejects.toThrow('Kupac se koristi u ponudama i ne može biti obrisan');

    const saNalogom = dodajKupca('Beta', '2');
    b.db.prepare(
      "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, opis, kupacId, korisnikId) VALUES (1, 2026, '2026-01-10', 'narudzba', 'Test', ?, ?)"
    ).run(saNalogom, ADMIN);
    await expect(b.call('kupac:delete', saNalogom)).rejects.toThrow('Kupac se koristi u radnim nalozima i ne može biti obrisan');

    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(2);
  });
});
