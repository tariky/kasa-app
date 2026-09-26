// Oblik `window.api`: metoda → IPC kanal. Dijele ga Electron preload
// (ipcRenderer.invoke) i Tauri (invoke('api')), pa renderer vidi isti API
// nad oba backenda. Kanali su ugovor — vidi src/ipc/ugovor.

import type { BackupDogadjaj, BackupInfo } from '../lib/backupRaspored';
import type { LicencaInfo } from '../lib/licencaTipovi';
import type { KnjigovodjaPodaci } from '../lib/knjigovodja/tipovi';
import type {
  User, DobavljacSifra, PregledCijenaUlaza, PromijenjenoOdPregleda, RadniNalog, ProizvodPonude,
  NormativStavka, TringSettings, FirmaSettings,
} from '../types';

/**
 * Prijenos poziva do backenda (Electron `ipcRenderer.invoke`, Tauri `invoke('api')`).
 * Odgovor je bez tipa — oblik mu daje `napraviApi` po kanalu.
 */
export type Pozovi = (kanal: string, ...args: unknown[]) => Promise<unknown>;
/** Pretplata na događaj backenda (Electron `ipcRenderer.on`, Tauri `listen`); vraća odjavu. */
export type NaDogadjaj = (ime: string, cb: (podaci: unknown) => void) => () => void;

/**
 * Electron `ipcRenderer.invoke` umota grešku handlera u
 * "Error invoking remote method '<kanal>': Error: <poruka>". Ostaje samo poruka
 * backenda — ista koju pod Tauri-jem daje Rust (vidi src/ipc/ugovor).
 */
export function ocistiPorukuIpc(poruka: string): string {
  return poruka.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
}

/** `pozovi` čije odbijanje nosi poruku bez Electron omota (preload). */
export function ocistiGreske(pozovi: Pozovi): Pozovi {
  return async (kanal, ...args) => {
    try {
      return await pozovi(kanal, ...args);
    } catch (e) {
      throw new Error(ocistiPorukuIpc(e instanceof Error ? e.message : String(e)));
    }
  };
}

