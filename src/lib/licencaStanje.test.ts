import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { izdajLicencu } from './licenca';
import { izracunajStanje, efektivniDanas, smijeRaditi, razlikaDana, opisLicence, brojDana } from './licencaStanje';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const token = izdajLicencu({ klijent: 'Pekara', vrijediDo: '2026-10-31', izdana: '2026-10-01' }, privateKey);
const stanje = (danas: string, t: string | null = token, uredjaj = 'A') =>
  izracunajStanje(t, publicKey, { danas, uredjaj });

test('bez tokena nema licence i ne smije raditi', () => {
  expect(stanje('2026-10-10', null)).toEqual({ stanje: 'nema' });
  expect(stanje('2026-10-10', '  ')).toEqual({ stanje: 'nema' });
  expect(smijeRaditi({ stanje: 'nema' })).toBe(false);
});

test('više od 7 dana do isteka je aktivna', () => {
  expect(stanje('2026-10-23')).toMatchObject({ stanje: 'aktivna', danaDoIsteka: 8 });
});

test('7 dana i manje do isteka je upozorenje, zadnji dan je 0', () => {
  expect(stanje('2026-10-24')).toMatchObject({ stanje: 'upozorenje', danaDoIsteka: 7 });
  expect(stanje('2026-10-31')).toMatchObject({ stanje: 'upozorenje', danaDoIsteka: 0 });
});

test('15 dana nakon isteka radi u periodu milosti, 16. dan je zaključana', () => {
  expect(stanje('2026-11-01')).toMatchObject({ stanje: 'milost', danaDoBlokade: 14 });
  const zadnji = stanje('2026-11-15');
  expect(zadnji).toMatchObject({ stanje: 'milost', danaDoBlokade: 0 });
  expect(smijeRaditi(zadnji)).toBe(true);
  const zakljucana = stanje('2026-11-16');
  expect(zakljucana.stanje).toBe('zakljucana');
  expect(smijeRaditi(zakljucana)).toBe(false);
});

test('lažan token ili tuđi uređaj je neispravna licenca', () => {
  const tudji = izdajLicencu({ klijent: 'X', vrijediDo: '2026-12-31', izdana: '2026-10-01' }, generateKeyPairSync('ed25519').privateKey);
  expect(stanje('2026-10-10', tudji)).toEqual({ stanje: 'neispravna', razlog: 'potpis' });
  const vezana = izdajLicencu({ klijent: 'X', vrijediDo: '2026-12-31', izdana: '2026-10-01', uredjaj: 'A' }, privateKey);
  expect(stanje('2026-10-10', vezana, 'A').stanje).toBe('aktivna');
  expect(stanje('2026-10-10', vezana, 'B')).toEqual({ stanje: 'neispravna', razlog: 'uredjaj' });
});

test('vraćen sat ne vraća datum unazad', () => {
  expect(efektivniDanas('2026-10-01', '2026-11-20')).toBe('2026-11-20');
  expect(efektivniDanas('2026-11-21', '2026-11-20')).toBe('2026-11-21');
  expect(efektivniDanas('2026-11-21', null)).toBe('2026-11-21');
});

test('razlika dana preko promjene ljetnog računanja vremena', () => {
  expect(razlikaDana('2026-10-24', '2026-10-26')).toBe(2);
  expect(razlikaDana('2026-03-28', '2026-03-30')).toBe(2);
});

test('opis stanja za prikaz', () => {
  expect(opisLicence(stanje('2026-10-28')).naslov).toBe('Licenca ističe za 3 dana');
  expect(opisLicence(stanje('2026-10-30')).naslov).toBe('Licenca ističe za 1 dan');
  expect(opisLicence(stanje('2026-10-31')).naslov).toBe('Licenca ističe danas');
  expect(opisLicence(stanje('2026-11-01')).tekst).toBe('Program radi još 14 dana, nakon toga samo za pregled.');
  expect(opisLicence(stanje('2026-11-15')).tekst).toContain('Danas je zadnji dan');
  expect(opisLicence(stanje('2026-11-16')).tekst).toContain('Istekla 31.10.2026.');
  expect(brojDana(21)).toBe('21 dan');
  expect(brojDana(11)).toBe('11 dana');
});
