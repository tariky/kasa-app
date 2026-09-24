import type { FirmaSettings } from '@/types';

/** Stranica loga u PDF tačkama (pt); logo je kvadratni okvir s objectFit: contain. */
export const LOGO_VELICINA = { min: 40, max: 200, zadano: 100 } as const;

export function logoVelicina(firma: Pick<Partial<FirmaSettings>, 'logoVelicina'>): number {
  const v = firma.logoVelicina;
  if (typeof v !== 'number' || !Number.isFinite(v)) return LOGO_VELICINA.zadano;
  return Math.min(LOGO_VELICINA.max, Math.max(LOGO_VELICINA.min, Math.round(v)));
}

/** "web · email" za zaglavlje dokumenta; prazan string ako ništa nije uneseno. */
export function kontaktFirme(firma: Pick<Partial<FirmaSettings>, 'web' | 'email'>): string {
  return [firma.web, firma.email].map(s => s?.trim() ?? '').filter(Boolean).join(' · ');
}
