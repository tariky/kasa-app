# Ručni unos fiskalnog računa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodati opciju za ručni unos fiskalnog računa (koji je isprintan ali nije spremljen zbog crasha) u bazu, bez štampanja na Tring uređaj.

**Architecture:** Nova SQLite kolona `isManual` na `orders`; novi IPC handler `order:createManual` koji prima gotov fiskalni broj + datum sa računa, provjerava duplikat, i piše order + order_items + stock_movements u jednoj transakciji; novi React dijalog `DodajRacunDialog` u `NarudzbeScreen`. Kalkulacija ukupno/PDV se izdvaja u čisti helper koji dijele KasaScreen i novi dijalog.

**Tech Stack:** Electron Forge, React, TypeScript, ShadCN UI, better-sqlite3, bun test (za čisti helper).

## Global Constraints

- **Fiskalni broj se NE generiše** — unosi ga korisnik sa papirnog računa.
- **Tring se NE poziva** kod ručnog unosa.
- `nacinPlacanja` je običan string: `'Gotovina' | 'Kartica' | 'Virman' | 'Ček'`.
- `pdvStopa` je `'E'` (17%) ili `'K'` (0%). PDV se računa samo za `'E'`: `itemTotal - itemTotal / 1.17`.
- `createdAt` u bazi je format `YYYY-MM-DD HH:MM:SS` (localtime).
- Zalihe: ručni unos **uvijek** kreira `stock_movements` 'izlaz' za ne-usluge (isto kao normalni `order:create`).
- Svi tekstovi UI-a na bosanskom, prate postojeći stil ekrana.

---

### Task 1: Izdvojiti i testirati helper za totale računa

Trenutno `KasaScreen.tsx:128-135` inline računa `subtotal`/`pdvAmount`. Novi dijalog treba istu logiku → izdvajamo u čisti helper i pišemo bun test.

**Files:**
- Create: `src/lib/racun.ts`
- Test: `src/lib/racun.test.ts`
- Modify: `src/screens/KasaScreen.tsx:128-135`

**Interfaces:**
- Produces: `izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number }` gdje
  `RacunStavka = { cijena: number; kolicina: number; rabat: number; pdvStopa: string }`.
  `rabat` je postotak (0–100). `ukupno` = suma `cijena*kolicina*(1-rabat/100)`.
  `pdvIznos` = suma po stavci samo za `pdvStopa === 'E'`: `itemTotal - itemTotal/1.17`.

- [ ] **Step 1: Napiši failing test**

```ts
// src/lib/racun.test.ts
import { test, expect } from 'bun:test';
import { izracunajTotale } from './racun';

test('sabira ukupno preko stavki sa rabatom', () => {
  const { ukupno } = izracunajTotale([
    { cijena: 100, kolicina: 2, rabat: 0, pdvStopa: 'E' },
    { cijena: 50, kolicina: 1, rabat: 10, pdvStopa: 'K' },
  ]);
  expect(ukupno).toBeCloseTo(245, 2); // 200 + 45
});

test('PDV samo za E stavke (17% uračunat u cijenu)', () => {
  const { pdvIznos } = izracunajTotale([
    { cijena: 117, kolicina: 1, rabat: 0, pdvStopa: 'E' },
    { cijena: 100, kolicina: 1, rabat: 0, pdvStopa: 'K' },
  ]);
  expect(pdvIznos).toBeCloseTo(17, 2); // 117 - 117/1.17 = 17; K stavka ne doprinosi
});

test('prazna lista daje nule', () => {
  expect(izracunajTotale([])).toEqual({ ukupno: 0, pdvIznos: 0 });
});
```

- [ ] **Step 2: Pokreni test — mora pasti**

Run: `bun test src/lib/racun.test.ts`
Expected: FAIL — `Cannot find module './racun'` / `izracunajTotale is not a function`.

- [ ] **Step 3: Implementiraj helper**