export function napraviApi(prijenos: Pozovi, naDogadjaj: NaDogadjaj) {
  // Odgovor kanala ima oblik naveden uz metodu — jedino mjesto gdje se to pretpostavlja.
  const pozovi = prijenos as <R>(kanal: string, ...args: unknown[]) => Promise<R>;
  return {
    // Licenca
    getLicenca: () => pozovi<LicencaInfo>('licenca:stanje'),
    aktivirajLicencu: (token: string) => pozovi<LicencaInfo>('licenca:aktiviraj', token),
    onLicencaBlokirano: (cb: () => void) => naDogadjaj('licenca:blokirano', () => cb()),

    // Automatski backup
    getBackupInfo: () => pozovi<BackupInfo>('backup:info'),
    backupSada: () => pozovi<BackupInfo>('backup:sada'),
    onBackupStanje: (cb: (d: BackupDogadjaj) => void) =>
      naDogadjaj('backup:stanje', d => cb(d as BackupDogadjaj)),

    // Users — sesija živi u main procesu (vidi src/ipc/sesija.ts); korisnikId se
    // nigdje ne šalje, backend ga uzima iz sesije.
    login: (pin: string) => pozovi<(User & { zadaniPin: boolean }) | null>('user:login', pin),
    logout: () => pozovi<{ success: boolean }>('user:logout'),
    promijeniSvojPin: (stari: string, novi: string) => pozovi<{ success: boolean }>('user:promijeniSvojPin', stari, novi),
    getUsers: () => pozovi<User[]>('user:getAll'),
    createUser: (data: any) => pozovi<any>('user:create', data),
    updateUser: (id: number, data: any) => pozovi<any>('user:update', id, data),
    deleteUser: (id: number) => pozovi<any>('user:delete', id),

    // Products
    getProducts: (tip?: string) => pozovi<any[]>('product:getAll', tip),
    getProduct: (id: number) => pozovi<any>('product:get', id),
    createSlobodanProduct: (data: { naziv: string; cijena: number; pdvStopa: string; jm?: string }) => pozovi<any>('product:slobodan', data),
    createProduct: (data: any) => pozovi<any>('product:create', data),
    updateProduct: (id: number, data: any) => pozovi<any>('product:update', id, data),
    deleteProduct: (id: number) => pozovi<any>('product:delete', id),
    adjustStock: (productId: number, newStanje: number) => pozovi<any>('product:adjustStock', productId, newStanje),
    getDobavljacSifre: (productId: number) => pozovi<DobavljacSifra[]>('product:getDobavljacSifre', productId),
    setDobavljacSifre: (productId: number, lista: { dobavljacId: number; sifra: string | null }[]) =>
      pozovi<{ changes: number }>('product:setDobavljacSifre', productId, lista),
    findByDobavljacSifra: (dobavljacId: number, sifra: string) => pozovi<any | null>('product:findByDobavljacSifra', dobavljacId, sifra),

    // Dobavljači
    getDobavljaci: () => pozovi<any[]>('dobavljac:getAll'),
    createDobavljac: (data: any) => pozovi<any>('dobavljac:create', data),
    updateDobavljac: (id: number, data: any) => pozovi<any>('dobavljac:update', id, data),
    deleteDobavljac: (id: number) => pozovi<any>('dobavljac:delete', id),
    getSifreDobavljaca: (dobavljacId: number) => pozovi<{ productId: number; sifra: string }[]>('dobavljac:getSifre', dobavljacId),

    // Kupci
    getKupci: () => pozovi<any[]>('kupac:getAll'),
    createKupac: (data: any) => pozovi<any>('kupac:create', data),
    updateKupac: (id: number, data: any) => pozovi<any>('kupac:update', id, data),
    deleteKupac: (id: number) => pozovi<any>('kupac:delete', id),

    // Primke
    getPrimke: () => pozovi<any[]>('primka:getAll'),
    getPrimka: (id: number) => pozovi<any>('primka:get', id),
    // Spremanje/brisanje nosi pregled koji je korisnik potvrdio (vidi primka:create u handlers.ts).
    /** Uz potvrđeni pregled; ako se stanje promijenilo od pregleda, ništa se ne upisuje i vraća se novi pregled. */
    createPrimka: (data: any, potvrda: PregledCijenaUlaza) =>
      pozovi<{ id: number; nivelacijaCreated: boolean } | PromijenjenoOdPregleda>('primka:create', data, potvrda),
    getNextBrojUlaza: () => pozovi<string>('primka:nextBroj'),
    updatePrimka: (data: any, potvrda: PregledCijenaUlaza) =>
      pozovi<{ id: number; nivelacijaCreated: boolean } | PromijenjenoOdPregleda>('primka:update', data, potvrda),
    deletePrimka: (id: number, potvrda: PregledCijenaUlaza) => pozovi<null | PromijenjenoOdPregleda>('primka:delete', id, potvrda),
    // Šta bi spremanje/brisanje uradilo s cijenama — ništa ne upisuje.
    pregledUnosaPrimke: (data: any) => pozovi<PregledCijenaUlaza>('primka:pregledUnosa', data),
    pregledIzmjenePrimke: (data: any) => pozovi<PregledCijenaUlaza>('primka:pregledIzmjene', data),
    pregledBrisanjaPrimke: (id: number) => pozovi<PregledCijenaUlaza>('primka:pregledBrisanja', id),

    // Nivelacije
    getNivelacije: (from?: string, to?: string) => pozovi<any[]>('nivelacija:getAll', from, to),
    getNivelacija: (id: number) => pozovi<any>('nivelacija:get', id),

    // Orders
    getOrders: () => pozovi<any[]>('order:getAll'),
    getOrder: (id: number) => pozovi<any>('order:get', id),
    createManualOrder: (data: any) => pozovi<{ id: number }>('order:createManual', data),
    setOrderDatumValute: (id: number, datum: string | null) => pozovi<{ datumValute: string | null }>('order:setDatumValute', id, datum),
    // adminPin: kasir uz uključen "PIN za reklamaciju" (provjera u main procesu, prije štampe).
    refundAndPrintOrder: (data: { id: number; brojReklamacije?: string; dozvoliPolog?: boolean; adminPin?: string }) =>
      pozovi<{
        success: boolean; brojReklamacije?: string | null; error?: string; odgovori?: Record<string, string>;
        nedovoljnoSredstava?: boolean; manjak?: number; pologIznos?: number;
        /** Uređaj nije potvrdio storno — riješava se u dijalogu nezavršenih računa. */
        ishodNepoznat?: boolean;
        /** Storno odštampan, ali već upisan iz dijaloga nezavršenih računa. */
        vecEvidentiran?: boolean;
      }>('order:refundAndPrint', data),
    finalizeOrder: (data: any) => pozovi<{
      success: boolean; id?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string>;
      /** Uređaj nije potvrdio račun — možda je odštampan; riješava se u dijalogu nezavršenih računa. */
      ishodNepoznat?: boolean;
      /** Odštampan, ali već upisan iz dijaloga nezavršenih računa — završen, bez novog id-a. */
      vecEvidentiran?: boolean;
    }>('order:finalize', data),
    finalizePrilogOrder: (data: {
      iznos?: number; nacinPlacanja: string; kupac?: any;
      stavke?: Array<{ productId: number; kolicina: number; cijena: number; rabat?: number; pdvStopa: string }>;
      prilogOpis?: string; prilogVeza?: string;
      datumValute?: string | null; napomena?: string | null; ponudaId?: number | null;
      /** Skica iz koje je faktura nastala — backend je briše kad račun postoji u bazi. */
      skicaId?: number | null;
    }) => pozovi<{
      success: boolean; id?: number; prilogBroj?: number; brojFiskalnogRacuna?: string | null;
      upozorenje?: string; error?: string; odgovori?: Record<string, string>; ishodNepoznat?: boolean;
      vecEvidentiran?: boolean;
    }>('order:finalizePrilog', data),
    getFiskalnaNumeracija: () => pozovi<{
      zadnjiUBazi: number | null; zadnjiUpisani: number | null; predvidjeni: number | null;
    }>('fiscal:getNumeracija'),
    setZadnjiFiskalniBroj: (broj: number) => pozovi<{ success: boolean; predvidjeni: number | null }>('fiscal:setZadnjiBroj', broj),
    getPrilogStavke: (orderId: number) => pozovi<any[]>('prilog:getStavke', orderId),
    savePrilogStavke: (orderId: number, stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat?: number; pdvStopa: string }>) => pozovi<{ success: boolean }>('prilog:saveStavke', orderId, stavke),
    listPending: () => pozovi<Array<{ id: number; korisnikId: number; createdAt: string; snapshot: any }>>('pending:list'),
    resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => pozovi<{ id: number }>('pending:resolve', data),
    discardPending: (id: number) => pozovi<{ success: boolean }>('pending:discard', id),
    getFiscalGaps: () => pozovi<number[]>('order:getFiscalGaps'),
    dismissFiscalGap: (broj: number) => pozovi<{ success: boolean }>('order:dismissFiscalGap', broj),

    // Ponude
    getPonude: () => pozovi<any[]>('ponuda:getAll'),
    getPonuda: (id: number) => pozovi<any>('ponuda:get', id),
    getNextBrojPonude: () => pozovi<{ broj: number; godina: number }>('ponuda:nextBroj'),
    createPonuda: (data: any) => pozovi<{ id: number; broj: number; godina: number }>('ponuda:create', data),
    updatePonuda: (id: number, data: any) => pozovi<{ success: boolean }>('ponuda:update', id, data),
    setPonudaStatus: (id: number, status: string) => pozovi<{ success: boolean }>('ponuda:setStatus', id, status),
    deletePonuda: (id: number) => pozovi<{ changes: number }>('ponuda:delete', id),
    konvertujPonudu: (data: { id: number; nacinPlacanja: string }) => pozovi<{
      success: boolean; racunId?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string>;
      ishodNepoznat?: boolean; vecEvidentiran?: boolean;
    }>('ponuda:konvertuj', data),

    // Proizvodnja
    getNalozi: (filter?: string) => pozovi<RadniNalog[]>('nalog:getAll', filter),
    getNalog: (id: number) => pozovi<RadniNalog>('nalog:get', id),
    getNextBrojNaloga: () => pozovi<{ broj: number; godina: number }>('nalog:nextBroj'),
    createNalog: (data: any) => pozovi<{ id: number; broj: number; godina: number }>('nalog:create', data),
    createNalogIzPonude: (ponudaId: number, proizvodi?: Array<{ productId: number; kolicina: number }>) =>
      pozovi<{ id: number; broj: number; godina: number }>('nalog:createIzPonude', ponudaId, proizvodi),
    getNalogZaPonudu: (ponudaId: number) => pozovi<{ id: number; broj: number; godina: number } | null>('nalog:zaPonudu', ponudaId),
    getProizvodiPonude: (ponudaId: number) => pozovi<ProizvodPonude[]>('nalog:proizvodiPonude', ponudaId),
    setNalogProizvodi: (id: number, proizvodi: Array<{ productId: number; kolicina: number }>) =>
      pozovi<{ success: boolean }>('nalog:setProizvodi', id, proizvodi),
    updateNalog: (id: number, data: any) => pozovi<{ success: boolean }>('nalog:update', id, data),
    saveNalogStavke: (id: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => pozovi<{ success: boolean }>('nalog:replaceStavke', id, stavke),
    setNalogStatus: (data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati' }) => pozovi<{ success: boolean }>('nalog:setStatus', data),
    deleteNalog: (id: number) => pozovi<{ success: boolean }>('nalog:delete', id),
    getNalogKalkulacija: (id: number) => pozovi<any>('nalog:kalkulacija', id),
    izdajRacunZaNalog: (data: { id: number; nacinPlacanja: string }) => pozovi<any>('nalog:izdajRacun', data),
    getNormativ: (productId: number) => pozovi<NormativStavka[]>('normativ:get', productId),
    saveNormativ: (productId: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => pozovi<{ success: boolean }>('normativ:save', productId, stavke),
    setProizvodnjaEnabled: (enabled: boolean) => pozovi<{ success: boolean }>('proizvodnja:setEnabled', enabled),

    // Tring
    tringInit: () => pozovi<any>('tring:init'),
    tringXReport: () => pozovi<any>('tring:xReport'),
    tringZReport: () => pozovi<any>('tring:zReport'),
    tringPeriodicReport: (from: string, to: string) => pozovi<any>('tring:periodicReport', from, to),
    tringGetLogs: () => pozovi<any[]>('tring:getLogs'),
    tringClearLogs: () => pozovi<any>('tring:clearLogs'),

    // Polog / povrat gotovine
    addCashMovement: (data: { tip: 'polog' | 'povrat'; iznos: number; napomena?: string }) =>
      pozovi<{ id: number; tringStatus: 'ok' | 'error' | 'skipped'; error?: string }>('cash:add', data),
    retryCashMovement: (id: number) => pozovi<{ id: number; tringStatus: 'ok' | 'error' | 'skipped'; error?: string }>('cash:retry', id),
    getTodayCashMovements: () => pozovi<Array<{
      id: number; tip: 'polog' | 'povrat'; iznos: number; korisnikId: number; korisnikIme: string;
      tringStatus: 'ok' | 'error' | 'skipped'; napomena: string | null; createdAt: string;
    }>>('cash:getToday'),
    getLastPolog: () => pozovi<number | null>('cash:lastPolog'),
    getDrawerState: () => pozovi<{
      polozi: number; gotovinskiPromet: number; povrati: number;
      gotovinskeReklamacije: number; ocekivanoStanje: number;
    }>('cash:drawerState'),

    // Spremljene košarice
    listSavedCarts: () => pozovi<Array<{ id: number; naziv: string; items: string; ukupno: number; createdAt: string }>>('savedCarts:list'),
    saveCart: (naziv: string, items: Array<{ productId: number; kolicina: number; rabat: number }>, ukupno: number) =>
      pozovi<number>('savedCarts:save', naziv, items, ukupno),
    deleteSavedCart: (id: number) => pozovi<any>('savedCarts:delete', id),
    listSkiceFaktura: () => pozovi<Array<{ id: number; naziv: string; podaci: string; ukupno: number; spremljeno: string }>>('fakturaSkice:list'),
    /** Bez id-a (ili s id-em obrisane skice) sprema novu; vraća id skice. */
    spremiSkicuFakture: (id: number | null, naziv: string, podaci: unknown, ukupno: number) =>
      pozovi<number>('fakturaSkice:save', id, naziv, podaci, ukupno),
    obrisiSkicuFakture: (id: number) => pozovi<any>('fakturaSkice:delete', id),

    // Settings
    getSetting: (key: string) => pozovi<string | null>('settings:get', key),
    setSetting: (key: string, value: string) => pozovi<any>('settings:set', key, value),
    getTringSettings: () => pozovi<TringSettings>('settings:getTring'),
    saveTringSettings: (data: any) => pozovi<any>('settings:saveTring', data),
    getFirmaSettings: () => pozovi<FirmaSettings>('settings:getFirma'),
    saveFirmaSettings: (data: FirmaSettings) => pozovi<{ success: boolean }>('settings:saveFirma', data),

    // Dialog / File System
    showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) =>
      pozovi<string | null>('dialog:saveFile', data),
    writeFile: (path: string, buffer: ArrayLike<number>) => pozovi<any>('fs:writeFile', { path, buffer: Array.from(buffer) }),

    // Reports
    getReportData: (type: string, from: string, to: string) => pozovi<any[]>('report:getData', type, from, to),
    izvozKnjigovodja: (od: string, doDatum: string) => pozovi<KnjigovodjaPodaci>('izvoz:knjigovodja', od, doDatum),

    // Database
    backupDatabase: () => pozovi<string | null>('db:backup'),
    restoreDatabase: () => pozovi<{ source: string; safetyPath: string } | null>('db:restore'),
  };
}

/** `window.api` — isti oblik pod Electronom i Tauri-jem. */
export type Api = ReturnType<typeof napraviApi>;
