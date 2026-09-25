// Ko smije zvati koji kanal. Main proces drži prijavljenog korisnika (sesiju) i
// sam odlučuje — renderer ne šalje ni korisnikId ni ulogu. Isti skupovi važe
// za Rust backend (src-tauri), pa su ovdje kao podaci, ne razbacani po handlerima.
import type { JavniKorisnik } from '../lib/korisnici';

export const PORUKA_NISTE_PRIJAVLJENI = 'Niste prijavljeni';
export const PORUKA_SAMO_ADMIN = 'Ovu radnju može izvršiti samo administrator';
export const PORUKA_ZADANI_PIN = 'Prije rada promijenite zadani PIN 0000';

/** Jedini kanali (uz KANALI_BEZ_PRIJAVE) dok prijavljeni korisnik još ima zadani PIN. */
export const KANALI_SA_ZADANIM_PINOM: ReadonlySet<string> = new Set(['user:promijeniSvojPin', 'user:logout']);

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
 * `kanal` s ovim argumentima. Poziva se prije handlera. `zadaniPin` = korisnik
 * se prijavio PIN-om 0000 i još ga nije promijenio: smije samo ono što smije
 * neprijavljen, plus promjenu svog PIN-a i odjavu.
 */
export function provjeriPristup(kanal: string, args: unknown[], korisnik: JavniKorisnik | null, zadaniPin = false): void {
  if (!korisnik || zadaniPin) {
    if (korisnik && KANALI_SA_ZADANIM_PINOM.has(kanal)) return;
    const poruka = korisnik ? PORUKA_ZADANI_PIN : PORUKA_NISTE_PRIJAVLJENI;
    if (!KANALI_BEZ_PRIJAVE.has(kanal)) throw new Error(poruka);
    if (kanal === 'settings:get' && !POSTAVKE_BEZ_PRIJAVE.has(args[0] as string)) throw new Error(poruka);
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
// Zajednički brojač za svaku provjeru PIN-a (prijava, admin PIN pri stornu,
// promjena svog PIN-a). Neuspjesi se broje u kliznom prozoru od 15 min i uspjeh
// ih NE briše — inače bi "4 pogrešna + prijava svojim PIN-om" išlo u beskraj.
// Živi u memoriji main procesa — restart aplikacije ga poništi.

export const DOZVOLJENI_NEUSPJESI = 5;
export const PROZOR_NEUSPJEHA_MS = 15 * 60_000;
export const PRVA_BLOKADA_MS = 30_000;
export const NAJDUZA_BLOKADA_MS = 15 * 60_000;

export function porukaBlokade(preostaloMs: number): string {
  return `Previše pogrešnih pokušaja. Pokušajte ponovo za ${Math.ceil(preostaloMs / 1000)} s.`;
}

export class OgranicenjePokusaja {
  private neuspjesi: number[] = [];
  private blokiranDo = 0;
  private trajanje = 0;

  constructor(private readonly sada: () => number = () => Date.now()) {}

  /** Baca grešku dok traje blokada — tada se PIN ni ne provjerava. */
  provjeri(): void {
    const preostalo = this.blokiranDo - this.sada();
    if (preostalo > 0) throw new Error(porukaBlokade(preostalo));
  }

  /**
   * Neuspjeh ulazi u prozor. Kad prozor ima ≥ 5 neuspjeha: prva blokada 30 s,
   * svaki sljedeći neuspjeh dok je prozor na pragu ili iznad udvostručuje je
   * (najviše 15 min). Kad stari neuspjesi isteknu ispod praga, kreće se od 30 s.
   */
  neuspjeh(): void {
    const t = this.sada();
    this.neuspjesi = this.neuspjesi.filter(x => t - x < PROZOR_NEUSPJEHA_MS);
    this.neuspjesi.push(t);
    if (this.neuspjesi.length < DOZVOLJENI_NEUSPJESI) {
      this.trajanje = 0;
      return;
    }
    this.trajanje = this.trajanje === 0 ? PRVA_BLOKADA_MS : Math.min(this.trajanje * 2, NAJDUZA_BLOKADA_MS);
    this.blokiranDo = t + this.trajanje;
  }
}

// ─── Promjena svog PIN-a ────────────────────────────────────
// Uspješna promjena otkriva da novi PIN nije ničiji, pa je i ona ograničena:
// najviše 3 po korisniku u 10 min (u memoriji, kao i brojač pokušaja).

export const PROMJENA_PINA_MAKS = 3;
export const PROMJENA_PINA_PROZOR_MS = 10 * 60_000;

export function porukaPrevisePromjena(preostaloMs: number): string {
  return `Previše promjena PIN-a. Pokušajte ponovo za ${Math.ceil(preostaloMs / 1000)} s.`;
}

export class OgranicenjePromjenaPina {
  private promjene = new Map<number, number[]>();

  constructor(private readonly sada: () => number = () => Date.now()) {}

  private svjeze(korisnikId: number): number[] {
    const t = this.sada();
    const lista = (this.promjene.get(korisnikId) ?? []).filter(x => t - x < PROMJENA_PINA_PROZOR_MS);
    this.promjene.set(korisnikId, lista);
    return lista;
  }

  provjeri(korisnikId: number): void {
    const lista = this.svjeze(korisnikId);
    if (lista.length >= PROMJENA_PINA_MAKS) throw new Error(porukaPrevisePromjena(lista[0] + PROMJENA_PINA_PROZOR_MS - this.sada()));
  }

  zabiljezi(korisnikId: number): void {
    this.svjeze(korisnikId).push(this.sada());
  }
}
