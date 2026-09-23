/**
 * Preračuni za pločasti materijal (iverica, MDF, lesonit). Ploča se kupuje
 * po komadu, a troši u m²; da unos ostane jednostavan, app radi preračun.
 */

export const JM_PLOCA = 'm²';

export interface Element {
  sirina: number; // mm
  visina: number; // mm
  kom: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ploča = materijal u m² sa upisanom dimenzijom. Bez dimenzije je običan m² materijal. */
export function jePloca(p: { jm: string; plocaSirina?: number | null; plocaVisina?: number | null }): boolean {
  return p.jm === JM_PLOCA && !!p.plocaSirina && !!p.plocaVisina && p.plocaSirina > 0 && p.plocaVisina > 0;
}

export function m2PoPloci(sirinaMm: number, visinaMm: number): number {
  return round4((sirinaMm * visinaMm) / 1_000_000);
}

export function komUM2(kom: number, sirinaMm: number, visinaMm: number): number {
  return round4(kom * m2PoPloci(sirinaMm, visinaMm));
}

export function m2UKom(m2: number, sirinaMm: number, visinaMm: number): number {
  const poPloci = m2PoPloci(sirinaMm, visinaMm);
  if (poPloci <= 0) return 0;
  return round2(m2 / poPloci);
}

export function elementiUM2(elementi: Element[]): number {
  return round4(
    elementi.reduce((sum, e) => {
      if (!(e.sirina > 0) || !(e.visina > 0) || !(e.kom > 0)) return sum;
      return sum + (e.sirina * e.visina * e.kom) / 1_000_000;
    }, 0)
  );
}

export function elementiUNapomenu(elementi: Element[]): string {
  return elementi
    .filter(e => e.sirina > 0 && e.visina > 0 && e.kom > 0)
    .map(e => `${e.sirina}×${e.visina} ×${e.kom}`)
    .join(', ');
}

/** Inverz od elementiUNapomenu. Ako tekst nije u tom obliku, vraća []. */
export function napomenaUElemente(napomena: string): Element[] {
  if (!napomena.trim()) return [];
  const dijelovi = napomena.split(',').map(s => s.trim()).filter(Boolean);
  const out: Element[] = [];
  for (const d of dijelovi) {
    const m = d.match(/^(\d+)\s*[×x]\s*(\d+)\s*×\s*(\d+)$/i);
    if (!m) return [];
    out.push({ sirina: Number(m[1]), visina: Number(m[2]), kom: Number(m[3]) });
  }
  return out;
}

type PlocaLike = { jm: string; plocaSirina?: number | null; plocaVisina?: number | null };

/** Ploča se u primci kuca u komadima; baza vodi m² i nabavnu po m². */
export function uBazuPrimke(
  p: PlocaLike | undefined, kolicinaUnos: number, nabavnaUnos: number
): { kolicina: number; nabavnaCijena: number } {
  if (!p || !jePloca(p)) return { kolicina: kolicinaUnos, nabavnaCijena: nabavnaUnos };
  const poPloci = m2PoPloci(p.plocaSirina!, p.plocaVisina!);
  return {
    kolicina: komUM2(kolicinaUnos, p.plocaSirina!, p.plocaVisina!),
    nabavnaCijena: round4(nabavnaUnos / poPloci),
  };
}

/** Inverz od uBazuPrimke — za prikaz postojeće primke u formi (komadi, nabavna po komadu). */
export function izBazePrimke(
  p: PlocaLike | undefined, kolicina: number, nabavnaCijena: number
): { kolicina: string; nabavnaCijena: string } {
  if (!p || !jePloca(p)) return { kolicina: String(kolicina), nabavnaCijena: String(nabavnaCijena) };
  const poPloci = m2PoPloci(p.plocaSirina!, p.plocaVisina!);
  return {
    kolicina: String(m2UKom(kolicina, p.plocaSirina!, p.plocaVisina!)),
    nabavnaCijena: String(round2(nabavnaCijena * poPloci)),
  };
}
