# Ulaz Robe Editing, PDF Reports & Business Settings

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ulaz robe editing/deleting, business settings in Postavke, and A4 PDF generation for ulaz robe documents using @react-pdf/renderer.

**Architecture:** Business info stored as key-value pairs in existing settings table (firma.* prefix). Primka edit reuses the NovaPrimkaDialog with pre-filled data. PDF generated client-side with @react-pdf/renderer, exported via Electron's dialog.showSaveDialog.

**Tech Stack:** @react-pdf/renderer, Electron dialog API, existing SQLite settings table

---

### Task 1: Install @react-pdf/renderer

**Step 1: Install dependency**

Run: `bun add @react-pdf/renderer`

**Step 2: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @react-pdf/renderer dependency"
```

---

### Task 2: Business Settings — Backend

**Files:**
- Modify: `src/ipc/handlers.ts` (after line 397, settings section)
- Modify: `src/preload.ts` (line 49, settings section)
- Modify: `src/global.d.ts` (line 39, settings types)

**Step 1: Add IPC handlers for firma settings**

In `src/ipc/handlers.ts`, after the `settings:saveTring` handler (~line 397), add:

```typescript
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

handle('settings:saveFirma', (data: {
  naziv: string; adresa: string; grad: string;
  idBroj: string; pdvBroj: string; skladiste: string; logo: string;
}) => {
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
  return { success: true };
});
```

**Step 2: Add preload bridge**

In `src/preload.ts`, after `saveTringSettings` (line 50):

```typescript
getFirmaSettings: () => ipcRenderer.invoke('settings:getFirma'),
saveFirmaSettings: (data: any) => ipcRenderer.invoke('settings:saveFirma', data),
```

**Step 3: Add type declarations**

In `src/global.d.ts`, after `saveTringSettings` (line 40):

```typescript
getFirmaSettings: () => Promise<{ naziv: string; adresa: string; grad: string; idBroj: string; pdvBroj: string; skladiste: string; logo: string }>;
saveFirmaSettings: (data: any) => Promise<any>;
```

**Step 4: Verify**

Run: `bun run tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat: add firma (business) settings backend"
```

---

### Task 3: Business Settings — UI (Postavke → Firma tab)

**Files:**
- Modify: `src/screens/PostavkeScreen.tsx`

**Step 1: Add Firma tab to PostavkeScreen**

Add state variables for firma settings (after existing tring state ~line 48):

```typescript
const [firmaNaziv, setFirmaNaziv] = useState('');
const [firmaAdresa, setFirmaAdresa] = useState('');
const [firmaGrad, setFirmaGrad] = useState('');
const [firmaIdBroj, setFirmaIdBroj] = useState('');
const [firmaPdvBroj, setFirmaPdvBroj] = useState('');
const [firmaSkladiste, setFirmaSkladiste] = useState('');
const [firmaLogo, setFirmaLogo] = useState('');
const [firmaStatus, setFirmaStatus] = useState('');
```

Add load effect (extend existing useEffect or add new one):

```typescript
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

Add save handler:

```typescript
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

Add logo file handler (converts to base64):

```typescript
const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setFirmaLogo(reader.result as string);
  reader.readAsDataURL(file);
};
```

Add third TabsTrigger in TabsList (~line 165):

```tsx
<TabsTrigger value="firma">Firma</TabsTrigger>
```

Add TabsContent for Firma (after fiskalni TabsContent):

```tsx
<TabsContent value="firma" className="space-y-4">
  <h2 className="text-lg font-semibold">Podaci o firmi</h2>
  <Card>
    <CardContent className="pt-6 space-y-4">
      <div className="space-y-2">
        <Label>Logo firme</Label>
        {firmaLogo && (
          <div className="mb-2">
            <img src={firmaLogo} alt="Logo" className="h-16 object-contain" />
          </div>
        )}
        <Input type="file" accept="image/*" onChange={handleLogoChange} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Naziv firme</Label>
          <Input value={firmaNaziv} onChange={e => setFirmaNaziv(e.target.value)} placeholder="Moja Firma d.o.o." />
        </div>
        <div className="space-y-2">
          <Label>Naziv skladišta</Label>
          <Input value={firmaSkladiste} onChange={e => setFirmaSkladiste(e.target.value)} placeholder="Glavno skladište" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Adresa</Label>
        <Input value={firmaAdresa} onChange={e => setFirmaAdresa(e.target.value)} placeholder="Ulica bb" />
      </div>
      <div className="space-y-2">
        <Label>Grad</Label>
        <Input value={firmaGrad} onChange={e => setFirmaGrad(e.target.value)} placeholder="Sarajevo" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>ID broj</Label>
          <Input value={firmaIdBroj} onChange={e => setFirmaIdBroj(e.target.value)} placeholder="4200000000000" />
        </div>
        <div className="space-y-2">
          <Label>PDV broj</Label>
          <Input value={firmaPdvBroj} onChange={e => setFirmaPdvBroj(e.target.value)} placeholder="200000000000" />
        </div>
      </div>
      {firmaStatus && <p className="text-sm text-emerald-600">{firmaStatus}</p>}
      <Button onClick={handleSaveFirma}>Spremi postavke firme</Button>
    </CardContent>
  </Card>
</TabsContent>
```

**Step 2: Verify**

Run: `bun run tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/screens/PostavkeScreen.tsx
git commit -m "feat: add firma settings UI in Postavke"
```

---

### Task 4: Primka Edit/Delete — Backend

**Files:**
- Modify: `src/ipc/handlers.ts` (after primka:create handler ~line 263)
- Modify: `src/preload.ts` (after getNextBrojUlaza)
- Modify: `src/global.d.ts` (after getNextBrojUlaza)

**Step 1: Add update handler**

In `src/ipc/handlers.ts`, after the `primka:create` handler:

```typescript
handle('primka:update', (data: {
  id: number;
  brojPrimke: string; datum?: string; napomena?: string;
  dobavljacNaziv?: string; dobavljacId?: string; dobavljacAdresa?: string;
  stavke: Array<{ productId: number; kolicina: number; cijena: number; nabavnaCijena: number; rabat: number; pdvStopa: string }>;
}) => {
  const updatePrimka = db.transaction(() => {
    const datum = data.datum || new Date().toISOString().split('T')[0];

    db.prepare('UPDATE primke SET brojPrimke = ?, datum = ?, dobavljacNaziv = ?, dobavljacId = ?, dobavljacAdresa = ?, napomena = ? WHERE id = ?')
      .run(data.brojPrimke, datum, data.dobavljacNaziv ?? null, data.dobavljacId ?? null, data.dobavljacAdresa ?? null, data.napomena ?? null, data.id);

    // Reverse old stock movements
    const oldStavke = db.prepare('SELECT productId, kolicina FROM primka_stavke WHERE primkaId = ?').all(data.id) as Array<{ productId: number; kolicina: number }>;
    for (const s of oldStavke) {
      db.prepare('UPDATE products SET stanje = stanje - ? WHERE id = ?').run(s.kolicina, s.productId);
    }

    // Delete old stavke and stock movements
    db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(data.id);
    db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(data.id);

    // Insert new stavke and stock movements
    const insertStavka = db.prepare(
      'INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertStock = db.prepare(
      "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'primka', ?)"
    );

    for (const stavka of data.stavke) {
      insertStavka.run(data.id, stavka.productId, stavka.kolicina, stavka.cijena, stavka.nabavnaCijena, stavka.rabat, stavka.pdvStopa);
      insertStock.run(stavka.productId, stavka.kolicina, data.id);
      db.prepare('UPDATE products SET stanje = stanje + ? WHERE id = ?').run(stavka.kolicina, stavka.productId);
    }

    return { id: data.id };
  });

  return updatePrimka();
});

