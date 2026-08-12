# Unos cijena bez PDV-a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodati globalnu postavku koja mijenja režim unosa cijene u formama artikla i usluge — korisnik upisuje netto cijenu, aplikacija dodaje 17 % PDV-a i u bazu sprema bruto kao i do sada.

**Architecture:** Postavka `cijene.unosBezPdv` se čuva u postojećoj `settings` tabeli preko generičkog `window.api.getSetting/setSetting`. Nova čista računska biblioteka `src/lib/pdvUnos.ts` radi konverziju netto ↔ bruto. React hook `src/hooks/useUnosBezPdv.ts` čita postavku i daje je dijalozima. Dva dijaloga (artikal, usluga) mijenjaju labelu, dodaju live preview i bedž, i konvertuju vrijednost prije spremanja. Baza, kasa, ponude, Tring i PDF-ovi se ne diraju.

**Tech Stack:** Electron Forge + TypeScript, React 19, Tailwind + shadcn/ui, better-sqlite3, `bun test`.

## Global Constraints

- **Baza se ne mijenja.** `products.cijena` i dalje čuva **bruto** cijenu (sa PDV-om). Nema migracije, nema promjene sheme u `src/database/schema.ts`.
- **Van dosega:** `src/lib/racun.ts`, kasa, ponude, narudžbe, izvještaji, Tring servis, svi PDF-ovi, primka i nivelacija (`SkladisteScreen.tsx` PrimkaDialog i `showNivelacija` dijalog). Ne dirati ih ni u jednom zadatku.
- **Ključ postavke:** tačno `cijene.unosBezPdv`, vrijednosti `'true'` / `'false'` (string). Nepostojeći ključ = `'false'`.
- **PDV stopa `'K'` (0 %)** nikad se ne konvertuje — ni labela, ni preview, ni bedž se ne prikazuju za nju.
- **Jezik UI teksta:** bosanski, kako je u ostatku aplikacije.
- **Testovi:** `bun test` (ne jest, ne vitest). Testovi žive uz kod u `src/lib/*.test.ts`.
- **Zaokruživanje:** uvijek preko `round2` iz `src/lib/novac.ts`.

---

### Task 1: Biblioteka za konverziju netto ↔ bruto

**Files:**
- Create: `src/lib/pdvUnos.ts`
- Test: `src/lib/pdvUnos.test.ts`

**Interfaces:**
- Consumes: `round2` iz `src/lib/novac.ts` (postojeće, potpis `round2(n: number): number`)
- Produces:
  - `uBruto(netto: number, pdvStopa: string): number`
  - `uNetto(bruto: number, pdvStopa: string): number`

- [ ] **Step 1: Napiši test koji pada**

Kreiraj `src/lib/pdvUnos.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { uBruto, uNetto } from './pdvUnos';

test('uBruto dodaje 17% na stopu E', () => {
  expect(uBruto(100, 'E')).toBe(117);
});

test('uNetto skida 17% sa stope E', () => {
  expect(uNetto(117, 'E')).toBe(100);
});

test('stopa K se ne konvertuje ni u jednom smjeru', () => {
  expect(uBruto(100, 'K')).toBe(100);
  expect(uNetto(100, 'K')).toBe(100);
});

test('rezultat je zaokruzen na dvije decimale', () => {
  // 100 / 1.17 = 85.4700854... → 85.47
  expect(uNetto(100, 'E')).toBe(85.47);
  // 85.47 * 1.17 = 99.9999 → 100.00
  expect(uBruto(85.47, 'E')).toBe(100);
});

// Dva uzastopna zaokruživanja na fene ne mogu biti povratna za svaku
// vrijednost: 1,00 → 0,85 → 0,99. Zato je invarijant "najviše jedan fening
// odstupanja", a ne tačna jednakost. Upravo zbog ovoga forma za izmjenu
// artikla čuva originalnu bruto cijenu kad polje nije dirano (Task 4 i 5).
// Poredi se u fenima kao cijelim brojevima: `Math.abs(a - b) <= 0.01` bi
// palo na float artefaktu (razlika ispadne 0.010000000000000009).
test('povratna konverzija odstupa najvise jedan fening', () => {
  for (const bruto of [1, 2.5, 10, 19.99, 100, 249.9, 1000]) {
    const razlikaUFeninzima = Math.round(Math.abs(uBruto(uNetto(bruto, 'E'), 'E') - bruto) * 100);
    expect(razlikaUFeninzima).toBeLessThanOrEqual(1);
  }
});

test('nula i negativan unos prolaze bez izuzetka', () => {
  expect(uBruto(0, 'E')).toBe(0);
  expect(uNetto(0, 'E')).toBe(0);
});
```

