import { test, expect } from 'bun:test';
import { rokOznaka, nalogKoraci, korakIndex, zadaniIzbor, oznaceneStavke, proizvodiIzIzbora } from './nalogPrikaz';

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

const linije = [
  { ponudaStavkaId: 11, productId: 1, naziv: 'Kuhinja', sifra: 'K', jm: 'kom', kolicina: 1, stanje: 0, zadano: true },
  { ponudaStavkaId: 12, productId: 2, naziv: 'Sudopera', sifra: 'S', jm: 'kom', kolicina: 1, stanje: 4, zadano: false },
  { ponudaStavkaId: 13, productId: 1, naziv: 'Kuhinja', sifra: 'K', jm: 'kom', kolicina: 2, stanje: 0, zadano: true },
];

test('zadaniIzbor: stavke kojih nema dovoljno na zalihi', () => {
  expect([...zadaniIzbor(linije)]).toEqual([11, 13]);
});

test('oznaceneStavke: proizvod označi stavku iste količine, pa prvu slobodnu istog artikla', () => {
  expect([...oznaceneStavke(linije, [{ productId: 1, kolicina: 2 }])]).toEqual([13]);
  expect([...oznaceneStavke(linije, [{ productId: 1, kolicina: 5 }, { productId: 1, kolicina: 1 }])].sort()).toEqual([11, 13]);
  expect([...oznaceneStavke(linije, [{ productId: 2, kolicina: 1 }, { productId: 9, kolicina: 1 }])]).toEqual([12]);
  expect(oznaceneStavke(linije, []).size).toBe(0);
});

test('proizvodiIzIzbora: po jedan proizvod za označenu stavku, redom ponude', () => {
  expect(proizvodiIzIzbora(linije, new Set([13, 12]))).toEqual([{ productId: 2, kolicina: 1 }, { productId: 1, kolicina: 2 }]);
  expect(proizvodiIzIzbora(linije, new Set())).toEqual([]);
});
