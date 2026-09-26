// Automatski backup u Electron main procesu: veže motor (src/lib/backupTok.ts)
// za userData, bazu, prozore i tajmer. Stanje je u userData/backup-stanje.json
// (van baze). Kredencijali ne izlaze iz main procesa.
import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb } from '../database/db';
import type { BackupInfo } from '../lib/backupRaspored';
import { napraviBackup } from '../lib/backupTok';
import { r2Posalji } from '../lib/r2';
import { uredjajId } from '../lib/uredjaj';
import { backupPristup } from './licenca';

const PROVJERA_MS = 60_000;

const putanjaStanja = () => path.join(app.getPath('userData'), 'backup-stanje.json');

let motor: ReturnType<typeof napraviBackup> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

/** Pravi motor; zove ga registerIpcHandlers (i svaki ugovorni test ispočetka). */
export function registrujBackup(): void {
  motor = napraviBackup({
    pristup: backupPristup,
    citajStanje: () => (existsSync(putanjaStanja()) ? JSON.parse(readFileSync(putanjaStanja(), 'utf8')) : {}),
    pisiStanje: s => writeFileSync(putanjaStanja(), JSON.stringify(s, null, 2)),
    kopijaBaze: () => {
      // VACUUM INTO: dosljedna kopija i s WAL-om; sinhrono, ~desetine ms.
      const cilj = path.join(tmpdir(), `pazar-backup-${randomUUID()}.db`);
      try {
        getDb().prepare('VACUUM INTO ?').run(cilj);
        return new Uint8Array(readFileSync(cilj));
      } finally {
        rmSync(cilj, { force: true });
      }
    },
    posalji: (r2, kljuc, tijelo, napredak) => r2Posalji(r2, kljuc, tijelo, napredak),
    // Svaki prozor zasebno: zatvoren ili pokvaren ne smije uskratiti ostale.
    javi: d => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue;
        try { w.webContents.send('backup:stanje', d); } catch { /* prozor se upravo zatvara */ }
      }
    },
    uredjaj: uredjajId,
    sada: () => new Date(),
    endpoint: process.env.PAZAR_BACKUP_ENDPOINT,
  });
}

function m() {
  if (!motor) registrujBackup();
  return motor!;
}

export const backupInfo = (): BackupInfo => m().info();
export const backupSada = (): Promise<BackupInfo> => m().sada();

/** Nova licenca: ako ima backup, prvi backup odmah (to je i provjera R2 podataka). */
export function backupNakonAktivacije(): void {
  if (m().info().aktivan) void m().sada().catch(() => undefined);
}

export function pokreniRaspored(): void {
  interval ??= setInterval(() => { void m().tick(); }, PROVJERA_MS);
}

export function zaustaviRaspored(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
