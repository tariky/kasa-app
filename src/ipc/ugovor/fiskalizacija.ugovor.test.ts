// Ugovor: tok fiskalnog dokumenta oko write-ahead reda — vidi backend.ts.
//
// 1. Dokument JE odštampan, a upis u bazu padne (SQLite trigger RAISE(ABORT),
//    pa put radi isto nad oba backenda): transakcija upisa se poništi,
//    write-ahead red ostaje u nezavršenim računima (operater ga rješava s
//    brojem s papira), a poruka svih tokova kaže „… JE odštampan, ali nije
//    zabilježen u bazi".
// 2. Sve što može pasti prije štampe (postavke uređaja, račun za uređaj) ide
//    prije write-ahead reda: greška tada ne ostavlja nezavršeni red.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { izracunajTotale } from '../../lib/racun';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const DATUM = '2026-09-20 11:30:00';

function red(sql: string, ...params: Array<string | number>): Record<string, unknown> {
  return b.db.prepare(sql).get(...params) as Record<string, unknown>;
}

const broj = (sql: string) => red(sql).n as number;

/** Svaki upis (ili izmjena) u `orders` pada — kao pun disk ili zaključana baza nakon štampe. */
function blokirajUpis(dogadjaj: 'INSERT' | 'UPDATE'): void {
  b.db.exec(`CREATE TRIGGER blokiraj_upis BEFORE ${dogadjaj} ON orders BEGIN SELECT RAISE(ABORT, 'upis blokiran'); END`);
}

function odblokiraj(): void {
  b.db.exec('DROP TRIGGER blokiraj_upis');
}

function pending(): Array<{ id: number; snapshot: Record<string, unknown> }> {
  return (b.db.prepare('SELECT id, snapshot FROM pending_receipts ORDER BY id').all() as Array<{ id: number; snapshot: string }>)
    .map(r => ({ id: r.id, snapshot: JSON.parse(r.snapshot) }));
}

let sifra = 0;
function dodajProizvod(tip: 'artikal' | 'materijal', stanje = 10): number {
  const s = `F${++sifra}`;
  const id = Number(b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', 5, 'E', 1, ?)"
  ).run(s, `Proizvod ${s}`, tip).lastInsertRowid);
  b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
    .run(id, stanje);
  return id;
}

function stanje(productId: number): number {
  return red(`
    SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0) AS s
    FROM stock_movements WHERE productId = ?
  `, productId).s as number;
}

function dodajKupca(): number {
  return Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Firma d.o.o.', '4200000000001')").run().lastInsertRowid);
}

