# Nivelacija (Price Adjustment) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a primka (goods receipt) contains products with different selling prices than existing stock, automatically create a Nivelacija document, update product prices, and provide a printable PDF record — as required by Bosnian fiscal law.

**Architecture:** Nivelacija is created transactionally during primka save. The `primka:create` and `primka:update` IPC handlers detect price differences, create nivelacija records, and update `products.cijena`. A new tab in IzvjestajiScreen displays nivelacija history. A `NivelacijaPdf` component (following the `UlazPdf` pattern) generates the legal document.

**Tech Stack:** SQLite (better-sqlite3), React, @react-pdf/renderer, ShadCN UI, Electron IPC

---

### Task 1: Database Schema — New Tables

**Files:**
- Modify: `src/database/schema.ts`

**Step 1: Add nivelacije and nivelacija_stavke tables to schema**

Add after the `settings` table and before the `CREATE INDEX` statements in the schema string:

```typescript
CREATE TABLE IF NOT EXISTS nivelacije (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brojNivelacije TEXT NOT NULL UNIQUE,
  datum TEXT NOT NULL,
  primkaId INTEGER,
  napomena TEXT,
  createdAt TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (primkaId) REFERENCES primke(id)
);

CREATE TABLE IF NOT EXISTS nivelacija_stavke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nivelacijaId INTEGER NOT NULL,
  productId INTEGER NOT NULL,
  kolicina REAL NOT NULL,
  staraCijena REAL NOT NULL,
  novaCijena REAL NOT NULL,
  razlika REAL NOT NULL,
  ukupnaRazlika REAL NOT NULL,
  pdvStopa TEXT NOT NULL,
  FOREIGN KEY (nivelacijaId) REFERENCES nivelacije(id),
  FOREIGN KEY (productId) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_nivelacija_stavke_nivelacijaId ON nivelacija_stavke(nivelacijaId);
```

**Step 2: Verify the app starts without errors**

Run: `bun run start` (or the dev command)
Expected: App starts, new tables are created automatically via `CREATE TABLE IF NOT EXISTS`.

**Step 3: Commit**

```bash
git add src/database/schema.ts
git commit -m "feat: add nivelacije and nivelacija_stavke tables to schema"
```

---

### Task 2: TypeScript Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Add Nivelacija and NivelacijaStavka interfaces**

Add at the end of `src/types.ts`:

```typescript
export interface NivelacijaStavka {
  id: number;
  nivelacijaId: number;
  productId: number;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  razlika: number;
  ukupnaRazlika: number;
  pdvStopa: string;
  productNaziv?: string;
  productSifra?: string;
  productJm?: string;
}

export interface Nivelacija {
  id: number;
  brojNivelacije: string;
  datum: string;
  primkaId: number | null;
  napomena: string | null;
  createdAt: string;
  stavke?: NivelacijaStavka[];
  primkaBroj?: string;
  stavkiCount?: number;
  ukupnaRazlika?: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Nivelacija and NivelacijaStavka types"
```

---

### Task 3: IPC Handlers — Nivelacija Logic in Primka Save

**Files:**
- Modify: `src/ipc/handlers.ts`

This is the core task. We modify `primka:create` and `primka:update` to detect price differences and create nivelacija records. We also add read-only handlers for the reports tab.

**Step 1: Add helper — next nivelacija number**

Add inside `registerIpcHandlers()`, near the `primka:nextBroj` handler:

```typescript
function getNextBrojNivelacije(): string {
  const year = new Date().getFullYear();
  const prefix = `NIV-${year}-`;
  const row = db.prepare(
    "SELECT MAX(CAST(SUBSTR(brojNivelacije, ?) AS INTEGER)) AS maxNum FROM nivelacije WHERE brojNivelacije LIKE ?"
  ).get(prefix.length + 1, `${prefix}%`) as { maxNum: number | null } | undefined;
  const next = (row?.maxNum ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
```

**Step 2: Add helper — get current stock for a product**

```typescript
function getProductStock(productId: number): number {
  const row = db.prepare(`
    SELECT COALESCE(
      SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
    ) AS stanje
    FROM stock_movements WHERE productId = ?
  `).get(productId) as { stanje: number };
  return row.stanje;
}
```

