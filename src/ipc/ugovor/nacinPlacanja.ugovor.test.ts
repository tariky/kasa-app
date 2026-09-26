// Ugovor: način plaćanja računa nikad nije nepoznat (odluka vlasnika 4).
// Svaki put koji upisuje `orders.nacinPlacanja` prima samo naziv s liste
// (Gotovina, Kartica, Virman, Ček) i odbija sve drugo PRIJE štampe i upisa.
// Stari zapisi iz baze normalizuju se pri otvaranju (migrations.test.ts,
// uredjaj.ugovor.test.ts → cash:drawerState) — vidi backend.ts.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { izracunajTotale } from '../../lib/racun';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // seedovani admin; harness mu postavi ADMIN_PIN i prijavi se

function broj(sql: string): number {
  return (b.db.prepare(sql).get() as { n: number }).n;
}

function dodajProizvod(sifra: string, tip: 'artikal' | 'materijal' | 'usluga', stanje = 0): number {
  const id = Number(b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', 5, 'E', 1, ?)"
  ).run(sifra, `Proizvod ${sifra}`, tip).lastInsertRowid);
  if (stanje) {
    b.db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'test', 0)")
      .run(id, stanje);
  }
  return id;
}

const DATUM = '2026-09-20 11:30:00';

let sifraSnapshota = 0;
/** Artikal za stavku snapshota (na stanju 10). */
function dodajProduktZaSnapshot(): number {
  return dodajProizvod(`S${++sifraSnapshota}`, 'artikal', 10);
}

function dodajPending(snapshot: object): number {
  return Number(b.db.prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(ADMIN, JSON.stringify(snapshot)).lastInsertRowid);
}

function dodajKupca(): number {
  return Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac d.o.o.', '4200000000009')").run().lastInsertRowid);
}

