/**
 * Postavke dokumenata (faktura, ponuda, otpremnica, račun, radni nalog) — ključevi
 * `dokumenti.*` u tabeli settings. Ključ koji nikad nije spremljen daje zadanu
 * vrijednost, pa dokument bez podešavanja izgleda kao prije ovih postavki.
 */
import type { SqlDb } from './sqldb';
import { round2 } from './novac';

export type NacinPlacanja = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
export const NACINI_PLACANJA: NacinPlacanja[] = ['Gotovina', 'Kartica', 'Virman', 'Ček'];

export type DokumentSaPotpisom = 'faktura' | 'ponuda' | 'otpremnica' | 'racun' | 'nalog';
export type DokumentSaPecatom = Exclude<DokumentSaPotpisom, 'nalog'>;
export const DOKUMENTI_SA_POTPISOM: DokumentSaPotpisom[] = ['faktura', 'ponuda', 'otpremnica', 'racun', 'nalog'];
export const DOKUMENTI_SA_PECATOM: DokumentSaPecatom[] = ['faktura', 'ponuda', 'otpremnica', 'racun'];

export interface PotpisLinije { lijevo: string; desno: string }
export interface FormatBroja { prefiks: string; cifara: number }
/** Posljednji broj iz starog programa — numeracija u toj godini nastavlja iza njega. */
export interface NastavakNumeracije { broj: number; godina: number }

export interface DokumentPostavke {
  faktura: { rokDana: number | null; nacinPlacanja: NacinPlacanja; napomena: string };
  ponuda: { vaziDana: number; uslovi: string; nacinPlacanja: NacinPlacanja; broj: FormatBroja; nastavak: NastavakNumeracije | null };
  nalog: { broj: FormatBroja; nastavak: NastavakNumeracije | null };
  podnozje: string;
  potpisi: Record<DokumentSaPotpisom, PotpisLinije>;
  pecat: { slika: string; velicina: number; na: Record<DokumentSaPecatom, boolean> };
  kolone: { sifra: boolean; jm: boolean };
}

export const LIMITI = { napomena: 500, uslovi: 500, prefiks: 8, podnozje: 300, potpis: 30 } as const;
export const PECAT_VELICINA = { min: 40, max: 200, zadano: 90 } as const;
const CIFARA_MAX = 6;

