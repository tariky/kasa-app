// Ugovor za kanale ponuda:*, prilog:* i fiscal:* — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, ADMIN_PIN, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // seedovani admin; harness mu postavi ADMIN_PIN i prijavi se
const GODINA = new Date().getFullYear();

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

function dodajKupca(naziv = 'Firma d.o.o.', idBroj = '4200000000001'): number {
  return Number(b.db.prepare(
    "INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad) VALUES (?, ?, '200000000001', 'Titova 1', '71000', 'Sarajevo')"
  ).run(naziv, idBroj).lastInsertRowid);
}

function stanje(productId: number): number {
  const r = b.db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `).get(productId) as { s: number };
  return r.s;
}

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: any[]): any[] {
  return b.db.prepare(sql).all(...params);
}

function broj(sql: string, ...params: any[]): number {
  return red(sql, ...params).n;
}

function stavka(productId: number, kolicina: number, cijena: number, rabat = 0, pdvStopa = 'E') {
  return { productId, kolicina, cijena, rabat, pdvStopa };
}

function danas(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plusDana(datum: string, dana: number): string {
  const d = new Date(`${datum}T00:00:00`);
  d.setDate(d.getDate() + dana);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function napraviPonudu(extra: Record<string, unknown> = {}): Promise<{ id: number; broj: number; godina: number; kupacId: number; p: number }> {
  const kupacId = (extra.kupacId as number) ?? dodajKupca();
  const p = dodajArtikal(`P${Math.random().toString(36).slice(2, 8)}`, 10, { stanje: 10 });
  const r = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, stavke: [stavka(p, 2, 10)], ...extra });
  return { ...r, kupacId, p };
}

/** Račun po prilogu upisan direktno — bez štampe, da prilog:* testovi ne ovise o fiskalnom nizu. */
function prilogRacun(ukupno = 50, status = 'completed'): number {
  return Number(b.db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, prilogBroj, prilogNaziv)
    VALUES (?, ?, 0, 'Virman', '101', ?, 101, 'Stavke po računu br. 101')
  `).run(ADMIN, ukupno, status).lastInsertRowid);
}

function prilogStavka(productId: number, kolicina: number, cijena: number, pdvStopa = 'E') {
  return { productId, kolicina, cijena, pdvStopa };
}

// ─── ponuda:nextBroj ────────────────────────────────────────

describe('ponuda:nextBroj', () => {
  test('brojanje kreće od 1 u tekućoj godini, druge godine se ne broje', async () => {
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 1, godina: GODINA });

    await napraviPonudu({ datum: `${GODINA - 1}-06-01` });
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 1, godina: GODINA });

    await napraviPonudu();
    await napraviPonudu();
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 3, godina: GODINA });
  });

  test('nastavak iz starog programa: sljedeći broj je iza upisanog, create ga upiše', async () => {
    await b.call('settings:set', 'dokumenti.ponuda.nastavakBroj', '12');
    await b.call('settings:set', 'dokumenti.ponuda.nastavakGodina', String(GODINA));
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 13, godina: GODINA });

    const { id } = await napraviPonudu();
    expect(red('SELECT broj, godina FROM ponude WHERE id = ?', id)).toEqual({ broj: 13, godina: GODINA });
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 14, godina: GODINA });
  });

  test('nastavak manji od najvećeg broja u bazi: broji se od najvećeg', async () => {
    await napraviPonudu();
    await napraviPonudu();
    await napraviPonudu();
    await b.call('settings:set', 'dokumenti.ponuda.nastavakBroj', '2');
    await b.call('settings:set', 'dokumenti.ponuda.nastavakGodina', String(GODINA));
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 4, godina: GODINA });
  });

  test('nastavak za drugu godinu ne dira tekuću', async () => {
    await b.call('settings:set', 'dokumenti.ponuda.nastavakBroj', '50');
    await b.call('settings:set', 'dokumenti.ponuda.nastavakGodina', String(GODINA - 1));
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 1, godina: GODINA });
    const { id } = await napraviPonudu();
    expect(red('SELECT broj, godina FROM ponude WHERE id = ?', id)).toEqual({ broj: 1, godina: GODINA });
    // U svojoj godini nastavak važi.
    const stara = await napraviPonudu({ datum: `${GODINA - 1}-06-01` });
    expect(red('SELECT broj, godina FROM ponude WHERE id = ?', stara.id)).toEqual({ broj: 51, godina: GODINA - 1 });
  });
});

// ─── ponuda:create ──────────────────────────────────────────

