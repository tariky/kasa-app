import type { SqlDb } from './sqldb';
import { localDateStr, round2 } from './novac';
import { uNetto } from './pdvUnos';
import { getProductStock } from './skladiste';
import { TOLERANCIJA_ZALIHE } from './tolerancije';
import { izracunajTotale, upisiRacun } from './racun';
import { provjeriNacinPlacanja } from './placanje';
import { buildTringRacun } from './tringRacun';
import { konvertujPonudu, type KonverzijaDeps, type KonverzijaResult } from './ponuda';
import type * as Tring from '@/services/tring';
import {
  baciAkoCekaNezavrsen, neuspjelaStampa, preuzmiPendingRed, snapshotKupca, vecEvidentiran, zapisiPending,
  type SnapshotNaloga,
} from './pendingRacun';
import { formatBroja, nastavakNumeracije, ZADANE_DOKUMENT_POSTAVKE, type FormatBroja } from './dokumentPostavke';
import type {
  NalogStatus, NalogVrsta, NormativStavka, ProizvodPonude, RadniNalog, RadniNalogProizvod, RadniNalogStavka,
} from '@/types';

export interface NalogInput {
  vrsta: NalogVrsta;
  korisnikId: number;
  opis?: string;
  kupacId?: number | null;
  ponudaId?: number | null;
  productId?: number | null;
  kolicina?: number;
  datum?: string;
  rok?: string | null;
  dogovorenaCijena?: number | null;
  trosakRada?: number;
  napomena?: string | null;
}

export interface NalogStavkaInput {
  materijalId: number;
  kolicina: number;
  napomena?: string | null;
}

export interface NalogProizvodInput {
  productId: number;
  kolicina: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ── numeracija ───────────────────────────────────────────

/** Sljedeći redni broj naloga u godini — od 1, ili iza posljednjeg broja iz starog programa. */
export function nextBrojNaloga(db: SqlDb, godina: number): number {
  const row = db.prepare('SELECT MAX(broj) AS maxBroj FROM radni_nalozi WHERE godina = ?')
    .get(godina) as { maxBroj: number | null };
  return Math.max(row.maxBroj ?? 0, nastavakNumeracije(db, 'nalog', godina)) + 1;
}

/** Prikazni oblik broja naloga, npr. "RN-2/2026" ili format iz postavki. */
export function formatBrojNaloga(n: { broj: number; godina: number }, f: FormatBroja = ZADANE_DOKUMENT_POSTAVKE.nalog.broj): string {
  return formatBroja(n, f);
}

// ── validacija ───────────────────────────────────────────

function productTip(db: SqlDb, id: number): { tip: string; naziv: string } | undefined {
  return db.prepare('SELECT tip, naziv FROM products WHERE id = ?').get(id) as any;
}

function validirajStavke(db: SqlDb, stavke: NalogStavkaInput[]): void {
  for (const s of stavke) {
    const p = productTip(db, s.materijalId);
    if (!p || p.tip !== 'materijal') throw new Error('Stavka utroška mora biti materijal');
    if (!(s.kolicina > 0)) throw new Error('Količina stavke mora biti veća od nule');
  }
}

/**
 * Normativ drži jedan red po materijalu (UNIQUE productId+materijalId). Nalog
 * namjerno dozvoljava isti materijal više puta — npr. ista ploča u dvije
 * dimenzije krojenja, svaka sa svojom napomenom.
 */
function baciAkoDupliMaterijal(db: SqlDb, stavke: NalogStavkaInput[]): void {
  const vidjeni = new Set<number>();
  for (const s of stavke) {
    if (vidjeni.has(s.materijalId)) {
      const naziv = productTip(db, s.materijalId)?.naziv ?? `#${s.materijalId}`;
      throw new Error(`Materijal "${naziv}" je unesen više puta — saberite količine u jednu stavku`);
    }
    vidjeni.add(s.materijalId);
  }
}

function ucitajNalogIliBaci(db: SqlDb, id: number): { status: NalogStatus; vrsta: NalogVrsta; kolicina: number; productId: number | null; ponudaId: number | null } {
  const n = db.prepare('SELECT status, vrsta, kolicina, productId, ponudaId FROM radni_nalozi WHERE id = ?').get(id) as any;
  if (!n) throw new Error('Radni nalog ne postoji');
  return n;
}

function baciAkoZakljucan(status: NalogStatus): void {
  if (status === 'zavrsen' || status === 'fakturisan') {
    throw new Error('Nalog je završen i ne može se mijenjati');
  }
}

/**
 * Ponuda fakturisana mimo naloga (ekran Ponude) — utrošak materijala pripada
 * fakturisanom poslu pa se nalog ne smije ni vratiti u izradu ni obrisati.
 */
function baciAkoPonudaFakturisana(db: SqlDb, ponudaId: number | null, radnja: string): void {
  if (!ponudaId) return;
  const p = db.prepare('SELECT status FROM ponude WHERE id = ?').get(ponudaId) as { status: string } | undefined;
  if (p?.status === 'konvertovana') throw new Error(`Ponuda ovog naloga je već fakturisana — nalog se ne može ${radnja}`);
}

// ── stavke ───────────────────────────────────────────────

function upisiStavke(db: SqlDb, nalogId: number, stavke: NalogStavkaInput[]): void {
  const ins = db.prepare(
    'INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)'
  );
  for (const s of stavke) ins.run(nalogId, s.materijalId, round4(s.kolicina), s.napomena ?? null);
}

/** Zamijeni sve stavke utroška. Poziva se u transakciji. */
export function replaceStavke(db: SqlDb, id: number, stavke: NalogStavkaInput[]): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);
  validirajStavke(db, stavke);
  db.prepare('DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?').run(id);
  upisiStavke(db, id, stavke);
}