```ts
// src/lib/racun.ts
export interface RacunStavka {
  cijena: number;
  kolicina: number;
  rabat: number; // postotak 0–100
  pdvStopa: string; // 'E' | 'K'
}

export function izracunajTotale(stavke: RacunStavka[]): { ukupno: number; pdvIznos: number } {
  const ukupno = stavke.reduce(
    (sum, s) => sum + s.cijena * s.kolicina * (1 - s.rabat / 100),
    0
  );
  const pdvIznos = stavke.reduce((sum, s) => {
    if (s.pdvStopa !== 'E') return sum;
    const itemTotal = s.cijena * s.kolicina * (1 - s.rabat / 100);
    return sum + (itemTotal - itemTotal / 1.17);
  }, 0);
  return { ukupno, pdvIznos };
}
```

- [ ] **Step 4: Pokreni test — mora proći**

Run: `bun test src/lib/racun.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Refaktoriši KasaScreen da koristi helper**

U `src/screens/KasaScreen.tsx` dodaj import na vrh (uz ostale importe):

```ts
import { izracunajTotale } from '@/lib/racun';
```

Zamijeni blok `src/screens/KasaScreen.tsx:128-135` sa:

```ts
  // Cart calculations
  const { ukupno: subtotal, pdvIznos: pdvAmount } = izracunajTotale(
    cart.map(item => ({
      cijena: item.product.cijena,
      kolicina: item.kolicina,
      rabat: item.rabat,
      pdvStopa: item.product.pdvStopa,
    }))
  );
  const total = subtotal;
  const itemCount = cart.reduce((sum, item) => sum + item.kolicina, 0);
```

- [ ] **Step 6: Provjeri da renderer build prolazi (typecheck)**

Run: `bun run lint`
Expected: nema novih grešaka vezanih za `KasaScreen.tsx` / `racun.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/racun.ts src/lib/racun.test.ts src/screens/KasaScreen.tsx
git commit -m "refactor(racun): extract izracunajTotale helper with tests"
```

---

### Task 2: Perzistencija `isManual` (schema + migracija + tip)

**Files:**
- Modify: `src/database/schema.ts:72-88` (orders CREATE TABLE)
- Modify: `src/database/db.ts:88-96` (runMigrations — dodati ALTER)
- Modify: `src/types.ts:62-79` (Order interface)

**Interfaces:**
- Produces: kolona `orders.isManual INTEGER NOT NULL DEFAULT 0`; polje `Order.isManual?: boolean`.

- [ ] **Step 1: Dodaj kolonu u schema.ts**

U `src/database/schema.ts`, u `CREATE TABLE IF NOT EXISTS orders (...)`, dodaj kolonu odmah nakon `kupacPostanskiBroj TEXT,` (linija ~85):

```sql
    kupacPostanskiBroj TEXT,
    isManual INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
```

- [ ] **Step 2: Dodaj migraciju u db.ts**

U `src/database/db.ts`, unutar `runMigrations`, odmah nakon bloka koji dodaje kupac kolone (nakon linije ~96, poslije zatvaranja `if (!orderCols.find(c => c.name === 'kupacNaziv')) { ... }`), dodaj:

```ts
  if (!orderCols.find(c => c.name === 'isManual')) {
    database.exec("ALTER TABLE orders ADD COLUMN isManual INTEGER NOT NULL DEFAULT 0");
  }
```

Napomena: `orderCols` je već deklarisan iznad (linija ~89) — koristi postojeću varijablu, ne redeklariši.

- [ ] **Step 3: Dodaj polje u Order tip**

U `src/types.ts`, u `interface Order`, dodaj nakon `status` linije:

```ts
  status: 'completed' | 'refunded';
  isManual?: boolean;
