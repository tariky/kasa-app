// Poređenje TS i Rust backenda nad kopijom stvarne baze: svi kanali koji
// samo čitaju (i pregledi primki, koji rade u transakciji koju ponište) moraju
// vratiti isto. Original se ne dira — svaki backend dobije svoju kopiju.
//
//   KASA_STVARNA_BAZA=~/Library/Application\ Support/Pazar/kasa.db KASA_STVARNA_PIN=<admin PIN> \
//     bun test src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts
//
// Kanali traže prijavu (src/ipc/sesija.ts), pa oba backenda prvo prijave
// administratora PIN-om iz KASA_STVARNA_PIN.
// Bez KASA_STVARNA_BAZA test se preskače. Rust binarij: vidi rustBackend.ts.
import { test, expect, describe, beforeAll, afterAll, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const IZVOR = process.env.KASA_STVARNA_BAZA;
const PIN = process.env.KASA_STVARNA_PIN ?? '';

type Pozovi = (kanal: string, ...args: unknown[]) => Promise<unknown>;

function kopija(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kasa-poredjenje-'));
  for (const sufiks of ['', '-wal', '-shm']) {
    if (existsSync(IZVOR + sufiks)) copyFileSync(IZVOR + sufiks, path.join(dir, 'kasa.db' + sufiks));
  }
  return dir;
}

/** TS handleri nad kopijom (isti shimovi kao tsBackend.ts). */
async function tsBackend(userData: string): Promise<Pozovi> {
  class BetterSqliteShim extends Database {
    constructor(file: string, opts: { readonly?: boolean; fileMustExist?: boolean } = {}) {
      super(file, opts.readonly ? { readonly: true, strict: true } : { create: !opts.fileMustExist, readwrite: true, strict: true });
    }
    pragma(izraz: string) { return this.prepare(`PRAGMA ${izraz}`).all(); }
  }
  const handleri = new Map<string, (e: unknown, ...a: any[]) => unknown>();
  mock.module('better-sqlite3', () => ({ default: BetterSqliteShim }));
  mock.module('electron', () => ({
    ipcMain: { handle: (k: string, fn: any) => { handleri.set(k, fn); } },
    app: { getPath: () => userData, relaunch: () => undefined, exit: () => undefined },
    dialog: {},
    BrowserWindow: { getAllWindows: () => [] },
  }));
  mock.module(path.join(__dirname, '../licenca.ts'), () => ({
    provjeriKanal: () => undefined,
    stanjeLicence: () => ({ stanje: 'aktivna' }),
    aktivirajLicencu: () => ({ stanje: 'aktivna' }),
    backupPristup: () => null,
  }));
  const { registerIpcHandlers } = await import('../handlers');
  registerIpcHandlers();
  return async (kanal, ...args) => {
    const log = console.error;
    console.error = () => undefined;
    try {
      const fn = handleri.get(kanal);
      if (!fn) throw new Error(`Kanal ne postoji: ${kanal}`);
      const r = await fn({}, ...JSON.parse(JSON.stringify(args)));
      return r === undefined ? null : JSON.parse(JSON.stringify(r));
    } catch (e: any) {
      return { __greska: e.message };
    } finally {
      console.error = log;
    }
  };
}

/** Rust backend nad kopijom, preko rustBackend.ts. */
async function rustBackend(userData: string): Promise<{ pozovi: Pozovi; zatvori: () => Promise<void> }> {
  const { otvoriRustBackendNad } = await import('./rustBackend');
  const b = await otvoriRustBackendNad(userData);
  return {
    pozovi: async (kanal, ...args) => {
      try { return await b.call(kanal, ...args); } catch (e: any) { return { __greska: e.message }; }
    },
    zatvori: () => b.close(),
  };
}

describe.skipIf(!IZVOR)('stvarna baza: TS i Rust vraćaju isto', () => {
  let ts: Pozovi;
  let rs: { pozovi: Pozovi; zatvori: () => Promise<void> };
  let citaj: Database;
  const folderi: string[] = [];

  beforeAll(async () => {
    const [a, b] = [kopija(), kopija()];
    folderi.push(a, b);
    rs = await rustBackend(b);
    if (!(await rs.pozovi('user:login', PIN))) throw new Error('KASA_STVARNA_PIN nije PIN korisnika u bazi');
    // Harness Rust backenda upiše port lažnog Tring uređaja; TS kopija dobije isti.
    const port = await rs.pozovi('settings:get', 'tring.port');
    const pisi = new Database(path.join(a, 'kasa.db'));
    pisi.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tring.port', ?)").run(port as string);
    pisi.close();
    ts = await tsBackend(a);
    if (!(await ts('user:login', PIN))) throw new Error('KASA_STVARNA_PIN nije PIN korisnika u bazi');
    citaj = new Database(path.join(a, 'kasa.db'), { readonly: true });
  });

  afterAll(async () => {
    citaj?.close();
    await rs?.zatvori();
    for (const f of folderi) rmSync(f, { recursive: true, force: true });
  });

  const ids = (sql: string) => (citaj.prepare(sql).all() as Array<{ id: number }>).map(r => r.id);

  function pozivi(): Array<[string, ...unknown[]]> {
    const p: Array<[string, ...unknown[]]> = [
      ['user:getAll'], ['product:getAll'], ['product:getAll', 'materijal'], ['product:getAll', 'usluga'],
      ['product:search', 'a'], ['product:search', ''], ['materijal:search', ''],
      ['dobavljac:getAll'], ['kupac:getAll'], ['kupac:search', 'a'],
      ['primka:getAll'], ['primka:nextBroj'], ['nivelacija:getAll'], ['nivelacija:getAll', '2000-01-01', '2100-12-31'],
      ['order:getAll'], ['order:getFiscalGaps'], ['fiscal:getNumeracija'], ['pending:list'],
      ['ponuda:getAll'], ['ponuda:nextBroj'], ['nalog:getAll'], ['nalog:getAll', 'aktivni'], ['nalog:nextBroj'],
      ['settings:getTring'], ['settings:getFirma'], ['settings:get', 'proizvodnja.enabled'],
      ['savedCarts:list'], ['fakturaSkice:list'], ['cash:getToday'], ['cash:lastPolog'], ['cash:drawerState'],
      ['report:getData', 'dnevni', '2000-01-01', '2100-12-31'], ['report:getData', 'primke', '2000-01-01', '2100-12-31'],
      ['izvoz:knjigovodja', '2000-01-01', '2100-12-31'], ['izvoz:knjigovodja', '2026-09-01', '2026-09-30'],
    ];
    for (const id of ids('SELECT id FROM orders')) p.push(['order:get', id], ['prilog:getStavke', id]);
    for (const id of ids('SELECT id FROM primke')) p.push(['primka:get', id], ['primka:pregledBrisanja', id]);
    for (const id of ids('SELECT id FROM nivelacije')) p.push(['nivelacija:get', id]);
    for (const id of ids('SELECT id FROM ponude')) p.push(['ponuda:get', id], ['nalog:zaPonudu', id]);
    for (const id of ids('SELECT id FROM radni_nalozi')) p.push(['nalog:get', id], ['nalog:kalkulacija', id]);
    for (const id of ids('SELECT id FROM products')) p.push(['product:get', id], ['normativ:get', id]);
    return p;
  }

  test('svi kanali za čitanje', async () => {
    const razlike: string[] = [];
    const lista = pozivi();
    for (const [kanal, ...args] of lista) {
      const [a, b] = [await ts(kanal, ...args), await rs.pozovi(kanal, ...args)];
      if (!Bun.deepEquals(a, b, true)) razlike.push(`${kanal}(${args.join(', ')}):\n  TS:   ${JSON.stringify(a)}\n  Rust: ${JSON.stringify(b)}`);
    }
    console.log(`upoređeno ${lista.length} poziva`);
    expect(razlike).toEqual([]);
  });

  test('pregled izmjene svake primke (bez upisa) je isti', async () => {
    for (const id of ids('SELECT id FROM primke')) {
      const primka = await ts('primka:get', id) as any;
      const data = { ...primka, stavke: primka.stavke.map((s: any) => ({ ...s, cijena: s.cijena + 1 })) };
      expect(await rs.pozovi('primka:pregledIzmjene', data)).toEqual(await ts('primka:pregledIzmjene', data));
    }
  });
});
