import { test, expect } from 'bun:test';
import {
  jePloca, m2PoPloci, komUM2, m2UKom, elementiUM2, elementiUNapomenu, napomenaUElemente, JM_PLOCA,
  uBazuPrimke, izBazePrimke,
} from './ploca';

test('standardna ploča 2800×2070 ima 5.796 m²', () => {
  expect(m2PoPloci(2800, 2070)).toBe(5.796);
});

test('kom → m² i nazad se poklapaju', () => {
  expect(komUM2(5, 2800, 2070)).toBe(28.98);
  expect(m2UKom(28.98, 2800, 2070)).toBe(5);
  expect(m2UKom(29, 2800, 2070)).toBe(5); // ≈ 5.003 → 2 decimale
});

test('elementi → m² zbraja sve komade', () => {
  const m2 = elementiUM2([
    { sirina: 600, visina: 720, kom: 2 },
    { sirina: 800, visina: 720, kom: 1 },
  ]);
  // 2×0.432 + 0.576 = 1.44
  expect(m2).toBe(1.44);
});

test('elementi bez komada ili s nulom se preskaču', () => {
  expect(elementiUM2([{ sirina: 600, visina: 720, kom: 0 }, { sirina: 0, visina: 720, kom: 3 }])).toBe(0);
});

test('napomena iz elemenata i nazad', () => {
  const el = [{ sirina: 600, visina: 720, kom: 2 }, { sirina: 800, visina: 720, kom: 1 }];
  const nap = elementiUNapomenu(el);
  expect(nap).toBe('600×720 ×2, 800×720 ×1');
  expect(napomenaUElemente(nap)).toEqual(el);
});

test('napomena koja nije lista elemenata daje prazan niz', () => {
  expect(napomenaUElemente('korpus donji')).toEqual([]);
  expect(napomenaUElemente('')).toEqual([]);
});

test('jePloca: samo m² sa obje dimenzije', () => {
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: 2800, plocaVisina: 2070 })).toBe(true);
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: null, plocaVisina: null })).toBe(false);
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: 2800 })).toBe(false);
  expect(jePloca({ jm: 'kom', plocaSirina: 2800, plocaVisina: 2070 })).toBe(false);
});

// ── primka: kom ↔ m² preračun ──────────────────────────────
const PLOCA = { jm: JM_PLOCA, plocaSirina: 2800, plocaVisina: 2070 };

test('uBazuPrimke: kom i nabavna po komadu se preračunaju u m² i nabavnu po m²', () => {
  expect(uBazuPrimke(PLOCA, 5, 120)).toEqual({ kolicina: 28.98, nabavnaCijena: 20.7039 });
});

test('izBazePrimke je inverz od uBazuPrimke', () => {
  expect(izBazePrimke(PLOCA, 28.98, 20.7039)).toEqual({ kolicina: '5', nabavnaCijena: '120' });
});

test('uBazuPrimke/izBazePrimke: nije ploča (jm) prolazi nepromijenjeno', () => {
  const materijal = { jm: 'm', plocaSirina: null, plocaVisina: null };
  expect(uBazuPrimke(materijal, 5, 120)).toEqual({ kolicina: 5, nabavnaCijena: 120 });
  expect(izBazePrimke(materijal, 5, 120)).toEqual({ kolicina: '5', nabavnaCijena: '120' });
});

test('uBazuPrimke/izBazePrimke: nedefinisan proizvod prolazi nepromijenjeno', () => {
  expect(uBazuPrimke(undefined, 5, 120)).toEqual({ kolicina: 5, nabavnaCijena: 120 });
  expect(izBazePrimke(undefined, 5, 120)).toEqual({ kolicina: '5', nabavnaCijena: '120' });
});
