import { pdf } from '@react-pdf/renderer';
import { PrilogPdf, type PrilogPdfStavka } from '@/components/PrilogPdf';
import { ucitajZaStampu } from '@/lib/stampa';

/**
 * Otvori A4 fakturu uz fiskalni račun za štampu. Vraća false kad faktura još
 * nema stavki (dodjeljuju se kasnije u Računima). Firma i postavke koje se ne
 * mogu pročitati daju praznu firmu / zadane postavke; ostale greške (narudžba,
 * stavke, PDF) propušta pozivaocu.
 */
export async function otvoriFakturuZaStampu(orderId: number): Promise<boolean> {
  const order = await window.api.getOrder(orderId);
  if (!order) return false;
  const stavke: PrilogPdfStavka[] = await window.api.getPrilogStavke(orderId);
  if (stavke.length === 0) return false;
  const { firma, postavke } = await ucitajZaStampu();
  const blob = await pdf(<PrilogPdf order={order} firma={firma} stavke={stavke} postavke={postavke} />).toBlob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  return true;
}
