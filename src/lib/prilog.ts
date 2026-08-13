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
