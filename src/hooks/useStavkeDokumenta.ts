import { useCallback, useMemo, useState } from 'react';
import type { Product } from '@/types';
import {
  dodajProizvod, izmijeni as izmijeniStavku, ukloni as ukloniStavku, totaliStavki, type StavkaDokumenta,
} from '@/lib/stavkeDokumenta';

/**
 * Stavke dokumenta u formi (ponuda, faktura, stavke priloga, ručni račun).
 * `postavi` puni ili prepravlja cijelu listu (učitavanje, rabat na sve);
 * `totali` su ukupno i PDV trenutnih stavki.
 */
export function useStavkeDokumenta() {
  const [stavke, postavi] = useState<StavkaDokumenta[]>([]);
  const dodaj = useCallback((p: Product, kol: number | null, opcije?: { rabat?: number }) =>
    postavi(prev => dodajProizvod(prev, p, kol, opcije)), []);
  const izmijeni = useCallback((productId: number, izmjena: Partial<StavkaDokumenta>) =>
    postavi(prev => izmijeniStavku(prev, productId, izmjena)), []);
  const ukloni = useCallback((productId: number) =>
    postavi(prev => ukloniStavku(prev, productId)), []);
  const totali = useMemo(() => totaliStavki(stavke), [stavke]);
  return { stavke, postavi, dodaj, izmijeni, ukloni, totali };
}
