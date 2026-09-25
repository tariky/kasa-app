#!/usr/bin/env bun
// Probni alat za šifrovane backup-e (age, X25519).
//
//   bun tools/backup/backup.ts kljuc                      — novi par ključeva
//   bun tools/backup/backup.ts sifruj <baza.db> [izlaz]   — kao što će raditi aplikacija
//   bun tools/backup/backup.ts desifruj <backup.age> [izlaz.db]
//
// Aplikacija ima samo javni ključ (age1...) pa može šifrovati, ali ne i
// dešifrovati. Privatni ključ ostaje na ovom računaru, pored licencnog.
// Format fajla: age(gzip(SQLite baza)) — hitno se može otvoriti i age CLI-jem:
//   age -d -i ~/.pazar-licenca/backup-kljuc.txt x.db.age | gunzip > x.db
import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';

const PRIVATNI = process.env.PAZAR_BACKUP_KLJUC ?? join(homedir(), '.pazar-licenca', 'backup-kljuc.txt');
const OBAVEZNE_TABELE = ['users', 'products', 'orders'];

function greska(poruka: string): never {
  console.error(`greška: ${poruka}`);
  process.exit(1);
}

async function ucitajPrivatni(): Promise<string> {
  const f = Bun.file(PRIVATNI);
  if (!(await f.exists())) greska(`nema ključa na ${PRIVATNI} — prvo pokreni "bun tools/backup/backup.ts kljuc"`);
  const red = (await f.text()).split('\n').find(r => r.startsWith('AGE-SECRET-KEY-'));
  if (!red) greska(`${PRIVATNI} ne sadrži AGE-SECRET-KEY`);
  return red.trim();
}

async function kljuc() {
  if (existsSync(PRIVATNI)) greska(`ključ već postoji na ${PRIVATNI} — ne prepisujem (stari backup-i bi postali nečitljivi)`);
  const privatni = await generateX25519Identity();
  const javni = await identityToRecipient(privatni);
  mkdirSync(dirname(PRIVATNI), { recursive: true });
  // Isti format kao age-keygen, pa ga age CLI čita direktno.
  await Bun.write(PRIVATNI, `# created: ${new Date().toISOString()}\n# public key: ${javni}\n${privatni}\n`);
  chmodSync(PRIVATNI, 0o600);
  console.log(`privatni ključ: ${PRIVATNI}  (napravi kopiju na sigurno mjesto — bez njega nema povrata)`);
  console.log(`javni ključ (ide u aplikaciju):\n${javni}`);
}

async function sifruj(baza: string, izlaz?: string) {
  if (!existsSync(baza)) greska(`nema fajla ${baza}`);
  const javni = await identityToRecipient(await ucitajPrivatni());
  // VACUUM INTO daje dosljednu samostalnu kopiju i dok aplikacija radi (WAL).
  const tmp = mkdtempSync(join(tmpdir(), 'pazar-backup-'));
  try {
    const kopija = join(tmp, 'kopija.db');
    const db = new Database(baza, { readonly: true });
    db.run('VACUUM INTO ?', [kopija]);
    db.close();
    const sirovo = await Bun.file(kopija).bytes();
    const e = new Encrypter();
    e.addRecipient(javni);
    const sifrovano = await e.encrypt(Bun.gzipSync(sirovo));
    const cilj = izlaz ?? `${basename(baza, '.db')}-${new Date().toISOString().slice(0, 16).replace(/:/g, '-')}.db.age`;
    await Bun.write(cilj, sifrovano);
    console.log(`${cilj}  (${kb(sirovo.length)} → ${kb(sifrovano.length)})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function desifruj(ulaz: string, izlaz?: string) {
  if (!existsSync(ulaz)) greska(`nema fajla ${ulaz}`);
  const d = new Decrypter();
  d.addIdentity(await ucitajPrivatni());
  let podaci: Uint8Array;
  try {
    podaci = await d.decrypt(await Bun.file(ulaz).bytes());
  } catch (e: any) {
    greska(`dešifrovanje nije uspjelo (pogrešan ključ ili oštećen fajl): ${e.message}`);
  }
  if (podaci[0] === 0x1f && podaci[1] === 0x8b) podaci = Bun.gunzipSync(podaci);
  const cilj = izlaz ?? ulaz.replace(/\.age$/, '').replace(/(\.db)?$/, '.db');
  if (existsSync(cilj)) greska(`${cilj} već postoji — navedi drugi izlaz`);
  await Bun.write(cilj, podaci);
  provjeri(cilj);
  console.log(`${cilj}  (${kb(podaci.length)}) — spremno za "Uvoz backup-a" u Postavkama`);
}

function provjeri(putanja: string) {
  const db = new Database(putanja, { readonly: true });
  try {
    const integritet = db.query('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integritet.integrity_check !== 'ok') greska(`baza je oštećena: ${integritet.integrity_check}`);
    const tabele = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(r => r.name));
    const nedostaje = OBAVEZNE_TABELE.filter(t => !tabele.has(t));
    if (nedostaje.length) greska(`nije Pazar baza (nedostaje: ${nedostaje.join(', ')})`);
    const broj = (t: string) => (db.query(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log(`provjera ok — proizvoda: ${broj('products')}, računa: ${broj('orders')}, korisnika: ${broj('users')}`);
  } finally {
    db.close();
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const [komanda, a, b] = process.argv.slice(2);
if (komanda === 'kljuc') await kljuc();
else if (komanda === 'sifruj' && a) await sifruj(a, b);
else if (komanda === 'desifruj' && a) await desifruj(a, b);
else greska('upotreba: kljuc | sifruj <baza.db> [izlaz] | desifruj <backup.age> [izlaz.db]');
