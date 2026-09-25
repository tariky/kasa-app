// Pravila za korisnike (user:create / user:update / user:delete) i PIN-ove — na jednom mjestu.
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SqlDb } from './sqldb';
import { zapisiAudit } from './audit';

export const ULOGE = ['admin', 'kasir'] as const;
export type Uloga = (typeof ULOGE)[number];

/** Korisnik kako ga vide kanali — nikad s PIN-om ni hešom. */
export interface JavniKorisnik { id: number; ime: string; uloga: Uloga }

/** PIN zadanog admina; prijava s njim traži promjenu PIN-a prije ulaska. */
export const ZADANI_PIN = '0000';

/** Baca grešku ako PIN nije niz od najmanje 4 cifre; vraća PIN nepromijenjen. */
export function validirajPin(pin: unknown): string {
  if (pin == null || (typeof pin === 'string' && !pin.trim())) throw new Error('PIN je obavezan');
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) throw new Error('PIN smije sadržavati samo cifre');
  if (pin.length < 4) throw new Error('PIN mora imati najmanje 4 cifre');
  return pin;
}

/** Baca grešku ako uloga nije "admin" ili "kasir". */
export function validirajUlogu(uloga: unknown): Uloga {
  if (!(ULOGE as readonly unknown[]).includes(uloga)) throw new Error('Uloga mora biti "admin" ili "kasir"');
  return uloga as Uloga;
}

/** Tabele s FK na users(id) — korisnik s ijednim redom u njima ne može biti obrisan. */
export const VEZE_KORISNIKA: readonly { tabela: string; poruka: string }[] = [
  { tabela: 'orders', poruka: 'Korisnik ima račune i ne može biti obrisan' },
  { tabela: 'pending_receipts', poruka: 'Korisnik ima račun u obradi i ne može biti obrisan' },
  { tabela: 'cash_movements', poruka: 'Korisnik ima pologe/povrate gotovine i ne može biti obrisan' },
  { tabela: 'ponude', poruka: 'Korisnik ima ponude i ne može biti obrisan' },
  { tabela: 'radni_nalozi', poruka: 'Korisnik ima radne naloge i ne može biti obrisan' },
];

// ─── Heš PIN-a ──────────────────────────────────────────────
// Format: `pbkdf2$<iteracije>$<so hex>$<heš hex>` — PBKDF2-HMAC-SHA256, 16 B
// nasumične soli, 32 B izlaza. Isti format čita Rust backend.

export const PBKDF2_ITERACIJE = 100000;
const SO_BAJTOVA = 16;
const HES_BAJTOVA = 32;
const FORMAT_HESA = /^pbkdf2\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

export function hesirajPin(pin: string, so: Buffer = randomBytes(SO_BAJTOVA)): string {
  const hes = pbkdf2Sync(pin, so, PBKDF2_ITERACIJE, HES_BAJTOVA, 'sha256');
  return `pbkdf2$${PBKDF2_ITERACIJE}$${so.toString('hex')}$${hes.toString('hex')}`;
}

/** Da li je vrijednost iz kolone `users.pin` već heš (a ne stari PIN u čistom tekstu). */
export function jeHesPina(zapis: string): boolean {
  return zapis.startsWith('pbkdf2$');
}

/**
 * Da li `pin` odgovara zapisu. Neispravan zapis (ili čist tekst) nikad ne
 * odgovara. Iteracije se čitaju iz zapisa (manje od 100000 se odbija), a
 * poređenje je konstantno-vremensko.
 */
export function provjeriPin(pin: unknown, zapis: string): boolean {
  if (typeof pin !== 'string') return false;
  const m = FORMAT_HESA.exec(zapis);
  if (!m) return false;
  const iteracije = Number(m[1]);
  if (iteracije < PBKDF2_ITERACIJE || iteracije > 10 * PBKDF2_ITERACIJE) return false;
  const ocekivano = Buffer.from(m[3], 'hex');
  const hes = pbkdf2Sync(pin, Buffer.from(m[2], 'hex'), iteracije, HES_BAJTOVA, 'sha256');
  return timingSafeEqual(hes, ocekivano);
}

// ─── Baza ───────────────────────────────────────────────────

