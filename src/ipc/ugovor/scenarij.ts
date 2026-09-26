// Zajednički rječnik ugovornih testova (vidi backend.ts): priprema podataka i
// čitanje stanja baze, isto nad oba backenda.
//
// Seed ide direktno u bazu, bez kanala — kanali imaju popratne efekte
// (sesija, audit, validacija, štampa) koje test pripreme ne smije okinuti.
// Stanje zalihe se čita iz knjige (stock_movements), jednom kopijom formule:
// `product:get` stanje ne vraća, a `product:getAll` preskače slobodne stavke
// i traži prijavu.
import type { SQLQueryBindings } from 'bun:sqlite';
import type { Backend } from './backend';
import { hesirajPin } from '../../lib/korisnici';

/** Seedovani admin (getDb); harness mu postavi ADMIN_PIN i prijavi se. */
export const ADMIN = 1;

type Polje = string | number | null | undefined;

export interface NoviArtikalUBazi {
  sifra: string;
  /** Zadano `Artikal <šifra>`. */
  naziv?: string;
  /** Zadano 10. */
  cijena?: number;
  /** Zadano 'artikal'. */
  tip?: string;
  /** Zadano 'kom'. */
  jm?: string;
  /** Zadano 'E'. */
  pdvStopa?: string;
  /** Zadano 1. */
  plu?: number | null;
  barkod?: string | null;
  slobodan?: number;
  plocaSirina?: number | null;
  plocaVisina?: number | null;
  /** Ulaz na zalihu jednim kretanjem ('test', 0); bez njega (ili 0) nema kretanja. */
  stanje?: number;
}

export interface NoviKupacUBazi {
  /** Zadano 'Firma d.o.o.'. */
  naziv?: string;
  /** Zadano '4200000000001'. */
  idBroj?: string;
  pdvBroj?: string | null;
  adresa?: string | null;
  postanskiBroj?: string | null;
  grad?: string | null;
  kontakt?: string | null;
}

export interface NoviRacunUBazi {
  /** Zadano ADMIN. */
  korisnikId?: number;
  /** Zadano 10. */
  ukupno?: number;
  /** Zadano 0. */
  pdvIznos?: number;
  /** Zadano 'Gotovina'. */
  nacinPlacanja?: string;
  brojFiskalnogRacuna?: string | null;
  /** Zadano 'refunded' kad je dat refundedAt, inače 'completed'. */
  status?: string;
  refundedAt?: string | null;
  brojReklamacije?: string | null;
  prilogBroj?: number | null;
  prilogNaziv?: string | null;
  kupacNaziv?: string | null;
  kupacIdBroj?: string | null;
  /** Bez njega: zadana vrijednost kolone (lokalno vrijeme sada). */
  createdAt?: string;
  /** Stavke (order_items), bez kretanja zalihe. */
  stavke?: Array<{ productId: number; kolicina: number; cijena: number; pdvStopa?: string; rabat?: number }>;
}

