# Crash-safe fiskalni računi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the checkout flow crash-safe so a printed fiscal receipt can never silently vanish from the DB, and detect/recover missing fiscal numbers.

**Architecture:** A write-ahead `pending_receipts` row (JSON cart snapshot) is committed before the printer is called; a single main-process `order:finalize` handler prints, then in one transaction creates the order and deletes the pending row. A leftover pending row on startup means "printed, outcome unknown" → a blocking reconciliation modal. Separately, sequential fiscal numbers are scanned for gaps and surfaced as a banner in Narudžbe that opens the existing manual-entry dialog prefilled.

**Tech Stack:** Electron + TypeScript, React, ShadCN UI, better-sqlite3, Bun (`bun test`), Tring mock server for integration checks.

## Global Constraints

- Runtime/test tooling is **Bun** — run tests with `bun test`, not jest/vitest.
- All new user-facing copy is in **Bosnian**, matching existing screens.
- Migrations follow the existing `db.ts` pattern: `PRAGMA table_info` / `CREATE TABLE IF NOT EXISTS`, no CHECK-constraint rebuilds, no destructive DDL.
- `orders.status` stays `CHECK(status IN ('completed','refunded'))` — do **not** add new status values there.
- Pure, testable logic goes in `src/lib/`; IPC handlers only orchestrate.
- Fiscal numbers: sale receipts are numeric strings (e.g. `"1234"`); refunds are `"R-..."` and must be ignored by gap detection.

---

### Task 1: Gap-detection pure functions

**Files:**
- Create: `src/lib/fiskalni.ts`
- Test: `src/lib/fiskalni.test.ts`

**Interfaces:**
- Produces: `parseFiskalniBroj(raw: string | null | undefined): number | null` and `izracunajPraznine(brojevi: number[]): number[]` — used by the `order:getFiscalGaps` handler in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/fiskalni.test.ts
import { test, expect } from 'bun:test';
import { parseFiskalniBroj, izracunajPraznine } from './fiskalni';

test('parseFiskalniBroj parsira numeričke brojeve', () => {
  expect(parseFiskalniBroj('1234')).toBe(1234);
  expect(parseFiskalniBroj('  42 ')).toBe(42);
});

test('parseFiskalniBroj ignoriše reklamacije i prazne', () => {
  expect(parseFiskalniBroj('R-5')).toBeNull();
  expect(parseFiskalniBroj(null)).toBeNull();
  expect(parseFiskalniBroj(undefined)).toBeNull();
  expect(parseFiskalniBroj('')).toBeNull();
  expect(parseFiskalniBroj('12a')).toBeNull();
});

test('izracunajPraznine bez rupa daje prazno', () => {
  expect(izracunajPraznine([1, 2, 3, 4])).toEqual([]);
});

test('izracunajPraznine nalazi jednu rupu', () => {
  expect(izracunajPraznine([100, 101, 103])).toEqual([102]);
});

test('izracunajPraznine nalazi više rupa i ignoriše redoslijed/duplikate', () => {
  expect(izracunajPraznine([10, 13, 13, 16])).toEqual([11, 12, 14, 15]);
});

