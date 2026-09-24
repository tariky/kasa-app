// Ugovor za kanale nalog:* i normativ:* (proizvodnja) — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina s PIN-om 0000
const GODINA = new Date().getFullYear();

// ─── pomoćne funkcije (samo SQL) ────────────────────────────

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: any[]): any[] {
  return b.db.prepare(sql).all(...params);
}

function dodajProizvod(
  sifra: string,
  tip: 'artikal' | 'materijal' | 'usluga',
  opts: { cijena?: number; jm?: string; plocaSirina?: number; plocaVisina?: number; stanje?: number } = {}
): number {
  const r = b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip, plocaSirina, plocaVisina) VALUES (?, ?, ?, ?, 'E', 1, ?, ?, ?)"
  ).run(sifra, `Proizvod ${sifra}`, opts.jm ?? 'kom', opts.cijena ?? 10, tip, opts.plocaSirina ?? null, opts.plocaVisina ?? null);
  const id = Number(r.lastInsertRowid);
  if (opts.stanje) {
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
      .run(id, opts.stanje);
  }
  return id;
}

let brojPrimke = 0;
/** Primka materijala: stavka po kalkulaciji ulaza + ulaz na zalihu. */
function primka(materijalId: number, kolicina: number, nabavna: number, opts: { rabat?: number; zavisni?: number } = {}): void {
  const p = b.db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES (?, '2026-01-10')").run(`P-${++brojPrimke}`);
  const primkaId = Number(p.lastInsertRowid);
  b.db.prepare(`
    INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa)
    VALUES (?, ?, ?, 0, ?, ?, ?, 'E')
  `).run(primkaId, materijalId, kolicina, nabavna, opts.rabat ?? 0, opts.zavisni ?? 0);
  b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)")
    .run(materijalId, kolicina, primkaId);
}

function dodajKupca(naziv = 'Kupac d.o.o.'): number {
  return Number(b.db.prepare(
    "INSERT INTO kupci (naziv, idBroj, adresa, postanskiBroj, grad) VALUES (?, '4200000000009', 'Titova 1', '71000', 'Sarajevo')"
  ).run(naziv).lastInsertRowid);
}

let brojPonude = 0;
function dodajPonudu(kupacId: number, status: string, stavke: Array<{ productId: number; kolicina: number; cijena: number }>, extra: { racunId?: number } = {}): number {
  const ukupno = stavke.reduce((s, x) => s + x.kolicina * x.cijena, 0);
  const pdv = Math.round((ukupno - ukupno / 1.17) * 100) / 100;
  const id = Number(b.db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos, racunId)
    VALUES (?, ?, ?, ?, '2026-03-01', '2026-03-31', ?, ?, ?, ?)
  `).run(++brojPonude, 2026, kupacId, ADMIN, status, ukupno, pdv, extra.racunId ?? null).lastInsertRowid);
  const ins = b.db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, 0, 'E')");
  for (const s of stavke) ins.run(id, s.productId, s.kolicina, s.cijena);
  return id;
}

function stanje(productId: number): number {
  return red(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `, productId).s;
}

function status(nalogId: number): string {
  return red('SELECT status FROM radni_nalozi WHERE id = ?', nalogId).status;
}

async function narudzba(kupacId: number, extra: Record<string, unknown> = {}): Promise<number> {
  const r = await b.call('nalog:create', { vrsta: 'narudzba', korisnikId: ADMIN, kupacId, opis: 'Kuhinja po mjeri', ...extra });
  return r.id;
}

async function zaliha(productId: number, kolicina: number, extra: Record<string, unknown> = {}): Promise<number> {
  const r = await b.call('nalog:create', { vrsta: 'zaliha', korisnikId: ADMIN, productId, kolicina, ...extra });
  return r.id;
}

async function zavrsi(id: number): Promise<void> {
  await b.call('nalog:setStatus', { id, status: 'zavrsen', korisnikId: ADMIN });
}

/** Narudžba sa jednom stavkom materijala, završena i spremna za račun. */
async function zavrsenaNarudzba(dogovorenaCijena: number | null, extra: Record<string, unknown> = {}): Promise<{ id: number; kupacId: number; mat: number }> {
  const kupacId = dodajKupca();
  const mat = dodajProizvod(`M${Math.random().toString(36).slice(2, 7)}`, 'materijal', { stanje: 10 });
  const id = await narudzba(kupacId, { dogovorenaCijena, ...extra });
  await b.call('nalog:replaceStavke', id, [{ materijalId: mat, kolicina: 2 }]);
  await zavrsi(id);
  return { id, kupacId, mat };
}

// ─── nalog:nextBroj ─────────────────────────────────────────

describe('nalog:nextBroj', () => {
  test('prvi broj tekuće godine je 1, zatim raste; druga godina ne utiče', async () => {
    expect(await b.call('nalog:nextBroj')).toEqual({ broj: 1, godina: GODINA });

    const kupacId = dodajKupca();
    await narudzba(kupacId);
    await narudzba(kupacId, { datum: `${GODINA - 1}-12-31` });
    expect(await b.call('nalog:nextBroj')).toEqual({ broj: 2, godina: GODINA });
  });
});

// ─── nalog:create ───────────────────────────────────────────

