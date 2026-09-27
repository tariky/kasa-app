import { test, expect } from 'bun:test';
// `better-sqlite3` je kompajliran za Electron ABI i ne učitava se van Electrona,
// pa testovi voze isti SQL kroz bun:sqlite (API koji migracije koriste —
// prepare().all() i exec() — je identičan).
import { Database } from 'bun:sqlite';
import { schema } from './schema';
import { runMigrations, KORACI_MIGRACIJA, KOD_MIGRACIJA } from './migrations';
import migracije from './migracije.json';
import { TABELE_SHEME } from './restore';
import { LEGACY_SCHEMA } from '../ipc/ugovor/staraBaza';
import { provjeriPin } from '../lib/korisnici';

type Db = any;

// Sve što migracije moraju doraditi na staroj bazi.
const ADDED_COLUMNS: Array<[string, string]> = [
  ['products', 'tip'],
  ['primka_stavke', 'nabavnaCijena'],
  ['primka_stavke', 'rabat'],
  ['primka_stavke', 'zavisniTroskovi'],
  ['primka_stavke', 'staraCijena'],
  ['primke', 'dobavljacNaziv'],
  ['primke', 'dobavljacId'],
  ['primke', 'dobavljacAdresa'],
  ['primke', 'brojFakture'],
  ['orders', 'kupacNaziv'],
  ['orders', 'kupacIdBroj'],
  ['orders', 'kupacAdresa'],
  ['orders', 'kupacGrad'],
  ['orders', 'kupacPostanskiBroj'],
  ['orders', 'isManual'],
  ['orders', 'refundedAt'],
  ['orders', 'prilogBroj'],
  ['orders', 'datumValute'],
  ['orders', 'napomena'],
  ['products', 'plocaSirina'],
  ['products', 'plocaVisina'],
  ['cijena_historija', 'ponistena'],
  ['cijena_historija', 'cijenaUProdaji'],
];
const ADDED_TABLES = [
  'dobavljaci', 'kupci', 'pending_receipts', 'prilog_stavke',
  'normativi', 'radni_nalozi', 'radni_nalog_stavke', 'radni_nalog_proizvodi', 'cijena_historija',
];

function columns(db: Db, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map(r => r.name));
}

function tables(db: Db): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return new Set(rows.map(r => r.name));
}

// Ono što `db:restore` radi nakon zamjene fajla: getDb() → schema + migracije.
function openAsCurrentVersion(db: Db): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  runMigrations(db);
}

function legacyDbWithData(): Db {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Stari Kasir', '1234', 'kasir')").run();
  db.prepare(
    "INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('001', 'Kafa', 2.5, 'E')"
  ).run();
  db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (1, 2.5, 0.36, 'gotovina', 'completed')"
  ).run();
  return db;
}

// Test bi bio bezvrijedan da stara schema slučajno već sadrži migrirane kolone.
test('polazna baza zaista nema ništa što migracije dodaju', () => {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  for (const [table, column] of ADDED_COLUMNS) {
    expect(columns(db, table)).not.toContain(column);
  }
  for (const table of ADDED_TABLES) {
    expect(tables(db)).not.toContain(table);
  }
  db.close();
});

test('backup iz starije verzije dobija sve kolone i tabele', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  for (const [table, column] of ADDED_COLUMNS) {
    expect(columns(db, table)).toContain(column);
  }
  for (const table of ADDED_TABLES) {
    expect(tables(db)).toContain(table);
  }
  db.close();
});

test('podaci iz backup-a preživljavaju nadogradnju', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  // PIN iz čistog teksta postaje heš (korak hesirajStarePinove).
  const user = db.prepare('SELECT ime, uloga, pin FROM users WHERE id = 1').get() as any;
  expect({ ime: user.ime, uloga: user.uloga }).toEqual({ ime: 'Stari Kasir', uloga: 'kasir' });
  expect(provjeriPin('1234', user.pin)).toBe(true);

  // Nove kolone dobijaju defaulte, stare vrijednosti ostaju.
  const product = db
    .prepare("SELECT naziv, cijena, tip FROM products WHERE sifra = '001'")
    .get() as any;
  expect(product).toEqual({ naziv: 'Kafa', cijena: 2.5, tip: 'artikal' });

  const order = db.prepare('SELECT ukupno, isManual, refundedAt FROM orders WHERE id = 1').get() as any;
  expect(order).toEqual({ ukupno: 2.5, isManual: 0, refundedAt: null });

  expect((db.prepare('PRAGMA integrity_check').get() as any).integrity_check).toBe('ok');
  db.close();
});

