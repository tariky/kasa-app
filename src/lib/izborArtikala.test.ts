import { test, expect } from 'bun:test';
import { pomjeriKursor, artikalZaEnter, nemaNaStanju } from './izborArtikala';
import type { Product } from '@/types';

function artikal(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sifra: '001', naziv: 'Test artikal', jm: 'kom', cijena: 10,
    pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', stanje: 5,
    ...overrides,
  };
}

// --- pomjeriKursor ---

test('strelica dolje s praznog kursora ide na prvi red', () => {
  expect(pomjeriKursor(-1, 'ArrowDown', 5)).toBe(0);
});

test('strelica dolje sa zadnjeg reda vraća na prvi', () => {
  expect(pomjeriKursor(4, 'ArrowDown', 5)).toBe(0);
});

test('strelica gore s praznog kursora ide na zadnji red', () => {
  expect(pomjeriKursor(-1, 'ArrowUp', 5)).toBe(4);
});

test('strelica gore s prvog reda ide na zadnji', () => {
  expect(pomjeriKursor(0, 'ArrowUp', 5)).toBe(4);
});

test('PageDown skače deset redova i staje na zadnjem', () => {
  expect(pomjeriKursor(2, 'PageDown', 30)).toBe(12);
  expect(pomjeriKursor(25, 'PageDown', 30)).toBe(29);
  expect(pomjeriKursor(-1, 'PageDown', 30)).toBe(9);
});

test('PageUp skače deset redova i staje na prvom', () => {
  expect(pomjeriKursor(15, 'PageUp', 30)).toBe(5);
  expect(pomjeriKursor(3, 'PageUp', 30)).toBe(0);
  expect(pomjeriKursor(-1, 'PageUp', 30)).toBe(0);
});

test('prazna lista i nepoznate tipke ne pomjeraju kursor', () => {
  expect(pomjeriKursor(0, 'ArrowDown', 0)).toBeNull();
  expect(pomjeriKursor(0, 'ArrowLeft', 5)).toBeNull();
  expect(pomjeriKursor(0, 'a', 5)).toBeNull();
});

// --- artikalZaEnter ---

const cola = artikal({ id: 1, sifra: '001', naziv: 'Coca Cola', barkod: '5449000000996' });
const fanta = artikal({ id: 2, sifra: '002', naziv: 'Fanta' });
const kola = artikal({ id: 3, sifra: '0011', naziv: 'Kola bez šećera' });

test('tačna šifra pobjeđuje bez obzira na kursor na prvom redu', () => {
  expect(artikalZaEnter({ query: '0011', kursor: 0, prikazani: [cola, kola], rezultati: [cola, kola] })).toBe(kola);
});

test('tačan barkod sa skenera dodaje artikal i prije nego stigne lista', () => {
  expect(artikalZaEnter({ query: '5449000000996', kursor: -1, prikazani: [], rezultati: [cola] })).toBe(cola);
});

test('kursor koji je korisnik pomjerio strelicama ima prednost nad tačnom šifrom', () => {
  expect(artikalZaEnter({ query: '001', kursor: 1, prikazani: [cola, kola], rezultati: [cola, kola] })).toBe(kola);
});

test('bez tačne šifre Enter uzima red pod kursorom', () => {
  expect(artikalZaEnter({ query: 'co', kursor: 0, prikazani: [cola, kola], rezultati: [cola, kola] })).toBe(cola);
});

test('jedini rezultat se dodaje i kad kursor još nije postavljen', () => {
  expect(artikalZaEnter({ query: 'fan', kursor: -1, prikazani: [], rezultati: [fanta] })).toBe(fanta);
});

test('više rezultata bez vidljivog kursora ne dodaje ništa', () => {
  expect(artikalZaEnter({ query: 'a', kursor: -1, prikazani: [], rezultati: [cola, fanta] })).toBeNull();
});

test('prazna pretraga bez kursora ne dodaje ništa, a s kursorom dodaje red iz cijele liste', () => {
  expect(artikalZaEnter({ query: '', kursor: -1, prikazani: [cola, fanta], rezultati: [] })).toBeNull();
  expect(artikalZaEnter({ query: '', kursor: 1, prikazani: [cola, fanta], rezultati: [] })).toBe(fanta);
});

// --- nemaNaStanju ---

test('artikal sa stanjem 0 nema na stanju osim kad je dozvoljena prodaja bez zalihe', () => {
  const prazan = artikal({ stanje: 0 });
  expect(nemaNaStanju(prazan, false)).toBe(true);
  expect(nemaNaStanju(prazan, true)).toBe(false);
});

test('usluge i artikli bez podatka o stanju su uvijek dostupni', () => {
  expect(nemaNaStanju(artikal({ tip: 'usluga', stanje: 0 }), false)).toBe(false);
  expect(nemaNaStanju(artikal({ stanje: undefined }), false)).toBe(false);
});
