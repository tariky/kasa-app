import { test, expect, beforeAll, beforeEach } from 'bun:test';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { gunzipSync } from 'node:zlib';
import { Decrypter } from 'age-encryption';
import { napraviBackup, NEMA_BACKUPA, type BackupOkruzenje } from './backupTok';
import { R2Greska, type R2Pristup } from './r2';
import type { BackupDogadjaj, BackupStanje } from './backupRaspored';
import type { R2Podaci } from './licenca';

let identitet: string;
let R2: R2Podaci;
beforeAll(async () => {
  identitet = await generateIdentity();
  R2 = { accountId: 'acc', accessKeyId: 'K', secret: 'S', bucket: 'pazar-test', primalac: await identityToRecipient(identitet) };
});
const BAZA = new TextEncoder().encode('SQLite format 3\0 lažna baza');
const START = new Date('2026-09-25T08:00:00Z');
const min = (n: number) => new Date(START.getTime() + n * 60_000);

let sat: Date;
let stanje: BackupStanje;
let dogadjaji: BackupDogadjaj[];
let poslano: { r2: R2Pristup; kljuc: string; tijelo: Uint8Array }[];
let greskaSlanja: Error | null;
let o: BackupOkruzenje;

beforeEach(() => {
  sat = START;
  stanje = {};
  dogadjaji = [];
  poslano = [];
  greskaSlanja = null;
  o = {
    pristup: () => R2,
    citajStanje: () => stanje,
    pisiStanje: s => { stanje = s; },
    kopijaBaze: () => BAZA,
    async posalji(r2, kljuc, tijelo, napredak) {
      if (greskaSlanja) throw greskaSlanja;
      napredak(tijelo.length / 2, tijelo.length);
      napredak(tijelo.length, tijelo.length);
      poslano.push({ r2, kljuc, tijelo });
    },
    javi: d => { dogadjaji.push(d); },
    uredjaj: () => 'AAAA-BBBB-CCCC',
    sada: () => sat,
    endpoint: 'http://lazni',
  };
});

async function desifruj(f: Uint8Array) {
  const d = new Decrypter();
  d.addIdentity(identitet);
  return new Uint8Array(gunzipSync(await d.decrypt(f)));
}

test('bez backup-a u licenci: neaktivan, "Backup sada" odbija', async () => {
  o.pristup = () => null;
  const b = napraviBackup(o);
  expect(b.info()).toEqual({ aktivan: false, uToku: false });
  await expect(b.sada()).rejects.toThrow(NEMA_BACKUPA);
});

test('uspjeh: šifrovana baza pod imenom uređaj/vrijeme, događaji redom, stanje upisano', async () => {
  const b = napraviBackup(o);
  sat = min(2);
  const info = await b.sada();
  expect(poslano).toHaveLength(1);
  expect(poslano[0].kljuc).toBe('AAAA-BBBB-CCCC/2026-09-25T08-02-00Z.db.age');
  expect(poslano[0].r2).toMatchObject({ bucket: 'pazar-test', endpoint: 'http://lazni' });
  expect(await desifruj(poslano[0].tijelo)).toEqual(BAZA);
  expect(dogadjaji).toEqual([
    { faza: 'kopija', procenat: 0 },
    { faza: 'sifrovanje', procenat: 0 },
    { faza: 'slanje', procenat: 0 },
    { faza: 'slanje', procenat: 50 },
    { faza: 'slanje', procenat: 100 },
    { gotovo: min(2).toISOString() },
  ]);
  expect(stanje).toEqual({ zadnjiUspjeh: min(2).toISOString(), zadnjiPokusaj: min(2).toISOString() });
  expect(info).toEqual({
    aktivan: true, bucket: 'pazar-test', uToku: false,
    zadnjiUspjeh: min(2).toISOString(), sljedeci: min(182).toISOString(),
  });
});

