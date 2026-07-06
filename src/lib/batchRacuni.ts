import { izracunajTotale } from './racun';
import type { Product } from '@/types';

export interface GeneratedStavka {
  productId: number;
  sifra: string;
  naziv: string;
  jm: string;
  plu?: number;
  cijena: number;
  kolicina: number;
  rabat: number;
  pdvStopa: 'E' | 'K';
}

export interface GeneratedRacun {
  id: string;
  stavke: GeneratedStavka[];
  ukupno: number;
  pdvIznos: number;
}

export interface GenerateOptions {
  /** Ciljni ukupni iznos svih računa (BAM). */
  target: number;
  /** Maksimalno stavki po računu. Default 4. */
  maxStavki?: number;
  /** Maksimalna količina po stavci. Default 3. */
  maxKolicina?: number;
  /** Sigurnosni limit na broj računa. Default 1000. */
  maxRacuna?: number;
  /** Injektabilni generator slučajnih brojeva (za testove). Default Math.random. */
  rng?: () => number;
}

export interface GenerateResult {
  racuni: GeneratedRacun[];
  /** Zbir svih generisanih računa. */
  ukupnoGenerisano: number;
  target: number;
  /** Koliko je nedostajalo do cilja (0 ako je cilj dostignut). */
  manjak: number;
}

/** Zaokruži na 2 decimale (fene) da izbjegnemo akumulaciju float greške. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generiše nasumične, realistične fiskalne račune do zadatog ciljnog iznosa.
 *
 * Pravila (usaglašena sa dizajnom):
 *  - Tvrdi limit na zalihe: nikad ne prodaje više od raspoloživog `stanje`.
 *  - Stani-ispod: zbir nikad ne prelazi `target`; staje kad ni najjeftiniji
 *    artikal ne stane u preostali budžet, kad nestane zaliha, ili na maxRacuna.
 *  - Mali računi: 1–maxStavki stavki, cjelobrojna količina 1–maxKolicina.
 *  - Usluge se preskaču (nemaju zalihe); rabat je uvijek 0.
 */
export function generirajRacune(products: Product[], opts: GenerateOptions): GenerateResult {
  const target = opts.target;
  const maxStavki = opts.maxStavki ?? 4;
  const maxKolicina = opts.maxKolicina ?? 3;
  const maxRacuna = opts.maxRacuna ?? 1000;
  const rng = opts.rng ?? Math.random;

  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  // Prihvatljivi artikli: roba sa pozitivnom zalihom i cijenom.
  const eligible = products.filter(
    p => p.tip !== 'usluga' && (p.stanje ?? 0) >= 1 && p.cijena > 0
  );

  // Ledger rezervacija: preostala (cjelobrojna) zaliha po artiklu.
  const stock = new Map<number, number>(
    eligible.map(p => [p.id, Math.floor(p.stanje ?? 0)])
  );

  const racuni: GeneratedRacun[] = [];
  let running = 0;
  let uid = 0;

  while (running < target && racuni.length < maxRacuna) {
    const remaining = round2(target - running);

    // Ako ni najjeftiniji artikal sa zalihom ne stane, gotovi smo.
    const affordable = eligible.filter(
      p => (stock.get(p.id) ?? 0) > 0 && p.cijena <= remaining
    );
    if (affordable.length === 0) break;

    const lineCount = 1 + Math.floor(rng() * maxStavki); // 1..maxStavki
    const stavke: GeneratedStavka[] = [];
    const usedIds = new Set<number>();
    let receiptTotal = 0;

    for (let i = 0; i < lineCount; i++) {
      const budgetLeft = round2(remaining - receiptTotal);
      const candidates = eligible.filter(
        p =>
          !usedIds.has(p.id) &&
          (stock.get(p.id) ?? 0) > 0 &&
          p.cijena <= budgetLeft
      );
      if (candidates.length === 0) break;

      const p = pick(candidates);
      const qtyCap = Math.min(
        maxKolicina,
        Math.floor(budgetLeft / p.cijena),
        stock.get(p.id) ?? 0
      );
      if (qtyCap < 1) break;
      const kolicina = 1 + Math.floor(rng() * qtyCap); // 1..qtyCap

      stavke.push({
        productId: p.id,
        sifra: p.sifra,
        naziv: p.naziv,
        jm: p.jm,
        plu: p.plu,
        cijena: p.cijena,
        kolicina,
        rabat: 0,
        pdvStopa: p.pdvStopa,
      });
      usedIds.add(p.id);
      stock.set(p.id, (stock.get(p.id) ?? 0) - kolicina);
      receiptTotal = round2(receiptTotal + p.cijena * kolicina);
    }

    if (stavke.length === 0) break;

    const { ukupno, pdvIznos } = izracunajTotale(stavke);
    racuni.push({
      id: String(++uid),
      stavke,
      ukupno: round2(ukupno),
      pdvIznos: round2(pdvIznos),
    });
    running = round2(running + ukupno);
  }

  return {
    racuni,
    ukupnoGenerisano: running,
    target,
    manjak: round2(Math.max(0, target - running)),
  };
}
