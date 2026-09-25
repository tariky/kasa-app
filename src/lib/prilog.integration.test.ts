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
import {
  finalizePrilogAndPrint, savePrilogStavkeInTransaction, prilogKompletan,
  type FinalizePrilogDeps,
} from './prilog';
import { refundAndPrint } from './refund';
import { postaviZadnjiFiskalniBroj, predvidjeniFiskalniBroj } from './fiskalni';
import { getProductStock } from './skladiste';

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
  // Prazna baza ne zna fiskalni niz — bez ovoga račun po prilogu odbija štampu.
  postaviZadnjiFiskalniBroj(db, 0);
});

/** Štampa koja vrati zadati BF, bez odlaska na uređaj. */
function printSaBrojem(broj: string, zabiljezi?: (racun: any) => void) {
  return async (racun: any) => {
    zabiljezi?.(racun);
    return { success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: broj } } as any;
  };
}

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
  expect(res.brojFiskalnogRacuna).toBeTruthy();
  // Broj fakture je BF broj sa isječka uz koji ide.
  expect(res.prilogBroj).toBe(Number(res.brojFiskalnogRacuna));

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.prilogBroj).toBe(Number(res.brojFiskalnogRacuna));
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

test('zbirna stavka koja ide uređaju nosi predviđeni broj isječka', async () => {
  postaviZadnjiFiskalniBroj(db, 127);
  expect(predvidjeniFiskalniBroj(db)).toBe(128);

  let poslato: any = null;
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('128', r => { poslato = r; }) },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  );

  expect(res.success).toBe(true);
  expect(res.upozorenje).toBeUndefined();
  expect(poslato.stavke.length).toBe(1);
  expect(poslato.stavke[0].artikal.naziv).toBe('Stavke po računu br. 128');
  expect(poslato.stavke[0].artikal.sifra).toBe('PRILOG');
  expect(poslato.stavke[0].artikal.stopa).toBe('E');
  expect(poslato.stavke[0].kolicina).toBe(1);
  expect(poslato.vrstePlacanja).toEqual([{ oznaka: 'Gotovina', iznos: 150 }]);
}, 15000);

test('naziv zbirne stavke se preuzima iz unosa i pamti uz račun', async () => {
  postaviZadnjiFiskalniBroj(db, 127);
  let poslato: any = null;
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('128', r => { poslato = r; }) },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina', prilogOpis: 'CNC obrada', prilogVeza: 'fakturi' }
  );

  expect(res.success).toBe(true);
  expect(poslato.stavke[0].artikal.naziv).toBe('CNC obrada po fakturi br. 128');
  // Storno i kopija računa čitaju naziv iz baze — mora biti isti kao odštampani.
  const order = db.prepare('SELECT prilogNaziv FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.prilogNaziv).toBe('CNC obrada po fakturi br. 128');
});

test('stvarni BF različit od predviđenog vraća upozorenje', async () => {
  postaviZadnjiFiskalniBroj(db, 127);
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('130') },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  );

  expect(res.success).toBe(true);
  // Papir već nosi 128 u nazivu stavke; faktura ide po stvarnom broju.
  expect(res.prilogBroj).toBe(130);
  expect(res.upozorenje).toContain('128');
  expect(res.upozorenje).toContain('130');
  const order = db.prepare('SELECT prilogBroj FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.prilogBroj).toBe(130);
});

test('bez poznatog fiskalnog niza nema štampe', async () => {
  db.prepare("DELETE FROM settings WHERE key = 'fiscal.zadnjiBroj'").run();
  await expect(finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina',
  })).rejects.toThrow(/posljednji fiskalni broj/i);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
});

test('svaki prilog račun nosi BF broj svog isječka', async () => {
  const prvi = await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 10, nacinPlacanja: 'Gotovina' });
  const drugi = await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 20, nacinPlacanja: 'Kartica' });
  expect(prvi.prilogBroj).toBe(Number(prvi.brojFiskalnogRacuna));
  expect(drugi.prilogBroj).toBe(Number(drugi.brojFiskalnogRacuna));
  expect(drugi.prilogBroj).toBe(prvi.prilogBroj! + 1);
}, 20000);

test('nenumerički BF pada na predviđeni broj', async () => {
  // Uređaj koji vrati npr. „R-12" ne smije ostaviti fakturu bez broja.
  postaviZadnjiFiskalniBroj(db, 127);
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('R-12') },
    { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' }
  );

  expect(res.success).toBe(true);
  expect(res.brojFiskalnogRacuna).toBe('R-12');
  expect(res.prilogBroj).toBe(128);
  expect(res.upozorenje).toBeUndefined();
  const order = db.prepare('SELECT prilogBroj FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.prilogBroj).toBe(128);
});

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
  // Snapshot nosi predviđeni broj; pending:resolve ga zamijeni ukucanim BF-om.
  expect(snap.prilogBroj).toBe(1);
  expect(snap.stavke).toEqual([]);
  expect(snap.ukupno).toBe(150);
}, 15000);

