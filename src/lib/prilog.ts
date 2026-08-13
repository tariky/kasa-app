import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { round2 } from './novac';
import { iznosStavke, izracunajTotale } from './racun';
import { buildTringRacun } from './tringRacun';

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

/**
 * Zamijeni kompletan set stavki priloga i sinhronizuj zalihe.
 *
 * Poziva se unutar transakcije (handler omotava u db.transaction). Diff je
 * najjednostavniji mogući: obriši stara kretanja tipa 'prilog' pa upiši nova —
 * neto efekat na zalihu je isti kao ručni diff, a nema stanja za greške.
 *
 * Sve provjere idu prije prvog upisa da poziv bez transakcije (testovi) ne
 * ostavi pola stavki u bazi.
 */
export function savePrilogStavkeInTransaction(
  db: SqlDb,
  orderId: number,
  stavke: PrilogStavkaUnos[]
): void {
  const order = db.prepare('SELECT prilogBroj, status FROM orders WHERE id = ?').get(orderId) as
    { prilogBroj: number | null; status: string } | undefined;
  if (!order) throw new Error('Račun ne postoji');
  if (order.prilogBroj == null) throw new Error('Ovo nije račun po prilogu');
  if (order.status !== 'completed') throw new Error('Račun je storniran — prilog se ne može mijenjati');

  // Tip proizvoda odlučuje da li stavka dira zalihu (usluge nemaju zalihu).
  const tipovi = new Map<number, string>();
  for (const s of stavke) {
    if (!(s.kolicina > 0)) throw new Error('Količina mora biti veća od 0');
    if (s.cijena < 0) throw new Error('Cijena ne može biti negativna');
    if (s.pdvStopa !== 'E') {
      throw new Error('U prilog smiju samo stavke sa PDV stopom E (zbirna stavka je fiskalizovana sa E)');
    }
    const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(s.productId) as { tip: string } | undefined;
    if (!product) throw new Error(`Proizvod #${s.productId} ne postoji`);
    tipovi.set(s.productId, product.tip);
  }

  db.prepare('DELETE FROM prilog_stavke WHERE orderId = ?').run(orderId);
  db.prepare("DELETE FROM stock_movements WHERE referenceType = 'prilog' AND referenceId = ?").run(orderId);

  const insertStavka = db.prepare(
    'INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'prilog', ?)"
  );

  for (const s of stavke) {
    insertStavka.run(orderId, s.productId, s.kolicina, s.cijena, s.pdvStopa);
    if (tipovi.get(s.productId) !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
  }
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

export interface FinalizePrilogDeps {
  db: SqlDb;
  /** Štampa fiskalni račun na uređaju. */
  print: (racun: Tring.Racun) => Promise<Tring.TringResponse | null>;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: (fn: () => void) => () => void;
}

export interface FinalizePrilogResult {
  success: boolean;
  id?: number;
  prilogBroj?: number;
  brojFiskalnogRacuna?: string | null;
  error?: string;
  odgovori?: Record<string, string>;
}

/**
 * Fiskalizuje račun po prilogu: jedna zbirna stavka, ručno unesen iznos.
 * Isti write-ahead obrazac kao order:finalize — snapshot u pending_receipts
 * prije štampe, pa atomični upis ordera + brisanje pending reda.
 */
export async function finalizePrilogAndPrint(
  deps: FinalizePrilogDeps,
  data: {
    korisnikId: number;
    iznos: number;
    nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
  }
): Promise<FinalizePrilogResult> {
  const { db, print, transaction } = deps;
  if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
  if (!(data.iznos > 0)) throw new Error('Iznos mora biti veći od 0');

  const prilogBroj = sljedeciPrilogBroj(db);
  const stavka = buildPrilogFiskalnaStavka(prilogBroj, data.iznos);
  const { ukupno, pdvIznos } = izracunajTotale([stavka]);

  // Write-ahead: stavke:[] + prilogBroj → pending:resolve rekonstruiše prilog račun.
  const snapshot = {
    korisnikId: data.korisnikId, ukupno, pdvIznos,
    nacinPlacanja: data.nacinPlacanja, kupac: data.kupac,
    stavke: [], prilogBroj,
  };
  const pending = db
    .prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(data.korisnikId, JSON.stringify(snapshot));
  const pendingId = pending.lastInsertRowid as number;

  let result: Tring.TringResponse | null;
  try {
    result = await print(buildTringRacun({
      ukupno, nacinPlacanja: data.nacinPlacanja, kupac: data.kupac, items: [stavka],
    }));
  } catch (err) {
    // Izuzetak iz štampe — ništa nije odštampano, počisti write-ahead red.
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    throw err;
  }

  if (!result || !result.success) {
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    return {
      success: false,
      error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
      odgovori: result?.odgovori ?? {},
    };
  }

  const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;
  let orderId = 0;
  try {
    transaction(() => {
      const r = db.prepare(`
        INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
          kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, prilogBroj)
        VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 0, ?)
      `).run(
        data.korisnikId, ukupno, pdvIznos, data.nacinPlacanja, brojFiskalnogRacuna,
        data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
        data.kupac?.grad || null, data.kupac?.postanskiBroj || null, prilogBroj
      );
      orderId = Number(r.lastInsertRowid);
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    })();
  } catch (err: any) {
    // Račun je već na papiru; pending red namjerno ostaje da se može riješiti
    // kroz pending:resolve, ali operater to mora znati odmah.
    throw new Error(
      `Fiskalni račun po prilogu br. ${prilogBroj} (BF ${brojFiskalnogRacuna ?? '?'}) JE odštampan, ` +
      `ali nije zabilježen u bazi: ${err?.message || 'nepoznata greška'}. Riješite ga kroz nezavršene račune.`
    );
  }

  return { success: true, id: orderId, prilogBroj, brojFiskalnogRacuna, odgovori: result.odgovori };
}
