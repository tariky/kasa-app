import { test, expect, describe } from 'bun:test';
import { OgranicenjePokusaja, OgranicenjePromjenaPina, provjeriPristup, porukaBlokade } from './sesija';

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
