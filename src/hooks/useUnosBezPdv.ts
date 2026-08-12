import { useState, useEffect } from 'react';

/**
 * Čita postavku `cijene.unosBezPdv`. Vraća `null` dok traje učitavanje —
 * pozivalac tada NE smije popunjavati formu, jer bi prikazao cijenu u
 * pogrešnoj jedinici.
 *
 * Postavka se ponovo čita svaki put kad se komponenta koja poziva hook
 * montira, i dodatno svaki put kad se promijeni `refreshKey` (npr. proslijedi
 * se `open` stanje dijaloga) — tako promjena u Postavkama vrijedi odmah, bez
 * restarta aplikacije.
 */
export function useUnosBezPdv(refreshKey?: unknown): boolean | null {
  const [bezPdv, setBezPdv] = useState<boolean | null>(null);

  useEffect(() => {
    let otkazano = false;
    window.api
      .getSetting('cijene.unosBezPdv')
      .then((v) => {
        if (!otkazano) setBezPdv(v === 'true');
      })
      .catch((err) => {
        // Greška ne smije zaglaviti formu: pozivaoci čekaju dok je vrijednost
        // `null`, pa bi bez ovoga dijalog ostao zauvijek nepopunjen. Vraćamo se
        // na zatečeno ponašanje — cijene se unose sa PDV-om — da ono što piše
        // na labeli uvijek odgovara onome što se sprema.
        console.error('Ne mogu pročitati postavku cijene.unosBezPdv:', err);
        if (!otkazano) setBezPdv(false);
      });
    return () => {
      otkazano = true;
    };
  }, [refreshKey]);

  return bezPdv;
}
