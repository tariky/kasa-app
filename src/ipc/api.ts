// Oblik `window.api`: metoda → IPC kanal. Dijele ga Electron preload
// (ipcRenderer.invoke) i Tauri (invoke('api')), pa renderer vidi isti API
// nad oba backenda. Kanali su ugovor — vidi src/ipc/ugovor.

import type { BackupDogadjaj } from '../lib/backupRaspored';

export type Pozovi = (kanal: string, ...args: unknown[]) => Promise<any>;
/** Pretplata na događaj backenda (Electron `ipcRenderer.on`, Tauri `listen`); vraća odjavu. */
export type NaDogadjaj = (ime: string, cb: (podaci: unknown) => void) => () => void;

export function napraviApi(pozovi: Pozovi, naDogadjaj: NaDogadjaj) {
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
    createUser: (data: any) => pozovi('user:create', data),
    updateUser: (id: number, data: any) => pozovi('user:update', id, data),
    deleteUser: (id: number) => pozovi('user:delete', id),

    // Products
    getProducts: (tip?: string) => pozovi('product:getAll', tip),
    getProduct: (id: number) => pozovi('product:get', id),
    createSlobodanProduct: (data: { naziv: string; cijena: number; pdvStopa: string; jm?: string }) => pozovi('product:slobodan', data),
    createProduct: (data: any) => pozovi('product:create', data),
    updateProduct: (id: number, data: any) => pozovi('product:update', id, data),
    deleteProduct: (id: number) => pozovi('product:delete', id),
    searchProducts: (query: string) => pozovi('product:search', query),
    adjustStock: (productId: number, newStanje: number) => pozovi('product:adjustStock', productId, newStanje),
    getDobavljacSifre: (productId: number) => pozovi('product:getDobavljacSifre', productId),
    setDobavljacSifre: (productId: number, lista: { dobavljacId: number; sifra: string | null }[]) =>
      pozovi('product:setDobavljacSifre', productId, lista),
    findByDobavljacSifra: (dobavljacId: number, sifra: string) => pozovi('product:findByDobavljacSifra', dobavljacId, sifra),

    // Dobavljači
    getDobavljaci: () => pozovi('dobavljac:getAll'),
    createDobavljac: (data: any) => pozovi('dobavljac:create', data),
    updateDobavljac: (id: number, data: any) => pozovi('dobavljac:update', id, data),
    deleteDobavljac: (id: number) => pozovi('dobavljac:delete', id),
    getSifreDobavljaca: (dobavljacId: number) => pozovi('dobavljac:getSifre', dobavljacId),

    // Kupci
    getKupci: () => pozovi('kupac:getAll'),
    searchKupci: (query: string) => pozovi('kupac:search', query),
    createKupac: (data: any) => pozovi('kupac:create', data),
    updateKupac: (id: number, data: any) => pozovi('kupac:update', id, data),
    deleteKupac: (id: number) => pozovi('kupac:delete', id),

    // Primke
    getPrimke: () => pozovi('primka:getAll'),
    getPrimka: (id: number) => pozovi('primka:get', id),
    // Spremanje/brisanje nosi pregled koji je korisnik potvrdio (vidi primka:create u handlers.ts).
    createPrimka: (data: any, potvrda: unknown) => pozovi('primka:create', data, potvrda),
    getNextBrojUlaza: () => pozovi('primka:nextBroj'),
    updatePrimka: (data: any, potvrda: unknown) => pozovi('primka:update', data, potvrda),
    deletePrimka: (id: number, potvrda: unknown) => pozovi('primka:delete', id, potvrda),
    // Šta bi spremanje/brisanje uradilo s cijenama — ništa ne upisuje.
    pregledUnosaPrimke: (data: any) => pozovi('primka:pregledUnosa', data),
    pregledIzmjenePrimke: (data: any) => pozovi('primka:pregledIzmjene', data),
    pregledBrisanjaPrimke: (id: number) => pozovi('primka:pregledBrisanja', id),

    // Nivelacije
    getNivelacije: (from?: string, to?: string) => pozovi('nivelacija:getAll', from, to),
    getNivelacija: (id: number) => pozovi('nivelacija:get', id),

    // Orders
    getOrders: () => pozovi('order:getAll'),
    getOrder: (id: number) => pozovi('order:get', id),
    createManualOrder: (data: any) => pozovi('order:createManual', data),
    setOrderDatumValute: (id: number, datum: string | null) => pozovi('order:setDatumValute', id, datum),
    // adminPin: kasir uz uključen "PIN za reklamaciju" (provjera u main procesu, prije štampe).
    refundAndPrintOrder: (data: { id: number; brojReklamacije?: string; dozvoliPolog?: boolean; adminPin?: string }) => pozovi('order:refundAndPrint', data),
    finalizeOrder: (data: any) => pozovi('order:finalize', data),
    finalizePrilogOrder: (data: any) => pozovi('order:finalizePrilog', data),
    getFiskalnaNumeracija: () => pozovi('fiscal:getNumeracija'),
    setZadnjiFiskalniBroj: (broj: number) => pozovi('fiscal:setZadnjiBroj', broj),
    getPrilogStavke: (orderId: number) => pozovi('prilog:getStavke', orderId),
    savePrilogStavke: (orderId: number, stavke: any[]) => pozovi('prilog:saveStavke', orderId, stavke),
    listPending: () => pozovi('pending:list'),
    resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => pozovi('pending:resolve', data),
    discardPending: (id: number) => pozovi('pending:discard', id),
    getFiscalGaps: () => pozovi('order:getFiscalGaps'),
    dismissFiscalGap: (broj: number) => pozovi('order:dismissFiscalGap', broj),

    // Ponude
    getPonude: () => pozovi('ponuda:getAll'),
    getPonuda: (id: number) => pozovi('ponuda:get', id),
    getNextBrojPonude: () => pozovi('ponuda:nextBroj'),
    createPonuda: (data: any) => pozovi('ponuda:create', data),
    updatePonuda: (id: number, data: any) => pozovi('ponuda:update', id, data),
    setPonudaStatus: (id: number, status: string) => pozovi('ponuda:setStatus', id, status),
    deletePonuda: (id: number) => pozovi('ponuda:delete', id),
    konvertujPonudu: (data: { id: number; nacinPlacanja: string }) => pozovi('ponuda:konvertuj', data),

    // Proizvodnja
    getNalozi: (filter?: string) => pozovi('nalog:getAll', filter),
    getNalog: (id: number) => pozovi('nalog:get', id),
    getNextBrojNaloga: () => pozovi('nalog:nextBroj'),
    createNalog: (data: any) => pozovi('nalog:create', data),
    createNalogIzPonude: (ponudaId: number) => pozovi('nalog:createIzPonude', ponudaId),
    getNalogZaPonudu: (ponudaId: number) => pozovi('nalog:zaPonudu', ponudaId),
    updateNalog: (id: number, data: any) => pozovi('nalog:update', id, data),
    saveNalogStavke: (id: number, stavke: any[]) => pozovi('nalog:replaceStavke', id, stavke),
    setNalogStatus: (data: { id: number; status: string }) => pozovi('nalog:setStatus', data),
    deleteNalog: (id: number) => pozovi('nalog:delete', id),
    getNalogKalkulacija: (id: number) => pozovi('nalog:kalkulacija', id),
    izdajRacunZaNalog: (data: { id: number; nacinPlacanja: string }) => pozovi('nalog:izdajRacun', data),
    getNormativ: (productId: number) => pozovi('normativ:get', productId),
    saveNormativ: (productId: number, stavke: any[]) => pozovi('normativ:save', productId, stavke),
    searchMaterijal: (query: string) => pozovi('materijal:search', query),
    setProizvodnjaEnabled: (enabled: boolean) => pozovi('proizvodnja:setEnabled', enabled),

    // Tring
    tringInit: () => pozovi('tring:init'),
    tringXReport: () => pozovi('tring:xReport'),
    tringZReport: () => pozovi('tring:zReport'),
    tringPeriodicReport: (from: string, to: string) => pozovi('tring:periodicReport', from, to),
    tringGetLogs: () => pozovi('tring:getLogs'),
    tringClearLogs: () => pozovi('tring:clearLogs'),

    // Polog / povrat gotovine
    addCashMovement: (data: { tip: 'polog' | 'povrat'; iznos: number; napomena?: string }) =>
      pozovi('cash:add', data),
    retryCashMovement: (id: number) => pozovi('cash:retry', id),
    getTodayCashMovements: () => pozovi('cash:getToday'),
    getLastPolog: () => pozovi('cash:lastPolog'),
    getDrawerState: () => pozovi('cash:drawerState'),

    // Spremljene košarice
    listSavedCarts: () => pozovi('savedCarts:list'),
    saveCart: (naziv: string, items: Array<{ productId: number; kolicina: number; rabat: number }>, ukupno: number) =>
      pozovi('savedCarts:save', naziv, items, ukupno),
    deleteSavedCart: (id: number) => pozovi('savedCarts:delete', id),
    listSkiceFaktura: () => pozovi('fakturaSkice:list'),
    spremiSkicuFakture: (id: number | null, naziv: string, podaci: unknown, ukupno: number) =>
      pozovi('fakturaSkice:save', id, naziv, podaci, ukupno),
    obrisiSkicuFakture: (id: number) => pozovi('fakturaSkice:delete', id),

    // Settings
    getSetting: (key: string) => pozovi('settings:get', key),
    setSetting: (key: string, value: string) => pozovi('settings:set', key, value),
    getTringSettings: () => pozovi('settings:getTring'),
    saveTringSettings: (data: any) => pozovi('settings:saveTring', data),
    getFirmaSettings: () => pozovi('settings:getFirma'),
    saveFirmaSettings: (data: any) => pozovi('settings:saveFirma', data),

    // Dialog / File System
    showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => pozovi('dialog:saveFile', data),
    writeFile: (path: string, buffer: ArrayLike<number>) => pozovi('fs:writeFile', { path, buffer: Array.from(buffer) }),

    // Reports
    getReportData: (type: string, from: string, to: string) => pozovi('report:getData', type, from, to),
    izvozKnjigovodja: (od: string, doDatum: string) => pozovi('izvoz:knjigovodja', od, doDatum),

    // Database
    backupDatabase: () => pozovi('db:backup'),
    restoreDatabase: () => pozovi('db:restore'),
  };
}
