# Kasa POS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete POS cashier app with warehouse management, Tring fiscal printer integration, and bookkeeping reports — all in Bosnian.

**Architecture:** Electron main process handles SQLite DB and HTTP/XML communication with Tring.Fiscal.Server. React renderer with ShadCN UI provides the frontend. IPC bridge connects them via contextBridge.

**Tech Stack:** Electron Forge, Vite, React 18, TypeScript, ShadCN UI, Tailwind CSS, better-sqlite3, Bun

---

### Task 1: Install Dependencies & Configure React + Tailwind + ShadCN

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.renderer.config.ts`
- Modify: `index.html`
- Modify: `src/renderer.ts` → rename to `src/renderer.tsx`
- Modify: `forge.config.ts`
- Create: `src/App.tsx`
- Create: `src/index.css` (overwrite)
- Create: `src/lib/utils.ts`
- Create: `components.json`
- Create: `postcss.config.js`
- Create: `tailwind.config.js`

**Step 1: Install all dependencies**

Run:
```bash
bun add react react-dom better-sqlite3 lucide-react class-variance-authority clsx tailwind-merge tailwindcss-animate @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-select @radix-ui/react-label @radix-ui/react-separator @radix-ui/react-scroll-area @radix-ui/react-dropdown-menu @radix-ui/react-toast @radix-ui/react-popover
bun add -d @types/react @types/react-dom @types/better-sqlite3 tailwindcss postcss autoprefixer @vitejs/plugin-react
```

**Step 2: Configure Tailwind**

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

`postcss.config.js`:
```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 3: Update tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "commonjs",
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noImplicitAny": true,
    "sourceMap": true,
    "baseUrl": ".",
    "outDir": "dist",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

**Step 4: Update vite.renderer.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 5: Create src/lib/utils.ts**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 6: Create components.json for ShadCN**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

**Step 7: Overwrite src/index.css with Tailwind + ShadCN CSS variables**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 220 70% 50%;
    --primary-foreground: 210 40% 98%;
    --secondary: 220 14.3% 95.9%;
    --secondary-foreground: 220 9% 46.1%;
    --muted: 220 14.3% 95.9%;
    --muted-foreground: 220 9% 46.1%;
    --accent: 220 14.3% 95.9%;
    --accent-foreground: 220 9% 46.1%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 220 13% 91%;
    --input: 220 13% 91%;
    --ring: 220 70% 50%;
    --radius: 0.5rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
}
```

**Step 8: Update index.html**

```html
<!doctype html>
<html lang="bs">
  <head>
    <meta charset="UTF-8" />
    <title>Kasa</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer.tsx"></script>
  </body>
</html>
```

**Step 9: Rename src/renderer.ts to src/renderer.tsx**

```tsx
import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<React.StrictMode><App /></React.StrictMode>);
```

**Step 10: Create src/App.tsx placeholder**

```tsx
export default function App() {
  return <div className="h-screen flex items-center justify-center text-2xl font-semibold">Kasa POS</div>;
}
```

**Step 11: Update forge.config.ts renderer entry**

In `forge.config.ts`, the renderer entry stays the same since Vite handles the `.tsx` extension.

**Step 12: Run and verify**

```bash
bun run start
```

Expected: Electron window showing "Kasa POS" centered, styled with Inter font.

**Step 13: Commit**

```bash
git add -A && git commit -m "feat: setup React + Tailwind + ShadCN UI foundation"
```

---

### Task 2: ShadCN UI Components

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/table.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/scroll-area.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/toast.tsx`
- Create: `src/components/ui/toaster.tsx`
- Create: `src/components/ui/use-toast.ts`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/popover.tsx`

**Step 1: Add ShadCN components via CLI**

```bash
bunx shadcn@latest add button input card table dialog select label separator scroll-area badge tabs toast dropdown-menu popover
```

If CLI doesn't work with the config, manually create each component following ShadCN source code.

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add ShadCN UI components"
```

---

### Task 3: Database Setup & Schema

**Files:**
- Create: `src/database/schema.ts`
- Create: `src/database/db.ts`
- Create: `src/database/migrations.ts`

**Step 1: Create src/database/schema.ts**

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ime TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  uloga TEXT NOT NULL DEFAULT 'kasir' CHECK(uloga IN ('admin', 'kasir')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sifra TEXT NOT NULL UNIQUE,
  naziv TEXT NOT NULL,
  jm TEXT NOT NULL DEFAULT 'kom',
  cijena REAL NOT NULL,
  pdvStopa TEXT NOT NULL DEFAULT 'E' CHECK(pdvStopa IN ('E', 'K')),
  plu INTEGER,
  barkod TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS primke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brojPrimke TEXT NOT NULL UNIQUE,
  datum TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  napomena TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS primka_stavke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primkaId INTEGER NOT NULL REFERENCES primke(id),
  productId INTEGER NOT NULL REFERENCES products(id),
  kolicina REAL NOT NULL,
  cijena REAL NOT NULL,
  pdvStopa TEXT NOT NULL DEFAULT 'E',
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  korisnikId INTEGER NOT NULL REFERENCES users(id),
  ukupno REAL NOT NULL,
  pdvIznos REAL NOT NULL,
  nacinPlacanja TEXT NOT NULL DEFAULT '{"Gotovina":0}',
  brojFiskalnogRacuna TEXT,
  brojReklamacije TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'refunded')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL REFERENCES orders(id),
  productId INTEGER NOT NULL REFERENCES products(id),
  kolicina REAL NOT NULL,
  cijena REAL NOT NULL,
  rabat REAL NOT NULL DEFAULT 0,
  pdvStopa TEXT NOT NULL DEFAULT 'E'
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL REFERENCES products(id),
  tip TEXT NOT NULL CHECK(tip IN ('ulaz', 'izlaz')),
  kolicina REAL NOT NULL,
  referenceType TEXT NOT NULL,
  referenceId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_products_sifra ON products(sifra);
CREATE INDEX IF NOT EXISTS idx_products_barkod ON products(barkod);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(productId);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(orderId);
CREATE INDEX IF NOT EXISTS idx_primka_stavke_primka ON primka_stavke(primkaId);
`;
```

**Step 2: Create src/database/db.ts**

```ts
import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';
import { SCHEMA } from './schema';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'kasa.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    seedDefaultAdmin();
  }
  return db;
}

function seedDefaultAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE uloga = ?').get('admin');
  if (!existing) {
    db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run('Admin', '0000', 'admin');
  }
}

export function closeDb() {
  if (db) {
    db.close();
  }
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add SQLite database schema and initialization"
```

---

### Task 4: IPC Bridge (Preload + Main Process Handlers)

**Files:**
- Modify: `src/preload.ts`
- Create: `src/ipc/handlers.ts`
- Create: `src/types.ts`
- Modify: `src/main.ts`

**Step 1: Create src/types.ts — shared types**

```ts
export interface User {
  id: number;
  ime: string;
  pin: string;
  uloga: 'admin' | 'kasir';
  createdAt: string;
}

export interface Product {
  id: number;
  sifra: string;
  naziv: string;
  jm: string;
  cijena: number;
  pdvStopa: 'E' | 'K';
  plu?: number;
  barkod?: string;
  createdAt: string;
  updatedAt: string;
  stpieces?: number;
}

export interface Primka {
  id: number;
  brojPrimke: string;
  datum: string;
  napomena?: string;
  createdAt: string;
  stavke?: PrimkaStavka[];
}

export interface PrimkaStavka {
  id: number;
  primkaId: number;
  productId: number;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
  createdAt: string;
  productNaziv?: string;
  productJm?: string;
}

export interface Order {
  id: number;
  korisnikId: number;
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  brojFiskalnogRacuna?: string;
  brojReklamacije?: string;
  status: 'completed' | 'refunded';
  createdAt: string;
  stavke?: OrderItem[];
  korisnikIme?: string;
}

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
  productNaziv?: string;
  productJm?: string;
}

export interface CartItem {
  product: Product;
  kolicina: number;
  rabat: number;
}

export interface TringSettings {
  host: string;
  port: number;
  operatorId: number;
  operatorPassword: string;
}
```

