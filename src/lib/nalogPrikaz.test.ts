import { test, expect } from 'bun:test';
import { rokOznaka, nalogKoraci, korakIndex } from './nalogPrikaz';

test('rokOznaka: bez roka nema oznake', () => {
  expect(rokOznaka(null, '2026-09-24')).toBeNull();
});

test('rokOznaka: danas, sutra, za N dana', () => {
  expect(rokOznaka('2026-09-24', '2026-09-24')).toEqual({ label: 'danas', tone: 'warn' });
  expect(rokOznaka('2026-09-25', '2026-09-24')).toEqual({ label: 'sutra', tone: 'warn' });
  expect(rokOznaka('2026-09-30', '2026-09-24')).toEqual({ label: 'za 6 dana', tone: 'ok' });
  expect(rokOznaka('2026-09-26', '2026-09-24')).toEqual({ label: 'za 2 dana', tone: 'warn' });
});

test('rokOznaka: probijen rok', () => {
  expect(rokOznaka('2026-09-23', '2026-09-24')).toEqual({ label: 'kasni 1 dan', tone: 'late' });
  expect(rokOznaka('2026-09-19', '2026-09-24')).toEqual({ label: 'kasni 5 dana', tone: 'late' });
});

test('rokOznaka: zatvoren nalog ne kasni', () => {
  expect(rokOznaka('2026-09-19', '2026-09-24', true)).toBeNull();
});

test('nalogKoraci: narudžba ide do fakture, zaliha do stanja', () => {
  expect(nalogKoraci('narudzba').map(k => k.status)).toEqual(['otvoren', 'u_izradi', 'zavrsen', 'fakturisan']);
  expect(nalogKoraci('zaliha').map(k => k.status)).toEqual(['otvoren', 'u_izradi', 'zavrsen']);
});

test('korakIndex: trenutni korak po statusu', () => {
  expect(korakIndex('narudzba', 'otvoren')).toBe(0);
  expect(korakIndex('narudzba', 'fakturisan')).toBe(3);
  expect(korakIndex('zaliha', 'zavrsen')).toBe(2);
});
