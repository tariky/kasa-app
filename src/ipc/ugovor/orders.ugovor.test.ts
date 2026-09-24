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

// ─── order:create ───────────────────────────────────────────

describe('order:create', () => {
  test('upisuje račun, stavke i izlaz sa zalihe', async () => {
    const p = dodajArtikal('A1', 5, { stanje: 10 });
    const r = await b.call('order:create', racun([stavka(p, 3, 5)], {
      brojFiskalnogRacuna: '42',
      kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', grad: 'Sarajevo' },
    }));

    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    const o = red('SELECT * FROM orders WHERE id = ?', r.id);
    expect(o).toMatchObject({
      korisnikId: ADMIN, ukupno: 15, status: 'completed', brojFiskalnogRacuna: '42', isManual: 0,
      kupacNaziv: 'Firma d.o.o.', kupacIdBroj: '4200000000001', kupacGrad: 'Sarajevo', kupacAdresa: null,
    });
    expect(red('SELECT COUNT(*) AS n FROM order_items WHERE orderId = ?', r.id).n).toBe(1);
    expect(stanje(p)).toBe(7);
  });

  test('usluga ne skida zalihu', async () => {
    const p = dodajArtikal('U1', 20, { tip: 'usluga' });
    await b.call('order:create', racun([stavka(p, 2, 20)]));
    expect(red('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', p).n).toBe(0);
  });

  test('odbija račun bez stavki i bez korisnika', async () => {
    const p = dodajArtikal('A2', 5);
    await expect(b.call('order:create', racun([]))).rejects.toThrow('Račun mora imati najmanje jednu stavku');
    await expect(b.call('order:create', racun([stavka(p, 1, 5)], { korisnikId: 0 }))).rejects.toThrow('Korisnik nije prijavljen');
    expect(red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });
});

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
    const { id } = await b.call('order:create', racun([stavka(p, 2, 4.5)]));

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
});

// ─── order:updateReklamacija / order:setDatumValute ─────────

describe('order:updateReklamacija', () => {
  test('upisuje broj i vraća broj promijenjenih redova', async () => {
    const p = dodajArtikal('R1', 1);
    const { id } = await b.call('order:create', racun([stavka(p, 1, 1)]));
    expect(await b.call('order:updateReklamacija', id, 'R-9')).toEqual({ changes: 1 });
    expect(red('SELECT brojReklamacije FROM orders WHERE id = ?', id).brojReklamacije).toBe('R-9');
    expect(await b.call('order:updateReklamacija', 999, 'R-9')).toEqual({ changes: 0 });
  });
});

describe('order:setDatumValute', () => {
  test('postavlja, briše i odbija neispravan datum', async () => {
    const p = dodajArtikal('V1', 1);
    const { id } = await b.call('order:create', racun([stavka(p, 1, 1)]));

    expect(await b.call('order:setDatumValute', id, '2026-10-01')).toEqual({ datumValute: '2026-10-01' });
    expect(red('SELECT datumValute FROM orders WHERE id = ?', id).datumValute).toBe('2026-10-01');
    expect(await b.call('order:setDatumValute', id, null)).toEqual({ datumValute: null });
    await expect(b.call('order:setDatumValute', id, '2026-02-30')).rejects.toThrow('Neispravan datum valute');
    await expect(b.call('order:setDatumValute', 999, '2026-10-01')).rejects.toThrow('Račun ne postoji');
  });
});

// ─── order:refund / order:refundAndPrint ────────────────────

describe('order:refund', () => {
  test('stornira bez štampe i vraća zalihu, samo jednom', async () => {
    const p = dodajArtikal('S1', 3, { stanje: 10 });
    const { id } = await b.call('order:create', racun([stavka(p, 4, 3)]));
    expect(stanje(p)).toBe(6);

    expect(await b.call('order:refund', id, ' R-5 ')).toEqual({ success: true });
    expect(red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id))
      .toEqual({ status: 'refunded', brojReklamacije: 'R-5' });
    expect(red('SELECT refundedAt FROM orders WHERE id = ?', id).refundedAt).toBeTruthy();
    expect(stanje(p)).toBe(10);
    expect(b.tring.zahtjevi).toEqual([]);

    await expect(b.call('order:refund', id)).rejects.toThrow('Račun ne postoji ili je već storniran');
    expect(stanje(p)).toBe(10);
  });
});

describe('order:refundAndPrint', () => {
  test('štampa reklamaciju i upisuje broj sa uređaja', async () => {
    const p = dodajArtikal('S2', 3, { stanje: 10 });
    const { id } = await b.call('order:create', racun([stavka(p, 2, 3)], { brojFiskalnogRacuna: '55' }));

    const r = await b.call('order:refundAndPrint', { id, korisnikId: ADMIN });

    expect(r).toMatchObject({ success: true, brojReklamacije: 'R-1', pologIznos: 0 });
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/srr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('55');
    expect(red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id))
      .toEqual({ status: 'refunded', brojReklamacije: 'R-1' });
    expect(stanje(p)).toBe(10);
  });

  test('bezgotovinski račun: pokriće se prvo unese u uređaj', async () => {
    const p = dodajArtikal('S3', 30);
    const { id } = await b.call('order:create', racun([stavka(p, 1, 30)], { brojFiskalnogRacuna: '56', nacinPlacanja: 'Kartica' }));

    const r = await b.call('order:refundAndPrint', { id, korisnikId: ADMIN });

    expect(r.success).toBe(true);
    const putanje = b.tring.zahtjevi.map(z => z.putanja);
    expect(putanje.at(-1)).toBe('/srr');
    expect(putanje[0]).toMatch(/^\/(unosnovca|un)$/);
    expect(b.tring.zahtjevi[0].tijelo).toContain('30');
  });

  test('greška printera: račun ostaje nestorniran', async () => {
    const p = dodajArtikal('S4', 3, { stanje: 10 });
    const { id } = await b.call('order:create', racun([stavka(p, 1, 3)], { brojFiskalnogRacuna: '57' }));
    b.tring.greskaNa('/srr', 'Uređaj zauzet');

    const r = await b.call('order:refundAndPrint', { id });

    expect(r.success).toBe(false);
    expect(red('SELECT status FROM orders WHERE id = ?', id).status).toBe('completed');
    expect(stanje(p)).toBe(9);
  });

  test('nenumerički fiskalni broj se odbija prije štampe', async () => {
    const p = dodajArtikal('S5', 3);
    const { id } = await b.call('order:create', racun([stavka(p, 1, 3)], { brojFiskalnogRacuna: '12/A' }));
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

  test('discard briše zapis', async () => {
    const id = dodajPending({ stavke: [] });
    expect(await b.call('pending:discard', id)).toEqual({ success: true });
    expect(await b.call('pending:list')).toEqual([]);
  });
});
