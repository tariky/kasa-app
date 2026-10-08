import { normalizeOznaka, provjeriReklamaciju, type OznakaPlacanja } from '../services/tring';
import type { SqlDb } from './sqldb';
import type { FiskalniUredjaj, IshodUredjaja } from './fiskalniUredjaj';
import { parseFiskalniBroj } from './fiskalni';
import { buildTringReklamacija, povratReklamacije } from './tringRacun';
import { PRILOG_SIFRA, prilogNaziv } from './prilog';
import { round2 } from './novac';
import { baciAkoCekaNezavrsen, vecEvidentiranStorno, type SnapshotStorna } from './pendingRacun';
import { fiskalizuj, uToku } from './fiskalizacija';
import * as zaliha from './zaliha';

/**
 * Storno vraća tačno ono što je račun skinuo: za svaki izlaz računa (prodaja
 * 'order' ili prilog 'prilog') ulaz 'refund' iste količine za isti artikal.
 * Današnji tip artikla se ne gleda — artikal je mogao postati usluga i
 * obrnuto nakon prodaje. `datum` = datum storna (bez njega: sada).
 * Rust: `vrati_zalihu_racuna` u storno.rs.
 */
function vratiZalihuRacuna(db: SqlDb, orderId: number, datum: string | null = null): void {
  const izlazi = db.prepare(
    "SELECT productId, kolicina FROM stock_movements WHERE tip = 'izlaz' AND referenceType IN ('order', 'prilog') AND referenceId = ? ORDER BY id"
  ).all(orderId) as Array<{ productId: number; kolicina: number }>;
  zaliha.knjizi(db, { vrsta: 'refund', id: orderId }, 'ulaz', izlazi, { datum: datum ?? undefined });
}

/**
 * Označi račun storniranim, vrati zalihu i upiši broj reklamacije. `datum` je
 * datum storna s papira kad se storno upisuje iz dijaloga nezavršenih računa.
 *
 * Poziva se unutar transakcije. Provjera statusa je ujedno i zaštita od
 * dvostrukog storna: drugi poziv za isti račun više ne nađe 'completed' red.
 */
export function refundOrderInTransaction(
  db: SqlDb,
  id: number,
  brojReklamacije: string | null,
  datum: string | null = null,
): void {
  const order = db.prepare("SELECT id FROM orders WHERE id = ? AND status = 'completed'")
    .get(id) as { id: number } | undefined;
  if (!order) throw new Error('Račun ne postoji ili je već storniran');

  db.prepare(
    "UPDATE orders SET status = 'refunded', refundedAt = COALESCE(?, datetime('now','localtime')), " +
    'brojReklamacije = COALESCE(?, brojReklamacije) WHERE id = ?'
  ).run(datum, brojReklamacije, id);

  vratiZalihuRacuna(db, id, datum);
}

export interface RefundDeps {
  db: SqlDb;
  /** Fiskalni uređaj (lib/fiskalniUredjaj.ts) — štampa storno. */
  uredjaj: Pick<FiskalniUredjaj, 'stampajReklamaciju'>;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: <T>(fn: () => T) => () => T;
  /** Očekivana gotovina u ladici; bez nje se manjak ne može izračunati. */
  drawerState?: () => { ocekivanoStanje: number };
  /** Evidentira polog (Tring UnosNovca + zapis u cash_movements). */
  depositCash?: (iznos: number, napomena: string) => Promise<void>;
  /**
   * Samo Tring UnosNovca na vrstu plaćanja, bez zapisa u cash_movements.
   * Pokriva bezgotovinski dio razbijenog računa koji se vraća gotovinom i
   * stanje vrste povrata koje uređaj ne vidi (npr. virman poslije Z
   * izvještaja). Storno ga odmah potroši, a iz ladice ništa ne izlazi — zapis
   * u evidenciji bi lažno napuhao očekivano stanje. Ide automatski, bez pitanja.
   */
  deviceCashIn?: (iznos: number, vrsta: OznakaPlacanja) => Promise<void>;
}

export interface RefundResult {
  success: boolean;
  brojReklamacije?: string | null;
  error?: string;
  odgovori?: Record<string, string>;
  /**
   * Štampa je pala, a u ladici nema evidentirane gotovine za povrat —
   * renderer nudi override ("ipak reklamiraj uz automatski polog").
   */
  nedovoljnoSredstava?: boolean;
  /** Koliko gotovine fali do iznosa povrata (za prijedlog pologa). */
  manjak?: number;
  /** Iznos automatski evidentiranog pologa kad je override iskorišten. */
  pologIznos?: number;
  /** Uređaj nije potvrdio storno — red ostaje za dijalog nezavršenih računa. */
  ishodNepoznat?: true;
  /** Storno je odštampan, ali već upisan iz dijaloga nezavršenih računa. */
  vecEvidentiran?: true;
  brojFiskalnogRacuna?: string | null;
}