- [ ] **Step 2: Pokreni test i potvrdi da pada**

Run: `bun test src/lib/pdvUnos.test.ts`
Expected: FAIL — `Cannot find module './pdvUnos'`

- [ ] **Step 3: Napiši implementaciju**

Kreiraj `src/lib/pdvUnos.ts`:

```ts
import { round2 } from './novac';

/**
 * Konverzija između netto i bruto cijene pri *unosu* artikla ili usluge.
 * U bazi se cijena uvijek čuva kao bruto (sa PDV-om) — ove funkcije samo
 * prevode ono što korisnik ukuca kad je uključena postavka
 * `cijene.unosBezPdv`.
 *
 * Stopa 'E' je 17 %, stopa 'K' je oslobođena PDV-a pa se ne dira. Faktor
 * 1.17 se namjerno drži u istom obliku kao u `src/lib/racun.ts`.
 */
const FAKTOR_E = 1.17;

/** Netto (bez PDV-a) → bruto (sa PDV-om). */
export function uBruto(netto: number, pdvStopa: string): number {
  if (pdvStopa !== 'E') return netto;
  return round2(netto * FAKTOR_E);
}

/** Bruto (sa PDV-om) → netto (bez PDV-a). */
export function uNetto(bruto: number, pdvStopa: string): number {
  if (pdvStopa !== 'E') return bruto;
  return round2(bruto / FAKTOR_E);
}
```

- [ ] **Step 4: Pokreni test i potvrdi da prolazi**

Run: `bun test src/lib/pdvUnos.test.ts`
Expected: PASS — 6 pass, 0 fail

Ako neki test padne, NE mijenjaj test da bi prošao — prijavi vrijednost koja puca.

- [ ] **Step 5: Pokreni cijeli test paket**

Run: `bun test`
Expected: PASS — svi postojeći testovi i dalje prolaze

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdvUnos.ts src/lib/pdvUnos.test.ts
git commit -m "feat(pdv): konverzija netto/bruto za unos cijena"
```

---

### Task 2: React hook za čitanje postavke

**Files:**
- Create: `src/hooks/useUnosBezPdv.ts` (novi direktorij `src/hooks/`)

**Interfaces:**
- Consumes: `window.api.getSetting(key: string): Promise<string | null>` (već tipizirano u `src/global.d.ts:91`)
- Produces: `useUnosBezPdv(refreshKey?: unknown): boolean | null` — vraća `null` dok se postavka učitava, potom `true`/`false`. Kad se `refreshKey` promijeni, postavka se ponovo pročita.

Nema testa — projekat nema infrastrukturu za testiranje React hookova, a hook je trivijalan omotač oko IPC poziva. Provjerava se kroz Task 3–5 ručno.

- [ ] **Step 1: Kreiraj hook**

Kreiraj `src/hooks/useUnosBezPdv.ts`:

```ts
import { useState, useEffect } from 'react';

/**
 * Čita postavku `cijene.unosBezPdv`. Vraća `null` dok traje učitavanje —
 * pozivalac tada NE smije popunjavati formu, jer bi prikazao cijenu u
 * pogrešnoj jedinici.
 *
 * `refreshKey` se koristi da se postavka ponovo pročita kad se dijalog
 * otvori, pa promjena u Postavkama vrijedi odmah, bez restarta aplikacije.
 */
