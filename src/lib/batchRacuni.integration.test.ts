// End-to-end: generator -> real Tring client -> mock Tring fiscal server.
// Verifies every generated receipt actually "prints" and gets a fiscal number,
// and that the printed grand total matches what the generator produced.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import type { Server } from 'node:http';
import { generirajRacune } from './batchRacuni';
import { buildTringRacun } from './tringRacun';
import { izracunajTotale } from './racun';
import * as Tring from '@/services/tring';
import { startMockTringServer } from '@/services/tring-mock-server';
import type { Product } from '@/types';

const PORT = 8099; // avoid clashing with a real/dev mock on 8085

let server: Server;

beforeAll(() => {
  server = startMockTringServer(PORT);
  Tring.configure({ host: 'localhost', port: PORT });
});

afterAll(() => {
  server.close();
});

function proizvod(over: Partial<Product>): Product {
  return {
    id: 1, sifra: '001', naziv: 'Artikal', jm: 'kom', cijena: 10,
    pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', stanje: 100, ...over,
  };
}

// Ista funkcija koju koristi IPC handler — ne kopija, da test hvata i izmjene u njoj.
function buildRacun(r: { stavke: any[]; ukupno: number }): Tring.Racun {
  return buildTringRacun({ ...r, nacinPlacanja: 'Gotovina' });
}

const katalog: Product[] = [
  proizvod({ id: 1, sifra: '001', naziv: 'Hljeb', cijena: 1.5, stanje: 200 }),
  proizvod({ id: 2, sifra: '002', naziv: 'Mlijeko', cijena: 2.3, stanje: 150 }),
  proizvod({ id: 3, sifra: '003', naziv: 'Kafa', cijena: 8.9, stanje: 80, pdvStopa: 'K' }),
  proizvod({ id: 4, sifra: '004', naziv: 'Čokolada', cijena: 3.75, stanje: 120 }),
];

test('svi generisani računi se uspješno štampaju kroz mock fiskalni server', async () => {
  // Mock server delays each print ~2.5s (real printer sim), so keep the batch
  // small enough to finish within the timeout.
  const res = generirajRacune(katalog, { target: 60 });
  expect(res.racuni.length).toBeGreaterThan(0);

  const fiskalniBrojevi: string[] = [];
  let odstampanoUkupno = 0;

  // Sequential print, exactly like GeneratorScreen's "Obradi sve" (minus the 5s wait).
  for (const r of res.racuni) {
    const odgovor = await Tring.stampatiFiskalniRacun(buildRacun(r));
    expect(odgovor.success).toBe(true);
    const broj = odgovor.odgovori?.BrojFiskalnogRacuna;
    expect(broj).toBeTruthy();
    fiskalniBrojevi.push(broj);
    odstampanoUkupno += r.ukupno;
  }

  // Every receipt got a unique fiscal number.
  expect(new Set(fiskalniBrojevi).size).toBe(res.racuni.length);
  // Printed total matches the generated total.
  expect(odstampanoUkupno).toBeCloseTo(res.ukupnoGenerisano, 2);
}, 60000);

test('iznos koji ide uređaju je zaokružen na fene', async () => {
  // 3×1,15 + 3×0,70 u plutajućem zarezu daje 5.549999999999999; takav broj je
  // ranije doslovno išao u <Iznos> i u orders.ukupno.
  const stavke = [
    { sifra: '001', naziv: 'Hljeb', jm: 'kom', cijena: 1.15, kolicina: 3, rabat: 0, pdvStopa: 'E' },
    { sifra: '002', naziv: 'Mlijeko', jm: 'kom', cijena: 0.70, kolicina: 3, rabat: 0, pdvStopa: 'E' },
  ];
  const { ukupno } = izracunajTotale(stavke);
  expect(ukupno).toBe(5.55);

  const racun = buildTringRacun({ stavke, ukupno, nacinPlacanja: 'Gotovina' });
  expect(racun.vrstePlacanja[0].iznos).toBe(5.55);
  // Ono što zaista završi u XML tijelu zahtjeva.
  expect(String(racun.vrstePlacanja[0].iznos)).toBe('5.55');

  const odgovor = await Tring.stampatiFiskalniRacun(racun);
  expect(odgovor.success).toBe(true);
}, 15000);

test('decimalna količina prolazi kroz cijeli lanac do uređaja', async () => {
  // parseInt je ranije sjekao 2,5 kg na 2 kg.
  const stavke = [
    { sifra: '010', naziv: 'Sir', jm: 'kg', cijena: 18, kolicina: 2.5, rabat: 0, pdvStopa: 'E' },
  ];
  const { ukupno } = izracunajTotale(stavke);
  expect(ukupno).toBe(45);

  const racun = buildTringRacun({ stavke, ukupno, nacinPlacanja: 'Gotovina' });
  expect(racun.stavke[0].kolicina).toBe(2.5);

  const odgovor = await Tring.stampatiFiskalniRacun(racun);
  expect(odgovor.success).toBe(true);
}, 15000);
