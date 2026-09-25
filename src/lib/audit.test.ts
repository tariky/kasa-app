import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '../database/schema';
import { hesirajPin } from './korisnici';
import { zapisiAudit } from './audit';

test('zapis: korisnik, akcija i detalji kao JSON; PIN, lozinke i heševi se izbacuju (zaštitna mreža)', () => {
  const db = new Database(':memory:');
  db.exec(schema);
  zapisiAudit(db as any, 7, 'test', {
    pin: '1234', adminPin: '1111', operatorPassword: 'x', lozinka: 'y', password: 'z',
    ugnijezdeno: { novi: '5', lista: [{ pin: '9' }, 2] }, h: hesirajPin('2222'), ok: 'da',
  });
  zapisiAudit(db as any, null, 'bez-korisnika', {});
  const redovi = db.prepare('SELECT korisnikId, akcija, detalji FROM audit_log ORDER BY id').all() as any[];
  expect(redovi.map(r => ({ ...r, detalji: JSON.parse(r.detalji) }))).toEqual([
    { korisnikId: 7, akcija: 'test', detalji: { ugnijezdeno: { novi: '5', lista: [{}, 2] }, h: '[skriveno]', ok: 'da' } },
    { korisnikId: null, akcija: 'bez-korisnika', detalji: {} },
  ]);
  db.close();
});
