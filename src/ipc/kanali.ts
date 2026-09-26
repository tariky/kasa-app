// Ugovor IPC kanala kao tip: kanal → [argumenti, rezultat]. Po njemu su
// tipizirani `handle` (handlers.ts), `pozovi` u napraviApi (api.ts → window.api)
// i ugovorni `Backend.call` (src/ipc/ugovor). Rust backend prima iste kanale
// (src-tauri/backend/src/kanali.rs) — ugovorni testovi drže oba backenda istim.
//
// Argumenti su ono što šalje renderer; backend ih svejedno provjerava. U
// rezultatu je "nema vrijednosti" uvijek `null` (JSON nema `undefined`).
// korisnikId se nigdje ne šalje — backend ga uzima iz sesije.
//
// Samo tipovi: modul se ne učitava ni u rendereru ni u main procesu.

import type { BackupInfo } from '../lib/backupRaspored';
import type { LicencaInfo } from '../lib/licencaTipovi';
import type { KnjigovodjaPodaci } from '../lib/knjigovodja/tipovi';
import type { PrimkaUnos, SpremljenaPrimka } from '../lib/primka';
import type { UnosRacuna } from '../lib/provjeraRacuna';
import type { Uspjeh } from '../lib/fiskalizacija';
import type { NeuspjehStampe, VecEvidentiran } from '../lib/pendingRacun';
import type { finalizePrilogAndPrint, PrilogStavkaUnos, FinalizePrilogResult } from '../lib/prilog';
import type { PonudaInput, PonudaStatus, KonverzijaResult, updatePonuda } from '../lib/ponuda';
import type { RefundResult } from '../lib/refund';
import type { NalogInput, NalogStavkaInput, NalogProizvodInput, Kalkulacija, updateNalog } from '../lib/proizvodnja';
import type { AddCashResult, CashMovementRow, CashTip } from '../lib/cash';
import type { DrawerState } from '../lib/drawer';
import type { SavedCartRow } from '../lib/savedCarts';
import type { SavedCartItem } from '../lib/kosarica';
import type { SkicaFaktureRow } from '../lib/fakturaSkice';
import type { TringResponse, TringLogEntry } from '../services/tring';
import type {
  User, Product, DobavljacSifra, Dobavljac, Kupac, Primka, PregledCijenaUlaza, PromijenjenoOdPregleda,
  Nivelacija, Order, Ponuda, PrilogStavka, RadniNalog, NalogStatus, ProizvodPonude, NormativStavka,
  TringSettings, FirmaSettings,
} from '../types';

/** Payload bez korisnikId — backend ga dodaje iz sesije. */
type BezKorisnika<T> = Omit<T, 'korisnikId'>;

/** Broj dodijeljen dokumentu (ponuda, nalog). */
type BrojDokumenta = { id: number; broj: number; godina: number };

export interface NoviKorisnik { ime: string; pin: string; uloga: string }
/** Prazan PIN = PIN ostaje kakav je. */
export interface IzmjenaKorisnika { ime?: string; pin?: string | null; uloga?: string }

export interface NoviArtikal {
  sifra: string; naziv: string; jm?: string; cijena: number;
  pdvStopa: string; plu?: number; barkod?: string | null; tip?: string;
  plocaSirina?: number | null; plocaVisina?: number | null;
}

/** Prazno polje = null. */
export interface NoviDobavljac {
  naziv: string; idBroj?: string | null; pdvBroj?: string | null; adresa?: string | null; kontakt?: string | null;
}

/** Prazno polje = null; rok, način plaćanja i rabat null = globalna postavka. */
export interface NoviKupac {
  naziv: string; idBroj: string; pdvBroj?: string | null; adresa?: string | null;
  postanskiBroj?: string | null; grad?: string | null; kontakt?: string | null;
  rokPlacanjaDana?: number | null; nacinPlacanja?: string | null; rabat?: number | null;
}

/** Ručni račun (izdat mimo programa): stavke kao na kasi + broj i datum s papira. */
export type RucniRacun = UnosRacuna & { brojFiskalnogRacuna: string; createdAt: string };

