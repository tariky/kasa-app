import { useModuli } from './useModuli';

/** Da li je modul Proizvodnja uključen (licenca + postavka). null = još se učitava. */
export function useProizvodnja(): boolean | null {
  const moduli = useModuli();
  return moduli ? moduli.ukljuceni.proizvodnja : null;
}