describe('nalog:create', () => {
  test('narudžba: vraća id, broj i godinu; numeracija po godini datuma', async () => {
    const kupacId = dodajKupca();
    const r = await b.call('nalog:create', {
      vrsta: 'narudzba', korisnikId: ADMIN, kupacId, opis: '  Ormar  ', datum: '2025-06-01',
      rok: '2025-06-15', dogovorenaCijena: 1170, trosakRada: 150, napomena: 'hitno',
    });
    expect(Object.keys(r).sort()).toEqual(['broj', 'godina', 'id']);
    expect(typeof r.id).toBe('number');
    expect(r.broj).toBe(1);
    expect(r.godina).toBe(2025);

    expect(red('SELECT * FROM radni_nalozi WHERE id = ?', r.id)).toMatchObject({
      broj: 1, godina: 2025, datum: '2025-06-01', rok: '2025-06-15', vrsta: 'narudzba', kupacId,
      ponudaId: null, opis: 'Ormar', productId: null, kolicina: 1, dogovorenaCijena: 1170, trosakRada: 150,
      status: 'otvoren', racunId: null, korisnikId: ADMIN, napomena: 'hitno', zavrsenAt: null,
    });

    const drugi = await b.call('nalog:create', { vrsta: 'narudzba', korisnikId: ADMIN, kupacId, opis: 'X', datum: '2025-07-01' });
    expect(drugi.broj).toBe(2);
    const treci = await b.call('nalog:create', { vrsta: 'narudzba', korisnikId: ADMIN, kupacId, opis: 'Y', datum: '2026-01-02' });
    expect({ broj: treci.broj, godina: treci.godina }).toEqual({ broj: 1, godina: 2026 });
  });

  test('bez datuma uzima današnji; bez troška rada upiše 0', async () => {
    const id = await narudzba(dodajKupca());
    const n = red('SELECT datum, godina, trosakRada, dogovorenaCijena, rok FROM radni_nalozi WHERE id = ?', id);
    expect(n.datum).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(n.godina).toBe(GODINA);
    expect(n).toMatchObject({ trosakRada: 0, dogovorenaCijena: null, rok: null });
  });

  test('zaliha: opis = naziv proizvoda, količina na 4 decimale, stavke = normativ × količina', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const iverica = dodajProizvod('IV', 'materijal', { jm: 'm²' });
    const vijak = dodajProizvod('VJ', 'materijal');
    await b.call('normativ:save', stol, [
      { materijalId: iverica, kolicina: 1.25, napomena: 'ploča' },
      { materijalId: vijak, kolicina: 8 },
    ]);

    const id = await zaliha(stol, 2.00004);
    expect(red('SELECT opis, kolicina, kupacId, productId FROM radni_nalozi WHERE id = ?', id))
      .toEqual({ opis: 'Proizvod STOL', kolicina: 2, kupacId: null, productId: stol });
    expect(redovi('SELECT materijalId, kolicina, napomena, nabavnaCijena FROM radni_nalog_stavke WHERE radniNalogId = ? ORDER BY id', id))
      .toEqual([
        { materijalId: iverica, kolicina: 2.5, napomena: 'ploča', nabavnaCijena: null },
        { materijalId: vijak, kolicina: 16, napomena: null, nabavnaCijena: null },
      ]);
  });

  test('zaliha bez normativa nema stavki; zadani opis ostaje', async () => {
    const p = dodajProizvod('P1', 'artikal');
    const id = await zaliha(p, 3, { opis: 'Serija 1' });
    expect(red('SELECT opis FROM radni_nalozi WHERE id = ?', id).opis).toBe('Serija 1');
    expect(red('SELECT COUNT(*) AS n FROM radni_nalog_stavke WHERE radniNalogId = ?', id).n).toBe(0);
  });

  test('validacije', async () => {
    const kupacId = dodajKupca();
    const artikal = dodajProizvod('A1', 'artikal');
    const mat = dodajProizvod('M1', 'materijal');
    const c = (d: Record<string, unknown>) => b.call('nalog:create', { korisnikId: ADMIN, ...d });

    await expect(b.call('nalog:create', { vrsta: 'narudzba', kupacId, opis: 'x' })).rejects.toThrow('Korisnik nije prijavljen');
    await expect(c({ vrsta: 'narudzba', opis: 'x' })).rejects.toThrow('Kupac je obavezan za nalog po narudžbi');
    await expect(c({ vrsta: 'narudzba', kupacId, opis: '   ' })).rejects.toThrow('Opis je obavezan');
    await expect(c({ vrsta: 'zaliha', kolicina: 1 })).rejects.toThrow('Proizvod je obavezan za nalog za zalihu');
    await expect(c({ vrsta: 'zaliha', productId: mat, kolicina: 1 })).rejects.toThrow('Nalog za zalihu može biti samo za artikal');
    await expect(c({ vrsta: 'zaliha', productId: 9999, kolicina: 1 })).rejects.toThrow('Nalog za zalihu može biti samo za artikal');
    await expect(c({ vrsta: 'zaliha', productId: artikal, kolicina: 0 })).rejects.toThrow('Količina mora biti veća od nule');
    await expect(c({ vrsta: 'zaliha', productId: artikal })).rejects.toThrow('Količina mora biti veća od nule');
    await expect(c({ vrsta: 'popravka', opis: 'x' })).rejects.toThrow('Nepoznata vrsta naloga');
    expect(red('SELECT COUNT(*) AS n FROM radni_nalozi').n).toBe(0);
  });
});

// ─── nalog:getAll / nalog:get ───────────────────────────────

describe('nalog:getAll', () => {
  test('najnoviji prvi (godina, broj), s podacima kupca, proizvoda i korisnika; bez stavki', async () => {
    const kupacId = dodajKupca('Stolarija Kupac');
    const p = dodajProizvod('KOM', 'artikal', { cijena: 250 });
    const stari = await narudzba(kupacId, { datum: '2025-12-01' });
    const n1 = await narudzba(kupacId, { datum: '2026-01-05' });
    const n2 = await zaliha(p, 1, { datum: '2026-01-06' });

    const lista: any[] = await b.call('nalog:getAll');
    expect(lista.map(n => n.id)).toEqual([n2, n1, stari]);
    expect(lista[1]).toMatchObject({
      broj: 1, godina: 2026, kupacNaziv: 'Stolarija Kupac', kupacIdBroj: '4200000000009', kupacAdresa: 'Titova 1',
      kupacGrad: 'Sarajevo', kupacPostanskiBroj: '71000', productNaziv: null, korisnikIme: 'Admin',
      racunBroj: null, racunStatus: null, ponudaBroj: null, ponudaGodina: null,
    });
    expect(lista[0]).toMatchObject({ productId: p, productNaziv: 'Proizvod KOM', productCijena: 250, kupacNaziv: null });
    expect(lista[0].stavke).toBeUndefined();
  });

  test('filter po statusu i "aktivni" (sve osim fakturisanih)', async () => {
    const otvoren = await narudzba(dodajKupca());
    const uIzradi = await narudzba(dodajKupca());
    await b.call('nalog:setStatus', { id: uIzradi, status: 'u_izradi', korisnikId: ADMIN });
    const f = await zavrsenaNarudzba(100);
    await b.call('nalog:izdajRacun', { id: f.id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });

    const ids = async (filter?: string) => (await b.call('nalog:getAll', ...(filter ? [filter] : []))).map((n: any) => n.id).sort();
    expect(await ids()).toEqual([otvoren, uIzradi, f.id].sort());
    expect(await ids('aktivni')).toEqual([otvoren, uIzradi].sort());
    expect(await ids('u_izradi')).toEqual([uIzradi]);
    expect(await ids('fakturisan')).toEqual([f.id]);
    expect(await ids('zavrsen')).toEqual([]);
  });
});

