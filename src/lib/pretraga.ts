/**
 * Fuzzy pretraga stavki (artikli, usluge, materijali) u memoriji — za PretragaStavki.
 * Svaka riječ upita mora pogoditi naziv, šifru, barkod ili dodatno polje (npr. šifre
 * dobavljača), redoslijed riječi nije bitan, kvačice se ignorišu. Riječ pogađa, od
 * najjačeg prema najslabijem: šifru, podniz naziva, slova naziva redom ("hrst" → hrast)
 * i na kraju riječ naziva s jednom greškom u kucanju ("mljeko" → mlijeko).
 */

import type { Product } from '@/types';

export interface PoljaPretrage {
  naziv: string;
  sifra?: string | null;
  barkod?: string | null;
  /** Dodatni tekst koji se pretražuje ali ne prikazuje (npr. šifre dobavljača). */
  dodatno?: string | null;
}

/** Šta se pretražuje na proizvodu; šifre dobavljača se traže, ali ne prikazuju. */
export const poljaProizvoda = (p: Product): PoljaPretrage =>
  ({ naziv: p.naziv, sifra: p.sifra, barkod: p.barkod, dodatno: p.sifreDobavljaca });

export interface Pogodak<T> {
  stavka: T;
  skor: number;
  /** Indeksi pogođenih znakova u originalnom nazivu (za označavanje). */
  nazivIdx: number[];
  sifraPogodak: boolean;
  barkodPogodak: boolean;
}

export interface OpcijePretrage<T> {
  /** Dodaje se na skor (npr. nedavno korištene stavke, tačna šifra dobavljača). */
  bonus?: (stavka: T, upit: string) => number;
  max?: number;
}

const FOLD: Record<string, string> = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'd', '×': 'x' };

/** Mala slova bez kvačica, znak po znak — dužina ostaje ista pa indeksi važe i za original. */
export function normalizuj(s: string): string {
  let o = '';
  for (const ch of s.toLowerCase()) o += FOLD[ch] ?? ch.normalize('NFD')[0];
  return o;
}

/** "3*kant" / "2,5 × iverica" → količina ispred zvjezdice; "7×50" ostaje upit. */
export function parsirajUpit(raw: string): { upit: string; kolicina: number | null } {
  const m = raw.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if (!m) return { upit: raw.trim(), kolicina: null };
  return { upit: m[2].trim(), kolicina: parseFloat(m[1].replace(',', '.')) };
}

/** "3*" na stavci koja već postoji: dodaje na upisanu količinu (tekst s zarezom). */
export function uvecajKolicinu(staro: string, kol: number): string {
  const n = parseFloat(staro.trim().replace(',', '.')) || 0;
  return String(Math.round((n + kol) * 1e4) / 1e4).replace('.', ',');
}

interface Pripremljeno { n: string; s: string; sBez: string; b: string; d: string; rijeci: { w: string; i: number }[] }
const cache = new WeakMap<object, { kljuc: string; p: Pripremljeno }>();

function pripremi(stavka: object, f: PoljaPretrage): Pripremljeno {
  const kljuc = `${f.naziv}\u0000${f.sifra ?? ''}\u0000${f.barkod ?? ''}\u0000${f.dodatno ?? ''}`;
  const hit = cache.get(stavka);
  if (hit && hit.kljuc === kljuc) return hit.p;
  const n = normalizuj(f.naziv);
  const s = normalizuj(f.sifra ?? '');
  const rijeci: { w: string; i: number }[] = [];
  for (const m of n.matchAll(/[a-z0-9]+/g)) rijeci.push({ w: m[0], i: m.index! });
  const p = { n, s, sBez: s.replace(/[-\s./]/g, ''), b: (f.barkod ?? '').toLowerCase(), d: normalizuj(f.dodatno ?? ''), rijeci };
  cache.set(stavka, { kljuc, p });
  return p;
}

const ALNUM = /[a-z0-9]/;
const pocetakRijeci = (h: string, i: number) => i === 0 || !ALNUM.test(h[i - 1]);
const niz = (od: number, n: number) => Array.from({ length: n }, (_, k) => od + k);