handle('primka:delete', (id: number) => {
  const deletePrimka = db.transaction(() => {
    // Reverse stock movements
    const stavke = db.prepare('SELECT productId, kolicina FROM primka_stavke WHERE primkaId = ?').all(id) as Array<{ productId: number; kolicina: number }>;
    for (const s of stavke) {
      db.prepare('UPDATE products SET stanje = stanje - ? WHERE id = ?').run(s.kolicina, s.productId);
    }

    db.prepare('DELETE FROM primka_stavke WHERE primkaId = ?').run(id);
    db.prepare("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?").run(id);
    db.prepare('DELETE FROM primke WHERE id = ?').run(id);
  });

  return deletePrimka();
});
```

**Step 2: Add preload bridge**

In `src/preload.ts`, after `getNextBrojUlaza`:

```typescript
updatePrimka: (data: any) => ipcRenderer.invoke('primka:update', data),
deletePrimka: (id: number) => ipcRenderer.invoke('primka:delete', id),
```

**Step 3: Add type declarations**

In `src/global.d.ts`, after `getNextBrojUlaza`:

```typescript
updatePrimka: (data: any) => Promise<any>;
deletePrimka: (id: number) => Promise<any>;
```

**Step 4: Verify**

Run: `bun run tsc --noEmit`

**Step 5: Commit**

```bash
git add src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat: add primka update and delete IPC handlers"
```

---

### Task 5: Primka Edit/Delete — UI

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx`

**Step 1: Update NovaPrimkaDialog to support editing**

The NovaPrimkaDialog component (~line 312) needs an optional `editPrimka` prop. Update its props:

```typescript
function NovaPrimkaDialog({
  open,
  onOpenChange,
  products,
  dobavljaci,
  onSave,
  editPrimka,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: Product[];
  dobavljaci: Dobavljac[];
  onSave: () => void;
  editPrimka?: Primka | null;
}) {
```

Update the useEffect that resets the form (~line 338) to pre-fill when editing:

```typescript
useEffect(() => {
  if (open) {
    if (editPrimka) {
      setBrojPrimke(editPrimka.brojPrimke);
      setNapomena(editPrimka.napomena ?? '');
      setDatum(editPrimka.datum);
      setDobavljacNaziv(editPrimka.dobavljacNaziv ?? '');
      setDobavljacId(editPrimka.dobavljacId ?? '');
      setDobavljacAdresa(editPrimka.dobavljacAdresa ?? '');
      setStavke(
        (editPrimka.stavke ?? []).map((s) => ({
          productId: s.productId,
          kolicina: String(s.kolicina),
          nabavnaCijena: String(s.nabavnaCijena),
          rabat: String(s.rabat || ''),
          cijena: String(s.cijena),
        }))
      );
    } else {
      setNapomena('');
      setDobavljacNaziv('');
      setDobavljacId('');
      setDobavljacAdresa('');
      const d = new Date();
      setDatum(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      setStavke([{ productId: null, kolicina: '', nabavnaCijena: '', rabat: '', cijena: '' }]);
      window.api.getNextBrojUlaza().then(setBrojPrimke).catch(() => setBrojPrimke(''));
    }
  }
}, [open, editPrimka]);
```

Update handleSave to call update when editing:

```typescript
const handleSave = async () => {
  if (!brojPrimke) return;
  const validStavke = stavke.filter(
    (s) => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena,
  );
  if (validStavke.length === 0) return;

  setSaving(true);
  try {
    const payload = {
      ...(editPrimka ? { id: editPrimka.id } : {}),
      brojPrimke,
      datum: datum || undefined,
      dobavljacNaziv: dobavljacNaziv || undefined,
      dobavljacId: dobavljacId || undefined,
      dobavljacAdresa: dobavljacAdresa || undefined,
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

Update dialog title to reflect edit mode:

```tsx
<DialogTitle className="text-lg">{editPrimka ? 'Uredi ulaz robe' : 'Novi ulaz robe'}</DialogTitle>
```

Make broj ulaza field editable when editing (not read-only):

```tsx
<Input
  id="brojPrimke"
  className={cn("font-mono", !editPrimka && "bg-muted")}
  value={brojPrimke}
  onChange={(e) => editPrimka && setBrojPrimke(e.target.value)}
  readOnly={!editPrimka}
