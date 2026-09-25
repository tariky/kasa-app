import { zipSync } from 'fflate';

/** Fajlovi → jedan .zip (za jedan dijalog snimanja i jedan prilog u mailu). */
export function zapakuj(fajlovi: Array<{ ime: string; bajtovi: Uint8Array }>): Uint8Array {
  return zipSync(Object.fromEntries(fajlovi.map(f => [f.ime, f.bajtovi])));
}
