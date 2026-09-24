import type { SqlDb } from './sqldb';
import type { PregledCijenaUlaza } from '../types';

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

/**
 * Upiše nove prodajne cijene u šifarnik. Dokument (nivelaciju) za artikle sa
 * zalihom pravi pozivalac — vidi `promjeneUProdaji`.
 */
export function upisiCijene(db: SqlDb, changes: PriceChange[]): void {
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
 * Stari put za primke bez historije cijena (`cijena_historija`); artikli iz
 * `preskoci` su već vraćeni iz historije. Vraća broj vraćenih artikala.
 */
export function revertNivelacijaPrices(db: SqlDb, primkaId: number, preskoci: Set<number> = new Set(), samo?: Set<number>): number {
  // Nivelacije se ne brišu, pa promjena artikla koji je izmjenom već uklonjen
  // s primke ostaje u njenoj nivelaciji — ta je poništena pri uklanjanju i ne
  // smije se vraćati ponovo (samo artikli koji su još na primci). Isto tako se
  // ne gazi cijena koju je poslije primke postavila druga primka ili ručna
  // izmjena. Protunivelacije nemaju primkaId, pa se ovdje nikad ne čitaju.
  const oldNivStavke = db.prepare(`
    SELECT ns.productId, ns.staraCijena, ns.novaCijena
    FROM nivelacija_stavke ns
    JOIN nivelacije n ON n.id = ns.nivelacijaId
    WHERE n.primkaId = ?
      AND ns.productId IN (SELECT productId FROM primka_stavke WHERE primkaId = ?)
    ORDER BY ns.id
  `).all(primkaId, primkaId) as Array<{ productId: number; staraCijena: number; novaCijena: number }>;

  return vratiCijeneAkoNepromijenjene(db, oldNivStavke.filter(p =>
    !preskoci.has(p.productId) && (!samo || samo.has(p.productId)) && !cijenaKasnijeMijenjana(db, primkaId, p.productId)));
}

/**
 * Isto kao `revertNivelacijaPrices`, ali za cijene koje je primka promijenila
 * artiklima bez zalihe (zapamćene u `primka_stavke.staraCijena`). Stavke bez
 * zapamćene cijene (stare primke) se ne diraju.
 */
export function revertPricesWithoutStock(db: SqlDb, primkaId: number, preskoci: Set<number> = new Set(), samo?: Set<number>): number {
  const promjene = db.prepare(`
    SELECT productId, staraCijena, cijena AS novaCijena
    FROM primka_stavke
    WHERE primkaId = ? AND staraCijena IS NOT NULL
  `).all(primkaId) as Array<{ productId: number; staraCijena: number; novaCijena: number }>;

  return vratiCijeneAkoNepromijenjene(db, promjene.filter(p => !preskoci.has(p.productId) && (!samo || samo.has(p.productId))));
}

// ── Historija promjena cijena (cijena_historija) ───────────────────────

export type IzvorCijene = 'primka' | 'rucno';

/** Upiše promjene prodajne cijene u historiju (poslije upisa u products). */
export function zapisiPromjeneCijena(
  db: SqlDb,
  izvor: IzvorCijene,
  izvorId: number | bigint | null,
  promjene: Array<{ productId: number; staraCijena: number; novaCijena: number }>
): void {
  const insert = db.prepare(
    'INSERT INTO cijena_historija (productId, izvor, izvorId, staraCijena, novaCijena) VALUES (?, ?, ?, ?, ?)'
  );
  for (const p of promjene) insert.run(p.productId, izvor, izvorId, p.staraCijena, p.novaCijena);
}

/**
 * Poništi promjene cijena koje je primka upisala u historiju, kao da primke
 * nikad nije bilo. Za svaku promjenu artikla:
 *  - ima kasniju promjenu (druga primka, ručna izmjena): cijena artikla ostaje,
 *    a kasnija promjena preuzima staru cijenu ove (lanac se premosti) — pa
 *    njeno kasnije poništavanje vraća cijenu koja stvarno važi bez ove primke;
 *  - posljednja je: artikal se vraća na staru cijenu, ali samo ako još stoji
 *    na cijeni ove primke (zaštita od izmjene mimo historije).
 * Vraća artikle koje je historija pokrila (za njih se stari put ne koristi).
 * `samo` ograniči poništavanje na te artikle (izmjena primke).
 */
export function ponistiPromjeneCijenaPrimke(db: SqlDb, primkaId: number, samo?: Set<number>): Set<number> {
  const promjene = (db.prepare(
    "SELECT id, productId, staraCijena, novaCijena FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ? ORDER BY id"
  ).all(primkaId) as Array<{ id: number; productId: number; staraCijena: number; novaCijena: number }>)
    .filter(p => !samo || samo.has(p.productId));

  const sljedeca = db.prepare('SELECT id FROM cijena_historija WHERE productId = ? AND id > ? ORDER BY id LIMIT 1');
  const premosti = db.prepare('UPDATE cijena_historija SET staraCijena = ? WHERE id = ?');
  const obrisi = db.prepare('DELETE FROM cijena_historija WHERE id = ?');
  const pokriveni = new Set<number>();

  for (const p of promjene) {
    pokriveni.add(p.productId);
    const s = sljedeca.get(p.productId, p.id) as { id: number } | undefined;
    if (s) premosti.run(p.staraCijena, s.id);
    else vratiCijeneAkoNepromijenjene(db, [p]);
    obrisi.run(p.id);
  }

  return pokriveni;
}

/**
 * Vrati sve prodajne cijene koje je primka promijenila. Poziva se prije
 * brisanja stavki/nivelacije u primka:update i primka:delete. Primke upisane
 * u historiju cijena poništavaju se kroz nju (ispravno i u lancu primki);
 * starije primke bez historije idu starim putem — nivelacija + artikli bez
 * zalihe, vraćanje samo ako artikal još stoji na cijeni primke.
 * `samo` ograniči poništavanje na te artikle (izmjena primke).
 */
export function revertPrimkaPrices(db: SqlDb, primkaId: number, samo?: Set<number>): number {
  const pokriveni = ponistiPromjeneCijenaPrimke(db, primkaId, samo);
  return pokriveni.size
    + revertNivelacijaPrices(db, primkaId, pokriveni, samo)
    + revertPricesWithoutStock(db, primkaId, pokriveni, samo);
}

// ── Nivelacija kao dokument promjene cijene u prodaji ──────────────────
//
// Nivelacija se nikad ne briše: roba se prodavala po cijeni iz nje. Kad
// brisanje ili izmjena primke promijeni cijenu u prodaji, razlika se
// dokumentuje novom nivelacijom (protunivelacija) — od cijene koja je bila u
// prodaji do nove, na zalihi koja ostaje bez robe iz te primke.

/** Artikli čiju prodajnu cijenu primka određuje ili je mijenjala (stavke + historija). */
export function artikliPrimke(db: SqlDb, primkaId: number): number[] {
  return (db.prepare(`
    SELECT productId FROM primka_stavke WHERE primkaId = ?
    UNION
    SELECT productId FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ?
  `).all(primkaId, primkaId) as Array<{ productId: number }>).map(r => r.productId);
}

/** Snimak trenutnih prodajnih cijena (prije poništavanja/izmjene primke), redom artikala. */
export function cijeneArtikala(db: SqlDb, productIds: Iterable<number>): Map<number, number> {
  const get = db.prepare('SELECT cijena FROM products WHERE id = ?');
  const m = new Map<number, number>();
  for (const id of productIds) {
    if (m.has(id)) continue;
    const r = get.get(id) as { cijena: number } | undefined;
    if (r) m.set(id, r.cijena);
  }
  return m;
}

/**
 * Stavke nivelacije za promjene cijene u prodaji od snimka `prije` do sada:
 * stara = cijena koja je bila u prodaji, nova = trenutna, količina = trenutna
 * zaliha. Samo artikli sa zalihom (bez zalihe nema šta nivelisati); materijal
 * nema prodajnu cijenu. Poziva se dok ulaz primke NIJE na zalihi — cijena se
 * mijenja na robi koja ostaje u prodavnici.
 */
export function promjeneUProdaji(db: SqlDb, prije: Map<number, number>): PriceChange[] {
  const get = db.prepare('SELECT cijena, pdvStopa, tip FROM products WHERE id = ?');
  const out: PriceChange[] = [];
  for (const [productId, staraCijena] of prije) {
    const p = get.get(productId) as { cijena: number; pdvStopa: string; tip: string } | undefined;
    if (!p || p.tip === 'materijal' || Math.abs(p.cijena - staraCijena) <= EPS) continue;
    const kolicina = getProductStock(db, productId);
    if (kolicina > 0) out.push({ productId, kolicina, staraCijena, novaCijena: p.cijena, pdvStopa: p.pdvStopa });
  }
  return out;
}

/** Brojevi nivelacija primke koje sadrže neki od artikala — za napomenu protunivelacije. */
export function brojeviNivelacijaPrimke(db: SqlDb, primkaId: number, productIds: Iterable<number>): string[] {
  const ids = [...productIds];
  if (ids.length === 0) return [];
  return (db.prepare(`
    SELECT n.brojNivelacije FROM nivelacije n
    WHERE n.primkaId = ? AND EXISTS (
      SELECT 1 FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id AND ns.productId IN (${ids.map(() => '?').join(', ')})
    )
    ORDER BY n.id
  `).all(primkaId, ...ids) as Array<{ brojNivelacije: string }>).map(r => r.brojNivelacije);
}

/** Napomena protunivelacije: razlog i nivelacije primke čije se cijene poništavaju. */
export function napomenaProtunivelacije(razlog: string, brojevi: string[]): string {
  return brojevi.length > 0 ? `${razlog} (${brojevi.join(', ')})` : razlog;
}

// ── Izmjena primke ─────────────────────────────────────────────────────

/** Promjena cijene artikla koju je primka upisala u historiju (najviše jedna po artiklu). */
function promjenaCijenePrimke(db: SqlDb, primkaId: number, productId: number) {
  return db.prepare(
    "SELECT id, staraCijena, novaCijena FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ? AND productId = ? ORDER BY id DESC LIMIT 1"
  ).get(primkaId, productId) as { id: number; staraCijena: number; novaCijena: number } | undefined;
}

function sljedecaPromjena(db: SqlDb, productId: number, id: number) {
  return db.prepare('SELECT id FROM cijena_historija WHERE productId = ? AND id > ? ORDER BY id LIMIT 1')
    .get(productId, id) as { id: number } | undefined;
}

/**
 * Da li je prodajnu cijenu artikla poslije ove primke mijenjalo nešto drugo
 * (kasnija primka ili ručna izmjena) — tada ta kasnija promjena određuje
 * trenutnu cijenu, a izmjena cijene na ovoj primci je ne smije pregaziti.
 *
 * Ako je primka mijenjala cijenu, gleda se lanac u historiji. Ako nije (cijena
 * je bila ista, ili je primka iz vremena prije historije), kasnija je svaka
 * promjena iz novije primke ili ručna izmjena upisana od unosa ove primke.
 * Stare primke bez ikakve historije to ne mogu znati — za njih vraća false.
 */
export function cijenaKasnijeMijenjana(db: SqlDb, primkaId: number, productId: number): boolean {
  const h = promjenaCijenePrimke(db, primkaId, productId);
  if (h) return !!sljedecaPromjena(db, productId, h.id);
  return !!db.prepare(`
    SELECT 1 FROM cijena_historija
    WHERE productId = ? AND (
      (izvor = 'primka' AND izvorId > ?) OR
      (izvor = 'rucno' AND createdAt >= (SELECT createdAt FROM primke WHERE id = ?))
    ) LIMIT 1
  `).get(productId, primkaId, primkaId);
}

/** Prodajna cijena po artiklu iz stavki — važi prva stavka artikla, kao u `collectPriceChanges`. */
function prveCijene<T extends { productId: number; cijena: number }>(stavke: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const s of stavke) if (!m.has(s.productId)) m.set(s.productId, s);
  return m;
}

