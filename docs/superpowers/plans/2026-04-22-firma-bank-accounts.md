# Firma Bank Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add up to 3 bank accounts (bank name + account number) to Firma settings and render them on the invoice PDF.

**Architecture:** Flat `firma.bankN.{name,number}` keys in the existing `settings` KV table (6 rows total). A new typed `FirmaSettings` shape flows from IPC → PostavkeScreen UI and from IPC → RacunPdf. The PDF renders a new "Žiro računi" block only when at least one account is populated.

**Tech Stack:** Electron Forge + Vite, TypeScript, React, better-sqlite3 (settings table), @react-pdf/renderer, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-04-22-firma-bank-accounts-design.md`

**Notes on testing:** This repo has no unit-test framework configured. Each task is verified with `bunx tsc --noEmit` for type safety, and the final task runs the app manually to exercise the UI and PDF. No new test runner is introduced (YAGNI).

---

## Task 1: Add `BankAccount` and `FirmaSettings` types

**Files:**
- Modify: `src/types.ts` (append at end of file)
- Modify: `src/global.d.ts:60-61`

- [ ] **Step 1: Add types to `src/types.ts`**

Append to the bottom of `src/types.ts`:

```ts
export interface BankAccount {
  bankName: string;
  accountNumber: string;
}

export interface FirmaSettings {
  naziv: string;
  adresa: string;
  grad: string;
  idBroj: string;
  pdvBroj: string;
  skladiste: string;
  logo: string;
  bankAccounts: BankAccount[];
}
```

- [ ] **Step 2: Replace the inline firma type in `src/global.d.ts`**

Current (line 60):

```ts
    getFirmaSettings: () => Promise<{ naziv: string; adresa: string; grad: string; idBroj: string; pdvBroj: string; skladiste: string; logo: string }>;
    saveFirmaSettings: (data: any) => Promise<any>;
```

Replace with:

```ts
    getFirmaSettings: () => Promise<import('./types').FirmaSettings>;
    saveFirmaSettings: (data: import('./types').FirmaSettings) => Promise<{ success: boolean }>;
```

`global.d.ts` is an ambient declaration file with no existing top-level imports, so inline `import('./types')` is the right form here — no need to change the top of the file.

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: No new errors introduced. The existing screens that call `getFirmaSettings()` should still compile because the new field `bankAccounts` is additive — any destructuring like `const { naziv, adresa, ... } = s` ignores it.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/global.d.ts
git commit -m "types: add BankAccount and FirmaSettings"
```

---

## Task 2: Extend IPC handlers to read/write bank accounts

**Files:**
- Modify: `src/ipc/handlers.ts:701-720` (`settings:getFirma`)
- Modify: `src/ipc/handlers.ts:733-751` (`settings:saveFirma`)

- [ ] **Step 1: Replace `settings:getFirma` handler**

Current (lines 701-720):

```ts
  handle('settings:getFirma', () => {
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'firma.%'")
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key.replace('firma.', '')] = row.value;
    }

    return {
      naziv: settings.naziv ?? '',
      adresa: settings.adresa ?? '',
      grad: settings.grad ?? '',
      idBroj: settings.idBroj ?? '',
      pdvBroj: settings.pdvBroj ?? '',
      skladiste: settings.skladiste ?? '',
      logo: settings.logo ?? '',
    };
  });
```

Replace with:

```ts
  handle('settings:getFirma', () => {
    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'firma.%'")
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key.replace('firma.', '')] = row.value;
    }

    const bankAccounts = [1, 2, 3]
      .map(i => ({
        bankName: settings[`bank${i}.name`] ?? '',
        accountNumber: settings[`bank${i}.number`] ?? '',
      }))
      .filter(b => b.bankName.trim() !== '' || b.accountNumber.trim() !== '');

    return {
      naziv: settings.naziv ?? '',
      adresa: settings.adresa ?? '',
      grad: settings.grad ?? '',
      idBroj: settings.idBroj ?? '',
      pdvBroj: settings.pdvBroj ?? '',
      skladiste: settings.skladiste ?? '',
      logo: settings.logo ?? '',
      bankAccounts,
    };
  });
```

