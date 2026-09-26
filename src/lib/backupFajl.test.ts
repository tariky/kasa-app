import { test, expect } from 'bun:test';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { sifrujBackup, desifrujBackup } from './backupFajl';

test('šifrovan backup se vraća samo pravim ključem', async () => {
  const kljuc = await generateX25519Identity();
  const baza = new TextEncoder().encode('SQLite format 3\0'.repeat(500));
  const fajl = await sifrujBackup(baza, await identityToRecipient(kljuc));
  expect(new TextDecoder().decode(fajl.subarray(0, 21))).toBe('age-encryption.org/v1');
  expect(fajl.length).toBeLessThan(baza.length); // gzip prije šifrovanja
  expect(await desifrujBackup(fajl, kljuc)).toEqual(baza);
  await expect(desifrujBackup(fajl, await generateX25519Identity())).rejects.toThrow();
});

test('gzip ne blokira main proces: sinhroni dio sifrujBackup je mali dio gzipSync vremena', async () => {
  const { gzipSync } = await import('node:zlib');
  const kljuc = await generateX25519Identity();
  const primalac = await identityToRecipient(kljuc);
  // ~32 MB polu-nasumičnih bajtova: gzip radi stvarni posao.
  const baza = new Uint8Array(32 * 1024 * 1024);
  let x = 1;
  for (let i = 0; i < baza.length; i++) { x = (x * 1103515245 + 12345) >>> 0; baza[i] = (x >>> 24) & 0x7f; }
  const t0 = performance.now();
  gzipSync(baza);
  const sinhroniGzip = performance.now() - t0;

  const t1 = performance.now();
  const p = sifrujBackup(baza, primalac);
  const sinhroniDio = performance.now() - t1;
  expect(await desifrujBackup(await p, kljuc)).toEqual(baza);
  expect(sinhroniDio).toBeLessThan(sinhroniGzip / 4);
});
