# Račun po prilogu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fiskalni račun sa jednom zbirnom stavkom "Stavke po računu br. N" čije se stvarne stavke naknadno dodjeljuju u sekciji Računi i printaju kao A4 specifikacija sa BF brojem.

**Architecture:** Nova kolona `orders.prilogBroj` (flag + interni broj) i tabela `prilog_stavke`; `order_items` ostaje prazan za prilog račune, a zbirna stavka se sintetizuje pri prikazu/štampi. Orkestracija fiskalizacije i logika stavki žive u `src/lib/prilog.ts` (testabilno nad `bun:sqlite` + mock Tring serverom, po uzoru na `lib/refund.ts`), IPC handleri su tanki omotači.

**Tech Stack:** Electron Forge + React + ShadCN, better-sqlite3 (prod) / bun:sqlite (testovi), `@react-pdf/renderer` za PDF, Tring fiskalni server.

**Spec:** `docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md`

## Global Constraints

- Naziv zbirne stavke: tačno `Stavke po računu br. ${prilogBroj}`; PDV stopa `E`, količina 1, rabat 0, šifra `PRILOG`, plu 0.
- U prilog smiju samo proizvodi sa `pdvStopa = 'E'`.
- Print PDF-a dozvoljen tek kad je `sumaPriloga === round2(orders.ukupno)` (poređenje na 2 decimale preko `round2`).
- Skladište: movements `tip='izlaz'`, `referenceType='prilog'`, `referenceId=orderId`, samo za proizvode `tip='artikal'`.
- Promet se računa isključivo iz `orders` — ništa se ne mijenja u izvještajima.
- Svi komentari u kodu na bosanskom, kao u ostatku repo-a. UI tekstovi na bosanskom.
- Testovi: `bun test` (bun:sqlite `:memory:` + `schema` iz `src/database/schema.ts`; mock fiskalni server `startMockTringServer` — svaki test fajl bira svoj slobodan port, zauzeti su 8085, 8097, 8099).
- Commit poslije svakog taska, poruke stilom repo-a: `feat(prilog): ...`, `fix(...)`, itd.

---

### Task 1: Baza — kolona `prilogBroj` i tabela `prilog_stavke`

**Files:**
- Modify: `src/database/schema.ts` (orders CREATE TABLE + nova tabela)
- Modify: `src/database/migrations.ts`
- Test: `src/database/migrations.test.ts`

**Interfaces:**
- Produces: kolona `orders.prilogBroj INTEGER NULL`; tabela `prilog_stavke(id, orderId, productId, kolicina REAL, cijena REAL, pdvStopa TEXT)`. Svi kasniji taskovi ovise o ovome.

- [ ] **Step 1: Napiši padajući test za migraciju**

Pogledaj postojeće testove u `src/database/migrations.test.ts` i prati njihov stil (kreiranje "stare" baze pa `runMigrations`). Dodaj:

```ts
test('dodaje prilogBroj kolonu na orders iz starije baze', () => {
  const db = new Database(':memory:');
  // stara baza: orders bez prilogBroj kolone
  db.exec(`CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    ukupno REAL NOT NULL,
    pdvIznos REAL NOT NULL,
    nacinPlacanja TEXT NOT NULL,
    brojFiskalnogRacuna TEXT,
    status TEXT NOT NULL
  )`);
  // minimalne ostale tabele koje runMigrations dira (vidi postojeće testove u fajlu)
  db.exec(`CREATE TABLE primka_stavke (id INTEGER PRIMARY KEY);
           CREATE TABLE primke (id INTEGER PRIMARY KEY);
           CREATE TABLE products (id INTEGER PRIMARY KEY)`);
  runMigrations(db as any);
  const cols = db.prepare('PRAGMA table_info(orders)').all() as { name: string }[];
  expect(cols.some(c => c.name === 'prilogBroj')).toBe(true);
});

test('kreira prilog_stavke tabelu ako ne postoji', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY);
           CREATE TABLE primka_stavke (id INTEGER PRIMARY KEY);
           CREATE TABLE primke (id INTEGER PRIMARY KEY);
           CREATE TABLE products (id INTEGER PRIMARY KEY)`);
  runMigrations(db as any);
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prilog_stavke'").get();
  expect(t).toBeTruthy();
});
```

Napomena: ako postojeći testovi u fajlu već imaju helper za "staru bazu", iskoristi njega umjesto dupliranja CREATE TABLE blokova.

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `bun test src/database/migrations.test.ts`
Expected: FAIL (kolona/tabela ne postoje nakon migracije)

- [ ] **Step 3: Implementiraj schema + migracije**

U `src/database/schema.ts`, u `orders` CREATE TABLE dodaj kolonu (iza `isManual`):

```sql
prilogBroj INTEGER,
```

i na kraj schema-e (uz ostale CREATE TABLE) dodaj:

```sql
CREATE TABLE IF NOT EXISTS prilog_stavke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  productId INTEGER NOT NULL,
  kolicina REAL NOT NULL,
  cijena REAL NOT NULL,
  pdvStopa TEXT NOT NULL,
  FOREIGN KEY (orderId) REFERENCES orders(id),
  FOREIGN KEY (productId) REFERENCES products(id)
);
```

U `src/database/migrations.ts` (na kraj `runMigrations`, koristi već učitani `orderCols`... pažnja: `orderCols` je pročitan ranije u funkciji — dodaj provjeru po istom obrascu kao `isManual`):

```ts
// Račun po prilogu: interni broj priloga (NULL = običan račun)
if (!orderCols.find(c => c.name === 'prilogBroj')) {
  database.exec("ALTER TABLE orders ADD COLUMN prilogBroj INTEGER");
}

