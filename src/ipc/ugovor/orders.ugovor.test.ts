// Ugovor za kanale order:* i pending:* — vidi backend.ts.
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

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function stavka(productId: number, kolicina: number, cijena: number) {
  return { productId, kolicina, cijena, rabat: 0, pdvStopa: 'E' };
}

function racun(stavke: ReturnType<typeof stavka>[], extra: Record<string, unknown> = {}) {
  const ukupno = stavke.reduce((s, x) => s + x.kolicina * x.cijena, 0);
  return { korisnikId: ADMIN, ukupno, pdvIznos: 0, nacinPlacanja: 'Gotovina', stavke, ...extra };
}

function kasaStavka(productId: number, kolicina: number, cijena: number) {
  const p = red('SELECT sifra, naziv, jm, plu FROM products WHERE id = ?', productId);
  return { ...stavka(productId, kolicina, cijena), sifra: p.sifra, naziv: p.naziv, jm: p.jm, plu: p.plu };
}

async function rucni(broj: string, createdAt: string, productId: number): Promise<number> {
  const r = await b.call('order:createManual', racun([stavka(productId, 1, 10)], { brojFiskalnogRacuna: broj, createdAt }));
  return r.id;
}

/** Sada kao lokalni "YYYY-MM-DD HH:MM:SS" — račun "od danas" (ladica ga broji). */
function sada(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let sljedeciBroj = 1000;
/** Račun upisan u bazu bez štampe (order:createManual), s datumom sada. */
async function izdaj(stavke: ReturnType<typeof stavka>[], extra: Record<string, unknown> = {}): Promise<{ id: number }> {
  return b.call('order:createManual', racun(stavke, { brojFiskalnogRacuna: String(++sljedeciBroj), createdAt: sada(), ...extra }));
}

// ─── order:createManual ─────────────────────────────────────

describe('order:createManual', () => {
  test('čuva zadani datum i broj, označava račun kao ručni', async () => {
    const p = dodajArtikal('M1', 10, { stanje: 5 });
    const id = await rucni(' 77 ', '2026-01-15 10:30:00', p);

    expect(red('SELECT brojFiskalnogRacuna, createdAt, isManual FROM orders WHERE id = ?', id))
      .toEqual({ brojFiskalnogRacuna: '77', createdAt: '2026-01-15 10:30:00', isManual: 1 });
    expect(red("SELECT createdAt FROM stock_movements WHERE referenceType = 'order' AND referenceId = ?", id).createdAt)
      .toBe('2026-01-15 10:30:00');
    expect(stanje(p)).toBe(4);
  });

  test('odbija duplikat fiskalnog broja', async () => {
    const p = dodajArtikal('M2', 10);
    await rucni('77', '2026-01-15 10:30:00', p);
    await expect(rucni('77', '2026-01-16 10:30:00', p)).rejects.toThrow('Fiskalni račun sa tim brojem već postoji');
  });

  test('upisuje kupca, stavke i izlaz sa zalihe; usluga ne skida zalihu', async () => {
    const p = dodajArtikal('A1', 5, { stanje: 10 });
    const u = dodajArtikal('U1', 20, { tip: 'usluga' });
    const r = await izdaj([stavka(p, 3, 5), stavka(u, 2, 20)], {
      brojFiskalnogRacuna: '42',
      kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', grad: 'Sarajevo' },
    });

    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    const o = red('SELECT * FROM orders WHERE id = ?', r.id);
    expect(o).toMatchObject({
      korisnikId: ADMIN, ukupno: 55, status: 'completed', brojFiskalnogRacuna: '42', isManual: 1,
      kupacNaziv: 'Firma d.o.o.', kupacIdBroj: '4200000000001', kupacGrad: 'Sarajevo', kupacAdresa: null,
    });
    expect(red('SELECT COUNT(*) AS n FROM order_items WHERE orderId = ?', r.id).n).toBe(2);
    expect(stanje(p)).toBe(7);
    expect(red('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', u).n).toBe(0);
  });

  test('odbija račun bez stavki', async () => {
    await expect(izdaj([])).rejects.toThrow('Račun mora imati najmanje jednu stavku');
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });

  test('traži fiskalni broj i datum', async () => {
    const p = dodajArtikal('M3', 10);
    await expect(b.call('order:createManual', racun([stavka(p, 1, 10)], { brojFiskalnogRacuna: ' ', createdAt: '2026-01-15' })))
      .rejects.toThrow('Fiskalni broj je obavezan');
    await expect(b.call('order:createManual', racun([stavka(p, 1, 10)], { brojFiskalnogRacuna: '1', createdAt: '' })))
      .rejects.toThrow('Datum računa je obavezan');
  });
});

// ─── order:getAll / order:get ───────────────────────────────

describe('order:getAll i order:get', () => {
  test('lista je od najnovijeg, s imenom korisnika i PDV brojem kupca', async () => {
    const p = dodajArtikal('G1', 10);
    b.db.prepare("INSERT INTO kupci (naziv, idBroj, pdvBroj) VALUES ('Kupac', '4200000000002', '200000000002')").run();
    const stari = await rucni('1', '2026-01-01 08:00:00', p);
    const novi = (await b.call('order:createManual', racun([stavka(p, 1, 10)], {
      brojFiskalnogRacuna: '2', createdAt: '2026-02-01 08:00:00', kupac: { naziv: 'Kupac', idBroj: '4200000000002' },
    }))).id;

    const lista: any[] = await b.call('order:getAll');
    expect(lista.map(o => o.id)).toEqual([novi, stari]);
    expect(lista[0]).toMatchObject({ korisnikIme: 'Admin', kupacPdvBroj: '200000000002' });
    expect(lista[1].kupacPdvBroj).toBeNull();
  });

  test('račun dolazi sa stavkama i podacima artikla', async () => {
    const p = dodajArtikal('G2', 4.5);
    const { id } = await izdaj([stavka(p, 2, 4.5)]);

    const o = await b.call('order:get', id);
    expect(o).toMatchObject({ id, ukupno: 9, korisnikIme: 'Admin' });
    expect(o.stavke).toEqual([expect.objectContaining({
      productId: p, kolicina: 2, cijena: 4.5, rabat: 0, pdvStopa: 'E',
      productNaziv: 'Artikal G2', productJm: 'kom', productSifra: 'G2', productPlu: 1,
    })]);
  });

  test('nepostojeći račun je greška', async () => {
    await expect(b.call('order:get', 999)).rejects.toThrow('Račun ne postoji');
  });
});

// ─── order:finalize ─────────────────────────────────────────

describe('order:finalize', () => {
  test('štampa pa upisuje račun s brojem sa uređaja', async () => {
    const p = dodajArtikal('F1', 2.5, { stanje: 10 });
    const r = await b.call('order:finalize', racun([kasaStavka(p, 2, 2.5)]));

    // Bez expect.any u toMatchObject: Bun 1.3 njime prepiše polje u `r`.
    expect(typeof r.id).toBe('number');
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(r.odgovori.BrojFiskalnogRacuna).toBe('101');
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('Artikal F1');
    expect(red('SELECT brojFiskalnogRacuna, isManual FROM orders WHERE id = ?', r.id)).toEqual({ brojFiskalnogRacuna: '101', isManual: 0 });
    expect(stanje(p)).toBe(8);
    expect(red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
  });

  test('greška printera: ništa se ne upisuje', async () => {
    const p = dodajArtikal('F2', 2.5, { stanje: 10 });
    b.tring.greskaNa('/sfr', 'Nema papira');

    const r = await b.call('order:finalize', racun([kasaStavka(p, 1, 2.5)]));

    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
    expect(stanje(p)).toBe(10);
  });

  test('prazan račun se odbija prije štampe', async () => {
    await expect(b.call('order:finalize', racun([]))).rejects.toThrow('Račun mora imati najmanje jednu stavku');
    expect(b.tring.zahtjevi).toEqual([]);
  });
});

// ─── order:finalizePrilog ───────────────────────────────────

describe('order:finalizePrilog', () => {
  test('bez poznatog zadnjeg fiskalnog broja ne štampa', async () => {
    await expect(b.call('order:finalizePrilog', { korisnikId: ADMIN, iznos: 50, nacinPlacanja: 'Virman' }))
      .rejects.toThrow('Nije poznat posljednji fiskalni broj');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('račun nosi broj isječka i jednu zbirnu stavku', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const r = await b.call('order:finalizePrilog', { korisnikId: ADMIN, iznos: 50, nacinPlacanja: 'Virman' });

    expect(r).toMatchObject({ success: true, prilogBroj: 101, brojFiskalnogRacuna: '101' });
    expect(r.upozorenje).toBeUndefined();
    const o = await b.call('order:get', r.id);
    expect(o).toMatchObject({ prilogBroj: 101, ukupno: 50 });
    expect(o.stavke).toHaveLength(1);
    expect(o.stavke[0]).toMatchObject({ kolicina: 1, cijena: 50, pdvStopa: 'E' });
  });

  test('stavke s rabatom, valuta i napomena idu na fakturu', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = dodajArtikal('F1', 20, { stanje: 10 });
    const r = await b.call('order:finalizePrilog', {
      korisnikId: ADMIN, nacinPlacanja: 'Virman', prilogVeza: 'fakturi',
      stavke: [{ productId: p, kolicina: 3, cijena: 20, rabat: 25, pdvStopa: 'E' }],
      datumValute: '2026-10-01', napomena: ' Isporuka petkom ',
    });

    expect(red('SELECT ukupno, datumValute, napomena, prilogNaziv FROM orders WHERE id = ?', r.id))
      .toEqual({ ukupno: 45, datumValute: '2026-10-01', napomena: 'Isporuka petkom', prilogNaziv: 'Stavke po fakturi br. 101' });
    expect(red('SELECT kolicina, cijena, rabat FROM prilog_stavke WHERE orderId = ?', r.id))
      .toEqual({ kolicina: 3, cijena: 20, rabat: 25 });
    expect(stanje(p)).toBe(7);
  });

  test('neispravan datum valute, predugačka napomena i rabat se odbijaju prije štampe', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = dodajArtikal('F2', 20);
    const osnova = { korisnikId: ADMIN, nacinPlacanja: 'Virman', iznos: 10 };
    await expect(b.call('order:finalizePrilog', { ...osnova, datumValute: '2026-13-01' }))
      .rejects.toThrow('Neispravan datum valute: 2026-13-01');
    await expect(b.call('order:finalizePrilog', { ...osnova, napomena: 'x'.repeat(501) }))
      .rejects.toThrow('Napomena može imati najviše 500 znakova');
    await expect(b.call('order:finalizePrilog', { ...osnova, stavke: [{ productId: p, kolicina: 1, cijena: 20, rabat: 100, pdvStopa: 'E' }] }))
      .rejects.toThrow('Rabat mora biti između 0 i 100 %');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('faktura iz ponude konvertuje ponudu; odbijena i konvertovana se odbijaju', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const kupac = Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Firma', '4200000000001')").run().lastInsertRowid);
    const ponuda = (status: string) => Number(b.db.prepare(`
      INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos, status)
      VALUES (?, 2026, ?, ?, '2026-09-01', '2026-09-30', 10, 1.45, ?)
    `).run(Math.floor(Math.random() * 1e6), kupac, ADMIN, status).lastInsertRowid);
    const osnova = { korisnikId: ADMIN, nacinPlacanja: 'Virman', iznos: 10 };

    const odbijena = ponuda('odbijena');
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: odbijena })).rejects.toThrow('Odbijena ponuda');
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: 999 })).rejects.toThrow('Ponuda ne postoji');
    expect(b.tring.zahtjevi).toEqual([]);

    const prihvacena = ponuda('prihvacena');
    const r = await b.call('order:finalizePrilog', { ...osnova, ponudaId: prihvacena });
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', prihvacena)).toEqual({ status: 'konvertovana', racunId: r.id });
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: prihvacena }))
      .rejects.toThrow('Ponuda je već konvertovana u račun');
  });
});