describe('ponuda:create', () => {
  test('upisuje ponudu i stavke, računa totale, rok 8 dana', async () => {
    const kupacId = dodajKupca();
    const a = dodajArtikal('C1', 117, { stanje: 5 });
    const c = dodajArtikal('C2', 100);

    const r = await b.call('ponuda:create', {
      kupacId, korisnikId: ADMIN, napomena: 'Opcija 8 dana',
      stavke: [stavka(a, 1, 117), stavka(c, 2, 100, 10, 'K')],
    });

    expect(Object.keys(r)).toEqual(['id', 'broj', 'godina']);
    expect(typeof r.id).toBe('number');
    expect(r).toMatchObject({ broj: 1, godina: GODINA });
    expect(red('SELECT * FROM ponude WHERE id = ?', r.id)).toMatchObject({
      broj: 1, godina: GODINA, kupacId, korisnikId: ADMIN, datum: danas(), vaziDo: plusDana(danas(), 8),
      status: 'draft', napomena: 'Opcija 8 dana', ukupno: 297, pdvIznos: 17, racunId: null,
    });
    expect(redovi('SELECT productId, kolicina, cijena, rabat, pdvStopa FROM ponuda_stavke WHERE ponudaId = ? ORDER BY id', r.id))
      .toEqual([
        { productId: a, kolicina: 1, cijena: 117, rabat: 0, pdvStopa: 'E' },
        { productId: c, kolicina: 2, cijena: 100, rabat: 10, pdvStopa: 'K' },
      ]);
    // Ponuda ne dira skladište.
    expect(stanje(a)).toBe(5);
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('godina i broj idu po datumu ponude; zadani rok i napomena', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('C3', 1);
    const s = [stavka(p, 1, 1)];

    const a = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, datum: '2025-12-30', stavke: s });
    const c = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, datum: '2025-05-01', vaziDo: '2025-06-01', stavke: s });
    const d = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, datum: '2026-01-02', stavke: s });

    expect([a, c, d].map(x => [x.broj, x.godina])).toEqual([[1, 2025], [2, 2025], [1, 2026]]);
    expect(red('SELECT vaziDo, napomena FROM ponude WHERE id = ?', a.id)).toEqual({ vaziDo: '2026-01-07', napomena: null });
    expect(red('SELECT vaziDo FROM ponude WHERE id = ?', c.id).vaziDo).toBe('2025-06-01');
  });

  test('autor je prijavljeni korisnik; korisnikId iz payload-a se ignoriše', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('C5', 1);
    const { id } = await b.call('ponuda:create', { kupacId, korisnikId: 999, stavke: [stavka(p, 1, 1)] });
    expect(red('SELECT korisnikId FROM ponude WHERE id = ?', id).korisnikId).toBe(ADMIN);
    await b.call('user:logout');
    await expect(b.call('ponuda:create', { kupacId, stavke: [stavka(p, 1, 1)] })).rejects.toThrow('Niste prijavljeni');
    expect(broj('SELECT COUNT(*) AS n FROM ponude')).toBe(1);
  });

  test('validacije: stavke, kupac', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('C4', 1);

    await expect(b.call('ponuda:create', { kupacId, korisnikId: ADMIN, stavke: [] }))
      .rejects.toThrow('Ponuda mora imati najmanje jednu stavku');
    await expect(b.call('ponuda:create', { kupacId: 0, korisnikId: ADMIN, stavke: [stavka(p, 1, 1)] }))
      .rejects.toThrow('Kupac je obavezan');
    // Nepostojeći kupac pada na stranom ključu baze; ništa se ne upisuje.
    await expect(b.call('ponuda:create', { kupacId: 999, korisnikId: ADMIN, stavke: [stavka(p, 1, 1)] }))
      .rejects.toThrow();
    expect(broj('SELECT COUNT(*) AS n FROM ponude')).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke')).toBe(0);
  });
});

// ─── ponuda:getAll ──────────────────────────────────────────

describe('ponuda:getAll', () => {
  test('od najnovije godine i broja, s kupcem, korisnikom i brojem računa', async () => {
    const kupacId = dodajKupca('Kupac A');
    const stara = await napraviPonudu({ kupacId, datum: '2025-03-01' });
    const prva = await napraviPonudu({ kupacId, datum: `${GODINA}-01-10` });
    const druga = await napraviPonudu({ kupacId, datum: `${GODINA}-01-05` });

    const lista: any[] = await b.call('ponuda:getAll');
    expect(lista.map(p => p.id)).toEqual([druga.id, prva.id, stara.id]);
    expect(lista[0]).toMatchObject({
      broj: 2, godina: GODINA, kupacNaziv: 'Kupac A', korisnikIme: 'Admin', racunBroj: null, status: 'draft',
    });
    expect(lista[0].stavke).toBeUndefined();
  });

  test('istekla ponuda se ne označava u bazi — status ostaje kakav je upisan', async () => {
    await napraviPonudu({ datum: '2020-01-01', vaziDo: '2020-01-09' });
    const [p] = await b.call('ponuda:getAll');
    expect(p).toMatchObject({ status: 'draft', vaziDo: '2020-01-09' });
  });

  test('prazna lista', async () => {
    expect(await b.call('ponuda:getAll')).toEqual([]);
  });
});

// ─── ponuda:get ─────────────────────────────────────────────