- [ ] **Step 2: Replace `settings:saveFirma` handler**

Current (lines 733-751):

```ts
  handle('settings:saveFirma', (data: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
  }) => {
    const save = db.transaction(() => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('firma.naziv', data.naziv);
      upsert.run('firma.adresa', data.adresa);
      upsert.run('firma.grad', data.grad);
      upsert.run('firma.idBroj', data.idBroj);
      upsert.run('firma.pdvBroj', data.pdvBroj);
      upsert.run('firma.skladiste', data.skladiste);
      upsert.run('firma.logo', data.logo);
    });
    save();
    return { success: true };
  });
```

Replace with:

```ts
  handle('settings:saveFirma', (data: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
    bankAccounts?: Array<{ bankName: string; accountNumber: string }>;
  }) => {
    const save = db.transaction(() => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      upsert.run('firma.naziv', data.naziv);
      upsert.run('firma.adresa', data.adresa);
      upsert.run('firma.grad', data.grad);
      upsert.run('firma.idBroj', data.idBroj);
      upsert.run('firma.pdvBroj', data.pdvBroj);
      upsert.run('firma.skladiste', data.skladiste);
      upsert.run('firma.logo', data.logo);

      const accounts = data.bankAccounts ?? [];
      for (let i = 0; i < 3; i++) {
        const a = accounts[i] ?? { bankName: '', accountNumber: '' };
        upsert.run(`firma.bank${i + 1}.name`, a.bankName ?? '');
        upsert.run(`firma.bank${i + 1}.number`, a.accountNumber ?? '');
      }
    });
    save();
    return { success: true };
  });
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ipc/handlers.ts
git commit -m "ipc: read/write up to 3 firma bank accounts"
```

---

## Task 3: Add "Bankovni računi" card to Firma tab

**Files:**
- Modify: `src/screens/PostavkeScreen.tsx:22` (icon imports)
- Modify: `src/screens/PostavkeScreen.tsx:49-50` (state)
- Modify: `src/screens/PostavkeScreen.tsx:103-113` (load effect)
- Modify: `src/screens/PostavkeScreen.tsx:182-190` (save handler)
- Modify: `src/screens/PostavkeScreen.tsx:818` (insert new card before Save button)

- [ ] **Step 1: Import the `Landmark` icon and `BankAccount` type**

Current (line 22, end of lucide-react import block):

```tsx
  HardDrive, Download, Bug, RefreshCw, X, ChevronDown, ChevronUp, Settings,
} from 'lucide-react';
```

Replace with:

```tsx
  HardDrive, Download, Bug, RefreshCw, X, ChevronDown, ChevronUp, Settings, Landmark,
} from 'lucide-react';
```

And extend the existing types import on line 16 from:

```tsx
import { User, TringSettings } from '@/types';
```

to:

```tsx
import { User, TringSettings, BankAccount } from '@/types';
```

- [ ] **Step 2: Add state for bank accounts**

After line 49 (`const [firmaLogo, setFirmaLogo] = useState('');`), add:

```tsx
  const [firmaBankAccounts, setFirmaBankAccounts] = useState<BankAccount[]>([
    { bankName: '', accountNumber: '' },
    { bankName: '', accountNumber: '' },
    { bankName: '', accountNumber: '' },
  ]);
```

- [ ] **Step 3: Populate state when firma settings load**

Current (lines 103-113):

```tsx
  useEffect(() => {
    window.api.getFirmaSettings().then((s) => {
      setFirmaNaziv(s.naziv);
      setFirmaAdresa(s.adresa);
      setFirmaGrad(s.grad);
      setFirmaIdBroj(s.idBroj);
      setFirmaPdvBroj(s.pdvBroj);
      setFirmaSkladiste(s.skladiste);
      setFirmaLogo(s.logo);
    });
  }, []);
```

Replace with:

```tsx
  useEffect(() => {
    window.api.getFirmaSettings().then((s) => {
      setFirmaNaziv(s.naziv);
      setFirmaAdresa(s.adresa);
      setFirmaGrad(s.grad);
      setFirmaIdBroj(s.idBroj);
      setFirmaPdvBroj(s.pdvBroj);
      setFirmaSkladiste(s.skladiste);
      setFirmaLogo(s.logo);

      const padded: BankAccount[] = [0, 1, 2].map(i =>
        s.bankAccounts[i] ?? { bankName: '', accountNumber: '' }
      );
      setFirmaBankAccounts(padded);
    });
  }, []);
```

- [ ] **Step 4: Include bank accounts in the save payload**

Current (lines 182-190):

```tsx
  const handleSaveFirma = async () => {
    await window.api.saveFirmaSettings({
      naziv: firmaNaziv, adresa: firmaAdresa, grad: firmaGrad,
      idBroj: firmaIdBroj, pdvBroj: firmaPdvBroj,
      skladiste: firmaSkladiste, logo: firmaLogo,
    });
    setFirmaStatus('Postavke firme spremljene!');
    setTimeout(() => setFirmaStatus(''), 3000);
  };
```

Replace with:

```tsx
  const handleSaveFirma = async () => {
    const cleanedAccounts = firmaBankAccounts
      .map(a => ({ bankName: a.bankName.trim(), accountNumber: a.accountNumber.trim() }))
      .filter(a => a.bankName !== '' || a.accountNumber !== '');
    await window.api.saveFirmaSettings({
      naziv: firmaNaziv, adresa: firmaAdresa, grad: firmaGrad,
      idBroj: firmaIdBroj, pdvBroj: firmaPdvBroj,
      skladiste: firmaSkladiste, logo: firmaLogo,
      bankAccounts: cleanedAccounts,
    });
    setFirmaStatus('Postavke firme spremljene!');
    setTimeout(() => setFirmaStatus(''), 3000);
  };
```

- [ ] **Step 5: Insert the "Bankovni računi" card**

In the Firma tab, between the "Fiskalni identifikatori" card (closing `</div>` around line 818) and the "Save button + status" block (around line 821), insert this new card:

```tsx
                {/* Bank accounts card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                        <Landmark size={20} className="text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Bankovni računi</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Prikazuju se na računima (do 3 računa)</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    {firmaBankAccounts.map((acc, i) => (
                      <div key={i} className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Račun {i + 1}
                        </Label>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            value={acc.bankName}
                            onChange={e => setFirmaBankAccounts(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], bankName: e.target.value };
                              return next;
                            })}
                            placeholder="Naziv banke"
                            className="text-[13px] h-9 bg-slate-50 border-slate-200"
                          />
                          <Input
                            value={acc.accountNumber}
                            onChange={e => setFirmaBankAccounts(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], accountNumber: e.target.value };
                              return next;
                            })}
                            placeholder="Broj računa"
                            className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
```

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Lint**

Run: `bun run lint`
Expected: No new errors in `PostavkeScreen.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/screens/PostavkeScreen.tsx
git commit -m "ui(postavke): add bank accounts card to Firma tab"
```

---

## Task 4: Render bank accounts on RacunPdf

**Files:**
- Modify: `src/components/RacunPdf.tsx:3` (imports)
- Modify: `src/components/RacunPdf.tsx:8-20` (props)
- Modify: `src/components/RacunPdf.tsx:22-79` (translations)
- Modify: `src/components/RacunPdf.tsx:85-306` (styles — add new entries)
- Modify: `src/components/RacunPdf.tsx:454-456` (insert rendering block)

- [ ] **Step 1: Import `BankAccount`**

Current (line 3):

```tsx
import { Order, OrderItem } from '@/types';
```

Replace with:

```tsx
import { Order, OrderItem, BankAccount } from '@/types';
```

- [ ] **Step 2: Add `bankAccounts` to props**

Current (lines 8-20):

```tsx
export interface RacunPdfProps {
  order: Order;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    skladiste: string;
    logo: string;
  };
  lang?: InvoiceLang;
}
```

Replace with:

```tsx
export interface RacunPdfProps {
  order: Order;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    skladiste: string;
    logo: string;
    bankAccounts: BankAccount[];
  };
  lang?: InvoiceLang;
}
```

- [ ] **Step 3: Add translations**

In the `bs` block (inside `translations`, around line 49), add one line before the closing `},`:

```tsx
    paymentBoth: 'Gotovina + Kartica',
    bankAccounts: 'Žiro računi',
  },
```

In the `en` block (around line 77), add one line before the closing `},`:

```tsx
    paymentBoth: 'Cash + Card',
    bankAccounts: 'Bank accounts',
  },
```

- [ ] **Step 4: Add styles**

In the `s` StyleSheet (after the `reklamacijaTitle` entry around line 291 and before the `/* ── Footer ── */` comment), add:

```ts
  /* ── Bank accounts ── */
  bankAccountsWrap: {
    marginTop: 18,
  },
  bankAccountsLabel: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#888',
    marginBottom: 4,
  },
  bankAccountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  bankName: {
    fontSize: 8.5,
    color: '#333',
  },
  bankNumber: {
    fontSize: 8.5,
    fontFamily: FB,
    fontWeight: 700,
    color: '#000',
  },
```

- [ ] **Step 5: Render the block**

Find the end of the totals block (around line 454, ending with `</View>` that closes `totalsWrap`) and the start of the reklamacija block (around line 456). Insert between them:

```tsx
        {/* ── Bank accounts ── */}
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

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: No errors. (The IPC getter now returns `bankAccounts: BankAccount[]`, so all call sites pass the right shape through `firma={firma}` automatically.)

- [ ] **Step 7: Lint**

Run: `bun run lint`
Expected: No new errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/RacunPdf.tsx
git commit -m "racun: render firma bank accounts on invoice pdf"
```

---

## Task 5: Manual verification

**Files:** none (runtime check)

- [ ] **Step 1: Start the app**

Run: `bun run start`
Expected: App launches to the login/kasa screen without console errors.

- [ ] **Step 2: Verify empty state on Firma tab**

Navigate to Postavke → Firma. Scroll to the new "Bankovni računi" card.
Expected: three empty rows labelled "Račun 1 / 2 / 3", each with two empty inputs (Naziv banke, Broj računa).

- [ ] **Step 3: Save with zero accounts → generate a PDF**

Leave all 3 rows empty, click "Spremi postavke firme", confirm "Postavke firme spremljene!" appears.
Go to Narudžbe, pick any completed order, generate/open PDF.
Expected: invoice renders exactly as before — **no "Žiro računi" section**.

- [ ] **Step 4: Save with 1 account → generate a PDF**

Back on Firma tab, fill only Račun 1 (e.g., "Raiffeisen Bank" / "1610000000000001"), save. Generate PDF again.
Expected: the invoice shows a "Žiro računi" section above the footer with one row: `Raiffeisen Bank` on the left, `1610000000000001` on the right (bank number bolded).

- [ ] **Step 5: Save with all 3 accounts → generate a PDF**

Fill all 3 rows with distinct values. Save. Generate PDF.
Expected: three rows appear under "Žiro računi" in order 1 → 2 → 3.

- [ ] **Step 6: Verify persistence**

Close the app completely, reopen, go back to Postavke → Firma.
Expected: all 3 bank accounts are still populated with the values entered.

- [ ] **Step 7: Clear middle slot → verify it drops out**

Empty both fields of Račun 2, save. Generate PDF.
Expected: only the other two accounts render on the invoice (the middle one is gone); the settings UI still shows three slots, with Račun 2 blank.

- [ ] **Step 8: Verify English PDF**

If any call site invokes `RacunPdf` with `lang="en"`, generate that variant (otherwise skip).
Expected: section header reads "Bank accounts" instead of "Žiro računi".

- [ ] **Step 9: Final commit (if any touch-ups were needed)**

If manual verification caught an issue and you fixed it, commit the fix. Otherwise skip.

---

## Summary of files changed

- `src/types.ts` — `BankAccount`, `FirmaSettings` types (Task 1)
- `src/global.d.ts` — typed firma IPC signatures (Task 1)
- `src/ipc/handlers.ts` — extended getFirma + saveFirma (Task 2)
- `src/screens/PostavkeScreen.tsx` — state, load, save, new card (Task 3)
- `src/components/RacunPdf.tsx` — prop, translations, styles, render block (Task 4)