// ── kreiranje / izmjena ──────────────────────────────────

/** Upiše nalog. Za zalihu, ako proizvod ima normativ, popuni stavke normativ × količina. U transakciji. */
export function createNalog(db: SqlDb, input: NalogInput): { id: number; broj: number; godina: number } {
  if (!input.korisnikId) throw new Error('Korisnik nije prijavljen');
  const datum = input.datum || localDateStr();
  const godina = Number(datum.slice(0, 4));
  let opis = (input.opis ?? '').trim();
  let kolicina = 1;

  if (input.vrsta === 'narudzba') {
    if (!input.kupacId) throw new Error('Kupac je obavezan za nalog po narudžbi');
    if (!opis) throw new Error('Opis je obavezan');
  } else if (input.vrsta === 'zaliha') {
    if (!input.productId) throw new Error('Proizvod je obavezan za nalog za zalihu');
    const p = productTip(db, input.productId);
    if (!p || p.tip !== 'artikal') throw new Error('Nalog za zalihu može biti samo za artikal');
    kolicina = round4(input.kolicina ?? 0);
    if (!(kolicina > 0)) throw new Error('Količina mora biti veća od nule');
    if (!opis) opis = p.naziv;
  } else {
    throw new Error('Nepoznata vrsta naloga');
  }

  const broj = nextBrojNaloga(db, godina);
  const res = db.prepare(`
    INSERT INTO radni_nalozi (broj, godina, datum, rok, vrsta, kupacId, ponudaId, opis, productId, kolicina,
      dogovorenaCijena, trosakRada, korisnikId, napomena)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    broj, godina, datum, input.rok ?? null, input.vrsta,
    input.vrsta === 'narudzba' ? input.kupacId : null,
    input.ponudaId ?? null, opis,
    input.vrsta === 'zaliha' ? input.productId : null, kolicina,
    input.dogovorenaCijena ?? null, input.trosakRada ?? 0, input.korisnikId, input.napomena ?? null
  );
  const id = Number(res.lastInsertRowid);

  if (input.vrsta === 'zaliha') {
    const normativ = getNormativ(db, input.productId!);
    if (normativ.length > 0) upisiStavke(db, id, stavkeIzNormativa(normativ, kolicina));
  }

  return { id, broj, godina };
}

/**
 * Nalog iz prihvaćene ponude: kupac, opis (nazivi stavki) i cijena sa ponude, te
 * stavke ponude koje nalog izrađuje. Bez izbora (`proizvodi` nije niz) važi
 * zadani iz `proizvodiPonude`. U transakciji.
 */
export function createNalogIzPonude(
  db: SqlDb, ponudaId: number, korisnikId: number, proizvodi?: NalogProizvodInput[] | null
): { id: number; broj: number; godina: number } {
  const ponuda = db.prepare('SELECT id, kupacId, status, ukupno FROM ponude WHERE id = ?').get(ponudaId) as any;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status !== 'prihvacena') throw new Error('Ponuda mora biti prihvaćena da bi se otvorio radni nalog');
  if (nalogZaPonudu(db, ponudaId)) throw new Error('Za ovu ponudu radni nalog već postoji');

  const nazivi = db.prepare(`
    SELECT p.naziv FROM ponuda_stavke ps LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? ORDER BY ps.id
  `).all(ponudaId) as Array<{ naziv: string | null }>;
  const opis = nazivi.map(n => n.naziv).filter(Boolean).join(', ') || `Ponuda ${ponudaId}`;

  const r = createNalog(db, {
    vrsta: 'narudzba', korisnikId, kupacId: ponuda.kupacId, ponudaId, opis,
    dogovorenaCijena: ponuda.ukupno,
  });
  const izbor = Array.isArray(proizvodi) ? proizvodi
    : proizvodiPonude(db, ponudaId).filter(p => p.zadano).map(p => ({ productId: p.productId, kolicina: p.kolicina }));
  upisiProizvode(db, r.id, ponudaId, izbor);
  return r;
}

/**
 * Stavke ponude koje nalog može izrađivati — artikli, ne usluge ni materijal —
 * s trenutnim stanjem. Zadano se izrađuje ono čega nema dovoljno na zalihi.
 */
export function proizvodiPonude(db: SqlDb, ponudaId: number): ProizvodPonude[] {
  const redovi = db.prepare(`
    SELECT ps.id AS ponudaStavkaId, ps.productId, p.naziv, p.sifra, p.jm, ps.kolicina
    FROM ponuda_stavke ps JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? AND p.tip NOT IN ('usluga', 'materijal')
    ORDER BY ps.id
  `).all(ponudaId) as ProizvodPonude[];
  for (const r of redovi) {
    r.stanje = getProductStock(db, r.productId);
    r.zadano = r.stanje < r.kolicina - TOLERANCIJA_ZALIHE;
  }
  return redovi;
}

/**
 * Provjeri izbor proizvoda prema trenutnoj ponudi: svaki mora biti artikal sa
 * ponude, a zbir po artiklu ne veći od količine na ponudi. Vraća redove s
 * količinom na 4 decimale.
 */
function validirajProizvode(db: SqlDb, ponudaId: number, proizvodi: NalogProizvodInput[]): NalogProizvodInput[] {
  const naPonudi = db.prepare(`
    SELECT p.naziv, p.tip, SUM(ps.kolicina) AS kolicina
    FROM ponuda_stavke ps JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? AND ps.productId = ?
  `);
  const zbir = new Map<number, number>();
  const redovi: NalogProizvodInput[] = [];
  for (const pr of proizvodi) {
    const s = naPonudi.get(ponudaId, pr.productId) as { naziv: string | null; tip: string | null; kolicina: number | null };
    const naziv = s.naziv ?? productTip(db, pr.productId)?.naziv ?? `#${pr.productId}`;
    if (s.kolicina == null) throw new Error(`Proizvod "${naziv}" nije na ponudi naloga`);
    if (s.tip === 'usluga' || s.tip === 'materijal') throw new Error(`"${naziv}" je ${s.tip} i ne izrađuje se po nalogu`);
    const kolicina = round4(pr.kolicina);
    if (!(kolicina > 0)) throw new Error('Količina proizvoda mora biti veća od nule');
    const ukupno = round4((zbir.get(pr.productId) ?? 0) + kolicina);
    if (ukupno > s.kolicina + TOLERANCIJA_ZALIHE) {
      throw new Error(`Proizvod "${naziv}": nalog izrađuje ${ukupno}, a na ponudi je ${round4(s.kolicina)}`);
    }
    zbir.set(pr.productId, ukupno);
    redovi.push({ productId: pr.productId, kolicina });
  }
  return redovi;
}

