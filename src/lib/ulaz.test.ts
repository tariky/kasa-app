import { test, expect } from 'bun:test';
import { redStatus, praznaStavka, ulazTotali, nedostajeOpis, uPayload, nivelacijaRazlike, cijeneBezUcinka, redNabavnaPoJed, type UlazRed } from './ulaz';

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
  expect(nedostajeOpis(rows, products)).toBe('Fakturna cijena fali kod 2 stavke');
  expect(nedostajeOpis([red({ productId: 1 })], products)).toBe('Količina fali kod 1 stavke');
  expect(nedostajeOpis([praznaStavka()], products)).toBe('Dodajte bar jednu stavku');
  expect(nedostajeOpis([red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '10' })], products)).toBeNull();
});

test('totali računaju samo potpune redove, ploča ide po komadu', () => {
  const rows = [
    red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '11.7' }),
    red({ productId: 11, kolicina: '3', nabavnaCijena: '60' }),
    red({ productId: 1, kolicina: '9' }),
  ];
  const t = ulazTotali(rows, products, '');
  expect(t.fakturna).toBe(190);
  expect(t.rabat).toBe(0);
  expect(t.zavisni).toBe(0);
  expect(t.nabavna).toBe(190);
  expect(t.prodajna).toBeCloseTo(23.4, 5);
  expect(t.ruc).toBeCloseTo(10, 5);
  expect(t.rucPct).toBeCloseTo(100, 5);
});

test('totali uračunavaju rabat i zavisne troškove — i na materijalu', () => {
  const rows = [
    red({ productId: 12, kolicina: '10', nabavnaCijena: '10', rabat: '20' }), // fakturna 100, nab 80
    red({ productId: 1, kolicina: '2', nabavnaCijena: '10', cijena: '23.4' }), // fakturna 20, nab 20
  ];
  const t = ulazTotali(rows, products, '25');
  expect(t.fakturna).toBe(120);
  expect(t.rabat).toBe(20);
  expect(t.zavisni).toBe(25);
  expect(t.nabavna).toBe(125);
  // zavisni srazmjerno vrijednosti nakon rabata: 80:20 → 20 i 5; artikal nab = 25, prodajna bez PDV 40 → RUC 15
  expect(t.ruc).toBeCloseTo(15, 5);
  expect(t.rucPct).toBeCloseTo(60, 5);
});

test('payload preračuna ploču u m², materijalu briše prodajnu, zavisne dijeli po stavkama', () => {
  const rows = [red({ productId: 11, kolicina: '3', nabavnaCijena: '60', cijena: '' }), red({ productId: 1, kolicina: '2', nabavnaCijena: '5', cijena: '12', rabat: '10' })];
  const p = uPayload(rows, products, '');
  expect(p[0]).toEqual({ productId: 11, kolicina: 6, nabavnaCijena: 30, rabat: 0, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E' });
  expect(p[1]).toEqual({ productId: 1, kolicina: 2, nabavnaCijena: 5, rabat: 10, zavisniTroskovi: 0, cijena: 12, pdvStopa: 'E' });
  // ploča 180, artikal 9 → 189; zavisni 21 → 20 i 1
  const z = uPayload(rows, products, '21');
  expect(z[0].zavisniTroskovi).toBe(20);
  expect(z[1].zavisniTroskovi).toBe(1);
  // materijal može imati rabat
  const m = uPayload([red({ productId: 12, kolicina: '4', nabavnaCijena: '2', rabat: '15' })], products, '0');
  expect(m[0]).toEqual({ productId: 12, kolicina: 4, nabavnaCijena: 2, rabat: 15, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E' });
});

test('nabavna po jedinici reda: nakon rabata, u jedinici u kojoj se kuca', () => {
  expect(redNabavnaPoJed(red({ productId: 12, kolicina: '10', nabavnaCijena: '10', rabat: '20' }))).toBe(8);
  expect(redNabavnaPoJed(red({ productId: 12, kolicina: '10', nabavnaCijena: '10' }))).toBe(10);
  expect(redNabavnaPoJed(red({ productId: 12, kolicina: '', nabavnaCijena: '10' }))).toBe(10);
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

// Izmjena postojećeg ulaza: cijena se mijenja samo gdje je korisnik mijenja,
// i samo ako ulaz i dalje određuje cijenu (nema kasnije promjene).
test('izmjena ulaza: nepromijenjena prodajna cijena ne najavljuje nivelaciju iako se razlikuje od trenutne', () => {
  const izvorne = [{ productId: 1, cijena: 12, kolicina: 1 }];
  const rows = [red({ productId: 1, kolicina: '5', nabavnaCijena: '5', cijena: '12' })];
  expect(nivelacijaRazlike(rows, products, izvorne)).toEqual([]);
  expect(cijeneBezUcinka(rows, products, izvorne)).toEqual([]);
});

test('izmjena ulaza: promjena cijene koju je kasnije pregazila druga promjena se ne najavljuje, nego se javlja da ne djeluje', () => {
  const izvorne = [{ productId: 1, cijena: 12, kolicina: 1, cijenaKasnijeMijenjana: true }];
  const rows = [red({ productId: 1, kolicina: '1', nabavnaCijena: '5', cijena: '13' })];
  expect(nivelacijaRazlike(rows, products, izvorne)).toEqual([]);
  expect(cijeneBezUcinka(rows, products, izvorne)).toEqual([{ productId: 1, productNaziv: 'Artikal', cijena: 10 }]);
});

test('izmjena ulaza: promjena cijene zadnjeg ulaza nivelira zalihu bez robe iz tog ulaza', () => {
  const izvorne = [{ productId: 1, cijena: 10, kolicina: 1 }];
  const rows = [red({ productId: 1, kolicina: '1', nabavnaCijena: '5', cijena: '12' })];
  expect(nivelacijaRazlike(rows, products, izvorne)).toEqual([
    { productId: 1, productNaziv: 'Artikal', kolicina: 2, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 4 },
  ]);
});

test('izmjena zadnjeg ulaza koji je postavio 12: nivelacija ide od cijene u prodaji (12 → 15), kao u bazi', () => {
  // Artikal 10 → ulaz postavio 12 (u prodaji je 12, zaliha 5 + 3 iz ulaza).
  const art = { ...artikal, cijena: 12, stanje: 8 };
  const izvorne = [{ productId: 1, cijena: 12, kolicina: 3 }];
  expect(nivelacijaRazlike([red({ productId: 1, kolicina: '3', nabavnaCijena: '5', cijena: '15' })], [art], izvorne)).toEqual([
    { productId: 1, productNaziv: 'Artikal', kolicina: 5, staraCijena: 12, novaCijena: 15, razlika: 3, ukupnaRazlika: 15 },
  ]);
  // Vraćanje na cijenu prije ulaza: u bazi protunivelacija 12 → 10 na istoj zalihi.
  expect(nivelacijaRazlike([red({ productId: 1, kolicina: '3', nabavnaCijena: '5', cijena: '10' })], [art], izvorne)).toEqual([
    { productId: 1, productNaziv: 'Artikal', kolicina: 5, staraCijena: 12, novaCijena: 10, razlika: -2, ukupnaRazlika: -10 },
  ]);
});
