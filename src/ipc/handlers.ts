import { ipcMain, dialog, app } from 'electron';
import { writeFileSync, copyFileSync } from 'fs';
import path from 'node:path';
import { getDb, closeDb } from '../database/db';
import { validateBackup, swapInBackup, type RestoreDeps } from '../database/restore';
import { parseFiskalniBroj, izracunajPraznine } from '../lib/fiskalni';
import { round2, localDateStr } from '../lib/novac';
import {
  collectPriceChanges, applyPricesWithoutStock, revertNivelacijaPrices,
  isDobavljacUsed, type PriceChange,
} from '../lib/skladiste';
import { refundOrderInTransaction, refundAndPrint } from '../lib/refund';
import { saveCart, listSavedCarts, deleteSavedCart } from '../lib/savedCarts';
import type { SavedCartItem } from '../lib/kosarica';
import {
  nextBrojPonude, createPonuda, updatePonuda, setStatusPonude, konvertujPonudu,
  type PonudaStatus,
} from '../lib/ponuda';
import { buildTringRacun, buildTringReklamacija } from '../lib/tringRacun';
import { addCashMovement, retryCashMovement, getTodayMovements, getDrawerState, getLastPologIznos } from '../lib/cash';
import * as Tring from '../services/tring';
import Database from 'better-sqlite3';

