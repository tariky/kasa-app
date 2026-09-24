import type { DobavljacSifra, Product } from '@/types';

/** Red u uređivaču šifri dobavljača na artiklu; dobavljacId null = dobavljač još nije izabran. */
export interface SifraRed {
  dobavljacId: number | null;
  sifra: string;
}

export function uRedove(lista: DobavljacSifra[]): SifraRed[] {
  return lista.map(s => ({ dobavljacId: s.dobavljacId, sifra: s.sifra ?? '' }));
}

/** Redovi bez izabranog dobavljača se ne spremaju; prazna šifra je dozvoljena. */
export function uPayload(redovi: SifraRed[]): { dobavljacId: number; sifra: string | null }[] {
  return redovi
    .filter((r): r is SifraRed & { dobavljacId: number } => r.dobavljacId !== null)
    .map(r => ({ dobavljacId: r.dobavljacId, sifra: r.sifra.trim() || null }));
}

/** Da li riječ pretrage (već mala slova) stoji u nekoj od šifri dobavljača artikla. */
export function uSiframaDobavljaca(p: Pick<Product, 'sifreDobavljaca'>, rijec: string): boolean {
  return (p.sifreDobavljaca ?? '').toLowerCase().includes(rijec);
}

/**
 * Pretraga artikala u stavkama ulaza: svaka riječ mora stajati u nazivu, šifri, barkodu
 * ili šifri dobavljača. Artikal čiju tačnu šifru ima izabrani dobavljač ulaza
 * (`sifreIzabranog`: productId → šifra) ide prvi — to je red s njegove fakture.
 */
export function pretraziZaUlaz(products: Product[], q: string, sifreIzabranog?: Map<number, string>, max = 12): Product[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const rijeci = s.split(/\s+/);
  const pogoci = products.filter(p => rijeci.every(r =>
    p.naziv.toLowerCase().includes(r) || p.sifra.toLowerCase().includes(r)
    || (p.barkod ?? '').toLowerCase().includes(r) || uSiframaDobavljaca(p, r)));
  const tacan = (p: Product) => sifreIzabranog?.get(p.id)?.toLowerCase() === s;
  return [...pogoci.filter(tacan), ...pogoci.filter(p => !tacan(p))].slice(0, max);
}
