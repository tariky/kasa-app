// Minimalni S3 klijent za Cloudflare R2: PUT, GET i ListObjectsV2 s AWS
// Signature V4. Bez AWS SDK-a — potpis je ~40 linija i provjeren je
// službenim AWS primjerima (r2.test.ts). Koriste ga main proces (automatski
// backup) i tools/backup (povrat).
import { createHash, createHmac } from 'node:crypto';

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

async function zahtjev(r2: R2Pristup, metoda: string, kljuc: string, upit: Record<string, string> = {}, tijelo?: Uint8Array): Promise<Response> {
  const baza = new URL(r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`);
  const putanja = `/${r2.bucket}${kljuc ? `/${kljuc}` : ''}`;
  const zaglavlja = potpisiS3({
    metoda, host: baza.host, putanja, upit, zaglavlja: {},
    hashTijela: sha256(tijelo ?? ''), accessKeyId: r2.accessKeyId, secret: r2.secret, region: 'auto', amzDatum: amzDatum(),
  });
  delete zaglavlja.host; // fetch ga postavlja sam
  const q = Object.keys(upit).sort().map(k => `${kodiraj(k)}=${kodiraj(upit[k])}`).join('&');
  const url = `${baza.origin}${kodiraj(putanja, true)}${q ? `?${q}` : ''}`;
  let odg: Response;
  try {
    odg = await fetch(url, { method: metoda, headers: zaglavlja, body: tijelo });
  } catch (e) {
    throw new Error(`Nema veze s R2 (${(e as Error).message})`);
  }
  if (!odg.ok) {
    const xml = await odg.text();
    const kod = xml.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? '';
    const poruka = xml.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? odg.statusText;
    const opis = `${odg.status}${kod ? ` ${kod}` : ''}`;
    throw new Error(odg.status === 403 ? `R2 je odbio pristup (${opis}): ${poruka}` : `R2 greška (${opis}): ${poruka}`);
  }
  return odg;
}

export async function r2Posalji(r2: R2Pristup, kljuc: string, tijelo: Uint8Array): Promise<void> {
  await zahtjev(r2, 'PUT', kljuc, {}, tijelo);
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