// Stavke priloga (specifikacija uz fiskalni račun)
database.exec(`
  CREATE TABLE IF NOT EXISTS prilog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  )
`);
```

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `bun test src/database/`
Expected: PASS (i novi i svi postojeći)

- [ ] **Step 5: Commit**

```bash
git add src/database/schema.ts src/database/migrations.ts src/database/migrations.test.ts
git commit -m "feat(prilog): prilogBroj kolona i prilog_stavke tabela"
```

---

### Task 2: `lib/prilog.ts` — brojevi, naziv, suma, fiskalna stavka

**Files:**
- Create: `src/lib/prilog.ts`
- Test: `src/lib/prilog.test.ts`

**Interfaces:**
- Consumes: `SqlDb` iz `./sqldb`, `round2` iz `./novac`, `iznosStavke`, `izracunajTotale` iz `./racun`.
- Produces (kasniji taskovi ih koriste tačno ovako):
  - `PRILOG_SIFRA = 'PRILOG'`
  - `prilogNaziv(broj: number): string`
  - `sljedeciPrilogBroj(db: SqlDb): number`
  - `interface PrilogStavkaUnos { productId: number; kolicina: number; cijena: number; pdvStopa: string }`
  - `sumaPriloga(stavke: PrilogStavkaUnos[]): number`
  - `prilogKompletan(ukupno: number, stavke: PrilogStavkaUnos[]): boolean`
  - `buildPrilogFiskalnaStavka(prilogBroj: number, iznos: number)` → `{ productId: 0, sifra: 'PRILOG', naziv, jm: 'kom', plu: 0, cijena, kolicina: 1, rabat: 0, pdvStopa: 'E' }`

- [ ] **Step 1: Napiši padajuće testove**

`src/lib/prilog.test.ts`:

```ts
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  PRILOG_SIFRA, prilogNaziv, sljedeciPrilogBroj,
  sumaPriloga, prilogKompletan, buildPrilogFiskalnaStavka,
} from './prilog';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

function dodajOrder(opts: { ukupno: number; prilogBroj?: number | null }): number {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, prilogBroj)
    VALUES (1, ?, 0, 'Gotovina', 'completed', ?)
  `).run(opts.ukupno, opts.prilogBroj ?? null);
  return Number(r.lastInsertRowid);
}

test('prilogNaziv formira tačan naziv stavke', () => {
  expect(prilogNaziv(17)).toBe('Stavke po računu br. 17');
});

test('sljedeciPrilogBroj počinje od 1 na praznoj bazi', () => {
  expect(sljedeciPrilogBroj(db)).toBe(1);
});

test('sljedeciPrilogBroj ignorira obične račune i nastavlja od maksimuma', () => {
  dodajOrder({ ukupno: 10 });                    // običan račun, prilogBroj NULL
  dodajOrder({ ukupno: 20, prilogBroj: 4 });
  expect(sljedeciPrilogBroj(db)).toBe(5);
});

test('sumaPriloga zaokružuje po stavci pa zbir', () => {
  const stavke = [
    { productId: 1, kolicina: 3, cijena: 0.335, pdvStopa: 'E' },  // 1.005 → 1.01 po stavci
    { productId: 2, kolicina: 1, cijena: 2,     pdvStopa: 'E' },
  ];
  expect(sumaPriloga(stavke)).toBe(3.01);
});

test('prilogKompletan poredi na 2 decimale', () => {
  const stavke = [{ productId: 1, kolicina: 2, cijena: 75, pdvStopa: 'E' }];
  expect(prilogKompletan(150, stavke)).toBe(true);
  expect(prilogKompletan(150.01, stavke)).toBe(false);
});

test('buildPrilogFiskalnaStavka gradi zbirnu stavku', () => {
  const s = buildPrilogFiskalnaStavka(17, 150);
  expect(s).toEqual({
    productId: 0, sifra: PRILOG_SIFRA, naziv: 'Stavke po računu br. 17',
    jm: 'kom', plu: 0, cijena: 150, kolicina: 1, rabat: 0, pdvStopa: 'E',
  });
});
```

- [ ] **Step 2: Pokreni testove — moraju pasti**

Run: `bun test src/lib/prilog.test.ts`
Expected: FAIL ("Cannot find module './prilog'")

- [ ] **Step 3: Implementiraj `src/lib/prilog.ts`**

```ts
import type { SqlDb } from './sqldb';
import { round2 } from './novac';
import { iznosStavke } from './racun';

/**
 * Račun po prilogu: fiskalno se kuca jedna zbirna stavka, a stvarne stavke se
 * naknadno dodjeljuju (prilog_stavke) i printaju kao specifikacija sa BF
 * brojem. Vidi docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md.
 */

export const PRILOG_SIFRA = 'PRILOG';

export function prilogNaziv(broj: number): string {
  return `Stavke po računu br. ${broj}`;
}

/** Interni broj priloga: nastavlja se na najveći do sada izdati. */
export function sljedeciPrilogBroj(db: SqlDb): number {
  const row = db.prepare('SELECT COALESCE(MAX(prilogBroj), 0) + 1 AS broj FROM orders').get() as { broj: number };
  return row.broj;
}

export interface PrilogStavkaUnos {
  productId: number;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
}

/** Zbir stavki priloga — zaokruživanje po stavci kao na fiskalnom uređaju. */
export function sumaPriloga(stavke: PrilogStavkaUnos[]): number {
  return round2(stavke.reduce((sum, s) => sum + iznosStavke({ ...s, rabat: 0 }), 0));
}

/** Prilog je kompletan tek kad se suma stavki poklopi sa fiskalnim iznosom. */
export function prilogKompletan(ukupno: number, stavke: PrilogStavkaUnos[]): boolean {
  return sumaPriloga(stavke) === round2(ukupno);
}

/** Zbirna stavka kako se šalje fiskalnom uređaju (i sintetizuje u prikazima). */
export function buildPrilogFiskalnaStavka(prilogBroj: number, iznos: number) {
  return {
    productId: 0,
    sifra: PRILOG_SIFRA,
    naziv: prilogNaziv(prilogBroj),
    jm: 'kom',
    plu: 0,
    cijena: round2(iznos),
    kolicina: 1,
    rabat: 0,
    pdvStopa: 'E',
  };
}
```

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `bun test src/lib/prilog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prilog.ts src/lib/prilog.test.ts
git commit -m "feat(prilog): osnovna logika broja, naziva i zbirne stavke"
```

---

### Task 3: `savePrilogStavkeInTransaction` — upis stavki + diff stock movements

**Files:**
- Modify: `src/lib/prilog.ts`
- Test: `src/lib/prilog.test.ts` (dodaj testove)

**Interfaces:**
- Consumes: Task 2 (`PrilogStavkaUnos`), tabele iz Taska 1.
- Produces: `savePrilogStavkeInTransaction(db: SqlDb, orderId: number, stavke: PrilogStavkaUnos[]): void` — poziva se UNUTAR transakcije (handler je omota u `db.transaction`, kao `refundOrderInTransaction`).

- [ ] **Step 1: Napiši padajuće testove**

