import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from './schema';
import { runMigrations } from './migrations';
import { podesiKonekciju } from './konekcija';

test('aktivna konekcija: WAL, strani ključevi, trusted_schema = OFF — i shema radi uz to', () => {
  const db = new Database(':memory:');
  podesiKonekciju({ pragma: (izraz: string) => db.prepare(`PRAGMA ${izraz}`).all() });
  expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(db.prepare('PRAGMA trusted_schema').get()).toEqual({ trusted_schema: 0 });
  db.exec(schema);
  runMigrations(db as any);
  // DEFAULT (datetime('now','localtime')) iz sheme radi i bez povjerenja u shemu.
  db.exec("INSERT INTO users (ime, pin, uloga) VALUES ('A', 'x', 'admin')");
  expect((db.prepare('SELECT createdAt FROM users').get() as { createdAt: string }).createdAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
  db.close();
});
