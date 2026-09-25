// Ugovor IPC sloja: ono što renderer vidi kroz `window.api`, opisano kao
// "kanal + argumenti → rezultat ili greška + stanje baze". Isti testovi se
// puštaju nad svakom implementacijom backenda (danas Electron/TS handleri,
// sutra Rust), pa prolaz testa znači da se nova implementacija ponaša isto.
//
// Izbor implementacije: KASA_BACKEND=ts (podrazumijevano) ili KASA_BACKEND=rust
// (src-tauri/backend, `bun run test:rust`).
import type { Database } from 'bun:sqlite';
import type { LaziTring } from './laziTring';

export interface OdgovoriDijaloga {
  /** Putanja koju vrati dijalog za spremanje. */
  sacuvaj: string | null;
  /** Putanja koju vrati dijalog za otvaranje. */
  otvori: string | null;
  /** Indeks dugmeta u dijalogu za potvrdu. */
  potvrda: number;
}

export interface OtvoreniDijalog {
  vrsta: 'sacuvaj' | 'otvori' | 'potvrda';
  /** Opcije kako ih je backend proslijedio (naslov, predložen naziv, filteri, dugmad). */
  opcije: Record<string, unknown>;
}

export interface Backend {
  /**
   * Poziv kanala kao iz renderera. Argumenti i rezultat idu kroz JSON, a
   * "nema vrijednosti" je uvijek `null` (JSON nema `undefined`).
   */
  call(kanal: string, ...args: unknown[]): Promise<any>;
  /** Druga konekcija na istu bazu — za pripremu podataka i provjeru stanja. */
  db: Database;
  tring: LaziTring;
  /** Odgovori koje će sljedeći sistemski dijalozi dati (null = korisnik otkazao). */
  dijalog: OdgovoriDijaloga;
  /** Dijalozi koje je backend otvorio, redom. */
  otvoreniDijalozi: OtvoreniDijalog[];
  /** Prazan folder za fajlove testa (backup, izvoz PDF-a...). */
  radniFolder: string;
  /** Da li je backend zatražio restart aplikacije (npr. nakon uvoza backup-a). */
  restartovan(): boolean;
  /**
   * Novo pokretanje backenda nad istom bazom (kao ponovno otvaranje programa):
   * shema, migracije i seed se ponove, sesija i ograničenje pokušaja počinju
   * iz početka — niko nije prijavljen.
   */
  ponovoPokreni(): Promise<void>;
  close(): Promise<void>;
}

export interface OpcijeBackenda {
  /**
   * PIN kojim se harness prijavi odmah nakon otvaranja (kanali traže
   * prijavljenog korisnika — vidi src/ipc/sesija.ts). Podrazumijevano zadani
   * admin (id 1, PIN 0000); `null` = backend ostaje bez prijave.
   */
  prijava?: string | null;
}

export async function otvoriBackend(opcije: OpcijeBackenda = {}): Promise<Backend> {
  const vrsta = process.env.KASA_BACKEND ?? 'ts';
  let b: Backend;
  if (vrsta === 'ts') b = await (await import('./tsBackend')).otvoriTsBackend();
  else if (vrsta === 'rust') b = await (await import('./rustBackend')).otvoriRustBackend();
  else throw new Error(`Nepoznat KASA_BACKEND: ${vrsta}`);
  const pin = opcije.prijava === undefined ? '0000' : opcije.prijava;
  if (pin !== null) await prijavi(b, pin);
  return b;
}

/** Prijava kao iz LoginScreena; baca ako PIN ne pripada nikome. Vraća user:login rezultat. */
export async function prijavi(b: Backend, pin: string): Promise<{ id: number; ime: string; uloga: string; zadaniPin: boolean }> {
  const u = await b.call('user:login', pin);
  if (!u) throw new Error(`Prijava PIN-om ${pin} nije uspjela`);
  return u;
}
