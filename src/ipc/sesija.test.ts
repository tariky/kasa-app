import { test, expect, describe, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from '../lib/testnaBaza';
import { hesirajPin, provjeriPin } from '../lib/korisnici';
import {
  OgranicenjePokusaja, OgranicenjePromjenaPina, provjeriPristup, porukaBlokade, napraviSesiju, KLJUC_BLOKADE,
  PORUKA_NISTE_PRIJAVLJENI, PORUKA_SAMO_ADMIN, PORUKA_ZADANI_PIN,
} from './sesija';

const ADMIN = { id: 1, ime: 'Admin', uloga: 'admin' as const };
const KASIR = { id: 2, ime: 'Kasir', uloga: 'kasir' as const };

describe('provjeriPristup', () => {
  test('bez prijave: samo prijava, odjava, licenca, firma i dozvoljene postavke', () => {
    for (const k of ['user:login', 'user:logout', 'licenca:stanje', 'licenca:aktiviraj', 'settings:getFirma']) {
      expect(() => provjeriPristup(k, [], null)).not.toThrow();
    }
    expect(() => provjeriPristup('settings:get', ['ui.skala'], null)).not.toThrow();
    expect(() => provjeriPristup('settings:get', ['tring.host'], null)).toThrow('Niste prijavljeni');
    expect(() => provjeriPristup('product:getAll', [], null)).toThrow('Niste prijavljeni');
  });

  test('admin kanali i postavke po ulozi', () => {
    expect(() => provjeriPristup('db:restore', [], KASIR)).toThrow('Ovu radnju može izvršiti samo administrator');
    expect(() => provjeriPristup('db:restore', [], ADMIN)).not.toThrow();
    expect(() => provjeriPristup('settings:set', ['kasa.scanMode'], KASIR)).not.toThrow();
    expect(() => provjeriPristup('settings:set', ['racun.napomena'], KASIR)).toThrow('samo administrator');
    expect(() => provjeriPristup('settings:set', ['racun.napomena'], ADMIN)).not.toThrow();
    expect(() => provjeriPristup('settings:set', ['tring.operatorPassword'], ADMIN)).toThrow('se ne može mijenjati');
    expect(() => provjeriPristup('settings:set', [42], ADMIN)).toThrow('Postavka "" se ne može mijenjati');
  });
});

describe('provjeriPristup — vraćanje naloga u izradu', () => {
  test('nalog:setStatus "vrati" smije samo admin; ostale statuse svako', () => {
    const vrati = [{ id: 1, status: 'vrati' }];
    expect(() => provjeriPristup('nalog:setStatus', vrati, KASIR)).toThrow('Vraćanje naloga u izradu može samo administrator');
    expect(() => provjeriPristup('nalog:setStatus', vrati, ADMIN)).not.toThrow();
    expect(() => provjeriPristup('nalog:setStatus', [{ id: 1, status: 'zavrsen' }], KASIR)).not.toThrow();
    expect(() => provjeriPristup('nalog:setStatus', [{ id: 1, status: 'u_izradi' }], KASIR)).not.toThrow();
    // Neispravan payload ostaje handleru (njegova poruka), kao i dosad.
    for (const args of [[], [null], [5], [{ id: 1 }]]) {
      expect(() => provjeriPristup('nalog:setStatus', args, KASIR)).not.toThrow();
    }
    // Bez prijave i sa zadanim PIN-om važe opšte poruke.
    expect(() => provjeriPristup('nalog:setStatus', vrati, null)).toThrow('Niste prijavljeni');
    expect(() => provjeriPristup('nalog:setStatus', vrati, KASIR, true)).toThrow('Prije rada promijenite zadani PIN 0000');
  });
});

describe('zadani PIN', () => {
  test('sesija sa zadanim PIN-om smije samo promjenu PIN-a, odjavu i pred-prijavne kanale', () => {
    expect(() => provjeriPristup('user:promijeniSvojPin', [], ADMIN, true)).not.toThrow();
    expect(() => provjeriPristup('user:logout', [], ADMIN, true)).not.toThrow();
    expect(() => provjeriPristup('settings:getFirma', [], ADMIN, true)).not.toThrow();
    expect(() => provjeriPristup('settings:get', ['ui.skala'], ADMIN, true)).not.toThrow();
    expect(() => provjeriPristup('settings:get', ['tring.host'], ADMIN, true)).toThrow('Prije rada promijenite zadani PIN 0000');
    expect(() => provjeriPristup('product:getAll', [], KASIR, true)).toThrow('Prije rada promijenite zadani PIN 0000');
    expect(() => provjeriPristup('user:promijeniSvojPin', [], null)).toThrow('Niste prijavljeni');
  });
});

describe('OgranicenjePokusaja', () => {
  /** Poruka blokade ili '' kad nema blokade. */
  const stanje = (o: OgranicenjePokusaja) => { try { o.provjeri(); return ''; } catch (e: any) { return e.message; } };
  const sekundi = (o: OgranicenjePokusaja) => Number(/za (\d+) s/.exec(stanje(o))?.[1] ?? 0);

  test('5 neuspjeha u 15 min → 30 s, zatim duplo do 15 min; uspjeh ne postoji kao reset', () => {
    let sada = 1_000_000;
    const o = new OgranicenjePokusaja(() => sada);
    for (let i = 0; i < 4; i++) o.neuspjeh();
    expect(() => o.provjeri()).not.toThrow();
    o.neuspjeh();
    expect(() => o.provjeri()).toThrow(porukaBlokade(30_000));
    sada += 29_001;
    expect(() => o.provjeri()).toThrow('za 1 s.');
    sada += 999;
    expect(() => o.provjeri()).not.toThrow();
    // Neuspjesi jedan za drugim (bez čekanja) — samo da se vidi gornja granica.
    const trajanja: number[] = [];
    for (let i = 0; i < 7; i++) {
      o.neuspjeh();
      trajanja.push(sekundi(o));
    }
    expect(trajanja).toEqual([60, 120, 240, 480, 900, 900, 900]);
  });

  test('eskalacija ostaje i kad stari neuspjesi isteknu iz prozora — svaki novi neuspjeh blokira duplo', () => {
    let sada = 0;
    const o = new OgranicenjePokusaja(() => sada);
    for (let i = 0; i < 5; i++) o.neuspjeh();
    expect(sekundi(o)).toBe(30);
    sada += 15 * 60_000;
    expect(stanje(o)).toBe('');
    o.neuspjeh();
    expect(sekundi(o)).toBe(60);
  });

  test('eskalacija se poništi tek nakon 60 min bez ijednog neuspjeha', () => {
    let sada = 0;
    const o = new OgranicenjePokusaja(() => sada);
    for (let i = 0; i < 5; i++) o.neuspjeh();
    sada += 60 * 60_000 - 1;
    o.neuspjeh();
    expect(sekundi(o)).toBe(60);
    sada += 60 * 60_000;
    for (let i = 0; i < 4; i++) o.neuspjeh();
    expect(stanje(o)).toBe('');
    o.neuspjeh();
    expect(sekundi(o)).toBe(30);
  });

  test('uporan napad: najviše jedan pokušaj u 15 min (≈ 100 na dan, ne 900)', () => {
    let sada = 0;
    const o = new OgranicenjePokusaja(() => sada);
    const pokusaji: number[] = [];
    // Napadač pokušava čim blokada istekne, 24 h.
    while (sada < 24 * 3600_000) {
      const preostalo = sekundi(o) * 1000;
      if (preostalo > 0) { sada += preostalo; continue; }
      pokusaji.push(sada);
      o.neuspjeh();
    }
    expect(pokusaji.length).toBeLessThanOrEqual(110);
    // Nakon početnih 5 + eskalacije do 15 min, razmak je uvijek pun prozor.
    const razmaci = pokusaji.slice(11).map((t, i) => t - pokusaji[10 + i]);
    expect(new Set(razmaci)).toEqual(new Set([15 * 60_000]));
  });

  test('stanje živi u skladištu: nova instanca (restart) nastavlja blokadu i eskalaciju', () => {
    let sada = 0;
    let zapis: string | null = null;
    const skladiste = { ucitaj: () => zapis, spremi: (s: string) => { zapis = s; } };
    const prva = new OgranicenjePokusaja(() => sada, skladiste);
    for (let i = 0; i < 5; i++) prva.neuspjeh();
    const druga = new OgranicenjePokusaja(() => sada, skladiste);
    expect(sekundi(druga)).toBe(30);
    sada += 30_000;
    expect(stanje(druga)).toBe('');
    druga.neuspjeh();
    expect(sekundi(new OgranicenjePokusaja(() => sada, skladiste))).toBe(60);
    expect(JSON.parse(zapis!)).toEqual({ neuspjesi: [0, 0, 0, 0, 0, 30_000], trajanje: 60_000, blokiranDo: 90_000 });
  });

  test('neispravan zapis u skladištu = bez blokade; blokada duža od 15 min (sat vraćen unazad) se skrati', () => {
    let zapis: string | null = 'nije json';
    const skladiste = { ucitaj: () => zapis, spremi: (s: string) => { zapis = s; } };
    expect(stanje(new OgranicenjePokusaja(() => 0, skladiste))).toBe('');
    zapis = JSON.stringify({ neuspjesi: [1e12], trajanje: 900_000, blokiranDo: 1e12 + 900_000 });
    const o = new OgranicenjePokusaja(() => 1e12 - 86_400_000, skladiste);
    expect(sekundi(o)).toBe(900);
  });
});

describe('OgranicenjePokusaja — sat vraćen unazad', () => {
  const stanje = (o: OgranicenjePokusaja) => { try { o.provjeri(); return ''; } catch (e: any) { return e.message; } };

  test('neuspjesi "iz budućnosti" se svedu na sada: ne produžuju ni prozor ni eskalaciju', () => {
    const DAN = 86_400_000;
    let sada = 10 * DAN;
    let zapis: string | null = JSON.stringify({
      neuspjesi: [sada + DAN, sada + DAN, sada + DAN, sada + DAN, sada + DAN], trajanje: 900_000, blokiranDo: sada + DAN + 900_000,
    });
    const skladiste = { ucitaj: () => zapis, spremi: (s: string) => { zapis = s; } };
    const o = new OgranicenjePokusaja(() => sada, skladiste);
    expect(stanje(o)).toBe(porukaBlokade(900_000));
    // Upisano stanje više nema ništa poslije "sada".
    const s = JSON.parse(zapis!);
    expect(s.neuspjesi).toEqual([sada, sada, sada, sada, sada]);
    expect(s.blokiranDo).toBe(sada + 900_000);
    // Blokada ističe za 15 min, eskalacija 60 min nakon "sada" — ne tek za dan.
    sada += 900_000;
    expect(stanje(o)).toBe('');
    sada += 60 * 60_000 - 900_000;
    o.neuspjeh();
    expect(stanje(o)).toBe('');
    expect(JSON.parse(zapis!)).toEqual({ neuspjesi: [sada], trajanje: 0, blokiranDo: 0 });
  });

  test('i neuspjeh() odmah svodi buduće zapise', () => {
    let zapis: string | null = JSON.stringify({ neuspjesi: [5e12], trajanje: 60_000, blokiranDo: 5e12 });
    const skladiste = { ucitaj: () => zapis, spremi: (s: string) => { zapis = s; } };
    const o = new OgranicenjePokusaja(() => 1e12, skladiste);
    o.neuspjeh();
    expect(JSON.parse(zapis!)).toEqual({ neuspjesi: [1e12, 1e12], trajanje: 120_000, blokiranDo: 1e12 + 120_000 });
  });
});

describe('OgranicenjePromjenaPina', () => {
  test('3 promjene po korisniku u 10 min', () => {
    let sada = 0;
    const o = new OgranicenjePromjenaPina(() => sada);
    for (let i = 0; i < 3; i++) { o.provjeri(1); o.zabiljezi(1); sada += 1000; }
    expect(() => o.provjeri(1)).toThrow('Previše promjena PIN-a. Pokušajte ponovo za 597 s.');
    expect(() => o.provjeri(2)).not.toThrow();
    sada = 10 * 60_000;
    expect(() => o.provjeri(1)).not.toThrow();
  });
});

// ─── Sesija (napraviSesiju) nad pravom bazom ────────────────
// Mašina stanja prijave; kanali su u ugovoru oba backenda (ugovor/sesija.ugovor.test.ts).

describe('napraviSesiju', () => {
  // PBKDF2 je namjerno spor — heševi se računaju jednom.
  const HES: Record<string, string> = Object.fromEntries(['0000', '1111', '1234', '2222'].map(p => [p, hesirajPin(p)]));
  const BLOKADA_30 = porukaBlokade(30_000);
  let db: TestnaBaza;
  let sada: number;
  let admin: number;
  let kasir: number;

  function dodaj(ime: string, pin: string, uloga: 'admin' | 'kasir'): number {
    return Number(db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, HES[pin], uloga).lastInsertRowid);
  }
  const postavi = (k: string, v: string) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, v);
  const pinKorisnika = (id: number) => (db.prepare('SELECT pin FROM users WHERE id = ?').get(id) as { pin: string }).pin;
  const greska = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
  const nova = () => napraviSesiju(db, () => sada);

  beforeEach(() => {
    db = testnaBaza();
    sada = 1_000_000_000;
    admin = dodaj('Admin', '1111', 'admin');
    kasir = dodaj('Kasir', '1234', 'kasir');
  });

  test('prijava otvara sesiju, odjava je zatvara', () => {
    const s = nova();
    expect(s.trenutni()).toBeNull();
    expect(s.prijavi('1234')).toEqual({ id: kasir, ime: 'Kasir', uloga: 'kasir', zadaniPin: false });
    expect(s.trenutni()).toEqual({ id: kasir, ime: 'Kasir', uloga: 'kasir' });
    expect(s.korisnik().id).toBe(kasir);
    expect(s.prijavljeniId()).toBe(kasir);
    expect(() => s.provjeriPristup('product:getAll', [])).not.toThrow();
    s.odjavi();
    expect(s.trenutni()).toBeNull();
    expect(s.prijavljeniId()).toBeNull();
    expect(() => s.korisnik()).toThrow(PORUKA_NISTE_PRIJAVLJENI);
    expect(() => s.provjeriPristup('product:getAll', [])).toThrow(PORUKA_NISTE_PRIJAVLJENI);
  });

  test('neuspjela prijava briše i dotadašnju sesiju — i kad je odbije blokada', () => {
    const s = nova();
    s.prijavi('1111');
    expect(s.prijavi('9999')).toBeNull();
    expect(s.trenutni()).toBeNull();
    expect(() => s.provjeriPristup('product:getAll', [])).toThrow(PORUKA_NISTE_PRIJAVLJENI);

    // Pogrešan admin PIN (storno) ne dira sesiju, ali puni zajednički brojač.
    s.prijavi('1111');
    for (let i = 0; i < 4; i++) expect(greska(() => s.provjeriAdminPin('9999'))).toBe('Neispravan admin PIN');
    expect(s.trenutni()).toMatchObject({ id: admin });
    // Prijava koju odbije blokada (i za tačan PIN) takođe zatvara sesiju.
    expect(greska(() => s.prijavi('1111'))).toBe(BLOKADA_30);
    expect(s.trenutni()).toBeNull();
  });

  test('uloga i postojanje korisnika se čitaju iz baze pri svakoj provjeri', () => {
    const s = nova();
    s.prijavi('1234');
    expect(greska(() => s.provjeriPristup('db:restore', []))).toBe(PORUKA_SAMO_ADMIN);
    db.prepare("UPDATE users SET uloga = 'admin' WHERE id = ?").run(kasir);
    expect(() => s.provjeriPristup('db:restore', [])).not.toThrow();
    db.prepare('DELETE FROM users WHERE id = ?').run(kasir);
    expect(s.trenutni()).toBeNull();
    expect(greska(() => s.provjeriPristup('product:getAll', []))).toBe(PORUKA_NISTE_PRIJAVLJENI);
    expect(greska(() => s.korisnik())).toBe(PORUKA_NISTE_PRIJAVLJENI);
  });

  test('zadani PIN: dok ga ne promijeni, sesija smije samo promjenu PIN-a i odjavu', () => {
    db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(HES['0000'], admin);
    const s = nova();
    expect(s.prijavi('0000')).toEqual({ id: admin, ime: 'Admin', uloga: 'admin', zadaniPin: true });
    expect(greska(() => s.provjeriPristup('product:getAll', []))).toBe(PORUKA_ZADANI_PIN);
    expect(() => s.provjeriPristup('user:promijeniSvojPin', [])).not.toThrow();
    expect(greska(() => s.promijeniSvojPin('0000', '0000'))).toBe('Novi PIN ne smije biti 0000');
    s.promijeniSvojPin('0000', '2468');
    expect(provjeriPin('2468', pinKorisnika(admin))).toBe(true);
    expect(() => s.provjeriPristup('product:getAll', [])).not.toThrow();
    expect(db.prepare('SELECT korisnikId, akcija, detalji FROM audit_log').all()).toEqual([
      { korisnikId: admin, akcija: 'korisnik:promjenaPina', detalji: JSON.stringify({ id: admin }) },
    ]);
  });

  test('zauzet PIN se broji kao neuspjeh: promjena svog PIN-a nije proročište za tuđe PIN-ove', () => {
    const s = nova();
    s.prijavi('1234');
    for (let i = 0; i < 5; i++) {
      expect(greska(() => s.promijeniSvojPin('1234', '1111'))).toBe('Taj PIN je zauzet, odaberite drugi');
    }
    // Sljedeći pokušaj, i sa slobodnim PIN-om, ne otkriva ništa.
    expect(greska(() => s.promijeniSvojPin('1234', '7777'))).toBe(BLOKADA_30);
    expect(provjeriPin('1234', pinKorisnika(kasir))).toBe(true);
    // Brojač je zajednički: blokada važi i za prijavu.
    expect(greska(() => s.prijavi('1111'))).toBe(BLOKADA_30);
  });

  test('pogrešan trenutni PIN je neuspjeh; neispravan novi PIN ne troši pokušaje', () => {
    const s = nova();
    s.prijavi('1234');
    for (let i = 0; i < 10; i++) {
      expect(greska(() => s.promijeniSvojPin('1234', '12'))).toBe('PIN mora imati najmanje 4 cifre');
    }
    for (let i = 0; i < 4; i++) {
      expect(greska(() => s.promijeniSvojPin('9999', '2468'))).toBe('Trenutni PIN nije tačan');
    }
    // Uspjeh ne briše neuspjehe: još jedan neuspjeh (peti) blokira.
    expect(s.prijavi('1234')).toMatchObject({ id: kasir });
    expect(s.prijavi('9999')).toBeNull();
    expect(greska(() => s.prijavi('1234'))).toBe(BLOKADA_30);
  });

  test('najviše 3 promjene svog PIN-a u 10 min', () => {
    const s = nova();
    s.prijavi('1234');
    s.promijeniSvojPin('1234', '1235');
    s.promijeniSvojPin('1235', '1236');
    s.promijeniSvojPin('1236', '1237');
    expect(greska(() => s.promijeniSvojPin('1237', '1238'))).toBe('Previše promjena PIN-a. Pokušajte ponovo za 600 s.');
    sada += 10 * 60_000;
    s.promijeniSvojPin('1237', '1238');
    expect(provjeriPin('1238', pinKorisnika(kasir))).toBe(true);
  });

  test('blokada je u bazi: nova sesija (restart programa) je nastavlja; ističe po satu sesije', () => {
    const s = nova();
    for (let i = 0; i < 5; i++) expect(s.prijavi('9999')).toBeNull();
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(KLJUC_BLOKADE)).toBeTruthy();
    const poRestartu = nova();
    expect(greska(() => poRestartu.prijavi('1111'))).toBe(BLOKADA_30);
    sada += 30_000;
    expect(poRestartu.prijavi('1111')).toMatchObject({ id: admin });
  });

  test('admin PIN: samo PIN administratora; neuspjeh ulazi u ograničenje pokušaja', () => {
    const s = nova();
    expect(s.provjeriAdminPin('1111')).toEqual({ id: admin, ime: 'Admin', uloga: 'admin' });
    for (const pin of ['1234', '9999', '', undefined]) {
      expect(greska(() => s.provjeriAdminPin(pin))).toBe('Neispravan admin PIN');
    }
    expect(greska(() => s.provjeriAdminPin('8888'))).toBe('Neispravan admin PIN');
    expect(greska(() => s.provjeriAdminPin('1111'))).toBe(BLOKADA_30);
  });

  describe('order:refundAndPrint uz kasa.requirePinRefund', () => {
    test('kasir šalje admin PIN u istom pozivu — provjerava se prije handlera', () => {
      postavi('kasa.requirePinRefund', 'true');
      const s = nova();
      s.prijavi('1234');
      for (const args of [[], [null], [{ id: 1 }], [{ id: 1, adminPin: '' }]]) {
        expect(greska(() => s.provjeriPristup('order:refundAndPrint', args))).toBe('Reklamacija traži PIN administratora');
      }
      expect(greska(() => s.provjeriPristup('order:refundAndPrint', [{ id: 1, adminPin: '1234' }]))).toBe('Neispravan admin PIN');
      const unos = { id: 1, adminPin: '1111' };
      s.provjeriPristup('order:refundAndPrint', [unos]);
      expect(s.odobrioAdmin(unos)).toBe(admin);
      // Odobrenje važi samo za payload poziva koji je prošao provjeru.
      expect(s.odobrioAdmin({ ...unos })).toBeNull();
    });

    test('admin ne treba PIN; bez postavke ni kasir — tada nema odobrenja', () => {
      postavi('kasa.requirePinRefund', 'true');
      const s = nova();
      s.prijavi('1111');
      const odAdmina = { id: 1 };
      s.provjeriPristup('order:refundAndPrint', [odAdmina]);
      expect(s.odobrioAdmin(odAdmina)).toBeNull();

      postavi('kasa.requirePinRefund', 'false');
      s.prijavi('1234');
      const odKasira = { id: 1, adminPin: '9999' };
      s.provjeriPristup('order:refundAndPrint', [odKasira]);
      expect(s.odobrioAdmin(odKasira)).toBeNull();
    });

    test('pogrešan admin PIN ulazi u ograničenje pokušaja', () => {
      postavi('kasa.requirePinRefund', 'true');
      const s = nova();
      s.prijavi('1234');
      for (let i = 0; i < 5; i++) {
        expect(greska(() => s.provjeriPristup('order:refundAndPrint', [{ id: 1, adminPin: '9999' }]))).toBe('Neispravan admin PIN');
      }
      expect(greska(() => s.provjeriPristup('order:refundAndPrint', [{ id: 1, adminPin: '1111' }]))).toBe(BLOKADA_30);
    });

    test('bez prijave i sa zadanim PIN-om važe opšte poruke, PIN se ne provjerava', () => {
      postavi('kasa.requirePinRefund', 'true');
      const s = nova();
      expect(greska(() => s.provjeriPristup('order:refundAndPrint', [{ id: 1, adminPin: '9999' }]))).toBe(PORUKA_NISTE_PRIJAVLJENI);
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(HES['0000'], kasir);
      s.prijavi('0000');
      expect(greska(() => s.provjeriPristup('order:refundAndPrint', [{ id: 1, adminPin: '9999' }]))).toBe(PORUKA_ZADANI_PIN);
      expect(db.prepare('SELECT 1 FROM settings WHERE key = ?').get(KLJUC_BLOKADE)).toBeNull();
    });
  });

  test('nalog:setStatus "vrati" kroz sesiju: kasir ne može ni kad u payload-u pošalje admina', () => {
    const s = nova();
    s.prijavi('1234');
    expect(greska(() => s.provjeriPristup('nalog:setStatus', [{ id: 1, status: 'vrati', korisnikId: admin }])))
      .toBe('Vraćanje naloga u izradu može samo administrator');
    s.prijavi('1111');
    expect(() => s.provjeriPristup('nalog:setStatus', [{ id: 1, status: 'vrati' }])).not.toThrow();
  });
});
