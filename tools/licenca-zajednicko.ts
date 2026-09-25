// Zajedničko CLI-ju i GUI-ju: gdje je privatni ključ, izdavanje s
// provjerom i dnevnik izdanih licenci.
import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { izdajLicencu, provjeriLicencu, lokalniDatum, Licenca, type R2Podaci } from '../src/lib/licenca';

export interface BackupUnos {
  bucket: string;
  /** Prazno = spremljeni ključevi tog bucketa. */
  accessKeyId?: string;
  secret?: string;
}
import { normalizujModule, type Modul } from '../src/lib/moduli';

export const PRIVATNI = process.env.PAZAR_LICENCA_KLJUC ?? join(homedir(), '.pazar-licenca', 'privatni.pem');
const DNEVNIK = join(dirname(PRIVATNI), 'izdane.jsonl');
/** Cloudflare account ID — isti za sve buckete. */
export const R2_FAJL = join(dirname(PRIVATNI), 'r2.json');
/** Bucket po klijentu: pristup (token samo za taj bucket) za izdavanje i povrat. */
export const BUCKETI_FAJL = join(dirname(PRIVATNI), 'r2-bucketi.json');
/** age par za backup-e (format kao age-keygen); javni ide u licencu. */
export const BACKUP_KLJUC = process.env.PAZAR_BACKUP_KLJUC ?? join(dirname(PRIVATNI), 'backup-kljuc.txt');

export interface BucketKlijenta {
  klijent: string;
  accessKeyId: string;
  secret: string;
}

function citajJson<T>(put: string, prazno: T): T {
  return existsSync(put) ? (JSON.parse(readFileSync(put, 'utf8')) as T) : prazno;
}

