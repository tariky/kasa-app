import { useModuliKontekst } from '@/components/ModuliProvider';
import type { LicencaInfo } from '@/lib/licencaTipovi';

/** Stanje licence. null = još se učitava. Osvježava se svaki sat (ModuliProvider). */
export function useLicenca(): LicencaInfo | null {
  return useModuliKontekst().licenca;
}
