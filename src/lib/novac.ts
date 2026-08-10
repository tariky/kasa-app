/**
 * Novčane i datumske pomoćne funkcije koje dijele main i renderer proces.
 * Bez zavisnosti na Electron ili DOM, da se mogu importovati sa obje strane.
 */

/** Zaokruži na 2 decimale (fene) da izbjegnemo akumulaciju float greške. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Prijedlozi iznosa koje mušterija realno može dati za račun `ukupno`:
 * tačan iznos, pa zaokruženja naviše na sljedeću novčanicu/prirodan iznos
 * (1, 5, 10, 20, 50, 100 KM), bez duplikata.
 */
export function prijedloziApoena(ukupno: number, max = 5): number[] {
  if (ukupno <= 0) return [];
  const iznos = round2(ukupno);
  const out = [iznos];
  for (const apoen of [1, 5, 10, 20, 50, 100]) {
    const v = Math.ceil(iznos / apoen) * apoen;
    if (v > iznos && !out.includes(v)) out.push(v);
  }
  return out.slice(0, max);
}

/**
 * Datum u obliku YYYY-MM-DD po *lokalnoj* vremenskoj zoni.
 * `toISOString()` se ne smije koristiti za "danas" — u UTC+1/+2 poslije
 * ponoći vraća jučerašnji datum, a baza piše `datetime('now','localtime')`.
 */
export function localDateStr(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
