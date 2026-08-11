import { test, expect } from 'bun:test';
import { buildUnosNovcaXml, buildPovratNovcaXml } from './tring';

test('UnosNovca XML nosi vrstu zahtjeva 7, Gotovinu i iznos', () => {
  const xml = buildUnosNovcaXml(3, 50);
  expect(xml).toStartWith('<?xml version="1.0" encoding="utf-8"?>');
  expect(xml).toContain('<BrojZahtjeva>3</BrojZahtjeva>');
  expect(xml).toContain('<VrstaZahtjeva>7</VrstaZahtjeva>');
  expect(xml).toContain('<Naziv>vrstaPlacanja</Naziv><Vrijednost>Gotovina</Vrijednost>');
  expect(xml).toContain('<Naziv>iznos</Naziv><Vrijednost>50</Vrijednost>');
});

test('PovratNovca XML ima isti oblik kao UnosNovca (razlikuje ih samo adresa)', () => {
  const unos = buildUnosNovcaXml(1, 120.33);
  const povrat = buildPovratNovcaXml(1, 120.33);
  expect(povrat).toBe(unos);
  expect(povrat).toContain('<Vrijednost>120.33</Vrijednost>');
});

test('iznos se zaokružuje na fene prije slanja', () => {
  const xml = buildUnosNovcaXml(1, 0.1 + 0.2);
  expect(xml).toContain('<Vrijednost>0.3</Vrijednost>');
});
