// Integracija nad pravom SQLite bazom sa produkcijskom šemom.
// (better-sqlite3 je buildan za Electron ABI i ne učitava se pod Bun-om, pa
// testovi koriste bun:sqlite — isti SQLite engine, isti SQL.)
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import {
  nextBrojPonude, formatBrojPonude, createPonuda, updatePonuda,
  efektivniStatus, setStatusPonude, konvertujPonudu, plusDana, danaIzmedju, DEFAULT_ROK_DANA,
} from './ponuda';
import type { SqlDb } from './sqldb';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
});

function dodajKupca(naziv = 'Test Kupac d.o.o.'): number {
  const r = db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES (?, ?)")
    .run(naziv, `42000${Math.floor(Math.random() * 100000)}`);
  return Number(r.lastInsertRowid);
}

let pinSeq = 1000;
function dodajKorisnika(): number {
  const r = db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Kasir', ?, 'kasir')")
    .run(String(pinSeq++));
  return Number(r.lastInsertRowid);
}

function ubaciPonudu(broj: number, godina: number): void {
  const kupacId = dodajKupca(`Kupac ${broj}/${godina}`);
  const korisnikId = Number(
    db.prepare("INSERT INTO users (ime, pin, uloga) VALUES (?, ?, 'kasir')")
      .run(`K${broj}${godina}`, `${broj}${godina}${Math.random()}`).lastInsertRowid
  );
  db.prepare(`
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
  `).run(broj, godina, kupacId, korisnikId, `${godina}-03-01`, `${godina}-03-09`);
}

// ─── Numeracija ─────────────────────────────────────────────

test('prazna baza: prva ponuda u godini dobija broj 1', () => {
  expect(nextBrojPonude(db, 2026)).toBe(1);
});

test('numeracija se nastavlja unutar iste godine', () => {
  ubaciPonudu(1, 2026);
  ubaciPonudu(2, 2026);
  expect(nextBrojPonude(db, 2026)).toBe(3);
});

test('nova godina resetuje brojanje od 1', () => {
  ubaciPonudu(7, 2025);
  expect(nextBrojPonude(db, 2026)).toBe(1);
});

test('format broja ponude je broj/godina', () => {
  expect(formatBrojPonude({ broj: 3, godina: 2026 })).toBe('3/2026');
});

// ─── createPonuda ───────────────────────────────────────────

function dodajArtikal(sifra: string, cijena: number): number {
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa) VALUES (?, ?, ?, 'E')")
    .run(sifra, `Artikal ${sifra}`, cijena);
  return Number(r.lastInsertRowid);
}

test('createPonuda upisuje ponudu sa zamrznutim cijenama i totalima', () => {
  const kupacId = dodajKupca();
  const korisnikId = dodajKorisnika();
  const productId = dodajArtikal('001', 10);

  const res = createPonuda(db, {
    kupacId, korisnikId, datum: '2026-03-01',
    stavke: [{ productId, kolicina: 2, cijena: 10, rabat: 0, pdvStopa: 'E' }],
  });

  expect(res.broj).toBe(1);
  expect(res.godina).toBe(2026);

  const p = db.prepare('SELECT * FROM ponude WHERE id = ?').get(res.id) as any;
  expect(p.status).toBe('draft');
  expect(p.ukupno).toBe(20);
  // 20 - 20/1.17 = 2.905... → 2.91 (PDV 17% sadržan u cijeni)
  expect(p.pdvIznos).toBe(2.91);

  const stavke = db.prepare('SELECT * FROM ponuda_stavke WHERE ponudaId = ?').all(res.id) as any[];
  expect(stavke.length).toBe(1);
  expect(stavke[0].cijena).toBe(10);

  // Zamrznuta cijena: kasnija promjena cjenovnika ne dira stavku ponude
  db.prepare('UPDATE products SET cijena = 99 WHERE id = ?').run(productId);
  const stavka = db.prepare('SELECT cijena FROM ponuda_stavke WHERE ponudaId = ?').get(res.id) as any;
  expect(stavka.cijena).toBe(10);
});

