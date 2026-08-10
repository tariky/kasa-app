import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { izracunajTotale } from './racun';
import { localDateStr } from './novac';
import { buildTringRacun } from './tringRacun';

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

  const datum = data.datum || localDateStr();
  const godina = Number(datum.slice(0, 4));
  const broj = nextBrojPonude(db, godina);
  const vaziDo = data.vaziDo || plusDana(datum, DEFAULT_ROK_DANA);
  const { ukupno, pdvIznos } = izracunajTotale(data.stavke);

  const result = db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, napomena, ukupno, pdvIznos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(broj, godina, data.kupacId, data.korisnikId, datum, vaziDo, data.napomena ?? null, ukupno, pdvIznos);

  const id = Number(result.lastInsertRowid);

  const insertStavka = db.prepare(
    'INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of data.stavke) {
    insertStavka.run(id, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
  }

  return { id, broj, godina };
}

export type PonudaStatus = 'draft' | 'poslana' | 'prihvacena' | 'odbijena' | 'konvertovana';

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

  const { ukupno, pdvIznos } = izracunajTotale(data.stavke);

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
  for (const s of data.stavke) {
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

/** Ponude kojima se konverzija trenutno štampa — zaštita od dvoklika. */
const konverzijeInFlight = new Set<number>();

/**
 * Odštampa fiskalni račun po ponudi i tek nakon uspješne štampe upiše račun,
 * razduži skladište i zaključa ponudu — u jednoj transakciji (isti obrazac
 * kao refundAndPrint). Račun ide po cijenama zamrznutim na ponudi, ne po
 * trenutnom cjenovniku. Istekla ponuda se smije konvertovati — operater
 * odlučuje da li dogovor još važi.
 */
export async function konvertujPonudu(
  deps: KonverzijaDeps,
  data: { id: number; korisnikId: number; nacinPlacanja: string }
): Promise<KonverzijaResult> {
  const { db, print, transaction } = deps;
  const id = data.id;

  if (konverzijeInFlight.has(id)) throw new Error('Konverzija ove ponude je već u toku');

  const ponuda = db.prepare('SELECT * FROM ponude WHERE id = ?').get(id) as any;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status === 'konvertovana') throw new Error('Ponuda je već konvertovana u račun');

  const stavke = db.prepare(`
    SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra,
           p.plu AS productPlu, p.tip AS productTip
    FROM ponuda_stavke ps
    LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ?
  `).all(id) as any[];
  if (stavke.length === 0) throw new Error('Ponuda nema stavki');

  const kupac = db.prepare('SELECT * FROM kupci WHERE id = ?').get(ponuda.kupacId) as any;

  konverzijeInFlight.add(id);
  try {
    const racun = buildTringRacun({
      stavke,
      ukupno: ponuda.ukupno,
      nacinPlacanja: data.nacinPlacanja,
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
        const orderRes = db.prepare(`
          INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
            kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj)
          VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
        `).run(
          data.korisnikId, ponuda.ukupno, ponuda.pdvIznos, data.nacinPlacanja, brojFiskalnogRacuna,
          kupac?.naziv ?? null, kupac?.idBroj ?? null, kupac?.adresa ?? null,
          kupac?.grad ?? null, kupac?.postanskiBroj ?? null
        );
        const orderId = Number(orderRes.lastInsertRowid);

        const insertItem = db.prepare(
          'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertStock = db.prepare(
          "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)"
        );
        for (const s of stavke) {
          insertItem.run(orderId, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
          if (s.productTip !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
        }

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