describe('ponuda:get', () => {
  test('ponuda sa podacima kupca i stavkama s podacima artikla', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('G1', 4.5);
    const { id } = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, stavke: [stavka(p, 2, 4.5)] });

    const po = await b.call('ponuda:get', id);
    expect(po).toMatchObject({
      id, broj: 1, godina: GODINA, status: 'draft', ukupno: 9, korisnikIme: 'Admin', racunBroj: null,
      kupacNaziv: 'Firma d.o.o.', kupacIdBroj: '4200000000001', kupacPdvBroj: '200000000001',
      kupacAdresa: 'Titova 1', kupacGrad: 'Sarajevo', kupacPostanskiBroj: '71000',
    });
    expect(po.stavke).toEqual([expect.objectContaining({
      ponudaId: id, productId: p, kolicina: 2, cijena: 4.5, rabat: 0, pdvStopa: 'E',
      productNaziv: 'Artikal G1', productJm: 'kom', productSifra: 'G1', productPlu: 1,
    })]);
  });

  test('cijene su zamrznute — promjena cjenovnika ne mijenja ponudu', async () => {
    const { id, p } = await napraviPonudu();
    b.db.prepare('UPDATE products SET cijena = 99 WHERE id = ?').run(p);

    const po = await b.call('ponuda:get', id);
    expect(po.ukupno).toBe(20);
    expect(po.stavke[0].cijena).toBe(10);
  });

  test('nepostojeća ponuda je greška', async () => {
    await expect(b.call('ponuda:get', 999)).rejects.toThrow('Ponuda ne postoji');
  });
});

// ─── ponuda:update ──────────────────────────────────────────

describe('ponuda:update', () => {
  test('zamjenjuje stavke i totale, broj i godina se ne mijenjaju', async () => {
    const { id, kupacId } = await napraviPonudu({ napomena: 'Stara' });
    const drugi = dodajKupca('Drugi', '4200000000009');
    const x = dodajArtikal('U1', 117);

    expect(await b.call('ponuda:update', id, {
      kupacId: drugi, datum: '2030-02-01', vaziDo: '2030-03-01', stavke: [stavka(x, 3, 117)],
    })).toEqual({ success: true });

    expect(red('SELECT broj, godina, kupacId, datum, vaziDo, napomena, ukupno, pdvIznos FROM ponude WHERE id = ?', id))
      .toEqual({ broj: 1, godina: GODINA, kupacId: drugi, datum: '2030-02-01', vaziDo: '2030-03-01', napomena: 'Stara', ukupno: 351, pdvIznos: 51 });
    expect(redovi('SELECT productId, kolicina FROM ponuda_stavke WHERE ponudaId = ?', id)).toEqual([{ productId: x, kolicina: 3 }]);
    expect(kupacId).not.toBe(drugi);
  });

  test('izostavljena polja ostaju, prazna napomena briše staru', async () => {
    const { id, kupacId, p } = await napraviPonudu({ napomena: 'Stara', datum: '2026-05-01', vaziDo: '2026-05-20' });

    await b.call('ponuda:update', id, { stavke: [stavka(p, 1, 10)] });
    expect(red('SELECT kupacId, datum, vaziDo, napomena, ukupno FROM ponude WHERE id = ?', id))
      .toEqual({ kupacId, datum: '2026-05-01', vaziDo: '2026-05-20', napomena: 'Stara', ukupno: 10 });

    await b.call('ponuda:update', id, { napomena: '', stavke: [stavka(p, 1, 10)] });
    expect(red('SELECT napomena FROM ponude WHERE id = ?', id).napomena).toBe('');
  });

  test('odbija prazne stavke, nepostojeću i konvertovanu ponudu', async () => {
    const { id, p } = await napraviPonudu();

    await expect(b.call('ponuda:update', id, { stavke: [] })).rejects.toThrow('Ponuda mora imati najmanje jednu stavku');
    await expect(b.call('ponuda:update', 999, { stavke: [stavka(p, 1, 1)] })).rejects.toThrow('Ponuda ne postoji');

    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    await expect(b.call('ponuda:update', id, { stavke: [stavka(p, 5, 1)] }))
      .rejects.toThrow('Konvertovana ponuda se ne može mijenjati');
    expect(redovi('SELECT kolicina, cijena FROM ponuda_stavke WHERE ponudaId = ?', id)).toEqual([{ kolicina: 2, cijena: 10 }]);
  });
});

describe('ponuda:create / ponuda:update — provjera stavki', () => {
  const lose = (p: number): Array<[Record<string, unknown>, string]> => [
    [{ kolicina: 0 }, 'Količina mora biti veća od 0'],
    [{ kolicina: '1' }, 'Količina mora biti veća od 0'],
    [{ cijena: -1 }, 'Cijena ne može biti negativna'],
    [{ cijena: null }, 'Cijena mora biti broj'],
    [{ rabat: 100.5 }, 'Rabat mora biti od 0 do 100 %'],
    [{ pdvStopa: 'X' }, 'PDV stopa mora biti E ili K'],
    [{ productId: 424242 }, 'Proizvod #424242 ne postoji'],
    [{ productId: `${p}` }, `Proizvod #${p} ne postoji`],
  ];

  test('rabat 100 % je dozvoljen', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('Q0', 10);
    const r = await b.call('ponuda:create', { kupacId, stavke: [stavka(p, 1, 10, 100), stavka(p, 2, 10)] });
    expect(red('SELECT ukupno FROM ponude WHERE id = ?', r.id).ukupno).toBe(20);
  });

  test('create odbija neispravnu stavku i ništa ne upisuje', async () => {
    const kupacId = dodajKupca();
    const p = dodajArtikal('Q1', 10);
    for (const [polje, poruka] of lose(p)) {
      await expect(b.call('ponuda:create', { kupacId, stavke: [{ ...stavka(p, 1, 10), ...polje }] }), JSON.stringify(polje))
        .rejects.toThrow(poruka);
    }
    await expect(b.call('ponuda:create', { kupacId, stavke: [null] })).rejects.toThrow('Neispravna stavka računa');
    await expect(b.call('ponuda:create', { kupacId, stavke: { length: 1 } })).rejects.toThrow('Neispravna stavka računa');
    expect(broj('SELECT COUNT(*) AS n FROM ponude')).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke')).toBe(0);
  });

  test('update odbija neispravnu stavku i ne dira postojeće', async () => {
    const { id, p } = await napraviPonudu();
    for (const [polje, poruka] of lose(p)) {
      await expect(b.call('ponuda:update', id, { stavke: [{ ...stavka(p, 1, 10), ...polje }] }), JSON.stringify(polje))
        .rejects.toThrow(poruka);
    }
    expect(redovi('SELECT kolicina, cijena FROM ponuda_stavke WHERE ponudaId = ?', id)).toEqual([{ kolicina: 2, cijena: 10 }]);
    expect(red('SELECT ukupno FROM ponude WHERE id = ?', id).ukupno).toBe(20);
  });
});

