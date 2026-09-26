// Ugovor za kanale order:* i pending:* — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { pokreniPokvareniTring, slobodanPort, type Kvar } from './laziTring';
import { sekundiOdSada } from './zona';
import { scenarij, ADMIN, sada, stavka } from './scenarij';
import { izracunajTotale } from '../../lib/racun';

let b: Backend;
const baza = scenarij(() => b);

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

/** Ukupno i PDV kao što ih računa ekran (izracunajTotale) — backend odbija drugačije. */
function racun(stavke: Array<ReturnType<typeof stavka> & Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const { ukupno, pdvIznos } = izracunajTotale(stavke);
  return { korisnikId: ADMIN, ukupno, pdvIznos, nacinPlacanja: 'Gotovina', stavke, ...extra };
}

async function rucni(broj: string, createdAt: string, productId: number): Promise<number> {
  const r = await b.call('order:createManual', racun([stavka(productId, 1, 10)], { brojFiskalnogRacuna: broj, createdAt }));
  return r.id;
}

let sljedeciBroj = 1000;
/** Račun upisan u bazu bez štampe (order:createManual), s datumom sada. */
async function izdaj(stavke: ReturnType<typeof stavka>[], extra: Record<string, unknown> = {}): Promise<{ id: number }> {
  return b.call('order:createManual', racun(stavke, { brojFiskalnogRacuna: String(++sljedeciBroj), createdAt: sada(), ...extra }));
}

// ─── order:createManual ─────────────────────────────────────

describe('order:createManual', () => {
  test('čuva zadani datum i broj, označava račun kao ručni', async () => {
    const p = baza.artikal({ sifra: 'M1', cijena: 10, stanje: 5 });
    const id = await rucni(' 77 ', '2026-01-15 10:30:00', p);

    expect(baza.red('SELECT brojFiskalnogRacuna, createdAt, isManual FROM orders WHERE id = ?', id))
      .toEqual({ brojFiskalnogRacuna: '77', createdAt: '2026-01-15 10:30:00', isManual: 1 });
    expect(baza.red("SELECT createdAt FROM stock_movements WHERE referenceType = 'order' AND referenceId = ?", id).createdAt)
      .toBe('2026-01-15 10:30:00');
    expect(baza.stanje(p)).toBe(4);
  });

  test('odbija duplikat fiskalnog broja', async () => {
    const p = baza.artikal({ sifra: 'M2', cijena: 10 });
    await rucni('77', '2026-01-15 10:30:00', p);
    await expect(rucni('77', '2026-01-16 10:30:00', p)).rejects.toThrow('Fiskalni račun sa tim brojem već postoji');
  });

  test('upisuje kupca, stavke i izlaz sa zalihe; usluga ne skida zalihu', async () => {
    const p = baza.artikal({ sifra: 'A1', cijena: 5, stanje: 10 });
    const u = baza.artikal({ sifra: 'U1', cijena: 20, tip: 'usluga' });
    const r = await izdaj([stavka(p, 3, 5), stavka(u, 2, 20)], {
      brojFiskalnogRacuna: '42',
      kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', grad: 'Sarajevo' },
    });

    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    const o = baza.red('SELECT * FROM orders WHERE id = ?', r.id);
    expect(o).toMatchObject({
      korisnikId: ADMIN, ukupno: 55, status: 'completed', brojFiskalnogRacuna: '42', isManual: 1,
      kupacNaziv: 'Firma d.o.o.', kupacIdBroj: '4200000000001', kupacGrad: 'Sarajevo', kupacAdresa: null,
    });
    expect(baza.red('SELECT COUNT(*) AS n FROM order_items WHERE orderId = ?', r.id).n).toBe(2);
    expect(baza.stanje(p)).toBe(7);
    expect(baza.red('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', u).n).toBe(0);
  });

  test('odbija račun bez stavki', async () => {
    await expect(izdaj([])).rejects.toThrow('Račun mora imati najmanje jednu stavku');
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });

  test('traži fiskalni broj i datum', async () => {
    const p = baza.artikal({ sifra: 'M3', cijena: 10 });
    await expect(b.call('order:createManual', racun([stavka(p, 1, 10)], { brojFiskalnogRacuna: ' ', createdAt: '2026-01-15' })))
      .rejects.toThrow('Fiskalni broj je obavezan');
    await expect(b.call('order:createManual', racun([stavka(p, 1, 10)], { brojFiskalnogRacuna: '1', createdAt: '' })))
      .rejects.toThrow('Datum računa je obavezan');
  });
});

// ─── order:getAll / order:get ───────────────────────────────