// ─── order:setDatumValute ───────────────────────────────────

describe('order:setDatumValute', () => {
  test('postavlja, briše i odbija neispravan datum', async () => {
    const p = dodajArtikal('V1', 1);
    const { id } = await izdaj([stavka(p, 1, 1)]);

    expect(await b.call('order:setDatumValute', id, '2026-10-01')).toEqual({ datumValute: '2026-10-01' });
    expect(red('SELECT datumValute FROM orders WHERE id = ?', id).datumValute).toBe('2026-10-01');
    expect(await b.call('order:setDatumValute', id, null)).toEqual({ datumValute: null });
    await expect(b.call('order:setDatumValute', id, '2026-02-30')).rejects.toThrow('Neispravan datum valute');
    await expect(b.call('order:setDatumValute', 999, '2026-10-01')).rejects.toThrow('Račun ne postoji');
  });
});

// ─── order:refundAndPrint ───────────────────────────────────

describe('order:refundAndPrint', () => {
  test('štampa reklamaciju i upisuje broj sa uređaja, samo jednom', async () => {
    const p = dodajArtikal('S2', 3, { stanje: 10 });
    const { id } = await izdaj([stavka(p, 2, 3)], { brojFiskalnogRacuna: '55' });

    const r = await b.call('order:refundAndPrint', { id });

    expect(r).toMatchObject({ success: true, brojReklamacije: 'R-1', pologIznos: 0 });
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/srr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('55');
    expect(red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id))
      .toEqual({ status: 'refunded', brojReklamacije: 'R-1' });
    expect(red('SELECT refundedAt FROM orders WHERE id = ?', id).refundedAt).toBeTruthy();
    expect(stanje(p)).toBe(10);

    await expect(b.call('order:refundAndPrint', { id })).rejects.toThrow('Račun ne postoji ili je već storniran');
    expect(b.tring.zahtjevi).toHaveLength(1);
    expect(stanje(p)).toBe(10);
  });

  test('bezgotovinski račun: pokriće se prvo unese u uređaj', async () => {
    const p = dodajArtikal('S3', 30);
    const { id } = await izdaj([stavka(p, 1, 30)], { brojFiskalnogRacuna: '56', nacinPlacanja: 'Kartica' });

    const r = await b.call('order:refundAndPrint', { id });

    expect(r.success).toBe(true);
    const putanje = b.tring.zahtjevi.map(z => z.putanja);
    expect(putanje.at(-1)).toBe('/srr');
    expect(putanje[0]).toMatch(/^\/(unosnovca|un)$/);
    expect(b.tring.zahtjevi[0].tijelo).toContain('30');
  });

  test('greška printera: račun ostaje nestorniran', async () => {
    const p = dodajArtikal('S4', 3, { stanje: 10 });
    const { id } = await izdaj([stavka(p, 1, 3)], { brojFiskalnogRacuna: '57' });
    b.tring.greskaNa('/srr', 'Uređaj zauzet');

    const r = await b.call('order:refundAndPrint', { id });

    expect(r.success).toBe(false);
    expect(red('SELECT status FROM orders WHERE id = ?', id).status).toBe('completed');
    expect(stanje(p)).toBe(9);
  });

  test('nenumerički fiskalni broj se odbija prije štampe', async () => {
    const p = dodajArtikal('S5', 3);
    const { id } = await izdaj([stavka(p, 1, 3)], { brojFiskalnogRacuna: '12/A' });
    await expect(b.call('order:refundAndPrint', { id })).rejects.toThrow('nije ispravan broj računa');
    expect(b.tring.zahtjevi).toEqual([]);
  });
});

