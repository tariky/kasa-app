// Odgovor kanala izvoz:knjigovodja — sirovi redovi upita iz upiti.ts, isti
// za Electron i Tauri backend. Obračun je u obracun.ts.

export interface IzvozRacun {
  id: number;
  createdAt: string;
  refundedAt: string | null;
  brojFiskalnogRacuna: string | null;
  brojReklamacije: string | null;
  status: 'completed' | 'refunded';
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  kupacNaziv: string | null;
  kupacIdBroj: string | null;
  isManual: number;
  prilogBroj: number | null;
  datumValute: string | null;
  korisnikIme: string | null;
}

export interface IzvozStavkaRacuna {
  orderId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
}

export interface IzvozPrimka {
  id: number;
  brojPrimke: string;
  datum: string;
  dobavljacNaziv: string | null;
  dobavljacId: string | null;
  brojFakture: string | null;
}

export interface IzvozPrimkaStavka {
  primkaId: number;
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number;
  cijena: number;
  nabavnaCijena: number;
  rabat: number;
  zavisniTroskovi: number;
  pdvStopa: string;
}

export interface IzvozNivelacijaStavka {
  brojNivelacije: string;
  datum: string;
  sifra: string | null;
  naziv: string | null;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  razlika: number;
  ukupnaRazlika: number;
  pdvStopa: string;
}

export interface IzvozKretanjeNovca {
  createdAt: string;
  tip: 'polog' | 'povrat';
  iznos: number;
  korisnikIme: string | null;
  napomena: string | null;
  tringStatus: string;
}

export interface IzvozUtrosak {
  nalogId: number;
  broj: number;
  godina: number;
  zavrsenAt: string;
  opis: string;
  proizvod: string | null;
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number;
  /** Cijena zamrznuta pri završetku naloga; null = uzima se prosjecnaNabavna. */
  nabavnaCijena: number | null;
  /** Prosječna nabavna materijala iz primki do dana završetka naloga. */
  prosjecnaNabavna: number;
}

export interface IzvozZaliha {
  sifra: string;
  naziv: string;
  jm: string | null;
  tip: string;
  /** Stanje na kraju dana `do` (zbir kretanja). */
  kolicina: number;
  /** Prodajna cijena važeća na dan `do`. */
  cijena: number;
  /** Zbir nabavnih vrijednosti primki do `do` — za prosječnu nabavnu. */
  nabavnaVrijednost: number;
  nabavnaKolicina: number;
}

export interface KnjigovodjaPodaci {
  od: string;
  do: string;
  racuni: IzvozRacun[];
  reklamacije: IzvozRacun[];
  stavkeRacuna: IzvozStavkaRacuna[];
  primke: IzvozPrimka[];
  primkaStavke: IzvozPrimkaStavka[];
  nivelacije: IzvozNivelacijaStavka[];
  kretanjaNovca: IzvozKretanjeNovca[];
  utrosak: IzvozUtrosak[];
  zalihe: IzvozZaliha[];
}
