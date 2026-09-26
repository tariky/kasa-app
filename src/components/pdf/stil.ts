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