// ─── order:getFiscalGaps / order:dismissFiscalGap ───────────

describe('fiskalne praznine', () => {
  test('vraća brojeve koji fale, bez odbačenih', async () => {
    const p = dodajArtikal('P1', 1);
    await rucni('5', '2026-01-01 08:00:00', p);
    await rucni('9', '2026-01-02 08:00:00', p);
    await rucni('X-1', '2026-01-03 08:00:00', p); // nenumerički se ignoriše

    expect(await b.call('order:getFiscalGaps')).toEqual([6, 7, 8]);
    expect(await b.call('order:dismissFiscalGap', 7)).toEqual({ success: true });
    await b.call('order:dismissFiscalGap', 7);
    expect(await b.call('order:getFiscalGaps')).toEqual([6, 8]);
    expect(JSON.parse(red("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").value)).toEqual([7]);
  });
});

// ─── pending:* ──────────────────────────────────────────────

describe('pending:*', () => {
  function dodajPending(snapshot: object): number {
    return Number(b.db.prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
      .run(ADMIN, JSON.stringify(snapshot)).lastInsertRowid);
  }

  test('list vraća snapshot kao objekat', async () => {
    const id = dodajPending({ ukupno: 7, stavke: [] });
    expect(await b.call('pending:list')).toEqual([
      { id, korisnikId: ADMIN, createdAt: expect.any(String), snapshot: { ukupno: 7, stavke: [] } },
    ]);
  });

  test('resolve pretvara snapshot u ručni račun s unesenim brojem', async () => {
    const p = dodajArtikal('N1', 6, { stanje: 10 });
    const id = dodajPending(racun([stavka(p, 2, 6)]));

    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: ' 300 ', createdAt: '2026-03-03 12:00:00' });

    expect(red('SELECT brojFiskalnogRacuna, isManual, createdAt, ukupno FROM orders WHERE id = ?', r.id))
      .toEqual({ brojFiskalnogRacuna: '300', isManual: 1, createdAt: '2026-03-03 12:00:00', ukupno: 12 });
    expect(stanje(p)).toBe(8);
    expect(await b.call('pending:list')).toEqual([]);
  });

  test('resolve odbija postojeći broj i nepostojeći zapis', async () => {
    const p = dodajArtikal('N2', 6);
    await rucni('300', '2026-01-01 08:00:00', p);
    const id = dodajPending(racun([stavka(p, 1, 6)]));

    await expect(b.call('pending:resolve', { id, brojFiskalnogRacuna: '300', createdAt: '2026-03-03' }))
      .rejects.toThrow('Fiskalni račun sa tim brojem već postoji');
    await expect(b.call('pending:resolve', { id: 999, brojFiskalnogRacuna: '301', createdAt: '2026-03-03' }))
      .rejects.toThrow('Zapis više ne postoji');
    expect(await b.call('pending:list')).toHaveLength(1);
  });

  test('resolve fakture nosi valutu i napomenu i veže ponudu', async () => {
    const kupac = Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Firma', '4200000000001')").run().lastInsertRowid);
    const ponudaId = Number(b.db.prepare(`
      INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos, status)
      VALUES (7, 2026, ?, ?, '2026-09-01', '2026-09-30', 10, 1.45, 'poslana')
    `).run(kupac, ADMIN).lastInsertRowid);
    const id = dodajPending({
      korisnikId: ADMIN, ukupno: 10, pdvIznos: 1.45, nacinPlacanja: 'Virman', stavke: [],
      prilogBroj: 5, prilogNaziv: 'Stavke po fakturi br. 5', prilogStavke: [],
      datumValute: '2026-10-10', napomena: 'Hitno', ponudaId,
    });

    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: '6', createdAt: '2026-09-02 10:00:00' });

    expect(red('SELECT prilogBroj, datumValute, napomena FROM orders WHERE id = ?', r.id))
      .toEqual({ prilogBroj: 6, datumValute: '2026-10-10', napomena: 'Hitno' });
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', ponudaId)).toEqual({ status: 'konvertovana', racunId: r.id });
  });

  test('discard briše zapis', async () => {
    const id = dodajPending({ stavke: [] });
    expect(await b.call('pending:discard', id)).toEqual({ success: true });
    expect(await b.call('pending:list')).toEqual([]);
  });
});
