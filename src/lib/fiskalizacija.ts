import type { SqlDb } from './sqldb';
import type { IshodUredjaja } from './fiskalniUredjaj';
import {
  neuspjelaStampa, preuzmiPendingRed, vecEvidentiran as vecEvidentiranRacun, zapisiPending,
  type NeuspjehStampe, type VecEvidentiran,
} from './pendingRacun';

/**
 * Tok fiskalnog dokumenta (kasa, faktura, ponuda, nalog, storno) na jednom
 * mjestu: write-ahead snapshot → štampa → ishod → upis u transakciji. Vidi
 * lib/pendingRacun.ts i docs/superpowers/specs/2026-07-06-crash-safe-racuni-design.md.
 *
 * Pozivalac PRIJE `fiskalizuj` uradi sve što može pasti: provjere koje bi
 * oborile upis (odštampan fiskalni dokument se ne može povući), postavke
 * uređaja (`uredjajIzPostavki`) i dokument za uređaj — write-ahead red se
 * upisuje tek kad preostaje samo slanje.
 *
 * Bez runtime importa services/tring: lib/ se (preko ponuda.ts, prilog.ts,
 * proizvodnja.ts) učitava i u rendereru.
 */

export interface FiskalizacijaDeps {
  db: SqlDb;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: <T>(fn: () => T) => () => T;
}

/** Dokument je odštampan i upisan; `id` je ono što je vratio `upisi`. */
export interface Uspjeh<T> {
  success: true;
  id: T;
  brojFiskalnogRacuna: string | null;
  odgovori: Record<string, string>;
}

export interface Fiskalizacija<S extends { korisnikId: number }, T> {
  /** Write-ahead snapshot (oblik po vrsti dokumenta — lib/pendingRacun.ts); red pripada `korisnikId`. */
  snapshot: S;
  /**
   * Štampa na uređaju (račun, ili reklamacija s unosom novca i ponovnim
   * pokušajem). Izuzetak znači da ništa nije odštampano.
   */
  stampaj: () => Promise<IshodUredjaja>;
  /**
   * Upis nakon uspješne štampe, u istoj transakciji u kojoj se preuzima
   * write-ahead red (s vezama: ponuda konvertovana, nalog fakturisan…).
   * `bf` = broj koji je vratio uređaj.
   */
  upisi: (bf: string | null) => T;
  /** Naziv dokumenta u poruci kad upis nakon štampe padne (`porukaNakonStampe`); zadano „Račun <bf>". */
  dokument?: (bf: string | null) => string;
  /** 'ž' za reklamaciju: „JE odštampana, ali nije zabilježena…". */
  rod?: 'm' | 'ž';
  /** Odgovor kad je red u međuvremenu riješen iz dijaloga; zadano za račun (BF). */
  vecEvidentiran?: (bf: string | null) => VecEvidentiran;
}

/**
 * `<dokument> JE odštampan, ali nije zabilježen u bazi: <greška>. Riješite ga
 * kroz nezavršene račune.` — jedina poruka za upis koji padne nakon štampe
 * (`rod` 'ž' za reklamaciju). Rust: `poruka_nakon_stampe`.
 */
export function porukaNakonStampe(dokument: string, greska: string, rod: 'm' | 'ž' = 'm'): string {
  return rod === 'ž'
    ? `${dokument} JE odštampana, ali nije zabilježena u bazi: ${greska}. Riješite je kroz nezavršene račune.`
    : `${dokument} JE odštampan, ali nije zabilježen u bazi: ${greska}. Riješite ga kroz nezavršene račune.`;
}

/**
 * Write-ahead red (odmah, van transakcije) → štampa → ishod:
 * - izuzetak iz štampe: ništa nije odštampano, red se briše, greška ide dalje;
 * - siguran neuspjeh briše red, nepoznat ishod ga ostavlja (`neuspjelaStampa`);
 * - uspjeh: u jednoj transakciji preuzmi red → `upisi`. Red koji je dijalog
 *   nezavršenih u međuvremenu riješio ili odbacio znači bez drugog zapisa
 *   (`vecEvidentiran`). Pad upisa poništi transakciju — red ostaje za dijalog.
 */
export async function fiskalizuj<S extends { korisnikId: number }, T>(
  deps: FiskalizacijaDeps, n: Fiskalizacija<S, T>,
): Promise<Uspjeh<T> | NeuspjehStampe | VecEvidentiran> {
  const { db, transaction } = deps;
  const pendingId = zapisiPending(db, n.snapshot.korisnikId, n.snapshot);

  let ishod: IshodUredjaja;
  try {
    ishod = await n.stampaj();
  } catch (err) {
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    throw err;
  }
  if (!ishod.ok) return neuspjelaStampa(db, pendingId, ishod);

  const bf = ishod.bf;
  let upis: { id: T } | null;
  try {
    upis = transaction(() => (preuzmiPendingRed(db, pendingId) ? { id: n.upisi(bf) } : null))();
  } catch (err) {
    // Dokument je već na papiru; red ostaje (rollback) za dijalog nezavršenih.
    const dokument = n.dokument ? n.dokument(bf) : `Račun ${bf ?? '?'}`;
    throw new Error(porukaNakonStampe(dokument, (err as Error | null)?.message || 'nepoznata greška', n.rod));
  }
  if (upis === null) return (n.vecEvidentiran ?? vecEvidentiranRacun)(bf);

  return { success: true, id: upis.id, brojFiskalnogRacuna: bf, odgovori: ishod.odgovori };
}

/** Ključevi dokumenata čija je štampa u toku (ponuda, nalog, storno). */
const kljuceviUToku = new Set<string>();

/**
 * Zaštita od dvoklika: dok poziv za isti dokument (`kljuc`, npr. `ponuda:5`)
 * traje, drugi se odbija porukom `poruka`. Ključ se zauzme prije provjera —
 * dok štampa traje, red u nezavršenim već postoji, pa bi drugi poziv inače
 * dobio poruku o nezavršenom računu — i oslobodi kad `fn` završi, i uz grešku.
 * Rust: `UToku`.
 */
export async function uToku<T>(kljuc: string, poruka: string, fn: () => Promise<T>): Promise<T> {
  if (kljuceviUToku.has(kljuc)) throw new Error(poruka);
  kljuceviUToku.add(kljuc);
  try {
    return await fn();
  } finally {
    kljuceviUToku.delete(kljuc);
  }
}
