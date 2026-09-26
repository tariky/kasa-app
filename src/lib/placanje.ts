import type * as Tring from '@/services/tring';
import { round2 } from './novac';
import { TOLERANCIJA_IZNOSA } from './racun';

/** Načini plaćanja koje nude ekrani (u bazi se čuva "Ček" s kvačicom). */
export const NACINI_PLACANJA = ['Gotovina', 'Kartica', 'Virman', 'Ček'] as const;
export type NacinPlacanja = typeof NACINI_PLACANJA[number];

/**
 * Ključ vrste u JSON raspodjeli razbijenog plaćanja — oblik koji čita
 * `raspodjelaPlacanja` (ladica, knjigovođa, ekran).
 */
const KLJUC_RASPODJELE: Record<NacinPlacanja, string> = {
  Gotovina: 'gotovina', Kartica: 'kartica', Virman: 'virman', 'Ček': 'cek',
};

/** Način plaćanja iz payload-a: tekst s liste NACINI_PLACANJA (trimovan). */
export function provjeriNacinPlacanja(nacin: unknown): NacinPlacanja {
  const n = typeof nacin === 'string' ? nacin.trim() : '';
  if (!n) throw new Error('Način plaćanja je obavezan');
  if (!(NACINI_PLACANJA as readonly string[]).includes(n)) throw new Error(`Nepoznat način plaćanja: "${n}"`);
  return n as NacinPlacanja;
}

/**
 * Plaćanje računa kako ide uređaju i u bazu. `nacinPlacanja` je uvijek
 * obavezan i s liste. Bez `vrstePlacanja` cijeli iznos ide tim načinom.
 * Razbijeno plaćanje (`vrstePlacanja`): svaka vrsta s liste i najviše
 * jednom, iznos > 0 (na fening), zbir = ukupno. Tada se u bazu upisuje ono
 * što je uređaj dobio: jedna vrsta → njen naziv, više → JSON raspodjela
 * (`{"gotovina":3,"cek":2}`), da ladica i izvoz vide stvarnu gotovinu.
 */
export function pripremiPlacanje(
  nacin: unknown, vrste: unknown, ukupno: number,
): { nacinPlacanja: string; vrstePlacanja: Tring.VrstaPlacanja[] } {
  const osnovni = provjeriNacinPlacanja(nacin);
  if (vrste === undefined || vrste === null || (Array.isArray(vrste) && vrste.length === 0)) {
    return { nacinPlacanja: osnovni, vrstePlacanja: [{ oznaka: osnovni, iznos: ukupno }] };
  }
  if (!Array.isArray(vrste)) throw new Error('Neispravne vrste plaćanja');

  const raspodjela = new Map<NacinPlacanja, number>();
  for (const v of vrste) {
    if (!v || typeof v !== 'object') throw new Error('Neispravne vrste plaćanja');
    const oznaka = provjeriNacinPlacanja((v as { oznaka?: unknown }).oznaka);
    const iznos = (v as { iznos?: unknown }).iznos;
    if (!(typeof iznos === 'number' && Number.isFinite(iznos) && round2(iznos) > 0)) {
      throw new Error('Iznos plaćanja mora biti veći od 0');
    }
    if (raspodjela.has(oznaka)) throw new Error(`Način plaćanja "${oznaka}" je naveden više puta`);
    raspodjela.set(oznaka, round2(iznos));
  }
  const zbir = round2([...raspodjela.values()].reduce((s, x) => s + x, 0));
  if (Math.abs(zbir - ukupno) > TOLERANCIJA_IZNOSA) {
    throw new Error(`Zbir plaćanja (${zbir.toFixed(2)}) ne odgovara iznosu računa (${ukupno.toFixed(2)})`);
  }

  const vrstePlacanja = [...raspodjela].map(([oznaka, iznos]) => ({ oznaka, iznos }));
  const nacinPlacanja = vrstePlacanja.length === 1
    ? vrstePlacanja[0].oznaka
    : JSON.stringify(Object.fromEntries(vrstePlacanja.map(v => [KLJUC_RASPODJELE[v.oznaka], v.iznos])));
  return { nacinPlacanja, vrstePlacanja };
}

// ─── Čitanje upisanog načina plaćanja ───────────────────────
// Jedini parser za `orders.nacinPlacanja` (knjigovođa, ekran računa, PDF-ovi).

export interface Placanja {
  gotovina: number;
  kartica: number;
  virman: number;
  cek: number;
}

