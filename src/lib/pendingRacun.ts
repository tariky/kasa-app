import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';

/**
 * Write-ahead zapis računa (pending_receipts, vidi
 * docs/superpowers/specs/2026-07-06-crash-safe-racuni-design.md): snapshot se
 * upiše prije štampe, a briše tek kad je ishod poznat — neuspjeh sa sigurnim
 * ishodom ga briše, nepoznat ishod ga ostavlja za dijalog nezavršenih
 * računa, a uspjeh ga briše u istoj transakciji s upisom računa.
 * Rust: `neuspjela_stampa`, `preuzmi_pending_red` i `vec_evidentiran` u racuni.rs.
 */

export interface NeuspjehStampe {
  success: false;
  error: string;
  odgovori: Record<string, string>;
  /** Račun je možda odštampan — renderer otvara dijalog nezavršenih računa. */
  ishodNepoznat?: true;
}

/**
 * Štampa nije uspjela. Siguran neuspjeh (uređaj odbio, veza odbijena) briše
 * write-ahead red; nepoznat ishod ga ostavlja i vraća poruku koja operatera
 * šalje u dijalog nezavršenih računa.
 */
export function neuspjelaStampa(
  db: SqlDb, pendingId: number, result: Tring.TringResponse | null | undefined,
): NeuspjehStampe {
  const greska = result?.error || result?.vrstaOdgovora || 'Nepoznata greška';
  const odgovori = result?.odgovori ?? {};
  // Kao `ishodNepoznat` iz services/tring — bez runtime importa, jer lib/ se
  // (preko ponuda.ts, prilog.ts, proizvodnja.ts) učitava i u rendereru.
  if (!!result && !result.success && result.ishodNepoznat === true) {
    return {
      success: false,
      error: `Uređaj nije potvrdio račun (${greska}) — ishod štampe nije poznat. ` +
        'Provjerite da li je račun odštampan i riješite ga u dijalogu nezavršenih računa.',
      odgovori,
      ishodNepoznat: true,
    };
  }
  db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
  return { success: false, error: greska, odgovori };
}

export function porukaVecEvidentiran(brojFiskalnogRacuna: string | null): string {
  return `Fiskalni račun BF ${brojFiskalnogRacuna ?? '?'} JE odštampan, ali je njegov nezavršeni zapis u međuvremenu ` +
    'riješen ili odbačen — račun je već evidentiran i drugi zapis nije napravljen. ' +
    'Ako je zapis odbačen, unesite račun ručno.';
}

/**
 * Prvi korak transakcije upisa nakon uspješne štampe: obriše write-ahead red i
 * time preuzme račun. `false` = red više ne postoji (riješen ili odbačen iz
 * dijaloga dok je štampa trajala) — pozivalac tada ne upisuje drugi zapis
 * istog računa nego vraća `vecEvidentiran(...)`.
 */
export function preuzmiPendingRed(db: SqlDb, pendingId: number): boolean {
  return db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId).changes === 1;
}

export interface VecEvidentiran {
  success: false;
  /** Račun je odštampan i već upisan iz dijaloga — ekran ga tretira kao završen, bez novog id-a. */
  vecEvidentiran: true;
  error: string;
  brojFiskalnogRacuna: string | null;
}

/** Odgovor kad `preuzmiPendingRed` vrati false. */
export function vecEvidentiran(brojFiskalnogRacuna: string | null): VecEvidentiran {
  return { success: false, vecEvidentiran: true, error: porukaVecEvidentiran(brojFiskalnogRacuna), brojFiskalnogRacuna };
}

// ─── Dokumenti s vlastitom operacijom upisa ─────────────────
// Ponuda→račun, nalog→račun i storno idu kroz isti write-ahead red; snapshot
// nosi `vrsta` da dijalog nezavršenih računa zna kojom operacijom ga upisati.
// Snapshot bez `vrsta` je običan račun (kasa, faktura) — stare baze.

export type VrstaNezavrsenog = 'ponuda' | 'nalog' | 'storno';

