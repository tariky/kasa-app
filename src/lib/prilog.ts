import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { parseFiskalniBroj, predvidjeniFiskalniBroj } from './fiskalni';
import { validanDatumValute } from './valuta';
import { round2 } from './novac';
import { iznosStavke, izracunajTotale } from './racun';
import { buildTringRacun } from './tringRacun';
import { provjeriIznoseStavke, provjeriKupca } from './provjeraRacuna';
import { provjeriNacinPlacanja } from './placanje';

/**
 * Račun po prilogu: fiskalno se kuca jedna zbirna stavka, a stvarne stavke se
 * naknadno dodjeljuju (prilog_stavke) i printaju kao prilog uz fiskalni račun sa BF
 * brojem. Vidi docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md.
 */

export const PRILOG_SIFRA = 'PRILOG';

/** Zadani dijelovi naziva zbirne stavke — „Stavke po računu br. 5". */
export const PRILOG_OPIS_DEFAULT = 'Stavke';
export const PRILOG_VEZA_DEFAULT = 'računu';
/**
 * Veza koju dijalog Faktura nudi — „Stavke po fakturi br. 5". Zadana vrijednost
 * iznad ostaje „računu" jer stari računi bez sačuvanog naziva njome rekonstruišu
 * tekst koji je stvarno otišao na uređaj (storno, kopija).
 */
export const FAKTURA_VEZA = 'fakturi';

/** Fiskalni uređaj ima kratko polje naziva stavke — dijelovi se ograničavaju već na unosu. */
export const PRILOG_OPIS_MAX = 24;
export const PRILOG_VEZA_MAX = 14;

/**
 * Naziv zbirne stavke. Operater po računu bira uvodni dio i vezu — „CNC obrada
 * po fakturi br. 128" — a prazan unos pada na zadane vrijednosti.
 *
 * Broj je BF broj isječka na koji se stavka kuca, pa se u trenutku štampe zna
 * samo kao predviđanje (vidi `predvidjeniFiskalniBroj`). `null` daje naziv bez
 * broja — koristi ga pregled u dijalogu dok se broj još ne zna.
 */
export function prilogNaziv(broj: number | null, opis?: string | null, veza?: string | null): string {
  const o = (opis ?? '').trim().slice(0, PRILOG_OPIS_MAX) || PRILOG_OPIS_DEFAULT;
  const v = (veza ?? '').trim().slice(0, PRILOG_VEZA_MAX) || PRILOG_VEZA_DEFAULT;
  return broj == null ? `${o} po ${v}` : `${o} po ${v} br. ${broj}`;
}

export interface PrilogStavkaUnos {
  productId: number;
  kolicina: number;
  cijena: number;
  /** Postotak 0–100; stari snapshoti i pozivi ga nemaju pa znači 0. */
  rabat?: number;
  pdvStopa: string;
}

/** Napomena na fakturi — stane u nekoliko redova ispod stavki. */
export const FAKTURA_NAPOMENA_MAX = 500;

/** Zbir stavki priloga — zaokruživanje po stavci kao na fiskalnom uređaju. */
export function sumaPriloga(stavke: PrilogStavkaUnos[]): number {
  return round2(stavke.reduce((sum, s) => sum + iznosStavke({ ...s, rabat: s.rabat ?? 0 }), 0));
}

/** Prilog je kompletan tek kad se suma stavki poklopi sa fiskalnim iznosom. */
export function prilogKompletan(ukupno: number, stavke: PrilogStavkaUnos[]): boolean {
  return sumaPriloga(stavke) === round2(ukupno);
}

/**
 * Provjeri stavke priloga i vrati tip proizvoda po id-u (usluge ne diraju
 * zalihu). Odvojeno od upisa da se stavke mogu odbiti i prije štampe —
 * greška poslije štampe znači papir bez pokrića.
 */
