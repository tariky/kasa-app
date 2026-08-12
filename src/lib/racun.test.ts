import { test, expect } from 'bun:test';
import { izracunajTotale, iznosStavke, pdvStavke } from './racun';

test('sabira ukupno preko stavki sa rabatom', () => {
  const { ukupno } = izracunajTotale([
    { cijena: 100, kolicina: 2, rabat: 0, pdvStopa: 'E' },
    { cijena: 50, kolicina: 1, rabat: 10, pdvStopa: 'K' },
  ]);
  expect(ukupno).toBeCloseTo(245, 2);
});

test('PDV samo za E stavke (17% uračunat u cijenu)', () => {
  const { pdvIznos } = izracunajTotale([
    { cijena: 117, kolicina: 1, rabat: 0, pdvStopa: 'E' },
    { cijena: 100, kolicina: 1, rabat: 0, pdvStopa: 'K' },
  ]);
  expect(pdvIznos).toBeCloseTo(17, 2);
});

test('prazna lista daje nule', () => {
  expect(izracunajTotale([])).toEqual({ ukupno: 0, pdvIznos: 0 });
});

test('ukupno je zaokruženo na fene, bez float repa', () => {
  // Bez zaokruživanja ovo daje 5.549999999999999 i takvo ide u <Iznos> i u bazu.
  const { ukupno } = izracunajTotale([
    { cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
    { cijena: 0.70, kolicina: 3, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(ukupno).toBe(5.55);
});

test('pdvIznos je zaokružen na fene', () => {
  const { pdvIznos } = izracunajTotale([
    { cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(pdvIznos).toBe(0.5);
});

test('iznosStavke zaokružuje po stavci kao fiskalni uređaj', () => {
  expect(iznosStavke({ cijena: 3.33, kolicina: 3, rabat: 10, pdvStopa: 'E' })).toBe(8.99);
});

test('pdvStavke izlučuje PDV iz iznosa sa uračunatim PDV-om', () => {
  expect(pdvStavke({ cijena: 117, kolicina: 1, rabat: 0, pdvStopa: 'E' })).toBeCloseTo(17, 2);
});

test('pdvStavke računa PDV na iznos umanjen za rabat', () => {
  // 117 × 2 = 234, −10% = 210.60 → PDV 30.60
  expect(pdvStavke({ cijena: 117, kolicina: 2, rabat: 10, pdvStopa: 'E' })).toBeCloseTo(30.6, 2);
});

test('pdvStavke daje 0 za oslobođenu stopu K', () => {
  expect(pdvStavke({ cijena: 100, kolicina: 3, rabat: 0, pdvStopa: 'K' })).toBe(0);
});

test('pdvIznos je zbir pdvStavke po stavkama, zaokružen jednom', () => {
  const stavke = [
    { cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
    { cijena: 0.70, kolicina: 3, rabat: 5, pdvStopa: 'E' },
    { cijena: 9.99, kolicina: 1, rabat: 0, pdvStopa: 'K' },
  ];
  const zbir = stavke.reduce((sum, s) => sum + pdvStavke(s), 0);
  expect(izracunajTotale(stavke).pdvIznos).toBe(Number(zbir.toFixed(2)));
});

test('kolone fakture se slažu sa zbirom na dnu', () => {
  const stavke = [
    { cijena: 16, kolicina: 5, rabat: 5, pdvStopa: 'E' },
    { cijena: 20, kolicina: 2, rabat: 0, pdvStopa: 'E' },
    { cijena: 15, kolicina: 1, rabat: 0, pdvStopa: 'E' },
  ];
  const { ukupno, pdvIznos } = izracunajTotale(stavke);
  const zbirIznosa = stavke.reduce((sum, s) => sum + iznosStavke(s), 0);
  expect(zbirIznosa).toBe(ukupno);
  expect(ukupno).toBe(131);
  expect(pdvIznos).toBe(19.03);
});

test('decimalna količina se ne siječe', () => {
  const { ukupno } = izracunajTotale([
    { cijena: 4, kolicina: 2.5, rabat: 0, pdvStopa: 'E' },
  ]);
  expect(ukupno).toBe(10);
});
