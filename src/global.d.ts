declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

declare module '*.ttf' {
  const src: string;
  export default src;
}

interface Window {
  /** Oblik je `napraviApi` (src/ipc/api.ts) — preload ga izloži pod Electronom, src/tauri/api.ts pod Tauri-jem. */
  api: import('./ipc/api').Api;
}
