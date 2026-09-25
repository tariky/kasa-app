#!/usr/bin/env bun
// Alat za šifrovane backup-e na R2 (age, X25519).
//
//   bun run backup kljuc                                   — novi par ključeva
//   bun run backup posalji [--token T] [--baza B] [--uredjaj ID]
//        — isto što aplikacija radi svaka 3 sata; bez argumenata uzima licencu
//          i bazu dev aplikacije (userData/Pazar)
//   bun run backup lista <bucket>                          — backup-i po računaru
//   bun run backup preuzmi <bucket> [ključ objekta] [--izlaz x.db]
//        — zadnji (ili navedeni) → dešifruj → provjeri → .db za "Uvoz backup-a"
//   bun run backup sifruj <baza.db> [izlaz]  /  desifruj <backup.age> [izlaz.db]  — lokalno
//
// Privatni ključ ostaje na ovom računaru, pored licencnog. R2 ključevi po
// bucketu su u ~/.pazar-licenca/r2-bucketi.json (sprema ih generator licenci).
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { identityToRecipient } from 'age-encryption';
import { backupPodaci } from '../../src/lib/licenca';
import { desifrujBackup, sifrujBackup } from '../../src/lib/backupFajl';
import { imeBackupa, r2Lista, r2Posalji, r2Preuzmi, type R2Pristup } from '../../src/lib/r2';
import { uredjajId } from '../../src/lib/uredjaj';
import { BACKUP_KLJUC as PRIVATNI, napraviBackupKljuc, privatniBackupKljuc, ucitajAccountId, ucitajBuckete } from '../licenca-zajednicko';

const OBAVEZNE_TABELE = ['users', 'products', 'orders'];
/** Samo za testove: lažni S3 server umjesto R2. */
const ENDPOINT = process.env.PAZAR_R2_ENDPOINT || undefined;
/** userData Electron dev aplikacije (productName "Pazar"). */
const DEV_PODACI = process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'Pazar')
  : process.platform === 'win32' ? join(process.env.APPDATA ?? '', 'Pazar') : join(homedir(), '.config', 'Pazar');

function greska(poruka: string): never {
  console.error(`greška: ${poruka}`);
  process.exit(1);
}

function ucitajPrivatni(): string {
  return privatniBackupKljuc() ?? greska(`nema ključa na ${PRIVATNI} — "bun run backup kljuc" ili "Napravi ključ" u generatoru licenci`);
}

