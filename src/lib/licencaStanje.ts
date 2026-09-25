// Stanje licence u aplikaciji: iz tokena i današnjeg datuma izračuna da li
// program radi normalno, upozorava, radi u periodu milosti ili je zaključan
// (samo pregled). Čista funkcija — main proces joj daje datum i ID uređaja.
import type { KeyObject } from 'node:crypto';
import { provjeriLicencu } from './licenca';
import { UPOZORENJE_DANA, PERIOD_MILOSTI_DANA, type StanjeLicence } from './licencaTipovi';
import { KANALI_MODULA, NAZIV_MODULA, modulVanLicence } from './moduli';

export * from './licencaTipovi';

function danBroj(datum: string): number {
  const [g, m, d] = datum.split('-').map(Number);
  return Date.UTC(g, m - 1, d) / 86_400_000;
}

/** Razlika u danima `do - od` za datume `YYYY-MM-DD`. */
export function razlikaDana(od: string, doDatuma: string): number {
  return danBroj(doDatuma) - danBroj(od);
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datum s kojim se računa licenca: najveći od stvarnog, zadnjeg viđenog
 * (licenca.json) i najnovijeg iz baze, da ni vraćanje sata unazad ni brisanje
 * `zadnjiDatum` ne produže licencu. Vrijednost koja nije `YYYY-MM-DD` se ignoriše.
 * Rust: `efektivni_danas` u licenca.rs.
 */
export function efektivniDanas(stvarni: string, zadnjiVidjeni?: string | null, izBaze?: string | null): string {
  let danas = stvarni;
  for (const d of [zadnjiVidjeni, izBaze]) {
    if (typeof d === 'string' && DATUM.test(d) && d > danas) danas = d;
  }
  return danas;
}

/**
 * Najnoviji dan iz računa i pologa/povrata — `createdAt` ih upisuje sat
 * računara, pa baza pamti "danas" i kad se obriše licenca.json. Ručno uneseni
 * računi (`isManual`) nose datum koji je korisnik ukucao, pa se ne broje:
 * greška u kucanju ne smije zaključati licencu. Isti upit je u licenca.rs.
 */
export const UPIT_NAJNOVIJI_DATUM = `
  SELECT MAX(d) AS d FROM (
    SELECT MAX(substr(createdAt, 1, 10)) AS d FROM orders
      WHERE isManual = 0 AND createdAt GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    UNION ALL
    SELECT MAX(substr(createdAt, 1, 10)) FROM cash_movements
      WHERE createdAt GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  )`;

/** Dovoljno i za better-sqlite3 i za bun:sqlite (testovi). */
interface CitljivaBaza {
  prepare(sql: string): { get(...parametri: unknown[]): unknown };
}

/** `YYYY-MM-DD` ili null (prazna, zatvorena ili nedostupna baza nisu greška). */
export function najnovijiDatumIzBaze(db: CitljivaBaza): string | null {
  try {
    return procitajDatum(db);
  } catch {
    return null;
  }
}

function procitajDatum(db: CitljivaBaza): string | null {
  const d = (db.prepare(UPIT_NAJNOVIJI_DATUM).get() as { d?: unknown } | null | undefined)?.d;
  return typeof d === 'string' && DATUM.test(d) ? d : null;
}

/** Pročitani datumi po konekciji; nova konekcija (restore, ponovno otvaranje) čita ponovo. */
const datumPoKonekciji = new WeakMap<object, string | null>();

/**
 * Kao `najnovijiDatumIzBaze`, ali jednom po konekciji: upit prolazi kroz sve
 * račune (~56 ms na 300k), a zove se pri svakom licenciranom kanalu. Računi
 * nastali kasnije nose sat računara, koji ionako ulazi u efektivni datum.
 * Neuspjelo čitanje se ne pamti. Rust: `DatumIzBaze` u licenca.rs.
 */
export function najnovijiDatumIzBazeJednom(db: CitljivaBaza): string | null {
  if (datumPoKonekciji.has(db)) return datumPoKonekciji.get(db) ?? null;
  let d: string | null;
  try {
    d = procitajDatum(db);
  } catch {
    return null;
  }
  datumPoKonekciji.set(db, d);
  return d;
}

export function izracunajStanje(
  token: string | null | undefined,
  javniKljuc: string | KeyObject,
  opcije: { danas: string; uredjaj: string },
): StanjeLicence {
  if (!token?.trim()) return { stanje: 'nema' };

  const [g, m, d] = opcije.danas.split('-').map(Number);
  const r = provjeriLicencu(token, javniKljuc, { sada: new Date(g, m - 1, d, 12), uredjaj: opcije.uredjaj });
  if (!r.ok && r.razlog !== 'istekla') return { stanje: 'neispravna', razlog: r.razlog };

  const licenca = r.ok ? r.licenca : r.licenca!;
  const danaDoIsteka = razlikaDana(opcije.danas, licenca.vrijediDo);
  if (danaDoIsteka >= 0) {
    return danaDoIsteka <= UPOZORENJE_DANA
      ? { stanje: 'upozorenje', licenca, danaDoIsteka }
      : { stanje: 'aktivna', licenca, danaDoIsteka };
  }
  const danaDoBlokade = PERIOD_MILOSTI_DANA + danaDoIsteka;
  return danaDoBlokade >= 0 ? { stanje: 'milost', licenca, danaDoBlokade } : { stanje: 'zakljucana', licenca };
}

/** Da li program smije praviti nove dokumente (račune, primke, naloge…). */
export function smijeRaditi(s: StanjeLicence): boolean {
  return s.stanje === 'aktivna' || s.stanje === 'upozorenje' || s.stanje === 'milost';
}

/** Kanali koji prave nove dokumente ili mijenjaju stanje zaliha. */
const BLOKIRANI_KANALI = new Set([
  'order:create', 'order:createManual', 'order:finalize', 'order:finalizePrilog',
  'order:refund', 'order:refundAndPrint',
  'tring:printReceipt', 'tring:printRefund',
  'primka:create', 'primka:update',
  'product:adjustStock',
  'ponuda:create', 'ponuda:update', 'ponuda:konvertuj',
  'nalog:create', 'nalog:createIzPonude', 'nalog:update', 'nalog:replaceStavke',
  'nalog:setStatus', 'nalog:izdajRacun',
]);

/** Kanal pripada modulu (svi takvi kanali nešto mijenjaju — čitanja nisu u katalogu). */
function kanalModula(kanal: string): boolean {
  // Object.hasOwn: ključevi s prototipa (`constructor`, `toString`) nisu kanali.
  return Object.hasOwn(KANALI_MODULA, kanal);
}

/** Da li kanal uopšte zavisi od licence — ostali ne čitaju licenca.json. */
export function kanalPodLicencom(kanal: string): boolean {
  return BLOKIRANI_KANALI.has(kanal) || kanalModula(kanal);
}

/**
 * Zašto licenca ne dozvoljava kanal; null = dozvoljen. Istekla licenca ima prednost.
 * Bez važeće licence (nema, neispravna, zaključana) program je "samo pregled":
 * čitanja rade, a kanali modula su blokirani kao i pisanje dokumenata —
 * `licenciraniModuli` daje "sve" samo da bi se u pregledu vidjeli ekrani.
 */
export function razlogBlokade(s: StanjeLicence, kanal: string): { razlog: 'istekla' | 'modul'; poruka: string } | null {
  if ((BLOKIRANI_KANALI.has(kanal) || kanalModula(kanal)) && !smijeRaditi(s)) {
    return { razlog: 'istekla', poruka: 'Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.' };
  }
  const modul = modulVanLicence(s, kanal);
  return modul ? { razlog: 'modul', poruka: `Modul ${NAZIV_MODULA[modul]} nije uključen u licencu.` } : null;
}
