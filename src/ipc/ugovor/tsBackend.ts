// Pokreće prave handlere iz `handlers.ts` bez Electrona: `electron` i
// `better-sqlite3` su zamijenjeni tankim shimovima (native build je vezan za
// Electron ABI), a licenca je otključana — ona ima svoje testove.
import { mock } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Backend, OdgovoriDijaloga, OtvoreniDijalog } from './backend';
import { BazaTesta } from './bazaTesta';
import { pokreniLaziTring } from './laziTring';

class BetterSqliteShim extends BazaTesta {
  constructor(file: string, opts: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    super(file, opts.readonly ? { readonly: true, strict: true } : { create: !opts.fileMustExist, readwrite: true, strict: true });
  }
  pragma(izraz: string) {
    return this.prepare(`PRAGMA ${izraz}`).all();
  }
}

type Handler = (event: unknown, ...args: any[]) => unknown;
const handleri = new Map<string, Handler>();
let userData = '';
let restart = false;
const dijalog: OdgovoriDijaloga = { sacuvaj: null, otvori: null, potvrda: 0 };
const otvoreniDijalozi: OtvoreniDijalog[] = [];
const dogadjaji: { ime: string; podaci: unknown }[] = [];
let backupR2: import('../../lib/licenca').R2Podaci | null = null;

function zabiljezi(vrsta: OtvoreniDijalog['vrsta'], opcije: Record<string, unknown>): void {
  otvoreniDijalozi.push({ vrsta, opcije });
}

mock.module('better-sqlite3', () => ({ default: BetterSqliteShim }));
mock.module('electron', () => ({
  ipcMain: { handle: (kanal: string, fn: Handler) => { handleri.set(kanal, fn); } },
  app: {
    getPath: () => userData,
    relaunch: () => { restart = true; },
    exit: () => { restart = true; },
  },
  dialog: {
    showSaveDialog: async (o: Record<string, unknown>) => (zabiljezi('sacuvaj', o), { canceled: dijalog.sacuvaj === null, filePath: dijalog.sacuvaj ?? undefined }),
    showOpenDialog: async (o: Record<string, unknown>) => (zabiljezi('otvori', o), { canceled: dijalog.otvori === null, filePaths: dijalog.otvori ? [dijalog.otvori] : [] }),
    showMessageBox: async (o: Record<string, unknown>) => (zabiljezi('potvrda', o), { response: dijalog.potvrda }),
  },
  BrowserWindow: {
    // Prije pravog prozora: jedan zatvoren i jedan čiji send baca — događaji
    // moraju ipak stići (src/ipc/backup.ts preskače/hvata po prozoru).
    getAllWindows: () => [
      { isDestroyed: () => true, webContents: { send: () => { throw new Error('Object has been destroyed'); } } },
      { isDestroyed: () => false, webContents: { send: () => { throw new Error('Render frame was disposed'); } } },
      { isDestroyed: () => false, webContents: { send: (ime: string, podaci: unknown) => { dogadjaji.push({ ime, podaci: JSON.parse(JSON.stringify(podaci ?? null)) }); } } },
    ],
  },
}));
mock.module(path.join(__dirname, '../licenca.ts'), () => ({
  provjeriKanal: () => undefined,
  stanjeLicence: () => ({ stanje: 'aktivna' }),
  aktivirajLicencu: () => ({ stanje: 'aktivna' }),
  backupPristup: () => backupR2,
}));

/**
 * Poziv handlera kao iz Electron IPC-a, bez JSON-a: `undefined` ostaje
 * `undefined` (Backend.call ga kroz JSON vraća kao null). Za otvoren TS backend.
 */
export async function pozoviHandlerBezJsona(kanal: string, ...args: unknown[]): Promise<unknown> {
  const fn = handleri.get(kanal);
  if (!fn) throw new Error(`Kanal ne postoji: ${kanal}`);
  return fn({}, ...args);
}

/** `baza`: postojeći fajl baze koji se kopira kao kasa.db prije otvaranja (vidi OpcijeBackenda). */
export async function otvoriTsBackend(baza?: string): Promise<Backend> {
  // Dinamički, da bi mockovi iznad bili postavljeni prije učitavanja handlera.
  const { registerIpcHandlers } = await import('../handlers');
  const { closeDb } = await import('../../database/db');
  closeDb();
  handleri.clear();
  restart = false;
  Object.assign(dijalog, { sacuvaj: null, otvori: null, potvrda: 0 });
  otvoreniDijalozi.length = 0;
  dogadjaji.length = 0;
  backupR2 = null;
  userData = mkdtempSync(path.join(tmpdir(), 'kasa-ugovor-'));
  const radniFolder = path.join(userData, 'radni');
  mkdirSync(radniFolder);
  if (baza) copyFileSync(baza, path.join(userData, 'kasa.db'));
  registerIpcHandlers();

  const putanjaBaze = path.join(userData, 'kasa.db');
  let db = new BazaTesta(putanjaBaze, { strict: true });
  const tring = pokreniLaziTring();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(tring.port));

  const backend: Backend = {
    get db() { return db; },
    tring,
    dijalog,
    otvoreniDijalozi,
    dogadjaji,
    postaviBackupLicencu: (r2) => { backupR2 = r2; },
    radniFolder,
    restartovan: () => restart,
    async kanali() {
      return [...handleri.keys()].sort();
    },
    async ponovoPokreni() {
      closeDb();
      handleri.clear();
      registerIpcHandlers();
    },
    // Isti poziv; tipove argumenata i rezultata daje Backend.pozovi.
    pozovi: (kanal, ...args) => (backend.call as unknown as (kanal: string, ...args: unknown[]) => Promise<never>)(kanal, ...args),
    async call(kanal, ...args) {
      const fn = handleri.get(kanal);
      if (!fn) throw new Error(`Kanal ne postoji: ${kanal}`);
      // Handler loguje svaku grešku; u testovima su greške očekivane, pa bez šuma.
      const logGreske = console.error;
      console.error = () => undefined;
      // db:restore briše i zamjenjuje kasa.db; Windows ne da obrisati fajl koji
      // drži druga konekcija (ova, iz procesa testa), pa se ona pusti za vrijeme
      // uvoza. Nova konekcija gleda bazu kakva je poslije uvoza.
      const uvoz = kanal === 'db:restore';
      if (uvoz) db.close();
      let rezultat: unknown;
      try {
        rezultat = await fn({}, ...JSON.parse(JSON.stringify(args)));
      } finally {
        console.error = logGreske;
        if (uvoz) db = new BazaTesta(putanjaBaze, { strict: true });
      }
      return rezultat === undefined ? null : JSON.parse(JSON.stringify(rezultat));
    },
    async close() {
      tring.stop();
      db.close();
      closeDb();
      rmSync(userData, { recursive: true, force: true });
    },
  };
  return backend;
}
