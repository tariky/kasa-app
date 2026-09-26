import * as Tring from '../services/tring';
import type { SqlDb } from './sqldb';

/**
 * Fiskalni uređaj (Tring) kako ga vidi poslovna logika. Štampa računa i
 * reklamacije i unos/povrat novca vraćaju ishod (`IshodUredjaja`); prijava
 * operatera i izvještaji vraćaju odgovor uređaja kakav jeste — renderer ga
 * prikazuje. Dnevnik zahtjeva vodi services/tring (postXml), ne pozivaoci.
 *
 * Adapter nad services/tring je samo za main proces: lib moduli koje učitava
 * i renderer (ponuda, prilog, proizvodnja) odavde uvoze samo tipove.
 */

/**
 * Ishod komande uređaja. `bf` je broj fiskalnog računa (ili reklamacije) koji
 * je uređaj vratio. `nepoznat`: zahtjev je stigao do uređaja, a potvrde nema —
 * račun je možda odštampan (vidi `ishodNepoznat` u services/tring).
 */
export type IshodUredjaja =
  | { ok: true; bf: string | null; odgovori: Record<string, string> }
  | { ok: false; greska: string; nepoznat: boolean; odgovori?: Record<string, string> };

export type NeuspjehUredjaja = Extract<IshodUredjaja, { ok: false }>;

export interface FiskalniUredjaj {
  stampajRacun(r: Tring.Racun): Promise<IshodUredjaja>;
  stampajReklamaciju(r: Tring.ReklamiraniRacun): Promise<IshodUredjaja>;
  /** Službeni unos gotovine (polog). */
  unosNovca(iznos: number): Promise<IshodUredjaja>;
  /** Službeni iznos gotovine (povrat). */
  povratNovca(iznos: number): Promise<IshodUredjaja>;
  /** Prijava operatera iz postavki. */
  inicijalizacija(): Promise<Tring.TringResponse>;
  /** X izvještaj. */
  presjekStanja(): Promise<Tring.TringResponse>;
  /** Z izvještaj. */
  dnevniIzvjestaj(): Promise<Tring.TringResponse>;
  /** Periodični izvještaj, datumi GGGG-MM-DD. */
  periodicniIzvjestaj(od: string, do_: string): Promise<Tring.TringResponse>;
}

/** Odgovor services/tring → ishod; bez odgovora (`null`) je siguran neuspjeh. */
export function ishodIzOdgovora(r: Tring.TringResponse | null | undefined): IshodUredjaja {
  if (r?.success) return { ok: true, bf: r.odgovori?.BrojFiskalnogRacuna || null, odgovori: r.odgovori ?? {} };
  return {
    ok: false,
    greska: r?.error || r?.vrstaOdgovora || 'Nepoznata greška',
    nepoznat: Tring.ishodNepoznat(r),
    ...(r?.odgovori ? { odgovori: r.odgovori } : {}),
  };
}

type Odgovor = Promise<Tring.TringResponse | null>;

/** Funkcije u obliku services/tring — pravi klijent (adapter ispod) ili lažni uređaj u testovima. */
export interface TringFunkcije {
  stampatiFiskalniRacun(r: Tring.Racun): Odgovor;
  stampatiReklamiraniRacun(r: Tring.ReklamiraniRacun): Odgovor;
  unosNovca(iznos: number): Odgovor;
  povratNovca(iznos: number): Odgovor;
  inicijalizacija(): Promise<Tring.TringResponse>;
  stampatiPresjekStanja(): Promise<Tring.TringResponse>;
  stampatiDnevniIzvjestaj(): Promise<Tring.TringResponse>;
  stampatiPeriodicniIzvjestaj(od: string, do_: string): Promise<Tring.TringResponse>;
}

/** Uređaj nad funkcijama u obliku services/tring; komanda koje nema baca grešku. */
export function uredjajIzFunkcija(f: Partial<TringFunkcije>): FiskalniUredjaj {
  const fn = <K extends keyof TringFunkcije>(k: K): TringFunkcije[K] => {
    const x = f[k];
    if (!x) throw new Error(`Fiskalni uređaj ne podržava komandu ${k}`);
    return x;
  };
  return {
    stampajRacun: async r => ishodIzOdgovora(await fn('stampatiFiskalniRacun')(r)),
    stampajReklamaciju: async r => ishodIzOdgovora(await fn('stampatiReklamiraniRacun')(r)),
    unosNovca: async iznos => ishodIzOdgovora(await fn('unosNovca')(iznos)),
    povratNovca: async iznos => ishodIzOdgovora(await fn('povratNovca')(iznos)),
    inicijalizacija: async () => fn('inicijalizacija')(),
    presjekStanja: async () => fn('stampatiPresjekStanja')(),
    dnevniIzvjestaj: async () => fn('stampatiDnevniIzvjestaj')(),
    periodicniIzvjestaj: async (od, do_) => fn('stampatiPeriodicniIzvjestaj')(od, do_),
  };
}

export interface TringPostavke {
  host: string;
  port: number;
  operatorId: number;
  /** `null` = lozinka nije upisana. */
  operatorPassword: string | null;
  /** `dev.logging`: dnevnik zahtjeva (tring:getLogs) i ispis u konzolu. */
  logovanje: boolean;
}

/** Postavke uređaja iz baze, sa zadanim vrijednostima (localhost:8085, operator 0). */
export function procitajTringPostavke(db: SqlDb): TringPostavke {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'tring.%'").all() as
    Array<{ key: string; value: string | null }>;
  const map: Record<string, string | null> = {};
  for (const row of rows) map[row.key.replace('tring.', '')] = row.value;
  const devLogging = db.prepare("SELECT value FROM settings WHERE key = 'dev.logging'").get() as
    { value: string | null } | undefined;
  return {
    host: map.host ?? 'localhost',
    port: parseInt(map.port ?? '8085', 10),
    operatorId: parseInt(map.operatorId ?? '0', 10),
    operatorPassword: map.operatorPassword ?? null,
    logovanje: devLogging?.value === 'true',
  };
}

/**
 * Pravi uređaj s postavkama iz baze. Postavke se čitaju odmah — handler
 * napravi uređaj na početku svakog poziva, pa izmjena u Postavkama važi za
 * sljedeći poziv, a nečitljive postavke bacaju prije write-ahead reda. Prije
 * svake komande klijent se podesi (host, port, dnevnik).
 */
export function uredjajIzPostavki(db: SqlDb): FiskalniUredjaj {
  const p = procitajTringPostavke(db);
  const podesi = (): void => {
    Tring.configure({ host: p.host, port: p.port });
    Tring.setLoggingEnabled(p.logovanje);
  };
  return uredjajIzFunkcija({
    stampatiFiskalniRacun: r => { podesi(); return Tring.stampatiFiskalniRacun(r); },
    stampatiReklamiraniRacun: r => { podesi(); return Tring.stampatiReklamiraniRacun(r); },
    unosNovca: iznos => { podesi(); return Tring.unosNovca(iznos); },
    povratNovca: iznos => { podesi(); return Tring.povratNovca(iznos); },
    inicijalizacija: () => { podesi(); return Tring.inicijalizacija(p.operatorId, p.operatorPassword ?? '0'); },
    stampatiPresjekStanja: () => { podesi(); return Tring.stampatiPresjekStanja(); },
    stampatiDnevniIzvjestaj: () => { podesi(); return Tring.stampatiDnevniIzvjestaj(); },
    stampatiPeriodicniIzvjestaj: (od, do_) => { podesi(); return Tring.stampatiPeriodicniIzvjestaj(od, do_); },
  });
}
