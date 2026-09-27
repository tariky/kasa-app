// Pravila šifarnika (artikli, dobavljači, kupci): validacija prije upisa,
// provjera brisanja artikla, slobodna stavka na kasi i UPDATE samo poslanih
// kolona. Kanali su u handlers.ts; Rust: katalog.rs.
import type { SqlDb } from './sqldb';
import type { Product } from '../types';
import { PDV_STOPE } from './provjeraRacuna';
import { NACINI_PLACANJA } from './placanje';
import { jeArtikalUProizvodnji } from './proizvodnja';

type Audit = (akcija: string, detalji: Record<string, unknown>) => void;

// ─── UPDATE poslanih kolona ─────────────────────────────────

/** Kolone koje product:update smije mijenjati. */
export const KOLONE_ARTIKLA = [
  'sifra', 'naziv', 'jm', 'cijena', 'pdvStopa', 'plu', 'barkod', 'tip', 'plocaSirina', 'plocaVisina',
] as const;
/** Kolone koje dobavljac:update smije mijenjati. */
export const KOLONE_DOBAVLJACA = ['naziv', 'idBroj', 'pdvBroj', 'adresa', 'kontakt'] as const;
/** Kolone koje kupac:update smije mijenjati. */
export const KOLONE_KUPCA = [
  'naziv', 'idBroj', 'pdvBroj', 'adresa', 'postanskiBroj', 'grad', 'kontakt', 'rokPlacanjaDana', 'nacinPlacanja', 'rabat',
] as const;

/**
 * `UPDATE <tabela> SET … WHERE id = ?` samo za poslane kolone: ključ iz
 * `polja` ulazi ako je u `dozvoljeneKolone` i vrijednost nije `undefined`
 * (null briše vrijednost), pa se payload može proslijediti direktno.
 * `uzIzmjenu` je SQL dodjela koja ide uz svaku stvarnu izmjenu (updatedAt).
 * Bez ijedne kolone baza se ne dira. Tabela i kolone dolaze iz koda, nikad
 * iz payload-a.
 */
export function azuriraj(
  db: SqlDb, tabela: string, id: unknown, polja: Record<string, unknown>,
  dozvoljeneKolone: readonly string[], opts: { uzIzmjenu?: string } = {},
): { changes: number } {
  const kolone = dozvoljeneKolone.filter(k => polja[k] !== undefined);
  if (kolone.length === 0) return { changes: 0 };
  const set = [...kolone.map(k => `${k} = ?`), ...(opts.uzIzmjenu ? [opts.uzIzmjenu] : [])];
  const result = db.prepare(`UPDATE ${tabela} SET ${set.join(', ')} WHERE id = ?`).run(...kolone.map(k => polja[k]), id);
  return { changes: result.changes };
}

// ─── Artikli ────────────────────────────────────────────────

export const PRODUCT_TIPOVI = ['artikal', 'usluga', 'materijal'] as const;

/** Tip artikla s liste; nepoznat ili prazan tip postaje 'artikal'. */
export function normalizujTip(t?: string): string {
  return (t && (PRODUCT_TIPOVI as readonly string[]).includes(t)) ? t : 'artikal';
}

export interface ArtikalUnos {
  sifra?: string; naziv?: string; cijena?: number; pdvStopa?: string; barkod?: string | null; plu?: unknown;
}

// PLU ide uređaju uz svaku stavku, pa važi Tringovo pravilo (MAX_PLU u
// services/tring.ts): cijeli broj od 0 do 999999. Prazno = bez PLU-a.
function validirajPlu(plu: unknown): number | null {
  if (plu == null || (typeof plu === 'string' && !plu.trim())) return null;
  const n = typeof plu === 'number' ? plu
    : typeof plu === 'string' && /^\d+$/.test(plu.trim()) ? Number(plu.trim())
    : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 999_999) throw new Error('PLU mora biti cijeli broj od 0 do 999999');
  return n;
}

/**
 * Zajednička pravila za product:create (id = null) i product:update. Na create-u su
 * sva polja obavezna, na update-u se provjerava samo ono što je poslano. Vraća
 * trimovane šifru, naziv i barkod (prazan barkod = null) i PLU kao broj, spremne
 * za upis — ključ postoji samo za poslano polje (barkod: kad je ključ poslan).
 */