/** Zamijeni proizvode naloga (provjereno prema ponudi). Poziva se u transakciji. */
function upisiProizvode(db: SqlDb, nalogId: number, ponudaId: number, proizvodi: NalogProizvodInput[]): void {
  const redovi = validirajProizvode(db, ponudaId, proizvodi);
  db.prepare('DELETE FROM radni_nalog_proizvodi WHERE radniNalogId = ?').run(nalogId);
  const ins = db.prepare('INSERT INTO radni_nalog_proizvodi (radniNalogId, productId, kolicina) VALUES (?, ?, ?)');
  for (const r of redovi) ins.run(nalogId, r.productId, r.kolicina);
}

/** Izbor proizvoda naloga iz ponude — samo dok nalog nije završen. U transakciji. */
export function setProizvodiNaloga(db: SqlDb, id: number, proizvodi: NalogProizvodInput[]): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);
  if (!n.ponudaId) throw new Error('Proizvodi se biraju samo za nalog iz ponude');
  upisiProizvode(db, id, n.ponudaId, proizvodi);
}

export function nalogZaPonudu(db: SqlDb, ponudaId: number): { id: number; broj: number; godina: number } | null {
  const row = db.prepare('SELECT id, broj, godina FROM radni_nalozi WHERE ponudaId = ? LIMIT 1').get(ponudaId) as any;
  return row ?? null;
}

/** Polja koja se smiju mijenjati na završenom nalogu bez cijene — dogovor sa kupcem stigne i poslije. */
const DOZVOLJENO_ZAVRSEN = new Set(['dogovorenaCijena', 'rok', 'napomena']);

export function updateNalog(
  db: SqlDb, id: number,
  patch: Partial<Omit<NalogInput, 'vrsta' | 'korisnikId'>>
): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.status === 'zavrsen') {
    if (Object.keys(patch).some(k => !DOZVOLJENO_ZAVRSEN.has(k))) baciAkoZakljucan(n.status);
  } else {
    baciAkoZakljucan(n.status);
  }

  const fields: string[] = [];
  const values: any[] = [];
  const set = (col: string, v: any) => { fields.push(`${col} = ?`); values.push(v); };

  if (patch.opis !== undefined) {
    const opis = patch.opis.trim();
    if (!opis) throw new Error('Opis je obavezan');
    set('opis', opis);
  }
  if (patch.kupacId !== undefined && n.vrsta === 'narudzba') {
    if (!patch.kupacId) throw new Error('Kupac je obavezan za nalog po narudžbi');
    set('kupacId', patch.kupacId);
  }
  if (patch.kolicina !== undefined && n.vrsta === 'zaliha') {
    const kolicina = round4(patch.kolicina);
    if (!(kolicina > 0)) throw new Error('Količina mora biti veća od nule');
    set('kolicina', kolicina);
  }
  if (patch.datum !== undefined) {
    if (typeof patch.datum !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(patch.datum)) {
      throw new Error('Datum naloga nije ispravan');
    }
    set('datum', patch.datum);
    // Numeracija ide po godini: prelazak u drugu godinu daje sljedeći slobodan broj te godine.
    const godina = Number(patch.datum.slice(0, 4));
    const trenutna = db.prepare('SELECT godina FROM radni_nalozi WHERE id = ?').get(id) as { godina: number };
    if (trenutna.godina !== godina) {
      set('godina', godina);
      set('broj', nextBrojNaloga(db, godina));
    }
  }
  if (patch.rok !== undefined) set('rok', patch.rok || null);
  if (patch.dogovorenaCijena !== undefined) set('dogovorenaCijena', patch.dogovorenaCijena ?? null);
  if (patch.trosakRada !== undefined) set('trosakRada', patch.trosakRada ?? 0);
  if (patch.napomena !== undefined) set('napomena', patch.napomena || null);

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE radni_nalozi SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/** Briše nalog i stavke. Samo nezavršen nalog čija ponuda nije fakturisana. U transakciji. */
export function deleteNalog(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  // Odštampan račun bez naloga mogao bi se samo odbaciti.
  baciAkoCekaNezavrsen(db, 'nalogId', id, 'Račun za ovaj nalog', 'prije brisanja naloga');
  if (n.ponudaId != null) baciAkoCekaNezavrsen(db, 'ponudaId', n.ponudaId, 'Račun po ponudi ovog naloga', 'prije brisanja naloga');
  baciAkoZakljucan(n.status);
  baciAkoPonudaFakturisana(db, n.ponudaId, 'obrisati');
  db.prepare('DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?').run(id);
  db.prepare('DELETE FROM radni_nalog_proizvodi WHERE radniNalogId = ?').run(id);
  db.prepare('DELETE FROM radni_nalozi WHERE id = ?').run(id);
}