export function useUnosBezPdv(refreshKey?: unknown): boolean | null {
  const [bezPdv, setBezPdv] = useState<boolean | null>(null);

  useEffect(() => {
    let otkazano = false;
    window.api
      .getSetting('cijene.unosBezPdv')
      .then((v) => {
        if (!otkazano) setBezPdv(v === 'true');
      })
      .catch((err) => {
        // Greška ne smije zaglaviti formu: pozivaoci čekaju dok je vrijednost
        // `null`, pa bi bez ovoga dijalog ostao zauvijek nepopunjen. Vraćamo se
        // na zatečeno ponašanje — cijene se unose sa PDV-om — da ono što piše
        // na labeli uvijek odgovara onome što se sprema.
        console.error('Ne mogu pročitati postavku cijene.unosBezPdv:', err);
        if (!otkazano) setBezPdv(false);
      });
    return () => {
      otkazano = true;
    };
  }, [refreshKey]);

  return bezPdv;
}
```

- [ ] **Step 2: Provjeri da TypeScript prolazi**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: bez grešaka koje pominju `useUnosBezPdv.ts`

(Ako `tsc` prijavi ranije postojeće greške u drugim fajlovima, zanemari ih — bitno je samo da novi fajl ne dodaje nove.)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUnosBezPdv.ts
git commit -m "feat(pdv): hook za citanje postavke unosa bez PDV-a"
```

---

### Task 3: Prekidač u Postavkama → tab Sistem

**Files:**
- Modify: `src/screens/PostavkeScreen.tsx` (import ikona na liniji 17-22; state oko linije 61; `useEffect` učitavanje oko linije 104-111; nova kartica se ubacuje na liniju 1046, između kartice „Postavke kase" i kartice „Napomena na računu")

**Interfaces:**
- Consumes: `window.api.getSetting` / `window.api.setSetting`
- Produces: postavku `cijene.unosBezPdv` u `settings` tabeli — čita je `useUnosBezPdv` iz Taska 2

**Napomena o povratnoj informaciji:** spec pominje „toast", ali aplikacija nema nikakvu toast infrastrukturu (`@radix-ui/react-toast` je u `package.json`, ali nijedna komponenta ga ne koristi). Umjesto uvođenja cijelog sistema zbog jedne poruke, potvrda se prikazuje kao inline traka ispod prekidača koja se sama sakrije nakon 5 sekundi.

- [ ] **Step 1: Dodaj `Percent` ikonu u import**

U `src/screens/PostavkeScreen.tsx`, u lucide-react import bloku (linije 17-22), dodaj `Percent` u listu:

```tsx
  HardDrive, Download, Upload, Bug, RefreshCw, X, ChevronDown, ChevronUp, Settings, Landmark, Percent,
} from 'lucide-react';
```

- [ ] **Step 2: Dodaj state**

Odmah ispod `const [allowZeroStock, setAllowZeroStock] = useState(false);` (linija 63) dodaj:

```tsx
  const [unosBezPdv, setUnosBezPdv] = useState(false);
  // Inline potvrda nakon promjene režima; sama se sakrije nakon 5 s.
  const [pdvPotvrda, setPdvPotvrda] = useState('');
```

- [ ] **Step 3: Učitaj postavku pri montiranju**

U `useEffect` bloku sa ostalim `getSetting` pozivima (linije 104-111), dodaj red:

```tsx
    window.api.getSetting('cijene.unosBezPdv').then((v) => setUnosBezPdv(v === 'true'));
```

- [ ] **Step 4: Ubaci karticu „Cijene"**

U `{activeTab === 'sistem' && ...}` bloku, odmah nakon zatvaranja kartice „Postavke kase" (linija 1045, `</div>` koji zatvara `{/* Kasa settings card */}`) i prije komentara `{/* Receipt note card */}`, ubaci:

```tsx
                {/* Cijene card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Percent size={20} className="text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Cijene</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Način unosa cijena u šifarniku</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="pr-4">
                        <p className="text-[13px] font-medium text-slate-700">Cijene se unose bez PDV-a</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">
                          Kod unosa artikla ili usluge upisuješ cijenu bez PDV-a; aplikacija sama dodaje 17 %
                        </p>
                      </div>
                      <Switch
                        checked={unosBezPdv}
                        onCheckedChange={async (checked) => {
                          setUnosBezPdv(checked);
                          await window.api.setSetting('cijene.unosBezPdv', String(checked));
                          setPdvPotvrda(
                            checked
                              ? 'Cijene se od sada unose bez PDV-a. Postojeći artikli nisu promijenjeni.'
                              : 'Cijene se od sada unose sa PDV-om. Postojeći artikli nisu promijenjeni.'
                          );
                        }}
                      />
                    </div>
                    {pdvPotvrda && (
                      <div className="text-[12px] px-3 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                        {pdvPotvrda}
                      </div>
                    )}
                  </div>
                </div>
```

