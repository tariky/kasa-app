// Čiste funkcije ponude koje koriste ekrani (broj, status, rok) i provjera
// korisnika prije štampe, koju ugovor ne može dosegnuti (handler šalje korisnika
// sesije). Kanali ponuda:* su u ugovoru oba backenda (ugovor/ponude.ugovor.test.ts).
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import {
  formatBrojPonude, createPonuda, efektivniStatus, konvertujPonudu, plusDana, danaIzmedju, DEFAULT_ROK_DANA,
} from './ponuda';
import { uredjajIzFunkcija } from './fiskalniUredjaj';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza({ kasir: true });
});

test('formatBrojPonude prima format iz postavki', () => {
  expect(formatBrojPonude({ broj: 3, godina: 2026 })).toBe('3/2026');
  expect(formatBrojPonude({ broj: 3, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-003/2026');
});

// ─── efektivniStatus ────────────────────────────────────────

test('draft i poslana poslije roka postaju istekla', () => {
  expect(efektivniStatus({ status: 'draft', vaziDo: '2026-03-09' }, '2026-03-10')).toBe('istekla');
  expect(efektivniStatus({ status: 'poslana', vaziDo: '2026-03-09' }, '2026-03-10')).toBe('istekla');
});

test('ponuda unutar roka zadržava svoj status — uključujući zadnji dan roka', () => {
  expect(efektivniStatus({ status: 'poslana', vaziDo: '2026-03-09' }, '2026-03-09')).toBe('poslana');
  expect(efektivniStatus({ status: 'draft', vaziDo: '2026-03-09' }, '2026-03-01')).toBe('draft');
});

test('prihvacena, odbijena i konvertovana ne ističu', () => {
  expect(efektivniStatus({ status: 'prihvacena', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('prihvacena');
  expect(efektivniStatus({ status: 'odbijena', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('odbijena');
  expect(efektivniStatus({ status: 'konvertovana', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('konvertovana');
});

// ─── konvertujPonudu ────────────────────────────────────────

test('konverzija se odbija PRIJE štampe kad korisnika nema u bazi (upis računa bi pao na stranom ključu)', async () => {
  const kupacId = Number(db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac d.o.o.', '4200000000001')").run().lastInsertRowid);
  const productId = Number(db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('001', 'Artikal', 10, 'E')").run().lastInsertRowid);
  const { id } = createPonuda(db, {
    kupacId, korisnikId: 1, datum: '2026-03-01',
    stavke: [{ productId, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }],
  });
  const stampa: unknown[] = [];
  const deps = {
    db, transaction: (fn: () => any) => db.transaction(fn),
    uredjaj: uredjajIzFunkcija({ stampatiFiskalniRacun: async (racun: unknown) => { stampa.push(racun); return { success: true, odgovori: {} } as any; } }),
  };

  for (const korisnikId of [0, 9999]) {
    await expect(konvertujPonudu(deps, { id, korisnikId, nacinPlacanja: 'Gotovina' })).rejects.toThrow('Korisnik nije prijavljen');
  }
  expect(stampa).toEqual([]);
  expect(db.prepare('SELECT COUNT(*) AS c FROM orders').get()).toEqual({ c: 0 });
});

// ── Računanje roka važenja ──────────────────────────────────

test('danaIzmedju broji pune dane i preskače prelazak na ljetno vrijeme', () => {
  expect(danaIzmedju('2026-03-01', '2026-03-09')).toBe(8);
  // 29.03.2026. je prelazak na ljetno vrijeme — dan traje 23h.
  expect(danaIzmedju('2026-03-28', '2026-03-30')).toBe(2);
  // 25.10.2026. je povratak na zimsko — dan traje 25h.
  expect(danaIzmedju('2026-10-24', '2026-10-26')).toBe(2);
});

test('danaIzmedju vraća 0 za isti dan i negativan broj za obrnut redoslijed', () => {
  expect(danaIzmedju('2026-03-01', '2026-03-01')).toBe(0);
  expect(danaIzmedju('2026-03-09', '2026-03-01')).toBe(-8);
});

test('plusDana i danaIzmedju su inverzni, i preko prelaska na ljetno vrijeme', () => {
  expect(plusDana('2026-03-01', DEFAULT_ROK_DANA)).toBe('2026-03-09');
  expect(plusDana('2026-03-28', 2)).toBe('2026-03-30');
  expect(danaIzmedju('2026-03-28', plusDana('2026-03-28', 15))).toBe(15);
});
