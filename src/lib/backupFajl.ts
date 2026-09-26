// Format backup fajla: age(gzip(SQLite baza)), X25519 primalac (`age1…`).
// Aplikacija ima samo javni ključ — može šifrovati, ne i dešifrovati.
// U nuždi: `age -d -i backup-kljuc.txt x.db.age | gunzip > x.db`.
import { promisify } from 'node:util';
import { gunzipSync, gzip } from 'node:zlib';
import { Decrypter, Encrypter } from 'age-encryption';

// Async: gzip ide u thread pool, main proces (kasa) ne stoji ~1,5 s na 100 MB.
const gzipAsync = promisify(gzip);

export async function sifrujBackup(baza: Uint8Array, primalac: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(primalac);
  return e.encrypt(new Uint8Array(await gzipAsync(baza)));
}

/** Baca grešku kad ključ ne odgovara ili je fajl oštećen. */
export async function desifrujBackup(fajl: Uint8Array, privatniKljuc: string): Promise<Uint8Array> {
  const d = new Decrypter();
  d.addIdentity(privatniKljuc);
  const podaci = await d.decrypt(fajl);
  return podaci[0] === 0x1f && podaci[1] === 0x8b ? new Uint8Array(gunzipSync(podaci)) : podaci;
}
