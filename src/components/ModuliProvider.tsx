import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LicencaInfo } from '@/lib/licencaTipovi';
import { licenciraniModuli, stanjeModula, type PostavkeModula, type StanjeModula } from '@/lib/moduli';

interface Vrijednost {
  /** Stanje licence. null = još se učitava. */
  licenca: LicencaInfo | null;
  /** Moduli iz licence i postavki. null = još se učitava. */
  moduli: StanjeModula | null;
  /** Novo stanje licence (npr. nakon aktivacije) — vide ga svi ekrani odmah. */
  objaviLicencu: (info: LicencaInfo) => void;
  /** Uključuje/isključuje Proizvodnju ili Generator: sprema postavku, pa navigacija reaguje bez remounta. */
  postaviModul: (modul: keyof PostavkeModula, ukljucen: boolean) => Promise<void>;
  otvoriLicencaDialog: () => void;
  /** Raste sa svakim zahtjevom za dialog licence (dugme ili blokada iz backenda). */
  licencaDialogZahtjev: number;
}

const Ctx = createContext<Vrijednost | null>(null);

/**
 * Licenca i moduli za cijelu aplikaciju: jedno čitanje licence i postavki
 * modula, osvježavanje svaki sat (kasa zna raditi danima) i jedna pretplata
 * na blokadu licence iz backenda.
 */
export function ModuliProvider({ children }: { children: React.ReactNode }) {
  const [licenca, setLicenca] = useState<LicencaInfo | null>(null);
  const [postavke, setPostavke] = useState<PostavkeModula | null>(null);
  const [licencaDialogZahtjev, setLicencaDialogZahtjev] = useState(0);

  const otvoriLicencaDialog = useCallback(() => setLicencaDialogZahtjev(n => n + 1), []);

  useEffect(() => {
    const ucitaj = () => window.api.getLicenca().then(setLicenca).catch(() => { /* ostaje zadnje poznato stanje */ });
    ucitaj();
    Promise.all([window.api.getSetting('proizvodnja.enabled'), window.api.getSetting('ui.showGenerator')])
      .then(([p, g]) => setPostavke({ proizvodnja: p === 'true', generator: g === 'true' }))
      // Neuspjelo čitanje postavki: Proizvodnja i Generator isključeni, ostali moduli i dalje rade
      .catch(() => setPostavke({ proizvodnja: false, generator: false }));
    const sat = setInterval(ucitaj, 60 * 60 * 1000);
    // Backend je odbio radnju zbog licence: novo stanje + dialog za unos koda.
    const odjavi = window.api.onLicencaBlokirano(() => { ucitaj(); otvoriLicencaDialog(); });
    return () => { clearInterval(sat); odjavi(); };
  }, [otvoriLicencaDialog]);

  const postaviModul = useCallback(async (modul: keyof PostavkeModula, ukljucen: boolean) => {
    if (modul === 'proizvodnja') await window.api.setProizvodnjaEnabled(ukljucen);
    else await window.api.setSetting('ui.showGenerator', String(ukljucen));
    setPostavke(s => s && { ...s, [modul]: ukljucen });
  }, []);

  const moduli = useMemo(
    () => (licenca && postavke ? stanjeModula(licenciraniModuli(licenca), postavke) : null),
    [licenca, postavke],
  );

  const vrijednost = useMemo<Vrijednost>(() => ({
    licenca, moduli, objaviLicencu: setLicenca, postaviModul, otvoriLicencaDialog, licencaDialogZahtjev,
  }), [licenca, moduli, postaviModul, otvoriLicencaDialog, licencaDialogZahtjev]);

  return <Ctx.Provider value={vrijednost}>{children}</Ctx.Provider>;
}

/** Licenca, moduli i radnje nad njima. Samo unutar `ModuliProvider` (App ga drži oko svih ekrana). */
export function useModuliKontekst(): Vrijednost {
  const v = useContext(Ctx);
  if (!v) throw new Error('useModuliKontekst van ModuliProvider-a');
  return v;
}