- [ ] **Step 5: Dodaj auto-sakrivanje potvrde**

Uz ostale `useEffect` pozive u komponenti (može odmah iza onog iz Step 3) dodaj:

```tsx
  useEffect(() => {
    if (!pdvPotvrda) return;
    const t = setTimeout(() => setPdvPotvrda(''), 5000);
    return () => clearTimeout(t);
  }, [pdvPotvrda]);
```

- [ ] **Step 6: Ručna provjera u aplikaciji**

Run: `bun run start`

Provjeri redom:
1. Postavke → tab **Sistem** → kartica **Cijene** postoji ispod kartice „Postavke kase".
2. Uključi prekidač → pojavi se zelena potvrda „Cijene se od sada unose bez PDV-a…" i nestane nakon ~5 s.
3. Isključi prekidač → potvrda kaže „…sa PDV-om…".
4. Zatvori i ponovo otvori Postavke → prekidač pamti zadnje stanje.

- [ ] **Step 7: Commit**

```bash
git add src/screens/PostavkeScreen.tsx
git commit -m "feat(postavke): prekidac za unos cijena bez PDV-a"
```

---

### Task 4: Forma artikla — labela, preview, bedž i konverzija

**Files:**
- Modify: `src/screens/SkladisteScreen.tsx` — `ArtikalDialog` komponenta (linije 56-303): importi (linije 1-28), state i `useEffect` (linije 67-88), `handleSave` (linije 90-123), zaglavlje dijaloga (linije 142-147), polje cijene (linije 205-217)

**Interfaces:**
- Consumes: `uBruto`, `uNetto` iz `src/lib/pdvUnos.ts` (Task 1); `useUnosBezPdv` iz `src/hooks/useUnosBezPdv.ts` (Task 2); postojeće `formatKM`, `parseDecimal` iz `src/lib/utils`
- Produces: ništa što drugi zadaci koriste

**Ključno pravilo (iz speca):** kod izmjene postojećeg artikla, ako korisnik **nije dirao** ni polje cijene ni PDV stopu, sprema se **originalna bruto cijena bez ikakve konverzije**. Time izmjena naziva ne može tiho pomjeriti cijenu za fening.

- [ ] **Step 1: Dodaj importe**

U `src/screens/SkladisteScreen.tsx`, ispod postojećeg importa `parseDecimal` (linija 3), dodaj:

```tsx
import { uBruto, uNetto } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';
```

- [ ] **Step 2: Dodaj state u `ArtikalDialog`**

Ispod `const [error, setError] = useState('');` (linija 69) dodaj:

```tsx
  const bezPdv = useUnosBezPdv(open);
  // Tekst koji je pri otvaranju stavljen u polje cijene — služi da prepoznamo
  // da korisnik cijenu uopšte nije dirao.
  const [cijenaInit, setCijenaInit] = useState('');
```

- [ ] **Step 3: Prilagodi popunjavanje forme**

Zamijeni cijeli `useEffect` (linije 71-88) ovim:

```tsx
  useEffect(() => {
    // Dok se postavka učitava ne diramo formu — inače bismo cijenu prikazali
    // u pogrešnoj jedinici pa je pregazili kad postavka stigne.
    if (!open || bezPdv === null) return;
    setError('');
    if (product) {
      const prikaz = String(bezPdv ? uNetto(product.cijena, product.pdvStopa) : product.cijena);
      setCijenaInit(prikaz);
      setForm({
        sifra: product.sifra,
        barkod: product.barkod ?? '',
        naziv: product.naziv,
        jm: product.jm,
        cijena: prikaz,
        pdvStopa: product.pdvStopa,
        stanje: String(product.stanje ?? 0),
      });
    } else {
      setCijenaInit('');
      setForm(emptyArtikalForm);
    }
  }, [open, product, bezPdv]);
```

- [ ] **Step 4: Dodaj izvedene vrijednosti za prikaz**

Odmah iznad `const handleSave = async () => {` (linija 90) dodaj:

```tsx
  // Režim "bez PDV-a" vrijedi samo za stopu E — kod K (0 %) bi oznaka
  // "bez PDV-a" bila obmanjujuća.
  const nettoRezim = bezPdv === true && form.pdvStopa === 'E';
  const cijenaBroj = parseDecimal(form.cijena);
  const previewBruto = nettoRezim && !isNaN(cijenaBroj) && form.cijena !== ''
    ? uBruto(cijenaBroj, form.pdvStopa)
    : null;
```

- [ ] **Step 5: Konvertuj vrijednost pri spremanju**

U `handleSave`, zamijeni red `cijena: parseDecimal(form.cijena),` (linija 100) tako da `payload` izgleda ovako:

```tsx
      // Uslov je napisan kao `product && ...` (a ne izdvojen u boolean varijablu)
      // da bi TypeScript suzio `product` sa `Product | null` na `Product` u
      // `true` grani — inače `product.cijena` puca na "possibly null".
      const cijenaZaBazu =
        product && form.cijena === cijenaInit && form.pdvStopa === product.pdvStopa
          ? product.cijena
          : bezPdv
            ? uBruto(parseDecimal(form.cijena), form.pdvStopa)
            : parseDecimal(form.cijena);

      const payload = {
        sifra: form.sifra,
        barkod: form.barkod || null,
        naziv: form.naziv,
        jm: form.jm,
        cijena: cijenaZaBazu,
        pdvStopa: form.pdvStopa,
      };
```

- [ ] **Step 6: Dodaj bedž u zaglavlje dijaloga**

Zamijeni `<DialogTitle>` red (linija 143) ovim:

```tsx
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg">{isEdit ? 'Uredi artikal' : 'Novi artikal'}</DialogTitle>
                  {nettoRezim && (
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                      bez PDV-a
                    </Badge>
                  )}
                </div>
```

(`Badge` je već importovan na liniji 21.)

- [ ] **Step 7: Prilagodi labelu i dodaj preview**

Zamijeni blok polja cijene (linije 205-217) ovim:

```tsx
            <div className="space-y-1.5">
              <Label htmlFor="cijena" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="h-3 w-3" />
                {nettoRezim ? 'Cijena bez PDV-a (KM)' : 'Cijena (KM)'}
              </Label>
              <DecimalInput
                id="cijena"
                className="font-mono text-base h-11"
                value={form.cijena}
                onValueChange={(text) => setForm({ ...form, cijena: text })}
                placeholder="0,00"
              />
              {previewBruto !== null && (
                <p className="text-[11px] text-slate-400 font-mono">
                  Sa PDV-om: {formatKM(previewBruto)}
                </p>
              )}
            </div>
```

- [ ] **Step 8: Provjeri TypeScript**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: bez novih grešaka u `SkladisteScreen.tsx`

- [ ] **Step 9: Ručna provjera u aplikaciji**

Run: `bun run start`

Sa postavkom **isključenom**:
1. Skladište → Novi artikal → nema bedža, labela je „Cijena (KM)", nema previewa.
2. Unesi cijenu 117,00, stopa E, spremi → u listi piše 117,00 KM. *(Postojeće ponašanje nije promijenjeno.)*

Sa postavkom **uključenom** (Postavke → Sistem → Cijene):
3. Novi artikal → bedž „bez PDV-a" pored naslova, labela „Cijena bez PDV-a (KM)".
4. Ukucaj `100` → ispod polja se pojavi „Sa PDV-om: 117,00 KM".
5. Spremi → u listi artikala cijena je **117,00 KM**.
6. Prebaci stopu na **K** → bedž i preview nestanu, labela se vrati na „Cijena (KM)", a broj u polju ostane isti.
7. Otvori taj artikal (117,00 KM, stopa E) na izmjenu → polje pokazuje **85,47**, preview „Sa PDV-om: 100,00 KM".

   ⚠️ Pažnja: ovo je artikal iz koraka 2 (bruto 117,00 → netto 100,00 prikaz). Provjeri onaj koji odgovara.
8. Promijeni **samo naziv** i spremi → cijena u listi je **nepromijenjena** do zadnjeg feninga. Ovo je najvažnija provjera cijelog zadatka.
9. Otvori isti artikal, promijeni cijenu na `90` i spremi → u listi je **105,30 KM**.

- [ ] **Step 10: Commit**

```bash
git add src/screens/SkladisteScreen.tsx
git commit -m "feat(skladiste): unos cijene artikla bez PDV-a"
```

