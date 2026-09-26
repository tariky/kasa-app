// src/lib/kupacRacuna.ts
// Kupac na računu kako ga kucaju kasa, faktura i ručni račun. Bez React-a.
import type { Kupac } from '@/types';

/**
 * Kupac na računu u formi — sva polja su tekst, prazan string = nije uneseno.
 * Isti oblik backend provjerava kao `KupacRacuna` u provjeraRacuna.ts.
 */
export interface KupacRacuna {
  idBroj: string;
  naziv: string;
  adresa: string;
  postanskiBroj: string;
  grad: string;
}

/** Najveća dužina polja koju Tring štampa na računu (i šifarnik kupaca dozvoljava). */
export const KUPAC_LIMITI: Readonly<Record<keyof KupacRacuna, number>> = {
  idBroj: 13, naziv: 32, adresa: 32, postanskiBroj: 5, grad: 26,
};

export const PRAZAN_KUPAC: KupacRacuna = { idBroj: '', naziv: '', adresa: '', postanskiBroj: '', grad: '' };

/** Kupac iz šifarnika → polja računa. */
export function izKupca(k: Kupac): KupacRacuna {
  return {
    idBroj: k.idBroj ?? '', naziv: k.naziv ?? '', adresa: k.adresa ?? '',
    postanskiBroj: k.postanskiBroj ?? '', grad: k.grad ?? '',
  };
}

/**
 * Kupac za slanje uz račun: polja bez razmaka na krajevima. Bez ID broja kupca
 * nema (račun ide na krajnjeg kupca) — vraća `undefined`, a backend upisuje NULL.
 */
export function zaSlanje(k: KupacRacuna): KupacRacuna | undefined {
  const idBroj = k.idBroj.trim();
  if (!idBroj) return undefined;
  return {
    idBroj, naziv: k.naziv.trim(), adresa: k.adresa.trim(), postanskiBroj: k.postanskiBroj.trim(), grad: k.grad.trim(),
  };
}
