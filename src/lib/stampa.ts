import type { FirmaSettings } from '@/types';
import { LOGO_VELICINA } from './firma';
import { KLJUCEVI_DOKUMENATA, ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke, type DokumentPostavke } from './dokumentPostavke';

const PRAZNA_FIRMA: FirmaSettings = {
  naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', web: '', email: '',
  logo: '', logoVelicina: LOGO_VELICINA.zadano, ziroRacuniPozicija: 'zaglavlje', bankAccounts: [],
};

export async function ucitajDokumentPostavke(): Promise<DokumentPostavke> {
  try {
    const vr = await Promise.all(KLJUCEVI_DOKUMENATA.map(k => window.api.getSetting(k)));
    return procitajDokumentPostavke(Object.fromEntries(KLJUCEVI_DOKUMENATA.map((k, i) => [k, vr[i]])));
  } catch {
    return ZADANE_DOKUMENT_POSTAVKE;
  }
}

/** Firma i postavke dokumenata svježe iz baze — PDF se pravi van React stabla i mora vidjeti zadnje spremljeno. */
export async function ucitajZaStampu(): Promise<{ firma: FirmaSettings; postavke: DokumentPostavke }> {
  const [firma, postavke] = await Promise.all([
    window.api.getFirmaSettings().catch(() => PRAZNA_FIRMA),
    ucitajDokumentPostavke(),
  ]);
  return { firma, postavke };
}
