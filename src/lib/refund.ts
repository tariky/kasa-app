import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { parseFiskalniBroj } from './fiskalni';
import { buildTringReklamacija } from './tringRacun';
import { PRILOG_SIFRA, prilogNaziv } from './prilog';
import { gotovinskiIznos } from './drawer';
import { round2 } from './novac';

/**
 * Označi račun storniranim, vrati zalihu i upiši broj reklamacije.
 *
 * Poziva se unutar transakcije. Provjera statusa je ujedno i zaštita od
 * dvostrukog storna: drugi poziv za isti račun više ne nađe 'completed' red.
 * Usluge nemaju zalihu pa se za njih ne kreira kretanje.
 */
export function refundOrderInTransaction(
  db: SqlDb,
  id: number,
  brojReklamacije: string | null
): void {
  const order = db.prepare("SELECT id, prilogBroj FROM orders WHERE id = ? AND status = 'completed'")
    .get(id) as { id: number; prilogBroj: number | null } | undefined;
  if (!order) throw new Error('Račun ne postoji ili je već storniran');

  db.prepare(
    "UPDATE orders SET status = 'refunded', refundedAt = datetime('now','localtime'), " +
    'brojReklamacije = COALESCE(?, brojReklamacije) WHERE id = ?'
  ).run(brojReklamacije, id);

  // Prilog račun nema order_items — zaliha se vraća po stavkama priloga.
  const items = (order.prilogBroj != null
    ? db.prepare('SELECT productId, kolicina FROM prilog_stavke WHERE orderId = ?')
    : db.prepare('SELECT productId, kolicina FROM order_items WHERE orderId = ?')
  ).all(id) as Array<{ productId: number; kolicina: number }>;

  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'refund', ?)"
  );

  for (const item of items) {
    const product = db.prepare('SELECT tip FROM products WHERE id = ?')
      .get(item.productId) as { tip: string } | undefined;
    if (!product || product.tip !== 'usluga') {
      insertStock.run(item.productId, item.kolicina, id);
    }
  }
}

export interface RefundDeps {
  db: SqlDb;
  /** Štampa storno na fiskalnom uređaju. */
  print: (racun: Tring.ReklamiraniRacun) => Promise<Tring.TringResponse | null>;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: (fn: () => void) => () => void;
  /** Očekivana gotovina u ladici; bez nje se manjak ne može izračunati. */
  drawerState?: () => { ocekivanoStanje: number };
  /** Evidentira polog (Tring UnosNovca + zapis u cash_movements). */
  depositCash?: (iznos: number, napomena: string) => Promise<void>;
  /**
   * Samo Tring UnosNovca, bez zapisa u cash_movements. Koristi se za dio
   * pokrića koji fizički ne ulazi u ladicu (storno virmanskog/kartičnog
   * računa): uređaj ga traži, a storno ga odmah potroši, pa bi zapis u
   * evidenciji ladice lažno napuhao očekivano stanje.
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
}

/**
 * Tring ne vraća šifru greške za praznu ladicu, samo tekst, pa se prepoznaje
 * po ključnim riječima. Ako se tekst promijeni, override se i dalje nudi jer
 * ga pali i lokalno stanje ladice.
 */
const NEDOVOLJNO_RE = /nedovoljno|nema dovoljno|insufficient|nedostaje|manjak|prazna kasa/i;

function jeNedovoljnoSredstava(r: Tring.TringResponse): boolean {
  return NEDOVOLJNO_RE.test(
    [r.error ?? '', r.vrstaOdgovora ?? '', ...Object.values(r.odgovori ?? {})].join(' ')
  );
}

/** Računi kojima se storno trenutno štampa — zaštita od dvoklika. */
const refundsInFlight = new Set<number>();

/**
 * Odštampa reklamaciju i tek nakon uspješne štampe upiše storno u bazu, u
 * jednoj transakciji. Ranije su štampa, promjena statusa i upis broja bila tri
 * odvojena IPC poziva iz renderera, pa je pad ili dvoklik između njih ostavljao
 * odštampan fiskalni storno bez ikakvog traga u bazi.
 */
export async function refundAndPrint(
  deps: RefundDeps,
  data: { id: number; brojReklamacije?: string; dozvoliPolog?: boolean }
): Promise<RefundResult> {
  const { db, print, transaction } = deps;
  const id = data.id;

  if (refundsInFlight.has(id)) throw new Error('Storniranje ovog računa je već u toku');

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'completed'").get(id);
  if (!order) throw new Error('Račun ne postoji ili je već storniran');

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

  refundsInFlight.add(id);
  try {
    // Override: operater je upozoren i svjesno gura storno preko stanja kase.
    // Manjak se prvo unese u uređaj; gotovinski dio ide i u evidenciju ladice
    // (stvaran novac), ostatak samo u uređaj (potroši ga isti storno).
    let pologIznos = 0;
    let uneseno = 0;
    if (data.dozvoliPolog) {
      if (manjakLadica > 0 && deps.depositCash) {
        await deps.depositCash(manjakLadica, `Automatski polog za reklamaciju računa #${id}`);
        pologIznos = manjakLadica;
        uneseno = manjakLadica;
      }
      const samoUredjaj = round2(manjakUredjaj - uneseno);
      if (samoUredjaj > 0 && deps.deviceCashIn) {
        await deps.deviceCashIn(samoUredjaj);
        uneseno = round2(uneseno + samoUredjaj);
      }
    }

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

    let result = await print(racun);

    // Stanje ladice je samo procjena brojača u uređaju (pologi se mogu voditi
    // i mimo aplikacije), pa ako uređaj i dalje javlja manjak — dopuni do
    // punog iznosa računa i pokušaj još jednom. Storno taj iznos odmah
    // potroši, tako da brojač uređaja ne ostane napuhan.
    if (data.dozvoliPolog && result && !result.success && jeNedovoljnoSredstava(result)) {
      const dopuna = round2(potrebnoUredjaj - uneseno);
      if (dopuna > 0 && deps.deviceCashIn) {
        await deps.deviceCashIn(dopuna);
        uneseno = round2(uneseno + dopuna);
        result = await print(racun);
      }
    }

    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
        odgovori: result?.odgovori ?? {},
        nedovoljnoSredstava:
          !data.dozvoliPolog && (manjakUredjaj > 0 || (!!result && jeNedovoljnoSredstava(result))),
        manjak: manjakUredjaj > 0 ? manjakUredjaj : potrebnoUredjaj,
      };
    }

    const brojReklamacije =
      data.brojReklamacije?.trim() || result.odgovori?.BrojFiskalnogRacuna || null;

    try {
      transaction(() => refundOrderInTransaction(db, id, brojReklamacije))();
    } catch (err: any) {
      // Storno je već na papiru i u fiskalnom uređaju — operater to mora znati.
      throw new Error(
        `Reklamacija #${brojReklamacije ?? '?'} JE odštampana, ali nije zabilježena u bazi: ` +
        `${err?.message || 'nepoznata greška'}. Evidentirajte račun ručno.`
      );
    }

    return { success: true, brojReklamacije, odgovori: result.odgovori, pologIznos };
  } finally {
    refundsInFlight.delete(id);
  }
}
