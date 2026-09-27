// Pod Tauri-jem nema Electron preloada: `window.api` se pravi ovdje, nad
// komandom `api` (src-tauri/src/lib.rs) koja prima iste kanale kao ipcMain.
// U Electronu (`window.api` već postoji) ovaj modul ne radi ništa.
import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { napraviApi } from '../ipc/api';

if (!('api' in window) && '__TAURI_INTERNALS__' in window) {
  // Tip kaže da `window.api` uvijek postoji (global.d.ts), pa ga provjera iznad
  // suzi na `never` — ovdje se tek pravi.
  (window as Window).api = napraviApi(
    (kanal, ...args) => new Promise((resolve, reject) => {
      // Odgovor stiže kroz kanal: komanda je sinhrona da bi pozivi išli u
      // backend redom kojim su poslani (kao ipcRenderer.invoke).
      const odgovor = new Channel<{ ok?: unknown; greska?: string }>();
      odgovor.onmessage = (o) => {
        // `greska` je samo poruka backenda (bez Electron omota) — ista kao
        // poslije `ocistiPorukuIpc` u preloadu, pa UI vidi isti tekst.
        if (o.greska !== undefined) reject(new Error(o.greska));
        else resolve(o.ok ?? null);
      };
      invoke('api', { kanal, args, odgovor }).catch((e: unknown) => {
        reject(new Error(typeof e === 'string' ? e : String((e as { message?: unknown } | null | undefined)?.message ?? e)));
      });
    }),
    (ime, cb) => {
      const odjava = listen(ime, e => cb(e.payload));
      return () => { void odjava.then(f => f()); };
    },
  );
}
