import { pdf } from '@react-pdf/renderer';
import { PrilogPdf, type PrilogPdfStavka } from '@/components/PrilogPdf';

/**
 * Otvori A4 fakturu uz fiskalni račun za štampu. Vraća false kad faktura još
 * nema stavki (dodjeljuju se kasnije u Računima); greške propušta pozivaocu.
 */
export async function otvoriFakturuZaStampu(orderId: number): Promise<boolean> {
  const order = await window.api.getOrder(orderId);
  if (!order) return false;
  const stavke: PrilogPdfStavka[] = await window.api.getPrilogStavke(orderId);
  if (stavke.length === 0) return false;
  const firma = await window.api.getFirmaSettings();
  const blob = await pdf(<PrilogPdf order={order} firma={firma} stavke={stavke} />).toBlob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  return true;
}
