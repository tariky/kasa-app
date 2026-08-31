import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import { refundOrderInTransaction, refundAndPrint, type RefundDeps } from './refund';
import type { TringResponse } from '@/services/tring';
import { getProductStock } from './skladiste';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajArtikal(id: number, tip = 'artikal'): void {
  db.prepare("INSERT INTO products (id, sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, ?, 10, 'E', ?)")
    .run(id, `S-${id}`, `Artikal ${id}`, tip);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 100, 'test', 0)")
    .run(id);
}

function dodajRacun(stavke: Array<{ productId: number; kolicina: number }>): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status)
    VALUES (1, 100, 17, 'Gotovina', '555', 'completed')
  `).run();
  const orderId = Number(r.lastInsertRowid);
  for (const s of stavke) {
    db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, 10, 0, 'E')")
      .run(orderId, s.productId, s.kolicina);
    db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)")
      .run(s.productId, s.kolicina, orderId);
  }
  return orderId;
}

test('storno mijenja status, vraća zalihu i upisuje broj reklamacije', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 3 }]);
  expect(getProductStock(db, 1)).toBe(97);

  refundOrderInTransaction(db, orderId, 'R-77');

  const order = db.prepare('SELECT status, brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('refunded');
  expect(order.brojReklamacije).toBe('R-77');
  expect(getProductStock(db, 1)).toBe(100);
});

test('drugi storno istog računa ne prolazi', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 2 }]);
  refundOrderInTransaction(db, orderId, 'R-1');

  expect(() => refundOrderInTransaction(db, orderId, 'R-2')).toThrow('već storniran');
  // Zaliha se ne smije vratiti dvaput.
  expect(getProductStock(db, 1)).toBe(100);
});

test('storno bez broja reklamacije ne briše postojeći broj', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  db.prepare("UPDATE orders SET brojReklamacije = 'ranije-upisan' WHERE id = ?").run(orderId);

  refundOrderInTransaction(db, orderId, null);

  const order = db.prepare('SELECT brojReklamacije FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.brojReklamacije).toBe('ranije-upisan');
});

test('usluge se ne vraćaju na zalihu', () => {
  dodajArtikal(1);
  dodajArtikal(2, 'usluga');
  const orderId = dodajRacun([{ productId: 1, kolicina: 2 }, { productId: 2, kolicina: 1 }]);
  const uslugaPrije = getProductStock(db, 2);

  refundOrderInTransaction(db, orderId, 'R-9');

  expect(getProductStock(db, 1)).toBe(100);
  expect(getProductStock(db, 2)).toBe(uslugaPrije);
});

test('storno upisuje refundedAt — bez njega se dnevni obračun ladice ne može izvesti', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);

  refundOrderInTransaction(db, orderId, 'R-5');

  const order = db.prepare('SELECT refundedAt FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.refundedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('storno nepostojećeg računa baca grešku', () => {
  expect(() => refundOrderInTransaction(db, 999, null)).toThrow('ne postoji');
});

test('decimalna količina se vraća u cijelosti', () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 2.5 }]);
  expect(getProductStock(db, 1)).toBe(97.5);

  refundOrderInTransaction(db, orderId, 'R-3');
  expect(getProductStock(db, 1)).toBe(100);
});

// ── Override praznog stanja kase ─────────────────────────────────────────────
// Tring odbija gotovinski storno kad u kasi nema evidentirane gotovine.
// Operater smije pregaziti stanje: manjak se upiše kao polog pa štampa prolazi.

function refundDeps(over: Partial<RefundDeps> = {}): RefundDeps {
  return {
    db,
    transaction: (fn) => db.transaction(fn),
    print: async () => ({ success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: 'R-1' } }),
    drawerState: () => ({ ocekivanoStanje: 0 }),
    ...over,
  };
}

test('neuspjela štampa uz praznu ladicu nudi override s izračunatim manjkom', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);

  const res = await refundAndPrint(refundDeps({
    print: async () => ({ success: false, vrstaOdgovora: 'Greska', odgovori: { Poruka: 'Nema dovoljno sredstava' } }),
  }), { id: orderId });

  expect(res.success).toBe(false);
  expect(res.nedovoljnoSredstava).toBe(true);
  expect(res.manjak).toBe(100); // cijeli gotovinski iznos — ladica je prazna
  expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any).toMatchObject({ status: 'completed' });
});

test('override evidentira polog za manjak i storno prolazi', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  const polozi: Array<{ iznos: number; napomena: string }> = [];

  const res = await refundAndPrint(refundDeps({
    drawerState: () => ({ ocekivanoStanje: 30 }),
    depositCash: async (iznos, napomena) => { polozi.push({ iznos, napomena }); },
  }), { id: orderId, dozvoliPolog: true });

  expect(res.success).toBe(true);
  expect(polozi).toHaveLength(1);
  expect(polozi[0].iznos).toBe(70); // 100 povrat − 30 u ladici
  expect(polozi[0].napomena).toContain(`#${orderId}`);
  expect(res.pologIznos).toBe(70);
  expect(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any).toMatchObject({ status: 'refunded' });
});

