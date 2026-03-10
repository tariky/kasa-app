import { ipcMain, dialog, app } from 'electron';
import { writeFileSync, copyFileSync } from 'fs';
import path from 'node:path';
import { getDb } from '../database/db';
import * as Tring from '../services/tring';

function handle<T>(channel: string, handler: (...args: any[]) => T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return handler(...args);
    } catch (error: any) {
      console.error(`[IPC ${channel}]`, error);
      throw new Error(error.message || 'Unknown error');
    }
  });
}

export function registerIpcHandlers(): void {
  const db = getDb();

  // ─── Users ───────────────────────────────────────────────

  handle('user:login', (pin: string) => {
    return db.prepare('SELECT id, ime, pin, uloga FROM users WHERE pin = ?').get(pin) ?? null;
  });

  handle('user:getAll', () => {
    return db.prepare('SELECT * FROM users ORDER BY ime').all();
  });

  handle('user:create', (data: { ime: string; pin: string; uloga: string }) => {
    const result = db
      .prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)')
      .run(data.ime, data.pin, data.uloga);
    return { id: result.lastInsertRowid };
  });

  handle('user:update', (id: number, data: { ime?: string; pin?: string; uloga?: string }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.ime !== undefined) { fields.push('ime = ?'); values.push(data.ime); }
    if (data.pin !== undefined) { fields.push('pin = ?'); values.push(data.pin); }
    if (data.uloga !== undefined) { fields.push('uloga = ?'); values.push(data.uloga); }

    if (fields.length === 0) return { changes: 0 };

    values.push(id);
    const result = db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
    return { changes: result.changes };
  });

  handle('user:delete', (id: number) => {
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

    if (data.sifra !== undefined) { fields.push('sifra = ?'); values.push(data.sifra); }
    if (data.naziv !== undefined) { fields.push('naziv = ?'); values.push(data.naziv); }
    if (data.jm !== undefined) { fields.push('jm = ?'); values.push(data.jm); }
    if (data.cijena !== undefined) { fields.push('cijena = ?'); values.push(data.cijena); }
    if (data.pdvStopa !== undefined) { fields.push('pdvStopa = ?'); values.push(data.pdvStopa); }
    if (data.plu !== undefined) { fields.push('plu = ?'); values.push(data.plu); }
    if ('barkod' in data) { fields.push('barkod = ?'); values.push(data.barkod); }
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
    const result = db
      .prepare('INSERT INTO dobavljaci (naziv, idBroj, pdvBroj, adresa, kontakt) VALUES (?, ?, ?, ?, ?)')
      .run(data.naziv, data.idBroj ?? null, data.pdvBroj ?? null, data.adresa ?? null, data.kontakt ?? null);
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
    const result = db
      .prepare('INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(data.naziv, data.idBroj, data.pdvBroj ?? null, data.adresa ?? null, data.postanskiBroj ?? null, data.grad ?? null, data.kontakt ?? null);
    return { id: result.lastInsertRowid };
  });

  handle('kupac:update', (id: number, data: {
    naziv?: string; idBroj?: string; pdvBroj?: string; adresa?: string;
    postanskiBroj?: string; grad?: string; kontakt?: string;
  }) => {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.naziv !== undefined) { fields.push('naziv = ?'); values.push(data.naziv); }
    if (data.idBroj !== undefined) { fields.push('idBroj = ?'); values.push(data.idBroj); }
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
    const createPrimka = db.transaction(() => {
      const datum = data.datum || new Date().toISOString().split('T')[0];
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
      // Deduplicate by productId — same product may appear on multiple stavke lines
      const priceDiffMap = new Map<number, {
        productId: number; kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string;
      }>();

      for (const stavka of data.stavke) {
        if (priceDiffMap.has(stavka.productId)) continue; // already recorded
        const product = db.prepare('SELECT cijena FROM products WHERE id = ?').get(stavka.productId) as { cijena: number } | undefined;
        if (product && Math.abs(product.cijena - stavka.cijena) > 0.001) {
          const existingStock = getProductStock(stavka.productId);
          if (existingStock > 0) {
            priceDiffMap.set(stavka.productId, {
              productId: stavka.productId,
              kolicina: existingStock,
              staraCijena: product.cijena,
              novaCijena: stavka.cijena,
              pdvStopa: stavka.pdvStopa,
            });
          }
        }
      }

      // Now insert stavke and stock movements
      for (const stavka of data.stavke) {
        insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, primkaId);
      }

      const priceDiffs = Array.from(priceDiffMap.values());

      createNivelacijaInTransaction(primkaId, priceDiffs);

      return { id: primkaId, nivelacijaCreated: priceDiffs.length > 0 };
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
      const datum = data.datum || new Date().toISOString().split('T')[0];

      db.prepare('UPDATE primke SET brojPrimke = ?, datum = ?, dobavljacNaziv = ?, dobavljacId = ?, dobavljacAdresa = ?, napomena = ?, brojFakture = ? WHERE id = ?')
        .run(data.brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.brojFakture ?? null, data.id);

      // Clean up old nivelacija and revert product prices it changed
      const oldNivStavke = db.prepare(`
        SELECT ns.productId, ns.staraCijena
        FROM nivelacija_stavke ns
        JOIN nivelacije n ON n.id = ns.nivelacijaId
        WHERE n.primkaId = ?
      `).all(data.id) as Array<{ productId: number; staraCijena: number }>;

      for (const ons of oldNivStavke) {
        db.prepare("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?")
          .run(ons.staraCijena, ons.productId);
      }

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

      const priceDiffMap = new Map<number, {
        productId: number; kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string;
      }>();

      for (const stavka of data.stavke) {
        if (!priceDiffMap.has(stavka.productId)) {
          const product = db.prepare('SELECT cijena FROM products WHERE id = ?').get(stavka.productId) as { cijena: number } | undefined;
          if (product && Math.abs(product.cijena - stavka.cijena) > 0.001) {
            const existingStock = getProductStock(stavka.productId);
            if (existingStock > 0) {
              priceDiffMap.set(stavka.productId, {
                productId: stavka.productId,
                kolicina: existingStock,
                staraCijena: product.cijena,
                novaCijena: stavka.cijena,
                pdvStopa: stavka.pdvStopa,
              });
            }
          }
        }
      }

      // Now insert stavke and stock movements
      for (const stavka of data.stavke) {
        insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, data.id);
      }

      createNivelacijaInTransaction(data.id, Array.from(priceDiffMap.values()));

      return { id: data.id, nivelacijaCreated: priceDiffMap.size > 0 };
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

  handle('order:updateReklamacija', (id: number, brojReklamacije: string) => {
    const result = db
      .prepare('UPDATE orders SET brojReklamacije = ? WHERE id = ?')
      .run(brojReklamacije, id);
    return { changes: result.changes };
  });

  handle('order:refund', (id: number) => {
    const refundOrder = db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status = 'completed'").get(id) as any;
      if (!order) throw new Error('Račun ne postoji ili je već storniran');

      db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(id);

      const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(id) as any[];

      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'refund', ?)"
      );

      for (const item of items) {
        const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(item.productId) as { tip: string } | undefined;
        if (!product || product.tip !== 'usluga') {
          insertStock.run(item.productId, item.kolicina, id);
        }
      }

      return { success: true };
    });

    return refundOrder();
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

    return {
      naziv: settings.naziv ?? '',
      adresa: settings.adresa ?? '',
      grad: settings.grad ?? '',
      idBroj: settings.idBroj ?? '',
      pdvBroj: settings.pdvBroj ?? '',
      skladiste: settings.skladiste ?? '',
      logo: settings.logo ?? '',
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

  handle('settings:saveFirma', (data: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
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

  function getProductStock(productId: number): number {
    const row = db.prepare(`
      SELECT COALESCE(
        SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
      ) AS stanje
      FROM stock_movements WHERE productId = ?
    `).get(productId) as { stanje: number };
    return row.stanje;
  }

  function createNivelacijaInTransaction(
    primkaId: number | bigint,
    priceDiffs: Array<{
      productId: number;
      kolicina: number;
      staraCijena: number;
      novaCijena: number;
      pdvStopa: string;
    }>
  ): void {
    if (priceDiffs.length === 0) return;

    const brojNivelacije = getNextBrojNivelacije();
    const datum = new Date().toISOString().split('T')[0];

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
    // Transform screen data to Tring Racun format
    const ukupno = data.ukupno || 0;

    // Build VrstaPlacanja - Tring expects payment type with full amount
    let vrstePlacanja: Tring.VrstaPlacanja[];
    if (data.vrstePlacanja && data.vrstePlacanja.length > 0) {
      vrstePlacanja = data.vrstePlacanja;
    } else {
      const oznaka = data.nacinPlacanja || 'Gotovina';
      vrstePlacanja = [{ oznaka, iznos: ukupno }];
    }

    const racun: Tring.Racun = {
      stavke: (data.items || data.stavke || []).map((item: any) => ({
        artikal: {
          sifra: item.sifra || String(item.productId || ''),
          naziv: item.naziv || '',
          jm: item.jm || 'kom',
          cijena: item.cijena,
          stopa: item.pdvStopa || item.stopa || 'E',
          plu: item.plu || 0,
        },
        kolicina: item.kolicina,
        rabat: item.rabat || 0,
      })),
      vrstePlacanja,
      kupac: data.kupac ? {
        idBroj: data.kupac.idBroj || '',
        naziv: data.kupac.naziv || '',
        adresa: data.kupac.adresa || '',
        postanskiBroj: data.kupac.postanskiBroj || '',
        grad: data.kupac.grad || '',
      } : undefined,
      napomena: data.napomena,
      brojRacuna: data.brojRacuna,
    };
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt request:', JSON.stringify(racun));
    const result = await Tring.stampatiFiskalniRacun(racun);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt response:', JSON.stringify(result));
    return result;
  });

  handle('tring:printRefund', async (data: any) => {
    loadTringConfig();
    // Transform screen data to Tring ReklamiraniRacun format
    const racun: Tring.ReklamiraniRacun = {
      stavke: (data.items || data.stavke || []).map((item: any) => ({
        artikal: {
          sifra: item.sifra || item.productSifra || String(item.productId || ''),
          naziv: item.naziv || item.productNaziv || '',
          jm: item.jm || item.productJm || 'kom',
          cijena: item.cijena,
          stopa: item.pdvStopa || item.stopa || 'E',
          plu: item.plu || item.productPlu || 0,
        },
        kolicina: item.kolicina,
        rabat: item.rabat || 0,
      })),
      vrstePlacanja: [],
      kupac: data.kupac ? {
        idBroj: data.kupac.idBroj || '',
        naziv: data.kupac.naziv || '',
        adresa: data.kupac.adresa || '',
        postanskiBroj: data.kupac.postanskiBroj || '',
        grad: data.kupac.grad || '',
      } : undefined,
      brojRacuna: Number(data.brojRacuna),
    };
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
    const timestamp = new Date().toISOString().slice(0, 10);
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
}