describe('order:getAll i order:get', () => {
  test('lista je od najnovijeg, s imenom korisnika i PDV brojem kupca', async () => {
    const p = baza.artikal({ sifra: 'G1', cijena: 10 });
    baza.kupac({ naziv: 'Kupac', idBroj: '4200000000002', pdvBroj: '200000000002' });
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
    const p = baza.artikal({ sifra: 'G2', cijena: 4.5 });
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
    const p = baza.artikal({ sifra: 'F1', cijena: 2.5, stanje: 10 });
    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 2, 2.5)]));

    // Bez expect.any u toMatchObject: Bun 1.3 njime prepiše polje u `r`.
    expect(typeof r.id).toBe('number');
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(r.odgovori.BrojFiskalnogRacuna).toBe('101');
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('Artikal F1');
    expect(baza.red('SELECT brojFiskalnogRacuna, isManual FROM orders WHERE id = ?', r.id)).toEqual({ brojFiskalnogRacuna: '101', isManual: 0 });
    expect(baza.stanje(p)).toBe(8);
    expect(baza.red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
  });

  test('greška printera: ništa se ne upisuje', async () => {
    const p = baza.artikal({ sifra: 'F2', cijena: 2.5, stanje: 10 });
    b.tring.greskaNa('/sfr', 'Nema papira');

    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 2.5)]));

    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(baza.red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
    expect(baza.stanje(p)).toBe(10);
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
    const p = baza.artikal({ sifra: 'F1', cijena: 20, stanje: 10 });
    const r = await b.call('order:finalizePrilog', {
      korisnikId: ADMIN, nacinPlacanja: 'Virman', prilogVeza: 'fakturi',
      stavke: [{ productId: p, kolicina: 3, cijena: 20, rabat: 25, pdvStopa: 'E' }],
      datumValute: '2026-10-01', napomena: ' Isporuka petkom ',
    });

    expect(baza.red('SELECT ukupno, datumValute, napomena, prilogNaziv FROM orders WHERE id = ?', r.id))
      .toEqual({ ukupno: 45, datumValute: '2026-10-01', napomena: 'Isporuka petkom', prilogNaziv: 'Stavke po fakturi br. 101' });
    expect(baza.red('SELECT kolicina, cijena, rabat FROM prilog_stavke WHERE orderId = ?', r.id))
      .toEqual({ kolicina: 3, cijena: 20, rabat: 25 });
    expect(baza.stanje(p)).toBe(7);
  });

  test('neispravan datum valute, predugačka napomena i rabat se odbijaju prije štampe', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = baza.artikal({ sifra: 'F2', cijena: 20 });
    const osnova = { korisnikId: ADMIN, nacinPlacanja: 'Virman', iznos: 10 };
    await expect(b.call('order:finalizePrilog', { ...osnova, datumValute: '2026-13-01' }))
      .rejects.toThrow('Neispravan datum valute: 2026-13-01');
    await expect(b.call('order:finalizePrilog', { ...osnova, napomena: 'x'.repeat(501) }))
      .rejects.toThrow('Napomena može imati najviše 500 znakova');
    await expect(b.call('order:finalizePrilog', { ...osnova, stavke: [{ productId: p, kolicina: 1, cijena: 20, rabat: 100.01, pdvStopa: 'E' }] }))
      .rejects.toThrow('Rabat mora biti od 0 do 100 %');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('faktura iz ponude konvertuje ponudu; odbijena i konvertovana se odbijaju', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const kupac = baza.kupac({ naziv: 'Firma', idBroj: '4200000000001' });
    const ponuda = (status: string) => baza.upisi('ponude', {
      broj: Math.floor(Math.random() * 1e6), godina: 2026, kupacId: kupac, korisnikId: ADMIN,
      datum: '2026-09-01', vaziDo: '2026-09-30', ukupno: 10, pdvIznos: 1.45, status,
    });
    const osnova = { korisnikId: ADMIN, nacinPlacanja: 'Virman', iznos: 10 };

    const odbijena = ponuda('odbijena');
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: odbijena })).rejects.toThrow('Odbijena ponuda');
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: 999 })).rejects.toThrow('Ponuda ne postoji');
    expect(b.tring.zahtjevi).toEqual([]);

    const prihvacena = ponuda('prihvacena');
    const r = await b.call('order:finalizePrilog', { ...osnova, ponudaId: prihvacena });
    expect(baza.red('SELECT status, racunId FROM ponude WHERE id = ?', prihvacena)).toEqual({ status: 'konvertovana', racunId: r.id });
    await expect(b.call('order:finalizePrilog', { ...osnova, ponudaId: prihvacena }))
      .rejects.toThrow('Ponuda je već konvertovana u račun');
  });
});

// ─── order:setDatumValute ───────────────────────────────────

describe('order:setDatumValute', () => {
  test('postavlja, briše i odbija neispravan datum', async () => {
    const p = baza.artikal({ sifra: 'V1', cijena: 1 });
    const { id } = await izdaj([stavka(p, 1, 1)]);

    expect(await b.call('order:setDatumValute', id, '2026-10-01')).toEqual({ datumValute: '2026-10-01' });
    expect(baza.red('SELECT datumValute FROM orders WHERE id = ?', id).datumValute).toBe('2026-10-01');
    expect(await b.call('order:setDatumValute', id, null)).toEqual({ datumValute: null });
    await expect(b.call('order:setDatumValute', id, '2026-02-30')).rejects.toThrow('Neispravan datum valute');
    await expect(b.call('order:setDatumValute', 999, '2026-10-01')).rejects.toThrow('Račun ne postoji');
  });
});

// ─── order:refundAndPrint ───────────────────────────────────