export interface IzmjenaPrimke {
  /** Artikli za koje se cijena računa kao kod nove primke (dodani, ili promijenjena cijena u zadnjoj promjeni). */
  kreiraj: Set<number>;
  /** Artikli čije su promjene cijena ove primke poništene (nivelacije ostaju; razliku nosi protunivelacija). */
  ponisteni: Set<number>;
  /** Zapamćena stara cijena (`primka_stavke.staraCijena`) artikala čije se promjene zadržavaju. */
  zadrzaneStareCijene: Map<number, number | null>;
}

/**
 * Pripremi cijene za izmjenu primke — poziva se prije brisanja starih stavki.
 * Cijena artikla se mijenja samo gdje je korisnik stvarno promijenio prodajnu
 * cijenu (prva stavka artikla), dodao ili uklonio artikal:
 *  - ista cijena: cijena artikla, historija, nivelacija i zapamćena stara
 *    cijena ostaju netaknuti;
 *  - uklonjen artikal: promjena se poništava kao pri brisanju primke;
 *  - dodan artikal: kao kod nove primke;
 *  - promijenjena cijena, a primka je zadnja promjena cijene artikla:
 *    poništi pa upiši kao novu (nova cijena + historija); nivelacija ide od
 *    cijene koja je bila u prodaji (npr. 12 → 15, ne 10 → 15) — vidi primka:update;
 *  - promijenjena cijena, a poslije je cijenu mijenjalo nešto drugo: trenutna
 *    cijena ostaje (kasnija promjena je važnija), nema nove nivelacije — samo
 *    se u lancu ispravi nova cijena ove primke i stara cijena sljedeće
 *    promjene, pa njeno kasnije poništavanje vodi na ispravljenu cijenu.
 *    Primka bez zapisa u historiji za taj artikal se ne ubacuje u lanac.
 */