let brojPonude = 0;
/** Prihvaćena ponuda s jednom stavkom (5 KM), spremna za račun. */
function prihvacenaPonuda(kupacId: number, productId: number): number {
  const id = Number(b.db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (?, 2026, ?, ?, '2026-03-01', '2026-03-31', 'prihvacena', 5, 0.73)
  `).run(++brojPonude, kupacId, ADMIN).lastInsertRowid);
  b.db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, 0, 'E')")
    .run(id, productId);
  return id;
}

/** Završen radni nalog (po narudžbi ili iz ponude), spreman za račun. */
async function zavrsenNalog(kupacId: number, ponudaId: number | null): Promise<number> {
  const { id } = ponudaId === null
    ? await b.call('nalog:create', { vrsta: 'narudzba', korisnikId: ADMIN, kupacId, opis: 'Po mjeri', dogovorenaCijena: 100 })
    : await b.call('nalog:createIzPonude', ponudaId, ADMIN);
  await b.call('nalog:replaceStavke', id, [{ materijalId: dodajProizvod(`M${id}`, 'materijal', 10), kolicina: 1 }]);
  await b.call('nalog:setStatus', { id, status: 'zavrsen', korisnikId: ADMIN });
  return id;
}

test('stari oblik načina plaćanja (mala slova, cek, JSON) ne prolazi nijednim putem upisa računa', async () => {
  const kupacId = dodajKupca();
  const artikal = dodajProizvod('A1', 'artikal', 10);
  const kasaStavka = { productId: artikal, sifra: 'A1', naziv: 'Proizvod A1', jm: 'kom', plu: 1, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' };
  const racun = { korisnikId: ADMIN, ...izracunajTotale([kasaStavka]), stavke: [kasaStavka] };
  const ponudaId = prihvacenaPonuda(kupacId, artikal);
  const narudzba = await zavrsenNalog(kupacId, null);
  const nalogIzPonude = await zavrsenNalog(kupacId, prihvacenaPonuda(kupacId, artikal));
  await b.call('fiscal:setZadnjiBroj', 100);
  b.tring.zahtjevi.length = 0;

  const putevi: Array<[string, (nacin: string) => Promise<unknown>]> = [
    ['order:finalize', nacin => b.call('order:finalize', { ...racun, nacinPlacanja: nacin })],
    ['order:finalize (razbijeno)', nacin => b.call('order:finalize', {
      ...racun, nacinPlacanja: 'Kartica', vrstePlacanja: [{ oznaka: nacin, iznos: 3 }, { oznaka: 'Kartica', iznos: 2 }],
    })],
    ['order:createManual', nacin => b.call('order:createManual', {
      ...racun, nacinPlacanja: nacin, brojFiskalnogRacuna: '1', createdAt: '2026-03-03 10:00:00',
    })],
    ['order:finalizePrilog', nacin => b.call('order:finalizePrilog', { iznos: 10, nacinPlacanja: nacin })],
    ['ponuda:konvertuj', nacin => b.call('ponuda:konvertuj', { id: ponudaId, korisnikId: ADMIN, nacinPlacanja: nacin })],
    ['nalog:izdajRacun (narudžba)', nacin => b.call('nalog:izdajRacun', { id: narudzba, korisnikId: ADMIN, nacinPlacanja: nacin })],
    ['nalog:izdajRacun (iz ponude)', nacin => b.call('nalog:izdajRacun', { id: nalogIzPonude, korisnikId: ADMIN, nacinPlacanja: nacin })],
  ];
  for (const [put, pozovi] of putevi) {
    for (const nacin of ['gotovina', 'cek', 'KARTICA', '{"gotovina":5}']) {
      await expect(pozovi(nacin), `${put}: ${nacin}`).rejects.toThrow(`Nepoznat način plaćanja: "${nacin}"`);
    }
  }

  expect(b.tring.zahtjevi).toEqual([]);
  expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
  expect(broj('SELECT COUNT(*) AS n FROM pending_receipts')).toBe(0);
  expect(broj("SELECT COUNT(*) AS n FROM ponude WHERE status <> 'prihvacena' OR racunId IS NOT NULL")).toBe(0);
  expect(broj("SELECT COUNT(*) AS n FROM radni_nalozi WHERE status <> 'zavrsen'")).toBe(0);
});

// Ruling 8: i naknadni upis iz nezavršenih (pending:resolve) provjerava način
// plaćanja iz snapshota PRIJE ikakvog upisa — stari red ili uvezen backup
// može nositi oblik koji ladica ne zna. Dozvoljen je kanonski tekst s liste
// ili JSON raspodjela koju čita `raspodjelaPlacanja`; storno ga nema.
test('pending:resolve odbija nepoznat način plaćanja iz snapshota, ništa ne upisuje, red ostaje', async () => {
  const artikal = dodajProduktZaSnapshot();
  const ponudaId = prihvacenaPonuda(dodajKupca(), artikal);
  const nalogId = await zavrsenNalog(dodajKupca(), null);
  const snapshoti: Array<[string, (nacin: string | null | undefined) => object]> = [
    ['kasa', nacin => ({
      korisnikId: ADMIN, ukupno: 5, pdvIznos: 0.73, nacinPlacanja: nacin,
      stavke: [{ productId: artikal, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
    })],
    ['faktura', nacin => ({
      korisnikId: ADMIN, ukupno: 5, pdvIznos: 0.73, nacinPlacanja: nacin, stavke: [],
      prilogBroj: 5, prilogNaziv: 'Stavke po fakturi br. 5', prilogStavke: [], datumValute: null, napomena: null, ponudaId: null,
    })],
    ['ponuda', nacin => ({
      vrsta: 'ponuda', ponudaId, ponudaBroj: 1, ponudaGodina: 2026, korisnikId: ADMIN, ukupno: 5, pdvIznos: 0.73,
      nacinPlacanja: nacin, kupac: null,
      stavke: [{ productId: artikal, naziv: 'Proizvod A1', kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E', productTip: 'artikal' }],
    })],
    ['nalog', nacin => ({
      vrsta: 'nalog', nalogId, nalogBroj: 1, nalogGodina: 2026, korisnikId: ADMIN, ukupno: 100, pdvIznos: 14.53,
      nacinPlacanja: nacin, kupac: null,
      stavke: [{ productId: 0, naziv: 'Namještaj po mjeri', kolicina: 1, cijena: 100, rabat: 0, pdvStopa: 'E', productTip: 'usluga' }],
    })],
  ];

  // null i nedostajući ključ (undefined JSON izostavi) daju praznu vrijednost u poruci (Ruling 15).
  for (const [vrsta, snapshot] of snapshoti) {
    for (const nacin of ['gotovina', ' Gotovina ', 'Bitcoin', '{"zlato":5}', '{"gotovina":"5"}', '', null, undefined]) {
      const id = dodajPending(snapshot(nacin));
      const { snapshot: upisan } = b.db.prepare('SELECT snapshot FROM pending_receipts WHERE id = ?').get(id) as { snapshot: string };
      expect('nacinPlacanja' in JSON.parse(upisan)).toBe(nacin !== undefined);
      await expect(b.call('pending:resolve', { id, brojFiskalnogRacuna: '700', createdAt: DATUM }), `${vrsta}: ${nacin}`)
        .rejects.toThrow(`Nepoznat način plaćanja: "${nacin ?? ''}"`);
      expect(broj(`SELECT COUNT(*) AS n FROM pending_receipts WHERE id = ${id}`), `${vrsta}: ${nacin}`).toBe(1);
    }
  }

  expect(broj('SELECT COUNT(*) AS n FROM orders')).toBe(0);
  expect(broj("SELECT COUNT(*) AS n FROM audit_log WHERE akcija = 'pending:rijesi'")).toBe(0);
  expect(broj("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'")).toBe(0);
  expect(broj(`SELECT COUNT(*) AS n FROM ponude WHERE id = ${ponudaId} AND status = 'prihvacena' AND racunId IS NULL`)).toBe(1);
  expect(broj(`SELECT COUNT(*) AS n FROM radni_nalozi WHERE id = ${nalogId} AND status = 'zavrsen'`)).toBe(1);
});

test('pending:resolve prima kanonski tekst i JSON raspodjelu koju ladica čita', async () => {
  const artikal = dodajProduktZaSnapshot();
  let brojRacuna = 700;
  for (const nacin of ['Ček', 'Virman', '{"gotovina":3,"kartica":2}', '{"Gotovina":5}']) {
    const id = dodajPending({
      korisnikId: ADMIN, ukupno: 5, pdvIznos: 0.73, nacinPlacanja: nacin,
      stavke: [{ productId: artikal, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
    });
    const r = await b.call('pending:resolve', { id, brojFiskalnogRacuna: String(++brojRacuna), createdAt: DATUM });
    expect((b.db.prepare('SELECT nacinPlacanja FROM orders WHERE id = ?').get(r.id) as { nacinPlacanja: string }).nacinPlacanja, nacin)
      .toBe(nacin);
  }
  expect(broj('SELECT COUNT(*) AS n FROM pending_receipts')).toBe(0);
});