describe('order:refundAndPrint', () => {
  test('štampa reklamaciju i upisuje broj sa uređaja, samo jednom', async () => {
    const p = baza.artikal({ sifra: 'S2', cijena: 3, stanje: 10 });
    const { id } = await izdaj([stavka(p, 2, 3)], { brojFiskalnogRacuna: '55' });

    const r = await b.call('order:refundAndPrint', { id });

    expect(r).toMatchObject({ success: true, brojReklamacije: 'R-1', pologIznos: 0 });
    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/srr']);
    expect(b.tring.zahtjevi[0].tijelo).toContain('55');
    expect(baza.red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id))
      .toEqual({ status: 'refunded', brojReklamacije: 'R-1' });
    expect(baza.red('SELECT refundedAt FROM orders WHERE id = ?', id).refundedAt).toBeTruthy();
    expect(baza.stanje(p)).toBe(10);

    await expect(b.call('order:refundAndPrint', { id })).rejects.toThrow('Račun ne postoji ili je već storniran');
    expect(b.tring.zahtjevi).toHaveLength(1);
    expect(baza.stanje(p)).toBe(10);
  });

  test('bezgotovinski račun: pokriće se prvo unese u uređaj', async () => {
    const p = baza.artikal({ sifra: 'S3', cijena: 30 });
    const { id } = await izdaj([stavka(p, 1, 30)], { brojFiskalnogRacuna: '56', nacinPlacanja: 'Kartica' });

    const r = await b.call('order:refundAndPrint', { id });

    expect(r.success).toBe(true);
    const putanje = b.tring.zahtjevi.map(z => z.putanja);
    expect(putanje.at(-1)).toBe('/srr');
    expect(putanje[0]).toMatch(/^\/(unosnovca|un)$/);
    expect(b.tring.zahtjevi[0].tijelo).toContain('30');
  });

  test('greška printera: račun ostaje nestorniran', async () => {
    const p = baza.artikal({ sifra: 'S4', cijena: 3, stanje: 10 });
    const { id } = await izdaj([stavka(p, 1, 3)], { brojFiskalnogRacuna: '57' });
    b.tring.greskaNa('/srr', 'Uređaj zauzet');

    const r = await b.call('order:refundAndPrint', { id });

    expect(r.success).toBe(false);
    expect(baza.red('SELECT status FROM orders WHERE id = ?', id).status).toBe('completed');
    expect(baza.stanje(p)).toBe(9);
  });

  test('nenumerički fiskalni broj se odbija prije štampe', async () => {
    const p = baza.artikal({ sifra: 'S5', cijena: 3 });
    const { id } = await izdaj([stavka(p, 1, 3)], { brojFiskalnogRacuna: '12/A' });
    await expect(b.call('order:refundAndPrint', { id })).rejects.toThrow('nije ispravan broj računa');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('reklamacija koju uređaj ne bi primio se odbija prije unosa novca i štampe', async () => {
    // Bezgotovinski račun: bez provjere bi pokriće prvo otišlo na uređaj.
    const p = baza.artikal({ sifra: 'S6', cijena: 30 });
    const { id } = await izdaj([stavka(p, 1, 30)], { brojFiskalnogRacuna: '58', nacinPlacanja: 'Virman' });
    b.db.prepare('UPDATE products SET plu = 1000000 WHERE id = ?').run(p); // stari podatak, van Tringovog opsega

    await expect(b.call('order:refundAndPrint', { id, dozvoliPolog: true }))
      .rejects.toThrow('Zahtjev nije poslan fiskalnom uređaju: neispravan PLU (mora biti cijeli broj od 0 do 999999)');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(baza.red('SELECT COUNT(*) AS n FROM cash_movements').n).toBe(0);
    expect(baza.red('SELECT status FROM orders WHERE id = ?', id).status).toBe('completed');

    // Ispravljen PLU: isti storno prolazi.
    b.db.prepare('UPDATE products SET plu = 7 WHERE id = ?').run(p);
    expect(await b.call('order:refundAndPrint', { id })).toMatchObject({ success: true });
  });
});

// ─── order:getFiscalGaps / order:dismissFiscalGap ───────────

describe('fiskalne praznine', () => {
  test('vraća brojeve koji fale, bez odbačenih', async () => {
    const p = baza.artikal({ sifra: 'P1', cijena: 1 });
    await rucni('5', '2026-01-01 08:00:00', p);
    await rucni('9', '2026-01-02 08:00:00', p);
    await rucni('X-1', '2026-01-03 08:00:00', p); // nenumerički se ignoriše

    expect(await b.call('order:getFiscalGaps')).toEqual([6, 7, 8]);
    expect(await b.call('order:dismissFiscalGap', 7)).toEqual({ success: true });
    await b.call('order:dismissFiscalGap', 7);
    expect(await b.call('order:getFiscalGaps')).toEqual([6, 8]);
    expect(JSON.parse(baza.red("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").value)).toEqual([7]);
  });
});

// ─── pending:* ──────────────────────────────────────────────

describe('pending:*', () => {
  function dodajPending(snapshot: object): number {
    return baza.upisi('pending_receipts', { korisnikId: ADMIN, snapshot: JSON.stringify(snapshot) });
  }

  test('list vraća snapshot kao objekat', async () => {
    const id = dodajPending({ ukupno: 7, stavke: [] });
    expect(await b.call('pending:list')).toEqual([
      { id, korisnikId: ADMIN, createdAt: expect.any(String), snapshot: { ukupno: 7, stavke: [] } },
    ]);
  });

  test('resolve pretvara snapshot u ručni račun s unesenim brojem', async () => {
    const p = baza.artikal({ sifra: 'N1', cijena: 6, stanje: 10 });
    const id = dodajPending(racun([stavka(p, 2, 6)]));

    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: ' 300 ', createdAt: '2026-03-03 12:00:00' });

    expect(baza.red('SELECT brojFiskalnogRacuna, isManual, createdAt, ukupno FROM orders WHERE id = ?', r.id))
      .toEqual({ brojFiskalnogRacuna: '300', isManual: 1, createdAt: '2026-03-03 12:00:00', ukupno: 12 });
    expect(baza.stanje(p)).toBe(8);
    expect(await b.call('pending:list')).toEqual([]);
    const trag = baza.red("SELECT korisnikId, detalji FROM audit_log WHERE akcija = 'pending:rijesi'");
    expect({ ...trag, detalji: JSON.parse(trag.detalji) })
      .toEqual({ korisnikId: ADMIN, detalji: { pendingId: id, brojFiskalnogRacuna: '300', orderId: r.id } });
  });

  test('resolve odbija postojeći broj i nepostojeći zapis', async () => {
    const p = baza.artikal({ sifra: 'N2', cijena: 6 });
    await rucni('300', '2026-01-01 08:00:00', p);
    const id = dodajPending(racun([stavka(p, 1, 6)]));

    await expect(b.call('pending:resolve', { id, brojFiskalnogRacuna: '300', createdAt: '2026-03-03' }))
      .rejects.toThrow('Fiskalni račun sa tim brojem već postoji');
    await expect(b.call('pending:resolve', { id: 999, brojFiskalnogRacuna: '301', createdAt: '2026-03-03' }))
      .rejects.toThrow('Zapis više ne postoji');
    expect(await b.call('pending:list')).toHaveLength(1);
    expect(baza.red("SELECT COUNT(*) AS n FROM audit_log WHERE akcija = 'pending:rijesi'").n).toBe(0);
  });

  test('resolve fakture nosi valutu i napomenu i veže ponudu', async () => {
    const kupac = baza.kupac({ naziv: 'Firma', idBroj: '4200000000001' });
    const ponudaId = baza.upisi('ponude', {
      broj: 7, godina: 2026, kupacId: kupac, korisnikId: ADMIN, datum: '2026-09-01', vaziDo: '2026-09-30',
      ukupno: 10, pdvIznos: 1.45, status: 'poslana',
    });
    const id = dodajPending({
      korisnikId: ADMIN, ukupno: 10, pdvIznos: 1.45, nacinPlacanja: 'Virman', stavke: [],
      prilogBroj: 5, prilogNaziv: 'Stavke po fakturi br. 5', prilogStavke: [],
      datumValute: '2026-10-10', napomena: 'Hitno', ponudaId,
    });

    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: '6', createdAt: '2026-09-02 10:00:00' });

    expect(baza.red('SELECT prilogBroj, datumValute, napomena FROM orders WHERE id = ?', r.id))
      .toEqual({ prilogBroj: 6, datumValute: '2026-10-10', napomena: 'Hitno' });
    expect(baza.red('SELECT status, racunId FROM ponude WHERE id = ?', ponudaId)).toEqual({ status: 'konvertovana', racunId: r.id });
  });

  test('discard briše zapis', async () => {
    const id = dodajPending({ stavke: [] });
    expect(await b.call('pending:discard', id)).toEqual({ success: true });
    expect(await b.call('pending:list')).toEqual([]);
  });
});

