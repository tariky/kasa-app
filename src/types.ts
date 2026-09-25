/** Korisnik kako ga vraćaju user:login i user:getAll — bez PIN-a. */
export interface User {
  id: number;
  ime: string;
  uloga: 'admin' | 'kasir';
}

export type ProductTip = 'artikal' | 'usluga' | 'materijal';

export interface Product {
  id: number;
  sifra: string;
  naziv: string;
  jm: string;
  cijena: number;
  pdvStopa: 'E' | 'K';
  plu?: number;
  barkod?: string;
  tip: ProductTip;
  /** Dimenzija ploče u mm — samo za materijal u m² koji se kupuje po komadu. */
  plocaSirina?: number | null;
  plocaVisina?: number | null;
  /** 1 = slobodna stavka s kase: skriveni artikal van šifarnika (product:slobodan). */
  slobodan?: number;
  createdAt: string;
  updatedAt: string;
  stanje?: number;
  /** Šifre dobavljača artikla razdvojene razmakom (samo za pretragu); null = nema ih. */
  sifreDobavljaca?: string | null;
}

/** Šifra pod kojom dobavljač vodi artikal; sifra null = artikal vezan za dobavljača bez šifre. */
export interface DobavljacSifra {
  dobavljacId: number;
  dobavljacNaziv?: string;
  sifra: string | null;
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
  /** Dio zavisnih troškova dokumenta (prevoz i sl.) koji otpada na stavku, ukupno u KM. */
  zavisniTroskovi: number;
  pdvStopa: string;
  /** Prodajna cijena koju je stavka pregazila bez nivelacije (artikal bez zalihe); null inače. */
  staraCijena?: number | null;
  /** Samo iz `primka:get`: cijenu artikla je poslije ove primke mijenjala druga primka ili ručna izmjena. */
  cijenaKasnijeMijenjana?: boolean;
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
  /** SQLite INTEGER 0/1 — u JSX uvijek kroz Boolean(), inače se `0` ispiše. */
  isManual?: 0 | 1;
  /** Interni broj priloga; NULL/undefined = običan račun. */
  prilogBroj?: number | null;
  prilogNaziv?: string | null;
  /** Datum valute (rok plaćanja), `YYYY-MM-DD`; upisuje se naknadno. */
  datumValute?: string | null;
  /** Napomena ispod stavki fakture. */
  napomena?: string | null;
  createdAt: string;
  stavke?: OrderItem[];
  korisnikIme?: string;
  kupacNaziv?: string;
  kupacIdBroj?: string;
  /** Dovučen iz šifrarnika kupaca po ID broju — ne snima se uz račun. */
  kupacPdvBroj?: string | null;
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

/** settings:getTring — lozinka operatera se ne vraća, samo da li je upisana. */
export interface TringSettings {
  host: string;
  port: number;
  operatorId: number;
  imaLozinku: boolean;
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

/**
 * Šta spremanje ili brisanje ulaza radi s prodajnim cijenama — backend pokrene
 * istu operaciju i poništi je (primka:pregledUnosa / pregledIzmjene / pregledBrisanja).
 */
export interface PregledCijenaUlaza {
  /** Nivelacije koje će nastati, redom i s brojem koji će dobiti. */
  dokumenti: Array<{
    /** `nivelacija` — nova cijena s ulaza; `protunivelacija` — poništenje cijene (uklonjena stavka, brisanje, povrat). */
    vrsta: 'nivelacija' | 'protunivelacija';
    brojNivelacije: string;
    datum: string;
    napomena: string | null;
    stavke: Array<{
      productId: number; productNaziv: string; kolicina: number;
      staraCijena: number; novaCijena: number; razlika: number; ukupnaRazlika: number;
    }>;
  }>;
  /** Artikli bez zalihe kojima se cijena mijenja bez dokumenta. */
  bezZalihe: Array<{ productId: number; productNaziv: string; staraCijena: number; novaCijena: number }>;
  /** Izmjena: cijena na ulazu promijenjena, ali u prodaji ostaje (kasnije ju je mijenjalo nešto drugo). */
  cijenaOstaje: Array<{ productId: number; productNaziv: string; cijena: number }>;
}

/**
 * Odgovor primka:create/update/delete kad se stanje promijenilo od pregleda
 * koji je korisnik potvrdio: ništa nije upisano, `pregled` je novi pregled za
 * ponovnu potvrdu.
 */
export interface PromijenjenoOdPregleda {
  promijenjeno: true;
  pregled: PregledCijenaUlaza;
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
  web: string;
  email: string;
  logo: string;
  /** Veličina loga na dokumentima u pt (vidi LOGO_VELICINA). */
  logoVelicina: number;
  /** Gdje faktura ispisuje žiro račune (vidi lib/firma.ts). */
  ziroRacuniPozicija: ZiroRacuniPozicija;
  bankAccounts: BankAccount[];
}

export type ZiroRacuniPozicija = 'zaglavlje' | 'podnozje';

export type NalogVrsta = 'narudzba' | 'zaliha';
export type NalogStatus = 'otvoren' | 'u_izradi' | 'zavrsen' | 'fakturisan';

export interface RadniNalogStavka {
  id: number;
  radniNalogId: number;
  materijalId: number;
  kolicina: number;
  /** Zamrznuta pri završetku; NULL dok je nalog otvoren. */
  nabavnaCijena: number | null;
  napomena?: string | null;
  materijalNaziv?: string;
  materijalSifra?: string;
  materijalJm?: string;
  plocaSirina?: number | null;
  plocaVisina?: number | null;
  stanje?: number;
}

export interface RadniNalog {
  id: number;
  broj: number;
  godina: number;
  datum: string;
  rok?: string | null;
  vrsta: NalogVrsta;
  kupacId?: number | null;
  ponudaId?: number | null;
  opis: string;
  productId?: number | null;
  kolicina: number;
  dogovorenaCijena?: number | null;
  trosakRada: number;
  status: NalogStatus;
  racunId?: number | null;
  korisnikId: number;
  napomena?: string | null;
  zavrsenAt?: string | null;
  createdAt: string;
  // JOIN polja
  kupacNaziv?: string | null;
  kupacIdBroj?: string | null;
  kupacAdresa?: string | null;
  kupacGrad?: string | null;
  kupacPostanskiBroj?: string | null;
  productNaziv?: string | null;
  productCijena?: number | null;
  korisnikIme?: string;
  racunBroj?: string | null;
  racunStatus?: string | null;
  ponudaBroj?: number | null;
  ponudaGodina?: number | null;
  stavke?: RadniNalogStavka[];
}

export interface NormativStavka {
  id: number;
  productId: number;
  materijalId: number;
  kolicina: number;
  napomena?: string | null;
  materijalNaziv?: string;
  materijalSifra?: string;
  materijalJm?: string;
}
