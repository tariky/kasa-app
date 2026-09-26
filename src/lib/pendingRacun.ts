import type * as Tring from '@/services/tring';
import { ishodNepoznat } from '../services/tring';
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
  if (ishodNepoznat(result)) {
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