// Map, ne objekat: ključ kao 'constructor' ili '__proto__' nije vrsta plaćanja.
const VRSTE = new Map<string, keyof Placanja>([
  ['gotovina', 'gotovina'], ['kartica', 'kartica'], ['virman', 'virman'], ['cek', 'cek'], ['ček', 'cek'],
]);
const NAZIV_VRSTE: Record<keyof Placanja, string> = { gotovina: 'Gotovina', kartica: 'Kartica', virman: 'Virman', cek: 'Ček' };
const VRSTE_REDOM: Array<keyof Placanja> = ['gotovina', 'kartica', 'virman', 'cek'];
export const nulaPlacanja = (): Placanja => ({ gotovina: 0, kartica: 0, virman: 0, cek: 0 });
const km = (n: number) => n.toFixed(2).replace('.', ',');

/** JSON objekat iz upisanog načina plaćanja; `null` kad to nije. */
function jsonObjekat(nacin: string): Record<string, unknown> | null {
  let json: unknown = null;
  try { json = JSON.parse(nacin); } catch { /* nije JSON */ }
  return json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null;
}

/**
 * Način plaćanja → iznosi po vrsti. Tekst ('Kartica', bez obzira na slova i
 * razmake) nosi cijeli iznos, JSON ({gotovina, kartica…}, ključevi bez obzira
 * na slova) je podijeljeno plaćanje. Jedini parser: ladica (`gotovinskiIznos`),
 * izvoz knjigovođi i ekran. Nepoznat oblik: sve u gotovinu, `poznat: false`
 * (Kontrola); ladica ga ne broji.
 */
export function raspodjelaPlacanja(nacin: string, ukupno: number): { iznosi: Placanja; opis: string; poznat: boolean } {
  const tekst = VRSTE.get(nacin.trim().toLowerCase());
  if (tekst) return { iznosi: { ...nulaPlacanja(), [tekst]: ukupno }, opis: NAZIV_VRSTE[tekst], poznat: true };

  const json = jsonObjekat(nacin);
  if (json) {
    const iznosi = nulaPlacanja();
    const opis: string[] = [];
    let poznat = true;
    for (const [k, v] of Object.entries(json)) {
      const vrsta = VRSTE.get(k.toLowerCase());
      if (!vrsta || typeof v !== 'number' || !Number.isFinite(v)) { poznat = false; break; }
      if (v === 0) continue;
      iznosi[vrsta] = round2(iznosi[vrsta] + v);
      opis.push(`${NAZIV_VRSTE[vrsta]} ${km(v)}`);
    }
    if (poznat && opis.length) return { iznosi, opis: opis.join(' + '), poznat };
  }
  return { iznosi: { ...nulaPlacanja(), gotovina: ukupno }, opis: nacin, poznat: false };
}

/**
 * Upisani način plaćanja u kanonskom obliku (migracija starih zapisa): tekst
 * → 'Gotovina', 'Kartica', 'Virman', 'Ček' ('cek' je Ček); JSON raspodjela →
 * ključevi 'gotovina', 'kartica', 'virman', 'cek', iznosi nepromijenjeni.
 * Oblik koji `raspodjelaPlacanja` ne razumije (nepoznata vrsta, iznos koji
 * nije broj, ista vrsta dvaput) ostaje kakav jeste. Idempotentna.
 */
export function kanonskiNacinPlacanja(nacin: string): string {
  const tekst = VRSTE.get(nacin.trim().toLowerCase());
  if (tekst) return NAZIV_VRSTE[tekst];

  const json = jsonObjekat(nacin);
  if (!json) return nacin;
  const kanonski: Partial<Placanja> = {};
  for (const [k, v] of Object.entries(json)) {
    const vrsta = VRSTE.get(k.toLowerCase());
    if (!vrsta || typeof v !== 'number' || !Number.isFinite(v) || Object.hasOwn(kanonski, vrsta)) return nacin;
    kanonski[vrsta] = v;
  }
  return JSON.stringify(kanonski);
}

/**
 * Način plaćanja za prikaz (ekran računa, PDF računa, promet): jedna vrsta →
 * njen naziv; razbijeno → "Gotovina 3,00 KM + Ček 2,00 KM". `nazivi` mijenja
 * nazive vrsta (npr. engleski PDF). Nepoznat oblik ide kako je upisan.
 */
export function opisPlacanja(nacin: string, ukupno: number, nazivi: Partial<Record<keyof Placanja, string>> = {}): string {
  const { iznosi, poznat } = raspodjelaPlacanja(nacin, ukupno);
  const dijelovi = VRSTE_REDOM.filter(v => iznosi[v] > 0);
  if (!poznat || dijelovi.length === 0) return nacin;
  const naziv = (v: keyof Placanja) => nazivi[v] ?? NAZIV_VRSTE[v];
  if (dijelovi.length === 1) return naziv(dijelovi[0]);
  return dijelovi.map(v => `${naziv(v)} ${km(iznosi[v])} KM`).join(' + ');
}
