// Oblik `window.api`: metoda → IPC kanal. Dijele ga Electron preload
// (ipcRenderer.invoke) i Tauri (invoke('api')), pa renderer vidi isti API
// nad oba backenda. Argumenti i rezultati kanala su ugovor `Kanali`
// (kanali.ts); ponašanje drže testovi u src/ipc/ugovor.

import type { BackupDogadjaj } from '../lib/backupRaspored';
import type { PregledCijenaUlaza } from '../types';
import type { Argumenti, IzvjestajPoVrsti, Kanal, PozoviKanal } from './kanali';

/**
 * Prijenos poziva do backenda (Electron `ipcRenderer.invoke`, Tauri `invoke('api')`).
 * Odgovor je bez tipa — oblik mu daje ugovor `Kanali` u napraviApi.
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

/** `pozovi` čije odbijanje nosi poruku bez Electron omota (preload); izvorno odbijanje je `cause`. */
export function ocistiGreske(pozovi: Pozovi): Pozovi {
  return async (kanal, ...args) => {
    try {
      return await pozovi(kanal, ...args);
    } catch (e) {
      throw new Error(ocistiPorukuIpc(e instanceof Error ? e.message : String(e)), { cause: e });
    }
  };
}

/** Argument kanala `K` na mjestu `i` (za objekte; jednostavni tipovi su napisani uz metodu). */
type Arg<K extends Kanal, I extends number = 0> = Argumenti<K>[I];

