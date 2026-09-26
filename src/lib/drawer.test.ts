import { test, expect } from 'bun:test';
import { gotovinskiIznos, ocekivanoStanje } from './drawer';

// gotovinskiIznos: koliko je gotovine ušlo u kasu po jednom računu

test('plain string Gotovina znači puni iznos računa', () => {
  expect(gotovinskiIznos('Gotovina', 25.5)).toBe(25.5);
});

test('plain string Kartica znači nula gotovine', () => {
  expect(gotovinskiIznos('Kartica', 25.5)).toBe(0);
});

test('JSON s poljem gotovina vraća taj iznos', () => {
  expect(gotovinskiIznos(JSON.stringify({ gotovina: 10, kartica: 15.5 }), 25.5)).toBe(10);
});

test('JSON bez gotovine vraća nulu', () => {
  expect(gotovinskiIznos(JSON.stringify({ kartica: 25.5 }), 25.5)).toBe(0);
});

test('Virman i Ček ne nose gotovinu', () => {
  expect(gotovinskiIznos('Virman', 100)).toBe(0);
  expect(gotovinskiIznos('Ček', 100)).toBe(0);
});

// Stari zapisi (starija verzija, uvezen backup) čitaju se kao na izvozu
// knjigovođi (raspodjelaPlacanja) — jedan parser za ladicu, izvoz i ekran.

test('mala slova i razmaci oko naziva: gotovina je i dalje cijeli iznos', () => {
  expect(gotovinskiIznos('gotovina', 25.5)).toBe(25.5);
  expect(gotovinskiIznos(' Gotovina ', 25.5)).toBe(25.5);
  expect(gotovinskiIznos('GOTOVINA', 25.5)).toBe(25.5);
});

test('JSON ključevi bez obzira na velika slova', () => {
  expect(gotovinskiIznos('{"Gotovina":5,"kartica":3}', 8)).toBe(5);
});

test('cek bez kvačice je ček, ne gotovina', () => {
  expect(gotovinskiIznos('cek', 100)).toBe(0);
});

test('nepoznat oblik ne nosi gotovinu (izvoz ga označava kao nepoznat)', () => {
  expect(gotovinskiIznos('Bitcoin', 100)).toBe(0);
  expect(gotovinskiIznos('{"gotovina":5,"zlato":3}', 8)).toBe(0);
  expect(gotovinskiIznos('{"gotovina":5,"constructor":3}', 8)).toBe(0);
  expect(gotovinskiIznos('constructor', 8)).toBe(0);
});

// ocekivanoStanje(kretanja, prodajeDanas, reklamiraneDanas):
// polozi + gotovinski promet − povrati − gotovinske reklamacije.
// prodajeDanas = računi prodani danas (bez obzira na kasniji storno);
// reklamiraneDanas = računi stornirani danas (mogu biti prodani i ranije).

test('samo polog daje stanje jednako pologu', () => {
  const r = ocekivanoStanje([{ tip: 'polog', iznos: 50 }], [], []);
  expect(r.ocekivanoStanje).toBe(50);
  expect(r.polozi).toBe(50);
});

test('gotovinski račun se dodaje na stanje', () => {
  const r = ocekivanoStanje(
    [{ tip: 'polog', iznos: 50 }],
    [{ nacinPlacanja: 'Gotovina', ukupno: 20 }],
    []
  );
  expect(r.gotovinskiPromet).toBe(20);
  expect(r.ocekivanoStanje).toBe(70);
});

test('kartični račun ne mijenja stanje ladice', () => {
  const r = ocekivanoStanje([], [{ nacinPlacanja: 'Kartica', ukupno: 99 }], []);
  expect(r.gotovinskiPromet).toBe(0);
  expect(r.ocekivanoStanje).toBe(0);
});

test('povrat novca umanjuje stanje', () => {
  const r = ocekivanoStanje(
    [{ tip: 'polog', iznos: 50 }, { tip: 'povrat', iznos: 30 }],
    [],
    []
  );
  expect(r.povrati).toBe(30);
  expect(r.ocekivanoStanje).toBe(20);
});

test('jučerašnji račun storniran danas umanjuje stanje', () => {
  const r = ocekivanoStanje(
    [{ tip: 'polog', iznos: 50 }],
    [],
    [{ nacinPlacanja: 'Gotovina', ukupno: 20 }]
  );
  expect(r.gotovinskeReklamacije).toBe(20);
  expect(r.gotovinskiPromet).toBe(0);
  expect(r.ocekivanoStanje).toBe(30);
});

test('prodan danas i storniran danas se poništavaju', () => {
  const racun = { nacinPlacanja: 'Gotovina', ukupno: 20 };
  const r = ocekivanoStanje([{ tip: 'polog', iznos: 50 }], [racun], [racun]);
  expect(r.gotovinskiPromet).toBe(20);
  expect(r.gotovinskeReklamacije).toBe(20);
  expect(r.ocekivanoStanje).toBe(50);
});

test('stari zapisi ulaze u gotovinski promet i reklamacije', () => {
  const r = ocekivanoStanje(
    [],
    [{ nacinPlacanja: 'gotovina', ukupno: 10 }, { nacinPlacanja: '{"Gotovina":5,"kartica":3}', ukupno: 8 }],
    [{ nacinPlacanja: ' Gotovina ', ukupno: 4 }]
  );
  expect(r.gotovinskiPromet).toBe(15);
  expect(r.gotovinskeReklamacije).toBe(4);
  expect(r.ocekivanoStanje).toBe(11);
});

test('mješovito plaćanje broji samo gotovinski dio', () => {
  const r = ocekivanoStanje(
    [],
    [{ nacinPlacanja: JSON.stringify({ gotovina: 10, kartica: 5 }), ukupno: 15 }],
    []
  );
  expect(r.gotovinskiPromet).toBe(10);
});

test('rezultat je zaokružen na fene, bez float repa', () => {
  const r = ocekivanoStanje(
    [{ tip: 'polog', iznos: 0.1 }, { tip: 'polog', iznos: 0.2 }],
    [],
    []
  );
  expect(r.ocekivanoStanje).toBe(0.3);
});
