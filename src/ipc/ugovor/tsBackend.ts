// Pokreće prave handlere iz `handlers.ts` bez Electrona: `electron` i
// `better-sqlite3` su zamijenjeni tankim shimovima (native build je vezan za
// Electron ABI), a licenca je otključana — ona ima svoje testove.
import { mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Backend, OdgovoriDijaloga, OtvoreniDijalog } from './backend';
import { pokreniLaziTring } from './laziTring';

class BetterSqliteShim extends Database {
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
  BrowserWindow: { getAllWindows: () => [] },
}));
mock.module(path.join(__dirname, '../licenca.ts'), () => ({
  provjeriKanal: () => undefined,
  stanjeLicence: () => ({ stanje: 'aktivna' }),
  aktivirajLicencu: () => ({ stanje: 'aktivna' }),
}));

export async function otvoriTsBackend(): Promise<Backend> {
  // Dinamički, da bi mockovi iznad bili postavljeni prije učitavanja handlera.
  const { registerIpcHandlers } = await import('../handlers');
  const { closeDb } = await import('../../database/db');
  closeDb();
  handleri.clear();
  restart = false;
  Object.assign(dijalog, { sacuvaj: null, otvori: null, potvrda: 0 });
  otvoreniDijalozi.length = 0;
  userData = mkdtempSync(path.join(tmpdir(), 'kasa-ugovor-'));
  const radniFolder = path.join(userData, 'radni');
  mkdirSync(radniFolder);
  registerIpcHandlers();

  const db = new Database(path.join(userData, 'kasa.db'), { strict: true });
  const tring = pokreniLaziTring();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(tring.port));

  return {
    db,
    tring,
    dijalog,
    otvoreniDijalozi,
    radniFolder,
    restartovan: () => restart,
    async ponovoPokreni() {
      closeDb();
      handleri.clear();
      registerIpcHandlers();
    },
    async call(kanal, ...args) {
      const fn = handleri.get(kanal);
      if (!fn) throw new Error(`Kanal ne postoji: ${kanal}`);
      // Handler loguje svaku grešku; u testovima su greške očekivane, pa bez šuma.
      const logGreske = console.error;
      console.error = () => undefined;
      let rezultat: unknown;
      try {
        rezultat = await fn({}, ...JSON.parse(JSON.stringify(args)));
      } finally {
        console.error = logGreske;
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
}