export function napraviApi(prijenos: Pozovi, naDogadjaj: NaDogadjaj) {
  // Backend odgovara oblikom iz ugovora (Kanali) — jedino mjesto gdje se to pretpostavlja.
  const pozovi = prijenos as PozoviKanal;
  return {
    // Licenca
    getLicenca: () => pozovi('licenca:stanje'),
    aktivirajLicencu: (token: string) => pozovi('licenca:aktiviraj', token),
    onLicencaBlokirano: (cb: () => void) => naDogadjaj('licenca:blokirano', () => cb()),

    // Automatski backup
    getBackupInfo: () => pozovi('backup:info'),
    backupSada: () => pozovi('backup:sada'),
    onBackupStanje: (cb: (d: BackupDogadjaj) => void) =>
      naDogadjaj('backup:stanje', d => cb(d as BackupDogadjaj)),

    // Users — sesija živi u main procesu (vidi src/ipc/sesija.ts); korisnikId se
    // nigdje ne šalje, backend ga uzima iz sesije.
    login: (pin: string) => pozovi('user:login', pin),
    logout: () => pozovi('user:logout'),
    promijeniSvojPin: (stari: string, novi: string) => pozovi('user:promijeniSvojPin', stari, novi),
    getUsers: () => pozovi('user:getAll'),
    createUser: (data: Arg<'user:create'>) => pozovi('user:create', data),
    updateUser: (id: number, data: Arg<'user:update', 1>) => pozovi('user:update', id, data),
    deleteUser: (id: number) => pozovi('user:delete', id),

    // Products
    getProducts: (tip?: string) => pozovi('product:getAll', tip),
    getProduct: (id: number) => pozovi('product:get', id),
    createSlobodanProduct: (data: Arg<'product:slobodan'>) => pozovi('product:slobodan', data),
    createProduct: (data: Arg<'product:create'>) => pozovi('product:create', data),
    updateProduct: (id: number, data: Arg<'product:update', 1>) => pozovi('product:update', id, data),
    deleteProduct: (id: number) => pozovi('product:delete', id),
    adjustStock: (productId: number, newStanje: number) => pozovi('product:adjustStock', productId, newStanje),
    getDobavljacSifre: (productId: number) => pozovi('product:getDobavljacSifre', productId),
    setDobavljacSifre: (productId: number, lista: Arg<'product:setDobavljacSifre', 1>) =>
      pozovi('product:setDobavljacSifre', productId, lista),
    findByDobavljacSifra: (dobavljacId: number, sifra: string) => pozovi('product:findByDobavljacSifra', dobavljacId, sifra),

    // Dobavljači
    getDobavljaci: () => pozovi('dobavljac:getAll'),
    createDobavljac: (data: Arg<'dobavljac:create'>) => pozovi('dobavljac:create', data),
    updateDobavljac: (id: number, data: Arg<'dobavljac:update', 1>) => pozovi('dobavljac:update', id, data),
    deleteDobavljac: (id: number) => pozovi('dobavljac:delete', id),
    getSifreDobavljaca: (dobavljacId: number) => pozovi('dobavljac:getSifre', dobavljacId),

    // Kupci
    getKupci: () => pozovi('kupac:getAll'),
    createKupac: (data: Arg<'kupac:create'>) => pozovi('kupac:create', data),
    updateKupac: (id: number, data: Arg<'kupac:update', 1>) => pozovi('kupac:update', id, data),
    deleteKupac: (id: number) => pozovi('kupac:delete', id),

    // Primke
    getPrimke: () => pozovi('primka:getAll'),
    getPrimka: (id: number) => pozovi('primka:get', id),
    // Spremanje/brisanje nosi pregled koji je korisnik potvrdio (vidi primka:create u handlers.ts);
    // ako se stanje promijenilo od pregleda, ništa se ne upisuje i vraća se novi pregled.
    createPrimka: (data: Arg<'primka:create'>, potvrda: PregledCijenaUlaza) => pozovi('primka:create', data, potvrda),
    getNextBrojUlaza: () => pozovi('primka:nextBroj'),
    updatePrimka: (data: Arg<'primka:update'>, potvrda: PregledCijenaUlaza) => pozovi('primka:update', data, potvrda),
    deletePrimka: (id: number, potvrda: PregledCijenaUlaza) => pozovi('primka:delete', id, potvrda),
    // Šta bi spremanje/brisanje uradilo s cijenama — ništa ne upisuje.
    pregledUnosaPrimke: (data: Arg<'primka:pregledUnosa'>) => pozovi('primka:pregledUnosa', data),
    pregledIzmjenePrimke: (data: Arg<'primka:pregledIzmjene'>) => pozovi('primka:pregledIzmjene', data),
    pregledBrisanjaPrimke: (id: number) => pozovi('primka:pregledBrisanja', id),

    // Nivelacije
    getNivelacije: (from?: string, to?: string) => pozovi('nivelacija:getAll', from, to),
    getNivelacija: (id: number) => pozovi('nivelacija:get', id),

    // Orders
    getOrders: () => pozovi('order:getAll'),
    getOrder: (id: number) => pozovi('order:get', id),
    createManualOrder: (data: Arg<'order:createManual'>) => pozovi('order:createManual', data),
    setOrderDatumValute: (id: number, datum: string | null) => pozovi('order:setDatumValute', id, datum),
    // adminPin: kasir uz uključen "PIN za reklamaciju" (provjera u main procesu, prije štampe).
    refundAndPrintOrder: (data: Arg<'order:refundAndPrint'>) => pozovi('order:refundAndPrint', data),
    finalizeOrder: (data: Arg<'order:finalize'>) => pozovi('order:finalize', data),
    finalizePrilogOrder: (data: Arg<'order:finalizePrilog'>) => pozovi('order:finalizePrilog', data),
    getFiskalnaNumeracija: () => pozovi('fiscal:getNumeracija'),
    setZadnjiFiskalniBroj: (broj: number) => pozovi('fiscal:setZadnjiBroj', broj),
    getPrilogStavke: (orderId: number) => pozovi('prilog:getStavke', orderId),
    savePrilogStavke: (orderId: number, stavke: Arg<'prilog:saveStavke', 1>) => pozovi('prilog:saveStavke', orderId, stavke),
    listPending: () => pozovi('pending:list'),
    resolvePending: (data: Arg<'pending:resolve'>) => pozovi('pending:resolve', data),
    discardPending: (id: number) => pozovi('pending:discard', id),
    getFiscalGaps: () => pozovi('order:getFiscalGaps'),
    dismissFiscalGap: (broj: number) => pozovi('order:dismissFiscalGap', broj),

    // Ponude
    getPonude: () => pozovi('ponuda:getAll'),
    getPonuda: (id: number) => pozovi('ponuda:get', id),
    getNextBrojPonude: () => pozovi('ponuda:nextBroj'),
    createPonuda: (data: Arg<'ponuda:create'>) => pozovi('ponuda:create', data),
    updatePonuda: (id: number, data: Arg<'ponuda:update', 1>) => pozovi('ponuda:update', id, data),
    setPonudaStatus: (id: number, status: Arg<'ponuda:setStatus', 1>) => pozovi('ponuda:setStatus', id, status),
    deletePonuda: (id: number) => pozovi('ponuda:delete', id),
    konvertujPonudu: (data: Arg<'ponuda:konvertuj'>) => pozovi('ponuda:konvertuj', data),

    // Proizvodnja
    getNalozi: (filter?: Arg<'nalog:getAll'>) => pozovi('nalog:getAll', filter),
    getNalog: (id: number) => pozovi('nalog:get', id),
    getNextBrojNaloga: () => pozovi('nalog:nextBroj'),
    createNalog: (data: Arg<'nalog:create'>) => pozovi('nalog:create', data),
    createNalogIzPonude: (ponudaId: number, proizvodi?: Arg<'nalog:createIzPonude', 1>) =>
      pozovi('nalog:createIzPonude', ponudaId, proizvodi),
    getNalogZaPonudu: (ponudaId: number) => pozovi('nalog:zaPonudu', ponudaId),
    getProizvodiPonude: (ponudaId: number) => pozovi('nalog:proizvodiPonude', ponudaId),
    setNalogProizvodi: (id: number, proizvodi: Arg<'nalog:setProizvodi', 1>) => pozovi('nalog:setProizvodi', id, proizvodi),
    updateNalog: (id: number, data: Arg<'nalog:update', 1>) => pozovi('nalog:update', id, data),
    saveNalogStavke: (id: number, stavke: Arg<'nalog:replaceStavke', 1>) => pozovi('nalog:replaceStavke', id, stavke),
    setNalogStatus: (data: Arg<'nalog:setStatus'>) => pozovi('nalog:setStatus', data),
    deleteNalog: (id: number) => pozovi('nalog:delete', id),
    getNalogKalkulacija: (id: number) => pozovi('nalog:kalkulacija', id),
    izdajRacunZaNalog: (data: Arg<'nalog:izdajRacun'>) => pozovi('nalog:izdajRacun', data),
    getNormativ: (productId: number) => pozovi('normativ:get', productId),
    saveNormativ: (productId: number, stavke: Arg<'normativ:save', 1>) => pozovi('normativ:save', productId, stavke),
    setProizvodnjaEnabled: (enabled: boolean) => pozovi('proizvodnja:setEnabled', enabled),

    // Tring
    tringInit: () => pozovi('tring:init'),
    tringXReport: () => pozovi('tring:xReport'),
    tringZReport: () => pozovi('tring:zReport'),
    tringPeriodicReport: (from: string, to: string) => pozovi('tring:periodicReport', from, to),
    tringGetLogs: () => pozovi('tring:getLogs'),
    tringClearLogs: () => pozovi('tring:clearLogs'),

    // Polog / povrat gotovine
    addCashMovement: (data: Arg<'cash:add'>) => pozovi('cash:add', data),
    retryCashMovement: (id: number) => pozovi('cash:retry', id),
    getTodayCashMovements: () => pozovi('cash:getToday'),
    getLastPolog: () => pozovi('cash:lastPolog'),
    getDrawerState: () => pozovi('cash:drawerState'),

    // Spremljene košarice
    listSavedCarts: () => pozovi('savedCarts:list'),
    saveCart: (naziv: string, items: Arg<'savedCarts:save', 1>, ukupno: number) => pozovi('savedCarts:save', naziv, items, ukupno),
    deleteSavedCart: (id: number) => pozovi('savedCarts:delete', id),
    listSkiceFaktura: () => pozovi('fakturaSkice:list'),
    /** Bez id-a (ili s id-em obrisane skice) sprema novu; vraća id skice. */
    spremiSkicuFakture: (id: number | null, naziv: string, podaci: unknown, ukupno: number) =>
      pozovi('fakturaSkice:save', id, naziv, podaci, ukupno),
    obrisiSkicuFakture: (id: number) => pozovi('fakturaSkice:delete', id),

    // Settings
    getSetting: (key: string) => pozovi('settings:get', key),
    setSetting: (key: string, value: string) => pozovi('settings:set', key, value),
    getTringSettings: () => pozovi('settings:getTring'),
    saveTringSettings: (data: Arg<'settings:saveTring'>) => pozovi('settings:saveTring', data),
    getFirmaSettings: () => pozovi('settings:getFirma'),
    saveFirmaSettings: (data: Arg<'settings:saveFirma'>) => pozovi('settings:saveFirma', data),

    // Dialog / File System
    showSaveDialog: (data: Arg<'dialog:saveFile'>) => pozovi('dialog:saveFile', data),
    writeFile: (path: string, buffer: ArrayLike<number>) => pozovi('fs:writeFile', { path, buffer: Array.from(buffer) }),

    // Reports — rezultat po vrsti izvještaja
    getReportData: <V extends keyof IzvjestajPoVrsti>(type: V, from: string, to: string) =>
      pozovi('report:getData', type, from, to) as Promise<IzvjestajPoVrsti[V]>,
    izvozKnjigovodja: (od: string, doDatum: string) => pozovi('izvoz:knjigovodja', od, doDatum),

    // Database
    backupDatabase: () => pozovi('db:backup'),
    restoreDatabase: () => pozovi('db:restore'),
  };
}

/** `window.api` — isti oblik pod Electronom i Tauri-jem. */
export type Api = ReturnType<typeof napraviApi>;