test('kartični račun se pokriva samo u uređaju — evidencija ladice se ne dira', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  db.prepare("UPDATE orders SET nacinPlacanja = 'Kartica' WHERE id = ?").run(orderId);
  const evidentirano: number[] = [];
  const uUredjaj: number[] = [];

  const res = await refundAndPrint(refundDeps({
    depositCash: async (iznos) => { evidentirano.push(iznos); },
    deviceCashIn: async (iznos) => { uUredjaj.push(iznos); },
  }), { id: orderId });

  expect(res.success).toBe(true);
  expect(evidentirano).toEqual([]); // iz ladice fizički ne izlazi ništa
  expect(uUredjaj).toEqual([100]);  // ali Tring traži gotovinsko pokriće
  expect(res.pologIznos).toBe(0);
});

test('virmanski račun prolazi bez ijednog override klika', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  db.prepare("UPDATE orders SET nacinPlacanja = 'Virman' WHERE id = ?").run(orderId);
  const uUredjaj: number[] = [];

  // Bez dozvoliPolog — obično 'Potvrdi reklamaciju'.
  const res = await refundAndPrint(refundDeps({
    deviceCashIn: async (iznos) => { uUredjaj.push(iznos); },
  }), { id: orderId });

  expect(res.success).toBe(true);
  expect(uUredjaj).toEqual([100]); // pokriće za uređaj, automatski
  expect(res.pologIznos).toBe(0);  // ladica ostaje netaknuta
  expect(db.prepare("SELECT COUNT(*) AS n FROM cash_movements").get() as any).toMatchObject({ n: 0 });
});

test('override dopunjava uređaj i ponavlja štampu kad stanje ladice laže', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  const uUredjaj: number[] = [];
  let pokusaj = 0;

  const res = await refundAndPrint(refundDeps({
    // Ladica tvrdi da ima dovoljno, ali brojač u uređaju je prazan.
    drawerState: () => ({ ocekivanoStanje: 100 }),
    deviceCashIn: async (iznos) => { uUredjaj.push(iznos); },
    print: async (): Promise<TringResponse> => (++pokusaj === 1
      ? { success: false, vrstaOdgovora: 'Greska', odgovori: { Poruka: 'ERROR_FISCAL_INSUFFICIENT_MONEY' } }
      : { success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: 'R-2' } }),
  }), { id: orderId, dozvoliPolog: true });

  expect(res.success).toBe(true);
  expect(uUredjaj).toEqual([100]); // dopuna do punog iznosa računa
  expect(pokusaj).toBe(2);
});

test('mješovito plaćanje: override traži samo gotovinski dio, ostatak ide sam', async () => {
  dodajArtikal(1);
  const orderId = dodajRacun([{ productId: 1, kolicina: 1 }]);
  db.prepare(`UPDATE orders SET nacinPlacanja = '{"gotovina":30,"kartica":70}' WHERE id = ?`).run(orderId);
  const evidentirano: number[] = [];
  const uUredjaj: number[] = [];
  // Uređaj traži pokriće u punom iznosu računa, kao pravi Tring.
  const pokriveno = () => [...evidentirano, ...uUredjaj].reduce((a, b) => a + b, 0);
  const deps = () => refundDeps({
    depositCash: async (iznos) => { evidentirano.push(iznos); },
    deviceCashIn: async (iznos) => { uUredjaj.push(iznos); },
    print: async (): Promise<TringResponse> => (pokriveno() >= 100
      ? { success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: 'R-3' } }
      : { success: false, vrstaOdgovora: 'Greska', odgovori: { Poruka: 'ERROR_FISCAL_INSUFFICIENT_MONEY' } }),
  });

  // Bez overrida: kartični dio se pokrije sam, ali za 30 KM gotovine se pita.
  const prvi = await refundAndPrint(deps(), { id: orderId });
  expect(prvi.success).toBe(false);
  expect(prvi.nedovoljnoSredstava).toBe(true);
  expect(prvi.manjak).toBe(30);
  expect(uUredjaj).toEqual([70]);
  expect(evidentirano).toEqual([]);

  const drugi = await refundAndPrint(deps(), { id: orderId, dozvoliPolog: true });
  expect(drugi.success).toBe(true);
  expect(evidentirano).toEqual([30]);
});
