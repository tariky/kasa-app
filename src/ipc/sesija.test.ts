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
      trajanja.push(Number(/za (\d+) s/.exec((() => { try { o.provjeri(); return ''; } catch (e: any) { return e.message; } })())![1]));
    }
    expect(trajanja).toEqual([60, 120, 240, 480, 900, 900, 900]);
  });

  test('neuspjesi stariji od 15 min ispadaju iz prozora, a prag kreće ispočetka', () => {
    let sada = 0;
    const o = new OgranicenjePokusaja(() => sada);
    for (let i = 0; i < 5; i++) o.neuspjeh();
    sada += 15 * 60_000;
    expect(() => o.provjeri()).not.toThrow();
    for (let i = 0; i < 4; i++) o.neuspjeh();
    expect(() => o.provjeri()).not.toThrow();
    o.neuspjeh();
    expect(() => o.provjeri()).toThrow(porukaBlokade(30_000));
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