test('izracunajPraznine sa manje od 2 broja daje prazno', () => {
  expect(izracunajPraznine([])).toEqual([]);
  expect(izracunajPraznine([7])).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/fiskalni.test.ts`
Expected: FAIL — cannot find module `./fiskalni`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/fiskalni.ts

/** Parse a fiscal receipt number; returns null for refunds (R-...), empty, or non-numeric. */
export function parseFiskalniBroj(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Return integers missing strictly between the min and max of the given fiscal numbers. */
export function izracunajPraznine(brojevi: number[]): number[] {
  const present = new Set(brojevi);
  const sorted = [...present].sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const gaps: number[] = [];
  for (let n = sorted[0] + 1; n < sorted[sorted.length - 1]; n++) {
    if (!present.has(n)) gaps.push(n);
  }
  return gaps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/fiskalni.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fiskalni.ts src/lib/fiskalni.test.ts
git commit -m "feat(fiskalni): gap-detection pure functions"
```

---

### Task 2: `pending_receipts` table + migration

**Files:**
- Modify: `src/database/schema.ts` (add table to the schema string)
- Modify: `src/database/db.ts:27-101` (add migration inside `runMigrations`)

**Interfaces:**
- Produces: table `pending_receipts (id, korisnikId, snapshot TEXT, createdAt)` used by Tasks 3 & 4.

- [ ] **Step 1: Add table to schema**

In `src/database/schema.ts`, add this block inside the backtick template (e.g. after the `order_items` table, before `stock_movements`):

```sql
  CREATE TABLE IF NOT EXISTS pending_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );
```

- [ ] **Step 2: Add migration for existing DBs**

In `src/database/db.ts`, at the end of `runMigrations` (after the `isManual` block at line 100), add:

```ts
  // Create pending_receipts table if missing (write-ahead intent log)
  database.exec(`
    CREATE TABLE IF NOT EXISTS pending_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      korisnikId INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (korisnikId) REFERENCES users(id)
    )
  `);
```

- [ ] **Step 3: Verify the app boots and creates the table**

Run: `bun run start` (let the window open, then close it).
Expected: no errors in the terminal. The DB now has `pending_receipts`. (Optional manual check: open the userData `kasa.db` and confirm the table exists.)

- [ ] **Step 4: Commit**

```bash
git add src/database/schema.ts src/database/db.ts
git commit -m "feat(db): add pending_receipts write-ahead table"
```

---

### Task 3: `insertCompletedOrder` helper + `order:finalize` handler

**Files:**
- Modify: `src/ipc/handlers.ts` (add module-scope helpers + new handler; refactor `tring:printReceipt` to share racun building)

**Interfaces:**
- Consumes: `pending_receipts` (Task 2), `Tring.stampatiFiskalniRacun`.
- Produces: IPC channel `order:finalize`; module-scope functions `insertCompletedOrder(db, data): number` and `buildTringRacun(data): Tring.Racun`, reused by Task 4.

**Snapshot / finalize payload shape** (each stavka carries BOTH print fields and `productId`):
```ts
type FinalizeData = {
  korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string;
  kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
  napomena?: string;
  stavke: Array<{
    productId: number; sifra: string; naziv: string; jm: string; plu?: number;
    cijena: number; kolicina: number; rabat: number; pdvStopa: string;
  }>;
};
```

- [ ] **Step 1: Add module-scope helper `insertCompletedOrder` (top of `handlers.ts`, after the `handle` helper at line 16)**

```ts
import type Database from 'better-sqlite3';

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
```

- [ ] **Step 2: Extract `buildTringRacun` and refactor `tring:printReceipt`**

Add this module-scope function near `insertCompletedOrder`:

```ts
function buildTringRacun(data: any): Tring.Racun {
  const ukupno = data.ukupno || 0;
  let vrstePlacanja: Tring.VrstaPlacanja[];
  if (data.vrstePlacanja && data.vrstePlacanja.length > 0) {
    vrstePlacanja = data.vrstePlacanja;
  } else {
    vrstePlacanja = [{ oznaka: data.nacinPlacanja || 'Gotovina', iznos: ukupno }];
  }
  return {
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
}
```

Then in `handle('tring:printReceipt', ...)` (lines 953-990), replace the inline `ukupno`/`vrstePlacanja`/`racun` construction with:

```ts
  handle('tring:printReceipt', async (data: any) => {
    loadTringConfig();
    const racun = buildTringRacun(data);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt request:', JSON.stringify(racun));
    const result = await Tring.stampatiFiskalniRacun(racun);
    if (Tring.isLoggingEnabled()) console.log('[Tring] printReceipt response:', JSON.stringify(result));
    return result;
  });
```

(`buildTringRacun` / `insertCompletedOrder` are module-scope and receive `db` explicitly; inside `registerIpcHandlers` `db` is in scope.)

- [ ] **Step 3: Add the `order:finalize` handler**

Inside `registerIpcHandlers`, near the other `order:*` handlers (e.g. after `order:createManual` around line 684):

```ts
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
```

- [ ] **Step 4: Verify happy path against the Tring mock server**

Start the mock server and app (see `package.json` / existing dev flow for the mock; it listens on `localhost:8085`). In the app, ring up a sale and pay.
Expected: sale completes, receipt "prints" via mock, and the order appears in Narudžbe with a fiscal number. No leftover row in `pending_receipts`.

- [ ] **Step 5: Verify print-failure path**

Stop the mock server (so the print call errors/times out), then attempt a sale.
Expected: an error message is shown, **no** order is created, and `pending_receipts` is empty afterward (the row was dropped).

- [ ] **Step 6: Commit**

```bash
git add src/ipc/handlers.ts
git commit -m "feat(kasa): write-ahead order:finalize handler + shared order/racun builders"
```

---

### Task 4: Reconciliation + gap-detection handlers

**Files:**
- Modify: `src/ipc/handlers.ts` (add `pending:list`, `pending:resolve`, `pending:discard`, `order:getFiscalGaps`, `order:dismissFiscalGap`)

**Interfaces:**
- Consumes: `insertCompletedOrder` (Task 3), `parseFiskalniBroj`/`izracunajPraznine` (Task 1).
- Produces: IPC channels used by preload (Task 5) and UI (Tasks 8-9):
  - `pending:list → Array<{ id: number; korisnikId: number; createdAt: string; snapshot: FinalizeData }>`
  - `pending:resolve({ id, brojFiskalnogRacuna, createdAt }) → { id: number }`
  - `pending:discard(id) → { success: true }`
  - `order:getFiscalGaps → number[]`
  - `order:dismissFiscalGap(broj: number) → { success: true }`

- [ ] **Step 1: Add the import for the pure functions**

At the top of `src/ipc/handlers.ts` (with the other imports):

```ts
import { parseFiskalniBroj, izracunajPraznine } from '../lib/fiskalni';
```

- [ ] **Step 2: Add pending-reconciliation handlers**

Inside `registerIpcHandlers`, near the other `order:*` handlers:

```ts
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
```

- [ ] **Step 3: Add gap-detection handlers**

```ts
  handle('order:getFiscalGaps', () => {
    const rows = db
      .prepare('SELECT brojFiskalnogRacuna FROM orders WHERE brojFiskalnogRacuna IS NOT NULL')
      .all() as Array<{ brojFiskalnogRacuna: string }>;
    const brojevi = rows
      .map(r => parseFiskalniBroj(r.brojFiskalnogRacuna))
      .filter((n): n is number => n !== null);
    const sve = izracunajPraznine(brojevi);

    const dismissedRow = db.prepare("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").get() as { value: string } | undefined;
    const dismissed: number[] = dismissedRow ? JSON.parse(dismissedRow.value) : [];
    return sve.filter(n => !dismissed.includes(n));
  });

  handle('order:dismissFiscalGap', (broj: number) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'").get() as { value: string } | undefined;
    const dismissed: number[] = row ? JSON.parse(row.value) : [];
    if (!dismissed.includes(broj)) dismissed.push(broj);
    db.prepare("INSERT INTO settings (key, value) VALUES ('fiscal.dismissedGaps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(dismissed));
    return { success: true };
  });
```

- [ ] **Step 4: Verify via app**

Run: `bun run start`. In DevTools console, run:
```js
await window.api.getFiscalGaps();      // → [] on a clean DB
await window.api.listPending();        // → []
```
(These bridges land in Task 5; if running before Task 5, verify by temporarily calling `ipcRenderer` — otherwise defer this check to after Task 5.)
Expected: no errors thrown by the handlers.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/handlers.ts
git commit -m "feat(ipc): pending reconciliation + fiscal gap detection handlers"
```

---

### Task 5: Preload bridges + type declarations

**Files:**
- Modify: `src/preload.ts:46-52` (Orders section)
- Modify: `src/global.d.ts:42-47` (Orders section of the `api` type)

**Interfaces:**
- Consumes: IPC channels from Tasks 3-4.
- Produces: `window.api.finalizeOrder`, `listPending`, `resolvePending`, `discardPending`, `getFiscalGaps`, `dismissFiscalGap` — used by Tasks 6, 8, 9.

- [ ] **Step 1: Add preload bridges**

In `src/preload.ts`, inside the `// Orders` block (after `refundOrder`, line 52):

```ts
  finalizeOrder: (data: any) => ipcRenderer.invoke('order:finalize', data),
  listPending: () => ipcRenderer.invoke('pending:list'),
  resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => ipcRenderer.invoke('pending:resolve', data),
  discardPending: (id: number) => ipcRenderer.invoke('pending:discard', id),
  getFiscalGaps: () => ipcRenderer.invoke('order:getFiscalGaps'),
  dismissFiscalGap: (broj: number) => ipcRenderer.invoke('order:dismissFiscalGap', broj),
```

- [ ] **Step 2: Add type declarations**

In `src/global.d.ts`, inside the `api: {` block (after `refundOrder`, line 47):

```ts
    finalizeOrder: (data: any) => Promise<{ success: boolean; id?: number; brojFiskalnogRacuna?: string | null; error?: string; odgovori?: Record<string, string> }>;
    listPending: () => Promise<Array<{ id: number; korisnikId: number; createdAt: string; snapshot: any }>>;
    resolvePending: (data: { id: number; brojFiskalnogRacuna: string; createdAt: string }) => Promise<{ id: number }>;
    discardPending: (id: number) => Promise<{ success: boolean }>;
    getFiscalGaps: () => Promise<number[]>;
    dismissFiscalGap: (broj: number) => Promise<{ success: boolean }>;
```

- [ ] **Step 3: Verify types compile**

Run: `bun run lint`
Expected: no new TypeScript/ESLint errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload.ts src/global.d.ts
git commit -m "feat(api): expose finalize, pending, and fiscal-gap bridges"
```

---

### Task 6: KasaScreen uses `finalizeOrder`

**Files:**
- Modify: `src/screens/KasaScreen.tsx:258-304` (`handleFinalize`)

**Interfaces:**
- Consumes: `window.api.finalizeOrder` (Task 5). Replaces the `tringPrintReceipt` + `createOrder` two-call sequence.

- [ ] **Step 1: Replace the two-call flow with a single finalize call**

In `handleFinalize`, replace the body from the `tringData` construction through the `createOrder` call (lines 267-292) with:

```ts
      const stavke = cart.map(item => ({
        productId: item.product.id,
        sifra: item.product.sifra,
        naziv: item.product.naziv,
        jm: item.product.jm,
        plu: item.product.plu,
        cijena: item.product.cijena,
        kolicina: item.kolicina,
        rabat: item.rabat,
        pdvStopa: item.product.pdvStopa,
      }));

      const res = await window.api.finalizeOrder({
        korisnikId: user.id, ukupno: total, pdvIznos: pdvAmount, nacinPlacanja: paymentType,
        kupac, napomena: racunNapomena || undefined, stavke,
      });

      if (!res || !res.success) {
        const details = res?.odgovori ? Object.entries(res.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setMessage({ type: 'error', text: `Greška pri štampanju: ${res?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
        setLoading(false);
        return;
      }

      const brojFiskalnogRacuna = res.brojFiskalnogRacuna || null;
```

Keep the existing success block that follows (clearing the cart, `setMessage` success text, `loadDailyTotal()`, refocus). Remove now-unused `datumRacuna`/`vrijemeRacuna` references from the success message, or keep them by reading from `res.odgovori?.DatumFiskalnogRacuna` / `VrijemeFiskalnogRacuna`:

```ts
      const datumRacuna = res.odgovori?.DatumFiskalnogRacuna || '';
      const vrijemeRacuna = res.odgovori?.VrijemeFiskalnogRacuna || '';
```

- [ ] **Step 2: Verify a full sale end-to-end (mock server running)**

Run: `bun run start`. Ring up a multi-item sale, apply a discount, pay.
Expected: identical behavior to before — receipt prints, success message with fiscal number, cart clears, daily total updates. Confirm the order + stock movements landed in the DB (check Narudžbe + Skladište).

- [ ] **Step 3: Commit**

```bash
git add src/screens/KasaScreen.tsx
git commit -m "feat(kasa): checkout uses single crash-safe finalizeOrder call"
```

---

### Task 7: DodajRacunDialog accepts a prefilled fiscal number

**Files:**
- Modify: `src/components/DodajRacunDialog.tsx:23-49` (Props + initial state)

**Interfaces:**
- Produces: optional `prefillBroj?: string` prop. When the dialog opens with it set, the fiscal-number field is prefilled. Consumed by Task 9.

- [ ] **Step 1: Add the prop and apply it on open**

Change the `Props` interface (line 23) to add:

```ts
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  korisnikId: number;
  onSaved: () => void;
  prefillBroj?: string;
}
```

Update the destructuring (line 36) to include `prefillBroj`, and add a `useEffect` (import `useEffect` from `react` — line 1 currently imports `useState, useMemo`) that seeds the field when the dialog opens:

```ts
import { useState, useMemo, useEffect } from 'react';
```

```ts
export default function DodajRacunDialog({ open, onOpenChange, korisnikId, onSaved, prefillBroj }: Props) {
  // ...existing useState declarations...

  useEffect(() => {
    if (open && prefillBroj) setBrojFiskalnog(prefillBroj);
  }, [open, prefillBroj]);
```

(The existing `reset()` on close already clears the field, so no other change is needed.)

- [ ] **Step 2: Verify existing manual entry still works and prefill applies**

Run: `bun run start`. Open the existing manual-entry button in Narudžbe (no prefill) → field is empty as before.
Expected: no regression. Prefill is exercised in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/components/DodajRacunDialog.tsx
git commit -m "feat(racun): DodajRacunDialog accepts prefilled fiscal number"
```

---

### Task 8: Startup reconciliation modal (blocking)

**Files:**
- Create: `src/components/PendingRacuniDialog.tsx`
- Modify: `src/components/MainLayout.tsx` (mount the modal so it appears after login)

**Interfaces:**
- Consumes: `window.api.listPending`, `resolvePending`, `discardPending` (Task 5).

- [ ] **Step 1: Create the modal component**

```tsx
// src/components/PendingRacuniDialog.tsx
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PendingRow {
  id: number;
  createdAt: string;
  snapshot: {
    ukupno: number;
    stavke: Array<{ naziv: string; kolicina: number; cijena: number }>;
  };
}

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PendingRacuniDialog({ korisnikId }: { korisnikId: number }) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [broj, setBroj] = useState('');
  const [datum, setDatum] = useState(nowLocalInput());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await window.api.listPending();
    setRows(data as PendingRow[]);
    setBroj(''); setDatum(nowLocalInput()); setError('');
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = rows[0];
  if (!current) return null;

  const resolve = async () => {
    setError('');
    if (!broj.trim()) { setError('Unesi fiskalni broj sa papirnog računa'); return; }
    setLoading(true);
    try {
      await window.api.resolvePending({ id: current.id, brojFiskalnogRacuna: broj.trim(), createdAt: datum.replace('T', ' ') + ':00' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Greška');
    } finally {
      setLoading(false);
    }
  };

  const discard = async () => {
    setLoading(true);
    try {
      await window.api.discardPending(current.id);
      await load();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-lg" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Neispravno završen račun</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Ovaj račun je poslan na štampu, ali aplikacija nije potvrdila upis (moguć prekid/pad računara).
            <strong> Provjerite papirni račun.</strong>
          </p>
          <div className="rounded border p-3 text-sm">
            <div className="font-medium mb-1">Stavke:</div>
            <ul className="space-y-0.5">
              {current.snapshot.stavke.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span>{s.naziv} × {s.kolicina}</span>
                  <span className="font-mono">{(s.cijena * s.kolicina).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
              <span>Ukupno</span><span className="font-mono">{current.snapshot.ukupno.toFixed(2)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fiskalni broj (sa papira)</Label>
              <Input value={broj} onChange={e => setBroj(e.target.value)} placeholder="npr. 1234" />
            </div>
            <div>
              <Label>Datum i vrijeme</Label>
              <Input type="datetime-local" value={datum} onChange={e => setDatum(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {rows.length > 1 && <p className="text-xs text-slate-500">Preostalo nerazriješenih: {rows.length}</p>}
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="outline" onClick={discard} disabled={loading}>Nije odštampan — odbaci</Button>
          <Button onClick={resolve} disabled={loading}>Odštampan — sačuvaj</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount it in MainLayout**

In `src/components/MainLayout.tsx`, add the import and render it once (it self-hides when there are no pending rows). After the opening `return (` wrapper's root element, include:

```tsx
import PendingRacuniDialog from '@/components/PendingRacuniDialog';
```

Render it inside the layout root (e.g. just before the `{screen === 'kasa' && ...}` block or at the end of the root container):

```tsx
      <PendingRacuniDialog korisnikId={user.id} />
```

- [ ] **Step 3: Verify the blocking modal**

Run: `bun run start`. Manually insert a fake pending row via DevTools console (there's no UI to create one directly):
```js
// Simulate a crash-orphaned print by finalizing against a stopped mock server won't leave a row (it's cleaned).
// Instead, temporarily insert one for the test:
```
Simplest reliable test: temporarily comment out the `DELETE FROM pending_receipts` line in the `order:finalize` success path, run one sale, restart the app.
Expected: on next launch the blocking modal appears, shows the sale's items/total, and cannot be dismissed with Esc or outside-click. "Odštampan — sačuvaj" with a number creates the order and closes; "Nije odštampan — odbaci" removes it. **Restore the deleted line after testing.**

- [ ] **Step 4: Commit**

```bash
git add src/components/PendingRacuniDialog.tsx src/components/MainLayout.tsx
git commit -m "feat(recovery): blocking startup modal for unresolved prints"
```

---

### Task 9: Narudžbe gap banner → prefilled manual entry

**Files:**
- Modify: `src/screens/NarudzbeScreen.tsx` (load gaps, render banner, open `DodajRacunDialog` with `prefillBroj`)

**Interfaces:**
- Consumes: `window.api.getFiscalGaps`, `dismissFiscalGap` (Task 5), `DodajRacunDialog.prefillBroj` (Task 7).

- [ ] **Step 1: Load gaps and add prefill state**

Near the other `useState` calls (around line 32 where `dodajOpen` is declared), add:

```ts
  const [gaps, setGaps] = useState<number[]>([]);
  const [prefillBroj, setPrefillBroj] = useState<string | undefined>(undefined);
```

In the existing `useEffect`/`loadOrders` area (line 34-40), also load gaps:

```ts
  const loadGaps = async () => {
    setGaps(await window.api.getFiscalGaps());
  };
```

Call `loadGaps()` inside the initial `useEffect` (alongside `loadOrders()`), and after a successful manual save.

- [ ] **Step 2: Render the banner**

Above the orders table (near the header block around line 176-181), add:

```tsx
      {gaps.length > 0 && (
        <div className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            Nedostaju fiskalni brojevi u nizu — mogući neupisani računi:
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {gaps.map(n => (
              <div key={n} className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  className="h-7 text-amber-700 border-amber-400"
                  onClick={() => { setPrefillBroj(String(n)); setDodajOpen(true); }}
                >
                  Unesi #{n}
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 text-slate-400"
                  onClick={async () => { await window.api.dismissFiscalGap(n); loadGaps(); }}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 3: Pass `prefillBroj` to the dialog and refresh gaps on save**

Find the existing `<DodajRacunDialog ... />` usage (around line 658) and add the `prefillBroj` prop plus clear it + reload gaps on save/close:

```tsx
      <DodajRacunDialog
        open={dodajOpen}
        onOpenChange={(v) => { setDodajOpen(v); if (!v) setPrefillBroj(undefined); }}
        korisnikId={korisnikId}
        prefillBroj={prefillBroj}
        onSaved={() => { loadOrders(); loadGaps(); setPrefillBroj(undefined); }}
      />
```

(Adjust to match the existing prop names already passed; only add `prefillBroj` and the `loadGaps()`/reset wiring.)

- [ ] **Step 4: Verify the banner + prefill flow**

Run: `bun run start`. Create a gap: ring up sales so recorded fiscal numbers skip one (e.g. via the mock server incrementing, or manually enter two manual receipts with numbers `5` and `7`). Open Narudžbe.
Expected: a banner lists `#6`. Clicking "Unesi #6" opens the manual-entry dialog with `6` prefilled. Saving it makes the banner entry disappear. The `×` dismiss also removes it (and it stays gone after reload).

- [ ] **Step 5: Commit**

```bash
git add src/screens/NarudzbeScreen.tsx
git commit -m "feat(narudzbe): fiscal-gap banner opens prefilled manual entry"
```

---

## Self-Review Notes

- **Spec coverage:** Layer 1 write-ahead → Tasks 2, 3, 6, 8. Layer 2 gap detection → Tasks 1, 4, 9. Blocking startup modal → Task 8. Banner→prefill manual entry → Tasks 7, 9. Dismissible gaps (`settings.fiscal.dismissedGaps`) → Task 4. Testing (pure-function units + mock-server integration) → Task 1 unit tests + Tasks 3/6/8/9 manual verifications.
- **Type consistency:** `insertCompletedOrder`, `buildTringRacun`, `parseFiskalniBroj`, `izracunajPraznine`, and the `finalizeOrder`/`listPending`/`resolvePending`/`discardPending`/`getFiscalGaps`/`dismissFiscalGap` bridges use identical names across producer and consumer tasks.
- **Known limitation (accepted):** handlers depend on Electron `app` (via `db.ts`), so they aren't unit-tested in isolation — verification is through the Tring mock server, matching the existing test posture. Only pure `src/lib` logic gets `bun test` coverage.