/** order:refundAndPrint — adminPin: kasir uz uključen "PIN za reklamaciju" (provjera u sesiji, prije štampe). */
export interface ZahtjevStorna { id: number; brojReklamacije?: string; dozvoliPolog?: boolean; adminPin?: string }

/** Izvještaj po vrsti (report:getData). */
export interface IzvjestajPoVrsti { dnevni: Order[]; primke: Primka[] }

export interface TringVeza { host: string; port: number; operatorId: number; operatorPassword?: string | null }

export interface Kanali {
  // ─── Licenca i automatski backup ───
  'licenca:stanje': [[], LicencaInfo];
  'licenca:aktiviraj': [[token: string], LicencaInfo];
  'backup:info': [[], BackupInfo];
  'backup:sada': [[], BackupInfo];

  // ─── Sesija i korisnici ───
  /** Pogrešan PIN = null; `zadaniPin`: prijava PIN-om 0000. */
  'user:login': [[pin: string], (User & { zadaniPin: boolean }) | null];
  'user:logout': [[], { success: boolean }];
  'user:promijeniSvojPin': [[stari: string, novi: string], { success: boolean }];
  'user:getAll': [[], User[]];
  'user:create': [[data: NoviKorisnik], { id: number }];
  'user:update': [[id: number, data: IzmjenaKorisnika], { changes: number }];
  'user:delete': [[id: number], { changes: number }];

  // ─── Artikli i šifre dobavljača ───
  'product:getAll': [[tip?: string], Product[]];
  'product:get': [[id: number], Product | null];
  'product:create': [[data: NoviArtikal], { id: number }];
  'product:update': [[id: number, data: Partial<NoviArtikal>], { changes: number }];
  'product:delete': [[id: number], { changes: number }];
  'product:adjustStock': [[productId: number, newStanje: number], { changes: number }];
  'product:getDobavljacSifre': [[productId: number], DobavljacSifra[]];
  /** Zamjenjuje sve šifre dobavljača artikla; prazna šifra = vezan bez šifre. */
  'product:setDobavljacSifre': [[productId: number, lista: Array<{ dobavljacId: number; sifra?: string | null }>], { changes: number }];
  'product:findByDobavljacSifra': [[dobavljacId: number, sifra: string], Product | null];
  'dobavljac:getSifre': [[dobavljacId: number], Array<{ productId: number; sifra: string }>];
  /** Slobodna stavka s kase: skriveni artikal po nazivu, stopi i JM (red sa stanjem 0). */
  'product:slobodan': [[data: { naziv: string; cijena: number; pdvStopa: string; jm?: string }], Product];

  // ─── Dobavljači i kupci ───
  'dobavljac:getAll': [[], Dobavljac[]];
  'dobavljac:create': [[data: NoviDobavljac], { id: number }];
  'dobavljac:update': [[id: number, data: Partial<NoviDobavljac>], { changes: number }];
  'dobavljac:delete': [[id: number], { changes: number }];
  'kupac:getAll': [[], Kupac[]];
  'kupac:create': [[data: NoviKupac], { id: number }];
  'kupac:update': [[id: number, data: Partial<NoviKupac>], { changes: number }];
  'kupac:delete': [[id: number], { changes: number }];

