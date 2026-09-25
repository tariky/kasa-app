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
