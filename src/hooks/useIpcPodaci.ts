import { useCallback, useEffect, useRef, useState } from 'react';
import { porukaGreske } from '@/lib/utils';

export interface StanjePodataka<T> {
  /** undefined dok prvo učitavanje nije uspjelo. Pri osvježavanju ostaju stari podaci. */
  podaci: T | undefined;
  /** Poruka zadnjeg neuspjelog učitavanja (bez Electron prefiksa); null kad je uspjelo. */
  greska: string | null;
  ucitava: boolean;
}

export const POCETNO_STANJE: StanjePodataka<never> = { podaci: undefined, greska: null, ucitava: true };

/**
 * Red učitavanja: upisuje se samo odgovor zadnjeg pokrenutog zahtjeva. Raniji
 * koji stigne kasnije (brza promjena filtera, StrictMode dvostruki effect) se
 * odbacuje, kao i svaki odgovor poslije `otkazi()`. `ucitaj` nikad ne odbija —
 * greška ide u stanje.
 */
export function redUcitavanja<T>(javi: (promjena: (s: StanjePodataka<T>) => StanjePodataka<T>) => void) {
  let zadnji = 0;
  return {
    async ucitaj(ucitaj: () => Promise<T>): Promise<void> {
      const moj = ++zadnji;
      javi(s => (s.ucitava ? s : { ...s, ucitava: true }));
      try {
        const podaci = await ucitaj();
        if (moj === zadnji) javi(() => ({ podaci, greska: null, ucitava: false }));
      } catch (e) {
        if (moj === zadnji) javi(s => ({ ...s, greska: porukaGreske(e), ucitava: false }));
      }
    },
    otkazi() { zadnji++; },
  };
}

/**
 * Podaci iz backenda za ekran: učitava pri mountu i kad se promijene `deps`,
 * greška se vidi umjesto tihog praznog ekrana. `osvjezi` ponovo učitava (npr.
 * poslije spremanja) i nikad ne baca.
 */
export function useIpcPodaci<T>(ucitaj: () => Promise<T>, deps: React.DependencyList): StanjePodataka<T> & { osvjezi: () => Promise<void> } {
  const [stanje, setStanje] = useState<StanjePodataka<T>>(POCETNO_STANJE);
  const [red] = useState(() => redUcitavanja<T>(setStanje));
  // osvjezi uvijek zove zadnju verziju funkcije (njena zatvaranja vide aktuelne filtere).
  const zadnja = useRef(ucitaj);
  useEffect(() => { zadnja.current = ucitaj; });

  useEffect(() => {
    red.ucitaj(ucitaj);
    return () => red.otkazi();
  }, deps);

  const osvjezi = useCallback(() => red.ucitaj(() => zadnja.current()), [red]);
  return { ...stanje, osvjezi };
}