/** Da li artikal figuriše u proizvodnji (normativ, stavka naloga, proizvod naloga) — tada se ne briše. */
export function jeArtikalUProizvodnji(db: SqlDb, productId: number): boolean {
  const row = db.prepare(`
    SELECT 1 AS x FROM normativi WHERE materijalId = ? OR productId = ?
    UNION ALL SELECT 1 FROM radni_nalog_stavke WHERE materijalId = ?
    UNION ALL SELECT 1 FROM radni_nalozi WHERE productId = ?
    UNION ALL SELECT 1 FROM radni_nalog_proizvodi WHERE productId = ?
    LIMIT 1
  `).get(productId, productId, productId, productId, productId);
  return !!row;
}

// ── čitanje ──────────────────────────────────────────────

const NALOG_SELECT = `
  SELECT rn.*,
    k.naziv AS kupacNaziv, k.idBroj AS kupacIdBroj, k.adresa AS kupacAdresa,
    k.grad AS kupacGrad, k.postanskiBroj AS kupacPostanskiBroj,
    p.naziv AS productNaziv, p.cijena AS productCijena,
    u.ime AS korisnikIme,
    o.brojFiskalnogRacuna AS racunBroj, o.status AS racunStatus,
    po.broj AS ponudaBroj, po.godina AS ponudaGodina
  FROM radni_nalozi rn
  LEFT JOIN kupci k ON k.id = rn.kupacId
  LEFT JOIN products p ON p.id = rn.productId
  LEFT JOIN users u ON u.id = rn.korisnikId
  LEFT JOIN orders o ON o.id = rn.racunId
  LEFT JOIN ponude po ON po.id = rn.ponudaId
`;

export function getNalogStavke(db: SqlDb, id: number): RadniNalogStavka[] {
  const stavke = db.prepare(`
    SELECT s.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm,
      m.plocaSirina, m.plocaVisina
    FROM radni_nalog_stavke s
    LEFT JOIN products m ON m.id = s.materijalId
    WHERE s.radniNalogId = ?
    ORDER BY s.id
  `).all(id) as RadniNalogStavka[];
  for (const s of stavke) s.stanje = getProductStock(db, s.materijalId);
  return stavke;
}

export function getNalogProizvodi(db: SqlDb, id: number): RadniNalogProizvod[] {
  return db.prepare(`
    SELECT rp.*, p.naziv AS productNaziv, p.sifra AS productSifra, p.jm AS productJm
    FROM radni_nalog_proizvodi rp LEFT JOIN products p ON p.id = rp.productId
    WHERE rp.radniNalogId = ? ORDER BY rp.id
  `).all(id) as RadniNalogProizvod[];
}

export function getNalog(db: SqlDb, id: number): RadniNalog {
  const n = db.prepare(`${NALOG_SELECT} WHERE rn.id = ?`).get(id) as RadniNalog | undefined;
  if (!n) throw new Error('Radni nalog ne postoji');
  n.stavke = getNalogStavke(db, id);
  n.proizvodi = getNalogProizvodi(db, id);
  return n;
}

export function listNalozi(db: SqlDb, filter?: { status?: NalogStatus | 'aktivni' }): RadniNalog[] {
  let where = '';
  const params: any[] = [];
  if (filter?.status === 'aktivni') where = "WHERE rn.status != 'fakturisan'";
  else if (filter?.status) { where = 'WHERE rn.status = ?'; params.push(filter.status); }
  return db.prepare(`${NALOG_SELECT} ${where} ORDER BY rn.godina DESC, rn.broj DESC`).all(...params) as RadniNalog[];
}

// ── normativi ────────────────────────────────────────────

/** Stavke utroška za nalog od `kolicina` komada: normativ × količina, na 4 decimale. */
export function stavkeIzNormativa(
  normativ: Array<Pick<NormativStavka, 'materijalId' | 'kolicina' | 'napomena'>>, kolicina: number
): NalogStavkaInput[] {
  return normativ.map(n => ({ materijalId: n.materijalId, kolicina: round4(n.kolicina * kolicina), napomena: n.napomena ?? null }));
}

export function getNormativ(db: SqlDb, productId: number): NormativStavka[] {
  return db.prepare(`
    SELECT n.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm
    FROM normativi n LEFT JOIN products m ON m.id = n.materijalId
    WHERE n.productId = ? ORDER BY n.id
  `).all(productId) as NormativStavka[];
}