describe('nalog:get', () => {
  test('nalog sa stavkama: podaci materijala, dimenzije ploče i trenutno stanje', async () => {
    const ploca = dodajProizvod('IV18', 'materijal', { jm: 'm²', plocaSirina: 2800, plocaVisina: 2070, stanje: 11.592 });
    const kant = dodajProizvod('KT', 'materijal', { jm: 'm' });
    const id = await narudzba(dodajKupca());
    await b.call('nalog:replaceStavke', id, [
      { materijalId: ploca, kolicina: 1.23456, napomena: '600×400 ×2' },
      { materijalId: kant, kolicina: 12 },
    ]);

    const n = await b.call('nalog:get', id);
    expect(n).toMatchObject({ id, vrsta: 'narudzba', status: 'otvoren', opis: 'Kuhinja po mjeri', korisnikIme: 'Admin' });
    expect(n.stavke).toHaveLength(2);
    expect(n.stavke[0]).toMatchObject({
      radniNalogId: id, materijalId: ploca, kolicina: 1.2346, nabavnaCijena: null, napomena: '600×400 ×2',
      materijalNaziv: 'Proizvod IV18', materijalSifra: 'IV18', materijalJm: 'm²',
      plocaSirina: 2800, plocaVisina: 2070, stanje: 11.592,
    });
    expect(n.stavke[1]).toMatchObject({ materijalId: kant, kolicina: 12, napomena: null, plocaSirina: null, plocaVisina: null, stanje: 0 });
  });

  test('nepostojeći nalog je greška', async () => {
    await expect(b.call('nalog:get', 999)).rejects.toThrow('Radni nalog ne postoji');
  });
});

// ─── nalog:createIzPonude / nalog:zaPonudu ──────────────────

describe('nalog:createIzPonude', () => {
  test('nasljeđuje kupca, ponudu, cijenu i opis iz naziva stavki', async () => {
    const kupacId = dodajKupca();
    const a = dodajProizvod('ORM', 'artikal');
    const u = dodajProizvod('MONT', 'usluga');
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [
      { productId: a, kolicina: 1, cijena: 900 },
      { productId: u, kolicina: 1, cijena: 270 },
    ]);

    const r = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    expect(Object.keys(r).sort()).toEqual(['broj', 'godina', 'id']);
    expect(r.broj).toBe(1);
    expect(red('SELECT vrsta, kupacId, ponudaId, opis, dogovorenaCijena, status FROM radni_nalozi WHERE id = ?', r.id))
      .toEqual({ vrsta: 'narudzba', kupacId, ponudaId, opis: 'Proizvod ORM, Proizvod MONT', dogovorenaCijena: 1170, status: 'otvoren' });
    const n = await b.call('nalog:get', r.id);
    expect(n).toMatchObject({ ponudaBroj: 1, ponudaGodina: 2026 });
  });

  test('ponuda bez stavki dobije opis "Ponuda <id>"', async () => {
    const ponudaId = dodajPonudu(dodajKupca(), 'prihvacena', []);
    const r = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    expect(red('SELECT opis FROM radni_nalozi WHERE id = ?', r.id).opis).toBe(`Ponuda ${ponudaId}`);
  });

  test('odbija: bez korisnika, nepostojeća, neprihvaćena i već iskorištena ponuda', async () => {
    const kupacId = dodajKupca();
    const a = dodajProizvod('A', 'artikal');
    const draft = dodajPonudu(kupacId, 'poslana', [{ productId: a, kolicina: 1, cijena: 10 }]);
    const ok = dodajPonudu(kupacId, 'prihvacena', [{ productId: a, kolicina: 1, cijena: 10 }]);

    await expect(b.call('nalog:createIzPonude', ok, 0)).rejects.toThrow('Korisnik nije prijavljen');
    await expect(b.call('nalog:createIzPonude', 999, ADMIN)).rejects.toThrow('Ponuda ne postoji');
    await expect(b.call('nalog:createIzPonude', draft, ADMIN))
      .rejects.toThrow('Ponuda mora biti prihvaćena da bi se otvorio radni nalog');
    await b.call('nalog:createIzPonude', ok, ADMIN);
    await expect(b.call('nalog:createIzPonude', ok, ADMIN)).rejects.toThrow('Za ovu ponudu radni nalog već postoji');
    expect(red('SELECT COUNT(*) AS n FROM radni_nalozi').n).toBe(1);
  });
});

describe('nalog:zaPonudu', () => {
  test('vraća {id, broj, godina} naloga za ponudu ili null', async () => {
    const kupacId = dodajKupca();
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [{ productId: dodajProizvod('A', 'artikal'), kolicina: 1, cijena: 10 }]);
    expect(await b.call('nalog:zaPonudu', ponudaId)).toBeNull();
    const r = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    expect(await b.call('nalog:zaPonudu', ponudaId)).toEqual({ id: r.id, broj: r.broj, godina: r.godina });
    expect(await b.call('nalog:zaPonudu', 999)).toBeNull();
  });
});

// ─── nalog:update ───────────────────────────────────────────

