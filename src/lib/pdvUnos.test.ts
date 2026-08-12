import { test, expect } from 'bun:test';
import { uBruto, uNetto } from './pdvUnos';

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
