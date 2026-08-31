import { test, expect } from 'bun:test';
import { buildUnosNovcaXml, buildPovratNovcaXml } from './tring';

// Oblik je preslikan iz Tringovih isporučenih primjera unosnovca.xml /
// povratnovca.xml — vidjeti docs/research/2026-08-31-tring-reklamacija-vrsta-placanja.md.

test('UnosNovca XML nosi vrstu zahtjeva 7, Gotovinu i iznos', () => {
  const xml = buildUnosNovcaXml(3, 50);
  expect(xml).toStartWith('<?xml version="1.0" encoding="utf-8"?>');
  expect(xml).toContain('<RacunZahtjev ');
  expect(xml).toContain('<BrojZahtjeva>3</BrojZahtjeva>');
  expect(xml).toContain('<VrstaZahtjeva>7</VrstaZahtjeva>');
  expect(xml).toContain('<NoviObjekat><Oznaka>Gotovina</Oznaka><Iznos>50</Iznos></NoviObjekat>');
});

test('PovratNovca je vrsta zahtjeva 8, inače isti oblik kao UnosNovca', () => {
  const unos = buildUnosNovcaXml(1, 120.33);
  const povrat = buildPovratNovcaXml(1, 120.33);
  expect(povrat).toContain('<VrstaZahtjeva>8</VrstaZahtjeva>');
  expect(unos).toContain('<VrstaZahtjeva>7</VrstaZahtjeva>');
  expect(povrat.replace('<VrstaZahtjeva>8', '<VrstaZahtjeva>7')).toBe(unos);
  expect(povrat).toContain('<Iznos>120.33</Iznos>');
});

test('oznaka plaćanja se može zadati (case-sensitive lista iz vrstaplacanja.xsd)', () => {
  expect(buildPovratNovcaXml(1, 10, 'Virman')).toContain('<Oznaka>Virman</Oznaka>');
});

test('iznos se zaokružuje na fene prije slanja', () => {
  const xml = buildUnosNovcaXml(1, 0.1 + 0.2);
  expect(xml).toContain('<Iznos>0.3</Iznos>');
});
