import { test, expect } from 'bun:test';
import { sljedeciBackup, trajnaGreska, ukupniProcenat } from './backupRaspored';

const start = new Date('2026-09-25T08:00:00Z');
const min = (n: number) => new Date(start.getTime() + n * 60_000);
const iso = (d: Date) => d.toISOString();

test('nikad uspjeha: minut nakon starta', () => {
  expect(sljedeciBackup({}, start, start)).toEqual(min(1));
});

test('nikad uspjeha, aplikacija radi duže: odmah (sada)', () => {
  expect(sljedeciBackup({}, min(90), start)).toEqual(min(90));
});

test('uspjeh stariji od 3 h: minut nakon starta', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-300)) }, start, start)).toEqual(min(1));
});

test('uspjeh prije sat vremena: uspjeh + 3 h', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-60)) }, start, start)).toEqual(min(120));
});

test('zadnji pokušaj pao: pokušaj + 15 min, i kad uspjeha nikad nije bilo', () => {
  const s = { zadnjiPokusaj: iso(min(10)), greska: 'Nema veze s R2', greskaOd: iso(min(10)) };
  expect(sljedeciBackup(s, min(11), start)).toEqual(min(25));
  expect(sljedeciBackup({ ...s, zadnjiUspjeh: iso(min(-600)) }, min(11), start)).toEqual(min(25));
});

test('pad prije pola sata, nakon restarta: minut nakon starta', () => {
  const s = { zadnjiPokusaj: iso(min(-30)), greska: 'x', greskaOd: iso(min(-30)) };
  expect(sljedeciBackup(s, start, start)).toEqual(min(1));
});

test('sat vraćen unazad (uspjeh u budućnosti): ne čeka taj datum', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(60 * 24 * 30)) }, start, start)).toEqual(min(1));
});

test('pokušaj bez greške (aplikacija ugašena usred backup-a) ne znači grešku', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-60)), zadnjiPokusaj: iso(min(-5)) }, start, start)).toEqual(min(120));
});

test('trajna greška: bez uspjeha duže od 24 h', () => {
  const dan = 24 * 60;
  expect(trajnaGreska({}, start)).toBe(false);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan + 1)) }, start)).toBe(false);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan - 1)) }, start)).toBe(true);
  // Uspjeh prije 30 h, greške tek sat vremena (aplikacija bila ugašena): i dalje nema uspjeha 24 h.
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-60)), zadnjiUspjeh: iso(min(-30 * 60)) }, start)).toBe(true);
  expect(trajnaGreska({ zadnjiUspjeh: iso(min(-30 * 60)) }, start)).toBe(false);
});

test('trajna greška: uspjeh "u budućnosti" (vraćen sat) ili nečitljiv → računa se od greskaOd', () => {
  const dan = 24 * 60;
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan - 1)), zadnjiUspjeh: iso(min(60)) }, start)).toBe(true);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan - 1)), zadnjiUspjeh: 'nije datum' }, start)).toBe(true);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-60)), zadnjiUspjeh: iso(min(60)) }, start)).toBe(false);
});

test('ukupni procenat po fazama: kopija 0–10, šifrovanje 10–20, slanje 20–100', () => {
  expect(ukupniProcenat('kopija', 0)).toBe(0);
  expect(ukupniProcenat('kopija', 100)).toBe(10);
  expect(ukupniProcenat('sifrovanje', 50)).toBe(15);
  expect(ukupniProcenat('slanje', 0)).toBe(20);
  expect(ukupniProcenat('slanje', 50)).toBe(60);
  expect(ukupniProcenat('slanje', 100)).toBe(100);
});
