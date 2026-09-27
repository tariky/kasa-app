import { round2 } from './novac';

/** Stopa PDV-a za stopu 'E' (BiH, 17 %). Stopa 'K' je oslobođena. Rust backend ima svoj par. */
export const PDV_STOPA_E_PCT = 17;
/** Bruto = neto × faktor. Drži se kao literal (ne 1 + 17/100) da zaokruživanje ostane bit-identično dosadašnjem. */
export const PDV_FAKTOR_E = 1.17;

/** PDV sadržan u bruto iznosu (sa PDV-om): bruto × stopa / (100 + stopa), na fening. */
export function izluciPdv(bruto: number, stopaPct: number): number {
  return round2((bruto * stopaPct) / (100 + stopaPct));
}