**Step 2: Create src/preload.ts — contextBridge API**

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Users
  login: (pin: string) => ipcRenderer.invoke('user:login', pin),
  getUsers: () => ipcRenderer.invoke('user:getAll'),
  createUser: (data: any) => ipcRenderer.invoke('user:create', data),
  updateUser: (id: number, data: any) => ipcRenderer.invoke('user:update', id, data),
  deleteUser: (id: number) => ipcRenderer.invoke('user:delete', id),

  // Products
  getProducts: () => ipcRenderer.invoke('product:getAll'),
  getProduct: (id: number) => ipcRenderer.invoke('product:get', id),
  createProduct: (data: any) => ipcRenderer.invoke('product:create', data),
  updateProduct: (id: number, data: any) => ipcRenderer.invoke('product:update', id, data),
  deleteProduct: (id: number) => ipcRenderer.invoke('product:delete', id),
  searchProducts: (query: string) => ipcRenderer.invoke('product:search', query),
  getStock: (productId: number) => ipcRenderer.invoke('product:getStock', productId),

  // Primke (inventory sheets)
  getPrimke: () => ipcRenderer.invoke('primka:getAll'),
  getPrimka: (id: number) => ipcRenderer.invoke('primka:get', id),
  createPrimka: (data: any) => ipcRenderer.invoke('primka:create', data),

  // Orders
  getOrders: () => ipcRenderer.invoke('order:getAll'),
  getOrder: (id: number) => ipcRenderer.invoke('order:get', id),
  createOrder: (data: any) => ipcRenderer.invoke('order:create', data),
  updateOrderReklamacija: (id: number, broj: string) => ipcRenderer.invoke('order:updateReklamacija', id, broj),
  refundOrder: (id: number) => ipcRenderer.invoke('order:refund', id),

  // Tring fiscal printer
  tringInit: () => ipcRenderer.invoke('tring:init'),
  tringPrintReceipt: (data: any) => ipcRenderer.invoke('tring:printReceipt', data),
  tringPrintRefund: (data: any) => ipcRenderer.invoke('tring:printRefund', data),
  tringXReport: () => ipcRenderer.invoke('tring:xReport'),
  tringZReport: () => ipcRenderer.invoke('tring:zReport'),
  tringPeriodicReport: (from: string, to: string) => ipcRenderer.invoke('tring:periodicReport', from, to),
  tringWriteArticle: (data: any) => ipcRenderer.invoke('tring:writeArticle', data),

  // Settings
  getTringSettings: () => ipcRenderer.invoke('settings:getTring'),
  saveTringSettings: (data: any) => ipcRenderer.invoke('settings:saveTring', data),

  // Reports
  getReportData: (type: string, from: string, to: string) => ipcRenderer.invoke('report:getData', type, from, to),
});
```

**Step 3: Create src/ipc/handlers.ts — all IPC handlers**

```ts
import { ipcMain } from 'electron';
import { getDb } from '../database/db';
import { TringService } from '../services/tring';

export function registerIpcHandlers() {
  const db = getDb();

  // === USERS ===
  ipcMain.handle('user:login', (_, pin: string) => {
    return db.prepare('SELECT id, ime, uloga FROM users WHERE pin = ?').get(pin);
  });

  ipcMain.handle('user:getAll', () => {
    return db.prepare('SELECT id, ime, pin, uloga, createdAt FROM users ORDER BY id').all();
  });

  ipcMain.handle('user:create', (_, data) => {
    const stmt = db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)');
    const result = stmt.run(data.ime, data.pin, data.uloga || 'kasir');
    return { id: result.lastInsertRowid };
  });

  ipcMain.handle('user:update', (_, id, data) => {
    db.prepare('UPDATE users SET ime = ?, pin = ?, uloga = ? WHERE id = ?').run(data.ime, data.pin, data.uloga, id);
    return { success: true };
  });

  ipcMain.handle('user:delete', (_, id) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { success: true };
  });

  // === PRODUCTS ===
  ipcMain.handle('product:getAll', () => {
    return db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN tip='ulaz' THEN kolicina ELSE -kolicina END) FROM stock_movements WHERE productId = p.id), 0) as stanje
      FROM products p ORDER BY p.naziv
    `).all();
  });

  ipcMain.handle('product:get', (_, id) => {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  });

  ipcMain.handle('product:create', (_, data) => {
    const stmt = db.prepare('INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, barkod) VALUES (?, ?, ?, ?, ?, ?)');
    const result = stmt.run(data.sifra, data.naziv, data.jm, data.cijena, data.pdvStopa, data.barkod || null);
    return { id: result.lastInsertRowid };
  });

  ipcMain.handle('product:update', (_, id, data) => {
    db.prepare(`UPDATE products SET sifra=?, naziv=?, jm=?, cijena=?, pdvStopa=?, barkod=?, updatedAt=datetime('now','localtime') WHERE id=?`)
      .run(data.sifra, data.naziv, data.jm, data.cijena, data.pdvStopa, data.barkod || null, id);
    return { success: true };
  });

  ipcMain.handle('product:delete', (_, id) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('product:search', (_, query: string) => {
    const like = `%${query}%`;
    return db.prepare(`
      SELECT p.*,
        COALESCE((SELECT SUM(CASE WHEN tip='ulaz' THEN kolicina ELSE -kolicina END) FROM stock_movements WHERE productId = p.id), 0) as stanje
      FROM products p
      WHERE p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?
      ORDER BY p.naziv LIMIT 20
    `).all(like, like, like);
  });

  ipcMain.handle('product:getStock', (_, productId) => {
    const row = db.prepare('SELECT COALESCE(SUM(CASE WHEN tip=\'ulaz\' THEN kolicina ELSE -kolicina END), 0) as stanje FROM stock_movements WHERE productId = ?').get(productId) as any;
    return row?.stanje ?? 0;
  });

  // === PRIMKE ===
  ipcMain.handle('primka:getAll', () => {
    return db.prepare('SELECT * FROM primke ORDER BY datum DESC').all();
  });

  ipcMain.handle('primka:get', (_, id) => {
    const primka = db.prepare('SELECT * FROM primke WHERE id = ?').get(id) as any;
    if (primka) {
      primka.stavke = db.prepare(`
        SELECT ps.*, p.naziv as productNaziv, p.jm as productJm
        FROM primka_stavke ps JOIN products p ON ps.productId = p.id
        WHERE ps.primkaId = ? ORDER BY ps.id
      `).all(id);
    }
    return primka;
  });

  ipcMain.handle('primka:create', (_, data) => {
    const insertPrimka = db.prepare('INSERT INTO primke (brojPrimke, napomena) VALUES (?, ?)');
    const insertStavka = db.prepare('INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, ?, ?, ?)');
    const insertStock = db.prepare('INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, \'ulaz\', ?, \'primka\', ?)');

    const tx = db.transaction(() => {
      const result = insertPrimka.run(data.brojPrimke, data.napomena || null);
      const primkaId = result.lastInsertRowid;
      for (const stavka of data.stavke) {
        insertStavka.run(primkaId, stavka.productId, stavka.kolicina, stavka.cijena, stavka.pdvStopa);
        insertStock.run(stavka.productId, stavka.kolicina, primkaId);
      }
      return { id: primkaId };
    });

    return tx();
  });

  // === ORDERS ===
  ipcMain.handle('order:getAll', () => {
    return db.prepare(`
      SELECT o.*, u.ime as korisnikIme
      FROM orders o JOIN users u ON o.korisnikId = u.id
      ORDER BY o.createdAt DESC
    `).all();
  });

  ipcMain.handle('order:get', (_, id) => {
    const order = db.prepare(`
      SELECT o.*, u.ime as korisnikIme
      FROM orders o JOIN users u ON o.korisnikId = u.id
      WHERE o.id = ?
    `).get(id) as any;
    if (order) {
      order.stavke = db.prepare(`
        SELECT oi.*, p.naziv as productNaziv, p.jm as productJm
        FROM order_items oi JOIN products p ON oi.productId = p.id
        WHERE oi.orderId = ? ORDER BY oi.id
      `).all(id);
    }
    return order;
  });

  ipcMain.handle('order:create', (_, data) => {
    const insertOrder = db.prepare('INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna) VALUES (?, ?, ?, ?, ?)');
    const insertItem = db.prepare('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)');
    const insertStock = db.prepare('INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, \'izlaz\', ?, \'order\', ?)');

    const tx = db.transaction(() => {
      const result = insertOrder.run(data.korisnikId, data.ukupno, data.pdvIznos, JSON.stringify(data.nacinPlacanja), data.brojFiskalnogRacuna || null);
      const orderId = result.lastInsertRowid;
      for (const item of data.stavke) {
        insertItem.run(orderId, item.productId, item.kolicina, item.cijena, item.rabat || 0, item.pdvStopa);
        insertStock.run(item.productId, item.kolicina, orderId);
      }
      return { id: orderId };
    });

    return tx();
  });

  ipcMain.handle('order:updateReklamacija', (_, id, broj) => {
    db.prepare('UPDATE orders SET brojReklamacije = ? WHERE id = ?').run(broj, id);
    return { success: true };
  });

  ipcMain.handle('order:refund', (_, id) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!order) return { success: false, error: 'Narudžba nije pronađena' };

    const items = db.prepare('SELECT * FROM order_items WHERE orderId = ?').all(id) as any[];
    const insertStock = db.prepare('INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, \'ulaz\', ?, \'refund\', ?)');

    const tx = db.transaction(() => {
      db.prepare('UPDATE orders SET status = \'refunded\' WHERE id = ?').run(id);
      for (const item of items) {
        insertStock.run(item.productId, item.kolicina, id);
      }
      return { success: true };
    });

    return tx();
  });

  // === SETTINGS ===
  // Store tring settings in a simple key-value table
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

  ipcMain.handle('settings:getTring', () => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tring') as any;
    return row ? JSON.parse(row.value) : { host: 'localhost', port: 8085, operatorId: 0, operatorPassword: '0' };
  });

  ipcMain.handle('settings:saveTring', (_, data) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('tring', JSON.stringify(data));
    return { success: true };
  });

  // === REPORTS ===
  ipcMain.handle('report:getData', (_, type, from, to) => {
    if (type === 'dnevni') {
      return db.prepare(`
        SELECT o.*, u.ime as korisnikIme FROM orders o
        JOIN users u ON o.korisnikId = u.id
        WHERE date(o.createdAt) BETWEEN ? AND ?
        ORDER BY o.createdAt DESC
      `).all(from, to);
    }
    if (type === 'primke') {
      return db.prepare(`
        SELECT p.*, COUNT(ps.id) as brojStavki,
          SUM(ps.kolicina * ps.cijena) as ukupnaVrijednost
        FROM primke p LEFT JOIN primka_stavke ps ON p.id = ps.primkaId
        WHERE date(p.datum) BETWEEN ? AND ?
        GROUP BY p.id ORDER BY p.datum DESC
      `).all(from, to);
    }
    return [];
  });

  // === TRING FISCAL PRINTER ===
  registerTringHandlers();
}

function registerTringHandlers() {
  const db = getDb();

  function getTringSettings() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tring') as any;
    return row ? JSON.parse(row.value) : { host: 'localhost', port: 8085, operatorId: 0, operatorPassword: '0' };
  }

  ipcMain.handle('tring:init', async () => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.inicijalizacija(settings.operatorId, settings.operatorPassword);
  });

  ipcMain.handle('tring:printReceipt', async (_, data) => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.stampatiFiskalniRacun(data);
  });

  ipcMain.handle('tring:printRefund', async (_, data) => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.stampatiReklamiraniRacun(data);
  });

  ipcMain.handle('tring:xReport', async () => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.stampatiPresjekStanja();
  });

  ipcMain.handle('tring:zReport', async () => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.stampatiDnevniIzvjestaj();
  });

  ipcMain.handle('tring:periodicReport', async (_, from, to) => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.stampatiPeriodicniIzvjestaj(from, to);
  });

  ipcMain.handle('tring:writeArticle', async (_, data) => {
    const settings = getTringSettings();
    const tring = new TringService(settings.host, settings.port);
    return tring.upisiArtikal(data);
  });
}
```

