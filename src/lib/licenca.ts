// Licencni token: `PAZAR1.<payload>.<potpis>`, oba dijela base64url.
// Payload je JSON s kratkim ključevima da token ostane kratak za slanje
// Viberom. Potpis je Ed25519 nad `PAZAR1.<payload>` — aplikacija ima samo
// javni ključ, pa token ne može napraviti niko ko nema privatni.
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, sign, verify, KeyObject } from 'node:crypto';
import { BACKUP_KLJUC_HEX } from './backupKljuc';
import { LICENCIRANI_MODULI, normalizujModule, type Modul } from './moduli';

const PREFIKS = 'PAZAR1';

export interface Licenca {
  klijent: string;
  /** Zadnji dan važenja, `YYYY-MM-DD`, uključivo. */
  vrijediDo: string;
  /** Datum izdavanja, `YYYY-MM-DD`. */
  izdana: string;
  /** Ako je postavljen, licenca važi samo na tom uređaju. */
  uredjaj?: string;
  /** Licencirani moduli. Nema polja = stari token = svi moduli; [] = samo jezgro. */
  moduli?: Modul[];
  /** Automatski backup na R2. Kredencijali nisu ovdje — samo `backupPodaci(token)`. */
  backup?: BackupLicence;
}

export interface BackupLicence {
  /** Bucket ovog klijenta; ostaje isti kad klijent promijeni računar. */
  bucket: string;
}

/** R2 pristup (token samo za bucket klijenta) i javni age ključ kojim aplikacija šifruje backup. */
export interface R2Podaci {
  accountId: string;
  accessKeyId: string;
  secret: string;
  bucket: string;
  /** `age1…` — privatni par je samo kod izdavača. */
  primalac: string;
}

interface Payload {
  k: string;
  d: string;
  i: string;
  u?: string;
  m?: string[];
  /** c = bucket, x = base64url(nonce | AES-256-GCM(JSON {a, k, s, r}) | tag). */
  b?: { c: string; x: string };
}

export type Provjera =
  | { ok: true; licenca: Licenca }
  | { ok: false; razlog: 'format' | 'potpis' | 'istekla' | 'uredjaj'; licenca?: Licenca };

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
/** R2 pravila za ime bucketa. */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function sifrujR2(r2: R2Podaci): string {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(BACKUP_KLJUC_HEX, 'hex'), nonce);
  const json = JSON.stringify({ a: r2.accountId, k: r2.accessKeyId, s: r2.secret, r: r2.primalac });
  return Buffer.concat([nonce, c.update(json, 'utf8'), c.final(), c.getAuthTag()]).toString('base64url');
}

function desifrujR2(bucket: string, x: string): R2Podaci | null {
  try {
    const buf = Buffer.from(x, 'base64url');
    if (buf.length < 12 + 16) return null;
    const d = createDecipheriv('aes-256-gcm', Buffer.from(BACKUP_KLJUC_HEX, 'hex'), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(buf.length - 16));
    const p = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8'));
    if (![p.a, p.k, p.s, p.r].every(v => typeof v === 'string' && v)) return null;
    return { accountId: p.a, accessKeyId: p.k, secret: p.s, bucket, primalac: p.r };
  } catch {
    return null;
  }
}

/** `b` iz payloada; pokvaren ili nepotpun `b` znači "bez backup-a", ne neispravnu licencu. */
function citajB(b: unknown): { c: string; x: string } | null {
  if (!b || typeof b !== 'object') return null;
  const { c, x } = b as Record<string, unknown>;
  return typeof c === 'string' && BUCKET.test(c) && typeof x === 'string' ? { c, x } : null;
}

function kljuc(pem: string | KeyObject, tip: 'privatni' | 'javni'): KeyObject {
  if (typeof pem !== 'string') return pem;
  return tip === 'privatni' ? createPrivateKey(pem) : createPublicKey(pem);
}