```

- [ ] **Step 4: Provjeri typecheck**

Run: `bun run lint`
Expected: nema grešaka vezanih za izmijenjene fajlove.

- [ ] **Step 5: Commit**

```bash
git add src/database/schema.ts src/database/db.ts src/types.ts
git commit -m "feat(db): add isManual column to orders"
```

---

### Task 3: IPC handler `order:createManual` + preload

**Files:**
- Modify: `src/ipc/handlers.ts:631` (dodati handler odmah nakon `order:create`)
- Modify: `src/preload.ts:49` (dodati `createManualOrder`)

**Interfaces:**
- Consumes: `orders.isManual` kolona (Task 2).
- Produces:
  - IPC `order:createManual` prima:
    ```ts
    {
      korisnikId: number; ukupno: number; pdvIznos: number;
      nacinPlacanja: string; brojFiskalnogRacuna: string; createdAt: string;
      kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
      stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
    }
    ```
    Vraća `{ id: number }` na uspjeh; baca `Error('Fiskalni račun sa tim brojem već postoji')` ako duplikat.
  - preload: `createManualOrder(data): Promise<{ id: number }>`.

- [ ] **Step 1: Dodaj handler u handlers.ts**

U `src/ipc/handlers.ts`, odmah nakon zatvaranja `handle('order:create', ...)` (linija ~631, prije `handle('order:updateReklamacija', ...)`), dodaj:

```ts
  handle('order:createManual', (data: {
    korisnikId: number; ukupno: number; pdvIznos: number;
    nacinPlacanja: string; brojFiskalnogRacuna: string; createdAt: string;
    kupac?: { naziv?: string; idBroj?: string; adresa?: string; grad?: string; postanskiBroj?: string };
    stavke: Array<{ productId: number; kolicina: number; cijena: number; rabat: number; pdvStopa: string }>;
  }) => {
    if (!data.stavke || data.stavke.length === 0) throw new Error('Račun mora imati najmanje jednu stavku');
    if (!data.korisnikId) throw new Error('Korisnik nije prijavljen');
    if (!data.brojFiskalnogRacuna?.trim()) throw new Error('Fiskalni broj je obavezan');
    if (!data.createdAt?.trim()) throw new Error('Datum računa je obavezan');

    const existing = db
      .prepare('SELECT id FROM orders WHERE brojFiskalnogRacuna = ?')
      .get(data.brojFiskalnogRacuna.trim());
    if (existing) throw new Error('Fiskalni račun sa tim brojem već postoji');

    const createManual = db.transaction(() => {
      const result = db
        .prepare(`
          INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
            kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, createdAt)
          VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 1, ?)
        `)
        .run(
          data.korisnikId, data.ukupno, data.pdvIznos, data.nacinPlacanja, data.brojFiskalnogRacuna.trim(),
          data.kupac?.naziv || null, data.kupac?.idBroj || null, data.kupac?.adresa || null,
          data.kupac?.grad || null, data.kupac?.postanskiBroj || null, data.createdAt
        );

      const orderId = result.lastInsertRowid;

      const insertItem = db.prepare(
        'INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertStock = db.prepare(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, ?)"
      );

      for (const item of data.stavke) {
        insertItem.run(orderId, item.productId, item.kolicina, item.cijena, item.rabat, item.pdvStopa);
        const product = db.prepare('SELECT tip FROM products WHERE id = ?').get(item.productId) as { tip: string } | undefined;
        if (!product || product.tip !== 'usluga') {
          insertStock.run(item.productId, item.kolicina, orderId, data.createdAt);
        }
      }

      return { id: orderId };
    });

    return createManual();
  });
```

- [ ] **Step 2: Izloži u preload.ts**

U `src/preload.ts`, odmah nakon linije 49 (`createOrder: ...`), dodaj:

```ts
  createManualOrder: (data: any) => ipcRenderer.invoke('order:createManual', data),
```

- [ ] **Step 3: Provjeri typecheck**

Run: `bun run lint`
Expected: nema grešaka vezanih za `handlers.ts` / `preload.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/ipc/handlers.ts src/preload.ts
git commit -m "feat(ipc): add order:createManual handler with duplicate guard"
```

---

### Task 4: Komponenta `DodajRacunDialog`

Samostalna dijalog-komponenta: pretraga proizvoda, lista stavki, kupac (opciono), datum/vrijeme, fiskalni broj, način plaćanja. Totali preko `izracunajTotale`.

**Files:**
- Create: `src/components/DodajRacunDialog.tsx`

**Interfaces:**
- Consumes: `izracunajTotale` (Task 1), `window.api.searchProducts`, `window.api.createManualOrder` (Task 3).
- Produces: default export `DodajRacunDialog` sa props:
  ```ts
  { open: boolean; onOpenChange: (v: boolean) => void; korisnikId: number; onSaved: () => void }
  ```

- [ ] **Step 1: Napiši komponentu**

```tsx
// src/components/DodajRacunDialog.tsx
import { useState, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Search } from 'lucide-react';
import { Product } from '@/types';
import { izracunajTotale } from '@/lib/racun';
import { formatKM } from '@/lib/utils';

