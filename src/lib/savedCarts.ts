import type { SqlDb } from './sqldb';
import type { SavedCartItem } from './kosarica';

export interface SavedCartRow {
  id: number;
  naziv: string;
  items: string; // JSON: SavedCartItem[]
  ukupno: number;
  createdAt: string;
}

export function saveCart(db: SqlDb, naziv: string, items: SavedCartItem[], ukupno: number): number {
  const r = db.prepare('INSERT INTO saved_carts (naziv, items, ukupno) VALUES (?, ?, ?)')
    .run(naziv, JSON.stringify(items), ukupno);
  return Number(r.lastInsertRowid);
}

export function listSavedCarts(db: SqlDb): SavedCartRow[] {
  return db.prepare('SELECT * FROM saved_carts ORDER BY id DESC').all() as SavedCartRow[];
}

export function deleteSavedCart(db: SqlDb, id: number): void {
  db.prepare('DELETE FROM saved_carts WHERE id = ?').run(id);
}