// ─── Provjera računa prije štampe ───────────────────────────
// Iznosi se računaju u backendu iz stavki (izracunajTotale); ništa se ne
// štampa i ništa ne upisuje dok stavke, iznosi i plaćanje nisu ispravni.

describe('provjera računa prije štampe (order:finalize, order:createManual)', () => {
  /** Stavka s jednim pokvarenim poljem i poruka koju backend mora vratiti. */
  function losaPolja(p: number): Array<[Record<string, unknown>, string]> {
    return [
      [{ kolicina: 0 }, 'Količina mora biti veća od 0'],
      [{ kolicina: -1 }, 'Količina mora biti veća od 0'],
      [{ kolicina: null }, 'Količina mora biti veća od 0'],
      [{ kolicina: '2' }, 'Količina mora biti veća od 0'],
      [{ cijena: -0.01 }, 'Cijena ne može biti negativna'],
      [{ cijena: null }, 'Cijena mora biti broj'],
      [{ cijena: '5' }, 'Cijena mora biti broj'],
      [{ rabat: 100.01 }, 'Rabat mora biti od 0 do 100 %'],
      [{ rabat: -5 }, 'Rabat mora biti od 0 do 100 %'],
      [{ rabat: '10' }, 'Rabat mora biti od 0 do 100 %'],
      [{ pdvStopa: 'A' }, 'PDV stopa mora biti E ili K'],
      [{ pdvStopa: null }, 'PDV stopa mora biti E ili K'],
      [{ productId: 999_999 }, 'Proizvod #999999 ne postoji'],
      [{ productId: String(p) }, `Proizvod #${p} ne postoji`],
    ];
  }

  function nistaUpisano() {
    expect(b.tring.zahtjevi).toEqual([]);
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(baza.red('SELECT COUNT(*) AS n FROM order_items').n).toBe(0);
    expect(baza.red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
    expect(baza.red("SELECT COUNT(*) AS n FROM stock_movements WHERE referenceType = 'order'").n).toBe(0);
  }

  test('finalize: neispravna stavka se odbija prije write-ahead zapisa i štampe', async () => {
    const p = baza.artikal({ sifra: 'V1', cijena: 5, stanje: 10 });
    for (const [polje, poruka] of losaPolja(p)) {
      const s = { ...baza.kasaStavka(p, 1, 5), ...polje };
      await expect(b.call('order:finalize', { ...racun([baza.kasaStavka(p, 1, 5)]), stavke: [s] }), JSON.stringify(polje)).rejects.toThrow(poruka);
    }
    await expect(b.call('order:finalize', { ...racun([]), stavke: [null] })).rejects.toThrow('Neispravna stavka računa');
    await expect(b.call('order:finalize', { ...racun([]), stavke: 'x' })).rejects.toThrow('Račun mora imati najmanje jednu stavku');
    nistaUpisano();
  });

  test('createManual: ista pravila za stavke, ništa se ne upisuje', async () => {
    const p = baza.artikal({ sifra: 'V2', cijena: 5, stanje: 10 });
    for (const [polje, poruka] of losaPolja(p)) {
      const s = { ...stavka(p, 1, 5), ...polje };
      await expect(b.call('order:createManual', { ...racun([stavka(p, 1, 5)], { brojFiskalnogRacuna: '7', createdAt: sada() }), stavke: [s] }), JSON.stringify(polje))
        .rejects.toThrow(poruka);
    }
    nistaUpisano();
  });

  test('rabat 100 % je dozvoljen (stavka od 0 KM), i na kasi i na ručnom računu', async () => {
    const p = baza.artikal({ sifra: 'V0', cijena: 5, stanje: 10 });
    const q = baza.artikal({ sifra: 'V9', cijena: 4, stanje: 10 });
    const stavke = [{ ...baza.kasaStavka(p, 1, 5), rabat: 100 }, baza.kasaStavka(q, 1, 4)];
    const r = await b.call('order:finalize', racun(stavke));
    expect(baza.red('SELECT ukupno FROM orders WHERE id = ?', r.id).ukupno).toBe(4);
    expect(baza.red('SELECT rabat FROM order_items WHERE orderId = ? AND productId = ?', r.id, p).rabat).toBe(100);
    const m = await b.call('order:createManual', racun([{ ...stavka(p, 1, 5), rabat: 100 }, stavka(q, 1, 4)], { brojFiskalnogRacuna: '4242', createdAt: sada() }));
    expect(baza.red('SELECT ukupno FROM orders WHERE id = ?', m.id).ukupno).toBe(4);
  });

  test('ukupno i PDV iz payload-a smiju odstupati najviše 0,005 — u bazu ide iznos izračunat iz stavki', async () => {
    const p = baza.artikal({ sifra: 'V3', cijena: 2.5, stanje: 10 });
    const osnova = racun([baza.kasaStavka(p, 2, 2.5)]); // 5 KM, PDV 0,73
    expect(osnova.pdvIznos).toBe(0.73);

    await expect(b.call('order:finalize', { ...osnova, ukupno: 4.99 })).rejects.toThrow('Ukupan iznos (4.99) ne odgovara stavkama (5.00)');
    await expect(b.call('order:finalize', { ...osnova, ukupno: '5' })).rejects.toThrow('Ukupan iznos ("5") ne odgovara stavkama (5.00)');
    await expect(b.call('order:finalize', { ...osnova, pdvIznos: 0 })).rejects.toThrow('Iznos PDV-a (0.00) ne odgovara stavkama (0.73)');
    await expect(b.call('order:createManual', { ...osnova, ukupno: 50, brojFiskalnogRacuna: '8', createdAt: sada() }))
      .rejects.toThrow('Ukupan iznos (50.00) ne odgovara stavkama (5.00)');
    nistaUpisano();

    const r = await b.call('order:finalize', { ...osnova, ukupno: 5.004, pdvIznos: 0.726 });
    expect(baza.red('SELECT ukupno, pdvIznos FROM orders WHERE id = ?', r.id)).toEqual({ ukupno: 5, pdvIznos: 0.73 });
    const bezIznosa = await b.call('order:createManual', { ...osnova, ukupno: null, pdvIznos: undefined, brojFiskalnogRacuna: '9', createdAt: sada() });
    expect(baza.red('SELECT ukupno, pdvIznos FROM orders WHERE id = ?', bezIznosa.id)).toEqual({ ukupno: 5, pdvIznos: 0.73 });
  });

  test('način plaćanja: samo Gotovina, Kartica, Virman ili Ček', async () => {
    const p = baza.artikal({ sifra: 'V4', cijena: 5, stanje: 10 });
    for (const [nacin, poruka] of [
      ['', 'Način plaćanja je obavezan'], [null, 'Način plaćanja je obavezan'], ['Bitcoin', 'Nepoznat način plaćanja: "Bitcoin"'],
      ['{"gotovina":5}', 'Nepoznat način plaćanja: "{"gotovina":5}"'], [{ gotovina: 5 }, 'Način plaćanja je obavezan'],
    ] as const) {
      await expect(b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], { nacinPlacanja: nacin })), String(nacin)).rejects.toThrow(poruka);
      await expect(b.call('order:createManual', racun([stavka(p, 1, 5)], { nacinPlacanja: nacin, brojFiskalnogRacuna: '1', createdAt: sada() })))
        .rejects.toThrow(poruka);
    }
    nistaUpisano();
    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], { nacinPlacanja: ' Ček ' }));
    expect(baza.red('SELECT nacinPlacanja FROM orders WHERE id = ?', r.id).nacinPlacanja).toBe('Ček');
  });

  test('razbijeno plaćanje: poznate vrste, iznosi > 0, zbir = ukupno; u bazu ide raspodjela', async () => {
    const p = baza.artikal({ sifra: 'V5', cijena: 5, stanje: 10 });
    const osnova = racun([baza.kasaStavka(p, 1, 5)]);
    for (const [vrste, poruka] of [
      [[{ oznaka: 'Gotovina', iznos: 3 }, { oznaka: 'Kartica', iznos: 1 }], 'Zbir plaćanja (4.00) ne odgovara iznosu računa (5.00)'],
      [[{ oznaka: 'Gotovina', iznos: 3 }, { oznaka: 'Zlato', iznos: 2 }], 'Nepoznat način plaćanja: "Zlato"'],
      [[{ oznaka: 'Gotovina', iznos: 6 }, { oznaka: 'Kartica', iznos: -1 }], 'Iznos plaćanja mora biti veći od 0'],
      [[{ oznaka: 'Gotovina', iznos: 2 }, { oznaka: 'Gotovina', iznos: 3 }], 'Način plaćanja "Gotovina" je naveden više puta'],
      [[null], 'Neispravne vrste plaćanja'],
      ['Gotovina', 'Neispravne vrste plaćanja'],
    ] as const) {
      await expect(b.call('order:finalize', { ...osnova, vrstePlacanja: vrste }), JSON.stringify(vrste)).rejects.toThrow(poruka);
    }
    nistaUpisano();

    const r = await b.call('order:finalize', { ...osnova, vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 3 }, { oznaka: 'Ček', iznos: 2 }] });
    expect(baza.red('SELECT nacinPlacanja FROM orders WHERE id = ?', r.id).nacinPlacanja).toBe('{"gotovina":3,"cek":2}');
    expect(await b.call('cash:drawerState')).toMatchObject({ gotovinskiPromet: 3 });
    const jedna = await b.call('order:finalize', { ...osnova, nacinPlacanja: 'Gotovina', vrstePlacanja: [{ oznaka: 'Kartica', iznos: 5 }] });
    expect(baza.red('SELECT nacinPlacanja FROM orders WHERE id = ?', jedna.id).nacinPlacanja).toBe('Kartica');
    expect(b.tring.zahtjevi.at(-1)!.tijelo).toContain('<Oznaka>Kartica</Oznaka><Iznos>5</Iznos>');
  });

  test('finalize: uređaj dobije šifru, naziv, JM i PLU artikla iz baze; stopa mora biti stopa artikla', async () => {
    const p = baza.artikal({ sifra: 'V6', cijena: 5, stanje: 10 });
    await expect(b.call('order:finalize', racun([{ ...baza.kasaStavka(p, 1, 5), pdvStopa: 'K' }])))
      .rejects.toThrow('PDV stopa stavke "Artikal V6" ne odgovara artiklu (E)');
    nistaUpisano();

    await b.call('order:finalize', racun([{ ...baza.kasaStavka(p, 1, 5), sifra: 'X', naziv: 'Laptop', jm: 'm', plu: 99 }]));
    const tijelo = b.tring.zahtjevi.at(-1)!.tijelo;
    expect(tijelo).toContain('<Sifra>V6</Sifra>');
    expect(tijelo).toContain('<Naziv>Artikal V6</Naziv>');
    expect(tijelo).toContain('<PLU>1</PLU>');
    expect(tijelo).not.toContain('Laptop');
  });

  test('finalize: polja van ugovora (datum, prilog, ručni, valuta) se ne upisuju', async () => {
    const p = baza.artikal({ sifra: 'V7', cijena: 5, stanje: 10 });
    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], {
      createdAt: '2020-01-01 00:00:00', prilogBroj: 5, prilogNaziv: 'X', isManual: 1, datumValute: '2020-02-02', brojFiskalnogRacuna: '1',
    }));
    const o = baza.red('SELECT createdAt, prilogBroj, prilogNaziv, isManual, datumValute, brojFiskalnogRacuna FROM orders WHERE id = ?', r.id);
    expect(o.createdAt.startsWith('2020')).toBe(false);
    expect({ ...o, createdAt: null }).toEqual({ createdAt: null, prilogBroj: null, prilogNaziv: null, isManual: 0, datumValute: null, brojFiskalnogRacuna: '101' });
  });

  test('neispravan kupac ili napomena se odbijaju prije štampe', async () => {
    const p = baza.artikal({ sifra: 'V8', cijena: 5, stanje: 10 });
    await expect(b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], { kupac: { naziv: { x: 1 } } }))).rejects.toThrow('Neispravni podaci kupca');
    await expect(b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], { kupac: 'Firma' }))).rejects.toThrow('Neispravni podaci kupca');
    await expect(b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)], { napomena: 5 }))).rejects.toThrow('Napomena mora biti tekst');
    await expect(b.call('order:createManual', racun([stavka(p, 1, 5)], { kupac: { idBroj: 42 }, brojFiskalnogRacuna: '1', createdAt: sada() })))
      .rejects.toThrow('Neispravni podaci kupca');
    nistaUpisano();
  });

  test('finalizePrilog: nepoznat način plaćanja se odbija prije štampe', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    await expect(b.call('order:finalizePrilog', { iznos: 10, nacinPlacanja: 'Bitcoin' })).rejects.toThrow('Nepoznat način plaćanja: "Bitcoin"');
    await expect(b.call('order:finalizePrilog', { iznos: '10', nacinPlacanja: 'Virman' })).rejects.toThrow('Iznos mora biti veći od 0');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(baza.red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
  });
});