/** Zamijeni normativ proizvoda. U transakciji. */
export function saveNormativ(db: SqlDb, productId: number, stavke: NalogStavkaInput[]): void {
  const p = productTip(db, productId);
  if (!p || p.tip !== 'artikal') throw new Error('Normativ se vodi samo za artikal');
  validirajStavke(db, stavke);
  baciAkoDupliMaterijal(db, stavke);
  db.prepare('DELETE FROM normativi WHERE productId = ?').run(productId);
  const ins = db.prepare('INSERT INTO normativi (productId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)');
  for (const s of stavke) ins.run(productId, s.materijalId, round4(s.kolicina), s.napomena ?? null);
}

// ── nabavna cijena ───────────────────────────────────────

/**
 * Prosječna ponderisana nabavna cijena iz svih primki materijala, po kalkulaciji
 * ulaza: fakturna − rabat + zavisni troškovi (prevoz i sl.). 0 bez primki.
 */
export function getProsjecnaNabavna(db: SqlDb, materijalId: number): number {
  const row = db.prepare(`
    SELECT SUM(kolicina * nabavnaCijena * (1 - COALESCE(rabat, 0) / 100.0) + COALESCE(zavisniTroskovi, 0)) AS vrijednost, SUM(kolicina) AS kolicina
    FROM primka_stavke WHERE productId = ?
  `).get(materijalId) as { vrijednost: number | null; kolicina: number | null };
  if (!row.kolicina || row.kolicina <= 0) return 0;
  return round4((row.vrijednost ?? 0) / row.kolicina);
}

// ── kalkulacija ──────────────────────────────────────────

export interface KalkulacijaStavka {
  materijalId: number;
  naziv: string;
  jm: string;
  kolicina: number;
  cijena: number;
  iznos: number;
  stanje: number;
  /** true = cijena zamrznuta pri završetku, false = trenutna prosječna. */
  zamrznuto: boolean;
}

export interface Kalkulacija {
  stavke: KalkulacijaStavka[];
  materijal: number;
  rad: number;
  ukupno: number;
  /** Narudžba: neto dogovorene cijene, marža KM i %. */
  neto?: number;
  marza?: number;
  marzaPct?: number;
  /** Zaliha: trošak po komadu. */
  poKomadu?: number;
  upozorenja: string[];
}

type NalogZaKalkulaciju = Pick<RadniNalog, 'vrsta' | 'kolicina' | 'dogovorenaCijena' | 'trosakRada' | 'status'>;
type StavkaZaKalkulaciju = RadniNalogStavka & { trenutnaCijena: number; naziv?: string };

/** Čista kalkulacija — bez baze, testabilna. */
export function kalkulacija(nalog: NalogZaKalkulaciju, stavke: StavkaZaKalkulaciju[]): Kalkulacija {
  const upozorenja: string[] = [];
  const otvoren = nalog.status === 'otvoren' || nalog.status === 'u_izradi';

  // Isti materijal može biti na više stavki (npr. ploča u dvije dimenzije) — stanje
  // pokriva njihov zbir, pa se upozorava jednom po materijalu.
  const zbir = new Map<number, number>();
  for (const s of stavke) zbir.set(s.materijalId, (zbir.get(s.materijalId) ?? 0) + s.kolicina);
  const upozoren = new Set<number>();

  const ks: KalkulacijaStavka[] = stavke.map(s => {
    const naziv = s.naziv ?? s.materijalNaziv ?? `#${s.materijalId}`;
    const zamrznuto = s.nabavnaCijena != null;
    const cijena = zamrznuto ? s.nabavnaCijena! : s.trenutnaCijena;
    const stanje = s.stanje ?? 0;
    if (!upozoren.has(s.materijalId)) {
      upozoren.add(s.materijalId);
      const utrosak = round4(zbir.get(s.materijalId)!);
      if (cijena <= 0) upozorenja.push(`${naziv}: nema nabavne cijene (nema primke)`);
      if (otvoren && utrosak > stanje + TOLERANCIJA_ZALIHE) upozorenja.push(`${naziv}: utrošak ${utrosak} prelazi stanje ${stanje}`);
    }
    return {
      materijalId: s.materijalId, naziv, jm: s.materijalJm ?? '', kolicina: s.kolicina,
      cijena, iznos: round2(s.kolicina * cijena), stanje, zamrznuto,
    };
  });

  const materijal = round2(ks.reduce((sum, s) => sum + s.iznos, 0));
  const rad = round2(nalog.trosakRada ?? 0);
  const ukupno = round2(materijal + rad);
  const out: Kalkulacija = { stavke: ks, materijal, rad, ukupno, upozorenja };

  if (nalog.vrsta === 'narudzba') {
    const bruto = nalog.dogovorenaCijena ?? 0;
    const neto = round2(uNetto(bruto, 'E'));
    const marza = round2(neto - ukupno);
    out.neto = neto;
    out.marza = marza;
    out.marzaPct = neto > 0 ? round2((marza / neto) * 100) : 0;
  } else {
    out.poKomadu = nalog.kolicina > 0 ? round2(ukupno / nalog.kolicina) : 0;
  }
  return out;
}

export function kalkulacijaNaloga(db: SqlDb, id: number): Kalkulacija {
  const n = getNalog(db, id);
  const stavke = (n.stavke ?? []).map(s => ({ ...s, trenutnaCijena: getProsjecnaNabavna(db, s.materijalId) }));
  return kalkulacija(n, stavke);
}

