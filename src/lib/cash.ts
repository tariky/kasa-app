import type { SqlDb } from './sqldb';
import type { FiskalniUredjaj, IshodUredjaja } from './fiskalniUredjaj';
import { ocekivanoStanje, type DrawerState } from './drawer';
import { round2 } from './novac';

export type CashTip = 'polog' | 'povrat';
export type TringStatus = 'ok' | 'error' | 'skipped';

export interface CashDeps {
  db: SqlDb;
  /** Šalje UnosNovca/PovratNovca; `null` znači da fiskalna integracija nije uključena. */
  uredjaj: Pick<FiskalniUredjaj, 'unosNovca' | 'povratNovca'> | null;
}

/** Polog → UnosNovca, povrat → PovratNovca; bez uređaja ništa se ne šalje. */
function posalji(deps: CashDeps, tip: CashTip, iznos: number): Promise<IshodUredjaja | null> {
  if (!deps.uredjaj) return Promise.resolve(null);
  return tip === 'polog' ? deps.uredjaj.unosNovca(iznos) : deps.uredjaj.povratNovca(iznos);
}

function statusSlanja(ishod: IshodUredjaja | null): { tringStatus: TringStatus; error?: string } {
  if (ishod === null) return { tringStatus: 'skipped' };
  return ishod.ok ? { tringStatus: 'ok' } : { tringStatus: 'error', error: ishod.greska };
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
  // Sve provjere prije slanja: uređaj je fizički primio/izdao novac čim
  // odgovori, pa upis nakon toga ne smije pasti na CHECK ili FOREIGN KEY.
  if (data.tip !== 'polog' && data.tip !== 'povrat') {
    throw new Error(`Nepoznata vrsta unosa gotovine: ${data.tip}`);
  }
  const iznos = round2(data.iznos);
  if (!Number.isFinite(iznos) || iznos <= 0) throw new Error('Iznos mora biti veći od nule');
  if (!deps.db.prepare('SELECT 1 FROM users WHERE id = ?').get(data.korisnikId ?? null)) {
    throw new Error('Korisnik ne postoji');
  }

  const { tringStatus, error } = statusSlanja(await posalji(deps, data.tip, iznos));

  const r = deps.db.prepare(
    'INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena) VALUES (?, ?, ?, ?, ?)'
  ).run(data.tip, iznos, data.korisnikId, tringStatus, data.napomena ?? null);

  return { id: Number(r.lastInsertRowid), tringStatus, error };
}

export async function retryCashMovement(deps: CashDeps, id: number): Promise<AddCashResult> {
  const row = deps.db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(id) as CashMovementRow | undefined;
  if (!row) throw new Error('Zapis ne postoji');
  if (row.tringStatus !== 'error') throw new Error('Samo neuspjela slanja se mogu ponoviti');

  const { tringStatus, error } = statusSlanja(await posalji(deps, row.tip, row.iznos));
  deps.db.prepare('UPDATE cash_movements SET tringStatus = ? WHERE id = ?').run(tringStatus, id);

  return { id, tringStatus, error };
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
