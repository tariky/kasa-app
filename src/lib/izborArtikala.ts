import type { Product } from '@/types';

/**
 * Čista logika tastature za izbor artikala na kasi: kako se kursor kreće po
 * listi i koji artikal Enter dodaje. Komponenta samo crta; ovo se testira.
 */

const STRANICA = 10;

/**
 * Novi indeks kursora za tipku, ili null ako tipka ne pomjera kursor.
 * Strelice se vrte ukrug (sa zadnjeg reda na prvi); PageUp/PageDown skaču
 * za deset redova i staju na rubovima. Kursor -1 znači „nijedan red“.
 */
export function pomjeriKursor(trenutni: number, tipka: string, duzina: number): number | null {
  if (duzina <= 0) return null;
  const zadnji = duzina - 1;
  switch (tipka) {
    case 'ArrowDown': return trenutni >= zadnji ? 0 : trenutni + 1;
    case 'ArrowUp': return trenutni <= 0 ? zadnji : trenutni - 1;
    case 'PageDown': return Math.min(zadnji, Math.max(-1, trenutni) + STRANICA);
    case 'PageUp': return Math.max(0, trenutni - STRANICA);
    default: return null;
  }
}

/**
 * Artikal koji Enter dodaje u košaricu, ili null ako nema jednoznačnog izbora.
 *
 * Redoslijed:
 * 1. red na koji je korisnik sam došao strelicama (kursor > 0);
 * 2. tačna šifra ili barkod među svježim rezultatima — put za skener, radi i
 *    prije nego što debounce osvježi listu na ekranu;
 * 3. red pod kursorom (kursor 0 je automatski na prvom rezultatu pretrage);
 * 4. jedini rezultat pretrage.
 * Više rezultata bez vidljivog kursora ne dodaje ništa — kasir još nije vidio listu.
 */
export function artikalZaEnter(opts: {
  query: string;
  kursor: number;
  prikazani: Product[];
  rezultati: Product[];
}): Product | null {
  const { kursor, prikazani, rezultati } = opts;
  const q = opts.query.trim();
  const podKursorom = kursor >= 0 && kursor < prikazani.length ? prikazani[kursor] : null;

  if (kursor > 0 && podKursorom) return podKursorom;
  if (q) {
    const tacan = rezultati.find(p => p.sifra === q || p.barkod === q);
    if (tacan) return tacan;
  }
  if (podKursorom) return podKursorom;
  if (q && rezultati.length === 1) return rezultati[0];
  return null;
}

/** Artikal se ne može prodati: zaliha je 0, a prodaja bez zalihe nije dozvoljena. Usluge nemaju zalihu. */
export function nemaNaStanju(product: Product, allowZeroStock: boolean): boolean {
  if (allowZeroStock || product.tip === 'usluga') return false;
  return product.stanje != null && product.stanje <= 0;
}