// ─── ponuda:setStatus ───────────────────────────────────────

describe('ponuda:setStatus', () => {
  test('ručni statusi se mogu mijenjati u bilo kom smjeru', async () => {
    const { id } = await napraviPonudu();
    for (const s of ['poslana', 'prihvacena', 'odbijena', 'draft', 'prihvacena']) {
      expect(await b.call('ponuda:setStatus', id, s)).toEqual({ success: true });
      expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe(s);
    }
  });

  test('"konvertovana" se ne postavlja ručno', async () => {
    const { id } = await napraviPonudu();
    await expect(b.call('ponuda:setStatus', id, 'konvertovana'))
      .rejects.toThrow('Status "konvertovana" postavlja se konverzijom u račun');
    // Provjera statusa ide prije provjere postojanja.
    await expect(b.call('ponuda:setStatus', 999, 'konvertovana'))
      .rejects.toThrow('Status "konvertovana" postavlja se konverzijom u račun');
    expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe('draft');
  });

  test('nepostojeća, konvertovana i nepoznat status', async () => {
    const { id } = await napraviPonudu();
    await expect(b.call('ponuda:setStatus', 999, 'poslana')).rejects.toThrow('Ponuda ne postoji');
    await expect(b.call('ponuda:setStatus', id, 'istekla')).rejects.toThrow('Nepoznat status ponude');
    expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe('draft');

    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    await expect(b.call('ponuda:setStatus', id, 'draft')).rejects.toThrow('Konvertovana ponuda se ne može mijenjati');
    expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe('konvertovana');
  });

  test('nepoznat status se odbija jasnom porukom prije upisa, ne greškom CHECK ograničenja baze', async () => {
    const { id } = await napraviPonudu();
    for (const s of ['istekla', 'nepostoji', '', null]) {
      await expect(b.call('ponuda:setStatus', id, s)).rejects.toThrow('Nepoznat status ponude');
    }
    await expect(b.call('ponuda:setStatus', id, 'istekla')).rejects.toThrow('Nepoznat status ponude: "istekla"');
    await expect(b.call('ponuda:setStatus', id, 'istekla')).rejects.not.toThrow('CHECK');
    // Validacija ulaza ide prije provjere postojanja.
    await expect(b.call('ponuda:setStatus', 999, 'istekla')).rejects.toThrow('Nepoznat status ponude');
    expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe('draft');
  });
});

// ─── ponuda:delete ──────────────────────────────────────────

describe('ponuda:delete', () => {
  test('briše ponudu i stavke, vraća broj obrisanih', async () => {
    const { id } = await napraviPonudu();
    const druga = await napraviPonudu();

    expect(await b.call('ponuda:delete', id)).toEqual({ changes: 1 });
    expect(broj('SELECT COUNT(*) AS n FROM ponude WHERE id = ?', id)).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke WHERE ponudaId = ?', id)).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke WHERE ponudaId = ?', druga.id)).toBe(1);
  });

  test('nepostojeća ponuda nije greška', async () => {
    expect(await b.call('ponuda:delete', 999)).toEqual({ changes: 0 });
  });

  test('broj obrisane ponude se ponovo dodjeljuje ako je bila zadnja', async () => {
    const { id } = await napraviPonudu();
    await b.call('ponuda:delete', id);
    expect(await b.call('ponuda:nextBroj')).toEqual({ broj: 1, godina: GODINA });
  });

  test('konvertovana ponuda se ne briše', async () => {
    const { id } = await napraviPonudu();
    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });

    await expect(b.call('ponuda:delete', id))
      .rejects.toThrow('Konvertovana ponuda se ne može obrisati — po njoj je izdat račun');
    expect(broj('SELECT COUNT(*) AS n FROM ponude WHERE id = ?', id)).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke WHERE ponudaId = ?', id)).toBe(1);
  });

  test('ponuda za koju postoji radni nalog se ne briše — jasna poruka, nalog ostaje', async () => {
    const { id } = await napraviPonudu();
    await b.call('ponuda:setStatus', id, 'prihvacena');
    const nalog = await b.call('nalog:createIzPonude', id, ADMIN);

    await expect(b.call('ponuda:delete', id)).rejects.toThrow(
      `Ponuda je vezana za radni nalog br. ${nalog.broj}/${nalog.godina} — prvo obrišite nalog`
    );
    await expect(b.call('ponuda:delete', id)).rejects.not.toThrow('FOREIGN KEY');
    expect(broj('SELECT COUNT(*) AS n FROM ponude WHERE id = ?', id)).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM ponuda_stavke WHERE ponudaId = ?', id)).toBe(1);
    expect(broj('SELECT COUNT(*) AS n FROM radni_nalozi WHERE ponudaId = ?', id)).toBe(1);

    // Kad se nalog obriše, ponuda se može obrisati.
    await b.call('nalog:delete', nalog.id);
    expect(await b.call('ponuda:delete', id)).toEqual({ changes: 1 });
  });
});

