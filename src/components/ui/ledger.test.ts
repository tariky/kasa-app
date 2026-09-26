import { describe, expect, test } from 'bun:test';
import { jePoljeZaUnos } from './ledger';

const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

describe('jePoljeZaUnos', () => {
  test('input, textarea, select i contentEditable su polja — tu prečice ekrana ne važe', () => {
    expect(jePoljeZaUnos(el('INPUT'))).toBe(true);
    expect(jePoljeZaUnos(el('TEXTAREA'))).toBe(true);
    expect(jePoljeZaUnos(el('SELECT'))).toBe(true);
    expect(jePoljeZaUnos(el('DIV', true))).toBe(true);
  });

  test('dugme, red liste, tijelo stranice i prazan cilj nisu', () => {
    expect(jePoljeZaUnos(el('BUTTON'))).toBe(false);
    expect(jePoljeZaUnos(el('TR'))).toBe(false);
    expect(jePoljeZaUnos(el('BODY'))).toBe(false);
    expect(jePoljeZaUnos(null)).toBe(false);
  });
});
