// Pravila Electron ljuske (main proces) bez zavisnosti od Electrona, da se
// mogu testirati: odakle se učitava aplikacija, kuda smije navigirati, koje
// prozore smije otvoriti, CSP i aplikacijski meni.
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';

/** Šema i host pod kojima se servira ugrađeni renderer (umjesto file://). */
export const APP_SEMA = 'app';
export const APP_HOST = 'pazar';
export const APP_URL = `${APP_SEMA}://${APP_HOST}/index.html`;

/**
 * CSP upakovane aplikacije (šalje se kao zaglavlje uz svaki odgovor app://).
 * - 'wasm-unsafe-eval': @react-pdf raspoređuje stranicu kroz yoga-layout (WebAssembly).
 * - style 'unsafe-inline': Radix/react-remove-scroll ubacuju <style>.
 * - img/font data: i blob:: logo firme je data: URL, PDF pregled je blob:.
 * - connect data:: yoga-layout prvo pokuša fetch() svog WebAssembly data: URL-a.
 */
export const CSP_ELECTRON = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data:",
  "object-src 'none'",
  "frame-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Navigacija je dozvoljena samo na adresu aplikacije (ista šema i host:
 * app://pazar u paketu, Vite server u razvoju). Sve ostalo — vanjski linkovi,
 * file://, javascript: — ostaje blokirano.
 */
export function jeDozvoljenaNavigacija(url: string, urlAplikacije: string): boolean {
  try {
    const cilj = new URL(url);
    const app = new URL(urlAplikacije);
    return cilj.protocol === app.protocol && cilj.host === app.host && cilj.host !== '';
  } catch {
    return false;
  }
}

/**
 * PDF prozor se otvori na about:blank pa navigira na svoj blob: — samo to
 * prvo učitavanje je dozvoljeno; poslije toga prozor ne navigira nikud.
 */
export function jeDozvoljenaNavigacijaPopupa(url: string, trenutniUrl: string): boolean {
  return jeDozvoljenPopup(url) && (trenutniUrl === '' || trenutniUrl === 'about:blank');
}

/** `window.open` iz aplikacije: samo PDF pregled (blob: URL). */
export function jeDozvoljenPopup(url: string): boolean {
  return url.startsWith('blob:');
}

/**
 * Putanja fajla za zahtjev `app://pazar/...` unutar foldera renderera, ili
 * null ako zahtjev nije za naš host ili izlazi iz foldera (../, apsolutne putanje).
 */
export function putanjaZaZahtjev(urlZahtjeva: string, korijen: string, p: typeof path = path): string | null {
  let url: URL;
  try {
    url = new URL(urlZahtjeva);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SEMA}:` || url.host !== APP_HOST) return null;
  let relativna: string;
  try {
    relativna = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (relativna.includes('\0')) return null;
  if (relativna === '/' || relativna === '') relativna = '/index.html';
  const puna = p.resolve(korijen, '.' + relativna);
  const odnos = p.relative(p.resolve(korijen), puna);
  if (odnos === '' || odnos.startsWith('..') || p.isAbsolute(odnos)) return null;
  return puna;
}

/**
 * Aplikacijski meni. Uredi (copy/paste) i na macOS-u meni aplikacije moraju
 * ostati — bez njih ne rade Cmd+C/V. Pogled (Reload, DevTools) samo u razvoju.
 */
export function meniSablon(opcije: { mac: boolean; razvoj: boolean }): MenuItemConstructorOptions[] {
  const meni: MenuItemConstructorOptions[] = [];
  if (opcije.mac) meni.push({ role: 'appMenu' });
  meni.push({ role: 'fileMenu' }, { role: 'editMenu' });
  if (opcije.razvoj) meni.push({ role: 'viewMenu' });
  meni.push({ role: 'windowMenu' });
  return meni;
}
