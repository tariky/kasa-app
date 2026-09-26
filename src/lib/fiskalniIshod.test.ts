// Ishod fiskalne štampe kako ga čita renderer. Odgovori i bačene greške
// dolaze iz stvarnih lib tokova (ponuda, storno, pendingRacun) nad pravom
// SQLite bazom — ako backend promijeni oblik ili poruku, test pada ovdje.
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import { createPonuda, konvertujPonudu } from './ponuda';
import { refundAndPrint } from './refund';
import { neuspjelaStampa, vecEvidentiran, vecEvidentiranStorno, zapisiPending } from './pendingRacun';
import { procitajIshod, izvrsiFiskalno } from './fiskalniIshod';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

const brojPending = () => (db.prepare('SELECT COUNT(*) AS c FROM pending_receipts').get() as { c: number }).c;

function napraviPonudu(): number {
  const kupacId = Number(db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac d.o.o.', '4200000000001')").run().lastInsertRowid);
  const productId = Number(db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('A1', 'Artikal', 10, 'E')").run().lastInsertRowid);
  return createPonuda(db, {
    kupacId, korisnikId: 1, datum: '2026-03-01',
    stavke: [{ productId, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }],
  }).id;
}

const stampaOk = async () => ({ success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: '41' } }) as any;
const deps = (print: any) => ({ db, print, transaction: <T>(fn: () => T) => db.transaction(fn) });
/** Upis poslije štampe pada — kao disk pun ili zaključana baza. */
const oboriUpis = (tabela: string, dogadjaj: 'INSERT' | 'UPDATE') =>
  db.exec(`CREATE TRIGGER obori BEFORE ${dogadjaj} ON ${tabela} BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`);

async function bacenaGreska(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('očekivana je bačena greška');
}

// ─── Vraćeni odgovori ───────────────────────────────────────

test('uspjeh: success iz bilo kojeg fiskalnog kanala', () => {
  expect(procitajIshod({ success: true, id: 7, brojFiskalnogRacuna: '41', odgovori: { BrojFiskalnogRacuna: '41' } } as any))
    .toEqual({ vrsta: 'uspjeh', poruka: '' });
});

test('siguran neuspjeh uređaja je greska — poruka nosi odgovore uređaja, formatirane na jednom mjestu', () => {
  const pendingId = zapisiPending(db, 1, {});
  const res = neuspjelaStampa(db, pendingId, {
    success: false, vrstaOdgovora: 'Greska', error: 'Nedovoljno novca u kasi [535]',
    odgovori: { Kod: '535', Opis: 'Nema novca' },
  });
  expect(procitajIshod(res)).toEqual({ vrsta: 'greska', poruka: 'Nedovoljno novca u kasi [535] (Kod: 535, Opis: Nema novca)' });
  // Siguran neuspjeh je obrisao write-ahead red — ponovni pokušaj je dozvoljen.
  expect(brojPending()).toBe(0);

  expect(procitajIshod({ success: false, error: 'Štampač ne odgovara', odgovori: {} })).toEqual({ vrsta: 'greska', poruka: 'Štampač ne odgovara' });
  // Bez teksta greške (npr. tring:init) ostaje vrsta odgovora uređaja.
  expect(procitajIshod({ success: false, vrstaOdgovora: 'Greska' }).poruka).toBe('Greska');
  expect(procitajIshod({ success: false }).poruka).toBe('Nepoznata greška');
});

test('nepoznat ishod koji backend vrati (ishodNepoznat) ostavlja red za dijalog nezavršenih', () => {
  const pendingId = zapisiPending(db, 1, {});
  const res = neuspjelaStampa(db, pendingId, {
    success: false, vrstaOdgovora: 'Greska', error: 'Request timed out', odgovori: {}, ishodNepoznat: true,
  });
  const ishod = procitajIshod(res);
  expect(ishod.vrsta).toBe('nepoznat');
  expect(ishod.poruka).toBe(res.error);
  expect(brojPending()).toBe(1);
});

test('već evidentiran račun i storno — i kad poruka kaže "JE odštampan", odgovor je vecEvidentiran', () => {
  const racun = vecEvidentiran('41');
  expect(procitajIshod(racun)).toEqual({ vrsta: 'vecEvidentiran', poruka: racun.error });
  const storno = vecEvidentiranStorno('9');
  expect(procitajIshod(storno)).toEqual({ vrsta: 'vecEvidentiran', poruka: storno.error });
});

test('odgovor koji fali (null/undefined bez greške) je greska', () => {
  expect(procitajIshod(null)).toEqual({ vrsta: 'greska', poruka: 'Nepoznata greška' });
  expect(procitajIshod(undefined)).toEqual({ vrsta: 'greska', poruka: 'Nepoznata greška' });
});

// ─── Bačene greške ──────────────────────────────────────────

test('bačena greška validacije PRIJE štampe je greska: ništa nije poslano, nema write-ahead reda', async () => {
  const id = napraviPonudu();
  let pozvano = 0;
  const print = async () => { pozvano++; return stampaOk(); };
  const e = await bacenaGreska(konvertujPonudu(deps(print), { id, korisnikId: 0, nacinPlacanja: 'Gotovina' }));

  expect(procitajIshod(undefined, e)).toEqual({ vrsta: 'greska', poruka: 'Korisnik nije prijavljen' });
  expect(pozvano).toBe(0);
  expect(brojPending()).toBe(0);
});

test('bačena greška POSLIJE štampe (račun po ponudi odštampan, upis pao) je nepoznat', async () => {
  const id = napraviPonudu();
  oboriUpis('orders', 'INSERT');
  const e = await bacenaGreska(konvertujPonudu(deps(stampaOk), { id, korisnikId: 1, nacinPlacanja: 'Gotovina' }));

  const ishod = procitajIshod(undefined, e);
  expect(ishod.vrsta).toBe('nepoznat');
  expect(ishod.poruka).toStartWith('Račun 41 JE odštampan, ali nije zabilježen u bazi: disk I/O error.');
  // Red ostaje (rollback) — dijalog nezavršenih ga rješava, ponuda se ne šalje ponovo.
  expect(brojPending()).toBe(1);
});

test('bačena greška POSLIJE štampe storna (reklamacija odštampana, upis pao) je nepoznat', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, cijena, pdvStopa) VALUES (1, 'A1', 'Artikal', 10, 'E')").run();
  const orderId = Number(db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status)
    VALUES (1, 10, 1.45, 'Gotovina', '555', 'completed')
  `).run().lastInsertRowid);
  db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, 1, 1, 10, 0, 'E')").run(orderId);
  oboriUpis('orders', 'UPDATE');
  const stampaStorna = async () => ({ success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: '9' } }) as any;

  const e = await bacenaGreska(refundAndPrint(deps(stampaStorna), { id: orderId }));

  const ishod = procitajIshod(undefined, e);
  expect(ishod.vrsta).toBe('nepoznat');
  expect(ishod.poruka).toStartWith('Reklamacija #9 JE odštampana, ali nije zabilježena u bazi');
  expect(brojPending()).toBe(1);
});

test('poruke "JE odštampan" iz ostalih tokova (oba backenda) i s Electron omotom su nepoznat', () => {
  const poruke = [
    // lib/prilog.ts, racuni.rs finalize_prilog_and_print
    'Fiskalni račun po prilogu br. 12 (BF 12) JE odštampan, ali nije zabilježen u bazi: x. Riješite ga kroz nezavršene račune.',
    // lib/proizvodnja.ts knjiziFakturisanjeNaloga, proizvodnja.rs knjizi_fakturisanje_naloga
    'Račun 41 JE odštampan, ali nalog nije zabilježen kao fakturisan u bazi: x. Evidentirajte nalog ručno.',
  ];
  for (const p of poruke) {
    expect(procitajIshod(undefined, new Error(p))).toEqual({ vrsta: 'nepoznat', poruka: p });
    // Electron ipcRenderer.invoke umota grešku handlera — oznaka se i dalje prepoznaje, omot se skida.
    const omotano = new Error(`Error invoking remote method 'order:finalizePrilog': Error: ${p}`);
    expect(procitajIshod(undefined, omotano)).toEqual({ vrsta: 'nepoznat', poruka: p });
  }
});

test('bačena greška bez oznake je greska (tekst ili ne-Error vrijednost)', () => {
  expect(procitajIshod(undefined, new Error('Nedovoljna količina na stanju'))).toEqual({ vrsta: 'greska', poruka: 'Nedovoljna količina na stanju' });
  expect(procitajIshod(undefined, 'Sesija je istekla')).toEqual({ vrsta: 'greska', poruka: 'Sesija je istekla' });
  // Bačena greška ima prednost pred odgovorom (poziv nije vratio ništa upotrebljivo).
  expect(procitajIshod({ success: true }, new Error('x')).vrsta).toBe('greska');
});

// ─── izvrsiFiskalno: bačena greška bez oznake i write-ahead red ─────

test('izvrsiFiskalno: vraćen odgovor se čita direktno, bez provjere nezavršenih', async () => {
  let provjera = 0;
  const ceka = async () => { provjera++; return true; };
  const ok = await izvrsiFiskalno(async () => ({ success: true, id: 5 }), ceka);
  expect(ok.ishod.vrsta).toBe('uspjeh');
  expect(ok.res).toEqual({ success: true, id: 5 });

  const greska = await izvrsiFiskalno(async () => ({ success: false, error: 'Uređaj odbio' }), ceka);
  expect(greska.ishod).toEqual({ vrsta: 'greska', poruka: 'Uređaj odbio' });
  expect(provjera).toBe(0);
});

test('izvrsiFiskalno: bačena greška bez oznake uz write-ahead red (order:finalize, upis pao poslije štampe) je nepoznat', async () => {
  // handlers.ts order:finalize: greška transakcije upisa poslije uspješne
  // štampe izlazi sirova (bez "JE odštampan"), a rollback ostavlja red.
  const r = await izvrsiFiskalno(async () => { throw new Error('database is locked'); }, async () => true);
  expect(r.res).toBeNull();
  expect(r.ishod.vrsta).toBe('nepoznat');
  expect(r.ishod.poruka).toBe(
    'Ishod štampe nije poznat (database is locked). Provjerite papirni isječak i riješite zapis u nezavršenim računima.'
  );
});

test('izvrsiFiskalno: bačena greška bez oznake i bez write-ahead reda je greska (validacija prije štampe)', async () => {
  const r = await izvrsiFiskalno(async () => { throw new Error('Korisnik nije prijavljen'); }, async () => false);
  expect(r).toEqual({ ishod: { vrsta: 'greska', poruka: 'Korisnik nije prijavljen' }, res: null });
});

test('izvrsiFiskalno: dokument koji već čeka u nezavršenim ide u dijalog, bez dvostruke poruke', async () => {
  const poruka = 'Račun po ovoj ponudi čeka u nezavršenim računima (ishod štampe nije poznat) — riješite ga prije nove štampe';
  const r = await izvrsiFiskalno(async () => { throw new Error(poruka); }, async () => true);
  expect(r.ishod).toEqual({ vrsta: 'nepoznat', poruka });
});

test('izvrsiFiskalno: kad se nezavršeni ne mogu pročitati, bačena greška je nepoznat (nikad ponovo na uređaj)', async () => {
  const r = await izvrsiFiskalno(async () => { throw new Error('x'); }, async () => { throw new Error('IPC pao'); });
  expect(r.ishod.vrsta).toBe('nepoznat');
});

test('izvrsiFiskalno: bačena greška s oznakom je nepoznat i bez provjere nezavršenih', async () => {
  let provjera = 0;
  const r = await izvrsiFiskalno(
    async () => { throw new Error('Račun 41 JE odštampan, ali nije zabilježen u bazi: x. Riješite ga kroz nezavršene račune.'); },
    async () => { provjera++; return false; },
  );
  expect(r.ishod.vrsta).toBe('nepoznat');
  expect(provjera).toBe(0);
});

test('izvrsiFiskalno: poziv koji vrati null bez greške provjerava nezavršene', async () => {
  expect((await izvrsiFiskalno(async () => null, async () => true)).ishod.vrsta).toBe('nepoznat');
  expect((await izvrsiFiskalno(async () => null, async () => false)).ishod).toEqual({ vrsta: 'greska', poruka: 'Nepoznata greška' });
});