/** Scenarij nad backendom testa; `b` može biti funkcija kad se backend otvara po testu. */
export function scenarij(backend: Backend | (() => Backend)) {
  const b = () => (typeof backend === 'function' ? backend() : backend);

  /** INSERT samo zadanih kolona (ostale dobiju zadanu vrijednost iz sheme); vraća id reda. */
  function upisi(tabela: string, polja: Record<string, Polje>): number {
    const kolone = Object.entries(polja).filter(([, v]) => v !== undefined);
    const sql = `INSERT INTO ${tabela} (${kolone.map(([k]) => k).join(', ')}) VALUES (${kolone.map(() => '?').join(', ')})`;
    return Number(b().db.prepare(sql).run(...kolone.map(([, v]) => v as SQLQueryBindings)).lastInsertRowid);
  }

  /** Prvi red upita (undefined kad ga nema); kolone nisu tipizirane. */
  function red(sql: string, ...params: SQLQueryBindings[]): any {
    return b().db.prepare(sql).get(...params);
  }

  function redovi(sql: string, ...params: SQLQueryBindings[]): any[] {
    return b().db.prepare(sql).all(...params);
  }

  /** Prva kolona prvog reda — COUNT, SUM, jedna vrijednost. */
  function broj(sql: string, ...params: SQLQueryBindings[]): number {
    return b().db.prepare(sql).values(...params)[0][0] as number;
  }

  /** Stanje artikla iz knjige zalihe: ulazi − izlazi. */
  function stanje(productId: number): number {
    return broj(`
      SELECT COALESCE(SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0)
      FROM stock_movements WHERE productId = ?
    `, productId);
  }

  /** Bez vrijednosti: postavka iz baze (null kad je nema). S vrijednošću: upiše je. */
  function postavka(kljuc: string): string | null;
  function postavka(kljuc: string, vrijednost: string): void;
  function postavka(kljuc: string, vrijednost?: string): string | null | void {
    if (vrijednost === undefined) return red('SELECT value FROM settings WHERE key = ?', kljuc)?.value ?? null;
    b().db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(kljuc, vrijednost);
  }

  /** Kretanje zalihe upisano direktno; zadano dokument 'test' 0 i lokalno vrijeme sada. */
  function kretanje(k: {
    productId: number; tip: 'ulaz' | 'izlaz'; kolicina: number;
    referenceType?: string; referenceId?: number; createdAt?: string;
  }): number {
    return upisi('stock_movements', { referenceType: 'test', referenceId: 0, ...k });
  }

  function artikal(a: NoviArtikalUBazi): number {
    const id = upisi('products', {
      sifra: a.sifra, naziv: a.naziv ?? `Artikal ${a.sifra}`, jm: a.jm ?? 'kom', cijena: a.cijena ?? 10,
      pdvStopa: a.pdvStopa ?? 'E', plu: a.plu === undefined ? 1 : a.plu, barkod: a.barkod, tip: a.tip ?? 'artikal',
      slobodan: a.slobodan, plocaSirina: a.plocaSirina, plocaVisina: a.plocaVisina,
    });
    if (a.stanje) kretanje({ productId: id, tip: 'ulaz', kolicina: a.stanje });
    return id;
  }

  function kupac(k: NoviKupacUBazi = {}): number {
    return upisi('kupci', { ...k, naziv: k.naziv ?? 'Firma d.o.o.', idBroj: k.idBroj ?? '4200000000001' });
  }

  /** Korisnik s heširanim PIN-om, kao da ga je upisao user:create. */
  function korisnik(ime: string, pin: string, uloga: 'admin' | 'kasir' = 'kasir'): number {
    return upisi('users', { ime, pin: hesirajPin(pin), uloga });
  }

  /** Račun upisan direktno (bez štampe i bez kretanja zalihe). */
  function racun(r: NoviRacunUBazi = {}): number {
    const { stavke, ...polja } = r;
    const id = upisi('orders', {
      ...polja,
      korisnikId: r.korisnikId ?? ADMIN, ukupno: r.ukupno ?? 10, pdvIznos: r.pdvIznos ?? 0,
      nacinPlacanja: r.nacinPlacanja ?? 'Gotovina', status: r.status ?? (r.refundedAt ? 'refunded' : 'completed'),
    });
    for (const s of stavke ?? []) {
      upisi('order_items', { orderId: id, productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.pdvStopa ?? 'E' });
    }
    return id;
  }

  /** Stavka računa s kase: `stavka` sa šifrom, nazivom, JM i PLU artikla iz baze. */
  function kasaStavka(productId: number, kolicina: number, cijena: number, extra: Record<string, unknown> = {}) {
    const a = red('SELECT sifra, naziv, jm, plu FROM products WHERE id = ?', productId);
    return { ...stavka(productId, kolicina, cijena, extra), sifra: a.sifra as string, naziv: a.naziv as string, jm: a.jm as string, plu: a.plu as number | null };
  }

  return { upisi, red, redovi, broj, stanje, postavka, kretanje, artikal, kupac, korisnik, racun, kasaStavka };
}