**Step 4: Update src/main.ts**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './ipc/handlers';
import { closeDb } from './database/db';

if (started) app.quit();

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on('ready', () => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  closeDb();
});
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add IPC bridge with all handlers for users, products, primke, orders, settings"
```

---

### Task 5: Tring Fiscal Printer Service

**Files:**
- Create: `src/services/tring.ts`

**Step 1: Create the Tring HTTP/XML service**

```ts
import http from 'node:http';

interface TringResponse {
  success: boolean;
  vrstaOdgovora: string;
  odgovori: Record<string, string>;
  error?: string;
}

export class TringService {
  private host: string;
  private port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  private async sendXml(filename: string, xml: string): Promise<TringResponse> {
    return new Promise((resolve) => {
      const postData = xml;
      const options = {
        hostname: this.host,
        port: this.port,
        path: `/${filename}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve(this.parseResponse(data));
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, vrstaOdgovora: 'Greska', odgovori: {}, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, vrstaOdgovora: 'Greska', odgovori: {}, error: 'Tring server timeout' });
      });

      req.write(postData);
      req.end();
    });
  }

  private parseResponse(xml: string): TringResponse {
    const odgovori: Record<string, string> = {};
    const vrstaMatch = xml.match(/<VrstaOdgovora>(.*?)<\/VrstaOdgovora>/);
    const vrsta = vrstaMatch?.[1] ?? 'Greska';

    const odgovorRegex = /<Odgovor>\s*<Naziv>(.*?)<\/Naziv>\s*<Vrijednost[^>]*>(.*?)<\/Vrijednost>\s*<\/Odgovor>/gs;
    let match;
    while ((match = odgovorRegex.exec(xml)) !== null) {
      if (match[1]) odgovori[match[1]] = match[2] ?? '';
    }

    return { success: vrsta === 'OK', vrstaOdgovora: vrsta, odgovori };
  }

  async inicijalizacija(operatorId: number, password: string): Promise<TringResponse> {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Operator xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojOperatora>${operatorId}</BrojOperatora>
  <Lozinka>${password}</Lozinka>
</Operator>`;
    return this.sendXml('init.xml', xml);
  }

  async upisiArtikal(artikal: { sifra: string; naziv: string; jm: string; cijena: number; stopa: string; plu?: number }): Promise<TringResponse> {
    const brojZahtjeva = Date.now();
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>
  <VrstaZahtjeva>105</VrstaZahtjeva>
  <NoviObjekat>
    <Sifra>${artikal.sifra}</Sifra>
    <Naziv>${artikal.naziv}</Naziv>
    <JM>${artikal.jm}</JM>
    <Cijena>${artikal.cijena}</Cijena>
    <Stopa>${artikal.stopa}</Stopa>
    <Grupa>0</Grupa>
    <PLU>${artikal.plu || 0}</PLU>
  </NoviObjekat>
</RacunZahtjev>`;
    return this.sendXml('ua.xml', xml);
  }

  async stampatiFiskalniRacun(racun: {
    stavke: Array<{ sifra: string; naziv: string; jm: string; cijena: number; stopa: string; plu?: number; kolicina: number; rabat?: number }>;
    vrstePlacanja: Array<{ oznaka: string; iznos: number }>;
    kupac?: { idBroj: string; naziv: string; adresa: string; postanskiBroj: string; grad: string };
    napomena?: string;
    brojRacuna?: string;
  }): Promise<TringResponse> {
    const brojZahtjeva = Date.now();
    const kupacXml = racun.kupac ? `
    <Kupac>
      <IDbroj>${racun.kupac.idBroj}</IDbroj>
      <Naziv>${racun.kupac.naziv}</Naziv>
      <Adresa>${racun.kupac.adresa}</Adresa>
      <PostanskiBroj>${racun.kupac.postanskiBroj}</PostanskiBroj>
      <Grad>${racun.kupac.grad}</Grad>
    </Kupac>` : '';

    const stavkeXml = racun.stavke.map(s => `
      <RacunStavka>
        <artikal>
          <Sifra>${s.sifra}</Sifra>
          <Naziv>${s.naziv}</Naziv>
          <JM>${s.jm}</JM>
          <Cijena>${s.cijena}</Cijena>
          <Stopa>${s.stopa}</Stopa>
          <Grupa>0</Grupa>
          <PLU>${s.plu || 0}</PLU>
        </artikal>
        <Kolicina>${s.kolicina}</Kolicina>
        <Rabat>${s.rabat || 0}</Rabat>
      </RacunStavka>`).join('');

    const placanjaXml = racun.vrstePlacanja.map(p => `
      <VrstaPlacanja>
        <Oznaka>${p.oznaka}</Oznaka>
        <Iznos>${p.iznos}</Iznos>
      </VrstaPlacanja>`).join('');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>
  <VrstaZahtjeva>0</VrstaZahtjeva>
  <NoviObjekat>${kupacXml}
    <StavkeRacuna>${stavkeXml}
    </StavkeRacuna>
    <VrstePlacanja>${placanjaXml}
    </VrstePlacanja>
    <Napomena>${racun.napomena || 'Hvala na posjeti!'}</Napomena>
    <BrojRacuna>${racun.brojRacuna || '0'}</BrojRacuna>
  </NoviObjekat>
</RacunZahtjev>`;
    return this.sendXml('sfr.xml', xml);
  }

  async stampatiReklamiraniRacun(racun: {
    brojRacuna: string;
    stavke: Array<{ sifra: string; naziv: string; jm: string; cijena: number; stopa: string; plu?: number; kolicina: number; rabat?: number }>;
    kupac?: { idBroj: string; naziv: string; adresa: string; postanskiBroj: string; grad: string };
  }): Promise<TringResponse> {
    const brojZahtjeva = Date.now();
    const kupacXml = racun.kupac ? `
    <Kupac>
      <IDbroj>${racun.kupac.idBroj}</IDbroj>
      <Naziv>${racun.kupac.naziv}</Naziv>
      <Adresa>${racun.kupac.adresa}</Adresa>
      <PostanskiBroj>${racun.kupac.postanskiBroj}</PostanskiBroj>
      <Grad>${racun.kupac.grad}</Grad>
    </Kupac>` : '';

    const stavkeXml = racun.stavke.map(s => `
      <RacunStavka>
        <artikal>
          <Sifra>${s.sifra}</Sifra>
          <Naziv>${s.naziv}</Naziv>
          <JM>${s.jm}</JM>
          <Cijena>${s.cijena}</Cijena>
          <Stopa>${s.stopa}</Stopa>
          <Grupa>0</Grupa>
          <PLU>${s.plu || 0}</PLU>
        </artikal>
        <Kolicina>${s.kolicina}</Kolicina>
        <Rabat>${s.rabat || 0}</Rabat>
      </RacunStavka>`).join('');

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>
  <VrstaZahtjeva>2</VrstaZahtjeva>
  <NoviObjekat>${kupacXml}
    <StavkeRacuna>${stavkeXml}
    </StavkeRacuna>
    <VrstePlacanja />
    <Napomena>Reklamacija</Napomena>
    <BrojRacuna>${racun.brojRacuna}</BrojRacuna>
  </NoviObjekat>
</RacunZahtjev>`;
    return this.sendXml('srr.xml', xml);
  }

  async stampatiPresjekStanja(): Promise<TringResponse> {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Zahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${Date.now()}</BrojZahtjeva>
  <VrstaZahtjeva>3</VrstaZahtjeva>
  <Parametri />
</Zahtjev>`;
    return this.sendXml('sps.xml', xml);
  }

  async stampatiDnevniIzvjestaj(): Promise<TringResponse> {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Zahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${Date.now()}</BrojZahtjeva>
  <VrstaZahtjeva>4</VrstaZahtjeva>
  <Parametri />
</Zahtjev>`;
    return this.sendXml('sdi.xml', xml);
  }

  async stampatiPeriodicniIzvjestaj(odDatuma: string, doDatuma: string): Promise<TringResponse> {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Zahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>${Date.now()}</BrojZahtjeva>
  <VrstaZahtjeva>5</VrstaZahtjeva>
  <Parametri>
    <Parametar>
      <Naziv>odDatuma</Naziv>
      <Vrijednost>${odDatuma}</Vrijednost>
    </Parametar>
    <Parametar>
      <Naziv>doDatuma</Naziv>
      <Vrijednost>${doDatuma}</Vrijednost>
    </Parametar>
  </Parametri>
</Zahtjev>`;
    return this.sendXml('spi.xml', xml);
  }
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add Tring fiscal printer HTTP/XML service"
```

---

### Task 6: PIN Login Screen

**Files:**
- Create: `src/screens/LoginScreen.tsx`
- Modify: `src/App.tsx`

**Step 1: Create LoginScreen**

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User } from '@/types';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const handleDigit = (d: string) => {
    if (pin.length < 6) setPin(prev => prev + d);
  };

  const handleDelete = () => setPin(prev => prev.slice(0, -1));

  const handleSubmit = async () => {
    if (pin.length < 4) return;
    const user = await (window as any).api.login(pin);
    if (user) {
      setError('');
      onLogin(user);
    } else {
      setError('Pogrešan PIN');
      setPin('');
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
      <Card className="w-80 shadow-xl">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-bold tracking-tight">Kasa</CardTitle>
          <p className="text-sm text-muted-foreground">Unesite PIN za prijavu</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center gap-2">
            {[0,1,2,3].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${i < pin.length ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
            ))}
            {pin.length > 4 && [4,5].map(i => (
              <div key={i} className={`w-4 h-4 rounded-full border-2 transition-colors ${i < pin.length ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`} />
            ))}
          </div>
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map(d => (
              <Button key={d} variant="outline" className="h-14 text-xl font-medium" onClick={() => handleDigit(d)}>{d}</Button>
            ))}
            <Button variant="outline" className="h-14 text-sm" onClick={handleDelete}>Obriši</Button>
            <Button variant="outline" className="h-14 text-xl font-medium" onClick={() => handleDigit('0')}>0</Button>
            <Button className="h-14 text-sm font-semibold" onClick={handleSubmit}>Prijava</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Update App.tsx with routing**

```tsx
import { useState } from 'react';
import { User } from '@/types';
import LoginScreen from '@/screens/LoginScreen';
import MainLayout from '@/components/MainLayout';

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  if (!user) return <LoginScreen onLogin={setUser} />;
  return <MainLayout user={user} onLogout={() => setUser(null)} />;
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add PIN login screen with numpad"
```

---

### Task 7: Main Layout & Navigation

**Files:**
- Create: `src/components/MainLayout.tsx`

**Step 1: Create MainLayout with sidebar navigation**

```tsx
import { useState } from 'react';
import { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import KasaScreen from '@/screens/KasaScreen';
import SkladisteScreen from '@/screens/SkladisteScreen';
import NarudzbeScreen from '@/screens/NarudzbeScreen';
import IzvjestajiScreen from '@/screens/IzvjestajiScreen';
import PostavkeScreen from '@/screens/PostavkeScreen';

type Screen = 'kasa' | 'skladiste' | 'narudzbe' | 'izvjestaji' | 'postavke';

const NAV_ITEMS: { id: Screen; label: string; icon: string }[] = [
  { id: 'kasa', label: 'Kasa', icon: '💰' },
  { id: 'skladiste', label: 'Skladište', icon: '📦' },
  { id: 'narudzbe', label: 'Narudžbe', icon: '📋' },
  { id: 'izvjestaji', label: 'Izvještaji', icon: '📊' },
  { id: 'postavke', label: 'Postavke', icon: '⚙️' },
];

interface Props {
  user: User;
  onLogout: () => void;
}

export default function MainLayout({ user, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>('kasa');

  return (
    <div className="h-screen flex">
      <aside className="w-52 bg-slate-900 text-white flex flex-col">
        <div className="p-4 pb-2">
          <h1 className="text-lg font-bold tracking-tight">Kasa</h1>
          <p className="text-xs text-slate-400">{user.ime} ({user.uloga})</p>
        </div>
        <Separator className="bg-slate-700" />
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(item => (
            (item.id === 'postavke' && user.uloga !== 'admin') ? null :
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                screen === item.id ? 'bg-primary text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="mr-2">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="p-2">
          <Button variant="ghost" className="w-full text-slate-400 hover:text-white hover:bg-slate-800" onClick={onLogout}>
            Odjava
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden bg-slate-50">
        {screen === 'kasa' && <KasaScreen user={user} />}
        {screen === 'skladiste' && <SkladisteScreen />}
        {screen === 'narudzbe' && <NarudzbeScreen />}
        {screen === 'izvjestaji' && <IzvjestajiScreen />}
        {screen === 'postavke' && <PostavkeScreen />}
      </main>
    </div>
  );
}
```

**Step 2: Create placeholder screens**

Create each of these as simple placeholders:
- `src/screens/KasaScreen.tsx`
- `src/screens/SkladisteScreen.tsx`
- `src/screens/NarudzbeScreen.tsx`
- `src/screens/IzvjestajiScreen.tsx`
- `src/screens/PostavkeScreen.tsx`

Each placeholder:
```tsx
export default function XScreen() {
  return <div className="p-6"><h2 className="text-xl font-semibold">X</h2></div>;
}
```

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add main layout with sidebar navigation"
```

---

### Task 8: Kasa (POS) Screen

**Files:**
- Modify: `src/screens/KasaScreen.tsx`

**Step 1: Build the full POS screen**

This is the main screen with:
- Left: product search + results grid
- Right: cart with quantities, PDV breakdown, payment type, finalize button
- Product search by name/barcode/sifra
- Add to cart, adjust quantity, remove
- Payment type selection (Gotovina/Cek/Kartica/Virman) with split payment
- Finalize: call Tring to print fiscal receipt, create order, deduct stock

```tsx
import { useState, useEffect, useCallback } from 'react';
import { User, Product, CartItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props { user: User; }

type PaymentType = 'Gotovina' | 'Cek' | 'Kartica' | 'Virman';

export default function KasaScreen({ user }: Props) {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<(Product & { stanje: number })[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 1) { setProducts([]); return; }
    const results = await (window as any).api.searchProducts(q);
    setProducts(results);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => searchProducts(search), 200);
    return () => clearTimeout(timeout);
  }, [search, searchProducts]);

  const addToCart = (product: Product & { stanje: number }) => {
    setCart(prev => {
      const existing = prev.find(c => c.product.id === product.id);
      if (existing) {
        return prev.map(c => c.product.id === product.id ? { ...c, kolicina: c.kolicina + 1 } : c);
      }
      return [...prev, { product, kolicina: 1, rabat: 0 }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.product.id === productId) {
        const newQty = c.kolicina + delta;
        return newQty > 0 ? { ...c, kolicina: newQty } : c;
      }
      return c;
    }).filter(c => c.kolicina > 0));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(c => c.product.id !== productId));
  };

  const getSubtotal = () => cart.reduce((sum, c) => sum + c.product.cijena * c.kolicina * (1 - c.rabat / 100), 0);
  const getPdvAmount = () => cart.reduce((sum, c) => {
    if (c.product.pdvStopa === 'E') {
      const itemTotal = c.product.cijena * c.kolicina * (1 - c.rabat / 100);
      return sum + (itemTotal - itemTotal / 1.17);
    }
    return sum;
  }, 0);

  const handleFinalize = async () => {
    if (cart.length === 0) return;
    setLoading(true);
    setMessage('');

    try {
      // Build Tring receipt data
      const tringData = {
        stavke: cart.map(c => ({
          sifra: c.product.sifra,
          naziv: c.product.naziv,
          jm: c.product.jm,
          cijena: c.product.cijena,
          stopa: c.product.pdvStopa,
          plu: c.product.plu || 0,
          kolicina: c.kolicina,
          rabat: c.rabat,
        })),
        vrstePlacanja: [{ oznaka: paymentType, iznos: parseFloat(paymentAmount) || 0 }],
      };

      // Print fiscal receipt
      const tringResult = await (window as any).api.tringPrintReceipt(tringData);
      const fiscalNumber = tringResult.odgovori?.BrojFiskalnogRacuna || null;

      if (!tringResult.success) {
        setMessage(`Greška fiskalnog printera: ${tringResult.error || tringResult.vrstaOdgovora}`);
        setLoading(false);
        return;
      }

      // Create order in DB
      const orderData = {
        korisnikId: user.id,
        ukupno: getSubtotal(),
        pdvIznos: getPdvAmount(),
        nacinPlacanja: { [paymentType]: parseFloat(paymentAmount) || getSubtotal() },
        brojFiskalnogRacuna: fiscalNumber,
        stavke: cart.map(c => ({
          productId: c.product.id,
          kolicina: c.kolicina,
          cijena: c.product.cijena,
          rabat: c.rabat,
          pdvStopa: c.product.pdvStopa,
        })),
      };

      await (window as any).api.createOrder(orderData);
      setCart([]);
      setPaymentAmount('');
      setMessage(`Račun #${fiscalNumber || 'OK'} uspješno štampan!`);
    } catch (err: any) {
      setMessage(`Greška: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="h-full flex">
      {/* Left: Product Search */}
      <div className="flex-1 flex flex-col p-4 gap-4">
        <Input
          placeholder="Pretraži artikle (naziv, šifra, barkod)..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-lg h-12"
          autoFocus
        />
        <ScrollArea className="flex-1">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="text-left p-3 rounded-lg border bg-white hover:border-primary hover:shadow-sm transition-all"
              >
                <p className="font-medium text-sm truncate">{p.naziv}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-primary font-bold">{p.cijena.toFixed(2)} KM</span>
                  <Badge variant={p.stanje > 0 ? 'secondary' : 'destructive'} className="text-xs">
                    {p.stanje} {p.jm}
                  </Badge>
                </div>
                <div className="flex gap-1 mt-1">
                  <Badge variant="outline" className="text-xs">{p.pdvStopa === 'E' ? '17% PDV' : '0% PDV'}</Badge>
                  <span className="text-xs text-muted-foreground">#{p.sifra}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Cart */}
      <div className="w-96 border-l bg-white flex flex-col">
        <div className="p-4 pb-2">
          <h2 className="font-semibold text-lg">Račun</h2>
        </div>
        <Separator />
        <ScrollArea className="flex-1 p-4">
          {cart.length === 0 && <p className="text-muted-foreground text-center py-8 text-sm">Prazan račun</p>}
          {cart.map(c => (
            <div key={c.product.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.product.naziv}</p>
                <p className="text-xs text-muted-foreground">{c.product.cijena.toFixed(2)} KM x {c.kolicina}</p>
              </div>
              <div className="flex items-center gap-1 ml-2">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => updateQuantity(c.product.id, -1)}>-</Button>
                <span className="w-8 text-center text-sm font-medium">{c.kolicina}</span>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => updateQuantity(c.product.id, 1)}>+</Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => removeFromCart(c.product.id)}>×</Button>
              </div>
              <p className="w-20 text-right text-sm font-semibold">{(c.product.cijena * c.kolicina * (1 - c.rabat / 100)).toFixed(2)}</p>
            </div>
          ))}
        </ScrollArea>
        <div className="border-t p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">PDV (17%)</span>
            <span>{getPdvAmount().toFixed(2)} KM</span>
          </div>
          <div className="flex justify-between text-lg font-bold">
            <span>Ukupno</span>
            <span>{getSubtotal().toFixed(2)} KM</span>
          </div>
          <Separator />
          <div className="flex gap-1">
            {(['Gotovina', 'Kartica', 'Virman', 'Cek'] as PaymentType[]).map(t => (
              <Button key={t} variant={paymentType === t ? 'default' : 'outline'} size="sm" className="flex-1 text-xs" onClick={() => setPaymentType(t)}>
                {t}
              </Button>
            ))}
          </div>
          <Input
            type="number"
            placeholder={`Iznos (${paymentType})...`}
            value={paymentAmount}
            onChange={e => setPaymentAmount(e.target.value)}
            className="h-10"
          />
          {message && <p className={`text-xs ${message.includes('Greška') ? 'text-destructive' : 'text-green-600'}`}>{message}</p>}
          <Button className="w-full h-12 text-lg font-bold" onClick={handleFinalize} disabled={cart.length === 0 || loading}>
            {loading ? 'Štampanje...' : 'Naplati'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add POS cashier screen with cart, payment, and Tring integration"
```

---

### Task 9: Skladište (Warehouse) Screen

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx`

**Step 1: Build warehouse screen with products list + primka creation**

The screen has two tabs: Artikli (products CRUD) and Primke (inventory sheets).

```tsx
import { useState, useEffect } from 'react';
import { Product, Primka } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ProductForm {
  sifra: string; naziv: string; jm: string; cijena: string; pdvStopa: 'E' | 'K'; barkod: string;
}

const emptyProduct: ProductForm = { sifra: '', naziv: '', jm: 'kom', cijena: '', pdvStopa: 'E', barkod: '' };

interface PrimkaItem {
  productId: number; productNaziv: string; kolicina: string; cijena: string; pdvStopa: string;
}

export default function SkladisteScreen() {
  const [products, setProducts] = useState<(Product & { stanje: number })[]>([]);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyProduct);
  const [primke, setPrimke] = useState<Primka[]>([]);
  const [showPrimkaDialog, setShowPrimkaDialog] = useState(false);
  const [primkaForm, setPrimkaForm] = useState({ brojPrimke: '', napomena: '' });
  const [primkaItems, setPrimkaItems] = useState<PrimkaItem[]>([]);
  const [selectedPrimka, setSelectedPrimka] = useState<Primka | null>(null);

  const loadProducts = async () => {
    const data = await (window as any).api.getProducts();
    setProducts(data);
  };
  const loadPrimke = async () => {
    const data = await (window as any).api.getPrimke();
    setPrimke(data);
  };

  useEffect(() => { loadProducts(); loadPrimke(); }, []);

  const handleSaveProduct = async () => {
    const data = { ...form, cijena: parseFloat(form.cijena) };
    if (editingProduct) {
      await (window as any).api.updateProduct(editingProduct, data);
    } else {
      await (window as any).api.createProduct(data);
    }
    setShowProductDialog(false);
    setForm(emptyProduct);
    setEditingProduct(null);
    loadProducts();
  };

  const handleEditProduct = (p: Product) => {
    setEditingProduct(p.id);
    setForm({ sifra: p.sifra, naziv: p.naziv, jm: p.jm, cijena: p.cijena.toString(), pdvStopa: p.pdvStopa, barkod: p.barkod || '' });
    setShowProductDialog(true);
  };

  const handleDeleteProduct = async (id: number) => {
    await (window as any).api.deleteProduct(id);
    loadProducts();
  };

  const addPrimkaItem = () => {
    setPrimkaItems(prev => [...prev, { productId: 0, productNaziv: '', kolicina: '1', cijena: '0', pdvStopa: 'E' }]);
  };

  const handleSavePrimka = async () => {
    const data = {
      brojPrimke: primkaForm.brojPrimke,
      napomena: primkaForm.napomena,
      stavke: primkaItems.filter(i => i.productId > 0).map(i => ({
        productId: i.productId,
        kolicina: parseFloat(i.kolicina),
        cijena: parseFloat(i.cijena),
        pdvStopa: i.pdvStopa,
      })),
    };
    await (window as any).api.createPrimka(data);
    setShowPrimkaDialog(false);
    setPrimkaForm({ brojPrimke: '', napomena: '' });
    setPrimkaItems([]);
    loadPrimke();
    loadProducts();
  };

  const viewPrimka = async (id: number) => {
    const data = await (window as any).api.getPrimka(id);
    setSelectedPrimka(data);
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <Tabs defaultValue="artikli" className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="artikli">Artikli</TabsTrigger>
          <TabsTrigger value="primke">Primke</TabsTrigger>
        </TabsList>

        <TabsContent value="artikli" className="flex-1 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Artikli</h2>
            <Button onClick={() => { setEditingProduct(null); setForm(emptyProduct); setShowProductDialog(true); }}>Novi artikal</Button>
          </div>
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Šifra</TableHead>
                  <TableHead>Naziv</TableHead>
                  <TableHead>JM</TableHead>
                  <TableHead>Cijena</TableHead>
                  <TableHead>PDV</TableHead>
                  <TableHead>Stanje</TableHead>
                  <TableHead>Barkod</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.sifra}</TableCell>
                    <TableCell className="font-medium">{p.naziv}</TableCell>
                    <TableCell>{p.jm}</TableCell>
                    <TableCell>{p.cijena.toFixed(2)} KM</TableCell>
                    <TableCell><Badge variant="outline">{p.pdvStopa === 'E' ? '17%' : '0%'}</Badge></TableCell>
                    <TableCell><Badge variant={(p as any).stanje > 0 ? 'secondary' : 'destructive'}>{(p as any).stanje}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.barkod || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleEditProduct(p)}>Uredi</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteProduct(p.id)}>Obriši</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="primke" className="flex-1 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Primke</h2>
            <Button onClick={() => setShowPrimkaDialog(true)}>Nova primka</Button>
          </div>
          <div className="flex gap-4 flex-1">
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Broj</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Napomena</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {primke.map(p => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => viewPrimka(p.id)}>
                      <TableCell className="font-mono font-medium">{p.brojPrimke}</TableCell>
                      <TableCell>{new Date(p.datum).toLocaleDateString('bs-BA')}</TableCell>
                      <TableCell className="text-muted-foreground">{p.napomena || '-'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); viewPrimka(p.id); }}>Detalji</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            {selectedPrimka && (
              <Card className="w-96">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Primka #{selectedPrimka.brojPrimke}</CardTitle>
                  <p className="text-xs text-muted-foreground">{new Date(selectedPrimka.datum).toLocaleDateString('bs-BA')}</p>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Artikal</TableHead><TableHead>Kol.</TableHead><TableHead>Cijena</TableHead><TableHead>PDV</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {selectedPrimka.stavke?.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="text-sm">{s.productNaziv}</TableCell>
                          <TableCell>{s.kolicina} {s.productJm}</TableCell>
                          <TableCell>{s.cijena.toFixed(2)}</TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{s.pdvStopa === 'E' ? '17%' : '0%'}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-3 pt-3 border-t flex justify-between font-semibold text-sm">
                    <span>Ukupno:</span>
                    <span>{selectedPrimka.stavke?.reduce((s, i) => s + i.kolicina * i.cijena, 0).toFixed(2)} KM</span>
                  </div>
                  <Button variant="outline" size="sm" className="w-full mt-3" onClick={() => window.print()}>Štampaj primku</Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Product Dialog */}
      <Dialog open={showProductDialog} onOpenChange={setShowProductDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingProduct ? 'Uredi artikal' : 'Novi artikal'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Šifra</Label><Input value={form.sifra} onChange={e => setForm({...form, sifra: e.target.value})} /></div>
              <div><Label>Barkod</Label><Input value={form.barkod} onChange={e => setForm({...form, barkod: e.target.value})} /></div>
            </div>
            <div><Label>Naziv</Label><Input value={form.naziv} onChange={e => setForm({...form, naziv: e.target.value})} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>JM</Label><Input value={form.jm} onChange={e => setForm({...form, jm: e.target.value})} /></div>
              <div><Label>Cijena (KM)</Label><Input type="number" step="0.01" value={form.cijena} onChange={e => setForm({...form, cijena: e.target.value})} /></div>
              <div>
                <Label>PDV Stopa</Label>
                <Select value={form.pdvStopa} onValueChange={v => setForm({...form, pdvStopa: v as 'E' | 'K'})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="E">E - 17%</SelectItem>
                    <SelectItem value="K">K - 0%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProductDialog(false)}>Otkaži</Button>
            <Button onClick={handleSaveProduct}>Sačuvaj</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Primka Dialog */}
      <Dialog open={showPrimkaDialog} onOpenChange={setShowPrimkaDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nova primka</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Broj primke</Label><Input value={primkaForm.brojPrimke} onChange={e => setPrimkaForm({...primkaForm, brojPrimke: e.target.value})} /></div>
            <div><Label>Napomena</Label><Input value={primkaForm.napomena} onChange={e => setPrimkaForm({...primkaForm, napomena: e.target.value})} /></div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Stavke</Label>
              <Button variant="outline" size="sm" onClick={addPrimkaItem}>Dodaj stavku</Button>
            </div>
            {primkaItems.map((item, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-end">
                <div className="col-span-2">
                  <Select value={item.productId.toString()} onValueChange={v => {
                    const p = products.find(pr => pr.id === parseInt(v));
                    const newItems = [...primkaItems];
                    newItems[i] = { ...item, productId: parseInt(v), productNaziv: p?.naziv || '', cijena: p?.cijena.toString() || '0', pdvStopa: p?.pdvStopa || 'E' };
                    setPrimkaItems(newItems);
                  }}>
                    <SelectTrigger><SelectValue placeholder="Odaberi artikal" /></SelectTrigger>
                    <SelectContent>
                      {products.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.naziv} ({p.sifra})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="number" placeholder="Količina" value={item.kolicina} onChange={e => { const n = [...primkaItems]; n[i] = {...item, kolicina: e.target.value}; setPrimkaItems(n); }} />
                <Input type="number" step="0.01" placeholder="Cijena" value={item.cijena} onChange={e => { const n = [...primkaItems]; n[i] = {...item, cijena: e.target.value}; setPrimkaItems(n); }} />
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPrimkaItems(prev => prev.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowPrimkaDialog(false); setPrimkaItems([]); }}>Otkaži</Button>
            <Button onClick={handleSavePrimka}>Sačuvaj primku</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add warehouse screen with products CRUD and primka management"
```

---

### Task 10: Narudžbe (Orders) Screen

**Files:**
- Modify: `src/screens/NarudzbeScreen.tsx`

**Step 1: Build orders screen with detail view and reklamacija**

```tsx
import { useState, useEffect } from 'react';
import { Order } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

export default function NarudzbeScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [refundFiscalNumber, setRefundFiscalNumber] = useState('');

  const loadOrders = async () => {
    const data = await (window as any).api.getOrders();
    setOrders(data);
  };

  useEffect(() => { loadOrders(); }, []);

  const viewOrder = async (id: number) => {
    const data = await (window as any).api.getOrder(id);
    setSelectedOrder(data);
  };

  const handleRefund = async () => {
    if (!selectedOrder) return;

    // Print refund on Tring
    const tringData = {
      brojRacuna: selectedOrder.brojFiskalnogRacuna,
      stavke: selectedOrder.stavke?.map(s => ({
        sifra: s.productId.toString(),
        naziv: s.productNaziv || '',
        jm: s.productJm || 'kom',
        cijena: s.cijena,
        stopa: s.pdvStopa,
        kolicina: s.kolicina,
        rabat: s.rabat,
      })) || [],
    };

    const result = await (window as any).api.tringPrintRefund(tringData);
    const refundNumber = result.odgovori?.BrojFiskalnogRacuna || refundFiscalNumber;

    if (result.success) {
      await (window as any).api.refundOrder(selectedOrder.id);
      await (window as any).api.updateOrderReklamacija(selectedOrder.id, refundNumber);
      setShowRefundDialog(false);
      setRefundFiscalNumber('');
      loadOrders();
      viewOrder(selectedOrder.id);
    }
  };

  const parsePayment = (json: string) => {
    try { return JSON.parse(json); } catch { return {}; }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-semibold">Narudžbe</h2>
      <div className="flex gap-4 flex-1 min-h-0">
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Kasir</TableHead>
                <TableHead>Ukupno</TableHead>
                <TableHead>Fiskalni br.</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map(o => (
                <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50" onClick={() => viewOrder(o.id)}>
                  <TableCell className="font-mono">{o.id}</TableCell>
                  <TableCell>{new Date(o.createdAt).toLocaleString('bs-BA')}</TableCell>
                  <TableCell>{o.korisnikIme}</TableCell>
                  <TableCell className="font-semibold">{o.ukupno.toFixed(2)} KM</TableCell>
                  <TableCell className="font-mono">{o.brojFiskalnogRacuna || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'completed' ? 'secondary' : 'destructive'}>
                      {o.status === 'completed' ? 'Završeno' : 'Reklamirano'}
                    </Badge>
                    {o.brojReklamacije && <span className="text-xs text-muted-foreground ml-1">Rek: {o.brojReklamacije}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        {selectedOrder && (
          <Card className="w-96 flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">Narudžba #{selectedOrder.id}</CardTitle>
                  <p className="text-xs text-muted-foreground">{new Date(selectedOrder.createdAt).toLocaleString('bs-BA')}</p>
                </div>
                <Badge variant={selectedOrder.status === 'completed' ? 'secondary' : 'destructive'}>
                  {selectedOrder.status === 'completed' ? 'Završeno' : 'Reklamirano'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Kasir:</span> {selectedOrder.korisnikIme}</div>
                <div><span className="text-muted-foreground">Fiskalni:</span> {selectedOrder.brojFiskalnogRacuna || '-'}</div>
                {selectedOrder.brojReklamacije && <div className="col-span-2"><span className="text-muted-foreground">Reklamacija:</span> {selectedOrder.brojReklamacije}</div>}
              </div>
              <Separator />
              <ScrollArea className="flex-1">
                <Table>
                  <TableHeader><TableRow><TableHead>Artikal</TableHead><TableHead>Kol.</TableHead><TableHead>Cijena</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {selectedOrder.stavke?.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.productNaziv}</TableCell>
                        <TableCell>{s.kolicina}</TableCell>
                        <TableCell>{(s.cijena * s.kolicina).toFixed(2)} KM</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <Separator />
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">PDV:</span><span>{selectedOrder.pdvIznos.toFixed(2)} KM</span></div>
                <div className="flex justify-between font-bold text-base"><span>Ukupno:</span><span>{selectedOrder.ukupno.toFixed(2)} KM</span></div>
                <div className="text-xs text-muted-foreground">
                  Plaćanje: {Object.entries(parsePayment(selectedOrder.nacinPlacanja)).map(([k, v]) => `${k}: ${(v as number).toFixed(2)} KM`).join(', ')}
                </div>
              </div>
              {selectedOrder.status === 'completed' && selectedOrder.brojFiskalnogRacuna && (
                <Button variant="destructive" size="sm" onClick={() => setShowRefundDialog(true)}>Reklamacija</Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reklamacija računa #{selectedOrder?.brojFiskalnogRacuna}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Ovo će štampati reklamirani račun na fiskalnom printeru i vratiti artikle na stanje.</p>
          <div><Label>Broj fiskalnog za reklamaciju (opciono)</Label><Input value={refundFiscalNumber} onChange={e => setRefundFiscalNumber(e.target.value)} placeholder="Automatski iz printera" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRefundDialog(false)}>Otkaži</Button>
            <Button variant="destructive" onClick={handleRefund}>Potvrdi reklamaciju</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add orders screen with detail view and reklamacija"
```

---

### Task 11: Izvještaji (Reports) Screen

**Files:**
- Modify: `src/screens/IzvjestajiScreen.tsx`

**Step 1: Build reports screen**

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export default function IzvjestajiScreen() {
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [orders, setOrders] = useState<any[]>([]);
  const [primkeData, setPrimkeData] = useState<any[]>([]);
  const [tringMessage, setTringMessage] = useState('');

  const loadDnevni = async () => {
    const data = await (window as any).api.getReportData('dnevni', dateFrom, dateTo);
    setOrders(data);
  };

  const loadPrimke = async () => {
    const data = await (window as any).api.getReportData('primke', dateFrom, dateTo);
    setPrimkeData(data);
  };

  const handleTringXReport = async () => {
    setTringMessage('Štampanje...');
    const result = await (window as any).api.tringXReport();
    setTringMessage(result.success ? 'Presjek stanja uspješno štampan' : `Greška: ${result.error || result.vrstaOdgovora}`);
  };

  const handleTringZReport = async () => {
    setTringMessage('Štampanje...');
    const result = await (window as any).api.tringZReport();
    setTringMessage(result.success ? 'Dnevni izvještaj uspješno štampan (Z-report)' : `Greška: ${result.error || result.vrstaOdgovora}`);
  };

  const handleTringPeriodic = async () => {
    setTringMessage('Štampanje...');
    const result = await (window as any).api.tringPeriodicReport(dateFrom, dateTo);
    setTringMessage(result.success ? 'Periodični izvještaj uspješno štampan' : `Greška: ${result.error || result.vrstaOdgovora}`);
  };

  const totalSales = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.ukupno, 0);
  const totalPdv = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.pdvIznos, 0);
  const totalRefunds = orders.filter(o => o.status === 'refunded').reduce((s, o) => s + o.ukupno, 0);

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-semibold">Izvještaji</h2>

      <div className="flex gap-3 items-end">
        <div><Label>Od</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div><Label>Do</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
      </div>

      <Tabs defaultValue="prodaja" className="flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="prodaja">Promet</TabsTrigger>
          <TabsTrigger value="primke">Primke</TabsTrigger>
          <TabsTrigger value="fiskalni">Fiskalni izvještaji</TabsTrigger>
        </TabsList>

        <TabsContent value="prodaja" className="flex-1 flex flex-col gap-4">
          <Button onClick={loadDnevni} variant="outline" size="sm" className="w-fit">Učitaj</Button>
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Ukupna prodaja</p><p className="text-2xl font-bold">{totalSales.toFixed(2)} KM</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">PDV (17%)</p><p className="text-2xl font-bold">{totalPdv.toFixed(2)} KM</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Reklamacije</p><p className="text-2xl font-bold text-destructive">{totalRefunds.toFixed(2)} KM</p></CardContent></Card>
          </div>
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Ukupno</TableHead>
                  <TableHead>PDV</TableHead>
                  <TableHead>Fiskalni</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono">{o.id}</TableCell>
                    <TableCell>{new Date(o.createdAt).toLocaleString('bs-BA')}</TableCell>
                    <TableCell>{o.korisnikIme}</TableCell>
                    <TableCell className="font-semibold">{o.ukupno.toFixed(2)} KM</TableCell>
                    <TableCell>{o.pdvIznos.toFixed(2)} KM</TableCell>
                    <TableCell className="font-mono">{o.brojFiskalnogRacuna || '-'}</TableCell>
                    <TableCell>{o.status === 'completed' ? 'Završeno' : 'Reklamirano'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          <Button variant="outline" onClick={() => window.print()} className="w-fit">Štampaj izvještaj</Button>
        </TabsContent>

        <TabsContent value="primke" className="flex-1 flex flex-col gap-4">
          <Button onClick={loadPrimke} variant="outline" size="sm" className="w-fit">Učitaj</Button>
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Broj primke</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Broj stavki</TableHead>
                  <TableHead>Ukupna vrijednost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {primkeData.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium">{p.brojPrimke}</TableCell>
                    <TableCell>{new Date(p.datum).toLocaleDateString('bs-BA')}</TableCell>
                    <TableCell>{p.brojStavki}</TableCell>
                    <TableCell className="font-semibold">{(p.ukupnaVrijednost || 0).toFixed(2)} KM</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
          <Button variant="outline" onClick={() => window.print()} className="w-fit">Štampaj izvještaj</Button>
        </TabsContent>

        <TabsContent value="fiskalni" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Tring fiskalni izvještaji</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <Button onClick={handleTringXReport}>Presjek stanja (X)</Button>
                <Button onClick={handleTringZReport} variant="destructive">Dnevni izvještaj (Z)</Button>
                <Button onClick={handleTringPeriodic} variant="outline">Periodični izvještaj</Button>
              </div>
              {tringMessage && <p className={`text-sm ${tringMessage.includes('Greška') ? 'text-destructive' : 'text-green-600'}`}>{tringMessage}</p>}
              <p className="text-xs text-muted-foreground">Z-report nulira vrijednosti. Koristiti na kraju dana. Periodični za mjesečni izvještaj.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add reports screen with sales, primke, and Tring fiscal reports"
```

---

### Task 12: Postavke (Settings) Screen

**Files:**
- Modify: `src/screens/PostavkeScreen.tsx`

**Step 1: Build settings screen with user management and Tring config**

```tsx
import { useState, useEffect } from 'react';
import { User } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

export default function PostavkeScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<number | null>(null);
  const [userForm, setUserForm] = useState({ ime: '', pin: '', uloga: 'kasir' as 'admin' | 'kasir' });
  const [tringSettings, setTringSettings] = useState({ host: 'localhost', port: 8085, operatorId: 0, operatorPassword: '0' });
  const [tringStatus, setTringStatus] = useState('');

  const loadUsers = async () => { setUsers(await (window as any).api.getUsers()); };
  const loadTring = async () => { setTringSettings(await (window as any).api.getTringSettings()); };

  useEffect(() => { loadUsers(); loadTring(); }, []);

  const handleSaveUser = async () => {
    if (editingUser) {
      await (window as any).api.updateUser(editingUser, userForm);
    } else {
      await (window as any).api.createUser(userForm);
    }
    setShowUserDialog(false);
    setEditingUser(null);
    setUserForm({ ime: '', pin: '', uloga: 'kasir' });
    loadUsers();
  };

  const handleEditUser = (u: User) => {
    setEditingUser(u.id);
    setUserForm({ ime: u.ime, pin: u.pin, uloga: u.uloga });
    setShowUserDialog(true);
  };

  const handleDeleteUser = async (id: number) => {
    await (window as any).api.deleteUser(id);
    loadUsers();
  };

  const handleSaveTring = async () => {
    await (window as any).api.saveTringSettings(tringSettings);
    setTringStatus('Postavke sačuvane');
  };

  const handleTestTring = async () => {
    setTringStatus('Testiranje...');
    const result = await (window as any).api.tringInit();
    setTringStatus(result.success ? 'Povezano uspješno!' : `Greška: ${result.error || result.vrstaOdgovora}`);
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-semibold">Postavke</h2>
      <Tabs defaultValue="korisnici" className="flex-1">
        <TabsList>
          <TabsTrigger value="korisnici">Korisnici</TabsTrigger>
          <TabsTrigger value="tring">Fiskalni printer</TabsTrigger>
        </TabsList>

        <TabsContent value="korisnici" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Korisnici sistema</h3>
            <Button size="sm" onClick={() => { setEditingUser(null); setUserForm({ ime: '', pin: '', uloga: 'kasir' }); setShowUserDialog(true); }}>Novi korisnik</Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ime</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead>Uloga</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.ime}</TableCell>
                  <TableCell className="font-mono">{u.pin}</TableCell>
                  <TableCell><Badge variant={u.uloga === 'admin' ? 'default' : 'secondary'}>{u.uloga}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleEditUser(u)}>Uredi</Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(u.id)}>Obriši</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="tring" className="space-y-4">
          <Card className="max-w-lg">
            <CardHeader><CardTitle className="text-base">Tring.Fiscal.Server</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Host</Label><Input value={tringSettings.host} onChange={e => setTringSettings({...tringSettings, host: e.target.value})} /></div>
                <div><Label>Port</Label><Input type="number" value={tringSettings.port} onChange={e => setTringSettings({...tringSettings, port: parseInt(e.target.value)})} /></div>
                <div><Label>Operator ID</Label><Input type="number" value={tringSettings.operatorId} onChange={e => setTringSettings({...tringSettings, operatorId: parseInt(e.target.value)})} /></div>
                <div><Label>Lozinka</Label><Input value={tringSettings.operatorPassword} onChange={e => setTringSettings({...tringSettings, operatorPassword: e.target.value})} /></div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveTring}>Sačuvaj</Button>
                <Button variant="outline" onClick={handleTestTring}>Testiraj konekciju</Button>
              </div>
              {tringStatus && <p className={`text-sm ${tringStatus.includes('Greška') ? 'text-destructive' : 'text-green-600'}`}>{tringStatus}</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingUser ? 'Uredi korisnika' : 'Novi korisnik'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Ime</Label><Input value={userForm.ime} onChange={e => setUserForm({...userForm, ime: e.target.value})} /></div>
            <div><Label>PIN</Label><Input value={userForm.pin} onChange={e => setUserForm({...userForm, pin: e.target.value})} maxLength={6} /></div>
            <div>
              <Label>Uloga</Label>
              <Select value={userForm.uloga} onValueChange={v => setUserForm({...userForm, uloga: v as 'admin' | 'kasir'})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kasir">Kasir</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDialog(false)}>Otkaži</Button>
            <Button onClick={handleSaveUser}>Sačuvaj</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add settings screen with user management and Tring config"
```

---

### Task 13: Print Styles & Final Polish

**Files:**
- Modify: `src/index.css`

**Step 1: Add print styles**

Append to `src/index.css`:
```css
@media print {
  body { overflow: visible; }
  aside { display: none !important; }
  .no-print { display: none !important; }
  main { margin: 0; padding: 20px; }
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add print styles for reports"
```

---

### Task 14: Window Type Declarations

**Files:**
- Create: `src/global.d.ts`

**Step 1: Add type declarations for window.api and Vite globals**

```ts
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

interface Window {
  api: {
    login: (pin: string) => Promise<any>;
    getUsers: () => Promise<any[]>;
    createUser: (data: any) => Promise<any>;
    updateUser: (id: number, data: any) => Promise<any>;
    deleteUser: (id: number) => Promise<any>;
    getProducts: () => Promise<any[]>;
    getProduct: (id: number) => Promise<any>;
    createProduct: (data: any) => Promise<any>;
    updateProduct: (id: number, data: any) => Promise<any>;
    deleteProduct: (id: number) => Promise<any>;
    searchProducts: (query: string) => Promise<any[]>;
    getStock: (productId: number) => Promise<number>;
    getPrimke: () => Promise<any[]>;
    getPrimka: (id: number) => Promise<any>;
    createPrimka: (data: any) => Promise<any>;
    getOrders: () => Promise<any[]>;
    getOrder: (id: number) => Promise<any>;
    createOrder: (data: any) => Promise<any>;
    updateOrderReklamacija: (id: number, broj: string) => Promise<any>;
    refundOrder: (id: number) => Promise<any>;
    tringInit: () => Promise<any>;
    tringPrintReceipt: (data: any) => Promise<any>;
    tringPrintRefund: (data: any) => Promise<any>;
    tringXReport: () => Promise<any>;
    tringZReport: () => Promise<any>;
    tringPeriodicReport: (from: string, to: string) => Promise<any>;
    tringWriteArticle: (data: any) => Promise<any>;
    getTringSettings: () => Promise<any>;
    saveTringSettings: (data: any) => Promise<any>;
    getReportData: (type: string, from: string, to: string) => Promise<any[]>;
  };
}
```

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add TypeScript declarations for window.api and Vite globals"
```

---

## Task Execution Order

Tasks 1-5 are **sequential** (foundation, then ShadCN, then DB, then IPC, then Tring).
Tasks 6-12 can be done **sequentially** after 5 (they depend on the foundation).
Tasks 13-14 are cleanup/polish.