// ─── Nepoznat ishod štampe ──────────────────────────────────
// Zahtjev je stigao do uređaja, a potvrde nema (prekid veze, odgovor koji nije
// odgovor uređaja, timeout): račun je možda odštampan, pa write-ahead red
// ostaje za dijalog nezavršenih računa. Sigurno neodštampan račun (veza
// odbijena, greška uređaja) briše red kao i ranije.

describe('nepoznat ishod štampe', () => {
  let zaustavi: (() => void) | null = null;
  afterEach(() => { zaustavi?.(); zaustavi = null; });

  async function uredjajSKvarom(kvar: Kvar) {
    const u = await pokreniPokvareniTring(kvar);
    zaustavi = u.stop;
    baza.postavka('tring.host', '127.0.0.1');
    baza.postavka('tring.port', String(u.port));
    return u;
  }

  function pending(): any[] {
    return b.db.prepare('SELECT snapshot FROM pending_receipts').all().map((r: any) => JSON.parse(r.snapshot));
  }

  for (const kvar of ['prekid', 'smece'] as const) {
    test(`finalize (${kvar}): red ostaje, ništa se ne upisuje, renderer dobije oznaku`, async () => {
      const p = baza.artikal({ sifra: 'I1', cijena: 5, stanje: 10 });
      const u = await uredjajSKvarom(kvar);

      const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 2, 5)]));

      expect(u.primljeno()).toBe(1);
      expect(r.success).toBe(false);
      expect(r.ishodNepoznat).toBe(true);
      expect(r.error).toContain('nezavršenih računa');
      expect(pending()).toHaveLength(1);
      expect(pending()[0]).toMatchObject({ ukupno: 10, stavke: [{ productId: p, kolicina: 2 }] });
      expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
      expect(baza.stanje(p)).toBe(10);

      // Operater potvrdi da je račun odštampan — tek tad nastaje narudžba.
      const [{ id }] = await b.call('pending:list');
      const rijesen = await b.call('pending:resolve', { id, brojFiskalnogRacuna: '777', createdAt: '2026-09-26 10:00:00' });
      expect(baza.red('SELECT brojFiskalnogRacuna FROM orders WHERE id = ?', rijesen.id).brojFiskalnogRacuna).toBe('777');
      expect(baza.stanje(p)).toBe(8);
    });
  }

  test('finalize: uređaj ugašen (veza odbijena) — sigurno nije odštampano, red se briše', async () => {
    const p = baza.artikal({ sifra: 'I2', cijena: 5, stanje: 10 });
    baza.postavka('tring.host', '127.0.0.1');
    baza.postavka('tring.port', String(await slobodanPort()));

    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)]));

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(pending()).toEqual([]);
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  });

  // Uređaj na LAN-u ugašen (SYN bez odgovora, nema RST-a): veza se ne
  // uspostavi, zahtjev sigurno nije poslan — red se briše, bez dijaloga.
  // Traje koliko i timeout povezivanja (5 s), osim gdje mreža odmah javi grešku.
  test('finalize: veza se ne uspostavi — sigurno nije odštampano, red se briše', async () => {
    const p = baza.artikal({ sifra: 'I5', cijena: 5, stanje: 10 });
    baza.postavka('tring.host', '10.255.255.1');

    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)]));

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(pending()).toEqual([]);
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
  }, 15000);

  test('finalize: greška uređaja nema oznaku nepoznatog ishoda', async () => {
    const p = baza.artikal({ sifra: 'I3', cijena: 5, stanje: 10 });
    b.tring.greskaNa('/sfr', 'Nema papira', 12);
    const r = await b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)]));
    expect(r).toEqual({ success: false, error: 'Nema papira [12]', odgovori: {} });
    expect(pending()).toEqual([]);
  });

  test('finalizePrilog (prekid): red sa stavkama priloga ostaje', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = baza.artikal({ sifra: 'I4', cijena: 20, stanje: 10 });
    await uredjajSKvarom('prekid');

    const r = await b.call('order:finalizePrilog', {
      nacinPlacanja: 'Virman', stavke: [{ productId: p, kolicina: 2, cijena: 20, rabat: 0, pdvStopa: 'E' }],
    });

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBe(true);
    expect(r.error).toContain('nezavršenih računa');
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({ ukupno: 40, prilogBroj: 101, prilogStavke: [{ productId: p, kolicina: 2 }] });
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(0);
    expect(baza.stanje(p)).toBe(10);
  });

  test('finalizePrilog: greška uređaja briše red', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    b.tring.greskaNa('/sfr', 'Nema papira');
    const r = await b.call('order:finalizePrilog', { iznos: 10, nacinPlacanja: 'Virman' });
    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(pending()).toEqual([]);
  });
});

