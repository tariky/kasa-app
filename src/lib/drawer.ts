/**
 * Obračun očekivanog stanja gotovine u ladici.
 * Čista logika bez baze — dijele je main proces (cash:drawerState) i testovi.
 */
import { round2 } from './novac';

export interface CashMovementLike {
  tip: 'polog' | 'povrat';
  iznos: number;
}

export interface OrderLike {
  nacinPlacanja: string;
  ukupno: number;
}

export interface DrawerState {
  polozi: number;
  gotovinskiPromet: number;
  povrati: number;
  gotovinskeReklamacije: number;
  ocekivanoStanje: number;
}

/**
 * Gotovinski dio jednog računa. `nacinPlacanja` je ili plain string
 * ('Gotovina', 'Kartica'...) — tada je gotovina puni iznos ili ništa —
 * ili JSON `{gotovina, kartica, ...}` s razbijenim iznosima.
 */
export function gotovinskiIznos(nacinPlacanja: string, ukupno: number): number {
  try {
    const parsed = JSON.parse(nacinPlacanja);
    return typeof parsed.gotovina === 'number' ? parsed.gotovina : 0;
  } catch {
    return nacinPlacanja === 'Gotovina' ? ukupno : 0;
  }
}

/**
 * `prodaje` su računi prodani u periodu (bez obzira na kasniji storno —
 * prodaja je tada unijela gotovinu), a `reklamirani` računi stornirani u
 * periodu (mogu biti prodani i ranije). Račun prodan i storniran isti dan
 * pojavi se u obje liste pa se gotovinski efekat poništi.
 */
export function ocekivanoStanje(
  movements: CashMovementLike[],
  prodaje: OrderLike[],
  reklamirani: OrderLike[]
): DrawerState {
  let polozi = 0;
  let povrati = 0;
  for (const m of movements) {
    if (m.tip === 'polog') polozi += m.iznos;
    else povrati += m.iznos;
  }

  let gotovinskiPromet = 0;
  let gotovinskeReklamacije = 0;
  for (const o of prodaje) gotovinskiPromet += gotovinskiIznos(o.nacinPlacanja, o.ukupno);
  for (const o of reklamirani) gotovinskeReklamacije += gotovinskiIznos(o.nacinPlacanja, o.ukupno);

  return {
    polozi: round2(polozi),
    gotovinskiPromet: round2(gotovinskiPromet),
    povrati: round2(povrati),
    gotovinskeReklamacije: round2(gotovinskeReklamacije),
    ocekivanoStanje: round2(polozi + gotovinskiPromet - povrati - gotovinskeReklamacije),
  };
}