export type Scenarij = ReturnType<typeof scenarij>;

const dvije = (n: number) => String(n).padStart(2, '0');

/** Datum kao lokalni "YYYY-MM-DD" — tako ga upisuje backend. */
export function danas(d: Date = new Date()): string {
  return `${d.getFullYear()}-${dvije(d.getMonth() + 1)}-${dvije(d.getDate())}`;
}

/** Vrijeme kao lokalni "YYYY-MM-DD HH:MM:SS" (zadano: sada). */
export function sada(d: Date = new Date()): string {
  return `${danas(d)} ${dvije(d.getHours())}:${dvije(d.getMinutes())}:${dvije(d.getSeconds())}`;
}

/** Stavka računa, ponude ili naloga iz ponude: bez rabata, stopa E. */
export function stavka(productId: number, kolicina: number, cijena: number, extra: Record<string, unknown> = {}) {
  return { productId, kolicina, cijena, rabat: 0, pdvStopa: 'E', ...extra };
}

/** Stavka primke: kao `stavka`, s nabavnom cijenom 5. */
export function stavkaPrimke(productId: number, kolicina: number, cijena: number, extra: Record<string, unknown> = {}) {
  return { productId, kolicina, cijena, nabavnaCijena: 5, rabat: 0, pdvStopa: 'E', ...extra };
}

/** Unos primke za primka:create/update/pregled*: datum 2026-03-10. */
export function primka(brojPrimke: string, stavke: ReturnType<typeof stavkaPrimke>[], extra: Record<string, unknown> = {}) {
  return { brojPrimke, datum: '2026-03-10', stavke, ...extra };
}

// ─── Sužavanje tipiziranog rezultata (Backend.pozovi) ───────
// Bacaju s cijelim odgovorom kad oblik nije očekivani; nisu tvrdnje (expect),
// pa ne mijenjaju broj expect() poziva — tvrdnje testa ostaju gdje jesu.

/** Vrijednost koja mora postojati (nije null ni undefined). */
export function postoji<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('Očekivana vrijednost, dobijeno: ' + String(x));
  return x;
}

/** Uspješan ishod (`success: true`) unije ishoda. */
export function uspjeh<R extends { success: boolean }>(r: R): Extract<R, { success: true }> {
  if (!r.success) throw new Error('Očekivan uspjeh: ' + JSON.stringify(r));
  return r as Extract<R, { success: true }>;
}

/** Neuspjeh (`success: false`) unije ishoda — i „već evidentiran". */
export function neuspjeh<R extends { success: boolean }>(r: R): Exclude<R, { success: true }> {
  if (r.success) throw new Error('Očekivan neuspjeh: ' + JSON.stringify(r));
  return r as Exclude<R, { success: true }>;
}

/** Neuspjela štampa (`success: false`, nije „već evidentiran"). */
export function neuspjehStampe<R extends { success: boolean }>(r: R): Exclude<R, { success: true } | { vecEvidentiran: true }> {
  if (r.success || 'vecEvidentiran' in r) throw new Error('Očekivan neuspjeh štampe: ' + JSON.stringify(r));
  return r as Exclude<R, { success: true } | { vecEvidentiran: true }>;
}

/** Primka je spremljena (backend nije vratio novi pregled). */
export function spremljena<R extends object>(r: R): Exclude<R, { promijenjeno: true }> {
  if ('promijenjeno' in r) throw new Error('Očekivano spremanje, dobijen novi pregled: ' + JSON.stringify(r));
  return r as Exclude<R, { promijenjeno: true }>;
}

/** Potvrda ne odgovara stanju: backend je vratio novi pregled umjesto spremanja. */
export function promijenjeno<R extends object | null>(r: R): Extract<R, { promijenjeno: true }> {
  if (r === null || !('promijenjeno' in r)) throw new Error('Očekivan novi pregled: ' + JSON.stringify(r));
  return r as Extract<R, { promijenjeno: true }>;
}
