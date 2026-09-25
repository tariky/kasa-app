import type { SqlDb } from './sqldb';

export interface SkicaFaktureRow {
  id: number;
  naziv: string;
  podaci: string; // JSON: stanje dijaloga fakture (FakturaSkica)
  ukupno: number;
  spremljeno: string;
}

/**
 * Nedovršena faktura: sprema se cijelo stanje dijaloga da se nastavi kasnije.
 * Sa id-em postojeće skice je prepisuje; ako je u međuvremenu obrisana, nastaje nova.
 */
export function spremiSkicuFakture(db: SqlDb, id: number | null, naziv: string, podaci: unknown, ukupno: number): number {
  if (podaci == null || typeof podaci !== 'object' || Array.isArray(podaci)) throw new Error('Skica je prazna');
  const json = JSON.stringify(podaci);
  if (id != null) {
    const r = db.prepare("UPDATE faktura_skice SET naziv = ?, podaci = ?, ukupno = ?, spremljeno = datetime('now','localtime') WHERE id = ?")
      .run(naziv, json, ukupno, id);
    if (r.changes > 0) return id;
  }
  const r = db.prepare('INSERT INTO faktura_skice (naziv, podaci, ukupno) VALUES (?, ?, ?)').run(naziv, json, ukupno);
  return Number(r.lastInsertRowid);
}

export function listSkiceFaktura(db: SqlDb): SkicaFaktureRow[] {
  return db.prepare('SELECT * FROM faktura_skice ORDER BY spremljeno DESC, id DESC').all() as SkicaFaktureRow[];
}

export function obrisiSkicuFakture(db: SqlDb, id: number): void {
  db.prepare('DELETE FROM faktura_skice WHERE id = ?').run(id);
}
