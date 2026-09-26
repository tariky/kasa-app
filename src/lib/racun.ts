import type { SqlDb } from './sqldb';
import { round2 } from './novac';
import { PDV_FAKTOR_E } from './pdv';
import * as zaliha from './zaliha';

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
  /** Račun po prilogu nema stavki (zbirna stavka živi samo na uređaju). */
  stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  /** Račun upisan iz dijaloga nezavršenih računa: datum s papira, označen kao ručni. */
  createdAt?: string;
  isManual?: 0 | 1;
  /** Račun po prilogu: interni broj priloga i naziv zbirne stavke. */
  prilogBroj?: number | null;
  prilogNaziv?: string | null;
  /** Faktura: rok plaćanja; napomena fakture ili računa sa kase. */
  datumValute?: string | null;
  napomena?: string | null;
}

/** Kupac kolona u `orders`: prazan tekst (i samo razmaci) je NULL — odluka 3. */
function kolonaKupca(v: string | null | undefined): string | null {
  return v == null || (typeof v === 'string' && v.trim() === '') ? null : v;
}

/**
 * Upis već odštampanog fiskalnog računa: orders + order_items + izlaz
 * skladišta. Jedini INSERT u `orders` — kasa, ručni račun, faktura (prilog),
 * ponuda, nalog i dijalog nezavršenih računa. Poziva se u transakciji, tek
 * nakon uspješne štampe (ili s brojem s papira). Izlaz ide kroz knjigu zalihe
 * (usluga ne razdužuje; tip artikla iz baze). Rust: `upisi_racun` u racun.rs.
 */
export function upisiRacun(db: SqlDb, input: UpisRacunaInput): number {
  const k = input.kupac;
  // Bez datuma: zadani datum kolone (sada), kao i ranije.
  const createdAt = input.createdAt || null;
  const orderRes = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
      kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, createdAt,
      prilogBroj, prilogNaziv, datumValute, napomena)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?)
  `).run(
    input.korisnikId, input.ukupno, input.pdvIznos, input.nacinPlacanja, input.brojFiskalnogRacuna,
    kolonaKupca(k?.naziv), kolonaKupca(k?.idBroj), kolonaKupca(k?.adresa), kolonaKupca(k?.grad),
    kolonaKupca(k?.postanskiBroj), input.isManual ?? 0, createdAt,
    input.prilogBroj ?? null, input.prilogNaziv ?? null, input.datumValute ?? null, input.napomena ?? null
  );
  const orderId = Number(orderRes.lastInsertRowid);

  const insertItem = db.prepare(
    'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of input.stavke) insertItem.run(orderId, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
  zaliha.knjizi(db, { vrsta: 'order', id: orderId }, 'izlaz', input.stavke, { datum: createdAt ?? undefined });
  return orderId;
}
