/**
 * Primka (ulaz robe) i nivelacija: unos, izmjena, brisanje i pregled promjena
 * cijena prije spremanja — orkestracija nad pravilima iz `skladiste.ts`, s
 * transakcijama i poništavanjem pregleda unutar modula. Rust parnjak je
 * `src-tauri/backend/src/skladiste.rs` (`unesi_primku`, `izmijeni_primku`,
 * `obrisi_primku`, `s_pregledom`, `spremi_potvrdjeno`, `bez_upisa`,
 * `create_nivelacija`) — ugovor oba backenda je `src/ipc/ugovor/skladiste.ugovor.test.ts`.
 */
import type { SqlDb } from './sqldb';
import type { PregledCijenaUlaza, PromijenjenoOdPregleda } from '../types';
import { localDateStr } from './novac';
import {
  collectPriceChanges, upisiCijene, revertPrimkaPrices, zapisiPromjeneCijena, stareCijeneStavki, datumKretanjaPrimke, validirajPrimku,
  pripremiIzmjenuPrimke, stareCijeneIzmjene, type PriceChange,
  artikliPrimke, cijeneArtikala, promjeneUProdaji, brojeviNivelacijaPrimke, napomenaProtunivelacije,
  pocetakPregleda, rezultatPregleda, cijeneKojeOstaju, istiPregled,
} from './skladiste';
import * as zaliha from './zaliha';

/** Primka kako je šalje ekran ulaza (primka:create, primka:update i njihov pregled). */
export interface PrimkaUnos {
  brojPrimke: string; datum?: string; napomena?: string; brojFakture?: string;
  dobavljacNaziv?: string; dobavljacId?: string; dobavljacAdresa?: string;
  stavke: Array<{ productId: number; kolicina: number; cijena: number; nabavnaCijena: number; rabat: number; zavisniTroskovi?: number; pdvStopa: string }>;
}

export interface PrimkaDeps {
  db: SqlDb;
  /** Isti audit koji handlers danas koristi (zapisiAudit vezan za trenutnog korisnika). */
  audit: (akcija: string, detalji: Record<string, unknown>) => void;
  /** Omotač koji izvrši callback u SQL transakciji (better-sqlite3 / bun:sqlite `db.transaction`). */
  transaction: <T>(fn: () => T) => () => T;
}

/** Odgovor primka:create / primka:update kad je upisano. */
export interface SpremljenaPrimka<Id = number> {
  id: Id;
  nivelacijaCreated: boolean;
}

export interface Primke {
  /** primka:create — bez potvrde (stari klijent, skripta) sprema bez poređenja. */
  unesi(unos: PrimkaUnos, potvrda?: unknown): SpremljenaPrimka<number | bigint> | PromijenjenoOdPregleda;
  /** primka:update */
  izmijeni(unos: PrimkaUnos & { id: number }, potvrda?: unknown): SpremljenaPrimka | PromijenjenoOdPregleda;
  /** primka:delete — uspjeh bez povratne vrijednosti; samo odbijanje nosi pregled. */
  obrisi(id: number, potvrda?: unknown): PromijenjenoOdPregleda | undefined;
  /** primka:pregledUnosa */
  pregledUnosa(unos: PrimkaUnos): PregledCijenaUlaza;
  /** primka:pregledIzmjene */
  pregledIzmjene(unos: PrimkaUnos & { id: number }): PregledCijenaUlaza;
  /** primka:pregledBrisanja */
  pregledBrisanja(id: number): PregledCijenaUlaza;
}

// ─── Nivelacija ─────────────────────────────────────────────

