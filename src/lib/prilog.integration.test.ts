// End-to-end: finalizePrilogAndPrint -> pravi Tring klijent -> mock fiskalni server -> baza.
// Vozi istu orkestraciju koju koristi IPC handler 'order:finalizePrilog',
// samo sa bun:sqlite bazom umjesto better-sqlite3 (native build je za Electron ABI).
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Server } from 'node:http';
import * as Tring from '@/services/tring';
import { startMockTringServer } from '@/services/tring-mock-server';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import { finalizePrilogAndPrint, type FinalizePrilogDeps } from './prilog';

const PORT = 8098; // 8085 dev, 8097 refund, 8099 batch

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
function deps(): FinalizePrilogDeps {
  return {
    db,
    transaction: (fn) => db.transaction(fn),
    print: (racun) => Tring.stampatiFiskalniRacun(racun),
  };
}

test('fiskalizuje zbirnu stavku i upiše prilog račun bez order_items', async () => {
  const res = await finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina',
  });

  expect(res.success).toBe(true);
  expect(res.prilogBroj).toBe(1);
  expect(res.brojFiskalnogRacuna).toBeTruthy();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.prilogBroj).toBe(1);
  expect(order.ukupno).toBe(150);
  expect(order.pdvIznos).toBeCloseTo(150 - 150 / 1.17, 2);
  expect(order.status).toBe('completed');

  const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(res.id!);
  expect(items.length).toBe(0);
  const movements = db.prepare('SELECT * FROM stock_movements').all();
  expect(movements.length).toBe(0);
  const pending = db.prepare('SELECT * FROM pending_receipts').all();
  expect(pending.length).toBe(0);
}, 15000);

test('zbirna stavka koja ide uređaju nosi naziv sa brojem priloga', async () => {
  let poslato: any = null;
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: async (racun) => { poslato = racun; return Tring.stampatiFiskalniRacun(racun); } },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  );

  expect(res.success).toBe(true);
  expect(poslato.stavke.length).toBe(1);
  expect(poslato.stavke[0].artikal.naziv).toBe('Stavke po računu br. 1');
  expect(poslato.stavke[0].artikal.sifra).toBe('PRILOG');
  expect(poslato.stavke[0].artikal.stopa).toBe('E');
  expect(poslato.stavke[0].kolicina).toBe(1);
  expect(poslato.vrstePlacanja).toEqual([{ oznaka: 'Gotovina', iznos: 150 }]);
}, 15000);

test('drugi prilog račun dobija sljedeći broj', async () => {
  await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 10, nacinPlacanja: 'Gotovina' });
  const res = await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 20, nacinPlacanja: 'Kartica' });
  expect(res.prilogBroj).toBe(2);
}, 20000);

test('kupac se upisuje na račun', async () => {
  const res = await finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 50, nacinPlacanja: 'Virman',
    kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', adresa: 'Ulica 1', grad: 'Sarajevo', postanskiBroj: '71000' },
  });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.kupacNaziv).toBe('Firma d.o.o.');
  expect(order.kupacIdBroj).toBe('4200000000001');
}, 15000);

test('odbija iznos <= 0', async () => {
  await expect(finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 0, nacinPlacanja: 'Gotovina',
  })).rejects.toThrow(/[Ii]znos/);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
});

test('neuspješna štampa ne ostavlja ni order ni pending red', async () => {
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: async () => ({ success: false, vrstaOdgovora: 'Greska', error: 'Nema papira', odgovori: {} }) },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  );

  expect(res.success).toBe(false);
  expect(res.error).toBe('Nema papira');
  expect(db.prepare('SELECT * FROM orders').all().length).toBe(0);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
});

test('pad štampe (izuzetak) čisti pending red i propušta grešku', async () => {
  await expect(finalizePrilogAndPrint(
    { ...deps(), print: async () => { throw new Error('mreža nedostupna'); } },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  )).rejects.toThrow('mreža nedostupna');

  expect(db.prepare('SELECT * FROM orders').all().length).toBe(0);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
});

test('snapshot pending reda nosi prilogBroj i prazne stavke', async () => {
  // Pad baze nakon štampe: pending red ostaje da ga operater riješi kroz
  // pending:resolve, koji iz snapshota mora rekonstruisati prilog račun.
  const brokenDeps: FinalizePrilogDeps = {
    ...deps(),
    transaction: () => () => { throw new Error('database is locked'); },
  };

  await expect(finalizePrilogAndPrint(brokenDeps, {
    korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina',
  })).rejects.toThrow('JE odštampan');

  const rows = db.prepare('SELECT snapshot FROM pending_receipts').all() as Array<{ snapshot: string }>;
  expect(rows.length).toBe(1);
  const snap = JSON.parse(rows[0].snapshot);
  expect(snap.prilogBroj).toBe(1);
  expect(snap.stavke).toEqual([]);
  expect(snap.ukupno).toBe(150);
}, 15000);
