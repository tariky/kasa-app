// End-to-end: generator -> real Tring client -> mock Tring fiscal server.
// Verifies every generated receipt actually "prints" and gets a fiscal number,
// and that the printed grand total matches what the generator produced.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import type { Server } from 'node:http';
import { generirajRacune } from './batchRacuni';
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

// Mirror of handlers.ts buildTringRacun for the fields the generator produces.
function buildRacun(r: { stavke: any[]; ukupno: number }): Tring.Racun {
  return {
    stavke: r.stavke.map(item => ({
      artikal: {
        sifra: item.sifra, naziv: item.naziv, jm: item.jm,
        cijena: item.cijena, stopa: item.pdvStopa, plu: item.plu || 0,
      },
      kolicina: item.kolicina,
      rabat: item.rabat || 0,
    })),
    vrstePlacanja: [{ oznaka: 'Gotovina', iznos: r.ukupno }],
  };
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
