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

    const product = db.prepare('SELECT cijena, tip FROM products WHERE id = ?')
      .get(stavka.productId) as { cijena: number; tip: string } | undefined;
    if (!product || product.tip === 'materijal') continue;
    if (Math.abs(product.cijena - stavka.cijena) <= EPS) continue;

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
 * Stara prodajna cijena koju treba zapamtiti na svakoj stavci primke
 * (`primka_stavke.staraCijena`), po redu stavki. Upisuje se samo za artikle
 * bez zalihe (kod njih nema nivelacije koja bi je čuvala) i samo na prvu
 * stavku artikla — njena cijena je ona koju je `collectPriceChanges` upisao.
 */
export function stareCijeneStavki(
  stavke: Array<{ productId: number }>,
  bezZaliha: PriceChange[]
): Array<number | null> {
  const stare = new Map(bezZaliha.map(c => [c.productId, c.staraCijena]));
  return stavke.map(s => {
    const stara = stare.get(s.productId);
    if (stara === undefined) return null;
    stare.delete(s.productId);
    return stara;
  });
}

/**
 * Vrati `staraCijena` artiklima koji još uvijek stoje na `novaCijena`. Ako je
 * cijenu u međuvremenu promijenilo nešto drugo (kasnija primka, ručna izmjena),
 * ta vrijednost se ne smije pregaziti. Vraća broj vraćenih artikala.
 */
function vratiCijeneAkoNepromijenjene(
  db: SqlDb,
  promjene: Array<{ productId: number; staraCijena: number; novaCijena: number }>
): number {
  const revertPrice = db.prepare(
    "UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
  );
  let reverted = 0;

  for (const p of promjene) {
    const current = db.prepare('SELECT cijena FROM products WHERE id = ?')
      .get(p.productId) as { cijena: number } | undefined;
    if (current && Math.abs(current.cijena - p.novaCijena) <= EPS) {
      revertPrice.run(p.staraCijena, p.productId);
      reverted++;
    }
  }

  return reverted;
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

  return vratiCijeneAkoNepromijenjene(db, oldNivStavke);
}

/**
 * Isto kao `revertNivelacijaPrices`, ali za cijene koje je primka promijenila
 * artiklima bez zalihe (zapamćene u `primka_stavke.staraCijena`). Stavke bez
 * zapamćene cijene (stare primke) se ne diraju.
 */
export function revertPricesWithoutStock(db: SqlDb, primkaId: number): number {
  const promjene = db.prepare(`
    SELECT productId, staraCijena, cijena AS novaCijena
    FROM primka_stavke
    WHERE primkaId = ? AND staraCijena IS NOT NULL
  `).all(primkaId) as Array<{ productId: number; staraCijena: number; novaCijena: number }>;

  return vratiCijeneAkoNepromijenjene(db, promjene);
}

/**
 * Vrati sve prodajne cijene koje je primka promijenila (nivelacija + artikli
 * bez zalihe). Poziva se prije brisanja stavki/nivelacije u primka:update i
 * primka:delete. Artikal je u jednoj primci samo u jednoj od dvije grupe.
 */
export function revertPrimkaPrices(db: SqlDb, primkaId: number): number {
  return revertNivelacijaPrices(db, primkaId) + revertPricesWithoutStock(db, primkaId);
}

/**
 * `stock_movements.createdAt` za ulaz iz primke: datum primke u formatu
 * kretanja (`YYYY-MM-DD HH:MM:SS`). Primka nosi samo datum, pa ulaz dobija
 * ponoć — deterministično (izmjena primke ne pomjera vrijeme) i unutar dana
 * pri poređenju stringova (`BETWEEN 'D 00:00:00' AND 'D 23:59:59'`, `LIKE 'D%'`).
 */
export function datumKretanjaPrimke(datum: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(datum) ? `${datum} 00:00:00` : datum;
}

/**
 * Zajednička validacija za primka:create i primka:update. Baca grešku sa
 * porukom za korisnika; vraća trimovan broj primke koji treba upisati.
 * `primkaId` je id primke koja se mijenja — njen vlastiti broj nije duplikat.
 */
export function validirajPrimku(
  db: SqlDb,
  data: { brojPrimke?: string; stavke?: Array<{ productId: number }> },
  primkaId?: number
): string {
  const brojPrimke = data.brojPrimke?.trim();
  if (!brojPrimke) throw new Error('Broj primke je obavezan');
  if (!data.stavke || data.stavke.length === 0) throw new Error('Primka mora imati najmanje jednu stavku');

  const postojeca = db.prepare('SELECT id FROM primke WHERE brojPrimke = ? AND id IS NOT ?')
    .get(brojPrimke, primkaId ?? null);
  if (postojeca) throw new Error(`Primka sa brojem "${data.brojPrimke}" već postoji`);

  const postojiArtikal = db.prepare('SELECT 1 FROM products WHERE id = ?');
  for (const s of data.stavke) {
    if (!postojiArtikal.get(s.productId)) throw new Error(`Artikal (ID ${s.productId}) ne postoji`);
  }

  return brojPrimke;
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
