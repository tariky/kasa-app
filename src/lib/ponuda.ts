import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { izracunajTotale, upisiRacun } from './racun';
import { localDateStr } from './novac';
import { buildTringRacun } from './tringRacun';
import { provjeriStavke } from './provjeraRacuna';
import { provjeriNacinPlacanja } from './placanje';

export interface PonudaStavka {
  productId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
}

export interface PonudaInput {
  kupacId: number;
  korisnikId: number;
  datum?: string;
  vaziDo?: string;
  napomena?: string;
  stavke: PonudaStavka[];
}

/** Default rok važenja ponude (uobičajena "opcija 8 dana"). */
export const DEFAULT_ROK_DANA = 8;

/** Datum ("YYYY-MM-DD") pomjeren za `dana` dana naprijed. */
export function plusDana(datum: string, dana: number): string {
  const d = new Date(`${datum}T00:00:00`);
  d.setDate(d.getDate() + dana);
  return localDateStr(d);
}

/**
 * Broj punih dana od `od` do `do_`. Računa se preko UTC ponoći da ljetno
 * računanje vremena ne pojede/doda sat i obori rezultat za jedan dan.
 */
export function danaIzmedju(od: string, do_: string): number {
  const a = Date.parse(`${od}T00:00:00Z`);
  const b = Date.parse(`${do_}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Sljedeći redni broj ponude u godini — brojanje kreće od 1 svake godine. */
export function nextBrojPonude(db: SqlDb, godina: number): number {
  const row = db.prepare('SELECT MAX(broj) AS maxBroj FROM ponude WHERE godina = ?')
    .get(godina) as { maxBroj: number | null };
  return (row.maxBroj ?? 0) + 1;
}

/** Prikazni oblik broja ponude, npr. "3/2026". */
export function formatBrojPonude(p: { broj: number; godina: number }): string {
  return `${p.broj}/${p.godina}`;
}

/**
 * Upiše ponudu sa stavkama. Cijene stavki se zamrzavaju kopiranjem u
 * `ponuda_stavke` — kasnija promjena cjenovnika ne smije mijenjati ponudu,
 * jer je ponuda obećanje kupcu. Poziva se unutar transakcije.
 */
export function createPonuda(
  db: SqlDb,
  data: PonudaInput
): { id: number; broj: number; godina: number } {
  if (!data.stavke || data.stavke.length === 0) {
    throw new Error('Ponuda mora imati najmanje jednu stavku');
  }
  if (!data.kupacId) throw new Error('Kupac je obavezan');
  const stavke = provjeriStavke(db, data.stavke);

  const datum = data.datum || localDateStr();
  const godina = Number(datum.slice(0, 4));
  const broj = nextBrojPonude(db, godina);
  const vaziDo = data.vaziDo || plusDana(datum, DEFAULT_ROK_DANA);
  const { ukupno, pdvIznos } = izracunajTotale(stavke);

  const result = db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, napomena, ukupno, pdvIznos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(broj, godina, data.kupacId, data.korisnikId, datum, vaziDo, data.napomena ?? null, ukupno, pdvIznos);

  const id = Number(result.lastInsertRowid);

  const insertStavka = db.prepare(
    'INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of stavke) {
    insertStavka.run(id, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
  }

  return { id, broj, godina };
}

export type PonudaStatus = 'draft' | 'poslana' | 'prihvacena' | 'odbijena' | 'konvertovana';

/** Statusi koje baza prihvata (CHECK na ponude.status). */
export const PONUDA_STATUSI: readonly PonudaStatus[] = ['draft', 'poslana', 'prihvacena', 'odbijena', 'konvertovana'];

/**
 * Status kakav se prikazuje: 'istekla' se ne upisuje u bazu nego izvodi iz
 * roka — samo za ponude koje još čekaju odgovor (draft/poslana). Zadnji dan
 * roka ponuda još važi.
 */
export function efektivniStatus(
  p: { status: string; vaziDo: string },
  danas: string = localDateStr()
): string {
  if ((p.status === 'draft' || p.status === 'poslana') && danas > p.vaziDo) return 'istekla';
  return p.status;
}

/** Ručna promjena statusa. 'konvertovana' smije postaviti samo konverzija. */
export function setStatusPonude(db: SqlDb, id: number, status: PonudaStatus): void {
  if (!PONUDA_STATUSI.includes(status)) {
    // 'istekla' je samo prikazni status (vidi efektivniStatus) — ne upisuje se.
    throw new Error(`Nepoznat status ponude: "${status ?? ''}"`);
  }
  if (status === 'konvertovana') {
    throw new Error('Status "konvertovana" postavlja se konverzijom u račun');
  }
  const ponuda = db.prepare('SELECT status FROM ponude WHERE id = ?')
    .get(id) as { status: string } | undefined;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status === 'konvertovana') throw new Error('Konvertovana ponuda se ne može mijenjati');

  db.prepare('UPDATE ponude SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Obriše ponudu i njene stavke. Konvertovana ponuda i ponuda za koju postoji
 * radni nalog se ne brišu — nalog se ne briše kaskadno, operater ga mora
 * svjesno obrisati prvo. Nepostojeća ponuda nije greška (changes: 0).
 * Poziva se unutar transakcije.
 */
export function deletePonuda(db: SqlDb, id: number): { changes: number } {
  const ponuda = db.prepare('SELECT status FROM ponude WHERE id = ?').get(id) as { status: string } | undefined;
  if (!ponuda) return { changes: 0 };
  if (ponuda.status === 'konvertovana') {
    throw new Error('Konvertovana ponuda se ne može obrisati — po njoj je izdat račun');
  }
  const nalog = db.prepare('SELECT broj, godina FROM radni_nalozi WHERE ponudaId = ? ORDER BY id LIMIT 1')
    .get(id) as { broj: number; godina: number } | undefined;
  if (nalog) {
    throw new Error(`Ponuda je vezana za radni nalog RN-${nalog.broj}/${nalog.godina} — prvo obrišite nalog`);
  }
  db.prepare('DELETE FROM ponuda_stavke WHERE ponudaId = ?').run(id);
  const r = db.prepare('DELETE FROM ponude WHERE id = ?').run(id);
  return { changes: Number(r.changes) };
}

/**
 * Izmijeni ponudu (stavke, kupca, rok, napomenu) i preračunaj totale.
 * Broj i godina se nikad ne mijenjaju — dodijeljeni su pri kreiranju.
 * Konvertovana ponuda je zaključana: račun je već izdat po njoj.
 * Poziva se unutar transakcije.
 */
export function updatePonuda(
  db: SqlDb,
  id: number,
  data: { kupacId?: number; datum?: string; vaziDo?: string; napomena?: string; stavke: PonudaStavka[] }
): void {
  if (!data.stavke || data.stavke.length === 0) {
    throw new Error('Ponuda mora imati najmanje jednu stavku');
  }

  const ponuda = db.prepare('SELECT id, status, kupacId, datum, vaziDo FROM ponude WHERE id = ?')
    .get(id) as { id: number; status: string; kupacId: number; datum: string; vaziDo: string } | undefined;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status === 'konvertovana') throw new Error('Konvertovana ponuda se ne može mijenjati');
  const stavke = provjeriStavke(db, data.stavke);

  const { ukupno, pdvIznos } = izracunajTotale(stavke);

  db.prepare(`
    UPDATE ponude SET kupacId = ?, datum = ?, vaziDo = ?, napomena = COALESCE(?, napomena),
      ukupno = ?, pdvIznos = ?
    WHERE id = ?
  `).run(
    data.kupacId ?? ponuda.kupacId, data.datum ?? ponuda.datum, data.vaziDo ?? ponuda.vaziDo,
    data.napomena ?? null, ukupno, pdvIznos, id
  );

  db.prepare('DELETE FROM ponuda_stavke WHERE ponudaId = ?').run(id);
  const insertStavka = db.prepare(
    'INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of stavke) {
    insertStavka.run(id, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
  }
}

export interface KonverzijaDeps {
  db: SqlDb;
  /** Štampa fiskalni račun na uređaju. */
  print: (racun: Tring.Racun) => Promise<Tring.TringResponse | null>;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: <T>(fn: () => T) => () => T;
}

export interface KonverzijaResult {
  success: boolean;
  racunId?: number;
  brojFiskalnogRacuna?: string | null;
  error?: string;
  odgovori?: Record<string, string>;
}

export { NACINI_PLACANJA } from './placanje';

/** Ponude kojima se konverzija trenutno štampa — zaštita od dvoklika. */
const konverzijeInFlight = new Set<number>();

/**
 * Odštampa fiskalni račun po ponudi i tek nakon uspješne štampe upiše račun,
 * razduži skladište i zaključa ponudu — u jednoj transakciji (isti obrazac
 * kao refundAndPrint). Račun ide po cijenama zamrznutim na ponudi, ne po
 * trenutnom cjenovniku. Istekla ponuda se smije konvertovati — operater
 * odlučuje da li dogovor još važi; odbijena ne smije.
 *
 * Sve što bi upis u bazu moglo oboriti (korisnik, način plaćanja, artikli)
 * provjerava se PRIJE štampe — odštampan fiskalni račun se ne može povući.
 */
export async function konvertujPonudu(
  deps: KonverzijaDeps,
  data: { id: number; korisnikId: number; nacinPlacanja: string }
): Promise<KonverzijaResult> {
  const { db, print, transaction } = deps;
  const id = data.id;

  if (konverzijeInFlight.has(id)) throw new Error('Konverzija ove ponude je već u toku');

  const korisnik = data.korisnikId
    ? db.prepare('SELECT id FROM users WHERE id = ?').get(data.korisnikId)
    : undefined;
  if (!korisnik) throw new Error('Korisnik nije prijavljen');

  const nacinPlacanja = provjeriNacinPlacanja(data.nacinPlacanja);

  const ponuda = db.prepare('SELECT * FROM ponude WHERE id = ?').get(id) as any;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status === 'konvertovana') throw new Error('Ponuda je već konvertovana u račun');
  if (ponuda.status === 'odbijena') {
    throw new Error('Odbijena ponuda se ne može pretvoriti u račun — ako kupac ipak prihvata, prvo promijenite status');
  }

  const stavke = db.prepare(`
    SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra,
           p.plu AS productPlu, p.tip AS productTip
    FROM ponuda_stavke ps
    LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ?
  `).all(id) as any[];
  if (stavke.length === 0) throw new Error('Ponuda nema stavki');
  // LEFT JOIN: artikal koji je nestao daje NULL naziv — upis stavke bi pao na
  // stranom ključu tek nakon štampe.
  if (stavke.some(s => s.productNaziv == null)) {
    throw new Error('Artikal na stavci ponude više ne postoji — izmijenite ponudu prije izdavanja računa');
  }

  const kupac = db.prepare('SELECT * FROM kupci WHERE id = ?').get(ponuda.kupacId) as any;

  konverzijeInFlight.add(id);
  try {
    const racun = buildTringRacun({
      stavke,
      ukupno: ponuda.ukupno,
      nacinPlacanja,
      kupac: kupac ? {
        idBroj: kupac.idBroj, naziv: kupac.naziv, adresa: kupac.adresa || '',
        postanskiBroj: kupac.postanskiBroj || '', grad: kupac.grad || '',
      } : undefined,
    });

    const result = await print(racun);

    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
        odgovori: result?.odgovori ?? {},
      };
    }

    const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;

    try {
      const racunId = transaction(() => {
        const orderId = upisiRacun(db, {
          korisnikId: data.korisnikId, ukupno: ponuda.ukupno, pdvIznos: ponuda.pdvIznos,
          nacinPlacanja, brojFiskalnogRacuna,
          kupac: kupac ?? null, stavke,
        });
        db.prepare("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?")
          .run(orderId, id);
        return orderId;
      })();

      return { success: true, racunId, brojFiskalnogRacuna, odgovori: result.odgovori };
    } catch (err: any) {
      // Račun je već na papiru i u fiskalnom uređaju — operater to mora znati.
      throw new Error(
        `Račun ${brojFiskalnogRacuna ?? '?'} JE odštampan, ali nije zabilježen u bazi: ` +
        `${err?.message || 'nepoznata greška'}. Evidentirajte račun ručno.`
      );
    }
  } finally {
    konverzijeInFlight.delete(id);
  }
}