test('stavke unesene na kasi određuju iznos i upisuju se uz račun', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'A1', 'Artikal', 'kom', 30, 'E', 'artikal')").run();
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (2, 'U1', 'Usluga', 'kom', 90, 'E', 'usluga')").run();
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (1, 'ulaz', 100, 'test', 0)").run();

  let poslato: any = null;
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: async (racun) => { poslato = racun; return Tring.stampatiFiskalniRacun(racun); } },
    {
      korisnikId: 1, nacinPlacanja: 'Gotovina',
      // Ukucani iznos se ignoriše kad stavke postoje — suma je jedini izvor istine.
      iznos: 999,
      stavke: [
        { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
        { productId: 2, kolicina: 1, cijena: 90, pdvStopa: 'E' },
      ],
    }
  );

  expect(res.success).toBe(true);
  expect(poslato.stavke.length).toBe(1);
  // Mock uređaj vodi vlastiti brojač, pa se stvarni BF razilazi sa predviđenim —
  // isječak nosi predviđeni broj, faktura stvarni.
  expect(poslato.stavke[0].artikal.naziv).toBe('Stavke po računu br. 1');
  expect(poslato.stavke[0].artikal.cijena).toBe(150);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.ukupno).toBe(150);

  const stavke = db.prepare('SELECT * FROM prilog_stavke WHERE orderId = ? ORDER BY productId').all(res.id!) as any[];
  expect(stavke.length).toBe(2);
  expect(stavke[0].kolicina).toBe(2);
  // Usluga ne dira zalihu, artikal da.
  expect(getProductStock(db, 1)).toBe(98);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
}, 15000);

test('pad baze nakon štampe ostavlja stavke u snapshotu', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'A1', 'Artikal', 'kom', 30, 'E', 'artikal')").run();

  await expect(finalizePrilogAndPrint(
    { ...deps(), transaction: () => () => { throw new Error('database is locked'); } },
    {
      korisnikId: 1, nacinPlacanja: 'Gotovina',
      stavke: [{ productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' }],
    }
  )).rejects.toThrow('JE odštampan');

  const rows = db.prepare('SELECT snapshot FROM pending_receipts').all() as Array<{ snapshot: string }>;
  const snap = JSON.parse(rows[0].snapshot);
  expect(snap.ukupno).toBe(60);
  expect(snap.stavke).toEqual([]);
  expect(snap.prilogStavke).toEqual([{ productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' }]);
}, 15000);

test('neispravna stavka se odbija prije štampe', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'K1', 'Oslobođeno', 'kom', 30, 'K', 'artikal')").run();
  let stampano = false;

  await expect(finalizePrilogAndPrint(
    { ...deps(), print: async (r) => { stampano = true; return Tring.stampatiFiskalniRacun(r); } },
    {
      korisnikId: 1, nacinPlacanja: 'Gotovina',
      stavke: [{ productId: 1, kolicina: 1, cijena: 30, pdvStopa: 'K' }],
    }
  )).rejects.toThrow(/stopom E/);

  // Ništa nije odštampano — greška poslije štampe bi bila papir bez pokrića.
  expect(stampano).toBe(false);
  expect(db.prepare('SELECT * FROM orders').all().length).toBe(0);
  expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
});

test('cijeli tok: fiskalizacija → dodjela stavki → kompletna zaključana → skladište → storno', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'A1', 'Artikal', 'kom', 30, 'E', 'artikal')").run();
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (2, 'U1', 'Usluga', 'kom', 90, 'E', 'usluga')").run();
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (1, 'ulaz', 100, 'test', 0)").run();

  // 1. Kasa: fiskalizuj 150 KM po prilogu.
  const res = await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina' });
  expect(res.success).toBe(true);
  const orderId = res.id!;

  // 2. Računi: prvi, nekompletan dio stavki (1×30 + 1×90 = 120).
  db.transaction(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 1, cijena: 30, pdvStopa: 'E' },
    { productId: 2, kolicina: 1, cijena: 90, pdvStopa: 'E' },
  ]))();
  expect(getProductStock(db, 1)).toBe(99);

  // 3. Dopuna do 150 ne skida duplo (količina 1 → 2).
  const stavke = [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
    { productId: 2, kolicina: 1, cijena: 90, pdvStopa: 'E' },
  ];
  expect(prilogKompletan(150, stavke)).toBe(true);
  db.transaction(() => savePrilogStavkeInTransaction(db, orderId, stavke))();
  expect(getProductStock(db, 1)).toBe(98);

  // 3b. Kompletna faktura je zaključana.
  expect(() => db.transaction(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 3, cijena: 30, pdvStopa: 'E' },
  ]))()).toThrow(/završena/);
  expect(getProductStock(db, 1)).toBe(98);

  // 4. Storno vraća zalihu po stavkama priloga.
  const storno = await refundAndPrint(
    { db, transaction: (fn) => db.transaction(fn), print: (r) => Tring.stampatiReklamiraniRacun(r) },
    { id: orderId }
  );
  expect(storno.success).toBe(true);
  expect(getProductStock(db, 1)).toBe(100);

  // 5. Prilog storniranog računa se više ne može mijenjati.
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 1, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/storniran/);
}, 30000);