export function pripremiIzmjenuPrimke(
  db: SqlDb,
  primkaId: number,
  noveStavke: Array<{ productId: number; cijena: number }>
): IzmjenaPrimke {
  const stare = prveCijene(db.prepare(
    'SELECT productId, cijena, staraCijena FROM primka_stavke WHERE primkaId = ? ORDER BY id'
  ).all(primkaId) as Array<{ productId: number; cijena: number; staraCijena: number | null }>);
  const nove = prveCijene(noveStavke);

  const kreiraj = new Set<number>();
  const ponisti = new Set<number>();
  const zadrzaneStareCijene = new Map<number, number | null>();
  const upisiNovu = db.prepare('UPDATE cijena_historija SET novaCijena = ? WHERE id = ?');
  const upisiStaru = db.prepare('UPDATE cijena_historija SET staraCijena = ? WHERE id = ?');

  for (const productId of stare.keys()) if (!nove.has(productId)) ponisti.add(productId);

  for (const [productId, nova] of nove) {
    const stara = stare.get(productId);
    if (!stara) { kreiraj.add(productId); continue; }
    if (Math.abs(stara.cijena - nova.cijena) > EPS && !cijenaKasnijeMijenjana(db, primkaId, productId)) {
      ponisti.add(productId);
      kreiraj.add(productId);
      continue;
    }
    // Zadržava se: ista cijena, ili je kasnija promjena važnija od ove.
    zadrzaneStareCijene.set(productId, stara.staraCijena);
    if (Math.abs(stara.cijena - nova.cijena) <= EPS) continue;
    const h = promjenaCijenePrimke(db, primkaId, productId);
    const sljedeca = h && sljedecaPromjena(db, productId, h.id);
    if (h && sljedeca) {
      upisiNovu.run(nova.cijena, h.id);
      upisiStaru.run(nova.cijena, sljedeca.id);
    }
  }

  if (ponisti.size > 0) revertPrimkaPrices(db, primkaId, ponisti);
  return { kreiraj, ponisteni: ponisti, zadrzaneStareCijene };
}

