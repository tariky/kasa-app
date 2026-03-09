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

      for (const stavka of data.stavke) {
        insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, primkaId);
      }

      return { id: primkaId };
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

      // Delete old stavke and stock movements
      db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(data.id);
      db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(data.id);

      // Insert new stavke and stock movements
      const insertStavka = db.prepare(
        'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)"
      );

      for (const stavka of data.stavke) {
        insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, data.id);
      }

      return { id: data.id };
    });

    return updatePrimka();
  });

  handle('primka:delete', (id: number) => {
    const deletePrimka = db.transaction(() => {
      db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(id);
      db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(id);
      db.prepare('DELETE FROM primke WHERE id = ?').run(id);
    });

    return deletePrimka();
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
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm
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
          SELECT p.*,
            (SELECT COUNT(*) FROM primka_stavke ps WHERE ps.primkaId = p.id) AS brojStavki,
            (SELECT SUM(ps.kolicina * ps.cijena) FROM primka_stavke ps WHERE ps.primkaId = p.id) AS ukupno
          FROM primke p
          WHERE date(p.datum) BETWEEN date(?) AND date(?)
          ORDER BY p.datum DESC
        `)
        .all(from, to);
      return primke;
    }

    throw new Error(`Nepoznat tip izvještaja: ${type}`);
  });

  // ─── Tring ──────────────────────────────────────────────

  handle('tring:init', () => {
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

    const operatorId = parseInt(map.operatorId ?? '0', 10);
    const operatorPassword = map.operatorPassword ?? '0';

    return Tring.inicijalizacija(operatorId, operatorPassword);
  });

  handle('tring:printReceipt', (data: any) => {
    // Transform screen data to Tring Racun format
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
      vrstePlacanja: data.vrstePlacanja || [{ oznaka: data.nacinPlacanja || 'Gotovina', iznos: 0 }],
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
    return Tring.stampatiFiskalniRacun(racun);
  });

  handle('tring:printRefund', (data: any) => {
    // Transform screen data to Tring ReklamiraniRacun format
    const racun: Tring.ReklamiraniRacun = {
      stavke: (data.items || data.stavke || []).map((item: any) => ({
        artikal: {
          sifra: item.sifra || String(item.productId || ''),
          naziv: item.naziv || item.productNaziv || '',
          jm: item.jm || item.productJm || 'kom',
          cijena: item.cijena,
          stopa: item.pdvStopa || item.stopa || 'E',
          plu: item.plu || 0,
        },
        kolicina: item.kolicina,
        rabat: item.rabat || 0,
      })),
      vrstePlacanja: data.vrstePlacanja || [],
      brojRacuna: Number(data.brojRacuna),
    };
    return Tring.stampatiReklamiraniRacun(racun);
  });

  handle('tring:xReport', () => {
    return Tring.stampatiPresjekStanja();
  });

  handle('tring:zReport', () => {
    return Tring.stampatiDnevniIzvjestaj();
  });

  handle('tring:periodicReport', (from: string, to: string) => {
    return Tring.stampatiPeriodicniIzvjestaj(from, to);
  });

  handle('tring:writeArticle', (data: any) => {
    return Tring.upisiArtikal(data);
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
