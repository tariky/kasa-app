# Proizvodnja (materijal, normativi, radni nalozi) — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opcioni modul "Proizvodnja": materijal kao treći tip artikla, normativi za standardne proizvode, radni nalozi (po narudžbi / za zalihu) koji troše materijal, kalkulacija i izdavanje računa iz naloga.

**Architecture:** Sva poslovna logika ide u čiste funkcije nad `SqlDb` u `src/lib/proizvodnja.ts` i `src/lib/ploca.ts` (testirano nad `bun:sqlite`), IPC handleri su tanki omotači, UI je novi ekran `ProizvodnjaScreen` sa komponentama u `src/components/proizvodnja/`. Materijal ulazi kroz postojeće primke i `stock_movements`; radni nalog knjiži `referenceType = 'radni_nalog'`. Modul se uključuje postavkom `proizvodnja.enabled`.

**Tech Stack:** Electron Forge + Vite, React 19, ShadCN UI (Radix), better-sqlite3 (prod) / bun:sqlite (test), @react-pdf/renderer, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-09-23-proizvodnja-radni-nalozi-design.md`

## Global Constraints

- Sav UI tekst i komentari na bosanskom, u stilu postojećih ekrana (kratko, bez anglizama gdje postoji domaći izraz).
- Testovi se pokreću sa `bun test`; baza u testovima je `bun:sqlite` `':memory:'` + `schema` iz `src/database/schema.ts`. `better-sqlite3` se **ne** importuje iz `src/lib/*`.
- Poslovna logika u `src/lib/*` prima `SqlDb` (`src/lib/sqldb.ts`) i ne zna za Electron ni Tring osim kroz `deps.print`.
- Nove tabele idu u `schema.ts` (`CREATE TABLE IF NOT EXISTS`); nove kolone na postojećim tabelama idu u `migrations.ts` (`PRAGMA table_info` + `ALTER TABLE`).
- Numeracija naloga: `RN-{broj}/{godina}`, `broj = MAX(broj)+1` unutar godine.
- Statusi naloga: `otvoren`, `u_izradi`, `zavrsen`, `fakturisan`. Vrste: `narudzba`, `zaliha`.
- Iznosi u KM: `round2` iz `src/lib/novac.ts`; količine i m² na 4 decimale.
- Sve promjene koje diraju `stock_movements` idu u jednoj transakciji.
- Print A4 radnog naloga bez cijena.
- Komit poslije svakog zadatka; poruke na bosanskom u obliku `feat(proizvodnja): ...`, sa `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Završetak naloga kad materijal nema dovoljno stanja** — ne smije blokirati (ploča se često potroši prije primke), ali kalkulacija mora nositi upozorenje. Test u Task 4.
2. **Ponovni završetak nakon "vrati u izradu"** kad je u međuvremenu stigla primka po drugoj cijeni — zamrznuta cijena mora biti nova prosječna, ne stara. Test u Task 4.
3. **Izdavanje računa za nalog bez dogovorene cijene** (NULL ili 0) — mora biti odbijeno prije štampe, ne smije nastati račun na 0 KM. Test u Task 5.
4. **Brisanje materijala koji figuriše na normativu ili stavci naloga** — blokirano s porukom, isto kao artikal u primkama. Test u Task 6.
5. **Materijal u m² bez dimenzije ploče** — nije ploča: primka ga prima direktno u m², bez preračuna, i ne pokazuje kalkulator. Test u Task 2 (`jePloca`).

---

## Struktura fajlova

**Novi:**
- `src/lib/ploca.ts` — preračuni ploča (kom ↔ m², elementi → m²), bez baze.
- `src/lib/ploca.test.ts`
- `src/lib/proizvodnja.ts` — nalozi, stavke, normativi, prosječna nabavna, kalkulacija, završetak/vraćanje, izdavanje računa.
- `src/lib/proizvodnja.test.ts` — unit + integracija nad in-memory bazom.
- `src/hooks/useProizvodnja.ts` — da li je modul uključen (postavka + event).
- `src/components/sifarnik/MaterijalTab.tsx` — šifarnik materijala.
- `src/components/proizvodnja/NalogDialog.tsx` — zaglavlje naloga (novi/uredi).
- `src/components/proizvodnja/StavkeUtroska.tsx` — tabela utroška + pretraga materijala.
- `src/components/proizvodnja/ElementiDialog.tsx` — kalkulator elemenata za ploče.
- `src/components/proizvodnja/KalkulacijaPanel.tsx` — prikaz kalkulacije.
- `src/components/proizvodnja/IzdajRacunDialog.tsx` — način plaćanja + fiskalizacija iz naloga.
- `src/components/proizvodnja/NormativiTab.tsx`
- `src/components/RadniNalogPdf.tsx`
- `src/screens/ProizvodnjaScreen.tsx` — lista naloga + detalj.

**Izmjene:**
- `src/database/schema.ts`, `src/database/migrations.ts`, `src/database/migrations.test.ts`
- `src/types.ts` — `Product.tip` tri vrijednosti, `plocaSirina/plocaVisina`, tipovi naloga.
- `src/lib/racun.ts` — `upisiRacun` (izdvojeno iz `konvertujPonudu`).
- `src/lib/ponuda.ts` — `konvertujPonudu` koristi `upisiRacun`.
- `src/lib/skladiste.ts` — `collectPriceChanges` preskače materijal.
- `src/lib/batchRacuni.ts` — generator uzima samo `tip === 'artikal'`.
- `src/ipc/handlers.ts`, `src/preload.ts`, `src/global.d.ts`
- `src/components/MainLayout.tsx`, `src/screens/PostavkeScreen.tsx`
- `src/screens/SifarnikScreen.tsx`, `src/screens/SkladisteScreen.tsx`, `src/screens/KasaScreen.tsx`, `src/screens/PonudeScreen.tsx`

---

### Task 1: Šema, migracija i tipovi

**Files:**
- Modify: `src/database/schema.ts` (products + nove tabele + indeksi)
- Modify: `src/database/migrations.ts` (kraj funkcije)
- Modify: `src/database/migrations.test.ts:60-91` (`ADDED_COLUMNS`, `ADDED_TABLES`)
- Modify: `src/types.ts:10-21` (Product), dodati tipove naloga

**Interfaces:**
- Produces: tabele `normativi`, `radni_nalozi`, `radni_nalog_stavke`; kolone `products.plocaSirina`, `products.plocaVisina`; TS tipovi `Product.tip: 'artikal' | 'usluga' | 'materijal'`, `RadniNalog`, `RadniNalogStavka`, `NormativStavka`.

- [ ] **Step 1: Dodaj kolone i tabele u test migracija (failing test)**

U `src/database/migrations.test.ts` dopuni liste:

```ts
const ADDED_COLUMNS: [string, string][] = [
  // ... postojeće ...
  ['orders', 'datumValute'],
  ['products', 'plocaSirina'],
  ['products', 'plocaVisina'],
];
const ADDED_TABLES = [
  'dobavljaci', 'kupci', 'pending_receipts', 'prilog_stavke',
  'normativi', 'radni_nalozi', 'radni_nalog_stavke',
];
```

- [ ] **Step 2: Pokreni test da padne**

Run: `bun test src/database/migrations.test.ts`
Expected: FAIL — `backup iz starije verzije dobija sve kolone i tabele` (nema `plocaSirina`, nema `radni_nalozi`).

- [ ] **Step 3: Šema**

U `src/database/schema.ts`, u `products` iza `tip`:

```sql
    tip TEXT NOT NULL DEFAULT 'artikal',
    plocaSirina INTEGER,
    plocaVisina INTEGER,
```

Iza `cash_movements`, prije indeksa:

```sql
  CREATE TABLE IF NOT EXISTS normativi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    materijalId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    napomena TEXT,
    UNIQUE(productId, materijalId),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (materijalId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS radni_nalozi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broj INTEGER NOT NULL,
    godina INTEGER NOT NULL,
    datum TEXT NOT NULL,
    rok TEXT,
    vrsta TEXT NOT NULL CHECK(vrsta IN ('narudzba', 'zaliha')),
    kupacId INTEGER,
    ponudaId INTEGER,
    opis TEXT NOT NULL,
    productId INTEGER,
    kolicina REAL NOT NULL DEFAULT 1,
    dogovorenaCijena REAL,
    trosakRada REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'otvoren'
      CHECK(status IN ('otvoren', 'u_izradi', 'zavrsen', 'fakturisan')),
    racunId INTEGER,
    korisnikId INTEGER NOT NULL,
    napomena TEXT,
    zavrsenAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(broj, godina),
    FOREIGN KEY (kupacId) REFERENCES kupci(id),
    FOREIGN KEY (ponudaId) REFERENCES ponude(id),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (racunId) REFERENCES orders(id),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS radni_nalog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    radniNalogId INTEGER NOT NULL,
    materijalId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    nabavnaCijena REAL,
    napomena TEXT,
    FOREIGN KEY (radniNalogId) REFERENCES radni_nalozi(id),
    FOREIGN KEY (materijalId) REFERENCES products(id)
  );
```

Indeksi (uz postojeće):

```sql
  CREATE INDEX IF NOT EXISTS idx_radni_nalog_stavke_nalogId ON radni_nalog_stavke(radniNalogId);
  CREATE INDEX IF NOT EXISTS idx_radni_nalozi_status ON radni_nalozi(status);
  CREATE INDEX IF NOT EXISTS idx_normativi_productId ON normativi(productId);
```

- [ ] **Step 4: Migracija**

Na kraj `runMigrations` u `src/database/migrations.ts`:

```ts
  // Proizvodnja: dimenzija ploče (mm) na materijalu u m² — kom ↔ m² preračun.
  const productCols2 = database.prepare("PRAGMA table_info(products)").all() as { name: string }[];
  if (!productCols2.find(c => c.name === 'plocaSirina')) {
    database.exec("ALTER TABLE products ADD COLUMN plocaSirina INTEGER");
  }
  if (!productCols2.find(c => c.name === 'plocaVisina')) {
    database.exec("ALTER TABLE products ADD COLUMN plocaVisina INTEGER");
  }
```

- [ ] **Step 5: Tipovi**

U `src/types.ts` izmijeni `Product`:

```ts
export type ProductTip = 'artikal' | 'usluga' | 'materijal';

export interface Product {
  id: number;
  sifra: string;
  naziv: string;
  jm: string;
  cijena: number;
  pdvStopa: 'E' | 'K';
  plu?: number;
  barkod?: string;
  tip: ProductTip;
  /** Dimenzija ploče u mm — samo za materijal u m² koji se kupuje po komadu. */
  plocaSirina?: number | null;
  plocaVisina?: number | null;
  createdAt: string;
  updatedAt: string;
  stanje?: number;
}
```

Na kraj `src/types.ts`:

```ts
export type NalogVrsta = 'narudzba' | 'zaliha';
export type NalogStatus = 'otvoren' | 'u_izradi' | 'zavrsen' | 'fakturisan';

export interface RadniNalogStavka {
  id: number;
  radniNalogId: number;
  materijalId: number;
  kolicina: number;
  /** Zamrznuta pri završetku; NULL dok je nalog otvoren. */
  nabavnaCijena: number | null;
  napomena?: string | null;
  materijalNaziv?: string;
  materijalSifra?: string;
  materijalJm?: string;
  plocaSirina?: number | null;
  plocaVisina?: number | null;
  stanje?: number;
}

export interface RadniNalog {
  id: number;
  broj: number;
  godina: number;
  datum: string;
  rok?: string | null;
  vrsta: NalogVrsta;
  kupacId?: number | null;
  ponudaId?: number | null;
  opis: string;
  productId?: number | null;
  kolicina: number;
  dogovorenaCijena?: number | null;
  trosakRada: number;
  status: NalogStatus;
  racunId?: number | null;
  korisnikId: number;
  napomena?: string | null;
  zavrsenAt?: string | null;
  createdAt: string;
  // JOIN polja
  kupacNaziv?: string | null;
  kupacIdBroj?: string | null;
  kupacAdresa?: string | null;
  kupacGrad?: string | null;
  kupacPostanskiBroj?: string | null;
  productNaziv?: string | null;
  productCijena?: number | null;
  korisnikIme?: string;
  racunBroj?: string | null;
  racunStatus?: string | null;
  ponudaBroj?: number | null;
  ponudaGodina?: number | null;
  stavke?: RadniNalogStavka[];
}

export interface NormativStavka {
  id: number;
  productId: number;
  materijalId: number;
  kolicina: number;
  napomena?: string | null;
  materijalNaziv?: string;
  materijalSifra?: string;
  materijalJm?: string;
}
```

- [ ] **Step 6: Testovi prolaze**

Run: `bun test src/database`
Expected: PASS (migracije, restore).

- [ ] **Step 7: Commit**

```bash
git add src/database src/types.ts
git commit -m "feat(proizvodnja): šema za materijal, normative i radne naloge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `ploca.ts` — preračuni ploča

**Files:**
- Create: `src/lib/ploca.ts`
- Test: `src/lib/ploca.test.ts`

**Interfaces:**
- Produces:
  - `jePloca(p: { jm: string; plocaSirina?: number | null; plocaVisina?: number | null }): boolean`
  - `m2PoPloci(sirinaMm: number, visinaMm: number): number` (4 dec.)
  - `komUM2(kom: number, sirinaMm: number, visinaMm: number): number` (4 dec.)
  - `m2UKom(m2: number, sirinaMm: number, visinaMm: number): number` (2 dec.)
  - `interface Element { sirina: number; visina: number; kom: number }`
  - `elementiUM2(elementi: Element[]): number` (4 dec.)
  - `elementiUNapomenu(elementi: Element[]): string` → `"600×720 ×2, 800×720 ×1"`
  - `napomenaUElemente(napomena: string): Element[]` (inverz, tolerantan; prazan niz ako ne prepozna)
  - `JM_PLOCA = 'm²'`

- [ ] **Step 1: Testovi**

```ts
// src/lib/ploca.test.ts
import { test, expect } from 'bun:test';
import {
  jePloca, m2PoPloci, komUM2, m2UKom, elementiUM2, elementiUNapomenu, napomenaUElemente, JM_PLOCA,
} from './ploca';

test('standardna ploča 2800×2070 ima 5.796 m²', () => {
  expect(m2PoPloci(2800, 2070)).toBe(5.796);
});

test('kom → m² i nazad se poklapaju', () => {
  expect(komUM2(5, 2800, 2070)).toBe(28.98);
  expect(m2UKom(28.98, 2800, 2070)).toBe(5);
  expect(m2UKom(29, 2800, 2070)).toBe(5); // ≈ 5.003 → 2 decimale
});

test('elementi → m² zbraja sve komade', () => {
  const m2 = elementiUM2([
    { sirina: 600, visina: 720, kom: 2 },
    { sirina: 800, visina: 720, kom: 1 },
  ]);
  // 2×0.432 + 0.576 = 1.44
  expect(m2).toBe(1.44);
});

test('elementi bez komada ili s nulom se preskaču', () => {
  expect(elementiUM2([{ sirina: 600, visina: 720, kom: 0 }, { sirina: 0, visina: 720, kom: 3 }])).toBe(0);
});

test('napomena iz elemenata i nazad', () => {
  const el = [{ sirina: 600, visina: 720, kom: 2 }, { sirina: 800, visina: 720, kom: 1 }];
  const nap = elementiUNapomenu(el);
  expect(nap).toBe('600×720 ×2, 800×720 ×1');
  expect(napomenaUElemente(nap)).toEqual(el);
});

test('napomena koja nije lista elemenata daje prazan niz', () => {
  expect(napomenaUElemente('korpus donji')).toEqual([]);
  expect(napomenaUElemente('')).toEqual([]);
});

test('jePloca: samo m² sa obje dimenzije', () => {
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: 2800, plocaVisina: 2070 })).toBe(true);
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: null, plocaVisina: null })).toBe(false);
  expect(jePloca({ jm: JM_PLOCA, plocaSirina: 2800 })).toBe(false);
  expect(jePloca({ jm: 'kom', plocaSirina: 2800, plocaVisina: 2070 })).toBe(false);
});
```

- [ ] **Step 2: Pokreni da padne**

Run: `bun test src/lib/ploca.test.ts`
Expected: FAIL — modul ne postoji.

- [ ] **Step 3: Implementacija**

```ts
// src/lib/ploca.ts
/**
 * Preračuni za pločasti materijal (iverica, MDF, lesonit). Ploča se kupuje
 * po komadu, a troši u m²; da unos ostane jednostavan, app radi preračun.
 */

export const JM_PLOCA = 'm²';

export interface Element {
  sirina: number; // mm
  visina: number; // mm
  kom: number;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ploča = materijal u m² sa upisanom dimenzijom. Bez dimenzije je običan m² materijal. */
export function jePloca(p: { jm: string; plocaSirina?: number | null; plocaVisina?: number | null }): boolean {
  return p.jm === JM_PLOCA && !!p.plocaSirina && !!p.plocaVisina && p.plocaSirina > 0 && p.plocaVisina > 0;
}

export function m2PoPloci(sirinaMm: number, visinaMm: number): number {
  return round4((sirinaMm * visinaMm) / 1_000_000);
}

export function komUM2(kom: number, sirinaMm: number, visinaMm: number): number {
  return round4(kom * m2PoPloci(sirinaMm, visinaMm));
}

export function m2UKom(m2: number, sirinaMm: number, visinaMm: number): number {
  const poPloci = m2PoPloci(sirinaMm, visinaMm);
  if (poPloci <= 0) return 0;
  return round2(m2 / poPloci);
}

export function elementiUM2(elementi: Element[]): number {
  return round4(
    elementi.reduce((sum, e) => {
      if (!(e.sirina > 0) || !(e.visina > 0) || !(e.kom > 0)) return sum;
      return sum + (e.sirina * e.visina * e.kom) / 1_000_000;
    }, 0)
  );
}

export function elementiUNapomenu(elementi: Element[]): string {
  return elementi
    .filter(e => e.sirina > 0 && e.visina > 0 && e.kom > 0)
    .map(e => `${e.sirina}×${e.visina} ×${e.kom}`)
    .join(', ');
}

/** Inverz od elementiUNapomenu. Ako tekst nije u tom obliku, vraća []. */
export function napomenaUElemente(napomena: string): Element[] {
  if (!napomena.trim()) return [];
  const dijelovi = napomena.split(',').map(s => s.trim()).filter(Boolean);
  const out: Element[] = [];
  for (const d of dijelovi) {
    const m = d.match(/^(\d+)\s*[×x]\s*(\d+)\s*×\s*(\d+)$/i);
    if (!m) return [];
    out.push({ sirina: Number(m[1]), visina: Number(m[2]), kom: Number(m[3]) });
  }
  return out;
}
```

- [ ] **Step 4: Testovi prolaze**

Run: `bun test src/lib/ploca.test.ts`
Expected: PASS (7 testova).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ploca.ts src/lib/ploca.test.ts
git commit -m "feat(proizvodnja): preračuni ploča kom ↔ m² i kalkulator elemenata

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `proizvodnja.ts` — nalozi, stavke, normativi (bez knjiženja)

**Files:**
- Create: `src/lib/proizvodnja.ts`
- Test: `src/lib/proizvodnja.test.ts`

**Interfaces:**
- Consumes: `SqlDb`, `localDateStr` iz `./novac`, `getProductStock` iz `./skladiste`, tipovi iz `@/types`.
- Produces (sve nad `SqlDb`, pozivač otvara transakciju gdje piše "u transakciji"):
  - `nextBrojNaloga(db, godina: number): number`
  - `formatBrojNaloga(n: { broj: number; godina: number }): string` → `"RN-3/2026"`
  - `interface NalogInput { vrsta: NalogVrsta; korisnikId: number; opis?: string; kupacId?: number | null; ponudaId?: number | null; productId?: number | null; kolicina?: number; datum?: string; rok?: string | null; dogovorenaCijena?: number | null; trosakRada?: number; napomena?: string | null }`
  - `interface NalogStavkaInput { materijalId: number; kolicina: number; napomena?: string | null }`
  - `createNalog(db, input: NalogInput): { id: number; broj: number; godina: number }` (u transakciji; za zalihu popuni stavke iz normativa)
  - `createNalogIzPonude(db, ponudaId: number, korisnikId: number): { id; broj; godina }` (u transakciji)
  - `updateNalog(db, id, patch: Partial<Omit<NalogInput, 'vrsta' | 'korisnikId'>>): void`
  - `replaceStavke(db, id, stavke: NalogStavkaInput[]): void` (u transakciji)
  - `getNalog(db, id): RadniNalog` (sa `stavke`, JOIN poljima i `stanje` po stavci)
  - `listNalozi(db, filter?: { status?: NalogStatus | 'aktivni' }): RadniNalog[]` (`aktivni` = sve osim `fakturisan`)
  - `deleteNalog(db, id): void` (u transakciji)
  - `getNormativ(db, productId): NormativStavka[]`
  - `saveNormativ(db, productId, stavke: NalogStavkaInput[]): void` (u transakciji)
  - `nalogZaPonudu(db, ponudaId): { id; broj; godina } | null`

- [ ] **Step 1: Testovi**

