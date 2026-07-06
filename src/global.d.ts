declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.ttf' {
  const src: string;
  export default src;
}

interface Window {
  api: {
    login: (pin: string) => Promise<any>;
    getUsers: () => Promise<any[]>;
    verifyAdminPin: (pin: string) => Promise<{ success: boolean; ime: string }>;
    createUser: (data: any) => Promise<any>;
    updateUser: (id: number, data: any) => Promise<any>;
    deleteUser: (id: number) => Promise<any>;
    getProducts: (tip?: string) => Promise<any[]>;
    getProduct: (id: number) => Promise<any>;
    createProduct: (data: any) => Promise<any>;
    updateProduct: (id: number, data: any) => Promise<any>;
    deleteProduct: (id: number) => Promise<any>;
    searchProducts: (query: string) => Promise<any[]>;
    adjustStock: (productId: number, newStanje: number) => Promise<any>;
    getStock: (productId: number) => Promise<number>;
    getDobavljaci: () => Promise<any[]>;
    createDobavljac: (data: any) => Promise<any>;
    updateDobavljac: (id: number, data: any) => Promise<any>;
    deleteDobavljac: (id: number) => Promise<any>;
    getKupci: () => Promise<any[]>;
    searchKupci: (query: string) => Promise<any[]>;
    createKupac: (data: any) => Promise<any>;
    updateKupac: (id: number, data: any) => Promise<any>;
    deleteKupac: (id: number) => Promise<any>;
    getPrimke: () => Promise<any[]>;
    getPrimka: (id: number) => Promise<any>;
    createPrimka: (data: any) => Promise<any>;
    getNextBrojUlaza: () => Promise<string>;
    updatePrimka: (data: any) => Promise<any>;
    deletePrimka: (id: number) => Promise<any>;
    getNivelacije: (from?: string, to?: string) => Promise<any[]>;
    getNivelacija: (id: number) => Promise<any>;
    getOrders: () => Promise<any[]>;
    getOrder: (id: number) => Promise<any>;
    createOrder: (data: any) => Promise<any>;
    createManualOrder: (data: any) => Promise<{ id: number }>;
    updateOrderReklamacija: (id: number, broj: string) => Promise<any>;
    refundOrder: (id: number) => Promise<any>;
    finalizeOrder: (data: any) => Promise<{ success: boolean; id?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string> }>;
    listPending: () => Promise<Array<{ id: number; korisnikId: number; createdAt: string; snapshot: any }>>;
    resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => Promise<{ id: number }>;
    discardPending: (id: number) => Promise<{ success: boolean }>;
    getFiscalGaps: () => Promise<number[]>;
    dismissFiscalGap: (broj: number) => Promise<{ success: boolean }>;
    tringInit: () => Promise<any>;
    tringPrintReceipt: (data: any) => Promise<any>;
    tringPrintRefund: (data: any) => Promise<any>;
    tringXReport: () => Promise<any>;
    tringZReport: () => Promise<any>;
    tringPeriodicReport: (from: string, to: string) => Promise<any>;
    tringWriteArticle: (data: any) => Promise<any>;
    tringGetLogs: () => Promise<any[]>;
    tringClearLogs: () => Promise<any>;
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
  };
}