/** Sljedeći broj nivelacije u godini (`NIV-<godina>-NNN`) — Rust `get_next_broj_nivelacije`. */
function getNextBrojNivelacije(db: SqlDb): string {
  const year = new Date().getFullYear();
  const prefix = `NIV-${year}-`;
  const row = db.prepare(
    "SELECT MAX(CAST(SUBSTR(brojNivelacije, ?) AS INTEGER)) AS maxNum FROM nivelacije WHERE brojNivelacije LIKE ?"
  ).get(prefix.length + 1, `${prefix}%`) as { maxNum: number | null } | undefined;
  const next = (row?.maxNum ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * Upiše nivelaciju (dokument) s današnjim datumom i sljedećim brojem; cijene
 * u šifarniku upisuje pozivalac. `primkaId` null = protunivelacija (nije
 * nivelacija primke — stari put poništavanja je ne čita). Vraća broj, ili
 * null kad nema stavki. Rust `create_nivelacija`.
 */
export function upisiNivelaciju(db: SqlDb, primkaId: number | bigint | null, priceDiffs: PriceChange[], napomena: string | null): string | null {
  if (priceDiffs.length === 0) return null;

  const brojNivelacije = getNextBrojNivelacije(db);
  const datum = localDateStr();

  const nivResult = db.prepare(
    'INSERT INTO nivelacije (brojNivelacije, datum, primkaId, napomena) VALUES (?, ?, ?, ?)'
  ).run(brojNivelacije, datum, primkaId, napomena);

  const nivelacijaId = nivResult.lastInsertRowid;

  const insertStavka = db.prepare(
    'INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  for (const d of priceDiffs) {
    const razlika = d.novaCijena - d.staraCijena;
    const ukupnaRazlika = razlika * d.kolicina;
    insertStavka.run(nivelacijaId, d.productId, d.kolicina, d.staraCijena, d.novaCijena, razlika, ukupnaRazlika, d.pdvStopa);
  }
  return brojNivelacije;
}

// ─── Primka ─────────────────────────────────────────────────

export function napraviPrimke({ db, audit, transaction }: PrimkaDeps): Primke {
  // Tijela create/update/delete bez transakcije: prava operacija ih pokrene u
  // transakciji, a pregled (primka:pregled*) u transakciji koju poništi — ista
  // logika, pa najava na ekranu ne može odstupiti od onoga što spremanje uradi.
  /**
   * Trag svake promjene cijene u šifarniku od snimka `prije` (cijeneArtikala) —
   * primka je mijenja nivelacijom, bez zalihe direktno, a brisanje je vraća.
   * U pregledu (poništena transakcija) nestaje zajedno s ostalim.
   * Rust `audit_cijena_primke`.
   */
  function auditCijenaPrimke(prije: Map<number, number>, izvor: string, primkaId: number | bigint) {
    const sada = cijeneArtikala(db, prije.keys());
    for (const [productId, staraCijena] of prije) {
      const novaCijena = sada.get(productId);
      if (novaCijena !== undefined && novaCijena !== staraCijena) {
        audit('artikal:cijena', { productId, staraCijena, novaCijena, izvor, primkaId: Number(primkaId) });
      }
    }
  }

  /** Rust `unesi_primku`. */
  function unesiPrimku(data: PrimkaUnos) {
    const brojPrimke = validirajPrimku(db, data);
    const cijenePrije = cijeneArtikala(db, data.stavke.map(s => s.productId));
    const datum = data.datum || localDateStr();
    const result = db
      .prepare('INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null);

    const primkaId = result.lastInsertRowid;

    const insertStavka = db.prepare(
      'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa, staraCijena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    // Collect price diffs BEFORE inserting stock (so stock reflects pre-delivery state)
    const { nivelacija, bezZaliha } = collectPriceChanges(db, data.stavke);

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti.
    const stareCijene = stareCijeneStavki(data.stavke, bezZaliha);
    data.stavke.forEach((stavka, i) => {
      insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.zavisniTroskovi ?? 0, stavka.pdvStopa, stareCijene[i]);
    });
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    zaliha.knjizi(db, { vrsta: 'primka', id: Number(primkaId) }, 'ulaz', data.stavke, { datum: datumKretanjaPrimke(datum) });

    upisiCijene(db, [...nivelacija, ...bezZaliha]);
    upisiNivelaciju(db, primkaId, nivelacija, null);
    zapisiPromjeneCijena(db, 'primka', primkaId, [...nivelacija, ...bezZaliha]);
    auditCijenaPrimke(cijenePrije, 'primka', primkaId);

    return { id: primkaId, nivelacijaCreated: nivelacija.length > 0 };
  }

  /** Rust `izmijeni_primku`. */
  function izmijeniPrimku(data: PrimkaUnos & { id: number }) {
    const brojPrimke = validirajPrimku(db, data, data.id);
    const datum = data.datum || localDateStr();

    db.prepare('UPDATE primke SET brojPrimke = ?, datum = ?, dobavljacNaziv = ?, dobavljacId = ?, dobavljacAdresa = ?, napomena = ?, brojFakture = ? WHERE id = ?')
      .run(brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null, data.id);

    // Cijene u prodaji prije izmjene — nivelacije (i protunivelacije) idu od njih.
    const prije = cijeneArtikala(db, [...artikliPrimke(db, data.id), ...data.stavke.map(s => s.productId)]);

    // Cijene se diraju samo za artikle kojima je korisnik promijenio prodajnu
    // cijenu (ili ih dodao/uklonio) — vidi pripremiIzmjenuPrimke. Ostalima
    // ostaju cijena, historija i nivelacija; izmjena količine, datuma ili
    // dobavljača ne smije ponovo nametnuti cijenu ove primke. Postojeće
    // nivelacije se nikad ne brišu.
    const izmjena = pripremiIzmjenuPrimke(db, data.id, data.stavke);

    // Delete old stavke and stock movements
    db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(data.id);
    zaliha.ponisti(db, { vrsta: 'primka', id: data.id });

    const insertStavka = db.prepare(
      'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa, staraCijena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    // Collect price diffs BEFORE inserting stock — samo za dodane artikle i
    // promijenjene cijene koje ova primka i dalje određuje.
    const { nivelacija, bezZaliha } = collectPriceChanges(db, data.stavke.filter(s => izmjena.kreiraj.has(s.productId)));

    upisiCijene(db, [...nivelacija, ...bezZaliha]);
    zapisiPromjeneCijena(db, 'primka', data.id, [...nivelacija, ...bezZaliha]);

    // Dokumenti: sve što se u prodaji promijenilo, od cijene koja je bila u
    // prodaji do nove, na zalihi bez robe iz ove primke (ulaz još nije upisan).
    // Nova cijena ove primke → njena nivelacija (npr. 12 → 15; stara 10 → 12
    // ostaje). Vraćena cijena (uklonjena stavka, cijena vraćena na staru) →
    // protunivelacija bez veze na primku, da je stari put poništavanja iz
    // nivelacija primke nikad ne pročita kao njenu.
    const odPrimke = new Set([...nivelacija, ...bezZaliha].map(c => c.productId));
    const promjene = promjeneUProdaji(db, prije);
    const noveCijene = promjene.filter(c => odPrimke.has(c.productId));
    const vraceneCijene = promjene.filter(c => !odPrimke.has(c.productId));
    upisiNivelaciju(db, data.id, noveCijene, `Izmjena primke ${brojPrimke}`);
    upisiNivelaciju(db, null, vraceneCijene, napomenaProtunivelacije(
      `Izmjena primke ${brojPrimke}: poništenje cijene`, brojeviNivelacijaPrimke(db, data.id, vraceneCijene.map(c => c.productId))
    ));

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti;
    // zadržane promjene zadržavaju svoju zapamćenu cijenu.
    const stareCijene = stareCijeneIzmjene(data.stavke, bezZaliha, izmjena.zadrzaneStareCijene);
    data.stavke.forEach((stavka, i) => {
      insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.zavisniTroskovi ?? 0, stavka.pdvStopa, stareCijene[i]);
    });
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    zaliha.knjizi(db, { vrsta: 'primka', id: data.id }, 'ulaz', data.stavke, { datum: datumKretanjaPrimke(datum) });

    auditCijenaPrimke(prije, 'primka:izmjena', data.id);

    return { id: data.id, nivelacijaCreated: promjene.length > 0 };
  }

  /** Rust `obrisi_primku`. */
  function obrisiPrimku(id: number) {
    const primka = db.prepare('SELECT brojPrimke FROM primke WHERE id = ?').get(id) as { brojPrimke: string } | undefined;
    if (!primka) return;

    // Vrati cijene koje je ova primka promijenila (historija, stari put iz
    // nivelacije, zapamćene cijene artikala bez zalihe — isto pravilo kao
    // primka:update).
    const prije = cijeneArtikala(db, artikliPrimke(db, id));
    revertPrimkaPrices(db, id);

    db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(id);
    zaliha.ponisti(db, { vrsta: 'primka', id });

    // Nivelacije primke su dokumenti po kojima se prodavalo i ostaju. Vraćena
    // cijena u prodaji se dokumentuje protunivelacijom s današnjim datumom,
    // na zalihi POSLIJE uklanjanja ulaza: poništena primka robu nije ni
    // unijela, a cijena se mijenja na robi koja ostaje u prodavnici (isto
    // kao pri unosu primke, gdje nivelacija ide na zalihu prije ulaza).
    const vracene = promjeneUProdaji(db, prije);
    const nivelacijePrimke = db.prepare('SELECT id, napomena FROM nivelacije WHERE primkaId = ? ORDER BY id').all(id) as Array<{ id: number; napomena: string | null }>;
    const ponistene = new Set(brojeviNivelacijaPrimke(db, id, vracene.map(c => c.productId)));
    const brojProtu = upisiNivelaciju(db, null, vracene, napomenaProtunivelacije(`Poništenje primke ${primka.brojPrimke}`, [...ponistene]));

    // Veza na primku (FK) se prekida, a trag ostaje u napomeni.
    const odvoji = db.prepare('UPDATE nivelacije SET primkaId = NULL, napomena = ? WHERE id = ?');
    const brojNiv = db.prepare('SELECT brojNivelacije FROM nivelacije WHERE id = ?');
    for (const n of nivelacijePrimke) {
      const broj = (brojNiv.get(n.id) as { brojNivelacije: string }).brojNivelacije;
      const trag = `Primka ${primka.brojPrimke} obrisana` + (brojProtu && ponistene.has(broj) ? `; cijena vraćena nivelacijom ${brojProtu}` : '');
      odvoji.run(n.napomena ? `${n.napomena}; ${trag}` : trag, n.id);
    }

    db.prepare('DELETE FROM primke WHERE id = ?').run(id);
    auditCijenaPrimke(prije, 'primka:brisanje', id);
  }

  /**
   * Pokrene operaciju u transakciji i pročita šta je napravila s cijenama
   * (nivelacije i promjene cijena, vidi rezultatPregleda). `zadrzi` nad tim
   * pregledom odluči: true → transakcija se potvrdi; false → rollback, u bazi
   * ne ostaje ništa — ni dokumenti, ni historija, ni zaliha, ni brojači
   * (sqlite_sequence, broj nivelacije). Greška operacije (validacija) ide
   * pozivaocu kao i bez pregleda. `primkaId` (izmjena, brisanje): pregled
   * nosi i upozorenja za zalihu njenih artikala. Rust `s_pregledom`.
   */
  function sPregledom<T>(
    operacija: () => T,
    cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'],
    zadrzi: (pregled: PregledCijenaUlaza) => boolean,
    primkaId?: number,
  ): { pregled: PregledCijenaUlaza; upisano: true; rezultat: T } | { pregled: PregledCijenaUlaza; upisano: false } {
    const PONISTI = new Error('pregled: poništi');
    let ishod: ReturnType<typeof sPregledom<T>> | undefined;
    try {
      transaction(() => {
        const pocetak = pocetakPregleda(db, primkaId);
        const ostaje = cijenaOstaje();
        const rezultat = operacija();
        const pregled = rezultatPregleda(db, pocetak, ostaje);
        if (zadrzi(pregled)) { ishod = { pregled, upisano: true, rezultat }; return; }
        ishod = { pregled, upisano: false };
        throw PONISTI;
      })();
    } catch (e) {
      if (e !== PONISTI) throw e;
    }
    return ishod!;
  }

  const bezCijenaKojeOstaju = () => [];
  /** Rust `ostaju_pri_izmjeni`. */
  const ostajuPriIzmjeni = (data: PrimkaUnos & { id: number }) => () => cijeneKojeOstaju(db, data.id, data.stavke ?? []);

  /**
   * Spremanje/brisanje ulaza. Ekran šalje pregled koji je korisnik potvrdio;
   * operacija se izvrši i u ISTOJ transakciji uporedi s njim (istiPregled). Ako
   * se stanje u međuvremenu promijenilo (prodaja, druga primka, ručna cijena,
   * ponoć, tuđa nivelacija uzela broj), ništa se ne upisuje i vraća se
   * { promijenjeno: true, pregled } s novim pregledom za ponovnu potvrdu.
   * Bez potvrde (stari klijent, skripta) operacija se izvrši bez poređenja.
   * Rust `spremi_potvrdjeno`.
   */
  function spremiPotvrdjeno<T>(operacija: () => T, cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'], potvrda: unknown, primkaId?: number): T | PromijenjenoOdPregleda {
    if (potvrda === undefined || potvrda === null) return transaction(operacija)();
    const ishod = sPregledom(operacija, cijenaOstaje, pregled => istiPregled(potvrda, pregled), primkaId);
    return ishod.upisano ? ishod.rezultat : { promijenjeno: true, pregled: ishod.pregled };
  }

  // Pregled promjena cijena prije spremanja/brisanja — ista operacija, uvijek
  // poništena; ništa ne upisuje, pa nije u licencnoj blokadi. Rust `bez_upisa`.
  const bezUpisa = (operacija: () => unknown, cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'] = bezCijenaKojeOstaju, primkaId?: number) =>
    sPregledom(operacija, cijenaOstaje, () => false, primkaId).pregled;

  return {
    unesi: (data, potvrda) => spremiPotvrdjeno(() => unesiPrimku(data), bezCijenaKojeOstaju, potvrda),
    izmijeni: (data, potvrda) => spremiPotvrdjeno(() => izmijeniPrimku(data), ostajuPriIzmjeni(data), potvrda, data.id),
    // Uspjeh bez povratne vrijednosti (kao i prije); samo odbijanje nosi pregled.
    obrisi: (id, potvrda) => {
      const r = spremiPotvrdjeno(() => { obrisiPrimku(id); }, bezCijenaKojeOstaju, potvrda, id);
      return r ?? undefined;
    },
    pregledUnosa: data => bezUpisa(() => unesiPrimku(data)),
    pregledIzmjene: data => bezUpisa(() => izmijeniPrimku(data), ostajuPriIzmjeni(data), data.id),
    pregledBrisanja: id => bezUpisa(() => obrisiPrimku(id), bezCijenaKojeOstaju, id),
  };
}
