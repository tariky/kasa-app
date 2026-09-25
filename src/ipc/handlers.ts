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
import {
  collectPriceChanges, upisiCijene, revertPrimkaPrices, zapisiPromjeneCijena, stareCijeneStavki, datumKretanjaPrimke, validirajPrimku,
  isDobavljacUsed, pripremiIzmjenuPrimke, stareCijeneIzmjene, cijenaKasnijeMijenjana, type PriceChange,
  artikliPrimke, cijeneArtikala, promjeneUProdaji, brojeviNivelacijaPrimke, napomenaProtunivelacije,
  pocetakPregleda, rezultatPregleda, cijeneKojeOstaju, istiPregled,
} from '../lib/skladiste';
import type { PregledCijenaUlaza, PromijenjenoOdPregleda } from '../types';
import {
  jeArtikalUProizvodnji, nextBrojNaloga, createNalog, createNalogIzPonude, nalogZaPonudu, updateNalog, replaceStavke,
  getNalog, listNalozi, deleteNalog, kalkulacijaNaloga, setStatusNaloga, zavrsiNalog, vratiUIzradu,
  izdajRacunZaNalog, getNormativ, saveNormativ, osigurajProdajnuUslugu,
} from '../lib/proizvodnja';
import { refundAndPrint } from '../lib/refund';
import { postaviDatumValute } from '../lib/valuta';
import {
  savePrilogStavkeInTransaction, finalizePrilogAndPrint, oznaciPonuduFakturisanom,
  PRILOG_SIFRA, prilogNaziv, type PrilogStavkaUnos,
} from '../lib/prilog';
import { saveCart, listSavedCarts, deleteSavedCart } from '../lib/savedCarts';
import { spremiSkicuFakture, listSkiceFaktura, obrisiSkicuFakture } from '../lib/fakturaSkice';
import {
  validirajPin, validirajUlogu, VEZE_KORISNIKA, ZADANI_PIN, hesirajPin, nadjiPoPinu, pinZauzet, pinKorisnika,
  type JavniKorisnik,
} from '../lib/korisnici';
import type { SavedCartItem } from '../lib/kosarica';
import {
  nextBrojPonude, createPonuda, updatePonuda, setStatusPonude, deletePonuda, konvertujPonudu,
  type PonudaStatus,
} from '../lib/ponuda';
import { buildTringRacun } from '../lib/tringRacun';
import { addCashMovement, retryCashMovement, getTodayMovements, getDrawerState, getLastPologIznos } from '../lib/cash';
import { logoVelicina, ziroRacuniPozicija } from '../lib/firma';
import { dohvatiKnjigovodja } from '../lib/knjigovodja/podaci';
import * as Tring from '../services/tring';
import { provjeriKanal, stanjeLicence, aktivirajLicencu } from './licenca';
import { provjeriPristup, OgranicenjePokusaja, PORUKA_NISTE_PRIJAVLJENI, TAJNE_POSTAVKE } from './sesija';
import Database from 'better-sqlite3';

// Provjera sesije i uloge prije svakog handlera; postavlja je registerIpcHandlers
// (treba joj baza da pročita trenutnog korisnika).
let provjeriSesiju: (channel: string, args: unknown[]) => void = () => undefined;

function handle<T>(channel: string, handler: (...args: any[]) => T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      provjeriKanal(channel);
      provjeriSesiju(channel, args);
      // `await` je obavezan: bez njega odbijeni promise async handlera
      // promaši catch ispod i renderer dobije neobrađenu Electron grešku.
      return await handler(...args);
    } catch (error: any) {
      console.error(`[IPC ${channel}]`, error);
      throw new Error(error.message || 'Nepoznata greška');
    }
  });
}

/** Primka kako je šalje ekran ulaza (primka:create, primka:update i njihov pregled). */
interface PrimkaUnos {
  brojPrimke: string; datum?: string; napomena?: string; brojFakture?: string;
  dobavljacNaziv?: string; dobavljacId?: string; dobavljacAdresa?: string;
  stavke: Array<{ productId: number; kolicina: number; cijena: number; nabavnaCijena: number; rabat: number; zavisniTroskovi?: number; pdvStopa: string }>;
}

// Insert a completed order + items + stock movements from a snapshot-shaped payload.
// Returns the new orderId. Caller is responsible for wrapping in a transaction.
function insertCompletedOrder(
  db: Database.Database,
  data: {
    korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string;
    brojFiskalnogRacuna: string | null;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
    isManual?: 0 | 1; createdAt?: string;
    // Račun po prilogu: nema stavki, nosi interni broj priloga i naziv zbirne stavke.
    prilogBroj?: number | null;
    prilogNaziv?: string | null;
    // Faktura: rok plaćanja i napomena putuju kroz snapshot.
    datumValute?: string | null;
    napomena?: string | null;
  }
): number {
  const isManual = data.isManual ?? 0;
  const hasCreatedAt = typeof data.createdAt === 'string' && data.createdAt.length > 0;

  const result = db
    .prepare(`
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
        kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual${hasCreatedAt ? ', createdAt' : ''}, prilogBroj, prilogNaziv, datumValute, napomena)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?${hasCreatedAt ? ', ?' : ''}, ?, ?, ?, ?)
    `)
    .run(
      data.korisnikId, data.ukupno, data.pdvIznos, data.nacinPlacanja, data.brojFiskalnogRacuna,
      data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
      data.kupac?.grad || null, data.kupac?.postanskiBroj || null, isManual,
      ...(hasCreatedAt ? [data.createdAt] : []),
      data.prilogBroj ?? null,
      data.prilogNaziv ?? null,
      data.datumValute ?? null,
      data.napomena ?? null
    );

  const orderId = result.lastInsertRowid as number;

  const insertItem = db.prepare(
    'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertStock = hasCreatedAt
    ? db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, ?)")
    : db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)");

  for (const item of data.stavke) {
    insertItem.run(orderId, item.productId, item.kolicina, item.cijena, item.rabat, item.pdvStopa);
    const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(item.productId) as { tip: string } | undefined;
    if (!product || product.tip !== 'usluga') {
      if (hasCreatedAt) insertStock.run(item.productId, item.kolicina, orderId, data.createdAt);
      else insertStock.run(item.productId, item.kolicina, orderId);
    }
  }

  return orderId;
}