/** Damerau-Levenshtein udaljenost ≤ 1. */
function jednaGreska(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

interface PogodakRijeci { skor: number; idx?: number[]; sifra?: boolean }

function pogodiRijec(t: string, p: Pripremljeno): PogodakRijeci | null {
  // 1) šifra — tačna ili početak (crtice nebitne: "m141" = "M-141")
  if (p.s) {
    const tBez = t.replace(/[-\s./]/g, '');
    if (p.s === t || (tBez && p.sBez === tBez)) return { skor: 320, sifra: true };
    if (p.s.startsWith(t) || (tBez && p.sBez.startsWith(tBez))) return { skor: 160 + t.length, sifra: true };
  }
  const h = p.n;
  // 2) podniz naziva; početak riječi i početak naziva nose više
  let najbolji: PogodakRijeci | null = null;
  for (let idx = h.indexOf(t); idx !== -1; idx = h.indexOf(t, idx + 1)) {
    const skor = 100 + (pocetakRijeci(h, idx) ? 40 : 0) + (idx === 0 ? 20 : 0) - idx * 0.3 + t.length * 2;
    if (!najbolji || skor > najbolji.skor) najbolji = { skor, idx: niz(idx, t.length) };
  }
  if (najbolji) return najbolji;
  // 3) dodatno polje (šifre dobavljača) i dijelovi barkoda
  if ((p.d && p.d.includes(t)) || (t.length >= 4 && p.b.includes(t))) return { skor: 90 };
  // 4) slova redom, zbijena ("hrst" → hrast); probaj od svakog pojavljivanja prvog slova
  if (t.length >= 2) {
    for (let s0 = h.indexOf(t[0]); s0 !== -1; s0 = h.indexOf(t[0], s0 + 1)) {
      const pos = [s0];
      let cons = 0, starts = pocetakRijeci(h, s0) ? 1 : 0;
      for (let i = s0 + 1, j = 1; i < h.length && j < t.length; i++) {
        if (h[i] !== t[j]) continue;
        if (pos[pos.length - 1] === i - 1) cons++;
        if (pocetakRijeci(h, i)) starts++;
        pos.push(i); j++;
      }
      if (pos.length < t.length) break;
      const raspon = pos[pos.length - 1] - pos[0] + 1;
      if (raspon > t.length * 2.2 + 1 || (starts === 0 && cons < t.length - 2)) continue;
      const skor = 45 + cons * 8 + starts * 10 - (raspon - t.length) * 3;
      if (!najbolji || skor > najbolji.skor) najbolji = { skor, idx: pos };
    }
    if (najbolji) return najbolji;
  }
  // 5) jedna greška u kucanju, samo za riječi od 4+ slova
  if (t.length >= 4) {
    for (const { w, i } of p.rijeci) {
      if (w.length < 4) continue;
      if (jednaGreska(t, w) || (w.length > t.length && jednaGreska(t, w.slice(0, t.length)))) {
        return { skor: 30, idx: niz(i, Math.min(w.length, t.length + 1)) };
      }
    }
  }
  return null;
}

export function pretrazi<T extends object>(
  stavke: readonly T[], upit: string, polja: (s: T) => PoljaPretrage, opcije: OpcijePretrage<T> = {},
): Pogodak<T>[] {
  const nq = normalizuj(upit.trim());
  const rijeci = nq.split(/\s+/).filter(Boolean);
  if (!rijeci.length) return [];

  // Čitač barkoda: tačan barkod je jedini smislen rezultat.
  if (/^\d{8,14}$/.test(nq)) {
    const tacni = stavke.filter(s => (polja(s).barkod ?? '') === nq);
    if (tacni.length) return tacni.map(stavka => ({ stavka, skor: 1000, nazivIdx: [], sifraPogodak: false, barkodPogodak: true }));
  }

  const out: Pogodak<T>[] = [];
  for (const stavka of stavke) {
    const f = polja(stavka);
    const p = pripremi(stavka, f);
    let skor = 0, sifraPogodak = false, ok = true;
    const idx = new Set<number>();
    for (const t of rijeci) {
      const r = pogodiRijec(t, p);
      if (!r) { ok = false; break; }
      skor += r.skor;
      if (r.sifra) sifraPogodak = true;
      r.idx?.forEach(i => idx.add(i));
    }
    if (!ok) continue;
    skor += (opcije.bonus?.(stavka, upit) ?? 0) - f.naziv.length * 0.05;
    out.push({ stavka, skor, nazivIdx: [...idx].sort((a, b) => a - b), sifraPogodak, barkodPogodak: false });
  }
  out.sort((a, b) => b.skor - a.skor || polja(a.stavka).naziv.localeCompare(polja(b.stavka).naziv, 'bs'));
  return opcije.max ? out.slice(0, opcije.max) : out;
}

/**
 * Filter liste (tabele računa, ponuda, šifarnika) istim fuzzy pravilima kao PretragaStavki,
 * ali bez preslagivanja: pogođeni redovi ostaju redom kojim su došli (npr. po datumu).
 */
export function filtriraj<T extends object>(stavke: readonly T[], upit: string, polja: (s: T) => PoljaPretrage): T[] {
  if (!upit.trim()) return [...stavke];
  const pogodjeni = new Set(pretrazi(stavke, upit, polja).map(p => p.stavka));
  return stavke.filter(s => pogodjeni.has(s));
}
