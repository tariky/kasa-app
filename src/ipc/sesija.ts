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

/**
 * Postavke koje settings:get nikad ne vraća (ide null). Stanje blokade PIN-a
 * je interno: ni čitanje ni upis (settings:set ga ionako odbija, nije na listi).
 */
export const TAJNE_POSTAVKE: ReadonlySet<string> = new Set(['tring.operatorPassword', 'sigurnost.pinBlokada']);

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
// Kad blokada jednom počne, eskalacija ostaje dok ne prođe 60 min bez ijednog
// neuspjeha: svaki novi neuspjeh blokira duplo duže (do 15 min), pa uporan
// napad dobije najviše jedan pokušaj u 15 min. Stanje je u bazi (postavka
// KLJUC_BLOKADE, nevidljiva za settings:get/set) i preživi restart programa.

export const DOZVOLJENI_NEUSPJESI = 5;
export const PROZOR_NEUSPJEHA_MS = 15 * 60_000;
export const PRVA_BLOKADA_MS = 30_000;
export const NAJDUZA_BLOKADA_MS = 15 * 60_000;
/** Eskalacija se poništava tek kad ovoliko prođe bez ijednog neuspjeha. */
export const SMIRENJE_MS = 60 * 60_000;
/** Postavka u kojoj živi stanje blokade (JSON, vidi StanjeBlokade). */
export const KLJUC_BLOKADE = 'sigurnost.pinBlokada';

export function porukaBlokade(preostaloMs: number): string {
  return `Previše pogrešnih pokušaja. Pokušajte ponovo za ${Math.ceil(preostaloMs / 1000)} s.`;
}

/**
 * Stanje kako se upisuje: `neuspjesi` su vremena (ms) neuspjeha iz zadnjih
 * 60 min, rastuće; `trajanje` je zadnja blokada (0 = nema eskalacije);
 * `blokiranDo` je kraj tekuće blokade (ms).
 */
export interface StanjeBlokade {
  neuspjesi: number[];
  trajanje: number;
  blokiranDo: number;
}

/** Gdje se stanje čuva — u programu je to red u `settings` (KLJUC_BLOKADE). */
export interface SkladisteBlokade {
  ucitaj(): string | null;
  spremi(json: string): void;
}

function uMemoriji(): SkladisteBlokade {
  let zapis: string | null = null;
  return { ucitaj: () => zapis, spremi: (s) => { zapis = s; } };
}

const konacan = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Stanje iz skladišta, svedeno na `sada`. Neispravan ili nepostojeći zapis =
 * čisto stanje (bez blokade). Sat vraćen unazad ne smije produžiti ni prozor
 * ni eskalaciju: neuspjeh "iz budućnosti" postaje `sada`, a blokada traje
 * najviše NAJDUZA_BLOKADA_MS od `sada`. `svedeno` = nešto je promijenjeno i
 * treba ga upisati.
 */
function procitajStanje(json: string | null, sada: number): { s: StanjeBlokade; svedeno: boolean } {
  let s: StanjeBlokade = { neuspjesi: [], trajanje: 0, blokiranDo: 0 };
  try {
    const z = JSON.parse(json ?? '');
    if (Array.isArray(z?.neuspjesi) && z.neuspjesi.every(konacan) && konacan(z.trajanje) && konacan(z.blokiranDo)) {
      s = { neuspjesi: z.neuspjesi, trajanje: z.trajanje, blokiranDo: z.blokiranDo };
    }
  } catch { /* nije JSON */ }
  let svedeno = false;
  if (s.neuspjesi.some(x => x > sada)) {
    s.neuspjesi = s.neuspjesi.map(x => Math.min(x, sada));
    svedeno = true;
  }
  if (s.blokiranDo > sada + NAJDUZA_BLOKADA_MS) {
    s.blokiranDo = sada + NAJDUZA_BLOKADA_MS;
    svedeno = true;
  }
  return { s, svedeno };
}

export class OgranicenjePokusaja {
  constructor(
    private readonly sada: () => number = () => Date.now(),
    private readonly skladiste: SkladisteBlokade = uMemoriji(),
  ) {}

  private spremi(s: StanjeBlokade): void {
    this.skladiste.spremi(JSON.stringify(s));
  }

  /** Baca grešku dok traje blokada — tada se PIN ni ne provjerava. */
  provjeri(): void {
    const t = this.sada();
    const { s, svedeno } = procitajStanje(this.skladiste.ucitaj(), t);
    if (svedeno) this.spremi(s);
    const preostalo = s.blokiranDo - t;
    if (preostalo > 0) throw new Error(porukaBlokade(preostalo));
  }

  /**
   * Neuspjeh ulazi u prozor. Bez eskalacije: kad prozor od 15 min ima ≥ 5
   * neuspjeha, blokada 30 s. Uz eskalaciju (bilo je blokade, a od zadnjeg
   * neuspjeha nije prošlo 60 min): svaki neuspjeh blokira duplo duže od
   * prethodne blokade, najviše 15 min.
   */
  neuspjeh(): void {
    const t = this.sada();
    let { s } = procitajStanje(this.skladiste.ucitaj(), t);
    const zadnji = s.neuspjesi.at(-1);
    if (zadnji === undefined || t - zadnji >= SMIRENJE_MS) s = { neuspjesi: [], trajanje: 0, blokiranDo: 0 };
    s.neuspjesi = s.neuspjesi.filter(x => t - x < SMIRENJE_MS);
    s.neuspjesi.push(t);
    const uProzoru = s.neuspjesi.filter(x => t - x < PROZOR_NEUSPJEHA_MS).length;
    if (s.trajanje > 0) s.trajanje = Math.min(s.trajanje * 2, NAJDUZA_BLOKADA_MS);
    else if (uProzoru >= DOZVOLJENI_NEUSPJESI) s.trajanje = PRVA_BLOKADA_MS;
    if (s.trajanje > 0) s.blokiranDo = t + s.trajanje;
    this.spremi(s);
  }
}

// ─── Promjena svog PIN-a ────────────────────────────────────
// Uspješna promjena otkriva da novi PIN nije ničiji, pa je i ona ograničena:
// najviše 3 po korisniku u 10 min (u memoriji — restart programa ga poništi).

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
