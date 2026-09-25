import { test, expect } from 'bun:test';
import { uredjajZaIzdavanje } from './licenca-zajednicko';

test('nova licenca je zadano vezana za uređaj; "bilo koji" se bira izričito', () => {
  expect(uredjajZaIzdavanje(' AAAA-BBBB-CCCC ', undefined)).toBe('AAAA-BBBB-CCCC');
  expect(uredjajZaIzdavanje('AAAA-BBBB-CCCC', false)).toBe('AAAA-BBBB-CCCC');
  expect(uredjajZaIzdavanje('', true)).toBeUndefined();
  expect(uredjajZaIzdavanje(undefined, true)).toBeUndefined();
  for (const [u, b] of [[undefined, undefined], ['', false], ['  ', undefined], [undefined, 'true'], [null, 1]] as const) {
    expect(() => uredjajZaIzdavanje(u, b)).toThrow('bilo koji');
  }
  expect(() => uredjajZaIzdavanje('AAAA-BBBB-CCCC', true)).toThrow('ne oboje');
  expect(() => uredjajZaIzdavanje(123, undefined)).toThrow('tekst');
});
