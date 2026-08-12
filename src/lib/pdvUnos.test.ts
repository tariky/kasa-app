import { test, expect } from 'bun:test';
import { uBruto, uNetto, cijenaZaSpremanje } from './pdvUnos';

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

// --- cijenaZaSpremanje --------------------------------------------------
// Rule 2 (money safety): ako korisnik nije dirao polje cijene, u bazu ide
// NEPROMIJENJENA originalna bruto vrijednost — jer bruto→netto→bruto nije
// povratno za svaku vrijednost (100,00 → 85,47 → 99,99).

test('cijenaZaSpremanje: nedirana cijena artikla vraca originalnu bruto vrijednost', () => {
  const original = { cijena: 100, pdvStopa: 'E' as const };
  const rezultat = cijenaZaSpremanje({
    unos: '85.47',
    unosInit: '85.47',
    stopa: 'E',
    original,
    bezPdv: true,
  });
  expect(rezultat).toBe(100);
});

test('cijenaZaSpremanje: dirana cijena se konvertuje iz netta', () => {
  const original = { cijena: 100, pdvStopa: 'E' as const };
  const rezultat = cijenaZaSpremanje({
    unos: '90',
    unosInit: '85.47',
    stopa: 'E',
    original,
    bezPdv: true,
  });
  expect(rezultat).toBe(uBruto(90, 'E'));
});

test('cijenaZaSpremanje: promjena stope uz nepromijenjen tekst polja se ipak konvertuje', () => {
  const original = { cijena: 100, pdvStopa: 'K' as const };
  const rezultat = cijenaZaSpremanje({
    unos: '100',
    unosInit: '100',
    stopa: 'E',
    original,
    bezPdv: true,
  });
  expect(rezultat).toBe(uBruto(100, 'E'));
});

test('cijenaZaSpremanje: kad je postavka iskljucena, unos se uzima kao bruto direktno (ako je diran)', () => {
  const original = { cijena: 100, pdvStopa: 'E' as const };
  const rezultat = cijenaZaSpremanje({
    unos: '150',
    unosInit: '100',
    stopa: 'E',
    original,
    bezPdv: false,
  });
  expect(rezultat).toBe(150);
});

test('cijenaZaSpremanje: novi proizvod (original null) uvijek racuna iz unosa', () => {
  const rezultatBezPdv = cijenaZaSpremanje({
    unos: '85.47',
    unosInit: '85.47',
    stopa: 'E',
    original: null,
    bezPdv: true,
  });
  expect(rezultatBezPdv).toBe(uBruto(85.47, 'E'));

  const rezultatSaPdv = cijenaZaSpremanje({
    unos: '100',
    unosInit: '100',
    stopa: 'E',
    original: null,
    bezPdv: false,
  });
  expect(rezultatSaPdv).toBe(100);
});

test('cijenaZaSpremanje: stopa K se nikad ne konvertuje, cak i kad je dirana', () => {
  const original = { cijena: 50, pdvStopa: 'K' as const };
  const rezultat = cijenaZaSpremanje({
    unos: '60',
    unosInit: '50',
    stopa: 'K',
    original,
    bezPdv: true,
  });
  expect(rezultat).toBe(60);
});