/**
 * `primka_stavke.staraCijena` pri izmjeni: nove promjene (iz `stareCijeneStavki`)
 * i zadržane stare vrijednosti — obje samo na prvu stavku artikla.
 */
export function stareCijeneIzmjene(
  stavke: Array<{ productId: number }>,
  bezZaliha: PriceChange[],
  zadrzane: Map<number, number | null>
): Array<number | null> {
  const nove = stareCijeneStavki(stavke, bezZaliha);
  const vidjeni = new Set<number>();
  return stavke.map((s, i) => {
    const prva = !vidjeni.has(s.productId);
    vidjeni.add(s.productId);
    if (nove[i] !== null) return nove[i];
    return prva ? (zadrzane.get(s.productId) ?? null) : null;
  });
}

// ── Pregled prije spremanja/brisanja ───────────────────────────────────
//
// Operacija se pokrene u transakciji koja se poništi; ovdje se samo pročita
// šta je napravila. Tako najava na ekranu i prava operacija dijele istu logiku.

export interface PocetakPregleda { zadnjaNivelacija: number; cijene: Map<number, number> }

/** Stanje prije operacije: zadnja nivelacija i sve prodajne cijene. */
export function pocetakPregleda(db: SqlDb): PocetakPregleda {
  const zadnja = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM nivelacije').get() as { id: number };
  const cijene = new Map((db.prepare('SELECT id, cijena FROM products').all() as Array<{ id: number; cijena: number }>).map(p => [p.id, p.cijena]));
  return { zadnjaNivelacija: zadnja.id, cijene };
}

