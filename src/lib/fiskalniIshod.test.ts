// Ishod fiskalne štampe kako ga čita renderer. Odgovori i bačene greške
// dolaze iz stvarnih lib tokova (ponuda, storno, pendingRacun) nad pravom
// SQLite bazom — ako backend promijeni oblik ili poruku, test pada ovdje.
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { createPonuda, konvertujPonudu } from './ponuda';
import { refundAndPrint } from './refund';
import { neuspjelaStampa, vecEvidentiran, vecEvidentiranStorno, zapisiPending } from './pendingRacun';
import { procitajIshod, izvrsiFiskalno } from './fiskalniIshod';
import type { FiskalniUredjaj, IshodUredjaja } from './fiskalniUredjaj';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza({ kasir: true });
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

/** Lažni fiskalni uređaj (lib/fiskalniUredjaj.ts): štampa vrati ishod u obliku adaptera. */
const stampaOk = async (): Promise<IshodUredjaja> => ({ ok: true, bf: '41', odgovori: { BrojFiskalnogRacuna: '41' } });
/** Tok dobije samo komandu uređaja koju koristi — ponuda `stampajRacun`, storno `stampajReklamaciju`. */
const deps = <U extends Partial<FiskalniUredjaj>>(uredjaj: U) =>
  ({ db, uredjaj, transaction: <T>(fn: () => T) => db.transaction(fn) });
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
    ok: false, greska: 'Nedovoljno novca u kasi [535]', nepoznat: false,
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
    ok: false, greska: 'Request timed out', nepoznat: true, odgovori: {},
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
  const stampajRacun = async () => { pozvano++; return stampaOk(); };
  const e = await bacenaGreska(konvertujPonudu(deps({ stampajRacun }), { id, korisnikId: 0, nacinPlacanja: 'Gotovina' }));

  expect(procitajIshod(undefined, e)).toEqual({ vrsta: 'greska', poruka: 'Korisnik nije prijavljen' });
  expect(pozvano).toBe(0);
  expect(brojPending()).toBe(0);
});

test('bačena greška POSLIJE štampe (račun po ponudi odštampan, upis pao) je nepoznat', async () => {
  const id = napraviPonudu();
  oboriUpis('orders', 'INSERT');
  const e = await bacenaGreska(konvertujPonudu(deps({ stampajRacun: stampaOk }), { id, korisnikId: 1, nacinPlacanja: 'Gotovina' }));

  const ishod = procitajIshod(undefined, e);
  expect(ishod.vrsta).toBe('nepoznat');
  // Ista poruka i za order:finalize i nalog:izdajRacun (lib/fiskalizacija.ts porukaNakonStampe, stampa.rs nije_zabiljezen).
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
  const stampaStorna = async (): Promise<IshodUredjaja> => ({ ok: true, bf: '9', odgovori: { BrojFiskalnogRacuna: '9' } });

  const e = await bacenaGreska(refundAndPrint(deps({ stampajReklamaciju: stampaStorna }), { id: orderId }));

  const ishod = procitajIshod(undefined, e);
  expect(ishod.vrsta).toBe('nepoznat');
  expect(ishod.poruka).toStartWith('Reklamacija #9 JE odštampana, ali nije zabilježena u bazi');
  expect(brojPending()).toBe(1);
});