// ── statusi i knjiženje ──────────────────────────────────

export function setStatusNaloga(db: SqlDb, id: number, status: 'u_izradi'): void {
  const n = ucitajNalogIliBaci(db, id);
  if (status === 'u_izradi' && n.status === 'otvoren') {
    db.prepare("UPDATE radni_nalozi SET status = 'u_izradi' WHERE id = ?").run(id);
    return;
  }
  throw new Error(`Prelaz ${n.status} → ${status} nije dozvoljen`);
}

/**
 * Završetak: izlaz materijala po stavkama (zamrzne prosječnu nabavnu), a za
 * zalihu i ulaz gotovog proizvoda. Nalog iz ponude uvodi na stanje proizvode
 * koje izrađuje (radni_nalog_proizvodi) — prodaja po ponudi ih skida, prije ili
 * poslije završetka, kao i robu sa zalihe. Negativno stanje ne blokira — ploča
 * se često potroši prije nego što se primka unese. U transakciji.
 */
export function zavrsiNalog(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.status !== 'otvoren' && n.status !== 'u_izradi') throw new Error('Nalog je već završen');
  const stavke = db.prepare('SELECT id, materijalId, kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?')
    .all(id) as Array<{ id: number; materijalId: number; kolicina: number }>;
  if (stavke.length === 0) throw new Error('Nalog nema stavki utroška');
  const proizvodi = db.prepare('SELECT productId, kolicina FROM radni_nalog_proizvodi WHERE radniNalogId = ? ORDER BY id')
    .all(id) as Array<{ productId: number; kolicina: number }>;
  // Prihvaćena ponuda se i dalje može mijenjati — izbor mora odgovarati ponudi
  // kakva je sada, inače bi na stanje ušlo ono što se neće prodati.
  if (proizvodi.length > 0 && n.ponudaId) {
    try {
      validirajProizvode(db, n.ponudaId, proizvodi);
    } catch (err: any) {
      throw new Error(
        `Ponuda je mijenjana nakon izbora proizvoda — ${err?.message}. Provjerite šta nalog izrađuje pa ga ponovo završite.`
      );
    }
  }

  const izlaz = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'radni_nalog', ?)"
  );
  const zamrzni = db.prepare('UPDATE radni_nalog_stavke SET nabavnaCijena = ? WHERE id = ?');
  for (const s of stavke) {
    zamrzni.run(getProsjecnaNabavna(db, s.materijalId), s.id);
    izlaz.run(s.materijalId, s.kolicina, id);
  }
  const ulaz = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'radni_nalog', ?)"
  );
  if (n.vrsta === 'zaliha' && n.productId) {
    ulaz.run(n.productId, n.kolicina, id);
  }
  for (const p of proizvodi) ulaz.run(p.productId, p.kolicina, id);
  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen', zavrsenAt = datetime('now','localtime') WHERE id = ?").run(id);
}

/**
 * Poništi knjiženja završetka i otključaj nalog. Fakturisan nalog (ili nalog
 * čija je ponuda fakturisana) se ne vraća, kao ni nalog čiji je proizvod već
 * prodan/izdat — brisanje ulaza bi ostavilo stanje u minusu. U transakciji.
 */
export function vratiUIzradu(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.status === 'fakturisan') throw new Error('Nalog je fakturisan i ne može se vratiti u izradu');
  if (n.status !== 'zavrsen') throw new Error('Samo završen nalog se vraća u izradu');
  // Račun koji čeka u nezavršenim fakturiše završen nalog kad se riješi.
  baciAkoCekaNezavrsen(db, 'nalogId', id, 'Račun za ovaj nalog', 'prije vraćanja naloga u izradu');
  // I račun po ponudi naloga izdat sa ekrana Ponude: kad se riješi, ponuda je fakturisana.
  if (n.ponudaId != null) {
    baciAkoCekaNezavrsen(db, 'ponudaId', n.ponudaId, 'Račun po ponudi ovog naloga', 'prije vraćanja naloga u izradu');
  }
  baciAkoPonudaFakturisana(db, n.ponudaId, 'vratiti u izradu');

  const ulazi = db.prepare(`
    SELECT sm.productId, SUM(sm.kolicina) AS kolicina, p.naziv
    FROM stock_movements sm LEFT JOIN products p ON p.id = sm.productId
    WHERE sm.referenceType = 'radni_nalog' AND sm.referenceId = ? AND sm.tip = 'ulaz'
    GROUP BY sm.productId ORDER BY MIN(sm.id)
  `).all(id) as Array<{ productId: number; kolicina: number; naziv: string | null }>;
  for (const u of ulazi) {
    const stanje = getProductStock(db, u.productId);
    if (stanje < u.kolicina - TOLERANCIJA_ZALIHE) {
      throw new Error(
        `Proizvod "${u.naziv ?? `#${u.productId}`}" je već prodan/izdat — nalog se ne može vratiti u izradu ` +
        `(na stanju ${round4(stanje)}, nalog je uveo ${round4(u.kolicina)})`
      );
    }
  }
  db.prepare("DELETE FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?").run(id);
  db.prepare('UPDATE radni_nalog_stavke SET nabavnaCijena = NULL WHERE radniNalogId = ?').run(id);
  db.prepare("UPDATE radni_nalozi SET status = 'u_izradi', zavrsenAt = NULL WHERE id = ?").run(id);
}