Dodaj u `src/lib/prilog.test.ts` (koristi postojeći `beforeEach` i `dodajOrder`; dodaj helper po uzoru na `refund.integration.test.ts`):

```ts
import { savePrilogStavkeInTransaction } from './prilog';
import { getProductStock } from './skladiste';

function dodajArtikal(id: number, cijena: number, tip = 'artikal', pdvStopa = 'E'): void {
  db.prepare("INSERT INTO products (id, sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, ?, 'kom', ?, ?, ?)")
    .run(id, `A${id}`, `Artikal ${id}`, cijena, pdvStopa, tip);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 100, 'test', 0)")
    .run(id);
}

test('savePrilogStavke upisuje stavke i skida stanje artiklima', () => {
  dodajArtikal(1, 30);
  dodajArtikal(2, 90, 'usluga');
  const orderId = dodajOrder({ ukupno: 150, prilogBroj: 1 });

  savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
    { productId: 2, kolicina: 1, cijena: 90, pdvStopa: 'E' },
  ]);

  const rows = db.prepare('SELECT * FROM prilog_stavke WHERE orderId = ?').all(orderId);
  expect(rows.length).toBe(2);
  expect(getProductStock(db, 1)).toBe(98);   // artikal skinut
  expect(getProductStock(db, 2)).toBe(100);  // usluga ne dira stanje
});

test('ponovni upis radi diff: stara kretanja se zamijene, bez duplog skidanja', () => {
  dodajArtikal(1, 30);
  dodajArtikal(3, 50);
  const orderId = dodajOrder({ ukupno: 150, prilogBroj: 1 });

  savePrilogStavkeInTransaction(db, orderId, [{ productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' }]);
  savePrilogStavkeInTransaction(db, orderId, [{ productId: 3, kolicina: 3, cijena: 50, pdvStopa: 'E' }]);

  expect(getProductStock(db, 1)).toBe(100);  // vraćeno nakon zamjene
  expect(getProductStock(db, 3)).toBe(97);
  const rows = db.prepare('SELECT productId FROM prilog_stavke WHERE orderId = ?').all(orderId) as any[];
  expect(rows.map(r => r.productId)).toEqual([3]);
});

test('odbija stavku sa PDV stopom različitom od E', () => {
  dodajArtikal(1, 30, 'artikal', 'K');
  const orderId = dodajOrder({ ukupno: 60, prilogBroj: 1 });
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'K' },
  ])).toThrow(/PDV stopom/);
});

test('odbija običan račun (bez prilogBroj) i storniran račun', () => {
  dodajArtikal(1, 30);
  const obican = dodajOrder({ ukupno: 60 });
  expect(() => savePrilogStavkeInTransaction(db, obican, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/nije račun po prilogu/);

  const prilog = dodajOrder({ ukupno: 60, prilogBroj: 2 });
  db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(prilog);
  expect(() => savePrilogStavkeInTransaction(db, prilog, [
    { productId: 1, kolicina: 2, cijena: 30, pdvStopa: 'E' },
  ])).toThrow(/storniran/);
});

test('odbija količinu <= 0 i negativnu cijenu', () => {
  dodajArtikal(1, 30);
  const orderId = dodajOrder({ ukupno: 60, prilogBroj: 1 });
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 0, cijena: 30, pdvStopa: 'E' },
  ])).toThrow();
  expect(() => savePrilogStavkeInTransaction(db, orderId, [
    { productId: 1, kolicina: 1, cijena: -5, pdvStopa: 'E' },
  ])).toThrow();
});
```

- [ ] **Step 2: Pokreni testove — moraju pasti**

Run: `bun test src/lib/prilog.test.ts`
Expected: FAIL ("savePrilogStavkeInTransaction is not exported")

- [ ] **Step 3: Implementiraj**

Dodaj u `src/lib/prilog.ts`:

```ts
/**
 * Zamijeni kompletan set stavki priloga i sinhronizuj zalihe.
 *
 * Poziva se unutar transakcije (handler omotava u db.transaction). Diff je
 * najjednostavniji mogući: obriši stara kretanja tipa 'prilog' pa upiši nova —
 * neto efekat na zalihu je isti kao ručni diff, a nema stanja za greške.
 */
export function savePrilogStavkeInTransaction(
  db: SqlDb,
  orderId: number,
  stavke: PrilogStavkaUnos[]
): void {
  const order = db.prepare('SELECT prilogBroj, status FROM orders WHERE id = ?').get(orderId) as
    { prilogBroj: number | null; status: string } | undefined;
  if (!order) throw new Error('Račun ne postoji');
  if (order.prilogBroj == null) throw new Error('Ovo nije račun po prilogu');
  if (order.status !== 'completed') throw new Error('Račun je storniran — prilog se ne može mijenjati');

  for (const s of stavke) {
    if (!(s.kolicina > 0)) throw new Error('Količina mora biti veća od 0');
    if (s.cijena < 0) throw new Error('Cijena ne može biti negativna');
    if (s.pdvStopa !== 'E') {
      throw new Error('U prilog smiju samo stavke sa PDV stopom E (zbirna stavka je fiskalizovana sa E)');
    }
  }

  db.prepare('DELETE FROM prilog_stavke WHERE orderId = ?').run(orderId);
  db.prepare("DELETE FROM stock_movements WHERE referenceType = 'prilog' AND referenceId = ?").run(orderId);

  const insertStavka = db.prepare(
    'INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'prilog', ?)"
  );

  for (const s of stavke) {
    insertStavka.run(orderId, s.productId, s.kolicina, s.cijena, s.pdvStopa);
    const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(s.productId) as { tip: string } | undefined;
    if (!product) throw new Error(`Proizvod #${s.productId} ne postoji`);
    if (product.tip !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
  }
}
```

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `bun test src/lib/prilog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/prilog.ts src/lib/prilog.test.ts
git commit -m "feat(prilog): upis stavki priloga sa diff sinhronizacijom zaliha"
```

---

### Task 4: `finalizePrilogAndPrint` — fiskalizacija zbirne stavke (orkestracija)

**Files:**
- Modify: `src/lib/prilog.ts`
- Test: `src/lib/prilog.integration.test.ts` (novi fajl)

**Interfaces:**
- Consumes: Task 2 (`sljedeciPrilogBroj`, `buildPrilogFiskalnaStavka`, `prilogNaziv`), `buildTringRacun` iz `./tringRacun`, `izracunajTotale` iz `./racun`, tipovi `Tring.Racun`/`Tring.TringResponse` iz `@/services/tring`.
- Produces:
  - `interface FinalizePrilogDeps { db: SqlDb; print: (racun: Tring.Racun) => Promise<Tring.TringResponse | null>; transaction: (fn: () => void) => () => void }`
  - `finalizePrilogAndPrint(deps, data: { korisnikId: number; iznos: number; nacinPlacanja: string; kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string } }): Promise<{ success: boolean; id?: number; prilogBroj?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string> }>`

Tok je preslikan sa `order:finalize` handlera (write-ahead pending → print → atomični upis) i `refundAndPrint` obrasca (deps za testabilnost):

1. Validacija: `iznos > 0`, `korisnikId` obavezan.
2. `prilogBroj = sljedeciPrilogBroj(db)`; `stavka = buildPrilogFiskalnaStavka(prilogBroj, iznos)`; `{ ukupno, pdvIznos } = izracunajTotale([stavka])`.
3. Write-ahead u `pending_receipts`: snapshot `{ korisnikId, ukupno, pdvIznos, nacinPlacanja, kupac, stavke: [], prilogBroj }` — **`stavke: []` i `prilogBroj` u snapshotu su bitni** da `pending:resolve` preko `insertCompletedOrder` rekonstruiše prilog račun bez order_items (Task 6 proširuje `insertCompletedOrder`).
4. `print(buildTringRacun({ ukupno, nacinPlacanja, kupac, items: [stavka] }))`.
5. Neuspjeh → obriši pending red, vrati `{ success: false, error, odgovori }`.
6. Uspjeh → u transakciji: INSERT u `orders` (sa `prilogBroj`, bez ijednog order_item i bez stock movements) + DELETE pending reda; vrati `{ success: true, id, prilogBroj, brojFiskalnogRacuna, odgovori }`.

- [ ] **Step 1: Napiši padajući integracioni test**

`src/lib/prilog.integration.test.ts` (uzor: `refund.integration.test.ts`; port 8098):

```ts
// End-to-end: finalizePrilogAndPrint -> pravi Tring klijent -> mock fiskalni server -> baza.
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