/**
 * Tring ne vraća šifru greške za praznu ladicu, samo tekst, pa se prepoznaje
 * po ključnim riječima. Ako se tekst promijeni, override se i dalje nudi jer
 * ga pali i lokalno stanje ladice.
 */
const NEDOVOLJNO_RE = /nedovoljno|nema dovoljno|insufficient|nedostaje|manjak|prazna kasa/i;

function jeNedovoljnoSredstava(r: IshodUredjaja): boolean {
  return !r.ok && NEDOVOLJNO_RE.test([r.greska, ...Object.values(r.odgovori ?? {})].join(' '));
}

/**
 * Odštampa reklamaciju i tek nakon uspješne štampe upiše storno u bazu, u
 * jednoj transakciji. Ranije su štampa, promjena statusa i upis broja bila tri
 * odvojena IPC poziva iz renderera, pa je pad ili dvoklik između njih ostavljao
 * odštampan fiskalni storno bez ikakvog traga u bazi.
 *
 * Write-ahead kao order:finalize (lib/fiskalizacija.ts): snapshot `vrsta:
 * 'storno'` prije unosa novca i štampe; nepoznat ishod ostavlja red (račun
 * ostaje 'completed' dok ga dijalog nezavršenih ne riješi).
 */
export async function refundAndPrint(
  deps: RefundDeps,
  data: {
    id: number; brojReklamacije?: string; dozvoliPolog?: boolean;
    /** Ko stornira (zapis nezavršenog storna); bez njega autor računa. */
    korisnikId?: number;
    /** Admin koji je odobrio storno kasira PIN-om — za trag 'storno' iz dijaloga. */
    odobrioAdminId?: number | null;
  }
): Promise<RefundResult> {
  const { db, uredjaj } = deps;
  const id = data.id;

  return uToku(`storno:${id}`, 'Storniranje ovog računa je već u toku', async () => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'completed'").get(id);
    if (!order) throw new Error('Račun ne postoji ili je već storniran');
    baciAkoCekaNezavrsen(db, 'orderId', order.id, 'Storno ovog računa');

    const brojRacuna = parseFiskalniBroj(order.brojFiskalnogRacuna);
    if (brojRacuna === null) {
      throw new Error(
        `Fiskalni broj "${order.brojFiskalnogRacuna ?? ''}" nije ispravan broj računa — reklamacija se ne može odštampati`
      );
    }

    // Reklamacija mora imati istu stavku kao original — prilog račun je
    // fiskalizovan jednom zbirnom stavkom, pa se ona ovdje sintetizuje.
    const stavke = order.prilogBroj != null
      ? [{
          sifra: PRILOG_SIFRA, naziv: order.prilogNaziv || prilogNaziv(order.prilogBroj), jm: 'kom', plu: 0,
          cijena: order.ukupno, kolicina: 1, rabat: 0, pdvStopa: 'E',
        }]
      : db.prepare(`
          SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
          FROM order_items oi
          LEFT JOIN products p ON p.id = oi.productId
          WHERE oi.orderId = ?
        `).all(id);

    const povrat = povratReklamacije(order.nacinPlacanja, order.ukupno);
    const racun = buildTringReklamacija({
      stavke,
      placanje: povrat.placanje,
      brojRacuna,
      kupac: order.kupacIdBroj ? {
        idBroj: order.kupacIdBroj,
        naziv: order.kupacNaziv || '',
        adresa: order.kupacAdresa || '',
        postanskiBroj: order.kupacPostanskiBroj || '',
        grad: order.kupacGrad || '',
      } : undefined,
    });
    // Reklamacija koju uređaj ne bi primio (npr. PLU artikla van opsega) se
    // odbija prije ikakvog unosa novca — inače bi pokriće ostalo u brojaču
    // uređaja i u pologu bez storna.
    const nevaljana = provjeriReklamaciju(racun);
    if (nevaljana) throw new Error(nevaljana);

    // Uređaj vraća cijeli iznos računa vrstom povrata (povratReklamacije) i
    // traži da njeno stanje u kasi bude barem toliko — inače TFS 535
    // (Nedovoljno novca u kasi). Iz ladice fizički izlazi samo gotovinski dio.
    const vrsta = normalizeOznaka(povrat.placanje.oznaka);
    const gotovinski = vrsta === 'Gotovina';
    const potrebnoUredjaj = round2(order.ukupno);
    const potrebnoLadica = gotovinski ? round2(potrebnoUredjaj - povrat.pokrice) : 0;
    let manjakLadica = 0;
    if (deps.drawerState && potrebnoLadica > 0) {
      try {
        manjakLadica = Math.max(0, round2(potrebnoLadica - deps.drawerState().ocekivanoStanje));
      } catch { /* stanje ladice je informativno — ne smije oboriti storno */ }
    }

    // Gotovinski manjak je stvaran novac iz ladice — samo se on gura kroz
    // override i samo se on evidentira kao polog (poznat prije štampe → snapshot).
    const planiraniPolog = data.dozvoliPolog && manjakLadica > 0 && deps.depositCash ? manjakLadica : 0;

    const snapshot: SnapshotStorna = {
      vrsta: 'storno', orderId: order.id, brojRacuna: order.brojFiskalnogRacuna ?? null,
      korisnikId: data.korisnikId ?? order.korisnikId, ukupno: order.ukupno,
      odobrioAdminId: data.odobrioAdminId ?? null, pologIznos: planiraniPolog,
      stavke: stavke.map((s: any) => ({
        naziv: s.naziv ?? s.productNaziv ?? '', kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat ?? 0,
      })),
    };

    // Broj reklamacije: ručno unesen, inače onaj sa uređaja.
    const brojReklamacije = (bf: string | null) => data.brojReklamacije?.trim() || bf;
    let zadnjiIshod: IshodUredjaja | null = null;
    let uneseno = 0;
    let pologIznos = 0;

    // Unos novca ili štampa koji bace izuzetak — storno nije odštampan (fiskalizuj briše red).
    const stampaj = async (): Promise<IshodUredjaja> => {
      // Bezgotovinski dio razbijenog računa ide u gotovinu uređaja automatski —
      // nema odluke za operatera jer nikakav stvaran novac ne mijenja vlasnika.
      if (povrat.pokrice > 0 && deps.deviceCashIn) {
        await deps.deviceCashIn(povrat.pokrice, 'Gotovina');
        uneseno = povrat.pokrice;
      }

      if (planiraniPolog > 0 && deps.depositCash) {
        await deps.depositCash(planiraniPolog, `Automatski polog za reklamaciju računa #${id}`);
        pologIznos = planiraniPolog;
        uneseno = round2(uneseno + planiraniPolog);
      }

      let ishod = await uredjaj.stampajReklamaciju(racun);

      // Stanje ladice je samo procjena brojača u uređaju (pologi se mogu voditi
      // i mimo aplikacije), a stanje virmana/kartice uređaj može nulirati Z
      // izvještajem — pa ako uređaj i dalje javlja manjak, dopuni vrstu povrata
      // do punog iznosa računa i pokušaj još jednom. Storno taj iznos odmah
      // potroši, tako da brojač uređaja ne ostane napuhan. Bez pitanja kad
      // gotovinski manjak ne postoji; inače tek uz override. Nikad nakon
      // nepoznatog ishoda — storno je možda već odštampan.
      if ((manjakLadica === 0 || data.dozvoliPolog) && !ishod.ok && !ishod.nepoznat && jeNedovoljnoSredstava(ishod)) {
        const dopuna = round2(potrebnoUredjaj - uneseno);
        if (dopuna > 0 && deps.deviceCashIn) {
          await deps.deviceCashIn(dopuna, vrsta);
          uneseno = round2(uneseno + dopuna);
          ishod = await uredjaj.stampajReklamaciju(racun);
        }
      }
      zadnjiIshod = ishod;
      return ishod;
    };

    const r = await fiskalizuj(deps, {
      snapshot,
      stampaj,
      upisi: bf => refundOrderInTransaction(db, id, brojReklamacije(bf)),
      dokument: bf => `Reklamacija #${brojReklamacije(bf) ?? '?'}`,
      rod: 'ž',
      vecEvidentiran: bf => vecEvidentiranStorno(brojReklamacije(bf)),
    });

    if (!r.success) {
      // Siguran neuspjeh je već obrisao red; nepoznat ishod ga ostavlja (bez
      // ponude pologa — storno se ne smije slati ponovo dok se ne riješi).
      if ('vecEvidentiran' in r || r.ishodNepoznat) return r;
      const neuspjeh = zadnjiIshod as IshodUredjaja | null;
      return {
        ...r,
        // Override (polog gotovine) se nudi samo ako može pomoći: kad fali
        // stvarna gotovina, ili kad uređaj i dalje traži gotovinu a nismo je
        // dopunili do punog iznosa. Bezgotovinskom povratu polog ne pomaže.
        nedovoljnoSredstava:
          !data.dozvoliPolog && gotovinski &&
          (manjakLadica > 0 || (!!neuspjeh && jeNedovoljnoSredstava(neuspjeh) && uneseno < potrebnoUredjaj)),
        manjak: manjakLadica > 0 ? manjakLadica : round2(potrebnoUredjaj - uneseno),
      };
    }

    return { success: true, brojReklamacije: brojReklamacije(r.brojFiskalnogRacuna), odgovori: r.odgovori, pologIznos };
  });
}
