import { test, expect } from 'bun:test';
import { potpisiS3, r2Posalji, r2Lista, r2Preuzmi, imeBackupa, R2Greska, type R2Pristup } from './r2';

// Službeni primjeri iz AWS dokumentacije "Signature Calculations for the
// Authorization Header: Transferring Payload in a Single Chunk".
const AWS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  amzDatum: '20130524T000000Z',
  host: 'examplebucket.s3.amazonaws.com',
};
const PRAZNO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

test('SigV4: GET objekta s Range', () => {
  const h = potpisiS3({ ...AWS, metoda: 'GET', putanja: '/test.txt', upit: {}, zaglavlja: { range: 'bytes=0-9' }, hashTijela: PRAZNO });
  expect(h.authorization).toBe(
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
});

test('SigV4: PUT objekta (posebni znakovi u putanji)', () => {
  const h = potpisiS3({
    ...AWS, metoda: 'PUT', putanja: '/test$file.text', upit: {},
    zaglavlja: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    hashTijela: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
  });
  expect(h.authorization).toEndWith('SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('SigV4: GET s upitom bez vrijednosti (?lifecycle)', () => {
  const h = potpisiS3({ ...AWS, metoda: 'GET', putanja: '/', upit: { lifecycle: '' }, zaglavlja: {}, hashTijela: PRAZNO });
  expect(h.authorization).toEndWith('Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});

test('SigV4: lista s upitom (sortiranje ključeva)', () => {
  const h = potpisiS3({ ...AWS, metoda: 'GET', putanja: '/', upit: { prefix: 'J', 'max-keys': '2' }, zaglavlja: {}, hashTijela: PRAZNO });
  expect(h.authorization).toEndWith('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('ime backup-a: uređaj/UTC vrijeme bez dvotačaka', () => {
  expect(imeBackupa('3F9A-01C2-7B44', new Date(Date.UTC(2026, 8, 25, 15, 0, 7)))).toBe('3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age');
});

// Lažni S3 server: provjerava da zahtjevi stižu potpisani i na pravo mjesto.
function lazniS3() {
  const objekti = new Map<string, Uint8Array>();
  const zahtjevi: { metoda: string; put: string; auth: string | null }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      zahtjevi.push({ metoda: req.method, put: url.pathname + url.search, auth: req.headers.get('authorization') });
      if (!req.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=KLJUC/')) return new Response('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 });
      const [, bucket, ...kljuc] = url.pathname.split('/');
      if (bucket !== 'pazar-pekara') return new Response('<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>', { status: 404 });
      const k = decodeURIComponent(kljuc.join('/'));
      if (req.method === 'PUT') {
        objekti.set(k, new Uint8Array(await req.arrayBuffer()));
        return new Response(null, { status: 200 });
      }
      if (req.method === 'GET' && k) {
        const o = objekti.get(k);
        return o ? new Response(o) : new Response('<Error><Code>NoSuchKey</Code><Message>nema</Message></Error>', { status: 404 });
      }
      const prefix = url.searchParams.get('prefix') ?? '';
      const xml = [...objekti].filter(([x]) => x.startsWith(prefix)).map(([x, v]) =>
        `<Contents><Key>${x}</Key><LastModified>2026-09-25T15:00:07.000Z</LastModified><Size>${v.length}</Size></Contents>`).join('');
      return new Response(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${xml}</ListBucketResult>`);
    },
  });
  return { server, objekti, zahtjevi };
}

const pristup = (endpoint: string, izmjene: Partial<R2Pristup> = {}): R2Pristup => ({
  accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'KLJUC', secret: 'tajna', bucket: 'pazar-pekara', endpoint, ...izmjene,
});

test('r2: pošalji, izlistaj i preuzmi', async () => {
  const { server, zahtjevi } = lazniS3();
  try {
    const r2 = pristup(server.url.origin);
    await r2Posalji(r2, 'AAAA-BBBB/2026-09-25T15-00-07Z.db.age', new Uint8Array([1, 2, 3]));
    expect(zahtjevi[0]).toMatchObject({ metoda: 'PUT', put: '/pazar-pekara/AAAA-BBBB/2026-09-25T15-00-07Z.db.age' });
    expect(await r2Lista(r2, 'AAAA-')).toEqual([{ kljuc: 'AAAA-BBBB/2026-09-25T15-00-07Z.db.age', velicina: 3, vrijeme: '2026-09-25T15:00:07.000Z' }]);
    expect([...await r2Preuzmi(r2, 'AAAA-BBBB/2026-09-25T15-00-07Z.db.age')]).toEqual([1, 2, 3]);
  } finally {
    server.stop(true);
  }
});

test('r2: greške servera su čitljive', async () => {
  const { server } = lazniS3();
  try {
    await expect(r2Posalji(pristup(server.url.origin, { accessKeyId: 'POGRESAN' }), 'x', new Uint8Array())).rejects.toThrow('R2 je odbio pristup (403 AccessDenied)');
    await expect(r2Lista(pristup(server.url.origin, { bucket: 'nepostojeci' }), '')).rejects.toThrow('404 NoSuchBucket');
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: napredak po bajtovima, tijelo stiže cijelo s dužinom', async () => {
  const primljeno: { duzina: string | null; tijelo: Uint8Array }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      primljeno.push({ duzina: req.headers.get('content-length'), tijelo: new Uint8Array(await req.arrayBuffer()) });
      return new Response(null, { status: 200 });
    },
  });
  try {
    const tijelo = new Uint8Array(300_000).map((_, i) => i % 251);
    const napredak: [number, number][] = [];
    await r2Posalji(pristup(server.url.origin), 'A/x.db.age', tijelo, (p, u) => napredak.push([p, u]));
    expect(primljeno[0].duzina).toBe('300000');
    expect(primljeno[0].tijelo).toEqual(tijelo);
    expect(napredak.length).toBeGreaterThan(1);
    expect(napredak.at(-1)).toEqual([300_000, 300_000]);
    for (let i = 1; i < napredak.length; i++) expect(napredak[i][0]).toBeGreaterThan(napredak[i - 1][0]);
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: 403 je R2Greska sa statusom, poruka ostaje ista', async () => {
  const { server } = lazniS3();
  try {
    const e = await r2Posalji(pristup(server.url.origin, { accessKeyId: 'POGRESAN' }), 'x', new Uint8Array([1])).catch(x => x);
    expect(e).toBeInstanceOf(R2Greska);
    expect(e.status).toBe(403);
    expect(e.message).toContain('R2 je odbio pristup (403 AccessDenied)');
    expect(e.kod).toBe('AccessDenied');
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: S3 <Code> je u R2Greska.kod (RequestTimeTooSkewed), poruka ostaje ista', async () => {
  const xml = '<Error><Code>RequestTimeTooSkewed</Code><Message>The difference between the request time and the current time is too large.</Message></Error>';
  const server = Bun.serve({ port: 0, fetch: () => new Response(xml, { status: 403 }) });
  try {
    const e = await r2Posalji(pristup(server.url.origin), 'x', new Uint8Array([1])).catch(x => x);
    expect(e).toBeInstanceOf(R2Greska);
    expect(e.status).toBe(403);
    expect(e.kod).toBe('RequestTimeTooSkewed');
    expect(e.message).toBe('R2 je odbio pristup (403 RequestTimeTooSkewed): The difference between the request time and the current time is too large.');
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: nema servera → R2Greska bez statusa', async () => {
  const e = await r2Posalji(pristup('http://127.0.0.1:1'), 'x', new Uint8Array([1])).catch(x => x);
  expect(e).toBeInstanceOf(R2Greska);
  expect(e.status).toBeUndefined();
  expect(e.message).toStartWith('Nema veze s R2');
});

test('r2Posalji: server koji ne odgovara → greška nakon isteka vremena', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  try {
    const e = await r2Posalji(pristup(server.url.origin), 'x', new Uint8Array([1]), undefined, 200).catch(x => x);
    expect(e).toBeInstanceOf(R2Greska);
    expect(e.message).toContain('isteklo vrijeme');
  } finally {
    server.stop(true);
  }
});
