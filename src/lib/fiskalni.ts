import type { SqlDb } from './sqldb';

/** Parse a fiscal receipt number; returns null for refunds (R-...), empty, or non-numeric. */
export function parseFiskalniBroj(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Najviše koliko praznina vraćamo odjednom. */
export const MAX_PRAZNINA = 200;

/**
 * Vrati brojeve koji nedostaju strogo između najmanjeg i najvećeg fiskalnog broja.
 *
 * Rezultat je ograničen na `maxGaps` — jedan pogrešno ukucan broj (npr. 1234567
 * umjesto 1234) inače generiše milione "praznina" i zamrzne ekran koji ih crta.
 */
export function izracunajPraznine(
  brojevi: number[],
  maxGaps: number = MAX_PRAZNINA,
  ignorisani: Set<number> = new Set()
): number[] {
  const present = new Set(brojevi);
  const sorted = [...present].sort((a, b) => a - b);
  if (sorted.length < 2 || maxGaps <= 0) return [];
  const gaps: number[] = [];
  const max = sorted[sorted.length - 1];
  for (let n = sorted[0] + 1; n < max; n++) {
    if (present.has(n) || ignorisani.has(n)) continue;
    gaps.push(n);
    if (gaps.length >= maxGaps) break;
  }
  return gaps;
}

/**
 * Postavka: posljednji BF broj odštampan prije nego je program preuzeo niz.
 * Služi samo dok u bazi nema nijednog fiskalizovanog računa.
 */
export const ZADNJI_FISKALNI_KEY = 'fiscal.zadnjiBroj';

/** Kada je taj broj upisan — odlučuje je li noviji od posljednjeg računa u bazi. */
export const ZADNJI_FISKALNI_AT_KEY = 'fiscal.zadnjiBrojAt';

/**
 * BF sa posljednjeg fiskalizovanog računa; `null` kad ga nema.
 *
 * Uzima se posljednji po datumu računa, a ne najveći broj u bazi: naknadno
 * popunjena praznina u nizu (stari račun ukucan danas) nosi stari datum, pa ne
 * pomjera niz unazad, a resetovan brojač na uređaju ne ostavlja zaglavljen
 * maksimum iz prošlog perioda. Reklamacije (`R-3`) i ručni upisi bez broja se
 * preskaču, pa se gleda prvi račun odozgo koji ima numerički BF.
 */
export function zadnjiFiskalniRacun(db: SqlDb): { broj: number; createdAt: string } | null {
  const rows = db
    .prepare(`
      SELECT brojFiskalnogRacuna, createdAt FROM orders
      WHERE brojFiskalnogRacuna IS NOT NULL
      ORDER BY createdAt DESC, id DESC
      LIMIT 200
    `)
    .all() as Array<{ brojFiskalnogRacuna: string; createdAt: string }>;
  for (const r of rows) {
    const broj = parseFiskalniBroj(r.brojFiskalnogRacuna);
    if (broj !== null) return { broj, createdAt: r.createdAt ?? '' };
  }
  return null;
}

/** Samo broj sa posljednjeg fiskalizovanog računa. */
export function zadnjiFiskalniBroj(db: SqlDb): number | null {
  return zadnjiFiskalniRacun(db)?.broj ?? null;
}

/** Ručno upisan posljednji broj iz postavki; `null` kad nije upisan. */
export function zadnjiUpisaniFiskalniBroj(db: SqlDb): number | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ZADNJI_FISKALNI_KEY) as
    { value: string } | undefined;
  const broj = row ? parseInt(row.value, 10) : NaN;
  return Number.isInteger(broj) && broj >= 0 ? broj : null;
}

/** Trenutak ručnog upisa, u istom formatu kao `orders.createdAt`. */
function zadnjiUpisAt(db: SqlDb): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ZADNJI_FISKALNI_AT_KEY) as
    { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Upisuje posljednji odštampani BF broj i vrijeme upisa. Nula znači „uređaj još
 * nije štampao". Vrijeme je bitno: ručna ispravka mora pobijediti ono što baza
 * zna, inače operater ne može ispraviti niz koji je odlutao.
 */
export function postaviZadnjiFiskalniBroj(db: SqlDb, broj: number): number {
  if (!Number.isInteger(broj) || broj < 0) {
    throw new Error('Posljednji fiskalni broj mora biti cijeli broj 0 ili veći');
  }
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  upsert.run(ZADNJI_FISKALNI_KEY, String(broj));
  const { sada } = db.prepare("SELECT datetime('now','localtime') AS sada").get() as { sada: string };
  upsert.run(ZADNJI_FISKALNI_AT_KEY, sada);
  return broj;
}

/**
 * Broj koji će uređaj po svoj prilici dati sljedećem isječku.
 *
 * Potreban je računu po prilogu: naziv zbirne stavke se kuca prije štampe, a
 * mora nositi broj tog istog isječka. `null` znači da se broj ne može
 * pretpostaviti i da ga operater mora unijeti; predviđanje nije garancija, pa
 * se poslije štampe poredi sa stvarnim BF-om.
 */
export function predvidjeniFiskalniBroj(db: SqlDb): number | null {
  const racun = zadnjiFiskalniRacun(db);
  const upisani = zadnjiUpisaniFiskalniBroj(db);
  if (upisani === null) return racun ? racun.broj + 1 : null;
  if (!racun) return upisani + 1;
  // Novija činjenica pobjeđuje: ručna ispravka važi dok kroz program ne prođe
  // sljedeći račun, a onda ga baza opet preuzima.
  const upisAt = zadnjiUpisAt(db) ?? '';
  return (upisAt > racun.createdAt ? upisani : racun.broj) + 1;
}
