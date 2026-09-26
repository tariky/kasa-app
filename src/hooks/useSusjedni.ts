import { useMemo } from 'react';
import { susjedni, type Susjedni } from '@/lib/ledgerLista';

/** Prethodni i sljedeći dokument liste iz koje je dijalog otvoren (↑↓ i strelice u podnožju). */
export function useSusjedni(redoslijed: readonly number[], id: number | null): Susjedni {
  return useMemo(() => susjedni(redoslijed, id), [redoslijed, id]);
}
