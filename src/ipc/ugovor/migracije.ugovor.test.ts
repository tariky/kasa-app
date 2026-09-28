// Ugovor za otvaranje baze iz starije verzije programa (ili uvezenog backup-a):
// shema, migracije (src/database/migracije.json i koraci u kodu) i seed — vidi
// backend.ts. Oba backenda moraju dati istu bazu, a ponovno otvaranje iste
// baze ne smije promijeniti ništa.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { otvoriBackend, prijavi, type Backend } from './backend';
import { BazaTesta } from './bazaTesta';
import { LEGACY_SCHEMA, LEGACY_SCHEMA_S_TABELAMA } from './staraBaza';
import { schema } from '../../database/schema';
import { provjeriPin } from '../../lib/korisnici';

let folder: string;
let b: Backend;

/** Stara baza s ponešto podataka, kao fajl (backend dobije kopiju). */
function staraBaza(): string {
  const putanja = path.join(folder, 'stara.db');
  const db = new BazaTesta(putanja);
  db.exec(LEGACY_SCHEMA);
  db.exec(`
    INSERT INTO users (ime, pin, uloga) VALUES ('Vlasnik', '9876', 'admin'), ('Stari Kasir', '1234', 'kasir');
    INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('001', 'Kafa', 2.5, 'E');
    INSERT INTO primke (brojPrimke, datum) VALUES ('P-OLD', '2025-01-10');
    INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 3, 2.5, 'E');
    INSERT INTO settings (key, value) VALUES ('firma.naziv', 'Stara radnja');
  `);
  const racun = db.prepare("INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (2, 8, 0, ?, 'completed')");
  for (const nacin of ['gotovina', ' Gotovina ', 'cek', '{"Gotovina":5,"Kartica":3}', 'Bitcoin']) racun.run(nacin);
  db.close();
  return putanja;
}

beforeEach(async () => {
  folder = mkdtempSync(path.join(tmpdir(), 'kasa-migracije-'));
  b = await otvoriBackend({ prijava: null, baza: staraBaza() });
});
afterEach(async () => {
  await b.close();
  rmSync(folder, { recursive: true, force: true });
});

/** Kolone koje migracije dodaju tabelama stare baze, redom izvršavanja. */
const DODANO_REDOM: Record<string, string[]> = {
  primka_stavke: ['nabavnaCijena', 'rabat', 'zavisniTroskovi', 'staraCijena'],
  primke: ['dobavljacNaziv', 'dobavljacId', 'dobavljacAdresa', 'brojFakture'],
  products: ['tip', 'plocaSirina', 'plocaVisina', 'slobodan'],
  orders: [
    'kupacNaziv', 'kupacIdBroj', 'kupacAdresa', 'kupacGrad', 'kupacPostanskiBroj',
    'isManual', 'refundedAt', 'prilogBroj', 'prilogNaziv', 'datumValute', 'napomena',
  ],
};

function kolone(db: Database, tabela: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map(k => k.name);
}

/** Tabele i indeksi koje program pravi (bez internih `sqlite_*`). */
function objekti(db: Database): string[] {
  return (db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as
    { type: string; name: string }[]).map(o => `${o.type} ${o.name}`);
}

/** Cijela baza: sqlite_master i svi redovi svake tabele. */
function snimak(db: Database): unknown {
  const master = db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all() as
    { type: string; name: string }[];
  return {
    master,
    redovi: master.filter(o => o.type === 'table').map(o => [o.name, db.prepare(`SELECT * FROM "${o.name}" ORDER BY rowid`).all()]),
  };
}