/**
 * Migracija: svaki PIN koji još nije heš postaje heš. Vraća broj izmijenjenih redova.
 *
 * Stari seed je vraćao Admin/0000 pri svakom pokretanju nakon što je vlasnik
 * promijenio PIN zadanog admina, pa bi heširanje tog reda ostavilo živog
 * admina s PIN-om 0000. Zato se, dok još ima PIN-ova u čistom tekstu, admin
 * s PIN-om '0000' onemogući kad postoji drugi admin s drugačijim PIN-om:
 * obriše se ako ga ništa ne referencira, a inače dobije nasumičan heš s kojim
 * se niko ne može prijaviti. Ako je on jedini admin, ostaje (prijava traži
 * promjenu PIN-a). Rust: `hesiraj_stare_pinove` u korisnici.rs.
 */
export function hesirajStarePinove(db: SqlDb): number {
  const redovi = db.prepare('SELECT id, ime, uloga, pin FROM users ORDER BY id').all() as
    Array<{ id: number; ime: string; uloga: string; pin: string }>;
  if (redovi.every(r => jeHesPina(String(r.pin)))) return 0;

  const zadani = redovi.filter(r => r.uloga === 'admin' && String(r.pin) === ZADANI_PIN);
  const imaDrugogAdmina = redovi.some(r => {
    if (r.uloga !== 'admin') return false;
    const pin = String(r.pin);
    return jeHesPina(pin) ? !provjeriPin(ZADANI_PIN, pin) : pin !== ZADANI_PIN;
  });
  const ugaseni = new Set<number>();
  if (zadani.length > 0 && imaDrugogAdmina) {
    for (const r of zadani) {
      const referenciran = VEZE_KORISNIKA.some(({ tabela }) =>
        db.prepare(`SELECT 1 FROM ${tabela} WHERE korisnikId = ? LIMIT 1`).get(r.id));
      if (referenciran) {
        // Nasumičan PIN koji niko ne zna: red ostaje zbog računa/pologa, ali se s njim ne može prijaviti.
        db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hesirajPin(randomBytes(32).toString('hex')), r.id);
      } else {
        db.prepare('DELETE FROM users WHERE id = ?').run(r.id);
      }
      zapisiAudit(db, null, 'korisnik:zadaniUklonjen', { id: r.id, ime: r.ime, obrisan: !referenciran });
      ugaseni.add(r.id);
    }
  }

  const upis = db.prepare('UPDATE users SET pin = ? WHERE id = ?');
  let n = ugaseni.size;
  for (const r of redovi) {
    if (ugaseni.has(r.id) || jeHesPina(String(r.pin))) continue;
    upis.run(hesirajPin(String(r.pin)), r.id);
    n++;
  }
  return n;
}

/** Zadani Admin/0000 — samo kad u bazi nema nijednog korisnika. */
export function osigurajZadanogAdmina(db: SqlDb): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;
  db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Admin', ?, 'admin')").run(hesirajPin(ZADANI_PIN));
}

/**
 * Korisnik čiji PIN odgovara (opcionalno samo među adminima). Provjerava se
 * svaki red, bez ranog izlaza, da trajanje ne otkriva koji je korisnik pogođen.
 */
export function nadjiPoPinu(db: SqlDb, pin: unknown, opts: { samoAdmin?: boolean; osimId?: number } = {}): JavniKorisnik | null {
  const redovi = db.prepare('SELECT id, ime, uloga, pin FROM users ORDER BY id').all() as Array<JavniKorisnik & { pin: string }>;
  let nadjen: JavniKorisnik | null = null;
  for (const r of redovi) {
    const odgovara = provjeriPin(pin, String(r.pin));
    if (!odgovara || nadjen) continue;
    if (opts.samoAdmin && r.uloga !== 'admin') continue;
    if (opts.osimId !== undefined && r.id === opts.osimId) continue;
    nadjen = { id: r.id, ime: r.ime, uloga: r.uloga };
  }
  return nadjen;
}

/** Da li `pin` već pripada nekom drugom korisniku (PIN je ujedno prijava, pa mora biti jedinstven). */
export function pinZauzet(db: SqlDb, pin: string, osimId?: number): boolean {
  return nadjiPoPinu(db, pin, { osimId }) !== null;
}

/** Da li `pin` odgovara PIN-u korisnika `id`. */
export function pinKorisnika(db: SqlDb, id: number, pin: unknown): boolean {
  const r = db.prepare('SELECT pin FROM users WHERE id = ?').get(id) as { pin: string } | undefined;
  return !!r && provjeriPin(pin, String(r.pin));
}
