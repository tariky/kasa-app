// Lažni S3 za ugovor backup-a: prima PUT, provjerava SigV4 potpis (ponovo ga
// računa s poznatim tajnim ključem) i SHA-256 tijela. Rust backend (faza 4)
// mora proći iste provjere — to je jedini dokaz da ga R2 neće odbiti.
import { createHash } from 'node:crypto';
import { potpisiS3 } from '../../lib/r2';

export const S3_KLJUC = 'UGOVOR-KLJUC';
export const S3_TAJNA = 'ugovor-tajna';

export interface S3Zahtjev {
  metoda: string;
  bucket: string;
  kljuc: string;
  tijelo: Uint8Array;
  potpisIspravan: boolean;
  hashIspravan: boolean;
}

export interface LaziS3 {
  url: string;
  zahtjevi: S3Zahtjev[];
  /** Status kojim server odgovara (200, 403, 500…). */
  status: number;
  /** S3 `<Code>` u tijelu greške; bez njega 403 → AccessDenied. */
  kod?: string;
  stop(): void;
}

export function pokreniLaziS3(opcije: { status?: number; kod?: string } = {}): LaziS3 {
  const s3: LaziS3 = { url: '', zahtjevi: [], status: opcije.status ?? 200, kod: opcije.kod, stop: () => undefined };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const tijelo = new Uint8Array(await req.arrayBuffer());
      const [, bucket, ...dijelovi] = url.pathname.split('/');
      const hash = req.headers.get('x-amz-content-sha256') ?? '';
      const auth = req.headers.get('authorization') ?? '';
      const potpisana = auth.match(/SignedHeaders=([^,]+)/)?.[1].split(';') ?? [];
      const zaglavlja: Record<string, string> = {};
      for (const k of potpisana) if (k !== 'host' && k !== 'x-amz-content-sha256' && k !== 'x-amz-date') zaglavlja[k] = req.headers.get(k) ?? '';
      const ocekivano = potpisiS3({
        metoda: req.method, host: url.host, putanja: decodeURIComponent(url.pathname), upit: Object.fromEntries(url.searchParams),
        zaglavlja, hashTijela: hash, accessKeyId: S3_KLJUC, secret: S3_TAJNA, region: 'auto', amzDatum: req.headers.get('x-amz-date') ?? '',
      }).authorization;
      s3.zahtjevi.push({
        metoda: req.method, bucket, kljuc: decodeURIComponent(dijelovi.join('/')), tijelo,
        potpisIspravan: auth === ocekivano,
        hashIspravan: hash === createHash('sha256').update(tijelo).digest('hex'),
      });
      if (s3.kod) return new Response(`<Error><Code>${s3.kod}</Code><Message>${s3.kod}</Message></Error>`, { status: s3.status });
      if (s3.status === 403) return new Response('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 });
      return new Response(null, { status: s3.status });
    },
  });
  s3.url = server.url.origin;
  s3.stop = () => server.stop(true);
  return s3;
}
