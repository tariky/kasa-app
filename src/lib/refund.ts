import { provjeriReklamaciju } from '../services/tring';
import type { SqlDb } from './sqldb';
import type { FiskalniUredjaj, IshodUredjaja } from './fiskalniUredjaj';
import { parseFiskalniBroj } from './fiskalni';
import { buildTringReklamacija } from './tringRacun';
import { PRILOG_SIFRA, prilogNaziv } from './prilog';
import { gotovinskiIznos } from './drawer';
import { round2 } from './novac';
import { baciAkoCekaNezavrsen, vecEvidentiranStorno, type SnapshotStorna } from './pendingRacun';
import { fiskalizuj, uToku } from './fiskalizacija';

/**
 * Storno vraća tačno ono što je račun skinuo: za svaki izlaz računa (prodaja
 * 'order' ili prilog 'prilog') ulaz 'refund' iste količine za isti artikal.
 * Današnji tip artikla se ne gleda — artikal je mogao postati usluga i
 * obrnuto nakon prodaje. `datum` = datum storna (bez njega: sada).
 * Rust: `vrati_zalihu_racuna` u racuni.rs.
 */
export function vratiZalihuRacuna(db: SqlDb, orderId: number, datum: string | null = null): void {
  const izlazi = db.prepare(
    "SELECT productId, kolicina FROM stock_movements WHERE tip = 'izlaz' AND referenceType IN ('order', 'prilog') AND referenceId = ? ORDER BY id"
  ).all(orderId) as Array<{ productId: number; kolicina: number }>;
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'ulaz', ?, 'refund', ?, COALESCE(?, datetime('now','localtime')))"
  );
  for (const izlaz of izlazi) insertStock.run(izlaz.productId, izlaz.kolicina, orderId, datum);
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
   * Samo Tring UnosNovca, bez zapisa u cash_movements. Pokriva nenovčani dio
   * računa (virman, kartica): uređaj ga traži jer storno isplaćuje gotovinom,
   * ali iz ladice ništa ne izlazi i storno ga odmah potroši — zapis u
   * evidenciji bi lažno napuhao očekivano stanje. Ide automatski, bez pitanja.
   */
  deviceCashIn?: (iznos: number) => Promise<void>;
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

    const racun = buildTringReklamacija({
      stavke,
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

    // Tring povrat po reklamiranom računu ide isključivo gotovinom, bez obzira
    // kako je original plaćen — uređaj traži pokriće u punom iznosu računa i
    // inače vrati ERROR_FISCAL_INSUFFICIENT_MONEY. Iz ladice, međutim, fizički
    // izlazi samo gotovinski dio originala.
    const potrebnoUredjaj = round2(order.ukupno);
    const potrebnoLadica = gotovinskiIznos(order.nacinPlacanja, order.ukupno);
    let stanjeLadice = 0;
    let manjakUredjaj = 0;
    let manjakLadica = 0;
    if (deps.drawerState) {
      try {
        stanjeLadice = deps.drawerState().ocekivanoStanje;
        manjakUredjaj = Math.max(0, round2(potrebnoUredjaj - stanjeLadice));
        manjakLadica = Math.max(0, round2(Math.min(potrebnoLadica, potrebnoUredjaj) - stanjeLadice));
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
      // Nenovčani dio pokrića ide automatski — nema odluke za operatera jer
      // nikakav stvaran novac ne mijenja vlasnika (virmanski račun se ovdje
      // pokriva u cijelosti, pa storno prolazi bez ijednog dodatnog klika).
      const samoUredjaj = Math.max(0, round2(manjakUredjaj - manjakLadica));
      if (samoUredjaj > 0 && deps.deviceCashIn) {
        await deps.deviceCashIn(samoUredjaj);
        uneseno = samoUredjaj;
      }

      if (planiraniPolog > 0 && deps.depositCash) {
        await deps.depositCash(planiraniPolog, `Automatski polog za reklamaciju računa #${id}`);
        pologIznos = planiraniPolog;
        uneseno = round2(uneseno + planiraniPolog);
      }

      let ishod = await uredjaj.stampajReklamaciju(racun);

      // Stanje ladice je samo procjena brojača u uređaju (pologi se mogu voditi
      // i mimo aplikacije), pa ako uređaj i dalje javlja manjak — dopuni do
      // punog iznosa računa i pokušaj još jednom. Storno taj iznos odmah
      // potroši, tako da brojač uređaja ne ostane napuhan. Bez pitanja kad
      // gotovinski manjak ne postoji; inače tek uz override. Nikad nakon
      // nepoznatog ishoda — storno je možda već odštampan.
      if ((manjakLadica === 0 || data.dozvoliPolog) && !ishod.ok && !ishod.nepoznat && jeNedovoljnoSredstava(ishod)) {
        const dopuna = round2(potrebnoUredjaj - uneseno);
        if (dopuna > 0 && deps.deviceCashIn) {
          await deps.deviceCashIn(dopuna);
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
        // Override se nudi samo ako može pomoći: kad fali stvarna gotovina, ili
        // kad uređaj i dalje traži novac a nismo ga dopunili do punog iznosa.
        nedovoljnoSredstava:
          !data.dozvoliPolog &&
          (manjakLadica > 0 || (!!neuspjeh && jeNedovoljnoSredstava(neuspjeh) && uneseno < potrebnoUredjaj)),
        manjak: manjakLadica > 0 ? manjakLadica : round2(potrebnoUredjaj - uneseno),
      };
    }

    return { success: true, brojReklamacije: brojReklamacije(r.brojFiskalnogRacuna), odgovori: r.odgovori, pologIznos };
  });
}