test('nakon nadogradnje se u staru bazu može pisati kroz nove kolone', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  db.prepare(
    "INSERT INTO dobavljaci (naziv, idBroj) VALUES ('Novi Dobavljač', '4200000000001')"
  ).run();
  db.prepare(
    "INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, brojFakture) VALUES ('P-1', '2026-08-11', 'Novi Dobavljač', 'F-1')"
  ).run();
  db.prepare(
    'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (1, 1, 10, 2.5, 1.8, 5, ?)'
  ).run('E');

  const stavka = db.prepare('SELECT nabavnaCijena, rabat FROM primka_stavke WHERE id = 1').get() as any;
  expect(stavka).toEqual({ nabavnaCijena: 1.8, rabat: 5 });
  db.close();
});

test('stare stavke primke nemaju zapamćenu staru cijenu (NULL), nova se može upisati', () => {
  const db = legacyDbWithData();
  db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES ('P-OLD', '2025-01-10')").run();
  db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 3, 2.5, 'E')").run();
  openAsCurrentVersion(db);

  expect((db.prepare('SELECT staraCijena FROM primka_stavke WHERE id = 1').get() as any).staraCijena).toBeNull();
  db.prepare(
    "INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa, staraCijena) VALUES (1, 1, 1, 3, 'E', 2.5)"
  ).run();
  expect((db.prepare('SELECT staraCijena FROM primka_stavke WHERE id = 2').get() as any).staraCijena).toBe(2.5);
  db.close();
});

test('historija cijena starih primki se ne izmišlja: tabela je nakon nadogradnje prazna', () => {
  const db = legacyDbWithData();
  db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES ('P-OLD', '2025-01-10')").run();
  db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 3, 2.5, 'E')").run();
  openAsCurrentVersion(db);

  expect((db.prepare('SELECT COUNT(*) AS n FROM cijena_historija').get() as any).n).toBe(0);
  db.prepare(
    "INSERT INTO cijena_historija (productId, izvor, izvorId, staraCijena, novaCijena) VALUES (1, 'primka', 1, 2.5, 3)"
  ).run();
  expect(() => db.prepare(
    "INSERT INTO cijena_historija (productId, izvor, izvorId, staraCijena, novaCijena) VALUES (1, 'nesto', NULL, 1, 2)"
  ).run()).toThrow();
  db.close();
});

test('nakon nadogradnje se prilog može upisati na stari račun', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);

  db.prepare('UPDATE orders SET prilogBroj = 1 WHERE id = 1').run();
  db.prepare(
    "INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 2, 2.5, 'E')"
  ).run();

  const stavka = db.prepare('SELECT orderId, kolicina, cijena FROM prilog_stavke WHERE id = 1').get() as any;
  expect(stavka).toEqual({ orderId: 1, kolicina: 2, cijena: 2.5 });
  expect((db.prepare('SELECT prilogBroj FROM orders WHERE id = 1').get() as any).prilogBroj).toBe(1);
  db.close();
});

test('migracije su idempotentne — ponovljeni uvoz iste baze ne mijenja ništa', () => {
  const db = legacyDbWithData();
  openAsCurrentVersion(db);
  const shema = () => db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all();
  const prvi = shema();
  const promjene = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

  expect(() => openAsCurrentVersion(db)).not.toThrow();
  expect(() => openAsCurrentVersion(db)).not.toThrow();
  expect(shema()).toEqual(prvi);
  expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(promjene);
  db.close();
});

