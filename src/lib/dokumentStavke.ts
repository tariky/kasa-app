import { round2 } from './novac';
import { PDV_FAKTOR_E } from './pdv';
import { iznosStavke, pdvStavke } from './racun';

/** Red komercijalnog dokumenta (račun, faktura, ponuda) — ono što kolone ispisuju. */
export interface LinijaDokumenta {
  /** Jedinična cijena bez PDV-a, izlučena iz bruto cijene po stopi stavke. */
  cijenaBezPdv: number;
  /** PDV sadržan u iznosu reda, nezaokružen kao `pdvStavke` (zaokružuje ga ispis). */
  pdv: number;
  /** Iznos reda sa PDV-om, zaokružen po redu kao `iznosStavke` — kolona se zbraja u UKUPNO. */
  iznos: number;
}

/**
 * Računica jednog reda za PDF dokumente. Cijene u sistemu su sa uračunatim PDV-om;
 * iznos se zaokružuje po redu kao na fiskalnom uređaju, pa se iznos reda na dokumentu
 * ne razlikuje za fening od zbira u UKUPNO. Stari zapisi bez rabata računaju se s 0 %.
 */
export function linijaDokumenta(s: { cijena: number; kolicina: number; rabat?: number | null; pdvStopa: string }): LinijaDokumenta {
  const stavka = { cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat ?? 0, pdvStopa: s.pdvStopa };
  return {
    cijenaBezPdv: s.pdvStopa === 'E' ? round2(s.cijena / PDV_FAKTOR_E) : round2(s.cijena),
    pdv: pdvStavke(stavka),
    iznos: iznosStavke(stavka),
  };
}