afterAll(() => { server.close(); });

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Kasir', '1234', 'kasir')").run();
});

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
});

test('drugi prilog račun dobija sljedeći broj', async () => {
  await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 10, nacinPlacanja: 'Gotovina' });
  const res = await finalizePrilogAndPrint(deps(), { korisnikId: 1, iznos: 20, nacinPlacanja: 'Kartica' });
  expect(res.prilogBroj).toBe(2);
});

test('kupac se upisuje na račun', async () => {
  const res = await finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 50, nacinPlacanja: 'Virman',
    kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', adresa: 'Ulica 1', grad: 'Sarajevo', postanskiBroj: '71000' },
  });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.id!) as any;
  expect(order.kupacNaziv).toBe('Firma d.o.o.');
  expect(order.kupacIdBroj).toBe('4200000000001');
});

test('odbija iznos <= 0', async () => {
  await expect(finalizePrilogAndPrint(deps(), {
    korisnikId: 1, iznos: 0, nacinPlacanja: 'Gotovina',
  })).rejects.toThrow(/[Ii]znos/);
});

test('neuspješna štampa ne ostavlja ni order ni pending red', async () => {
  // Mock server: štampa pada kad je print nedostupan — vidi kako refund.integration
  // simulira grešku; ako mock nema takav mehanizam, privremeno rekonfiguriši port:
  Tring.configure({ host: 'localhost', port: 1 }); // nedostupan server
  try {
    const res = await finalizePrilogAndPrint(deps(), {
      korisnikId: 1, iznos: 150, nacinPlacanja: 'Gotovina',
    }).catch(err => ({ success: false, error: String(err) }));
    expect(res.success).toBe(false);
    expect(db.prepare('SELECT * FROM orders').all().length).toBe(0);
    expect(db.prepare('SELECT * FROM pending_receipts').all().length).toBe(0);
  } finally {
    Tring.configure({ host: 'localhost', port: PORT });
  }
});
```

Napomena za zadnji test: prvo pogledaj `src/services/tring.ts` — ako `stampatiFiskalniRacun` na mrežnu grešku BACA (a ne vraća `{success:false}`), onda `finalizePrilogAndPrint` mora u `try/finally` obrisati pending red prije nego što grešku propusti dalje, i test prilagodi tome (`rejects.toThrow` + provjera da su tabele prazne).

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `bun test src/lib/prilog.integration.test.ts`
Expected: FAIL ("finalizePrilogAndPrint is not exported")

- [ ] **Step 3: Implementiraj**

Dodaj u `src/lib/prilog.ts`:

```ts
import type * as Tring from '@/services/tring';
import { buildTringRacun } from './tringRacun';
import { izracunajTotale } from './racun';

export interface FinalizePrilogDeps {
  db: SqlDb;
  /** Štampa fiskalni račun na uređaju. */
  print: (racun: Tring.Racun) => Promise<Tring.TringResponse | null>;
  /** Omotač koji izvrši callback u SQL transakciji. */
  transaction: (fn: () => void) => () => void;
}

export interface FinalizePrilogResult {
  success: boolean;
  id?: number;
  prilogBroj?: number;
  brojFiskalnogRacuna?: string | null;
  error?: string;
  odgovori?: Record<string, string>;
}

/**
 * Fiskalizuje račun po prilogu: jedna zbirna stavka, ručno unesen iznos.
 * Isti write-ahead obrazac kao order:finalize — snapshot u pending_receipts
 * prije štampe, pa atomični upis ordera + brisanje pending reda.
 */