export function registerIpcHandlers(): void {
  // ─── Licenca ───
  handle('licenca:stanje', () => stanjeLicence());
  handle('licenca:aktiviraj', (token: string) => aktivirajLicencu(token));

  const db = getDb();

  const postavka = (key: string): string | null =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;

  // ─── Sesija i korisnici ──────────────────────────────────
  // Prijavljeni korisnik živi samo u main procesu (jedan prozor = jedna sesija);
  // uloga se svaki put čita iz baze, pa izmjena ili brisanje korisnika važi odmah.

  let prijavljeniId: number | null = null;
  const pokusaji = new OgranicenjePokusaja();

  const trenutni = (): JavniKorisnik | null => {
    if (prijavljeniId === null) return null;
    return (db.prepare('SELECT id, ime, uloga FROM users WHERE id = ?').get(prijavljeniId) as JavniKorisnik | undefined) ?? null;
  };
  /** Prijavljeni korisnik; kanal je već prošao provjeriSesiju, ali korisnik je mogao biti obrisan. */
  const korisnik = (): JavniKorisnik => {
    const k = trenutni();
    if (!k) throw new Error(PORUKA_NISTE_PRIJAVLJENI);
    return k;
  };
  provjeriSesiju = (channel, args) => provjeriPristup(channel, args, trenutni());

  /**
   * Admin PIN za radnju kasira (storno). Neuspjeh ulazi u ograničenje pokušaja;
   * baca 'Neispravan admin PIN'. Vraća admina čiji je PIN.
   */
  const provjeriAdminPin = (pin: unknown): JavniKorisnik => {
    pokusaji.provjeri();
    const admin = nadjiPoPinu(db, pin, { samoAdmin: true });
    if (!admin) {
      pokusaji.neuspjeh();
      throw new Error('Neispravan admin PIN');
    }
    pokusaji.uspjeh();
    return admin;
  };

  handle('user:login', (pin: string) => {
    // Nova prijava uvijek poništi staru sesiju, i kad ne uspije.
    prijavljeniId = null;
    pokusaji.provjeri();
    const u = nadjiPoPinu(db, pin);
    if (!u) {
      pokusaji.neuspjeh();
      return null;
    }
    pokusaji.uspjeh();
    prijavljeniId = u.id;
    return { ...u, zadaniPin: pin === ZADANI_PIN };
  });

  handle('user:logout', () => {
    prijavljeniId = null;
    return { success: true };
  });

  // Prijavljeni korisnik mijenja svoj PIN (obavezno nakon prijave sa zadanim 0000).
  handle('user:promijeniSvojPin', (stari: string, novi: string) => {
    const k = korisnik();
    validirajPin(novi);
    if (novi === ZADANI_PIN) throw new Error(`Novi PIN ne smije biti ${ZADANI_PIN}`);
    pokusaji.provjeri();
    if (!pinKorisnika(db, k.id, stari)) {
      pokusaji.neuspjeh();
      throw new Error('Trenutni PIN nije tačan');
    }
    pokusaji.uspjeh();
    if (pinZauzet(db, novi, k.id)) throw new Error('Taj PIN je zauzet, odaberite drugi');
    db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hesirajPin(novi), k.id);
    return { success: true };
  });

  handle('user:verifyAdminPin', (pin: string) => {
    const admin = provjeriAdminPin(pin);
    return { success: true, ime: admin.ime };
  });

  handle('user:getAll', () => {
    return db.prepare('SELECT id, ime, uloga FROM users ORDER BY ime').all();
  });

  // Admin koji je jedini admin u bazi — ne smije se obrisati ni degradirati.
  const jePosljednjiAdmin = (id: number): boolean => {
    const u = db.prepare('SELECT uloga FROM users WHERE id = ?').get(id) as { uloga: string } | undefined;
    if (u?.uloga !== 'admin') return false;
    return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE uloga = 'admin'").get() as { n: number }).n <= 1;
  };

  handle('user:create', (data: { ime: string; pin: string; uloga: string }) => {
    if (!data.ime?.trim()) throw new Error('Ime korisnika je obavezno');
    validirajPin(data.pin);
    validirajUlogu(data.uloga);
    if (pinZauzet(db, data.pin)) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
    const result = db
      .prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)')
      .run(data.ime.trim(), hesirajPin(data.pin), data.uloga);
    return { id: result.lastInsertRowid };
  });

  handle('user:update', (id: number, data: { ime?: string; pin?: string | null; uloga?: string }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.ime !== undefined) {
      if (!data.ime.trim()) throw new Error('Ime korisnika je obavezno');
      fields.push('ime = ?'); values.push(data.ime.trim());
    }
    // Prazan PIN = PIN ostaje kakav je (UI ga više ne zna, pa ga ne može ni poslati).
    if (data.pin != null && data.pin !== '') {
      validirajPin(data.pin);
      if (pinZauzet(db, data.pin, id)) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
      fields.push('pin = ?'); values.push(hesirajPin(data.pin));
    }
    if (data.uloga !== undefined) {
      const uloga = validirajUlogu(data.uloga);
      if (uloga !== 'admin' && jePosljednjiAdmin(id)) throw new Error('Posljednji administrator ne može postati kasir');
      fields.push('uloga = ?'); values.push(uloga);
    }

    if (fields.length === 0) return { changes: 0 };

    values.push(id);
    const result = db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
  });

  handle('user:delete', (id: number) => {
    for (const { tabela, poruka } of VEZE_KORISNIKA) {
      if (db.prepare(`SELECT 1 FROM ${tabela} WHERE korisnikId = ? LIMIT 1`).get(id)) throw new Error(poruka);
    }
    if (jePosljednjiAdmin(id)) throw new Error('Posljednji administrator ne može biti obrisan');
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { changes: result.changes };
  });

  // ─── Products ────────────────────────────────────────────

  const PRODUCT_TIPOVI = ['artikal', 'usluga', 'materijal'] as const;
  const normalizujTip = (t?: string): string => (t && (PRODUCT_TIPOVI as readonly string[]).includes(t)) ? t : 'artikal';

  // Šifre dobavljača artikla u jednom stringu — za pretragu u šifarniku, primci i kasi.
  const SIFRE_DOBAVLJACA = `(SELECT GROUP_CONCAT(ds.sifra, ' ') FROM artikal_dobavljac_sifre ds
            WHERE ds.productId = p.id AND ds.sifra IS NOT NULL) AS sifreDobavljaca`;

  handle('product:getAll', (tip?: string) => {
    const where = tip ? 'WHERE p.slobodan = 0 AND p.tip = ?' : 'WHERE p.slobodan = 0';
    return db
      .prepare(`
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje,
          ${SIFRE_DOBAVLJACA}
        FROM products p
        ${where}
        ORDER BY p.naziv
      `)
      .all(...(tip ? [normalizujTip(tip)] : []));
  });

  handle('product:get', (id: number) => {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  });

  const PDV_STOPE = ['E', 'K'];
  // Tring: naziv zajedno s JM ima 32–36 znakova, zavisno od uređaja.
  const SLOBODAN_NAZIV_MAX = 32;

  type ArtikalUnos = { sifra?: string; naziv?: string; cijena?: number; pdvStopa?: string; barkod?: string | null };

  // Zajednička pravila za product:create (id = null) i product:update. Na create-u su
  // sva polja obavezna, na update-u se provjerava samo ono što je poslano. Vraća
  // trimovane šifru, naziv i barkod (prazan barkod = null) spremne za upis.
  const validirajArtikal = (data: ArtikalUnos, id: number | null) => {
    const poslano = (k: keyof ArtikalUnos) => id === null || data[k] !== undefined;
    const upis: { sifra?: string; naziv?: string; barkod?: string | null } = {};
    if (poslano('sifra')) {
      if (!data.sifra?.trim()) throw new Error('Šifra artikla je obavezna');
      upis.sifra = data.sifra.trim();
    }
    if (poslano('naziv')) {
      if (!data.naziv?.trim()) throw new Error('Naziv artikla je obavezan');
      upis.naziv = data.naziv.trim();
    }
    if (poslano('cijena') && (data.cijena == null || !(data.cijena >= 0))) throw new Error('Cijena mora biti pozitivan broj');
    if (poslano('pdvStopa') && !PDV_STOPE.includes(data.pdvStopa as string)) throw new Error('PDV stopa mora biti E ili K');
    const osimId = id ?? -1;
    if (upis.sifra !== undefined && db.prepare('SELECT id FROM products WHERE sifra = ? AND id != ?').get(upis.sifra, osimId)) {
      throw new Error(`Artikal sa šifrom "${data.sifra}" već postoji`);
    }
    if (id === null || 'barkod' in data) {
      upis.barkod = data.barkod?.trim() || null;
      if (upis.barkod && db.prepare('SELECT id FROM products WHERE barkod = ? AND id != ?').get(upis.barkod, osimId)) {
        throw new Error(`Artikal sa barkodom "${data.barkod}" već postoji`);
      }
    }
    return upis;
  };

  handle('product:create', (data: {
    sifra: string; naziv: string; jm?: string; cijena: number;
    pdvStopa: string; plu?: number; barkod?: string | null; tip?: string;
    plocaSirina?: number | null; plocaVisina?: number | null;
  }) => {
    const upis = validirajArtikal(data, null);
    const tip = normalizujTip(data.tip);
    const result = db
      .prepare(`
        INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip, plocaSirina, plocaVisina)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(upis.sifra, upis.naziv, data.jm ?? (tip === 'usluga' ? 'usl' : 'kom'), data.cijena, data.pdvStopa,
        data.plu ?? null, upis.barkod ?? null, tip, data.plocaSirina ?? null, data.plocaVisina ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('product:update', (id: number, data: {
    sifra?: string; naziv?: string; jm?: string; cijena?: number;
    pdvStopa?: string; plu?: number; barkod?: string | null; tip?: string;
    plocaSirina?: number | null; plocaVisina?: number | null;
  }) => {
    const upis = validirajArtikal(data, id);
    const fields: string[] = [];
    const values: any[] = [];

    if (upis.sifra !== undefined) { fields.push('sifra = ?'); values.push(upis.sifra); }
    if (upis.naziv !== undefined) { fields.push('naziv = ?'); values.push(upis.naziv); }
    if (data.jm !== undefined) { fields.push('jm = ?'); values.push(data.jm); }
    if (data.cijena !== undefined) { fields.push('cijena = ?'); values.push(data.cijena); }
    if (data.pdvStopa !== undefined) { fields.push('pdvStopa = ?'); values.push(data.pdvStopa); }
    if (data.plu !== undefined) { fields.push('plu = ?'); values.push(data.plu); }
    if (upis.barkod !== undefined) { fields.push('barkod = ?'); values.push(upis.barkod); }
    if (data.tip !== undefined) { fields.push('tip = ?'); values.push(normalizujTip(data.tip)); }
    if ('plocaSirina' in data) { fields.push('plocaSirina = ?'); values.push(data.plocaSirina ?? null); }
    if ('plocaVisina' in data) { fields.push('plocaVisina = ?'); values.push(data.plocaVisina ?? null); }

    if (fields.length === 0) return { changes: 0 };

    fields.push("updatedAt = datetime('now','localtime')");
    values.push(id);

    return db.transaction(() => {
      const prije = db.prepare('SELECT cijena FROM products WHERE id = ?').get(id) as { cijena: number } | undefined;
      const result = db
        .prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`)
        .run(...values);
      // Ručna izmjena cijene ulazi u historiju: poništavanje ranije primke je ne smije pregaziti.
      if (prije && data.cijena !== undefined && data.cijena !== prije.cijena) {
        zapisiPromjeneCijena(db, 'rucno', null, [{ productId: id, staraCijena: prije.cijena, novaCijena: data.cijena }]);
      }
      return { changes: result.changes };
    })();
  });

  handle('product:delete', (id: number) => {
    const inOrders = db.prepare('SELECT id FROM order_items WHERE productId = ? LIMIT 1').get(id);
    if (inOrders) throw new Error('Artikal se koristi u računima i ne može biti obrisan');
    const inPrimke = db.prepare('SELECT id FROM primka_stavke WHERE productId = ? LIMIT 1').get(id);
    if (inPrimke) throw new Error('Artikal se koristi u primkama i ne može biti obrisan');
    if (jeArtikalUProizvodnji(db, id)) throw new Error('Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan');
    // Ostali strani ključevi na products (vidi schema.ts). Kretanja zalihe idu zadnja:
    // račun i primka ih i sami prave, pa za njih važi konkretnija poruka iznad.
    const ostaleVeze: Array<[tabela: string, poruka: string]> = [
      ['prilog_stavke', 'Artikal se koristi u prilozima i ne može biti obrisan'],
      ['ponuda_stavke', 'Artikal se koristi u ponudama i ne može biti obrisan'],
      ['nivelacija_stavke', 'Artikal se koristi u nivelacijama i ne može biti obrisan'],
      ['stock_movements', 'Artikal ima kretanja zalihe i ne može biti obrisan'],
    ];
    for (const [tabela, poruka] of ostaleVeze) {
      if (db.prepare(`SELECT 1 FROM ${tabela} WHERE productId = ? LIMIT 1`).get(id)) throw new Error(poruka);
    }
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
    // Calculate current stock
    const row = db.prepare(`
      SELECT COALESCE(
        SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
      ) AS stanje
      FROM stock_movements WHERE productId = ?
    `).get(productId) as { stanje: number };

    const diff = newStanje - row.stanje;
    if (diff === 0) return { changes: 0 };

    const tip = diff > 0 ? 'ulaz' : 'izlaz';
    const kolicina = Math.abs(diff);

    db.prepare(
      "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, ?, ?, 'adjustment', 0)"
    ).run(productId, tip, kolicina);

    return { changes: 1 };
  });

  handle('product:search', (query: string) => {
    const like = `%${query}%`;
    return db
      .prepare(`
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje,
          ${SIFRE_DOBAVLJACA}
        FROM products p
        WHERE (p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?
          OR EXISTS (SELECT 1 FROM artikal_dobavljac_sifre ds WHERE ds.productId = p.id AND ds.sifra LIKE ?))
          AND p.tip != 'materijal' AND p.slobodan = 0
        ORDER BY p.naziv
      `)
      .all(like, like, like, like);
  });

  // ─── Šifre dobavljača ───────────────────────────────────

  handle('product:getDobavljacSifre', (productId: number) => {
    return db.prepare(`
      SELECT ds.dobavljacId, d.naziv AS dobavljacNaziv, ds.sifra
      FROM artikal_dobavljac_sifre ds JOIN dobavljaci d ON d.id = ds.dobavljacId
      WHERE ds.productId = ?
      ORDER BY d.naziv, ds.dobavljacId
    `).all(productId);
  });

  // Zamjenjuje sve šifre dobavljača artikla. Prazna šifra = artikal je vezan za
  // dobavljača bez šifre. Sve se provjeri prije upisa, pa greška ništa ne mijenja.
  handle('product:setDobavljacSifre', (productId: number, lista: Array<{ dobavljacId: number; sifra?: string | null }>) => {
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
    return db.prepare(`
      SELECT p.*,
        COALESCE(
          (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
           FROM stock_movements sm WHERE sm.productId = p.id),
          0
        ) AS stanje
      FROM artikal_dobavljac_sifre ds JOIN products p ON p.id = ds.productId
      WHERE ds.dobavljacId = ? AND ds.sifra = ?
    `).get(dobavljacId, s) ?? null;
  });

  handle('dobavljac:getSifre', (dobavljacId: number) => {
    return db.prepare(
      'SELECT productId, sifra FROM artikal_dobavljac_sifre WHERE dobavljacId = ? AND sifra IS NOT NULL ORDER BY sifra'
    ).all(dobavljacId);
  });

  // Slobodna stavka na kasi: kasir upiše naziv, cijenu i stopu, a stavka dobije
  // skriveni artikal (slobodan = 1, bez zalihe, van šifarnika) s automatskom šifrom.
  // Tring pamti naziv, JM i stopu po artiklu i u toku dana ih ne smije mijenjati,
  // a svaki novi artikal trajno zauzme mjesto (PLU) u memoriji uređaja — zato se
  // isti naziv (bez obzira na velika slova), stopa i JM uvijek vraćaju na isti
  // artikal, kome se mijenja samo cijena.
  handle('product:slobodan', (data: { naziv?: string; cijena?: number; pdvStopa?: string; jm?: string }) => {
    const naziv = data.naziv?.trim() ?? '';
    if (!naziv) throw new Error('Naziv stavke je obavezan');
    if (naziv.length > SLOBODAN_NAZIV_MAX) throw new Error(`Naziv stavke može imati najviše ${SLOBODAN_NAZIV_MAX} znaka`);
    if (data.cijena == null || !(data.cijena >= 0.01 && data.cijena <= 9_999_999.99)) {
      throw new Error('Cijena mora biti između 0,01 i 9.999.999,99');
    }
    if (!PDV_STOPE.includes(data.pdvStopa as string)) throw new Error('PDV stopa mora biti E ili K');
    const jm = data.jm?.trim() || 'kom';

    return db.transaction(() => {
      // SQLite-ov lower() zna samo ASCII (Š ≠ š), pa se naziv poredi ovdje.
      const kandidati = db.prepare(
        'SELECT id, naziv FROM products WHERE slobodan = 1 AND pdvStopa = ? AND jm = ?'
      ).all(data.pdvStopa, jm) as { id: number; naziv: string }[];
      const postojeci = kandidati.find(k => k.naziv.toLowerCase() === naziv.toLowerCase());
      let id: number;
      if (postojeci) {
        id = postojeci.id;
        db.prepare("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?").run(data.cijena, id);
      } else {
        const zadnji = db.prepare(
          "SELECT MAX(CAST(substr(sifra, 2) AS INTEGER)) AS n FROM products WHERE slobodan = 1"
        ).get() as { n: number | null };
        let broj = (zadnji.n ?? 0) + 1;
        const sifraZa = (n: number) => 'S' + String(n).padStart(6, '0');
        while (db.prepare('SELECT 1 FROM products WHERE sifra = ?').get(sifraZa(broj))) broj++;
        const r = db.prepare(`
          INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, slobodan)
          VALUES (?, ?, ?, ?, ?, 'usluga', 1)
        `).run(sifraZa(broj), naziv, jm, data.cijena, data.pdvStopa);
        id = Number(r.lastInsertRowid);
      }
      return db.prepare('SELECT p.*, 0 AS stanje FROM products p WHERE p.id = ?').get(id);
    })();
  });

  handle('materijal:search', (query: string) => {
    const like = `%${query}%`;
    return db
      .prepare(`
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje
        FROM products p
        WHERE p.tip = 'materijal' AND (p.naziv LIKE ? OR p.sifra LIKE ?)
        ORDER BY p.naziv
        LIMIT 30
      `)
      .all(like, like);
  });

  // ─── Dobavljači ─────────────────────────────────────────

  handle('dobavljac:getAll', () => {
    return db.prepare('SELECT * FROM dobavljaci ORDER BY naziv').all();
  });

  // Zajednička pravila za dobavljac:create (id = null) i dobavljac:update — na update-u
  // se naziv provjerava samo ako je poslan. Vraća trimovan naziv spreman za upis.
  const validirajDobavljaca = (data: { naziv?: string }, id: number | null): { naziv?: string } => {
    if (id !== null && data.naziv === undefined) return {};
    if (!data.naziv?.trim()) throw new Error('Naziv dobavljača je obavezan');
    return { naziv: data.naziv.trim() };
  };

  handle('dobavljac:create', (data: {
    naziv: string; idBroj?: string; pdvBroj?: string; adresa?: string; kontakt?: string;
  }) => {
    const upis = validirajDobavljaca(data, null);
    const result = db
      .prepare('INSERT INTO dobavljaci (naziv, idBroj, pdvBroj, adresa, kontakt) VALUES (?, ?, ?, ?, ?)')
      .run(upis.naziv, data.idBroj ?? null, data.pdvBroj ?? null, data.adresa ?? null, data.kontakt ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('dobavljac:update', (id: number, data: {
    naziv?: string; idBroj?: string; pdvBroj?: string; adresa?: string; kontakt?: string;
  }) => {
    const upis = validirajDobavljaca(data, id);
    const fields: string[] = [];
    const values: any[] = [];

    if (upis.naziv !== undefined) { fields.push('naziv = ?'); values.push(upis.naziv); }
    if (data.idBroj !== undefined) { fields.push('idBroj = ?'); values.push(data.idBroj); }
    if (data.pdvBroj !== undefined) { fields.push('pdvBroj = ?'); values.push(data.pdvBroj); }
    if (data.adresa !== undefined) { fields.push('adresa = ?'); values.push(data.adresa); }
    if (data.kontakt !== undefined) { fields.push('kontakt = ?'); values.push(data.kontakt); }

    if (fields.length === 0) return { changes: 0 };
    values.push(id);

    const result = db
      .prepare(`UPDATE dobavljaci SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
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
    return db.prepare('SELECT * FROM kupci ORDER BY naziv').all();
  });

  handle('kupac:search', (query: string) => {
    const like = `%${query}%`;
    return db
      .prepare('SELECT * FROM kupci WHERE naziv LIKE ? OR idBroj LIKE ? OR kontakt LIKE ? ORDER BY naziv')
      .all(like, like, like);
  });

  // Zajednička pravila za kupac:create (id = null) i kupac:update — na update-u se
  // provjerava samo ono što je poslano. Vraća trimovane naziv i JIB spremne za upis.
  const validirajKupca = (data: { naziv?: string; idBroj?: string }, id: number | null) => {
    const upis: { naziv?: string; idBroj?: string } = {};
    if (id === null || data.naziv !== undefined) {
      if (!data.naziv?.trim()) throw new Error('Naziv kupca je obavezan');
      upis.naziv = data.naziv.trim();
    }
    if (id === null || data.idBroj !== undefined) {
      if (!data.idBroj?.trim()) throw new Error('ID broj (JIB) kupca je obavezan');
      upis.idBroj = data.idBroj.trim();
      if (db.prepare('SELECT id FROM kupci WHERE idBroj = ? AND id != ?').get(upis.idBroj, id ?? -1)) {
        throw new Error(`Kupac sa JIB-om "${data.idBroj}" već postoji`);
      }
    }
    return upis;
  };

  handle('kupac:create', (data: {
    naziv: string; idBroj: string; pdvBroj?: string; adresa?: string;
    postanskiBroj?: string; grad?: string; kontakt?: string;
  }) => {
    const upis = validirajKupca(data, null);
    const result = db
      .prepare('INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(upis.naziv, upis.idBroj, data.pdvBroj ?? null, data.adresa ?? null, data.postanskiBroj ?? null, data.grad ?? null, data.kontakt ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('kupac:update', (id: number, data: {
    naziv?: string; idBroj?: string; pdvBroj?: string; adresa?: string;
    postanskiBroj?: string; grad?: string; kontakt?: string;
  }) => {
    const upis = validirajKupca(data, id);
    const fields: string[] = [];
    const values: any[] = [];

    if (upis.naziv !== undefined) { fields.push('naziv = ?'); values.push(upis.naziv); }
    if (upis.idBroj !== undefined) { fields.push('idBroj = ?'); values.push(upis.idBroj); }
    if (data.pdvBroj !== undefined) { fields.push('pdvBroj = ?'); values.push(data.pdvBroj); }
    if (data.adresa !== undefined) { fields.push('adresa = ?'); values.push(data.adresa); }
    if (data.postanskiBroj !== undefined) { fields.push('postanskiBroj = ?'); values.push(data.postanskiBroj); }
    if (data.grad !== undefined) { fields.push('grad = ?'); values.push(data.grad); }
    if (data.kontakt !== undefined) { fields.push('kontakt = ?'); values.push(data.kontakt); }

    if (fields.length === 0) return { changes: 0 };
    values.push(id);

    const result = db
      .prepare(`UPDATE kupci SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
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
    return db.prepare('SELECT * FROM primke ORDER BY datum DESC').all();
  });

  handle('primka:get', (id: number) => {
    const primka = db.prepare('SELECT * FROM primke WHERE id = ?').get(id) as any;
    if (!primka) throw new Error('Primka ne postoji');

    primka.stavke = db
      .prepare(`
        SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra
        FROM primka_stavke ps
        LEFT JOIN products p ON p.id = ps.productId
        WHERE ps.primkaId = ?
      `)
      .all(id);
    // Stavke čiju je cijenu poslije ove primke mijenjalo nešto drugo: izmjena
    // njihove cijene na primci ne mijenja cijenu u prodaji (ekran to prikazuje).
    for (const s of primka.stavke) s.cijenaKasnijeMijenjana = cijenaKasnijeMijenjana(db, id, s.productId);

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

  // Tijela create/update/delete bez transakcije: prava operacija ih pokrene u
  // transakciji, a pregled (primka:pregled*) u transakciji koju poništi — ista
  // logika, pa najava na ekranu ne može odstupiti od onoga što spremanje uradi.
  function unesiPrimku(data: PrimkaUnos) {
    const brojPrimke = validirajPrimku(db, data);
    const datum = data.datum || localDateStr();
    const result = db
      .prepare('INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null);

    const primkaId = result.lastInsertRowid;

    const insertStavka = db.prepare(
      'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa, staraCijena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertStock = db.prepare(
      "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'ulaz', ?, 'primka', ?, ?)"
    );

    // Collect price diffs BEFORE inserting stock (so stock reflects pre-delivery state)
    const { nivelacija, bezZaliha } = collectPriceChanges(db, data.stavke);

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti.
    const stareCijene = stareCijeneStavki(data.stavke, bezZaliha);
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    const datumUlaza = datumKretanjaPrimke(datum);
    data.stavke.forEach((stavka, i) => {
      insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.zavisniTroskovi ?? 0, stavka.pdvStopa, stareCijene[i]);
      insertStock.run(stavka.productId, stavka.kolicina, primkaId, datumUlaza);
    });

    upisiCijene(db, [...nivelacija, ...bezZaliha]);
    createNivelacija(primkaId, nivelacija, null);
    zapisiPromjeneCijena(db, 'primka', primkaId, [...nivelacija, ...bezZaliha]);

    return { id: primkaId, nivelacijaCreated: nivelacija.length > 0 };
  }

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
    db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(data.id);

    const insertStavka = db.prepare(
      'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa, staraCijena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertStock = db.prepare(
      "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'ulaz', ?, 'primka', ?, ?)"
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
    createNivelacija(data.id, noveCijene, `Izmjena primke ${brojPrimke}`);
    createNivelacija(null, vraceneCijene, napomenaProtunivelacije(
      `Izmjena primke ${brojPrimke}: poništenje cijene`, brojeviNivelacijaPrimke(db, data.id, vraceneCijene.map(c => c.productId))
    ));

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti;
    // zadržane promjene zadržavaju svoju zapamćenu cijenu.
    const stareCijene = stareCijeneIzmjene(data.stavke, bezZaliha, izmjena.zadrzaneStareCijene);
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    const datumUlaza = datumKretanjaPrimke(datum);
    data.stavke.forEach((stavka, i) => {
      insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.zavisniTroskovi ?? 0, stavka.pdvStopa, stareCijene[i]);
      insertStock.run(stavka.productId, stavka.kolicina, data.id, datumUlaza);
    });

    return { id: data.id, nivelacijaCreated: promjene.length > 0 };
  }

  function obrisiPrimku(id: number) {
    const primka = db.prepare('SELECT brojPrimke FROM primke WHERE id = ?').get(id) as { brojPrimke: string } | undefined;
    if (!primka) return;

    // Vrati cijene koje je ova primka promijenila (historija, stari put iz
    // nivelacije, zapamćene cijene artikala bez zalihe — isto pravilo kao
    // primka:update).
    const prije = cijeneArtikala(db, artikliPrimke(db, id));
    revertPrimkaPrices(db, id);

    db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(id);
    db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(id);

    // Nivelacije primke su dokumenti po kojima se prodavalo i ostaju. Vraćena
    // cijena u prodaji se dokumentuje protunivelacijom s današnjim datumom,
    // na zalihi POSLIJE uklanjanja ulaza: poništena primka robu nije ni
    // unijela, a cijena se mijenja na robi koja ostaje u prodavnici (isto
    // kao pri unosu primke, gdje nivelacija ide na zalihu prije ulaza).
    const vracene = promjeneUProdaji(db, prije);
    const nivelacijePrimke = db.prepare('SELECT id, napomena FROM nivelacije WHERE primkaId = ? ORDER BY id').all(id) as Array<{ id: number; napomena: string | null }>;
    const ponistene = new Set(brojeviNivelacijaPrimke(db, id, vracene.map(c => c.productId)));
    const brojProtu = createNivelacija(null, vracene, napomenaProtunivelacije(`Poništenje primke ${primka.brojPrimke}`, [...ponistene]));

    // Veza na primku (FK) se prekida, a trag ostaje u napomeni.
    const odvoji = db.prepare('UPDATE nivelacije SET primkaId = NULL, napomena = ? WHERE id = ?');
    const brojNiv = db.prepare('SELECT brojNivelacije FROM nivelacije WHERE id = ?');
    for (const n of nivelacijePrimke) {
      const broj = (brojNiv.get(n.id) as { brojNivelacije: string }).brojNivelacije;
      const trag = `Primka ${primka.brojPrimke} obrisana` + (brojProtu && ponistene.has(broj) ? `; cijena vraćena nivelacijom ${brojProtu}` : '');
      odvoji.run(n.napomena ? `${n.napomena}; ${trag}` : trag, n.id);
    }

    db.prepare('DELETE FROM primke WHERE id = ?').run(id);
  }

  /**
   * Pokrene operaciju u transakciji i pročita šta je napravila s cijenama
   * (nivelacije i promjene cijena, vidi rezultatPregleda). `zadrzi` nad tim
   * pregledom odluči: true → transakcija se potvrdi; false → rollback, u bazi
   * ne ostaje ništa — ni dokumenti, ni historija, ni zaliha, ni brojači
   * (sqlite_sequence, broj nivelacije). Greška operacije (validacija) ide
   * pozivaocu kao i bez pregleda.
   */
  function sPregledom<T>(
    operacija: () => T,
    cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'],
    zadrzi: (pregled: PregledCijenaUlaza) => boolean,
  ): { pregled: PregledCijenaUlaza; upisano: true; rezultat: T } | { pregled: PregledCijenaUlaza; upisano: false } {
    const PONISTI = new Error('pregled: poništi');
    let ishod: ReturnType<typeof sPregledom<T>> | undefined;
    try {
      db.transaction(() => {
        const pocetak = pocetakPregleda(db);
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
  const ostajuPriIzmjeni = (data: PrimkaUnos & { id: number }) => () => cijeneKojeOstaju(db, data.id, data.stavke ?? []);

  /**
   * Spremanje/brisanje ulaza. Ekran šalje pregled koji je korisnik potvrdio;
   * operacija se izvrši i u ISTOJ transakciji uporedi s njim (istiPregled). Ako
   * se stanje u međuvremenu promijenilo (prodaja, druga primka, ručna cijena,
   * ponoć, tuđa nivelacija uzela broj), ništa se ne upisuje i vraća se
   * { promijenjeno: true, pregled } s novim pregledom za ponovnu potvrdu.
   * Bez potvrde (stari klijent, skripta) operacija se izvrši bez poređenja.
   */
  function spremiPotvrdjeno<T>(operacija: () => T, cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'], potvrda: unknown): T | PromijenjenoOdPregleda {
    if (potvrda === undefined || potvrda === null) return db.transaction(operacija)();
    const ishod = sPregledom(operacija, cijenaOstaje, pregled => istiPregled(potvrda, pregled));
    return ishod.upisano ? ishod.rezultat : { promijenjeno: true, pregled: ishod.pregled };
  }

  handle('primka:create', (data: PrimkaUnos, potvrda?: unknown) =>
    spremiPotvrdjeno(() => unesiPrimku(data), bezCijenaKojeOstaju, potvrda));
  handle('primka:update', (data: PrimkaUnos & { id: number }, potvrda?: unknown) =>
    spremiPotvrdjeno(() => izmijeniPrimku(data), ostajuPriIzmjeni(data), potvrda));
  // Uspjeh bez povratne vrijednosti (kao i prije); samo odbijanje nosi pregled.
  handle('primka:delete', (id: number, potvrda?: unknown) => {
    const r = spremiPotvrdjeno(() => { obrisiPrimku(id); }, bezCijenaKojeOstaju, potvrda);
    return r ?? undefined;
  });

  // Pregled promjena cijena prije spremanja/brisanja — ista operacija, uvijek
  // poništena; ništa ne upisuje, pa nije u licencnoj blokadi.
  const bezUpisa = (operacija: () => unknown, cijenaOstaje: () => PregledCijenaUlaza['cijenaOstaje'] = bezCijenaKojeOstaju) =>
    sPregledom(operacija, cijenaOstaje, () => false).pregled;
  handle('primka:pregledUnosa', (data: PrimkaUnos) => bezUpisa(() => unesiPrimku(data)));
  handle('primka:pregledIzmjene', (data: PrimkaUnos & { id: number }) => bezUpisa(() => izmijeniPrimku(data), ostajuPriIzmjeni(data)));
  handle('primka:pregledBrisanja', (id: number) => bezUpisa(() => obrisiPrimku(id)));

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
      `).all(from, to);
    }
    return db.prepare(`
      SELECT n.*,
        p.brojPrimke AS primkaBroj,
        (SELECT COUNT(*) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS stavkiCount,
        (SELECT COALESCE(SUM(ns.ukupnaRazlika), 0) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS ukupnaRazlika
      FROM nivelacije n
      LEFT JOIN primke p ON p.id = n.primkaId
      ORDER BY n.datum DESC
    `).all();
  });

  handle('nivelacija:get', (id: number) => {
    const niv = db.prepare(`
      SELECT n.*, p.brojPrimke AS primkaBroj
      FROM nivelacije n
      LEFT JOIN primke p ON p.id = n.primkaId
      WHERE n.id = ?
    `).get(id) as any;
    if (!niv) throw new Error('Nivelacija ne postoji');

    niv.stavke = db.prepare(`
      SELECT ns.*, p.naziv AS productNaziv, p.sifra AS productSifra, p.jm AS productJm
      FROM nivelacija_stavke ns
      LEFT JOIN products p ON p.id = ns.productId
      WHERE ns.nivelacijaId = ?
    `).all(id);

    return niv;
  });

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
      .all();
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
      .get(id) as any;

    if (!order) throw new Error('Račun ne postoji');

    order.stavke = db
      .prepare(`
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?
      `)
      .all(id);

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

  handle('order:createManual', (unos: {
    ukupno: number; pdvIznos: number;
    nacinPlacanja: string; brojFiskalnogRacuna: string; createdAt: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    const data = { ...unos, korisnikId: korisnik().id };
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
    if (!data.brojFiskalnogRacuna?.trim()) throw new Error('Fiskalni broj je obavezan');
    if (!data.createdAt?.trim()) throw new Error('Datum računa je obavezan');

    const existing = db
      .prepare('SELECT id FROM orders WHERE brojFiskalnogRacuna = ?')
      .get(data.brojFiskalnogRacuna.trim());
    if (existing) throw new Error('Fiskalni račun sa tim brojem već postoji');

    const createManual = db.transaction(() => {
      const result = db
        .prepare(`
          INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
            kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, createdAt)
          VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 1, ?)
        `)
        .run(
          data.korisnikId, data.ukupno, data.pdvIznos, data.nacinPlacanja, data.brojFiskalnogRacuna.trim(),
          data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
          data.kupac?.grad || null, data.kupac?.postanskiBroj || null, data.createdAt
        );

      const orderId = result.lastInsertRowid;

      const insertItem = db.prepare(
        'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, ?)"
      );

      for (const item of data.stavke) {
        insertItem.run(orderId, item.productId, item.kolicina, item.cijena, item.rabat, item.pdvStopa);
        // Only create stock movements for artikli, not services
        const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(item.productId) as { tip: string } | undefined;
        if (!product || product.tip !== 'usluga') {
          insertStock.run(item.productId, item.kolicina, orderId, data.createdAt);
        }
      }

      return { id: orderId };
    });

    return createManual();
  });

  handle('order:finalize', async (unos: {
    ukupno: number; pdvIznos: number; nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    napomena?: string;
    stavke: Array<{ productId: number; sifra: string; naziv: string; jm: string; plu?: number;
      cijena: number; kolicina: number; rabat: number; pdvStopa: string }>;
  }) => {
    // Račun izdaje prijavljeni korisnik — korisnikId iz payload-a se ne čita.
    const data = { ...unos, korisnikId: korisnik().id };
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');

    // 1. Write-ahead: persist the snapshot BEFORE printing (committed immediately).
    const pending = db
      .prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
      .run(data.korisnikId, JSON.stringify(data));
    const pendingId = pending.lastInsertRowid as number;

    // 2. Print.
    loadTringConfig();
    const racun = buildTringRacun({ ...data, items: data.stavke });
    if (Tring.isLoggingEnabled()) console.log('[Tring] finalize request:', JSON.stringify(racun));
    const result = await Tring.stampatiFiskalniRacun(racun);
    if (Tring.isLoggingEnabled()) console.log('[Tring] finalize response:', JSON.stringify(result));

    // 3b. Print failed → nothing was printed, drop the pending row.
    if (!result || !result.success) {
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
      return {
        success: false,
        error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
        odgovori: result?.odgovori ?? {},
      };
    }

    // 3a. Print succeeded → create order + delete pending row atomically.
    const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;
    const finalizeTx = db.transaction(() => {
      const orderId = insertCompletedOrder(db, { ...data, brojFiskalnogRacuna, isManual: 0 });
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
      return orderId;
    });
    const orderId = finalizeTx();

    return { success: true, id: orderId, brojFiskalnogRacuna, odgovori: result.odgovori };
  });

  // Račun po prilogu: jedna zbirna stavka na fiskalnom računu, stvarne stavke
  // se dodjeljuju naknadno. Orkestracija živi u lib/prilog.ts (testabilna).
  handle('order:finalizePrilog', async (unos: {
    iznos?: number; nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke?: PrilogStavkaUnos[];
    prilogOpis?: string; prilogVeza?: string;
    datumValute?: string | null; napomena?: string | null; ponudaId?: number | null;
  }) => {
    const data = { ...unos, korisnikId: korisnik().id };
    loadTringConfig();
    return finalizePrilogAndPrint({
      db,
      transaction: (fn) => db.transaction(fn),
      print: async (racun) => {
        if (Tring.isLoggingEnabled()) console.log('[Tring] finalizePrilog request:', JSON.stringify(racun));
        const result = await Tring.stampatiFiskalniRacun(racun);
        if (Tring.isLoggingEnabled()) console.log('[Tring] finalizePrilog response:', JSON.stringify(result));
        return result;
      },
    }, data);
  });

  // Fiskalni niz: račun po prilogu mora znati broj isječka prije nego ga odštampa.
  handle('fiscal:getNumeracija', () => ({
    zadnjiUBazi: zadnjiFiskalniBroj(db),
    zadnjiUpisani: zadnjiUpisaniFiskalniBroj(db),
    predvidjeni: predvidjeniFiskalniBroj(db),
  }));

  handle('fiscal:setZadnjiBroj', (broj: number) => {
    postaviZadnjiFiskalniBroj(db, broj);
    return { success: true, predvidjeni: predvidjeniFiskalniBroj(db) };
  });

  handle('prilog:getStavke', (orderId: number) => {
    return db.prepare(`
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.tip AS productTip
      FROM prilog_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.orderId = ?
      ORDER BY ps.id
    `).all(orderId);
  });

  handle('prilog:saveStavke', (orderId: number, stavke: PrilogStavkaUnos[]) => {
    db.transaction(() => savePrilogStavkeInTransaction(db, orderId, stavke))();
    return { success: true };
  });

  handle('order:setDatumValute', (id: number, datum: string | null) => {
    return { datumValute: postaviDatumValute(db, id, datum) };
  });

  // Orkestracija (štampa → atomični upis) živi u lib/refund.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('order:refundAndPrint', async (data: {
    id: number; brojReklamacije?: string; dozvoliPolog?: boolean; adminPin?: string;
  }) => {
    const k = korisnik();
    // Kasir uz uključen "PIN za reklamaciju" šalje admin PIN u istom pozivu;
    // provjera je ovdje, prije štampe — odvojeni verifyAdminPin korak renderer
    // može preskočiti.
    if (postavka('kasa.requirePinRefund') === 'true' && k.uloga !== 'admin') {
      if (!data?.adminPin) throw new Error('Reklamacija traži PIN administratora');
      provjeriAdminPin(data.adminPin);
    }
    loadTringConfig();
    return refundAndPrint({
      db,
      transaction: (fn) => db.transaction(fn),
      print: async (racun) => {
        if (Tring.isLoggingEnabled()) console.log('[Tring] refundAndPrint request:', JSON.stringify(racun));
        const result = await Tring.stampatiReklamiraniRacun(racun);
        if (Tring.isLoggingEnabled()) console.log('[Tring] refundAndPrint response:', JSON.stringify(result));
        return result;
      },
      drawerState: () => getDrawerState(db),
      // Override iz UI-ja: manjak se evidentira kao pravi polog (Tring
      // UnosNovca + cash_movements) da uređaj dozvoli gotovinski storno.
      depositCash: async (iznos, napomena) => {
        const res = await addCashMovement(cashDeps(), {
          tip: 'polog', iznos, korisnikId: k.id, napomena,
        });
        if (res.tringStatus === 'error') {
          throw new Error(`Polog od ${iznos} KM nije prihvaćen na printeru: ${res.error ?? 'nepoznata greška'}`);
        }
      },
      // Pokriće koje fizički ne ulazi u ladicu — samo brojač uređaja.
      deviceCashIn: async (iznos) => {
        loadTringConfig();
        const res = await Tring.unosNovca(iznos);
        if (Tring.isLoggingEnabled()) console.log('[Tring] deviceCashIn:', JSON.stringify(res));
        if (!res.success) {
          throw new Error(`Unos novca od ${iznos} KM nije prihvaćen na printeru: ${res.error || res.vrstaOdgovora}`);
        }
      },
    }, data);
  });

  handle('pending:list', () => {
    const rows = db
      .prepare('SELECT id, korisnikId, snapshot, createdAt FROM pending_receipts ORDER BY id')
      .all() as Array<{ id: number; korisnikId: number; snapshot: string; createdAt: string }>;
    return rows.map(r => ({
      id: r.id, korisnikId: r.korisnikId, createdAt: r.createdAt, snapshot: JSON.parse(r.snapshot),
    }));
  });

  handle('pending:resolve', (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => {
    if (!data.brojFiskalnogRacuna?.trim()) throw new Error('Fiskalni broj je obavezan');
    if (!data.createdAt?.trim()) throw new Error('Datum računa je obavezan');

    const row = db.prepare('SELECT snapshot FROM pending_receipts WHERE id = ?').get(data.id) as { snapshot: string } | undefined;
    if (!row) throw new Error('Zapis više ne postoji');
    const snap = JSON.parse(row.snapshot);

    const existing = db.prepare('SELECT id FROM orders WHERE brojFiskalnogRacuna = ?').get(data.brojFiskalnogRacuna.trim());
    if (existing) throw new Error('Fiskalni račun sa tim brojem već postoji');

    const resolveTx = db.transaction(() => {
      const orderId = insertCompletedOrder(db, {
        ...snap,
        brojFiskalnogRacuna: data.brojFiskalnogRacuna.trim(),
        // Prilog račun: broj fakture je BF koji operater ovdje ukuca; rezervni
        // broj iz snapshota ostaje samo kad BF nije numerički.
        prilogBroj: snap.prilogBroj == null
          ? null
          : parseFiskalniBroj(data.brojFiskalnogRacuna.trim()) ?? snap.prilogBroj,
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
      db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(data.id);
      return orderId;
    });
    return { id: resolveTx() };
  });

  handle('pending:discard', (id: number) => {
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(id);
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
    if (!dismissed.includes(broj)) dismissed.push(broj);
    db.prepare("INSERT INTO settings (key, value) VALUES ('fiscal.dismissedGaps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(dismissed));
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
    `).all();
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
    `).get(id) as any;
    if (!ponuda) throw new Error('Ponuda ne postoji');

    ponuda.stavke = db.prepare(`
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
      FROM ponuda_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.ponudaId = ?
    `).all(id);

    return ponuda;
  });

  handle('ponuda:nextBroj', () => {
    const godina = new Date().getFullYear();
    return { broj: nextBrojPonude(db, godina), godina };
  });

  handle('ponuda:create', (unos: {
    kupacId: number; datum?: string; vaziDo?: string; napomena?: string;
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    const data = { ...unos, korisnikId: korisnik().id };
    const tx = db.transaction(() => createPonuda(db, data));
    return tx();
  });

  handle('ponuda:update', (id: number, data: {
    kupacId?: number; datum?: string; vaziDo?: string; napomena?: string;
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    const tx = db.transaction(() => updatePonuda(db, id, data));
    tx();
    return { success: true };
  });

  handle('ponuda:setStatus', (id: number, status: PonudaStatus) => {
    setStatusPonude(db, id, status);
    return { success: true };
  });

  handle('ponuda:delete', (id: number) => {
    return db.transaction(() => deletePonuda(db, id))();
  });

  // Orkestracija (štampa → atomični upis) živi u lib/ponuda.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('ponuda:konvertuj', async (unos: { id: number; nacinPlacanja: string }) => {
    const data = { ...unos, korisnikId: korisnik().id };
    loadTringConfig();
    return konvertujPonudu({
      db,
      transaction: (fn) => db.transaction(fn),
      print: async (racun) => {
        if (Tring.isLoggingEnabled()) console.log('[Tring] ponuda:konvertuj request:', JSON.stringify(racun));
        const result = await Tring.stampatiFiskalniRacun(racun);
        if (Tring.isLoggingEnabled()) console.log('[Tring] ponuda:konvertuj response:', JSON.stringify(result));
        return result;
      },
    }, data);
  });

  // ─── Proizvodnja ─────────────────────────────────────────

  handle('nalog:getAll', (filter?: string) =>
    listNalozi(db, filter ? { status: filter as any } : undefined));

  handle('nalog:get', (id: number) => getNalog(db, id));

  handle('nalog:nextBroj', () => {
    const godina = new Date().getFullYear();
    return { broj: nextBrojNaloga(db, godina), godina };
  });

  handle('nalog:create', (unos: any) => {
    const data = { ...unos, korisnikId: korisnik().id };
    return db.transaction(() => createNalog(db, data))();
  });

  handle('nalog:createIzPonude', (ponudaId: number) => {
    const korisnikId = korisnik().id;
    return db.transaction(() => createNalogIzPonude(db, ponudaId, korisnikId))();
  });

  handle('nalog:zaPonudu', (ponudaId: number) => nalogZaPonudu(db, ponudaId));

  handle('nalog:update', (id: number, data: any) => {
    updateNalog(db, id, data);
    return { success: true };
  });

  handle('nalog:replaceStavke', (id: number, stavke: any[]) => {
    db.transaction(() => replaceStavke(db, id, stavke))();
    return { success: true };
  });

  handle('nalog:setStatus', (data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati' }) => {
    if (data.status === 'u_izradi') setStatusNaloga(db, data.id, 'u_izradi');
    else if (data.status === 'zavrsen') db.transaction(() => zavrsiNalog(db, data.id))();
    else if (data.status === 'vrati') {
      if (korisnik().uloga !== 'admin') throw new Error('Vraćanje naloga u izradu može samo administrator');
      db.transaction(() => vratiUIzradu(db, data.id))();
    } else throw new Error('Nepoznat status');
    return { success: true };
  });

  handle('nalog:delete', (id: number) => {
    db.transaction(() => deleteNalog(db, id))();
    return { success: true };
  });

  handle('nalog:kalkulacija', (id: number) => kalkulacijaNaloga(db, id));

  handle('nalog:izdajRacun', async (unos: { id: number; nacinPlacanja: string }) => {
    const data = { ...unos, korisnikId: korisnik().id };
    loadTringConfig();
    return izdajRacunZaNalog({
      db,
      transaction: (fn) => db.transaction(fn),
      print: async (racun) => {
        if (Tring.isLoggingEnabled()) console.log('[Tring] nalog:izdajRacun request:', JSON.stringify(racun));
        const result = await Tring.stampatiFiskalniRacun(racun);
        if (Tring.isLoggingEnabled()) console.log('[Tring] nalog:izdajRacun response:', JSON.stringify(result));
        return result;
      },
    }, data);
  });

  handle('normativ:get', (productId: number) => getNormativ(db, productId));

  handle('normativ:save', (productId: number, stavke: any[]) => {
    db.transaction(() => saveNormativ(db, productId, stavke))();
    return { success: true };
  });

  handle('proizvodnja:setEnabled', (enabled: boolean) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('proizvodnja.enabled', String(enabled));
    if (enabled) osigurajProdajnuUslugu(db);
    return { success: true };
  });

  // ─── Settings ────────────────────────────────────────────

  handle('settings:getTring', () => {
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'tring.%'")
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, any> = {};
    for (const row of rows) {
      const shortKey = row.key.replace('tring.', '');
      settings[shortKey] = row.value;
    }

    // Lozinka operatera ne izlazi iz main procesa — UI zna samo da li je upisana.
    return {
      host: settings.host ?? 'localhost',
      port: parseInt(settings.port ?? '8085', 10),
      operatorId: parseInt(settings.operatorId ?? '0', 10),
      imaLozinku: (settings.operatorPassword ?? '') !== '',
    };
  });

  handle('settings:saveTring', (data: { host: string; port: number; operatorId: number; operatorPassword?: string | null }) => {
    if (!data.host?.trim()) throw new Error('Host je obavezan');
    if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
      throw new Error('Port mora biti cijeli broj između 1 i 65535');
    }
    if (!Number.isInteger(data.operatorId) || data.operatorId < 0) {
      throw new Error('Operator ID mora biti nenegativan cijeli broj');
    }
    const save = db.transaction(() => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('tring.host', data.host);
      upsert.run('tring.port', String(data.port));
      upsert.run('tring.operatorId', String(data.operatorId));
      // Prazna lozinka = stara ostaje (UI je ne zna, pa je ni ne šalje nazad).
      if (typeof data.operatorPassword === 'string' && data.operatorPassword !== '') {
        upsert.run('tring.operatorPassword', data.operatorPassword);
      }
    });
    save();
    return { success: true };
  });

  handle('settings:getFirma', () => {
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'firma.%'")
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key.replace('firma.', '')] = row.value;
    }

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
  handle('settings:set', (key: string, value: string) => {
    if (typeof value !== 'string') throw new Error('Vrijednost postavke mora biti tekst');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
    return { success: true };
  });

  // ─── Spremljene košarice ─────────────────────────────────

  handle('savedCarts:list', () => listSavedCarts(db));

  handle('savedCarts:save', (naziv: string, items: SavedCartItem[], ukupno: number) => {
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

  handle('settings:saveFirma', (data: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
    web?: string; email?: string; logoVelicina?: number; ziroRacuniPozicija?: string;
    bankAccounts?: Array<{ bankName: string; accountNumber: string }>;
  }) => {
    const save = db.transaction(() => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('firma.naziv', data.naziv);
      upsert.run('firma.adresa', data.adresa);
      upsert.run('firma.grad', data.grad);
      upsert.run('firma.idBroj', data.idBroj);
      upsert.run('firma.pdvBroj', data.pdvBroj);
      upsert.run('firma.skladiste', data.skladiste);
      upsert.run('firma.logo', data.logo);
      upsert.run('firma.web', data.web ?? '');
      upsert.run('firma.email', data.email ?? '');
      upsert.run('firma.logoVelicina', String(logoVelicina(data)));
      upsert.run('firma.ziroRacuniPozicija', ziroRacuniPozicija(data));

      const accounts = data.bankAccounts ?? [];
      for (let i = 0; i < 3; i++) {
        const a = accounts[i] ?? { bankName: '', accountNumber: '' };
        upsert.run(`firma.bank${i + 1}.name`, a.bankName ?? '');
        upsert.run(`firma.bank${i + 1}.number`, a.accountNumber ?? '');
      }
    });
    save();
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
        .all(from, to);
    }

    if (type === 'primke') {
      const primke = db
        .prepare(`
          SELECT p.*
          FROM primke p
          WHERE date(p.datum) BETWEEN date(?) AND date(?)
          ORDER BY p.datum DESC
        `)
        .all(from, to) as any[];

      // Attach stavke for each primka so the UI can calculate nabavna/prodajna per-item
      for (const primka of primke) {
        primka.stavke = db
          .prepare('SELECT * FROM primka_stavke WHERE primkaId = ?')
          .all(primka.id);
      }
      return primke;
    }

    throw new Error(`Nepoznat tip izvještaja: ${type}`);
  });

  // Izvoz za knjigovođu: sirovi redovi za period, obračun je u rendereru.
  handle('izvoz:knjigovodja', (od: string, doDatum: string) => dohvatiKnjigovodja(db, od, doDatum));

  // ─── Nivelacija Helpers ─────────────────────────────────

  function getNextBrojNivelacije(): string {
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
   * null kad nema stavki.
   */
  function createNivelacija(primkaId: number | bigint | null, priceDiffs: PriceChange[], napomena: string | null): string | null {
    if (priceDiffs.length === 0) return null;

    const brojNivelacije = getNextBrojNivelacije();
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

  // ─── Tring ──────────────────────────────────────────────

  // Load Tring settings from DB and configure the Tring client
  function loadTringConfig(): { operatorId: number; operatorPassword: string } {
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'tring.%'")
      .all() as Array<{ key: string; value: string }>;

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key.replace('tring.', '')] = row.value;
    }

    Tring.configure({
      host: map.host ?? 'localhost',
      port: parseInt(map.port ?? '8085', 10),
    });

    // Load dev logging setting
    const devLogging = db.prepare("SELECT value FROM settings WHERE key = 'dev.logging'").get() as { value: string } | undefined;
    Tring.setLoggingEnabled(devLogging?.value === 'true');

    return {
      operatorId: parseInt(map.operatorId ?? '0', 10),
      operatorPassword: map.operatorPassword ?? '0',
    };
  }

  handle('tring:init', async () => {
    const { operatorId, operatorPassword } = loadTringConfig();
    const result = await Tring.inicijalizacija(operatorId, operatorPassword);
    if (Tring.isLoggingEnabled()) console.log('[Tring] init:', JSON.stringify(result));
    return result;
  });

  handle('tring:xReport', async () => {
    loadTringConfig();
    const result = await Tring.stampatiPresjekStanja();
    if (Tring.isLoggingEnabled()) console.log('[Tring] xReport:', JSON.stringify(result));
    return result;
  });

  handle('tring:zReport', async () => {
    loadTringConfig();
    const result = await Tring.stampatiDnevniIzvjestaj();
    if (Tring.isLoggingEnabled()) console.log('[Tring] zReport:', JSON.stringify(result));
    return result;
  });

  handle('tring:periodicReport', async (from: string, to: string) => {
    loadTringConfig();
    const result = await Tring.stampatiPeriodicniIzvjestaj(from, to);
    if (Tring.isLoggingEnabled()) console.log('[Tring] periodicReport:', JSON.stringify(result));
    return result;
  });

  // Službeni unos/iznos gotovine (polog). Deps obrazac kao refundAndPrint —
  // logika i upis žive u lib/cash.ts da budu testabilni bez Electrona.
  const cashDeps = () => {
    loadTringConfig();
    return {
      db,
      send: async (tip: 'polog' | 'povrat', iznos: number) => {
        const result = tip === 'polog' ? await Tring.unosNovca(iznos) : await Tring.povratNovca(iznos);
        if (Tring.isLoggingEnabled()) console.log(`[Tring] ${tip}:`, JSON.stringify(result));
        return result;
      },
    };
  };

  handle('cash:add', (data: { tip: 'polog' | 'povrat'; iznos: number; napomena?: string }) =>
    addCashMovement(cashDeps(), { ...data, korisnikId: korisnik().id }));

  handle('cash:retry', (id: number) => retryCashMovement(cashDeps(), id));

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

  handle('dialog:saveFile', async (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: data.defaultName,
      filters: data.filters,
    });
    // Otkazan dijalog poništava i ranije odobrenje — upisiva je samo putanja
    // iz zadnjeg dijaloga.
    lastApprovedSavePath = null;
    if (!result.canceled && result.filePath) {
      lastApprovedSavePath = result.filePath;
      return result.filePath;
    }
    return null;
  });

  handle('fs:writeFile', (data: { path: string; buffer: number[] }) => {
    if (data.path !== lastApprovedSavePath) {
      throw new Error('Write path not approved by save dialog');
    }
    lastApprovedSavePath = null;
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
    if (result.canceled || !result.filePath) return null;

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
