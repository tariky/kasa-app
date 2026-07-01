export interface RacunStavka {
  cijena: number;
  kolicina: number;
  rabat: number; // postotak 0–100
  pdvStopa: string; // 'E' | 'K'
}

export function izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number } {
  const ukupno = stavke.reduce(
    (sum, s) => sum + s.cijena * s.kolicina * (1 - s.rabat / 100),
    0
  );
  const pdvIznos = stavke.reduce((sum, s) => {
    if (s.pdvStopa !== 'E') return sum;
    const itemTotal = s.cijena * s.kolicina * (1 - s.rabat / 100);
    return sum + (itemTotal - itemTotal / 1.17);
  }, 0);
  return { ukupno, pdvIznos };
}
