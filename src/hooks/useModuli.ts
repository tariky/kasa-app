import { useModuliKontekst } from '@/components/ModuliProvider';
import type { StanjeModula } from '@/lib/moduli';

/** Moduli iz licence i postavki. null = još se učitava. */
export function useModuli(): StanjeModula | null {
  return useModuliKontekst().moduli;
}