test('rabat po stavci smanjuje iznos zbirne stavke i pamti se uz stavku', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'A1', 'Artikal', 'kom', 30, 'E', 'artikal')").run();

  let poslato: any = null;
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('1', r => { poslato = r; }) },
    {
      korisnikId: 1, nacinPlacanja: 'Virman',
      stavke: [{ productId: 1, kolicina: 3, cijena: 30, rabat: 10, pdvStopa: 'E' }],
    }
  );

  expect(res.success).toBe(true);
  expect(poslato.stavke[0].artikal.cijena).toBe(81);
  const stavka = db.prepare('SELECT rabat FROM prilog_stavke WHERE orderId = ?').get(res.id!) as any;
  expect(stavka.rabat).toBe(10);
  expect(prilogKompletan(81, [{ productId: 1, kolicina: 3, cijena: 30, rabat: 10, pdvStopa: 'E' }])).toBe(true);
});

test('rabat van 0–100 se odbija prije štampe', async () => {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (1, 'A1', 'Artikal', 'kom', 30, 'E', 'artikal')").run();
  let stampano = false;
  await expect(finalizePrilogAndPrint(
    { ...deps(), print: async () => { stampano = true; return null; } },
    { korisnikId: 1, nacinPlacanja: 'Virman', stavke: [{ productId: 1, kolicina: 1, cijena: 30, rabat: 100, pdvStopa: 'E' }] }
  )).rejects.toThrow(/Rabat/);
  expect(stampano).toBe(false);
});

test('datum valute i napomena se upisuju na fakturu i nose u snapshotu', async () => {
  let snapTokomStampe: any = null;
  const res = await finalizePrilogAndPrint(
    {
      ...deps(),
      print: async () => {
        snapTokomStampe = JSON.parse((db.prepare('SELECT snapshot FROM pending_receipts').get() as any).snapshot);
        return { success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: '1' } } as any;
      },
    },
    { korisnikId: 1, iznos: 100, nacinPlacanja: 'Virman', datumValute: '2026-10-15', napomena: '  Isporuka na gradilište  ' }
  );

  const order = db.prepare('SELECT datumValute, napomena FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order).toEqual({ datumValute: '2026-10-15', napomena: 'Isporuka na gradilište' });
  expect(snapTokomStampe.datumValute).toBe('2026-10-15');
  expect(snapTokomStampe.napomena).toBe('Isporuka na gradilište');
});

test('neispravan datum valute se odbija prije štampe', async () => {
  let stampano = false;
  await expect(finalizePrilogAndPrint(
    { ...deps(), print: async () => { stampano = true; return null; } },
    { korisnikId: 1, iznos: 100, nacinPlacanja: 'Virman', datumValute: '2026-02-30' }
  )).rejects.toThrow(/datum valute/);
  expect(stampano).toBe(false);
});

function ponuda(status = 'draft'): number {
  db.prepare("INSERT INTO kupci (id, naziv, idBroj) VALUES (1, 'Firma', '4200000000001')").run();
  return Number(db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos, status)
    VALUES (1, 2026, 1, 1, '2026-09-01', '2026-09-30', 100, 14.53, ?)
  `).run(status).lastInsertRowid);
}

test('faktura iz ponude označava ponudu konvertovanom', async () => {
  const id = ponuda();
  const res = await finalizePrilogAndPrint(
    { ...deps(), print: printSaBrojem('1') },
    { korisnikId: 1, iznos: 100, nacinPlacanja: 'Virman', ponudaId: id }
  );
  const p = db.prepare('SELECT status, racunId FROM ponude WHERE id = ?').get(id) as any;
  expect(p).toEqual({ status: 'konvertovana', racunId: res.id! });
});

test('konvertovana ili odbijena ponuda ne može u fakturu — ništa se ne štampa', async () => {
  const id = ponuda('odbijena');
  let stampano = false;
  const print = async () => { stampano = true; return null; };
  await expect(finalizePrilogAndPrint({ ...deps(), print }, { korisnikId: 1, iznos: 100, nacinPlacanja: 'Virman', ponudaId: id }))
    .rejects.toThrow(/Odbijena/);
  db.prepare("UPDATE ponude SET status = 'konvertovana' WHERE id = ?").run(id);
  await expect(finalizePrilogAndPrint({ ...deps(), print }, { korisnikId: 1, iznos: 100, nacinPlacanja: 'Virman', ponudaId: id }))
    .rejects.toThrow(/već konvertovana/);
  expect(stampano).toBe(false);
});
