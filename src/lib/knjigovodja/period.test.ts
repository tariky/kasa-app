import { test, expect } from 'bun:test';
import { periodMjeseca, prosliMjesec, mjesecPerioda, prikazPerioda, prikazDatuma, imeFajla, MJESECI } from './period';

test('period mjeseca uključuje zadnji dan, i u prestupnoj godini', () => {
  expect(periodMjeseca(2026, 9)).toEqual({ od: '2026-09-01', do: '2026-09-30' });
  expect(periodMjeseca(2024, 2)).toEqual({ od: '2024-02-01', do: '2024-02-29' });
  expect(periodMjeseca(2026, 2)).toEqual({ od: '2026-02-01', do: '2026-02-28' });
  expect(periodMjeseca(2026, 12)).toEqual({ od: '2026-12-01', do: '2026-12-31' });
});

test('prošli mjesec prelazi granicu godine', () => {
  expect(prosliMjesec(new Date(2026, 8, 25))).toEqual({ godina: 2026, mjesec: 8 });
  expect(prosliMjesec(new Date(2026, 0, 3))).toEqual({ godina: 2025, mjesec: 12 });
});

test('cijeli mjesec se prepoznaje, dio mjeseca ne', () => {
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-09-30' })).toEqual({ godina: 2026, mjesec: 9 });
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-09-29' })).toBeNull();
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-10-31' })).toBeNull();
});

test('prikaz perioda i datuma', () => {
  expect(MJESECI).toHaveLength(12);
  expect(prikazPerioda({ od: '2026-09-01', do: '2026-09-30' })).toBe('Septembar 2026');
  expect(prikazPerioda({ od: '2026-09-01', do: '2026-09-15' })).toBe('01.09.2026. – 15.09.2026.');
  expect(prikazPerioda({ od: '2026-09-05', do: '2026-09-05' })).toBe('05.09.2026.');
  expect(prikazDatuma('2026-09-01 10:00:00')).toBe('01.09.2026.');
});

test('ime fajla: ASCII, bez nedozvoljenih znakova, mjesec ili raspon', () => {
  expect(imeFajla('Čaplja d.o.o.', { od: '2026-09-01', do: '2026-09-30' })).toBe('Knjigovodja_Caplja_d.o.o_2026-09');
  expect(imeFajla('A/B: "Đak" <x>|?*', { od: '2026-09-01', do: '2026-09-15' })).toBe('Knjigovodja_AB_Dak_x_2026-09-01_2026-09-15');
  expect(imeFajla('   ', { od: '2026-09-01', do: '2026-09-30' })).toBe('Knjigovodja_2026-09');
});