export async function finalizePrilogAndPrint(
  deps: FinalizePrilogDeps,
  data: {
    korisnikId: number;
    iznos: number;
    nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
  }
): Promise<FinalizePrilogResult> {
  const { db, print, transaction } = deps;
  if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
  if (!(data.iznos > 0)) throw new Error('Iznos mora biti veći od 0');

  const prilogBroj = sljedeciPrilogBroj(db);
  const stavka = buildPrilogFiskalnaStavka(prilogBroj, data.iznos);
  const { ukupno, pdvIznos } = izracunajTotale([stavka]);

  // Write-ahead: stavke:[] + prilogBroj → pending:resolve rekonstruiše prilog račun.
  const snapshot = {
    korisnikId: data.korisnikId, ukupno, pdvIznos,
    nacinPlacanja: data.nacinPlacanja, kupac: data.kupac,
    stavke: [], prilogBroj,
  };
  const pending = db
    .prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)')
    .run(data.korisnikId, JSON.stringify(snapshot));
  const pendingId = pending.lastInsertRowid as number;

  let result: Tring.TringResponse | null;
  try {
    result = await print(buildTringRacun({
      ukupno, nacinPlacanja: data.nacinPlacanja, kupac: data.kupac, items: [stavka],
    }));
  } catch (err) {
    // Mrežna greška — ništa nije odštampano, počisti write-ahead red.
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    throw err;
  }

  if (!result || !result.success) {
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
    return {
      success: false,
      error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška',
      odgovori: result?.odgovori ?? {},
    };
  }

  const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;
  let orderId = 0;
  transaction(() => {
    const r = db.prepare(`
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
        kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, prilogBroj)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 0, ?)
    `).run(
      data.korisnikId, ukupno, pdvIznos, data.nacinPlacanja, brojFiskalnogRacuna,
      data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
      data.kupac?.grad || null, data.kupac?.postanskiBroj || null, prilogBroj
    );
    orderId = Number(r.lastInsertRowid);
    db.prepare('DELETE FROM pending_receipts WHERE id = ?').run(pendingId);
  })();

  return { success: true, id: orderId, prilogBroj, brojFiskalnogRacuna, odgovori: result.odgovori };
}
```

Prilagodi ponašanje na mrežnu grešku stvarnom ponašanju `Tring.stampatiFiskalniRacun` (vidi napomenu u Stepu 1).

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `bun test src/lib/`
Expected: PASS (svi lib testovi, ne samo novi)

- [ ] **Step 5: Commit**

```bash
git add src/lib/prilog.ts src/lib/prilog.integration.test.ts
git commit -m "feat(prilog): fiskalizacija zbirne stavke sa write-ahead upisom"
```

---

### Task 5: Storno prilog računa — zaliha iz `prilog_stavke`, reklamacija sa zbirnom stavkom

**Files:**
- Modify: `src/lib/refund.ts`
- Test: `src/lib/refund.test.ts` i/ili `src/lib/refund.integration.test.ts` (dodaj testove; prati gdje koji nivo pripada po postojećoj podjeli fajlova)

**Interfaces:**
- Consumes: `prilogNaziv`, `PRILOG_SIFRA` iz `./prilog` (Task 2); tabele iz Taska 1.
- Produces: nepromijenjeni potpisi `refundOrderInTransaction` i `refundAndPrint` — samo interno granaju za prilog račune.

- [ ] **Step 1: Napiši padajuće testove**

U `src/lib/refund.integration.test.ts` (koristi postojeće helpere `dodajArtikal`/`dodajRacun` — proširi `dodajRacun` opcionalnim `prilogBroj` poljem ili dodaj mali helper):

```ts
test('storno prilog računa vraća zalihu po prilog_stavke', async () => {
  dodajArtikal(1, 'A1', 30);
  // prilog račun: order bez order_items, sa prilog stavkama i njihovim izlazima
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, prilogBroj)
    VALUES (1, 60, 8.72, 'Gotovina', '55', 'completed', 1)
  `).run();
  const orderId = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, 1, 2, 30, 'E')").run(orderId);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (1, 'izlaz', 2, 'prilog', ?)").run(orderId);

  const result = await refundAndPrint(deps(), { id: orderId });

  expect(result.success).toBe(true);
  expect(getProductStock(db, 1)).toBe(100); // 100 ulaz - 2 prilog + 2 refund
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as any;
  expect(order.status).toBe('refunded');
});

test('storno prilog računa bez dodijeljenih stavki prolazi (nema šta vratiti)', async () => {
  const r = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, prilogBroj)
    VALUES (1, 60, 8.72, 'Gotovina', '56', 'completed', 2)
  `).run();
  const result = await refundAndPrint(deps(), { id: Number(r.lastInsertRowid) });
  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Pokreni testove — moraju pasti**

Run: `bun test src/lib/refund.integration.test.ts`
Expected: FAIL — prvi test pada jer se zaliha ne vraća (refund čita samo `order_items`); mogući pad i na štampi reklamacije (prazne stavke).

- [ ] **Step 3: Implementiraj granu za prilog**

U `refundOrderInTransaction` (`src/lib/refund.ts`), zamijeni čitanje stavki:

```ts
  const orderRow = db.prepare("SELECT id, prilogBroj FROM orders WHERE id = ? AND status = 'completed'").get(id) as
    { id: number; prilogBroj: number | null } | undefined;
  if (!orderRow) throw new Error('Račun ne postoji ili je već storniran');
```

(umjesto postojećeg `const order = ...` reda; UPDATE ostaje isti) i:

```ts
  // Prilog račun nema order_items — zaliha se vraća po stavkama priloga.
  const items = (orderRow.prilogBroj != null
    ? db.prepare('SELECT productId, kolicina FROM prilog_stavke WHERE orderId = ?')
    : db.prepare('SELECT productId, kolicina FROM order_items WHERE orderId = ?')
  ).all(id) as Array<{ productId: number; kolicina: number }>;
```

U `refundAndPrint`, poslije čitanja `stavke` iz `order_items`, dodaj sintetičku zbirnu stavku za prilog račune (reklamacija na fiskalnom uređaju mora imati istu stavku kao original):

```ts
  const stavke = order.prilogBroj != null
    ? [{
        sifra: PRILOG_SIFRA, naziv: prilogNaziv(order.prilogBroj), jm: 'kom', plu: 0,
        cijena: order.ukupno, kolicina: 1, rabat: 0, pdvStopa: 'E',
      }]
    : db.prepare(`
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?
      `).all(id);
```

Import na vrhu: `import { PRILOG_SIFRA, prilogNaziv } from './prilog';`

- [ ] **Step 4: Pokreni testove — moraju proći**

Run: `bun test src/lib/`
Expected: PASS (novi + svi postojeći refund testovi)

- [ ] **Step 5: Commit**

```bash
git add src/lib/refund.ts src/lib/refund.integration.test.ts src/lib/refund.test.ts
git commit -m "feat(prilog): storno prilog racuna vraca zalihu iz prilog_stavke"
```

---

### Task 6: IPC handleri, preload i tipovi

