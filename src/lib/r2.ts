// Minimalni S3 klijent za Cloudflare R2: PUT, GET i ListObjectsV2 s AWS
// Signature V4. Bez AWS SDK-a — potpis je ~40 linija i provjeren je
// službenim AWS primjerima (r2.test.ts). Koriste ga main proces (automatski
// backup) i tools/backup (povrat).
import { createHash, createHmac } from 'node:crypto';
import { request as httpZahtjev } from 'node:http';
import { request as httpsZahtjev } from 'node:https';

export interface R2Pristup {
  accountId: string;
  accessKeyId: string;
  secret: string;
  bucket: string;
  /** Samo za testove (lažni server); inače `https://<accountId>.r2.cloudflarestorage.com`. */
  endpoint?: string;
}

export interface R2Objekat {
  kljuc: string;
  velicina: number;
  /** ISO, kako ga R2 vrati. */
  vrijeme: string;
}

const sha256 = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
const hmac = (k: string | Buffer, x: string) => createHmac('sha256', k).update(x).digest();

/** RFC 3986 kao što ga S3 traži: sve osim A-Z a-z 0-9 - _ . ~ (i `/` u putanji). */
function kodiraj(s: string, cuvajKosuCrtu = false): string {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return cuvajKosuCrtu ? e.replace(/%2F/g, '/') : e;
}

export interface ZahtjevZaPotpis {
  metoda: string;
  host: string;
  /** Nekodirana putanja, npr. `/bucket/uredjaj/vrijeme.db.age`. */
  putanja: string;
  upit: Record<string, string>;
  /** Dodatna zaglavlja koja se potpisuju (mala slova). */
  zaglavlja: Record<string, string>;
  hashTijela: string;
  accessKeyId: string;
  secret: string;
  region: string;
  /** `YYYYMMDDTHHMMSSZ` */
  amzDatum: string;
}

/** Zaglavlja za zahtjev, uključujući `authorization` (SigV4, servis s3). */
export function potpisiS3(z: ZahtjevZaPotpis): Record<string, string> {
  const zaglavlja: Record<string, string> = {
    ...z.zaglavlja,
    host: z.host,
    'x-amz-content-sha256': z.hashTijela,
    'x-amz-date': z.amzDatum,
  };
  const imena = Object.keys(zaglavlja).map(k => k.toLowerCase()).sort();
  const potpisana = imena.join(';');
  const kanonskaZaglavlja = imena.map(k => `${k}:${String(zaglavlja[k]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const kanonskiUpit = Object.keys(z.upit).sort().map(k => `${kodiraj(k)}=${kodiraj(z.upit[k])}`).join('&');
  const kanonski = [z.metoda, kodiraj(z.putanja, true), kanonskiUpit, kanonskaZaglavlja, potpisana, z.hashTijela].join('\n');

  const dan = z.amzDatum.slice(0, 8);
  const opseg = `${dan}/${z.region}/s3/aws4_request`;
  const zaPotpis = ['AWS4-HMAC-SHA256', z.amzDatum, opseg, sha256(kanonski)].join('\n');
  const kljuc = hmac(hmac(hmac(hmac(`AWS4${z.secret}`, dan), z.region), 's3'), 'aws4_request');
  const potpis = createHmac('sha256', kljuc).update(zaPotpis).digest('hex');
  return {
    ...zaglavlja,
    authorization: `AWS4-HMAC-SHA256 Credential=${z.accessKeyId}/${opseg},SignedHeaders=${potpisana},Signature=${potpis}`,
  };
}

function amzDatum(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Svaka greška R2 poziva. `status` je HTTP status; nema ga kad server nije ni
 * odgovorio. `kod` je S3 `<Code>` iz tijela (npr. RequestTimeTooSkewed).
 */
export class R2Greska extends Error {
  constructor(poruka: string, readonly status?: number, readonly kod?: string) {
    super(poruka);
    this.name = 'R2Greska';
  }
}

function greskaOdgovora(status: number, statusTekst: string, xml: string): R2Greska {
  const kod = xml.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? '';
  const poruka = xml.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? statusTekst;
  const opis = `${status}${kod ? ` ${kod}` : ''}`;
  return new R2Greska(status === 403 ? `R2 je odbio pristup (${opis}): ${poruka}` : `R2 greška (${opis}): ${poruka}`, status, kod || undefined);
}

/** URL i potpisana zaglavlja (bez `host` — postavlja ga klijent). */
function pripremi(r2: R2Pristup, metoda: string, kljuc: string, upit: Record<string, string>, tijelo?: Uint8Array) {
  const baza = new URL(r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`);
  const putanja = `/${r2.bucket}${kljuc ? `/${kljuc}` : ''}`;
  const zaglavlja = potpisiS3({
    metoda, host: baza.host, putanja, upit, zaglavlja: {},
    hashTijela: sha256(tijelo ?? ''), accessKeyId: r2.accessKeyId, secret: r2.secret, region: 'auto', amzDatum: amzDatum(),
  });
  delete zaglavlja.host;
  const q = Object.keys(upit).sort().map(k => `${kodiraj(k)}=${kodiraj(upit[k])}`).join('&');
  return { url: new URL(`${baza.origin}${kodiraj(putanja, true)}${q ? `?${q}` : ''}`), zaglavlja };
}

