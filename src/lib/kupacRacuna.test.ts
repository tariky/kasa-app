import { test, expect, describe } from 'bun:test';
import { KUPAC_LIMITI, PRAZAN_KUPAC, izKupca, zaSlanje } from './kupacRacuna';
import type { Kupac } from '@/types';

test('limiti polja su oni koje štampa Tring (JIB 13, naziv 32, adresa 32, poštanski 5, grad 26)', () => {
  expect(KUPAC_LIMITI).toEqual({ idBroj: 13, naziv: 32, adresa: 32, postanskiBroj: 5, grad: 26 });
});

describe('izKupca', () => {
  test('kupac iz šifarnika → polja računa; ostala polja šifarnika se ne nose', () => {
    const k: Kupac = {
      id: 3, naziv: 'Firma d.o.o.', idBroj: '4200000000002', pdvBroj: '200000000000',
      adresa: 'Ulica 1', postanskiBroj: '75000', grad: 'Tuzla', kontakt: '061', rabat: 5, createdAt: '',
    };
    expect(izKupca(k)).toEqual({
      idBroj: '4200000000002', naziv: 'Firma d.o.o.', adresa: 'Ulica 1', postanskiBroj: '75000', grad: 'Tuzla',
    });
  });

  test('polja kojih nema u šifarniku su prazan tekst', () => {
    expect(izKupca({ id: 1, naziv: 'Kupac', idBroj: '4200000000002', createdAt: '' })).toEqual({
      idBroj: '4200000000002', naziv: 'Kupac', adresa: '', postanskiBroj: '', grad: '',
    });
  });
});

describe('zaSlanje', () => {
  test('sva polja se šalju bez razmaka na krajevima', () => {
    expect(zaSlanje({
      idBroj: ' 4200000000002 ', naziv: ' Firma ', adresa: 'Ulica 1  ', postanskiBroj: ' 75000', grad: ' Tuzla ',
    })).toEqual({ idBroj: '4200000000002', naziv: 'Firma', adresa: 'Ulica 1', postanskiBroj: '75000', grad: 'Tuzla' });
  });

  test('prazna polja pored ID broja ostaju prazna (NULL upisuje backend)', () => {
    expect(zaSlanje({ ...PRAZAN_KUPAC, idBroj: '4200000000002' })).toEqual({
      idBroj: '4200000000002', naziv: '', adresa: '', postanskiBroj: '', grad: '',
    });
  });

  test('prazan kupac se ne šalje', () => {
    expect(zaSlanje(PRAZAN_KUPAC)).toBeUndefined();
    expect(zaSlanje({ idBroj: '  ', naziv: ' ', adresa: '', postanskiBroj: '', grad: '' })).toBeUndefined();
  });

  test('kupac bez ID broja se ne šalje — račun ide na krajnjeg kupca', () => {
    expect(zaSlanje({ ...PRAZAN_KUPAC, naziv: 'Firma', grad: 'Tuzla' })).toBeUndefined();
  });

  test('ne mijenja formu', () => {
    const forma = { ...PRAZAN_KUPAC, idBroj: ' 4200000000002 ' };
    zaSlanje(forma);
    expect(forma.idBroj).toBe(' 4200000000002 ');
  });
});
