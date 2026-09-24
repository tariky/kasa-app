declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.ttf' {
  const src: string;
  export default src;
}

interface Window {
  api: {
    getLicenca: () => Promise<import('./lib/licencaTipovi').LicencaInfo>;
    aktivirajLicencu: (token: string) => Promise<import('./lib/licencaTipovi').LicencaInfo>;
    onLicencaBlokirano: (cb: () => void) => () => void;
    login: (pin: string) => Promise<any>;
    getUsers: () => Promise<any[]>;
    verifyAdminPin: (pin: string) => Promise<{ success: boolean; ime: string }>;
    createUser: (data: any) => Promise<any>;
    updateUser: (id: number, data: any) => Promise<any>;
    deleteUser: (id: number) => Promise<any>;
    getProducts: (tip?: string) => Promise<any[]>;
    getProduct: (id: number) => Promise<any>;
    createSlobodanProduct: (data: { naziv: string; cijena: number; pdvStopa: string; jm?: string }) => Promise<any>;
    createProduct: (data: any) => Promise<any>;
    updateProduct: (id: number, data: any) => Promise<any>;
    deleteProduct: (id: number) => Promise<any>;
    searchProducts: (query: string) => Promise<any[]>;
    adjustStock: (productId: number, newStanje: number) => Promise<any>;
    getDobavljacSifre: (productId: number) => Promise<import('./types').DobavljacSifra[]>;
    setDobavljacSifre: (productId: number, lista: { dobavljacId: number; sifra: string | null }[]) => Promise<{ changes: number }>;
    findByDobavljacSifra: (dobavljacId: number, sifra: string) => Promise<any | null>;
    getStock: (productId: number) => Promise<number>;
    getDobavljaci: () => Promise<any[]>;
    createDobavljac: (data: any) => Promise<any>;
    updateDobavljac: (id: number, data: any) => Promise<any>;
    deleteDobavljac: (id: number) => Promise<any>;
    getSifreDobavljaca: (dobavljacId: number) => Promise<{ productId: number; sifra: string }[]>;
    getKupci: () => Promise<any[]>;
    searchKupci: (query: string) => Promise<any[]>;
    createKupac: (data: any) => Promise<any>;
    updateKupac: (id: number, data: any) => Promise<any>;
    deleteKupac: (id: number) => Promise<any>;
    getPrimke: () => Promise<any[]>;
    getPrimka: (id: number) => Promise<any>;
    /** Uz potvrđeni pregled; ako se stanje promijenilo od pregleda, ništa se ne upisuje i vraća se novi pregled. */
    createPrimka: (data: any, potvrda: import('./types').PregledCijenaUlaza) => Promise<{ id: number; nivelacijaCreated: boolean } | import('./types').PromijenjenoOdPregleda>;
    getNextBrojUlaza: () => Promise<string>;
    updatePrimka: (data: any, potvrda: import('./types').PregledCijenaUlaza) => Promise<{ id: number; nivelacijaCreated: boolean } | import('./types').PromijenjenoOdPregleda>;
    deletePrimka: (id: number, potvrda: import('./types').PregledCijenaUlaza) => Promise<null | import('./types').PromijenjenoOdPregleda>;
    pregledUnosaPrimke: (data: any) => Promise<import('./types').PregledCijenaUlaza>;
    pregledIzmjenePrimke: (data: any) => Promise<import('./types').PregledCijenaUlaza>;
    pregledBrisanjaPrimke: (id: number) => Promise<import('./types').PregledCijenaUlaza>;
    getNivelacije: (from?: string, to?: string) => Promise<any[]>;
    getNivelacija: (id: number) => Promise<any>;
    getOrders: () => Promise<any[]>;
    getOrder: (id: number) => Promise<any>;
    createOrder: (data: any) => Promise<any>;
    createManualOrder: (data: any) => Promise<{ id: number }>;
    updateOrderReklamacija: (id: number, broj: string) => Promise<any>;
    setOrderDatumValute: (id: number, datum: string | null) => Promise<{ datumValute: string | null }>;
    refundOrder: (id: number, brojReklamacije?: string) => Promise<any>;
    refundAndPrintOrder: (data: {
      id: number; brojReklamacije?: string; dozvoliPolog?: boolean; korisnikId?: number;
    }) => Promise<{
      success: boolean; brojReklamacije?: string | null; error?: string; odgovori?: Record<string, string>;
      nedovoljnoSredstava?: boolean; manjak?: number; pologIznos?: number;
    }>;
    finalizeOrder: (data: any) => Promise<{ success: boolean; id?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string> }>;
    finalizePrilogOrder: (data: {
      korisnikId: number; iznos?: number; nacinPlacanja: string; kupac?: any;
      stavke?: Array<{ productId: number; kolicina: number; cijena: number; pdvStopa: string }>;
      prilogOpis?: string; prilogVeza?: string;
    }) => Promise<{
      success: boolean; id?: number; prilogBroj?: number; brojFiskalnogRacuna?: string | null;
      upozorenje?: string; error?: string; odgovori?: Record<string, string>;
    }>;
    getFiskalnaNumeracija: () => Promise<{
      zadnjiUBazi: number | null; zadnjiUpisani: number | null; predvidjeni: number | null;
    }>;
    setZadnjiFiskalniBroj: (broj: number) => Promise<{ success: boolean; predvidjeni: number | null }>;
    getPrilogStavke: (orderId: number) => Promise<any[]>;
    savePrilogStavke: (orderId: number, stavke: Array<{ productId: number; kolicina: number; cijena: number; pdvStopa: string }>) => Promise<{ success: boolean }>;
    listPending: () => Promise<Array<{ id: number; korisnikId: number; createdAt: string; snapshot: any }>>;
    resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => Promise<{ id: number }>;
    discardPending: (id: number) => Promise<{ success: boolean }>;
    getFiscalGaps: () => Promise<number[]>;
    dismissFiscalGap: (broj: number) => Promise<{ success: boolean }>;
    getPonude: () => Promise<any[]>;
    getPonuda: (id: number) => Promise<any>;
    getNextBrojPonude: () => Promise<{ broj: number; godina: number }>;
    createPonuda: (data: any) => Promise<{ id: number; broj: number; godina: number }>;
    updatePonuda: (id: number, data: any) => Promise<{ success: boolean }>;
    setPonudaStatus: (id: number, status: string) => Promise<{ success: boolean }>;
    deletePonuda: (id: number) => Promise<{ changes: number }>;
    konvertujPonudu: (data: { id: number; korisnikId: number; nacinPlacanja: string }) => Promise<{
      success: boolean; racunId?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string>;
    }>;
    getNalozi: (filter?: string) => Promise<import('@/types').RadniNalog[]>;
    getNalog: (id: number) => Promise<import('@/types').RadniNalog>;
    getNextBrojNaloga: () => Promise<{ broj: number; godina: number }>;
    createNalog: (data: any) => Promise<{ id: number; broj: number; godina: number }>;
    createNalogIzPonude: (ponudaId: number, korisnikId: number) => Promise<{ id: number; broj: number; godina: number }>;
    getNalogZaPonudu: (ponudaId: number) => Promise<{ id: number; broj: number; godina: number } | null>;
    updateNalog: (id: number, data: any) => Promise<{ success: boolean }>;
    saveNalogStavke: (id: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => Promise<{ success: boolean }>;
    setNalogStatus: (data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati'; korisnikId: number }) => Promise<{ success: boolean }>;
    deleteNalog: (id: number) => Promise<{ success: boolean }>;
    getNalogKalkulacija: (id: number) => Promise<any>;
    izdajRacunZaNalog: (data: { id: number; korisnikId: number; nacinPlacanja: string }) => Promise<any>;
    getNormativ: (productId: number) => Promise<import('@/types').NormativStavka[]>;
    saveNormativ: (productId: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => Promise<{ success: boolean }>;
    searchMaterijal: (query: string) => Promise<any[]>;
    setProizvodnjaEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
    tringInit: () => Promise<any>;
    tringPrintReceipt: (data: any) => Promise<any>;
    tringPrintRefund: (data: any) => Promise<any>;
    tringXReport: () => Promise<any>;
    tringZReport: () => Promise<any>;
    tringPeriodicReport: (from: string, to: string) => Promise<any>;
    tringWriteArticle: (data: any) => Promise<any>;
    tringGetLogs: () => Promise<any[]>;
    tringClearLogs: () => Promise<any>;
    addCashMovement: (data: { tip: 'polog' | 'povrat'; iznos: number; korisnikId: number; napomena?: string }) =>
      Promise<{ id: number; tringStatus: 'ok' | 'error' | 'skipped'; error?: string }>;
    retryCashMovement: (id: number) => Promise<{ id: number; tringStatus: 'ok' | 'error' | 'skipped'; error?: string }>;
    getTodayCashMovements: () => Promise<Array<{
      id: number; tip: 'polog' | 'povrat'; iznos: number; korisnikId: number; korisnikIme: string;
      tringStatus: 'ok' | 'error' | 'skipped'; napomena: string | null; createdAt: string;
    }>>;
    getLastPolog: () => Promise<number | null>;
    getDrawerState: () => Promise<{
      polozi: number; gotovinskiPromet: number; povrati: number;
      gotovinskeReklamacije: number; ocekivanoStanje: number;
    }>;
    listSavedCarts: () => Promise<Array<{ id: number; naziv: string; items: string; ukupno: number; createdAt: string }>>;
    saveCart: (naziv: string, items: Array<{ productId: number; kolicina: number; rabat: number }>, ukupno: number) => Promise<number>;
    deleteSavedCart: (id: number) => Promise<any>;
    getSetting: (key: string) => Promise<string | null>;
    setSetting: (key: string, value: string) => Promise<any>;
    getTringSettings: () => Promise<any>;
    saveTringSettings: (data: any) => Promise<any>;
    getFirmaSettings: () => Promise<import('./types').FirmaSettings>;
    saveFirmaSettings: (data: import('./types').FirmaSettings) => Promise<{ success: boolean }>;
    showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
    writeFile: (path: string, buffer: Buffer) => Promise<any>;
    getReportData: (type: string, from: string, to: string) => Promise<any[]>;
    backupDatabase: () => Promise<string | null>;
    restoreDatabase: () => Promise<{ source: string; safetyPath: string } | null>;
  };
}