---

### Task 5: Forma usluge — labela, preview, bedž i konverzija

**Files:**
- Modify: `src/components/sifarnik/UslugeTab.tsx` — `UslugaDialog` komponenta (linije 24-107): importi (linije 1-18), state i `useEffect` (linije 35-54), zaglavlje (linije 61-66), polje cijene (linije 77-80), `onSave` poziv (linija 98)

**Interfaces:**
- Consumes: `uBruto`, `uNetto` iz `src/lib/pdvUnos.ts` (Task 1); `useUnosBezPdv` iz `src/hooks/useUnosBezPdv.ts` (Task 2)
- Produces: ništa što drugi zadaci koriste. `onSave({ sifra, naziv, cijena, pdvStopa })` zadržava isti potpis — `cijena` je i dalje **bruto** broj, pa `handleSave` u `UslugeTab` (linija 139) ostaje nepromijenjen.

- [ ] **Step 1: Dodaj importe**

U `src/components/sifarnik/UslugeTab.tsx`, ispod linije 3, dodaj:

```tsx
import { uBruto, uNetto } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';
```

- [ ] **Step 2: Dodaj state**

Ispod `const [pdvStopa, setPdvStopa] = useState<'E' | 'K'>('E');` (linija 38) dodaj:

```tsx
  const bezPdv = useUnosBezPdv(open);
  // Tekst koji je pri otvaranju stavljen u polje — prepoznaje da cijena nije dirana.
  const [cijenaInit, setCijenaInit] = useState('');
```

- [ ] **Step 3: Prilagodi popunjavanje forme**

Zamijeni cijeli `useEffect` (linije 40-54) ovim:

```tsx
  useEffect(() => {
    // Dok se postavka učitava ne diramo formu — inače bismo cijenu prikazali
    // u pogrešnoj jedinici pa je pregazili kad postavka stigne.
    if (!open || bezPdv === null) return;
    if (product) {
      const prikaz = String(bezPdv ? uNetto(product.cijena, product.pdvStopa) : product.cijena);
      setSifra(product.sifra);
      setNaziv(product.naziv);
      setCijena(prikaz);
      setCijenaInit(prikaz);
      setPdvStopa(product.pdvStopa);
    } else {
      setSifra('');
      setNaziv('');
      setCijena('');
      setCijenaInit('');
      setPdvStopa('E');
    }
  }, [open, product, bezPdv]);
```

- [ ] **Step 4: Dodaj izvedene vrijednosti**

Odmah ispod `const isEdit = !!product;` (linija 56) dodaj:

```tsx
  // Režim "bez PDV-a" vrijedi samo za stopu E — kod K (0 %) bi oznaka
  // "bez PDV-a" bila obmanjujuća.
  const nettoRezim = bezPdv === true && pdvStopa === 'E';
  const cijenaBroj = parseDecimal(cijena);
  const previewBruto = nettoRezim && !isNaN(cijenaBroj) && cijena !== ''
    ? uBruto(cijenaBroj, pdvStopa)
    : null;

  const handleSpremi = () => {
    // Uslov je napisan kao `product && ...` (a ne izdvojen u boolean varijablu)
    // da bi TypeScript suzio `product` sa `Product | null` na `Product` u
    // `true` grani — inače `product.cijena` puca na "possibly null".
    const cijenaZaBazu =
      product && cijena === cijenaInit && pdvStopa === product.pdvStopa
        ? product.cijena
        : bezPdv
          ? uBruto(parseDecimal(cijena), pdvStopa)
          : parseDecimal(cijena);
    onSave({ sifra, naziv, cijena: cijenaZaBazu, pdvStopa });
  };
```

- [ ] **Step 5: Dodaj bedž u zaglavlje**

Zamijeni `<DialogTitle>` red (linija 62) ovim:

```tsx
          <div className="flex items-center gap-2">
            <DialogTitle>{isEdit ? 'Uredi uslugu' : 'Nova usluga'}</DialogTitle>
            {nettoRezim && (
              <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                bez PDV-a
              </Badge>
            )}
          </div>
```

(`Badge` je već importovan na liniji 15.)

- [ ] **Step 6: Prilagodi labelu i dodaj preview**

Zamijeni blok polja cijene (linije 77-80) ovim:

```tsx
            <div className="space-y-2">
              <Label>{nettoRezim ? 'Cijena bez PDV-a' : 'Cijena'}</Label>
              <DecimalInput value={cijena} onValueChange={text => setCijena(text)} placeholder="0,00" className="font-mono" />
              {previewBruto !== null && (
                <p className="text-[11px] text-slate-400 font-mono">
                  Sa PDV-om: {formatKM(previewBruto)}
                </p>
              )}
            </div>
```

- [ ] **Step 7: Prikači `handleSpremi` na dugme**

Zamijeni `onClick` na dugmetu za spremanje (linija 98):

```tsx
            onClick={handleSpremi}
```

- [ ] **Step 8: Provjeri TypeScript**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: bez novih grešaka u `UslugeTab.tsx`

- [ ] **Step 9: Ručna provjera u aplikaciji**

Run: `bun run start`

Sa postavkom **uključenom**, Šifarnik → tab Usluge:
1. Nova usluga → bedž „bez PDV-a", labela „Cijena bez PDV-a".
2. Ukucaj `100` → preview „Sa PDV-om: 117,00 KM"; spremi → u listi je **117,00 KM**.
3. Prebaci stopu na **K** → bedž i preview nestanu, labela je „Cijena", broj ostaje isti.
4. Otvori uslugu iz koraka 2 na izmjenu → polje pokazuje **85,47**.
5. Promijeni **samo naziv** i spremi → cijena u listi je **nepromijenjena**.

Sa postavkom **isključenom**:
6. Nova usluga, cijena `117`, stopa E → spremi → u listi je **117,00 KM**, bez bedža i previewa.

- [ ] **Step 10: Commit**

```bash
git add src/components/sifarnik/UslugeTab.tsx
git commit -m "feat(sifarnik): unos cijene usluge bez PDV-a"
```

---

### Task 6: Završna provjera

**Files:** nijedan (samo verifikacija)

- [ ] **Step 1: Pokreni cijeli test paket**

Run: `bun test`
Expected: PASS — svi testovi, uključujući `pdvUnos.test.ts`

- [ ] **Step 2: Pokreni lint**

Run: `bun run lint`
Expected: bez novih grešaka u `src/lib/pdvUnos.ts`, `src/hooks/useUnosBezPdv.ts`, `src/screens/PostavkeScreen.tsx`, `src/screens/SkladisteScreen.tsx`, `src/components/sifarnik/UslugeTab.tsx`

- [ ] **Step 3: Potvrdi da van-dosega tokovi nisu dirani**

Rad se odvija direktno na `main`, pa se poredi sa commitom prije Taska 1 —
`cd04bb1` (`docs: plan implementacije za unos cijena bez PDV-a`). U radnoj
kopiji postoji i nekomitovan rad na backup/restore funkciji koji **nije dio
ovog plana**; on se ne commituje i zato se ne pojavljuje u ovom diffu.

Diff je ograničen na `src/` da commitovi same dokumentacije ne zamute sliku.

Run: `git diff --stat cd04bb1 HEAD -- src/`
Expected: izmijenjeni su **samo** ovi fajlovi:

```
src/lib/pdvUnos.ts
src/lib/pdvUnos.test.ts
src/hooks/useUnosBezPdv.ts
src/screens/PostavkeScreen.tsx
src/screens/SkladisteScreen.tsx
src/components/sifarnik/UslugeTab.tsx
```

Ako se u listi pojavi `schema.ts`, `racun.ts`, bilo koji PDF, `services/tring.ts` ili dijalog primke/nivelacije — nešto je izašlo van dosega, vrati to.

- [ ] **Step 4: Regresija fiskalnog toka**

Run: `bun run start`

Sa postavkom **uključenom**, prodaj u kasi artikal koji je unesen kao netto `100` (bruto 117,00):
1. Kasa pokazuje cijenu **117,00 KM**.
2. Ukupno je 117,00 KM, PDV (17 %) je **17,00 KM**.
3. Račun se fiskalizira normalno (ili, ako Tring nije spojen, ponaša se isto kao i prije ove izmjene).

Ovo dokazuje ono zbog čega je cijeli zahvat i držan malen: baza i dalje čuva bruto, pa fiskalni tok ne zna da postavka postoji.
