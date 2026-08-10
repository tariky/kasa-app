import type * as Tring from '@/services/tring';
import type { SqlDb } from './sqldb';
import { parseFiskalniBroj } from './fiskalni';
import { buildTringReklamacija } from './tringRacun';

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
  const order = db.prepare("SELECT id FROM orders WHERE id = ? AND status = 'completed'").get(id);
  if (!order) throw new Error('Račun ne postoji ili je već storniran');

  db.prepare("UPDATE orders SET status = 'refunded', brojReklamacije = COALESCE(?, brojReklamacije) WHERE id = ?")
    .run(brojReklamacije, id);

  const items = db.prepare('SELECT productId, kolicina FROM order_items WHERE orderId = ?')
    .all(id) as Array<{ productId: number; kolicina: number }>;

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
}

export interface RefundResult {
  success: boolean;
  brojReklamacije?: string | null;
  error?: string;
  odgovori?: Record<string, string>;
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
  data: { id: number; brojReklamacije?: string }
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

  const stavke = db.prepare(`
    SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.productId
    WHERE oi.orderId = ?
  `).all(id);

  refundsInFlight.add(id);
  try {
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

    const result = await print(racun);

    if (!result || !result.success) {
      return {
        success: false,
        error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
        odgovori: result?.odgovori ?? {},
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

    return { success: true, brojReklamacije, odgovori: result.odgovori };
  } finally {
    refundsInFlight.delete(id);
  }
}