export function fakturisiNalog(db: SqlDb, id: number, racunId: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.vrsta !== 'narudzba') throw new Error('Račun se izdaje samo za nalog po narudžbi');
  if (n.status !== 'zavrsen') throw new Error('Nalog mora biti završen prije izdavanja računa');
  db.prepare("UPDATE radni_nalozi SET status = 'fakturisan', racunId = ? WHERE id = ?").run(racunId, id);
}

// ── izdavanje računa ─────────────────────────────────────

/** Usluga preko koje se prodaje rad po mjeri — kreira se pri uključivanju modula. */
export const PRODAJNA_USLUGA = { sifra: 'NAMJ', naziv: 'Namještaj po mjeri' } as const;

/**
 * Id postojeće usluge NAMJ ili null ako je još nema. Baca ako šifru drži
 * artikal/materijal — prodaja preko njega bi skidala robu sa zalihe.
 */
function postojecaProdajnaUsluga(db: SqlDb): number | null {
  const row = db.prepare('SELECT id, tip, naziv FROM products WHERE sifra = ?').get(PRODAJNA_USLUGA.sifra) as
    { id: number; tip: string; naziv: string } | undefined;
  if (!row) return null;
  if (row.tip !== 'usluga') {
    throw new Error(
      `Šifra ${PRODAJNA_USLUGA.sifra} je zauzeta artiklom "${row.naziv}" koji nije usluga — ` +
      'promijenite šifru tog artikla pa ponovo izdajte račun'
    );
  }
  return row.id;
}

/**
 * Pri uključivanju modula: kreira uslugu NAMJ ako šifra nije zauzeta. Postojeći
 * proizvod sa tom šifrom se ne dira (ni kad nije usluga — tada izdavanje
 * računa za nalog javi grešku prije štampe).
 */
export function osigurajProdajnuUslugu(db: SqlDb): number {
  const row = db.prepare('SELECT id FROM products WHERE sifra = ?').get(PRODAJNA_USLUGA.sifra) as { id: number } | undefined;
  if (row) return row.id;
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', 0, 'E', 'usluga')"
  ).run(PRODAJNA_USLUGA.sifra, PRODAJNA_USLUGA.naziv);
  return Number(r.lastInsertRowid);
}

const izdavanjaUToku = new Set<number>();

/**
 * Upiše fakturisanje naloga (status → fakturisan, racunId) u transakciji.
 * Račun u tom trenutku već postoji (ponuda konvertovana sa ekrana Ponude) —
 * greška ovdje ne smije proći nezapaženo jer nalog i knjigovodstvo ispadnu iz sinhrona.
 */
function knjiziFakturisanjeNaloga(
  db: SqlDb, transaction: KonverzijaDeps['transaction'],
  nalogId: number, racunId: number, brojFiskalnogRacuna: string | null
): void {
  try {
    transaction(() => fakturisiNalog(db, nalogId, racunId))();
  } catch (err: any) {
    throw new Error(
      `Račun ${brojFiskalnogRacuna ?? '?'} JE odštampan, ali nalog nije zabilježen kao fakturisan u bazi: ` +
      `${err?.message || 'nepoznata greška'}. Evidentirajte nalog ručno.`
    );
  }
}

/**
 * Upis računa za samostalni nalog iz write-ahead snapshota: stavka usluge NAMJ
 * (kreira se tek ovdje — neuspjela štampa ne ostavlja tragove) i nalog →
 * fakturisan. Isti upis ide nakon uspješne štampe i iz dijaloga nezavršenih
 * računa. U transakciji. Rust: `upisi_racun_naloga`.
 */
export function upisiRacunNaloga(
  db: SqlDb, snap: SnapshotNaloga,
  opts: { brojFiskalnogRacuna: string | null; createdAt?: string; isManual?: 0 | 1 },
): number {
  const usluga = postojecaProdajnaUsluga(db) ?? osigurajProdajnuUslugu(db);
  const orderId = upisiRacun(db, {
    korisnikId: snap.korisnikId, ukupno: snap.ukupno, pdvIznos: snap.pdvIznos,
    nacinPlacanja: snap.nacinPlacanja, brojFiskalnogRacuna: opts.brojFiskalnogRacuna, kupac: snap.kupac,
    stavke: snap.stavke.map(s => ({ ...s, productId: usluga })),
    createdAt: opts.createdAt, isManual: opts.isManual,
  });
  fakturisiNalog(db, snap.nalogId, orderId);
  return orderId;
}

/**
 * Fiskalni račun za završen nalog po narudžbi. Nalog iz ponude ide kroz
 * konverziju ponude (stvarne stavke; nalog se fakturiše u istoj transakciji);
 * samostalan nalog ide kao jedna stavka usluge "Namještaj po mjeri" po
 * dogovorenoj cijeni. Upis tek nakon štampe, uz write-ahead red (vrsta
 * 'ponuda' odnosno 'nalog' — lib/pendingRacun.ts). Ako je ponuda već
 * konvertovana direktno (npr. sa ekrana Ponude), nalog se samo poveže sa
 * postojećim računom — bez ponovne štampe.
 */