// ─── ponuda:konvertuj ───────────────────────────────────────

describe('ponuda:konvertuj', () => {
  test('štampa pa upisuje račun po zamrznutim cijenama i zaključava ponudu', async () => {
    const kupacId = dodajKupca();
    const a = dodajArtikal('K1', 10, { stanje: 10 });
    const u = dodajArtikal('K2', 30, { tip: 'usluga' });
    const { id } = await b.call('ponuda:create', {
      kupacId, korisnikId: ADMIN, stavke: [stavka(a, 3, 10), stavka(u, 1, 30, 10)],
    });
    b.db.prepare('UPDATE products SET cijena = 99').run();

    const r = await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Virman' });

    expect(Object.keys(r).sort()).toEqual(['brojFiskalnogRacuna', 'odgovori', 'racunId', 'success']);
    expect(typeof r.racunId).toBe('number');
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101', odgovori: { BrojFiskalnogRacuna: '101' } });

    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    const tijelo = b.tring.zahtjevi[0].tijelo;
    expect(tijelo).toContain('Artikal K1');
    expect(tijelo).toContain('4200000000001');
    expect(tijelo).toContain('Virman');

    expect(red('SELECT * FROM orders WHERE id = ?', r.racunId)).toMatchObject({
      korisnikId: ADMIN, ukupno: 57, nacinPlacanja: 'Virman', brojFiskalnogRacuna: '101', status: 'completed',
      isManual: 0, prilogBroj: null, kupacNaziv: 'Firma d.o.o.', kupacIdBroj: '4200000000001',
      kupacAdresa: 'Titova 1', kupacGrad: 'Sarajevo', kupacPostanskiBroj: '71000',
    });
    expect(redovi('SELECT productId, kolicina, cijena, rabat FROM order_items WHERE orderId = ? ORDER BY id', r.racunId))
      .toEqual([{ productId: a, kolicina: 3, cijena: 10, rabat: 0 }, { productId: u, kolicina: 1, cijena: 30, rabat: 10 }]);
    expect(stanje(a)).toBe(7);
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', u)).toBe(0);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', id)).toEqual({ status: 'konvertovana', racunId: r.racunId });

    const [lista] = await b.call('ponuda:getAll');
    expect(lista).toMatchObject({ status: 'konvertovana', racunBroj: '101' });
    expect((await b.call('ponuda:get', id)).racunBroj).toBe('101');
  });

  test('istekla ponuda se smije konvertovati', async () => {
    const { id } = await napraviPonudu({ datum: '2020-01-01', vaziDo: '2020-01-09' });
    const r = await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r.success).toBe(true);
    expect(red('SELECT status FROM ponude WHERE id = ?', id).status).toBe('konvertovana');
  });

  test('greška printera: ništa se ne upisuje, ponuda ostaje otvorena', async () => {
    const { id, p } = await napraviPonudu();
    await b.call('ponuda:setStatus', id, 'prihvacena');
    b.tring.greskaNa('/sfr', 'Nema papira');

    const r = await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });

    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.racunId).toBeUndefined();
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
    expect(stanje(p)).toBe(10);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', id)).toEqual({ status: 'prihvacena', racunId: null });

    // Nakon greške se može ponoviti.
    const ponovo = await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(ponovo).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
  });

  test('već konvertovana ponuda se ne štampa ponovo', async () => {
    const { id } = await napraviPonudu();
    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });

    await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Ponuda je već konvertovana u račun');
    expect(b.tring.zahtjevi).toHaveLength(1);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(1);
  });

  test('nepostojeća ponuda i ponuda bez stavki se odbijaju prije štampe', async () => {
    await expect(b.call('ponuda:konvertuj', { id: 999, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Ponuda ne postoji');

    const { id } = await napraviPonudu();
    b.db.prepare('DELETE FROM ponuda_stavke WHERE ponudaId = ?').run(id);
    await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Ponuda nema stavki');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('broj s uređaja postaje zadnji fiskalni broj u bazi', async () => {
    const { id } = await napraviPonudu();
    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: 101, zadnjiUpisani: null, predvidjeni: 102 });
  });

  test('bez prijavljenog korisnika odbija se PRIJE štampe; korisnikId iz payload-a se ignoriše', async () => {
    const { id, p } = await napraviPonudu();
    await b.call('user:logout');
    for (const korisnikId of [0, undefined, null, 999, ADMIN]) {
      await expect(b.call('ponuda:konvertuj', { id, korisnikId, nacinPlacanja: 'Gotovina' }))
        .rejects.toThrow('Niste prijavljeni');
    }
    expect(b.tring.zahtjevi).toEqual([]);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
    expect(stanje(p)).toBe(10);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', id)).toEqual({ status: 'draft', racunId: null });

    // Nakon prijave konverzija prolazi, a račun nosi prijavljenog korisnika.
    await b.call('user:login', ADMIN_PIN);
    const r = await b.call('ponuda:konvertuj', { id, korisnikId: 999, nacinPlacanja: 'Gotovina' });
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', r.racunId).korisnikId).toBe(ADMIN);
  });

  test('način plaćanja: izostavljen ili nepoznat se odbija PRIJE štampe', async () => {
    const { id } = await napraviPonudu();
    for (const nacinPlacanja of [undefined, null, '', '  ']) {
      await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja }))
        .rejects.toThrow('Način plaćanja je obavezan');
    }
    await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Bitcoin' }))
      .rejects.toThrow('Nepoznat način plaćanja: "Bitcoin"');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);

    expect(await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Ček' }))
      .toMatchObject({ success: true });
    expect(red('SELECT nacinPlacanja FROM orders').nacinPlacanja).toBe('Ček');
  });

  test('stavka s artiklom koji više ne postoji odbija se PRIJE štampe', async () => {
    const { id, p } = await napraviPonudu();
    // Artikal nestao mimo stranog ključa (stara baza / ručni zahvat).
    b.db.exec('PRAGMA foreign_keys = OFF');
    b.db.prepare('DELETE FROM products WHERE id = ?').run(p);
    b.db.exec('PRAGMA foreign_keys = ON');

    await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Artikal na stavci ponude više ne postoji');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
  });

  test('odbijena ponuda se ne pretvara u račun — jasna poruka, bez štampe', async () => {
    const { id, p } = await napraviPonudu();
    await b.call('ponuda:setStatus', id, 'odbijena');

    await expect(b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Odbijena ponuda se ne može pretvoriti u račun');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
    expect(stanje(p)).toBe(10);
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', id)).toEqual({ status: 'odbijena', racunId: null });

    // Ako se kupac predomisli, operater vrati status pa konvertuje.
    await b.call('ponuda:setStatus', id, 'prihvacena');
    expect(await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }))
      .toMatchObject({ success: true });
  });
});

