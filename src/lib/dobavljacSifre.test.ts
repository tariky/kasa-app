import { test, expect } from 'bun:test';
import { bonusSifreIzabranog, uPayload, uRedove, uSiframaDobavljaca } from './dobavljacSifre';
import { poljaProizvoda, pretrazi } from './pretraga';
import type { Product } from '@/types';

test('uPayload preskače redove bez dobavljača, a praznu šifru šalje kao null', () => {
  expect(uPayload([
    { dobavljacId: 1, sifra: ' A-1 ' },
    { dobavljacId: null, sifra: 'X' },
    { dobavljacId: 2, sifra: '   ' },
  ])).toEqual([{ dobavljacId: 1, sifra: 'A-1' }, { dobavljacId: 2, sifra: null }]);
});

test('uRedove pretvara null šifru u prazan unos', () => {
  expect(uRedove([{ dobavljacId: 3, dobavljacNaziv: 'Alfa', sifra: null }])).toEqual([{ dobavljacId: 3, sifra: '' }]);
});

test('uSiframaDobavljaca traži podstring bez obzira na velika slova', () => {
  expect(uSiframaDobavljaca({ sifreDobavljaca: 'XK-100 B7' }, 'xk-1')).toBe(true);
  expect(uSiframaDobavljaca({ sifreDobavljaca: 'XK-100 B7' }, 'b7')).toBe(true);
  expect(uSiframaDobavljaca({ sifreDobavljaca: null }, 'x')).toBe(false);
  expect(uSiframaDobavljaca({}, 'x')).toBe(false);
});

const art = (id: number, naziv: string, extra: Partial<Product> = {}) =>
  ({ id, sifra: `A${id}`, naziv, jm: 'kom', cijena: 1, pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', ...extra }) as Product;

test('pretraga ulaza nalazi po šifri dobavljača, a tačna šifra izabranog dobavljača ide prva', () => {
  const lista = [
    art(1, 'Kafa K-10 pakovanje'),
    art(2, 'Čaj', { sifreDobavljaca: 'K-10' }),
    art(3, 'Šećer', { sifreDobavljaca: 'K-100' }),
  ];
  const ids = (q: string, sifre?: Map<number, string>) =>
    pretrazi(lista, q, poljaProizvoda, { bonus: bonusSifreIzabranog(sifre) }).map(p => p.stavka.id);
  expect(ids('k-10')).toEqual([1, 2, 3]);
  expect(ids('K-10', new Map([[2, 'K-10'], [3, 'K-100']]))).toEqual([2, 1, 3]);
  expect(ids('  ')).toEqual([]);
});