  // ─── Primke i nivelacije ───
  'primka:getAll': [[], Primka[]];
  'primka:get': [[id: number], Primka];
  'primka:nextBroj': [[], string];
  /**
   * Spremanje/brisanje nosi pregled koji je korisnik potvrdio; ako se stanje
   * promijenilo od pregleda, ništa se ne upisuje i vraća se novi pregled.
   * Bez potvrde (stari klijent, skripta) sprema bez poređenja.
   */
  'primka:create': [[data: PrimkaUnos, potvrda?: PregledCijenaUlaza], SpremljenaPrimka | PromijenjenoOdPregleda];
  'primka:update': [[data: PrimkaUnos & { id: number }, potvrda?: PregledCijenaUlaza], SpremljenaPrimka | PromijenjenoOdPregleda];
  'primka:delete': [[id: number, potvrda?: PregledCijenaUlaza], PromijenjenoOdPregleda | null];
  /** Šta bi spremanje/brisanje uradilo s cijenama — ništa ne upisuje. */
  'primka:pregledUnosa': [[data: PrimkaUnos], PregledCijenaUlaza];
  'primka:pregledIzmjene': [[data: PrimkaUnos & { id: number }], PregledCijenaUlaza];
  'primka:pregledBrisanja': [[id: number], PregledCijenaUlaza];
  'nivelacija:getAll': [[from?: string, to?: string], Nivelacija[]];
  'nivelacija:get': [[id: number], Nivelacija];

  // ─── Računi ───
  'order:getAll': [[], Order[]];
  'order:get': [[id: number], Order];
  'order:createManual': [[unos: RucniRacun], { id: number }];
  'order:finalize': [[unos: UnosRacuna], Uspjeh<number> | NeuspjehStampe | VecEvidentiran];
  'order:finalizePrilog': [[unos: BezKorisnika<Parameters<typeof finalizePrilogAndPrint>[1]>], FinalizePrilogResult];
  'fiscal:getNumeracija': [[], { zadnjiUBazi: number | null; zadnjiUpisani: number | null; predvidjeni: number | null }];
  'fiscal:setZadnjiBroj': [[broj: number], { success: boolean; predvidjeni: number | null }];
  'prilog:getStavke': [[orderId: number], PrilogStavka[]];
  'prilog:saveStavke': [[orderId: number, stavke: PrilogStavkaUnos[]], { success: boolean }];
  'order:setDatumValute': [[id: number, datum: string | null], { datumValute: string | null }];
  'order:refundAndPrint': [[data: ZahtjevStorna], RefundResult];
  /** Write-ahead redovi koji čekaju dijalog nezavršenih; snapshot je JSON kako je upisan (lib/pendingRacun.ts). */
  'pending:list': [[], Array<{ id: number; korisnikId: number; createdAt: string; snapshot: unknown }>];
  'pending:resolve': [[data: { id: number; brojFiskalnogRacuna: string; createdAt: string }], { id: number }];
  'pending:discard': [[id: number], { success: boolean }];
  'order:getFiscalGaps': [[], number[]];
  'order:dismissFiscalGap': [[broj: number], { success: boolean }];

  // ─── Ponude ───
  'ponuda:getAll': [[], Ponuda[]];
  'ponuda:get': [[id: number], Ponuda];
  'ponuda:nextBroj': [[], { broj: number; godina: number }];
  'ponuda:create': [[unos: BezKorisnika<PonudaInput>], BrojDokumenta];
  'ponuda:update': [[id: number, data: Parameters<typeof updatePonuda>[2]], { success: boolean }];
  'ponuda:setStatus': [[id: number, status: PonudaStatus], { success: boolean }];
  'ponuda:delete': [[id: number], { changes: number }];
  'ponuda:konvertuj': [[unos: { id: number; nacinPlacanja: string }], KonverzijaResult];

