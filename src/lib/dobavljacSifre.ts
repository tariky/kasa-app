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
 * Bonus za pretragu u stavkama ulaza: artikal čiju tačnu šifru ima izabrani dobavljač ulaza
 * (`sifreIzabranog`: productId → šifra) ide prvi — to je red s njegove fakture.
 */
export function bonusSifreIzabranog(sifreIzabranog?: Map<number, string>) {
  return (p: Pick<Product, 'id'>, upit: string): number =>
    sifreIzabranog?.get(p.id)?.toLowerCase() === upit.trim().toLowerCase() ? 1000 : 0;
}
