// Ko smije zvati koji kanal. Main proces drži prijavljenog korisnika (sesiju) i
// sam odlučuje — renderer ne šalje ni korisnikId ni ulogu. Isti skupovi važe
// za Rust backend (src-tauri), pa su ovdje kao podaci, ne razbacani po handlerima.
import type { JavniKorisnik } from '../lib/korisnici';

export const PORUKA_NISTE_PRIJAVLJENI = 'Niste prijavljeni';
export const PORUKA_SAMO_ADMIN = 'Ovu radnju može izvršiti samo administrator';

/** Kanali koji rade i bez prijave (ekran za prijavu i aktivaciju licence). */
export const KANALI_BEZ_PRIJAVE: ReadonlySet<string> = new Set([
  'licenca:stanje', 'licenca:aktiviraj',
  'user:login', 'user:logout',
  // LoginScreen: naziv firme u lijevom panelu.
  'settings:getFirma',
  // settings:get samo za ključeve iz POSTAVKE_BEZ_PRIJAVE (vidi provjeriPristup).
  'settings:get',
]);

/** Postavke koje renderer čita prije prijave (skala ekrana, moduli na LoginScreenu). */
export const POSTAVKE_BEZ_PRIJAVE: ReadonlySet<string> = new Set([
  'ui.skala', 'proizvodnja.enabled', 'ui.showGenerator',
]);

/**
 * Kanali koji mijenjaju stanje, a UI ih nudi samo administratoru (Postavke,
 * Knjigovođa tab) ili su sami po sebi administratorski.
 */
export const ADMIN_KANALI: ReadonlySet<string> = new Set([
  'user:create', 'user:update', 'user:delete',
  'settings:saveFirma', 'settings:saveTring',
  'proizvodnja:setEnabled',
  'fiscal:setZadnjiBroj', 'order:dismissFiscalGap', 'pending:discard',
  'db:backup', 'db:restore',
  'izvoz:knjigovodja',
  // Dijagnostika fiskalnog uređaja (Postavke → Fiskalni); log sadrži i lozinku operatera.
  'tring:init', 'tring:getLogs', 'tring:clearLogs',
]);

/** settings:set — ključevi koje smije postaviti svaki prijavljeni korisnik (KasaScreen). */
export const POSTAVKE_ZA_SVE: ReadonlySet<string> = new Set([
  'kasa.scanMode',
]);

/** settings:set — ključevi iz Postavki (samo administrator). Sve ostalo se odbija. */
export const POSTAVKE_ZA_ADMINA: ReadonlySet<string> = new Set([
  // KasaGrupa
  'kasa.pologPrompt', 'kasa.allowZeroStock', 'kasa.kusurKalkulacija', 'kasa.requirePinRefund',
  'kasa.showDailyTotal', 'cijene.unosBezPdv',
  // FiskalniGrupa
  'racun.napomena', 'dev.logging',
  // SistemGrupa
  'ui.skala',
  // LicencaGrupa
  'ui.showGenerator',
]);

/** Postavke koje settings:get nikad ne vraća (ide null). */
export const TAJNE_POSTAVKE: ReadonlySet<string> = new Set(['tring.operatorPassword']);

/**
 * Baca grešku ako `korisnik` (null = niko nije prijavljen) ne smije zvati
 * `kanal` s ovim argumentima. Poziva se prije handlera.
 */
export function provjeriPristup(kanal: string, args: unknown[], korisnik: JavniKorisnik | null): void {
  if (!korisnik) {
    if (!KANALI_BEZ_PRIJAVE.has(kanal)) throw new Error(PORUKA_NISTE_PRIJAVLJENI);
    if (kanal === 'settings:get' && !POSTAVKE_BEZ_PRIJAVE.has(args[0] as string)) throw new Error(PORUKA_NISTE_PRIJAVLJENI);
    return;
  }
  if (ADMIN_KANALI.has(kanal) && korisnik.uloga !== 'admin') throw new Error(PORUKA_SAMO_ADMIN);
  if (kanal === 'settings:set') provjeriUpisPostavke(args[0], korisnik);
}

function provjeriUpisPostavke(kljuc: unknown, korisnik: JavniKorisnik): void {
  const k = typeof kljuc === 'string' ? kljuc : '';
  if (POSTAVKE_ZA_SVE.has(k)) return;
  if (!POSTAVKE_ZA_ADMINA.has(k)) throw new Error(`Postavka "${k}" se ne može mijenjati`);
  if (korisnik.uloga !== 'admin') throw new Error(PORUKA_SAMO_ADMIN);
}

// ─── Ograničenje pokušaja ───────────────────────────────────
// Zajednički brojač za svaku provjeru PIN-a (prijava, admin PIN, promjena
// svog PIN-a). Živi u memoriji main procesa — restart aplikacije ga poništi.

export const DOZVOLJENI_NEUSPJESI = 5;
export const PRVA_BLOKADA_MS = 30_000;
export const NAJDUZA_BLOKADA_MS = 15 * 60_000;

export function porukaBlokade(preostaloMs: number): string {
  return `Previše pogrešnih pokušaja. Pokušajte ponovo za ${Math.ceil(preostaloMs / 1000)} s.`;
}

export class OgranicenjePokusaja {
  private neuspjesi = 0;
  private blokiranDo = 0;

  constructor(private readonly sada: () => number = () => Date.now()) {}

  /** Baca grešku dok traje blokada — tada se PIN ni ne provjerava. */
  provjeri(): void {
    const preostalo = this.blokiranDo - this.sada();
    if (preostalo > 0) throw new Error(porukaBlokade(preostalo));
  }

  /** Peti uzastopni neuspjeh blokira 30 s, svaki sljedeći udvostručuje (najviše 15 min). */
  neuspjeh(): void {
    this.neuspjesi++;
    if (this.neuspjesi < DOZVOLJENI_NEUSPJESI) return;
    const trajanje = Math.min(PRVA_BLOKADA_MS * 2 ** (this.neuspjesi - DOZVOLJENI_NEUSPJESI), NAJDUZA_BLOKADA_MS);
    this.blokiranDo = this.sada() + trajanje;
  }

  uspjeh(): void {
    this.neuspjesi = 0;
    this.blokiranDo = 0;
  }
}