```ts
// src/lib/proizvodnja.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { schema } from '@/database/schema';
import type { SqlDb } from './sqldb';
import {
  nextBrojNaloga, formatBrojNaloga, createNalog, createNalogIzPonude, updateNalog,
  replaceStavke, getNalog, listNalozi, deleteNalog, getNormativ, saveNormativ, nalogZaPonudu,
} from './proizvodnja';

let db: SqlDb & Database;

beforeEach(() => {
  db = new Database(':memory:') as SqlDb & Database;
  db.exec(schema);
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Admin', '0000', 'admin')").run();
});

// ── pomoćne ──────────────────────────────────────────────
export function dodajMaterijal(db: SqlDb, sifra: string, jm = 'kom', dim?: [number, number]): number {
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, plocaSirina, plocaVisina) VALUES (?, ?, ?, 0, 'E', 'materijal', ?, ?)"
  ).run(sifra, `Materijal ${sifra}`, jm, dim?.[0] ?? null, dim?.[1] ?? null);
  return Number(r.lastInsertRowid);
}
export function dodajArtikal(db: SqlDb, sifra: string, cijena = 100): number {
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', ?, 'E', 'artikal')"
  ).run(sifra, `Proizvod ${sifra}`, cijena);
  return Number(r.lastInsertRowid);
}
export function dodajKupca(db: SqlDb, naziv = 'Kupac d.o.o.'): number {
  const r = db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES (?, '4200000000001')").run(naziv);
  return Number(r.lastInsertRowid);
}
export function primka(db: SqlDb, productId: number, kolicina: number, nabavna: number): void {
  const p = db.prepare("INSERT INTO primke (brojPrimke, datum) VALUES (?, '2026-09-01')")
    .run(`U-${Math.random()}`);
  db.prepare("INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, pdvStopa) VALUES (?, ?, ?, 0, ?, 'E')")
    .run(p.lastInsertRowid, productId, kolicina, nabavna);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)")
    .run(productId, kolicina, p.lastInsertRowid);
}

// ── numeracija ───────────────────────────────────────────
test('broj naloga kreće od 1 svake godine', () => {
  expect(nextBrojNaloga(db, 2026)).toBe(1);
  const k = dodajKupca(db);
  createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', datum: '2026-09-23' });
  expect(nextBrojNaloga(db, 2026)).toBe(2);
  expect(nextBrojNaloga(db, 2027)).toBe(1);
  expect(formatBrojNaloga({ broj: 2, godina: 2026 })).toBe('RN-2/2026');
});

// ── kreiranje ────────────────────────────────────────────
test('narudžba traži kupca i opis', () => {
  expect(() => createNalog(db, { vrsta: 'narudzba', korisnikId: 1, opis: 'X' })).toThrow('Kupac');
  expect(() => createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: dodajKupca(db), opis: '  ' })).toThrow('Opis');
});

test('zaliha traži proizvod tipa artikal i količinu > 0', () => {
  const mat = dodajMaterijal(db, 'IV18');
  expect(() => createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: mat, kolicina: 2 })).toThrow('artikal');
  const art = dodajArtikal(db, 'LINA');
  expect(() => createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 0 })).toThrow('Količina');
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 3 });
  const n = getNalog(db, r.id);
  expect(n.opis).toBe('Proizvod LINA'); // opis default = naziv proizvoda
  expect(n.status).toBe('otvoren');
  expect(n.kolicina).toBe(3);
});

test('zaliha sa normativom popuni stavke normativ × količina', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const kant = dodajMaterijal(db, 'KANT', 'm');
  saveNormativ(db, art, [
    { materijalId: iv, kolicina: 1.25, napomena: 'korpus' },
    { materijalId: kant, kolicina: 6 },
  ]);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 4 });
  const n = getNalog(db, r.id);
  expect(n.stavke!.map(s => [s.materijalId, s.kolicina])).toEqual([[iv, 5], [kant, 24]]);
  expect(n.stavke![0].napomena).toBe('korpus');
  expect(n.stavke![0].nabavnaCijena).toBeNull();
});

test('nalog iz ponude nasljeđuje kupca, opis i cijenu; druga konverzija odbijena', () => {
  const k = dodajKupca(db, 'Mujić');
  const a1 = dodajArtikal(db, 'KUH', 3000);
  const a2 = dodajArtikal(db, 'MONT', 200);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (7, 1, 2026, ?, 1, '2026-09-01', '2026-09-09', 'prihvacena', 3200, 465.81)`).run(k);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 3000, 0, 'E')").run(a1);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 200, 0, 'E')").run(a2);

  const r = createNalogIzPonude(db, 7, 1);
  const n = getNalog(db, r.id);
  expect(n.vrsta).toBe('narudzba');
  expect(n.kupacId).toBe(k);
  expect(n.ponudaId).toBe(7);
  expect(n.opis).toBe('Proizvod KUH, Proizvod MONT');
  expect(n.dogovorenaCijena).toBe(3200);
  expect(n.ponudaBroj).toBe(1);
  expect(nalogZaPonudu(db, 7)).toEqual({ id: r.id, broj: 1, godina: 2026 });

  expect(() => createNalogIzPonude(db, 7, 1)).toThrow('već');
});

test('nalog iz ponude koja nije prihvaćena je odbijen', () => {
  const k = dodajKupca(db);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (8, 2, 2026, ?, 1, '2026-09-01', '2026-09-09', 'poslana', 100, 14.53)`).run(k);
  expect(() => createNalogIzPonude(db, 8, 1)).toThrow('prihvaćena');
  expect(nalogZaPonudu(db, 8)).toBeNull();
});

// ── izmjene ──────────────────────────────────────────────
test('update i replaceStavke rade samo dok nalog nije završen', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Plakar' });
  updateNalog(db, r.id, { opis: 'Plakar klizni', dogovorenaCijena: 1500, rok: '2026-10-15', trosakRada: 200 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2.5, napomena: '600×720 ×2' }]);
  const n = getNalog(db, r.id);
  expect(n.opis).toBe('Plakar klizni');
  expect(n.dogovorenaCijena).toBe(1500);
  expect(n.trosakRada).toBe(200);
  expect(n.stavke!.length).toBe(1);
  expect(n.stavke![0].materijalJm).toBe('m²');
  expect(n.stavke![0].plocaSirina).toBe(2800);

  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen' WHERE id = ?").run(r.id);
  expect(() => updateNalog(db, r.id, { opis: 'X' })).toThrow('završen');
  expect(() => replaceStavke(db, r.id, [])).toThrow('završen');
});

test('stavka mora biti materijal sa količinom > 0', () => {
  const k = dodajKupca(db);
  const art = dodajArtikal(db, 'A');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  expect(() => replaceStavke(db, r.id, [{ materijalId: art, kolicina: 1 }])).toThrow('materijal');
  const iv = dodajMaterijal(db, 'IV');
  expect(() => replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 0 }])).toThrow('Količina');
});

test('lista: filter aktivni isključuje fakturisane, redoslijed najnoviji prvi', () => {
  const k = dodajKupca(db);
  const a = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'A', datum: '2026-09-01' });
  const b = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'B', datum: '2026-09-02' });
  db.prepare("UPDATE radni_nalozi SET status = 'fakturisan' WHERE id = ?").run(a.id);
  expect(listNalozi(db).map(n => n.id)).toEqual([b.id, a.id]);
  expect(listNalozi(db, { status: 'aktivni' }).map(n => n.id)).toEqual([b.id]);
  expect(listNalozi(db, { status: 'fakturisan' }).map(n => n.id)).toEqual([a.id]);
  expect(listNalozi(db)[0].kupacNaziv).toBe('Kupac d.o.o.');
});

test('brisanje samo dok nalog nije završen; briše i stavke', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  deleteNalog(db, r.id);
  expect(db.prepare('SELECT COUNT(*) AS c FROM radni_nalog_stavke').get()).toEqual({ c: 0 });
  expect(() => getNalog(db, r.id)).toThrow('ne postoji');

  const r2 = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Y' });
  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen' WHERE id = ?").run(r2.id);
  expect(() => deleteNalog(db, r2.id)).toThrow('završen');
});

// ── normativi ────────────────────────────────────────────
test('saveNormativ zamjenjuje cijeli set i vraća JOIN polja', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²');
  const kant = dodajMaterijal(db, 'KANT', 'm');
  saveNormativ(db, art, [{ materijalId: iv, kolicina: 1.2 }, { materijalId: kant, kolicina: 5 }]);
  saveNormativ(db, art, [{ materijalId: kant, kolicina: 6 }]);
  const n = getNormativ(db, art);
  expect(n.length).toBe(1);
  expect(n[0].kolicina).toBe(6);
  expect(n[0].materijalNaziv).toBe('Materijal KANT');
  expect(n[0].materijalJm).toBe('m');
  expect(() => saveNormativ(db, iv, [])).toThrow('artikal');
});
```

- [ ] **Step 2: Pokreni da padne**

Run: `bun test src/lib/proizvodnja.test.ts`
Expected: FAIL — modul ne postoji.

- [ ] **Step 3: Implementacija**

```ts
// src/lib/proizvodnja.ts
import type { SqlDb } from './sqldb';
import { localDateStr } from './novac';
import { getProductStock } from './skladiste';
import type {
  NalogStatus, NalogVrsta, NormativStavka, RadniNalog, RadniNalogStavka,
} from '@/types';

export interface NalogInput {
  vrsta: NalogVrsta;
  korisnikId: number;
  opis?: string;
  kupacId?: number | null;
  ponudaId?: number | null;
  productId?: number | null;
  kolicina?: number;
  datum?: string;
  rok?: string | null;
  dogovorenaCijena?: number | null;
  trosakRada?: number;
  napomena?: string | null;
}

export interface NalogStavkaInput {
  materijalId: number;
  kolicina: number;
  napomena?: string | null;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ── numeracija ───────────────────────────────────────────

export function nextBrojNaloga(db: SqlDb, godina: number): number {
  const row = db.prepare('SELECT MAX(broj) AS maxBroj FROM radni_nalozi WHERE godina = ?')
    .get(godina) as { maxBroj: number | null };
  return (row.maxBroj ?? 0) + 1;
}

export function formatBrojNaloga(n: { broj: number; godina: number }): string {
  return `RN-${n.broj}/${n.godina}`;
}

// ── validacija ───────────────────────────────────────────

function productTip(db: SqlDb, id: number): { tip: string; naziv: string } | undefined {
  return db.prepare('SELECT tip, naziv FROM products WHERE id = ?').get(id) as any;
}

function validirajStavke(db: SqlDb, stavke: NalogStavkaInput[]): void {
  for (const s of stavke) {
    const p = productTip(db, s.materijalId);
    if (!p || p.tip !== 'materijal') throw new Error('Stavka utroška mora biti materijal');
    if (!(s.kolicina > 0)) throw new Error('Količina stavke mora biti veća od nule');
  }
}

function ucitajNalogIliBaci(db: SqlDb, id: number): { status: NalogStatus; vrsta: NalogVrsta; kolicina: number; productId: number | null; ponudaId: number | null } {
  const n = db.prepare('SELECT status, vrsta, kolicina, productId, ponudaId FROM radni_nalozi WHERE id = ?').get(id) as any;
  if (!n) throw new Error('Radni nalog ne postoji');
  return n;
}

function baciAkoZakljucan(status: NalogStatus): void {
  if (status === 'zavrsen' || status === 'fakturisan') {
    throw new Error('Nalog je završen i ne može se mijenjati');
  }
}

// ── stavke ───────────────────────────────────────────────

function upisiStavke(db: SqlDb, nalogId: number, stavke: NalogStavkaInput[]): void {
  const ins = db.prepare(
    'INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)'
  );
  for (const s of stavke) ins.run(nalogId, s.materijalId, round4(s.kolicina), s.napomena ?? null);
}

/** Zamijeni sve stavke utroška. Poziva se u transakciji. */
export function replaceStavke(db: SqlDb, id: number, stavke: NalogStavkaInput[]): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);
  validirajStavke(db, stavke);
  db.prepare('DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?').run(id);
  upisiStavke(db, id, stavke);
}

// ── kreiranje / izmjena ──────────────────────────────────

/** Upiše nalog. Za zalihu, ako proizvod ima normativ, popuni stavke normativ × količina. U transakciji. */
export function createNalog(db: SqlDb, input: NalogInput): { id: number; broj: number; godina: number } {
  if (!input.korisnikId) throw new Error('Korisnik nije prijavljen');
  const datum = input.datum || localDateStr();
  const godina = Number(datum.slice(0, 4));
  let opis = (input.opis ?? '').trim();
  let kolicina = 1;

  if (input.vrsta === 'narudzba') {
    if (!input.kupacId) throw new Error('Kupac je obavezan za nalog po narudžbi');
    if (!opis) throw new Error('Opis je obavezan');
  } else if (input.vrsta === 'zaliha') {
    if (!input.productId) throw new Error('Proizvod je obavezan za nalog za zalihu');
    const p = productTip(db, input.productId);
    if (!p || p.tip !== 'artikal') throw new Error('Nalog za zalihu može biti samo za artikal');
    kolicina = input.kolicina ?? 0;
    if (!(kolicina > 0)) throw new Error('Količina mora biti veća od nule');
    if (!opis) opis = p.naziv;
  } else {
    throw new Error('Nepoznata vrsta naloga');
  }

  const broj = nextBrojNaloga(db, godina);
  const res = db.prepare(`
    INSERT INTO radni_nalozi (broj, godina, datum, rok, vrsta, kupacId, ponudaId, opis, productId, kolicina,
      dogovorenaCijena, trosakRada, korisnikId, napomena)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    broj, godina, datum, input.rok ?? null, input.vrsta,
    input.vrsta === 'narudzba' ? input.kupacId : null,
    input.ponudaId ?? null, opis,
    input.vrsta === 'zaliha' ? input.productId : null, kolicina,
    input.dogovorenaCijena ?? null, input.trosakRada ?? 0, input.korisnikId, input.napomena ?? null
  );
  const id = Number(res.lastInsertRowid);

  if (input.vrsta === 'zaliha') {
    const normativ = getNormativ(db, input.productId!);
    if (normativ.length > 0) {
      upisiStavke(db, id, normativ.map(n => ({
        materijalId: n.materijalId, kolicina: round4(n.kolicina * kolicina), napomena: n.napomena ?? null,
      })));
    }
  }

  return { id, broj, godina };
}

/** Nalog iz prihvaćene ponude: kupac, opis (nazivi stavki) i cijena sa ponude. U transakciji. */
export function createNalogIzPonude(db: SqlDb, ponudaId: number, korisnikId: number): { id: number; broj: number; godina: number } {
  const ponuda = db.prepare('SELECT id, kupacId, status, ukupno FROM ponude WHERE id = ?').get(ponudaId) as any;
  if (!ponuda) throw new Error('Ponuda ne postoji');
  if (ponuda.status !== 'prihvacena') throw new Error('Radni nalog se otvara samo iz prihvaćene ponude');
  if (nalogZaPonudu(db, ponudaId)) throw new Error('Za ovu ponudu radni nalog već postoji');

  const nazivi = db.prepare(`
    SELECT p.naziv FROM ponuda_stavke ps LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? ORDER BY ps.id
  `).all(ponudaId) as Array<{ naziv: string | null }>;
  const opis = nazivi.map(n => n.naziv).filter(Boolean).join(', ') || `Ponuda ${ponudaId}`;

  return createNalog(db, {
    vrsta: 'narudzba', korisnikId, kupacId: ponuda.kupacId, ponudaId, opis,
    dogovorenaCijena: ponuda.ukupno,
  });
}

export function nalogZaPonudu(db: SqlDb, ponudaId: number): { id: number; broj: number; godina: number } | null {
  const row = db.prepare('SELECT id, broj, godina FROM radni_nalozi WHERE ponudaId = ? LIMIT 1').get(ponudaId) as any;
  return row ?? null;
}

export function updateNalog(
  db: SqlDb, id: number,
  patch: Partial<Omit<NalogInput, 'vrsta' | 'korisnikId'>>
): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);

  const fields: string[] = [];
  const values: any[] = [];
  const set = (col: string, v: any) => { fields.push(`${col} = ?`); values.push(v); };

  if (patch.opis !== undefined) {
    const opis = patch.opis.trim();
    if (!opis) throw new Error('Opis je obavezan');
    set('opis', opis);
  }
  if (patch.kupacId !== undefined && n.vrsta === 'narudzba') {
    if (!patch.kupacId) throw new Error('Kupac je obavezan za nalog po narudžbi');
    set('kupacId', patch.kupacId);
  }
  if (patch.kolicina !== undefined && n.vrsta === 'zaliha') {
    if (!(patch.kolicina > 0)) throw new Error('Količina mora biti veća od nule');
    set('kolicina', patch.kolicina);
  }
  if (patch.datum !== undefined) set('datum', patch.datum);
  if (patch.rok !== undefined) set('rok', patch.rok || null);
  if (patch.dogovorenaCijena !== undefined) set('dogovorenaCijena', patch.dogovorenaCijena ?? null);
  if (patch.trosakRada !== undefined) set('trosakRada', patch.trosakRada ?? 0);
  if (patch.napomena !== undefined) set('napomena', patch.napomena || null);

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE radni_nalozi SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/** Briše nalog i stavke. Samo nezavršen nalog. U transakciji. */
export function deleteNalog(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  baciAkoZakljucan(n.status);
  db.prepare('DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?').run(id);
  db.prepare('DELETE FROM radni_nalozi WHERE id = ?').run(id);
}

// ── čitanje ──────────────────────────────────────────────

const NALOG_SELECT = `
  SELECT rn.*,
    k.naziv AS kupacNaziv, k.idBroj AS kupacIdBroj, k.adresa AS kupacAdresa,
    k.grad AS kupacGrad, k.postanskiBroj AS kupacPostanskiBroj,
    p.naziv AS productNaziv, p.cijena AS productCijena,
    u.ime AS korisnikIme,
    o.brojFiskalnogRacuna AS racunBroj, o.status AS racunStatus,
    po.broj AS ponudaBroj, po.godina AS ponudaGodina
  FROM radni_nalozi rn
  LEFT JOIN kupci k ON k.id = rn.kupacId
  LEFT JOIN products p ON p.id = rn.productId
  LEFT JOIN users u ON u.id = rn.korisnikId
  LEFT JOIN orders o ON o.id = rn.racunId
  LEFT JOIN ponude po ON po.id = rn.ponudaId
`;

export function getNalogStavke(db: SqlDb, id: number): RadniNalogStavka[] {
  const stavke = db.prepare(`
    SELECT s.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm,
      m.plocaSirina, m.plocaVisina
    FROM radni_nalog_stavke s
    LEFT JOIN products m ON m.id = s.materijalId
    WHERE s.radniNalogId = ?
    ORDER BY s.id
  `).all(id) as RadniNalogStavka[];
  for (const s of stavke) s.stanje = getProductStock(db, s.materijalId);
  return stavke;
}

export function getNalog(db: SqlDb, id: number): RadniNalog {
  const n = db.prepare(`${NALOG_SELECT} WHERE rn.id = ?`).get(id) as RadniNalog | undefined;
  if (!n) throw new Error('Radni nalog ne postoji');
  n.stavke = getNalogStavke(db, id);
  return n;
}

export function listNalozi(db: SqlDb, filter?: { status?: NalogStatus | 'aktivni' }): RadniNalog[] {
  let where = '';
  const params: any[] = [];
  if (filter?.status === 'aktivni') where = "WHERE rn.status != 'fakturisan'";
  else if (filter?.status) { where = 'WHERE rn.status = ?'; params.push(filter.status); }
  return db.prepare(`${NALOG_SELECT} ${where} ORDER BY rn.godina DESC, rn.broj DESC`).all(...params) as RadniNalog[];
}

// ── normativi ────────────────────────────────────────────

export function getNormativ(db: SqlDb, productId: number): NormativStavka[] {
  return db.prepare(`
    SELECT n.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm
    FROM normativi n LEFT JOIN products m ON m.id = n.materijalId
    WHERE n.productId = ? ORDER BY n.id
  `).all(productId) as NormativStavka[];
}

/** Zamijeni normativ proizvoda. U transakciji. */
export function saveNormativ(db: SqlDb, productId: number, stavke: NalogStavkaInput[]): void {
  const p = productTip(db, productId);
  if (!p || p.tip !== 'artikal') throw new Error('Normativ se vodi samo za artikal');
  validirajStavke(db, stavke);
  db.prepare('DELETE FROM normativi WHERE productId = ?').run(productId);
  const ins = db.prepare('INSERT INTO normativi (productId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)');
  for (const s of stavke) ins.run(productId, s.materijalId, round4(s.kolicina), s.napomena ?? null);
}
```

- [ ] **Step 4: Testovi prolaze**

Run: `bun test src/lib/proizvodnja.test.ts`
Expected: PASS (12 testova).

- [ ] **Step 5: Commit**

```bash
git add src/lib/proizvodnja.ts src/lib/proizvodnja.test.ts
git commit -m "feat(proizvodnja): radni nalozi, stavke utroška i normativi (lib)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Prosječna nabavna, kalkulacija, završetak i vraćanje naloga

**Files:**
- Modify: `src/lib/proizvodnja.ts`
- Test: `src/lib/proizvodnja.test.ts`

**Interfaces:**
- Produces:
  - `getProsjecnaNabavna(db, materijalId): number` (4 dec., 0 bez primki)
  - `interface KalkulacijaStavka { materijalId; naziv; jm; kolicina; cijena; iznos; stanje; zamrznuto: boolean }`
  - `interface Kalkulacija { stavke: KalkulacijaStavka[]; materijal: number; rad: number; ukupno: number; neto?: number; marza?: number; marzaPct?: number; poKomadu?: number; upozorenja: string[] }`
  - `kalkulacija(nalog: Pick<RadniNalog,'vrsta'|'kolicina'|'dogovorenaCijena'|'trosakRada'|'status'>, stavke: Array<RadniNalogStavka & { trenutnaCijena: number }>): Kalkulacija` (čista)
  - `kalkulacijaNaloga(db, id): Kalkulacija`
  - `setStatusNaloga(db, id, status: 'u_izradi'): void` (samo `otvoren → u_izradi`)
  - `zavrsiNalog(db, id): void` (u transakciji)
  - `vratiUIzradu(db, id): void` (u transakciji)
  - `fakturisiNalog(db, id, racunId: number): void`