export const ZADANE_DOKUMENT_POSTAVKE: DokumentPostavke = {
  faktura: { rokDana: null, nacinPlacanja: 'Virman', napomena: '' },
  ponuda: {
    vaziDana: 8,
    uslovi: 'Cijene su izražene u KM sa uračunatim PDV-om.',
    nacinPlacanja: 'Gotovina',
    broj: { prefiks: '', cifara: 0 },
    nastavak: null,
  },
  nalog: { broj: { prefiks: 'RN-', cifara: 0 }, nastavak: null },
  podnozje: '',
  potpisi: {
    faktura: { lijevo: 'Izdao', desno: 'Primio' },
    ponuda: { lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' },
    otpremnica: { lijevo: 'Robu izdao', desno: 'Robu primio' },
    racun: { lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' },
    nalog: { lijevo: 'Izradio', desno: 'Preuzeo' },
  },
  pecat: { slika: '', velicina: PECAT_VELICINA.zadano, na: { faktura: false, ponuda: false, otpremnica: false, racun: false } },
  kolone: { sifra: false, jm: true },
};

const K = {
  fakturaRok: 'dokumenti.faktura.rokDana',
  fakturaNacin: 'dokumenti.faktura.nacinPlacanja',
  fakturaNapomena: 'dokumenti.faktura.napomena',
  ponudaVazi: 'dokumenti.ponuda.vaziDana',
  ponudaUslovi: 'dokumenti.ponuda.uslovi',
  ponudaNacin: 'dokumenti.ponuda.nacinPlacanja',
  ponudaPrefiks: 'dokumenti.ponuda.prefiks',
  ponudaCifara: 'dokumenti.ponuda.cifara',
  ponudaNastavakBroj: 'dokumenti.ponuda.nastavakBroj',
  ponudaNastavakGodina: 'dokumenti.ponuda.nastavakGodina',
  nalogPrefiks: 'dokumenti.nalog.prefiks',
  nalogNastavakBroj: 'dokumenti.nalog.nastavakBroj',
  nalogNastavakGodina: 'dokumenti.nalog.nastavakGodina',
  podnozje: 'dokumenti.podnozje',
  pecat: 'dokumenti.pecat',
  pecatVelicina: 'dokumenti.pecatVelicina',
  sifra: 'dokumenti.kolone.sifra',
  jm: 'dokumenti.kolone.jm',
} as const;
const potpisKljuc = (d: DokumentSaPotpisom, strana: keyof PotpisLinije) => `dokumenti.potpis.${d}.${strana}`;
const pecatKljuc = (d: DokumentSaPecatom) => `dokumenti.pecat.${d}`;

export const KLJUCEVI_DOKUMENATA: string[] = [
  ...Object.values(K),
  ...DOKUMENTI_SA_POTPISOM.flatMap(d => [potpisKljuc(d, 'lijevo'), potpisKljuc(d, 'desno')]),
  ...DOKUMENTI_SA_PECATOM.map(pecatKljuc),
];

type Raw = Record<string, string | null | undefined>;

function cijeli(v: string | null | undefined, min: number, max: number): number | null {
  const t = (v ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** Spremljen tekst se koristi i kad je prazan; nikad spremljen → zadano. */
function tekst(v: string | null | undefined, zadano: string, limit: number): string {
  return v == null ? zadano : v.trim().slice(0, limit);
}

function nacin(v: string | null | undefined, zadano: NacinPlacanja): NacinPlacanja {
  return NACINI_PLACANJA.includes(v as NacinPlacanja) ? (v as NacinPlacanja) : zadano;
}

function prekidac(v: string | null | undefined, zadano: boolean): boolean {
  return v === 'true' ? true : v === 'false' ? false : zadano;
}

/** react-pdf štampa samo PNG i JPEG — svg/webp/gif bi tiho izostali. */
const jeSlika = (v: string) => /^data:image\/(png|jpeg);base64,/.test(v);

/** Nastavak važi samo kad su i broj i godina ispravni. */
function nastavak(broj: string | null | undefined, godina: string | null | undefined): NastavakNumeracije | null {
  const b = cijeli(broj, 1, 999999);
  const g = cijeli(godina, 2000, 2999);
  return b != null && g != null ? { broj: b, godina: g } : null;
}

export function procitajDokumentPostavke(raw: Raw): DokumentPostavke {
  const Z = ZADANE_DOKUMENT_POSTAVKE;
  const potpis = (d: DokumentSaPotpisom, s: keyof PotpisLinije) =>
    (raw[potpisKljuc(d, s)] ?? '').trim().slice(0, LIMITI.potpis) || Z.potpisi[d][s];
  const slika = raw[K.pecat] ?? '';
  return {
    faktura: {
      rokDana: cijeli(raw[K.fakturaRok], 0, 365),
      nacinPlacanja: nacin(raw[K.fakturaNacin], Z.faktura.nacinPlacanja),
      napomena: tekst(raw[K.fakturaNapomena], Z.faktura.napomena, LIMITI.napomena),
    },
    ponuda: {
      vaziDana: cijeli(raw[K.ponudaVazi], 1, 365) ?? Z.ponuda.vaziDana,
      uslovi: tekst(raw[K.ponudaUslovi], Z.ponuda.uslovi, LIMITI.uslovi),
      nacinPlacanja: nacin(raw[K.ponudaNacin], Z.ponuda.nacinPlacanja),
      broj: {
        prefiks: tekst(raw[K.ponudaPrefiks], Z.ponuda.broj.prefiks, LIMITI.prefiks),
        cifara: cijeli(raw[K.ponudaCifara], 0, CIFARA_MAX) ?? 0,
      },
      nastavak: nastavak(raw[K.ponudaNastavakBroj], raw[K.ponudaNastavakGodina]),
    },
    nalog: {
      broj: { prefiks: tekst(raw[K.nalogPrefiks], Z.nalog.broj.prefiks, LIMITI.prefiks), cifara: 0 },
      nastavak: nastavak(raw[K.nalogNastavakBroj], raw[K.nalogNastavakGodina]),
    },
    podnozje: tekst(raw[K.podnozje], Z.podnozje, LIMITI.podnozje),
    potpisi: Object.fromEntries(DOKUMENTI_SA_POTPISOM.map(d => [d, { lijevo: potpis(d, 'lijevo'), desno: potpis(d, 'desno') }])) as DokumentPostavke['potpisi'],
    pecat: {
      slika: jeSlika(slika) ? slika : '',
      velicina: cijeli(raw[K.pecatVelicina], PECAT_VELICINA.min, PECAT_VELICINA.max) ?? PECAT_VELICINA.zadano,
      na: Object.fromEntries(DOKUMENTI_SA_PECATOM.map(d => [d, prekidac(raw[pecatKljuc(d)], false)])) as DokumentPostavke['pecat']['na'],
    },
    kolone: { sifra: prekidac(raw[K.sifra], Z.kolone.sifra), jm: prekidac(raw[K.jm], Z.kolone.jm) },
  };
}

/** Sve postavke kao string vrijednosti za `settings:set` — pokriva svaki ključ iz KLJUCEVI_DOKUMENATA. */
export function uKljuceve(p: DokumentPostavke): Record<string, string> {
  const out: Record<string, string> = {
    [K.fakturaRok]: p.faktura.rokDana == null ? '' : String(p.faktura.rokDana),
    [K.fakturaNacin]: p.faktura.nacinPlacanja,
    [K.fakturaNapomena]: p.faktura.napomena,
    [K.ponudaVazi]: String(p.ponuda.vaziDana),
    [K.ponudaUslovi]: p.ponuda.uslovi,
    [K.ponudaNacin]: p.ponuda.nacinPlacanja,
    [K.ponudaPrefiks]: p.ponuda.broj.prefiks,
    [K.ponudaCifara]: String(p.ponuda.broj.cifara),
    [K.ponudaNastavakBroj]: String(p.ponuda.nastavak?.broj ?? ''),
    [K.ponudaNastavakGodina]: String(p.ponuda.nastavak?.godina ?? ''),
    [K.nalogPrefiks]: p.nalog.broj.prefiks,
    [K.nalogNastavakBroj]: String(p.nalog.nastavak?.broj ?? ''),
    [K.nalogNastavakGodina]: String(p.nalog.nastavak?.godina ?? ''),
    [K.podnozje]: p.podnozje,
    [K.pecat]: p.pecat.slika,
    [K.pecatVelicina]: String(p.pecat.velicina),
    [K.sifra]: String(p.kolone.sifra),
    [K.jm]: String(p.kolone.jm),
  };
  for (const d of DOKUMENTI_SA_POTPISOM) {
    out[potpisKljuc(d, 'lijevo')] = p.potpisi[d].lijevo;
    out[potpisKljuc(d, 'desno')] = p.potpisi[d].desno;
  }
  for (const d of DOKUMENTI_SA_PECATOM) out[pecatKljuc(d)] = String(p.pecat.na[d]);
  return out;
}

/** „P-003/2026“ — broj se nulama dopunjava do `cifara`, duži broj ostaje cijel. */
export function formatBroja(n: { broj: number; godina: number }, f: FormatBroja): string {
  return `${f.prefiks}${String(n.broj).padStart(f.cifara, '0')}/${n.godina}`;
}

/**
 * Najveći broj iz starog programa za godinu, ili 0. Čita se direktno iz settings —
 * radi i u Electron main procesu i u test bazi.
 */
export function nastavakNumeracije(db: SqlDb, dok: 'ponuda' | 'nalog', godina: number): number {
  const v = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value;
  const n = nastavak(v(`dokumenti.${dok}.nastavakBroj`), v(`dokumenti.${dok}.nastavakGodina`));
  return n && n.godina === godina ? n.broj : 0;
}

/** Polja kupca iz šifarnika koja nose zadane vrijednosti; NULL = koristi globalno. */
export interface KupacZadano {
  rokPlacanjaDana?: number | null;
  nacinPlacanja?: string | null;
  rabat?: number | null;
}

/** Redoslijed: kupac → globalna postavka dokumenta → zadano. */
export function zadanoZaKupca(
  kupac: KupacZadano | null | undefined,
  p: DokumentPostavke,
  dokument: 'faktura' | 'ponuda',
): { rokDana: number | null; nacinPlacanja: NacinPlacanja; rabat: number } {
  const globalno = dokument === 'faktura' ? p.faktura : { rokDana: null, nacinPlacanja: p.ponuda.nacinPlacanja };
  return {
    rokDana: kupac?.rokPlacanjaDana ?? globalno.rokDana,
    nacinPlacanja: nacin(kupac?.nacinPlacanja, globalno.nacinPlacanja),
    rabat: kupac?.rabat ?? 0,
  };
}

/** Način kupca na kasi: samo ispravan kupčev način — globalni fakturni način ne mijenja kasu. */
export function nacinKupcaNaKasi(kupac: KupacZadano): NacinPlacanja | null {
  return NACINI_PLACANJA.includes(kupac.nacinPlacanja as NacinPlacanja) ? (kupac.nacinPlacanja as NacinPlacanja) : null;
}

/** Kad kupac ode: način koji je on postavio vraća se na Gotovinu, ručni izbor kasira ostaje. */
export function nacinBezKupca(trenutni: NacinPlacanja, odKupca: NacinPlacanja | null): NacinPlacanja {
  return odKupca != null && trenutni === odKupca ? 'Gotovina' : trenutni;
}

/** Rok u danima → izbor u dijalogu fakture: brzi chip ako postoji, inače tačan datum. */
export function rokUIzbor(dana: number | null, brzi: readonly number[]): { rok: number | 'datum' | null; dana: number | null } {
  if (dana == null) return { rok: null, dana: null };
  return { rok: brzi.includes(dana) ? dana : 'datum', dana };
}

/**
 * Zadane vrijednosti fakture prema tome odakle je nastala: skica čuva sve svoje (null),
 * faktura iz ponude uzima rok i način kupca ali ne rabat — stavke nose rabat iz ponude.
 */
export function zadanoZaFakturu(
  kupac: KupacZadano | null | undefined,
  p: DokumentPostavke,
  izvor: 'nova' | 'ponuda' | 'skica',
): { rokDana: number | null; nacinPlacanja: NacinPlacanja; rabat: number } | null {
  if (izvor === 'skica') return null;
  const z = zadanoZaKupca(kupac, p, 'faktura');
  return izvor === 'ponuda' ? { ...z, rabat: 0 } : z;
}

/** Rabat kupca dobijaju samo stavke bez rabata — ručno upisan rabat ostaje. */
export function primijeniRabatKupca<T extends { rabat: number }>(stavke: T[], rabat: number): T[] {
  if (!(rabat > 0)) return stavke;
  return stavke.map(s => (s.rabat === 0 ? { ...s, rabat } : s));
}

/** Pečat za dokument, ili null kad nije uključen ili slika nije učitana. */
export function pecatZa(p: DokumentPostavke, dok: DokumentSaPecatom): { slika: string; velicina: number } | null {
  return p.pecat.na[dok] && jeSlika(p.pecat.slika) ? { slika: p.pecat.slika, velicina: p.pecat.velicina } : null;
}

/** Rabat za štampu: „5%“, „2,5%“, „12,75%“. */
export function formatRabat(r: number): string {
  return `${String(round2(r)).replace('.', ',')}%`;
}
