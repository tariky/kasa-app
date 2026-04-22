# Firma Bank Accounts — Design

## Summary

Add up to three bank accounts (bank name + account number) to Firma settings. Populated accounts are rendered on the invoice (RacunPdf) in a dedicated "Žiro računi" section. Empty slots are omitted; the entire section is hidden if no accounts are defined.

## Scope

- Extend `firma` settings with 3 optional `BankAccount` slots.
- Add a "Bankovni računi" card to the Firma tab in `PostavkeScreen`.
- Render a "Žiro računi" / "Bank accounts" section on `RacunPdf`.
- Persist via existing `settings` key-value table.

Out of scope: SWIFT/BIC, IBAN validation, per-invoice selection of which accounts to show, support for more than 3 accounts.

## Data Shape

```ts
type BankAccount = { bankName: string; accountNumber: string };
```

`getFirmaSettings` response (extended):

```ts
{
  naziv: string; adresa: string; grad: string;
  idBroj: string; pdvBroj: string; skladiste: string; logo: string;
  bankAccounts: BankAccount[]; // length 0–3; only non-empty entries
}
```

`saveFirmaSettings` payload accepts the same shape. The handler receives a full 3-element array from the UI (padded with empty strings) and persists all 6 keys; the getter filters out empty entries before returning.

## Storage

Six new rows in the existing `settings(key, value)` table:

- `firma.bank1.name`, `firma.bank1.number`
- `firma.bank2.name`, `firma.bank2.number`
- `firma.bank3.name`, `firma.bank3.number`

No schema migration required — rows appear on first save. Matches the existing `firma.*` flat-key convention in `src/ipc/handlers.ts:741-747`.

## IPC Layer (`src/ipc/handlers.ts`)

**`settings:getFirma`** (around line 701):
Read the 6 bank keys alongside the existing firma keys. Build a 3-element working array, then filter out entries where both fields are empty, and return as `bankAccounts`.

**`settings:saveFirma`** (around line 733):
Extend the typed payload to include `bankAccounts: BankAccount[]`. In the transaction, pad the array to length 3 (missing or empty slots written as empty strings) and upsert all 6 keys.

## Type & Preload

- `src/types.ts`: export `BankAccount`.
- `src/global.d.ts`: update the `getFirmaSettings` return type and `saveFirmaSettings` argument type to include `bankAccounts: BankAccount[]`. Replace the inline object literal with a named `FirmaSettings` type exported from `src/types.ts` to keep the shape in one place.
- `src/preload.ts`: no changes — existing channels are generic `ipcRenderer.invoke`.

## Settings UI (`src/screens/PostavkeScreen.tsx`)

**State**: replace the temptation to use 6 separate `useState`s with a single `firmaBankAccounts: BankAccount[]` state initialised to `[{bankName:'',accountNumber:''}, ×3]`.

**Load** (extend the `getFirmaSettings` effect around line 103): populate the array from `s.bankAccounts`, padding to length 3 with empty entries.

**Save** (extend `handleSaveFirma` around line 182): include `bankAccounts: firmaBankAccounts` in the payload.

**Layout**: new card after the "Fiskalni identifikatori" card (around line 818), matching sibling styling:

```
┌──────────────────────────────────────────────────┐
│ 🏦  Bankovni računi                              │
│     Prikazuju se na računima i dokumentima       │
├──────────────────────────────────────────────────┤
│ RAČUN 1                                          │
│ [ Naziv banke       ]  [ Broj računa           ] │
│ RAČUN 2                                          │
│ [ Naziv banke       ]  [ Broj računa           ] │
│ RAČUN 3                                          │
│ [ Naziv banke       ]  [ Broj računa           ] │
└──────────────────────────────────────────────────┘
```

- Card header icon: `Landmark` (lucide-react) in an amber-50 tile with amber-500 icon, matching the "Backup" card's accent family and distinguishing it from the existing blue/violet/emerald firma cards.
- Each row: two-column grid, same `h-9 bg-slate-50 border-slate-200` input styling as other firma fields.
- No add/remove buttons — three fixed slots.
- No separate save button; saved with the existing "Spremi postavke firme" action.

## PDF Placement (`src/components/RacunPdf.tsx`)

**Type extension**:

```ts
export interface RacunPdfProps {
  order: Order;
  firma: { /* existing fields */; bankAccounts: BankAccount[] };
  lang?: InvoiceLang;
}
```

**Translations**:

```ts
bs: { bankAccounts: 'Žiro računi', /* … */ }
en: { bankAccounts: 'Bank accounts', /* … */ }
```

**Rendering**: a new `<View>` inserted between the totals block (ends line 454) and the reklamacija box (starts line 457). Renders only if `firma.bankAccounts.length > 0`.

Styling (new entries in the `s` StyleSheet):

- `bankAccountsWrap`: `marginTop: 18`, no border, label + rows.
- `bankAccountsLabel`: reuse `metaLabel` style (`fontSize: 7, FB, uppercase, letterSpacing: 1, color: #888`).
- `bankAccountRow`: `flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2`.
- `bankName`: `fontSize: 8.5, color: #333`.
- `bankNumber`: `fontSize: 8.5, fontFamily: FB, color: #000` (bold/mono-feel to emphasise the number).

```jsx
{firma.bankAccounts.length > 0 && (
  <View style={s.bankAccountsWrap}>
    <Text style={s.bankAccountsLabel}>{t.bankAccounts}</Text>
    {firma.bankAccounts.map((b, i) => (
      <View key={i} style={s.bankAccountRow}>
        <Text style={s.bankName}>{b.bankName}</Text>
        <Text style={s.bankNumber}>{b.accountNumber}</Text>
      </View>
    ))}
  </View>
)}
```

**Call sites**: all existing callers that render `RacunPdf` load the firma payload via `getFirmaSettings`. They automatically receive `bankAccounts`. No changes needed at call sites beyond TypeScript picking up the new field.

## Backwards Compatibility

- Existing users with no bank accounts: `getFirmaSettings` returns `bankAccounts: []`. The settings UI shows three empty rows. The PDF renders exactly as before.
- No migration step needed. Six upsert calls happen the first time the user saves the Firma tab.

## Testing

Manual verification only (matches existing repo patterns — no unit tests exist for these screens):

1. Fresh install / existing DB: Firma tab loads without error; three empty bank rows visible.
2. Fill 0, 1, 2, 3 accounts → save → reload app → values persist.
3. Generate a PDF invoice from NarudzbeScreen for each case: 0 accounts → no section; 1–3 → section shows populated rows only.
4. Clear a previously filled account (both fields blank) → save → PDF omits that row on next generation.
5. English-language PDF path renders "Bank accounts" instead of "Žiro računi".

## Files Changed

- `src/types.ts` — add `BankAccount` and `FirmaSettings` types.
- `src/global.d.ts` — replace inline firma object literals with `FirmaSettings` references.
- `src/ipc/handlers.ts` — extend get/save handlers.
- `src/screens/PostavkeScreen.tsx` — new state, new card, extended load/save.
- `src/components/RacunPdf.tsx` — new prop, translations, render block, styles.