/>
```

**Step 2: Add edit/delete buttons to PrimkeTab detail panel**

In the PrimkeTab component, add state for edit dialog and delete:

```typescript
const [editPrimka, setEditPrimka] = useState<Primka | null>(null);
```

Add edit and delete handlers:

```typescript
const handleEdit = (primka: Primka) => {
  setEditPrimka(primka);
  setDialogOpen(true);
};

const handleDelete = async (primka: Primka) => {
  if (!confirm(`Obrisati ulaz ${primka.brojPrimke}?`)) return;
  await window.api.deletePrimka(primka.id);
  setSelectedPrimka(null);
  loadPrimke();
  onReloadProducts();
};
```

Update the "Novi ulaz" button handler to clear editPrimka:

```typescript
<Button size="sm" onClick={() => { setEditPrimka(null); setDialogOpen(true); }} className="ml-auto h-9">
```

Add Uredi and Obriši buttons in the detail panel CardHeader, next to the Štampaj button:

```tsx
<Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleEdit(selectedPrimka)}>
  <Pencil className="h-3.5 w-3.5 mr-1" />
  Uredi
</Button>
<Button variant="outline" size="sm" className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(selectedPrimka)}>
  <Trash2 className="h-3.5 w-3.5 mr-1" />
  Obriši
</Button>
```

Pass editPrimka to the dialog:

```tsx
<NovaPrimkaDialog
  open={dialogOpen}
  onOpenChange={setDialogOpen}
  products={products}
  dobavljaci={dobavljaci}
  onSave={handleSavePrimka}
  editPrimka={editPrimka}
/>
```

Where `handleSavePrimka` reloads and resets:

```typescript
const handleSavePrimka = () => {
  loadPrimke();
  onReloadProducts();
  setEditPrimka(null);
  // Re-select if was editing
  if (selectedPrimka) {
    window.api.getPrimka(selectedPrimka.id).then(setSelectedPrimka).catch(() => setSelectedPrimka(null));
  }
};
```

**Step 3: Verify**

Run: `bun run tsc --noEmit`

**Step 4: Commit**

```bash
git add src/screens/SkladisteScreen.tsx
git commit -m "feat: add ulaz robe editing and deleting"
```

---

### Task 6: Electron Save Dialog IPC

**Files:**
- Modify: `src/ipc/handlers.ts` (top of file for import, and new handler)
- Modify: `src/preload.ts`
- Modify: `src/global.d.ts`

**Step 1: Add save dialog handler**

At the top of `src/ipc/handlers.ts`, add dialog import:

```typescript
import { dialog } from 'electron';
```

Add handler (in the settings section or after it):

```typescript
handle('dialog:saveFile', async (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: data.defaultName,
    filters: data.filters,
  });
  return result.canceled ? null : result.filePath;
});
```

**Step 2: Add preload bridge**

```typescript
showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('dialog:saveFile', data),
```

**Step 3: Add type declaration**

```typescript
showSaveDialog: (data: { defaultName: string; filters: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
```

**Step 4: Verify & Commit**

Run: `bun run tsc --noEmit`

```bash
git add src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat: add Electron save file dialog IPC"
```

---

### Task 7: PDF Document Component

**Files:**
- Create: `src/components/UlazPdf.tsx`

**Step 1: Create PDF document component**

Create `src/components/UlazPdf.tsx` with a full A4 prijemnica layout using @react-pdf/renderer:

The component receives props:
```typescript
interface UlazPdfProps {
  primka: Primka;
  firma: {
    naziv: string; adresa: string; grad: string;
    idBroj: string; pdvBroj: string; skladiste: string; logo: string;
  };
}
```

Layout sections:
1. **Header**: Logo (left, if exists) + firma info (right) — naziv, adresa, grad, ID/PDV broj
2. **Document title**: "PRIJEMNICA" centered, broj ulaza + datum + skladište below
3. **Supplier block**: Dobavljač name, ID, address in a bordered box
4. **Stavke table**: Columns — Rb., Artikal, JM, Količina, Nab. cijena, Rabat%, Prod. cijena, Ukupno
5. **Totals section**: Nabavna vrijednost, Prodajna vrijednost, RUC, PDV u RUC, Marža, RUC%, Marža%
6. **Napomena**: If exists, show in a light box
7. **Footer**: "Generisano: {date}" left, page number right

Use @react-pdf/renderer's `Document`, `Page`, `View`, `Text`, `Image`, `StyleSheet` APIs. Use `Font.register` for a clean font if desired, or stick with Helvetica default.

**Step 2: Verify**

Run: `bun run tsc --noEmit`

**Step 3: Commit**

```bash
git add src/components/UlazPdf.tsx
git commit -m "feat: add UlazPdf A4 prijemnica component"
```

---

### Task 8: PDF Export & Print Integration

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx` (PrimkeTab detail panel)

**Step 1: Add PDF generation helpers**

In PrimkeTab, add a helper to load firma settings and generate PDF:

```typescript
import { pdf } from '@react-pdf/renderer';
import { UlazPdf } from '@/components/UlazPdf';

const handlePrintPdf = async (primka: Primka) => {
  const firma = await window.api.getFirmaSettings();
  const blob = await pdf(<UlazPdf primka={primka} firma={firma} />).toBlob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
};

const handleExportPdf = async (primka: Primka) => {
  const firma = await window.api.getFirmaSettings();
  const blob = await pdf(<UlazPdf primka={primka} firma={firma} />).toBlob();
  const filePath = await window.api.showSaveDialog({
    defaultName: `${primka.brojPrimke}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!filePath) return;

  const buffer = await blob.arrayBuffer();
  await window.api.writeFile(filePath, Buffer.from(buffer));
};
```

Note: We need a `writeFile` IPC handler too. Add to handlers.ts:

```typescript
import { writeFileSync } from 'fs';