**Files:**
- Modify: `src/ipc/handlers.ts`
- Modify: `src/preload.ts`
- Modify: `src/global.d.ts`

**Interfaces:**
- Consumes: Task 2–4 (`sljedeciPrilogBroj`, `savePrilogStavkeInTransaction`, `finalizePrilogAndPrint`, `prilogNaziv`, `PRILOG_SIFRA`, tip `PrilogStavkaUnos`).
- Produces (renderer ih zove preko `window.api`):
  - `finalizePrilogOrder(data: { korisnikId: number; iznos: number; nacinPlacanja: string; kupac?: any }) → Promise<FinalizePrilogResult>`
  - `getNextPrilogBroj() → Promise<number>`
  - `getPrilogStavke(orderId: number) → Promise<any[]>` (redovi sa `productNaziv`, `productJm`, `productSifra`, `productTip`)
  - `savePrilogStavke(orderId: number, stavke: PrilogStavkaUnos[]) → Promise<{ success: boolean }>`
  - `order:get` za prilog račune vraća sintetičku zbirnu stavku u `order.stavke` + polje `prilogBroj` (postojeći `SELECT o.*` ga već nosi).

Nema automatskih testova za sam IPC sloj (postojeći handleri ih nemaju — logika je već pokrivena u lib taskovima). Verifikacija: typecheck + lint.

- [ ] **Step 1: Handleri u `src/ipc/handlers.ts`**

Importi na vrhu (uz postojeće lib importe):

```ts
import {
  sljedeciPrilogBroj, savePrilogStavkeInTransaction, finalizePrilogAndPrint,
  buildPrilogFiskalnaStavka, PRILOG_SIFRA, prilogNaziv, type PrilogStavkaUnos,
} from '../lib/prilog';
```

`insertCompletedOrder` — dodaj podršku za `prilogBroj` (treba `pending:resolve` toku; potpis se širi opcionalnim poljem `prilogBroj?: number | null` u `data`):

```ts
// u INSERT koloni listi, iza isManual:
..., isManual${hasCreatedAt ? ', createdAt' : ''}, prilogBroj)
// u VALUES: dodaj jedan ? na kraj
// u .run(...): iza isManual/createdAt argumenata dodaj:
data.prilogBroj ?? null
```

(Pazi na redoslijed: `createdAt` je uslovni parametar — najjednostavnije je `prilogBroj` staviti kao POSLJEDNJU kolonu i posljednji argument.)

Novi handleri (smjesti ih odmah iza `order:finalize`):

```ts
  handle('order:finalizePrilog', async (data: {
    korisnikId: number; iznos: number; nacinPlacanja: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
  }) => {
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

  handle('prilog:nextBroj', () => sljedeciPrilogBroj(db));

  handle('prilog:getStavke', (orderId: number) => {
    return db.prepare(`
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.tip AS productTip
      FROM prilog_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.orderId = ?
    `).all(orderId);
  });

  handle('prilog:saveStavke', (orderId: number, stavke: PrilogStavkaUnos[]) => {
    db.transaction(() => savePrilogStavkeInTransaction(db, orderId, stavke))();
    return { success: true };
  });
```

`order:get` — poslije punjenja `order.stavke`, sintetizuj zbirnu stavku za prilog račune (prikaz detalja i kopija računa tada rade bez izmjena):

```ts
    // Prilog račun nema order_items — prikaz i kopija računa dobiju zbirnu stavku.
    if (order.prilogBroj != null) {
      order.stavke = [{
        orderId: order.id, productId: 0, kolicina: 1, cijena: order.ukupno, rabat: 0,
        pdvStopa: 'E', productNaziv: prilogNaziv(order.prilogBroj),
        productJm: 'kom', productSifra: PRILOG_SIFRA, productPlu: 0,
      }];
    }
```

- [ ] **Step 2: Preload u `src/preload.ts`**

Iza `finalizeOrder`:

```ts
  finalizePrilogOrder: (data: any) => ipcRenderer.invoke('order:finalizePrilog', data),
  getNextPrilogBroj: () => ipcRenderer.invoke('prilog:nextBroj'),
  getPrilogStavke: (orderId: number) => ipcRenderer.invoke('prilog:getStavke', orderId),
  savePrilogStavke: (orderId: number, stavke: any[]) => ipcRenderer.invoke('prilog:saveStavke', orderId, stavke),
```

- [ ] **Step 3: Tipovi u `src/global.d.ts`**

Iza `finalizeOrder` deklaracije:

```ts
    finalizePrilogOrder: (data: { korisnikId: number; iznos: number; nacinPlacanja: string; kupac?: any }) => Promise<{
      success: boolean; id?: number; prilogBroj?: number; brojFiskalnogRacuna?: string | null;
      error?: string; odgovori?: Record<string, string>;
    }>;
    getNextPrilogBroj: () => Promise<number>;
    getPrilogStavke: (orderId: number) => Promise<any[]>;
    savePrilogStavke: (orderId: number, stavke: Array<{ productId: number; kolicina: number; cijena: number; pdvStopa: string }>) => Promise<{ success: boolean }>;
```

- [ ] **Step 4: Verifikacija**

Run: `bunx tsc --noEmit && bun run lint && bun test`
Expected: bez grešaka (lint smije prijaviti samo postojeće/nepovezane warninge), svi testovi PASS

- [ ] **Step 5: Commit**

```bash
git add src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat(prilog): IPC handleri i preload API za racun po prilogu"
```

---

### Task 7: Kasa — dugme "Račun po prilogu" + dijalog

**Files:**
- Create: `src/components/PrilogRacunDialog.tsx`
- Modify: `src/screens/KasaScreen.tsx`

**Interfaces:**
- Consumes: `window.api.finalizePrilogOrder`, `window.api.getNextPrilogBroj` (Task 6); ShadCN `Dialog`, `Button`, `Label`, `Input`, `DecimalInput` (`@/components/ui/...`); `prilogNaziv` iz `@/lib/prilog`; `formatKM` — provjeri odakle ga KasaScreen importuje i koristi isti izvor.
- Produces: `<PrilogRacunDialog open onOpenChange korisnikId onSuccess />` — `onSuccess(res: { id: number; prilogBroj: number; brojFiskalnogRacuna: string | null })`.

- [ ] **Step 1: Napravi `src/components/PrilogRacunDialog.tsx`**

