/** Parse a fiscal receipt number; returns null for refunds (R-...), empty, or non-numeric. */
export function parseFiskalniBroj(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Najviše koliko praznina vraćamo odjednom. */
export const MAX_PRAZNINA = 200;

/**
 * Vrati brojeve koji nedostaju strogo između najmanjeg i najvećeg fiskalnog broja.
 *
 * Rezultat je ograničen na `maxGaps` — jedan pogrešno ukucan broj (npr. 1234567
 * umjesto 1234) inače generiše milione "praznina" i zamrzne ekran koji ih crta.
 */
export function izracunajPraznine(
  brojevi: number[],
  maxGaps: number = MAX_PRAZNINA,
  ignorisani: Set<number> = new Set()
): number[] {
  const present = new Set(brojevi);
  const sorted = [...present].sort((a, b) => a - b);
  if (sorted.length < 2 || maxGaps <= 0) return [];
  const gaps: number[] = [];
  const max = sorted[sorted.length - 1];
  for (let n = sorted[0] + 1; n < max; n++) {
    if (present.has(n) || ignorisani.has(n)) continue;
    gaps.push(n);
    if (gaps.length >= maxGaps) break;
  }
  return gaps;
}
