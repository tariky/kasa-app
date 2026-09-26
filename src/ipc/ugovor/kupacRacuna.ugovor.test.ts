// Ugovor: prazan kupac se upisuje kao NULL (odluka vlasnika 3) — vidi backend.ts.
//
// Na svakom putu upisa računa (order:finalize, order:createManual,
// order:finalizePrilog, ponuda:konvertuj, nalog:izdajRacun i pending:resolve za
// svaku vrstu snapshota) kupac kolona u `orders` dobija NULL kad je vrijednost
// null/undefined ili tekst koji je prazan nakon trim(). Neprazna vrijednost se
// upisuje kakva jeste — bez trim-a i druge normalizacije.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { pokreniPokvareniTring } from './laziTring';
import { scenarij, ADMIN, uspjeh, upisan, postoji } from './scenarij';
import { izracunajTotale } from '../../lib/racun';

let b: Backend;
const baza = scenarij(() => b);
let zaustavi: (() => void) | null = null;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { zaustavi?.(); zaustavi = null; await b.close(); });

const DATUM = '2026-09-20 11:30:00';

type Kupac = { naziv: string; idBroj: string; adresa: string; grad: string; postanskiBroj: string };

/** Sva polja prazna ('' ili samo razmaci) i jedan kupac s nepraznim nazivom (bez trim-a). */
const KUPCI: Array<{ opis: string; kupac: Kupac; ocekivano: Record<string, string | null> }> = [
  {
    opis: 'prazni tekstovi',
    kupac: { naziv: '', idBroj: '', adresa: '', grad: '', postanskiBroj: '' },
    ocekivano: { kupacNaziv: null, kupacIdBroj: null, kupacAdresa: null, kupacGrad: null, kupacPostanskiBroj: null },
  },
  {
    opis: 'samo razmaci',
    kupac: { naziv: ' ', idBroj: '   ', adresa: '\t', grad: ' \n ', postanskiBroj: '  ' },
    ocekivano: { kupacNaziv: null, kupacIdBroj: null, kupacAdresa: null, kupacGrad: null, kupacPostanskiBroj: null },
  },
  {
    opis: 'naziv s razmacima ostaje kakav jeste',
    kupac: { naziv: ' Firma d.o.o. ', idBroj: '4200000000001', adresa: '', grad: ' ', postanskiBroj: '71000' },
    ocekivano: { kupacNaziv: ' Firma d.o.o. ', kupacIdBroj: '4200000000001', kupacAdresa: null, kupacGrad: null, kupacPostanskiBroj: '71000' },
  },
];

function kupacRacuna(orderId: number): Record<string, string | null> {
  return baza.red('SELECT kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj FROM orders WHERE id = ?', orderId);
}

let sifra = 0;
/** „Proizvod K<n>" od 5 KM s ulazom na zalihu. */
function dodajProizvod(tip: 'artikal' | 'materijal', stanje = 10): number {
  const s = `K${++sifra}`;
  const id = baza.artikal({ sifra: s, naziv: `Proizvod ${s}`, cijena: 5, tip });
  baza.kretanje({ productId: id, tip: 'ulaz', kolicina: stanje });
  return id;
}

/** Kupac upisan direktno u šifarnik (stari zapis ili uvezen backup s praznim poljima). */
function dodajKupca(k: Kupac): number {
  return baza.kupac({ naziv: k.naziv, idBroj: k.idBroj, adresa: k.adresa, grad: k.grad, postanskiBroj: k.postanskiBroj });
}

function kasaRacun<E extends Record<string, unknown>>(kupac: Kupac, extra: E = {} as E) {
  const stavka = baza.kasaStavka(dodajProizvod('artikal'), 1, 5);
  return { ...izracunajTotale([stavka]), nacinPlacanja: 'Gotovina', stavke: [stavka], kupac, ...extra };
}

let brojPonude = 0;
/** Prihvaćena ponuda kupca s jednom stavkom (5 KM). */
function prihvacenaPonuda(kupacId: number): number {
  const id = baza.upisi('ponude', {
    broj: ++brojPonude, godina: 2026, kupacId, korisnikId: ADMIN, datum: '2026-03-01', vaziDo: '2026-03-31',
    status: 'prihvacena', ukupno: 5, pdvIznos: 0.73,
  });
  baza.upisi('ponuda_stavke', { ponudaId: id, productId: dodajProizvod('artikal'), kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' });
  return id;
}

/** Završen samostalni nalog po narudžbi za kupca. */
async function zavrsenNalog(kupacId: number): Promise<number> {
  const { id } = await b.pozovi('nalog:create', { vrsta: 'narudzba', kupacId, opis: 'Po mjeri', dogovorenaCijena: 100 });
  await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod('materijal'), kolicina: 1 }]);
  await b.call('nalog:setStatus', { id, status: 'zavrsen' });
  return id;
}

