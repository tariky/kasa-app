import { useEffect, useMemo, useState } from 'react';
import { useLicenca } from './useLicenca';
import { licenciraniModuli, stanjeModula, type PostavkeModula, type StanjeModula } from '@/lib/moduli';

/** Moduli iz licence i postavki. null = još se učitava. */
export function useModuli(): StanjeModula | null {
  const licenca = useLicenca();
  const [postavke, setPostavke] = useState<PostavkeModula | null>(null);

  useEffect(() => {
    Promise.all([window.api.getSetting('proizvodnja.enabled'), window.api.getSetting('ui.showGenerator')])
      .then(([p, g]) => setPostavke({ proizvodnja: p === 'true', generator: g === 'true' }));
    // Postavke javljaju promjenu odmah, bez ponovnog ulaska u aplikaciju
    const promjena = (kljuc: keyof PostavkeModula) => (e: Event) =>
      setPostavke(s => s && { ...s, [kljuc]: Boolean((e as CustomEvent).detail) });
    const onProizvodnja = promjena('proizvodnja');
    const onGenerator = promjena('generator');
    window.addEventListener('ui:proizvodnja', onProizvodnja);
    window.addEventListener('ui:showGenerator', onGenerator);
    return () => {
      window.removeEventListener('ui:proizvodnja', onProizvodnja);
      window.removeEventListener('ui:showGenerator', onGenerator);
    };
  }, []);

  return useMemo(
    () => (licenca && postavke ? stanjeModula(licenciraniModuli(licenca), postavke) : null),
    [licenca, postavke],
  );
}