test('createPonuda bez vaziDo postavlja rok 8 dana od datuma', () => {
  const kupacId = dodajKupca();
  const korisnikId = dodajKorisnika();
  const productId = dodajArtikal('002', 5);

  const res = createPonuda(db, {
    kupacId, korisnikId, datum: '2026-03-28',
    stavke: [{ productId, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
  });

  const p = db.prepare('SELECT vaziDo FROM ponude WHERE id = ?').get(res.id) as any;
  expect(p.vaziDo).toBe('2026-04-05');
});

test('createPonuda poštuje eksplicitni vaziDo', () => {
  const kupacId = dodajKupca();
  const korisnikId = dodajKorisnika();
  const productId = dodajArtikal('003', 5);

  const res = createPonuda(db, {
    kupacId, korisnikId, datum: '2026-03-01', vaziDo: '2026-03-31',
    stavke: [{ productId, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
  });

  const p = db.prepare('SELECT vaziDo FROM ponude WHERE id = ?').get(res.id) as any;
  expect(p.vaziDo).toBe('2026-03-31');
});

// ─── updatePonuda ───────────────────────────────────────────

function napraviPonudu(cijena = 10): { id: number; productId: number } {
  const kupacId = dodajKupca();
  const korisnikId = dodajKorisnika();
  const productId = dodajArtikal(`U${Math.random()}`, cijena);
  const res = createPonuda(db, {
    kupacId, korisnikId, datum: '2026-03-01',
    stavke: [{ productId, kolicina: 1, cijena, rabat: 0, pdvStopa: 'E' }],
  });
  return { id: res.id, productId };
}

test('updatePonuda mijenja stavke i preračunava totale', () => {
  const { id, productId } = napraviPonudu(10);

  updatePonuda(db, id, {
    vaziDo: '2026-04-15',
    napomena: 'izmjena po dogovoru',
    stavke: [{ productId, kolicina: 3, cijena: 12, rabat: 0, pdvStopa: 'E' }],
  });

  const p = db.prepare('SELECT * FROM ponude WHERE id = ?').get(id) as any;
  expect(p.ukupno).toBe(36);
  expect(p.vaziDo).toBe('2026-04-15');
  expect(p.napomena).toBe('izmjena po dogovoru');

  const stavke = db.prepare('SELECT * FROM ponuda_stavke WHERE ponudaId = ?').all(id) as any[];
  expect(stavke.length).toBe(1);
  expect(stavke[0].kolicina).toBe(3);
  expect(stavke[0].cijena).toBe(12);
});

test('updatePonuda ne dira broj i godinu ponude', () => {
  const { id, productId } = napraviPonudu(10);
  updatePonuda(db, id, {
    stavke: [{ productId, kolicina: 2, cijena: 10, rabat: 0, pdvStopa: 'E' }],
  });
  const p = db.prepare('SELECT broj, godina FROM ponude WHERE id = ?').get(id) as any;
  expect(p.broj).toBe(1);
  expect(p.godina).toBe(2026);
});

test('konvertovana ponuda se ne može mijenjati', () => {
  const { id, productId } = napraviPonudu(10);
  db.prepare("UPDATE ponude SET status = 'konvertovana' WHERE id = ?").run(id);

  expect(() => updatePonuda(db, id, {
    stavke: [{ productId, kolicina: 5, cijena: 10, rabat: 0, pdvStopa: 'E' }],
  })).toThrow('Konvertovana ponuda se ne može mijenjati');
});

// ─── efektivniStatus ────────────────────────────────────────

test('draft i poslana poslije roka postaju istekla', () => {
  expect(efektivniStatus({ status: 'draft', vaziDo: '2026-03-09' }, '2026-03-10')).toBe('istekla');
  expect(efektivniStatus({ status: 'poslana', vaziDo: '2026-03-09' }, '2026-03-10')).toBe('istekla');
});

test('ponuda unutar roka zadržava svoj status — uključujući zadnji dan roka', () => {
  expect(efektivniStatus({ status: 'poslana', vaziDo: '2026-03-09' }, '2026-03-09')).toBe('poslana');
  expect(efektivniStatus({ status: 'draft', vaziDo: '2026-03-09' }, '2026-03-01')).toBe('draft');
});

test('prihvacena, odbijena i konvertovana ne ističu', () => {
  expect(efektivniStatus({ status: 'prihvacena', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('prihvacena');
  expect(efektivniStatus({ status: 'odbijena', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('odbijena');
  expect(efektivniStatus({ status: 'konvertovana', vaziDo: '2026-03-09' }, '2026-04-01')).toBe('konvertovana');
});

// ─── setStatusPonude ────────────────────────────────────────

test('operater ručno mijenja status (draft → poslana → prihvacena)', () => {
  const { id } = napraviPonudu();
  setStatusPonude(db, id, 'poslana');
  setStatusPonude(db, id, 'prihvacena');
  const p = db.prepare('SELECT status FROM ponude WHERE id = ?').get(id) as any;
  expect(p.status).toBe('prihvacena');
});

test('konvertovana se ne može postaviti ručno', () => {
  const { id } = napraviPonudu();
  expect(() => setStatusPonude(db, id, 'konvertovana'))
    .toThrow('Status "konvertovana" postavlja se konverzijom u račun');
});

test('status konvertovane ponude se ne može mijenjati', () => {
  const { id } = napraviPonudu();
  db.prepare("UPDATE ponude SET status = 'konvertovana' WHERE id = ?").run(id);
  expect(() => setStatusPonude(db, id, 'odbijena'))
    .toThrow('Konvertovana ponuda se ne može mijenjati');
});

// ─── konvertujPonudu ────────────────────────────────────────

function printOk(broj = '55') {
  const calls: any[] = [];
  const print = async (racun: any) => {
    calls.push(racun);
    return { success: true, odgovori: { BrojFiskalnogRacuna: broj } } as any;
  };
  return { print, calls };
}

const printFail = async () =>
  ({ success: false, error: 'Štampač ne odgovara', odgovori: {} } as any);

function deps(print: any) {
  return { db, print, transaction: (fn: () => any) => db.transaction(fn) };
}

test('uspješna konverzija: račun po zamrznutim cijenama, skladište razduženo, ponuda zaključana', async () => {
  const { id, productId } = napraviPonudu(10);
  const korisnikId = dodajKorisnika();
  // Cjenovnik se u međuvremenu promijenio — konverzija ga ne smije vidjeti
  db.prepare('UPDATE products SET cijena = 99 WHERE id = ?').run(productId);

  const { print, calls } = printOk('77');
  const result = await konvertujPonudu(deps(print), { id, korisnikId, nacinPlacanja: 'Gotovina' });

  expect(result.success).toBe(true);
  expect(result.brojFiskalnogRacuna).toBe('77');

  // Štampano po zamrznutoj cijeni s ponude
  expect(calls[0].stavke[0].artikal.cijena).toBe(10);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.racunId) as any;
  expect(order.status).toBe('completed');
  expect(order.ukupno).toBe(10);
  expect(order.brojFiskalnogRacuna).toBe('77');
  expect(order.kupacNaziv).toBe('Test Kupac d.o.o.');

  const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(result.racunId) as any[];
  expect(items[0].cijena).toBe(10);

  const stock = db.prepare(
    "SELECT * FROM stock_movements WHERE referenceType = 'order' AND referenceId = ?"
  ).all(result.racunId) as any[];
  expect(stock.length).toBe(1);
  expect(stock[0].tip).toBe('izlaz');

  const p = db.prepare('SELECT status, racunId FROM ponude WHERE id = ?').get(id) as any;
  expect(p.status).toBe('konvertovana');
  expect(p.racunId).toBe(result.racunId);
});

test('neuspješna štampa: ništa se ne upisuje, ponuda ostaje kakva je bila', async () => {
  const { id } = napraviPonudu(10);
  const korisnikId = dodajKorisnika();

  const result = await konvertujPonudu(deps(printFail), { id, korisnikId, nacinPlacanja: 'Gotovina' });

  expect(result.success).toBe(false);
  expect(result.error).toBe('Štampač ne odgovara');
  expect(db.prepare('SELECT COUNT(*) AS c FROM orders').get()).toEqual({ c: 0 });
  const p = db.prepare('SELECT status, racunId FROM ponude WHERE id = ?').get(id) as any;
  expect(p.status).toBe('draft');
  expect(p.racunId).toBeNull();
});

test('već konvertovana ponuda se ne može ponovo konvertovati', async () => {
  const { id } = napraviPonudu(10);
  const korisnikId = dodajKorisnika();
  db.prepare("UPDATE ponude SET status = 'konvertovana' WHERE id = ?").run(id);

  const { print } = printOk();
  await expect(konvertujPonudu(deps(print), { id, korisnikId, nacinPlacanja: 'Gotovina' }))
    .rejects.toThrow('Ponuda je već konvertovana u račun');
});

test('usluge ne prave kretanje zaliha pri konverziji', async () => {
  const kupacId = dodajKupca('Uslužni kupac');
  const korisnikId = dodajKorisnika();
  const r = db.prepare("INSERT INTO products (sifra, naziv, cijena, pdvStopa, tip) VALUES ('USL1', 'Usluga', 50, 'E', 'usluga')").run();
  const productId = Number(r.lastInsertRowid);
  const pon = createPonuda(db, {
    kupacId, korisnikId, datum: '2026-03-01',
    stavke: [{ productId, kolicina: 1, cijena: 50, rabat: 0, pdvStopa: 'E' }],
  });

  const { print } = printOk();
  const result = await konvertujPonudu(deps(print), { id: pon.id, korisnikId, nacinPlacanja: 'Gotovina' });

  expect(result.success).toBe(true);
  const stock = db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get() as any;
  expect(stock.c).toBe(0);
});

test('createPonuda odbija ponudu bez stavki', () => {
  const kupacId = dodajKupca();
  const korisnikId = dodajKorisnika();
  expect(() => createPonuda(db, { kupacId, korisnikId, datum: '2026-03-01', stavke: [] }))
    .toThrow('Ponuda mora imati najmanje jednu stavku');
});

// ── Računanje roka važenja ──────────────────────────────────

test('danaIzmedju broji pune dane i preskače prelazak na ljetno vrijeme', () => {
  expect(danaIzmedju('2026-03-01', '2026-03-09')).toBe(8);
  // 29.03.2026. je prelazak na ljetno vrijeme — dan traje 23h.
  expect(danaIzmedju('2026-03-28', '2026-03-30')).toBe(2);
  // 25.10.2026. je povratak na zimsko — dan traje 25h.
  expect(danaIzmedju('2026-10-24', '2026-10-26')).toBe(2);
});

test('danaIzmedju vraća 0 za isti dan i negativan broj za obrnut redoslijed', () => {
  expect(danaIzmedju('2026-03-01', '2026-03-01')).toBe(0);
  expect(danaIzmedju('2026-03-09', '2026-03-01')).toBe(-8);
});

test('plusDana i danaIzmedju su inverzni, i preko prelaska na ljetno vrijeme', () => {
  expect(plusDana('2026-03-01', DEFAULT_ROK_DANA)).toBe('2026-03-09');
  expect(plusDana('2026-03-28', 2)).toBe('2026-03-30');
  expect(danaIzmedju('2026-03-28', plusDana('2026-03-28', 15))).toBe(15);
});
