import { test, expect } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { izdajLicencu, provjeriLicencu, procitajLicencu } from './licenca';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const tudji = generateKeyPairSync('ed25519');

const osnovna = { klijent: 'Pekara Šeher', vrijediDo: '2026-10-31', izdana: '2026-10-01' };

test('ispravan token prolazi provjeru do zadnjeg dana uključivo', () => {
  const token = izdajLicencu(osnovna, privateKey);
  const r = provjeriLicencu(token, publicKey, { sada: new Date(2026, 9, 31, 23, 59) });
  expect(r).toEqual({ ok: true, licenca: osnovna });
});

test('dan poslije isteka token je istekao', () => {
  const token = izdajLicencu(osnovna, privateKey);
  const r = provjeriLicencu(token, publicKey, { sada: new Date(2026, 10, 1, 0, 1) });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.razlog).toBe('istekla');
});

test('izmijenjen datum u payloadu ruši potpis', () => {
  const token = izdajLicencu(osnovna, privateKey);
  const [pre, , potpis] = token.split('.');
  const lazni = Buffer.from(JSON.stringify({ k: 'Pekara Šeher', d: '2099-12-31', i: '2026-10-01' })).toString('base64url');
  const r = provjeriLicencu(`${pre}.${lazni}.${potpis}`, publicKey, { sada: new Date(2026, 9, 5) });
  expect(r).toEqual({ ok: false, razlog: 'potpis' });
});

test('token potpisan tuđim ključem ne prolazi', () => {
  const token = izdajLicencu(osnovna, tudji.privateKey);
  expect(provjeriLicencu(token, publicKey, { sada: new Date(2026, 9, 5) })).toEqual({ ok: false, razlog: 'potpis' });
});

test('licenca vezana za uređaj ne važi na drugom', () => {
  const token = izdajLicencu({ ...osnovna, uredjaj: 'kasa-1' }, privateKey);
  const sada = new Date(2026, 9, 5);
  expect(provjeriLicencu(token, publicKey, { sada, uredjaj: 'kasa-1' }).ok).toBe(true);
  const r = provjeriLicencu(token, publicKey, { sada, uredjaj: 'kasa-2' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.razlog).toBe('uredjaj');
});

test('smeće i razmaci oko tokena', () => {
  expect(provjeriLicencu('nije token', publicKey)).toEqual({ ok: false, razlog: 'format' });
  const token = izdajLicencu(osnovna, privateKey);
  expect(procitajLicencu(`  ${token}\n`)).toEqual(osnovna);
});
