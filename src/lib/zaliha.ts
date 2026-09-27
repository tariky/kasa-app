// Knjiga zalihe: stanje artikla = SUM(ulaz) − SUM(izlaz) iz stock_movements.
// Svako kretanje zalihe se upisuje i briše ovdje; Rust: zaliha.rs.
//
// Rust backend (src-tauri/backend/src/zaliha.rs) čita ovaj fajl include_str!-om
// i uzima tekst između backtick navodnika kao STANJE_SQL, pa se taj znak u
// fajlu smije pojaviti samo oko tog SQL-a.
import type { SqlDb } from './sqldb';
import { TOLERANCIJA_ZALIHE } from './tolerancije';

/** Vidi lib/tolerancije.ts. */
export { TOLERANCIJA_ZALIHE };

/**
 * Stanje artikla kao SQL izraz za SELECT (podupit): artikal je u upitu pod
 * aliasom p. Bez kretanja je 0 (INTEGER), inače zbir u REAL-u.
 */
export const STANJE_SQL = `COALESCE((
  SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
  FROM stock_movements sm WHERE sm.productId = p.id
), 0)`;

/** Dokument kretanja: referenceType i referenceId u stock_movements. */
export interface DokumentZalihe {
  vrsta: string;
  id: number;
}

export type SmjerZalihe = 'ulaz' | 'izlaz';

/**
 * Prodaja (račun, prilog) ne razdužuje uslugu — usluga nema zalihu. Tip
 * artikla se čita iz baze u trenutku knjiženja. Ostala kretanja knjiže tačno
 * zadano: storno vraća ono što je račun skinuo (artikal je mogao postati
 * usluga), korekcija i nalog imaju svoju količinu.
 */
const PRODAJA = ['order', 'prilog'];

/**
 * Upiše kretanje za svaku stavku, redom. Datum je datum dokumenta
 * (YYYY-MM-DD HH:MM:SS; izvještaj „Zalihe na dan" ide po njemu), a bez
 * njega lokalno vrijeme sada — kao zadana vrijednost kolone.
 */
export function knjizi(
  db: SqlDb,
  ref: DokumentZalihe,
  smjer: SmjerZalihe,
  stavke: Array<{ productId: number; kolicina: number }>,
  opts: { datum?: string } = {},
): void {
  const upis = db.prepare(
    'INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) ' +
    "VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))"
  );
  const tipArtikla = db.prepare('SELECT tip FROM products WHERE id = ?');
  const prodaja = smjer === 'izlaz' && PRODAJA.includes(ref.vrsta);
  for (const s of stavke) {
    if (prodaja && (tipArtikla.get(s.productId) as { tip: string } | undefined)?.tip === 'usluga') continue;
    upis.run(s.productId, smjer, s.kolicina, ref.vrsta, ref.id, opts.datum ?? null);
  }
}

/** Obriše sva kretanja dokumenta (izmjena ili brisanje primke, priloga, naloga). */
export function ponisti(db: SqlDb, ref: DokumentZalihe): void {
  db.prepare('DELETE FROM stock_movements WHERE referenceType = ? AND referenceId = ?').run(ref.vrsta, ref.id);
}

/** Trenutno stanje artikla (isti STANJE_SQL; artikal koji ne postoji ima 0). */
export function stanje(db: SqlDb, productId: number): number {
  const red = db.prepare('SELECT ' + STANJE_SQL + ' AS stanje FROM (SELECT ? AS id) p').get(productId) as { stanje: number };
  return red.stanje;
}