// ─── prilog:getStavke ───────────────────────────────────────

describe('prilog:getStavke', () => {
  test('bez stavki i za nepostojeći račun vraća praznu listu', async () => {
    const id = prilogRacun();
    expect(await b.call('prilog:getStavke', id)).toEqual([]);
    expect(await b.call('prilog:getStavke', 999)).toEqual([]);
  });

  test('stavke po redu unosa, s podacima artikla', async () => {
    const id = prilogRacun();
    const a = dodajArtikal('L1', 5);
    const u = dodajArtikal('L2', 20, { tip: 'usluga' });
    b.db.prepare("INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 2, 5, 'E')").run(id, u);
    b.db.prepare("INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 4, 5, 'E')").run(id, a);

    const s: any[] = await b.call('prilog:getStavke', id);
    expect(s).toHaveLength(2);
    expect(Object.keys(s[0]).sort()).toEqual(
      ['cijena', 'id', 'kolicina', 'orderId', 'pdvStopa', 'productId', 'rabat', 'productJm', 'productNaziv', 'productSifra', 'productTip'].sort()
    );
    expect(s.map(x => x.productId)).toEqual([u, a]);
    expect(s[0]).toMatchObject({
      orderId: id, kolicina: 2, cijena: 5, pdvStopa: 'E',
      productNaziv: 'Artikal L2', productJm: 'kom', productSifra: 'L2', productTip: 'usluga',
    });
  });
});

// ─── prilog:saveStavke ──────────────────────────────────────

