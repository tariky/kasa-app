// Ugovor automatskog backup-a: backup:info, backup:sada i događaj
// backup:stanje, protiv lažnog S3 (PAZAR_BACKUP_ENDPOINT). Tijelo se
// dešifruje JS age-om i otvara kao baza — za Rust (faza 4) to je i interop.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { desifrujBackup } from '../../lib/backupFajl';
import { hesirajPin } from '../../lib/korisnici';
import type { R2Podaci } from '../../lib/licenca';
import { PORUKA_SAMO_ADMIN } from '../sesija';
import { otvoriBackend, prijavi, type Backend } from './backend';
import { pokreniLaziS3, S3_KLJUC, S3_TAJNA, type LaziS3 } from './laziS3';

const IME = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db\.age$/;

// Rust backend dobija backup:* u fazi 4 — do tada ovaj ugovor važi samo za TS.
describe.skipIf(process.env.KASA_BACKEND === 'rust')('backup:*', () => {
  let b: Backend;
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

  function dodajKorisnika(ime: string, pin: string, uloga: 'admin' | 'kasir' = 'kasir'): number {
    return Number(b.db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, hesirajPin(pin), uloga).lastInsertRowid);
  }

  test('licenca bez backup-a: info neaktivan, backup:sada odbija, ništa se ne šalje', async () => {
    expect(await b.call('backup:info')).toEqual({ aktivan: false, uToku: false });
    await expect(b.call('backup:sada')).rejects.toThrow('Automatski backup nije uključen u licencu.');
    expect(s3.zahtjevi).toHaveLength(0);
  });

  test('backup:sada šalje potpisanu, šifrovanu kopiju baze u bucket klijenta', async () => {
    b.postaviBackupLicencu(r2);
    b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac iz backup-a', '4200000000000')").run();

    const info = await b.call('backup:sada');
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

    const fajl = path.join(b.radniFolder, 'vraceno.db');
    writeFileSync(fajl, await desifrujBackup(z.tijelo, identitet));
    const vraceno = new Database(fajl, { readonly: true });
    expect(vraceno.prepare("SELECT naziv FROM kupci WHERE idBroj = '4200000000000'").get()).toEqual({ naziv: 'Kupac iz backup-a' });
    expect(vraceno.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    vraceno.close();

    const st = stanjaBackupa();
    expect(st[0]).toEqual({ faza: 'kopija', procenat: 0 });
    expect(st.map(s => s.faza).filter(Boolean)).toEqual(expect.arrayContaining(['kopija', 'sifrovanje', 'slanje']));
    expect(st.at(-1)).toEqual({ gotovo: info.zadnjiUspjeh });

    expect(await b.call('backup:info')).toMatchObject({ zadnjiUspjeh: info.zadnjiUspjeh });
  });

  test('R2 odbije (403): poruka za korisnika, greška u info i događaju, kasa radi dalje', async () => {
    b.postaviBackupLicencu(r2);
    s3.status = 403;
    const info = await b.call('backup:sada');
    expect(info.greska).toBe('R2 pristup više ne važi — zatražite novu licencu');
    expect(typeof info.greskaOd).toBe('string');
    expect(stanjaBackupa().at(-1)).toEqual({ greska: 'R2 pristup više ne važi — zatražite novu licencu', trajnaGreska: false });
    expect(await b.call('user:getAll')).toBeArray();
  });

  test('server nedostupan: greška, bez izuzetka', async () => {
    b.postaviBackupLicencu(r2);
    s3.stop();
    const info = await b.call('backup:sada');
    expect(info.greska).toStartWith('Nema veze s R2');
  });

  test('dva backup:sada odjednom: jedno slanje, isti odgovor', async () => {
    b.postaviBackupLicencu(r2);
    const [a, c] = await Promise.all([b.call('backup:sada'), b.call('backup:sada')]);
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
    dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    expect((await b.call('backup:info')).aktivan).toBe(true);
    await expect(b.call('backup:sada')).rejects.toThrow(PORUKA_SAMO_ADMIN);
    expect(s3.zahtjevi).toHaveLength(0);
  });
});
