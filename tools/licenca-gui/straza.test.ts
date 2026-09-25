import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { istiToken, noviToken, provjeriZahtjev, TOKEN_HEADER } from './straza';

const port = 4747;
const token = noviToken();
const opcije = { port, token };
const nas = `http://127.0.0.1:${port}`;

function zahtjev(put: string, { host = `127.0.0.1:${port}`, metoda = 'GET', zaglavlja = {} as Record<string, string> } = {}) {
  return new Request(`${nas}${put}`, { method: metoda, headers: { host, ...zaglavlja }, body: metoda === 'POST' ? '{}' : undefined });
}
const post = (put: string, zaglavlja: Record<string, string>, host?: string) => zahtjev(put, { metoda: 'POST', zaglavlja, host });
const ispravanPost = { origin: nas, 'content-type': 'application/json', [TOKEN_HEADER]: token };

describe('provjeriZahtjev', () => {
  test('Host mora biti 127.0.0.1:<port> ili localhost:<port>', () => {
    expect(provjeriZahtjev(zahtjev('/'), opcije)).toBeNull();
    expect(provjeriZahtjev(zahtjev('/', { host: `localhost:${port}` }), opcije)).toBeNull();
    // DNS rebinding: napadačev domen pokazuje na 127.0.0.1, ali Host ostaje njegov.
    for (const host of ['napadac.example', `napadac.example:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `localhost.napadac.example:${port}`, `[::1]:${port}`]) {
      expect(provjeriZahtjev(zahtjev('/', { host }), opcije)?.status).toBe(403);
      expect(provjeriZahtjev(zahtjev('/api/stanje', { host, zaglavlja: { [TOKEN_HEADER]: token } }), opcije)?.status).toBe(403);
    }
  });

  test('POST traži vlastiti Origin', () => {
    expect(provjeriZahtjev(post('/api/izdaj', ispravanPost), opcije)).toBeNull();
    expect(provjeriZahtjev(post('/api/izdaj', { ...ispravanPost, origin: `http://localhost:${port}` }, `localhost:${port}`), opcije)).toBeNull();
    for (const origin of [undefined, 'null', 'https://napadac.example', `http://localhost:${port}`, `https://127.0.0.1:${port}`, `http://127.0.0.1:${port + 1}`]) {
      const z = { ...ispravanPost } as Record<string, string>;
      if (origin === undefined) delete z.origin; else z.origin = origin;
      expect(provjeriZahtjev(post('/api/izdaj', z), opcije)?.status).toBe(403);
    }
    // I metode osim GET/HEAD.
    expect(provjeriZahtjev(zahtjev('/api/izdaj', { metoda: 'PUT', zaglavlja: { [TOKEN_HEADER]: token } }), opcije)?.status).toBe(403);
  });

  test('POST traži Content-Type: application/json', () => {
    expect(provjeriZahtjev(post('/api/izdaj', { ...ispravanPost, 'content-type': 'application/json; charset=utf-8' }), opcije)).toBeNull();
    // Obična HTML forma s tuđe stranice šalje ove tipove bez CORS preflighta.
    for (const tip of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', '']) {
      expect(provjeriZahtjev(post('/api/izdaj', { ...ispravanPost, 'content-type': tip }), opcije)?.status).toBe(415);
    }
  });

  test('/api/* traži token iz linka, stranica ne', () => {
    expect(provjeriZahtjev(zahtjev('/'), opcije)).toBeNull();
    expect(provjeriZahtjev(zahtjev('/api/stanje', { zaglavlja: { [TOKEN_HEADER]: token } }), opcije)).toBeNull();
    for (const t of [undefined, '', 'x', token.slice(0, -1), `${token}x`, noviToken()]) {
      const z: Record<string, string> = t === undefined ? {} : { [TOKEN_HEADER]: t };
      expect(provjeriZahtjev(zahtjev('/api/stanje', { zaglavlja: z }), opcije)?.status).toBe(401);
      expect(provjeriZahtjev(post('/api/izdaj', { ...ispravanPost, [TOKEN_HEADER]: t ?? '' }), opcije)?.status).toBe(401);
    }
    // Ni zaobilazni putevi do API-ja bez tokena.
    for (const put of ['/%61pi/stanje', '/api/../api/stanje', '//api/stanje', '/index.html']) {
      expect(provjeriZahtjev(zahtjev(put), opcije)?.status).toBe(401);
    }
  });

  test('istiToken', () => {
    expect(istiToken(token, token)).toBe(true);
    expect(istiToken(null, token)).toBe(false);
    expect(istiToken('', token)).toBe(false);
    expect(istiToken(token.toUpperCase() === token ? 'a' : token.toUpperCase(), token)).toBe(false);
    expect(noviToken()).not.toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });
});

// Pravi server na slučajnom portu, s privremenim ključem (ne dira ~/.pazar-licenca).
describe('server', () => {
  let dir: string;
  let proces: ReturnType<typeof Bun.spawn>;
  let url: URL;
  let tok: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pazar-licenca-gui-'));
    const kljuc = join(dir, 'privatni.pem');
    writeFileSync(kljuc, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    proces = Bun.spawn(['bun', join(import.meta.dir, 'server.ts')], {
      env: { ...process.env, PORT: '0', BEZ_BROWSERA: '1', PAZAR_LICENCA_KLJUC: kljuc, PAZAR_BACKUP_KLJUC: join(dir, 'backup-kljuc.txt') },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const citac = (proces.stdout as ReadableStream<Uint8Array>).getReader();
    let ispis = '';
    while (!ispis.includes('\n')) {
      const { value, done } = await citac.read();
      if (done) break;
      ispis += new TextDecoder().decode(value);
    }
    citac.releaseLock();
    const link = ispis.match(/(http:\/\/127\.0\.0\.1:\d+\/#t=[A-Za-z0-9_-]+)/)?.[1];
    if (!link) throw new Error(`Server nije ispisao link: ${ispis}`);
    url = new URL(link);
    tok = new URLSearchParams(url.hash.slice(1)).get('t')!;
  });

  afterAll(() => {
    proces?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  const adresa = (put: string) => new URL(put, url.origin).href;

  test('stranica se servira bez tokena, s zaglavljima protiv ugradnje', async () => {
    const r = await fetch(adresa('/'));
    expect(r.status).toBe(200);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(await r.text()).toContain('x-pazar-token');
  });

  test('API radi samo s tokenom iz ispisanog linka', async () => {
    expect((await fetch(adresa('/api/stanje'))).status).toBe(401);
    expect((await fetch(adresa('/api/stanje'), { headers: { 'x-pazar-token': 'pogresan' } })).status).toBe(401);
    const r = await fetch(adresa('/api/stanje'), { headers: { 'x-pazar-token': tok } });
    expect(r.status).toBe(200);
    expect((await r.json()).izdane).toEqual([]);
  });

  test('tuđi Host se odbija (DNS rebinding)', async () => {
    const r = await fetch(adresa('/api/stanje'), { headers: { 'x-pazar-token': tok, host: `napadac.example:${url.port}` } });
    expect(r.status).toBe(403);
  });

  test('POST s tuđim Origin-om ili bez JSON-a se odbija', async () => {
    const tijelo = JSON.stringify({ token: 'PAZAR1.x.y' });
    const z = { 'x-pazar-token': tok, 'content-type': 'application/json', origin: url.origin };
    expect((await fetch(adresa('/api/provjeri'), { method: 'POST', headers: z, body: tijelo })).status).toBe(400);
    expect((await fetch(adresa('/api/provjeri'), { method: 'POST', headers: { ...z, origin: 'https://napadac.example' }, body: tijelo })).status).toBe(403);
    expect((await fetch(adresa('/api/provjeri'), { method: 'POST', headers: { ...z, 'content-type': 'text/plain' }, body: tijelo })).status).toBe(415);
    expect((await fetch(adresa('/api/provjeri'), { method: 'POST', headers: z, body: 'nije json' })).status).toBe(400);
  });

  test('nova licenca bez ID-a uređaja traži izričit izbor "bilo koji"', async () => {
    const z = { 'x-pazar-token': tok, 'content-type': 'application/json', origin: url.origin };
    const izdaj = (b: object) => fetch(adresa('/api/izdaj'), { method: 'POST', headers: z, body: JSON.stringify({ klijent: 'Test', dana: 31, moduli: [], ...b }) });
    const bez = await izdaj({ uredjaj: '' });
    expect(bez.status).toBe(400);
    expect((await bez.json()).greska).toContain('bilo koji');
    const vezana = await (await izdaj({ uredjaj: 'AAAA-BBBB-CCCC' })).json();
    expect(vezana.uredjaj).toBe('AAAA-BBBB-CCCC');
    const bilo = await (await izdaj({ uredjaj: '', biloKojiUredjaj: true })).json();
    expect(bilo.token).toStartWith('PAZAR1.');
    expect('uredjaj' in bilo).toBe(false);
  });
});
