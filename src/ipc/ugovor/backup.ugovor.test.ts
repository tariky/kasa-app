// Ugovor automatskog backup-a: backup:info, backup:sada i događaj
// backup:stanje, protiv lažnog S3 (PAZAR_BACKUP_ENDPOINT), nad oba backenda.
// Tijelo se dešifruje JS age-om i otvara kao baza — za Rust je to i interop.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { desifrujBackup } from '../../lib/backupFajl';
import { izdajLicencu, type R2Podaci } from '../../lib/licenca';
import { PORUKA_SAMO_ADMIN } from '../sesija';
import { otvoriBackend, prijavi, type Backend } from './backend';
import { BazaTesta } from './bazaTesta';
import { pokreniLaziS3, S3_KLJUC, S3_TAJNA, type LaziS3 } from './laziS3';
import { scenarij } from './scenarij';

const IME = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db\.age$/;

describe('backup:*', () => {
  let b: Backend;
  const baza = scenarij(() => b);
  let s3: LaziS3;
  let identitet: string;
  let r2: R2Podaci;

  beforeEach(async () => {
    s3 = pokreniLaziS3();
    process.env.PAZAR_BACKUP_ENDPOINT = s3.url;
    identitet = await generateIdentity();
    r2 = { accountId: 'ugovor', accessKeyId: S3_KLJUC, secret: S3_TAJNA, bucket: 'pazar-ugovor', primalac: await identityToRecipient(identitet) };
    b = await otvoriBackend();
  });

  afterEach(async () => {
    await b.close();
    s3.stop();
    delete process.env.PAZAR_BACKUP_ENDPOINT;
  });

  const stanjaBackupa = () => b.dogadjaji.filter(d => d.ime === 'backup:stanje').map(d => d.podaci as Record<string, unknown>);

  test('licenca bez backup-a: info neaktivan, backup:sada odbija, ništa se ne šalje', async () => {
    expect(await b.pozovi('backup:info')).toEqual({ aktivan: false, uToku: false });
    await expect(b.call('backup:sada')).rejects.toThrow('Automatski backup nije uključen u licencu.');
    expect(s3.zahtjevi).toHaveLength(0);
  });

  test('backup:sada šalje potpisanu, šifrovanu kopiju baze u bucket klijenta', async () => {
    b.postaviBackupLicencu(r2);
    baza.kupac({ naziv: 'Kupac iz backup-a', idBroj: '4200000000000' });

    const info = await b.pozovi('backup:sada');
    expect(info.aktivan).toBe(true);
    expect(info.bucket).toBe('pazar-ugovor');
    expect(info.uToku).toBe(false);
    expect(typeof info.zadnjiUspjeh).toBe('string');
    expect(typeof info.sljedeci).toBe('string');
    expect(info.greska).toBeUndefined();

    expect(s3.zahtjevi).toHaveLength(1);
    const z = s3.zahtjevi[0];
    expect(z).toMatchObject({ metoda: 'PUT', bucket: 'pazar-ugovor', potpisIspravan: true, hashIspravan: true });
    expect(z.kljuc).toMatch(IME);
    // R2 odbija chunked PUT: dužina mora ići unaprijed (lažni S3 bi primio i chunked).
    expect(z.duzina).toBe(z.tijelo.length);

    const fajl = path.join(b.radniFolder, 'vraceno.db');
    writeFileSync(fajl, await desifrujBackup(z.tijelo, identitet));
    const vraceno = new BazaTesta(fajl, { readonly: true });
    expect(vraceno.prepare("SELECT naziv FROM kupci WHERE idBroj = '4200000000000'").get()).toEqual({ naziv: 'Kupac iz backup-a' });
    expect(vraceno.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    vraceno.close();

    const st = stanjaBackupa();
    expect(st[0]).toEqual({ faza: 'kopija', procenat: 0 });
    expect(st.map(s => s.faza).filter(Boolean)).toEqual(expect.arrayContaining(['kopija', 'sifrovanje', 'slanje']));
    expect(st.at(-1)).toEqual({ gotovo: info.zadnjiUspjeh });

    expect(await b.pozovi('backup:info')).toMatchObject({ zadnjiUspjeh: info.zadnjiUspjeh });
  });

  test('R2 odbije (403): poruka za korisnika, greška u info i događaju, kasa radi dalje', async () => {
    b.postaviBackupLicencu(r2);
    s3.status = 403;
    const info = await b.pozovi('backup:sada');
    expect(info.greska).toBe('R2 pristup više ne važi — zatražite novu licencu');
    expect(typeof info.greskaOd).toBe('string');
    expect(stanjaBackupa().at(-1)).toEqual({ greska: 'R2 pristup više ne važi — zatražite novu licencu', trajnaGreska: false });
    expect(await b.pozovi('user:getAll')).toBeArray();
  });

  test('pomjeren sat (403 RequestTimeTooSkewed): poruka o satu, ne o licenci', async () => {
    b.postaviBackupLicencu(r2);
    s3.status = 403;
    s3.kod = 'RequestTimeTooSkewed';
    const info = await b.pozovi('backup:sada');
    const poruka = 'Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.';
    expect(info.greska).toBe(poruka);
    expect(stanjaBackupa().at(-1)).toEqual({ greska: poruka, trajnaGreska: false });
  });

  test('server nedostupan: greška, bez izuzetka', async () => {
    b.postaviBackupLicencu(r2);
    s3.stop();
    const info = await b.pozovi('backup:sada');
    expect(info.greska).toStartWith('Nema veze s R2');
  });

  test('dva backup:sada odjednom: jedno slanje, isti odgovor', async () => {
    b.postaviBackupLicencu(r2);
    const [a, c] = await Promise.all([b.pozovi('backup:sada'), b.pozovi('backup:sada')]);
    expect(s3.zahtjevi).toHaveLength(1);
    expect(a).toEqual(c);
  });

  test('aktivacija licence s backup-om odmah pokreće prvi backup', async () => {
    b.postaviBackupLicencu(r2);
    await b.call('licenca:aktiviraj', 'PAZAR1.x.y');
    for (let i = 0; i < 100 && !stanjaBackupa().some(s => 'gotovo' in s); i++) await Bun.sleep(20);
    expect(s3.zahtjevi).toHaveLength(1);
  });

  test('temp kopija baze se briše i nakon uspjeha i nakon greške', async () => {
    const temp = () => readdirSync(tmpdir()).filter(f => f.startsWith('pazar-backup-'));
    const prije = temp().length;
    b.postaviBackupLicencu(r2);
    await b.call('backup:sada');
    s3.status = 500;
    await b.call('backup:sada');
    expect(temp().length).toBe(prije);
  });

  test('kasir vidi backup:info, a backup:sada je samo za administratora', async () => {
    b.postaviBackupLicencu(r2);
    baza.korisnik('Kasir', '1234');
    await prijavi(b, '1234');
    expect((await b.pozovi('backup:info')).aktivan).toBe(true);
    await expect(b.call('backup:sada')).rejects.toThrow(PORUKA_SAMO_ADMIN);
    expect(s3.zahtjevi).toHaveLength(0);
  });

  test('dok backup šalje, kasa radi (slanje ne drži red poziva)', async () => {
    b.postaviBackupLicencu(r2);
    s3.odgodaMs = 1500;
    let gotov = false;
    const backup = b.pozovi('backup:sada').then(i => { gotov = true; return i; });
    for (let i = 0; i < 200 && !stanjaBackupa().some(s => s.faza === 'slanje'); i++) await Bun.sleep(10);
    expect(stanjaBackupa().some(s => s.faza === 'slanje')).toBe(true);

    expect(await b.pozovi('user:getAll')).toBeArray();
    expect(gotov).toBe(false);
    expect((await backup).greska).toBeUndefined();
  });

  const fajlStanja = () => path.join(b.radniFolder, '..', 'backup-stanje.json');

  test('backup-stanje.json iz Electron verzije: raspored se nastavlja', async () => {
    const uspjeh = new Date(Date.now() - 60 * 60_000).toISOString();
    writeFileSync(fajlStanja(), JSON.stringify({ zadnjiUspjeh: uspjeh, zadnjiPokusaj: uspjeh }, null, 2));
    b.postaviBackupLicencu(r2);
    const info = await b.pozovi('backup:info');
    expect(info.zadnjiUspjeh).toBe(uspjeh);
    expect(info.sljedeci).toBe(new Date(Date.parse(uspjeh) + 3 * 60 * 60_000).toISOString());
    expect(info.greska).toBeUndefined();
  });

  test('pokvaren backup-stanje.json: kao da backup-a nije bilo, backup prolazi i prepiše ga', async () => {
    writeFileSync(fajlStanja(), '{pokvaren');
    b.postaviBackupLicencu(r2);
    expect((await b.pozovi('backup:info')).zadnjiUspjeh).toBeUndefined();
    const info = await b.pozovi('backup:sada');
    expect(info.greska).toBeUndefined();
    expect(JSON.parse(readFileSync(fajlStanja(), 'utf8'))).toEqual({ zadnjiUspjeh: info.zadnjiUspjeh, zadnjiPokusaj: expect.any(String) });
  });
});

// Harness zaobilazi token (postaviBackupLicencu), pa ovdje posebno: token koji
// izdaje generator (TS) backend mora pročitati u iste R2 podatke. Za Rust je to
// jedini dokaz da AES-GCM dešifrovanje iz licence radi kao u Electronu.
describe('R2 podaci iz licence (TS izdaje, backend čita)', () => {
  let b: Backend;
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });
  afterEach(async () => { await b.close(); });

  const licenca = { klijent: 'Ugovor d.o.o.', vrijediDo: '2099-12-31', izdana: '2026-09-27', backup: { bucket: 'pazar-ugovor' } };
  const potpis = () => generateKeyPairSync('ed25519').privateKey;

  test('token s backup-om daje iste R2 podatke', async () => {
    const r2: R2Podaci = {
      accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'KLJUČ-ugovor', secret: 'tajna/+=ugovor',
      bucket: 'pazar-ugovor', primalac: await identityToRecipient(await generateIdentity()),
    };
    expect(await b.r2IzTokena(izdajLicencu(licenca, potpis(), r2))).toEqual(r2);
  });

  test('token bez backup-a ili s pokvarenim b.x: null', async () => {
    const { backup: _, ...bezBackupa } = licenca;
    expect(await b.r2IzTokena(izdajLicencu(bezBackupa, potpis()))).toBeNull();

    const r2: R2Podaci = { accountId: 'a', accessKeyId: 'k', secret: 's', bucket: 'pazar-ugovor', primalac: 'age1xyz' };
    const [prefiks, payload, sig] = izdajLicencu(licenca, potpis(), r2).split('.');
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const x: string = p.b.x;
    p.b.x = x.slice(0, 20) + (x[20] === 'A' ? 'B' : 'A') + x.slice(21);
    expect(await b.r2IzTokena(`${prefiks}.${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`)).toBeNull();
  });
});