describe('nalog:update', () => {
  test('mijenja zadana polja, prazni rok/napomenu u null; vraća {success: true}', async () => {
    const kupacId = dodajKupca();
    const drugi = dodajKupca('Drugi');
    const id = await narudzba(kupacId, { rok: '2026-05-01', napomena: 'x', trosakRada: 10 });

    expect(await b.call('nalog:update', id, {
      opis: '  Novi opis ', kupacId: drugi, rok: '', napomena: '', dogovorenaCijena: 500, trosakRada: 40, datum: '2026-02-02',
    })).toEqual({ success: true });
    expect(red('SELECT opis, kupacId, rok, napomena, dogovorenaCijena, trosakRada, datum FROM radni_nalozi WHERE id = ?', id))
      .toEqual({ opis: 'Novi opis', kupacId: drugi, rok: null, napomena: null, dogovorenaCijena: 500, trosakRada: 40, datum: '2026-02-02' });

    await b.call('nalog:update', id, { dogovorenaCijena: null });
    expect(red('SELECT dogovorenaCijena FROM radni_nalozi WHERE id = ?', id).dogovorenaCijena).toBeNull();
  });

  test('količina važi samo za zalihu, kupac samo za narudžbu (inače se tiho ignoriše); stavke se ne preračunavaju', async () => {
    const p = dodajProizvod('P', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    await b.call('normativ:save', p, [{ materijalId: m, kolicina: 2 }]);
    const z = await zaliha(p, 1);
    const n = await narudzba(dodajKupca());

    await b.call('nalog:update', z, { kolicina: 3.33333, kupacId: dodajKupca('K') });
    await b.call('nalog:update', n, { kolicina: 7 });
    expect(red('SELECT kolicina, kupacId FROM radni_nalozi WHERE id = ?', z)).toEqual({ kolicina: 3.3333, kupacId: null });
    expect(red('SELECT kolicina FROM radni_nalozi WHERE id = ?', n).kolicina).toBe(1);
    expect(red('SELECT kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?', z).kolicina).toBe(2);
  });

  test('validacije', async () => {
    const n = await narudzba(dodajKupca());
    const z = await zaliha(dodajProizvod('P', 'artikal'), 1);
    await expect(b.call('nalog:update', 999, { opis: 'x' })).rejects.toThrow('Radni nalog ne postoji');
    await expect(b.call('nalog:update', n, { opis: ' ' })).rejects.toThrow('Opis je obavezan');
    await expect(b.call('nalog:update', n, { kupacId: null })).rejects.toThrow('Kupac je obavezan za nalog po narudžbi');
    await expect(b.call('nalog:update', z, { kolicina: 0 })).rejects.toThrow('Količina mora biti veća od nule');
    expect(red('SELECT opis FROM radni_nalozi WHERE id = ?', n).opis).toBe('Kuhinja po mjeri');
  });

  test('završen nalog: smiju se samo dogovorena cijena, rok i napomena', async () => {
    const { id } = await zavrsenaNarudzba(null);
    await b.call('nalog:update', id, { dogovorenaCijena: 300, rok: '2026-09-01', napomena: 'dogovoreno' });
    expect(red('SELECT dogovorenaCijena, rok, napomena FROM radni_nalozi WHERE id = ?', id))
      .toEqual({ dogovorenaCijena: 300, rok: '2026-09-01', napomena: 'dogovoreno' });

    await expect(b.call('nalog:update', id, { dogovorenaCijena: 1, trosakRada: 5 }))
      .rejects.toThrow('Nalog je završen i ne može se mijenjati');
    expect(red('SELECT dogovorenaCijena FROM radni_nalozi WHERE id = ?', id).dogovorenaCijena).toBe(300);
  });

  test('fakturisan nalog je potpuno zaključan', async () => {
    const { id } = await zavrsenaNarudzba(100);
    await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    await expect(b.call('nalog:update', id, { napomena: 'x' })).rejects.toThrow('Nalog je završen i ne može se mijenjati');
  });

  test('izmjena datuma u drugu godinu daje sljedeći slobodan broj te godine; ista godina ne mijenja broj', async () => {
    const kupacId = dodajKupca();
    const id = await narudzba(kupacId, { datum: '2025-12-30' });
    const drugi2025 = await narudzba(kupacId, { datum: '2025-12-31' });
    await narudzba(kupacId, { datum: '2026-01-05' }); // RN-1/2026 već postoji

    await b.call('nalog:update', id, { datum: '2025-11-01' });
    expect(red('SELECT broj, godina, datum FROM radni_nalozi WHERE id = ?', id)).toEqual({ broj: 1, godina: 2025, datum: '2025-11-01' });

    await b.call('nalog:update', id, { datum: '2026-01-02' });
    expect(red('SELECT broj, godina, datum FROM radni_nalozi WHERE id = ?', id)).toEqual({ broj: 2, godina: 2026, datum: '2026-01-02' });
    expect(red('SELECT broj, godina FROM radni_nalozi WHERE id = ?', drugi2025)).toEqual({ broj: 2, godina: 2025 });

    // vraćanje u 2025: opet sljedeći slobodan broj (rupa RN-1/2025 se ne popunjava)
    await b.call('nalog:update', id, { datum: '2025-12-30' });
    expect(red('SELECT broj, godina FROM radni_nalozi WHERE id = ?', id)).toEqual({ broj: 3, godina: 2025 });
  });

  test('neispravan datum se odbija', async () => {
    const id = await narudzba(dodajKupca(), { datum: '2025-12-30' });
    await expect(b.call('nalog:update', id, { datum: '' })).rejects.toThrow('Datum naloga nije ispravan');
    await expect(b.call('nalog:update', id, { datum: 'abc' })).rejects.toThrow('Datum naloga nije ispravan');
    expect(red('SELECT broj, godina, datum FROM radni_nalozi WHERE id = ?', id)).toEqual({ broj: 1, godina: 2025, datum: '2025-12-30' });
  });
});

// ─── nalog:replaceStavke ────────────────────────────────────

describe('nalog:replaceStavke', () => {
  test('zamijeni cijeli set stavki; količina na 4 decimale; prazan niz briše sve', async () => {
    const m1 = dodajProizvod('M1', 'materijal');
    const m2 = dodajProizvod('M2', 'materijal');
    const id = await narudzba(dodajKupca());

    expect(await b.call('nalog:replaceStavke', id, [{ materijalId: m1, kolicina: 1 }])).toEqual({ success: true });
    await b.call('nalog:replaceStavke', id, [
      { materijalId: m2, kolicina: 0.123456, napomena: 'rez' },
      { materijalId: m2, kolicina: 3 },
    ]);
    expect(redovi('SELECT materijalId, kolicina, napomena FROM radni_nalog_stavke WHERE radniNalogId = ? ORDER BY id', id))
      .toEqual([
        { materijalId: m2, kolicina: 0.1235, napomena: 'rez' },
        { materijalId: m2, kolicina: 3, napomena: null },
      ]);

    await b.call('nalog:replaceStavke', id, []);
    expect(red('SELECT COUNT(*) AS n FROM radni_nalog_stavke WHERE radniNalogId = ?', id).n).toBe(0);
  });

  test('stavka mora biti materijal s količinom > 0; greška ne dira postojeće stavke', async () => {
    const m = dodajProizvod('M', 'materijal');
    const a = dodajProizvod('A', 'artikal');
    const id = await narudzba(dodajKupca());
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 5 }]);

    await expect(b.call('nalog:replaceStavke', id, [{ materijalId: a, kolicina: 1 }]))
      .rejects.toThrow('Stavka utroška mora biti materijal');
    await expect(b.call('nalog:replaceStavke', id, [{ materijalId: 999, kolicina: 1 }]))
      .rejects.toThrow('Stavka utroška mora biti materijal');
    await expect(b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 1 }, { materijalId: m, kolicina: 0 }]))
      .rejects.toThrow('Količina stavke mora biti veća od nule');
    await expect(b.call('nalog:replaceStavke', 999, [])).rejects.toThrow('Radni nalog ne postoji');
    expect(redovi('SELECT materijalId, kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?', id))
      .toEqual([{ materijalId: m, kolicina: 5 }]);
  });

  test('u izradi se smije, na završenom ne', async () => {
    const m = dodajProizvod('M', 'materijal');
    const id = await narudzba(dodajKupca());
    await b.call('nalog:setStatus', { id, status: 'u_izradi', korisnikId: ADMIN });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 1 }]);
    await zavrsi(id);
    await expect(b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 2 }]))
      .rejects.toThrow('Nalog je završen i ne može se mijenjati');
  });
});

// ─── nalog:setStatus ────────────────────────────────────────

