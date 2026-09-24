import { test, expect } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
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

/** Token s proizvoljnim payloadom (i onim koji izdajLicencu ne dozvoljava). */
function potpisi(payload: object): string {
  const tijelo = `PAZAR1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${tijelo}.${sign(null, Buffer.from(tijelo), privateKey).toString('base64url')}`;
}
const sada = new Date(2026, 9, 5);

test('moduli se čuvaju u tokenu, redom iz kataloga i bez duplikata', () => {
  const token = izdajLicencu({ ...osnovna, moduli: ['proizvodnja', 'ponude', 'ponude'] }, privateKey);
  expect(provjeriLicencu(token, publicKey, { sada })).toEqual({ ok: true, licenca: { ...osnovna, moduli: ['ponude', 'proizvodnja'] } });
});

test('prazna lista modula znači samo jezgro i ostaje prazna', () => {
  const token = izdajLicencu({ ...osnovna, moduli: [] }, privateKey);
  expect(procitajLicencu(token)).toEqual({ ...osnovna, moduli: [] });
});

test('stari token bez m nema polje moduli', () => {
  const token = potpisi({ k: osnovna.klijent, d: osnovna.vrijediDo, i: osnovna.izdana });
  expect(procitajLicencu(token)).toEqual(osnovna);
  expect('moduli' in procitajLicencu(token)!).toBe(false);
});

test('dopisan modul u payload ruši potpis', () => {
  const token = izdajLicencu({ ...osnovna, moduli: ['ponude'] }, privateKey);
  const [pre, , potpis] = token.split('.');
  const lazni = Buffer.from(JSON.stringify({ k: osnovna.klijent, d: osnovna.vrijediDo, i: osnovna.izdana, m: ['ponude', 'proizvodnja'] })).toString('base64url');
  expect(provjeriLicencu(`${pre}.${lazni}.${potpis}`, publicKey, { sada })).toEqual({ ok: false, razlog: 'potpis' });
});

test('izdavanje s nepoznatim modulom baca grešku', () => {
  expect(() => izdajLicencu({ ...osnovna, moduli: ['racunovodstvo' as never] }, privateKey)).toThrow('Nepoznat modul: racunovodstvo');
});

test('nepoznat modul u tokenu se ignoriše, m koji nije niz je greška formata', () => {
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: ['ponude', 'buducnost'] }))?.moduli).toEqual(['ponude']);
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: 'ponude' }))).toBeNull();
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: null }))).toBeNull();
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: [1] }))).toBeNull();
});