describe('prilog:saveStavke', () => {
  test('rabat se pamti po stavci, a bez njega je 0', async () => {
    const id = prilogRacun(60);
    const a = dodajArtikal('R1', 10);
    const c = dodajArtikal('R2', 5);
    await b.call('prilog:saveStavke', id, [{ ...prilogStavka(a, 5, 10), rabat: 10 }, prilogStavka(c, 1, 5)]);
    expect((await b.call('prilog:getStavke', id)).map((s: any) => [s.productId, s.rabat])).toEqual([[a, 10], [c, 0]]);
    await expect(b.call('prilog:saveStavke', id, [{ ...prilogStavka(a, 1, 10), rabat: -1 }]))
      .rejects.toThrow('Rabat mora biti od 0 do 100 %');
  });

  test('upisuje stavke i razdužuje skladište, usluge ne', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S1', 5, { stanje: 10 });
    const u = dodajArtikal('S2', 20, { tip: 'usluga' });

    expect(await b.call('prilog:saveStavke', id, [prilogStavka(a, 2, 5), prilogStavka(u, 2, 20)])).toEqual({ success: true });

    expect((await b.call('prilog:getStavke', id)).map((s: any) => [s.productId, s.kolicina, s.cijena]))
      .toEqual([[a, 2, 5], [u, 2, 20]]);
    expect(stanje(a)).toBe(8);
    expect(broj('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', u)).toBe(0);
    expect(red("SELECT tip, kolicina, referenceType, referenceId FROM stock_movements WHERE productId = ? AND referenceType = 'prilog'", a))
      .toEqual({ tip: 'izlaz', kolicina: 2, referenceType: 'prilog', referenceId: id });
    // Stavke priloga ne idu u order_items niti na uređaj.
    expect(broj('SELECT COUNT(*) AS n FROM order_items WHERE orderId = ?', id)).toBe(0);
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('ponovni upis zamjenjuje set i zalihu, prazan set briše sve', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S3', 5, { stanje: 10 });
    const c = dodajArtikal('S4', 5, { stanje: 10 });

    await b.call('prilog:saveStavke', id, [prilogStavka(a, 4, 5)]);
    await b.call('prilog:saveStavke', id, [prilogStavka(a, 1, 5), prilogStavka(c, 3, 5)]);
    expect((await b.call('prilog:getStavke', id)).map((s: any) => [s.productId, s.kolicina])).toEqual([[a, 1], [c, 3]]);
    expect([stanje(a), stanje(c)]).toEqual([9, 7]);

    await b.call('prilog:saveStavke', id, []);
    expect(await b.call('prilog:getStavke', id)).toEqual([]);
    expect([stanje(a), stanje(c)]).toEqual([10, 10]);
  });

  test('zbir stavki ne mora odgovarati iznosu računa', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S5', 5);
    expect(await b.call('prilog:saveStavke', id, [prilogStavka(a, 1, 30)])).toEqual({ success: true });
    expect(red('SELECT ukupno FROM orders WHERE id = ?', id).ukupno).toBe(50);
  });

  test('odbija račun koji ne postoji ili nije po prilogu', async () => {
    const a = dodajArtikal('S6', 5);
    const obican = Number(b.db.prepare(
      "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (?, 5, 0, 'Gotovina', 'completed')"
    ).run(ADMIN).lastInsertRowid);

    await expect(b.call('prilog:saveStavke', 999, [prilogStavka(a, 1, 5)])).rejects.toThrow('Račun ne postoji');
    await expect(b.call('prilog:saveStavke', obican, [prilogStavka(a, 1, 5)])).rejects.toThrow('Ovo nije račun po prilogu');
    expect(broj('SELECT COUNT(*) AS n FROM prilog_stavke')).toBe(0);
  });

  test('neispravna stavka odbija cijeli upis, stari set ostaje', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S7', 5, { stanje: 10 });
    await b.call('prilog:saveStavke', id, [prilogStavka(a, 2, 5)]);

    const slucajevi: Array<[any, string]> = [
      [prilogStavka(a, 0, 5), 'Količina mora biti veća od 0'],
      [prilogStavka(a, -1, 5), 'Količina mora biti veća od 0'],
      [prilogStavka(a, 1, -1), 'Cijena ne može biti negativna'],
      [prilogStavka(a, 1, 5, 'K'), 'U prilog smiju samo stavke sa PDV stopom E (zbirna stavka je fiskalizovana sa E)'],
      [prilogStavka(999, 1, 5), 'Proizvod #999 ne postoji'],
    ];
    for (const [losa, poruka] of slucajevi) {
      await expect(b.call('prilog:saveStavke', id, [prilogStavka(a, 1, 5), losa])).rejects.toThrow(poruka);
    }
    expect((await b.call('prilog:getStavke', id)).map((s: any) => s.kolicina)).toEqual([2]);
    expect(stanje(a)).toBe(8);
  });

  test('kompletna faktura je zaključana: stavke i zaliha ostaju kakve jesu', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S9', 5, { stanje: 20 });
    // Nekompletan set se smije mijenjati više puta…
    await b.call('prilog:saveStavke', id, [prilogStavka(a, 4, 5)]);
    await b.call('prilog:saveStavke', id, [prilogStavka(a, 10, 5)]);
    expect(stanje(a)).toBe(10);

    // …a kad se suma poklopi s fiskalnim iznosom, faktura je završena.
    for (const novi of [[prilogStavka(a, 1, 50)], []]) {
      await expect(b.call('prilog:saveStavke', id, novi))
        .rejects.toThrow('Faktura je završena — stavke se ne mogu mijenjati');
    }
    expect((await b.call('prilog:getStavke', id)).map((s: any) => s.kolicina)).toEqual([10]);
    expect(stanje(a)).toBe(10);
  });

  test('storniran račun: prilog je zaključan, storno je vratio zalihu po stavkama priloga', async () => {
    const id = prilogRacun(50);
    const a = dodajArtikal('S8', 5, { stanje: 10 });
    await b.call('prilog:saveStavke', id, [prilogStavka(a, 3, 5)]);
    expect(stanje(a)).toBe(7);

    expect(await b.call('order:refundAndPrint', { id })).toMatchObject({ success: true });
    expect(stanje(a)).toBe(10);

    await expect(b.call('prilog:saveStavke', id, [prilogStavka(a, 1, 5)]))
      .rejects.toThrow('Račun je storniran — prilog se ne može mijenjati');
    await expect(b.call('prilog:saveStavke', id, [])).rejects.toThrow('Račun je storniran — prilog se ne može mijenjati');
    expect((await b.call('prilog:getStavke', id)).map((s: any) => s.kolicina)).toEqual([3]);
    expect(stanje(a)).toBe(10);
  });

  test('stavke unesene na kasi kod order:finalizePrilog se vide kroz prilog:getStavke', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const a = dodajArtikal('S9', 5, { stanje: 10 });
    const r = await b.call('order:finalizePrilog', {
      korisnikId: ADMIN, nacinPlacanja: 'Virman', stavke: [prilogStavka(a, 2, 5)],
    });
    expect(r.success).toBe(true);
    expect((await b.call('prilog:getStavke', r.id)).map((s: any) => [s.productId, s.kolicina])).toEqual([[a, 2]]);
    expect(stanje(a)).toBe(8);
  });
});

