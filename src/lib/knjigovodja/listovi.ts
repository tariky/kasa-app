// Koji listovi idu u Excel i koliko redova nose — dijele excel.ts i tab
// (tab ne smije statički povući exceljs).
import type { KnjigovodjaIzvjestaj } from './obracun';

export const NAZIVI_LISTOVA = {
  rekapitulacija: 'Rekapitulacija',
  kif: 'KIF - računi',
  reklamacije: 'Reklamacije',
  kuf: 'KUF - ulaz robe',
  ulazStavke: 'Ulaz - stavke',
  nivelacije: 'Nivelacije',
  polog: 'Polog - povrat',
  utrosak: 'Utrošak materijala',
  zalihe: 'Zalihe na dan',
  kontrola: 'Kontrola',
} as const;

export function listoviIzvjestaja(iz: KnjigovodjaIzvjestaj): Array<{ naziv: string; redova: number }> {
  const L = NAZIVI_LISTOVA;
  return [
    { naziv: L.rekapitulacija, redova: iz.dani.length },
    { naziv: L.kif, redova: iz.kif.length },
    { naziv: L.reklamacije, redova: iz.reklamacije.length },
    ...(iz.moduli.skladiste ? [
      { naziv: L.kuf, redova: iz.kuf.length },
      { naziv: L.ulazStavke, redova: iz.ulazStavke.length },
      { naziv: L.nivelacije, redova: iz.nivelacije.length },
    ] : []),
    { naziv: L.polog, redova: iz.kretanjaNovca.length },
    ...(iz.moduli.proizvodnja ? [{ naziv: L.utrosak, redova: iz.utrosak.length }] : []),
    ...(iz.moduli.skladiste ? [{ naziv: L.zalihe, redova: iz.zalihe.length }] : []),
    { naziv: L.kontrola, redova: iz.upozorenja.length },
  ];
}