export function lokalniDatum(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function izdajLicencu(licenca: Licenca, privatniKljuc: string | KeyObject, r2?: R2Podaci): string {
  if (!licenca.klijent.trim()) throw new Error('Klijent je obavezan');
  if (!DATUM.test(licenca.vrijediDo)) throw new Error('vrijediDo mora biti YYYY-MM-DD');
  if (!DATUM.test(licenca.izdana)) throw new Error('izdana mora biti YYYY-MM-DD');

  const payload: Payload = { k: licenca.klijent, d: licenca.vrijediDo, i: licenca.izdana };
  if (licenca.uredjaj) payload.u = licenca.uredjaj;
  if (licenca.moduli) {
    const nepoznati = licenca.moduli.filter(m => !LICENCIRANI_MODULI.includes(m));
    if (nepoznati.length) throw new Error(`Nepoznat modul: ${nepoznati.join(', ')}`);
    payload.m = normalizujModule(licenca.moduli)!;
  }
  if (licenca.backup) {
    const { bucket } = licenca.backup;
    if (!BUCKET.test(bucket)) throw new Error('Ime bucketa: 3–63 znaka, mala slova, brojevi i crtica');
    if (!r2) throw new Error('Za backup trebaju R2 podaci');
    if (r2.bucket !== bucket) throw new Error('R2 podaci su za drugi bucket');
    if (![r2.accountId, r2.accessKeyId, r2.secret].every(v => v?.trim())) throw new Error('R2 podaci nisu potpuni');
    if (!r2.primalac?.startsWith('age1')) throw new Error('Javni ključ za backup mora počinjati s age1');
    payload.b = { c: bucket, x: sifrujR2(r2) };
  }

  const tijelo = `${PREFIKS}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const potpis = sign(null, Buffer.from(tijelo), kljuc(privatniKljuc, 'privatni'));
  return `${tijelo}.${potpis.toString('base64url')}`;
}

/** Čita token bez provjere potpisa — samo za prikaz. */
export function procitajLicencu(token: string): Licenca | null {
  const dijelovi = token.trim().split('.');
  if (dijelovi.length !== 3 || dijelovi[0] !== PREFIKS) return null;
  try {
    const p = JSON.parse(Buffer.from(dijelovi[1], 'base64url').toString('utf8')) as Payload;
    if (typeof p.k !== 'string' || !DATUM.test(p.d) || !DATUM.test(p.i)) return null;
    let moduli: Modul[] | undefined;
    if ('m' in p) {
      const n = normalizujModule(p.m);
      if (!n) return null;
      moduli = n;
    }
    const b = citajB(p.b);
    return {
      klijent: p.k, vrijediDo: p.d, izdana: p.i,
      ...(p.u ? { uredjaj: p.u } : {}), ...(moduli ? { moduli } : {}), ...(b ? { backup: { bucket: b.c } } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * R2 podaci iz licence, samo za main proces (nikad renderer). Ne provjerava
 * potpis — pozivalac koristi token koji je već prošao `provjeriLicencu`.
 */
export function backupPodaci(token: string): R2Podaci | null {
  const dijelovi = token.trim().split('.');
  if (dijelovi.length !== 3 || dijelovi[0] !== PREFIKS || !procitajLicencu(token)) return null;
  const b = citajB(JSON.parse(Buffer.from(dijelovi[1], 'base64url').toString('utf8')).b);
  return b && desifrujR2(b.c, b.x);
}

export function provjeriLicencu(
  token: string,
  javniKljuc: string | KeyObject,
  opcije: { sada?: Date; uredjaj?: string } = {},
): Provjera {
  const licenca = procitajLicencu(token);
  if (!licenca) return { ok: false, razlog: 'format' };

  const [prefiks, payload, potpis] = token.trim().split('.');
  const ispravan = verify(
    null,
    Buffer.from(`${prefiks}.${payload}`),
    kljuc(javniKljuc, 'javni'),
    Buffer.from(potpis, 'base64url'),
  );
  if (!ispravan) return { ok: false, razlog: 'potpis' };

  if (licenca.uredjaj && licenca.uredjaj !== opcije.uredjaj) {
    return { ok: false, razlog: 'uredjaj', licenca };
  }
  if (lokalniDatum(opcije.sada ?? new Date()) > licenca.vrijediDo) {
    return { ok: false, razlog: 'istekla', licenca };
  }
  return { ok: true, licenca };
}
