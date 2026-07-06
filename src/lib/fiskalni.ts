/** Parse a fiscal receipt number; returns null for refunds (R-...), empty, or non-numeric. */
export function parseFiskalniBroj(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Return integers missing strictly between the min and max of the given fiscal numbers. */
export function izracunajPraznine(brojevi: number[]): number[] {
  const present = new Set(brojevi);
  const sorted = [...present].sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const gaps: number[] = [];
  for (let n = sorted[0] + 1; n < sorted[sorted.length - 1]; n++) {
    if (!present.has(n)) gaps.push(n);
  }
  return gaps;
}
