import type { SqlDb } from './sqldb';

/**
 * Datum valute (rok plaćanja) na izdatom računu. Nije dio fiskalnog zapisa —
 * upisuje se naknadno, po dogovoru s kupcem, i prikazuje se samo na A4 kopiji
 * računa. Zato se smije mijenjati i brisati bez ograničenja, i na stornu.
 */

/** ISO datum bez vremena, onako kako ga vraća `DatePicker`. */
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** Prihvata samo `YYYY-MM-DD` koji zaista postoji u kalendaru (ne 2026-02-30). */
export function validanDatumValute(datum: string): boolean {
  if (!ISO_DATUM.test(datum)) return false;
  const d = new Date(`${datum}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === datum;
}

/** Postavlja ili (uz `null`) uklanja datum valute. Vraća upisanu vrijednost. */
export function postaviDatumValute(db: SqlDb, orderId: number, datum: string | null): string | null {
  const postoji = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!postoji) throw new Error('Račun ne postoji');

  if (datum !== null && !validanDatumValute(datum)) {
    throw new Error(`Neispravan datum valute: ${datum}`);
  }

  db.prepare('UPDATE orders SET datumValute = ? WHERE id = ?').run(datum, orderId);
  return datum;
}

/**
 * Prikaz datuma valute na A4 računu. Formatira se iz dijelova stringa, jer bi
 * ga `new Date('2026-09-10')` pročitao kao UTC ponoć i u minus zonama pomjerio
 * dan unazad. Vraća `null` kad datum nije postavljen ili nije ispravan.
 */
export function formatDatumValute(datum: string | null | undefined): string | null {
  if (!datum || !validanDatumValute(datum)) return null;
  const [y, m, d] = datum.split('-');
  return `${d}.${m}.${y}.`;
}
