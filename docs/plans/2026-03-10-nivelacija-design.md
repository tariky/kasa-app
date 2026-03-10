# Nivelacija (Price Adjustment) — Design

## Context

Under Bosnian fiscal law, a retail store cannot have the same product at two different selling prices simultaneously. When a new delivery (primka) arrives with a different selling price, the existing stock must be formally revalued via a **Nivelacija** (Zapisnik o promjeni cijena) before the new price takes effect.

Currently the app does not handle this — primka saves do not update `products.cijena`, leaving the system out of sync.

## Database

### New tables

```sql
nivelacije
├── id (PK, AUTOINCREMENT)
├── brojNivelacije (TEXT, UNIQUE — e.g. "NIV-2026-001")
├── datum (TEXT, NOT NULL)
├── primkaId (INTEGER, FK → primke, nullable)
├── napomena (TEXT)
├── createdAt (TEXT, DEFAULT datetime)

nivelacija_stavke
├── id (PK, AUTOINCREMENT)
├── nivelacijaId (INTEGER, FK → nivelacije)
├── productId (INTEGER, FK → products)
├── kolicina (REAL — existing stock at time of nivelacija)
├── staraCijena (REAL — old selling price)
├── novaCijena (REAL — new selling price)
├── razlika (REAL — novaCijena - staraCijena, per unit)
├── ukupnaRazlika (REAL — razlika × kolicina)
├── pdvStopa (TEXT)
```

### Existing table changes

- `products.cijena` is updated to `novaCijena` when nivelacija is confirmed (within the same transaction as the primka save).

## Workflow: Primka Save Flow

1. User saves a primka with stavke (each has nabavnaCijena and cijena).
2. For each stavka, compare `stavka.cijena` with `products.cijena`.
3. **If no differences** — save primka normally.
4. **If differences exist** — show confirmation dialog:
   - Lists affected products: naziv, current stock qty, old price, new price, difference/unit, total difference.
   - Two buttons: "Sačuvaj sa nivelacijom" / "Otkaži".
   - No option to skip nivelacija (legally required).
5. **On confirm** — single DB transaction:
   - Save primka + stavke + stock movements (existing logic).
   - Create `nivelacije` record linked to this primka.
   - Create `nivelacija_stavke` for each product with price difference.
   - Update `products.cijena` to new price for each affected product.

## Izvještaji: Nivelacije Tab

New 4th tab in IzvjestajiScreen ("Nivelacije"):

- Date range picker (reuses existing).
- Summary cards: Broj nivelacija, Ukupno pozitivna razlika, Ukupno negativna razlika.
- Table: brojNivelacije, datum, linked primka number, stavki count, total razlika (+/-).
- Click row to expand — shows individual stavke (product, qty, old→new price, razlika).

## PDF: Zapisnik o promjeni cijena

Printable/exportable PDF for inspectors:

- Header: firma info (from settings).
- Title: "ZAPISNIK O PROMJENI CIJENA (NIVELACIJA)" + brojNivelacije.
- Date, linked primka number.
- Table columns: Rb, Šifra, Naziv, JM, Količina, Stara cijena, Nova cijena, Razlika/jed, Ukupna razlika.
- Footer totals: Ukupna pozitivna razlika, Ukupna negativna razlika, PDV on the difference.
- Signature line (potpis ovlaštenog lica).
- Export button in the expanded row or detail view.

## Out of Scope

- Tring fiscal device price sync (not included per user request).
- Manual nivelacija creation outside of primka flow.
- FIFO cost tracking / batch-level cost separation.
