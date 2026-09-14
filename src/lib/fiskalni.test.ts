import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  parseFiskalniBroj, izracunajPraznine, MAX_PRAZNINA,
  zadnjiFiskalniBroj, zadnjiUpisaniFiskalniBroj,
  postaviZadnjiFiskalniBroj, predvidjeniFiskalniBroj,
} from './fiskalni';

test('parseFiskalniBroj parsira numeričke brojeve', () => {
  expect(parseFiskalniBroj('1234')).toBe(1234);
  expect(parseFiskalniBroj('  42 ')).toBe(42);
});

test('parseFiskalniBroj ignoriše reklamacije i prazne', () => {
  expect(parseFiskalniBroj('R-5')).toBeNull();
  expect(parseFiskalniBroj(null)).toBeNull();
  expect(parseFiskalniBroj(undefined)).toBeNull();
  expect(parseFiskalniBroj('')).toBeNull();
  expect(parseFiskalniBroj('12a')).toBeNull();
});

test('izracunajPraznine bez rupa daje prazno', () => {
  expect(izracunajPraznine([1, 2, 3, 4])).toEqual([]);
});

test('izracunajPraznine nalazi jednu rupu', () => {
  expect(izracunajPraznine([100, 101, 103])).toEqual([102]);
});

test('izracunajPraznine nalazi više rupa i ignoriše redoslijed/duplikate', () => {
  expect(izracunajPraznine([10, 13, 13, 16])).toEqual([11, 12, 14, 15]);
});

test('izracunajPraznine sa manje od 2 broja daje prazno', () => {
  expect(izracunajPraznine([])).toEqual([]);
  expect(izracunajPraznine([7])).toEqual([]);
});

test('izracunajPraznine ograničava rezultat kod pogrešno ukucanog broja', () => {
  // Tipfeler 1234567 umjesto 1234 bi inače nabrojao preko milion "praznina".
  const start = Date.now();
  const gaps = izracunajPraznine([1, 2, 3, 1234567]);
  expect(gaps.length).toBe(MAX_PRAZNINA);
  expect(gaps[0]).toBe(4);
  expect(Date.now() - start).toBeLessThan(200);
});

test('izracunajPraznine preskače odbačene brojeve bez trošenja limita', () => {
  const gaps = izracunajPraznine([10, 16], 2, new Set([11, 12]));
  expect(gaps).toEqual([13, 14]);
});

// ── Predviđanje sljedećeg fiskalnog broja ──

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajRacun(broj: string | null, createdAt?: string): void {
  db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, brojFiskalnogRacuna, createdAt)
    VALUES (1, 10, 0, 'Gotovina', 'completed', ?, COALESCE(?, datetime('now','localtime')))
  `).run(broj, createdAt ?? null);
}

test('prazna baza bez upisanog broja ne može predvidjeti isječak', () => {
  expect(zadnjiFiskalniBroj(db)).toBeNull();
  expect(predvidjeniFiskalniBroj(db)).toBeNull();
});

test('predviđa sljedeći broj iz posljednjeg računa', () => {
  dodajRacun('7', '2026-09-10 08:00:00');
  dodajRacun('12', '2026-09-10 09:00:00');
  expect(zadnjiFiskalniBroj(db)).toBe(12);
  expect(predvidjeniFiskalniBroj(db)).toBe(13);
});

test('naknadno popunjena praznina ne vraća niz unazad', () => {
  // Stari račun ukucan danas nosi svoj stari datum, pa ne pomjera niz.
  dodajRacun('12', '2026-09-10 09:00:00');
  dodajRacun('4', '2026-09-01 08:00:00');
  expect(zadnjiFiskalniBroj(db)).toBe(12);
  expect(predvidjeniFiskalniBroj(db)).toBe(13);
});

test('resetovan brojač na uređaju se prati, ne pamti se stari maksimum', () => {
  dodajRacun('4200', '2026-08-31 23:00:00');
  dodajRacun('3', '2026-09-01 08:00:00');
  expect(predvidjeniFiskalniBroj(db)).toBe(4);
});

test('reklamacije (R-…) i prazni brojevi se preskaču', () => {
  dodajRacun('5', '2026-09-10 08:00:00');
  dodajRacun('R-3', '2026-09-10 09:00:00');
  dodajRacun(null, '2026-09-10 10:00:00');
  expect(predvidjeniFiskalniBroj(db)).toBe(6);
});

test('ručno upisan broj pokriva praznu bazu', () => {
  postaviZadnjiFiskalniBroj(db, 127);
  expect(zadnjiUpisaniFiskalniBroj(db)).toBe(127);
  expect(predvidjeniFiskalniBroj(db)).toBe(128);
});

test('račun izdat poslije ručnog upisa preuzima niz', () => {
  postaviZadnjiFiskalniBroj(db, 127);
  dodajRacun('300');
  expect(predvidjeniFiskalniBroj(db)).toBe(301);
});

test('ručna ispravka pobjeđuje ono što baza zna', () => {
  // Niz je odlutao (test-računi, zamjena uređaja) — operater ga ispravlja rukom.
  dodajRacun('9', '2026-09-01 08:00:00');
  expect(predvidjeniFiskalniBroj(db)).toBe(10);
  postaviZadnjiFiskalniBroj(db, 4200);
  expect(predvidjeniFiskalniBroj(db)).toBe(4201);
});

test('nula znači da uređaj još nije štampao', () => {
  postaviZadnjiFiskalniBroj(db, 0);
  expect(predvidjeniFiskalniBroj(db)).toBe(1);
});

test('odbija negativan i decimalan posljednji broj', () => {
  expect(() => postaviZadnjiFiskalniBroj(db, -1)).toThrow(/cijeli broj/);
  expect(() => postaviZadnjiFiskalniBroj(db, 1.5)).toThrow(/cijeli broj/);
});