**Step 3: Add nivelacija creation helper**

This function is called within the primka save transaction when price differences are detected:

```typescript
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
```

**Step 4: Modify `primka:create` handler**

Replace the existing `primka:create` handler. The key change: after inserting stavke and stock movements, check for price differences and create nivelacija if needed.

Find the existing `handle('primka:create', ...)` block (lines ~293-322 of handlers.ts) and replace the transaction body:

```typescript
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

    // Detect price differences before inserting (compare against current products.cijena)
    const priceDiffs: Array<{
      productId: number; kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string;
    }> = [];

    for (const stavka of data.stavke) {
      insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
      insertStock.run(stavka.productId, stavka.kolicina, primkaId);

      // Check if selling price changed
      const product = db.prepare('SELECT cijena FROM products WHERE id = ?').get(stavka.productId) as { cijena: number } | undefined;
      if (product && Math.abs(product.cijena - stavka.cijena) > 0.001) {
        const existingStock = getProductStock(stavka.productId);
        // Stock at time of nivelacija = existing stock (before this primka's stock was just added above)
        // We use existingStock which already includes this primka's ulaz since insertStock ran
        // Actually: stock_movements for this primka were already inserted, so existingStock includes the new qty.
        // The nivelacija kolicina should be the stock BEFORE the new ulaz:
        const stockBeforeUlaz = existingStock - stavka.kolicina;
        if (stockBeforeUlaz > 0) {
          priceDiffs.push({
            productId: stavka.productId,
            kolicina: stockBeforeUlaz,
            staraCijena: product.cijena,
            novaCijena: stavka.cijena,
            pdvStopa: stavka.pdvStopa,
          });
        }
      }
    }

    // Create nivelacija if there are price differences
    createNivelacijaInTransaction(primkaId, priceDiffs);

    return { id: primkaId, nivelpijaCreated: priceDiffs.length > 0 };
  });

  return createPrimka();
});
```

**Important note about kolicina:** The nivelacija records the existing stock at the *old* price (before the new delivery). The new delivery items come in at the new price. So `kolicina` in nivelacija_stavke = stock before this primka's ulaz.

**Step 5: Modify `primka:update` handler similarly**

Apply the same price-diff logic to `primka:update`. Since update deletes old stock movements and re-inserts, the logic is the same — check price diffs after re-inserting:

In the `primka:update` transaction, after the loop that re-inserts stavke and stock movements, add:

```typescript
// Detect price differences
const priceDiffs: Array<{
  productId: number; kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string;
}> = [];

for (const stavka of data.stavke) {
  const product = db.prepare('SELECT cijena FROM products WHERE id = ?').get(stavka.productId) as { cijena: number } | undefined;
  if (product && Math.abs(product.cijena - stavka.cijena) > 0.001) {
    const existingStock = getProductStock(stavka.productId);
    const stockBeforeUlaz = existingStock - stavka.kolicina;
    if (stockBeforeUlaz > 0) {
      priceDiffs.push({
        productId: stavka.productId,
        kolicina: stockBeforeUlaz,
        staraCijena: product.cijena,
        novaCijena: stavka.cijena,
        pdvStopa: stavka.pdvStopa,
      });
    }
  }
}

createNivelacijaInTransaction(data.id, priceDiffs);
```

**Step 6: Add nivelacija query handlers**

Add these handlers after the primka handlers section:

```typescript
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
```

**Step 7: Commit**

```bash
git add src/ipc/handlers.ts
git commit -m "feat: add nivelacija creation in primka save + query handlers"
```

---

### Task 4: Preload + Type Declarations

**Files:**
- Modify: `src/preload.ts`
- Modify: `src/global.d.ts`

**Step 1: Add IPC bridges in preload.ts**

Add in the Primke section or create a new Nivelacije section:

```typescript
// Nivelacije
getNivelacije: (from?: string, to?: string) => ipcRenderer.invoke('nivelacija:getAll', from, to),
getNivelacija: (id: number) => ipcRenderer.invoke('nivelacija:get', id),
```

**Step 2: Add type declarations in global.d.ts**

Add inside the `api` interface:

