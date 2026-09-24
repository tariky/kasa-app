import { useEffect, useState } from 'react';
import type { LicencaInfo } from '@/lib/licencaTipovi';

/** Javlja svim `useLicenca` da je stanje promijenjeno (npr. nakon aktivacije). */
export function objaviLicencu(info: LicencaInfo): void {
  window.dispatchEvent(new CustomEvent('ui:licenca', { detail: info }));
}

/** Otvara dialog za unos koda licence. */
export function otvoriLicencaDialog(): void {
  window.dispatchEvent(new Event('ui:licencaDialog'));
}

/** Stanje licence. null = još se učitava. Osvježava se svaki sat jer kasa zna raditi danima. */
export function useLicenca(): LicencaInfo | null {
  const [info, setInfo] = useState<LicencaInfo | null>(null);
  useEffect(() => {
    const ucitaj = () => window.api.getLicenca().then(setInfo).catch(() => {});
    ucitaj();
    const sat = setInterval(ucitaj, 60 * 60 * 1000);
    const onPromjena = (e: Event) => setInfo((e as CustomEvent<LicencaInfo>).detail);
    window.addEventListener('ui:licenca', onPromjena);
    const odjavi = window.api.onLicencaBlokirano(ucitaj);
    return () => {
      clearInterval(sat);
      window.removeEventListener('ui:licenca', onPromjena);
      odjavi();
    };
  }, []);
  return info;
}