// ─── Račun riješen iz dijaloga dok je štampa trajala ─────────
// Dok uređaj štampa, operater može pending red riješiti ručno (npr. nakon
// ponovne prijave dijalog ga pokaže). Kad štampa onda uspije, drugi zapis
// istog računa se ne smije upisati. Odgovor nosi `vecEvidentiran` da ekran
// korpu/fakturu tretira kao završenu (bez novog id-a) i ne pošalje je ponovo.

describe('pending red riješen tokom štampe', () => {
  async function rijesiTokomStampe(stigao: Promise<void>): Promise<{ id: number }> {
    await stigao;
    const [{ id }] = await b.call('pending:list');
    return b.call('pending:resolve', { id, brojFiskalnogRacuna: '500', createdAt: '2026-09-26 10:00:00' });
  }

  test('finalize ne upisuje drugu narudžbu', async () => {
    const p = baza.artikal({ sifra: 'D1', cijena: 5, stanje: 10 });
    const stampa = b.tring.zadrzi('/sfr');
    const finalize = b.call('order:finalize', racun([baza.kasaStavka(p, 1, 5)]));
    const rucni = await rijesiTokomStampe(stampa.stigao);
    stampa.pusti();

    const r = await finalize;
    expect(r.error).toContain('već evidentiran');
    expect({ ...r, error: null }).toEqual({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: '101', error: null });
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(1);
    expect(baza.red('SELECT id FROM orders').id).toBe(rucni.id);
    expect(baza.stanje(p)).toBe(9);
    expect(baza.red('SELECT COUNT(*) AS n FROM pending_receipts').n).toBe(0);
  });

  test('finalizePrilog ne upisuje drugu fakturu', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = baza.artikal({ sifra: 'D2', cijena: 20, stanje: 10 });
    const stampa = b.tring.zadrzi('/sfr');
    const finalize = b.call('order:finalizePrilog', {
      nacinPlacanja: 'Virman', stavke: [{ productId: p, kolicina: 2, cijena: 20, rabat: 0, pdvStopa: 'E' }],
    });
    await rijesiTokomStampe(stampa.stigao);
    stampa.pusti();

    const r = await finalize;
    expect(r.error).toContain('već evidentiran');
    expect({ ...r, error: null }).toEqual({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: '101', error: null });
    expect(baza.red('SELECT COUNT(*) AS n FROM orders').n).toBe(1);
    expect(baza.red('SELECT COUNT(*) AS n FROM prilog_stavke').n).toBe(1);
    expect(baza.stanje(p)).toBe(8);
  });
});

