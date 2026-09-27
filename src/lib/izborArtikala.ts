import type { Product } from '@/types';

/** Artikal se ne može prodati: zaliha je 0, a prodaja bez zalihe nije dozvoljena. Usluge nemaju zalihu. */
export function nemaNaStanju(product: Product, allowZeroStock: boolean): boolean {
  if (allowZeroStock || product.tip === 'usluga') return false;
  return product.stanje != null && product.stanje <= 0;
}