- [ ] **Step 1: Testovi (dodati u `proizvodnja.test.ts`)**

```ts
import {
  getProsjecnaNabavna, kalkulacija, kalkulacijaNaloga, setStatusNaloga, zavrsiNalog, vratiUIzradu, fakturisiNalog,
} from './proizvodnja';
import { getProductStock } from './skladiste';

test('prosječna nabavna je ponderisana po količini; bez primki 0', () => {
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  expect(getProsjecnaNabavna(db, iv)).toBe(0);
  primka(db, iv, 10, 10);   // 100
  primka(db, iv, 30, 14);   // 420 → 520 / 40 = 13
  expect(getProsjecnaNabavna(db, iv)).toBe(13);
});

test('kalkulacija za narudžbu: marža prema neto dogovorene cijene', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 1170, trosakRada: 100, status: 'otvoren' },
    [
      { id: 1, radniNalogId: 1, materijalId: 1, kolicina: 10, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 13, stanje: 20 } as any,
      { id: 2, radniNalogId: 1, materijalId: 2, kolicina: 4, nabavnaCijena: null, naziv: 'Kant', trenutnaCijena: 0.5, stanje: 1 } as any,
    ]
  );
  expect(k.materijal).toBe(132);
  expect(k.rad).toBe(100);
  expect(k.ukupno).toBe(232);
  expect(k.neto).toBe(1000);
  expect(k.marza).toBe(768);
  expect(k.marzaPct).toBe(76.8);
  expect(k.upozorenja).toEqual(['Kant: utrošak 4 prelazi stanje 1']);
  expect(k.stavke[0].zamrznuto).toBe(false);
});

test('kalkulacija: materijal bez primke daje upozorenje', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 117, trosakRada: 0, status: 'otvoren' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 2, nabavnaCijena: null, naziv: 'Staklo', trenutnaCijena: 0, stanje: 5 } as any]
  );
  expect(k.materijal).toBe(0);
  expect(k.upozorenja).toEqual(['Staklo: nema nabavne cijene (nema primke)']);
});

test('kalkulacija za zalihu: trošak po komadu; zamrznuta cijena ima prednost', () => {
  const k = kalkulacija(
    { vrsta: 'zaliha', kolicina: 4, dogovorenaCijena: null, trosakRada: 40, status: 'zavrsen' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 8, nabavnaCijena: 12, naziv: 'IV', trenutnaCijena: 99, stanje: 0 } as any]
  );
  expect(k.materijal).toBe(96);
  expect(k.ukupno).toBe(136);
  expect(k.poKomadu).toBe(34);
  expect(k.neto).toBeUndefined();
  expect(k.stavke[0].zamrznuto).toBe(true);
  expect(k.upozorenja).toEqual([]); // završen nalog ne upozorava na stanje
});

test('prelazi statusa: otvoren → u_izradi, ostalo odbijeno', () => {
  const k = dodajKupca(db);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  setStatusNaloga(db, r.id, 'u_izradi');
  expect(getNalog(db, r.id).status).toBe('u_izradi');
  expect(() => setStatusNaloga(db, r.id, 'u_izradi')).toThrow();
  expect(() => zavrsiNalog(db, r.id)).toThrow('stavk'); // nema stavki
});

test('završetak knjiži izlaz materijala i zamrzava prosječnu cijenu', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  const kant = dodajMaterijal(db, 'KANT', 'm');
  primka(db, iv, 40, 13);
  primka(db, kant, 100, 0.5);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', dogovorenaCijena: 2340 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 10 }, { materijalId: kant, kolicina: 20 }]);

  zavrsiNalog(db, r.id);

  const n = getNalog(db, r.id);
  expect(n.status).toBe('zavrsen');
  expect(n.zavrsenAt).toBeTruthy();
  expect(n.stavke!.map(s => s.nabavnaCijena)).toEqual([13, 0.5]);
  expect(getProductStock(db, iv)).toBe(30);
  expect(getProductStock(db, kant)).toBe(80);
  const mv = db.prepare("SELECT * FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?").all(r.id) as any[];
  expect(mv.length).toBe(2);
  expect(mv.every(m => m.tip === 'izlaz')).toBe(true);

  // kasnija primka po drugoj cijeni ne mijenja završenu kalkulaciju
  primka(db, iv, 40, 20);
  expect(kalkulacijaNaloga(db, r.id).materijal).toBe(140);
  expect(() => replaceStavke(db, r.id, [])).toThrow('završen');
});

test('završetak naloga za zalihu knjiži i ulaz gotovog proizvoda', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 40, 13);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 3 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 6 }]);
  zavrsiNalog(db, r.id);
  expect(getProductStock(db, art)).toBe(3);
  expect(getProductStock(db, iv)).toBe(34);
  const ulaz = db.prepare("SELECT * FROM stock_movements WHERE productId = ? AND tip = 'ulaz'").get(art) as any;
  expect(ulaz.referenceType).toBe('radni_nalog');
  expect(ulaz.referenceId).toBe(r.id);
});

test('završetak ne blokira kad stanja nema, ali kalkulacija upozorava', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 2, 13);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 5 }]);
  expect(kalkulacijaNaloga(db, r.id).upozorenja).toEqual(['Materijal IV18: utrošak 5 prelazi stanje 2']);
  zavrsiNalog(db, r.id);
  expect(getProductStock(db, iv)).toBe(-3);
});

test('vraćanje u izradu briše knjiženja; ponovni završetak uzima novu prosječnu cijenu', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV18', 'm²', [2800, 2070]);
  primka(db, iv, 10, 10);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 1 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2 }]);
  zavrsiNalog(db, r.id);

  vratiUIzradu(db, r.id);
  const n = getNalog(db, r.id);
  expect(n.status).toBe('u_izradi');
  expect(n.zavrsenAt).toBeNull();
  expect(n.stavke![0].nabavnaCijena).toBeNull();
  expect(getProductStock(db, iv)).toBe(10);
  expect(getProductStock(db, art)).toBe(0);

  primka(db, iv, 10, 20); // prosjek sad 15
  zavrsiNalog(db, r.id);
  expect(getNalog(db, r.id).stavke![0].nabavnaCijena).toBe(15);
  expect(getProductStock(db, iv)).toBe(18);
});

test('fakturisan nalog se ne može vratiti u izradu; fakturisiNalog samo za završenu narudžbu', () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  expect(() => fakturisiNalog(db, r.id, 1)).toThrow('završen');
  zavrsiNalog(db, r.id);
  db.prepare("INSERT INTO orders (id, korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (55, 1, 100, 14.53, 'Gotovina', 'completed')").run();
  fakturisiNalog(db, r.id, 55);
  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(55);
  expect(() => vratiUIzradu(db, r.id)).toThrow('fakturisan');

  const art = dodajArtikal(db, 'A');
  const z = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 1 });
  replaceStavke(db, z.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, z.id);
  expect(() => fakturisiNalog(db, z.id, 55)).toThrow('narudžb');
});
```

- [ ] **Step 2: Pokreni da padne**

Run: `bun test src/lib/proizvodnja.test.ts`
Expected: FAIL — funkcije nisu eksportovane.

- [ ] **Step 3: Implementacija (dodati u `proizvodnja.ts`)**

```ts
import { round2 } from './novac';
import { uNetto } from './pdvUnos';

// ── nabavna cijena ───────────────────────────────────────

/** Prosječna ponderisana nabavna cijena iz svih primki materijala; 0 bez primki. */
export function getProsjecnaNabavna(db: SqlDb, materijalId: number): number {
  const row = db.prepare(`
    SELECT SUM(kolicina * nabavnaCijena) AS vrijednost, SUM(kolicina) AS kolicina
    FROM primka_stavke WHERE productId = ?
  `).get(materijalId) as { vrijednost: number | null; kolicina: number | null };
  if (!row.kolicina || row.kolicina <= 0) return 0;
  return round4((row.vrijednost ?? 0) / row.kolicina);
}

// ── kalkulacija ──────────────────────────────────────────

export interface KalkulacijaStavka {
  materijalId: number;
  naziv: string;
  jm: string;
  kolicina: number;
  cijena: number;
  iznos: number;
  stanje: number;
  /** true = cijena zamrznuta pri završetku, false = trenutna prosječna. */
  zamrznuto: boolean;
}

export interface Kalkulacija {
  stavke: KalkulacijaStavka[];
  materijal: number;
  rad: number;
  ukupno: number;
  /** Narudžba: neto dogovorene cijene, marža KM i %. */
  neto?: number;
  marza?: number;
  marzaPct?: number;
  /** Zaliha: trošak po komadu. */
  poKomadu?: number;
  upozorenja: string[];
}

type NalogZaKalkulaciju = Pick<RadniNalog, 'vrsta' | 'kolicina' | 'dogovorenaCijena' | 'trosakRada' | 'status'>;
type StavkaZaKalkulaciju = RadniNalogStavka & { trenutnaCijena: number; naziv?: string };

/** Čista kalkulacija — bez baze, testabilna. */
export function kalkulacija(nalog: NalogZaKalkulaciju, stavke: StavkaZaKalkulaciju[]): Kalkulacija {
  const upozorenja: string[] = [];
  const otvoren = nalog.status === 'otvoren' || nalog.status === 'u_izradi';

  const ks: KalkulacijaStavka[] = stavke.map(s => {
    const naziv = s.naziv ?? s.materijalNaziv ?? `#${s.materijalId}`;
    const zamrznuto = s.nabavnaCijena != null;
    const cijena = zamrznuto ? s.nabavnaCijena! : s.trenutnaCijena;
    const stanje = s.stanje ?? 0;
    if (cijena <= 0) upozorenja.push(`${naziv}: nema nabavne cijene (nema primke)`);
    if (otvoren && s.kolicina > stanje) upozorenja.push(`${naziv}: utrošak ${s.kolicina} prelazi stanje ${stanje}`);
    return {
      materijalId: s.materijalId, naziv, jm: s.materijalJm ?? '', kolicina: s.kolicina,
      cijena, iznos: round2(s.kolicina * cijena), stanje, zamrznuto,
    };
  });

  const materijal = round2(ks.reduce((sum, s) => sum + s.iznos, 0));
  const rad = round2(nalog.trosakRada ?? 0);
  const ukupno = round2(materijal + rad);
  const out: Kalkulacija = { stavke: ks, materijal, rad, ukupno, upozorenja };

  if (nalog.vrsta === 'narudzba') {
    const bruto = nalog.dogovorenaCijena ?? 0;
    const neto = round2(uNetto(bruto, 'E'));
    const marza = round2(neto - ukupno);
    out.neto = neto;
    out.marza = marza;
    out.marzaPct = neto > 0 ? round2((marza / neto) * 100) : 0;
  } else {
    out.poKomadu = nalog.kolicina > 0 ? round2(ukupno / nalog.kolicina) : 0;
  }
  return out;
}

export function kalkulacijaNaloga(db: SqlDb, id: number): Kalkulacija {
  const n = getNalog(db, id);
  const stavke = (n.stavke ?? []).map(s => ({ ...s, trenutnaCijena: getProsjecnaNabavna(db, s.materijalId) }));
  return kalkulacija(n, stavke);
}

// ── statusi i knjiženje ──────────────────────────────────

export function setStatusNaloga(db: SqlDb, id: number, status: 'u_izradi'): void {
  const n = ucitajNalogIliBaci(db, id);
  if (status === 'u_izradi' && n.status === 'otvoren') {
    db.prepare("UPDATE radni_nalozi SET status = 'u_izradi' WHERE id = ?").run(id);
    return;
  }
  throw new Error(`Prelaz ${n.status} → ${status} nije dozvoljen`);
}

/**
 * Završetak: izlaz materijala po stavkama (zamrzne prosječnu nabavnu), a za
 * zalihu i ulaz gotovog proizvoda. Negativno stanje ne blokira — ploča se
 * često potroši prije nego što se primka unese. U transakciji.
 */
export function zavrsiNalog(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.status !== 'otvoren' && n.status !== 'u_izradi') throw new Error('Nalog je već završen');
  const stavke = db.prepare('SELECT id, materijalId, kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?')
    .all(id) as Array<{ id: number; materijalId: number; kolicina: number }>;
  if (stavke.length === 0) throw new Error('Nalog nema stavki utroška');

  const izlaz = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'radni_nalog', ?)"
  );
  const zamrzni = db.prepare('UPDATE radni_nalog_stavke SET nabavnaCijena = ? WHERE id = ?');
  for (const s of stavke) {
    zamrzni.run(getProsjecnaNabavna(db, s.materijalId), s.id);
    izlaz.run(s.materijalId, s.kolicina, id);
  }
  if (n.vrsta === 'zaliha' && n.productId) {
    db.prepare(
      "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'radni_nalog', ?)"
    ).run(n.productId, n.kolicina, id);
  }
  db.prepare("UPDATE radni_nalozi SET status = 'zavrsen', zavrsenAt = datetime('now','localtime') WHERE id = ?").run(id);
}

/** Poništi knjiženja završetka i otključaj nalog. Fakturisan nalog se ne vraća. U transakciji. */
export function vratiUIzradu(db: SqlDb, id: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.status === 'fakturisan') throw new Error('Nalog je fakturisan i ne može se vratiti u izradu');
  if (n.status !== 'zavrsen') throw new Error('Samo završen nalog se vraća u izradu');
  db.prepare("DELETE FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?").run(id);
  db.prepare('UPDATE radni_nalog_stavke SET nabavnaCijena = NULL WHERE radniNalogId = ?').run(id);
  db.prepare("UPDATE radni_nalozi SET status = 'u_izradi', zavrsenAt = NULL WHERE id = ?").run(id);
}

export function fakturisiNalog(db: SqlDb, id: number, racunId: number): void {
  const n = ucitajNalogIliBaci(db, id);
  if (n.vrsta !== 'narudzba') throw new Error('Račun se izdaje samo za nalog po narudžbi');
  if (n.status !== 'zavrsen') throw new Error('Nalog mora biti završen prije izdavanja računa');
  db.prepare("UPDATE radni_nalozi SET status = 'fakturisan', racunId = ? WHERE id = ?").run(racunId, id);
}
```

Napomena: `ucitajNalogIliBaci` iz Task 3 mora vraćati i `productId` i `kolicina` (već vraća).

- [ ] **Step 4: Testovi prolaze**

Run: `bun test src/lib/proizvodnja.test.ts`
Expected: PASS (22 testova).

- [ ] **Step 5: Commit**

```bash
git add src/lib/proizvodnja.ts src/lib/proizvodnja.test.ts
git commit -m "feat(proizvodnja): kalkulacija, završetak i vraćanje radnog naloga

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Izdavanje računa iz naloga (`upisiRacun` + `izdajRacunZaNalog`)

**Files:**
- Modify: `src/lib/racun.ts` (dodati `upisiRacun`)
- Modify: `src/lib/ponuda.ts:215-243` (`konvertujPonudu` koristi `upisiRacun`)
- Modify: `src/lib/proizvodnja.ts`
- Test: `src/lib/proizvodnja.test.ts`, postojeći `src/lib/ponuda.test.ts` mora i dalje prolaziti

**Interfaces:**
- Consumes: `KonverzijaDeps`, `KonverzijaResult`, `konvertujPonudu` iz `./ponuda`; `buildTringRacun` iz `./tringRacun`; `izracunajTotale` iz `./racun`.
- Produces:
  - `racun.ts`: `interface UpisRacunaInput { korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string; brojFiskalnogRacuna: string | null; kupac?: { naziv?: string | null; idBroj?: string | null; adresa?: string | null; grad?: string | null; postanskiBroj?: string | null } | null; stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string; productTip?: string }> }` i `upisiRacun(db: SqlDb, input: UpisRacunaInput): number` (vraća `orderId`; izlaz skladišta za stavke čiji `productTip !== 'usluga'`).
  - `proizvodnja.ts`: `PRODAJNA_USLUGA = { sifra: 'NAMJ', naziv: 'Namještaj po mjeri' }`, `osigurajProdajnuUslugu(db): number`, `izdajRacunZaNalog(deps: KonverzijaDeps, data: { id: number; korisnikId: number; nacinPlacanja: string }): Promise<KonverzijaResult>`.

- [ ] **Step 1: Testovi (dodati u `proizvodnja.test.ts`)**

```ts
import { izdajRacunZaNalog, osigurajProdajnuUslugu, PRODAJNA_USLUGA } from './proizvodnja';

function printOk(broj = '91') {
  const calls: any[] = [];
  const print = async (racun: any) => {
    calls.push(racun);
    return { success: true, odgovori: { BrojFiskalnogRacuna: broj } } as any;
  };
  return { print, calls };
}
const printFail = async () => ({ success: false, error: 'Štampač ne odgovara', odgovori: {} } as any);
function deps(print: any) {
  return { db, print, transaction: (fn: any) => db.transaction(fn) };
}

test('osigurajProdajnuUslugu kreira uslugu NAMJ jednom', () => {
  const a = osigurajProdajnuUslugu(db);
  const b = osigurajProdajnuUslugu(db);
  expect(a).toBe(b);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(a) as any;
  expect(p.sifra).toBe(PRODAJNA_USLUGA.sifra);
  expect(p.tip).toBe('usluga');
  expect(p.pdvStopa).toBe('E');
});

test('samostalni nalog: račun sa jednom stavkom po dogovorenoj cijeni, nalog fakturisan', async () => {
  const k = dodajKupca(db, 'Mujić');
  const iv = dodajMaterijal(db, 'IV');
  primka(db, iv, 10, 10);
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'Kuhinja', dogovorenaCijena: 2340 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 2 }]);
  zavrsiNalog(db, r.id);

  const { print, calls } = printOk('91');
  const res = await izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Kartica' });
  expect(res.success).toBe(true);
  expect(res.brojFiskalnogRacuna).toBe('91');

  expect(calls[0].stavke.length).toBe(1);
  expect(calls[0].stavke[0].artikal.naziv).toBe(PRODAJNA_USLUGA.naziv);
  expect(calls[0].stavke[0].artikal.cijena).toBe(2340);
  expect(calls[0].kupac.naziv).toBe('Mujić');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(res.racunId) as any;
  expect(order.ukupno).toBe(2340);
  expect(order.nacinPlacanja).toBe('Kartica');
  expect(order.kupacNaziv).toBe('Mujić');
  const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(res.racunId) as any[];
  expect(items.length).toBe(1);
  // usluga ne dira skladište
  expect(db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE referenceType = 'order'").get()).toEqual({ c: 0 });

  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(res.racunId);
  expect(n.racunBroj).toBe('91');
});

test('nalog bez dogovorene cijene ili nezavršen ne ide na štampu', async () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X' });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  const { print, calls } = printOk();
  await expect(izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' })).rejects.toThrow('završen');
  zavrsiNalog(db, r.id);
  await expect(izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' })).rejects.toThrow('Dogovorena cijena');
  expect(calls.length).toBe(0);
});

test('neuspjela štampa ne mijenja nalog ni bazu', async () => {
  const k = dodajKupca(db);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalog(db, { vrsta: 'narudzba', korisnikId: 1, kupacId: k, opis: 'X', dogovorenaCijena: 100 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, r.id);
  const res = await izdajRacunZaNalog(deps(printFail), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' });
  expect(res.success).toBe(false);
  expect(db.prepare('SELECT COUNT(*) AS c FROM orders').get()).toEqual({ c: 0 });
  expect(getNalog(db, r.id).status).toBe('zavrsen');
});

test('nalog iz ponude: račun ide kroz konverziju ponude, nalog pokupi racunId', async () => {
  const k = dodajKupca(db);
  const a1 = dodajArtikal(db, 'KUH', 1000);
  db.prepare(`INSERT INTO ponude (id, broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
    VALUES (7, 1, 2026, ?, 1, '2026-09-01', '2026-09-09', 'prihvacena', 1000, 145.30)`).run(k);
  db.prepare("INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (7, ?, 1, 1000, 0, 'E')").run(a1);
  const iv = dodajMaterijal(db, 'IV');
  const r = createNalogIzPonude(db, 7, 1);
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, r.id);

  const { print, calls } = printOk('92');
  const res = await izdajRacunZaNalog(deps(print), { id: r.id, korisnikId: 1, nacinPlacanja: 'Gotovina' });
  expect(res.success).toBe(true);
  expect(calls[0].stavke[0].artikal.naziv).toBe('Proizvod KUH'); // stavke sa ponude, ne NAMJ
  const p = db.prepare('SELECT status, racunId FROM ponude WHERE id = 7').get() as any;
  expect(p.status).toBe('konvertovana');
  const n = getNalog(db, r.id);
  expect(n.status).toBe('fakturisan');
  expect(n.racunId).toBe(p.racunId);
});
```

- [ ] **Step 2: Pokreni da padne**

Run: `bun test src/lib/proizvodnja.test.ts`
Expected: FAIL — `izdajRacunZaNalog` nije eksportovan.

- [ ] **Step 3: `upisiRacun` u `racun.ts`**

Dodati na kraj `src/lib/racun.ts`:

```ts
import type { SqlDb } from './sqldb';

export interface UpisRacunaInput {
  korisnikId: number;
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  brojFiskalnogRacuna: string | null;
  kupac?: {
    naziv?: string | null; idBroj?: string | null; adresa?: string | null;
    grad?: string | null; postanskiBroj?: string | null;
  } | null;
  stavke: Array<{
    productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string;
    /** 'usluga' ne razdužuje skladište. */
    productTip?: string;
  }>;
}

/**
 * Upis već odštampanog fiskalnog računa: orders + order_items + izlaz
 * skladišta. Zajedničko za konverziju ponude i račun iz radnog naloga.
 * Poziva se u transakciji, tek nakon uspješne štampe.
 */
export function upisiRacun(db: SqlDb, input: UpisRacunaInput): number {
  const k = input.kupac;
  const orderRes = db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
      kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
  `).run(
    input.korisnikId, input.ukupno, input.pdvIznos, input.nacinPlacanja, input.brojFiskalnogRacuna,
    k?.naziv ?? null, k?.idBroj ?? null, k?.adresa ?? null, k?.grad ?? null, k?.postanskiBroj ?? null
  );
  const orderId = Number(orderRes.lastInsertRowid);

  const insertItem = db.prepare(
    'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertStock = db.prepare(
    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)"
  );
  for (const s of input.stavke) {
    insertItem.run(orderId, s.productId, s.kolicina, s.cijena, s.rabat, s.pdvStopa);
    if (s.productTip !== 'usluga') insertStock.run(s.productId, s.kolicina, orderId);
  }
  return orderId;
}
```

- [ ] **Step 4: `konvertujPonudu` koristi `upisiRacun`**

U `src/lib/ponuda.ts` dodaj `import { izracunajTotale, upisiRacun } from './racun';` i zamijeni tijelo `transaction(() => { ... })` (od `const orderRes = db.prepare(` do `return orderId;`) sa:

```ts
      const racunId = transaction(() => {
        const orderId = upisiRacun(db, {
          korisnikId: data.korisnikId, ukupno: ponuda.ukupno, pdvIznos: ponuda.pdvIznos,
          nacinPlacanja: data.nacinPlacanja, brojFiskalnogRacuna,
          kupac: kupac ?? null, stavke,
        });
        db.prepare("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?")
          .run(orderId, id);
        return orderId;
      })();
```

Run: `bun test src/lib/ponuda.test.ts`
Expected: PASS (bez promjene ponašanja).

- [ ] **Step 5: `izdajRacunZaNalog` u `proizvodnja.ts`**

```ts
import { izracunajTotale, upisiRacun } from './racun';
import { buildTringRacun } from './tringRacun';
import { konvertujPonudu, type KonverzijaDeps, type KonverzijaResult } from './ponuda';

/** Usluga preko koje se prodaje rad po mjeri — kreira se pri uključivanju modula. */
export const PRODAJNA_USLUGA = { sifra: 'NAMJ', naziv: 'Namještaj po mjeri' } as const;

export function osigurajProdajnuUslugu(db: SqlDb): number {
  const row = db.prepare('SELECT id FROM products WHERE sifra = ?').get(PRODAJNA_USLUGA.sifra) as { id: number } | undefined;
  if (row) return row.id;
  const r = db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', 0, 'E', 'usluga')"
  ).run(PRODAJNA_USLUGA.sifra, PRODAJNA_USLUGA.naziv);
  return Number(r.lastInsertRowid);
}