```typescript
getNivelacije: (from?: string, to?: string) => Promise<any[]>;
getNivelacija: (id: number) => Promise<any>;
```

**Step 3: Commit**

```bash
git add src/preload.ts src/global.d.ts
git commit -m "feat: add nivelacija IPC bridges and type declarations"
```

---

### Task 5: Nivelacija Confirmation Dialog in Primka Save

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx`

The NovaPrimkaDialog's `handleSave` function must check for price differences before saving. If differences exist, show a confirmation dialog listing affected products.

**Step 1: Add state for nivelacija confirmation**

Inside `NovaPrimkaDialog`, add state:

```typescript
const [nivelacijaItems, setNivelacijaItems] = useState<Array<{
  productId: number;
  productNaziv: string;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  razlika: number;
  ukupnaRazlika: number;
}>>([]);
const [showNivelacija, setShowNivelacija] = useState(false);
```

**Step 2: Modify handleSave to check prices first**

Replace the existing `handleSave` in `NovaPrimkaDialog`. Before calling `createPrimka`/`updatePrimka`, check for price differences:

```typescript
const handleSave = async () => {
  if (!brojPrimke) return;
  const validStavke = stavke.filter(
    (s) => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena,
  );
  if (validStavke.length === 0) return;

  // Check for price differences
  const diffs: typeof nivelacijaItems = [];
  for (const s of validStavke) {
    const product = products.find(p => p.id === s.productId);
    if (product && Math.abs(product.cijena - parseFloat(s.cijena)) > 0.001) {
      const existingStock = product.stanje ?? 0;
      if (existingStock > 0) {
        const razlika = parseFloat(s.cijena) - product.cijena;
        diffs.push({
          productId: product.id,
          productNaziv: product.naziv,
          kolicina: existingStock,
          staraCijena: product.cijena,
          novaCijena: parseFloat(s.cijena),
          razlika,
          ukupnaRazlika: razlika * existingStock,
        });
      }
    }
  }

  if (diffs.length > 0) {
    setNivelacijaItems(diffs);
    setShowNivelacija(true);
    return; // Wait for user confirmation
  }

  // No price differences — save normally
  await doSave();
};