test('stara baza dobija sve tabele, indekse i kolone nove; kolone se dodaju redom migracija', () => {
  const nova = new Database(':memory:');
  nova.exec(schema);
  const stara = new Database(':memory:');
  stara.exec(LEGACY_SCHEMA);

  expect(objekti(b.db)).toEqual(objekti(nova));
  for (const tabela of objekti(nova).filter(o => o.startsWith('table ')).map(o => o.slice(6))) {
    const polazne = kolone(stara, tabela).length > 0 ? kolone(stara, tabela) : kolone(nova, tabela);
    expect([tabela, ...kolone(b.db, tabela)]).toEqual([tabela, ...polazne, ...(DODANO_REDOM[tabela] ?? [])]);
    expect([tabela, ...[...kolone(b.db, tabela)].sort()]).toEqual([tabela, ...[...kolone(nova, tabela)].sort()]);
  }
  nova.close();
  stara.close();
});

test('podaci stare baze ostaju: način plaćanja postaje kanonski, PIN-ovi heš, nove kolone zadane', async () => {
  const korisnici = b.db.prepare('SELECT id, ime, uloga, pin FROM users ORDER BY id').all() as
    Array<{ id: number; ime: string; uloga: string; pin: string }>;
  expect(korisnici.map(k => [k.id, k.ime, k.uloga])).toEqual([[1, 'Vlasnik', 'admin'], [2, 'Stari Kasir', 'kasir']]);
  expect(provjeriPin('9876', korisnici[0].pin)).toBe(true);
  expect(provjeriPin('1234', korisnici[1].pin)).toBe(true);

  expect(b.db.prepare('SELECT nacinPlacanja, isManual, refundedAt, kupacNaziv FROM orders ORDER BY id').all()).toEqual([
    { nacinPlacanja: 'Gotovina', isManual: 0, refundedAt: null, kupacNaziv: null },
    { nacinPlacanja: 'Gotovina', isManual: 0, refundedAt: null, kupacNaziv: null },
    { nacinPlacanja: 'Ček', isManual: 0, refundedAt: null, kupacNaziv: null },
    { nacinPlacanja: '{"gotovina":5,"kartica":3}', isManual: 0, refundedAt: null, kupacNaziv: null },
    // Oblik koji parser ne razumije ostaje kakav jeste (izvoz ga označava).
    { nacinPlacanja: 'Bitcoin', isManual: 0, refundedAt: null, kupacNaziv: null },
  ]);
  expect(b.db.prepare('SELECT naziv, tip, plocaSirina, slobodan FROM products').all())
    .toEqual([{ naziv: 'Kafa', tip: 'artikal', plocaSirina: null, slobodan: 0 }]);
  expect(b.db.prepare('SELECT kolicina, nabavnaCijena, rabat, zavisniTroskovi, staraCijena FROM primka_stavke').all())
    .toEqual([{ kolicina: 3, nabavnaCijena: 0, rabat: 0, zavisniTroskovi: 0, staraCijena: null }]);
  expect(b.db.prepare('SELECT COUNT(*) AS n FROM cijena_historija').get()).toEqual({ n: 0 });
  expect(b.db.prepare("SELECT key, value FROM settings WHERE key IN ('firma.naziv', 'tring.host') ORDER BY key").all())
    .toEqual([{ key: 'firma.naziv', value: 'Stara radnja' }, { key: 'tring.host', value: 'localhost' }]);
  expect(b.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });

  expect(await prijavi(b, '1234')).toMatchObject({ id: 2, uloga: 'kasir', zadaniPin: false });
});

test('ponovno otvaranje iste baze (drugi i treći prolaz migracija) ne mijenja ništa', async () => {
  const prije = snimak(b.db);
  await b.ponovoPokreni();
  expect(snimak(b.db)).toEqual(prije);
  await b.ponovoPokreni();
  expect(snimak(b.db)).toEqual(prije);
});

// ─── Tabela postoji, kolona ne ──────────────────────────────