test('stari zapisi načina plaćanja postaju kanonski; drugi prolaz ne mijenja ništa', () => {
  const db = legacyDbWithData(); // račun 1: 'gotovina'
  const racun = db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (1, 8, 0, ?, 'completed')"
  );
  for (const nacin of [
    'cek', '{"Gotovina":5,"Kartica":3}', ' Gotovina ', 'KARTICA', 'virman', 'Ček', '{"gotovina":3,"cek":5}', 'Bitcoin', '{"gotovina":5,"zlato":3}',
  ]) racun.run(nacin);
  const nacini = () => (db.prepare('SELECT nacinPlacanja FROM orders ORDER BY id').all() as { nacinPlacanja: string }[])
    .map(r => r.nacinPlacanja);

  openAsCurrentVersion(db);
  const poslije = nacini();
  expect(poslije).toEqual([
    'Gotovina', 'Ček', '{"gotovina":5,"kartica":3}', 'Gotovina', 'Kartica', 'Virman', 'Ček', '{"gotovina":3,"cek":5}',
    // Oblik koji parser ne razumije ostaje kakav jeste (izvoz ga označava).
    'Bitcoin', '{"gotovina":5,"zlato":3}',
  ]);

  const promjene = db.prepare('SELECT total_changes() AS n').get() as { n: number };
  openAsCurrentVersion(db);
  expect(nacini()).toEqual(poslije);
  expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(promjene.n);
  db.close();
});

test('kupci dobijaju kolone za zadane vrijednosti dokumenata', () => {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  runMigrations(db as Db);
  const cols = (db.prepare('PRAGMA table_info(kupci)').all() as { name: string }[]).map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['rokPlacanjaDana', 'nacinPlacanja', 'rabat']));
  runMigrations(db as Db); // idempotentno
  db.close();
});

test('aktuelna baza prolazi kroz migracije bez promjena', () => {
  const db: Db = new Database(':memory:');
  openAsCurrentVersion(db);
  const before = [...tables(db)].sort().join(',');
  runMigrations(db);
  expect([...tables(db)].sort().join(',')).toBe(before);
  db.close();
});

// ─── migracije.json ─────────────────────────────────────────

const SQL_KLJUCEVI = ['tabela', 'kolona', 'sql', 'samoAkoTabelaPostoji', 'opis'];

test('migracije.json: svaki korak je SQL (tabela + sql) ili kod, bez nepoznatih ključeva', () => {
  expect(migracije.length).toBeGreaterThan(0);
  for (const k of migracije as Record<string, unknown>[]) {
    const gdje = JSON.stringify(k);
    if ('kod' in k) {
      expect(Object.keys(k).filter(x => x !== 'kod' && x !== 'opis'), gdje).toEqual([]);
      expect(typeof k.kod, gdje).toBe('string');
      continue;
    }
    expect(Object.keys(k).filter(x => !SQL_KLJUCEVI.includes(x)), gdje).toEqual([]);
    expect(typeof k.tabela, gdje).toBe('string');
    expect(Array.isArray(k.sql) && k.sql.length > 0 && k.sql.every(s => typeof s === 'string'), gdje).toBe(true);
    if ('kolona' in k) expect(typeof k.kolona, gdje).toBe('string');
    if ('samoAkoTabelaPostoji' in k) expect(typeof k.samoAkoTabelaPostoji, gdje).toBe('boolean');
  }
});

test('svaki kod korak iz migracije.json ima funkciju i svaka funkcija je korak (jednom)', () => {
  const uJsonu = KORACI_MIGRACIJA.flatMap(k => ('kod' in k ? [k.kod] : []));
  expect(new Set(uJsonu).size).toBe(uJsonu.length);
  expect([...uJsonu].sort()).toEqual([...KOD_MIGRACIJA.keys()].sort());
});

// Korak s kolonom se preskače kad kolona postoji — ako ALTER dodaje drugu
// kolonu (ili u drugu tabelu), drugi prolaz ponovi ALTER i pukne.
test('korak s kolonom dodaje baš tu kolonu u svoju tabelu (prvi ALTER), ostali SQL je ALTER te tabele', () => {
  for (const k of KORACI_MIGRACIJA) {
    if ('kod' in k || k.kolona === undefined) continue;
    const alteri = k.sql.map(s => s.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) /)?.slice(1));
    expect(alteri[0], k.kolona).toEqual([k.tabela, k.kolona]);
    for (const a of alteri) expect(a?.[0], k.kolona).toBe(k.tabela);
  }
});

// Uvoz backup-a odbija tabele kojih nema u shemi (restore.ts), pa ni
// migracija ne smije praviti drugu.
test('migracije prave samo tabele iz schema.ts', () => {
  for (const k of KORACI_MIGRACIJA) {
    if ('kod' in k) continue;
    for (const sql of k.sql) {
      const nova = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1];
      if (nova) expect(TABELE_SHEME.has(nova), nova).toBe(true);
    }
  }
});