describe('nalog:setStatus', () => {
  test('otvoren → u_izradi; ponovo u_izradi nije dozvoljeno', async () => {
    const id = await narudzba(dodajKupca());
    expect(await b.call('nalog:setStatus', { id, status: 'u_izradi', korisnikId: ADMIN })).toEqual({ success: true });
    expect(status(id)).toBe('u_izradi');
    await expect(b.call('nalog:setStatus', { id, status: 'u_izradi', korisnikId: ADMIN }))
      .rejects.toThrow('Prelaz u_izradi → u_izradi nije dozvoljen');
  });

  test('završetak zaliha: izlaz materijala po stavkama, ulaz gotovog proizvoda, zamrznuta prosječna nabavna', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const iverica = dodajProizvod('IV', 'materijal', { jm: 'm²' });
    primka(iverica, 10, 4);
    primka(iverica, 10, 6, { rabat: 10, zavisni: 2 }); // (40 + 54 + 2) / 20 = 4.8
    await b.call('normativ:save', stol, [{ materijalId: iverica, kolicina: 1.5 }]);
    const id = await zaliha(stol, 4); // 6 m²

    await zavrsi(id);

    expect(stanje(iverica)).toBe(14);
    expect(stanje(stol)).toBe(4);
    expect(redovi("SELECT productId, tip, kolicina FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ? ORDER BY id", id))
      .toEqual([
        { productId: iverica, tip: 'izlaz', kolicina: 6 },
        { productId: stol, tip: 'ulaz', kolicina: 4 },
      ]);
    expect(red('SELECT nabavnaCijena FROM radni_nalog_stavke WHERE radniNalogId = ?', id).nabavnaCijena).toBe(4.8);
    const n = red('SELECT status, zavrsenAt FROM radni_nalozi WHERE id = ?', id);
    expect(n.status).toBe('zavrsen');
    expect(n.zavrsenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('završetak narudžbe direktno iz "otvoren": samo izlaz materijala, bez ulaza proizvoda; bez primke cijena 0', async () => {
    const { id, mat } = await zavrsenaNarudzba(100);
    expect(status(id)).toBe('zavrsen');
    expect(stanje(mat)).toBe(8);
    expect(redovi("SELECT productId, tip, kolicina FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?", id))
      .toEqual([{ productId: mat, tip: 'izlaz', kolicina: 2 }]);
    expect(red('SELECT nabavnaCijena FROM radni_nalog_stavke WHERE radniNalogId = ?', id).nabavnaCijena).toBe(0);
  });

  test('negativno stanje ne blokira završetak (ploča se troši prije primke)', async () => {
    const ploca = dodajProizvod('IV', 'materijal', { jm: 'm²', plocaSirina: 2800, plocaVisina: 2070 });
    const id = await narudzba(dodajKupca());
    await b.call('nalog:replaceStavke', id, [{ materijalId: ploca, kolicina: 3.5 }]);
    await zavrsi(id);
    expect(stanje(ploca)).toBe(-3.5);
  });

  test('završetak bez stavki i dvostruki završetak su odbijeni', async () => {
    const id = await narudzba(dodajKupca());
    await expect(zavrsi(id)).rejects.toThrow('Nalog nema stavki utroška');
    expect(status(id)).toBe('otvoren');

    const z = await zavrsenaNarudzba(100);
    await expect(zavrsi(z.id)).rejects.toThrow('Nalog je već završen');
    await expect(b.call('nalog:setStatus', { id: z.id, status: 'u_izradi', korisnikId: ADMIN }))
      .rejects.toThrow('Prelaz zavrsen → u_izradi nije dozvoljen');
    expect(stanje(z.mat)).toBe(8);
  });

  test('vrati: admin poništava knjiženja, briše zamrznutu cijenu, nalog ide u izradu', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    primka(m, 10, 3);
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 2 }]);
    const id = await zaliha(stol, 2);
    await zavrsi(id);

    expect(await b.call('nalog:setStatus', { id, status: 'vrati', korisnikId: ADMIN })).toEqual({ success: true });
    expect(red('SELECT status, zavrsenAt FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'u_izradi', zavrsenAt: null });
    expect(red("SELECT COUNT(*) AS n FROM stock_movements WHERE referenceType = 'radni_nalog'").n).toBe(0);
    expect(stanje(m)).toBe(10);
    expect(stanje(stol)).toBe(0);
    expect(red('SELECT nabavnaCijena FROM radni_nalog_stavke WHERE radniNalogId = ?', id).nabavnaCijena).toBeNull();

    // ponovni završetak uzima novu prosječnu cijenu
    primka(m, 10, 5); // (30 + 50) / 20 = 4
    await zavrsi(id);
    expect(red('SELECT nabavnaCijena FROM radni_nalog_stavke WHERE radniNalogId = ?', id).nabavnaCijena).toBe(4);
    expect(stanje(m)).toBe(16);
  });

  test('vrati: samo administrator, samo završen, nikad fakturisan', async () => {
    const kasir = Number(b.db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Kasir', '1111', 'kasir')").run().lastInsertRowid);
    const otvoren = await narudzba(dodajKupca());
    const z = await zavrsenaNarudzba(100);

    await expect(b.call('nalog:setStatus', { id: z.id, status: 'vrati', korisnikId: kasir }))
      .rejects.toThrow('Vraćanje naloga u izradu može samo administrator');
    await expect(b.call('nalog:setStatus', { id: z.id, status: 'vrati', korisnikId: 999 }))
      .rejects.toThrow('Vraćanje naloga u izradu može samo administrator');
    expect(status(z.id)).toBe('zavrsen');

    await expect(b.call('nalog:setStatus', { id: otvoren, status: 'vrati', korisnikId: ADMIN }))
      .rejects.toThrow('Samo završen nalog se vraća u izradu');

    await b.call('nalog:izdajRacun', { id: z.id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    await expect(b.call('nalog:setStatus', { id: z.id, status: 'vrati', korisnikId: ADMIN }))
      .rejects.toThrow('Nalog je fakturisan i ne može se vratiti u izradu');
    expect(stanje(z.mat)).toBe(8);
  });

  test('nepoznat status i nepostojeći nalog', async () => {
    const id = await narudzba(dodajKupca());
    await expect(b.call('nalog:setStatus', { id, status: 'fakturisan', korisnikId: ADMIN })).rejects.toThrow('Nepoznat status');
    await expect(b.call('nalog:setStatus', { id: 999, status: 'u_izradi', korisnikId: ADMIN })).rejects.toThrow('Radni nalog ne postoji');
    await expect(b.call('nalog:setStatus', { id: 999, status: 'zavrsen', korisnikId: ADMIN })).rejects.toThrow('Radni nalog ne postoji');
    await expect(b.call('nalog:setStatus', { id: 999, status: 'vrati', korisnikId: ADMIN })).rejects.toThrow('Radni nalog ne postoji');
  });
});

// ─── nalog:delete ───────────────────────────────────────────

describe('nalog:delete', () => {
  test('briše nezavršen nalog i njegove stavke; ponuda se oslobađa za novi nalog', async () => {
    const kupacId = dodajKupca();
    const m = dodajProizvod('M', 'materijal');
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [{ productId: dodajProizvod('A', 'artikal'), kolicina: 1, cijena: 10 }]);
    const { id } = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    await b.call('nalog:setStatus', { id, status: 'u_izradi', korisnikId: ADMIN });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 1 }]);

    expect(await b.call('nalog:delete', id)).toEqual({ success: true });
    expect(red('SELECT COUNT(*) AS n FROM radni_nalozi').n).toBe(0);
    expect(red('SELECT COUNT(*) AS n FROM radni_nalog_stavke').n).toBe(0);
    expect(await b.call('nalog:zaPonudu', ponudaId)).toBeNull();
  });

  test('završen i fakturisan nalog se ne briše; knjiženja ostaju', async () => {
    const z = await zavrsenaNarudzba(100);
    await expect(b.call('nalog:delete', z.id)).rejects.toThrow('Nalog je završen i ne može se mijenjati');
    expect(stanje(z.mat)).toBe(8);
    await b.call('nalog:izdajRacun', { id: z.id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    await expect(b.call('nalog:delete', z.id)).rejects.toThrow('Nalog je završen i ne može se mijenjati');
    expect(red('SELECT COUNT(*) AS n FROM radni_nalozi').n).toBe(1);
  });

  test('nepostojeći nalog', async () => {
    await expect(b.call('nalog:delete', 999)).rejects.toThrow('Radni nalog ne postoji');
  });
});

// ─── nalog:kalkulacija ──────────────────────────────────────

describe('nalog:kalkulacija', () => {
  test('narudžba: materijal po prosječnoj nabavnoj (rabat + zavisni troškovi), rad, marža prema neto', async () => {
    const m = dodajProizvod('IV', 'materijal', { jm: 'm²' });
    primka(m, 10, 4);
    primka(m, 10, 6, { rabat: 10, zavisni: 2 }); // prosjek 4.8
    const id = await narudzba(dodajKupca(), { dogovorenaCijena: 117, trosakRada: 20 });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 5 }]);

    expect(await b.call('nalog:kalkulacija', id)).toEqual({
      stavke: [{ materijalId: m, naziv: 'Proizvod IV', jm: 'm²', kolicina: 5, cijena: 4.8, iznos: 24, stanje: 20, zamrznuto: false }],
      materijal: 24, rad: 20, ukupno: 44, upozorenja: [],
      neto: 100, marza: 56, marzaPct: 56,
    });
  });

  test('narudžba bez cijene: neto 0, marža negativna, marzaPct 0', async () => {
    const m = dodajProizvod('M', 'materijal', { stanje: 5 });
    primka(m, 1, 10);
    const id = await narudzba(dodajKupca(), { trosakRada: 5 });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 1 }]);
    const k = await b.call('nalog:kalkulacija', id);
    expect(k).toMatchObject({ materijal: 10, rad: 5, ukupno: 15, neto: 0, marza: -15, marzaPct: 0 });
  });

  test('upozorenja: materijal bez primke i utrošak iznad stanja (dok je nalog otvoren)', async () => {
    const m = dodajProizvod('LJ', 'materijal', { jm: 'l', stanje: 2 });
    const id = await narudzba(dodajKupca(), { dogovorenaCijena: 50 });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 5 }]);

    const k = await b.call('nalog:kalkulacija', id);
    expect(k.stavke[0]).toEqual({ materijalId: m, naziv: 'Proizvod LJ', jm: 'l', kolicina: 5, cijena: 0, iznos: 0, stanje: 2, zamrznuto: false });
    expect(k.upozorenja).toEqual([
      'Proizvod LJ: nema nabavne cijene (nema primke)',
      'Proizvod LJ: utrošak 5 prelazi stanje 2',
    ]);
  });

  test('zaliha: trošak po komadu; nakon završetka cijena je zamrznuta i ne prati nove primke', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    primka(m, 10, 3);
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 2 }]);
    const id = await zaliha(stol, 3, { trosakRada: 12 });

    const prije = await b.call('nalog:kalkulacija', id);
    expect(prije).toEqual({
      stavke: [{ materijalId: m, naziv: 'Proizvod M', jm: 'kom', kolicina: 6, cijena: 3, iznos: 18, stanje: 10, zamrznuto: false }],
      materijal: 18, rad: 12, ukupno: 30, poKomadu: 10, upozorenja: [],
    });

    await zavrsi(id);
    primka(m, 10, 9); // nova prosječna bi bila 6
    const poslije = await b.call('nalog:kalkulacija', id);
    expect(poslije.stavke[0]).toMatchObject({ cijena: 3, iznos: 18, stanje: 14, zamrznuto: true });
    expect(poslije).toMatchObject({ materijal: 18, ukupno: 30, poKomadu: 10, upozorenja: [] });
  });

  test('završen nalog ne upozorava na stanje (već je skinuto)', async () => {
    const m = dodajProizvod('M', 'materijal');
    primka(m, 1, 2);
    const id = await narudzba(dodajKupca(), { dogovorenaCijena: 10 });
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 3 }]);
    await zavrsi(id);
    const k = await b.call('nalog:kalkulacija', id);
    expect(k.stavke[0]).toMatchObject({ stanje: -2, zamrznuto: true, cijena: 2, iznos: 6 });
    expect(k.upozorenja).toEqual([]);
  });

  test('nalog bez stavki i nepostojeći nalog', async () => {
    const id = await narudzba(dodajKupca(), { trosakRada: 7.555 });
    expect(await b.call('nalog:kalkulacija', id)).toEqual({
      stavke: [], materijal: 0, rad: 7.56, ukupno: 7.56, neto: 0, marza: -7.56, marzaPct: 0, upozorenja: [],
    });
    await expect(b.call('nalog:kalkulacija', 999)).rejects.toThrow('Radni nalog ne postoji');
  });
});

