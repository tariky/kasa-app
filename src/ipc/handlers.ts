import { ipcMain, dialog, app } from 'electron';
import { writeFileSync } from 'fs';
import path from 'node:path';
import { getDb, closeDb } from '../database/db';
import { validateBackup, swapInBackup, samostalnaKopija, type RestoreDeps } from '../database/restore';
import {
  parseFiskalniBroj, izracunajPraznine, zadnjiFiskalniBroj,
  zadnjiUpisaniFiskalniBroj, postaviZadnjiFiskalniBroj, predvidjeniFiskalniBroj,
} from '../lib/fiskalni';
import { round2, localDateStr } from '../lib/novac';
import { zapisiPromjeneCijena, isDobavljacUsed, cijenaKasnijeMijenjana } from '../lib/skladiste';
import * as zaliha from '../lib/zaliha';
import { napraviPrimke } from '../lib/primka';
import {
  nextBrojNaloga, createNalog, createNalogIzPonude, nalogZaPonudu, updateNalog, replaceStavke,
  proizvodiPonude, setProizvodiNaloga,
  getNalog, listNalozi, deleteNalog, kalkulacijaNaloga, setStatusNaloga, zavrsiNalog, vratiUIzradu,
  izdajRacunZaNalog, upisiRacunNaloga, getNormativ, saveNormativ, osigurajProdajnuUslugu,
} from '../lib/proizvodnja';
import { refundAndPrint, refundOrderInTransaction } from '../lib/refund';
import { provjeriNacinPlacanjaSnapshota, type VrstaNezavrsenog } from '../lib/pendingRacun';
import { postaviDatumValute } from '../lib/valuta';
import {
  savePrilogStavkeInTransaction, finalizePrilogAndPrint, oznaciPonuduFakturisanom,
  PRILOG_SIFRA, prilogNaziv,
} from '../lib/prilog';
import { saveCart, listSavedCarts, deleteSavedCart } from '../lib/savedCarts';
import { spremiSkicuFakture, listSkiceFaktura, obrisiSkicuFakture } from '../lib/fakturaSkice';
import { validirajPin, validirajUlogu, VEZE_KORISNIKA, hesirajPin, pinZauzet } from '../lib/korisnici';
import {
  nextBrojPonude, createPonuda, updatePonuda, setStatusPonude, deletePonuda, konvertujPonudu,
  upisiKonverzijuPonude,
} from '../lib/ponuda';
import { buildTringRacun } from '../lib/tringRacun';
import { upisiRacun } from '../lib/racun';
import { fiskalizuj } from '../lib/fiskalizacija';
import { pripremiRacun } from '../lib/provjeraRacuna';
import { zapisiAudit } from '../lib/audit';
import { procitajPostavku, procitajGrupu, upisiPostavke } from '../lib/postavke';
import {
  azuriraj, normalizujTip, validirajArtikal, provjeriBrisanjeArtikla, slobodnaStavka, validirajDobavljaca, validirajKupca,
  KOLONE_ARTIKLA, KOLONE_DOBAVLJACA, KOLONE_KUPCA,
} from '../lib/katalog';
import { addCashMovement, retryCashMovement, getTodayMovements, getDrawerState, getLastPologIznos } from '../lib/cash';
import { logoVelicina, ziroRacuniPozicija } from '../lib/firma';
import { dohvatiKnjigovodja } from '../lib/knjigovodja/podaci';
import { procitajTringPostavke, uredjajIzPostavki } from '../lib/fiskalniUredjaj';
import * as Tring from '../services/tring';
import { provjeriKanal, stanjeLicence, aktivirajLicencu } from './licenca';
import { backupInfo, backupSada, backupNakonAktivacije, registrujBackup } from './backup';
import { imeZaCuvanje, dozvoljeniFilteri, dozvoljenaEkstenzija } from './cuvanje';
import { napraviSesiju, TAJNE_POSTAVKE } from './sesija';
import Database from 'better-sqlite3';
import type { Argumenti, Kanal, Rezultat } from './kanali';
import type {
  User, Product, DobavljacSifra, Dobavljac, Kupac, Primka, PrimkaStavka, Nivelacija, NivelacijaStavka,
  Order, OrderItem, PrilogStavka, Ponuda, StavkaPonude,
} from '../types';

// Provjera sesije i uloge prije svakog handlera; postavlja je registerIpcHandlers
// (treba joj baza da pročita trenutnog korisnika).
let provjeriSesiju: (channel: string, args: unknown[]) => void = () => undefined;

/**
 * Odgovor handlera kanala `K` (kanali.ts). "Nema vrijednosti" je `null`, ne
 * `undefined`: Electron IPC prenosi `undefined` kakav jeste, a ugovor i Rust
 * vraćaju `null` (npr. `.get()` bez reda → `?? null`).
 */
type OdgovorHandlera<K extends Kanal> = Rezultat<K>;

function handle<K extends Kanal>(
  channel: K, handler: (...args: Argumenti<K>) => OdgovorHandlera<K> | Promise<OdgovorHandlera<K>>,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      provjeriKanal(channel);
      provjeriSesiju(channel, args);
      // `await` je obavezan: bez njega odbijeni promise async handlera
      // promaši catch ispod i renderer dobije neobrađenu Electron grešku.
      // Argumenti su oni koje je poslao renderer — tip im daje ugovor, provjeru handler.
      return await handler(...(args as Argumenti<K>));
    } catch (error: any) {
      console.error(`[IPC ${channel}]`, error);
      throw new Error(error.message || 'Nepoznata greška');
    }
  });
}

