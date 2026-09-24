import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import katalog from './moduliKatalog.json';
import { LICENCIRANI_MODULI, KANALI_MODULA, licenciraniModuli, modulVanLicence, stanjeModula, opisModula } from './moduli';
import type { StanjeLicence } from './licencaTipovi';

const licenca = { klijent: 'F', vrijediDo: '2026-12-31', izdana: '2026-01-01' };
const aktivna = (moduli?: string[]): StanjeLicence =>
  ({ stanje: 'aktivna', danaDoIsteka: 30, licenca: { ...licenca, ...(moduli ? { moduli } : {}) } }) as StanjeLicence;
const sve = { skladiste: true, ponude: true, proizvodnja: true, generator: true };

test('katalog i TS tip imaju iste module', () => {
  expect(katalog.moduli).toEqual(['skladiste', 'ponude', 'proizvodnja', 'generator']);
  expect(Object.keys(katalog.nazivi).sort()).toEqual([...LICENCIRANI_MODULI].sort());
  for (const moduli of Object.values(KANALI_MODULA)) for (const m of moduli) expect(LICENCIRANI_MODULI).toContain(m);
});

test('svaki kanal iz kataloga postoji u handlers.ts', () => {
  const handlers = readFileSync(path.join(__dirname, '../ipc/handlers.ts'), 'utf8');
  for (const kanal of Object.keys(KANALI_MODULA)) expect(handlers).toContain(`handle('${kanal}'`);
});

test('stari token i stanje bez licence daju sve module', () => {
  expect(licenciraniModuli(aktivna())).toEqual(sve);
  expect(licenciraniModuli({ stanje: 'nema' })).toEqual(sve);
  expect(licenciraniModuli({ stanje: 'neispravna', razlog: 'potpis' })).toEqual(sve);
});

test('licenca s listom daje samo te module, i kad je zaključana', () => {
  expect(licenciraniModuli(aktivna(['ponude']))).toEqual({ skladiste: false, ponude: true, proizvodnja: false, generator: false });
  expect(licenciraniModuli({ stanje: 'zakljucana', licenca: { ...licenca, moduli: [] } })).toEqual({ skladiste: false, ponude: false, proizvodnja: false, generator: false });
});

test('kanal nelicenciranog modula je blokiran, jezgro i čitanje nisu', () => {
  const s = aktivna(['proizvodnja']);
  expect(modulVanLicence(s, 'ponuda:create')).toBe('ponude');
  expect(modulVanLicence(s, 'nalog:createIzPonude')).toBe('ponude');
  expect(modulVanLicence(s, 'nalog:create')).toBeNull();
  expect(modulVanLicence(s, 'ponuda:getAll')).toBeNull();
  expect(modulVanLicence(s, 'order:create')).toBeNull();
  expect(modulVanLicence(aktivna(), 'nalog:createIzPonude')).toBeNull();
  // Ključevi s prototipa objekta nisu kanali modula.
  expect(modulVanLicence(aktivna([]), 'constructor')).toBeNull();
});

test('proizvodnja i generator traže i postavku, veza traži oba modula', () => {
  const lic = licenciraniModuli(aktivna(['ponude', 'proizvodnja']));
  expect(stanjeModula(lic, { proizvodnja: false, generator: true })).toEqual({
    licencirani: lic,
    ukljuceni: { skladiste: false, ponude: true, proizvodnja: false, generator: false },
    vezaPonudaNalog: false,
  });
  expect(stanjeModula(lic, { proizvodnja: true, generator: false }).vezaPonudaNalog).toBe(true);
  expect(stanjeModula(licenciraniModuli(aktivna(['proizvodnja'])), { proizvodnja: true, generator: false }).vezaPonudaNalog).toBe(false);
});

test('opis modula za prikaz', () => {
  expect(opisModula(undefined)).toBe('svi (bez ograničenja)');
  expect(opisModula([])).toBe('samo osnovni');
  expect(opisModula(['skladiste', 'ponude'])).toBe('Skladište, Ponude');
});