const izdavanjaUToku = new Set<number>();

/**
 * Fiskalni račun za završen nalog po narudžbi. Nalog iz ponude ide kroz
 * konverziju ponude (stvarne stavke); samostalan nalog ide kao jedna stavka
 * usluge "Namještaj po mjeri" po dogovorenoj cijeni. Upis tek nakon štampe.
 */
export async function izdajRacunZaNalog(
  deps: KonverzijaDeps,
  data: { id: number; korisnikId: number; nacinPlacanja: string }
): Promise<KonverzijaResult> {
  const { db, print, transaction } = deps;
  const nalog = getNalog(db, data.id);
  if (nalog.vrsta !== 'narudzba') throw new Error('Račun se izdaje samo za nalog po narudžbi');
  if (nalog.status !== 'zavrsen') throw new Error('Nalog mora biti završen prije izdavanja računa');
  if (izdavanjaUToku.has(nalog.id)) throw new Error('Izdavanje računa za ovaj nalog je već u toku');

  izdavanjaUToku.add(nalog.id);
  try {
    if (nalog.ponudaId) {
      const res = await konvertujPonudu(deps, { id: nalog.ponudaId, korisnikId: data.korisnikId, nacinPlacanja: data.nacinPlacanja });
      if (res.success && res.racunId) transaction(() => fakturisiNalog(db, nalog.id, res.racunId!))();
      return res;
    }

    if (!(nalog.dogovorenaCijena! > 0)) throw new Error('Dogovorena cijena mora biti upisana prije izdavanja računa');
    const uslugaId = osigurajProdajnuUslugu(db);
    const stavke = [{
      productId: uslugaId, kolicina: 1, cijena: nalog.dogovorenaCijena!, rabat: 0, pdvStopa: 'E',
      productSifra: PRODAJNA_USLUGA.sifra, productNaziv: PRODAJNA_USLUGA.naziv, productJm: 'kom', productTip: 'usluga',
    }];
    const { ukupno, pdvIznos } = izracunajTotale(stavke);
    const kupac = nalog.kupacId
      ? db.prepare('SELECT * FROM kupci WHERE id = ?').get(nalog.kupacId) as any
      : null;

    const racun = buildTringRacun({
      stavke, ukupno, nacinPlacanja: data.nacinPlacanja,
      kupac: kupac ? {
        idBroj: kupac.idBroj, naziv: kupac.naziv, adresa: kupac.adresa || '',
        postanskiBroj: kupac.postanskiBroj || '', grad: kupac.grad || '',
      } : undefined,
    });
    const result = await print(racun);
    if (!result || !result.success) {
      return { success: false, error: result?.error || result?.vrstaOdgovora || 'Nepoznata greška', odgovori: result?.odgovori ?? {} };
    }
    const brojFiskalnogRacuna = result.odgovori?.BrojFiskalnogRacuna || null;

    try {
      const racunId = transaction(() => {
        const orderId = upisiRacun(db, {
          korisnikId: data.korisnikId, ukupno, pdvIznos, nacinPlacanja: data.nacinPlacanja,
          brojFiskalnogRacuna, kupac, stavke,
        });
        fakturisiNalog(db, nalog.id, orderId);
        return orderId;
      })();
      return { success: true, racunId, brojFiskalnogRacuna, odgovori: result.odgovori };
    } catch (err: any) {
      throw new Error(
        `Račun ${brojFiskalnogRacuna ?? '?'} JE odštampan, ali nije zabilježen u bazi: ` +
        `${err?.message || 'nepoznata greška'}. Evidentirajte račun ručno.`
      );
    }
  } finally {
    izdavanjaUToku.delete(nalog.id);
  }
}
```

- [ ] **Step 6: Testovi prolaze**

Run: `bun test src/lib/proizvodnja.test.ts src/lib/ponuda.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/racun.ts src/lib/ponuda.ts src/lib/proizvodnja.ts src/lib/proizvodnja.test.ts
git commit -m "feat(proizvodnja): izdavanje fiskalnog računa iz radnog naloga

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Materijal kao tip artikla u postojećoj logici

**Files:**
- Modify: `src/lib/skladiste.ts:31-64` (`collectPriceChanges`)
- Modify: `src/lib/batchRacuni.ts:70-72`
- Modify: `src/lib/proizvodnja.ts` (dodati `jeArtikalUProizvodnji`)
- Modify: `src/ipc/handlers.ts:164-296` (product handleri)
- Modify: `src/screens/KasaScreen.tsx:130-137`
- Test: `src/lib/skladiste.test.ts`, `src/lib/batchRacuni.test.ts`, `src/lib/proizvodnja.test.ts`

**Interfaces:**
- Produces: `jeArtikalUProizvodnji(db, productId): boolean` (true ako je na normativu, stavci naloga ili kao proizvod naloga); `product:getAll(tip?: 'artikal' | 'usluga' | 'materijal')`, `product:create/update` prihvataju `tip: 'materijal'` i `plocaSirina`, `plocaVisina`; `product:search` isključuje materijal; novi `materijal:search(query)`; `product:delete` odbija artikal koji je u proizvodnji.

- [ ] **Step 1: Testovi**

U `src/lib/skladiste.test.ts`:

```ts
test('materijal nikad ne ide u nivelaciju ni u promjenu cijene', () => {
  const id = dodajArtikal('IV18', 0, 'materijal');
  dodajZalihu(id, 5);
  const { nivelacija, bezZaliha } = collectPriceChanges(db, [
    { productId: id, cijena: 12, pdvStopa: 'E' },
  ]);
  expect(nivelacija).toEqual([]);
  expect(bezZaliha).toEqual([]);
});
```

U `src/lib/proizvodnja.test.ts`:

```ts
import { jeArtikalUProizvodnji } from './proizvodnja';

test('artikal u normativu ili na nalogu se ne smije obrisati', () => {
  const art = dodajArtikal(db, 'LINA');
  const iv = dodajMaterijal(db, 'IV');
  const kant = dodajMaterijal(db, 'KANT', 'm');
  const slobodan = dodajMaterijal(db, 'X');
  saveNormativ(db, art, [{ materijalId: iv, kolicina: 1 }]);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 1 });
  replaceStavke(db, r.id, [{ materijalId: kant, kolicina: 2 }]);
  expect(jeArtikalUProizvodnji(db, iv)).toBe(true);     // normativ
  expect(jeArtikalUProizvodnji(db, kant)).toBe(true);   // stavka naloga
  expect(jeArtikalUProizvodnji(db, art)).toBe(true);    // proizvod naloga
  expect(jeArtikalUProizvodnji(db, slobodan)).toBe(false);
});
```

U `src/lib/batchRacuni.test.ts`:

```ts
test('generator preskače materijal i usluge', () => {
  const lista = [
    proizvod({ id: 1, tip: 'artikal', stanje: 50 }),
    proizvod({ id: 2, tip: 'materijal', stanje: 50 }),
    proizvod({ id: 3, tip: 'usluga', stanje: 50 }),
  ];
  const res = generirajRacune(lista, { target: 200, rng: seededRng(1) });
  const ids = new Set(res.racuni.flatMap(r => r.stavke.map(s => s.productId)));
  expect(ids).toEqual(new Set([1]));
});
```

- [ ] **Step 2: Pokreni da padnu**

Run: `bun test src/lib/skladiste.test.ts src/lib/batchRacuni.test.ts src/lib/proizvodnja.test.ts`
Expected: FAIL na sva tri nova testa.

- [ ] **Step 3: `collectPriceChanges` preskače materijal**

U `src/lib/skladiste.ts`, u petlji zamijeni:

```ts
    const product = db.prepare('SELECT cijena, tip FROM products WHERE id = ?')
      .get(stavka.productId) as { cijena: number; tip: string } | undefined;
    if (!product || product.tip === 'materijal') continue;
    if (Math.abs(product.cijena - stavka.cijena) <= EPS) continue;
```

- [ ] **Step 4: Generator samo artikli + `jeArtikalUProizvodnji`**

U `src/lib/batchRacuni.ts`:

```ts
  const eligible = products.filter(
    p => p.tip === 'artikal' && (p.stanje ?? 0) >= 1 && p.cijena > 0
  );
```

U `src/lib/proizvodnja.ts`:

```ts
/** Da li artikal figuriše u proizvodnji (normativ, stavka naloga, proizvod naloga) — tada se ne briše. */
export function jeArtikalUProizvodnji(db: SqlDb, productId: number): boolean {
  const row = db.prepare(`
    SELECT 1 AS x FROM normativi WHERE materijalId = ? OR productId = ?
    UNION ALL SELECT 1 FROM radni_nalog_stavke WHERE materijalId = ?
    UNION ALL SELECT 1 FROM radni_nalozi WHERE productId = ?
    LIMIT 1
  `).get(productId, productId, productId, productId);
  return !!row;
}
```

Run: `bun test src/lib/skladiste.test.ts src/lib/batchRacuni.test.ts src/lib/proizvodnja.test.ts`
Expected: PASS.

- [ ] **Step 5: Product handleri**

U `src/ipc/handlers.ts`:

```ts
  const PRODUCT_TIPOVI = ['artikal', 'usluga', 'materijal'] as const;
  const normalizujTip = (t?: string): string => (PRODUCT_TIPOVI as readonly string[]).includes(t ?? '') ? t! : 'artikal';

  handle('product:getAll', (tip?: string) => {
    const where = tip ? 'WHERE p.tip = ?' : '';
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
      .all(...(tip ? [normalizujTip(tip)] : []));
  });
```

`product:create`: proširi ulazni tip sa `plocaSirina?: number | null; plocaVisina?: number | null;`, zamijeni `const tip = ...` sa `const tip = normalizujTip(data.tip);` i INSERT:

```ts
      .prepare(`
        INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip, plocaSirina, plocaVisina)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(data.sifra, data.naziv, data.jm ?? (tip === 'usluga' ? 'usl' : 'kom'), data.cijena, data.pdvStopa,
        data.plu ?? null, data.barkod ?? null, tip, data.plocaSirina ?? null, data.plocaVisina ?? null);
```

`product:update`: proširi ulazni tip isto, zamijeni liniju za `tip` sa `values.push(normalizujTip(data.tip))` i dodaj:

```ts
    if ('plocaSirina' in data) { fields.push('plocaSirina = ?'); values.push(data.plocaSirina ?? null); }
    if ('plocaVisina' in data) { fields.push('plocaVisina = ?'); values.push(data.plocaVisina ?? null); }
```

`product:delete`, prije `DELETE` (import `jeArtikalUProizvodnji` iz `../lib/proizvodnja`):

```ts
    if (jeArtikalUProizvodnji(db, id)) throw new Error('Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan');
```

`product:search`: u WHERE dodaj `AND p.tip != 'materijal'`:

```sql
        WHERE (p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?) AND p.tip != 'materijal'
```

Novi handler odmah ispod:

```ts
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
```

- [ ] **Step 6: Kasa ne prikazuje materijal**

U `src/screens/KasaScreen.tsx` `loadAllProducts`:

```ts
      const all: Product[] = await window.api.getProducts();
      setAllProducts(all.filter(p => p.tip !== 'materijal'));