/** Uređaj koji primi zahtjev pa prekine vezu — red ostaje u nezavršenim. */
async function uredjajBezPotvrde(): Promise<void> {
  const u = await pokreniPokvareniTring('prekid');
  zaustavi = u.stop;
  baza.postavka('tring.host', '127.0.0.1');
  baza.postavka('tring.port', String(u.port));
}

let fiskalniBroj = 500;
/** Nezavršeni red (jedini u tabeli) riješen kao odštampan; vraća id računa. */
async function rijesi(): Promise<number> {
  const [row] = await b.pozovi('pending:list');
  const r = await b.pozovi('pending:resolve', { id: row.id, brojFiskalnogRacuna: String(++fiskalniBroj), createdAt: DATUM });
  return r.id;
}

describe('prazan kupac → NULL na svakom putu upisa računa', () => {
  test('order:finalize', async () => {
    for (const { opis, kupac, ocekivano } of KUPCI) {
      const r = await b.pozovi('order:finalize', kasaRacun(kupac));
      expect(r.success, opis).toBe(true);
      expect(kupacRacuna(uspjeh(r).id), opis).toEqual(ocekivano);
    }
  });

  test('order:createManual', async () => {
    for (const { opis, kupac, ocekivano } of KUPCI) {
      const r = await b.pozovi('order:createManual', kasaRacun(kupac, { brojFiskalnogRacuna: String(++fiskalniBroj), createdAt: DATUM }));
      expect(kupacRacuna(r.id), opis).toEqual(ocekivano);
    }
  });

  test('order:finalizePrilog', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    for (const { opis, kupac, ocekivano } of KUPCI) {
      const r = await b.pozovi('order:finalizePrilog', { iznos: 10, nacinPlacanja: 'Virman', kupac });
      expect(r, opis).toMatchObject({ success: true });
      expect(kupacRacuna(upisan(r).id), opis).toEqual(ocekivano);
    }
  });

  test('ponuda:konvertuj', async () => {
    for (const { opis, kupac, ocekivano } of KUPCI) {
      const r = await b.pozovi('ponuda:konvertuj', { id: prihvacenaPonuda(dodajKupca(kupac)), nacinPlacanja: 'Gotovina' });
      expect(r.success, opis).toBe(true);
      expect(kupacRacuna(postoji(r.racunId)), opis).toEqual(ocekivano);
    }
  });

  test('nalog:izdajRacun (samostalni nalog i nalog iz ponude)', async () => {
    for (const { opis, kupac, ocekivano } of KUPCI) {
      const kupacId = dodajKupca(kupac);
      const samostalni = await b.pozovi('nalog:izdajRacun', { id: await zavrsenNalog(kupacId), nacinPlacanja: 'Virman' });
      expect(samostalni.success, opis).toBe(true);
      expect(kupacRacuna(postoji(samostalni.racunId)), `${opis} (samostalni)`).toEqual(ocekivano);

      const { id } = await b.pozovi('nalog:createIzPonude', prihvacenaPonuda(kupacId));
      await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod('materijal'), kolicina: 1 }]);
      await b.call('nalog:setStatus', { id, status: 'zavrsen' });
      const izPonude = await b.pozovi('nalog:izdajRacun', { id, nacinPlacanja: 'Virman' });
      expect(izPonude.success, opis).toBe(true);
      expect(kupacRacuna(postoji(izPonude.racunId)), `${opis} (iz ponude)`).toEqual(ocekivano);
    }
  });

  test('pending:resolve — snapshot računa sa kase, fakture (prilog), ponude i naloga', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    await uredjajBezPotvrde();
    const putevi: Array<[string, (k: Kupac) => Promise<unknown>]> = [
      ['kasa', k => b.pozovi('order:finalize', kasaRacun(k))],
      ['faktura', k => b.pozovi('order:finalizePrilog', { iznos: 10, nacinPlacanja: 'Virman', kupac: k })],
      ['ponuda', k => b.pozovi('ponuda:konvertuj', { id: prihvacenaPonuda(dodajKupca(k)), nacinPlacanja: 'Gotovina' })],
      ['nalog', async k => b.pozovi('nalog:izdajRacun', { id: await zavrsenNalog(dodajKupca(k)), nacinPlacanja: 'Virman' })],
    ];
    for (const [put, stampaj] of putevi) {
      for (const { opis, kupac, ocekivano } of KUPCI) {
        const r = await stampaj(kupac) as { ishodNepoznat?: boolean };
        expect(r.ishodNepoznat, `${put}: ${opis}`).toBe(true);
        expect(kupacRacuna(await rijesi()), `${put}: ${opis}`).toEqual(ocekivano);
      }
    }
    expect(baza.broj('SELECT COUNT(*) AS n FROM pending_receipts')).toBe(0);
  });
});