// ─── fiscal:getNumeracija / fiscal:setZadnjiBroj ────────────

function racunSaBrojem(brojFiskalnogRacuna: string | null, createdAt: string): number {
  return Number(b.db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, createdAt) VALUES (?, 1, 0, 'Gotovina', ?, 'completed', ?)"
  ).run(ADMIN, brojFiskalnogRacuna, createdAt).lastInsertRowid);
}

function postavka(key: string): string | null {
  return red('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

describe('fiscal:getNumeracija', () => {
  test('prazna baza bez upisa: ništa se ne zna', async () => {
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: null, zadnjiUpisani: null, predvidjeni: null });
  });

  test('zadnji u bazi je zadnji po datumu, ne najveći; reklamacije i nenumerički se preskaču', async () => {
    racunSaBrojem('500', '2026-01-01 08:00:00');
    racunSaBrojem('9', '2026-02-01 08:00:00');
    racunSaBrojem('R-3', '2026-03-01 08:00:00');
    racunSaBrojem('12/A', '2026-03-02 08:00:00');
    racunSaBrojem(null, '2026-03-03 08:00:00');

    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: 9, zadnjiUpisani: null, predvidjeni: 10 });
  });

  test('isti datum: odlučuje kasnije upisan račun', async () => {
    racunSaBrojem('20', '2026-02-01 08:00:00');
    racunSaBrojem('7', '2026-02-01 08:00:00');
    expect((await b.call('fiscal:getNumeracija')).zadnjiUBazi).toBe(7);
  });
});

describe('fiscal:setZadnjiBroj', () => {
  test('bez računa u bazi, upisani broj određuje predviđanje', async () => {
    expect(await b.call('fiscal:setZadnjiBroj', 100)).toEqual({ success: true, predvidjeni: 101 });
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: null, zadnjiUpisani: 100, predvidjeni: 101 });
    expect(postavka('fiscal.zadnjiBroj')).toBe('100');
    expect(postavka('fiscal.zadnjiBrojAt')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('nula znači da uređaj još nije štampao', async () => {
    expect(await b.call('fiscal:setZadnjiBroj', 0)).toEqual({ success: true, predvidjeni: 1 });
  });

  test('ručna ispravka poslije zadnjeg računa pobjeđuje bazu', async () => {
    racunSaBrojem('50', '2026-01-01 08:00:00');
    expect(await b.call('fiscal:setZadnjiBroj', 200)).toEqual({ success: true, predvidjeni: 201 });
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: 50, zadnjiUpisani: 200, predvidjeni: 201 });
  });

  test('račun noviji od ručnog upisa ponovo preuzima niz', async () => {
    await b.call('fiscal:setZadnjiBroj', 200);
    racunSaBrojem('50', '2099-01-01 08:00:00');
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: 50, zadnjiUpisani: 200, predvidjeni: 51 });
  });

  test('račun izdat kroz program poslije upisa pomjera predviđanje', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const { id } = await napraviPonudu();
    await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' }); // uređaj vrati 101
    expect(await b.call('fiscal:getNumeracija')).toEqual({ zadnjiUBazi: 101, zadnjiUpisani: 100, predvidjeni: 102 });
  });

  test('ponovni upis prepisuje stari broj', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    await b.call('fiscal:setZadnjiBroj', 40);
    expect(postavka('fiscal.zadnjiBroj')).toBe('40');
    expect(broj("SELECT COUNT(*) AS n FROM settings WHERE key = 'fiscal.zadnjiBroj'")).toBe(1);
  });

  test('odbija negativan, decimalan i nenumerički broj', async () => {
    const poruka = 'Posljednji fiskalni broj mora biti cijeli broj 0 ili veći';
    await expect(b.call('fiscal:setZadnjiBroj', -1)).rejects.toThrow(poruka);
    await expect(b.call('fiscal:setZadnjiBroj', 1.5)).rejects.toThrow(poruka);
    await expect(b.call('fiscal:setZadnjiBroj', '5')).rejects.toThrow(poruka);
    await expect(b.call('fiscal:setZadnjiBroj', null)).rejects.toThrow(poruka);
    expect(postavka('fiscal.zadnjiBroj')).toBeNull();
  });
});
