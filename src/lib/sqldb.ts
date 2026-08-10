/**
 * Najmanji zajednički imenilac SQLite API-ja koji koristi poslovna logika.
 * Namjerno ne zavisi od `better-sqlite3` da se ista logika može izvršiti i
 * nad `bun:sqlite` u testovima (native build je vezan za Electron ABI).
 */
export interface SqlStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface SqlDb {
  prepare(sql: string): SqlStatement;
}