// ─── Skica fakture i fiskalizacija ──────────────────────────
// Skica iz koje je faktura fiskalizovana ne smije ostati — mogla bi se
// fiskalizovati ponovo. Faktura s nepoznatim ishodom čuva skicu dok operater
// ne riješi nezavršeni račun: odštampan → skica se briše; odbačen → ostaje.

describe('skica fakture', () => {
  let zaustavi: (() => void) | null = null;
  afterEach(() => { zaustavi?.(); zaustavi = null; });

  function dodajSkicu(): number {
    return baza.upisi('faktura_skice', { naziv: 'Skica', podaci: '{}', ukupno: 40 });
  }
  const imaSkicu = (id: number) => baza.red('SELECT COUNT(*) AS n FROM faktura_skice WHERE id = ?', id).n === 1;

  async function nepoznatIshod(skicaId: number) {
    await b.call('fiscal:setZadnjiBroj', 100);
    const u = await pokreniPokvareniTring('prekid');
    zaustavi = u.stop;
    baza.postavka('tring.host', '127.0.0.1');
    baza.postavka('tring.port', String(u.port));
    const r = await b.call('order:finalizePrilog', { iznos: 40, nacinPlacanja: 'Virman', skicaId });
    expect(r.ishodNepoznat).toBe(true);
    const [row] = await b.call('pending:list');
    expect(row.snapshot.skicaId).toBe(skicaId);
    return row.id as number;
  }

  test('uspješna fiskalizacija briše skicu', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const skica = dodajSkicu();
    const r = await b.call('order:finalizePrilog', { iznos: 40, nacinPlacanja: 'Virman', skicaId: skica });
    expect(r.success).toBe(true);
    expect(imaSkicu(skica)).toBe(false);
  });

  test('nepoznat ishod: skica ostaje, pa se briše kad se račun riješi kao odštampan', async () => {
    const skica = dodajSkicu();
    const pendingId = await nepoznatIshod(skica);
    expect(imaSkicu(skica)).toBe(true);

    await b.call('pending:resolve', { id: pendingId, brojFiskalnogRacuna: '101', createdAt: '2026-09-26 10:00:00' });
    expect(imaSkicu(skica)).toBe(false);
  });

  test('nepoznat ishod: odbačen račun (nije odštampan) ostavlja skicu', async () => {
    const skica = dodajSkicu();
    const pendingId = await nepoznatIshod(skica);
    await b.call('pending:discard', pendingId);
    expect(imaSkicu(skica)).toBe(true);
  });

  test('bez skice snapshot nema skicaId', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const stampa = b.tring.zadrzi('/sfr');
    const finalize = b.call('order:finalizePrilog', { iznos: 40, nacinPlacanja: 'Virman' });
    await stampa.stigao;
    const [row] = await b.call('pending:list');
    expect('skicaId' in row.snapshot).toBe(false);
    stampa.pusti();
    expect((await finalize).success).toBe(true);
  });
});