Sadržaj (prati vizuelni stil postojećih dijaloga, npr. `CashMovementDialog.tsx` / `DodajRacunDialog.tsx` — pogledaj ih prije pisanja):

- State: `iznos: number | null`, `nacinPlacanja: PaymentType` (isti tip unije kao KasaScreen: `'Gotovina' | 'Kartica' | 'Virman' | 'Ček'`, default `'Gotovina'`), kupac polja (`kupacNaziv`, `kupacIdBroj`, `kupacAdresa`, `kupacGrad`, `kupacPostanskiBroj`) sklopljena u "Kupac (opcionalno)" sekciju, `busy: boolean`, `error: string | null`, `nextBroj: number | null`.
- Na otvaranje (`useEffect` na `open`): `window.api.getNextPrilogBroj().then(setNextBroj)`; resetuj polja.
- Informativni red: `Stavka na računu: "{prilogNaziv(nextBroj ?? 0)}"` (prikaži tek kad je `nextBroj` učitan).
- Validacija prije slanja: `iznos > 0`; ako je `nacinPlacanja === 'Virman'` traži `kupacIdBroj` (ista poruka kao KasaScreen: virman ide na žiro račun, kupac je obavezan).
- Potvrda (dugme "Fiskalizuj", disabled dok je `busy`):

```tsx
const res = await window.api.finalizePrilogOrder({
  korisnikId,
  iznos: iznos!,
  nacinPlacanja,
  kupac: kupacIdBroj.trim() ? {
    naziv: kupacNaziv.trim(), idBroj: kupacIdBroj.trim(), adresa: kupacAdresa.trim(),
    grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim(),
  } : undefined,
});
if (res.success) { onSuccess(res as any); onOpenChange(false); }
else setError(res.error || 'Štampa nije uspjela');
```

- Props interfejs:

```tsx
interface PrilogRacunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  korisnikId: number;
  onSuccess: (res: { id: number; prilogBroj: number; brojFiskalnogRacuna: string | null }) => void;
}
```

- [ ] **Step 2: Uveži u `KasaScreen.tsx`**

- `const [prilogOpen, setPrilogOpen] = useState(false);`
- Dugme uz postojeće akcije kase (pored spremljenih korpi / naplate — pogledaj layout i stavi ga gdje stoje sekundarne akcije, sa ikonom `ReceiptText` ili `Paperclip` iz `lucide-react`): tekst **"Račun po prilogu"**, `onClick={() => setPrilogOpen(true)}`.
- Render dijaloga na dnu komponente:

```tsx
<PrilogRacunDialog
  open={prilogOpen}
  onOpenChange={setPrilogOpen}
  korisnikId={user.id}
  onSuccess={(res) => {
    setMessage({ type: 'success', text: `Fiskalizovan račun po prilogu br. ${res.prilogBroj} (BF ${res.brojFiskalnogRacuna ?? '?'}). Stavke dodijelite u sekciji Računi.` });
    // osvježi dnevni promet istim mehanizmom kojim to radi postojeća naplata
  }}
/>
```

(Za osvježavanje dnevnog prometa pozovi istu funkciju/effect koji KasaScreen već koristi nakon `finalizeOrder` uspjeha — pronađi je i iskoristi, ne dupliraj logiku.)

- [ ] **Step 3: Verifikacija**

Run: `bunx tsc --noEmit && bun run lint`
Expected: bez novih grešaka

Zatim ručna provjera (mock Tring server): pokreni `bun run start`, na kasi klikni "Račun po prilogu", unesi 150, Fiskalizuj → uspješna poruka, račun se vidi u sekciji Računi. Ako dev okruženje koristi mock na portu 8085, provjeri da je pokrenut (vidi kako se pokreće `tring-mock-server` u dev-u).

- [ ] **Step 4: Commit**

```bash
git add src/components/PrilogRacunDialog.tsx src/screens/KasaScreen.tsx
git commit -m "feat(prilog): dugme i dijalog za racun po prilogu na kasi"
```

---

### Task 8: Računi — badge, dijalog za dodjelu stavki

**Files:**
- Create: `src/components/PrilogStavkeDialog.tsx`
- Modify: `src/screens/NarudzbeScreen.tsx`

**Interfaces:**
- Consumes: `window.api.getPrilogStavke`, `window.api.savePrilogStavke`, `window.api.searchProducts`, `window.api.getOrder` (Task 6); `sumaPriloga`, `prilogKompletan`, tip `PrilogStavkaUnos` iz `@/lib/prilog`; ShadCN `Dialog`, `Table`, `Badge`, `Input`, `DecimalInput`, `Button`.
- Produces: `<PrilogStavkeDialog open onOpenChange order onSaved />` gdje je `order` puni red iz `order:get` (treba mu `id`, `ukupno`, `prilogBroj`, `status`). `onSaved()` — roditelj osvježi prikaz.

- [ ] **Step 1: Napravi `src/components/PrilogStavkeDialog.tsx`**

Ponašanje:

- Na otvaranje: `window.api.getPrilogStavke(order.id)` → mapiraj u lokalni state `stavke: Array<{ productId, naziv, jm, kolicina, cijena, pdvStopa, tip }>`.
- Pretraga proizvoda: input + `window.api.searchProducts(query)` (debounce ~250ms ili on-enter, kako već rade pretrage u repo-u — pogledaj `SkladisteScreen`/`SifarnikScreen` i preuzmi obrazac). Iz rezultata **izbaci proizvode sa `pdvStopa !== 'E'`**; klik na rezultat dodaje stavku sa `kolicina: 1` i `cijena` iz šifarnika (ako je proizvod već u listi, uvećaj količinu).
- Tabela stavki: naziv, JM, količina (`DecimalInput`), cijena (`DecimalInput`), iznos (`round2(kolicina*cijena)`), dugme za brisanje reda.
- Footer — živa suma:

```tsx
const suma = sumaPriloga(stavke);
const kompletan = prilogKompletan(order.ukupno, stavke);
// prikaz: "Suma stavki: X KM / Fiskalni iznos: Y KM" + zelena kvačica ili crvena razlika (X - Y)
```

- Dugme **"Sačuvaj"**: `await window.api.savePrilogStavke(order.id, stavke.map(s => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, pdvStopa: s.pdvStopa })))` → `onSaved()`; greške prikaži u dijalogu. Spremanje je dozvoljeno i kad suma nije kompletna (rad u više navrata).
- Ako je `order.status !== 'completed'`: sve read-only, poruka "Račun je storniran — prilog se ne može mijenjati".

