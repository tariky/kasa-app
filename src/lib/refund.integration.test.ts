// End-to-end: refundAndPrint -> pravi Tring klijent -> mock fiskalni server -> baza.
// Vozi istu orkestraciju koju koristi IPC handler 'order:refundAndPrint',
// samo sa bun:sqlite bazom umjesto better-sqlite3 (native build je za Electron ABI).
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Server } from 'node:http';
import * as Tring from '@/services/tring';
import { startMockTringServer } from '@/services/tring-mock-server';
import { schema } from '@/database/schema';
import { refundAndPrint, type RefundDeps } from './refund';
import { getProductStock } from './skladiste';
import type { SqlDb } from './sqldb';

const PORT = 8097; // ne sudara se sa dev mockom (8085) ni batch testom (8099)

let server: Server;
let db: SqlDb & Database;

beforeAll(() => {
  server = startMockTringServer(PORT);
  Tring.configure({ host: 'localhost', port: PORT });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

/** Iste zavisnosti koje handler prosljeđuje u produkciji. */
function deps(): RefundDeps {
  return {
    db,
    transaction: (fn) => db.transaction(fn),
    print: (racun) => Tring.stampatiReklamiraniRacun(racun),
  };
}

function dodajArtikal(id: number, sifra: string, cijena: number, tip = 'artikal'): void {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, ?, 'kom', ?, 'E', ?)")
    .run(id, sifra, `Artikal ${sifra}`, cijena, tip);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 100, 'test', 0)")
    .run(id);
}

function dodajRacun(opts: {
  brojFiskalnog: string | null;
  stavke: Array<{ productId: number; kolicina: number; cijena: number }>;
  kupacIdBroj?: string;
}): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, kupacNaziv, kupacIdBroj)
    VALUES (1, 100, 17, 'Gotovina', ?, 'completed', ?, ?)
  `).run(opts.brojFiskalnog, opts.kupacIdBroj ? 'Firma d.o.o.' : null, opts.kupacIdBroj ?? null);
  const orderId = Number(r.lastInsertRowid);
  for (const s of opts.stavke) {
    db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, 0, 'E')")
      .run(orderId, s.productId, s.kolicina, s.cijena);
    db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)")
      .run(s.productId, s.kolicina, orderId);
  }
  return orderId;
}

test('uspješan storno: uređaj odštampa, baza upiše, zaliha se vrati', async () => {
  dodajArtikal(1, '001', 2.30);
  const orderId = dodajRacun({ brojFiskalnog: '555', stavke: [{ productId: 1, kolicina: 3, cijena: 2.30 }] });
  expect(getProductStock(db, 1)).toBe(97);

  const res = await refundAndPrint(deps(), { id: orderId });

  expect(res.success).toBe(true);
  expect(res.brojReklamacije).toMatch(/^R-\d+$/); // broj koji je vratio uređaj
  const order = db.prepare('SELECT status, brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('refunded');
  expect(order.brojReklamacije).toBe(res.brojReklamacije);
  expect(getProductStock(db, 1)).toBe(100);
}, 15000);

test('ručno unesen broj reklamacije ima prednost nad brojem sa uređaja', async () => {
  dodajArtikal(1, '002', 5);
  const orderId = dodajRacun({ brojFiskalnog: '556', stavke: [{ productId: 1, kolicina: 1, cijena: 5 }] });

  const res = await refundAndPrint(deps(), { id: orderId, brojReklamacije: 'RUC-42' });

  expect(res.success).toBe(true);
  const order = db.prepare('SELECT brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.brojReklamacije).toBe('RUC-42');
}, 15000);

test('nenumerički fiskalni broj se odbija PRIJE štampe', async () => {
  // Ovo je bio bug: Number("1234/A") = NaN je odlazio u <BrojRacuna>.
  dodajArtikal(1, '003', 5);
  const orderId = dodajRacun({ brojFiskalnog: '1234/A', stavke: [{ productId: 1, kolicina: 1, cijena: 5 }] });

  await expect(refundAndPrint(deps(), { id: orderId })).rejects.toThrow('nije ispravan broj računa');

  // Ništa nije odštampano ni promijenjeno.
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('completed');
  expect(getProductStock(db, 1)).toBe(99);
}, 15000);

test('drugi storno istog računa se odbija, zaliha se ne vraća dvaput', async () => {
  dodajArtikal(1, '004', 5);
  const orderId = dodajRacun({ brojFiskalnog: '557', stavke: [{ productId: 1, kolicina: 4, cijena: 5 }] });

  const prvi = await refundAndPrint(deps(), { id: orderId });
  expect(prvi.success).toBe(true);
  expect(getProductStock(db, 1)).toBe(100);

  await expect(refundAndPrint(deps(), { id: orderId })).rejects.toThrow('već storniran');
  expect(getProductStock(db, 1)).toBe(100);
}, 20000);

test('dvoklik ne odštampa dva storna', async () => {
  dodajArtikal(1, '005', 5);
  const orderId = dodajRacun({ brojFiskalnog: '558', stavke: [{ productId: 1, kolicina: 2, cijena: 5 }] });

  // Oba poziva krenu prije nego prvi završi štampu (uređaj kasni ~2.5s).
  const [a, b] = await Promise.allSettled([
    refundAndPrint(deps(), { id: orderId }),
    refundAndPrint(deps(), { id: orderId }),
  ]);

  const uspjeli = [a, b].filter(r => r.status === 'fulfilled' && (r.value as any).success);
  expect(uspjeli.length).toBe(1);
  expect(getProductStock(db, 1)).toBe(100);
}, 20000);

test('neuspjela štampa ne mijenja bazu', async () => {
  dodajArtikal(1, '006', 5);
  const orderId = dodajRacun({ brojFiskalnog: '559', stavke: [{ productId: 1, kolicina: 3, cijena: 5 }] });

  const res = await refundAndPrint(
    { ...deps(), print: async () => ({ success: false, vrstaOdgovora: 'Greska', error: 'Nema papira', odgovori: {} }) },
    { id: orderId }
  );

  expect(res.success).toBe(false);
  expect(res.error).toBe('Nema papira');
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('completed');
  expect(getProductStock(db, 1)).toBe(97);
});

test('pad baze nakon štampe javlja da je storno na papiru', async () => {
  dodajArtikal(1, '007', 5);
  const orderId = dodajRacun({ brojFiskalnog: '560', stavke: [{ productId: 1, kolicina: 1, cijena: 5 }] });

  const brokenDeps: RefundDeps = {
    ...deps(),
    transaction: () => () => { throw new Error('database is locked'); },
  };

  await expect(refundAndPrint(brokenDeps, { id: orderId })).rejects.toThrow('JE odštampana');
}, 15000);

test('kupac sa računa se prosljeđuje uređaju', async () => {
  dodajArtikal(1, '008', 5);
  const orderId = dodajRacun({
    brojFiskalnog: '561',
    stavke: [{ productId: 1, kolicina: 1, cijena: 5 }],
    kupacIdBroj: '4200000000000',
  });

  let poslato: any = null;
  const res = await refundAndPrint(
    { ...deps(), print: async (racun) => { poslato = racun; return Tring.stampatiReklamiraniRacun(racun); } },
    { id: orderId }
  );

  expect(res.success).toBe(true);
  expect(poslato.kupac.idBroj).toBe('4200000000000');
  expect(poslato.brojRacuna).toBe(561); // broj originalnog računa, ne NaN
  expect(poslato.stavke[0].artikal.sifra).toBe('008');
}, 15000);