const doSave = async () => {
  const validStavke = stavke.filter(
    (s) => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena,
  );
  setSaving(true);
  try {
    const payload = {
      ...(editPrimka ? { id: editPrimka.id } : {}),
      brojPrimke,
      datum: datum || undefined,
      dobavljacNaziv: dobavljacNaziv || undefined,
      dobavljacId: dobavljacId || undefined,
      dobavljacAdresa: dobavljacAdresa || undefined,
      brojFakture: brojFakture || undefined,
      napomena: napomena || undefined,
      stavke: validStavke.map((s) => ({
        productId: s.productId,
        kolicina: parseFloat(s.kolicina),
        nabavnaCijena: parseFloat(s.nabavnaCijena),
        rabat: parseFloat(s.rabat) || 0,
        cijena: parseFloat(s.cijena),
        pdvStopa: products.find(p => p.id === s.productId)?.pdvStopa ?? 'E',
      })),
    };

    if (editPrimka) {
      await window.api.updatePrimka(payload);
    } else {
      await window.api.createPrimka(payload);
    }
    onOpenChange(false);
    onSave();
  } catch (err: any) {
    console.error(err);
  } finally {
    setSaving(false);
  }
};
```

**Step 3: Add nivelacija confirmation dialog JSX**

Add inside the `NovaPrimkaDialog` return, after the main `Dialog`:

```tsx
{/* Nivelacija Confirmation Dialog */}
<Dialog open={showNivelacija} onOpenChange={setShowNivelacija}>
  <DialogContent className="sm:max-w-lg">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        Nivelacija cijena
      </DialogTitle>
      <DialogDescription>
        Sljedeći artikli imaju različitu prodajnu cijenu od trenutne. Sačuvanje primke će automatski kreirati nivelaciju i ažurirati cijene.
      </DialogDescription>
    </DialogHeader>

    <div className="max-h-[300px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b">
            <th className="text-left py-2">Artikal</th>
            <th className="text-right py-2">Kol.</th>
            <th className="text-right py-2">Stara</th>
            <th className="text-right py-2">Nova</th>
            <th className="text-right py-2">Razlika</th>
          </tr>
        </thead>
        <tbody>
          {nivelacijaItems.map((item) => (
            <tr key={item.productId} className="border-b border-slate-50">
              <td className="py-2 text-sm">{item.productNaziv}</td>
              <td className="py-2 text-right font-mono text-sm">{item.kolicina}</td>
              <td className="py-2 text-right font-mono text-sm">{formatKM(item.staraCijena)}</td>
              <td className="py-2 text-right font-mono text-sm">{formatKM(item.novaCijena)}</td>
              <td className={cn(
                "py-2 text-right font-mono text-sm font-medium",
                item.ukupnaRazlika > 0 ? "text-emerald-600" : "text-red-500"
              )}>
                {item.ukupnaRazlika > 0 ? '+' : ''}{formatKM(item.ukupnaRazlika)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td colSpan={4} className="py-2 text-sm font-semibold">Ukupna razlika</td>
            <td className={cn(
              "py-2 text-right font-mono text-sm font-bold",
              nivelacijaItems.reduce((s, i) => s + i.ukupnaRazlika, 0) > 0 ? "text-emerald-600" : "text-red-500"
            )}>
              {formatKM(nivelacijaItems.reduce((s, i) => s + i.ukupnaRazlika, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setShowNivelacija(false)}>
        Otkaži
      </Button>
      <Button
        onClick={() => {
          setShowNivelacija(false);
          doSave();
        }}
      >
        Sačuvaj sa nivelacijom
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Note:** You'll need to import `AlertTriangle` from lucide-react (already imported in the file).

**Step 4: Verify the primka save flow**

Run the app. Create a product, create a primka with that product. Then create a second primka for the same product with a different selling price. The confirmation dialog should appear.

**Step 5: Commit**

```bash
git add src/screens/SkladisteScreen.tsx
git commit -m "feat: add nivelacija confirmation dialog to primka save flow"
```

---

### Task 6: Nivelacije Tab in IzvjestajiScreen

**Files:**
- Modify: `src/screens/IzvjestajiScreen.tsx`

**Step 1: Add 'nivelacije' to the Tab type and tabs array**

Change `type Tab = 'promet' | 'primke' | 'fiskalni';` to:

```typescript
type Tab = 'promet' | 'primke' | 'nivelacije' | 'fiskalni';
```

Add to the `tabs` array (before fiskalni):

```typescript
{ id: 'nivelacije', label: 'Nivelacije', icon: FileText },
```

Import `Nivelacija` from `@/types`.

**Step 2: Add nivelacije state and loader**

```typescript
const [nivelacijeData, setNivelacijeData] = useState<Nivelacija[]>([]);
const [nivelacijeLoading, setNivelacijeLoading] = useState(false);
const [expandedNivId, setExpandedNivId] = useState<number | null>(null);
const [expandedNivStavke, setExpandedNivStavke] = useState<any[]>([]);

const loadNivelacije = async () => {
  setNivelacijeLoading(true);
  try {
    const data = await window.api.getNivelacije(toDateStr(dateFrom), toDateStr(dateTo));
    setNivelacijeData(data);
  } catch (err) {
    console.error('Nivelacije load error:', err);
  } finally {
    setNivelacijeLoading(false);
  }
};

const loadNivelacijaDetail = async (id: number) => {
  if (expandedNivId === id) {
    setExpandedNivId(null);
    return;
  }
  try {
    const niv = await window.api.getNivelacija(id);
    setExpandedNivStavke(niv.stavke || []);
    setExpandedNivId(id);
  } catch (err) {
    console.error('Nivelacija detail error:', err);
  }
};
```

**Step 3: Update the "Generiši" button logic**

In the button's `onClick` and `disabled` props, add nivelacije tab handling. Change:

```typescript
{activeTab !== 'fiskalni' && (
```

to:

```typescript
{(activeTab === 'promet' || activeTab === 'primke' || activeTab === 'nivelacije') && (
```

And update the onClick:

```typescript
onClick={activeTab === 'promet' ? loadPromet : activeTab === 'primke' ? loadPrimke : loadNivelacije}
disabled={activeTab === 'promet' ? prometLoading : activeTab === 'primke' ? primkeLoading : nivelacijeLoading}
```

**Step 4: Add Nivelacije tab content**

Add after the `{/* ═══ PRIMKE TAB ═══ */}` section close and before `{/* ═══ FISKALNI TAB ═══ */}`:

```tsx
{/* ═══ NIVELACIJE TAB ═══ */}
{activeTab === 'nivelacije' && (
  <div className="flex flex-col h-full">
    {/* Summary cards */}
    <div className="flex-shrink-0 px-6 pt-5 pb-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Broj nivelacija</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <FileText size={16} className="text-blue-500" />
            </div>
          </div>
          <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
            {nivelacijeData.length}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Pozitivna razlika</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <ArrowUpRight size={16} className="text-emerald-500" />
            </div>
          </div>
          <p className="text-[22px] font-bold font-mono tracking-tight text-emerald-600 leading-none">
            {formatKM(nivelacijeData.filter(n => (n.ukupnaRazlika ?? 0) > 0).reduce((s, n) => s + (n.ukupnaRazlika ?? 0), 0))}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Negativna razlika</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <ArrowDownRight size={16} className="text-red-500" />
            </div>
          </div>
          <p className="text-[22px] font-bold font-mono tracking-tight text-red-500 leading-none">
            {formatKM(nivelacijeData.filter(n => (n.ukupnaRazlika ?? 0) < 0).reduce((s, n) => s + (n.ukupnaRazlika ?? 0), 0))}
          </p>
        </div>
      </div>
    </div>

    {/* Table */}
    <div className="flex-1 min-h-0 px-6 pb-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-700">Nivelacije</span>
            {nivelacijeData.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                {nivelacijeData.length}
              </Badge>
            )}
          </div>
        </div>

        {nivelacijeData.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
              <FileText size={24} className="text-slate-300" />
            </div>
            <p className="text-[13px] font-medium text-slate-500">Nema podataka</p>
            <p className="text-[12px] text-slate-400 mt-0.5">Odaberite period i kliknite Generiši</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="text-left pl-5 pr-2 py-2.5">Broj</th>
                  <th className="text-left px-2 py-2.5">Datum</th>
                  <th className="text-left px-2 py-2.5">Primka</th>
                  <th className="text-right px-2 py-2.5">Stavki</th>
                  <th className="text-right pr-5 pl-2 py-2.5">Ukupna razlika</th>
                </tr>
              </thead>
              <tbody>
                {nivelacijeData.map((niv) => (
                  <React.Fragment key={niv.id}>
                    <tr
                      className="border-t border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => loadNivelacijaDetail(niv.id)}
                    >
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono font-semibold text-slate-700">
                        {niv.brojNivelacije}
                      </td>
                      <td className="px-2 py-2.5 text-[12px] tabular-nums text-slate-600">
                        {formatDate(niv.datum)}
                      </td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-slate-500">
                        {niv.primkaBroj || '—'}
                      </td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-right tabular-nums text-slate-500">
                        {niv.stavkiCount ?? 0}
                      </td>
                      <td className={cn(
                        "pr-5 pl-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums",
                        (niv.ukupnaRazlika ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'
                      )}>
                        {(niv.ukupnaRazlika ?? 0) >= 0 ? '+' : ''}{formatKM(niv.ukupnaRazlika ?? 0)}
                      </td>
                    </tr>
                    {/* Expanded detail */}
                    {expandedNivId === niv.id && (
                      <tr>
                        <td colSpan={5} className="px-5 py-3 bg-slate-50/50">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="text-[10px] text-slate-400 uppercase">
                                <th className="text-left py-1">Artikal</th>
                                <th className="text-right py-1">Količina</th>
                                <th className="text-right py-1">Stara cijena</th>
                                <th className="text-right py-1">Nova cijena</th>
                                <th className="text-right py-1">Razlika/jed</th>
                                <th className="text-right py-1">Ukupna razlika</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedNivStavke.map((s: any) => (
                                <tr key={s.id} className="border-t border-slate-100">
                                  <td className="py-1.5 text-slate-700">{s.productNaziv}</td>
                                  <td className="py-1.5 text-right font-mono text-slate-500">{s.kolicina}</td>
                                  <td className="py-1.5 text-right font-mono text-slate-500">{formatKM(s.staraCijena)}</td>
                                  <td className="py-1.5 text-right font-mono text-slate-700">{formatKM(s.novaCijena)}</td>
                                  <td className={cn(
                                    "py-1.5 text-right font-mono",
                                    s.razlika >= 0 ? 'text-emerald-600' : 'text-red-500'
                                  )}>
                                    {s.razlika >= 0 ? '+' : ''}{formatKM(s.razlika)}
                                  </td>
                                  <td className={cn(
                                    "py-1.5 text-right font-mono font-medium",
                                    s.ukupnaRazlika >= 0 ? 'text-emerald-600' : 'text-red-500'
                                  )}>
                                    {s.ukupnaRazlika >= 0 ? '+' : ''}{formatKM(s.ukupnaRazlika)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </div>
  </div>
)}
```

**Step 5: Add `React` import if not present**

The file uses `<React.Fragment>`, so ensure `import React from 'react'` or that JSX Fragment shorthand `<>` is used instead.

**Step 6: Verify**

Run the app, go to Izvještaji, confirm the Nivelacije tab appears and loads data.

**Step 7: Commit**

```bash
git add src/screens/IzvjestajiScreen.tsx
git commit -m "feat: add Nivelacije tab to IzvjestajiScreen"
```

---

### Task 7: NivelacijaPdf Component

**Files:**
- Create: `src/components/NivelacijaPdf.tsx`

Follow the `UlazPdf.tsx` pattern: `@react-pdf/renderer` Document/Page/View/Text, same font imports, A4 portrait.

**Step 1: Create the PDF component**

```tsx
import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { Nivelacija, NivelacijaStavka } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';

export interface NivelacijaPdfProps {
  nivelacija: Nivelacija;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    skladiste: string;
    logo: string;
  };
}

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

const s = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    fontFamily: F,
    fontSize: 8,
    color: '#000',
  },
  title: {
    fontSize: 12,
    fontFamily: FB,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    textAlign: 'center',
    marginBottom: 16,
  },
  headerGrid: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 20,
  },
  headerCol: {
    width: '50%',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  fieldLabel: {
    fontSize: 7,
    color: '#555',
    width: 100,
  },
  fieldValue: {
    fontSize: 8,
    fontFamily: FB,
    fontWeight: 700,
    flex: 1,
  },
  table: {
    marginBottom: 16,
  },
  tHeadRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tHeadCell: {
    fontSize: 6.5,
    fontFamily: FB,
    fontWeight: 700,
    padding: 3,
    borderRight: '0.5pt solid #999',
    textAlign: 'center',
  },
  tRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #ccc',
  },
  tCell: {
    fontSize: 7.5,
    padding: 3,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'right',
  },
  tCellLeft: {
    fontSize: 7.5,
    padding: 3,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'left',
  },
  tTotalRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tTotalCell: {
    fontSize: 7.5,
    fontFamily: FB,
    fontWeight: 700,
    padding: 3,
    borderRight: '0.5pt solid #999',
    textAlign: 'right',
  },
  /* Column widths — 9 columns */
  cRb:     { width: '4%' },
  cSifra:  { width: '8%' },
  cNaziv:  { width: '24%' },
  cJm:     { width: '5%' },
  cKol:    { width: '9%' },
  cStara:  { width: '13%' },
  cNova:   { width: '13%' },
  cRazJed: { width: '12%' },
  cRazUk:  { width: '12%', borderRight: 'none' },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  summaryTable: {
    width: '45%',
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottom: '0.5pt solid #eee',
  },
  summaryLineBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderTop: '1pt solid #000',
    marginTop: 2,
  },
  summaryLabel: { fontSize: 8 },
  summaryValue: { fontSize: 8, fontFamily: FB, fontWeight: 700, textAlign: 'right' },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 40,
  },
  signatureBlock: {
    width: 180,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 8,
    marginBottom: 24,
  },
  signatureLine: {
    borderTop: '0.5pt solid #000',
    width: '100%',
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 6.5,
    color: '#999',
  },
});

export function NivelacijaPdf({ nivelacija, firma }: NivelacijaPdfProps) {
  const stavke = nivelacija.stavke ?? [];

  const totPozitivna = stavke.filter(s => s.ukupnaRazlika > 0).reduce((a, s) => a + s.ukupnaRazlika, 0);
  const totNegativna = stavke.filter(s => s.ukupnaRazlika < 0).reduce((a, s) => a + s.ukupnaRazlika, 0);
  const totRazlika = stavke.reduce((a, s) => a + s.ukupnaRazlika, 0);

  // PDV on the difference (17% items only)
  const pdvNaRazliku = stavke
    .filter(st => st.pdvStopa === 'E')
    .reduce((a, st) => a + st.ukupnaRazlika, 0) * 17 / 117;

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        <Text style={s.title}>ZAPISNIK O PROMJENI CIJENA (NIVELACIJA)</Text>
        <Text style={s.subtitle}>Broj: {nivelacija.brojNivelacije}</Text>

        <View style={s.headerGrid}>
          <View style={s.headerCol}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Firma:</Text>
              <Text style={s.fieldValue}>{firma.naziv}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Adresa:</Text>
              <Text style={s.fieldValue}>{firma.adresa}, {firma.grad}</Text>
            </View>
            {firma.idBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>ID broj:</Text>
                <Text style={s.fieldValue}>{firma.idBroj}</Text>
              </View>
            ) : null}
            {firma.pdvBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>PDV broj:</Text>
                <Text style={s.fieldValue}>{firma.pdvBroj}</Text>
              </View>
            ) : null}
          </View>
          <View style={s.headerCol}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Datum:</Text>
              <Text style={s.fieldValue}>{nivelacija.datum}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Prodajni objekt:</Text>
              <Text style={s.fieldValue}>{firma.skladiste || 'Glavna prodavnica'}</Text>
            </View>
            {nivelacija.primkaBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>Vezana primka:</Text>
                <Text style={s.fieldValue}>{nivelacija.primkaBroj}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.cRb]}>Rb</Text>
            <Text style={[s.tHeadCell, s.cSifra]}>Šifra</Text>
            <Text style={[s.tHeadCell, s.cNaziv]}>Naziv</Text>
            <Text style={[s.tHeadCell, s.cJm]}>JM</Text>
            <Text style={[s.tHeadCell, s.cKol]}>Količina</Text>
            <Text style={[s.tHeadCell, s.cStara]}>Stara cijena</Text>
            <Text style={[s.tHeadCell, s.cNova]}>Nova cijena</Text>
            <Text style={[s.tHeadCell, s.cRazJed]}>Razlika/jed</Text>
            <Text style={[s.tHeadCell, s.cRazUk, { borderRight: 'none' }]}>Ukup. razlika</Text>
          </View>

          {stavke.map((st, i) => (
            <View key={st.id} style={s.tRow}>
              <Text style={[s.tCell, s.cRb, { textAlign: 'center' }]}>{i + 1}</Text>
              <Text style={[s.tCellLeft, s.cSifra]}>{st.productSifra ?? ''}</Text>
              <Text style={[s.tCellLeft, s.cNaziv]}>{st.productNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.cJm, { textAlign: 'center' }]}>{st.productJm ?? ''}</Text>
              <Text style={[s.tCell, s.cKol]}>{fmt(st.kolicina)}</Text>
              <Text style={[s.tCell, s.cStara]}>{fmt(st.staraCijena)}</Text>
              <Text style={[s.tCell, s.cNova]}>{fmt(st.novaCijena)}</Text>
              <Text style={[s.tCell, s.cRazJed]}>{fmt(st.razlika)}</Text>
              <Text style={[s.tCell, s.cRazUk, { borderRight: 'none' }]}>{fmt(st.ukupnaRazlika)}</Text>
            </View>
          ))}

          <View style={s.tTotalRow}>
            <Text style={[s.tTotalCell, s.cRb]} />
            <Text style={[s.tTotalCell, s.cSifra]} />
            <Text style={[s.tTotalCell, s.cNaziv]} />
            <Text style={[s.tTotalCell, s.cJm]} />
            <Text style={[s.tTotalCell, s.cKol]} />
            <Text style={[s.tTotalCell, s.cStara]} />
            <Text style={[s.tTotalCell, s.cNova]} />
            <Text style={[s.tTotalCell, s.cRazJed]}>UKUPNO:</Text>
            <Text style={[s.tTotalCell, s.cRazUk, { borderRight: 'none' }]}>{fmt(totRazlika)}</Text>
          </View>
        </View>

        {/* Summary */}
        <View style={s.summaryRow}>
          <View style={s.summaryTable}>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna pozitivna razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totPozitivna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna negativna razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totNegativna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>PDV na razliku (17%):</Text>
              <Text style={s.summaryValue}>{fmt(pdvNaRazliku)} KM</Text>
            </View>
            <View style={s.summaryLineBold}>
              <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Neto razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totRazlika)} KM</Text>
            </View>
          </View>
        </View>

        {/* Signature */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Potpis ovlaštenog lica:</Text>
            <View style={s.signatureLine} />
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text>{firma.naziv} | {firma.adresa}, {firma.grad}</Text>
          <Text>Generisano: {today}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/NivelacijaPdf.tsx
git commit -m "feat: add NivelacijaPdf component for legal price adjustment document"
```

---

### Task 8: PDF Export Button in IzvjestajiScreen

**Files:**
- Modify: `src/screens/IzvjestajiScreen.tsx`

**Step 1: Add PDF export function**

Import `pdf` from `@react-pdf/renderer` and `NivelacijaPdf` from `@/components/NivelacijaPdf`. Add firma settings state and export function:

```typescript
import { pdf } from '@react-pdf/renderer';
import { NivelacijaPdf } from '@/components/NivelacijaPdf';

// Inside the component:
const [firma, setFirma] = useState<any>(null);

useEffect(() => {
  window.api.getFirmaSettings().then(setFirma);
}, []);

const exportNivelacijaPdf = async (nivId: number) => {
  if (!firma) return;
  try {
    const niv = await window.api.getNivelacija(nivId);
    const blob = await pdf(<NivelacijaPdf nivelacija={niv} firma={firma} />).toBlob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const path = await window.api.showSaveDialog({
      defaultName: `${niv.brojNivelacije}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (path) {
      await window.api.writeFile(path, buffer);
    }
  } catch (err) {
    console.error('PDF export error:', err);
  }
};
```

**Step 2: Add export button in the expanded nivelacija row**

In the expanded detail section, add a download button after the detail table:

```tsx
<div className="flex justify-end mt-2">
  <Button
    variant="outline"
    size="sm"
    className="h-7 gap-1.5 text-[12px]"
    onClick={(e) => {
      e.stopPropagation();
      exportNivelacijaPdf(niv.id);
    }}
  >
    <Download size={13} />
    Exportuj PDF
  </Button>
</div>
```

Import `Download` from `lucide-react` (already imported in the file).

**Step 3: Verify PDF export**

Run the app. Create a nivelacija (by saving a primka with a price difference). Go to Izvještaji → Nivelacije, expand a row, click Export PDF. Verify the PDF generates correctly.

**Step 4: Commit**

```bash
git add src/screens/IzvjestajiScreen.tsx
git commit -m "feat: add nivelacija PDF export in IzvjestajiScreen"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/database/schema.ts` | Add `nivelacije` and `nivelacija_stavke` tables |
| `src/types.ts` | Add `Nivelacija` and `NivelacijaStavka` interfaces |
| `src/ipc/handlers.ts` | Price-diff detection in `primka:create`/`primka:update`, nivelacija creation in transaction, `nivelacija:getAll`/`nivelacija:get` handlers |
| `src/preload.ts` | Add `getNivelacije`/`getNivelacija` IPC bridges |
| `src/global.d.ts` | Add type declarations for new IPC methods |
| `src/screens/SkladisteScreen.tsx` | Nivelacija confirmation dialog in primka save flow |
| `src/screens/IzvjestajiScreen.tsx` | New "Nivelacije" tab with table, expanded detail, PDF export |
| `src/components/NivelacijaPdf.tsx` | New PDF component for Zapisnik o promjeni cijena |
