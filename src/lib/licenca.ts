// Licencni token: `PAZAR1.<payload>.<potpis>`, oba dijela base64url.
// Payload je JSON s kratkim ključevima da token ostane kratak za slanje
// Viberom. Potpis je Ed25519 nad `PAZAR1.<payload>` — aplikacija ima samo
// javni ključ, pa token ne može napraviti niko ko nema privatni.
import { createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'node:crypto';

const PREFIKS = 'PAZAR1';

export interface Licenca {
  klijent: string;
  /** Zadnji dan važenja, `YYYY-MM-DD`, uključivo. */
  vrijediDo: string;
  /** Datum izdavanja, `YYYY-MM-DD`. */
  izdana: string;
  /** Ako je postavljen, licenca važi samo na tom uređaju. */
  uredjaj?: string;
}

interface Payload {
  k: string;
  d: string;
  i: string;
  u?: string;
}

export type Provjera =
  | { ok: true; licenca: Licenca }
  | { ok: false; razlog: 'format' | 'potpis' | 'istekla' | 'uredjaj'; licenca?: Licenca };

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

function kljuc(pem: string | KeyObject, tip: 'privatni' | 'javni'): KeyObject {
  if (typeof pem !== 'string') return pem;
  return tip === 'privatni' ? createPrivateKey(pem) : createPublicKey(pem);
}

export function lokalniDatum(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function izdajLicencu(licenca: Licenca, privatniKljuc: string | KeyObject): string {
  if (!licenca.klijent.trim()) throw new Error('Klijent je obavezan');
  if (!DATUM.test(licenca.vrijediDo)) throw new Error('vrijediDo mora biti YYYY-MM-DD');
  if (!DATUM.test(licenca.izdana)) throw new Error('izdana mora biti YYYY-MM-DD');

  const payload: Payload = { k: licenca.klijent, d: licenca.vrijediDo, i: licenca.izdana };
  if (licenca.uredjaj) payload.u = licenca.uredjaj;

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
    return { klijent: p.k, vrijediDo: p.d, izdana: p.i, ...(p.u ? { uredjaj: p.u } : {}) };
  } catch {
    return null;
  }
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