test('403: čitljiva poruka, greška u stanju, greskaOd ostaje od prvog pada, uspjeh je briše', async () => {
  const b = napraviBackup(o);
  greskaSlanja = new R2Greska('R2 je odbio pristup (403 AccessDenied): Access Denied', 403);
  sat = min(2);
  const info = await b.sada();
  expect(info.greska).toBe('R2 pristup više ne važi — zatražite novu licencu');
  expect(dogadjaji.at(-1)).toEqual({ greska: 'R2 pristup više ne važi — zatražite novu licencu', trajnaGreska: false });
  expect(stanje.greskaOd).toBe(min(2).toISOString());

  greskaSlanja = new R2Greska('Nema veze s R2 (ECONNREFUSED)');
  sat = min(20);
  await b.sada();
  expect(stanje).toMatchObject({ greska: 'Nema veze s R2 (ECONNREFUSED)', greskaOd: min(2).toISOString(), zadnjiPokusaj: min(20).toISOString() });

  greskaSlanja = null;
  sat = min(40);
  await b.sada();
  expect(stanje).toEqual({ zadnjiUspjeh: min(40).toISOString(), zadnjiPokusaj: min(40).toISOString() });
});

test('trajna greška kad uspjeha nema duže od 24 h', async () => {
  stanje = { greska: 'x', greskaOd: min(-25 * 60).toISOString(), zadnjiPokusaj: min(-20).toISOString() };
  greskaSlanja = new Error('Nema veze s R2 (offline)');
  await napraviBackup(o).sada();
  expect(dogadjaji.at(-1)).toEqual({ greska: 'Nema veze s R2 (offline)', trajnaGreska: true });
});

test('pad kopije baze je obična greška backup-a', async () => {
  o.kopijaBaze = () => { throw new Error('disk pun'); };
  const info = await napraviBackup(o).sada();
  expect(info.greska).toBe('disk pun');
  expect(poslano).toHaveLength(0);
});

test('"Backup sada" dok backup teče: jedno slanje, isti rezultat', async () => {
  let pusti!: () => void;
  const ceka = new Promise<void>(r => { pusti = r; });
  const staro = o.posalji;
  o.posalji = async (...a) => { await ceka; return staro(...a); };
  const b = napraviBackup(o);
  const p1 = b.sada();
  const p2 = b.sada();
  expect(b.info().uToku).toBe(true);
  pusti();
  const [i1, i2] = await Promise.all([p1, p2]);
  expect(poslano).toHaveLength(1);
  expect(i1).toEqual(i2);
  expect(i1.uToku).toBe(false);
});

test('ništa iz okruženja ne izlazi kao izuzetak (kasa radi dalje)', async () => {
  o.citajStanje = () => { throw new SyntaxError('Unexpected end of JSON input'); };
  o.pisiStanje = () => { throw new Error('ENOSPC'); };
  o.javi = () => { throw new Error('prozor zatvoren'); };
  const b = napraviBackup(o);
  expect(b.info()).toMatchObject({ aktivan: true, uToku: false });
  await expect(b.sada()).resolves.toMatchObject({ aktivan: true });
  await expect(b.tick()).resolves.toBeUndefined();

  o.pristup = () => { throw new Error('licenca.json oštećen'); };
  expect(napraviBackup(o).info()).toEqual({ aktivan: false, uToku: false });
  await expect(napraviBackup(o).tick()).resolves.toBeUndefined();
});

test('tick: minut nakon starta, pa svaka 3 h; nakon pada za 15 min', async () => {
  const b = napraviBackup(o);
  await b.tick();
  expect(poslano).toHaveLength(0);
  sat = min(1);
  await b.tick();
  expect(poslano).toHaveLength(1);

  sat = min(1 + 179);
  await b.tick();
  expect(poslano).toHaveLength(1);
  greskaSlanja = new Error('offline');
  sat = min(1 + 180);
  await b.tick();
  expect(stanje.greska).toBe('offline');

  greskaSlanja = null;
  sat = min(181 + 14);
  await b.tick();
  expect(poslano).toHaveLength(1);
  sat = min(181 + 15);
  await b.tick();
  expect(poslano).toHaveLength(2);
});

test('tick ne radi ništa kad licenca izgubi backup', async () => {
  const b = napraviBackup(o);
  o.pristup = () => null;
  sat = min(10);
  await b.tick();
  expect(poslano).toHaveLength(0);
  expect(dogadjaji).toHaveLength(0);
});
