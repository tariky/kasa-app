import { test, expect } from 'bun:test';
import { redStatus, praznaStavka, ulazTotali, nedostajeOpis, uPayload, nivelacijaRazlike, type UlazRed } from './ulaz';

const artikal = { id: 1, sifra: 'A-1', naziv: 'Artikal', jm: 'kom', cijena: 10, pdvStopa: 'E', tip: 'artikal', stanje: 3 } as any;
const ploca = { id: 11, sifra: 'IV', naziv: 'Iverica', jm: 'm²', cijena: 0, pdvStopa: 'E', tip: 'materijal', plocaSirina: 2000, plocaVisina: 1000, stanje: 0 } as any;
const kant = { id: 12, sifra: 'KT', naziv: 'Kant', jm: 'm', cijena: 0, pdvStopa: 'E', tip: 'materijal', stanje: 0 } as any;
const products = [artikal, ploca, kant];
const red = (p: Partial<UlazRed>): UlazRed => ({ ...praznaStavka(), ...p });

test('prazan red se ignoriše, red s artiklom bez količine i cijene javlja šta fali', () => {
  expect(redStatus(praznaStavka(), products)).toEqual({ stanje: 'prazan' });
  expect(redStatus(red({ productId: 1 }), products)).toEqual({ stanje: 'nepotpun', nedostaje: ['kolicina', 'nabavna', 'prodajna'] });
  expect(redStatus(red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '10' }), products)).toEqual({ stanje: 'ok' });
});

test('materijal ne traži prodajnu cijenu, artikal traži', () => {
  expect(redStatus(red({ productId: 12, kolicina: '2', nabavnaCijena: '0,9', cijena: '' }), products)).toEqual({ stanje: 'ok' });
  expect(redStatus(red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '' }), products)).toEqual({ stanje: 'nepotpun', nedostaje: ['prodajna'] });
});

test('količina tipkana bez artikla je nepotpun red', () => {
  expect(redStatus(red({ kolicina: '2' }), products)).toEqual({ stanje: 'nepotpun', nedostaje: ['artikal'] });
});

test('nedostajeOpis sažima šta treba popuniti', () => {
  const rows = [red({ productId: 1, kolicina: '2' }), red({ productId: 12, kolicina: '1' }), praznaStavka()];
  expect(nedostajeOpis(rows, products)).toBe('Nabavna cijena fali kod 2 stavke');
  expect(nedostajeOpis([red({ productId: 1 })], products)).toBe('Količina fali kod 1 stavke');
  expect(nedostajeOpis([praznaStavka()], products)).toBe('Dodajte bar jednu stavku');
  expect(nedostajeOpis([red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '10' })], products)).toBeNull();
});

test('totali računaju samo potpune redove, ploča ide po komadu', () => {
  const rows = [
    red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '10' }),
    red({ productId: 11, kolicina: '3', nabavnaCijena: '60' }),
    red({ productId: 1, kolicina: '9' }),
  ];
  expect(ulazTotali(rows, products)).toEqual({ nabavna: 190, prodajna: 20, ruc: 10, rucPct: 100 });
});

test('payload preračuna ploču u m² i materijalu briše prodajnu', () => {
  const rows = [red({ productId: 11, kolicina: '3', nabavnaCijena: '60', cijena: '' }), red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '12', rabat: '10' })];
  const p = uPayload(rows, products);
  expect(p[0]).toEqual({ productId: 11, kolicina: 6, nabavnaCijena: 30, rabat: 0, cijena: 0, pdvStopa: 'E' });
  expect(p[1]).toEqual({ productId: 1, kolicina: 2, nabavnaCijena: 5, rabat: 10, cijena: 12, pdvStopa: 'E' });
});

test('nivelacija se javlja samo za artikal sa zalihom i drugom prodajnom', () => {
  const rows = [
    red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '12' }),
    red({ productId: 12, kolicina: '1', nabavnaCijena: '1', cijena: '' }),
  ];
  expect(nivelacijaRazlike(rows, products)).toEqual([
    { productId: 1, productNaziv: 'Artikal', kolicina: 3, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 6 },
  ]);
  expect(nivelacijaRazlike([red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '10' })], products)).toEqual([]);
});
