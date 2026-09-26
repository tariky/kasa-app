/**
 * Mjere vrha A4 dokumenta u pt. Dijele ih PDF dokumenti i živi prikaz zaglavlja u
 * postavkama (`ZaglavljePrikaz`, 1pt = 1px) — prikaz ne smije lagati o razmacima.
 */
export const MJERE_ZAGLAVLJA = {
  /** Margina stranice (lijevo, desno, gore). */
  margina: 50,
  /** Razmak između loga i naziva firme. */
  razmakLoga: 10,
  /** Od vrha (logo, firma, naslov) do debele linije. */
  razmakIspodZaglavlja: 30,
  debljinaLinije: 2,
  /** Od debele linije do bloka Izdavač / Kupac. */
  razmakIspodLinije: 20,
  nazivFirme: 14,
  redFirme: 8,
  naslov: 22,
  broj: 10,
} as const;

// ── Datumi na dokumentima ────────────────────────────────

const dvije = (n: number) => String(n).padStart(2, '0');

/** 26.09.2026 — zadano danas (za „Generisano:“ u podnožju). */
export function datumPdf(d: Date = new Date()): string {
  return `${dvije(d.getDate())}.${dvije(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 25.09.2026 u 10:30 — vrijeme računa u lokalnoj zoni; `u` je veznik po jeziku („at“). */
export function datumVrijemePdf(d: Date, u = 'u'): string {
  return `${datumPdf(d)} ${u} ${dvije(d.getHours())}:${dvije(d.getMinutes())}`;
}

/**
 * `YYYY-MM-DD` iz baze → 25.09.2026, iz dijelova teksta (bez `new Date`, koji bi ga
 * pročitao kao UTC ponoć); prazno → „—“.
 */
export function datumIzBaze(datum: string | null | undefined): string {
  return datum ? datum.split('-').reverse().join('.') : '—';
}