export async function izdajRacunZaNalog(
  deps: KonverzijaDeps,
  data: { id: number; korisnikId: number; nacinPlacanja: string }
): Promise<KonverzijaResult> {
  const { db, print, transaction } = deps;
  const nalog = getNalog(db, data.id);
  if (nalog.vrsta !== 'narudzba') throw new Error('Račun se izdaje samo za nalog po narudžbi');
  if (nalog.status !== 'zavrsen') throw new Error('Nalog mora biti završen prije izdavanja računa');
  if (izdavanjaUToku.has(nalog.id)) throw new Error('Izdavanje računa za ovaj nalog je već u toku');
  // Sve što bi upis nakon štampe odbio (FK na korisnika) provjerava se prije štampe.
  const korisnik = data.korisnikId ? db.prepare('SELECT id FROM users WHERE id = ?').get(data.korisnikId) : undefined;
  if (!korisnik) throw new Error('Korisnik nije prijavljen');
  // Štampa bez oznake plaćanja ide kao Gotovina — i u bazu se tako upisuje.
  const nacinPlacanja = provjeriNacinPlacanja(data.nacinPlacanja || 'Gotovina');
  baciAkoCekaNezavrsen(db, 'nalogId', nalog.id, 'Račun za ovaj nalog');

  izdavanjaUToku.add(nalog.id);
  try {
    if (nalog.ponudaId) {
      const ponuda = db.prepare('SELECT status, racunId FROM ponude WHERE id = ?').get(nalog.ponudaId) as
        { status: string; racunId: number | null } | undefined;

      if (ponuda?.status === 'konvertovana' && ponuda.racunId) {
        const order = db.prepare('SELECT brojFiskalnogRacuna FROM orders WHERE id = ?').get(ponuda.racunId) as
          { brojFiskalnogRacuna: string | null } | undefined;
        const brojFiskalnogRacuna = order?.brojFiskalnogRacuna ?? null;
        knjiziFakturisanjeNaloga(db, transaction, nalog.id, ponuda.racunId, brojFiskalnogRacuna);
        return { success: true, racunId: ponuda.racunId, brojFiskalnogRacuna, odgovori: {} };
      }

      return await konvertujPonudu(
        deps, { id: nalog.ponudaId, korisnikId: data.korisnikId, nacinPlacanja }, { nalogId: nalog.id },
      );
    }

    const cijena = nalog.dogovorenaCijena ?? 0;
    if (!(cijena > 0)) throw new Error('Dogovorena cijena mora biti upisana prije izdavanja računa');
    // Usluga se kreira tek uz uspješan upis — ovdje se samo provjeri da šifra nije zauzeta.
    const postojecaUsluga = postojecaProdajnaUsluga(db);
    const stavke = [{
      productId: postojecaUsluga ?? 0, kolicina: 1, cijena, rabat: 0, pdvStopa: 'E',
      productSifra: PRODAJNA_USLUGA.sifra, productNaziv: PRODAJNA_USLUGA.naziv, productJm: 'kom', productTip: 'usluga',
    }];
    const { ukupno, pdvIznos } = izracunajTotale(stavke);
    const kupac = nalog.kupacId
      ? db.prepare('SELECT * FROM kupci WHERE id = ?').get(nalog.kupacId) as any
      : null;

    const racun = buildTringRacun({
      stavke, ukupno, nacinPlacanja,
      kupac: kupac ? {
        idBroj: kupac.idBroj, naziv: kupac.naziv, adresa: kupac.adresa || '',
        postanskiBroj: kupac.postanskiBroj || '', grad: kupac.grad || '',
      } : undefined,
    });

    const snapshot: SnapshotNaloga = {
      vrsta: 'nalog', nalogId: nalog.id, nalogBroj: nalog.broj, nalogGodina: nalog.godina,
      korisnikId: data.korisnikId, ukupno, pdvIznos, nacinPlacanja, kupac: snapshotKupca(kupac),
      stavke: [{
        productId: postojecaUsluga ?? 0, naziv: PRODAJNA_USLUGA.naziv, kolicina: 1, cijena,
        rabat: 0, pdvStopa: 'E', productTip: 'usluga',
      }],
    };
    const pendingId = zapisiPending(db, data.korisnikId, snapshot);

    let result: Tring.TringResponse | null;
    try {
      result = await print(racun);
    } catch (err) {
      // Izuzetak iz štampe — ništa nije odštampano, počisti write-ahead red.
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
      throw err;
    }
    // Siguran neuspjeh briše pending red; nepoznat ishod ga ostavlja.
    if (!result || !result.success) return neuspjelaStampa(db, pendingId, result);
    const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;

    let racunId: number | null;
    try {
      racunId = transaction(() => {
        // Red riješen iz dijaloga dok je štampa trajala → bez drugog zapisa.
        if (!preuzmiPendingRed(db, pendingId)) return null;
        return upisiRacunNaloga(db, snapshot, { brojFiskalnogRacuna });
      })();
    } catch (err: any) {
      // Račun je već na papiru; pending red ostaje (rollback) za dijalog.
      throw new Error(
        `Račun ${brojFiskalnogRacuna ?? '?'} JE odštampan, ali nije zabilježen u bazi: ` +
        `${err?.message || 'nepoznata greška'}. Riješite ga kroz nezavršene račune.`
      );
    }
    if (racunId === null) return vecEvidentiran(brojFiskalnogRacuna);
    return { success: true, racunId, brojFiskalnogRacuna, odgovori: result.odgovori };
  } finally {
    izdavanjaUToku.delete(nalog.id);
  }
}
