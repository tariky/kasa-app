// bun:sqlite `close()` ne zatvara fajl dok postoji ijedna nefinalizovana izjava
// iz `prepare()` (sqlite3_close_v2) — kasa.db, -wal i -shm ostaju otvoreni. Na
// macOS-u se folder ipak obriše, a na Windowsu rmSync baci EBUSY. BazaTesta
// pamti svoje izjave i finalizuje ih prije zatvaranja.
import { Database, type SQLQueryBindings, type Statement } from 'bun:sqlite';

export class BazaTesta extends Database {
  #izjave = new Set<Statement<any, any>>();

  override prepare<R, P extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: P) {
    const izjava = super.prepare<R, P>(sql, params);
    this.#izjave.add(izjava);
    return izjava;
  }

  override close(throwOnError?: boolean) {
    for (const izjava of this.#izjave) izjava.finalize();
    this.#izjave.clear();
    super.close(throwOnError);
  }
}
