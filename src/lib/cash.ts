import type { TringResponse } from '@/services/tring';
import type { SqlDb } from './sqldb';
import { ocekivanoStanje, type DrawerState } from './drawer';
import { round2 } from './novac';

export type CashTip = 'polog' | 'povrat';
export type TringStatus = 'ok' | 'error' | 'skipped';

export interface CashDeps {
  db: SqlDb;
  /** Pošalje UnosNovca/PovratNovca; `null` znači da fiskalna integracija nije uključena. */
  send: (tip: CashTip, iznos: number) => Promise<TringResponse | null>;
}

export interface CashMovementRow {
  id: number;
  tip: CashTip;
  iznos: number;
  korisnikId: number;
  korisnikIme: string;
  tringStatus: TringStatus;
  napomena: string | null;
  createdAt: string;
}

export interface AddCashResult {
  id: number;
  tringStatus: TringStatus;
  error?: string;
}

/**
 * Evidencija se upisuje i kad printer ne odgovori (tringStatus='error') —
 * fizički novac je već u ladici, pa zapis ne smije ovisiti o štampi.
 * Neuspjelo slanje se ponavlja kroz retryCashMovement.
 */
export async function addCashMovement(
  deps: CashDeps,
  data: { tip: CashTip; iznos: number; korisnikId: number; napomena?: string }
): Promise<AddCashResult> {
  const iznos = round2(data.iznos);
  if (!Number.isFinite(iznos) || iznos <= 0) throw new Error('Iznos mora biti veći od nule');

  const result = await deps.send(data.tip, iznos);
  const tringStatus: TringStatus = result === null ? 'skipped' : result.success ? 'ok' : 'error';

  const r = deps.db.prepare(
    'INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena) VALUES (?, ?, ?, ?, ?)'
  ).run(data.tip, iznos, data.korisnikId, tringStatus, data.napomena ?? null);

  return {
    id: Number(r.lastInsertRowid),
    tringStatus,
    error: result && !result.success ? (result.error || result.vrstaOdgovora) : undefined,
  };
}

export async function retryCashMovement(deps: CashDeps, id: number): Promise<AddCashResult> {
  const row = deps.db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(id) as CashMovementRow | undefined;
  if (!row) throw new Error('Zapis ne postoji');
  if (row.tringStatus !== 'error') throw new Error('Samo neuspjela slanja se mogu ponoviti');

  const result = await deps.send(row.tip, row.iznos);
  const tringStatus: TringStatus = result === null ? 'skipped' : result.success ? 'ok' : 'error';
  deps.db.prepare('UPDATE cash_movements SET tringStatus = ? WHERE id = ?').run(tringStatus, id);

  return {
    id,
    tringStatus,
    error: result && !result.success ? (result.error || result.vrstaOdgovora) : undefined,
  };
}

export function getTodayMovements(db: SqlDb): CashMovementRow[] {
  return db.prepare(`
    SELECT cm.*, u.ime AS korisnikIme
    FROM cash_movements cm
    LEFT JOIN users u ON u.id = cm.korisnikId
    WHERE date(cm.createdAt) = date('now', 'localtime')
    ORDER BY cm.id
  `).all() as CashMovementRow[];
}

/** Iznos zadnjeg unesenog pologa (bilo koji dan) — prijedlog za jutarnji prompt. */
export function getLastPologIznos(db: SqlDb): number | null {
  const row = db.prepare(
    "SELECT iznos FROM cash_movements WHERE tip = 'polog' ORDER BY id DESC LIMIT 1"
  ).get() as { iznos: number } | undefined;
  return row?.iznos ?? null;
}

export function getDrawerState(db: SqlDb): DrawerState {
  const movements = db.prepare(`
    SELECT tip, iznos FROM cash_movements
    WHERE date(createdAt) = date('now', 'localtime')
  `).all() as Array<{ tip: CashTip; iznos: number }>;

  const prodaje = db.prepare(`
    SELECT nacinPlacanja, ukupno FROM orders
    WHERE date(createdAt) = date('now', 'localtime')
  `).all() as Array<{ nacinPlacanja: string; ukupno: number }>;

  const reklamirani = db.prepare(`
    SELECT nacinPlacanja, ukupno FROM orders
    WHERE refundedAt IS NOT NULL AND date(refundedAt) = date('now', 'localtime')
  `).all() as Array<{ nacinPlacanja: string; ukupno: number }>;

  return ocekivanoStanje(movements, prodaje, reklamirani);
}
