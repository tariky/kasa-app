import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ZADANE_DOKUMENT_POSTAVKE, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { ucitajDokumentPostavke } from '@/lib/stampa';

interface Vrijednost { postavke: DokumentPostavke; osvjezi: () => Promise<void> }

const Ctx = createContext<Vrijednost>({ postavke: ZADANE_DOKUMENT_POSTAVKE, osvjezi: () => Promise.resolve() });

/** Postavke dokumenata za ekrane (format brojeva, zadani rokovi…); Postavke zovu `osvjezi` nakon spremanja. */
export function DokumentPostavkeProvider({ children }: { children: React.ReactNode }) {
  const [postavke, setPostavke] = useState<DokumentPostavke>(ZADANE_DOKUMENT_POSTAVKE);
  const osvjezi = useCallback(async () => { setPostavke(await ucitajDokumentPostavke()); }, []);
  useEffect(() => { osvjezi(); }, [osvjezi]);
  return <Ctx.Provider value={{ postavke, osvjezi }}>{children}</Ctx.Provider>;
}

export const useDokumentPostavke = () => useContext(Ctx);