export function registerIpcHandlers(): void {
  // ─── Licenca ───
  handle('licenca:stanje', () => stanjeLicence());
  handle('licenca:aktiviraj', (token: string) => {
    const info = aktivirajLicencu(token);
    backupNakonAktivacije();
    return info;
  });

  // ─── Automatski backup (src/ipc/backup.ts) ───
  registrujBackup();
  handle('backup:info', () => backupInfo());
  handle('backup:sada', () => backupSada());

  const db = getDb();

  const postavka = (key: string): string | null => procitajPostavku(db, key);

  // ─── Sesija i korisnici ──────────────────────────────────
  // Prijava, PIN-ovi, blokada pokušaja i pravila pristupa: napraviSesiju (sesija.ts).

  const sesija = napraviSesiju(db);
  const { korisnik } = sesija;
  provjeriSesiju = (channel, args) => sesija.provjeriPristup(channel, args);

  /** Trag radnje u audit_log, s prijavljenim korisnikom (lib/audit.ts). */
  const audit = (akcija: string, detalji: Record<string, unknown>) => zapisiAudit(db, sesija.prijavljeniId(), akcija, detalji);

  handle('user:login', (pin: string) => sesija.prijavi(pin));

  handle('user:logout', () => {
    sesija.odjavi();
    return { success: true };
  });

  // Prijavljeni korisnik mijenja svoj PIN (obavezno nakon prijave sa zadanim 0000).
  handle('user:promijeniSvojPin', (stari: string, novi: string) => {
    sesija.promijeniSvojPin(stari, novi);
    return { success: true };
  });

  handle('user:getAll', () => {
    return db.prepare('SELECT id, ime, uloga FROM users ORDER BY ime').all() as User[];
  });

  // Admin koji je jedini admin u bazi — ne smije se obrisati ni degradirati.
  const jePosljednjiAdmin = (id: number): boolean => {
    const u = db.prepare('SELECT uloga FROM users WHERE id = ?').get(id) as { uloga: string } | undefined;
    if (u?.uloga !== 'admin') return false;
    return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE uloga = 'admin'").get() as { n: number }).n <= 1;
  };

  handle('user:create', (data) => {
    if (!data.ime?.trim()) throw new Error('Ime korisnika je obavezno');
    validirajPin(data.pin);
    validirajUlogu(data.uloga);
    if (pinZauzet(db, data.pin)) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
    return db.transaction(() => {
      const result = db
        .prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)')
        .run(data.ime.trim(), hesirajPin(data.pin), data.uloga);
      audit('korisnik:create', { id: Number(result.lastInsertRowid), ime: data.ime.trim(), uloga: data.uloga });
      return { id: Number(result.lastInsertRowid) };
    })();
  });

  handle('user:update', (id, data) => {
    const polja: { ime?: string; pin?: string; uloga?: string } = {};
    // Audit: nova imena i uloga, a za PIN samo da je promijenjen.
    const trag: Record<string, unknown> = { id };

    if (data.ime !== undefined) {
      if (!data.ime.trim()) throw new Error('Ime korisnika je obavezno');
      polja.ime = trag.ime = data.ime.trim();
    }
    // Prazan PIN = PIN ostaje kakav je (UI ga više ne zna, pa ga ne može ni poslati).
    if (data.pin != null && data.pin !== '') {
      validirajPin(data.pin);
      if (pinZauzet(db, data.pin, id)) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
      polja.pin = hesirajPin(data.pin);
    }
    if (data.uloga !== undefined) {
      const uloga = validirajUlogu(data.uloga);
      if (uloga !== 'admin' && jePosljednjiAdmin(id)) throw new Error('Posljednji administrator ne može postati kasir');
      polja.uloga = trag.uloga = uloga;
    }
    trag.pinPromijenjen = polja.pin !== undefined;

    return db.transaction(() => {
      const result = azuriraj(db, 'users', id, polja, ['ime', 'pin', 'uloga']);
      if (result.changes > 0) audit('korisnik:update', trag);
      return result;
    })();
  });

  handle('user:delete', (id: number) => {
    for (const { tabela, poruka } of VEZE_KORISNIKA) {
      if (db.prepare(`SELECT 1 FROM ${tabela} WHERE korisnikId = ? LIMIT 1`).get(id)) throw new Error(poruka);
    }
    if (jePosljednjiAdmin(id)) throw new Error('Posljednji administrator ne može biti obrisan');
    return db.transaction(() => {
      const u = db.prepare('SELECT ime, uloga FROM users WHERE id = ?').get(id) as { ime: string; uloga: string } | undefined;
      const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
      if (result.changes > 0 && u) audit('korisnik:delete', { id, ime: u.ime, uloga: u.uloga });
      return { changes: result.changes };
    })();
  });

  // ─── Products ────────────────────────────────────────────

  // Šifre dobavljača artikla u jednom stringu — za pretragu u šifarniku, primci i kasi.
  const SIFRE_DOBAVLJACA = `(SELECT GROUP_CONCAT(ds.sifra, ' ') FROM artikal_dobavljac_sifre ds
            WHERE ds.productId = p.id AND ds.sifra IS NOT NULL) AS sifreDobavljaca`;

  handle('product:getAll', (tip?: string) => {
    const where = tip ? 'WHERE p.slobodan = 0 AND p.tip = ?' : 'WHERE p.slobodan = 0';
    return db
      .prepare(`
        SELECT p.*,
          ${zaliha.STANJE_SQL} AS stanje,
          ${SIFRE_DOBAVLJACA}
        FROM products p
        ${where}
        ORDER BY p.naziv
      `)
      .all(...(tip ? [normalizujTip(tip)] : [])) as Product[];
  });

  handle('product:get', (id: number) => {
    return (db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined) ?? null;
  });

  // Pravila šifarnika (validacija, brisanje, slobodna stavka): lib/katalog.ts.

  handle('product:create', (data) => {
    const upis = validirajArtikal(db, data, null);
    const tip = normalizujTip(data.tip);
    const result = db
      .prepare(`
        INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip, plocaSirina, plocaVisina)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(upis.sifra, upis.naziv, data.jm ?? (tip === 'usluga' ? 'usl' : 'kom'), data.cijena, data.pdvStopa,
        upis.plu ?? null, upis.barkod ?? null, tip, data.plocaSirina ?? null, data.plocaVisina ?? null);
    return { id: Number(result.lastInsertRowid) };
  });

  handle('product:update', (id, data) => {
    const polja = {
      ...data,
      ...validirajArtikal(db, data, id),
      tip: data.tip !== undefined ? normalizujTip(data.tip) : undefined,
      // Dimenzije ploče se mijenjaju kad je ključ poslan (bez vrijednosti = null).
      plocaSirina: 'plocaSirina' in data ? data.plocaSirina ?? null : undefined,
      plocaVisina: 'plocaVisina' in data ? data.plocaVisina ?? null : undefined,
    };

    return db.transaction(() => {
      const prije = db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number } | undefined;
      const result = azuriraj(db, 'products', id, polja, KOLONE_ARTIKLA, { uzIzmjenu: "updatedAt = datetime('now','localtime')" });
      // Ručna izmjena cijene ulazi u historiju: poništavanje ranije primke je ne smije pregaziti.
      if (prije && data.cijena !== undefined && data.cijena !== prije.cijena) {
        zapisiPromjeneCijena(db, 'rucno', null, [{ productId: id, staraCijena: prije.cijena, novaCijena: data.cijena }]);
        audit('artikal:cijena', { productId: id, staraCijena: prije.cijena, novaCijena: data.cijena, izvor: 'rucno' });
      }
      return result;
    })();
  });

  handle('product:delete', (id: number) => {
    provjeriBrisanjeArtikla(db, id);
    // Historija cijena artikla bez primki ima samo ručne izmjene, a šifre dobavljača su
    // samo šifarnik — obje idu s artiklom.
    return db.transaction(() => {
      db.prepare('DELETE FROM cijena_historija WHERE productId = ?').run(id);
      db.prepare('DELETE FROM artikal_dobavljac_sifre WHERE productId = ?').run(id);
      const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
      return { changes: result.changes };
    })();
  });

  handle('product:adjustStock', (productId: number, newStanje: number) => {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new Error('Artikal ne postoji');
    if (typeof newStanje !== 'number' || !Number.isFinite(newStanje)) throw new Error('Stanje mora biti broj');
    const staroStanje = zaliha.stanje(db, productId);
    const diff = newStanje - staroStanje;
    // Ostatak zaokruživanja (0,1 + 0,2 − 0,3) nije korekcija.
    if (Math.abs(diff) < zaliha.TOLERANCIJA_ZALIHE) return { changes: 0 };

    db.transaction(() => {
      zaliha.knjizi(db, { vrsta: 'adjustment', id: 0 }, diff > 0 ? 'ulaz' : 'izlaz', [{ productId, kolicina: Math.abs(diff) }]);
      audit('zaliha:korekcija', { productId, staroStanje, novoStanje: newStanje });
    })();

    return { changes: 1 };
  });

  // ─── Šifre dobavljača ───────────────────────────────────

  handle('product:getDobavljacSifre', (productId: number) => {
    return db.prepare(`
      SELECT ds.dobavljacId, d.naziv AS dobavljacNaziv, ds.sifra
      FROM artikal_dobavljac_sifre ds JOIN dobavljaci d ON d.id = ds.dobavljacId
      WHERE ds.productId = ?
      ORDER BY d.naziv, ds.dobavljacId
    `).all(productId) as DobavljacSifra[];
  });

  // Zamjenjuje sve šifre dobavljača artikla. Prazna šifra = artikal je vezan za
  // dobavljača bez šifre. Sve se provjeri prije upisa, pa greška ništa ne mijenja.
  handle('product:setDobavljacSifre', (productId, lista) => {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new Error('Artikal ne postoji');
    const upis: Array<{ dobavljacId: number; sifra: string | null }> = [];
    for (const s of lista ?? []) {
      const dobavljac = db.prepare('SELECT naziv FROM dobavljaci WHERE id = ?').get(s.dobavljacId) as { naziv: string } | undefined;
      if (!dobavljac) throw new Error('Dobavljač ne postoji');
      if (upis.some(u => u.dobavljacId === s.dobavljacId)) throw new Error(`Dobavljač "${dobavljac.naziv}" je naveden više puta`);
      const sifra = s.sifra?.trim() || null;
      if (sifra) {
        const zauzeo = db.prepare(`
          SELECT p.sifra, p.naziv FROM artikal_dobavljac_sifre ds JOIN products p ON p.id = ds.productId
          WHERE ds.dobavljacId = ? AND ds.sifra = ? AND ds.productId != ?
        `).get(s.dobavljacId, sifra, productId) as { sifra: string; naziv: string } | undefined;
        if (zauzeo) throw new Error(`Dobavljač "${dobavljac.naziv}" već ima šifru "${sifra}" na artiklu "${zauzeo.naziv}" (${zauzeo.sifra})`);
      }
      upis.push({ dobavljacId: s.dobavljacId, sifra });
    }
    return db.transaction(() => {
      db.prepare('DELETE FROM artikal_dobavljac_sifre WHERE productId = ?').run(productId);
      const ins = db.prepare('INSERT INTO artikal_dobavljac_sifre (productId, dobavljacId, sifra) VALUES (?, ?, ?)');
      for (const u of upis) ins.run(productId, u.dobavljacId, u.sifra);
      return { changes: upis.length };
    })();
  });

  // Temelj automatskog unosa robe: artikal po tačnoj šifri s dobavljačeve fakture.
  handle('product:findByDobavljacSifra', (dobavljacId: number, sifra: string) => {
    const s = sifra?.trim();
    if (!s) return null;
    return (db.prepare(`
      SELECT p.*, ${zaliha.STANJE_SQL} AS stanje
      FROM artikal_dobavljac_sifre ds JOIN products p ON p.id = ds.productId
      WHERE ds.dobavljacId = ? AND ds.sifra = ?
    `).get(dobavljacId, s) as Product | undefined) ?? null;
  });

  handle('dobavljac:getSifre', (dobavljacId: number) => {
    return db.prepare(
      'SELECT productId, sifra FROM artikal_dobavljac_sifre WHERE dobavljacId = ? AND sifra IS NOT NULL ORDER BY sifra'
    ).all(dobavljacId) as Array<{ productId: number; sifra: string }>;
  });

  // Slobodna stavka na kasi: skriveni artikal po nazivu, stopi i JM (lib/katalog.ts).
  handle('product:slobodan', (data) => db.transaction(() => slobodnaStavka(db, data, audit))());

  // ─── Dobavljači ─────────────────────────────────────────

  handle('dobavljac:getAll', () => {
    return db.prepare('SELECT * FROM dobavljaci ORDER BY naziv').all() as Dobavljac[];
  });

  handle('dobavljac:create', (data) => {
    const upis = validirajDobavljaca(data, null);
    const result = db
      .prepare('INSERT INTO dobavljaci (naziv, idBroj, pdvBroj, adresa, kontakt) VALUES (?, ?, ?, ?, ?)')
      .run(upis.naziv, data.idBroj ?? null, data.pdvBroj ?? null, data.adresa ?? null, data.kontakt ?? null);
    return { id: Number(result.lastInsertRowid) };
  });

  handle('dobavljac:update', (id, data) => {
    return azuriraj(db, 'dobavljaci', id, { ...data, ...validirajDobavljaca(data, id) }, KOLONE_DOBAVLJACA);
  });

  handle('dobavljac:delete', (id: number) => {
    const dobavljac = db
      .prepare('SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = ?')
      .get(id) as { naziv: string; idBroj: string | null; pdvBroj: string | null } | undefined;
    if (!dobavljac) return { changes: 0 };

    if (isDobavljacUsed(db, dobavljac)) {
      throw new Error('Dobavljač se koristi u primkama i ne može biti obrisan');
    }
    if (db.prepare('SELECT 1 FROM artikal_dobavljac_sifre WHERE dobavljacId = ? LIMIT 1').get(id)) {
      throw new Error('Dobavljač je vezan za artikle i ne može biti obrisan');
    }
    const result = db.prepare('DELETE FROM dobavljaci WHERE id = ?').run(id);
    return { changes: result.changes };
  });

  // ─── Kupci ──────────────────────────────────────────────

  handle('kupac:getAll', () => {
    return db.prepare('SELECT * FROM kupci ORDER BY naziv').all() as Kupac[];
  });

  handle('kupac:create', (data) => {
    const upis = validirajKupca(db, data, null);
    const result = db
      .prepare('INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt, rokPlacanjaDana, nacinPlacanja, rabat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(upis.naziv, upis.idBroj, data.pdvBroj ?? null, data.adresa ?? null, data.postanskiBroj ?? null, data.grad ?? null, data.kontakt ?? null,
        upis.rokPlacanjaDana ?? null, upis.nacinPlacanja ?? null, upis.rabat ?? null);
    return { id: Number(result.lastInsertRowid) };
  });

  handle('kupac:update', (id, data) => {
    return azuriraj(db, 'kupci', id, { ...data, ...validirajKupca(db, data, id) }, KOLONE_KUPCA);
  });

  handle('kupac:delete', (id: number) => {
    const kupac = db.prepare('SELECT idBroj FROM kupci WHERE id = ?').get(id) as { idBroj: string } | undefined;
    if (kupac) {
      const inOrders = db.prepare('SELECT id FROM orders WHERE kupacIdBroj = ? LIMIT 1').get(kupac.idBroj);
      if (inOrders) throw new Error('Kupac se koristi u računima i ne može biti obrisan');
    }
    if (db.prepare('SELECT 1 FROM ponude WHERE kupacId = ? LIMIT 1').get(id)) {
      throw new Error('Kupac se koristi u ponudama i ne može biti obrisan');
    }
    if (db.prepare('SELECT 1 FROM radni_nalozi WHERE kupacId = ? LIMIT 1').get(id)) {
      throw new Error('Kupac se koristi u radnim nalozima i ne može biti obrisan');
    }
    const result = db.prepare('DELETE FROM kupci WHERE id = ?').run(id);
    return { changes: result.changes };
  });

  // ─── Primke ──────────────────────────────────────────────

  handle('primka:getAll', () => {
    return db.prepare('SELECT * FROM primke ORDER BY datum DESC').all() as Primka[];
  });

  handle('primka:get', (id: number) => {
    const primka = db.prepare('SELECT * FROM primke WHERE id = ?').get(id) as Primka | undefined;
    if (!primka) throw new Error('Primka ne postoji');

    const stavke = db
      .prepare(`
        SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra
        FROM primka_stavke ps
        LEFT JOIN products p ON p.id = ps.productId
        WHERE ps.primkaId = ?
      `)
      .all(id) as PrimkaStavka[];
    primka.stavke = stavke;
    // Stavke čiju je cijenu poslije ove primke mijenjalo nešto drugo: izmjena
    // njihove cijene na primci ne mijenja cijenu u prodaji (ekran to prikazuje).
    for (const s of stavke) s.cijenaKasnijeMijenjana = cijenaKasnijeMijenjana(db, id, s.productId);

    return primka;
  });

  handle('primka:nextBroj', () => {
    const year = new Date().getFullYear();
    const prefix = `U-${year}-`;
    const row = db.prepare(
      "SELECT MAX(CAST(SUBSTR(brojPrimke, ?) AS INTEGER)) AS maxNum FROM primke WHERE brojPrimke LIKE ?"
    ).get(prefix.length + 1, `${prefix}%`) as { maxNum: number | null } | undefined;
    const next = (row?.maxNum ?? 0) + 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  });

  // Unos, izmjena i brisanje primke s pregledom promjena cijena — lib/primka.ts
  // (transakcije i poništavanje pregleda su u modulu; Rust skladiste.rs).
  const primke = napraviPrimke({ db, audit, transaction: fn => db.transaction(fn) });

  handle('primka:create', (data, potvrda) => primke.unesi(data, potvrda));
  handle('primka:update', (data, potvrda) => primke.izmijeni(data, potvrda));
  handle('primka:delete', (id, potvrda) => primke.obrisi(id, potvrda) ?? null);
  // Pregled ništa ne upisuje, pa nije u licencnoj blokadi.
  handle('primka:pregledUnosa', data => primke.pregledUnosa(data));
  handle('primka:pregledIzmjene', data => primke.pregledIzmjene(data));
  handle('primka:pregledBrisanja', id => primke.pregledBrisanja(id));

  // ─── Nivelacije ──────────────────────────────────────────

  handle('nivelacija:getAll', (from?: string, to?: string) => {
    if (from && to) {
      return db.prepare(`
        SELECT n.*,
          p.brojPrimke AS primkaBroj,
          (SELECT COUNT(*) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS stavkiCount,
          (SELECT COALESCE(SUM(ns.ukupnaRazlika), 0) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS ukupnaRazlika
        FROM nivelacije n
        LEFT JOIN primke p ON p.id = n.primkaId
        WHERE date(n.datum) BETWEEN date(?) AND date(?)
        ORDER BY n.datum DESC
      `).all(from, to) as Nivelacija[];
    }
    return db.prepare(`
      SELECT n.*,
        p.brojPrimke AS primkaBroj,
        (SELECT COUNT(*) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS stavkiCount,
        (SELECT COALESCE(SUM(ns.ukupnaRazlika), 0) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS ukupnaRazlika
      FROM nivelacije n
      LEFT JOIN primke p ON p.id = n.primkaId
      ORDER BY n.datum DESC
    `).all() as Nivelacija[];
  });

  handle('nivelacija:get', (id: number) => {
    const niv = db.prepare(`
      SELECT n.*, p.brojPrimke AS primkaBroj
      FROM nivelacije n
      LEFT JOIN primke p ON p.id = n.primkaId
      WHERE n.id = ?
    `).get(id) as Nivelacija | undefined;
    if (!niv) throw new Error('Nivelacija ne postoji');

    niv.stavke = db.prepare(`
      SELECT ns.*, p.naziv AS productNaziv, p.sifra AS productSifra, p.jm AS productJm
      FROM nivelacija_stavke ns
      LEFT JOIN products p ON p.id = ns.productId
      WHERE ns.nivelacijaId = ?
    `).all(id) as NivelacijaStavka[];

    return niv;
  });

  // Fiskalni uređaj s postavkama iz baze — pravi se na početku svakog poziva, prije
  // write-ahead reda (nečitljive postavke tada ne ostavljaju nezavršen račun).
  // Dnevnik zahtjeva vodi services/tring.
  const uredjaj = () => uredjajIzPostavki(db);
  const transakcija = <T>(fn: () => T) => db.transaction(fn);

  // ─── Orders ──────────────────────────────────────────────

  handle('order:getAll', () => {
    return db
      .prepare(`
        SELECT o.*, u.ime AS korisnikIme, k.pdvBroj AS kupacPdvBroj
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
        LEFT JOIN kupci k ON k.idBroj = o.kupacIdBroj
        ORDER BY o.createdAt DESC
      `)
      .all() as Order[];
  });

  handle('order:get', (id: number) => {
    const order = db
      .prepare(`
        SELECT o.*, u.ime AS korisnikIme, k.pdvBroj AS kupacPdvBroj
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
        LEFT JOIN kupci k ON k.idBroj = o.kupacIdBroj
        WHERE o.id = ?
      `)
      .get(id) as Order | undefined;

    if (!order) throw new Error('Račun ne postoji');

    order.stavke = db
      .prepare(`
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?
      `)
      .all(id) as OrderItem[];

    // Prilog račun nema order_items — prikaz i kopija računa dobiju zbirnu stavku.
    if (order.prilogBroj != null) {
      order.stavke = [{
        id: 0, orderId: order.id, productId: 0, kolicina: 1, cijena: order.ukupno, rabat: 0,
        pdvStopa: 'E', productNaziv: order.prilogNaziv || prilogNaziv(order.prilogBroj),
        productJm: 'kom', productSifra: PRILOG_SIFRA, productPlu: 0,
      }];
    }

    return order;
  });

  // Račun izdat mimo programa (npr. dok program nije radio), upisan naknadno.
  // Stavke, iznosi i plaćanje se provjeravaju kao na kasi (pripremiRacun), ali
  // stopa i cijena stavke smiju odstupati od današnjeg artikla — prepisuje se
  // stari isječak.
  handle('order:createManual', (unos) => {
    const korisnikId = korisnik().id;
    const r = pripremiRacun(db, unos, { stopaArtikla: false });
    const broj = typeof unos.brojFiskalnogRacuna === 'string' ? unos.brojFiskalnogRacuna.trim() : '';
    if (!broj) throw new Error('Fiskalni broj je obavezan');
    const createdAt = typeof unos.createdAt === 'string' ? unos.createdAt : '';
    if (!createdAt.trim()) throw new Error('Datum računa je obavezan');

    const existing = db.prepare('SELECT id FROM orders WHERE brojFiskalnogRacuna = ?').get(broj);
    if (existing) throw new Error('Fiskalni račun sa tim brojem već postoji');

    return db.transaction(() => {
      const id = upisiRacun(db, {
        korisnikId, ukupno: r.ukupno, pdvIznos: r.pdvIznos, nacinPlacanja: r.nacinPlacanja,
        brojFiskalnogRacuna: broj, kupac: r.kupac, stavke: r.stavke, isManual: 1, createdAt,
      });
      audit('racun:rucni', { orderId: id, brojFiskalnogRacuna: broj, ukupno: r.ukupno, createdAt });
      return { id };
    })();
  });

  handle('order:finalize', async (unos: unknown) => {
    // Račun izdaje prijavljeni korisnik — korisnikId iz payload-a se ne čita.
    const korisnikId = korisnik().id;
    // Sve provjere prije write-ahead zapisa i štampe; iznosi se računaju iz stavki.
    const r = pripremiRacun(db, unos, { stopaArtikla: true });
    const data = {
      korisnikId, ukupno: r.ukupno, pdvIznos: r.pdvIznos,
      nacinPlacanja: r.nacinPlacanja, vrstePlacanja: r.vrstePlacanja,
      kupac: r.kupac, napomena: r.napomena,
      // Uređaj dobija šifru, naziv, JM i PLU artikla iz baze, ne iz payload-a.
      stavke: r.stavke.map(s => ({
        productId: s.productId, sifra: s.artikal.sifra, naziv: s.artikal.naziv, jm: s.artikal.jm ?? 'kom',
        plu: s.artikal.plu ?? 0, cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.pdvStopa,
      })),
    };

    // Postavke uređaja i račun za uređaj prije write-ahead reda (lib/fiskalizacija.ts).
    const u = uredjaj();
    const racun = buildTringRacun({ ...data, items: data.stavke });
    return fiskalizuj({ db, transaction: transakcija }, {
      snapshot: data,
      stampaj: () => u.stampajRacun(racun),
      upisi: bf => upisiRacun(db, { ...data, brojFiskalnogRacuna: bf, isManual: 0 }),
    });
  });

  // Račun po prilogu: jedna zbirna stavka na fiskalnom računu, stvarne stavke
  // se dodjeljuju naknadno. Orkestracija živi u lib/prilog.ts (testabilna).
  handle('order:finalizePrilog', async (unos) => {
    const data = { ...unos, korisnikId: korisnik().id };
    return finalizePrilogAndPrint({ db, uredjaj: uredjaj(), transaction: transakcija }, data);
  });

  // Fiskalni niz: račun po prilogu mora znati broj isječka prije nego ga odštampa.
  handle('fiscal:getNumeracija', () => ({
    zadnjiUBazi: zadnjiFiskalniBroj(db),
    zadnjiUpisani: zadnjiUpisaniFiskalniBroj(db),
    predvidjeni: predvidjeniFiskalniBroj(db),
  }));

  handle('fiscal:setZadnjiBroj', (broj: number) => {
    db.transaction(() => {
      const stariBroj = zadnjiUpisaniFiskalniBroj(db);
      postaviZadnjiFiskalniBroj(db, broj);
      audit('fiskalni:zadnjiBroj', { stariBroj, noviBroj: broj });
    })();
    return { success: true, predvidjeni: predvidjeniFiskalniBroj(db) };
  });

  handle('prilog:getStavke', (orderId: number) => {
    return db.prepare(`
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.tip AS productTip
      FROM prilog_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.orderId = ?
      ORDER BY ps.id
    `).all(orderId) as PrilogStavka[];
  });

  handle('prilog:saveStavke', (orderId, stavke) => {
    db.transaction(() => savePrilogStavkeInTransaction(db, orderId, stavke))();
    return { success: true };
  });

  handle('order:setDatumValute', (id: number, datum: string | null) => {
    return { datumValute: postaviDatumValute(db, id, datum) };
  });

  // Orkestracija (štampa → atomični upis) živi u lib/refund.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('order:refundAndPrint', async (data) => {
    const k = korisnik();
    // Admin PIN (kasa.requirePinRefund) je provjeren prije handlera, u sesiji;
    // odobrenje koje je tada trebalo, a ovdje ga nema, baca (fail-closed).
    const odobrioAdminId = sesija.odobrioAdmin(data);
    const original = db.prepare('SELECT brojFiskalnogRacuna, ukupno FROM orders WHERE id = ?').get(data?.id) as
      { brojFiskalnogRacuna: string | null; ukupno: number } | undefined;
    const u = uredjaj();
    const rezultat = await refundAndPrint({
      db,
      uredjaj: u,
      transaction: transakcija,
      drawerState: () => getDrawerState(db),
      // Override iz UI-ja: manjak se evidentira kao pravi polog (Tring
      // UnosNovca + cash_movements) da uređaj dozvoli gotovinski storno.
      depositCash: async (iznos, napomena) => {
        const res = await addCashMovement({ db, uredjaj: u }, {
          tip: 'polog', iznos, korisnikId: k.id, napomena,
        });
        if (res.tringStatus === 'error') {
          throw new Error(`Polog od ${iznos} KM nije prihvaćen na printeru: ${res.error ?? 'nepoznata greška'}`);
        }
      },
      // Pokriće koje fizički ne ulazi u ladicu — samo brojač uređaja.
      deviceCashIn: async (iznos) => {
        const res = await u.unosNovca(iznos);
        if (!res.ok) throw new Error(`Unos novca od ${iznos} KM nije prihvaćen na printeru: ${res.greska}`);
      },
    }, { ...data, korisnikId: k.id, odobrioAdminId });
    if (rezultat.success) {
      // Storno je već odštampan i upisan — greška traga ne smije to sakriti.
      // Korisnik je onaj s početka poziva: dok se čekala štampa, neko se mogao
      // odjaviti ili prijaviti drugi korisnik.
      try {
        zapisiAudit(db, k.id, 'storno', {
          orderId: data.id, brojFiskalnogRacuna: original?.brojFiskalnogRacuna ?? null,
          brojReklamacije: rezultat.brojReklamacije ?? null, ukupno: original?.ukupno ?? null,
          odobrioAdminId, pologIznos: rezultat.pologIznos ?? 0,
        });
      } catch (e) {
        console.error('[audit] storno', e);
      }
    }
    return rezultat;
  });

  handle('pending:list', () => {
    const rows = db
      .prepare('SELECT id, korisnikId, snapshot, createdAt FROM pending_receipts ORDER BY id')
      .all() as Array<{ id: number; korisnikId: number; snapshot: string; createdAt: string }>;
    return rows.map(r => ({
      id: r.id, korisnikId: r.korisnikId, createdAt: r.createdAt, snapshot: JSON.parse(r.snapshot),
    }));
  });

  handle('pending:resolve', (data) => {
    if (!data.brojFiskalnogRacuna?.trim()) throw new Error('Fiskalni broj je obavezan');
    if (!data.createdAt?.trim()) throw new Error('Datum računa je obavezan');

    const row = db.prepare('SELECT snapshot FROM pending_receipts WHERE id = ?').get(data.id) as { snapshot: string } | undefined;
    if (!row) throw new Error('Zapis više ne postoji');
    const snap = JSON.parse(row.snapshot);
    const broj = data.brojFiskalnogRacuna.trim();
    // `vrsta: null` = bez vrste (običan račun), kao u Rust-u.
    const vrsta: VrstaNezavrsenog | undefined = snap.vrsta ?? undefined;
    if (vrsta !== undefined && !['ponuda', 'nalog', 'storno'].includes(vrsta)) {
      throw new Error(`Nepoznata vrsta nezavršenog zapisa: "${vrsta}"`);
    }
    // Račun (ne storno) upisuje način plaćanja iz snapshota — samo oblik koji ladica zna.
    if (vrsta !== 'storno') provjeriNacinPlacanjaSnapshota(snap.nacinPlacanja);

    // Storno nosi broj reklamacije — drugi niz, ne broj računa.
    if (vrsta !== 'storno') {
      const existing = db.prepare('SELECT id FROM orders WHERE brojFiskalnogRacuna = ?').get(broj);
      if (existing) throw new Error('Fiskalni račun sa tim brojem već postoji');
    }

    const resolveTx = db.transaction(() => {
      let orderId: number;
      // Odštampan dokument upisuje se istom operacijom kao nakon uspješne štampe,
      // s brojem i datumom s papira (ručni račun).
      if (vrsta === 'ponuda') {
        orderId = upisiKonverzijuPonude(db, snap, { brojFiskalnogRacuna: broj, createdAt: data.createdAt, isManual: 1 });
      } else if (vrsta === 'nalog') {
        orderId = upisiRacunNaloga(db, snap, { brojFiskalnogRacuna: broj, createdAt: data.createdAt, isManual: 1 });
      } else if (vrsta === 'storno') {
        orderId = snap.orderId;
        refundOrderInTransaction(db, orderId, broj, data.createdAt);
        // Jedini trag 'storno' za ovaj storno (nepoznat ishod ga nije upisao):
        // isti oblik kao order:refundAndPrint, pod pokretačem, uz ko je red riješio.
        zapisiAudit(db, snap.korisnikId ?? null, 'storno', {
          orderId, brojFiskalnogRacuna: snap.brojRacuna ?? null, brojReklamacije: broj, ukupno: snap.ukupno ?? null,
          odobrioAdminId: snap.odobrioAdminId ?? null, pologIznos: snap.pologIznos ?? 0,
          pendingId: data.id, rijesioKorisnikId: sesija.prijavljeniId(),
        });
      } else {
        // Snapshot bez vrste: račun sa kase ili faktura (i sve stare baze).
        orderId = upisiRacun(db, {
          ...snap,
          brojFiskalnogRacuna: broj,
          // Prilog račun: broj fakture je BF koji operater ovdje ukuca; rezervni
          // broj iz snapshota ostaje samo kad BF nije numerički.
          prilogBroj: snap.prilogBroj == null
            ? null
            : parseFiskalniBroj(broj) ?? snap.prilogBroj,
          isManual: 1,
          createdAt: data.createdAt,
        });
        // Prilog račun: stvarne stavke žive u snapshotu odvojeno od order_items.
        if (Array.isArray(snap.prilogStavke) && snap.prilogStavke.length > 0) {
          savePrilogStavkeInTransaction(db, orderId, snap.prilogStavke);
        }
        // Faktura iz ponude: ponuda se veže tek kad račun stvarno postoji u bazi.
        if (snap.ponudaId != null) {
          const ponuda = db.prepare('SELECT status FROM ponude WHERE id = ?').get(snap.ponudaId) as { status: string } | undefined;
          if (ponuda && ponuda.status !== 'konvertovana') oznaciPonuduFakturisanom(db, snap.ponudaId, orderId);
        }
        // Faktura iz skice: odštampana faktura se ne smije moći fiskalizovati ponovo.
        if (snap.skicaId != null) db.prepare('DELETE FROM faktura_skice WHERE id = ?').run(snap.skicaId);
      }
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(data.id);
      audit('pending:rijesi', {
        pendingId: data.id, brojFiskalnogRacuna: broj, orderId, ...(vrsta !== undefined ? { vrsta } : {}),
      });
      return orderId;
    });
    return { id: resolveTx() };
  });

  handle('pending:discard', (id: number) => {
    db.transaction(() => {
      const row = db.prepare('SELECT snapshot FROM pending_receipts WHERE id = ?').get(id) as { snapshot: string } | undefined;
      const r = db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(id);
      if (r.changes > 0 && row) {
        let snapshot: unknown = row.snapshot;
        try { snapshot = JSON.parse(row.snapshot); } catch { /* ostaje tekst */ }
        audit('pending:odbaci', { pendingId: id, snapshot });
      }
    })();
    return { success: true };
  });

  handle('order:getFiscalGaps', () => {
    const rows = db
      .prepare('SELECT brojFiskalnogRacuna FROM orders WHERE brojFiskalnogRacuna IS NOT NULL')
      .all() as Array<{ brojFiskalnogRacuna: string }>;
    const brojevi = rows
      .map(r => parseFiskalniBroj(r.brojFiskalnogRacuna))
      .filter((n): n is number => n !== null);
    const dismissedRow = db.prepare("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").get() as { value: string } | undefined;
    const dismissed: number[] = dismissedRow ? JSON.parse(dismissedRow.value) : [];
    // Odbačene praznine se preskaču unutar računa da ne troše ograničenje.
    return izracunajPraznine(brojevi, undefined, new Set(dismissed));
  });

  handle('order:dismissFiscalGap', (broj: number) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").get() as { value: string } | undefined;
    const dismissed: number[] = row ? JSON.parse(row.value) : [];
    if (dismissed.includes(broj)) return { success: true };
    dismissed.push(broj);
    db.transaction(() => {
      upisiPostavke(db, [['fiscal.dismissedGaps', JSON.stringify(dismissed)]]);
      audit('fiskalni:odbaciPrazninu', { broj });
    })();
    return { success: true };
  });

  // ─── Ponude ──────────────────────────────────────────────

  handle('ponuda:getAll', () => {
    return db.prepare(`
      SELECT po.*, k.naziv AS kupacNaziv, u.ime AS korisnikIme,
        o.brojFiskalnogRacuna AS racunBroj
      FROM ponude po
      LEFT JOIN kupci k ON k.id = po.kupacId
      LEFT JOIN users u ON u.id = po.korisnikId
      LEFT JOIN orders o ON o.id = po.racunId
      ORDER BY po.godina DESC, po.broj DESC
    `).all() as Ponuda[];
  });

  handle('ponuda:get', (id: number) => {
    const ponuda = db.prepare(`
      SELECT po.*, u.ime AS korisnikIme, o.brojFiskalnogRacuna AS racunBroj,
        k.naziv AS kupacNaziv, k.idBroj AS kupacIdBroj, k.pdvBroj AS kupacPdvBroj,
        k.adresa AS kupacAdresa, k.grad AS kupacGrad, k.postanskiBroj AS kupacPostanskiBroj
      FROM ponude po
      LEFT JOIN kupci k ON k.id = po.kupacId
      LEFT JOIN users u ON u.id = po.korisnikId
      LEFT JOIN orders o ON o.id = po.racunId
      WHERE po.id = ?
    `).get(id) as Ponuda | undefined;
    if (!ponuda) throw new Error('Ponuda ne postoji');

    ponuda.stavke = db.prepare(`
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
      FROM ponuda_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.ponudaId = ?
    `).all(id) as StavkaPonude[];

    return ponuda;
  });

  handle('ponuda:nextBroj', () => {
    const godina = new Date().getFullYear();
    return { broj: nextBrojPonude(db, godina), godina };
  });

  handle('ponuda:create', (unos) => {
    const data = { ...unos, korisnikId: korisnik().id };
    const tx = db.transaction(() => createPonuda(db, data));
    return tx();
  });

  handle('ponuda:update', (id, data) => {
    const tx = db.transaction(() => updatePonuda(db, id, data));
    tx();
    return { success: true };
  });

  handle('ponuda:setStatus', (id, status) => {
    setStatusPonude(db, id, status);
    return { success: true };
  });

  handle('ponuda:delete', (id: number) => {
    return db.transaction(() => deletePonuda(db, id))();
  });

  // Orkestracija (štampa → atomični upis) živi u lib/ponuda.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('ponuda:konvertuj', async (unos) => {
    const data = { ...unos, korisnikId: korisnik().id };
    return konvertujPonudu({ db, uredjaj: uredjaj(), transaction: transakcija }, data);
  });

  // ─── Proizvodnja ─────────────────────────────────────────

  handle('nalog:getAll', (filter) =>
    listNalozi(db, filter ? { status: filter } : undefined));

  handle('nalog:get', (id: number) => getNalog(db, id));

  handle('nalog:nextBroj', () => {
    const godina = new Date().getFullYear();
    return { broj: nextBrojNaloga(db, godina), godina };
  });

  handle('nalog:create', (unos) => {
    const data = { ...unos, korisnikId: korisnik().id };
    return db.transaction(() => createNalog(db, data))();
  });

  // Drugi argument je izbor proizvoda (niz); raniji pozivi su tu slali korisnikId —
  // to se ignoriše i važi zadani izbor.
  handle('nalog:createIzPonude', (ponudaId: number, proizvodi?: unknown) => {
    const korisnikId = korisnik().id;
    const izbor = Array.isArray(proizvodi) ? proizvodi : undefined;
    return db.transaction(() => createNalogIzPonude(db, ponudaId, korisnikId, izbor))();
  });

  handle('nalog:zaPonudu', (ponudaId: number) => nalogZaPonudu(db, ponudaId));

  handle('nalog:proizvodiPonude', (ponudaId: number) => proizvodiPonude(db, ponudaId));

  handle('nalog:setProizvodi', (id, proizvodi) => {
    db.transaction(() => setProizvodiNaloga(db, id, proizvodi))();
    return { success: true };
  });

  handle('nalog:update', (id, data) => {
    updateNalog(db, id, data);
    return { success: true };
  });

  handle('nalog:replaceStavke', (id, stavke) => {
    db.transaction(() => replaceStavke(db, id, stavke))();
    return { success: true };
  });

  handle('nalog:setStatus', (data) => {
    if (data.status === 'u_izradi') setStatusNaloga(db, data.id, 'u_izradi');
    else if (data.status === 'zavrsen') db.transaction(() => zavrsiNalog(db, data.id))();
    // 'vrati' smije samo admin — provjereno u sesija.ts, prije handlera.
    else if (data.status === 'vrati') db.transaction(() => vratiUIzradu(db, data.id))();
    else throw new Error('Nepoznat status');
    return { success: true };
  });

  handle('nalog:delete', (id: number) => {
    db.transaction(() => deleteNalog(db, id))();
    return { success: true };
  });

  handle('nalog:kalkulacija', (id: number) => kalkulacijaNaloga(db, id));

  handle('nalog:izdajRacun', async (unos) => {
    const data = { ...unos, korisnikId: korisnik().id };
    return izdajRacunZaNalog({ db, uredjaj: uredjaj(), transaction: transakcija }, data);
  });

  handle('normativ:get', (productId: number) => getNormativ(db, productId));

  handle('normativ:save', (productId, stavke) => {
    db.transaction(() => saveNormativ(db, productId, stavke))();
    return { success: true };
  });

  handle('proizvodnja:setEnabled', (enabled: boolean) => {
    db.transaction(() => {
      const [promjena] = upisiPostavke(db, [['proizvodnja.enabled', String(enabled)]]);
      if (promjena) audit('postavke:set', { ...promjena });
      if (enabled) osigurajProdajnuUslugu(db);
    })();
    return { success: true };
  });

  // ─── Settings ────────────────────────────────────────────

  handle('settings:getTring', () => {
    const t = procitajTringPostavke(db);
    // Lozinka operatera ne izlazi iz main procesa — UI zna samo da li je upisana.
    return { host: t.host, port: t.port, operatorId: t.operatorId, imaLozinku: (t.operatorPassword ?? '') !== '' };
  });

  handle('settings:saveTring', (data) => {
    if (!data.host?.trim()) throw new Error('Host je obavezan');
    if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
      throw new Error('Port mora biti cijeli broj između 1 i 65535');
    }
    if (!Number.isInteger(data.operatorId) || data.operatorId < 0) {
      throw new Error('Operator ID mora biti nenegativan cijeli broj');
    }
    const nove: Array<[string, string]> = [
      ['tring.host', data.host],
      ['tring.port', String(data.port)],
      ['tring.operatorId', String(data.operatorId)],
    ];
    // Prazna lozinka = stara ostaje (UI je ne zna, pa je ni ne šalje nazad).
    if (typeof data.operatorPassword === 'string' && data.operatorPassword !== '') {
      nove.push(['tring.operatorPassword', data.operatorPassword]);
    }
    // Audit: lozinka samo kao "promijenjena", nikad vrijednost.
    db.transaction(() => {
      upisiPostavke(db, nove, { audit, akcija: 'postavke:tring', bezVrijednosti: new Set(['tring.operatorPassword']) });
    })();
    return { success: true };
  });

  handle('settings:getFirma', () => {
    const settings = procitajGrupu(db, 'firma');
    const bankAccounts = [1, 2, 3]
      .map(i => ({
        bankName: settings[`bank${i}.name`] ?? '',
        accountNumber: settings[`bank${i}.number`] ?? '',
      }))
      .filter(b => b.bankName.trim() !== '' || b.accountNumber.trim() !== '');

    return {
      naziv: settings.naziv ?? '',
      adresa: settings.adresa ?? '',
      grad: settings.grad ?? '',
      idBroj: settings.idBroj ?? '',
      pdvBroj: settings.pdvBroj ?? '',
      skladiste: settings.skladiste ?? '',
      web: settings.web ?? '',
      email: settings.email ?? '',
      logo: settings.logo ?? '',
      logoVelicina: logoVelicina({ logoVelicina: Number(settings.logoVelicina) }),
      ziroRacuniPozicija: ziroRacuniPozicija(settings),
      bankAccounts,
    };
  });

  handle('settings:get', (key: string) => {
    if (TAJNE_POSTAVKE.has(key)) return null;
    return postavka(key);
  });

  // Ključ je već prošao allowlistu i provjeru uloge (sesija.ts).
  // Audit: svaka promjena vrijednosti osim kasa.scanMode (prekidač skenera na
  // kasi, F2 — UI izbor kasira, ne postavka programa).
  handle('settings:set', (key: string, value: string) => {
    if (typeof value !== 'string') throw new Error('Vrijednost postavke mora biti tekst');
    db.transaction(() => {
      const [promjena] = upisiPostavke(db, [[key, value]]);
      if (promjena && key !== 'kasa.scanMode') audit('postavke:set', { ...promjena });
    })();
    return { success: true };
  });

  // ─── Spremljene košarice ─────────────────────────────────

  handle('savedCarts:list', () => listSavedCarts(db));

  handle('savedCarts:save', (naziv, items, ukupno) => {
    if (!items?.length) throw new Error('Košarica je prazna');
    return saveCart(db, naziv, items, ukupno);
  });

  handle('savedCarts:delete', (id: number) => {
    deleteSavedCart(db, id);
    return { success: true };
  });

  // ─── Skice faktura ───────────────────────────────────────

  handle('fakturaSkice:list', () => listSkiceFaktura(db));

  handle('fakturaSkice:save', (id: number | null, naziv: string, podaci: unknown, ukupno: number) =>
    spremiSkicuFakture(db, id, naziv, podaci, ukupno));

  handle('fakturaSkice:delete', (id: number) => {
    obrisiSkicuFakture(db, id);
    return { success: true };
  });

  handle('settings:saveFirma', (data) => {
    const nove: Array<[string, string]> = [
      ['firma.naziv', data.naziv],
      ['firma.adresa', data.adresa],
      ['firma.grad', data.grad],
      ['firma.idBroj', data.idBroj],
      ['firma.pdvBroj', data.pdvBroj],
      ['firma.skladiste', data.skladiste],
      ['firma.logo', data.logo],
      ['firma.web', data.web ?? ''],
      ['firma.email', data.email ?? ''],
      ['firma.logoVelicina', String(logoVelicina(data))],
      ['firma.ziroRacuniPozicija', ziroRacuniPozicija(data)],
    ];
    const accounts = data.bankAccounts ?? [];
    for (let i = 0; i < 3; i++) {
      const a = accounts[i] ?? { bankName: '', accountNumber: '' };
      nove.push([`firma.bank${i + 1}.name`, a.bankName ?? '']);
      nove.push([`firma.bank${i + 1}.number`, a.accountNumber ?? '']);
    }
    // Audit: stara i nova vrijednost promijenjenih ključeva; logo (slika) samo kao "promijenjen".
    db.transaction(() => {
      upisiPostavke(db, nove, { audit, akcija: 'postavke:firma', bezVrijednosti: new Set(['firma.logo']) });
    })();
    return { success: true };
  });

  // ─── Reports ─────────────────────────────────────────────

  handle('report:getData', (type: string, from: string, to: string) => {
    if (type === 'dnevni') {
      return db
        .prepare(`
          SELECT o.*, u.ime AS korisnikIme
          FROM orders o
          LEFT JOIN users u ON u.id = o.korisnikId
          WHERE date(o.createdAt) BETWEEN date(?) AND date(?)
          ORDER BY o.createdAt DESC
        `)
        .all(from, to) as Order[];
    }

    if (type === 'primke') {
      const primke = db
        .prepare(`
          SELECT p.*
          FROM primke p
          WHERE date(p.datum) BETWEEN date(?) AND date(?)
          ORDER BY p.datum DESC
        `)
        .all(from, to) as Primka[];

      // Attach stavke for each primka so the UI can calculate nabavna/prodajna per-item
      for (const primka of primke) {
        primka.stavke = db
          .prepare('SELECT * FROM primka_stavke WHERE primkaId = ?')
          .all(primka.id) as PrimkaStavka[];
      }
      return primke;
    }

    throw new Error(`Nepoznat tip izvještaja: ${type}`);
  });

  // Izvoz za knjigovođu: sirovi redovi za period, obračun je u rendereru.
  handle('izvoz:knjigovodja', (od: string, doDatum: string) => dohvatiKnjigovodja(db, od, doDatum));

  // ─── Tring ──────────────────────────────────────────────

  handle('tring:init', () => uredjaj().inicijalizacija());

  handle('tring:xReport', () => uredjaj().presjekStanja());

  handle('tring:zReport', () => uredjaj().dnevniIzvjestaj());

  handle('tring:periodicReport', (from: string, to: string) => uredjaj().periodicniIzvjestaj(from, to));

  // Službeni unos/iznos gotovine (polog). Logika i upis žive u lib/cash.ts da
  // budu testabilni bez Electrona.
  handle('cash:add', (data) =>
    addCashMovement({ db, uredjaj: uredjaj() }, { ...data, korisnikId: korisnik().id }));

  handle('cash:retry', (id: number) => retryCashMovement({ db, uredjaj: uredjaj() }, id));

  handle('cash:getToday', () => getTodayMovements(db));

  handle('cash:lastPolog', () => getLastPologIznos(db));

  handle('cash:drawerState', () => getDrawerState(db));

  handle('tring:getLogs', () => {
    return Tring.getLogs();
  });

  handle('tring:clearLogs', () => {
    Tring.clearLogs();
    return { success: true };
  });

  // ─── Dialog / File System ─────────────────────────────────

  let lastApprovedSavePath: string | null = null;

  // Predloženo ime, filteri i odabrana putanja idu kroz pravila iz cuvanje.ts
  // (ista kao u Tauri ljusci). Svaki poziv poništava ranije odobrenje — upisiva
  // je samo putanja iz zadnjeg dijaloga; odbijeno ime ili ekstenzija = otkazano.
  handle('dialog:saveFile', async (data) => {
    lastApprovedSavePath = null;
    const ime = imeZaCuvanje(data?.defaultName);
    if (!ime) return null;
    const result = await dialog.showSaveDialog({
      defaultPath: ime,
      filters: dozvoljeniFilteri(data?.filters),
    });
    if (result.canceled || !result.filePath || !dozvoljenaEkstenzija(result.filePath)) return null;
    lastApprovedSavePath = result.filePath;
    return result.filePath;
  });

  handle('fs:writeFile', (data) => {
    if (data.path !== lastApprovedSavePath) {
      throw new Error('Write path not approved by save dialog');
    }
    lastApprovedSavePath = null;
    if (!dozvoljenaEkstenzija(data.path)) throw new Error('Nedozvoljena vrsta fajla');
    writeFileSync(data.path, Buffer.from(data.buffer));
    return { success: true };
  });

  // ─── Database Backup ───────────────────────────────────────

  handle('db:backup', async () => {
    const dbPath = path.join(app.getPath('userData'), 'kasa.db');
    const timestamp = localDateStr();
    const result = await dialog.showSaveDialog({
      defaultPath: `kasa-backup-${timestamp}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath || !dozvoljenaEkstenzija(result.filePath)) return null;

    // Samostalan fajl (DELETE journal mode): gola kopija WAL baze se ne
    // otvara read-only, pa je ni db:restore ne bi mogao provjeriti.
    samostalnaKopija(dbPath, result.filePath, restoreDeps);
    return result.filePath;
  });

  // Uvoz backup-a. Handler radi samo dijaloge; sam rad s fajlovima je u
  // `database/restore.ts`. getDb() nakon zamjene odradi schemu + migracije, pa
  // backup iz starije verzije programa radi bez dodatnih koraka.
  const restoreDeps: RestoreDeps = {
    open: (filePath) => new Database(filePath, { fileMustExist: true }),
    closeActive: closeDb,
    openActive: () => { getDb(); },
    checkpointActive: () => { getDb().pragma('wal_checkpoint(TRUNCATE)'); },
  };

  handle('db:restore', async () => {
    const dbPath = path.join(app.getPath('userData'), 'kasa.db');

    const picked = await dialog.showOpenDialog({
      title: 'Odaberi backup baze',
      properties: ['openFile'],
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const source = picked.filePaths[0];

    // Provjera prije potvrde — nema smisla plašiti korisnika upozorenjem ako
    // odabrani fajl ionako nije upotrebljiv backup.
    validateBackup(source, restoreDeps);

    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Otkaži', 'Uvezi i restartuj'],
      defaultId: 0,
      cancelId: 0,
      title: 'Uvoz backup-a',
      message: 'Zamijeniti trenutnu bazu podataka?',
      detail:
        'Svi trenutni podaci (računi, artikli, primke, korisnici) bit će zamijenjeni ' +
        'podacima iz backup-a. Kopija trenutne baze se sprema automatski. ' +
        'Program će se restartovati nakon uvoza.',
    });
    if (confirm.response !== 1) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safetyPath = path.join(app.getPath('userData'), `kasa-prije-uvoza-${stamp}.db`);
    swapInBackup(source, dbPath, safetyPath, restoreDeps);
    // Trag ide u uvezenu bazu (nova konekcija iz getDb); stara ga ima u sigurnosnoj kopiji.
    try {
      zapisiAudit(getDb(), sesija.prijavljeniId(), 'baza:restore', { izvor: source, sigurnosnaKopija: safetyPath });
    } catch (e) {
      console.error('[audit] baza:restore', e);
    }

    // Renderer drži stanje stare baze (prijavljeni korisnik, korpa) — restart je
    // jedini pouzdan način da se sve osvježi.
    setTimeout(() => {
      closeDb();
      app.relaunch();
      app.exit(0);
    }, 500);

    return { source, safetyPath };
  });
}