/**
 * Nivelacije nastale poslije `pocetak` i promjene cijena koje nisu u njima
 * (artikli bez zalihe). Nivelacija s vezom na primku nosi novu cijenu ulaza;
 * bez veze je protunivelacija (poništenje cijene).
 */
export function rezultatPregleda(db: SqlDb, pocetak: PocetakPregleda, cijenaOstaje: PregledCijenaUlaza['cijenaOstaje']): PregledCijenaUlaza {
  const stavkeNiv = db.prepare(`
    SELECT ns.productId, p.naziv AS productNaziv, ns.kolicina, ns.staraCijena, ns.novaCijena, ns.razlika, ns.ukupnaRazlika
    FROM nivelacija_stavke ns JOIN products p ON p.id = ns.productId
    WHERE ns.nivelacijaId = ? ORDER BY ns.id
  `);
  const dokumenti = (db.prepare('SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije WHERE id > ? ORDER BY id')
    .all(pocetak.zadnjaNivelacija) as Array<{ id: number; brojNivelacije: string; datum: string; primkaId: number | null; napomena: string | null }>)
    .map(n => ({
      vrsta: n.primkaId === null ? 'protunivelacija' as const : 'nivelacija' as const,
      brojNivelacije: n.brojNivelacije, datum: n.datum, napomena: n.napomena,
      stavke: stavkeNiv.all(n.id) as PregledCijenaUlaza['dokumenti'][number]['stavke'],
    }));

  const uDokumentu = new Set(dokumenti.flatMap(d => d.stavke.map(s => s.productId)));
  const promijenjene = new Set<number>();
  const bezZalihe: PregledCijenaUlaza['bezZalihe'] = [];
  for (const p of db.prepare('SELECT id, naziv, cijena FROM products ORDER BY id').all() as Array<{ id: number; naziv: string; cijena: number }>) {
    const stara = pocetak.cijene.get(p.id);
    if (stara === undefined || Math.abs(stara - p.cijena) <= EPS) continue;
    promijenjene.add(p.id);
    if (!uDokumentu.has(p.id)) bezZalihe.push({ productId: p.id, productNaziv: p.naziv, staraCijena: stara, novaCijena: p.cijena });
  }

  return { dokumenti, bezZalihe, cijenaOstaje: cijenaOstaje.filter(c => !promijenjene.has(c.productId)) };
}

/**
 * Izmjena primke: artikli kojima korisnik mijenja prodajnu cijenu na primci,
 * a cijenu je poslije ove primke mijenjalo nešto drugo — cijena u prodaji
 * ostaje (vidi `pripremiIzmjenuPrimke`). Poziva se prije izmjene.
 */
export function cijeneKojeOstaju(
  db: SqlDb,
  primkaId: number,
  noveStavke: Array<{ productId: number; cijena: number }>
): PregledCijenaUlaza['cijenaOstaje'] {
  const stare = prveCijene(db.prepare('SELECT productId, cijena FROM primka_stavke WHERE primkaId = ? ORDER BY id')
    .all(primkaId) as Array<{ productId: number; cijena: number }>);
  const artikal = db.prepare('SELECT naziv, cijena, tip FROM products WHERE id = ?');
  const out: PregledCijenaUlaza['cijenaOstaje'] = [];
  for (const [productId, nova] of prveCijene(noveStavke)) {
    const stara = stare.get(productId);
    if (!stara || Math.abs(stara.cijena - nova.cijena) <= EPS || !cijenaKasnijeMijenjana(db, primkaId, productId)) continue;
    const p = artikal.get(productId) as { naziv: string; cijena: number; tip: string } | undefined;
    if (p && p.tip !== 'materijal') out.push({ productId, productNaziv: p.naziv, cijena: p.cijena });
  }
  return out;
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
