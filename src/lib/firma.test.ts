import { test, expect } from 'bun:test';
import { LOGO_VELICINA, logoVelicina, kontaktFirme, ziroRacuniPozicija, mjestoZiroRacuna } from './firma';

test('logoVelicina vraća zadanu vrijednost kad nije postavljena', () => {
  expect(logoVelicina({})).toBe(LOGO_VELICINA.zadano);
  expect(logoVelicina({ logoVelicina: undefined })).toBe(LOGO_VELICINA.zadano);
  expect(logoVelicina({ logoVelicina: Number.NaN })).toBe(LOGO_VELICINA.zadano);
});

test('logoVelicina ograničava na dozvoljeni raspon', () => {
  expect(logoVelicina({ logoVelicina: 5 })).toBe(LOGO_VELICINA.min);
  expect(logoVelicina({ logoVelicina: 999 })).toBe(LOGO_VELICINA.max);
  expect(logoVelicina({ logoVelicina: 140 })).toBe(140);
});

test('kontaktFirme spaja web i email, preskače prazne', () => {
  expect(kontaktFirme({ web: 'www.firma.ba', email: 'info@firma.ba' })).toBe('www.firma.ba · info@firma.ba');
  expect(kontaktFirme({ web: '  ', email: 'info@firma.ba' })).toBe('info@firma.ba');
  expect(kontaktFirme({ web: 'www.firma.ba' })).toBe('www.firma.ba');
  expect(kontaktFirme({})).toBe('');
});

test('ziroRacuniPozicija je zaglavlje osim kad je izričito podnožje', () => {
  expect(ziroRacuniPozicija({})).toBe('zaglavlje');
  expect(ziroRacuniPozicija({ ziroRacuniPozicija: 'podnozje' })).toBe('podnozje');
  expect(ziroRacuniPozicija({ ziroRacuniPozicija: 'zaglavlje' })).toBe('zaglavlje');
  expect(ziroRacuniPozicija({ ziroRacuniPozicija: 'bilo šta' as any })).toBe('zaglavlje');
});

test('mjestoZiroRacuna: po postavci, a bez ijednog računa nigdje (dokument nema prazan blok)', () => {
  const racuni = [{ bankName: 'Banka', accountNumber: '1234567890123456' }];
  expect(mjestoZiroRacuna({ bankAccounts: racuni })).toBe('zaglavlje');
  expect(mjestoZiroRacuna({ ziroRacuniPozicija: 'zaglavlje', bankAccounts: racuni })).toBe('zaglavlje');
  expect(mjestoZiroRacuna({ ziroRacuniPozicija: 'podnozje', bankAccounts: racuni })).toBe('podnozje');
  expect(mjestoZiroRacuna({ ziroRacuniPozicija: 'podnozje', bankAccounts: [] })).toBeNull();
  expect(mjestoZiroRacuna({ ziroRacuniPozicija: 'zaglavlje', bankAccounts: [] })).toBeNull();
});