interface StavkaUnos {
  product: Product;
  kolicina: number;
  rabat: number;
}

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  korisnikId: number;
  onSaved: () => void;
}

function nowLocalInput(): string {
  // 'YYYY-MM-DDTHH:MM' za <input type="datetime-local">
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DodajRacunDialog({ open, onOpenChange, korisnikId, onSaved }: Props) {
  const [brojFiskalnog, setBrojFiskalnog] = useState('');
  const [datum, setDatum] = useState(nowLocalInput());
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Gotovina');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [stavke, setStavke] = useState<StavkaUnos[]>([]);
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { ukupno, pdvIznos } = useMemo(
    () => izracunajTotale(stavke.map(s => ({
      cijena: s.product.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
    }))),
    [stavke]
  );

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const found = await window.api.searchProducts(q);
    setResults(found);
  };

  const addProduct = (p: Product) => {
    setStavke(prev => {
      const existing = prev.find(s => s.product.id === p.id);
      if (existing) return prev.map(s => s.product.id === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      return [...prev, { product: p, kolicina: 1, rabat: 0 }];
    });
    setQuery(''); setResults([]);
  };

  const updateStavka = (id: number, patch: Partial<StavkaUnos>) => {
    setStavke(prev => prev.map(s => s.product.id === id ? { ...s, ...patch } : s));
  };
  const removeStavka = (id: number) => setStavke(prev => prev.filter(s => s.product.id !== id));

  const reset = () => {
    setBrojFiskalnog(''); setDatum(nowLocalInput()); setNacinPlacanja('Gotovina');
    setQuery(''); setResults([]); setStavke([]);
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setError('');
  };

  const handleSave = async () => {
    setError('');
    if (!brojFiskalnog.trim()) { setError('Unesi fiskalni broj računa'); return; }
    if (stavke.length === 0) { setError('Dodaj bar jednu stavku'); return; }
    if (!datum) { setError('Unesi datum i vrijeme računa'); return; }

    // 'YYYY-MM-DDTHH:MM' -> 'YYYY-MM-DD HH:MM:00'
    const createdAt = datum.replace('T', ' ') + ':00';
    const kupac = kupacIdBroj.trim()
      ? { idBroj: kupacIdBroj.trim(), naziv: kupacNaziv.trim(), adresa: kupacAdresa.trim(), grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim() }
      : undefined;

    setLoading(true);
    try {
      await window.api.createManualOrder({
        korisnikId, ukupno, pdvIznos, nacinPlacanja,
        brojFiskalnogRacuna: brojFiskalnog.trim(), createdAt, kupac,
        stavke: stavke.map(s => ({
          productId: s.product.id, kolicina: s.kolicina, cijena: s.product.cijena, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
        })),
      });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Ručni unos fiskalnog računa</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fiskalni broj računa *</Label>
                <Input value={brojFiskalnog} onChange={e => setBrojFiskalnog(e.target.value)} placeholder="npr. 1234" />
              </div>
              <div>
                <Label>Datum i vrijeme *</Label>
                <Input type="datetime-local" value={datum} onChange={e => setDatum(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Način plaćanja</Label>
              <div className="flex gap-2 mt-1">
                {(['Gotovina', 'Kartica', 'Virman', 'Ček'] as PaymentType[]).map(t => (
                  <Button key={t} type="button" variant={nacinPlacanja === t ? 'default' : 'outline'} size="sm" onClick={() => setNacinPlacanja(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Dodaj artikal</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={e => search(e.target.value)} placeholder="Pretraži šifru, barkod ili naziv..." />
              </div>
              {results.length > 0 && (
                <div className="border rounded-md mt-1 max-h-40 overflow-auto">
                  {results.map(p => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 flex justify-between text-sm">
                      <span>{p.naziv} <span className="text-slate-400">({p.sifra})</span></span>
                      <span className="font-mono">{formatKM(p.cijena)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {stavke.length > 0 && (
              <div className="border rounded-md divide-y">
                {stavke.map(s => (
                  <div key={s.product.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0 truncate">{s.product.naziv}</div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-400">Kol</Label>
                      <Input type="number" min={0} step="any" value={s.kolicina} className="w-16 h-8"
                        onChange={e => updateStavka(s.product.id, { kolicina: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-400">Rabat %</Label>
                      <Input type="number" min={0} max={100} step="any" value={s.rabat} className="w-16 h-8"
                        onChange={e => updateStavka(s.product.id, { rabat: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="w-24 text-right font-mono">
                      {formatKM(s.product.cijena * s.kolicina * (1 - s.rabat / 100))}
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStavka(s.product.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <details className="border rounded-md px-3 py-2">
              <summary className="cursor-pointer text-sm text-slate-600">Kupac (opciono)</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><Label>ID broj</Label><Input value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} /></div>
                <div><Label>Naziv</Label><Input value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} /></div>
                <div><Label>Adresa</Label><Input value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} /></div>
                <div><Label>Grad</Label><Input value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} /></div>
                <div><Label>Poštanski broj</Label><Input value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} /></div>
              </div>
            </details>

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm text-slate-500">PDV (17%): {formatKM(pdvIznos)}</span>
              <span className="text-lg font-bold">Ukupno: {formatKM(ukupno)}</span>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={loading}>Otkaži</Button>
          <Button onClick={handleSave} disabled={loading}>
            <Plus className="h-4 w-4 mr-1" /> {loading ? 'Spremam...' : 'Spremi račun'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Provjeri typecheck**

Run: `bun run lint`
Expected: nema grešaka u `DodajRacunDialog.tsx`. (Ako ShadCN nema neki import — provjeri postojanje `@/components/ui/scroll-area`; već se koristi u NarudzbeScreen pa postoji.)

- [ ] **Step 3: Commit**

```bash
git add src/components/DodajRacunDialog.tsx
git commit -m "feat(ui): add DodajRacunDialog for manual receipt entry"
```

---

### Task 5: Integracija u NarudzbeScreen (dugme + badge)

**Files:**
- Modify: `src/screens/NarudzbeScreen.tsx`

**Interfaces:**
- Consumes: `DodajRacunDialog` (Task 4), `Order.isManual` (Task 2).
- NarudzbeScreen mora znati `korisnikId`. Provjeri prima li već `user`/`korisnikId` kao prop ili ga čita iz konteksta. Ako NE, dodaj prop `korisnikId: number` u komponentu i proslijedi ga od roditelja (mjesto gdje se `<NarudzbeScreen />` renderuje — pretraži `NarudzbeScreen` u `src/`). Ako roditelj već ima `user`, proslijedi `user.id`.

- [ ] **Step 1: Dodaj import i state**

Na vrh `src/screens/NarudzbeScreen.tsx` uz ostale importe dodaj:

```ts
import DodajRacunDialog from '@/components/DodajRacunDialog';
import { Plus } from 'lucide-react';
```

(`Plus` dodaj u postojeći `lucide-react` import ako je jednostavnije — inače zaseban import je OK.)

Unutar komponente, uz ostale `useState`, dodaj:

```ts
  const [dodajOpen, setDodajOpen] = useState(false);
```

- [ ] **Step 2: Osiguraj korisnikId**

Pretraži gdje se `NarudzbeScreen` renderuje:

Run: `grep -rn "NarudzbeScreen" src/ --include=*.tsx | grep -v "export default"`

Ako roditelj prosljeđuje `user`, izmijeni potpis komponente na:

```ts
export default function NarudzbeScreen({ korisnikId }: { korisnikId: number }) {
```

i na mjestu rendera dodaj `korisnikId={user.id}`. Ako korisnik već dolazi kroz neki prop/kontekst, iskoristi to umjesto novog propa. Cilj: imati validan `korisnikId: number` dostupan u komponenti.

- [ ] **Step 3: Dodaj dugme iznad liste računa**

Pronađi vrh lijevog panela (lista računa) i dodaj dugme. Primjer — odmah unutar kontejnera liste, prije tabele/liste redova:

```tsx
        <div className="flex justify-end mb-3">
          <Button size="sm" onClick={() => setDodajOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Dodaj račun ručno
          </Button>
        </div>
```

- [ ] **Step 4: Renderuj dijalog**

Pri dnu JSX-a komponente (prije zatvaranja root elementa) dodaj:

```tsx
        <DodajRacunDialog
          open={dodajOpen}
          onOpenChange={setDodajOpen}
          korisnikId={korisnikId}
          onSaved={loadOrders}
        />
```

- [ ] **Step 5: Dodaj "Ručno" badge u detaljima i listi**

U detaljnom panelu, pored fiskalnog broja/statusa, dodaj (kada je `selectedOrder?.isManual`):

```tsx
        {selectedOrder?.isManual ? (
          <Badge variant="outline" className="border-amber-400 text-amber-600">Ručno unesen</Badge>
        ) : null}
```

U redu liste računa, pored broja/statusa, dodaj mali indikator kada je `order.isManual`:

```tsx
          {order.isManual ? <Badge variant="outline" className="ml-1 text-amber-600 border-amber-400">R</Badge> : null}
```

(`Badge` je već importovan u fajlu.)

- [ ] **Step 6: Provjeri typecheck**

Run: `bun run lint`
Expected: nema grešaka u `NarudzbeScreen.tsx`.

- [ ] **Step 7: Ručna verifikacija u aplikaciji**

Run: `bun run start`
Provjeri:
1. Otvori ekran Narudžbe → klikni "Dodaj račun ručno".
2. Unesi fiskalni broj, datum sa (npr. jučerašnjeg) računa, dodaj 1–2 artikla, klikni Spremi.
3. Račun se pojavljuje u listi sa "R"/"Ručno unesen" badge, tačnim datumom, ukupnim iznosom i PDV-om.
4. Ponovni unos **istog** fiskalnog broja → greška "Fiskalni račun sa tim brojem već postoji".
5. Provjeri da su zalihe artikala smanjene (ekran Skladište/izvještaj zaliha).
6. PDF računa (Print/Export) prikazuje stavke i totale tačno.

- [ ] **Step 8: Commit**

```bash
git add src/screens/NarudzbeScreen.tsx
git commit -m "feat(narudzbe): add manual receipt entry button and badge"
```

---

## Self-Review

**Spec coverage:**
- Migracija `isManual` → Task 2 ✓
- `Order.isManual` tip → Task 2 ✓
- `order:createManual` sa duplikat-provjerom, eksplicitni `createdAt`, bez Tringa → Task 3 ✓
- Stock movements 'izlaz' → Task 3 ✓
- Dijalog sa punim stavkama, auto totali → Task 4 ✓
- Dugme u NarudzbeScreen + badge → Task 5 ✓
- Reuse kalkulacije (KasaScreen + dijalog) → Task 1 ✓

**Placeholder scan:** Nema TBD/TODO; sav kod je konkretan.

**Type consistency:** `izracunajTotale(RacunStavka[]) → {ukupno, pdvIznos}` konzistentno u Task 1/4. Handler potpis (`createManualOrder` payload) isti u Task 3/4. `isManual` isti u Task 2/3/5.

**Napomena o testovima:** Repo nema test-infrastrukturu (nema test skripte ni postojećih testova). Automatski test je pisan samo za čisti helper (`izracunajTotale`) preko `bun test`, jer je izolovan i vrijedan. DB migracija, IPC handler (better-sqlite3 + Electron native) i React dijalog verifikuju se ručnim pokretanjem aplikacije (Task 5, Step 7) — pisanje unit-testova za njih zahtijevalo bi novu infrastrukturu izvan opsega ove funkcionalnosti.
