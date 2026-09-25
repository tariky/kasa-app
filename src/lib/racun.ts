import type { SqlDb } from './sqldb';
import { round2 } from './novac';
import { PDV_FAKTOR_E } from './pdv';

export interface RacunStavka {
  cijena: number;
  kolicina: number;
  rabat: number; // postotak 0–100
  pdvStopa: string; // 'E' | 'K'
}

/**
 * Iznos jedne stavke, zaokružen na fene. Fiskalni uređaj računa i zaokružuje
 * po stavci, pa se i ovdje mora zaokruživati po stavci — inače zbir koji
 * šaljemo u <Iznos> ne odgovara zbiru koji uređaj sam ispiše.
 */
export function iznosStavke(s: RacunStavka): number {
  return round2(s.cijena * s.kolicina * (1 - s.rabat / 100));
}

/**
 * PDV sadržan u iznosu jedne stavke. Cijene su sa uračunatim PDV-om, pa se PDV
 * izlučuje iz iznosa. Stopa 'K' je oslobođena PDV-a → 0.
 *
 * Nezaokruženo namjerno: zbir se zaokružuje jednom, u `izracunajTotale`.
 * Za prikaz po stavci zaokružuje sam formatter, pa se kolona PDV-a na
 * dokumentu može razlikovati od ukupnog PDV-a za fening.
 */
export function pdvStavke(s: RacunStavka): number {
  if (s.pdvStopa !== 'E') return 0;
  const iznos = iznosStavke(s);
  return iznos - iznos / PDV_FAKTOR_E;
}

/**
 * Koliko iznos koji pošalje ekran smije odstupati od iznosa izračunatog iz
 * stavki (pola feninga; iznad toga backend odbija račun).
 */
export const TOLERANCIJA_IZNOSA = 0.005;

export function izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number } {
  const ukupno = round2(stavke.reduce((sum, s) => sum + iznosStavke(s), 0));
  const pdvIznos = round2(stavke.reduce((sum, s) => sum + pdvStavke(s), 0));
  return { ukupno, pdvIznos };
}

export interface UpisRacunaInput {
  korisnikId: number;
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  brojFiskalnogRacuna: string | null;
  kupac?: {
    naziv?: string | null; idBroj?: string | null; adresa?: string | null;
    grad?: string | null; postanskiBroj?: string | null;
  } | null;
  stavke: Array<{
    productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string;
    /** 'usluga' ne razdužuje skladište. */
    productTip?: string;
  }>;
}

/**
 * Upis već odštampanog fiskalnog računa: orders + order_items + izlaz
 * skladišta. Zajedničko za konverziju ponude i račun iz radnog naloga.
 * Poziva se u transakciji, tek nakon uspješne štampe.
 */
export function upisiRacun(db: SqlDb, input: UpisRacunaInput): number {
  const k = input.kupac;
  const orderRes = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
      kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
  `).run(
    input.korisnikId, input.ukupno, input.pdvIznos, input.nacinPlacanja, input.brojFiskalnogRacuna,
    k?.naziv ?? null, k?.idBroj ?? null, k?.adresa ?? null, k?.grad ?? null, k?.postanskiBroj ?? null
  );
  const orderId = Number(orderRes.lastInsertRowid);

  const insertItem = db.prepare(
    'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)"
  );
  for (const s of input.stavke) {
    insertItem.run(orderId, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
    if (s.productTip !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
  }
  return orderId;
}