test('poruke "JE odštampan" iz ostalih tokova (oba backenda) i s Electron omotom su nepoznat', () => {
  const poruke = [
    // lib/prilog.ts, prilog.rs finalize_prilog_and_print
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
// Nezavršeni se čitaju iz iste baze kao što ih renderer čita kroz pending:list.

const nezavrseni = async () => (db.prepare('SELECT id FROM pending_receipts ORDER BY id').all() as Array<{ id: number }>).map(r => r.id);
const pada = async (): Promise<number[]> => { throw new Error('IPC pao'); };
/** Nevezan red koji čeka odluku admina (pending:discard je samo za admina). */
const stariRed = () => zapisiPending(db, 1, { ukupno: 5, stavke: [] });

test('izvrsiFiskalno: vraćen odgovor se čita direktno', async () => {
  const ok = await izvrsiFiskalno(async () => ({ success: true, id: 5 }), nezavrseni);
  expect(ok).toEqual({ ishod: { vrsta: 'uspjeh', poruka: '' }, res: { success: true, id: 5 } });
  stariRed();
  // Siguran neuspjeh je presuda backenda — ni postojeći red ga ne mijenja.
  const greska = await izvrsiFiskalno(async () => ({ success: false, error: 'Uređaj odbio' }), nezavrseni);
  expect(greska.ishod).toEqual({ vrsta: 'greska', poruka: 'Uređaj odbio' });
});

test('izvrsiFiskalno: greška validacije uz NEVEZAN postojeći red je greska (korpa ostaje)', async () => {
  stariRed();
  const id = napraviPonudu();
  const r = await izvrsiFiskalno(() => konvertujPonudu(deps({ stampajRacun: stampaOk }), { id, korisnikId: 0, nacinPlacanja: 'Gotovina' }), nezavrseni);
  expect(r).toEqual({ ishod: { vrsta: 'greska', poruka: 'Korisnik nije prijavljen' }, res: null });
  expect(brojPending()).toBe(1);
});

test('izvrsiFiskalno: novi red uz sirovu grešku (bez "JE odštampan") je nepoznat', async () => {
  stariRed();
  // Poziv je upisao write-ahead red pa bacio grešku bez oznake — npr. IPC pao
  // bez odgovora. (Upis koji padne poslije štampe oba backenda javljaju s
  // oznakom — lib/fiskalizacija.ts, stampa.rs; ovo je rezerva za sve ostalo.)
  const finalize = async () => { zapisiPending(db, 1, { ukupno: 10, stavke: [] }); throw new Error('database is locked'); };
  const r = await izvrsiFiskalno(finalize, nezavrseni);
  expect(r.res).toBeNull();
  expect(r.ishod).toEqual({
    vrsta: 'nepoznat',
    poruka: 'Ishod štampe nije poznat (database is locked). Provjerite papirni isječak i riješite zapis u nezavršenim računima.',
  });
});

test('izvrsiFiskalno: red koji za isti dokument već čeka blokira štampu — greska, bez novog reda', async () => {
  const id = napraviPonudu();
  zapisiPending(db, 1, { vrsta: 'ponuda', ponudaId: id });
  const r = await izvrsiFiskalno(() => konvertujPonudu(deps({ stampajRacun: stampaOk }), { id, korisnikId: 1, nacinPlacanja: 'Gotovina' }), nezavrseni);
  expect(r.ishod.vrsta).toBe('greska');
  expect(r.ishod.poruka).toStartWith('Račun po ovoj ponudi čeka u nezavršenim računima');
});

test('izvrsiFiskalno: kad se nezavršeni ne mogu pročitati (prije ili poslije), bačena greška je nepoznat', async () => {
  const baca = async () => { throw new Error('x'); };
  expect((await izvrsiFiskalno(baca, pada)).ishod.vrsta).toBe('nepoznat');
  // Čitanje prije poziva palo, poslije uspjelo: ne zna se šta je bilo prije.
  let citanja = 0;
  const prvoPada = async () => { if (citanja++ === 0) throw new Error('IPC pao'); return []; };
  expect((await izvrsiFiskalno(baca, prvoPada)).ishod.vrsta).toBe('nepoznat');
  // Uspjeh ne zavisi od čitanja nezavršenih.
  expect((await izvrsiFiskalno(async () => ({ success: true }), pada)).ishod.vrsta).toBe('uspjeh');
});

test('izvrsiFiskalno: bačena greška s oznakom je nepoznat i bez novog reda', async () => {
  const r = await izvrsiFiskalno(
    async () => { throw new Error('Račun 41 JE odštampan, ali nije zabilježen u bazi: x. Riješite ga kroz nezavršene račune.'); },
    async () => [],
  );
  expect(r.ishod.vrsta).toBe('nepoznat');
});

test('izvrsiFiskalno: poziv koji vrati null bez greške — nepoznat samo uz novi red', async () => {
  stariRed();
  expect((await izvrsiFiskalno(async () => null, nezavrseni)).ishod).toEqual({ vrsta: 'greska', poruka: 'Nepoznata greška' });
  const noviRed = async () => { stariRed(); return null; };
  expect((await izvrsiFiskalno(noviRed, nezavrseni)).ishod.vrsta).toBe('nepoznat');
});
