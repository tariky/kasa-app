// Čiste funkcije priloga koje koriste kasa i dijalozi. Upis stavki priloga
// (prilog:saveStavke) je u ugovoru oba backenda (ugovor/ponude.ugovor.test.ts).
import { test, expect } from 'bun:test';
import { PRILOG_SIFRA, prilogNaziv, sumaPriloga, prilogKompletan, buildPrilogFiskalnaStavka } from './prilog';

test('prilogNaziv bez broja je ono što se kuca na isječak', () => {
  expect(prilogNaziv(null)).toBe('Stavke po računu');
});

test('prilogNaziv koristi zadani uvod i vezu iz unosa', () => {
  expect(prilogNaziv(null, 'CNC obrada', 'fakturi')).toBe('CNC obrada po fakturi');
});

test('prilogNaziv pada na zadane dijelove kad je unos prazan', () => {
  expect(prilogNaziv(null, '   ', '')).toBe('Stavke po računu');
});

test('prilogNaziv sa brojem rekonstruiše tekst starih računa', () => {
  // Računi izdati prije prelaska na BF broj imaju broj u odštampanom nazivu.
  expect(prilogNaziv(17)).toBe('Stavke po računu br. 17');
});

test('buildPrilogFiskalnaStavka preuzima zadani naziv', () => {
  expect(buildPrilogFiskalnaStavka(null, 100, 'CNC obrada po fakturi').naziv)
    .toBe('CNC obrada po fakturi');
});

test('sumaPriloga zaokružuje po stavci pa zbir', () => {
  const stavke = [
    { productId: 1, kolicina: 3, cijena: 0.335, pdvStopa: 'E' },  // 1.005 → 1.01 po stavci
    { productId: 2, kolicina: 1, cijena: 2,     pdvStopa: 'E' },
  ];
  expect(sumaPriloga(stavke)).toBe(3.01);
});

test('prilogKompletan poredi na 2 decimale', () => {
  const stavke = [{ productId: 1, kolicina: 2, cijena: 75, pdvStopa: 'E' }];
  expect(prilogKompletan(150, stavke)).toBe(true);
  expect(prilogKompletan(150.01, stavke)).toBe(false);
});

test('buildPrilogFiskalnaStavka gradi zbirnu stavku', () => {
  const s = buildPrilogFiskalnaStavka(17, 150);
  expect(s).toEqual({
    productId: 0, sifra: PRILOG_SIFRA, naziv: 'Stavke po računu br. 17',
    jm: 'kom', plu: 0, cijena: 150, kolicina: 1, rabat: 0, pdvStopa: 'E',
  });
});
