import { test, expect } from 'bun:test';
import { linijaDokumenta } from './dokumentStavke';
import { iznosStavke, izracunajTotale, pdvStavke } from './racun';

test('iznos reda od 2,675 KM je 2,68 — isto kao iznosStavke i UKUPNO', () => {
  const red = { cijena: 5.35, kolicina: 1, rabat: 50, pdvStopa: 'E' };
  expect(linijaDokumenta(red).iznos).toBe(2.68);
  expect(linijaDokumenta(red).iznos).toBe(iznosStavke(red));
  expect(izracunajTotale([red]).ukupno).toBe(2.68);
});

test('iznos reda s rabatom se zaokružuje po redu (22,815 → 22,82)', () => {
  expect(linijaDokumenta({ cijena: 11.7, kolicina: 2, rabat: 2.5, pdvStopa: 'E' }).iznos).toBe(22.82);
});

test('zbir iznosa redova je UKUPNO dokumenta', () => {
  const stavke = [
    { cijena: 11.7, kolicina: 2, rabat: 2.5, pdvStopa: 'E' },
    { cijena: 5.35, kolicina: 1, rabat: 50, pdvStopa: 'E' },
    { cijena: 20, kolicina: 1.5, rabat: 0, pdvStopa: 'K' },
    { cijena: 45.9, kolicina: 3, rabat: 10, pdvStopa: 'E' },
  ];
  const zbir = stavke.reduce((a, s) => a + linijaDokumenta(s).iznos, 0);
  expect(Math.round(zbir * 100) / 100).toBe(izracunajTotale(stavke).ukupno);
});

test('cijena bez PDV-a: stopa E izlučuje 17 %, stopa K ostaje ista', () => {
  expect(linijaDokumenta({ cijena: 11.7, kolicina: 2, pdvStopa: 'E' }).cijenaBezPdv).toBe(10);
  expect(linijaDokumenta({ cijena: 45.9, kolicina: 1, pdvStopa: 'E' }).cijenaBezPdv).toBe(39.23);
  expect(linijaDokumenta({ cijena: 20, kolicina: 1.5, pdvStopa: 'K' }).cijenaBezPdv).toBe(20);
});

test('PDV reda je PDV iz iznosa stavke; stopa K nema PDV', () => {
  const e = { cijena: 45.9, kolicina: 3, rabat: 10, pdvStopa: 'E' };
  expect(linijaDokumenta(e).pdv).toBe(pdvStavke(e));
  expect(linijaDokumenta({ cijena: 20, kolicina: 1.5, rabat: 0, pdvStopa: 'K' }).pdv).toBe(0);
});

test('stavka bez rabata (stari zapisi: undefined ili null) računa se kao rabat 0', () => {
  const bez = linijaDokumenta({ cijena: 11.7, kolicina: 2, pdvStopa: 'E' });
  expect(bez.iznos).toBe(23.4);
  expect(linijaDokumenta({ cijena: 11.7, kolicina: 2, rabat: null, pdvStopa: 'E' })).toEqual(bez);
});