export function validirajArtikal(db: SqlDb, data: ArtikalUnos, id: number | null) {
  const poslano = (k: keyof ArtikalUnos) => id === null || data[k] !== undefined;
  const upis: { sifra?: string; naziv?: string; barkod?: string | null; plu?: number | null } = {};
  if (poslano('sifra')) {
    if (!data.sifra?.trim()) throw new Error('Šifra artikla je obavezna');
    upis.sifra = data.sifra.trim();
  }
  if (poslano('naziv')) {
    if (!data.naziv?.trim()) throw new Error('Naziv artikla je obavezan');
    upis.naziv = data.naziv.trim();
  }
  if (poslano('cijena') && (data.cijena == null || !(data.cijena >= 0))) throw new Error('Cijena mora biti pozitivan broj');
  if (poslano('pdvStopa') && !(PDV_STOPE as readonly string[]).includes(data.pdvStopa as string)) throw new Error('PDV stopa mora biti E ili K');
  if (poslano('plu')) upis.plu = validirajPlu(data.plu);
  const osimId = id ?? -1;
  if (upis.sifra !== undefined && db.prepare('SELECT id FROM products WHERE sifra = ? AND id != ?').get(upis.sifra, osimId)) {
    throw new Error(`Artikal sa šifrom "${data.sifra}" već postoji`);
  }
  if (id === null || 'barkod' in data) {
    upis.barkod = data.barkod?.trim() || null;
    if (upis.barkod && db.prepare('SELECT id FROM products WHERE barkod = ? AND id != ?').get(upis.barkod, osimId)) {
      throw new Error(`Artikal sa barkodom "${data.barkod}" već postoji`);
    }
  }
  return upis;
}

/**
 * Baca grešku ako se artikal negdje koristi (strani ključevi na products, vidi
 * schema.ts). Kretanja zalihe idu zadnja: račun i primka ih i sami prave, pa
 * za njih važi konkretnija poruka. Historija cijena i šifre dobavljača nisu
 * prepreka — brišu se s artiklom.
 */
export function provjeriBrisanjeArtikla(db: SqlDb, id: number): void {
  const inOrders = db.prepare('SELECT id FROM order_items WHERE productId = ? LIMIT 1').get(id);
  if (inOrders) throw new Error('Artikal se koristi u računima i ne može biti obrisan');
  const inPrimke = db.prepare('SELECT id FROM primka_stavke WHERE productId = ? LIMIT 1').get(id);
  if (inPrimke) throw new Error('Artikal se koristi u primkama i ne može biti obrisan');
  if (jeArtikalUProizvodnji(db, id)) throw new Error('Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan');
  const ostaleVeze: Array<[tabela: string, poruka: string]> = [
    ['prilog_stavke', 'Artikal se koristi u prilozima i ne može biti obrisan'],
    ['ponuda_stavke', 'Artikal se koristi u ponudama i ne može biti obrisan'],
    ['nivelacija_stavke', 'Artikal se koristi u nivelacijama i ne može biti obrisan'],
    ['stock_movements', 'Artikal ima kretanja zalihe i ne može biti obrisan'],
  ];
  for (const [tabela, poruka] of ostaleVeze) {
    if (db.prepare(`SELECT 1 FROM ${tabela} WHERE productId = ? LIMIT 1`).get(id)) throw new Error(poruka);
  }
}

// ─── Slobodna stavka ────────────────────────────────────────

/** Tring: naziv zajedno s JM ima 32–36 znakova, zavisno od uređaja. */
export const SLOBODAN_NAZIV_MAX = 32;

/**
 * Slobodna stavka na kasi: kasir upiše naziv, cijenu i stopu, a stavka dobije
 * skriveni artikal (slobodan = 1, bez zalihe, van šifarnika) s automatskom šifrom.
 * Tring pamti naziv, JM i stopu po artiklu (PLU) i u toku dana ih ne smije
 * mijenjati, a svaki novi artikal trajno zauzme mjesto u memoriji uređaja — zato
 * se isti naziv (bez obzira na velika slova), stopa i JM uvijek vraćaju na isti
 * artikal, kome se mijenja samo cijena. Vraća red artikla sa stanjem 0.
 * Transakciju otvara pozivalac.
 */