function pisiTajno(put: string, v: unknown) {
  mkdirSync(dirname(put), { recursive: true });
  writeFileSync(put, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
  chmodSync(put, 0o600);
}

export function ucitajAccountId(): string | null {
  return citajJson<{ accountId?: string }>(R2_FAJL, {}).accountId ?? null;
}

export function spremiAccountId(accountId: string) {
  const cist = accountId.trim();
  if (!/^[0-9a-f]{32}$/i.test(cist)) throw new Error('Account ID je 32 heksadecimalna znaka (Cloudflare → R2 → desno "Account ID")');
  pisiTajno(R2_FAJL, { accountId: cist });
}

export function ucitajBuckete(): Record<string, BucketKlijenta> {
  return citajJson<Record<string, BucketKlijenta>>(BUCKETI_FAJL, {});
}

/**
 * Pristup za bucket: novi ključevi se spremaju, prazni znače "koristi spremljene".
 * Bucket drugog klijenta se odbija — backup-i dva klijenta ne smiju se miješati.
 */
export function pristupBucketu(bucket: string, klijent: string, accessKeyId?: string, secret?: string): BucketKlijenta {
  const bucketi = ucitajBuckete();
  const stari = bucketi[bucket];
  if (stari && stari.klijent !== klijent) throw new Error(`Bucket ${bucket} već koristi klijent "${stari.klijent}"`);
  const novi: BucketKlijenta = {
    klijent,
    accessKeyId: accessKeyId?.trim() || stari?.accessKeyId || '',
    secret: secret?.trim() || stari?.secret || '',
  };
  if (!novi.accessKeyId || !novi.secret) throw new Error(`Upiši Access Key ID i Secret za bucket ${bucket}`);
  if (!stari || stari.accessKeyId !== novi.accessKeyId || stari.secret !== novi.secret) {
    pisiTajno(BUCKETI_FAJL, { ...bucketi, [bucket]: novi });
  }
  return novi;
}

/** Privatni age ključ (`AGE-SECRET-KEY-…`) ili null kad ga nema. */
export function privatniBackupKljuc(): string | null {
  if (!existsSync(BACKUP_KLJUC)) return null;
  return readFileSync(BACKUP_KLJUC, 'utf8').split('\n').find((r) => r.startsWith('AGE-SECRET-KEY-'))?.trim() ?? null;
}

export async function javniBackupKljuc(): Promise<string | null> {
  const privatni = privatniBackupKljuc();
  return privatni ? identityToRecipient(privatni) : null;
}

/** Novi age par. Nikad ne prepisuje postojeći — stari backup-i bi postali nečitljivi. */
export async function napraviBackupKljuc(): Promise<string> {
  if (existsSync(BACKUP_KLJUC)) throw new Error(`ključ već postoji na ${BACKUP_KLJUC} — ne prepisujem (stari backup-i bi postali nečitljivi)`);
  const privatni = await generateX25519Identity();
  const javni = await identityToRecipient(privatni);
  mkdirSync(dirname(BACKUP_KLJUC), { recursive: true });
  writeFileSync(BACKUP_KLJUC, `# created: ${new Date().toISOString()}\n# public key: ${javni}\n${privatni}\n`, { mode: 0o600 });
  chmodSync(BACKUP_KLJUC, 0o600);
  return javni;
}

/** Novi klijent dobija sve osim Generatora (interni alat). */
export const PODRAZUMIJEVANI_MODULI: Modul[] = ['skladiste', 'ponude', 'proizvodnja'];

export interface IzdanaLicenca extends Licenca {
  token: string;
  vrijeme: string;
}

export function ucitajPrivatni(): KeyObject {
  if (!existsSync(PRIVATNI)) {
    throw new Error(`nema privatnog ključa na ${PRIVATNI} — prvo pokreni "bun tools/licenca.ts kljucevi"`);
  }
  return createPrivateKey(readFileSync(PRIVATNI, 'utf8'));
}

export function javniIzPrivatnog(): KeyObject {
  return createPublicKey(ucitajPrivatni());
}

/** Zadnji dan važenja kad licenca traje `dana` dana računajući i danas. */
export function doNakonDana(dana: number, od = new Date()): string {
  const d = new Date(od);
  d.setDate(d.getDate() + dana - 1);
  return lokalniDatum(d);
}

export async function izdaj(unos: { klijent: string; vrijediDo: string; uredjaj?: string; moduli: Modul[]; backup?: BackupUnos }): Promise<IzdanaLicenca> {
  const privatni = ucitajPrivatni();
  const bucket = unos.backup?.bucket.trim();
  const licenca: Licenca = {
    klijent: unos.klijent.trim(),
    vrijediDo: unos.vrijediDo,
    izdana: lokalniDatum(new Date()),
    moduli: unos.moduli,
    ...(unos.uredjaj?.trim() ? { uredjaj: unos.uredjaj.trim() } : {}),
    ...(bucket ? { backup: { bucket } } : {}),
  };
  let r2: R2Podaci | undefined;
  if (bucket) {
    const accountId = ucitajAccountId();
    if (!accountId) throw new Error('Prvo spremi Cloudflare Account ID');
    const primalac = await javniBackupKljuc();
    if (!primalac) throw new Error('Prvo napravi ključ za backup');
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Ime bucketa: 3–63 znaka, mala slova, brojevi i crtica');
    const p = pristupBucketu(bucket, licenca.klijent, unos.backup?.accessKeyId, unos.backup?.secret);
    r2 = { accountId, accessKeyId: p.accessKeyId, secret: p.secret, bucket, primalac };
  }
  const token = izdajLicencu(licenca, privatni, r2);

  // Provjera svojim javnim ključem da ne pošaljemo neispravan token.
  const r = provjeriLicencu(token, createPublicKey(privatni), { uredjaj: licenca.uredjaj });
  if (!r.ok) throw new Error(r.razlog === 'istekla' ? 'datum važenja je u prošlosti' : `token ne prolazi provjeru (${r.razlog})`);

  // Dnevnik i ispis dobijaju listu kao u tokenu: redom iz kataloga, bez duplikata.
  // (izdajLicencu je gore dobio sirovu listu da bi nepoznat modul bacio grešku.)
  const izdana: IzdanaLicenca = { ...licenca, moduli: normalizujModule(unos.moduli) ?? [], token, vrijeme: new Date().toISOString() };
  appendFileSync(DNEVNIK, JSON.stringify(izdana) + '\n', { mode: 0o600 });
  return izdana;
}

export function izdaneLicence(): IzdanaLicenca[] {
  if (!existsSync(DNEVNIK)) return [];
  return readFileSync(DNEVNIK, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((red) => JSON.parse(red) as IzdanaLicenca);
}
