// src/lib/kalkulacija.ts
// Kalkulacija cijena za ulaz robe (obrazac KCM), onako kako se radi u praksi:
//   fakturna cijena bez PDV-a × količina
//   − rabat dobavljača (%)
//   + zavisni troškovi (prevoz, špedicija…) raspoređeni po stavkama
//   = nabavna vrijednost  →  / količina = nabavna cijena po jedinici
// Roba koja se prodaje ide dalje: + RUC → prodajna bez PDV → + PDV → MP cijena.
// Materijal staje na nabavnoj — ta cijena ulazi u prosječnu nabavnu i utrošak na nalogu.
// Jedan izvor istine za dijalog, PDF-ove i izvještaje; bez React-a.

export interface StavkaZaKalkulaciju {
  kolicina: number;
  /** Fakturna cijena po jedinici, bez PDV-a, prije rabata. */
  nabavnaCijena: number;
  rabat: number;
  /** Zavisni troškovi koji otpadaju na ovu stavku, ukupno u KM (ne po jedinici). */
  zavisniTroskovi: number;
  /** Prodajna cijena sa PDV-om; 0 za materijal. */
  cijena: number;
  pdvStopa: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const pdvStopaPct = (stopa: string) => (stopa === 'E' ? 17 : 0);

export function fakturnaVrijednost(s: Pick<StavkaZaKalkulaciju, 'kolicina' | 'nabavnaCijena'>): number {
  return s.kolicina * (s.nabavnaCijena || 0);
}

export function rabatIznos(s: Pick<StavkaZaKalkulaciju, 'kolicina' | 'nabavnaCijena' | 'rabat'>): number {
  return fakturnaVrijednost(s) * ((s.rabat || 0) / 100);
}

/** Nabavna vrijednost stavke: fakturna − rabat + zavisni. */
export function nabavnaVrijednost(s: Pick<StavkaZaKalkulaciju, 'kolicina' | 'nabavnaCijena' | 'rabat' | 'zavisniTroskovi'>): number {
  return fakturnaVrijednost(s) - rabatIznos(s) + (s.zavisniTroskovi || 0);
}

/**
 * Ukupne zavisne troškove dokumenta rasporedi po stavkama srazmjerno njihovoj
 * vrijednosti (fakturna − rabat). Zaokruženo na fening; ostatak zaokruživanja
 * ide na zadnju stavku koja nosi vrijednost, pa je zbir uvijek tačno `ukupno`.
 */
export function rasporediZavisne(vrijednosti: number[], ukupno: number): number[] {
  const zbir = vrijednosti.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  if (!(ukupno > 0) || zbir <= 0) return vrijednosti.map(() => 0);
  const out = vrijednosti.map(v => (v > 0 ? round2((ukupno * v) / zbir) : 0));
  const razlika = round2(ukupno - out.reduce((a, b) => a + b, 0));
  if (razlika !== 0) {
    let zadnji = -1;
    for (let i = vrijednosti.length - 1; i >= 0; i--) if (vrijednosti[i] > 0) { zadnji = i; break; }
    if (zadnji >= 0) out[zadnji] = round2(out[zadnji] + razlika);
  }
  return out;
}

export interface KalkulacijaStavke {
  fakturnaPoJed: number;
  fakturnaVrijednost: number;
  rabatIznos: number;
  zavisni: number;
  nabavnaPoJed: number;
  nabavnaVrijednost: number;
  prodajnaSaPdv: number;
  prodajnaBezPdv: number;
  prodajnaVrijednostBezPdv: number;
  rucStopa: number;
  rucIznos: number;
  pdvStopa: number;
  pdvIznos: number;
  mpVrijednost: number;
}

/** Puni red kalkulacije za jednu stavku. Stavka bez prodajne (materijal) ima samo nabavni dio. */
export function kalkulacijaStavke(s: StavkaZaKalkulaciju): KalkulacijaStavke {
  const fakturna = fakturnaVrijednost(s);
  const rabat = rabatIznos(s);
  const zavisni = s.zavisniTroskovi || 0;
  const nabavna = fakturna - rabat + zavisni;
  const nabavnaPoJed = s.kolicina > 0 ? nabavna / s.kolicina : 0;
  const prodajnaSaPdv = s.cijena || 0;
  const pdvStopa = pdvStopaPct(s.pdvStopa);
  const prodajnaBezPdv = prodajnaSaPdv / (1 + pdvStopa / 100);
  const prodajnaVrijednostBezPdv = prodajnaBezPdv * s.kolicina;
  const seProdaje = prodajnaSaPdv > 0;
  const rucIznos = seProdaje ? prodajnaVrijednostBezPdv - nabavna : 0;
  const rucStopa = seProdaje && nabavna > 0 ? (rucIznos / nabavna) * 100 : 0;
  const pdvIznos = prodajnaVrijednostBezPdv * (pdvStopa / 100);
  return {
    fakturnaPoJed: s.nabavnaCijena || 0, fakturnaVrijednost: fakturna, rabatIznos: rabat, zavisni,
    nabavnaPoJed, nabavnaVrijednost: nabavna,
    prodajnaSaPdv, prodajnaBezPdv, prodajnaVrijednostBezPdv,
    rucStopa, rucIznos, pdvStopa, pdvIznos, mpVrijednost: prodajnaVrijednostBezPdv + pdvIznos,
  };
}

export interface KalkulacijaPrimke {
  fakturna: number;
  rabat: number;
  zavisni: number;
  nabavna: number;
  /** Nabavna samo onih stavki koje se prodaju — osnova za RUC. */
  nabavnaArtikala: number;
  prodajnaBezPdv: number;
  pdv: number;
  /** Maloprodajna vrijednost sa PDV-om. */
  prodajna: number;
  ruc: number;
  rucPct: number;
  imaArtikala: boolean;
}

/** Sume dokumenta. RUC se računa samo nad stavkama sa prodajnom — materijal bi rušio postotak. */
export function kalkulacijaPrimke(stavke: StavkaZaKalkulaciju[]): KalkulacijaPrimke {
  const k: KalkulacijaPrimke = { fakturna: 0, rabat: 0, zavisni: 0, nabavna: 0, nabavnaArtikala: 0, prodajnaBezPdv: 0, pdv: 0, prodajna: 0, ruc: 0, rucPct: 0, imaArtikala: false };
  for (const s of stavke) {
    const r = kalkulacijaStavke(s);
    k.fakturna += r.fakturnaVrijednost; k.rabat += r.rabatIznos; k.zavisni += r.zavisni; k.nabavna += r.nabavnaVrijednost;
    if (r.prodajnaSaPdv > 0) {
      k.nabavnaArtikala += r.nabavnaVrijednost; k.prodajnaBezPdv += r.prodajnaVrijednostBezPdv;
      k.pdv += r.pdvIznos; k.prodajna += r.mpVrijednost; k.ruc += r.rucIznos;
    }
  }
  k.imaArtikala = k.nabavnaArtikala > 0;
  k.rucPct = k.imaArtikala ? (k.ruc / k.nabavnaArtikala) * 100 : 0;
  return k;
}