- [ ] **Step 2: Uveži u `NarudzbeScreen.tsx`**

- U listi računa: gdje se renderuju postojeći `Badge`-evi, za `order.prilogBroj != null` dodaj `<Badge variant="secondary">Prilog br. {order.prilogBroj}</Badge>`. Provjeri da query liste (`order:getAll`) vraća `prilogBroj` — vraća `o.*`/`*`, pa nema izmjena; ako je SELECT sa eksplicitnim kolonama, dodaj `prilogBroj`.
- U detaljima/akcijama selektovanog računa: ako je `selectedOrder.prilogBroj != null`, dodaj dugme **"Uredi prilog"** koje otvara `PrilogStavkeDialog` (proslijedi puni order iz `getOrder`). Nakon `onSaved` osvježi selektovani račun postojećim mehanizmom (`window.api.getOrder`).

- [ ] **Step 3: Verifikacija**

Run: `bunx tsc --noEmit && bun run lint`
Expected: bez novih grešaka

Ručno: otvori račun iz Taska 7, "Uredi prilog", dodaj artikal 2×30 i uslugu 1×90 → suma 150/150 zelena; sačuvaj; provjeri u Skladištu da je artiklu stanje palo za 2, a ponovno uređivanje (promjena količine) da ne skida duplo.

- [ ] **Step 4: Commit**

```bash
git add src/components/PrilogStavkeDialog.tsx src/screens/NarudzbeScreen.tsx
git commit -m "feat(prilog): dodjela stavki priloga u sekciji Racuni"
```

---

### Task 9: `PrilogPdf` — A4 specifikacija sa BF brojem + print gating

**Files:**
- Create: `src/components/PrilogPdf.tsx`
- Modify: `src/components/PrilogStavkeDialog.tsx` (ili NarudzbeScreen akcije — gdje je print dugme prirodnije uz postojeće print akcije; odaberi jedno mjesto)
- Modify: `src/screens/NarudzbeScreen.tsx`

**Interfaces:**
- Consumes: `@react-pdf/renderer` (`pdf(...)` obrazac iz `NarudzbeScreen` print akcija), `pdf-fonts.ts`, `RacunPdf.tsx`/`OtpremnicaPdf.tsx` kao stilski uzor; `prilogKompletan` iz `@/lib/prilog`; `iznosStavke`, `pdvStavke` iz `@/lib/racun`; `round2` iz `@/lib/novac`.
- Produces: `<PrilogPdf order firma stavke />` — `order` (treba: `prilogBroj`, `brojFiskalnogRacuna`, `createdAt`, `ukupno`, `pdvIznos`, kupac polja), `firma` (isti oblik kao kod `RacunPdf` — pogledaj kako je NarudzbeScreen dobavlja), `stavke` (redovi iz `getPrilogStavke`).

- [ ] **Step 1: Napravi `src/components/PrilogPdf.tsx`**

Prepiši strukturu (fontovi, header sa firmom, stilovi) iz `OtpremnicaPdf.tsx` (najbliži po namjeni — dokument sa stavkama bez fiskalne forme), sa sadržajem:

- Naslov: `Specifikacija br. {order.prilogBroj}`
- Podnaslov (obavezno, zakonska veza): `Uz fiskalni račun BF: {order.brojFiskalnogRacuna}`
- Datum računa (`order.createdAt`), kupac blok ako `order.kupacNaziv || order.kupacIdBroj`.
- Tabela: Šifra (`productSifra`), Naziv (`productNaziv`), JM (`productJm`), Količina, Cijena, Iznos (`iznosStavke({...s, rabat: 0})`).
- Rekapitulacija ispod tabele: `Ukupno bez PDV`, `PDV 17%`, `UKUPNO` — izračun iz stavki preko `pdvStavke` (suma), formatiranje kao u `RacunPdf`.
- Footer po uzoru na ostale dokumente (potpis/mjesto ako ga drugi dokumenti imaju).

- [ ] **Step 2: Print akcija + gating**

Na odabranom mjestu (uz "Uredi prilog" akciju):

```tsx
const handlePrintPrilog = async (order: any) => {
  const stavke = await window.api.getPrilogStavke(order.id);
  if (!prilogKompletan(order.ukupno, stavke)) {
    // ista notifikaciona mehanika koju NarudzbeScreen već koristi za greške
    setMessage?.({ type: 'error', text: 'Suma stavki priloga se ne poklapa sa fiskalnim iznosom — dopunite prilog prije štampe.' });
    return;
  }
  const blob = await pdf(<PrilogPdf order={order} firma={firma} stavke={stavke} />).toBlob();
  // otvori/odštampaj blob istim mehanizmom kao postojeće RacunPdf print akcije u NarudzbeScreen
};
```

Dugme "Štampaj prilog" prikaži samo za `order.prilogBroj != null`; disabled (sa tooltipom o razlici sume) kad prilog nije kompletan — stanje kompletnosti drži tamo gdje su stavke već učitane (u dijalogu), a kod poziva iz liste provjeri kao gore.

- [ ] **Step 3: Verifikacija**

Run: `bunx tsc --noEmit && bun run lint && bun test`
Expected: sve zeleno

Ručno: račun iz Taska 8 → "Štampaj prilog" → PDF ima naslov "Specifikacija br. 1", red "Uz fiskalni račun BF: ...", stavke i totale koji se poklapaju sa fiskalnim iznosom. Zatim ukloni jednu stavku (suma ≠ iznos) → print odbijen sa porukom.

- [ ] **Step 4: Commit**

```bash
git add src/components/PrilogPdf.tsx src/components/PrilogStavkeDialog.tsx src/screens/NarudzbeScreen.tsx
git commit -m "feat(prilog): A4 specifikacija priloga sa BF brojem i print gating"
```

---

## Završna provjera (nakon svih taskova)

- [ ] `bun test` — svi testovi zeleni.
- [ ] `bunx tsc --noEmit && bun run lint` — čisto.
- [ ] Ručni smoke test cijelog toka na mock Tring serveru: kasa → prilog račun 150 KM → Računi → dodjela 2×30 + 1×90 → skladište -2 → print specifikacije → storno računa → skladište vraćeno, uređivanje priloga blokirano.
- [ ] Spec pokrivenost: prođi kroz `docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md` sekciju po sekciju i potvrdi da je svaka tačka implementirana.
