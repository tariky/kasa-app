import type { SqlDb } from './sqldb';
import { localDateStr } from './novac';
import { getProductStock } from './skladiste';
import type {
  NalogStatus, NalogVrsta, NormativStavka, RadniNalog, RadniNalogStavka,
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

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ── numeracija ───────────────────────────────────────────

export function nextBrojNaloga(db: SqlDb, godina: number): number {
  const row = db.prepare('SELECT MAX(broj) AS maxBroj FROM radni_nalozi WHERE godina = ?')
    .get(godina) as { maxBroj: number | null };
  return (row.maxBroj ?? 0) + 1;
}

export function formatBrojNaloga(n: { broj: number; godina: number }): string {
  return `RN-${n.broj}/${n.godina}`;
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
    if (normativ.length > 0) {
      upisiStavke(db, id, normativ.map(n => ({
        materijalId: n.materijalId, kolicina: round4(n.kolicina * kolicina), napomena: n.napomena ?? null,
      })));
    }
  }

  return { id, broj, godina };
}

/** Nalog iz prihvaćene ponude: kupac, opis (nazivi stavki) i cijena sa ponude. U transakciji. */
export function createNalogIzPonude(db: SqlDb, ponudaId: number, korisnikId: number): { id: number; broj: number; godina: number } {
  const ponuda = db.prepare('SELECT id, kupacId, status, ukupno FROM ponude WHERE id = ?').get(ponudaId) as any;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status !== 'prihvacena') throw new Error('Ponuda mora biti prihvaćena da bi se otvorio radni nalog');
  if (nalogZaPonudu(db, ponudaId)) throw new Error('Za ovu ponudu radni nalog već postoji');

  const nazivi = db.prepare(`
    SELECT p.naziv FROM ponuda_stavke ps LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? ORDER BY ps.id
  `).all(ponudaId) as Array<{ naziv: string | null }>;
  const opis = nazivi.map(n => n.naziv).filter(Boolean).join(', ') || `Ponuda ${ponudaId}`;

  return createNalog(db, {
    vrsta: 'narudzba', korisnikId, kupacId: ponuda.kupacId, ponudaId, opis,
    dogovorenaCijena: ponuda.ukupno,
  });
}

export function nalogZaPonudu(db: SqlDb, ponudaId: number): { id: number; broj: number; godina: number } | null {
  const row = db.prepare('SELECT id, broj, godina FROM radni_nalozi WHERE ponudaId = ? LIMIT 1').get(ponudaId) as any;
  return row ?? null;
}

export function updateNalog(
  db: SqlDb, id: number,
  patch: Partial<Omit<NalogInput, 'vrsta' | 'korisnikId'>>
): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);

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
  if (patch.datum !== undefined) set('datum', patch.datum);
  if (patch.rok !== undefined) set('rok', patch.rok || null);
  if (patch.dogovorenaCijena !== undefined) set('dogovorenaCijena', patch.dogovorenaCijena ?? null);
  if (patch.trosakRada !== undefined) set('trosakRada', patch.trosakRada ?? 0);
  if (patch.napomena !== undefined) set('napomena', patch.napomena || null);

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE radni_nalozi SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/** Briše nalog i stavke. Samo nezavršen nalog. U transakciji. */
export function deleteNalog(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);
  db.prepare('DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?').run(id);
  db.prepare('DELETE FROM radni_nalozi WHERE id = ?').run(id);
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

export function getNalog(db: SqlDb, id: number): RadniNalog {
  const n = db.prepare(`${NALOG_SELECT} WHERE rn.id = ?`).get(id) as RadniNalog | undefined;
  if (!n) throw new Error('Radni nalog ne postoji');
  n.stavke = getNalogStavke(db, id);
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
  db.prepare('DELETE FROM normativi WHERE productId = ?').run(productId);
  const ins = db.prepare('INSERT INTO normativi (productId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)');
  for (const s of stavke) ins.run(productId, s.materijalId, round4(s.kolicina), s.napomena ?? null);
}