  // ─── Proizvodnja ───
  'nalog:getAll': [[filter?: NalogStatus | 'aktivni'], RadniNalog[]];
  'nalog:get': [[id: number], RadniNalog];
  'nalog:nextBroj': [[], { broj: number; godina: number }];
  'nalog:create': [[unos: BezKorisnika<NalogInput>], BrojDokumenta];
  /** Izbor proizvoda ponude koje nalog izrađuje; bez niza važi zadani izbor. */
  'nalog:createIzPonude': [[ponudaId: number, proizvodi?: NalogProizvodInput[]], BrojDokumenta];
  'nalog:zaPonudu': [[ponudaId: number], BrojDokumenta | null];
  'nalog:proizvodiPonude': [[ponudaId: number], ProizvodPonude[]];
  'nalog:setProizvodi': [[id: number, proizvodi: NalogProizvodInput[]], { success: boolean }];
  'nalog:update': [[id: number, data: Parameters<typeof updateNalog>[2]], { success: boolean }];
  'nalog:replaceStavke': [[id: number, stavke: NalogStavkaInput[]], { success: boolean }];
  /** 'vrati' smije samo admin (sesija). */
  'nalog:setStatus': [[data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati' }], { success: boolean }];
  'nalog:delete': [[id: number], { success: boolean }];
  'nalog:kalkulacija': [[id: number], Kalkulacija];
  'nalog:izdajRacun': [[unos: { id: number; nacinPlacanja: string }], KonverzijaResult];
  'normativ:get': [[productId: number], NormativStavka[]];
  'normativ:save': [[productId: number, stavke: NalogStavkaInput[]], { success: boolean }];
  'proizvodnja:setEnabled': [[enabled: boolean], { success: boolean }];

  // ─── Postavke, košarice, skice ───
  /** Lozinka operatera ne izlazi iz backenda — samo `imaLozinku`. */
  'settings:getTring': [[], TringSettings];
  /** Prazna lozinka = stara ostaje. */
  'settings:saveTring': [[data: TringVeza], { success: boolean }];
  'settings:getFirma': [[], FirmaSettings];
  /** Tajne postavke se čitaju kao null. */
  'settings:get': [[key: string], string | null];
  'settings:set': [[key: string, value: string], { success: boolean }];
  'settings:saveFirma': [[data: FirmaSettings], { success: boolean }];
  'savedCarts:list': [[], SavedCartRow[]];
  /** Vraća id spremljene košarice. */
  'savedCarts:save': [[naziv: string, items: SavedCartItem[], ukupno: number], number];
  'savedCarts:delete': [[id: number], { success: boolean }];
  'fakturaSkice:list': [[], SkicaFaktureRow[]];
  /** Bez id-a (ili s id-em obrisane skice) sprema novu; vraća id skice. */
  'fakturaSkice:save': [[id: number | null, naziv: string, podaci: unknown, ukupno: number], number];
  'fakturaSkice:delete': [[id: number], { success: boolean }];

  // ─── Izvještaji i izvoz ───
  'report:getData': [[vrsta: keyof IzvjestajPoVrsti, od: string, doDatum: string], IzvjestajPoVrsti[keyof IzvjestajPoVrsti]];
  'izvoz:knjigovodja': [[od: string, doDatum: string], KnjigovodjaPodaci];

  // ─── Fiskalni uređaj i gotovina ───
  'tring:init': [[], TringResponse];
  'tring:xReport': [[], TringResponse];
  'tring:zReport': [[], TringResponse];
  'tring:periodicReport': [[od: string, doDatum: string], TringResponse];
  'tring:getLogs': [[], TringLogEntry[]];
  'tring:clearLogs': [[], { success: boolean }];
  'cash:add': [[data: { tip: CashTip; iznos: number; napomena?: string }], AddCashResult];
  'cash:retry': [[id: number], AddCashResult];
  'cash:getToday': [[], CashMovementRow[]];
  'cash:lastPolog': [[], number | null];
  'cash:drawerState': [[], DrawerState];

  // ─── Dijalozi, fajlovi, baza ───
  /** Otkazano ili odbijeno ime/ekstenzija = null; upisiva je samo putanja iz zadnjeg dijaloga. */
  'dialog:saveFile': [[data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }], string | null];
  'fs:writeFile': [[data: { path: string; buffer: number[] }], { success: boolean }];
  'db:backup': [[], string | null];
  'db:restore': [[], { source: string; safetyPath: string } | null];
}

export type Kanal = keyof Kanali;
export type Argumenti<K extends Kanal> = Kanali[K][0];
export type Rezultat<K extends Kanal> = Kanali[K][1];

/** Poziv kanala s argumentima i rezultatom iz ugovora. */
export type PozoviKanal = <K extends Kanal>(kanal: K, ...args: Argumenti<K>) => Promise<Rezultat<K>>;