```

- [ ] **Step 7: Lint i testovi**

Run: `bun run lint && bun test`
Expected: lint bez grešaka, svi testovi PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/skladiste.ts src/lib/skladiste.test.ts src/lib/batchRacuni.ts src/lib/batchRacuni.test.ts src/lib/proizvodnja.ts src/lib/proizvodnja.test.ts src/ipc/handlers.ts src/screens/KasaScreen.tsx
git commit -m "feat(proizvodnja): materijal kao tip artikla — šifarnik, pretraga, kasa, generator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: IPC handleri za naloge i normative + preload + tipovi API-ja

**Files:**
- Modify: `src/ipc/handlers.ts` (nova sekcija iza `ponuda:konvertuj`)
- Modify: `src/preload.ts`
- Modify: `src/global.d.ts`

**Interfaces:**
- Consumes: sve iz `src/lib/proizvodnja.ts`.
- Produces `window.api`:
  - `getNalozi(filter?: 'aktivni' | NalogStatus): Promise<RadniNalog[]>`
  - `getNalog(id): Promise<RadniNalog>`
  - `getNextBrojNaloga(): Promise<{ broj; godina }>`
  - `createNalog(data: NalogInput): Promise<{ id; broj; godina }>`
  - `createNalogIzPonude(ponudaId, korisnikId): Promise<{ id; broj; godina }>`
  - `getNalogZaPonudu(ponudaId): Promise<{ id; broj; godina } | null>`
  - `updateNalog(id, data): Promise<{ success: true }>`
  - `saveNalogStavke(id, stavke: NalogStavkaInput[]): Promise<{ success: true }>`
  - `setNalogStatus(data: { id; status: 'u_izradi' | 'zavrsen' | 'vrati'; korisnikId }): Promise<{ success: true }>` (`vrati` = vrati u izradu, samo admin)
  - `deleteNalog(id): Promise<{ success: true }>`
  - `getNalogKalkulacija(id): Promise<Kalkulacija>`
  - `izdajRacunZaNalog(data: { id; korisnikId; nacinPlacanja }): Promise<KonverzijaResult>`
  - `getNormativ(productId): Promise<NormativStavka[]>`
  - `saveNormativ(productId, stavke): Promise<{ success: true }>`
  - `searchMaterijal(query): Promise<Product[]>`
  - `setProizvodnjaEnabled(enabled: boolean): Promise<{ success: true }>`

- [ ] **Step 1: Handleri**

U `src/ipc/handlers.ts` import:

```ts
import {
  nextBrojNaloga, createNalog, createNalogIzPonude, nalogZaPonudu, updateNalog, replaceStavke,
  getNalog, listNalozi, deleteNalog, kalkulacijaNaloga, setStatusNaloga, zavrsiNalog, vratiUIzradu,
  izdajRacunZaNalog, getNormativ, saveNormativ, osigurajProdajnuUslugu,
} from '../lib/proizvodnja';
```

Iza `ponuda:konvertuj`:

```ts
  // ─── Proizvodnja ─────────────────────────────────────────

  handle('nalog:getAll', (filter?: string) =>
    listNalozi(db, filter ? { status: filter as any } : undefined));

  handle('nalog:get', (id: number) => getNalog(db, id));

  handle('nalog:nextBroj', () => {
    const godina = new Date().getFullYear();
    return { broj: nextBrojNaloga(db, godina), godina };
  });

  handle('nalog:create', (data: any) => {
    if (!data?.korisnikId) throw new Error('Korisnik nije prijavljen');
    return db.transaction(() => createNalog(db, data))();
  });

  handle('nalog:createIzPonude', (ponudaId: number, korisnikId: number) => {
    if (!korisnikId) throw new Error('Korisnik nije prijavljen');
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

  handle('nalog:setStatus', (data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati'; korisnikId: number }) => {
    if (data.status === 'u_izradi') setStatusNaloga(db, data.id, 'u_izradi');
    else if (data.status === 'zavrsen') db.transaction(() => zavrsiNalog(db, data.id))();
    else if (data.status === 'vrati') {
      const u = db.prepare('SELECT uloga FROM users WHERE id = ?').get(data.korisnikId) as { uloga: string } | undefined;
      if (u?.uloga !== 'admin') throw new Error('Vraćanje naloga u izradu može samo administrator');
      db.transaction(() => vratiUIzradu(db, data.id))();
    } else throw new Error('Nepoznat status');
    return { success: true };
  });

  handle('nalog:delete', (id: number) => {
    db.transaction(() => deleteNalog(db, id))();
    return { success: true };
  });

  handle('nalog:kalkulacija', (id: number) => kalkulacijaNaloga(db, id));

  handle('nalog:izdajRacun', async (data: { id: number; korisnikId: number; nacinPlacanja: string }) => {
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
```

- [ ] **Step 2: Preload**

U `src/preload.ts` iza `konvertujPonudu`:

```ts
  // Proizvodnja
  getNalozi: (filter?: string) => ipcRenderer.invoke('nalog:getAll', filter),
  getNalog: (id: number) => ipcRenderer.invoke('nalog:get', id),
  getNextBrojNaloga: () => ipcRenderer.invoke('nalog:nextBroj'),
  createNalog: (data: any) => ipcRenderer.invoke('nalog:create', data),
  createNalogIzPonude: (ponudaId: number, korisnikId: number) => ipcRenderer.invoke('nalog:createIzPonude', ponudaId, korisnikId),
  getNalogZaPonudu: (ponudaId: number) => ipcRenderer.invoke('nalog:zaPonudu', ponudaId),
  updateNalog: (id: number, data: any) => ipcRenderer.invoke('nalog:update', id, data),
  saveNalogStavke: (id: number, stavke: any[]) => ipcRenderer.invoke('nalog:replaceStavke', id, stavke),
  setNalogStatus: (data: { id: number; status: string; korisnikId: number }) => ipcRenderer.invoke('nalog:setStatus', data),
  deleteNalog: (id: number) => ipcRenderer.invoke('nalog:delete', id),
  getNalogKalkulacija: (id: number) => ipcRenderer.invoke('nalog:kalkulacija', id),
  izdajRacunZaNalog: (data: { id: number; korisnikId: number; nacinPlacanja: string }) => ipcRenderer.invoke('nalog:izdajRacun', data),
  getNormativ: (productId: number) => ipcRenderer.invoke('normativ:get', productId),
  saveNormativ: (productId: number, stavke: any[]) => ipcRenderer.invoke('normativ:save', productId, stavke),
  searchMaterijal: (query: string) => ipcRenderer.invoke('materijal:search', query),
  setProizvodnjaEnabled: (enabled: boolean) => ipcRenderer.invoke('proizvodnja:setEnabled', enabled),
```

- [ ] **Step 3: `global.d.ts`**

U `interface Window { api: { ... } }` dodaj:

```ts
    getNalozi: (filter?: string) => Promise<import('@/types').RadniNalog[]>;
    getNalog: (id: number) => Promise<import('@/types').RadniNalog>;
    getNextBrojNaloga: () => Promise<{ broj: number; godina: number }>;
    createNalog: (data: any) => Promise<{ id: number; broj: number; godina: number }>;
    createNalogIzPonude: (ponudaId: number, korisnikId: number) => Promise<{ id: number; broj: number; godina: number }>;
    getNalogZaPonudu: (ponudaId: number) => Promise<{ id: number; broj: number; godina: number } | null>;
    updateNalog: (id: number, data: any) => Promise<{ success: boolean }>;
    saveNalogStavke: (id: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => Promise<{ success: boolean }>;
    setNalogStatus: (data: { id: number; status: 'u_izradi' | 'zavrsen' | 'vrati'; korisnikId: number }) => Promise<{ success: boolean }>;
    deleteNalog: (id: number) => Promise<{ success: boolean }>;
    getNalogKalkulacija: (id: number) => Promise<any>;
    izdajRacunZaNalog: (data: { id: number; korisnikId: number; nacinPlacanja: string }) => Promise<any>;
    getNormativ: (productId: number) => Promise<import('@/types').NormativStavka[]>;
    saveNormativ: (productId: number, stavke: Array<{ materijalId: number; kolicina: number; napomena?: string | null }>) => Promise<{ success: boolean }>;
    searchMaterijal: (query: string) => Promise<any[]>;
    setProizvodnjaEnabled: (enabled: boolean) => Promise<{ success: boolean }>;
```

(Ako `global.d.ts` ne dozvoljava `import('@/types')` u ambijentnoj deklaraciji, koristi `any[]`/`any` kao ostatak fajla.)

- [ ] **Step 4: Lint + tipovi**

Run: `bun run lint && bunx tsc --noEmit -p tsconfig.json`
Expected: bez grešaka.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat(proizvodnja): IPC za radne naloge, normative i materijal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Uključivanje modula — postavka, hook, navigacija

**Files:**
- Create: `src/hooks/useProizvodnja.ts`
- Modify: `src/screens/PostavkeScreen.tsx:71,118,1090-1105`
- Modify: `src/components/MainLayout.tsx`
- Create: `src/screens/ProizvodnjaScreen.tsx` (privremeni kostur; puni sadržaj u Task 11)

**Interfaces:**
- Produces: `useProizvodnja(): boolean | null` (null dok se učitava); CustomEvent `ui:proizvodnja` (`detail: boolean`); CustomEvent `ui:openNalog` (`detail: number` = id naloga) koji MainLayout pretvara u `screen = 'proizvodnja'` + prop `initialNalogId`.
- `ProizvodnjaScreen` props: `{ korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null }`.

- [ ] **Step 1: Hook**

```ts
// src/hooks/useProizvodnja.ts
import { useEffect, useState } from 'react';

/** Da li je modul Proizvodnja uključen. null = još se učitava. */
export function useProizvodnja(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    window.api.getSetting('proizvodnja.enabled').then(v => setEnabled(v === 'true'));
    const onToggle = (e: Event) => setEnabled(Boolean((e as CustomEvent).detail));
    window.addEventListener('ui:proizvodnja', onToggle);
    return () => window.removeEventListener('ui:proizvodnja', onToggle);
  }, []);
  return enabled;
}
```

- [ ] **Step 2: Postavke**

U `PostavkeScreen.tsx`:
- state: `const [proizvodnjaEnabled, setProizvodnjaEnabled] = useState(false);`
- učitavanje uz ostale: `window.api.getSetting('proizvodnja.enabled').then((v) => setProizvodnjaEnabled(v === 'true'));`
- odmah ispod bloka "Generator opcija" (isti obrazac, iza `</div>` tog reda dodaj `<Separator />` pa):

```tsx
                    <div className="flex items-center justify-between">
                      <div className="pr-4">
                        <p className="text-[13px] font-medium text-slate-700">Proizvodnja</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">
                          Radni nalozi, materijal i normativi. Uključuje ekran Proizvodnja i tip artikla „materijal“.
                        </p>
                      </div>
                      <Switch
                        checked={proizvodnjaEnabled}
                        onCheckedChange={async (checked) => {
                          setProizvodnjaEnabled(checked);
                          await window.api.setProizvodnjaEnabled(checked);
                          window.dispatchEvent(new CustomEvent('ui:proizvodnja', { detail: checked }));
                        }}
                      />
                    </div>
```

- [ ] **Step 3: Kostur ekrana**

```tsx
// src/screens/ProizvodnjaScreen.tsx (privremeno — Task 11 ga zamjenjuje)
export default function ProizvodnjaScreen({ korisnikId, uloga, initialNalogId }: {
  korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  return (
    <div className="p-6 text-slate-500 text-[13px]">
      Proizvodnja (korisnik {korisnikId}, {uloga}{initialNalogId ? `, nalog #${initialNalogId}` : ''})
    </div>
  );
}
```

- [ ] **Step 4: MainLayout**

```tsx
import { Factory } from 'lucide-react';
import ProizvodnjaScreen from '@/screens/ProizvodnjaScreen';
import { useProizvodnja } from '@/hooks/useProizvodnja';

type Screen = 'kasa' | 'skladiste' | 'sifarnik' | 'narudzbe' | 'ponude' | 'proizvodnja' | 'izvjestaji' | 'generator' | 'postavke';

// u NAV_ITEMS iza 'ponude':
  { id: 'proizvodnja', label: 'Proizvodnja', icon: Factory },
```

U komponenti:

```tsx
  const proizvodnja = useProizvodnja();
  const [openNalogId, setOpenNalogId] = useState<number | null>(null);

  useEffect(() => {
    if (proizvodnja === false) setScreen(s => (s === 'proizvodnja' ? 'kasa' : s));
  }, [proizvodnja]);

  useEffect(() => {
    // Ponude otvaraju nalog na ekranu Proizvodnja — ekrani se ne poznaju međusobno.
    const onOpen = (e: Event) => {
      setOpenNalogId(Number((e as CustomEvent).detail));
      setScreen('proizvodnja');
    };
    window.addEventListener('ui:openNalog', onOpen);
    return () => window.removeEventListener('ui:openNalog', onOpen);
  }, []);
```

U nav petlji: `if (item.id === 'proizvodnja' && !proizvodnja) return null;`

U main: `{screen === 'proizvodnja' && <ProizvodnjaScreen korisnikId={user.id} uloga={user.uloga} initialNalogId={openNalogId} />}`

- [ ] **Step 5: Ručna provjera**

Run: `bun run start`
Provjeri: Postavke → prekidač Proizvodnja uključi → stavka "Proizvodnja" se odmah pojavi u meniju i otvara kostur; isključi → nestane i vrati na Kasu. Šifarnik → Usluge sadrži "Namještaj po mjeri" (NAMJ).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProizvodnja.ts src/screens/PostavkeScreen.tsx src/components/MainLayout.tsx src/screens/ProizvodnjaScreen.tsx
git commit -m "feat(proizvodnja): opcija u postavkama i stavka u navigaciji

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Šifarnik materijala (`MaterijalTab`)

**Files:**
- Create: `src/components/sifarnik/MaterijalTab.tsx`
- Modify: `src/screens/SifarnikScreen.tsx`

**Interfaces:**
- Consumes: `window.api.getProducts('materijal')`, `createProduct`, `updateProduct`, `deleteProduct`; `jePloca`, `m2PoPloci`, `m2UKom`, `JM_PLOCA` iz `@/lib/ploca`; `useProizvodnja`.
- Produces: `MaterijalTab({ materijali: Product[]; onReload: () => void })`.

- [ ] **Step 1: `MaterijalTab.tsx`**

Modelirati po `UslugeTab.tsx` (isti raspored: header s pretragom, tabela, dijalog). Razlike:

```tsx
// src/components/sifarnik/MaterijalTab.tsx
import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { cn } from '@/lib/utils';
import { jePloca, m2PoPloci, m2UKom, JM_PLOCA } from '@/lib/ploca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Search, Pencil, X, Layers } from 'lucide-react';

const JEDINICE = [JM_PLOCA, 'kom', 'm', 'kg', 'l', 'pak'] as const;

function MaterijalDialog({ open, onOpenChange, product, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; product: Product | null;
  onSave: (data: { sifra: string; naziv: string; jm: string; plocaSirina: number | null; plocaVisina: number | null }) => Promise<void>;
}) {
  const [sifra, setSifra] = useState('');
  const [naziv, setNaziv] = useState('');
  const [jm, setJm] = useState<string>(JM_PLOCA);
  const [sirina, setSirina] = useState('');
  const [visina, setVisina] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (product) {
      setSifra(product.sifra); setNaziv(product.naziv); setJm(product.jm);
      setSirina(product.plocaSirina ? String(product.plocaSirina) : '');
      setVisina(product.plocaVisina ? String(product.plocaVisina) : '');
    } else {
      setSifra(''); setNaziv(''); setJm(JM_PLOCA); setSirina(''); setVisina('');
    }
  }, [open, product]);

  const jeM2 = jm === JM_PLOCA;
  const s = parseInt(sirina, 10); const v = parseInt(visina, 10);
  const dimOk = jeM2 && s > 0 && v > 0;

  const spremi = async () => {
    try {
      await onSave({
        sifra: sifra.trim(), naziv: naziv.trim(), jm,
        plocaSirina: dimOk ? s : null, plocaVisina: dimOk ? v : null,
      });
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{product ? 'Uredi materijal' : 'Novi materijal'}</DialogTitle>
          <DialogDescription>Materijal se nabavlja primkom i troši na radnim nalozima; ne prodaje se na kasi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-[120px_1fr] gap-4">
            <div className="space-y-2">
              <Label>Šifra</Label>
              <Input value={sifra} onChange={e => setSifra(e.target.value)} placeholder="IV-18-B" className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Naziv</Label>
              <Input value={naziv} onChange={e => setNaziv(e.target.value)} placeholder="Iverica bijela 18 mm" autoFocus />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Jedinica mjere</Label>
            <Select value={jm} onValueChange={setJm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JEDINICE.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {jeM2 && (
            <div className="space-y-2">
              <Label>Dimenzija ploče (mm) <span className="text-slate-400 font-normal">— opciono</span></Label>
              <div className="flex items-center gap-2">
                <Input value={sirina} onChange={e => setSirina(e.target.value.replace(/\D/g, ''))} placeholder="2800" className="font-mono w-28" />
                <span className="text-slate-400">×</span>
                <Input value={visina} onChange={e => setVisina(e.target.value.replace(/\D/g, ''))} placeholder="2070" className="font-mono w-28" />
                {dimOk && <span className="text-[12px] text-slate-500 font-mono">= {m2PoPloci(s, v)} m²/ploči</span>}
              </div>
              <p className="text-[11px] text-slate-400">
                S dimenzijom se ploče na primci unose u komadima, a app ih preračuna u m².
              </p>
            </div>
          )}
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button onClick={spremi} disabled={!sifra.trim() || !naziv.trim()}>{product ? 'Spremi' : 'Dodaj'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterijalTab({ materijali, onReload }: { materijali: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [msg, setMsg] = useState('');

  const filtered = materijali
    .filter(p => !search || p.naziv.toLowerCase().includes(search.toLowerCase()) || p.sifra.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.naziv.localeCompare(b.naziv));

  const handleSave = async (data: any) => {
    if (edit) await window.api.updateProduct(edit.id, { ...data, tip: 'materijal' });
    else await window.api.createProduct({ ...data, cijena: 0, pdvStopa: 'E', tip: 'materijal' });
    setDialogOpen(false); setEdit(null); onReload();
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`Obrisati materijal "${p.naziv}"?`)) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e: any) { setMsg(e?.message || 'Greška'); }
  };

  const prikazStanja = (p: Product) => {
    const st = p.stanje ?? 0;
    if (jePloca(p)) return `${st.toFixed(2)} m² (≈ ${m2UKom(st, p.plocaSirina!, p.plocaVisina!)} pl.)`;
    return `${st} ${p.jm}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 px-6 py-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži materijal..." className="pl-9 h-8 text-[13px] bg-slate-50 border-slate-200" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Materijal</span>
              {materijali.length > 0 && <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">{materijali.length}</Badge>}
            </div>
            <Button size="sm" onClick={() => { setEdit(null); setDialogOpen(true); }} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Novi materijal
            </Button>
          </div>
          {msg && <p className="px-5 py-2 text-[12px] text-rose-600 bg-rose-50 border-b border-rose-100">{msg}</p>}

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Layers size={24} className="text-slate-300" /></div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata' : 'Nema materijala'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte ploče, kant traku, okove…</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5 w-[90px]">Šifra</th>
                    <th className="text-left px-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[60px]">JM</th>
                    <th className="text-left px-2 py-2.5 w-[120px]">Ploča</th>
                    <th className="text-right px-2 py-2.5 w-[170px]">Stanje</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className="group border-t border-slate-50 hover:bg-slate-50/50 cursor-pointer" onClick={() => { setEdit(p); setDialogOpen(true); }}>
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400">{p.sifra}</td>
                      <td className="px-2 py-2.5 text-[12px] font-medium text-slate-700">{p.naziv}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500">{p.jm}</td>
                      <td className="px-2 py-2.5 text-[11px] font-mono text-slate-400">
                        {jePloca(p) ? `${p.plocaSirina}×${p.plocaVisina}` : '—'}
                      </td>
                      <td className={cn('px-2 py-2.5 text-[12px] font-mono text-right tabular-nums', (p.stanje ?? 0) <= 0 ? 'text-rose-500' : 'text-slate-700')}>
                        {prikazStanja(p)}
                      </td>
                      <td className="pr-5 pl-2 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); setEdit(p); setDialogOpen(true); }}><Pencil className="h-3 w-3 mr-1" /> Uredi</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={e => { e.stopPropagation(); handleDelete(p); }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>
      <MaterijalDialog key={edit?.id ?? 'new'} open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEdit(null); }} product={edit} onSave={handleSave} />
    </div>
  );
}
```

- [ ] **Step 2: `SifarnikScreen.tsx`**

```tsx
import { MaterijalTab } from '@/components/sifarnik/MaterijalTab';
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { Users, Building2, Wrench, Layers } from 'lucide-react';

type SifarnikTab = 'kupci' | 'dobavljaci' | 'usluge' | 'materijal';
// state + load:
  const proizvodnja = useProizvodnja();
  const [materijali, setMaterijali] = useState<Product[]>([]);
  const loadMaterijali = useCallback(async () => {
    setMaterijali(await window.api.getProducts('materijal'));
  }, []);
  useEffect(() => { if (proizvodnja) loadMaterijali(); }, [proizvodnja, loadMaterijali]);
  useEffect(() => { if (proizvodnja === false && activeTab === 'materijal') setActiveTab('kupci'); }, [proizvodnja, activeTab]);
// tabs:
  const tabs = [
    { id: 'kupci', label: 'Kupci', icon: Users },
    { id: 'dobavljaci', label: 'Dobavljači', icon: Building2 },
    { id: 'usluge', label: 'Usluge', icon: Wrench },
    ...(proizvodnja ? [{ id: 'materijal' as const, label: 'Materijal', icon: Layers }] : []),
  ];
// content:
  {activeTab === 'materijal' && <MaterijalTab materijali={materijali} onReload={loadMaterijali} />}
```

- [ ] **Step 3: Ručna provjera**

Run: `bun run start`
- Modul uključen: Šifarnik ima karticu Materijal. Dodaj "Iverica bijela 18mm", m², 2800×2070 → tabela pokazuje "2800×2070" i "= 5.796 m²/ploči" u dijalogu. Dodaj "Kant ABS 22mm" u `m`, "Baglama 110°" u `kom`.
- Kasa: materijal se ne vidi ni u listi ni u pretrazi.
- Modul isključen: kartica nestaje.

- [ ] **Step 4: Commit**

```bash
git add src/components/sifarnik/MaterijalTab.tsx src/screens/SifarnikScreen.tsx
git commit -m "feat(proizvodnja): šifarnik materijala sa dimenzijom ploče

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Primka materijala i ploče u komadima

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx` (`NovaPrimkaDialog` 361-560 i 700-760; `SkladisteScreen` 1520-1535; lista artikala oko 1060-1080)

**Interfaces:**
- Consumes: `jePloca`, `komUM2`, `m2UKom`, `m2PoPloci` iz `@/lib/ploca`; `useProizvodnja`.
- Ponašanje: kad je modul uključen, `products` u Skladištu = artikli + materijal (materijal s badge-om); u primci se ploča unosi u **komadima**, u bazu ide **m²** i **nabavna po m²**; za materijal prodajna kolona je prazna i ne šalje se (0).

- [ ] **Step 1: Učitavanje materijala u Skladištu**

U `SkladisteScreen`:

```tsx
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { jePloca, komUM2, m2UKom, m2PoPloci } from '@/lib/ploca';
// ...
  const proizvodnja = useProizvodnja();
  const loadProducts = useCallback(async () => {
    const artikli = await window.api.getProducts('artikal');
    const materijal = proizvodnja ? await window.api.getProducts('materijal') : [];
    setProducts([...artikli, ...materijal]);
  }, [proizvodnja]);
```

(`useEffect` koji zove `loadProducts` već zavisi od `loadProducts`, pa će se ponovo pokrenuti kad se postavka učita.)

U listi artikala (red tabele), uz naziv dodaj badge kad je `p.tip === 'materijal'`:

```tsx
{p.tip === 'materijal' && (
  <span className="ml-2 inline-flex items-center rounded px-1.5 py-px text-[9.5px] font-semibold bg-violet-50 text-violet-600 border border-violet-100">materijal</span>
)}
```

i prikaz stanja za ploče: gdje se ispisuje `stock`, ako `jePloca(p)` ispiši `${stock.toFixed(2)} m² · ≈ ${m2UKom(stock, p.plocaSirina!, p.plocaVisina!)} pl.`. Dugme "Uredi" na materijalu ne otvara `ArtikalDialog` (on bi pregazio tip) — umjesto toga red materijala nije klikabilan i ima tekst "uredi u Šifarniku → Materijal".

- [ ] **Step 2: Primka — ploče u komadima**

U `NovaPrimkaDialog`:

Pomoćna funkcija iznad komponente:

```tsx
/** Ploča se u primci kuca u komadima; baza vodi m² i nabavnu po m². */
function uBazuPrimke(p: Product, kolicinaUnos: number, nabavnaUnos: number): { kolicina: number; nabavnaCijena: number } {
  if (!jePloca(p)) return { kolicina: kolicinaUnos, nabavnaCijena: nabavnaUnos };
  const poPloci = m2PoPloci(p.plocaSirina!, p.plocaVisina!);
  return {
    kolicina: komUM2(kolicinaUnos, p.plocaSirina!, p.plocaVisina!),
    nabavnaCijena: Math.round((nabavnaUnos / poPloci) * 10000) / 10000,
  };
}
function izBazePrimke(p: Product | undefined, kolicina: number, nabavnaCijena: number): { kolicina: string; nabavnaCijena: string } {
  if (!p || !jePloca(p)) return { kolicina: String(kolicina), nabavnaCijena: String(nabavnaCijena) };
  const poPloci = m2PoPloci(p.plocaSirina!, p.plocaVisina!);
  return {
    kolicina: String(m2UKom(kolicina, p.plocaSirina!, p.plocaVisina!)),
    nabavnaCijena: String(Math.round(nabavnaCijena * poPloci * 100) / 100),
  };
}
```

U `useEffect` za `editPrimka`, mapiranje stavki:

```tsx
          (editPrimka.stavke ?? []).map((s) => {
            const p = products.find(pr => pr.id === s.productId);
            const prikaz = izBazePrimke(p, s.kolicina, s.nabavnaCijena);
            return {
              productId: s.productId,
              kolicina: prikaz.kolicina,
              nabavnaCijena: prikaz.nabavnaCijena,
              rabat: String(s.rabat || ''),
              cijena: String(s.cijena),
            };
          })
```

U `updateStavka`, kad se izabere materijal: `if (p) updated.cijena = p.tip === 'materijal' ? '0' : String(p.cijena);`

U `doSave` mapiranje:

```tsx
        stavke: validStavke.map((s) => {
          const p = products.find(pr => pr.id === s.productId)!;
          const baza = uBazuPrimke(p, parseDecimal(s.kolicina), parseDecimal(s.nabavnaCijena));
          return {
            productId: s.productId,
            kolicina: baza.kolicina,
            nabavnaCijena: baza.nabavnaCijena,
            rabat: parseDecimal(s.rabat) || 0,
            cijena: p.tip === 'materijal' ? 0 : parseDecimal(s.cijena),
            pdvStopa: p.pdvStopa ?? 'E',
          };
        }),
```

U `handleSave` (provjera nivelacije) preskoči materijal: `if (product && product.tip !== 'materijal' && Math.abs(...) > 0.001)`.

U redu stavke, ispod `DecimalInput` za količinu (omotaj količinu u `<div>`), kad je odabrani proizvod ploča:

```tsx
{(() => {
  const p = products.find(pr => pr.id === s.productId);
  if (!p || !jePloca(p) || !s.kolicina) return null;
  const kom = parseDecimal(s.kolicina);
  return (
    <span className="block text-[9.5px] text-slate-400 font-mono text-right -mt-0.5">
      = {komUM2(kom, p.plocaSirina!, p.plocaVisina!)} m²
    </span>
  );
})()}
```

Naslov kolone "Kol." ostaje; uz izabranu ploču placeholder količine je "kom", uz ostali materijal jm materijala. Kolona "Prodajna" za materijal: `DecimalInput` `disabled` i prazan (`value=""`) kad je `p.tip === 'materijal'`.

U `Select` liste proizvoda u primci, materijal prikaži s prefiksom badge-a: `{p.tip === 'materijal' && <span className="text-[9px] text-violet-500 mr-1">MAT</span>}`.

- [ ] **Step 3: Ručna provjera**

Run: `bun run start`
- Nova primka: odaberi "Iverica bijela 18mm", upiši 5 kom, nabavna 120 → ispod "= 28.98 m²". Spremi. Skladište: iverica pokazuje "28.98 m² · ≈ 5 pl.". Šifarnik → Materijal stanje isto.
- Otvori istu primku za uređivanje: količina pokazuje 5, nabavna 120 (ne 28.98 / 20.70).
- Primka nije napravila nivelaciju za materijal.
- Kant traka: 50 m, nabavna 0.45 → stanje 50 m.

- [ ] **Step 4: Commit**

```bash
git add src/screens/SkladisteScreen.tsx
git commit -m "feat(proizvodnja): primka materijala, ploče u komadima uz preračun u m²

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Ekran Proizvodnja — lista naloga i dijalog naloga

**Files:**
- Create: `src/components/proizvodnja/NalogDialog.tsx`
- Modify (zamijeni kostur): `src/screens/ProizvodnjaScreen.tsx`

**Interfaces:**
- Consumes: `window.api.getNalozi`, `getNalog`, `createNalog`, `updateNalog`, `deleteNalog`, `getKupci`, `getProducts('artikal')`; `formatBrojNaloga` iz `@/lib/proizvodnja`; `ActionRow, Eyebrow, LedgerHead, SegmentedFilter` iz `@/components/ui/ledger`.
- Produces:
  - `NalogDialog({ open, onOpenChange, korisnikId, nalog: RadniNalog | null, onSaved: (id: number) => void })`
  - `ProizvodnjaScreen` koji renderuje listu, detalj s placeholderima za stavke/kalkulaciju (Task 12), i akcije Uredi/Obriši/U izradu.
  - Interni `STATUS_META` i `StatusChip` eksportovani iz `ProizvodnjaScreen.tsx` radi ponovne upotrebe.

- [ ] **Step 1: `NalogDialog.tsx`**

```tsx
// src/components/proizvodnja/NalogDialog.tsx
import { useEffect, useState } from 'react';
import type { Kupac, Product, RadniNalog, NalogVrsta } from '@/types';
import { formatKM, parseDecimal } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { User, Package } from 'lucide-react';

export function NalogDialog({ open, onOpenChange, korisnikId, nalog, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; korisnikId: number;
  nalog: RadniNalog | null; onSaved: (id: number) => void;
}) {
  const [vrsta, setVrsta] = useState<NalogVrsta>('narudzba');
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [artikli, setArtikli] = useState<Product[]>([]);
  const [kupacId, setKupacId] = useState('');
  const [productId, setProductId] = useState('');
  const [kolicina, setKolicina] = useState('1');
  const [opis, setOpis] = useState('');
  const [datum, setDatum] = useState(localDateStr());
  const [rok, setRok] = useState('');
  const [cijena, setCijena] = useState('');
  const [napomena, setNapomena] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.api.getKupci().then(setKupci);
    window.api.getProducts('artikal').then(setArtikli);
    setError('');
    if (nalog) {
      setVrsta(nalog.vrsta);
      setKupacId(nalog.kupacId ? String(nalog.kupacId) : '');
      setProductId(nalog.productId ? String(nalog.productId) : '');
      setKolicina(String(nalog.kolicina));
      setOpis(nalog.opis);
      setDatum(nalog.datum);
      setRok(nalog.rok ?? '');
      setCijena(nalog.dogovorenaCijena != null ? String(nalog.dogovorenaCijena) : '');
      setNapomena(nalog.napomena ?? '');
    } else {
      setVrsta('narudzba'); setKupacId(''); setProductId(''); setKolicina('1'); setOpis('');
      setDatum(localDateStr()); setRok(''); setCijena(''); setNapomena('');
    }
  }, [open, nalog]);

  const isEdit = !!nalog;
  const valid = vrsta === 'narudzba'
    ? !!kupacId && opis.trim().length > 0
    : !!productId && parseDecimal(kolicina) > 0;

  const spremi = async () => {
    setSaving(true); setError('');
    try {
      const payload: any = {
        opis: opis.trim(), datum, rok: rok || null, napomena: napomena || null,
        dogovorenaCijena: cijena ? parseDecimal(cijena) : null,
      };
      if (vrsta === 'narudzba') payload.kupacId = Number(kupacId);
      else { payload.productId = Number(productId); payload.kolicina = parseDecimal(kolicina); }
      let id: number;
      if (isEdit) { await window.api.updateNalog(nalog!.id, payload); id = nalog!.id; }
      else { const r = await window.api.createNalog({ ...payload, vrsta, korisnikId }); id = r.id; }
      onOpenChange(false);
      onSaved(id);
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Uredi nalog` : 'Novi radni nalog'}</DialogTitle>
          <DialogDescription>
            {vrsta === 'narudzba' ? 'Izrada po narudžbi za poznatog kupca.' : 'Standardni proizvod koji ide na zalihu.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2">
              {([['narudzba', 'Po narudžbi', User], ['zaliha', 'Za zalihu', Package]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" onClick={() => setVrsta(v)} aria-pressed={vrsta === v}
                  className={cn('h-10 flex items-center justify-center gap-2 rounded-lg border text-[12.5px] font-medium',
                    vrsta === v ? 'bg-[#0f1629] text-white border-[#0f1629]' : 'text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}

          {vrsta === 'narudzba' ? (
            <div className="space-y-2">
              <Label>Kupac</Label>
              <Select value={kupacId} onValueChange={setKupacId}>
                <SelectTrigger><SelectValue placeholder="Odaberi kupca…" /></SelectTrigger>
                <SelectContent>
                  {kupci.map(k => <SelectItem key={k.id} value={String(k.id)}>{k.naziv}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <div className="space-y-2">
                <Label>Proizvod</Label>
                <Select value={productId} onValueChange={setProductId} disabled={isEdit}>
                  <SelectTrigger><SelectValue placeholder="Odaberi proizvod…" /></SelectTrigger>
                  <SelectContent>
                    {artikli.map(p => <SelectItem key={p.id} value={String(p.id)}><span className="font-mono text-xs text-slate-400 mr-2">{p.sifra}</span>{p.naziv}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Komada</Label>
                <DecimalInput maxDecimals={0} value={kolicina} onValueChange={t => setKolicina(t)} className="font-mono" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Opis {vrsta === 'zaliha' && <span className="text-slate-400 font-normal">— opciono</span>}</Label>
            <Input value={opis} onChange={e => setOpis(e.target.value)} placeholder="Kuhinja 3,2 m, bijela mat, radna ploča hrast" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2"><Label>Datum</Label><DatePicker value={datum} onChange={setDatum} /></div>
            <div className="space-y-2"><Label>Rok isporuke</Label><DatePicker value={rok} onChange={setRok} /></div>
            {vrsta === 'narudzba' && (
              <div className="space-y-2">
                <Label>Dogovorena cijena</Label>
                <DecimalInput value={cijena} onValueChange={t => setCijena(t)} placeholder="0,00" className="font-mono" />
                {cijena && <p className="text-[10.5px] text-slate-400 font-mono">{formatKM(parseDecimal(cijena) || 0)} sa PDV-om</p>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Napomena</Label>
            <Input value={napomena} onChange={e => setNapomena(e.target.value)} placeholder="Opcionalno" />
          </div>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button onClick={spremi} disabled={!valid || saving}>{isEdit ? 'Spremi' : 'Otvori nalog'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `ProizvodnjaScreen.tsx`**

```tsx
// src/screens/ProizvodnjaScreen.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RadniNalog, NalogStatus } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ActionRow, Eyebrow, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import { NalogDialog } from '@/components/proizvodnja/NalogDialog';
import { NormativiTab } from '@/components/proizvodnja/NormativiTab';
import {
  RefreshCw, Plus, Pencil, Trash2, Hammer, ClipboardList, AlertTriangle, X, Factory, Play,
} from 'lucide-react';

export const STATUS_META: Record<NalogStatus, { label: string; cls: string }> = {
  otvoren: { label: 'Otvoren', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  u_izradi: { label: 'U izradi', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  zavrsen: { label: 'Završen', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  fakturisan: { label: 'Fakturisan', cls: 'bg-violet-50 text-violet-600 border-violet-100' },
};

export function StatusChip({ status, size = 'sm' }: { status: NalogStatus; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center rounded-full font-semibold border text-[10px]', size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1', m.cls)}>
      {m.label}
    </span>
  );
}

type Filter = 'aktivni' | 'otvoren' | 'u_izradi' | 'zavrsen' | 'fakturisan' | 'sve';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'aktivni', label: 'Aktivni' },
  { id: 'otvoren', label: 'Otvoreni' },
  { id: 'u_izradi', label: 'U izradi' },
  { id: 'zavrsen', label: 'Završeni' },
  { id: 'fakturisan', label: 'Fakturisani' },
  { id: 'sve', label: 'Svi' },
];

type Tab = 'nalozi' | 'normativi';

export default function ProizvodnjaScreen({ korisnikId, uloga, initialNalogId }: {
  korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  const [tab, setTab] = useState<Tab>('nalozi');
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
  const [selected, setSelected] = useState<RadniNalog | null>(null);
  const [filter, setFilter] = useState<Filter>('aktivni');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editNalog, setEditNalog] = useState<RadniNalog | null>(null);
  const [brisiOpen, setBrisiOpen] = useState(false);

  const load = useCallback(async () => {
    setNalozi(await window.api.getNalozi());
  }, []);
  useEffect(() => { load(); }, [load]);

  const select = useCallback(async (id: number) => {
    try { setSelected(await window.api.getNalog(id)); }
    catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  }, []);

  useEffect(() => { if (initialNalogId) { setTab('nalozi'); select(initialNalogId); } }, [initialNalogId, select]);

  const refreshSelected = useCallback(async () => {
    await load();
    if (selected) await select(selected.id);
  }, [load, select, selected]);

  const visible = useMemo(() => nalozi.filter(n =>
    filter === 'sve' ? true : filter === 'aktivni' ? n.status !== 'fakturisan' : n.status === filter
  ), [nalozi, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: nalozi.length, aktivni: 0 };
    for (const n of nalozi) { c[n.status] = (c[n.status] ?? 0) + 1; if (n.status !== 'fakturisan') c.aktivni++; }
    return c;
  }, [nalozi]);

  const uredivo = selected && (selected.status === 'otvoren' || selected.status === 'u_izradi');

  const uIzradu = async () => {
    if (!selected) return;
    try {
      await window.api.setNalogStatus({ id: selected.id, status: 'u_izradi', korisnikId });
      await refreshSelected();
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  const obrisi = async () => {
    if (!selected) return;
    try {
      await window.api.deleteNalog(selected.id);
      setBrisiOpen(false); setSelected(null); await load();
      setMsg({ type: 'success', text: 'Nalog obrisan' });
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f6f9]">
      <div className="flex-shrink-0 bg-white border-b border-slate-200/80 px-6 py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight">Proizvodnja</h2>
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              {([['nalozi', 'Radni nalozi', Hammer], ['normativi', 'Normativi', ClipboardList]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-medium', tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            {tab === 'nalozi' && <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />}
          </div>
          {tab === 'nalozi' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Osvježi</Button>
              <Button size="sm" onClick={() => { setEditNalog(null); setFormOpen(true); }} className="h-8 gap-1.5 text-[12px]"><Plus className="h-3.5 w-3.5" /> Novi nalog</Button>
            </div>
          )}
        </div>
      </div>

      {msg && (
        <div className={cn('mx-5 mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-medium',
          msg.type === 'error' ? 'bg-rose-50/70 border-rose-200 text-rose-700' : 'bg-emerald-50/70 border-emerald-200 text-emerald-700')}>
          {msg.type === 'error' ? <AlertTriangle size={14} /> : <Factory size={14} />}
          {msg.text}
          <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setMsg(null)}><X size={13} /></button>
        </div>
      )}

      {tab === 'normativi' ? (
        <NormativiTab />
      ) : (
        <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">
          {/* Lista */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
              {visible.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                  <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Hammer size={20} className="text-slate-300" /></div>
                  <p className="text-[13px] font-medium text-slate-500">Nema radnih naloga</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">Otvorite nalog za kupca ili za zalihu.</p>
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <table className="w-full border-separate border-spacing-0">
                    <LedgerHead columns={[
                      { label: 'Broj', className: 'text-left pl-5 pr-2 w-[100px]' },
                      { label: 'Datum', className: 'text-left px-2 w-[90px]' },
                      { label: 'Vrsta', className: 'text-left px-2 w-[90px]' },
                      { label: 'Kupac / proizvod', className: 'text-left px-2' },
                      { label: 'Rok', className: 'text-left px-2 w-[90px]' },
                      { label: 'Cijena', className: 'text-right px-2 w-[110px]' },
                      { label: 'Status', className: 'text-right pr-5 pl-2 w-[110px]' },
                    ]} />
                    <tbody>
                      {visible.map(n => {
                        const isSel = selected?.id === n.id;
                        return (
                          <tr key={n.id} onClick={() => select(n.id)}
                            className={cn('cursor-pointer transition-colors', isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50')}>
                            <td className={cn('pl-5 pr-2 py-2.5 border-b border-slate-100 font-mono text-[11.5px] font-semibold tabular-nums',
                              isSel ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-500')}>{formatBrojNaloga(n)}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-500 tabular-nums">{formatDate(n.datum)}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[11px] text-slate-500">{n.vrsta === 'narudzba' ? 'Narudžba' : 'Zaliha'}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-700 truncate max-w-[260px]">
                              {n.vrsta === 'narudzba' ? (n.kupacNaziv || '—') : `${n.productNaziv} × ${n.kolicina}`}
                              <span className="block text-[10.5px] text-slate-400 truncate">{n.opis}</span>
                            </td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-400 tabular-nums">{n.rok ? formatDate(n.rok) : '—'}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">
                              {n.dogovorenaCijena != null ? formatKM(n.dogovorenaCijena) : '—'}
                            </td>
                            <td className="pr-5 pl-2 py-2.5 border-b border-slate-100 text-right"><StatusChip status={n.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          </div>

          {/* Detalj */}
          <div className="w-[460px] flex-shrink-0">
            {selected ? (
              <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-5 pt-5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Eyebrow>{selected.vrsta === 'narudzba' ? 'Radni nalog po narudžbi' : 'Radni nalog za zalihu'}</Eyebrow>
                      <h3 className="text-[19px] font-bold font-mono tracking-tight text-slate-900 leading-tight mt-1">{formatBrojNaloga(selected)}</h3>
                      <p className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums">
                        {formatDate(selected.datum)}{selected.rok ? ` · rok ${formatDate(selected.rok)}` : ''}
                      </p>
                    </div>
                    <StatusChip status={selected.status} size="md" />
                  </div>
                </div>

                <div className="flex-shrink-0 px-5 pb-3">
                  <dl className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-1.5 text-[12px]">
                    {selected.vrsta === 'narudzba' ? (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Kupac</dt><dd className="font-medium text-slate-700 text-right truncate">{selected.kupacNaziv || '—'}</dd></div>
                    ) : (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Proizvod</dt><dd className="font-medium text-slate-700 text-right truncate">{selected.productNaziv} × {selected.kolicina}</dd></div>
                    )}
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Opis</dt><dd className="text-slate-700 text-right">{selected.opis}</dd></div>
                    {selected.ponudaBroj && (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Iz ponude</dt><dd className="font-mono text-slate-600">{selected.ponudaBroj}/{selected.ponudaGodina}</dd></div>
                    )}
                    {selected.racunBroj && (
                      <div className="flex justify-between gap-3"><dt className="text-violet-400">Fiskalni račun</dt>
                        <dd className="font-mono font-medium text-violet-600">#{selected.racunBroj}{selected.racunStatus === 'refunded' ? ' · stornirano' : ''}</dd></div>
                    )}
                    {selected.napomena && <p className="pt-1.5 border-t border-slate-200/70 text-[11.5px] text-slate-500">{selected.napomena}</p>}
                  </dl>
                </div>

                {/* Stavke + kalkulacija — Task 12 */}
                <div className="flex-1 min-h-0 border-t border-slate-100" id="nalog-detalj-sredina" />

                <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3.5 space-y-2">
                  {selected.status === 'otvoren' && <ActionRow icon={Play} label="U izradu" onClick={uIzradu} />}
                  {uredivo && <ActionRow icon={Pencil} label="Uredi zaglavlje" onClick={() => { setEditNalog(selected); setFormOpen(true); }} />}
                  {uredivo && <ActionRow icon={Trash2} label="Obriši nalog" tone="danger" onClick={() => setBrisiOpen(true)} />}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[12.5px] text-slate-400 bg-white/60 rounded-2xl border border-dashed border-slate-200">
                Odaberite nalog iz liste
              </div>
            )}
          </div>
        </div>
      )}

      <NalogDialog open={formOpen} onOpenChange={setFormOpen} korisnikId={korisnikId} nalog={editNalog}
        onSaved={async (id) => { await load(); await select(id); setMsg({ type: 'success', text: editNalog ? 'Nalog izmijenjen' : 'Nalog otvoren' }); }} />

      <Dialog open={brisiOpen} onOpenChange={setBrisiOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Obrisati nalog {selected ? formatBrojNaloga(selected) : ''}?</DialogTitle>
            <DialogDescription>Nalog nije završen pa ništa nije knjiženo. Brisanje se ne može poništiti.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setBrisiOpen(false)}>Otkaži</Button>
            <Button variant="destructive" onClick={obrisi}>Obriši</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Dok `NormativiTab` ne postoji (Task 14), privremeno ga zamijeni sa `<div className="p-6 text-slate-400 text-[13px]">Normativi — uskoro</div>` i ukloni import; Task 14 ga vraća.

- [ ] **Step 3: Ručna provjera**

Run: `bun run start`
- Novi nalog po narudžbi: kupac, opis, cijena → pojavi se u listi (RN-1/2026, status Otvoren), detalj desno.
- Novi nalog za zalihu: proizvod × 3 → opis default naziv proizvoda.
- U izradu → status se mijenja. Uredi zaglavlje radi. Obriši radi.
- Filteri broje ispravno.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ProizvodnjaScreen.tsx src/components/proizvodnja/NalogDialog.tsx
git commit -m "feat(proizvodnja): ekran sa listom radnih naloga i dijalogom naloga

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Stavke utroška, kalkulator elemenata, kalkulacija, završetak i vraćanje

**Files:**
- Create: `src/components/proizvodnja/ElementiDialog.tsx`
- Create: `src/components/proizvodnja/StavkeUtroska.tsx`
- Create: `src/components/proizvodnja/KalkulacijaPanel.tsx`
- Modify: `src/screens/ProizvodnjaScreen.tsx` (sredina detalja + akcije Završi / Vrati u izradu)

**Interfaces:**
- Consumes: `window.api.searchMaterijal`, `saveNalogStavke`, `getNalogKalkulacija`, `setNalogStatus`, `updateNalog`; `Kalkulacija` tip iz `@/lib/proizvodnja`; `jePloca`, `elementiUM2`, `elementiUNapomenu`, `napomenaUElemente`, `Element` iz `@/lib/ploca`.
- Produces:
  - `ElementiDialog({ open, onOpenChange, initial: Element[], onConfirm: (m2: number, napomena: string) => void })`
  - `interface StavkaDraft { materijalId: number; naziv: string; sifra: string; jm: string; kolicina: string; napomena: string; stanje: number; plocaSirina?: number | null; plocaVisina?: number | null }`
  - `StavkeUtroska({ stavke: RadniNalogStavka[]; uredivo: boolean; onSave: (stavke: NalogStavkaInput[]) => Promise<void> })`
  - `KalkulacijaPanel({ nalog: RadniNalog; kalkulacija: Kalkulacija | null; uredivo: boolean; onTrosakRada: (iznos: number) => Promise<void> })`

- [ ] **Step 1: `ElementiDialog.tsx`**

```tsx
// src/components/proizvodnja/ElementiDialog.tsx
import { useEffect, useState } from 'react';
import { elementiUM2, elementiUNapomenu, type Element } from '@/lib/ploca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, X } from 'lucide-react';

type Red = { sirina: string; visina: string; kom: string };
const prazan = (): Red => ({ sirina: '', visina: '', kom: '1' });

/** Kalkulator elemenata: stolar kroji po elementima (600×720 ×2), a nalog vodi m². */
export function ElementiDialog({ open, onOpenChange, initial, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; initial: Element[];
  onConfirm: (m2: number, napomena: string) => void;
}) {
  const [redovi, setRedovi] = useState<Red[]>([prazan()]);

  useEffect(() => {
    if (!open) return;
    setRedovi(initial.length > 0
      ? initial.map(e => ({ sirina: String(e.sirina), visina: String(e.visina), kom: String(e.kom) }))
      : [prazan(), prazan(), prazan()]);
  }, [open, initial]);

  const elementi: Element[] = redovi.map(r => ({ sirina: Number(r.sirina) || 0, visina: Number(r.visina) || 0, kom: Number(r.kom) || 0 }));
  const m2 = elementiUM2(elementi);
  const set = (i: number, patch: Partial<Red>) => setRedovi(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const samoCifre = (s: string) => s.replace(/\D/g, '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Elementi</DialogTitle>
          <DialogDescription>Širina × visina u mm i broj komada. Zbir ide u količinu, lista u napomenu.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <div className="grid grid-cols-[1fr_16px_1fr_16px_64px_28px] items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
            <span>Širina</span><span /><span>Visina</span><span /><span>Kom</span><span />
          </div>
          {redovi.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_16px_1fr_16px_64px_28px] items-center gap-1">
              <Input value={r.sirina} onChange={e => set(i, { sirina: samoCifre(e.target.value) })} placeholder="600" className="h-8 font-mono text-sm" autoFocus={i === 0} />
              <span className="text-slate-400 text-center">×</span>
              <Input value={r.visina} onChange={e => set(i, { visina: samoCifre(e.target.value) })} placeholder="720" className="h-8 font-mono text-sm" />
              <span className="text-slate-400 text-center">×</span>
              <Input value={r.kom} onChange={e => set(i, { kom: samoCifre(e.target.value) })} placeholder="1" className="h-8 font-mono text-sm" />
              <button onClick={() => setRedovi(rs => rs.filter((_, j) => j !== i))} disabled={redovi.length === 1}
                className="h-8 w-7 flex items-center justify-center text-slate-400 hover:text-rose-500 disabled:opacity-30"><X size={14} /></button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-xs mt-1" onClick={() => setRedovi(rs => [...rs, prazan()])}><Plus className="h-3.5 w-3.5 mr-1" /> Red</Button>
          <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex items-center justify-between">
            <span className="text-[12px] text-slate-500">Ukupno</span>
            <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{m2.toFixed(4)} m²</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button disabled={m2 <= 0} onClick={() => { onConfirm(m2, elementiUNapomenu(elementi)); onOpenChange(false); }}>Preuzmi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `StavkeUtroska.tsx`**

```tsx
// src/components/proizvodnja/StavkeUtroska.tsx
import { useEffect, useRef, useState } from 'react';
import type { RadniNalogStavka } from '@/types';
import type { NalogStavkaInput } from '@/lib/proizvodnja';
import { jePloca, napomenaUElemente } from '@/lib/ploca';
import { cn, parseDecimal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eyebrow } from '@/components/ui/ledger';
import { ElementiDialog } from './ElementiDialog';
import { Search, X, Ruler, Save, AlertTriangle } from 'lucide-react';

export interface StavkaDraft {
  materijalId: number; naziv: string; sifra: string; jm: string;
  kolicina: string; napomena: string; stanje: number;
  plocaSirina?: number | null; plocaVisina?: number | null;
}

function izStavke(s: RadniNalogStavka): StavkaDraft {
  return {
    materijalId: s.materijalId, naziv: s.materijalNaziv ?? `#${s.materijalId}`, sifra: s.materijalSifra ?? '',
    jm: s.materijalJm ?? '', kolicina: String(s.kolicina), napomena: s.napomena ?? '', stanje: s.stanje ?? 0,
    plocaSirina: s.plocaSirina, plocaVisina: s.plocaVisina,
  };
}

export function StavkeUtroska({ stavke, uredivo, onSave }: {
  stavke: RadniNalogStavka[]; uredivo: boolean; onSave: (stavke: NalogStavkaInput[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StavkaDraft[]>(stavke.map(izStavke));
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [elementiZa, setElementiZa] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDraft(stavke.map(izStavke)); setDirty(false); }, [stavke]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => setResults(await window.api.searchMaterijal(query.trim())), 150);
  }, [query]);

  const dodaj = (m: any) => {
    setDraft(d => d.some(x => x.materijalId === m.id) ? d : [...d, {
      materijalId: m.id, naziv: m.naziv, sifra: m.sifra, jm: m.jm, kolicina: '', napomena: '',
      stanje: m.stanje ?? 0, plocaSirina: m.plocaSirina, plocaVisina: m.plocaVisina,
    }]);
    setDirty(true); setQuery(''); setResults([]);
  };
  const set = (i: number, patch: Partial<StavkaDraft>) => { setDraft(d => d.map((s, j) => (j === i ? { ...s, ...patch } : s))); setDirty(true); };
  const ukloni = (i: number) => { setDraft(d => d.filter((_, j) => j !== i)); setDirty(true); };

  const spremi = async () => {
    setSaving(true); setError('');
    try {
      await onSave(draft.map(s => ({ materijalId: s.materijalId, kolicina: parseDecimal(s.kolicina) || 0, napomena: s.napomena || null })));
      setDirty(false);
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-2 bg-slate-50/40">
        <Eyebrow>Utrošak materijala</Eyebrow>
        <span className="font-mono text-[10px] tabular-nums text-slate-400">{draft.length}</span>
      </div>

      {uredivo && (
        <div className="px-5 pb-2 relative">
          <Search className="absolute left-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Dodaj materijal (naziv ili šifra)…" className="pl-8 h-8 text-[12.5px] bg-slate-50" />
          {results.length > 0 && (
            <div className="absolute left-5 right-5 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-auto">
              {results.map(m => (
                <button key={m.id} onClick={() => dodaj(m)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 text-[12px]">
                  <span><span className="font-mono text-slate-400 mr-2">{m.sifra}</span>{m.naziv}</span>
                  <span className={cn('font-mono text-[11px]', (m.stanje ?? 0) <= 0 ? 'text-rose-500' : 'text-slate-400')}>{m.stanje} {m.jm}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y divide-slate-50">
          {draft.length === 0 && <p className="px-5 py-4 text-[12px] text-slate-400">Još nema stavki utroška.</p>}
          {draft.map((s, i) => {
            const kol = parseDecimal(s.kolicina) || 0;
            const prekoracenje = uredivo && kol > s.stanje;
            return (
              <div key={s.materijalId} className="px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-slate-700 truncate">{s.naziv}</p>
                    <p className={cn('text-[10px] font-mono', prekoracenje ? 'text-rose-500' : 'text-slate-400')}>
                      stanje {s.stanje} {s.jm}{prekoracenje ? ' · nedovoljno' : ''}
                    </p>
                  </div>
                  {uredivo ? (
                    <>
                      <DecimalInput maxDecimals={4} value={s.kolicina} onValueChange={t => set(i, { kolicina: t })} placeholder="0" className="h-8 w-24 font-mono text-sm text-right" />
                      <span className="text-[11px] text-slate-400 w-7">{s.jm}</span>
                      {jePloca(s) && (
                        <button title="Elementi" onClick={() => setElementiZa(i)} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Ruler size={14} /></button>
                      )}
                      <button onClick={() => ukloni(i)} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50"><X size={14} /></button>
                    </>
                  ) : (
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">{s.kolicina} {s.jm}</span>
                  )}
                </div>
                {uredivo ? (
                  <Input value={s.napomena} onChange={e => set(i, { napomena: e.target.value })} placeholder="Napomena (npr. korpus 600×720 ×2)" className="mt-1.5 h-7 text-[11px] bg-transparent border-0 border-b border-slate-100 rounded-none px-0 shadow-none" />
                ) : s.napomena ? <p className="mt-1 text-[11px] text-slate-400">{s.napomena}</p> : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {uredivo && (
        <div className="flex-shrink-0 px-5 py-2.5 border-t border-slate-100 flex items-center gap-2">
          {error && <span className="flex items-center gap-1 text-[11px] text-rose-600"><AlertTriangle size={12} /> {error}</span>}
          <Button size="sm" className="ml-auto h-8 gap-1.5 text-[12px]" onClick={spremi} disabled={!dirty || saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Spremam…' : 'Spremi stavke'}
          </Button>
        </div>
      )}

      <ElementiDialog
        open={elementiZa != null}
        onOpenChange={v => { if (!v) setElementiZa(null); }}
        initial={elementiZa != null ? napomenaUElemente(draft[elementiZa]?.napomena ?? '') : []}
        onConfirm={(m2, nap) => { if (elementiZa != null) set(elementiZa, { kolicina: String(m2), napomena: nap }); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: `KalkulacijaPanel.tsx`**

```tsx
// src/components/proizvodnja/KalkulacijaPanel.tsx
import { useEffect, useState } from 'react';
import type { RadniNalog } from '@/types';
import type { Kalkulacija } from '@/lib/proizvodnja';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Eyebrow } from '@/components/ui/ledger';
import { AlertTriangle, Lock } from 'lucide-react';

export function KalkulacijaPanel({ nalog, kalkulacija, uredivo, onTrosakRada }: {
  nalog: RadniNalog; kalkulacija: Kalkulacija | null; uredivo: boolean; onTrosakRada: (iznos: number) => Promise<void>;
}) {
  const [rad, setRad] = useState(String(nalog.trosakRada ?? 0));
  useEffect(() => { setRad(String(nalog.trosakRada ?? 0)); }, [nalog.id, nalog.trosakRada]);
  const k = kalkulacija;
  const zamrznuto = nalog.status === 'zavrsen' || nalog.status === 'fakturisan';

  const Red = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-slate-400">{label}</span>
      <span className={cn('font-mono tabular-nums text-slate-600', cls)}>{value}</span>
    </div>
  );

  return (
    <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <Eyebrow>Kalkulacija</Eyebrow>
        {zamrznuto && <span className="flex items-center gap-1 text-[10px] text-slate-400"><Lock size={10} /> zamrznuta pri završetku</span>}
      </div>
      {k && k.upozorenja.length > 0 && (
        <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5 mb-1.5">
          {k.upozorenja.map((u, i) => <p key={i} className="flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={11} /> {u}</p>)}
        </div>
      )}
      <Red label="Materijal" value={formatKM(k?.materijal ?? 0)} />
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-slate-400">Rad</span>
        {uredivo ? (
          <DecimalInput value={rad} onValueChange={t => setRad(t)} onBlur={() => onTrosakRada(parseDecimal(rad) || 0)}
            className="h-7 w-24 font-mono text-[12px] text-right" placeholder="0,00" />
        ) : <span className="font-mono tabular-nums text-slate-600">{formatKM(k?.rad ?? 0)}</span>}
      </div>
      <div className="pt-1.5 border-t border-slate-100 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-slate-800">Ukupan trošak</span>
        <span className="text-[16px] font-bold font-mono tabular-nums text-slate-900">{formatKM(k?.ukupno ?? 0)}</span>
      </div>
      {nalog.vrsta === 'narudzba' && k && (
        <div className="pt-1.5 space-y-1">
          <Red label="Dogovorena cijena (bruto)" value={formatKM(nalog.dogovorenaCijena ?? 0)} />
          <Red label="Bez PDV-a" value={formatKM(k.neto ?? 0)} />
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-slate-800">Marža</span>
            <span className={cn('text-[16px] font-bold font-mono tabular-nums', (k.marza ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {formatKM(k.marza ?? 0)} <span className="text-[11px] font-medium">({(k.marzaPct ?? 0).toFixed(1)} %)</span>
            </span>
          </div>
        </div>
      )}
      {nalog.vrsta === 'zaliha' && k && (
        <div className="pt-1.5 space-y-1">
          <Red label={`Trošak po komadu (×${nalog.kolicina})`} value={formatKM(k.poKomadu ?? 0)} cls="font-semibold text-slate-800" />
          <Red label="Prodajna cijena iz šifarnika" value={formatKM(nalog.productCijena ?? 0)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Uvezati u `ProizvodnjaScreen.tsx`**

Import:

```tsx
import { StavkeUtroska } from '@/components/proizvodnja/StavkeUtroska';
import { KalkulacijaPanel } from '@/components/proizvodnja/KalkulacijaPanel';
import type { Kalkulacija } from '@/lib/proizvodnja';
import { CheckCircle2, Undo2 } from 'lucide-react';
```

State + učitavanje kalkulacije uz `select`:

```tsx
  const [kalk, setKalk] = useState<Kalkulacija | null>(null);
  const [zavrsiOpen, setZavrsiOpen] = useState(false);
  const [vratiOpen, setVratiOpen] = useState(false);

  const select = useCallback(async (id: number) => {
    try {
      const n = await window.api.getNalog(id);
      setSelected(n);
      setKalk(await window.api.getNalogKalkulacija(id));
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  }, []);
```

Zamijeni placeholder `<div ... id="nalog-detalj-sredina" />` sa:

```tsx
                <div className="flex-1 min-h-0 border-t border-slate-100">
                  <StavkeUtroska
                    stavke={selected.stavke ?? []}
                    uredivo={!!uredivo}
                    onSave={async (stavke) => { await window.api.saveNalogStavke(selected.id, stavke); await select(selected.id); }}
                  />
                </div>
                <KalkulacijaPanel
                  nalog={selected} kalkulacija={kalk} uredivo={!!uredivo}
                  onTrosakRada={async (iznos) => { await window.api.updateNalog(selected.id, { trosakRada: iznos }); await select(selected.id); }}
                />
```

Akcije (u bloku akcija, iznad "Uredi zaglavlje"):

```tsx
                  {uredivo && (selected.stavke?.length ?? 0) > 0 && (
                    <ActionRow icon={CheckCircle2} label="Završi nalog" tone="primary" onClick={() => setZavrsiOpen(true)} />
                  )}
                  {selected.status === 'zavrsen' && uloga === 'admin' && (
                    <ActionRow icon={Undo2} label="Vrati u izradu" onClick={() => setVratiOpen(true)} />
                  )}
```

Dijalog potvrde završetka (uz dijalog brisanja):

```tsx
      <Dialog open={zavrsiOpen} onOpenChange={setZavrsiOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Završiti nalog {selected ? formatBrojNaloga(selected) : ''}?</DialogTitle>
            <DialogDescription>
              Materijal se skida sa skladišta po stavkama utroška i nabavne cijene se zamrzavaju.
              {selected?.vrsta === 'zaliha' && ` Na stanje ulazi ${selected.kolicina} × ${selected.productNaziv}.`}
            </DialogDescription>
          </DialogHeader>
          {kalk && kalk.upozorenja.length > 0 && (
            <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5">
              {kalk.upozorenja.map((u, i) => <p key={i} className="text-[11.5px] text-amber-700">{u}</p>)}
              <p className="text-[11px] text-amber-600/80 pt-1">Završetak nije blokiran — stanje će ići u minus dok se ne unese primka.</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setZavrsiOpen(false)}>Otkaži</Button>
            <Button onClick={async () => {
              if (!selected) return;
              try {
                await window.api.setNalogStatus({ id: selected.id, status: 'zavrsen', korisnikId });
                setZavrsiOpen(false); await refreshSelected();
                setMsg({ type: 'success', text: `Nalog ${formatBrojNaloga(selected)} završen, materijal razdužen` });
              } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); setZavrsiOpen(false); }
            }}>Završi i razduži</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vratiOpen} onOpenChange={setVratiOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Vratiti nalog u izradu?</DialogTitle>
            <DialogDescription>Knjiženja završetka se brišu (materijal se vraća na stanje), stavke se otključavaju.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setVratiOpen(false)}>Otkaži</Button>
            <Button onClick={async () => {
              if (!selected) return;
              try {
                await window.api.setNalogStatus({ id: selected.id, status: 'vrati', korisnikId });
                setVratiOpen(false); await refreshSelected();
              } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); setVratiOpen(false); }
            }}>Vrati u izradu</Button>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 5: Ručna provjera**

Run: `bun run start`
- Na otvorenom nalogu dodaj ivericu; klik na ravnalo → Elementi: 600×720 ×2, 800×720 ×1 → Preuzmi → količina 1.44, napomena "600×720 ×2, 800×720 ×1". Dodaj kant 6 m, baglame 4 kom. Spremi stavke → kalkulacija prikazuje materijal, unesi rad 150 → ukupno, marža.
- Upiši utrošak veći od stanja → crveno "nedovoljno" i upozorenje u kalkulaciji.
- Završi nalog → Skladište: stanja smanjena; kalkulacija zamrznuta; stavke read-only.
- Kao admin: Vrati u izradu → stanja vraćena, stavke uređive. Kao kasir: dugme nema.
- Nalog za zalihu: završetak povećava stanje proizvoda.

- [ ] **Step 6: Lint**

Run: `bun run lint`
Expected: bez grešaka.

- [ ] **Step 7: Commit**

```bash
git add src/components/proizvodnja src/screens/ProizvodnjaScreen.tsx
git commit -m "feat(proizvodnja): stavke utroška, kalkulator elemenata, kalkulacija i završetak naloga

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Izdavanje računa iz naloga i veza s ponudama

**Files:**
- Create: `src/components/proizvodnja/IzdajRacunDialog.tsx`
- Modify: `src/screens/ProizvodnjaScreen.tsx` (akcija "Izdaj račun")
- Modify: `src/screens/PonudeScreen.tsx` (akcija "Radni nalog" na prihvaćenoj ponudi)

**Interfaces:**
- Consumes: `window.api.izdajRacunZaNalog`, `createNalogIzPonude`, `getNalogZaPonudu`; `useProizvodnja`; CustomEvent `ui:openNalog`.
- Produces: `IzdajRacunDialog({ open, onOpenChange, nalog: RadniNalog, korisnikId, onIzdat: (brojFiskalnog: string | null) => void })`.

- [ ] **Step 1: `IzdajRacunDialog.tsx`**

Modelirati po dijalogu konverzije u `PonudeScreen.tsx:1041-1132` (iste opcije plaćanja `PAYMENTS`, tastatura 1–4 i ⌘↵):

```tsx
// src/components/proizvodnja/IzdajRacunDialog.tsx
import { useState } from 'react';
import type { RadniNalog } from '@/types';
import { formatBrojNaloga, PRODAJNA_USLUGA } from '@/lib/proizvodnja';
import { cn, formatKM } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, Key } from '@/components/ui/ledger';
import { Receipt, AlertTriangle, Banknote, CreditCard, Building, FileCheck } from 'lucide-react';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
const PAYMENTS: { type: PaymentType; icon: React.ReactNode }[] = [
  { type: 'Gotovina', icon: <Banknote size={14} /> },
  { type: 'Kartica', icon: <CreditCard size={14} /> },
  { type: 'Virman', icon: <Building size={14} /> },
  { type: 'Ček', icon: <FileCheck size={14} /> },
];

export function IzdajRacunDialog({ open, onOpenChange, nalog, korisnikId, onIzdat }: {
  open: boolean; onOpenChange: (v: boolean) => void; nalog: RadniNalog; korisnikId: number;
  onIzdat: (brojFiskalnog: string | null) => void;
}) {
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const izPonude = !!nalog.ponudaId;

  const izdaj = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await window.api.izdajRacunZaNalog({ id: nalog.id, korisnikId, nacinPlacanja: paymentType });
      if (!r || !r.success) {
        const det = r?.odgovori ? Object.entries(r.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setErr(`Greška: ${r?.error || 'Nepoznata greška'}${det ? ` (${det})` : ''}`);
        return;
      }
      onOpenChange(false);
      onIzdat(r.brojFiskalnogRacuna ?? null);
    } catch (e: any) { setErr(`Greška: ${e?.message || 'Nepoznata greška'}`); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); izdaj(); return; }
          const i = Number(e.key);
          if (i >= 1 && i <= PAYMENTS.length) { e.preventDefault(); setPaymentType(PAYMENTS[i - 1].type); }
        }}>
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center"><Receipt className="h-5 w-5 text-violet-500" /></div>
              <div>
                <DialogTitle className="text-lg">Izdaj račun za {formatBrojNaloga(nalog)}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {izPonude ? `Račun po stavkama ponude ${nalog.ponudaBroj}/${nalog.ponudaGodina}` : `Jedna stavka: „${PRODAJNA_USLUGA.naziv}“ po dogovorenoj cijeni`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        <Separator />
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-600/80">Fiskalni račun se štampa na Tring printeru. Provjerite da je printer uključen.</p>
          </div>
          <div className="space-y-1.5">
            <Eyebrow className="block">Način plaćanja</Eyebrow>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENTS.map((p, i) => (
                <button key={p.type} onClick={() => setPaymentType(p.type)} aria-pressed={paymentType === p.type}
                  className={cn('h-10 flex items-center gap-2 rounded-lg border px-3 text-[12px] font-medium',
                    paymentType === p.type ? 'bg-[#0f1629] text-white border-[#0f1629]' : 'text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  {p.icon}{p.type}<Key tone={paymentType === p.type ? 'dark' : 'light'}>{i + 1}</Key>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <span className="text-[12px] text-slate-500">Za naplatu</span>
            <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{formatKM(nalog.dogovorenaCijena ?? 0)}</span>
          </div>
          {err && <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600"><AlertTriangle size={13} /> {err}</div>}
        </div>
        <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400"><Key className="ml-0">⌘↵</Key> izdaj</span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
            <Button onClick={izdaj} disabled={busy || !(nalog.dogovorenaCijena! > 0)} className="min-w-[160px]">{busy ? 'Štampam…' : 'Izdaj fiskalni račun'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Akcija u `ProizvodnjaScreen.tsx`**

```tsx
import { IzdajRacunDialog } from '@/components/proizvodnja/IzdajRacunDialog';
import { Receipt } from 'lucide-react';
// state
  const [racunOpen, setRacunOpen] = useState(false);
// akcija (iznad "Vrati u izradu")
  {selected.status === 'zavrsen' && selected.vrsta === 'narudzba' && (
    <ActionRow icon={Receipt} label="Izdaj račun" tone="primary" onClick={() => setRacunOpen(true)} />
  )}
// dijalog (uz ostale)
  {selected && (
    <IzdajRacunDialog open={racunOpen} onOpenChange={setRacunOpen} nalog={selected} korisnikId={korisnikId}
      onIzdat={async (bf) => { await refreshSelected(); setMsg({ type: 'success', text: `Račun #${bf ?? ''} izdat po nalogu ${formatBrojNaloga(selected)}` }); }} />
  )}
```

- [ ] **Step 3: Ponude — "Radni nalog"**

U `PonudeScreen.tsx`:

```tsx
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { Hammer } from 'lucide-react';
import { formatBrojNaloga } from '@/lib/proizvodnja';
// u komponenti
  const proizvodnja = useProizvodnja();
  const [nalogZaPonudu, setNalogZaPonudu] = useState<{ id: number; broj: number; godina: number } | null>(null);
  useEffect(() => {
    if (!selected || !proizvodnja) { setNalogZaPonudu(null); return; }
    window.api.getNalogZaPonudu(selected.id).then(setNalogZaPonudu).catch(() => setNalogZaPonudu(null));
  }, [selected, proizvodnja]);

  const otvoriNalog = (id: number) => window.dispatchEvent(new CustomEvent('ui:openNalog', { detail: id }));

  const napraviNalog = async () => {
    if (!selected) return;
    try {
      const r = await window.api.createNalogIzPonude(selected.id, korisnikId);
      setMsg({ type: 'success', text: `Radni nalog ${formatBrojNaloga(r)} otvoren po ponudi ${formatBrojPonude(selected)}` });
      otvoriNalog(r.id);
    } catch (err: any) { setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' }); }
  };
```

U bloku akcija detalja ponude (uz "Štampaj ponudu"), samo kad je `proizvodnja` uključena:

```tsx
  {proizvodnja && selStatus === 'prihvacena' && !nalogZaPonudu && (
    <ActionRow icon={Hammer} label="Radni nalog" onClick={napraviNalog} />
  )}
  {proizvodnja && nalogZaPonudu && (
    <ActionRow icon={Hammer} label={`Otvori nalog ${formatBrojNaloga(nalogZaPonudu)}`} onClick={() => otvoriNalog(nalogZaPonudu.id)} />
  )}
```

Napomena: na konvertovanoj ponudi dugme "Konvertuj" već nestaje; ako je nalog iz ponude završen, račun se izdaje **iz naloga** (koji zove konverziju ponude). Ako korisnik ipak konvertuje ponudu direktno, nalog ostaje `zavrsen` bez `racunId` — prihvatljivo, ali dodaj u `ProizvodnjaScreen` prikaz: kad je `selected.ponudaId` i ponuda već konvertovana, sakrij "Izdaj račun" nije potrebno jer `izdajRacunZaNalog` → `konvertujPonudu` baca "Ponuda je već konvertovana" i poruka se prikaže korisniku.

- [ ] **Step 4: Ručna provjera**

Run: `bun run start` (Tring mock: `bun src/services/tring-mock-server.ts` ako postoji skripta, ili stvarni printer)
- Ponuda prihvaćena → "Radni nalog" → prebaci na Proizvodnju s otvorenim nalogom (kupac, opis, cijena preneseni). Na ponudi sad stoji "Otvori nalog RN-x".
- Završi nalog → "Izdaj račun" → Gotovina → račun izdat; nalog Fakturisan s BF brojem; ponuda "Račun izdat".
- Samostalan nalog (bez ponude) → Izdaj račun → stavka "Namještaj po mjeri" po dogovorenoj cijeni; Računi ekran prikazuje račun s kupcem.
- Nalog bez dogovorene cijene → dugme onemogućeno.

- [ ] **Step 5: Commit**

```bash
git add src/components/proizvodnja/IzdajRacunDialog.tsx src/screens/ProizvodnjaScreen.tsx src/screens/PonudeScreen.tsx
git commit -m "feat(proizvodnja): izdavanje računa iz naloga i radni nalog iz ponude

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Normativi

**Files:**
- Create: `src/components/proizvodnja/NormativiTab.tsx`
- Modify: `src/screens/ProizvodnjaScreen.tsx` (vrati pravi import `NormativiTab`)

**Interfaces:**
- Consumes: `window.api.getProducts('artikal')`, `getNormativ`, `saveNormativ`, `searchMaterijal`; `jePloca` iz `@/lib/ploca`.
- Produces: `NormativiTab()` bez propsa.

- [ ] **Step 1: `NormativiTab.tsx`**

```tsx
// src/components/proizvodnja/NormativiTab.tsx
import { useEffect, useRef, useState } from 'react';
import type { NormativStavka, Product } from '@/types';
import { cn, parseDecimal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eyebrow } from '@/components/ui/ledger';
import { Search, X, Save, ClipboardList, AlertTriangle } from 'lucide-react';

interface Red { materijalId: number; naziv: string; sifra: string; jm: string; kolicina: string; napomena: string }

/** Normativ = utrošak materijala za 1 kom standardnog proizvoda; predložak za nalog za zalihu. */
export function NormativiTab() {
  const [artikli, setArtikli] = useState<Product[]>([]);
  const [filter, setFilter] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [redovi, setRedovi] = useState<Red[]>([]);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { window.api.getProducts('artikal').then(setArtikli); }, []);

  const odaberi = async (id: number) => {
    setProductId(id); setMsg(null);
    const n: NormativStavka[] = await window.api.getNormativ(id);
    setRedovi(n.map(s => ({ materijalId: s.materijalId, naziv: s.materijalNaziv ?? '', sifra: s.materijalSifra ?? '', jm: s.materijalJm ?? '', kolicina: String(s.kolicina), napomena: s.napomena ?? '' })));
    setDirty(false);
  };

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => setResults(await window.api.searchMaterijal(query.trim())), 150);
  }, [query]);

  const dodaj = (m: any) => {
    setRedovi(r => r.some(x => x.materijalId === m.id) ? r : [...r, { materijalId: m.id, naziv: m.naziv, sifra: m.sifra, jm: m.jm, kolicina: '', napomena: '' }]);
    setDirty(true); setQuery(''); setResults([]);
  };
  const set = (i: number, patch: Partial<Red>) => { setRedovi(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };

  const spremi = async () => {
    if (productId == null) return;
    try {
      await window.api.saveNormativ(productId, redovi.map(r => ({ materijalId: r.materijalId, kolicina: parseDecimal(r.kolicina) || 0, napomena: r.napomena || null })));
      setDirty(false); setMsg({ type: 'success', text: 'Normativ spremljen' });
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  const listaArtikala = artikli.filter(a => !filter || a.naziv.toLowerCase().includes(filter.toLowerCase()) || a.sifra.toLowerCase().includes(filter.toLowerCase()));
  const odabrani = artikli.find(a => a.id === productId);

  return (
    <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">
      <div className="w-[340px] flex-shrink-0 bg-white rounded-2xl border border-slate-200/70 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 relative">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Proizvod…" className="pl-8 h-8 text-[12.5px] bg-slate-50" />
        </div>
        <ScrollArea className="flex-1">
          {listaArtikala.map(a => (
            <button key={a.id} onClick={() => odaberi(a.id)}
              className={cn('w-full text-left px-4 py-2.5 border-b border-slate-50 text-[12px] hover:bg-slate-50', productId === a.id && 'bg-blue-50/80 text-blue-700')}>
              <span className="font-mono text-slate-400 mr-2">{a.sifra}</span>{a.naziv}
            </button>
          ))}
        </ScrollArea>
      </div>

      <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-sm flex flex-col overflow-hidden">
        {!odabrani ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
            <ClipboardList size={22} className="text-slate-300 mb-2" />
            <p className="text-[13px] font-medium text-slate-500">Odaberite proizvod</p>
            <p className="text-[12px]">Normativ je utrošak materijala za jedan komad.</p>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-slate-100">
              <Eyebrow>Normativ za 1 kom</Eyebrow>
              <h3 className="text-[16px] font-semibold text-slate-800 mt-0.5">{odabrani.naziv}</h3>
            </div>
            <div className="px-5 py-2 relative">
              <Search className="absolute left-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Dodaj materijal…" className="pl-8 h-8 text-[12.5px] bg-slate-50" />
              {results.length > 0 && (
                <div className="absolute left-5 right-5 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-auto">
                  {results.map(m => (
                    <button key={m.id} onClick={() => dodaj(m)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 text-[12px]">
                      <span><span className="font-mono text-slate-400 mr-2">{m.sifra}</span>{m.naziv}</span><span className="text-[11px] text-slate-400">{m.jm}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y divide-slate-50">
                {redovi.length === 0 && <p className="px-5 py-4 text-[12px] text-slate-400">Nema stavki. Dodajte materijal iznad.</p>}
                {redovi.map((r, i) => (
                  <div key={r.materijalId} className="px-5 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-slate-700 truncate">{r.naziv}</p>
                      <Input value={r.napomena} onChange={e => set(i, { napomena: e.target.value })} placeholder="Napomena" className="mt-0.5 h-6 text-[11px] bg-transparent border-0 border-b border-slate-100 rounded-none px-0 shadow-none" />
                    </div>
                    <DecimalInput maxDecimals={4} value={r.kolicina} onValueChange={t => set(i, { kolicina: t })} className="h-8 w-24 font-mono text-sm text-right" placeholder="0" />
                    <span className="text-[11px] text-slate-400 w-7">{r.jm}</span>
                    <button onClick={() => { setRedovi(x => x.filter((_, j) => j !== i)); setDirty(true); }} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              {msg && (
                <span className={cn('flex items-center gap-1 text-[11.5px]', msg.type === 'error' ? 'text-rose-600' : 'text-emerald-600')}>
                  {msg.type === 'error' && <AlertTriangle size={12} />} {msg.text}
                </span>
              )}
              <Button size="sm" className="ml-auto h-8 gap-1.5 text-[12px]" onClick={spremi} disabled={!dirty}><Save className="h-3.5 w-3.5" /> Spremi normativ</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Vrati import u `ProizvodnjaScreen.tsx`**

Ukloni privremeni placeholder i koristi `import { NormativiTab } from '@/components/proizvodnja/NormativiTab';` te `<NormativiTab />`.

- [ ] **Step 3: Ručna provjera**

Run: `bun run start`
- Normativi: odaberi komodu "Lina", dodaj ivericu 1.25 m², kant 6 m, baglame 4 kom → Spremi. Ponovo otvori: iste vrijednosti.
- Novi nalog za zalihu, Lina × 4 → stavke automatski 5 m², 24 m, 16 kom, uređive.

- [ ] **Step 4: Commit**

```bash
git add src/components/proizvodnja/NormativiTab.tsx src/screens/ProizvodnjaScreen.tsx
git commit -m "feat(proizvodnja): normativi za standardne proizvode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Print radnog naloga (A4 PDF, bez cijena)

**Files:**
- Create: `src/components/RadniNalogPdf.tsx`
- Modify: `src/screens/ProizvodnjaScreen.tsx` (akcije Štampaj / Sačuvaj PDF)

**Interfaces:**
- Consumes: `pdf` iz `@react-pdf/renderer`, `PDF_FONT_FAMILY(_BOLD)` iz `./pdf-fonts`, `POTPIS_AUTORA` iz `@/lib/brend`, `formatBrojNaloga`; `window.api.getFirmaSettings`, `showSaveDialog`, `writeFile`.
- Produces: `RadniNalogPdf({ nalog: RadniNalog; firma: FirmaSettings })`.

- [ ] **Step 1: `RadniNalogPdf.tsx`**

Stil i zaglavlje kopirati iz `PonudaPdf.tsx` (`topBar`, `logo`, `dividerThick`, `infoRow`, `metaRow`, `table`, `signaturesWrap`, `footer`), bez totala i bez žiro računa:

```tsx
// src/components/RadniNalogPdf.tsx
import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { FirmaSettings, RadniNalog } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;

const s = StyleSheet.create({
  page: { padding: 50, paddingBottom: 70, fontFamily: F, fontSize: 9, color: '#000' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 100, height: 100, objectFit: 'contain' as const },
  firmaNaziv: { fontSize: 14, fontFamily: FB, fontWeight: 700, letterSpacing: 0.3 },
  firmaLine: { fontSize: 8, marginTop: 1 },
  title: { fontSize: 22, fontFamily: FB, fontWeight: 700, letterSpacing: 1, textAlign: 'right' },
  number: { fontSize: 10, marginTop: 2, textAlign: 'right' },
  note: { fontSize: 7, marginTop: 3, textAlign: 'right' },
  dividerThick: { borderBottom: '2pt solid #000', marginBottom: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  infoBlock: { width: '48%' },
  infoLabel: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 },
  infoName: { fontSize: 11, fontFamily: FB, fontWeight: 700, marginBottom: 3 },
  infoLine: { fontSize: 8.5, marginBottom: 1.5 },
  metaRow: { flexDirection: 'row', marginBottom: 18, gap: 40 },
  metaLabel: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 9 },
  opisBox: { border: '1pt solid #000', padding: 8, marginBottom: 18 },
  opisTitle: { fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  opisText: { fontSize: 10, lineHeight: 1.4 },
  table: { marginBottom: 20 },
  tHeaderRow: { flexDirection: 'row', borderBottom: '1.5pt solid #000', paddingBottom: 5, marginBottom: 2 },
  tHeaderCell: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 },
  tRow: { flexDirection: 'row', paddingVertical: 5, borderBottom: '0.5pt solid #ddd', alignItems: 'flex-start' },
  tCell: { fontSize: 8.5, lineHeight: 1.3 },
  tCellBold: { fontSize: 8.5, fontFamily: FB, fontWeight: 700, lineHeight: 1.3 },
  colRb: { width: '5%' },
  colSifra: { width: '14%' },
  colMat: { width: '36%' },
  colJm: { width: '8%' },
  colKol: { width: '12%', textAlign: 'right' },
  colNap: { width: '25%', paddingLeft: 8 },
  signaturesWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 40, paddingBottom: 20 },
  signatureBlock: { width: '42%' },
  signatureLine: { borderTop: '0.5pt solid #000', marginBottom: 4 },
  signatureLabel: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 30, left: 50, right: 50, flexDirection: 'row', justifyContent: 'space-between', borderTop: '0.5pt solid #ccc', paddingTop: 8, fontSize: 7, color: '#999' },
});

const fmtDateStr = (d?: string | null) => (d ? d.split('-').reverse().join('.') : '—');
const fmtKol = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');

export function RadniNalogPdf({ nalog, firma }: { nalog: RadniNalog; firma: FirmaSettings }) {
  const stavke = nalog.stavke ?? [];
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={s.logo} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
            </View>
          </View>
          <View>
            <Text style={s.title}>RADNI NALOG</Text>
            <Text style={s.number}>br. {formatBrojNaloga(nalog)}</Text>
            <Text style={s.note}>{nalog.vrsta === 'narudzba' ? 'Izrada po narudžbi' : 'Izrada za zalihu'}</Text>
          </View>
        </View>
        <View style={s.dividerThick} />

        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.infoLabel}>Izvođač</Text>
            <Text style={s.infoName}>{firma.naziv}</Text>
            <Text style={s.infoLine}>{firma.adresa}</Text>
            <Text style={s.infoLine}>{firma.grad}</Text>
          </View>
          <View style={s.infoBlock}>
            {nalog.vrsta === 'narudzba' ? (
              <>
                <Text style={s.infoLabel}>Kupac</Text>
                <Text style={s.infoName}>{nalog.kupacNaziv ?? ''}</Text>
                {nalog.kupacAdresa ? <Text style={s.infoLine}>{nalog.kupacAdresa}</Text> : null}
                {(nalog.kupacPostanskiBroj || nalog.kupacGrad) ? <Text style={s.infoLine}>{[nalog.kupacPostanskiBroj, nalog.kupacGrad].filter(Boolean).join(' ')}</Text> : null}
              </>
            ) : (
              <>
                <Text style={s.infoLabel}>Proizvod</Text>
                <Text style={s.infoName}>{nalog.productNaziv ?? ''}</Text>
                <Text style={s.infoLine}>Količina: {fmtKol(nalog.kolicina)} kom</Text>
              </>
            )}
          </View>
        </View>

        <View style={s.metaRow}>
          <View><Text style={s.metaLabel}>Datum naloga</Text><Text style={s.metaValue}>{fmtDateStr(nalog.datum)}</Text></View>
          <View><Text style={s.metaLabel}>Rok isporuke</Text><Text style={s.metaValue}>{fmtDateStr(nalog.rok)}</Text></View>
          <View><Text style={s.metaLabel}>Nalog otvorio</Text><Text style={s.metaValue}>{nalog.korisnikIme || '—'}</Text></View>
          {nalog.ponudaBroj ? <View><Text style={s.metaLabel}>Po ponudi</Text><Text style={s.metaValue}>{nalog.ponudaBroj}/{nalog.ponudaGodina}</Text></View> : null}
        </View>

        <View style={s.opisBox}>
          <Text style={s.opisTitle}>Opis posla</Text>
          <Text style={s.opisText}>{nalog.opis}</Text>
          {nalog.napomena ? <Text style={{ fontSize: 8.5, marginTop: 4 }}>{nalog.napomena}</Text> : null}
        </View>

        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            <Text style={[s.tHeaderCell, s.colSifra]}>Šifra</Text>
            <Text style={[s.tHeaderCell, s.colMat]}>Materijal</Text>
            <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>
            <Text style={[s.tHeaderCell, s.colKol]}>Količina</Text>
            <Text style={[s.tHeaderCell, s.colNap]}>Napomena</Text>
          </View>
          {stavke.map((st, i) => (
            <View key={st.id} style={s.tRow}>
              <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colSifra]}>{st.materijalSifra ?? ''}</Text>
              <Text style={[s.tCellBold, s.colMat]}>{st.materijalNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.colJm]}>{st.materijalJm ?? ''}</Text>
              <Text style={[s.tCellBold, s.colKol]}>{fmtKol(st.kolicina)}</Text>
              <Text style={[s.tCell, s.colNap]}>{st.napomena ?? ''}</Text>
            </View>
          ))}
          {stavke.length === 0 && <Text style={{ fontSize: 8.5, paddingVertical: 6 }}>Utrošak materijala nije unesen.</Text>}
        </View>

        <View style={s.signaturesWrap} wrap={false}>
          <View style={s.signatureBlock}><View style={s.signatureLine} /><Text style={s.signatureLabel}>Izradio</Text></View>
          <View style={s.signatureBlock}><View style={s.signatureLine} /><Text style={s.signatureLabel}>Preuzeo</Text></View>
        </View>

        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text>{firma.naziv} · Generisano: {today}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Akcije u `ProizvodnjaScreen.tsx`**

```tsx
import { pdf } from '@react-pdf/renderer';
import { RadniNalogPdf } from '@/components/RadniNalogPdf';
import { Printer, Download } from 'lucide-react';
// helperi u komponenti (isti obrazac kao PonudeScreen)
  const loadFirma = async () => {
    try { return await window.api.getFirmaSettings(); }
    catch { return { naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', logo: '', bankAccounts: [] }; }
  };
  const buildPdfBlob = async (n: RadniNalog) => {
    const full = n.stavke ? n : await window.api.getNalog(n.id);
    return pdf(<RadniNalogPdf nalog={full} firma={await loadFirma()} />).toBlob();
  };
  const printPdf = async (n: RadniNalog) => {
    const url = URL.createObjectURL(await buildPdfBlob(n));
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };
  const exportPdf = async (n: RadniNalog) => {
    const blob = await buildPdfBlob(n);
    const savePath = await window.api.showSaveDialog({ defaultName: `RadniNalog-${n.broj}-${n.godina}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!savePath) return;
    await window.api.writeFile(savePath, Array.from(new Uint8Array(await blob.arrayBuffer())) as any);
  };
// akcija (prva u bloku akcija)
  <ActionRow icon={Printer} label="Štampaj nalog" onClick={() => printPdf(selected)}
    trailing={{ icon: Download, onClick: () => exportPdf(selected), title: 'Sačuvaj PDF' }} />
```

- [ ] **Step 3: Ručna provjera**

Run: `bun run start`
- Štampaj nalog: A4 s logom firme, "RADNI NALOG br. RN-1/2026", kupac, rok, opis, tabela materijala s napomenama (elementi), potpisi. Nigdje cijena.
- Sačuvaj PDF: fajl `RadniNalog-1-2026.pdf`.

- [ ] **Step 4: Commit**

```bash
git add src/components/RadniNalogPdf.tsx src/screens/ProizvodnjaScreen.tsx
git commit -m "feat(proizvodnja): A4 print radnog naloga bez cijena

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Završna provjera

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-proizvodnja-radni-nalozi-design.md` (dopuna)

- [ ] **Step 1: Cijeli test paket, lint, tipovi**

Run: `bun test && bun run lint && bunx tsc --noEmit -p tsconfig.json`
Expected: svi testovi PASS (235 postojećih + novi), lint i tsc bez grešaka.

- [ ] **Step 2: Kompletan tok na svježoj bazi (ručno)**

Run: `bun run start`
1. Postavke → uključi Proizvodnja.
2. Šifarnik → Materijal: iverica (m², 2800×2070), kant (m), baglame (kom).
3. Skladište → Primka: 5 pl. iverice po 120 KM, 50 m kanta po 0.45, 20 baglama po 3.2.
4. Ponude → nova ponuda kupcu, stavka "Kuhinja po mjeri" (usluga) 3.500 KM → prihvaćena → Radni nalog.
5. Proizvodnja → nalog: stavke preko Elementi + kant + baglame, rad 400 → kalkulacija i marža → Završi.
6. Skladište: stanja smanjena. Štampaj nalog.
7. Izdaj račun → Gotovina → nalog Fakturisan, ponuda Račun izdat, Računi prikazuje račun.
8. Normativi: Lina → nalog za zalihu × 2 → Završi → Kasa prodaje Linu sa stanjem 2.
9. Isključi modul: meni, kartice i dugmad nestaju; podaci ostaju; ponovo uključi → sve tu.

- [ ] **Step 3: Dopuna speca**

U spec dodaj na kraj sekcije 3 stavku:

```markdown
- **Dopuna (implementacija):** materijal se uređuje u Šifarniku na kartici
  „Materijal“ (`MaterijalTab`), a ne kroz dijalog artikla u Skladištu — dijalog
  artikla je vezan za prodajnu cijenu i PDV koje materijal nema. Skladište i
  dalje prikazuje stanje materijala i prima ga primkom.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-23-proizvodnja-radni-nalozi-design.md
git commit -m "docs(proizvodnja): dopuna speca nakon implementacije

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
