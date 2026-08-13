export interface User {
  id: number;
  ime: string;
  pin: string;
  uloga: 'admin' | 'kasir';
  createdAt: string;
}

export interface Product {
  id: number;
  sifra: string;
  naziv: string;
  jm: string;
  cijena: number;
  pdvStopa: 'E' | 'K';
  plu?: number;
  barkod?: string;
  tip: 'artikal' | 'usluga';
  createdAt: string;
  updatedAt: string;
  stanje?: number;
}

export interface Dobavljac {
  id: number;
  naziv: string;
  idBroj?: string;
  pdvBroj?: string;
  adresa?: string;
  kontakt?: string;
  createdAt: string;
}

export interface Primka {
  id: number;
  brojPrimke: string;
  datum: string;
  dobavljacNaziv?: string;
  dobavljacId?: string;
  dobavljacAdresa?: string;
  brojFakture?: string;
  napomena?: string;
  createdAt: string;
  stavke?: PrimkaStavka[];
}

export interface PrimkaStavka {
  id: number;
  primkaId: number;
  productId: number;
  kolicina: number;
  cijena: number;
  nabavnaCijena: number;
  rabat: number;
  pdvStopa: string;
  createdAt: string;
  productNaziv?: string;
  productJm?: string;
  productSifra?: string;
}

export interface Order {
  id: number;
  korisnikId: number;
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  brojFiskalnogRacuna?: string;
  brojReklamacije?: string;
  status: 'completed' | 'refunded';
  isManual?: boolean;
  /** Interni broj priloga; NULL/undefined = običan račun. */
  prilogBroj?: number | null;
  createdAt: string;
  stavke?: OrderItem[];
  korisnikIme?: string;
  kupacNaziv?: string;
  kupacIdBroj?: string;
  kupacAdresa?: string;
  kupacGrad?: string;
  kupacPostanskiBroj?: string;
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
  productNaziv?: string;
  productJm?: string;
}

export interface Kupac {
  id: number;
  naziv: string;
  idBroj: string;
  pdvBroj?: string;
  adresa?: string;
  postanskiBroj?: string;
  grad?: string;
  kontakt?: string;
  createdAt: string;
}

export interface CartItem {
  product: Product;
  kolicina: number;
  rabat: number;
}

export interface TringSettings {
  host: string;
  port: number;
  operatorId: number;
  operatorPassword: string;
}

export interface NivelacijaStavka {
  id: number;
  nivelacijaId: number;
  productId: number;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  razlika: number;
  ukupnaRazlika: number;
  pdvStopa: string;
  productNaziv?: string;
  productSifra?: string;
  productJm?: string;
}

export interface Nivelacija {
  id: number;
  brojNivelacije: string;
  datum: string;
  primkaId: number | null;
  napomena: string | null;
  createdAt: string;
  stavke?: NivelacijaStavka[];
  primkaBroj?: string;
  stavkiCount?: number;
  ukupnaRazlika?: number;
}

export interface BankAccount {
  bankName: string;
  accountNumber: string;
}

export interface FirmaSettings {
  naziv: string;
  adresa: string;
  grad: string;
  idBroj: string;
  pdvBroj: string;
  skladiste: string;
  logo: string;
  bankAccounts: BankAccount[];
}
