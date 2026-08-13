import type { SqlDb } from './sqldb';
import { round2 } from './novac';
import { iznosStavke } from './racun';

/**
 * Račun po prilogu: fiskalno se kuca jedna zbirna stavka, a stvarne stavke se
 * naknadno dodjeljuju (prilog_stavke) i printaju kao specifikacija sa BF
 * brojem. Vidi docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md.
 */

export const PRILOG_SIFRA = 'PRILOG';

export function prilogNaziv(broj: number): string {
  return `Stavke po računu br. ${broj}`;
}

/** Interni broj priloga: nastavlja se na najveći do sada izdati. */
export function sljedeciPrilogBroj(db: SqlDb): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(prilogBroj), 0) + 1 AS broj FROM orders')
    .get() as { broj: number };
  return row.broj;
}

export interface PrilogStavkaUnos {
  productId: number;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
}

/** Zbir stavki priloga — zaokruživanje po stavci kao na fiskalnom uređaju. */
export function sumaPriloga(stavke: PrilogStavkaUnos[]): number {
  return round2(stavke.reduce((sum, s) => sum + iznosStavke({ ...s, rabat: 0 }), 0));
}

/** Prilog je kompletan tek kad se suma stavki poklopi sa fiskalnim iznosom. */
export function prilogKompletan(ukupno: number, stavke: PrilogStavkaUnos[]): boolean {
  return sumaPriloga(stavke) === round2(ukupno);
}

/** Zbirna stavka kako se šalje fiskalnom uređaju (i sintetizuje u prikazima). */
export function buildPrilogFiskalnaStavka(prilogBroj: number, iznos: number) {
  return {
    productId: 0,
    sifra: PRILOG_SIFRA,
    naziv: prilogNaziv(prilogBroj),
    jm: 'kom',
    plu: 0,
    cijena: round2(iznos),
    kolicina: 1,
    rabat: 0,
    pdvStopa: 'E',
  };
}
