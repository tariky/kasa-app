// Pod Tauri-jem nema Electron preloada: `window.api` se pravi ovdje, nad
// komandom `api` (src-tauri/src/lib.rs) koja prima iste kanale kao ipcMain.
// U Electronu (`window.api` već postoji) ovaj modul ne radi ništa.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { napraviApi } from '../ipc/api';

if (!('api' in window) && '__TAURI_INTERNALS__' in window) {
  (window as any).api = napraviApi(
    async (kanal, ...args) => {
      try {
        return await invoke('api', { kanal, args });
      } catch (e) {
        // Rust vraća poruku kao string; ekrani očekuju Error s porukom.
        throw new Error(typeof e === 'string' ? e : String((e as any)?.message ?? e));
      }
    },
    (cb) => {
      const odjava = listen('licenca:blokirano', () => cb());
      return () => { void odjava.then(f => f()); };
    },
  );
}