export function slobodnaStavka(
  db: SqlDb, data: { naziv?: string; cijena?: number; pdvStopa?: string; jm?: string }, audit: Audit,
): Product {
  const naziv = data.naziv?.trim() ?? '';
  if (!naziv) throw new Error('Naziv stavke je obavezan');
  if (naziv.length > SLOBODAN_NAZIV_MAX) throw new Error(`Naziv stavke može imati najviše ${SLOBODAN_NAZIV_MAX} znaka`);
  if (data.cijena == null || !(data.cijena >= 0.01 && data.cijena <= 9_999_999.99)) {
    throw new Error('Cijena mora biti između 0,01 i 9.999.999,99');
  }
  if (!(PDV_STOPE as readonly string[]).includes(data.pdvStopa as string)) throw new Error('PDV stopa mora biti E ili K');
  const jm = data.jm?.trim() || 'kom';

  // SQLite-ov lower() zna samo ASCII (Š ≠ š), pa se naziv poredi ovdje.
  const kandidati = db.prepare(
    'SELECT id, naziv, cijena FROM products WHERE slobodan = 1 AND pdvStopa = ? AND jm = ?'
  ).all(data.pdvStopa, jm) as { id: number; naziv: string; cijena: number }[];
  const postojeci = kandidati.find(k => k.naziv.toLowerCase() === naziv.toLowerCase());
  let id: number;
  if (postojeci) {
    id = postojeci.id;
    db.prepare("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?").run(data.cijena, id);
    if (data.cijena !== postojeci.cijena) {
      audit('artikal:cijena', { productId: id, staraCijena: postojeci.cijena, novaCijena: data.cijena, izvor: 'slobodan' });
    }
  } else {
    const zadnji = db.prepare(
      "SELECT MAX(CAST(substr(sifra, 2) AS INTEGER)) AS n FROM products WHERE slobodan = 1"
    ).get() as { n: number | null };
    let broj = (zadnji.n ?? 0) + 1;
    const sifraZa = (n: number) => 'S' + String(n).padStart(6, '0');
    while (db.prepare('SELECT 1 FROM products WHERE sifra = ?').get(sifraZa(broj))) broj++;
    const r = db.prepare(`
      INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, slobodan)
      VALUES (?, ?, ?, ?, ?, 'usluga', 1)
    `).run(sifraZa(broj), naziv, jm, data.cijena, data.pdvStopa);
    id = Number(r.lastInsertRowid);
  }
  return db.prepare('SELECT p.*, 0 AS stanje FROM products p WHERE p.id = ?').get(id) as Product;
}

// ─── Dobavljači ─────────────────────────────────────────────

/**
 * Zajednička pravila za dobavljac:create (id = null) i dobavljac:update — na update-u
 * se naziv provjerava samo ako je poslan. Vraća trimovan naziv spreman za upis.
 */
export function validirajDobavljaca(data: { naziv?: string }, id: number | null): { naziv?: string } {
  if (id !== null && data.naziv === undefined) return {};
  if (!data.naziv?.trim()) throw new Error('Naziv dobavljača je obavezan');
  return { naziv: data.naziv.trim() };
}

// ─── Kupci ──────────────────────────────────────────────────

export interface KupacUnos {
  naziv?: string; idBroj?: string;
  rokPlacanjaDana?: unknown; nacinPlacanja?: unknown; rabat?: unknown;
}

export interface UpisKupca {
  naziv?: string; idBroj?: string;
  rokPlacanjaDana?: number | null; nacinPlacanja?: string | null; rabat?: number | null;
}

const prazno = (v: unknown) => v === null || v === '';

/**
 * Zajednička pravila za kupac:create (id = null) i kupac:update — na update-u se
 * provjerava samo ono što je poslano. Vraća trimovane naziv i JIB te zadane
 * vrijednosti za dokumente (rok, način plaćanja, rabat; prazno/null briše
 * vrijednost) — ključ postoji samo za poslano polje.
 */
export function validirajKupca(db: SqlDb, data: KupacUnos, id: number | null): UpisKupca {
  const upis: UpisKupca = {};
  if (id === null || data.naziv !== undefined) {
    if (!data.naziv?.trim()) throw new Error('Naziv kupca je obavezan');
    upis.naziv = data.naziv.trim();
  }
  if (id === null || data.idBroj !== undefined) {
    if (!data.idBroj?.trim()) throw new Error('ID broj (JIB) kupca je obavezan');
    upis.idBroj = data.idBroj.trim();
    if (db.prepare('SELECT id FROM kupci WHERE idBroj = ? AND id != ?').get(upis.idBroj, id ?? -1)) {
      throw new Error(`Kupac sa JIB-om "${data.idBroj}" već postoji`);
    }
  }
  if (data.rokPlacanjaDana !== undefined) {
    const v = data.rokPlacanjaDana;
    if (prazno(v)) upis.rokPlacanjaDana = null;
    else if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 365) throw new Error('Rok plaćanja mora biti cijeli broj dana od 0 do 365');
    else upis.rokPlacanjaDana = v;
  }
  if (data.nacinPlacanja !== undefined) {
    const v = data.nacinPlacanja;
    if (prazno(v)) upis.nacinPlacanja = null;
    else if (typeof v !== 'string' || !(NACINI_PLACANJA as readonly string[]).includes(v)) throw new Error(`Nepoznat način plaćanja "${String(v)}"`);
    else upis.nacinPlacanja = v;
  }
  if (data.rabat !== undefined) {
    const v = data.rabat;
    if (prazno(v)) upis.rabat = null;
    else {
      // Gornja granica se provjerava nakon zaokruživanja (99.995 → 100); negativno se
      // odbija prije, jer Math.round i Rustov round različito zaokružuju -x.5.
      const r = typeof v === 'number' ? Math.round(v * 100) / 100 : NaN;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !(r < 100)) throw new Error('Rabat kupca mora biti od 0 do manje od 100 %');
      upis.rabat = r;
    }
  }
  return upis;
}
