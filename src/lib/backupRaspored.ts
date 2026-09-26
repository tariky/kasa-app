// Automatski backup: stanje, raspored i napredak. Čist modul bez Node-a —
// koriste ga main proces (src/lib/backupTok.ts) i renderer (traka, Postavke).
// Rust backend (faza 4) mora dati iste odgovore. Spec:
// docs/superpowers/specs/2026-09-25-r2-backup-design.md

export const INTERVAL_MS = 3 * 60 * 60 * 1000;
export const PONOVO_NAKON_GRESKE_MS = 15 * 60 * 1000;
export const ODGODA_STARTA_MS = 60 * 1000;
export const TRAJNA_GRESKA_MS = 24 * 60 * 60 * 1000;

/** `userData/backup-stanje.json` — van baze, jer se baza backup-uje i vraća. */
export interface BackupStanje {
  zadnjiUspjeh?: string;
  zadnjiPokusaj?: string;
  greska?: string;
  /** Prvi pad u nizu; briše se uspjehom. */
  greskaOd?: string;
}

/** Odgovor kanala `backup:info`. */
export interface BackupInfo {
  /** Licenca važi i ima backup. */
  aktivan: boolean;
  bucket?: string;
  zadnjiUspjeh?: string;
  greska?: string;
  greskaOd?: string;
  sljedeci?: string;
  uToku: boolean;
}

export type BackupFaza = 'kopija' | 'sifrovanje' | 'slanje';

/** Događaj `backup:stanje`. `procenat` je unutar faze (0–100). */
export type BackupDogadjaj =
  | { faza: BackupFaza; procenat: number }
  | { gotovo: string }
  | { greska: string; trajnaGreska: boolean };

const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/**
 * Kada je sljedeći backup. Pao pokušaj → pokušaj + 15 min; inače uspjeh + 3 h
 * (nikad uspjeha ili uspjeh "u budućnosti" zbog vraćenog sata → odmah). Nikad
 * prije `start + 1 min` (aplikacija se prvo pokrene) ni prije `sada`.
 */
export function sljedeciBackup(s: BackupStanje, sada: Date, start: Date): Date {
  const t = sada.getTime();
  const pokusaj = ms(s.zadnjiPokusaj);
  const uspjeh = ms(s.zadnjiUspjeh);
  let kandidat: number;
  if (s.greska && pokusaj <= t) kandidat = pokusaj + PONOVO_NAKON_GRESKE_MS;
  else kandidat = Number.isNaN(uspjeh) || uspjeh > t ? -Infinity : uspjeh + INTERVAL_MS;
  return new Date(Math.max(kandidat, start.getTime() + ODGODA_STARTA_MS, t));
}

/**
 * Backup pada i uspjeha nema duže od 24 h. Uspjeh kojeg nema, koji se ne da
 * pročitati ili je "u budućnosti" (vraćen sat) ne važi — računa se od `greskaOd`.
 */
export function trajnaGreska(s: BackupStanje, sada: Date): boolean {
  if (!s.greska) return false;
  const uspjeh = ms(s.zadnjiUspjeh);
  const od = Number.isNaN(uspjeh) || uspjeh > sada.getTime() ? ms(s.greskaOd) : uspjeh;
  return !Number.isNaN(od) && sada.getTime() - od > TRAJNA_GRESKA_MS;
}

const OPSEG: Record<BackupFaza, [number, number]> = { kopija: [0, 10], sifrovanje: [10, 20], slanje: [20, 100] };

/** Procenat cijelog backup-a iz faze i procenta unutar nje. */
export function ukupniProcenat(faza: BackupFaza, procenat: number): number {
  const [od, doP] = OPSEG[faza];
  return Math.round(od + ((doP - od) * Math.min(100, Math.max(0, procenat))) / 100);
}
