// Regresija: fiskalni račun je jednom slao omotač <VrstaPlacanja> umjesto
// <VrstePlacanja>. TFS nepoznat element tiho ignoriše, pa je uređaj mjesecima
// svaki račun knjižio kao gotovinski, a niko to nije primijetio iz aplikacije.
// Ovi testovi gledaju XML koji stvarno ode na žicu, ne međuobjekte.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import type { Server } from 'node:http';
import * as Tring from '@/services/tring';
import { pokreniMockTring } from '@/services/tring-mock-server';
import { buildTringRacun, buildTringReklamacija } from '@/lib/tringRacun';

let server: Server;
const log = console.log;

beforeAll(async () => {
  const mock = await pokreniMockTring({ kasnjenjeMs: 0 });
  server = mock.server;
  Tring.configure({ host: 'localhost', port: mock.port });
  // Dnevnik (getLogs) nosi poslani XML; ispis u konzolu koji ga prati se utiša.
  Tring.setLoggingEnabled(true);
  console.log = () => undefined;
});

afterAll(() => {
  console.log = log;
  Tring.setLoggingEnabled(false);
  server.close();
});

const items = [{ productSifra: 'p1', productNaziv: 'p1', productJm: 'kom', cijena: 100, kolicina: 1, pdvStopa: 'E' }];

/** XML zadnjeg poslanog zahtjeva. */
function zadnjiZahtjev(): string {
  return Tring.getLogs().at(-1)!.requestXml;
}

test.each([
  ['Gotovina', 'Gotovina'],
  ['Kartica', 'Kartica'],
  ['Virman', 'Virman'],
  ['Ček', 'Cek'], // enumeracija je bez kvačice (vrstaplacanja.xsd)
])('fiskalni račun (%s) šalje VrstePlacanja s oznakom %s', async (nacinPlacanja, oznaka) => {
  await Tring.stampatiFiskalniRacun(buildTringRacun({ ukupno: 100, nacinPlacanja, items }));
  const xml = zadnjiZahtjev();

  expect(xml).toContain(
    `<VrstePlacanja><VrstaPlacanja><Oznaka>${oznaka}</Oznaka><Iznos>100</Iznos></VrstaPlacanja></VrstePlacanja>`
  );
  // Dvostruki <VrstaPlacanja> je bio baš taj bug.
  expect(xml).not.toContain('<VrstaPlacanja><VrstaPlacanja>');
});

test('reklamacija šalje Gotovina/0 — bez toga TFS vraća grešku 573', async () => {
  await Tring.stampatiReklamiraniRacun(buildTringReklamacija({ items, brojRacuna: 3 }));
  const xml = zadnjiZahtjev();

  expect(xml).toContain(
    '<VrstePlacanja><VrstaPlacanja><Oznaka>Gotovina</Oznaka><Iznos>0</Iznos></VrstaPlacanja></VrstePlacanja>'
  );
  expect(xml).not.toContain('<VrstePlacanja />');
});
