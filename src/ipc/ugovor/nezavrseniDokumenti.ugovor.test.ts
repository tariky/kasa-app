// Ugovor: write-ahead za ponudu→račun, nalog→račun i storno — vidi backend.ts.
//
// Isti obrazac kao order:finalize (lib/pendingRacun.ts): prije štampe se u
// pending_receipts upiše snapshot s `vrsta` ('ponuda' | 'nalog' | 'storno').
// Siguran neuspjeh briše red; nepoznat ishod ga ostavlja (dokument ostaje
// netaknut); uspjeh briše red u istoj transakciji s upisom. Dijalog
// nezavršenih računa razrješava red operacijom te vrste ili ga odbacuje, a dok
// red postoji, nova štampa istog dokumenta se odbija prije štampe. Snapshot
// bez `vrsta` je običan račun (stare baze).
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { pokreniPokvareniTring } from './laziTring';

let b: Backend;
let zaustavi: (() => void) | null = null;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { zaustavi?.(); zaustavi = null; await b.close(); });

const ADMIN = 1;
const DATUM = '2026-09-20 11:30:00';

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: any[]): any[] {
  return b.db.prepare(sql).all(...params);
}

const brojRacuna = () => red('SELECT COUNT(*) AS n FROM orders').n as number;

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
  return red(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `, productId).s;
}

function dodajKupca(): number {
  return Number(b.db.prepare(
    "INSERT INTO kupci (naziv, idBroj, adresa, postanskiBroj, grad) VALUES ('Firma d.o.o.', '4200000000001', 'Titova 1', '71000', 'Sarajevo')"
  ).run().lastInsertRowid);
}

function pending(): any[] {
  return redovi('SELECT snapshot FROM pending_receipts ORDER BY id').map(r => JSON.parse(r.snapshot));
}

function dodajPending(snapshot: object): number {
  return Number(b.db.prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(ADMIN, JSON.stringify(snapshot)).lastInsertRowid);
}

async function pendingId(): Promise<number> {
  const [row] = await b.call('pending:list');
  return row.id;
}

/**
 * Operater riješi red iz dijaloga dok uređaj još štampa; štampa se pusti i
 * kad rješavanje padne, da poziv ne ostane visiti (i zauzet "u toku").
 */
async function rijesiTokomStampe(stampa: { stigao: Promise<void>; pusti: () => void }, broj: string): Promise<{ id: number }> {
  try {
    await stampa.stigao;
    return await b.call('pending:resolve', { id: await pendingId(), brojFiskalnogRacuna: broj, createdAt: DATUM });
  } finally {
    stampa.pusti();
  }
}

/** Uređaj koji primi zahtjev pa prekine vezu — ishod štampe nije poznat. */
async function uredjajBezPotvrde(): Promise<void> {
  const u = await pokreniPokvareniTring('prekid');
  zaustavi = u.stop;
  b.db.prepare("UPDATE settings SET value = '127.0.0.1' WHERE key = 'tring.host'").run();
  b.db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(u.port));
}

/** Nakon nepoznatog ishoda test nastavlja s ispravnim (lažnim) uređajem. */
function ispravanUredjaj(): void {
  zaustavi?.(); zaustavi = null;
  b.db.prepare("UPDATE settings SET value = 'localhost' WHERE key = 'tring.host'").run();
  b.db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(b.tring.port));
}

/** Prihvaćena ponuda s jednim artiklom (2 × 10 KM, na stanju 10). */
async function prihvacenaPonuda(): Promise<{ id: number; broj: number; godina: number; p: number }> {
  const kupacId = dodajKupca();
  const p = dodajArtikal(`P${Math.random().toString(36).slice(2, 8)}`, 10, { stanje: 10 });
  const r = await b.call('ponuda:create', { kupacId, korisnikId: ADMIN, stavke: [{ productId: p, kolicina: 2, cijena: 10, rabat: 0, pdvStopa: 'E' }] });
  await b.call('ponuda:setStatus', r.id, 'prihvacena');
  return { id: r.id, broj: r.broj, godina: r.godina, p };
}

const konvertuj = (id: number) => b.call('ponuda:konvertuj', { id, nacinPlacanja: 'Gotovina' });
const ponuda = (id: number) => red('SELECT status, racunId FROM ponude WHERE id = ?', id);

/** Završen samostalni nalog po narudžbi s dogovorenom cijenom. */
async function zavrsenNalog(dogovorenaCijena = 234): Promise<number> {
  const kupacId = dodajKupca();
  const mat = dodajArtikal(`M${Math.random().toString(36).slice(2, 7)}`, 1, { tip: 'materijal', stanje: 10 });
  const { id } = await b.call('nalog:create', { vrsta: 'narudzba', kupacId, opis: 'Kuhinja', dogovorenaCijena });
  await b.call('nalog:replaceStavke', id, [{ materijalId: mat, kolicina: 2 }]);
  await b.call('nalog:setStatus', { id, status: 'zavrsen' });
  return id;
}

/** Završen nalog iz prihvaćene ponude. */
async function zavrsenNalogIzPonude(): Promise<{ nalogId: number; ponudaId: number; p: number }> {
  const pon = await prihvacenaPonuda();
  const { id } = await b.call('nalog:createIzPonude', pon.id);
  const mat = dodajArtikal(`M${Math.random().toString(36).slice(2, 7)}`, 1, { tip: 'materijal', stanje: 10 });
  await b.call('nalog:replaceStavke', id, [{ materijalId: mat, kolicina: 1 }]);
  await b.call('nalog:setStatus', { id, status: 'zavrsen' });
  return { nalogId: id, ponudaId: pon.id, p: pon.p };
}

const izdajNalog = (id: number) => b.call('nalog:izdajRacun', { id, nacinPlacanja: 'Virman' });
const nalog = (id: number) => red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id);

/** Datum "sada" kao lokalni "YYYY-MM-DD HH:MM:SS" — gotovinski račun ulazi u ladicu. */
function sada(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Gotovinski račun od danas (ladica pokriva storno bez pologa). */
async function racunZaStorno(): Promise<{ id: number; p: number }> {
  const p = dodajArtikal(`S${Math.random().toString(36).slice(2, 7)}`, 3, { stanje: 10 });
  const { id } = await b.call('order:createManual', {
    ukupno: 6, pdvIznos: 0.87, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '55', createdAt: sada(),
    stavke: [{ productId: p, kolicina: 2, cijena: 3, rabat: 0, pdvStopa: 'E' }],
  });
  return { id, p };
}

const storniraj = (id: number) => b.call('order:refundAndPrint', { id });
const order = (id: number) => red('SELECT status, brojReklamacije, refundedAt FROM orders WHERE id = ?', id);

// ─── ponuda → račun ─────────────────────────────────────────

describe('ponuda:konvertuj — write-ahead', () => {
  test('nepoznat ishod: red s vrstom "ponuda" ostaje, ponuda ostaje prihvaćena, ništa se ne upisuje', async () => {
    const pon = await prihvacenaPonuda();
    await uredjajBezPotvrde();

    const r = await konvertuj(pon.id);

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBe(true);
    expect(r.error).toContain('nezavršenih računa');
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({
      vrsta: 'ponuda', ponudaId: pon.id, ponudaBroj: pon.broj, ponudaGodina: pon.godina,
      korisnikId: ADMIN, ukupno: 20, nacinPlacanja: 'Gotovina',
      kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001' },
      stavke: [{ productId: pon.p, naziv: `Artikal ${red('SELECT sifra FROM products WHERE id = ?', pon.p).sifra}`, kolicina: 2, cijena: 10 }],
    });
    expect('nalogId' in pending()[0]).toBe(false);
    expect(ponuda(pon.id)).toEqual({ status: 'prihvacena', racunId: null });
    expect(brojRacuna()).toBe(0);
    expect(stanje(pon.p)).toBe(10);
  });

  test('siguran neuspjeh (greška uređaja) briše red', async () => {
    const pon = await prihvacenaPonuda();
    b.tring.greskaNa('/sfr', 'Nema papira', 12);

    const r = await konvertuj(pon.id);

    expect(r).toEqual({ success: false, error: 'Nema papira [12]', odgovori: {} });
    expect(pending()).toEqual([]);
    expect(ponuda(pon.id)).toEqual({ status: 'prihvacena', racunId: null });
  });

  test('uspjeh: red se briše u istoj transakciji s upisom', async () => {
    const pon = await prihvacenaPonuda();
    const stampa = b.tring.zadrzi('/sfr');
    const r = konvertuj(pon.id);
    await stampa.stigao;
    expect(pending()).toMatchObject([{ vrsta: 'ponuda', ponudaId: pon.id }]);
    stampa.pusti();

    expect(await r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(pending()).toEqual([]);
  });

  test('resolve: račun po snapshotu s unesenim brojem i datumom, ponuda konvertovana, zaliha skinuta', async () => {
    const pon = await prihvacenaPonuda();
    await uredjajBezPotvrde();
    await konvertuj(pon.id);
    const id = await pendingId();

    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: ' 700 ', createdAt: DATUM });

    expect(red('SELECT brojFiskalnogRacuna, createdAt, isManual, ukupno, nacinPlacanja, kupacNaziv, status FROM orders WHERE id = ?', r.id))
      .toEqual({ brojFiskalnogRacuna: '700', createdAt: DATUM, isManual: 1, ukupno: 20, nacinPlacanja: 'Gotovina', kupacNaziv: 'Firma d.o.o.', status: 'completed' });
    expect(redovi('SELECT productId, kolicina, cijena FROM order_items WHERE orderId = ?', r.id))
      .toEqual([{ productId: pon.p, kolicina: 2, cijena: 10 }]);
    expect(stanje(pon.p)).toBe(8);
    expect(red("SELECT createdAt FROM stock_movements WHERE referenceType = 'order' AND referenceId = ?", r.id).createdAt).toBe(DATUM);
    expect(ponuda(pon.id)).toEqual({ status: 'konvertovana', racunId: r.id });
    expect(pending()).toEqual([]);
    const trag = red("SELECT detalji FROM audit_log WHERE akcija = 'pending:rijesi'");
    expect(JSON.parse(trag.detalji)).toEqual({ pendingId: id, brojFiskalnogRacuna: '700', orderId: r.id, vrsta: 'ponuda' });

    // Riješena ponuda se više ne štampa.
    ispravanUredjaj();
    await expect(konvertuj(pon.id)).rejects.toThrow('Ponuda je već konvertovana u račun');
  });

  test('resolve odbija broj koji već postoji', async () => {
    const pon = await prihvacenaPonuda();
    await uredjajBezPotvrde();
    await konvertuj(pon.id);
    b.db.prepare("INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status) VALUES (1, 1, 0, 'Gotovina', '700', 'completed')").run();

    await expect(b.call('pending:resolve', { id: await pendingId(), brojFiskalnogRacuna: '700', createdAt: DATUM }))
      .rejects.toThrow('Fiskalni račun sa tim brojem već postoji');
    expect(ponuda(pon.id)).toEqual({ status: 'prihvacena', racunId: null });
    expect(pending()).toHaveLength(1);
  });

  test('discard: ništa se ne upisuje, ponuda se može ponovo štampati', async () => {
    const pon = await prihvacenaPonuda();
    await uredjajBezPotvrde();
    await konvertuj(pon.id);

    expect(await b.call('pending:discard', await pendingId())).toEqual({ success: true });

    expect(brojRacuna()).toBe(0);
    expect(stanje(pon.p)).toBe(10);
    expect(ponuda(pon.id)).toEqual({ status: 'prihvacena', racunId: null });
    ispravanUredjaj();
    expect(await konvertuj(pon.id)).toMatchObject({ success: true });
  });

  test('dok red postoji, nova štampa iste ponude (račun ili faktura) se odbija prije štampe', async () => {
    const pon = await prihvacenaPonuda();
    await uredjajBezPotvrde();
    await konvertuj(pon.id);
    ispravanUredjaj();

    await expect(konvertuj(pon.id)).rejects.toThrow('Račun po ovoj ponudi čeka u nezavršenim računima');
    await b.call('fiscal:setZadnjiBroj', 100);
    await expect(b.call('order:finalizePrilog', { iznos: 20, nacinPlacanja: 'Virman', ponudaId: pon.id }))
      .rejects.toThrow('Račun po ovoj ponudi čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(pending()).toHaveLength(1);

    // Druga ponuda nije blokirana.
    const druga = await prihvacenaPonuda();
    expect(await konvertuj(druga.id)).toMatchObject({ success: true });
  });

  test('stara faktura iz ponude (snapshot bez vrste, s ponudaId) takođe blokira konverziju', async () => {
    const pon = await prihvacenaPonuda();
    dodajPending({
      korisnikId: ADMIN, ukupno: 20, pdvIznos: 2.91, nacinPlacanja: 'Virman', stavke: [],
      prilogBroj: 5, prilogNaziv: 'Stavke po fakturi br. 5', prilogStavke: [], datumValute: null, napomena: null, ponudaId: pon.id,
    });
    await expect(konvertuj(pon.id)).rejects.toThrow('Račun po ovoj ponudi čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('red riješen tokom štampe: vecEvidentiran, samo jedan račun', async () => {
    const pon = await prihvacenaPonuda();
    const stampa = b.tring.zadrzi('/sfr');
    const r = konvertuj(pon.id);
    const rucni = await rijesiTokomStampe(stampa, '500');

    const odgovor = await r;
    expect(odgovor.error).toContain('već evidentiran');
    expect({ ...odgovor, error: null }).toEqual({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: '101', error: null });
    expect(brojRacuna()).toBe(1);
    expect(ponuda(pon.id)).toEqual({ status: 'konvertovana', racunId: rucni.id });
    expect(stanje(pon.p)).toBe(8);
    expect(pending()).toEqual([]);
  });
});

// ─── nalog → račun ──────────────────────────────────────────

describe('nalog:izdajRacun — write-ahead (samostalni nalog)', () => {
  test('nepoznat ishod: red s vrstom "nalog" ostaje, nalog ostaje završen, usluga se ne kreira', async () => {
    const id = await zavrsenNalog(234);
    await uredjajBezPotvrde();

    const r = await izdajNalog(id);

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBe(true);
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({
      vrsta: 'nalog', nalogId: id, nalogBroj: 1, korisnikId: ADMIN, ukupno: 234, nacinPlacanja: 'Virman',
      kupac: { naziv: 'Firma d.o.o.' },
      stavke: [{ naziv: 'Namještaj po mjeri', kolicina: 1, cijena: 234, pdvStopa: 'E', productTip: 'usluga' }],
    });
    expect(nalog(id)).toEqual({ status: 'zavrsen', racunId: null });
    expect(brojRacuna()).toBe(0);
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(0);
  });

  test('siguran neuspjeh briše red', async () => {
    const id = await zavrsenNalog();
    b.tring.greskaNa('/sfr', 'Nema papira');
    const r = await izdajNalog(id);
    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(pending()).toEqual([]);
    expect(nalog(id)).toEqual({ status: 'zavrsen', racunId: null });
  });

  test('resolve: račun usluge NAMJ s unesenim brojem, nalog fakturisan', async () => {
    const id = await zavrsenNalog(234);
    await uredjajBezPotvrde();
    await izdajNalog(id);

    const r = await b.call('pending:resolve', { id: await pendingId(), brojFiskalnogRacuna: '701', createdAt: DATUM });

    const usluga = red("SELECT id, tip FROM products WHERE sifra = 'NAMJ'");
    expect(usluga.tip).toBe('usluga');
    expect(red('SELECT brojFiskalnogRacuna, createdAt, isManual, ukupno, nacinPlacanja, kupacNaziv FROM orders WHERE id = ?', r.id))
      .toEqual({ brojFiskalnogRacuna: '701', createdAt: DATUM, isManual: 1, ukupno: 234, nacinPlacanja: 'Virman', kupacNaziv: 'Firma d.o.o.' });
    expect(redovi('SELECT productId, kolicina, cijena FROM order_items WHERE orderId = ?', r.id))
      .toEqual([{ productId: usluga.id, kolicina: 1, cijena: 234 }]);
    expect(red('SELECT COUNT(*) AS n FROM stock_movements WHERE productId = ?', usluga.id).n).toBe(0);
    expect(nalog(id)).toEqual({ status: 'fakturisan', racunId: r.id });
    expect(pending()).toEqual([]);
  });

  test('discard: nalog ostaje završen i račun se može ponovo izdati', async () => {
    const id = await zavrsenNalog();
    await uredjajBezPotvrde();
    await izdajNalog(id);
    await b.call('pending:discard', await pendingId());

    expect(brojRacuna()).toBe(0);
    expect(nalog(id)).toEqual({ status: 'zavrsen', racunId: null });
    ispravanUredjaj();
    expect(await izdajNalog(id)).toMatchObject({ success: true });
    expect(nalog(id).status).toBe('fakturisan');
  });

  test('dok red postoji, novo izdavanje za isti nalog se odbija prije štampe', async () => {
    const id = await zavrsenNalog();
    await uredjajBezPotvrde();
    await izdajNalog(id);
    ispravanUredjaj();

    await expect(izdajNalog(id)).rejects.toThrow('Račun za ovaj nalog čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toEqual([]);

    const drugi = await zavrsenNalog();
    expect(await izdajNalog(drugi)).toMatchObject({ success: true });
  });

  test('red riješen tokom štampe: vecEvidentiran, samo jedan račun', async () => {
    const id = await zavrsenNalog();
    const stampa = b.tring.zadrzi('/sfr');
    const r = izdajNalog(id);
    const rucni = await rijesiTokomStampe(stampa, '500');

    const odgovor = await r;
    expect({ ...odgovor, error: null }).toEqual({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: '101', error: null });
    expect(brojRacuna()).toBe(1);
    expect(nalog(id)).toEqual({ status: 'fakturisan', racunId: rucni.id });
  });
});

describe('nalog:izdajRacun — write-ahead (nalog iz ponude)', () => {
  test('nepoznat ishod: red vrste "ponuda" nosi nalog; ponuda prihvaćena, nalog završen', async () => {
    const { nalogId, ponudaId, p } = await zavrsenNalogIzPonude();
    const prije = stanje(p);
    await uredjajBezPotvrde();

    const r = await izdajNalog(nalogId);

    expect(r.ishodNepoznat).toBe(true);
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({ vrsta: 'ponuda', ponudaId, nalogId });
    expect(ponuda(ponudaId)).toEqual({ status: 'prihvacena', racunId: null });
    expect(nalog(nalogId)).toEqual({ status: 'zavrsen', racunId: null });
    expect(stanje(p)).toBe(prije);

    ispravanUredjaj();
    await expect(izdajNalog(nalogId)).rejects.toThrow('čeka u nezavršenim računima');
    await expect(konvertuj(ponudaId)).rejects.toThrow('Račun po ovoj ponudi čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('resolve: račun, ponuda konvertovana i nalog fakturisan', async () => {
    const { nalogId, ponudaId, p } = await zavrsenNalogIzPonude();
    const prije = stanje(p);
    await uredjajBezPotvrde();
    await izdajNalog(nalogId);

    const r = await b.call('pending:resolve', { id: await pendingId(), brojFiskalnogRacuna: '702', createdAt: DATUM });

    expect(ponuda(ponudaId)).toEqual({ status: 'konvertovana', racunId: r.id });
    expect(nalog(nalogId)).toEqual({ status: 'fakturisan', racunId: r.id });
    expect(red('SELECT nacinPlacanja, brojFiskalnogRacuna FROM orders WHERE id = ?', r.id))
      .toEqual({ nacinPlacanja: 'Virman', brojFiskalnogRacuna: '702' });
    expect(stanje(p)).toBe(prije - 2);
  });

  test('uspjeh: ponuda konvertovana i nalog fakturisan u istoj transakciji, red obrisan', async () => {
    const { nalogId, ponudaId } = await zavrsenNalogIzPonude();
    const r = await izdajNalog(nalogId);
    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101' });
    expect(ponuda(ponudaId)).toEqual({ status: 'konvertovana', racunId: r.racunId });
    expect(nalog(nalogId)).toEqual({ status: 'fakturisan', racunId: r.racunId });
    expect(pending()).toEqual([]);
  });
});

// ─── storno ─────────────────────────────────────────────────

describe('order:refundAndPrint — write-ahead', () => {
  test('nepoznat ishod: red s vrstom "storno" ostaje, račun ostaje completed, zaliha netaknuta', async () => {
    const { id, p } = await racunZaStorno();
    await uredjajBezPotvrde();

    const r = await storniraj(id);

    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBe(true);
    expect(r.nedovoljnoSredstava).toBeFalsy();
    expect(pending()).toHaveLength(1);
    expect(pending()[0]).toMatchObject({
      vrsta: 'storno', orderId: id, brojRacuna: '55', korisnikId: ADMIN, ukupno: 6,
      stavke: [{ naziv: red('SELECT naziv FROM products WHERE id = ?', p).naziv, kolicina: 2, cijena: 3 }],
    });
    expect(order(id)).toEqual({ status: 'completed', brojReklamacije: null, refundedAt: null });
    expect(stanje(p)).toBe(8);
    expect(red("SELECT COUNT(*) AS n FROM audit_log WHERE akcija = 'storno'").n).toBe(0);
  });

  test('siguran neuspjeh briše red', async () => {
    const { id } = await racunZaStorno();
    b.tring.greskaNa('/srr', 'Uređaj zauzet');
    const r = await storniraj(id);
    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(pending()).toEqual([]);
    expect(order(id).status).toBe('completed');
  });

  test('resolve: račun storniran s unesenim brojem reklamacije i datumom, zaliha vraćena po kretanjima', async () => {
    const { id, p } = await racunZaStorno();
    await uredjajBezPotvrde();
    await storniraj(id);
    const pid = await pendingId();

    // Broj reklamacije je drugi niz — isti broj kao neki račun nije prepreka.
    const r = await b.call('pending:resolve', { id: pid, brojFiskalnogRacuna: ' 55 ', createdAt: DATUM });

    expect(r).toEqual({ id });
    expect(order(id)).toEqual({ status: 'refunded', brojReklamacije: '55', refundedAt: DATUM });
    expect(redovi("SELECT productId, tip, kolicina, createdAt FROM stock_movements WHERE referenceType = 'refund' AND referenceId = ?", id))
      .toEqual([{ productId: p, tip: 'ulaz', kolicina: 2, createdAt: DATUM }]);
    expect(stanje(p)).toBe(10);
    expect(brojRacuna()).toBe(1);
    expect(pending()).toEqual([]);
    const trag = red("SELECT detalji FROM audit_log WHERE akcija = 'pending:rijesi'");
    expect(JSON.parse(trag.detalji)).toEqual({ pendingId: pid, brojFiskalnogRacuna: '55', orderId: id, vrsta: 'storno' });

    ispravanUredjaj();
    await expect(storniraj(id)).rejects.toThrow('Račun ne postoji ili je već storniran');
  });

  test('discard: račun ostaje completed i može se stornirati', async () => {
    const { id, p } = await racunZaStorno();
    await uredjajBezPotvrde();
    await storniraj(id);
    await b.call('pending:discard', await pendingId());

    expect(order(id)).toEqual({ status: 'completed', brojReklamacije: null, refundedAt: null });
    expect(stanje(p)).toBe(8);
    ispravanUredjaj();
    expect(await storniraj(id)).toMatchObject({ success: true, brojReklamacije: 'R-1' });
    expect(stanje(p)).toBe(10);
  });

  test('dok red postoji, novi storno istog računa se odbija prije štampe', async () => {
    const { id } = await racunZaStorno();
    await uredjajBezPotvrde();
    await storniraj(id);
    ispravanUredjaj();

    await expect(storniraj(id)).rejects.toThrow('Storno ovog računa čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(order(id).status).toBe('completed');
  });

  test('red riješen tokom štampe: vecEvidentiran, zaliha vraćena samo jednom', async () => {
    const { id, p } = await racunZaStorno();
    const stampa = b.tring.zadrzi('/srr');
    const r = storniraj(id);
    await rijesiTokomStampe(stampa, 'R-9');

    const odgovor = await r;
    expect(odgovor.error).toContain('već evidentiran');
    expect({ ...odgovor, error: null }).toEqual({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: 'R-1', error: null });
    expect(order(id)).toEqual({ status: 'refunded', brojReklamacije: 'R-9', refundedAt: DATUM });
    expect(stanje(p)).toBe(10);
    expect(red("SELECT COUNT(*) AS n FROM stock_movements WHERE referenceType = 'refund'").n).toBe(1);
    expect(red("SELECT COUNT(*) AS n FROM audit_log WHERE akcija = 'storno'").n).toBe(0);
  });
});

// ─── Stari snapshoti ────────────────────────────────────────

describe('snapshot bez vrste', () => {
  test('rješava se kao običan račun i ne blokira dokumente', async () => {
    const p = dodajArtikal('L1', 6, { stanje: 10 });
    const pid = dodajPending({ korisnikId: ADMIN, ukupno: 12, pdvIznos: 1.74, nacinPlacanja: 'Gotovina', stavke: [{ productId: p, kolicina: 2, cijena: 6, rabat: 0, pdvStopa: 'E' }] });

    const { id } = await racunZaStorno();
    expect(await storniraj(id)).toMatchObject({ success: true });

    const r = await b.call('pending:resolve', { id: pid, brojFiskalnogRacuna: '300', createdAt: DATUM });
    expect(red('SELECT brojFiskalnogRacuna, isManual, ukupno, status FROM orders WHERE id = ?', r.id))
      .toEqual({ brojFiskalnogRacuna: '300', isManual: 1, ukupno: 12, status: 'completed' });
    expect(stanje(p)).toBe(8);
    const trag = red("SELECT detalji FROM audit_log WHERE akcija = 'pending:rijesi'");
    expect(JSON.parse(trag.detalji)).toEqual({ pendingId: pid, brojFiskalnogRacuna: '300', orderId: r.id });
  });

  test('nepoznata vrsta se ne razrješava kao račun', async () => {
    const pid = dodajPending({ vrsta: 'nesto', korisnikId: ADMIN, ukupno: 1, stavke: [] });
    await expect(b.call('pending:resolve', { id: pid, brojFiskalnogRacuna: '1', createdAt: DATUM }))
      .rejects.toThrow('Nepoznata vrsta nezavršenog zapisa: "nesto"');
    expect(brojRacuna()).toBe(0);
    expect(pending()).toHaveLength(1);
  });
});
