import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { izracunajTotale, TOLERANCIJA_IZNOSA } from './racun';
import { pripremiPlacanje } from './placanje';

// Provjera računa i ponuda u main procesu, prije ikakve štampe ili upisa:
// renderer šalje stavke, a iznosi se ovdje računaju iz njih (izracunajTotale).
// Cijenu stavke kasir smije mijenjati (ručni račun, ponuda, rabat na kasi),
// pa se ne poredi s cjenovnikom — provjerava se samo da je smislena.

export const PDV_STOPE = ['E', 'K'] as const;
export type PdvStopa = typeof PDV_STOPE[number];

const konacan = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Količina, cijena i rabat jedne stavke (račun, ponuda, prilog): količina
 * konačan broj > 0, cijena konačan broj ≥ 0, rabat (nedostaje = 0) konačan
 * broj u [0, 100] — 100 % je stavka od 0 KM (kasa ga nudi).
 */
export function provjeriIznoseStavke(s: { kolicina?: unknown; cijena?: unknown; rabat?: unknown }): void {
  if (!(konacan(s.kolicina) && s.kolicina > 0)) throw new Error('Količina mora biti veća od 0');
  if (!konacan(s.cijena)) throw new Error('Cijena mora biti broj');
  if (s.cijena < 0) throw new Error('Cijena ne može biti negativna');
  const rabat = s.rabat ?? 0;
  if (!(konacan(rabat) && rabat >= 0 && rabat <= 100)) throw new Error('Rabat mora biti od 0 do 100 %');
}

/** Artikal stavke kako je u bazi — za štampu i za provjeru stope. */
export interface ArtikalStavke {
  sifra: string; naziv: string; jm: string | null; plu: number | null; tip: string; pdvStopa: string;
}

export interface ProvjerenaStavka {
  productId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: PdvStopa;
  artikal: ArtikalStavke;
}

/**
 * Provjeri svaku stavku (iznosi, stopa E/K, artikal postoji — productId mora
 * biti cijeli broj) i vrati je svedenu na polja ugovora. Prazna lista nije
 * greška ovdje: poruku za nju daje pozivalac.
 */
export function provjeriStavke(db: SqlDb, stavke: unknown): ProvjerenaStavka[] {
  if (!Array.isArray(stavke)) throw new Error('Neispravna stavka računa');
  const artikal = db.prepare('SELECT sifra, naziv, jm, plu, tip, pdvStopa FROM products WHERE id = ?');
  return stavke.map((s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('Neispravna stavka računa');
    const x = s as Record<string, unknown>;
    provjeriIznoseStavke(x);
    if (!(PDV_STOPE as readonly unknown[]).includes(x.pdvStopa)) throw new Error('PDV stopa mora biti E ili K');
    const a = Number.isInteger(x.productId) ? artikal.get(x.productId) as ArtikalStavke | undefined : undefined;
    if (!a) throw new Error(`Proizvod #${x.productId} ne postoji`);
    return {
      productId: x.productId as number, kolicina: x.kolicina as number, cijena: x.cijena as number,
      rabat: (x.rabat ?? 0) as number, pdvStopa: x.pdvStopa as PdvStopa, artikal: a,
    };
  });
}

const prikazIznosa = (v: unknown) => (konacan(v) ? v.toFixed(2) : JSON.stringify(v));

/**
 * Ukupno/PDV koje je poslao ekran smiju odstupati od izračunatih najviše
 * TOLERANCIJA_IZNOSA; izostavljeni (null/undefined) se ne provjeravaju. U
 * bazu i na uređaj uvijek ide izračunata vrijednost.
 */
export function provjeriTotale(
  zadano: { ukupno?: unknown; pdvIznos?: unknown },
  izracunato: { ukupno: number; pdvIznos: number },
): void {
  const provjeri = (vrijednost: unknown, tacno: number, naziv: string) => {
    if (vrijednost === undefined || vrijednost === null) return;
    if (!(konacan(vrijednost) && Math.abs(vrijednost - tacno) <= TOLERANCIJA_IZNOSA + 1e-9)) {
      throw new Error(`${naziv} (${prikazIznosa(vrijednost)}) ne odgovara stavkama (${tacno.toFixed(2)})`);
    }
  };
  provjeri(zadano.ukupno, izracunato.ukupno, 'Ukupan iznos');
  provjeri(zadano.pdvIznos, izracunato.pdvIznos, 'Iznos PDV-a');
}

export interface KupacRacuna {
  naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string;
}

const POLJA_KUPCA = ['naziv', 'idBroj', 'adresa', 'grad', 'postanskiBroj'] as const;

/**
 * Kupac s računa: nema ga (null/undefined) ili je objekat čija su poznata
 * polja tekst (ili nedostaju). Ostala polja se odbacuju. Upis objekta u
 * kolonu bi pao tek nakon štampe.
 */
export function provjeriKupca(kupac: unknown): KupacRacuna | undefined {
  if (kupac === undefined || kupac === null) return undefined;
  if (typeof kupac !== 'object' || Array.isArray(kupac)) throw new Error('Neispravni podaci kupca');
  const k = kupac as Record<string, unknown>;
  const rezultat: KupacRacuna = {};
  for (const polje of POLJA_KUPCA) {
    const v = k[polje];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw new Error('Neispravni podaci kupca');
    rezultat[polje] = v;
  }
  return rezultat;
}

export interface PripremljenRacun {
  stavke: ProvjerenaStavka[];
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  vrstePlacanja: Tring.VrstaPlacanja[];
  kupac?: KupacRacuna;
  napomena?: string;
}

/**
 * Račun iz payload-a (order:finalize, order:createManual), provjeren redom:
 * stavke (bar jedna, svaka ispravna), stopa stavke = stopa artikla (samo uz
 * `stopaArtikla` — kasa; ručni račun prepisuje stari isječak), ukupno i PDV
 * (provjeriTotale), plaćanje (pripremiPlacanje), kupac, napomena (tekst).
 * Sva ostala polja payload-a se ignorišu.
 */
export function pripremiRacun(db: SqlDb, unos: unknown, opcije: { stopaArtikla: boolean }): PripremljenRacun {
  const u = (unos && typeof unos === 'object' ? unos : {}) as Record<string, unknown>;
  if (!Array.isArray(u.stavke) || u.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
  const stavke = provjeriStavke(db, u.stavke);
  if (opcije.stopaArtikla) {
    for (const s of stavke) {
      if (s.pdvStopa !== s.artikal.pdvStopa) {
        throw new Error(`PDV stopa stavke "${s.artikal.naziv}" ne odgovara artiklu (${s.artikal.pdvStopa})`);
      }
    }
  }
  const { ukupno, pdvIznos } = izracunajTotale(stavke);
  provjeriTotale(u, { ukupno, pdvIznos });
  const { nacinPlacanja, vrstePlacanja } = pripremiPlacanje(u.nacinPlacanja, u.vrstePlacanja, ukupno);
  const kupac = provjeriKupca(u.kupac);
  if (u.napomena !== undefined && u.napomena !== null && typeof u.napomena !== 'string') {
    throw new Error('Napomena mora biti tekst');
  }
  const napomena = (u.napomena as string | null | undefined) ?? undefined;
  return { stavke, ukupno, pdvIznos, nacinPlacanja, vrstePlacanja, kupac, napomena };
}