/** Dosljedna samostalna kopija i dok aplikacija radi (WAL). */
function kopijaBaze(baza: string): Uint8Array {
  if (!existsSync(baza)) greska(`nema baze ${baza}`);
  const tmp = mkdtempSync(join(tmpdir(), 'pazar-backup-'));
  try {
    const kopija = join(tmp, 'kopija.db');
    const db = new Database(baza, { readonly: true });
    db.run('VACUUM INTO ?', [kopija]);
    db.close();
    return new Uint8Array(readFileSync(kopija));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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

/** R2 pristup za bucket iz podataka generatora licenci. */
function pristupIzGeneratora(bucket: string): R2Pristup {
  const accountId = ucitajAccountId() ?? greska('nema Account ID-a — spremi ga u generatoru licenci');
  const b = ucitajBuckete()[bucket] ?? greska(`nepoznat bucket ${bucket} — izdaj licencu s njim u generatoru (tamo se spremaju ključevi)`);
  return { accountId, accessKeyId: b.accessKeyId, secret: b.secret, bucket, endpoint: ENDPOINT };
}

const kb = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function kljuc() {
  let javni: string;
  try {
    javni = await napraviBackupKljuc();
  } catch (e) {
    greska((e as Error).message);
  }
  console.log(`privatni ključ: ${PRIVATNI}  (napravi kopiju na sigurno mjesto — bez njega nema povrata)`);
  console.log(`javni ključ (ide u licencu):\n${javni}`);
}

async function posalji(args: string[]) {
  const { values } = parseArgs({ args, options: { token: { type: 'string' }, baza: { type: 'string' }, uredjaj: { type: 'string' } } });
  let token = values.token;
  if (!token) {
    const f = join(DEV_PODACI, 'licenca.json');
    if (!existsSync(f)) greska(`nema ${f} — navedi --token`);
    token = (JSON.parse(await Bun.file(f).text()) as { token?: string }).token ?? greska(`${f} nema token`);
  }
  const podaci = backupPodaci(token) ?? greska('licenca nema backup (ili R2 podaci u njoj nisu ispravni)');
  const r2 = { ...podaci, endpoint: ENDPOINT };
  const baza = values.baza ?? join(DEV_PODACI, 'kasa.db');
  const uredjaj = values.uredjaj ?? uredjajId();

  const t0 = performance.now();
  const sirovo = kopijaBaze(baza);
  const fajl = await sifrujBackup(sirovo, r2.primalac);
  const ime = imeBackupa(uredjaj);
  console.log(`bucket ${r2.bucket}, ${ime}  (${kb(sirovo.length)} → ${kb(fajl.length)})`);
  try {
    await r2Posalji(r2, ime, fajl);
  } catch (e) {
    greska((e as Error).message);
  }
  console.log(`poslano za ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

async function lista(bucket: string) {
  let objekti;
  try {
    objekti = await r2Lista(pristupIzGeneratora(bucket), '');
  } catch (e) {
    greska((e as Error).message);
  }
  if (!objekti.length) return console.log(`${bucket}: nema backup-a`);
  const poUredjaju = Map.groupBy(objekti, o => o.kljuc.split('/')[0]);
  for (const [uredjaj, lista] of poUredjaju) {
    console.log(`\n${uredjaj}  (${lista.length} backup-a)`);
    for (const o of lista.sort((a, b) => a.kljuc.localeCompare(b.kljuc))) {
      console.log(`  ${new Date(o.vrijeme).toLocaleString('bs-BA')}  ${kb(o.velicina).padStart(8)}  ${o.kljuc}`);
    }
  }
}

async function preuzmi(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { izlaz: { type: 'string' } } });
  const [bucket, zadani] = positionals;
  if (!bucket) greska('upotreba: preuzmi <bucket> [ključ objekta] [--izlaz x.db]');
  const r2 = pristupIzGeneratora(bucket);
  const privatni = ucitajPrivatni();
  try {
    let kljucObjekta = zadani;
    if (!kljucObjekta) {
      const svi = await r2Lista(r2, '');
      if (!svi.length) greska(`${bucket}: nema backup-a`);
      kljucObjekta = svi.sort((a, b) => a.vrijeme.localeCompare(b.vrijeme)).at(-1)!.kljuc;
    }
    console.log(`preuzimam ${bucket}/${kljucObjekta}`);
    const podaci = await desifrujBackup(await r2Preuzmi(r2, kljucObjekta), privatni);
    const cilj = values.izlaz ?? `${bucket}-${basename(kljucObjekta).replace(/\.db\.age$/, '')}.db`;
    if (existsSync(cilj)) greska(`${cilj} već postoji — navedi --izlaz`);
    await Bun.write(cilj, podaci);
    provjeri(cilj);
    console.log(`${cilj}  (${kb(podaci.length)}) — spremno za "Uvoz backup-a" u Postavkama`);
  } catch (e) {
    greska((e as Error).message);
  }
}

async function sifruj(baza: string, izlaz?: string) {
  const javni = await identityToRecipient(ucitajPrivatni());
  const sirovo = kopijaBaze(baza);
  const fajl = await sifrujBackup(sirovo, javni);
  const cilj = izlaz ?? `${basename(baza, '.db')}-${new Date().toISOString().slice(0, 16).replace(/:/g, '-')}.db.age`;
  await Bun.write(cilj, fajl);
  console.log(`${cilj}  (${kb(sirovo.length)} → ${kb(fajl.length)})`);
}

async function desifruj(ulaz: string, izlaz?: string) {
  if (!existsSync(ulaz)) greska(`nema fajla ${ulaz}`);
  let podaci: Uint8Array;
  try {
    podaci = await desifrujBackup(await Bun.file(ulaz).bytes(), ucitajPrivatni());
  } catch (e) {
    greska(`dešifrovanje nije uspjelo (pogrešan ključ ili oštećen fajl): ${(e as Error).message}`);
  }
  const cilj = izlaz ?? ulaz.replace(/\.age$/, '').replace(/(\.db)?$/, '.db');
  if (existsSync(cilj)) greska(`${cilj} već postoji — navedi drugi izlaz`);
  await Bun.write(cilj, podaci);
  provjeri(cilj);
  console.log(`${cilj}  (${kb(podaci.length)}) — spremno za "Uvoz backup-a" u Postavkama`);
}

const [komanda, ...ostalo] = process.argv.slice(2);
if (komanda === 'kljuc') await kljuc();
else if (komanda === 'posalji') await posalji(ostalo);
else if (komanda === 'lista' && ostalo[0]) await lista(ostalo[0]);
else if (komanda === 'preuzmi') await preuzmi(ostalo);
else if (komanda === 'sifruj' && ostalo[0]) await sifruj(ostalo[0], ostalo[1]);
else if (komanda === 'desifruj' && ostalo[0]) await desifruj(ostalo[0], ostalo[1]);
else greska('upotreba: kljuc | posalji [--token T] [--baza B] [--uredjaj ID] | lista <bucket> | preuzmi <bucket> [ključ] [--izlaz x.db] | sifruj <baza.db> [izlaz] | desifruj <backup.age> [izlaz.db]');
