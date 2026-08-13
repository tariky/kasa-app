import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Users
  login: (pin: string) => ipcRenderer.invoke('user:login', pin),
  getUsers: () => ipcRenderer.invoke('user:getAll'),
  verifyAdminPin: (pin: string) => ipcRenderer.invoke('user:verifyAdminPin', pin),
  createUser: (data: any) => ipcRenderer.invoke('user:create', data),
  updateUser: (id: number, data: any) => ipcRenderer.invoke('user:update', id, data),
  deleteUser: (id: number) => ipcRenderer.invoke('user:delete', id),

  // Products
  getProducts: (tip?: string) => ipcRenderer.invoke('product:getAll', tip),
  getProduct: (id: number) => ipcRenderer.invoke('product:get', id),
  createProduct: (data: any) => ipcRenderer.invoke('product:create', data),
  updateProduct: (id: number, data: any) => ipcRenderer.invoke('product:update', id, data),
  deleteProduct: (id: number) => ipcRenderer.invoke('product:delete', id),
  searchProducts: (query: string) => ipcRenderer.invoke('product:search', query),
  adjustStock: (productId: number, newStanje: number) => ipcRenderer.invoke('product:adjustStock', productId, newStanje),

  // Dobavljači
  getDobavljaci: () => ipcRenderer.invoke('dobavljac:getAll'),
  createDobavljac: (data: any) => ipcRenderer.invoke('dobavljac:create', data),
  updateDobavljac: (id: number, data: any) => ipcRenderer.invoke('dobavljac:update', id, data),
  deleteDobavljac: (id: number) => ipcRenderer.invoke('dobavljac:delete', id),

  // Kupci
  getKupci: () => ipcRenderer.invoke('kupac:getAll'),
  searchKupci: (query: string) => ipcRenderer.invoke('kupac:search', query),
  createKupac: (data: any) => ipcRenderer.invoke('kupac:create', data),
  updateKupac: (id: number, data: any) => ipcRenderer.invoke('kupac:update', id, data),
  deleteKupac: (id: number) => ipcRenderer.invoke('kupac:delete', id),

  // Primke
  getPrimke: () => ipcRenderer.invoke('primka:getAll'),
  getPrimka: (id: number) => ipcRenderer.invoke('primka:get', id),
  createPrimka: (data: any) => ipcRenderer.invoke('primka:create', data),
  getNextBrojUlaza: () => ipcRenderer.invoke('primka:nextBroj'),
  updatePrimka: (data: any) => ipcRenderer.invoke('primka:update', data),
  deletePrimka: (id: number) => ipcRenderer.invoke('primka:delete', id),

  // Nivelacije
  getNivelacije: (from?: string, to?: string) => ipcRenderer.invoke('nivelacija:getAll', from, to),
  getNivelacija: (id: number) => ipcRenderer.invoke('nivelacija:get', id),

  // Orders
  getOrders: () => ipcRenderer.invoke('order:getAll'),
  getOrder: (id: number) => ipcRenderer.invoke('order:get', id),
  createOrder: (data: any) => ipcRenderer.invoke('order:create', data),
  createManualOrder: (data: any) => ipcRenderer.invoke('order:createManual', data),
  updateOrderReklamacija: (id: number, broj: string) => ipcRenderer.invoke('order:updateReklamacija', id, broj),
  refundOrder: (id: number, brojReklamacije?: string) => ipcRenderer.invoke('order:refund', id, brojReklamacije),
  refundAndPrintOrder: (data: { id: number; brojReklamacije?: string }) => ipcRenderer.invoke('order:refundAndPrint', data),
  finalizeOrder: (data: any) => ipcRenderer.invoke('order:finalize', data),
  finalizePrilogOrder: (data: any) => ipcRenderer.invoke('order:finalizePrilog', data),
  getNextPrilogBroj: () => ipcRenderer.invoke('prilog:nextBroj'),
  getPrilogStavke: (orderId: number) => ipcRenderer.invoke('prilog:getStavke', orderId),
  savePrilogStavke: (orderId: number, stavke: any[]) => ipcRenderer.invoke('prilog:saveStavke', orderId, stavke),
  listPending: () => ipcRenderer.invoke('pending:list'),
  resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => ipcRenderer.invoke('pending:resolve', data),
  discardPending: (id: number) => ipcRenderer.invoke('pending:discard', id),
  getFiscalGaps: () => ipcRenderer.invoke('order:getFiscalGaps'),
  dismissFiscalGap: (broj: number) => ipcRenderer.invoke('order:dismissFiscalGap', broj),

  // Ponude
  getPonude: () => ipcRenderer.invoke('ponuda:getAll'),
  getPonuda: (id: number) => ipcRenderer.invoke('ponuda:get', id),
  getNextBrojPonude: () => ipcRenderer.invoke('ponuda:nextBroj'),
  createPonuda: (data: any) => ipcRenderer.invoke('ponuda:create', data),
  updatePonuda: (id: number, data: any) => ipcRenderer.invoke('ponuda:update', id, data),
  setPonudaStatus: (id: number, status: string) => ipcRenderer.invoke('ponuda:setStatus', id, status),
  deletePonuda: (id: number) => ipcRenderer.invoke('ponuda:delete', id),
  konvertujPonudu: (data: { id: number; korisnikId: number; nacinPlacanja: string }) => ipcRenderer.invoke('ponuda:konvertuj', data),

  // Tring
  tringInit: () => ipcRenderer.invoke('tring:init'),
  tringPrintReceipt: (data: any) => ipcRenderer.invoke('tring:printReceipt', data),
  tringPrintRefund: (data: any) => ipcRenderer.invoke('tring:printRefund', data),
  tringXReport: () => ipcRenderer.invoke('tring:xReport'),
  tringZReport: () => ipcRenderer.invoke('tring:zReport'),
  tringPeriodicReport: (from: string, to: string) => ipcRenderer.invoke('tring:periodicReport', from, to),
  tringWriteArticle: (data: any) => ipcRenderer.invoke('tring:writeArticle', data),
  tringGetLogs: () => ipcRenderer.invoke('tring:getLogs'),
  tringClearLogs: () => ipcRenderer.invoke('tring:clearLogs'),

  // Polog / povrat gotovine
  addCashMovement: (data: { tip: 'polog' | 'povrat'; iznos: number; korisnikId: number; napomena?: string }) =>
    ipcRenderer.invoke('cash:add', data),
  retryCashMovement: (id: number) => ipcRenderer.invoke('cash:retry', id),
  getTodayCashMovements: () => ipcRenderer.invoke('cash:getToday'),
  getLastPolog: () => ipcRenderer.invoke('cash:lastPolog'),
  getDrawerState: () => ipcRenderer.invoke('cash:drawerState'),

  // Spremljene košarice
  listSavedCarts: () => ipcRenderer.invoke('savedCarts:list'),
  saveCart: (naziv: string, items: Array<{ productId: number; kolicina: number; rabat: number }>, ukupno: number) =>
    ipcRenderer.invoke('savedCarts:save', naziv, items, ukupno),
  deleteSavedCart: (id: number) => ipcRenderer.invoke('savedCarts:delete', id),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getTringSettings: () => ipcRenderer.invoke('settings:getTring'),
  saveTringSettings: (data: any) => ipcRenderer.invoke('settings:saveTring', data),
  getFirmaSettings: () => ipcRenderer.invoke('settings:getFirma'),
  saveFirmaSettings: (data: any) => ipcRenderer.invoke('settings:saveFirma', data),

  // Dialog / File System
  showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('dialog:saveFile', data),
  writeFile: (path: string, buffer: Buffer) => ipcRenderer.invoke('fs:writeFile', { path, buffer: Array.from(buffer) }),

  // Reports
  getReportData: (type: string, from: string, to: string) => ipcRenderer.invoke('report:getData', type, from, to),

  // Database
  backupDatabase: () => ipcRenderer.invoke('db:backup'),
  restoreDatabase: () => ipcRenderer.invoke('db:restore'),
});
