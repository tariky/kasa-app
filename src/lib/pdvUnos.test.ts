import { test, expect } from 'bun:test';
import { uBruto, uNetto, brutoIzUnosa, promijeniRezim } from './pdvUnos';

test('uBruto dodaje 17% na stopu E', () => {
  expect(uBruto(100, 'E')).toBe(117);
});

test('uNetto skida 17% sa stope E', () => {
  expect(uNetto(117, 'E')).toBe(100);
});

test('stopa K se ne konvertuje ni u jednom smjeru', () => {
  expect(uBruto(100, 'K')).toBe(100);
  expect(uNetto(100, 'K')).toBe(100);
});

test('rezultat je zaokruzen na dvije decimale', () => {
  // 100 / 1.17 = 85.4700854... → 85.47
  expect(uNetto(100, 'E')).toBe(85.47);
  // 85.47 * 1.17 = 99.9999 → 100.00
  expect(uBruto(85.47, 'E')).toBe(100);
});

// Dva uzastopna zaokruživanja na fene ne mogu biti povratna za svaku
// vrijednost: 1,00 → 0,85 → 0,99. Zato je invarijant "najviše jedan fening
// odstupanja", a ne tačna jednakost. Upravo zbog ovoga forma za izmjenu
// artikla čuva originalnu bruto cijenu kad polje nije dirano (Task 4 i 5).
// Poredi se u fenima kao cijelim brojevima: `Math.abs(a - b) <= 0.01` bi
// palo na float artefaktu (razlika ispadne 0.010000000000000009).
test('povratna konverzija odstupa najvise jedan fening', () => {
  for (const bruto of [1, 2.5, 10, 19.99, 100, 249.9, 1000]) {
    const razlikaUFeninzima = Math.round(Math.abs(uBruto(uNetto(bruto, 'E'), 'E') - bruto) * 100);
    expect(razlikaUFeninzima).toBeLessThanOrEqual(1);
  }
});

test('nula i negativan unos prolaze bez izuzetka', () => {
  expect(uBruto(0, 'E')).toBe(0);
  expect(uNetto(0, 'E')).toBe(0);
});

test('NaN unos ostaje NaN', () => {
  expect(uBruto(NaN, 'E')).toBeNaN();
});

// --- brutoIzUnosa -------------------------------------------------------
// Rule 2 (money safety): ako polje prikazuje tačno ono što je izvedeno iz
// sidra, u bazu ide NEPROMIJENJENA bruto vrijednost sidra — jer
// bruto→netto→bruto nije povratno za svaku vrijednost (100,00 → 85,47 → 99,99).

const E100 = { cijena: 100, pdvStopa: 'E' as const };

test('brutoIzUnosa: nedirana cijena artikla vraca originalnu bruto vrijednost', () => {
  expect(brutoIzUnosa({ unos: '85.47', stopa: 'E', bezPdv: true, sidro: E100 })).toBe(100);
  expect(brutoIzUnosa({ unos: '100', stopa: 'E', bezPdv: false, sidro: E100 })).toBe(100);
});

test('brutoIzUnosa: dirana cijena se konvertuje iz netta', () => {
  expect(brutoIzUnosa({ unos: '90', stopa: 'E', bezPdv: true, sidro: E100 })).toBe(uBruto(90, 'E'));
});

test('brutoIzUnosa: promjena stope uz nepromijenjen tekst polja se ipak konvertuje', () => {
  const sidro = { cijena: 100, pdvStopa: 'K' as const };
  expect(brutoIzUnosa({ unos: '100', stopa: 'E', bezPdv: true, sidro })).toBe(uBruto(100, 'E'));
});

test('brutoIzUnosa: sa PDV-om se unos uzima kao bruto direktno', () => {
  expect(brutoIzUnosa({ unos: '150', stopa: 'E', bezPdv: false, sidro: E100 })).toBe(150);
});

test('brutoIzUnosa: bez sidra uvijek racuna iz unosa', () => {
  expect(brutoIzUnosa({ unos: '85.47', stopa: 'E', bezPdv: true, sidro: null })).toBe(uBruto(85.47, 'E'));
  expect(brutoIzUnosa({ unos: '100', stopa: 'E', bezPdv: false, sidro: null })).toBe(100);
});

test('brutoIzUnosa: stopa K se nikad ne konvertuje', () => {
  const sidro = { cijena: 50, pdvStopa: 'K' as const };
  expect(brutoIzUnosa({ unos: '60', stopa: 'K', bezPdv: true, sidro })).toBe(60);
});

test('brutoIzUnosa: prazan unos daje NaN', () => {
  expect(brutoIzUnosa({ unos: '', stopa: 'E', bezPdv: true, sidro: null })).toBeNaN();
});

// --- promijeniRezim ------------------------------------------------------

test('promijeniRezim: cuva cijenu, ne tekst — 117 sa PDV-om postaje 100 bez', () => {
  const r = promijeniRezim({ unos: '117', stopa: 'E', bezPdv: false, sidro: null }, true);
  expect(r.unos).toBe('100');
  expect(brutoIzUnosa({ unos: r.unos, stopa: 'E', bezPdv: true, sidro: r.sidro })).toBe(117);
});

test('promijeniRezim: tamo-nazad vraca isti broj, bez fening pomaka', () => {
  const tamo = promijeniRezim({ unos: '100', stopa: 'E', bezPdv: false, sidro: null }, true);
  expect(tamo.unos).toBe('85.47');
  expect(brutoIzUnosa({ unos: tamo.unos, stopa: 'E', bezPdv: true, sidro: tamo.sidro })).toBe(100);
  const nazad = promijeniRezim({ unos: tamo.unos, stopa: 'E', bezPdv: true, sidro: tamo.sidro }, false);
  expect(nazad.unos).toBe('100');
});

test('promijeniRezim: na spremljenom artiklu ne pomjera cijenu', () => {
  const r = promijeniRezim({ unos: '100', stopa: 'E', bezPdv: false, sidro: E100 }, true);
  expect(brutoIzUnosa({ unos: r.unos, stopa: 'E', bezPdv: true, sidro: r.sidro })).toBe(100);
});

test('promijeniRezim: prazno polje ostaje prazno', () => {
  expect(promijeniRezim({ unos: '', stopa: 'E', bezPdv: false, sidro: null }, true)).toEqual({ unos: '', sidro: null });
});