// ─── nalog:izdajRacun ───────────────────────────────────────

describe('nalog:izdajRacun', () => {
  test('samostalni nalog: jedna stavka usluge NAMJ po dogovorenoj cijeni, nalog fakturisan', async () => {
    const { id, kupacId } = await zavrsenaNarudzba(234);

    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Virman' });
    expect(typeof r.racunId).toBe('number');
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101', odgovori: { BrojFiskalnogRacuna: '101' } });

    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('Namještaj po mjeri');
    expect(b.tring.zahtjevi[0].tijelo).toContain('4200000000009');

    const usluga = red("SELECT id, naziv, tip, pdvStopa, cijena FROM products WHERE sifra = 'NAMJ'");
    expect(usluga).toMatchObject({ naziv: 'Namještaj po mjeri', tip: 'usluga', pdvStopa: 'E', cijena: 0 });
    expect(red('SELECT korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, kupacNaziv, kupacIdBroj, kupacGrad FROM orders WHERE id = ?', r.racunId))
      .toEqual({ korisnikId: ADMIN, ukupno: 234, pdvIznos: 34, nacinPlacanja: 'Virman', brojFiskalnogRacuna: '101', status: 'completed', kupacNaziv: 'Kupac d.o.o.', kupacIdBroj: '4200000000009', kupacGrad: 'Sarajevo' });
    expect(redovi('SELECT productId, kolicina, cijena, rabat, pdvStopa FROM order_items WHERE orderId = ?', r.racunId))
      .toEqual([{ productId: usluga.id, kolicina: 1, cijena: 234, rabat: 0, pdvStopa: 'E' }]);
    expect(red('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', usluga.id).n).toBe(0);

    expect(red('SELECT status, racunId, kupacId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'fakturisan', racunId: r.racunId, kupacId });
    expect(await b.call('nalog:get', id)).toMatchObject({ racunBroj: '101', racunStatus: 'completed' });
  });

  test('postojeća usluga NAMJ se ponovo koristi', async () => {
    const postojeca = dodajProizvod('NAMJ', 'usluga');
    const { id } = await zavrsenaNarudzba(50);
    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(red('SELECT productId FROM order_items WHERE orderId = ?', r.racunId).productId).toBe(postojeca);
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(1);
  });

  test('nalog iz ponude: račun sa stavkama ponude, ponuda konvertovana, nalog fakturisan', async () => {
    const kupacId = dodajKupca();
    const ormar = dodajProizvod('ORM', 'artikal', { stanje: 5 });
    const mont = dodajProizvod('MONT', 'usluga');
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [
      { productId: ormar, kolicina: 2, cijena: 400 },
      { productId: mont, kolicina: 1, cijena: 100 },
    ]);
    const { id } = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    const m = dodajProizvod('M', 'materijal');
    await b.call('nalog:replaceStavke', id, [{ materijalId: m, kolicina: 1 }]);
    await zavrsi(id);

    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(typeof r.racunId).toBe('number');
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('Proizvod ORM');
    expect(b.tring.zahtjevi[0].tijelo).not.toContain('Namještaj po mjeri');

    expect(red('SELECT ukupno, brojFiskalnogRacuna, kupacNaziv FROM orders WHERE id = ?', r.racunId))
      .toEqual({ ukupno: 900, brojFiskalnogRacuna: '101', kupacNaziv: 'Kupac d.o.o.' });
    expect(redovi('SELECT productId, kolicina, cijena FROM order_items WHERE orderId = ? ORDER BY id', r.racunId))
      .toEqual([{ productId: ormar, kolicina: 2, cijena: 400 }, { productId: mont, kolicina: 1, cijena: 100 }]);
    expect(stanje(ormar)).toBe(3);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', ponudaId)).toEqual({ status: 'konvertovana', racunId: r.racunId });
    expect(red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'fakturisan', racunId: r.racunId });
  });

  test('ponuda već konvertovana sa ekrana Ponude: nalog se samo poveže, bez štampe', async () => {
    const kupacId = dodajKupca();
    const a = dodajProizvod('A', 'artikal');
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [{ productId: a, kolicina: 1, cijena: 100 }]);
    const { id } = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod('M', 'materijal'), kolicina: 1 }]);
    await zavrsi(id);
    const orderId = Number(b.db.prepare(
      "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status) VALUES (?, 100, 14.53, 'Gotovina', '55', 'completed')"
    ).run(ADMIN).lastInsertRowid);
    b.db.prepare("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?").run(orderId, ponudaId);

    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r).toEqual({ success: true, racunId: orderId, brojFiskalnogRacuna: '55', odgovori: {} });
    expect(b.tring.zahtjevi).toEqual([]);
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(1);
    expect(red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'fakturisan', racunId: orderId });
  });

  test('greška printera: vraća success false, ništa se ne upisuje, nalog ostaje završen', async () => {
    const { id } = await zavrsenaNarudzba(100);
    b.tring.greskaNa('/sfr', 'Nema papira');

    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.racunId).toBeUndefined();
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'zavrsen', racunId: null });

    // nakon greške može ponovo
    const r2 = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r2).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
  });

  test('greška printera za nalog iz ponude: ponuda ostaje prihvaćena', async () => {
    const kupacId = dodajKupca();
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [{ productId: dodajProizvod('A', 'artikal'), kolicina: 1, cijena: 10 }]);
    const { id } = await b.call('nalog:createIzPonude', ponudaId, ADMIN);
    await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod('M', 'materijal'), kolicina: 1 }]);
    await zavrsi(id);
    b.tring.greskaNa('/sfr', 'Nema papira');

    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r.success).toBe(false);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', ponudaId)).toEqual({ status: 'prihvacena', racunId: null });
    expect(status(id)).toBe('zavrsen');
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });

  test('odbija prije štampe: zaliha, nezavršen, fakturisan, bez cijene, nepostojeći', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const z = await zaliha(stol, 1);
    const otvoren = await narudzba(dodajKupca(), { dogovorenaCijena: 100 });
    const bezCijene = await zavrsenaNarudzba(null);
    const nula = await zavrsenaNarudzba(0);
    const izdaj = (id: number) => b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });

    await expect(izdaj(z)).rejects.toThrow('Račun se izdaje samo za nalog po narudžbi');
    await expect(izdaj(otvoren)).rejects.toThrow('Nalog mora biti završen prije izdavanja računa');
    await expect(izdaj(bezCijene.id)).rejects.toThrow('Dogovorena cijena mora biti upisana prije izdavanja računa');
    await expect(izdaj(nula.id)).rejects.toThrow('Dogovorena cijena mora biti upisana prije izdavanja računa');
    await expect(izdaj(999)).rejects.toThrow('Radni nalog ne postoji');
    expect(b.tring.zahtjevi).toEqual([]);

    const f = await zavrsenaNarudzba(10);
    await izdaj(f.id);
    await expect(izdaj(f.id)).rejects.toThrow('Nalog mora biti završen prije izdavanja računa');
    expect(b.tring.zahtjevi).toHaveLength(1);
  });

  test('šifra NAMJ zauzeta artiklom koji nije usluga: odbija prije štampe, zaliha se ne dira', async () => {
    const artikal = dodajProizvod('NAMJ', 'artikal', { stanje: 5 });
    const { id } = await zavrsenaNarudzba(100);

    await expect(b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Šifra NAMJ je zauzeta artiklom "Proizvod NAMJ" koji nije usluga — promijenite šifru tog artikla pa ponovo izdajte račun');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(stanje(artikal)).toBe(5);
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(status(id)).toBe('zavrsen');
  });

  test('greška printera ne ostavlja novu uslugu NAMJ; kreira se tek uz uspješan upis', async () => {
    const { id } = await zavrsenaNarudzba(100);
    b.tring.greskaNa('/sfr', 'Nema papira');
    expect((await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' })).success).toBe(false);
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(0);
  });

  test('nepostojeći korisnik se odbija prije štampe (samostalni i nalog iz ponude)', async () => {
    const { id } = await zavrsenaNarudzba(100);
    const kupacId = dodajKupca();
    const ponudaId = dodajPonudu(kupacId, 'prihvacena', [{ productId: dodajProizvod('A', 'artikal'), kolicina: 1, cijena: 10 }]);
    const izPonude = (await b.call('nalog:createIzPonude', ponudaId, ADMIN)).id;
    await b.call('nalog:replaceStavke', izPonude, [{ materijalId: dodajProizvod('M', 'materijal'), kolicina: 1 }]);
    await zavrsi(izPonude);

    for (const nalogId of [id, izPonude]) {
      for (const korisnikId of [0, 999]) {
        await expect(b.call('nalog:izdajRacun', { id: nalogId, korisnikId, nacinPlacanja: 'Gotovina' }))
          .rejects.toThrow('Korisnik nije prijavljen');
      }
    }
    expect(b.tring.zahtjevi).toEqual([]);
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(status(id)).toBe('zavrsen');
    expect(status(izPonude)).toBe('zavrsen');
  });

  test('bez načina plaćanja račun ide kao Gotovina (štampa i baza se slažu)', async () => {
    const { id } = await zavrsenaNarudzba(100);
    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: '' });
    expect(r.success).toBe(true);
    expect(red('SELECT nacinPlacanja FROM orders WHERE id = ?', r.racunId).nacinPlacanja).toBe('Gotovina');
  });

  test('dva istovremena izdavanja za isti nalog: drugo se odbija, štampa se jednom', async () => {
    const { id } = await zavrsenaNarudzba(100);
    const data = { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' };
    const [prvi, drugi] = await Promise.allSettled([b.call('nalog:izdajRacun', data), b.call('nalog:izdajRacun', data)]);

    expect(prvi.status).toBe('fulfilled');
    expect(drugi.status).toBe('rejected');
    expect((drugi as PromiseRejectedResult).reason.message).toContain('Izdavanje računa za ovaj nalog je već u toku');
    expect(b.tring.zahtjevi).toHaveLength(1);
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(1);
  });
});

