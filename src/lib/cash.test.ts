import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import { addCashMovement, retryCashMovement, getTodayMovements, getDrawerState } from './cash';
import type { SqlDb } from './sqldb';
import type { TringResponse } from '@/services/tring';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

const ok: TringResponse = { success: true, vrstaOdgovora: 'OK', odgovori: {} };
const greska: TringResponse = { success: false, vrstaOdgovora: 'Greska', odgovori: {}, error: 'printer ne radi' };

function dodajRacun(nacinPlacanja: string, ukupno: number, opts: { createdAt?: string; refundedAt?: string } = {}): void {
  db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, refundedAt, createdAt)
    VALUES (1, ?, 0, ?, ?, ?, ?)
  `).run(
    ukupno, nacinPlacanja,
    opts.refundedAt ? 'refunded' : 'completed',
    opts.refundedAt ?? null,
    opts.createdAt ?? nowStr()
  );
}

test('polog se upiše sa statusom ok kad printer potvrdi', async () => {
  const r = await addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  expect(r.tringStatus).toBe('ok');

  const row = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(r.id) as any;
  expect(row.tip).toBe('polog');
  expect(row.iznos).toBe(50);
  expect(row.tringStatus).toBe('ok');
});

test('polog se upiše i kad slanje na printer ne uspije', async () => {
  const r = await addCashMovement({ db, send: async () => greska }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  expect(r.tringStatus).toBe('error');
  expect(r.error).toBe('printer ne radi');

  const row = db.prepare('SELECT tringStatus FROM cash_movements WHERE id = ?').get(r.id) as any;
  expect(row.tringStatus).toBe('error');
});

test('bez fiskalne integracije status je skipped', async () => {
  const r = await addCashMovement({ db, send: async () => null }, { tip: 'povrat', iznos: 20, korisnikId: 1 });
  expect(r.tringStatus).toBe('skipped');
});

test('nevalidan iznos baca grešku i ništa ne upisuje', async () => {
  await expect(addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: 0, korisnikId: 1 }))
    .rejects.toThrow('Iznos');
  await expect(addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: NaN, korisnikId: 1 }))
    .rejects.toThrow('Iznos');
  expect((db.prepare('SELECT COUNT(*) c FROM cash_movements').get() as any).c).toBe(0);
});

test('retry šalje ponovo i prebacuje error u ok', async () => {
  const r = await addCashMovement({ db, send: async () => greska }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  const retry = await retryCashMovement({ db, send: async () => ok }, r.id);
  expect(retry.tringStatus).toBe('ok');

  const row = db.prepare('SELECT tringStatus FROM cash_movements WHERE id = ?').get(r.id) as any;
  expect(row.tringStatus).toBe('ok');
});

test('retry odbija zapis koji nije u error statusu', async () => {
  const r = await addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  await expect(retryCashMovement({ db, send: async () => ok }, r.id)).rejects.toThrow();
});

test('getTodayMovements vraća samo današnja kretanja', async () => {
  await addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  db.prepare(`
    INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt)
    VALUES ('polog', 99, 1, 'ok', '2020-01-01 08:00:00')
  `).run();

  const rows = getTodayMovements(db);
  expect(rows.length).toBe(1);
  expect(rows[0].iznos).toBe(50);
  expect(rows[0].korisnikIme).toBe('Kasir');
});

test('getLastPologIznos vraća iznos zadnjeg pologa iz bilo kojeg dana', async () => {
  db.prepare(`
    INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt)
    VALUES ('polog', 40, 1, 'ok', '2020-01-01 08:00:00')
  `).run();
  db.prepare(`
    INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt)
    VALUES ('povrat', 99, 1, 'ok', '2020-01-02 08:00:00')
  `).run();

  const { getLastPologIznos } = await import('./cash');
  expect(getLastPologIznos(db)).toBe(40);
});

test('getLastPologIznos vraća null kad pologa nema', async () => {
  const { getLastPologIznos } = await import('./cash');
  expect(getLastPologIznos(db)).toBeNull();
});

test('getDrawerState kombinuje pologe, promet, reklamacije za danas', async () => {
  await addCashMovement({ db, send: async () => ok }, { tip: 'polog', iznos: 50, korisnikId: 1 });
  dodajRacun('Gotovina', 20);                                    // danas, gotovina → +20
  dodajRacun('Kartica', 99);                                     // kartica → 0
  dodajRacun('Gotovina', 15, { createdAt: '2020-01-01 10:00:00', refundedAt: nowStr() }); // jučer prodan, danas storniran → −15
  dodajRacun('Gotovina', 7, { createdAt: '2020-01-01 10:00:00' }); // stara prodaja → ne ulazi

  const s = getDrawerState(db);
  expect(s.polozi).toBe(50);
  expect(s.gotovinskiPromet).toBe(20);
  expect(s.gotovinskeReklamacije).toBe(15);
  expect(s.ocekivanoStanje).toBe(55);
});

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
