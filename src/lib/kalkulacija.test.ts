import { test, expect } from 'bun:test';
import { nabavnaVrijednost, rasporediZavisne, kalkulacijaStavke, kalkulacijaPrimke } from './kalkulacija';

const st = (p: Partial<Parameters<typeof kalkulacijaStavke>[0]>) => ({
  kolicina: 1, nabavnaCijena: 0, rabat: 0, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E', ...p,
});

test('nabavna vrijednost = fakturna − rabat + zavisni', () => {
  expect(nabavnaVrijednost(st({ kolicina: 10, nabavnaCijena: 10 }))).toBe(100);
  expect(nabavnaVrijednost(st({ kolicina: 10, nabavnaCijena: 10, rabat: 20 }))).toBe(80);
  expect(nabavnaVrijednost(st({ kolicina: 10, nabavnaCijena: 10, rabat: 20, zavisniTroskovi: 5 }))).toBe(85);
  expect(nabavnaVrijednost(st({ kolicina: 10, nabavnaCijena: 10, rabat: undefined as any, zavisniTroskovi: undefined as any }))).toBe(100);
});

test('zavisni se raspoređuju srazmjerno vrijednosti, zbir je tačno ukupno', () => {
  expect(rasporediZavisne([100, 300], 40)).toEqual([10, 30]);
  // 100 / 3 se ne dijeli ravno — ostatak ide na zadnju stavku s vrijednošću
  const r = rasporediZavisne([1, 1, 1], 100);
  expect(r.reduce((a, b) => a + b, 0)).toBe(100);
  expect(r).toEqual([33.33, 33.33, 33.34]);
  // stavka bez vrijednosti ne nosi zavisne
  expect(rasporediZavisne([50, 0, 50], 10)).toEqual([5, 0, 5]);
  expect(rasporediZavisne([50, 0, 0], 10)).toEqual([10, 0, 0]);
});

test('bez zavisnih ili bez vrijednosti raspored je nule', () => {
  expect(rasporediZavisne([100, 200], 0)).toEqual([0, 0]);
  expect(rasporediZavisne([0, 0], 30)).toEqual([0, 0]);
  expect(rasporediZavisne([], 30)).toEqual([]);
});

test('kalkulacija stavke: nabavna po jedinici uključuje rabat i zavisne, RUC prema prodajnoj bez PDV', () => {
  const k = kalkulacijaStavke(st({ kolicina: 10, nabavnaCijena: 10, rabat: 10, zavisniTroskovi: 10, cijena: 23.4, pdvStopa: 'E' }));
  expect(k.fakturnaVrijednost).toBe(100);
  expect(k.rabatIznos).toBe(10);
  expect(k.nabavnaVrijednost).toBe(100);
  expect(k.nabavnaPoJed).toBe(10);
  expect(k.prodajnaBezPdv).toBeCloseTo(20, 5);
  expect(k.prodajnaVrijednostBezPdv).toBeCloseTo(200, 5);
  expect(k.rucIznos).toBeCloseTo(100, 5);
  expect(k.rucStopa).toBeCloseTo(100, 5);
  expect(k.pdvIznos).toBeCloseTo(34, 5);
  expect(k.mpVrijednost).toBeCloseTo(234, 5);
});

test('materijal (bez prodajne) ima nabavnu, ali ne ulazi u RUC ni PDV', () => {
  const k = kalkulacijaStavke(st({ kolicina: 4, nabavnaCijena: 25, rabat: 0, zavisniTroskovi: 8, cijena: 0 }));
  expect(k.nabavnaVrijednost).toBe(108);
  expect(k.nabavnaPoJed).toBe(27);
  expect(k.prodajnaVrijednostBezPdv).toBe(0);
  expect(k.rucIznos).toBe(0);
  expect(k.pdvIznos).toBe(0);
});

test('kalkulacija primke: sume dokumenta; RUC i marža samo nad artiklima', () => {
  const k = kalkulacijaPrimke([
    st({ kolicina: 10, nabavnaCijena: 10, rabat: 10, zavisniTroskovi: 10, cijena: 23.4, pdvStopa: 'E' }), // artikal, nab 100
    st({ kolicina: 4, nabavnaCijena: 25, zavisniTroskovi: 8, cijena: 0 }),                                 // materijal, nab 108
  ]);
  expect(k.fakturna).toBe(200);
  expect(k.rabat).toBe(10);
  expect(k.zavisni).toBe(18);
  expect(k.nabavna).toBe(208);
  expect(k.nabavnaArtikala).toBe(100);
  expect(k.prodajna).toBeCloseTo(234, 5);
  expect(k.pdv).toBeCloseTo(34, 5);
  expect(k.ruc).toBeCloseTo(100, 5);
  expect(k.rucPct).toBeCloseTo(100, 5);
  expect(k.imaArtikala).toBe(true);
});

test('kalkulacija primke bez artikala nema RUC', () => {
  const k = kalkulacijaPrimke([st({ kolicina: 4, nabavnaCijena: 25, cijena: 0 })]);
  expect(k.imaArtikala).toBe(false);
  expect(k.rucPct).toBe(0);
  expect(k.nabavna).toBe(100);
});
