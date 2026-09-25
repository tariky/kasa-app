// Pravila dijaloga za spremanje (dialog:saveFile, db:backup, fs:writeFile) —
// ista kao u Tauri ljusci (src-tauri/src/lib.rs, ime_za_cuvanje): renderer
// predlaže samo ime fajla u folderu koji bira korisnik, i samo vrste fajlova
// koje program zaista pravi.
import path from 'node:path';

export const DOZVOLJENE_EKSTENZIJE = ['pdf', 'xlsx', 'csv', 'db', 'zip'] as const;

const dozvoljena = (ext: string) => (DOZVOLJENE_EKSTENZIJE as readonly string[]).includes(ext.toLowerCase());

/** Ekstenzija putanje (bez obzira na velika slova) je s liste. `.zip` bez imena nema ekstenziju. */
export function dozvoljenaEkstenzija(putanja: unknown): boolean {
  return typeof putanja === 'string' && dozvoljena(path.extname(putanja).slice(1));
}

/**
 * Predloženo ime za dijalog: `/`, `\` i `:` postaju `-` (na Windowsu je
 * `C:ime` putanja relativna na disk C). Prazno, skriveno (počinje tačkom),
 * s NUL znakom ili bez dozvoljene ekstenzije → null (dijalog se ne otvara).
 */
export function imeZaCuvanje(predlog: unknown): string | null {
  if (typeof predlog !== 'string') return null;
  const ime = predlog.trim().replace(/[/\\:]/g, '-');
  if (!ime || ime.startsWith('.') || ime.includes('\0') || !dozvoljenaEkstenzija(ime)) return null;
  return ime;
}

/** Filteri dijaloga bez ekstenzija van liste; filter koji ostane prazan se izbacuje. */
export function dozvoljeniFilteri(filteri: unknown): Array<{ name: string; extensions: string[] }> {
  if (!Array.isArray(filteri)) return [];
  return filteri
    .map((f) => ({
      name: typeof f?.name === 'string' ? f.name : '',
      extensions: (Array.isArray(f?.extensions) ? f.extensions : [])
        .filter((e: unknown): e is string => typeof e === 'string' && dozvoljena(e)),
    }))
    .filter(f => f.extensions.length > 0);
}
