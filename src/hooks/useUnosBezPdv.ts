import { useState, useEffect } from 'react';

/**
 * Čita postavku `cijene.unosBezPdv`. Vraća `null` dok traje učitavanje —
 * pozivalac tada NE smije popunjavati formu, jer bi prikazao cijenu u
 * pogrešnoj jedinici.
 *
 * `refreshKey` se koristi da se postavka ponovo pročita kad se dijalog
 * otvori, pa promjena u Postavkama vrijedi odmah, bez restarta aplikacije.
 */
export function useUnosBezPdv(refreshKey?: unknown): boolean | null {
  const [bezPdv, setBezPdv] = useState<boolean | null>(null);

  useEffect(() => {
    let otkazano = false;
    window.api.getSetting('cijene.unosBezPdv').then((v) => {
      if (!otkazano) setBezPdv(v === 'true');
    });
    return () => {
      otkazano = true;
    };
  }, [refreshKey]);

  return bezPdv;
}
