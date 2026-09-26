import type { ReactElement } from 'react';
import { pdf, type DocumentProps } from '@react-pdf/renderer';
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

/** PDF za otvaranje ili snimanje: element dokumenta (`<RacunPdf …/>`) ili već napravljen blob. */
export type PdfIzvor = ReactElement<DocumentProps> | Blob;

const uBlob = (izvor: PdfIzvor): Promise<Blob> => (izvor instanceof Blob ? Promise.resolve(izvor) : pdf(izvor).toBlob());

/** Koliko često se gleda je li prozor s PDF-om zatvoren. */
export const PROVJERA_ZATVARANJA_MS = 2000;

/**
 * Otvori PDF u novom prozoru za pregled i štampu. Blob URL živi dok je prozor
 * otvoren: `onload` bi ga oslobodio čim se PDF prikaže, a pregledač ga može
 * ponovo čitati kad se iz prozora štampa ili snima; `onafterprint` ga ne
 * oslobodi nikad kad se PDF samo pogleda i zatvori. Prozor koji se nije otvorio — odmah.
 */
export async function otvoriPdf(izvor: PdfIzvor, naslov?: string): Promise<void> {
  const url = URL.createObjectURL(await uBlob(izvor));
  const prozor = window.open(url, '_blank');
  if (!prozor) { URL.revokeObjectURL(url); return; }
  if (naslov) {
    try { prozor.document.title = naslov; } catch { /* naslov nije bitan za štampu */ }
  }
  const provjera = setInterval(() => {
    if (!prozor.closed) return;
    clearInterval(provjera);
    URL.revokeObjectURL(url);
  }, PROVJERA_ZATVARANJA_MS);
}

/** Snimi PDF u fajl koji korisnik izabere. `false` = odustao od dijaloga. */
export async function spremiPdf(izvor: PdfIzvor, imeFajla: string): Promise<boolean> {
  const blob = await uBlob(izvor);
  const putanja = await window.api.showSaveDialog({ defaultName: imeFajla, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!putanja) return false;
  await window.api.writeFile(putanja, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
