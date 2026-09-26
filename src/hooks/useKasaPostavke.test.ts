import { describe, expect, test } from 'bun:test';
import { KLJUCEVI_KASE, kasaPostavkeIz } from './useKasaPostavke';

describe('kasaPostavkeIz', () => {
  test('dok postavke nisu učitane (ili ključa nema): zaliha se poštuje, kusur uključen, bez napomene, skena i prometa', () => {
    const zadano = { allowZeroStock: false, kusurEnabled: true, racunNapomena: '', scanMode: false, prikaziDnevniPromet: false };
    expect(kasaPostavkeIz({})).toEqual(zadano);
    expect(kasaPostavkeIz(Object.fromEntries(KLJUCEVI_KASE.map(k => [k, null])))).toEqual(zadano);
  });

  test('uključene postavke', () => {
    expect(kasaPostavkeIz({
      'kasa.showDailyTotal': 'true', 'kasa.allowZeroStock': 'true', 'kasa.kusurKalkulacija': 'false',
      'racun.napomena': 'Hvala na posjeti', 'kasa.scanMode': 'true',
    })).toEqual({ allowZeroStock: true, kusurEnabled: false, racunNapomena: 'Hvala na posjeti', scanMode: true, prikaziDnevniPromet: true });
  });

  test('samo tačno „true“ uključuje, a kusur gasi samo „false“', () => {
    expect(kasaPostavkeIz({ 'kasa.allowZeroStock': '1', 'kasa.scanMode': 'da', 'kasa.showDailyTotal': 'TRUE', 'kasa.kusurKalkulacija': '0' }))
      .toEqual({ allowZeroStock: false, kusurEnabled: true, racunNapomena: '', scanMode: false, prikaziDnevniPromet: false });
  });

  test('ključevi se čitaju redom kojim ih je kasa uvijek čitala', () => {
    expect(KLJUCEVI_KASE).toEqual(['kasa.showDailyTotal', 'kasa.allowZeroStock', 'kasa.kusurKalkulacija', 'racun.napomena', 'kasa.scanMode']);
  });
});
