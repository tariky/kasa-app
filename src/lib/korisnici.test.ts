import { test, expect, describe, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import {
  hesirajPin, provjeriPin, jeHesPina, hesirajStarePinove, osigurajZadanogAdmina, nadjiPoPinu, pinZauzet, pinKorisnika,
} from './korisnici';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
});

function dodaj(ime: string, pin: string, uloga = 'kasir'): number {
  return Number(db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, pin, uloga).lastInsertRowid);
}

describe('heš PIN-a', () => {
  test('format pbkdf2$100000$<16 B so>$<32 B heš>, nova so svaki put', () => {
    const a = hesirajPin('1234');
    const b = hesirajPin('1234');
    expect(a).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(jeHesPina(a)).toBe(true);
    expect(jeHesPina('1234')).toBe(false);
  });

  test('ista so daje isti heš', () => {
    const so = Buffer.alloc(16, 1);
    expect(hesirajPin('1234', so)).toBe(hesirajPin('1234', so));
  });

  test('provjera: tačan PIN, pogrešan PIN, čist tekst, neispravan zapis, ne-string', () => {
    const h = hesirajPin('1234');
    expect(provjeriPin('1234', h)).toBe(true);
    expect(provjeriPin('1235', h)).toBe(false);
    expect(provjeriPin('1234', '1234')).toBe(false);
    expect(provjeriPin('1234', 'pbkdf2$100000$abc$def')).toBe(false);
    expect(provjeriPin('1234', h.replace('$100000$', '$99999$'))).toBe(false);
    expect(provjeriPin(1234, h)).toBe(false);
    expect(provjeriPin(null, h)).toBe(false);
  });
});

describe('seed i migracija', () => {
  test('zadani admin samo u praznoj tabeli', () => {
    osigurajZadanogAdmina(db);
    osigurajZadanogAdmina(db);
    const svi = db.prepare('SELECT ime, uloga, pin FROM users').all() as any[];
    expect(svi).toHaveLength(1);
    expect(svi[0]).toMatchObject({ ime: 'Admin', uloga: 'admin' });
    expect(provjeriPin('0000', svi[0].pin)).toBe(true);

    db.prepare('DELETE FROM users').run();
    dodaj('Berina', hesirajPin('1111'), 'admin');
    osigurajZadanogAdmina(db);
    expect(db.prepare('SELECT ime FROM users').all()).toEqual([{ ime: 'Berina' }]);
  });

  test('hešira samo PIN-ove u čistom tekstu, idempotentno', () => {
    const h = hesirajPin('1111');
    const a = dodaj('A', h);
    const b = dodaj('B', '2222');
    expect(hesirajStarePinove(db)).toBe(1);
    expect(hesirajStarePinove(db)).toBe(0);
    expect((db.prepare('SELECT pin FROM users WHERE id = ?').get(a) as any).pin).toBe(h);
    expect(provjeriPin('2222', (db.prepare('SELECT pin FROM users WHERE id = ?').get(b) as any).pin)).toBe(true);
  });
});

describe('pretraga po PIN-u', () => {
  test('nadjiPoPinu, samo admin, osim id-a; pinZauzet i pinKorisnika', () => {
    const admin = dodaj('Admin', hesirajPin('0000'), 'admin');
    const kasir = dodaj('Kasir', hesirajPin('1234'));
    expect(nadjiPoPinu(db, '1234')).toEqual({ id: kasir, ime: 'Kasir', uloga: 'kasir' });
    expect(nadjiPoPinu(db, '1234', { samoAdmin: true })).toBeNull();
    expect(nadjiPoPinu(db, '0000', { samoAdmin: true })).toEqual({ id: admin, ime: 'Admin', uloga: 'admin' });
    expect(nadjiPoPinu(db, '9999')).toBeNull();
    expect(pinZauzet(db, '1234')).toBe(true);
    expect(pinZauzet(db, '1234', kasir)).toBe(false);
    expect(pinKorisnika(db, kasir, '1234')).toBe(true);
    expect(pinKorisnika(db, admin, '1234')).toBe(false);
    expect(pinKorisnika(db, 999, '1234')).toBe(false);
  });
});
