import type { SqlDb } from './sqldb';

/** Tolerancija pri poređenju cijena (fening). */
const EPS = 0.001;

export interface PriceChange {
  productId: number;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  pdvStopa: string;
}

/** Trenutno stanje artikla izračunato iz kretanja zaliha. */
export function getProductStock(db: SqlDb, productId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(
      SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
    ) AS stanje
    FROM stock_movements WHERE productId = ?
  `).get(productId) as { stanje: number };
  return row.stanje;
}

/**
 * Razvrsta izmjene prodajne cijene sa primke u dvije grupe (dedup po artiklu):
 *  - `nivelacija` — artikli sa zalihom; razlika se mora dokumentovati,
 *  - `bezZaliha`  — artikli bez zalihe; nema šta da se nivelira, ali nova
 *                   cijena i dalje mora ući u šifarnik, inače se artikal
 *                   nastavi prodavati po staroj cijeni.
 *
 * Mora se pozvati PRIJE upisa ulaza da bi zaliha odražavala stanje prije primke.
 */
export function collectPriceChanges(
  db: SqlDb,
  stavke: Array<{ productId: number; cijena: number; pdvStopa: string }>
): { nivelacija: PriceChange[]; bezZaliha: PriceChange[] } {
  const nivelacija: PriceChange[] = [];
  const bezZaliha: PriceChange[] = [];
  const seen = new Set<number>();

  for (const stavka of stavke) {
    if (seen.has(stavka.productId)) continue;
    seen.add(stavka.productId);

    const product = db.prepare('SELECT cijena FROM products WHERE id = ?')
      .get(stavka.productId) as { cijena: number } | undefined;
    if (!product || Math.abs(product.cijena - stavka.cijena) <= EPS) continue;

    const existingStock = getProductStock(db, stavka.productId);
    const change: PriceChange = {
      productId: stavka.productId,
      kolicina: existingStock,
      staraCijena: product.cijena,
      novaCijena: stavka.cijena,
      pdvStopa: stavka.pdvStopa,
    };
    if (existingStock > 0) nivelacija.push(change);
    else bezZaliha.push(change);
  }

  return { nivelacija, bezZaliha };
}

/** Upiše novu prodajnu cijenu za artikle bez zalihe (nema nivelacije). */
export function applyPricesWithoutStock(db: SqlDb, changes: PriceChange[]): void {
  if (changes.length === 0) return;
  const updatePrice = db.prepare(
    "UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
  );
  for (const c of changes) updatePrice.run(c.novaCijena, c.productId);
}

/**
 * Vrati cijene koje je nivelacija ove primke postavila — ali samo za artikle
 * koji još uvijek stoje na toj cijeni. Ako je kasnija primka u međuvremenu
 * promijenila cijenu, njena vrijednost se ne smije pregaziti.
 * Vraća broj vraćenih artikala.
 */
export function revertNivelacijaPrices(db: SqlDb, primkaId: number): number {
  const oldNivStavke = db.prepare(`
    SELECT ns.productId, ns.staraCijena, ns.novaCijena
    FROM nivelacija_stavke ns
    JOIN nivelacije n ON n.id = ns.nivelacijaId
    WHERE n.primkaId = ?
  `).all(primkaId) as Array<{ productId: number; staraCijena: number; novaCijena: number }>;

  const revertPrice = db.prepare(
    "UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
  );
  let reverted = 0;

  for (const ons of oldNivStavke) {
    const current = db.prepare('SELECT cijena FROM products WHERE id = ?')
      .get(ons.productId) as { cijena: number } | undefined;
    if (current && Math.abs(current.cijena - ons.novaCijena) <= EPS) {
      revertPrice.run(ons.staraCijena, ons.productId);
      reverted++;
    }
  }

  return reverted;
}

/**
 * Da li dobavljač figuriše na nekoj primci.
 *
 * `primke.dobavljacId` čuva JIB/PDV broj dobavljača (tako ga upisuje ekran
 * primke), a ne njegov rowid — provjera po rowid-u nikad ne pogodi ništa.
 */
export function isDobavljacUsed(
  db: SqlDb,
  dobavljac: { naziv: string; idBroj?: string | null; pdvBroj?: string | null }
): boolean {
  const oznake = [dobavljac.idBroj, dobavljac.pdvBroj]
    .map(v => v?.trim())
    .filter((v): v is string => !!v);

  const row = oznake.length > 0
    ? db.prepare(
        `SELECT id FROM primke
         WHERE dobavljacNaziv = ? OR dobavljacId IN (${oznake.map(() => '?').join(', ')})
         LIMIT 1`
      ).get(dobavljac.naziv, ...oznake)
    : db.prepare('SELECT id FROM primke WHERE dobavljacNaziv = ? LIMIT 1').get(dobavljac.naziv);

  return !!row;
}