handle('fs:writeFile', (data: { path: string; buffer: number[] }) => {
  writeFileSync(data.path, Buffer.from(data.buffer));
  return { success: true };
});
```

And preload:
```typescript
writeFile: (path: string, buffer: Buffer) => ipcRenderer.invoke('fs:writeFile', { path, buffer: Array.from(buffer) }),
```

And global.d.ts:
```typescript
writeFile: (path: string, buffer: Buffer) => Promise<any>;
```

**Step 2: Replace buttons in detail panel**

Replace the single Štampaj button with:

```tsx
<div className="flex items-center gap-1">
  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handlePrintPdf(selectedPrimka)}>
    <Printer className="h-3.5 w-3.5 mr-1" />
    Štampaj
  </Button>
  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleExportPdf(selectedPrimka)}>
    <FileText className="h-3.5 w-3.5 mr-1" />
    Izvezi PDF
  </Button>
</div>
```

**Step 3: Verify**

Run: `bun run tsc --noEmit`

**Step 4: Commit**

```bash
git add src/screens/SkladisteScreen.tsx src/ipc/handlers.ts src/preload.ts src/global.d.ts
git commit -m "feat: integrate PDF print and export in ulaz robe detail"
```

---

### Task 9: Final Integration Testing

**Step 1: Manual test checklist**

- [ ] Postavke → Firma tab: fill all fields, upload logo, save, reload app — settings persist
- [ ] Skladište → Ulaz robe → create new ulaz — auto-generated broj works
- [ ] Select existing ulaz → click Uredi → dialog pre-fills, edit stavke, save — updates correctly
- [ ] Select ulaz → Obriši → confirm — deletes and reverses stock
- [ ] Select ulaz → Štampaj — opens PDF in new window with correct A4 layout
- [ ] Select ulaz → Izvezi PDF — save dialog opens, PDF saved to chosen location
- [ ] Verify stock quantities update correctly after edit/delete

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for ulaz editing and PDF export"
```