async function zahtjev(r2: R2Pristup, metoda: string, kljuc: string, upit: Record<string, string> = {}): Promise<Response> {
  const { url, zaglavlja } = pripremi(r2, metoda, kljuc, upit);
  let odg: Response;
  try {
    odg = await fetch(url, { method: metoda, headers: zaglavlja });
  } catch (e) {
    throw new R2Greska(`Nema veze s R2 (${(e as Error).message})`);
  }
  if (!odg.ok) throw greskaOdgovora(odg.status, odg.statusText, await odg.text());
  return odg;
}

const KOMAD = 64 * 1024;

/**
 * PUT preko node:http(s), a ne fetch: fetch sa streamom šalje chunked bez
 * dužine, što R2 odbija, a bez streama nema napretka. `napredak` se javlja
 * kad komad ode na mrežu.
 */
export function r2Posalji(
  r2: R2Pristup, kljuc: string, tijelo: Uint8Array,
  napredak?: (poslano: number, ukupno: number) => void, cekanjeMs = 120_000,
): Promise<void> {
  const { url, zaglavlja } = pripremi(r2, 'PUT', kljuc, {}, tijelo);
  return new Promise((resolve, reject) => {
    const posalji = url.protocol === 'https:' ? httpsZahtjev : httpZahtjev;
    const z = posalji(url, { method: 'PUT', headers: { ...zaglavlja, 'content-length': String(tijelo.length) } }, odg => {
      const dijelovi: Buffer[] = [];
      odg.on('data', (d: Buffer) => dijelovi.push(d));
      odg.on('end', () => {
        const status = odg.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(greskaOdgovora(status, odg.statusMessage ?? '', Buffer.concat(dijelovi).toString('utf8')));
      });
      odg.on('error', e => reject(new R2Greska(`Nema veze s R2 (${e.message})`)));
    });
    z.on('error', e => reject(new R2Greska(`Nema veze s R2 (${e.message})`)));
    // Bun na destroy(greška) ne emituje 'error' (samo 'close'), pa odbijamo ovdje.
    z.setTimeout(cekanjeMs, () => {
      reject(new R2Greska('Nema veze s R2 (isteklo vrijeme)'));
      z.destroy();
    });

    let poslano = 0;
    const salji = () => {
      while (poslano < tijelo.length) {
        const kraj = Math.min(poslano + KOMAD, tijelo.length);
        const komad = tijelo.subarray(poslano, kraj);
        poslano = kraj;
        if (!z.write(komad, () => napredak?.(kraj, tijelo.length))) {
          z.once('drain', salji);
          return;
        }
      }
      z.end();
    };
    salji();
  });
}

export async function r2Preuzmi(r2: R2Pristup, kljuc: string): Promise<Uint8Array> {
  return new Uint8Array(await (await zahtjev(r2, 'GET', kljuc)).arrayBuffer());
}

const xmlTekst = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Svi objekti s prefiksom (ListObjectsV2, po 1000 dok ima). */
export async function r2Lista(r2: R2Pristup, prefiks: string): Promise<R2Objekat[]> {
  const svi: R2Objekat[] = [];
  let nastavak: string | undefined;
  do {
    const upit: Record<string, string> = { 'list-type': '2', prefix: prefiks, ...(nastavak ? { 'continuation-token': nastavak } : {}) };
    const xml = await (await zahtjev(r2, 'GET', '', upit)).text();
    for (const [, c] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      svi.push({
        kljuc: xmlTekst(c.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? ''),
        velicina: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        vrijeme: c.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? '',
      });
    }
    nastavak = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlTekst(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? '') : undefined;
  } while (nastavak);
  return svi;
}

/** `<uredjaj>/<UTC vrijeme>Z.db.age` — sekunde u imenu, pa se ništa ne prepisuje. */
export function imeBackupa(uredjaj: string, kada = new Date()): string {
  return `${uredjaj}/${kada.toISOString().slice(0, 19).replace(/:/g, '-')}Z.db.age`;
}
