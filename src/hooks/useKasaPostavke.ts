import { useCallback, useEffect, useState } from 'react';

/** Postavke koje kasa čita pri otvaranju, redom kojim se čitaju. */
export const KLJUCEVI_KASE = ['kasa.showDailyTotal', 'kasa.allowZeroStock', 'kasa.kusurKalkulacija', 'racun.napomena', 'kasa.scanMode'] as const;
type KljucKase = typeof KLJUCEVI_KASE[number];

export interface KasaPostavke {
  /** Prodaja preko stanja (količina se ne steže na zalihu). */
  allowZeroStock: boolean;
  /** Poslije gotovinskog računa otvara se kalkulacija kusura. */
  kusurEnabled: boolean;
  /** Napomena ispod stavki fiskalnog računa. */
  racunNapomena: string;
  /** Brzi sken: artikal odmah ide u račun s količinom 1. */
  scanMode: boolean;
  /** Promet današnjih završenih računa u zaglavlju računa. */
  prikaziDnevniPromet: boolean;
}

/** Vrijednosti iz tabele settings → postavke kase; ključ koji još nije učitan (ili ga nema) daje zadano. */
export function kasaPostavkeIz(v: Partial<Record<KljucKase, string | null>>): KasaPostavke {
  return {
    allowZeroStock: v['kasa.allowZeroStock'] === 'true',
    kusurEnabled: v['kasa.kusurKalkulacija'] !== 'false',
    racunNapomena: v['racun.napomena'] || '',
    scanMode: v['kasa.scanMode'] === 'true',
    prikaziDnevniPromet: v['kasa.showDailyTotal'] === 'true',
  };
}

/**
 * Postavke kase, pročitane jednom pri otvaranju ekrana (Postavke su drugi
 * ekran, pa se kasa poslije promjene ionako ponovo otvara). Svaki ključ stiže
 * za sebe; do tada važi zadano. `postaviScanMode` pamti brzi sken (F2).
 */
export function useKasaPostavke() {
  const [vrijednosti, setVrijednosti] = useState<Partial<Record<KljucKase, string | null>>>({});

  useEffect(() => {
    for (const k of KLJUCEVI_KASE) {
      window.api.getSetting(k)
        .then(v => setVrijednosti(s => ({ ...s, [k]: v })))
        .catch(() => { /* ostaje zadano */ });
    }
  }, []);

  const postaviScanMode = useCallback((on: boolean) => {
    setVrijednosti(s => ({ ...s, 'kasa.scanMode': on ? 'true' : 'false' }));
    window.api.setSetting('kasa.scanMode', on ? 'true' : 'false');
  }, []);

  return { ...kasaPostavkeIz(vrijednosti), postaviScanMode };
}