function handle<T>(channel: string, handler: (...args: any[]) => T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      // `await` je obavezan: bez njega odbijeni promise async handlera
      // promaši catch ispod i renderer dobije neobrađenu Electron grešku.
      return await handler(...args);
    } catch (error: any) {
      console.error(`[IPC ${channel}]`, error);
      throw new Error(error.message || 'Nepoznata greška');
    }
  });
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
  }
): number {
  const isManual = data.isManual ?? 0;
  const hasCreatedAt = typeof data.createdAt === 'string' && data.createdAt.length > 0;

  const result = db
    .prepare(`
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
        kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual${hasCreatedAt ? ', createdAt' : ''})
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?${hasCreatedAt ? ', ?' : ''})
    `)
    .run(
      data.korisnikId, data.ukupno, data.pdvIznos, data.nacinPlacanja, data.brojFiskalnogRacuna,
      data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
      data.kupac?.grad || null, data.kupac?.postanskiBroj || null, isManual,
      ...(hasCreatedAt ? [data.createdAt] : [])
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
  const db = getDb();

  // ─── Users ───────────────────────────────────────────────

  handle('user:login', (pin: string) => {
    return db.prepare('SELECT id, ime, pin, uloga FROM users WHERE pin = ?').get(pin) ?? null;
  });

  handle('user:verifyAdminPin', (pin: string) => {
    const user = db.prepare("SELECT id, ime FROM users WHERE pin = ? AND uloga = 'admin'").get(pin) as any;
    if (!user) throw new Error('Neispravan admin PIN');
    return { success: true, ime: user.ime };
  });

  handle('user:getAll', () => {
    return db.prepare('SELECT * FROM users ORDER BY ime').all();
  });

  handle('user:create', (data: { ime: string; pin: string; uloga: string }) => {
    if (!data.ime?.trim()) throw new Error('Ime korisnika je obavezno');
    if (!data.pin?.trim()) throw new Error('PIN je obavezan');
    if (data.pin.length < 4) throw new Error('PIN mora imati najmanje 4 cifre');
    const existingPin = db.prepare('SELECT id FROM users WHERE pin = ?').get(data.pin);
    if (existingPin) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
    const result = db
      .prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)')
      .run(data.ime.trim(), data.pin, data.uloga);
    return { id: result.lastInsertRowid };
  });

  handle('user:update', (id: number, data: { ime?: string; pin?: string; uloga?: string }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.ime !== undefined) {
      if (!data.ime.trim()) throw new Error('Ime korisnika je obavezno');
      fields.push('ime = ?'); values.push(data.ime.trim());
    }
    if (data.pin !== undefined) {
      if (data.pin.length < 4) throw new Error('PIN mora imati najmanje 4 cifre');
      const existingPin = db.prepare('SELECT id FROM users WHERE pin = ? AND id != ?').get(data.pin, id);
      if (existingPin) throw new Error(`Korisnik sa PIN-om "${data.pin}" već postoji`);
      fields.push('pin = ?'); values.push(data.pin);
    }
    if (data.uloga !== undefined) { fields.push('uloga = ?'); values.push(data.uloga); }

    if (fields.length === 0) return { changes: 0 };

    values.push(id);
    const result = db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
  });

  handle('user:delete', (id: number) => {
    const hasOrders = db.prepare('SELECT id FROM orders WHERE korisnikId = ? LIMIT 1').get(id);
    if (hasOrders) throw new Error('Korisnik ima račune i ne može biti obrisan');
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { changes: result.changes };
  });

  // ─── Products ────────────────────────────────────────────

  handle('product:getAll', (tip?: string) => {
    const where = tip ? `WHERE p.tip = '${tip === 'usluga' ? 'usluga' : 'artikal'}'` : '';
    return db
      .prepare(`
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje
        FROM products p
        ${where}
        ORDER BY p.naziv
      `)
      .all();
  });

  handle('product:get', (id: number) => {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  });

  handle('product:create', (data: {
    sifra: string; naziv: string; jm?: string; cijena: number;
    pdvStopa: string; plu?: number; barkod?: string; tip?: string;
  }) => {
    if (!data.sifra?.trim()) throw new Error('Šifra artikla je obavezna');
    if (!data.naziv?.trim()) throw new Error('Naziv artikla je obavezan');
    if (data.cijena == null || data.cijena < 0) throw new Error('Cijena mora biti pozitivan broj');
    const existing = db.prepare('SELECT id FROM products WHERE sifra = ?').get(data.sifra.trim());
    if (existing) throw new Error(`Artikal sa šifrom "${data.sifra}" već postoji`);
    if (data.barkod?.trim()) {
      const existingBarkod = db.prepare('SELECT id FROM products WHERE barkod = ?').get(data.barkod.trim());
      if (existingBarkod) throw new Error(`Artikal sa barkodom "${data.barkod}" već postoji`);
    }
    const tip = data.tip === 'usluga' ? 'usluga' : 'artikal';
    const result = db
      .prepare(`
        INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(data.sifra, data.naziv, data.jm ?? (tip === 'usluga' ? 'usl' : 'kom'), data.cijena, data.pdvStopa, data.plu ?? null, data.barkod ?? null, tip);
    return { id: result.lastInsertRowid };
  });

  handle('product:update', (id: number, data: {
    sifra?: string; naziv?: string; jm?: string; cijena?: number;
    pdvStopa?: string; plu?: number; barkod?: string | null; tip?: string;
  }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.sifra !== undefined) {
      const existing = db.prepare('SELECT id FROM products WHERE sifra = ? AND id != ?').get(data.sifra, id);
      if (existing) throw new Error(`Artikal sa šifrom "${data.sifra}" već postoji`);
      fields.push('sifra = ?'); values.push(data.sifra);
    }
    if (data.naziv !== undefined) { fields.push('naziv = ?'); values.push(data.naziv); }
    if (data.jm !== undefined) { fields.push('jm = ?'); values.push(data.jm); }
    if (data.cijena !== undefined) { fields.push('cijena = ?'); values.push(data.cijena); }
    if (data.pdvStopa !== undefined) { fields.push('pdvStopa = ?'); values.push(data.pdvStopa); }
    if (data.plu !== undefined) { fields.push('plu = ?'); values.push(data.plu); }
    if ('barkod' in data) {
      if (data.barkod?.trim()) {
        const existingBarkod = db.prepare('SELECT id FROM products WHERE barkod = ? AND id != ?').get(data.barkod.trim(), id);
        if (existingBarkod) throw new Error(`Artikal sa barkodom "${data.barkod}" već postoji`);
      }
      fields.push('barkod = ?'); values.push(data.barkod);
    }
    if (data.tip !== undefined) { fields.push('tip = ?'); values.push(data.tip === 'usluga' ? 'usluga' : 'artikal'); }

    if (fields.length === 0) return { changes: 0 };

    fields.push("updatedAt = datetime('now','localtime')");
    values.push(id);

    const result = db
      .prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
  });

  handle('product:delete', (id: number) => {
    const inOrders = db.prepare('SELECT id FROM order_items WHERE productId = ? LIMIT 1').get(id);
    if (inOrders) throw new Error('Artikal se koristi u računima i ne može biti obrisan');
    const inPrimke = db.prepare('SELECT id FROM primka_stavke WHERE productId = ? LIMIT 1').get(id);
    if (inPrimke) throw new Error('Artikal se koristi u primkama i ne može biti obrisan');
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
    return { changes: result.changes };
  });

  handle('product:adjustStock', (productId: number, newStanje: number) => {
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
          ) AS stanje
        FROM products p
        WHERE p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?
        ORDER BY p.naziv
      `)
      .all(like, like, like);
  });

  // ─── Dobavljači ─────────────────────────────────────────

  handle('dobavljac:getAll', () => {
    return db.prepare('SELECT * FROM dobavljaci ORDER BY naziv').all();
  });

  handle('dobavljac:create', (data: {
    naziv: string; idBroj?: string; pdvBroj?: string; adresa?: string; kontakt?: string;
  }) => {
    if (!data.naziv?.trim()) throw new Error('Naziv dobavljača je obavezan');
    const result = db
      .prepare('INSERT INTO dobavljaci (naziv, idBroj, pdvBroj, adresa, kontakt) VALUES (?, ?, ?, ?, ?)')
      .run(data.naziv.trim(), data.idBroj ?? null, data.pdvBroj ?? null, data.adresa ?? null, data.kontakt ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('dobavljac:update', (id: number, data: {
    naziv?: string; idBroj?: string; pdvBroj?: string; adresa?: string; kontakt?: string;
  }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.naziv !== undefined) { fields.push('naziv = ?'); values.push(data.naziv); }
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

  handle('kupac:create', (data: {
    naziv: string; idBroj: string; pdvBroj?: string; adresa?: string;
    postanskiBroj?: string; grad?: string; kontakt?: string;
  }) => {
    if (!data.naziv?.trim()) throw new Error('Naziv kupca je obavezan');
    if (!data.idBroj?.trim()) throw new Error('ID broj (JIB) kupca je obavezan');
    const existingJib = db.prepare('SELECT id FROM kupci WHERE idBroj = ?').get(data.idBroj.trim());
    if (existingJib) throw new Error(`Kupac sa JIB-om "${data.idBroj}" već postoji`);
    const result = db
      .prepare('INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(data.naziv.trim(), data.idBroj.trim(), data.pdvBroj ?? null, data.adresa ?? null, data.postanskiBroj ?? null, data.grad ?? null, data.kontakt ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('kupac:update', (id: number, data: {
    naziv?: string; idBroj?: string; pdvBroj?: string; adresa?: string;
    postanskiBroj?: string; grad?: string; kontakt?: string;
  }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.naziv !== undefined) { fields.push('naziv = ?'); values.push(data.naziv); }
    if (data.idBroj !== undefined) {
      const existingJib = db.prepare('SELECT id FROM kupci WHERE idBroj = ? AND id != ?').get(data.idBroj, id);
      if (existingJib) throw new Error(`Kupac sa JIB-om "${data.idBroj}" već postoji`);
      fields.push('idBroj = ?'); values.push(data.idBroj);
    }
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

  handle('primka:create', (data: {
    brojPrimke: string; datum?: string; napomena?: string; brojFakture?: string;
    dobavljacNaziv?: string; dobavljacId?: string; dobavljacAdresa?: string;
    stavke: Array<{ productId: number; kolicina: number; cijena: number; nabavnaCijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.brojPrimke?.trim()) throw new Error('Broj primke je obavezan');
    if (!data.stavke || data.stavke.length === 0) throw new Error('Primka mora imati najmanje jednu stavku');
    const existingPrimka = db.prepare('SELECT id FROM primke WHERE brojPrimke = ?').get(data.brojPrimke.trim());
    if (existingPrimka) throw new Error(`Primka sa brojem "${data.brojPrimke}" već postoji`);
    const createPrimka = db.transaction(() => {
      const datum = data.datum || localDateStr();
      const result = db
        .prepare('INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(data.brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null);

      const primkaId = result.lastInsertRowid;

      const insertStavka = db.prepare(
        'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)"
      );

      // Collect price diffs BEFORE inserting stock (so stock reflects pre-delivery state)
      const { nivelacija, bezZaliha } = collectPriceChanges(db, data.stavke);

      // Now insert stavke and stock movements
      for (const stavka of data.stavke) {
        insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, primkaId);
      }

      applyPricesWithoutStock(db, bezZaliha);
      createNivelacijaInTransaction(primkaId, nivelacija);

      return { id: primkaId, nivelacijaCreated: nivelacija.length > 0 };
    });

    return createPrimka();
  });

  handle('primka:update', (data: {
    id: number;
    brojPrimke: string; datum?: string; napomena?: string; brojFakture?: string;
    dobavljacNaziv?: string; dobavljacId?: string; dobavljacAdresa?: string;
    stavke: Array<{ productId: number; kolicina: number; cijena: number; nabavnaCijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    const updatePrimka = db.transaction(() => {
      const datum = data.datum || localDateStr();

      db.prepare('UPDATE primke SET brojPrimke = ?, datum = ?, dobavljacNaziv = ?, dobavljacId = ?, dobavljacAdresa = ?, napomena = ?, brojFakture = ? WHERE id = ?')
        .run(data.brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null, data.id);

      // Clean up old nivelacija and revert the product prices it changed.
      // Revert samo ako artikal još uvijek stoji na cijeni koju je *ova*
      // primka postavila — inače bismo pregazili kasniju nivelaciju.
      revertNivelacijaPrices(db, data.id);

      db.prepare('DELETE FROM nivelacija_stavke WHERE nivelacijaId IN (SELECT id FROM nivelacije WHERE primkaId = ?)').run(data.id);
      db.prepare('DELETE FROM nivelacije WHERE primkaId = ?').run(data.id);

      // Delete old stavke and stock movements
      db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(data.id);
      db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(data.id);

      // Collect price diffs BEFORE inserting stock, deduplicate by productId
      const insertStavka = db.prepare(
        'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)"
      );

      const { nivelacija, bezZaliha } = collectPriceChanges(db, data.stavke);

      // Now insert stavke and stock movements
      for (const stavka of data.stavke) {
        insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, data.id);
      }

      applyPricesWithoutStock(db, bezZaliha);
      createNivelacijaInTransaction(data.id, nivelacija);

      return { id: data.id, nivelacijaCreated: nivelacija.length > 0 };
    });

    return updatePrimka();
  });

  handle('primka:delete', (id: number) => {
    const deletePrimka = db.transaction(() => {
      // Clean up associated nivelacije
      db.prepare('DELETE FROM nivelacija_stavke WHERE nivelacijaId IN (SELECT id FROM nivelacije WHERE primkaId = ?)').run(id);
      db.prepare('DELETE FROM nivelacije WHERE primkaId = ?').run(id);

      db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(id);
      db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(id);
      db.prepare('DELETE FROM primke WHERE id = ?').run(id);
    });

    return deletePrimka();
  });

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
        SELECT o.*, u.ime AS korisnikIme
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
        ORDER BY o.createdAt DESC
      `)
      .all();
  });

  handle('order:get', (id: number) => {
    const order = db
      .prepare(`
        SELECT o.*, u.ime AS korisnikIme
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
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

    return order;
  });

  handle('order:create', (data: {
    korisnikId: number; ukupno: number; pdvIznos: number;
    nacinPlacanja: string; brojFiskalnogRacuna?: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
    if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
    const createOrder = db.transaction(() => {
      const result = db
        .prepare(`
          INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
            kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj)
          VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
        `)
        .run(
          data.korisnikId, data.ukupno, data.pdvIznos, data.nacinPlacanja, data.brojFiskalnogRacuna ?? null,
          data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
          data.kupac?.grad || null, data.kupac?.postanskiBroj || null
        );

      const orderId = result.lastInsertRowid;

      const insertItem = db.prepare(
        'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)"
      );

      for (const item of data.stavke) {
        insertItem.run(orderId, item.productId, item.kolicina, item.cijena, item.rabat, item.pdvStopa);
        // Only create stock movements for artikli, not services
        const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(item.productId) as { tip: string } | undefined;
        if (!product || product.tip !== 'usluga') {
          insertStock.run(item.productId, item.kolicina, orderId);
        }
      }

      return { id: orderId };
    });

    return createOrder();
  });

  handle('order:createManual', (data: {
    korisnikId: number; ukupno: number; pdvIznos: number;
    nacinPlacanja: string; brojFiskalnogRacuna: string; createdAt: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
    if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
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

  handle('order:finalize', async (data: {
    korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    napomena?: string;
    stavke: Array<{ productId: number; sifra: string; naziv: string; jm: string; plu?: number;
      cijena: number; kolicina: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
    if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');

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

  handle('order:updateReklamacija', (id: number, brojReklamacije: string) => {
    const result = db
      .prepare('UPDATE orders SET brojReklamacije = ? WHERE id = ?')
      .run(brojReklamacije, id);
    return { changes: result.changes };
  });

  handle('order:refund', (id: number, brojReklamacije?: string) => {
    const tx = db.transaction(() => refundOrderInTransaction(db, id, brojReklamacije?.trim() || null));
    tx();
    return { success: true };
  });

  // Orkestracija (štampa → atomični upis) živi u lib/refund.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('order:refundAndPrint', async (data: { id: number; brojReklamacije?: string }) => {
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
        isManual: 1,
        createdAt: data.createdAt,
      });
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

  handle('ponuda:create', (data: {
    kupacId: number; korisnikId: number; datum?: string; vaziDo?: string; napomena?: string;
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
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
    const ponuda = db.prepare('SELECT status FROM ponude WHERE id = ?').get(id) as { status: string } | undefined;
    if (!ponuda) return { changes: 0 };
    if (ponuda.status === 'konvertovana') {
      throw new Error('Konvertovana ponuda se ne može obrisati — po njoj je izdat račun');
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM ponuda_stavke WHERE ponudaId = ?').run(id);
      return db.prepare('DELETE FROM ponude WHERE id = ?').run(id);
    });
    return { changes: tx().changes };
  });

  // Orkestracija (štampa → atomični upis) živi u lib/ponuda.ts da bi bila
  // testabilna nad mock fiskalnim serverom, bez Electron ovisnosti.
  handle('ponuda:konvertuj', async (data: { id: number; korisnikId: number; nacinPlacanja: string }) => {
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

    return {
      host: settings.host ?? 'localhost',
      port: parseInt(settings.port ?? '8085', 10),
      operatorId: parseInt(settings.operatorId ?? '0', 10),
      operatorPassword: settings.operatorPassword ?? '0',
    };
  });

  handle('settings:saveTring', (data: { host: string; port: number; operatorId: number; operatorPassword: string }) => {
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
      upsert.run('tring.operatorPassword', data.operatorPassword);
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
      logo: settings.logo ?? '',
      bankAccounts,
    };
  });

  handle('settings:get', (key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  handle('settings:set', (key: string, value: string) => {
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

  handle('settings:saveFirma', (data: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
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

  function createNivelacijaInTransaction(primkaId: number | bigint, priceDiffs: PriceChange[]): void {
    if (priceDiffs.length === 0) return;

    const brojNivelacije = getNextBrojNivelacije();
    const datum = localDateStr();

    const nivResult = db.prepare(
      'INSERT INTO nivelacije (brojNivelacije, datum, primkaId) VALUES (?, ?, ?)'
    ).run(brojNivelacije, datum, primkaId);

    const nivelacijaId = nivResult.lastInsertRowid;

    const insertStavka = db.prepare(
      'INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const updatePrice = db.prepare(
      "UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?"
    );

    for (const d of priceDiffs) {
      const razlika = d.novaCijena - d.staraCijena;
      const ukupnaRazlika = razlika * d.kolicina;
      insertStavka.run(nivelacijaId, d.productId, d.kolicina, d.staraCijena, d.novaCijena, razlika, ukupnaRazlika, d.pdvStopa);
      updatePrice.run(d.novaCijena, d.productId);
    }
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

  handle('tring:printReceipt', async (data: any) => {
    loadTringConfig();
    const racun = buildTringRacun(data);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt request:', JSON.stringify(racun));
    const result = await Tring.stampatiFiskalniRacun(racun);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt response:', JSON.stringify(result));
    return result;
  });

  handle('tring:printRefund', async (data: any) => {
    loadTringConfig();
    const brojRacuna = parseFiskalniBroj(data.brojRacuna);
    if (brojRacuna === null) {
      throw new Error(`Fiskalni broj "${data.brojRacuna ?? ''}" nije ispravan broj računa`);
    }
    const racun = buildTringReklamacija({ ...data, brojRacuna });
    if (Tring.isLoggingEnabled()) console.log('[Tring] printRefund request:', JSON.stringify(racun));
    const result = await Tring.stampatiReklamiraniRacun(racun);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printRefund response:', JSON.stringify(result));
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

  handle('cash:add', (data: { tip: 'polog' | 'povrat'; iznos: number; korisnikId: number; napomena?: string }) =>
    addCashMovement(cashDeps(), data));

  handle('cash:retry', (id: number) => retryCashMovement(cashDeps(), id));

  handle('cash:getToday', () => getTodayMovements(db));

  handle('cash:lastPolog', () => getLastPologIznos(db));

  handle('cash:drawerState', () => getDrawerState(db));

  handle('tring:writeArticle', async (data: any) => {
    loadTringConfig();
    const result = await Tring.upisiArtikal(data);
    if (Tring.isLoggingEnabled()) console.log('[Tring] writeArticle:', JSON.stringify(result));
    return result;
  });

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

    // Checkpoint WAL to ensure all data is flushed to main DB file
    db.pragma('wal_checkpoint(TRUNCATE)');
    copyFileSync(dbPath, result.filePath);
    return result.filePath;
  });

  // Uvoz backup-a. Handler radi samo dijaloge; sam rad s fajlovima je u
  // `database/restore.ts`. getDb() nakon zamjene odradi schemu + migracije, pa
  // backup iz starije verzije programa radi bez dodatnih koraka.
  const restoreDeps: RestoreDeps = {
    openReadonly: (filePath) => new Database(filePath, { readonly: true, fileMustExist: true }),
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