// ─── Kretanja priloga nose datum računa ─────────────────────

describe('datum kretanja priloga', () => {
  const datumi = (orderId: number) => b.db
    .prepare("SELECT createdAt FROM stock_movements WHERE referenceType = 'prilog' AND referenceId = ? ORDER BY id")
    .all(orderId).map((r: any) => r.createdAt);

  test('dodjela stavki danima kasnije i ponovno spremanje skidaju robu na datum računa', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = baza.artikal({ sifra: 'K1', cijena: 10, stanje: 10 });
    const q = baza.artikal({ sifra: 'K2', cijena: 10, stanje: 10 });
    const { id } = await b.call('order:finalizePrilog', { iznos: 30, nacinPlacanja: 'Virman' });
    b.db.prepare("UPDATE orders SET createdAt = '2026-01-10 09:15:00' WHERE id = ?").run(id);

    await b.call('prilog:saveStavke', id, [{ productId: p, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }]);
    expect(datumi(id)).toEqual(['2026-01-10 09:15:00']);

    await b.call('prilog:saveStavke', id, [
      { productId: p, kolicina: 2, cijena: 10, rabat: 0, pdvStopa: 'E' },
      { productId: q, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' },
    ]);
    expect(datumi(id)).toEqual(['2026-01-10 09:15:00', '2026-01-10 09:15:00']);
  });

  test('račun riješen iz nezavršenih nosi datum koji je operater unio', async () => {
    const p = baza.artikal({ sifra: 'K3', cijena: 10, stanje: 10 });
    const pendingId = baza.upisi('pending_receipts', { korisnikId: ADMIN, snapshot: JSON.stringify({
      korisnikId: ADMIN, ukupno: 20, pdvIznos: 2.91, nacinPlacanja: 'Virman', stavke: [],
      prilogBroj: 5, prilogNaziv: 'Stavke po fakturi br. 5',
      prilogStavke: [{ productId: p, kolicina: 2, cijena: 10, rabat: 0, pdvStopa: 'E' }],
    }) });

    const r = await b.call('pending:resolve', { id: pendingId, brojFiskalnogRacuna: '6', createdAt: '2026-02-03 11:00:00' });

    expect(datumi(r.id)).toEqual(['2026-02-03 11:00:00']);
    expect(baza.stanje(p)).toBe(8);
  });
});

// ─── Storno vraća ono što je račun skinuo ───────────────────

describe('storno i zaliha', () => {
  const povrat = (orderId: number) => b.db
    .prepare("SELECT productId, tip, kolicina FROM stock_movements WHERE referenceType = 'refund' AND referenceId = ? ORDER BY id")
    .all(orderId);

  test('artikal koji je nakon prodaje postao usluga se vraća; usluga koja je postala artikal ne', async () => {
    const a = baza.artikal({ sifra: 'Z1', cijena: 3, stanje: 10 });
    const u = baza.artikal({ sifra: 'Z2', cijena: 4, tip: 'usluga' });
    const { id } = await izdaj([stavka(a, 2, 3), stavka(u, 1, 4)], { brojFiskalnogRacuna: '60' });
    b.db.prepare("UPDATE products SET tip = 'usluga' WHERE id = ?").run(a);
    b.db.prepare("UPDATE products SET tip = 'artikal' WHERE id = ?").run(u);

    expect(await b.call('order:refundAndPrint', { id })).toMatchObject({ success: true });

    expect(povrat(id)).toEqual([{ productId: a, tip: 'ulaz', kolicina: 2 }]);
    expect(baza.stanje(a)).toBe(10);
    expect(baza.stanje(u)).toBe(0);
  });

  test('storno fakture vraća robu skinutu prilogom', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    const p = baza.artikal({ sifra: 'Z3', cijena: 10, stanje: 10 });
    const { id } = await b.call('order:finalizePrilog', {
      nacinPlacanja: 'Virman', stavke: [{ productId: p, kolicina: 3, cijena: 10, rabat: 0, pdvStopa: 'E' }],
    });
    expect(baza.stanje(p)).toBe(7);
    b.db.prepare("UPDATE products SET tip = 'usluga' WHERE id = ?").run(p);

    expect(await b.call('order:refundAndPrint', { id })).toMatchObject({ success: true });

    expect(povrat(id)).toEqual([{ productId: p, tip: 'ulaz', kolicina: 3 }]);
    expect(baza.stanje(p)).toBe(10);
  });

  test('prodaja i storno bez datuma s papira: kretanja nose lokalno vrijeme računa i storna („Zalihe na dan")', async () => {
    const p = baza.artikal({ sifra: 'Z4', cijena: 2.5, stanje: 10 });
    // Kretanja nose vrijeme računa i storna, a to je lokalno vrijeme sada (zona.ts).
    const kretanje = (vrsta: string, id: number) => baza.red(`
      SELECT sm.tip, sm.kolicina, sm.createdAt,
        abs(julianday(sm.createdAt) - julianday(CASE WHEN sm.tip = 'izlaz' THEN o.createdAt ELSE o.refundedAt END)) * 86400 AS razlika
      FROM stock_movements sm JOIN orders o ON o.id = sm.referenceId
      WHERE sm.referenceType = ? AND sm.referenceId = ?
    `, vrsta, id);

    const { id } = await b.call('order:finalize', racun([baza.kasaStavka(p, 2, 2.5)]));
    expect(await b.call('order:refundAndPrint', { id })).toMatchObject({ success: true });

    for (const [vrsta, tip] of [['order', 'izlaz'], ['refund', 'ulaz']]) {
      const k = kretanje(vrsta, id);
      expect([k.tip, k.kolicina]).toEqual([tip, 2]);
      expect(k.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(k.razlika).toBeLessThanOrEqual(1);
      expect(sekundiOdSada(k.createdAt)).toBeLessThanOrEqual(5);
    }
  });
});
