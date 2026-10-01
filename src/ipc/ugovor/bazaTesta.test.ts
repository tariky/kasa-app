// Zatvorena BazaTesta ne drži fajlove baze ni uz živu izjavu iz prepare():
// na Windowsu bi brisanje foldera bacilo EBUSY, na macOS-u fajlove vidi lsof.
import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BazaTesta } from './bazaTesta';

function otvoreniFajlovi(folder: string): string[] {
  if (process.platform === 'win32') return [];
  const lsof = Bun.spawnSync(['lsof', '-p', String(process.pid)]);
  return lsof.stdout.toString().split('\n').filter(l => l.includes(folder));
}

test('close finalizuje izjave i pusti kasa.db, -wal i -shm', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'kasa-baza-testa-'));
  const db = new BazaTesta(path.join(folder, 'kasa.db'), { strict: true });
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1)');
  const izjava = db.prepare('SELECT x FROM t');
  expect(izjava.all()).toEqual([{ x: 1 }]);

  db.close();
  expect(otvoreniFajlovi(folder)).toEqual([]);
  rmSync(folder, { recursive: true });
});
