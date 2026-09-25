import { test, expect } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { izdajLicencu, provjeriLicencu, procitajLicencu, backupPodaci } from './licenca';

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

const r2 = {
  accountId: '0123456789abcdef0123456789abcdef',
  accessKeyId: 'AKIDabcdef0123456789abcdef012345',
  secret: 'tajna0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  bucket: 'pazar-pekara-seher',
  primalac: 'age1xysxk850805p27sr69wc9a6f6dfu76m4ld9zae0cehcdwtl9rulsfuwfxp',
};

test('backup: licenca nosi ime bucketa, a R2 pristup samo šifrovan', () => {
  const token = izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey, r2);
  expect(provjeriLicencu(token, publicKey, { sada })).toEqual({ ok: true, licenca: { ...osnovna, backup: { bucket: 'pazar-pekara-seher' } } });
  const payload = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
  for (const tajno of [r2.secret, r2.accessKeyId, r2.accountId]) expect(payload).not.toContain(tajno);
  expect(backupPodaci(token)).toEqual(r2);
});

test('backup: licenca bez backup-a nema ni polje ni podatke', () => {
  const token = izdajLicencu(osnovna, privateKey, r2);
  expect('backup' in procitajLicencu(token)!).toBe(false);
  expect(backupPodaci(token)).toBeNull();
  expect(backupPodaci('smeće')).toBeNull();
});

test('backup: izdavanje traži R2 podatke za isti bucket i ispravno ime', () => {
  expect(() => izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey)).toThrow('R2 podaci');
  expect(() => izdajLicencu({ ...osnovna, backup: { bucket: 'Pekara Šeher' } }, privateKey, { ...r2, bucket: 'Pekara Šeher' })).toThrow('Ime bucketa');
  expect(() => izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey, { ...r2, bucket: 'drugi-bucket' })).toThrow('bucket');
  expect(() => izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey, { ...r2, primalac: 'xyz' })).toThrow('age1');
  expect(() => izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey, { ...r2, secret: ' ' })).toThrow('potpuni');
});

test('backup: pokvaren b se ignoriše, licenca i dalje važi', () => {
  const b = (x: unknown) => potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', b: x });
  for (const los of [null, 'x', { c: 'Loš Bucket', x: 'abc' }, { c: 'dobar-bucket' }, { c: 'ab', x: 'abc' }]) {
    expect(provjeriLicencu(b(los), publicKey, { sada })).toEqual({ ok: true, licenca: { klijent: 'F', vrijediDo: '2026-10-31', izdana: '2026-10-01' } });
  }
  expect(procitajLicencu(b({ c: 'dobar-bucket', x: 'neispravno' }))?.backup).toEqual({ bucket: 'dobar-bucket' });
  expect(backupPodaci(b({ c: 'dobar-bucket', x: 'neispravno' }))).toBeNull();
});

test('backup: dopisan backup u payload ruši potpis', () => {
  const tudjiToken = izdajLicencu({ ...osnovna, backup: { bucket: r2.bucket } }, privateKey, r2);
  const tudjeB = JSON.parse(Buffer.from(tudjiToken.split('.')[1], 'base64url').toString('utf8')).b;
  const [pre, , potpis] = izdajLicencu(osnovna, privateKey).split('.');
  const lazni = Buffer.from(JSON.stringify({ k: osnovna.klijent, d: osnovna.vrijediDo, i: osnovna.izdana, b: tudjeB })).toString('base64url');
  expect(provjeriLicencu(`${pre}.${lazni}.${potpis}`, publicKey, { sada })).toEqual({ ok: false, razlog: 'potpis' });
});

test('d, i i u moraju biti stringovi — inače je token neispravan', () => {
  const osn = { k: 'F', d: '2026-10-31', i: '2026-10-01' };
  // ['2026-10-31'] bi kroz regex (String(niz)) prošao kao datum.
  for (const los of [{ d: ['2026-10-31'] }, { i: ['2026-10-01'] }, { d: 20261031 }, { u: 1 }, { u: ['A'] }, { u: { x: 1 } }, { u: null }, { u: true }]) {
    const token = potpisi({ ...osn, ...los });
    expect(procitajLicencu(token)).toBeNull();
    expect(provjeriLicencu(token, publicKey, { sada })).toEqual({ ok: false, razlog: 'format' });
  }
  // Prazan u (kao i bez u) znači "bilo koji uređaj", kao u Rustu.
  expect(provjeriLicencu(potpisi({ ...osn, u: '' }), publicKey, { sada, uredjaj: 'X' }).ok).toBe(true);
});

test('potpis mora biti tačno 64 bajta u kanonskom base64url, bez viška', () => {
  const token = izdajLicencu(osnovna, privateKey);
  const [pre, payload, potpis] = token.split('.');
  expect(potpis).toHaveLength(86);
  const saPotpisom = (p: string) => provjeriLicencu(`${pre}.${payload}.${p}`, publicKey, { sada });
  expect(saPotpisom(potpis).ok).toBe(true);
  // Node bi višak na kraju, padding, razmak ili drugačije zadnje bitove tiho progutao.
  const zadnji = potpis.at(-1)!;
  const drugiZadnji = { A: 'B', Q: 'R', g: 'h', w: 'x' }[zadnji as 'A'];
  for (const los of [`${potpis}A`, `${potpis}AA`, `${potpis}==`, `${potpis.slice(0, 40)} ${potpis.slice(40)}`,
    potpis.slice(0, -1) + drugiZadnji, potpis.replace(/-/g, '+').replace(/_/g, '/'), potpis.slice(0, -2), ''].filter(p => p !== potpis)) {
    expect(saPotpisom(los)).toEqual({ ok: false, razlog: 'potpis' });
  }
});