/** Prihvaćena ponuda s jednom stavkom (5 KM); vraća i artikal. */
function prihvacenaPonuda(): { id: number; p: number } {
  const p = dodajProizvod('artikal');
  const id = Number(b.db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (1, 2026, ?, 1, '2026-03-01', '2026-03-31', 'prihvacena', 5, 0.73)
  `).run(dodajKupca()).lastInsertRowid);
  b.db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, 0, 'E')")
    .run(id, p);
  return { id, p };
}

/** Račun sa kase: `kolicina` × artikal od 5 KM, gotovina. */
function kasaRacun(p: number, kolicina: number) {
  const a = red('SELECT sifra, naziv, jm, plu FROM products WHERE id = ?', p);
  const stavka = { productId: p, kolicina, cijena: 5, rabat: 0, pdvStopa: 'E', ...a };
  return { ...izracunajTotale([stavka]), nacinPlacanja: 'Gotovina', stavke: [stavka] };
}

/** Završen samostalni nalog po narudžbi (100 KM). */
async function zavrsenNalog(): Promise<number> {
  const { id } = await b.call('nalog:create', { vrsta: 'narudzba', kupacId: dodajKupca(), opis: 'Po mjeri', dogovorenaCijena: 100 });
  await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod('materijal'), kolicina: 1 }]);
  await b.call('nalog:setStatus', { id, status: 'zavrsen' });
  return id;
}

/** Riješi jedini nezavršeni red s brojem s papira; vraća id računa. */
async function rijesi(brojSaPapira: string): Promise<number> {
  const [row] = pending();
  return (await b.call('pending:resolve', { id: row.id, brojFiskalnogRacuna: brojSaPapira, createdAt: DATUM })).id;
}

describe('štampa uspjela, upis pao', () => {
  test('order:finalize: „Račun … JE odštampan", red ostaje, ništa upisano, zaliha netaknuta', async () => {
    const p = dodajProizvod('artikal');
    blokirajUpis('INSERT');

    await expect(b.call('order:finalize', kasaRacun(p, 2))).rejects.toThrow(
      'Račun 101 JE odštampan, ali nije zabilježen u bazi: upis blokiran. Riješite ga kroz nezavršene račune.',
    );

    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
    expect(stanje(p)).toBe(10);
    expect(pending()).toHaveLength(1);
    expect(pending()[0].snapshot).toMatchObject({ ukupno: 10, nacinPlacanja: 'Gotovina', stavke: [{ productId: p, kolicina: 2 }] });

    odblokiraj();
    const id = await rijesi('101');
    expect(red('SELECT brojFiskalnogRacuna, isManual FROM orders WHERE id = ?', id)).toEqual({ brojFiskalnogRacuna: '101', isManual: 1 });
    expect(stanje(p)).toBe(8);
  });

  test('order:finalizePrilog: poruka s brojem fakture i BF-om, red sa stavkama priloga ostaje', async () => {
    const p = dodajProizvod('artikal');
    await b.call('fiscal:setZadnjiBroj', 100);
    blokirajUpis('INSERT');

    await expect(b.call('order:finalizePrilog', {
      nacinPlacanja: 'Virman', stavke: [{ productId: p, kolicina: 2, cijena: 5, pdvStopa: 'E' }],
    })).rejects.toThrow(
      'Fiskalni račun po prilogu br. 101 (BF 101) JE odštampan, ali nije zabilježen u bazi: upis blokiran. ' +
      'Riješite ga kroz nezavršene račune.',
    );

    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM prilog_stavke')).toBe(0);
    expect(stanje(p)).toBe(10);
    expect(pending()[0].snapshot).toMatchObject({ prilogBroj: 101, prilogStavke: [{ productId: p, kolicina: 2 }] });

    odblokiraj();
    const id = await rijesi('101');
    expect(red('SELECT prilogBroj, ukupno FROM orders WHERE id = ?', id)).toEqual({ prilogBroj: 101, ukupno: 10 });
    expect(stanje(p)).toBe(8);
  });

  test('ponuda:konvertuj: „Račun … JE odštampan", ponuda ostaje prihvaćena', async () => {
    const pon = prihvacenaPonuda();
    blokirajUpis('INSERT');

    await expect(b.call('ponuda:konvertuj', { id: pon.id, nacinPlacanja: 'Gotovina' })).rejects.toThrow(
      'Račun 101 JE odštampan, ali nije zabilježen u bazi: upis blokiran. Riješite ga kroz nezavršene račune.',
    );

    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', pon.id)).toEqual({ status: 'prihvacena', racunId: null });
    expect(stanje(pon.p)).toBe(10);
    expect(pending()[0].snapshot).toMatchObject({ vrsta: 'ponuda', ponudaId: pon.id });
    // Dok red čeka, ponuda se ne štampa ponovo.
    await expect(b.call('ponuda:konvertuj', { id: pon.id, nacinPlacanja: 'Gotovina' }))
      .rejects.toThrow('Račun po ovoj ponudi čeka u nezavršenim računima');
    expect(b.tring.zahtjevi).toHaveLength(1);

    odblokiraj();
    const id = await rijesi('101');
    expect(red('SELECT status, racunId FROM ponude WHERE id = ?', pon.id)).toEqual({ status: 'konvertovana', racunId: id });
  });

  test('nalog:izdajRacun: nalog ostaje završen, usluga NAMJ se ne kreira', async () => {
    const id = await zavrsenNalog();
    blokirajUpis('INSERT');

    await expect(b.call('nalog:izdajRacun', { id, nacinPlacanja: 'Virman' })).rejects.toThrow(
      'Račun 101 JE odštampan, ali nije zabilježen u bazi: upis blokiran. Riješite ga kroz nezavršene račune.',
    );

    expect(red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'zavrsen', racunId: null });
    expect(broj("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'")).toBe(0);
    expect(pending()[0].snapshot).toMatchObject({ vrsta: 'nalog', nalogId: id });

    odblokiraj();
    const racunId = await rijesi('101');
    expect(red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id)).toEqual({ status: 'fakturisan', racunId });
  });

  test('order:refundAndPrint: „Reklamacija … JE odštampana", račun ostaje nestorniran', async () => {
    const p = dodajProizvod('artikal');
    const { id } = await b.call('order:createManual', {
      ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Virman', brojFiskalnogRacuna: '55', createdAt: DATUM,
      stavke: [{ productId: p, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
    });
    blokirajUpis('UPDATE');

    await expect(b.call('order:refundAndPrint', { id })).rejects.toThrow(
      'Reklamacija #R-1 JE odštampana, ali nije zabilježena u bazi: upis blokiran. Riješite je kroz nezavršene račune.',
    );

    expect(red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id)).toEqual({ status: 'completed', brojReklamacije: null });
    expect(stanje(p)).toBe(9);
    expect(pending()[0].snapshot).toMatchObject({ vrsta: 'storno', orderId: id });
    expect(broj("SELECT COUNT(*) AS n FROM audit_log WHERE akcija = 'storno'")).toBe(0);

    odblokiraj();
    await rijesi('R-1');
    expect(red('SELECT status, brojReklamacije FROM orders WHERE id = ?', id)).toEqual({ status: 'refunded', brojReklamacije: 'R-1' });
    expect(stanje(p)).toBe(10);
  });
});

describe('greška prije štampe ne ostavlja nezavršeni red', () => {
  /**
   * Postavke uređaja (tring.*) se ne mogu pročitati: `settings` postaje view
   * koji za tring.* ključeve baca „malformed JSON" (ostale postavke rade).
   */
  function necitljivePostavkeUredjaja(): void {
    b.db.exec('ALTER TABLE settings RENAME TO settings_citljive');
    b.db.exec("CREATE VIEW settings AS SELECT key, CASE WHEN key LIKE 'tring.%' THEN json(key) ELSE value END AS value FROM settings_citljive");
  }

  test('postavke uređaja nečitljive: greška na svakom toku, bez reda, ništa odštampano ni upisano', async () => {
    const p = dodajProizvod('artikal');
    await b.call('fiscal:setZadnjiBroj', 100);
    const pon = prihvacenaPonuda();
    const nalogId = await zavrsenNalog();
    const { id: orderId } = await b.call('order:createManual', {
      ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Virman', brojFiskalnogRacuna: '55', createdAt: DATUM,
      stavke: [{ productId: p, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
    });
    necitljivePostavkeUredjaja();

    const tokovi: Array<[string, () => Promise<unknown>]> = [
      ['order:finalize', () => b.call('order:finalize', kasaRacun(p, 1))],
      ['order:finalizePrilog', () => b.call('order:finalizePrilog', { iznos: 10, nacinPlacanja: 'Virman' })],
      ['ponuda:konvertuj', () => b.call('ponuda:konvertuj', { id: pon.id, nacinPlacanja: 'Gotovina' })],
      ['nalog:izdajRacun', () => b.call('nalog:izdajRacun', { id: nalogId, nacinPlacanja: 'Virman' })],
      ['order:refundAndPrint', () => b.call('order:refundAndPrint', { id: orderId })],
    ];
    for (const [tok, pozovi] of tokovi) {
      await expect(pozovi(), tok).rejects.toThrow('malformed JSON');
      expect(pending(), tok).toEqual([]);
    }

    expect(b.tring.zahtjevi).toEqual([]);
    expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(1);
    expect(red('SELECT status FROM orders WHERE id = ?', orderId)).toEqual({ status: 'completed' });
    expect(red('SELECT status FROM ponude WHERE id = ?', pon.id)).toEqual({ status: 'prihvacena' });
    expect(red('SELECT status FROM radni_nalozi WHERE id = ?', nalogId)).toEqual({ status: 'zavrsen' });
  });
});