export function validirajPrilogStavke(db: SqlDb, stavke: PrilogStavkaUnos[]): Map<number, string> {
  const tipovi = new Map<number, string>();
  for (const s of stavke) {
    if (!s || typeof s !== 'object') throw new Error('Neispravna stavka računa');
    provjeriIznoseStavke(s);
    if (s.pdvStopa !== 'E') {
      throw new Error('U prilog smiju samo stavke sa PDV stopom E (zbirna stavka je fiskalizovana sa E)');
    }
    const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(s.productId) as { tip: string } | undefined;
    if (!product) throw new Error(`Proizvod #${s.productId} ne postoji`);
    tipovi.set(s.productId, product.tip);
  }
  return tipovi;
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
  const order = db.prepare('SELECT prilogBroj, status, ukupno FROM orders WHERE id = ?').get(orderId) as
    { prilogBroj: number | null; status: string; ukupno: number } | undefined;
  if (!order) throw new Error('Račun ne postoji');
  if (order.prilogBroj == null) throw new Error('Ovo nije račun po prilogu');
  if (order.status !== 'completed') throw new Error('Račun je storniran — prilog se ne može mijenjati');
  // Stavke se dodjeljuju dok se ne poklope s fiskalnim iznosom; tad je faktura završena.
  const postojece = db.prepare('SELECT kolicina, cijena, rabat, pdvStopa FROM prilog_stavke WHERE orderId = ?')
    .all(orderId) as PrilogStavkaUnos[];
  if (postojece.length > 0 && prilogKompletan(order.ukupno, postojece)) {
    throw new Error('Faktura je završena — stavke se ne mogu mijenjati');
  }

  const tipovi = validirajPrilogStavke(db, stavke);

  db.prepare('DELETE FROM prilog_stavke WHERE orderId = ?').run(orderId);
  db.prepare("DELETE FROM stock_movements WHERE referenceType = 'prilog' AND referenceId = ?").run(orderId);

  const insertStavka = db.prepare(
    'INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'prilog', ?)"
  );

  for (const s of stavke) {
    insertStavka.run(orderId, s.productId, s.kolicina, s.cijena, s.rabat ?? 0, s.pdvStopa);
    if (tipovi.get(s.productId) !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
  }
}

/** Zbirna stavka kako se šalje fiskalnom uređaju (i sintetizuje u prikazima). */
export function buildPrilogFiskalnaStavka(prilogBroj: number | null, iznos: number, naziv?: string | null) {
  return {
    productId: 0,
    sifra: PRILOG_SIFRA,
    naziv: naziv || prilogNaziv(prilogBroj),
    jm: 'kom',
    plu: 0,
    cijena: round2(iznos),
    kolicina: 1,
    rabat: 0,
    pdvStopa: 'E',
  };
}

/**
 * Datum valute, napomena i ponuda se provjeravaju prije štampe — greška poslije
 * štampe znači papir bez zapisa. Vraća normalizovane vrijednosti za upis.
 */
export function provjeriDodatkeFakture(
  db: SqlDb,
  data: { datumValute?: string | null; napomena?: string | null; ponudaId?: number | null },
): { datumValute: string | null; napomena: string | null; ponudaId: number | null } {
  const datumValute = data.datumValute?.trim() || null;
  if (datumValute !== null && !validanDatumValute(datumValute)) {
    throw new Error(`Neispravan datum valute: ${datumValute}`);
  }
  const napomena = data.napomena?.trim() || null;
  if (napomena !== null && napomena.length > FAKTURA_NAPOMENA_MAX) {
    throw new Error(`Napomena može imati najviše ${FAKTURA_NAPOMENA_MAX} znakova`);
  }
  const ponudaId = data.ponudaId ?? null;
  if (ponudaId !== null) {
    const ponuda = db.prepare('SELECT status FROM ponude WHERE id = ?').get(ponudaId) as { status: string } | undefined;
    if (!ponuda) throw new Error('Ponuda ne postoji');
    if (ponuda.status === 'konvertovana') throw new Error('Ponuda je već konvertovana u račun');
    if (ponuda.status === 'odbijena') {
      throw new Error('Odbijena ponuda se ne može pretvoriti u fakturu — ako kupac ipak prihvata, prvo promijenite status');
    }
  }
  return { datumValute, napomena, ponudaId };
}

/** Ponuda po kojoj je izdana faktura — isto stanje kao nakon konverzije u račun. */
export function oznaciPonuduFakturisanom(db: SqlDb, ponudaId: number, orderId: number): void {
  db.prepare("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?").run(orderId, ponudaId);
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
  /** Stvarni BF se razišao sa onim odštampanim u nazivu stavke. */
  upozorenje?: string;
  error?: string;
  odgovori?: Record<string, string>;
}

/**
 * Fiskalizuje račun po prilogu: jedna zbirna stavka na uređaju.
 *
 * Iznos dolazi na dva načina — ručno ukucan, ili izveden iz stavki koje je
 * operater unio odmah na kasi. Kad stavke postoje, one su jedini izvor
 * istine za iznos i upisuju se u istoj transakciji kao i račun, pa nema
 * stanja u kojem je račun fiskalizovan a stavke izgubljene.
 *
 * Isti write-ahead obrazac kao order:finalize — snapshot u pending_receipts
 * prije štampe, pa atomični upis ordera + brisanje pending reda.
 */
export async function finalizePrilogAndPrint(
  deps: FinalizePrilogDeps,
  data: {
    korisnikId: number;
    /** Ručno ukucan iznos; ignoriše se kad su poslate stavke. */
    iznos?: number;
    nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    /** Stavke unesene odmah na kasi — iznos se računa iz njih. */
    stavke?: PrilogStavkaUnos[];
    /** Uvodni dio naziva zbirne stavke ("CNC obrada"); prazno = "Stavke". */
    prilogOpis?: string;
    /** Veza u nazivu ("fakturi"); prazno = "računu". */
    prilogVeza?: string;
    /** Rok plaćanja, YYYY-MM-DD; prazno = bez valute. */
    datumValute?: string | null;
    /** Slobodan tekst ispod stavki fakture. */
    napomena?: string | null;
    /** Ponuda iz koje je faktura nastala — označava se konvertovanom u istoj transakciji. */
    ponudaId?: number | null;
  }
): Promise<FinalizePrilogResult> {
  const { db, print, transaction } = deps;
  if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');

  const stavke = data.stavke ?? [];
  if (!Array.isArray(stavke)) throw new Error('Neispravna stavka računa');
  // Prije bilo kakve štampe: neispravna stavka ne smije proizvesti papir.
  if (stavke.length > 0) validirajPrilogStavke(db, stavke);
  const iznos = stavke.length > 0 ? sumaPriloga(stavke) : (data.iznos ?? 0);
  if (!(typeof iznos === 'number' && Number.isFinite(iznos) && iznos > 0)) throw new Error('Iznos mora biti veći od 0');
  const nacinPlacanja = provjeriNacinPlacanja(data.nacinPlacanja);
  const kupac = provjeriKupca(data.kupac);
  const { datumValute, napomena, ponudaId } = provjeriDodatkeFakture(db, data);

  // Naziv stavke mora nositi broj isječka na koji se kuca, a njega uređaj vrati
  // tek nakon štampe — zato predviđanje iz fiskalnog niza. Poslije štampe se
  // poredi sa stvarnim BF-om i razlika se prijavljuje operateru.
  const predvidjeniBroj = predvidjeniFiskalniBroj(db);
  if (predvidjeniBroj == null) {
    throw new Error(
      'Nije poznat posljednji fiskalni broj, pa se broj fakture ne može odštampati na isječku. ' +
      'Upišite posljednji izdati fiskalni broj prije štampe.'
    );
  }
  // Naziv se zamrzava ovdje: storno i kopija računa moraju odštampati isti
  // tekst koji je otišao na fiskalni uređaj, pa se čuva uz račun.
  const naziv = prilogNaziv(predvidjeniBroj, data.prilogOpis, data.prilogVeza);
  const stavka = buildPrilogFiskalnaStavka(predvidjeniBroj, iznos, naziv);
  const { ukupno, pdvIznos } = izracunajTotale([stavka]);

  // Write-ahead: stavke:[] + prilogBroj → pending:resolve rekonstruiše prilog
  // račun; prilogStavke nosi stvarne stavke da se ne izgube pri spašavanju.
  const snapshot = {
    korisnikId: data.korisnikId, ukupno, pdvIznos,
    nacinPlacanja, kupac,
    stavke: [], prilogBroj: predvidjeniBroj, prilogNaziv: naziv, prilogStavke: stavke,
    datumValute, napomena, ponudaId,
  };
  const pending = db
    .prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(data.korisnikId, JSON.stringify(snapshot));
  const pendingId = pending.lastInsertRowid as number;

  let result: Tring.TringResponse | null;
  try {
    result = await print(buildTringRacun({
      ukupno, nacinPlacanja, kupac, items: [stavka],
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
  // Faktura nosi isti broj kao fiskalni isječak uz koji ide. Kad uređaj vrati
  // broj različit od predviđenog, papir već nosi pogrešan broj u nazivu stavke —
  // faktura ide po stvarnom, a operater to mora saznati odmah.
  const prilogBroj = parseFiskalniBroj(brojFiskalnogRacuna) ?? predvidjeniBroj;
  const upozorenje = prilogBroj !== predvidjeniBroj
    ? `Na isječku je odštampan br. ${predvidjeniBroj}, a uređaj je vratio BF ${brojFiskalnogRacuna}. ` +
      `Faktura nosi br. ${prilogBroj} — provjerite isječak.`
    : undefined;
  let orderId = 0;
  try {
    transaction(() => {
      const r = db.prepare(`
        INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
          kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, prilogBroj, prilogNaziv,
          datumValute, napomena)
        VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        data.korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna,
        kupac?.naziv || null, kupac?.idBroj || null, kupac?.adresa || null,
        kupac?.grad || null, kupac?.postanskiBroj || null, prilogBroj, naziv,
        datumValute, napomena
      );
      orderId = Number(r.lastInsertRowid);
      if (stavke.length > 0) savePrilogStavkeInTransaction(db, orderId, stavke);
      if (ponudaId != null) oznaciPonuduFakturisanom(db, ponudaId, orderId);
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

  return { success: true, id: orderId, prilogBroj, brojFiskalnogRacuna, upozorenje, odgovori: result.odgovori };
}
