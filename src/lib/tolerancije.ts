// Zajedničke granice poređenja — bez importa, pa ih smiju koristiti i renderer
// i backend (lib/). Rust: `zaliha::TOLERANCIJA_ZALIHE`.

/**
 * Tolerancija za stanje zalihe i količine: |stanje| < 1e-9 je nula. Stanje je
 * zbir kretanja u REAL-u, pa ostaje šum (0,1 + 0,2 − 0,3 ≠ 0) — takva "zaliha"
 * ne pravi nivelaciju, upozorenje ni korekciju. Ista granica važi u izvozu,
 * proizvodnji (utrošak, proizvodi naloga) i prikazu naloga.
 */
export const TOLERANCIJA_ZALIHE = 1e-9;