// ─── normativ:get / normativ:save ───────────────────────────

describe('normativ:save i normativ:get', () => {
  test('save zamjenjuje cijeli set; get vraća stavke s podacima materijala po redoslijedu unosa', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const iv = dodajProizvod('IV', 'materijal', { jm: 'm²', plocaSirina: 2800, plocaVisina: 2070 });
    const vj = dodajProizvod('VJ', 'materijal');
    const kt = dodajProizvod('KT', 'materijal', { jm: 'm' });

    expect(await b.call('normativ:get', stol)).toEqual([]);
    expect(await b.call('normativ:save', stol, [{ materijalId: kt, kolicina: 4 }])).toEqual({ success: true });
    await b.call('normativ:save', stol, [
      { materijalId: iv, kolicina: 0.123456, napomena: '600×400 ×2' },
      { materijalId: vj, kolicina: 8 },
    ]);

    const n: any[] = await b.call('normativ:get', stol);
    expect(n).toHaveLength(2);
    expect(n[0]).toMatchObject({
      productId: stol, materijalId: iv, kolicina: 0.1235, napomena: '600×400 ×2',
      materijalNaziv: 'Proizvod IV', materijalSifra: 'IV', materijalJm: 'm²',
    });
    expect(typeof n[0].id).toBe('number');
    expect(n[1]).toMatchObject({ productId: stol, materijalId: vj, kolicina: 8, napomena: null, materijalJm: 'kom' });
    expect(red('SELECT COUNT(*) AS n FROM normativi WHERE materijalId = ?', kt).n).toBe(0);

    await b.call('normativ:save', stol, []);
    expect(await b.call('normativ:get', stol)).toEqual([]);
  });

  test('normativ ne mijenja postojeće naloge', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 1 }]);
    const id = await zaliha(stol, 2);
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 5 }]);
    expect(red('SELECT kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?', id).kolicina).toBe(2);
  });

  test('validacije: normativ samo za artikal, stavke samo materijal s količinom > 0; greška ne dira postojeći', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    const u = dodajProizvod('U', 'usluga');
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 3 }]);

    await expect(b.call('normativ:save', m, [])).rejects.toThrow('Normativ se vodi samo za artikal');
    await expect(b.call('normativ:save', u, [])).rejects.toThrow('Normativ se vodi samo za artikal');
    await expect(b.call('normativ:save', 999, [])).rejects.toThrow('Normativ se vodi samo za artikal');
    await expect(b.call('normativ:save', stol, [{ materijalId: stol, kolicina: 1 }])).rejects.toThrow('Stavka utroška mora biti materijal');
    await expect(b.call('normativ:save', stol, [{ materijalId: m, kolicina: -1 }])).rejects.toThrow('Količina stavke mora biti veća od nule');
    expect(redovi('SELECT materijalId, kolicina FROM normativi WHERE productId = ?', stol)).toEqual([{ materijalId: m, kolicina: 3 }]);
  });

  test('isti materijal dvaput u normativu se odbija, postojeći normativ ostaje', async () => {
    const stol = dodajProizvod('STOL', 'artikal');
    const m = dodajProizvod('M', 'materijal');
    await b.call('normativ:save', stol, [{ materijalId: m, kolicina: 3 }]);
    await expect(b.call('normativ:save', stol, [{ materijalId: m, kolicina: 1 }, { materijalId: m, kolicina: 2 }]))
      .rejects.toThrow('Materijal "Proizvod M" je unesen više puta — saberite količine u jednu stavku');
    expect(redovi('SELECT materijalId, kolicina FROM normativi WHERE productId = ?', stol)).toEqual([{ materijalId: m, kolicina: 3 }]);
  });

  test('get za nepostojeći proizvod vraća prazno', async () => {
    expect(await b.call('normativ:get', 999)).toEqual([]);
  });
});