/** Kasnija stara baza (LEGACY_SCHEMA_S_TABELAMA) s kupcem, fakturom po prilogu i promjenom cijene. */
function staraBazaSTabelama(): string {
  const putanja = path.join(folder, 'stara-s-tabelama.db');
  const db = new BazaTesta(putanja);
  db.exec(LEGACY_SCHEMA_S_TABELAMA);
  db.exec(`
    INSERT INTO users (ime, pin, uloga) VALUES ('Vlasnik', '9876', 'admin');
    INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES ('001', 'Kafa', 2.5, 'E');
    INSERT INTO kupci (naziv, idBroj, grad) VALUES ('Stari kupac', '4200000000001', 'Sarajevo');
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status) VALUES (1, 10, 1.45, 'Virman', '7', 'completed');
    INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (1, 1, 4, 2.5, 'E');
    INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (1, 'rucno', 2, 2.5, '2025-06-01 10:00:00');
  `);
  db.close();
  return putanja;
}

describe('stara baza s kupcima, prilogom i historijom cijena bez novih kolona', () => {
  beforeEach(async () => {
    await b.close();
    b = await otvoriBackend({ prijava: null, baza: staraBazaSTabelama() });
  });

  test('tabela koja postoji dobija kolone koje joj fale, redom migracija (i samoAkoTabelaPostoji)', () => {
    const nova = new Database(':memory:');
    nova.exec(schema);
    const stara = new Database(':memory:');
    stara.exec(LEGACY_SCHEMA_S_TABELAMA);
    const dodano: Record<string, string[]> = {
      ...DODANO_REDOM,
      kupci: ['rokPlacanjaDana', 'nacinPlacanja', 'rabat'],
      prilog_stavke: ['rabat'],
      cijena_historija: ['ponistena', 'cijenaUProdaji'],
    };

    expect(objekti(b.db)).toEqual(objekti(nova));
    for (const tabela of objekti(nova).filter(o => o.startsWith('table ')).map(o => o.slice(6))) {
      const polazne = kolone(stara, tabela).length > 0 ? kolone(stara, tabela) : kolone(nova, tabela);
      expect([tabela, ...kolone(b.db, tabela)]).toEqual([tabela, ...polazne, ...(dodano[tabela] ?? [])]);
      expect([tabela, ...[...kolone(b.db, tabela)].sort()]).toEqual([tabela, ...[...kolone(nova, tabela)].sort()]);
    }
    nova.close();
    stara.close();
  });

  test('stari redovi dobiju zadane vrijednosti novih kolona, a kanali ih čitaju', async () => {
    expect(b.db.prepare('SELECT naziv, rokPlacanjaDana, nacinPlacanja, rabat FROM kupci').all())
      .toEqual([{ naziv: 'Stari kupac', rokPlacanjaDana: null, nacinPlacanja: null, rabat: null }]);
    expect(b.db.prepare('SELECT kolicina, rabat FROM prilog_stavke').all()).toEqual([{ kolicina: 4, rabat: 0 }]);
    expect(b.db.prepare('SELECT staraCijena, novaCijena, ponistena, cijenaUProdaji FROM cijena_historija').all())
      .toEqual([{ staraCijena: 2, novaCijena: 2.5, ponistena: 0, cijenaUProdaji: null }]);

    await prijavi(b, '9876');
    expect(await b.pozovi('kupac:getAll')).toMatchObject([{ naziv: 'Stari kupac', rokPlacanjaDana: null, nacinPlacanja: null, rabat: null }]);
    expect((await b.pozovi('prilog:getStavke', 1)).map(s => [s.productId, s.kolicina, s.rabat])).toEqual([[1, 4, 0]]);
    // Zalihe na dan čitaju staru historiju: prije promjene 2, poslije 2,5.
    const cijenaNaDan = async (dan: string) => (await b.pozovi('izvoz:knjigovodja', dan, dan)).zalihe.map(z => [z.sifra, z.cijena]);
    expect(await cijenaNaDan('2025-05-31')).toEqual([['001', 2]]);
    expect(await cijenaNaDan('2025-06-01')).toEqual([['001', 2.5]]);
  });

  test('ponovno otvaranje ne mijenja ništa', async () => {
    const prije = snimak(b.db);
    await b.ponovoPokreni();
    expect(snimak(b.db)).toEqual(prije);
  });
});
