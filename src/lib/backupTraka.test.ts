import { test, expect } from 'bun:test';
import { prikazIzDogadjaja, prikazIzInfo, vrijemeHHMM } from './backupTraka';

test('faze: ukupni procenat na liniji i u piluli', () => {
  expect(prikazIzDogadjaja({ faza: 'kopija', procenat: 0 })).toEqual({ sirina: 0, ton: 'rad', tekst: 'Backup… 0%', uPostavke: false });
  expect(prikazIzDogadjaja({ faza: 'slanje', procenat: 31 })).toEqual({ sirina: 45, ton: 'rad', tekst: 'Backup… 45%', uPostavke: false });
});

test('gotovo: puna zelena linija, vrijeme, nestaje za 3 s', () => {
  const d = new Date(2026, 8, 25, 15, 0, 7);
  expect(prikazIzDogadjaja({ gotovo: d.toISOString() })).toEqual({
    sirina: 100, ton: 'uspjeh', tekst: `Backup spremljen · ${vrijemeHHMM(d.toISOString())}`, uPostavke: false, nestajeZaMs: 3000,
  });
  expect(vrijemeHHMM(d.toISOString())).toBe('15:00');
});

test('greška: žuto, ponovo za 15 min, nestaje za 5 s', () => {
  expect(prikazIzDogadjaja({ greska: 'offline', trajnaGreska: false })).toEqual({
    sirina: 100, ton: 'greska', tekst: 'Backup nije uspio — pokušavam ponovo za 15 min', uPostavke: false, nestajeZaMs: 5000,
  });
});

test('trajna greška: pilula ostaje i vodi u Postavke, bez linije', () => {
  expect(prikazIzDogadjaja({ greska: 'offline', trajnaGreska: true })).toEqual({
    sirina: 0, ton: 'greska', tekst: 'Nema backup-a duže od 24 h', uPostavke: true,
  });
});

test('pri pokretanju: prikazuje samo backup u toku ili trajnu grešku', () => {
  const sada = new Date('2026-09-25T12:00:00Z');
  expect(prikazIzInfo({ aktivan: false, uToku: false }, sada)).toBeNull();
  expect(prikazIzInfo({ aktivan: true, uToku: false, zadnjiUspjeh: '2026-09-25T11:00:00Z' }, sada)).toBeNull();
  expect(prikazIzInfo({ aktivan: true, uToku: true }, sada)).toMatchObject({ ton: 'rad', tekst: 'Backup… 0%' });
  expect(prikazIzInfo({ aktivan: true, uToku: false, greska: 'x', greskaOd: '2026-09-24T10:00:00Z' }, sada))
    .toMatchObject({ ton: 'greska', uPostavke: true });
  expect(prikazIzInfo({ aktivan: true, uToku: false, greska: 'x', greskaOd: '2026-09-25T10:00:00Z' }, sada)).toBeNull();
});