/** Stavka računa u snapshotu ponude/naloga — dovoljna za upis i za prikaz u dijalogu. */
export interface SnapshotStavka {
  productId: number;
  naziv: string;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
  /** 'usluga' ne razdužuje skladište (upisiRacun). */
  productTip?: string | null;
}

export interface SnapshotKupac {
  naziv: string | null; idBroj: string | null; adresa: string | null; grad: string | null; postanskiBroj: string | null;
}

/** Račun po ponudi (ekran Ponude ili nalog iz ponude — tada nosi `nalogId`). */
export interface SnapshotPonude {
  vrsta: 'ponuda';
  ponudaId: number; ponudaBroj: number; ponudaGodina: number;
  nalogId?: number;
  korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string;
  kupac: SnapshotKupac | null;
  stavke: SnapshotStavka[];
}

/** Račun za samostalni nalog po narudžbi (jedna stavka usluge NAMJ). */
export interface SnapshotNaloga {
  vrsta: 'nalog';
  nalogId: number; nalogBroj: number; nalogGodina: number;
  korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string;
  kupac: SnapshotKupac | null;
  stavke: SnapshotStavka[];
}

/**
 * Storno (reklamacija) računa; stavke su samo za prikaz u dijalogu. Nosi i
 * podatke traga 'storno' (pokretač = korisnikId, admin koji je odobrio PIN-om,
 * polog) — trag se upisuje tek kad je storno upisan u bazu, pa i iz dijaloga.
 */
export interface SnapshotStorna {
  vrsta: 'storno';
  orderId: number;
  /** Fiskalni broj računa koji se stornira. */
  brojRacuna: string | null;
  korisnikId: number; ukupno: number;
  odobrioAdminId: number | null;
  /** Automatski polog evidentiran prije štampe (0 = bez pologa). */
  pologIznos: number;
  stavke: Array<{ naziv: string; kolicina: number; cijena: number; rabat: number }>;
}

export function snapshotKupca(k: Partial<Record<keyof SnapshotKupac, string | null>> | null | undefined): SnapshotKupac | null {
  if (!k) return null;
  return {
    naziv: k.naziv ?? null, idBroj: k.idBroj ?? null, adresa: k.adresa ?? null,
    grad: k.grad ?? null, postanskiBroj: k.postanskiBroj ?? null,
  };
}

/** Write-ahead: snapshot se upiše (odmah, van transakcije) prije štampe. */
export function zapisiPending(db: SqlDb, korisnikId: number, snapshot: object): number {
  return Number(db.prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(korisnikId, JSON.stringify(snapshot)).lastInsertRowid);
}

/**
 * Nova štampa dokumenta za koji postoji nerazriješen write-ahead red mogla bi
 * dati drugi fiskalni račun za isti posao — odbija se prije štampe, dok
 * operater ne riješi red (odštampan) ili ga admin ne odbaci (i nalog se tada
 * ne vraća u izradu i ne briše — `radnja`). `kljuc` je polje
 * snapshota (i stara faktura iz ponude nosi `ponudaId`); obje strane se
 * porede kao cijeli brojevi (id iz payload-a može stići i kao tekst).
 * Rust: `baci_ako_ceka_nezavrsen`.
 */
export function baciAkoCekaNezavrsen(
  db: SqlDb, kljuc: 'ponudaId' | 'nalogId' | 'orderId', id: number, dokument: string,
  radnja = 'prije nove štampe',
): void {
  const red = db.prepare(`
    SELECT id FROM pending_receipts
    WHERE CAST(CASE WHEN json_valid(snapshot) THEN json_extract(snapshot, ?) END AS INTEGER) = CAST(? AS INTEGER)
    LIMIT 1
  `).get(`$.${kljuc}`, id);
  if (red) {
    throw new Error(
      `${dokument} čeka u nezavršenim računima (ishod štampe nije poznat) — riješite ga ${radnja}`
    );
  }
}
