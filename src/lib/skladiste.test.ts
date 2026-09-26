// Rubni slučajevi pomoćnih funkcija skladišta koje ugovor ne može izraziti:
// vrijednosti koje JSON ne prenosi (NaN, Infinity, undefined — Electron IPC ih
// prenosi), datum s vremenom, napomena bez brojeva nivelacija, otisak pregleda
// polje po polje. Primke, nivelacije, historija i protunivelacije su u ugovoru
// oba backenda (ugovor/skladiste.ugovor.test.ts) i u primka.test.ts.
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { napomenaProtunivelacije, datumKretanjaPrimke, istiPregled, validirajPrimku } from './skladiste';
import type { PregledCijenaUlaza } from '../types';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
});

function dodajArtikal(sifra: string, cijena: number): number {
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES (?, ?, ?, 'E')")
    .run(sifra, `Artikal ${sifra}`, cijena);
  return Number(r.lastInsertRowid);
}

test('napomena protunivelacije: brojevi poništenih nivelacija u zagradi, bez njih samo razlog', () => {
  expect(napomenaProtunivelacije('Poništenje primke U-5', ['NIV-2026-003'])).toBe('Poništenje primke U-5 (NIV-2026-003)');
  expect(napomenaProtunivelacije('Poništenje primke U-5', [])).toBe('Poništenje primke U-5');
});

// ── validirajPrimku ───────────────────────────────────────────────────

test('validirajPrimku: količina i cijene stavke moraju biti ispravni brojevi', () => {
  const id = dodajArtikal('038', 10);
  const s = { productId: id, kolicina: 2, cijena: 12, nabavnaCijena: 5 };
  const probaj = (x: Record<string, unknown>) => () => validirajPrimku(db, { brojPrimke: 'U-1', stavke: [{ ...s, ...x }] as any });

  expect(probaj({})()).toBe('U-1');
  expect(probaj({ cijena: 0, nabavnaCijena: 0 })()).toBe('U-1');
  for (const kolicina of [0, -1, NaN, Infinity, '2', null, undefined]) {
    expect(probaj({ kolicina })).toThrow('Količina za "Artikal 038" mora biti veća od nule');
  }
  for (const cijena of [-0.01, NaN, Infinity, '12', null, undefined]) {
    expect(probaj({ cijena })).toThrow('Prodajna cijena za "Artikal 038" nije ispravna');
  }
  for (const nabavnaCijena of [-1, NaN, -Infinity, '5', null, undefined]) {
    expect(probaj({ nabavnaCijena })).toThrow('Nabavna cijena za "Artikal 038" nije ispravna');
  }
});

test('datumKretanjaPrimke: datum primke u formatu kretanja zalihe (ponoć)', () => {
  expect(datumKretanjaPrimke('2026-03-10')).toBe('2026-03-10 00:00:00');
  // Ako datum već nosi vrijeme, ostaje kakav jeste.
  expect(datumKretanjaPrimke('2026-03-10 14:20:00')).toBe('2026-03-10 14:20:00');
});

// ── Otisak potvrđenog pregleda ─────────────────────────────────────────

const pregledPrimjer = () => ({
  dokumenti: [{ vrsta: 'nivelacija' as const, brojNivelacije: 'NIV-2026-001', datum: '2026-05-12', napomena: null, stavke: [
    { productId: 2, productNaziv: 'B', kolicina: 1.5, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 3 },
    { productId: 1, productNaziv: 'A', kolicina: 5, staraCijena: 1, novaCijena: 1.1, razlika: 0.1, ukupnaRazlika: 0.5 },
  ] }],
  bezZalihe: [{ productId: 3, productNaziv: 'C', staraCijena: 20, novaCijena: 25 }],
  cijenaOstaje: [],
  upozorenja: [{ vrsta: 'minus' as const, productId: 1, productNaziv: 'A', stanjePrije: 2, stanjePoslije: -8 }],
});

test('otisak: isti sadržaj s drugim nazivom, redom stavki i šumom zaokruživanja je isti', () => {
  const b = pregledPrimjer();
  b.dokumenti[0].stavke.reverse();
  b.dokumenti[0].stavke[0].productNaziv = 'Drugi naziv';
  b.dokumenti[0].stavke[0].razlika = 0.1 + 1e-12;
  expect(istiPregled(b, pregledPrimjer())).toBe(true);
});

test('otisak: svako polje dokumenta je u poređenju', () => {
  const izmjene: Array<(p: ReturnType<typeof pregledPrimjer>) => void> = [
    p => { (p.dokumenti[0] as any).vrsta = 'protunivelacija'; },
    p => { p.dokumenti[0].brojNivelacije = 'NIV-2026-002'; },
    p => { p.dokumenti[0].datum = '2026-05-13'; },
    p => { (p.dokumenti[0] as any).napomena = 'x'; },
    p => { p.dokumenti[0].stavke[0].kolicina = 2; },
    p => { p.dokumenti[0].stavke[0].staraCijena = 11; },
    p => { p.dokumenti[0].stavke[0].novaCijena = 13; },
    p => { p.dokumenti[0].stavke[0].ukupnaRazlika = 4; },
    p => { p.dokumenti[0].stavke[0].productId = 9; },
    p => { p.dokumenti = []; },
    p => { p.bezZalihe[0].novaCijena = 26; },
    p => { p.bezZalihe = []; },
    p => { (p.cijenaOstaje as any) = [{ productId: 4, productNaziv: 'D', cijena: 1 }]; },
    p => { (p.upozorenja[0] as any).vrsta = 'prodano'; },
    p => { p.upozorenja[0].productId = 2; },
    p => { p.upozorenja[0].stanjePrije = 3; },
    p => { p.upozorenja[0].stanjePoslije = -7; },
    p => { p.upozorenja = []; },
  ];
  for (const izmijeni of izmjene) {
    const p = pregledPrimjer();
    izmijeni(p);
    expect(istiPregled(p, pregledPrimjer())).toBe(false);
  }
});

test('otisak: neispravan oblik nije nikad isti', () => {
  // Neispravan oblik nema otisak, pa nije isti ni sam sebi.
  const nijeIstiSebi = (p: unknown) => istiPregled(p, p as PregledCijenaUlaza);
  expect(nijeIstiSebi(null)).toBe(false);
  expect(nijeIstiSebi({})).toBe(false);
  expect(nijeIstiSebi({ dokumenti: [], bezZalihe: [], cijenaOstaje: [{ productId: 1, cijena: 'x' }], upozorenja: [] })).toBe(false);
  expect(istiPregled({}, pregledPrimjer())).toBe(false);
  expect(istiPregled(pregledPrimjer(), pregledPrimjer())).toBe(true);
  // Pregled bez upozorenja (stari oblik) nije potvrda ničega.
  const bezUpozorenja: Partial<ReturnType<typeof pregledPrimjer>> = pregledPrimjer();
  delete bezUpozorenja.upozorenja;
  expect(nijeIstiSebi(bezUpozorenja)).toBe(false);
});
