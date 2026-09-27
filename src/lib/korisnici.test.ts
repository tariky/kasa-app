import { test, expect, describe, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import {
  hesirajPin, provjeriPin, jeHesPina, hesirajStarePinove, nadjiPoPinu, pinZauzet, pinKorisnika,
} from './korisnici';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
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

// Seed i migracija PIN-ova (zadani admin, heširanje čistog teksta, Admin/0000 koga je
// vratio stari seed) su u ugovoru oba backenda (ugovor/sesija.ugovor.test.ts); ovdje
// ostaje slučaj koji ugovor nema: drugi admin s već heširanim PIN-om.
describe('seed i migracija', () => {
  const audit = () => (db.prepare('SELECT korisnikId, akcija, detalji FROM audit_log ORDER BY id').all() as any[])
    .map(r => ({ ...r, detalji: JSON.parse(r.detalji) }));

  test('drugi admin s već heširanim PIN-om se računa; heš PIN-a 0000 ne', () => {
    dodaj('Admin', hesirajPin('0000'), 'admin');
    const zadani = dodaj('Admin', '0000', 'admin');
    expect(hesirajStarePinove(db)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 2 });
    expect(audit()).toEqual([]);
    expect(provjeriPin('0000', (db.prepare('SELECT pin FROM users WHERE id = ?').get(zadani) as any).pin)).toBe(true);

    db.prepare('DELETE FROM users').run();
    const vlasnik = dodaj('Vlasnik', hesirajPin('4321'), 'admin');
    const vraceni = dodaj('Admin', '0000', 'admin');
    expect(hesirajStarePinove(db)).toBe(1);
    expect(db.prepare('SELECT id FROM users').all()).toEqual([{ id: vlasnik }]);
    expect(audit()).toEqual([{ korisnikId: null, akcija: 'korisnik:zadaniUklonjen', detalji: { id: vraceni, ime: 'Admin', obrisan: true } }]);
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
