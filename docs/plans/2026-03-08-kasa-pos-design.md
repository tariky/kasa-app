# Kasa POS — Design Document

## Overview
POS cashier app for Bosnian market. Electron Forge + TypeScript + React + ShadCN UI. Full Bosnian UI. Tring fiscal printer integration. SQLite local database.

## Architecture
```
Renderer (React + ShadCN + Tailwind)  ←IPC→  Main Process (Electron)
                                                 ├── SQLite (better-sqlite3)
                                                 └── HTTP/XML → Tring.Fiscal.Server:8085
```

## Tring Fiscal Printer Integration
- HTTP/XML communication to Tring.Fiscal.Server (default localhost:8085)
- PDV tax rates: E = 17% (opća stopa), K = 0% (oslobođeno PDV)
- Articles synced via UpisiArtikal (PLU, Sifra, Naziv, JM, Cijena, Stopa)
- StampatiFiskalniRacun returns BrojFiskalnogRacuna
- StampatiReklamiraniRacun for returns (requires original BrojRacuna)
- Reports: PresjekStanja (X-report), DnevniIzvjestaj (Z-report), PeriodicniIzvjestaj
- Payment types: Gotovina, Cek, Kartica, Virman (split payments supported)
- Inicijalizacija required on startup (operator login)

## Screens

### 1. PIN Login
- PIN pad for cashier login
- Multi-user support (admin/kasir roles)

### 2. Kasa (POS)
- Product search by name/barcode/sifra
- Cart with quantities, rabat (discount)
- PDV breakdown (E/K)
- Payment type selection (split payments)
- Finalize: sync articles to Tring → print fiscal receipt → deduct stock → store BrojFiskalnogRacuna

### 3. Skladište (Warehouse)
- Product CRUD (sifra, naziv, jm, cijena, pdvStopa, barkod)
- Stock levels per product
- "Nova primka" — inventory receiving sheet
  - Lists items: količina, cijena, PDV stopa, datum
  - Adds stock on creation
  - Printable for bookkeeping

### 4. Narudžbe (Orders)
- Order history with fiscal numbers
- Order detail: items, totals, PDV breakdown, payment method, cashier
- Reklamacija: enter original fiscal number → print return via Tring → restore stock
- Store both BrojFiskalnogRacuna and return fiscal number

### 5. Izvještaji (Reports)
- Trigger Tring reports: X-report, Z-report, periodic
- App reports: dnevni promet, PDV pregled, primke list
- Print-friendly HTML layout

### 6. Postavke (Settings)
- Tring server config (IP, port)
- User management (add/edit/delete cashiers with PINs)

## Data Model

### users
id, ime, pin, uloga (admin/kasir), createdAt

### products
id, sifra, naziv, jm, cijena, pdvStopa (E/K), plu, barkod, createdAt, updatedAt

### primke (inventory sheets)
id, brojPrimke, datum, napomena, createdAt

### primka_stavke
id, primkaId, productId, kolicina, cijena, pdvStopa, createdAt

### orders
id, datum, korisnikId, ukupno, pdvIznos, nacinPlacanja (JSON), brojFiskalnogRacuna, brojReklamacije, status, createdAt

### order_items
id, orderId, productId, kolicina, cijena, rabat, pdvStopa

### stock_movements
id, productId, tip (ulaz/izlaz), kolicina, referenceType, referenceId, createdAt

## Tech Stack
- Electron Forge + Vite
- React 18 + TypeScript
- ShadCN UI + Tailwind CSS
- better-sqlite3 (SQLite)
- HTTP/XML client for Tring.Fiscal.Server
- Bun package manager
