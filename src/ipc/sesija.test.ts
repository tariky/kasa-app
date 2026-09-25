import { test, expect, describe } from 'bun:test';
import { OgranicenjePokusaja, provjeriPristup, porukaBlokade } from './sesija';

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

describe('OgranicenjePokusaja', () => {
  test('5 grešaka → 30 s, zatim duplo do 15 min; uspjeh resetuje', () => {
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
    const trajanja: number[] = [];
    for (let i = 0; i < 7; i++) {
      o.neuspjeh();
      trajanja.push(Number(/za (\d+) s/.exec((() => { try { o.provjeri(); return ''; } catch (e: any) { return e.message; } })())![1]));
    }
    expect(trajanja).toEqual([60, 120, 240, 480, 900, 900, 900]);
    o.uspjeh();
    expect(() => o.provjeri()).not.toThrow();
    for (let i = 0; i < 4; i++) o.neuspjeh();
    expect(() => o.provjeri()).not.toThrow();
  });
});
