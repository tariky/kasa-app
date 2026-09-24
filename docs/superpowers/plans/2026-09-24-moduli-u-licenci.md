# Moduli u licenci — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pri izdavanju licence bira se koji su moduli (Skladište, Ponude, Proizvodnja, Generator) dostupni; aplikacija ih prikazuje/sakriva i oba backenda (Electron i Rust) blokiraju kanale nelicenciranih modula.

**Architecture:** Potpisani token `PAZAR1` dobija opciono polje `m` (lista modula). Katalog modula, njihovi nazivi i mapa kanal → moduli žive u jednom JSON fajlu (`src/lib/moduliKatalog.json`) koji čitaju i TS (import) i Rust (`include_str!`), pa su oba backenda isti po konstrukciji. Licenca kaže šta je *dozvoljeno*, postavka (`proizvodnja.enabled`, `ui.showGenerator`) šta je *uključeno*; veza Ponude–Proizvodnja je izvedena (`ponude && proizvodnja`), nije poseban modul.

**Tech Stack:** TypeScript, React, Bun test, Electron IPC, Rust (`pazar-backend`, serde_json, ed25519-dalek).

**Spec:** Nema zasebnog spec fajla — odluke su donesene u razgovoru 2026-09-24 i prepisane ispod u "Odluke".

## Odluke

- **Jezgro (uvijek uključeno, nije u katalogu):** Kasa, Šifarnik, Računi, Izvještaji.
- **Licencirani moduli:** `skladiste`, `ponude`, `proizvodnja`, `generator`.
- **Stari token bez `m`** = svi moduli (postojeći klijenti ne gube ništa).
- **`m: []`** = samo jezgro. `m` koji nije niz stringova = token neispravnog formata. Nepoznati ID modula u `m` se prešutno ignoriše (novi generator, stara aplikacija).
- **Stanje bez licence** (`nema`, `neispravna`): moduli se računaju kao svi — pisanje je ionako blokirano licencom.
- **Proizvodnja i Generator** traže licencu **i** uključenu postavku. Skladište i Ponude traže samo licencu.
- **Veza Ponude–Proizvodnja** postoji samo kad su oba modula uključena. Licenca blokira *pravljenje nove veze* (`nalog:createIzPonude` traži oba), nikad *završavanje* postojećeg posla: bez veze Ponude dozvoljavaju konverziju u račun i kad nalog postoji (`proizvodnja.ts:527` to već pokriva), a `nalog:izdajRacun` za nalog iz ponude radi i bez modula Ponude (`konvertujPonudu` je lib funkcija, ne kanal).
- **Modul van licence:** ekran se sakriva iz navigacije, podaci ostaju u bazi i vraćaju se kad se modul ponovo licencira. Backend blokira samo kanale koji pišu; čitanje ostaje.
- **Novi generator uvijek upisuje `m` eksplicitno** (default = sve postojeće osim Generatora), da budući moduli ne dođu automatski starim klijentima.

## Global Constraints

- Prefiks tokena ostaje `PAZAR1`; payload ključevi kratki (`m`).
- Stari tokeni moraju i dalje prolaziti: `procitajLicencu` za token bez `m` vraća objekat **bez** ključa `moduli` (postojeći test `toEqual(osnovna)` to provjerava).
- Poruka za blokiran modul, identična u oba backenda: `Modul <Naziv> nije uključen u licencu.`
- Poruka za isteklu licencu ostaje: `Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.`
- Event `licenca:blokirano` šalje se samo za isteklu licencu, ne za modul.
- Bun, ne npm/node (`bun test`, `bun tools/...`).
- Komentari i nazivi na bosanskom, kao ostatak koda.

## Review Focus

1. **Stari token u novoj aplikaciji** — sve radi kao prije, svi ekrani vidljivi (pokriveno u Task 1 i 2).
2. **Dopisan modul u payload ručno** — mora pasti na potpisu (Task 1).
3. **Klijent izgubi Proizvodnju, a ima ponudu s otvorenim nalogom** — u Ponudama nema dugmadi za nalog, a "Konvertuj u račun" je dostupno (Task 6, ručna provjera).
4. **Kanal iz kataloga koji ne postoji u handlerima** (tipfeler u JSON-u) — tiho ne bi blokirao ništa; test u Task 2 poredi katalog s `handlers.ts`.
5. **Rust i TS parser se razilaze za `"m": null`** — oba moraju reći "format" (Task 1 i 3 imaju isti test slučaj).

---

## Struktura fajlova

| Fajl | Odgovornost |
|---|---|
| `src/lib/moduliKatalog.json` (novo) | Jedini izvor: lista modula, nazivi, kanal → moduli |
| `src/lib/moduli.ts` (novo) | Čiste funkcije: normalizacija, licencirani moduli, blokada kanala, efektivno stanje modula, opis za prikaz |
| `src/lib/moduli.test.ts` (novo) | Testovi za gornje + katalog vs `handlers.ts` |
| `src/lib/licenca.ts` | `Licenca.moduli`, polje `m` u izdavanju/čitanju |
| `src/lib/licencaStanje.ts` | `BLOKIRANI_KANALI` preseljeni ovdje, `kanalPodLicencom`, `razlogBlokade` |
| `src/ipc/licenca.ts` | `provjeriKanal` koristi `razlogBlokade` |
| `src-tauri/backend/src/licenca.rs` | Isto u Rustu |
| `tools/licenca-zajednicko.ts`, `tools/licenca.ts`, `tools/licenca-gui/*` | Izbor modula pri izdavanju |
| `src/hooks/useModuli.ts` (novo), `src/hooks/useProizvodnja.ts` | Renderer stanje modula |
| `src/components/MainLayout.tsx`, `src/screens/LoginScreen.tsx`, `src/screens/PostavkeScreen.tsx`, `src/screens/PonudeScreen.tsx`, `src/components/licenca/LicencaKartica.tsx` | UI |

---

### Task 1: Katalog modula i polje `m` u tokenu (TS)

**Files:**
- Create: `src/lib/moduliKatalog.json`
- Create: `src/lib/moduli.ts`
- Modify: `src/lib/licenca.ts`
- Test: `src/lib/licenca.test.ts`

**Interfaces:**
- Produces: `type Modul = 'skladiste' | 'ponude' | 'proizvodnja' | 'generator'`; `LICENCIRANI_MODULI: readonly Modul[]`; `NAZIV_MODULA: Record<Modul, string>`; `KANALI_MODULA: Record<string, Modul[]>`; `normalizujModule(m: unknown): Modul[] | null`; `Licenca.moduli?: Modul[]`.

- [ ] **Step 1: Napiši katalog**

`src/lib/moduliKatalog.json`:
```json
{
  "moduli": ["skladiste", "ponude", "proizvodnja", "generator"],
  "nazivi": {
    "skladiste": "Skladište",
    "ponude": "Ponude",
    "proizvodnja": "Proizvodnja",
    "generator": "Generator"
  },
  "kanali": {
    "primka:create": ["skladiste"],
    "primka:update": ["skladiste"],
    "primka:delete": ["skladiste"],
    "product:adjustStock": ["skladiste"],
    "ponuda:create": ["ponude"],
    "ponuda:update": ["ponude"],
    "ponuda:setStatus": ["ponude"],
    "ponuda:delete": ["ponude"],
    "ponuda:konvertuj": ["ponude"],
    "nalog:create": ["proizvodnja"],
    "nalog:createIzPonude": ["ponude", "proizvodnja"],
    "nalog:update": ["proizvodnja"],
    "nalog:replaceStavke": ["proizvodnja"],
    "nalog:setStatus": ["proizvodnja"],
    "nalog:delete": ["proizvodnja"],
    "nalog:izdajRacun": ["proizvodnja"],
    "normativ:save": ["proizvodnja"],
    "proizvodnja:setEnabled": ["proizvodnja"]
  }
}
```

- [ ] **Step 2: Napiši `src/lib/moduli.ts` (samo katalog i normalizacija za sada)**

```ts
// Licencirani moduli. Katalog (lista, nazivi, kanal → moduli) je u
// moduliKatalog.json da ga Rust backend čita isti (`include_str!`).
// Jezgro — Kasa, Šifarnik, Računi, Izvještaji — nije ovdje: uvijek je uključeno.
import katalog from './moduliKatalog.json';

export type Modul = 'skladiste' | 'ponude' | 'proizvodnja' | 'generator';

export const LICENCIRANI_MODULI = katalog.moduli as readonly Modul[];
export const NAZIV_MODULA = katalog.nazivi as Record<Modul, string>;
export const KANALI_MODULA = katalog.kanali as Record<string, Modul[]>;

/**
 * Sirovo `m` polje tokena → poznati moduli, bez duplikata, redom iz kataloga.
 * Nepoznati ID se ignoriše (token iz novijeg generatora). null = nije niz stringova.
 */
export function normalizujModule(m: unknown): Modul[] | null {
  if (!Array.isArray(m) || !m.every(x => typeof x === 'string')) return null;
  return LICENCIRANI_MODULI.filter(x => m.includes(x));
}
```

- [ ] **Step 3: Napiši testove koji padaju** — u `src/lib/licenca.test.ts` proširi postojeći import na `import { generateKeyPairSync, sign } from 'node:crypto';` i dodaj na kraj:

```ts
/** Token s proizvoljnim payloadom (i onim koji izdajLicencu ne dozvoljava). */
function potpisi(payload: object): string {
  const tijelo = `PAZAR1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${tijelo}.${sign(null, Buffer.from(tijelo), privateKey).toString('base64url')}`;
}
const sada = new Date(2026, 9, 5);

test('moduli se čuvaju u tokenu, redom iz kataloga i bez duplikata', () => {
  const token = izdajLicencu({ ...osnovna, moduli: ['proizvodnja', 'ponude', 'ponude'] }, privateKey);
  expect(provjeriLicencu(token, publicKey, { sada })).toEqual({ ok: true, licenca: { ...osnovna, moduli: ['ponude', 'proizvodnja'] } });
});

test('prazna lista modula znači samo jezgro i ostaje prazna', () => {
  const token = izdajLicencu({ ...osnovna, moduli: [] }, privateKey);
  expect(procitajLicencu(token)).toEqual({ ...osnovna, moduli: [] });
});

test('stari token bez m nema polje moduli', () => {
  const token = potpisi({ k: osnovna.klijent, d: osnovna.vrijediDo, i: osnovna.izdana });
  expect(procitajLicencu(token)).toEqual(osnovna);
  expect('moduli' in procitajLicencu(token)!).toBe(false);
});

test('dopisan modul u payload ruši potpis', () => {
  const token = izdajLicencu({ ...osnovna, moduli: ['ponude'] }, privateKey);
  const [pre, , potpis] = token.split('.');
  const lazni = Buffer.from(JSON.stringify({ k: osnovna.klijent, d: osnovna.vrijediDo, i: osnovna.izdana, m: ['ponude', 'proizvodnja'] })).toString('base64url');
  expect(provjeriLicencu(`${pre}.${lazni}.${potpis}`, publicKey, { sada })).toEqual({ ok: false, razlog: 'potpis' });
});

test('izdavanje s nepoznatim modulom baca grešku', () => {
  expect(() => izdajLicencu({ ...osnovna, moduli: ['racunovodstvo' as never] }, privateKey)).toThrow('Nepoznat modul: racunovodstvo');
});

test('nepoznat modul u tokenu se ignoriše, m koji nije niz je greška formata', () => {
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: ['ponude', 'buducnost'] }))?.moduli).toEqual(['ponude']);
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: 'ponude' }))).toBeNull();
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: null }))).toBeNull();
  expect(procitajLicencu(potpisi({ k: 'F', d: '2026-10-31', i: '2026-10-01', m: [1] }))).toBeNull();
});
```

- [ ] **Step 4: Pokreni, mora pasti**

Run: `bun test src/lib/licenca.test.ts`
Expected: FAIL (novi testovi; `moduli` se ne upisuje/čita).

- [ ] **Step 5: Implementiraj u `src/lib/licenca.ts`**

Dodaj import na vrh (ispod postojećeg `node:crypto` importa):
```ts
import { LICENCIRANI_MODULI, normalizujModule, type Modul } from './moduli';
```
U `interface Licenca` dodaj nakon `uredjaj?`:
```ts
  /** Licencirani moduli. Nema polja = stari token = svi moduli; [] = samo jezgro. */
  moduli?: Modul[];
```
U `interface Payload` dodaj `m?: string[];`.

U `izdajLicencu`, poslije `if (licenca.uredjaj) payload.u = licenca.uredjaj;`:
```ts
  if (licenca.moduli) {
    const nepoznati = licenca.moduli.filter(m => !LICENCIRANI_MODULI.includes(m));
    if (nepoznati.length) throw new Error(`Nepoznat modul: ${nepoznati.join(', ')}`);
    payload.m = normalizujModule(licenca.moduli)!;
  }
```
U `procitajLicencu` zamijeni tijelo `try` bloka:
```ts
    const p = JSON.parse(Buffer.from(dijelovi[1], 'base64url').toString('utf8')) as Payload;
    if (typeof p.k !== 'string' || !DATUM.test(p.d) || !DATUM.test(p.i)) return null;
    let moduli: Modul[] | undefined;
    if ('m' in p) {
      const n = normalizujModule(p.m);
      if (!n) return null;
      moduli = n;
    }
    return { klijent: p.k, vrijediDo: p.d, izdana: p.i, ...(p.u ? { uredjaj: p.u } : {}), ...(moduli ? { moduli } : {}) };
```
(`'m' in p` a ne `p.m !== undefined`, da `"m": null` bude greška formata — isto kao Rust `p.get("m")`.)

- [ ] **Step 6: Pokreni, mora proći**

Run: `bun test src/lib/licenca.test.ts src/lib/licencaStanje.test.ts`
Expected: PASS (svi, uključujući stare).

- [ ] **Step 7: Commit**

```bash
git add src/lib/moduliKatalog.json src/lib/moduli.ts src/lib/licenca.ts src/lib/licenca.test.ts
git commit -m "feat(licenca): lista modula u tokenu licence"
```

---

### Task 2: Pravila modula i blokada kanala u Electron backendu

**Files:**
- Modify: `src/lib/moduli.ts`
- Create: `src/lib/moduli.test.ts`
- Modify: `src/lib/licencaStanje.ts`
- Modify: `src/ipc/licenca.ts`
- Test: `src/lib/licencaStanje.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Modul`, `LICENCIRANI_MODULI`, `NAZIV_MODULA`, `KANALI_MODULA`, `Licenca.moduli`).
- Produces (u `moduli.ts`): `type SkupModula = Record<Modul, boolean>`; `licenciraniModuli(s: StanjeLicence): SkupModula`; `modulVanLicence(s: StanjeLicence, kanal: string): Modul | null`; `interface PostavkeModula { proizvodnja: boolean; generator: boolean }`; `interface StanjeModula { licencirani: SkupModula; ukljuceni: SkupModula; vezaPonudaNalog: boolean }`; `stanjeModula(licencirani: SkupModula, p: PostavkeModula): StanjeModula`; `opisModula(moduli?: Modul[]): string`.
- Produces (u `licencaStanje.ts`): `kanalPodLicencom(kanal: string): boolean`; `razlogBlokade(s: StanjeLicence, kanal: string): { razlog: 'istekla' | 'modul'; poruka: string } | null`.

- [ ] **Step 1: Napiši testove koji padaju** — `src/lib/moduli.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import katalog from './moduliKatalog.json';
import { LICENCIRANI_MODULI, KANALI_MODULA, licenciraniModuli, modulVanLicence, stanjeModula, opisModula } from './moduli';
import type { StanjeLicence } from './licencaTipovi';

const licenca = { klijent: 'F', vrijediDo: '2026-12-31', izdana: '2026-01-01' };
const aktivna = (moduli?: string[]): StanjeLicence =>
  ({ stanje: 'aktivna', danaDoIsteka: 30, licenca: { ...licenca, ...(moduli ? { moduli } : {}) } }) as StanjeLicence;
const sve = { skladiste: true, ponude: true, proizvodnja: true, generator: true };

test('katalog i TS tip imaju iste module', () => {
  expect(katalog.moduli).toEqual(['skladiste', 'ponude', 'proizvodnja', 'generator']);
  expect(Object.keys(katalog.nazivi).sort()).toEqual([...LICENCIRANI_MODULI].sort());
  for (const moduli of Object.values(KANALI_MODULA)) for (const m of moduli) expect(LICENCIRANI_MODULI).toContain(m);
});

test('svaki kanal iz kataloga postoji u handlers.ts', () => {
  const handlers = readFileSync(path.join(import.meta.dir, '../ipc/handlers.ts'), 'utf8');
  for (const kanal of Object.keys(KANALI_MODULA)) expect(handlers).toContain(`handle('${kanal}'`);
});

test('stari token i stanje bez licence daju sve module', () => {
  expect(licenciraniModuli(aktivna())).toEqual(sve);
  expect(licenciraniModuli({ stanje: 'nema' })).toEqual(sve);
  expect(licenciraniModuli({ stanje: 'neispravna', razlog: 'potpis' })).toEqual(sve);
});

test('licenca s listom daje samo te module, i kad je zaključana', () => {
  expect(licenciraniModuli(aktivna(['ponude']))).toEqual({ skladiste: false, ponude: true, proizvodnja: false, generator: false });
  expect(licenciraniModuli({ stanje: 'zakljucana', licenca: { ...licenca, moduli: [] } })).toEqual({ skladiste: false, ponude: false, proizvodnja: false, generator: false });
});

test('kanal nelicenciranog modula je blokiran, jezgro i čitanje nisu', () => {
  const s = aktivna(['proizvodnja']);
  expect(modulVanLicence(s, 'ponuda:create')).toBe('ponude');
  expect(modulVanLicence(s, 'nalog:createIzPonude')).toBe('ponude');
  expect(modulVanLicence(s, 'nalog:create')).toBeNull();
  expect(modulVanLicence(s, 'ponuda:getAll')).toBeNull();
  expect(modulVanLicence(s, 'order:create')).toBeNull();
  expect(modulVanLicence(aktivna(), 'nalog:createIzPonude')).toBeNull();
});

test('proizvodnja i generator traže i postavku, veza traži oba modula', () => {
  const lic = licenciraniModuli(aktivna(['ponude', 'proizvodnja']));
  expect(stanjeModula(lic, { proizvodnja: false, generator: true })).toEqual({
    licencirani: lic,
    ukljuceni: { skladiste: false, ponude: true, proizvodnja: false, generator: false },
    vezaPonudaNalog: false,
  });
  expect(stanjeModula(lic, { proizvodnja: true, generator: false }).vezaPonudaNalog).toBe(true);
  expect(stanjeModula(licenciraniModuli(aktivna(['proizvodnja'])), { proizvodnja: true, generator: false }).vezaPonudaNalog).toBe(false);
});

test('opis modula za prikaz', () => {
  expect(opisModula(undefined)).toBe('svi (bez ograničenja)');
  expect(opisModula([])).toBe('samo osnovni');
  expect(opisModula(['skladiste', 'ponude'])).toBe('Skladište, Ponude');
});
```

Dodaj u `src/lib/licencaStanje.test.ts` (proširi import iz `./licencaStanje` sa `razlogBlokade, kanalPodLicencom`):
```ts
test('razlog blokade: istekla licenca ima prednost nad modulom', () => {
  const lic = { klijent: 'F', vrijediDo: '2026-01-01', izdana: '2025-01-01', moduli: [] as never[] };
  expect(razlogBlokade({ stanje: 'zakljucana', licenca: lic }, 'ponuda:create')?.razlog).toBe('istekla');
  expect(razlogBlokade({ stanje: 'aktivna', licenca: lic, danaDoIsteka: 9 }, 'ponuda:create'))
    .toEqual({ razlog: 'modul', poruka: 'Modul Ponude nije uključen u licencu.' });
  expect(razlogBlokade({ stanje: 'aktivna', licenca: lic, danaDoIsteka: 9 }, 'order:create')).toBeNull();
  expect(razlogBlokade({ stanje: 'zakljucana', licenca: lic }, 'product:getAll')).toBeNull();
});

test('kanalPodLicencom: pisanje dokumenata i kanali modula, ne čitanje', () => {
  expect(kanalPodLicencom('order:create')).toBe(true);
  expect(kanalPodLicencom('normativ:save')).toBe(true);
  expect(kanalPodLicencom('primka:delete')).toBe(true);
  expect(kanalPodLicencom('product:getAll')).toBe(false);
});
```

- [ ] **Step 2: Pokreni, mora pasti**

Run: `bun test src/lib/moduli.test.ts src/lib/licencaStanje.test.ts`
Expected: FAIL — `licenciraniModuli`, `razlogBlokade` ne postoje.

- [ ] **Step 3: Dopuni `src/lib/moduli.ts`**

Dodaj import tipa na vrh: `import type { StanjeLicence } from './licencaTipovi';` i na kraj fajla:
```ts
export type SkupModula = Record<Modul, boolean>;

/** Šta licenca dozvoljava. Stari token bez liste i stanje bez licence daju sve. */
export function licenciraniModuli(s: StanjeLicence): SkupModula {
  const lista = 'licenca' in s ? s.licenca.moduli : undefined;
  return Object.fromEntries(LICENCIRANI_MODULI.map(m => [m, lista ? lista.includes(m) : true])) as SkupModula;
}

/** Prvi modul koji kanal traži a licenca ga nema; null = kanal je dozvoljen. */
export function modulVanLicence(s: StanjeLicence, kanal: string): Modul | null {
  const trazi = KANALI_MODULA[kanal];
  if (!trazi) return null;
  const l = licenciraniModuli(s);
  return trazi.find(m => !l[m]) ?? null;
}

export interface PostavkeModula {
  proizvodnja: boolean;
  generator: boolean;
}

export interface StanjeModula {
  licencirani: SkupModula;
  ukljuceni: SkupModula;
  /** Radni nalog iz ponude — samo kad su uključene i Ponude i Proizvodnja. */
  vezaPonudaNalog: boolean;
}

/** Licenca kaže šta je dozvoljeno; Proizvodnja i Generator traže i uključenu postavku. */
export function stanjeModula(licencirani: SkupModula, p: PostavkeModula): StanjeModula {
  const ukljuceni: SkupModula = {
    skladiste: licencirani.skladiste,
    ponude: licencirani.ponude,
    proizvodnja: licencirani.proizvodnja && p.proizvodnja,
    generator: licencirani.generator && p.generator,
  };
  return { licencirani, ukljuceni, vezaPonudaNalog: ukljuceni.ponude && ukljuceni.proizvodnja };
}

/** "Skladište, Ponude" / "samo osnovni" / "svi (bez ograničenja)" za stari token. */
export function opisModula(moduli?: Modul[]): string {
  if (!moduli) return 'svi (bez ograničenja)';
  if (!moduli.length) return 'samo osnovni';
  return moduli.map(m => NAZIV_MODULA[m]).join(', ');
}
```

- [ ] **Step 4: Preseli `BLOKIRANI_KANALI` i dodaj `razlogBlokade` u `src/lib/licencaStanje.ts`**

Dodaj import: `import { KANALI_MODULA, NAZIV_MODULA, modulVanLicence } from './moduli';`
Na kraj fajla:
```ts
/** Kanali koji prave nove dokumente ili mijenjaju stanje zaliha. */
const BLOKIRANI_KANALI = new Set([
  'order:create', 'order:createManual', 'order:finalize', 'order:finalizePrilog',
  'order:refund', 'order:refundAndPrint',
  'tring:printReceipt', 'tring:printRefund',
  'primka:create', 'primka:update',
  'product:adjustStock',
  'ponuda:create', 'ponuda:update', 'ponuda:konvertuj',
  'nalog:create', 'nalog:createIzPonude', 'nalog:update', 'nalog:replaceStavke',
  'nalog:setStatus', 'nalog:izdajRacun',
]);

/** Da li kanal uopšte zavisi od licence — ostali ne čitaju licenca.json. */
export function kanalPodLicencom(kanal: string): boolean {
  return BLOKIRANI_KANALI.has(kanal) || kanal in KANALI_MODULA;
}

/** Zašto licenca ne dozvoljava kanal; null = dozvoljen. Istekla licenca ima prednost. */
export function razlogBlokade(s: StanjeLicence, kanal: string): { razlog: 'istekla' | 'modul'; poruka: string } | null {
  if (BLOKIRANI_KANALI.has(kanal) && !smijeRaditi(s)) {
    return { razlog: 'istekla', poruka: 'Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.' };
  }
  const modul = modulVanLicence(s, kanal);
  return modul ? { razlog: 'modul', poruka: `Modul ${NAZIV_MODULA[modul]} nije uključen u licencu.` } : null;
}
```

- [ ] **Step 5: Prepiši `provjeriKanal` u `src/ipc/licenca.ts`**

Obriši lokalni `BLOKIRANI_KANALI` (linije 15–25) i komentar iznad njega. Import iz `../lib/licencaStanje` promijeni u:
```ts
import { izracunajStanje, efektivniDanas, kanalPodLicencom, razlogBlokade, type LicencaInfo } from '../lib/licencaStanje';
```
Zamijeni `provjeriKanal`:
```ts
/** Baca grešku ako licenca ne dozvoljava kanal (istekla ili modul nije licenciran). */
export function provjeriKanal(kanal: string): void {
  if (!kanalPodLicencom(kanal)) return;
  const blokada = razlogBlokade(stanjeLicence(), kanal);
  if (!blokada) return;
  if (blokada.razlog === 'istekla') {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('licenca:blokirano');
  }
  throw new Error(blokada.poruka);
}
```
Ažuriraj komentar na vrhu fajla: "…i blokira kanale koji prave nove dokumente kad je licenca zaključana ili modul nije licenciran."

- [ ] **Step 6: Pokreni, mora proći**

Run: `bun test src/lib`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/moduli.ts src/lib/moduli.test.ts src/lib/licencaStanje.ts src/lib/licencaStanje.test.ts src/ipc/licenca.ts
git commit -m "feat(licenca): blokada kanala nelicenciranih modula u Electron backendu"
```

---

### Task 3: Isto u Rust backendu

**Files:**
- Modify: `src-tauri/backend/src/licenca.rs`

**Interfaces:**
- Consumes: `src/lib/moduliKatalog.json` (Task 1) preko `include_str!`.
- Produces: `procitaj_licencu` vraća `"moduli"` kad token ima `m`; `razlog_blokade(s: &Value, kanal: &str) -> Option<(bool, String)>` (`true` = istekla).

- [ ] **Step 1: Napiši test koji pada** — u `mod tests` na dnu `licenca.rs` dodaj:

```rust
    #[test]
    fn moduli_u_licenci() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let v = k.verifying_key();
        let stari = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01"}"#);
        assert!(procitaj_licencu(&stari).unwrap().get("moduli").is_none());
        let sa = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","m":["proizvodnja","ponude","buducnost"]}"#);
        assert_eq!(procitaj_licencu(&sa).unwrap()["moduli"], json!(["ponude", "proizvodnja"]));
        for los in [r#""m":"ponude""#, r#""m":null"#, r#""m":[1]"#] {
            let t = izdaj(&k, &format!(r#"{{"k":"F","d":"2026-10-10","i":"2026-01-01",{los}}}"#));
            assert!(procitaj_licencu(&t).is_none(), "{los}");
        }

        let samo_proizvodnja = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","m":["proizvodnja"]}"#);
        let s = izracunaj_stanje(Some(&samo_proizvodnja), &v, "2026-09-01", "X");
        assert_eq!(razlog_blokade(&s, "ponuda:create"), Some((false, "Modul Ponude nije uključen u licencu.".to_string())));
        assert_eq!(razlog_blokade(&s, "nalog:createIzPonude"), Some((false, "Modul Ponude nije uključen u licencu.".to_string())));
        assert_eq!(razlog_blokade(&s, "nalog:create"), None);
        assert_eq!(razlog_blokade(&s, "order:create"), None);
        let s_stari = izracunaj_stanje(Some(&stari), &v, "2026-09-01", "X");
        assert_eq!(razlog_blokade(&s_stari, "nalog:createIzPonude"), None);
        let zakljucana = izracunaj_stanje(Some(&samo_proizvodnja), &v, "2026-12-01", "X");
        assert!(razlog_blokade(&zakljucana, "ponuda:create").unwrap().0);
        assert!(pod_licencom("normativ:save") && pod_licencom("order:create") && !pod_licencom("product:getAll"));
    }
```

- [ ] **Step 2: Pokreni, mora pasti**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend moduli_u_licenci`
Expected: FAIL kompajliranja — `razlog_blokade`, `pod_licencom` ne postoje.

- [ ] **Step 3: Implementiraj**

Ispod `javni_kljuc()` dodaj:
```rust
/// Katalog modula iz `src/lib/moduliKatalog.json` (jedan izvor za oba backenda).
fn katalog() -> &'static Value {
    static K: OnceLock<Value> = OnceLock::new();
    K.get_or_init(|| serde_json::from_str(include_str!("../../../src/lib/moduliKatalog.json")).expect("ispravan moduliKatalog.json"))
}

/// `normalizujModule`: poznati moduli redom iz kataloga; `None` kad nije niz stringova.
fn normalizuj_module(m: &Value) -> Option<Value> {
    let niz = m.as_array().filter(|n| n.iter().all(Value::is_string))?;
    Some(Value::Array(katalog()["moduli"].as_array().unwrap().iter().filter(|x| niz.contains(x)).cloned().collect()))
}
```
U `procitaj_licencu`, poslije bloka za `"u"`:
```rust
    if let Some(m) = p.get("m") {
        l.insert("moduli".into(), normalizuj_module(m)?);
    }
```
Zamijeni `provjeri_kanal` i dodaj pomoćne funkcije iznad nje:
```rust
/// `kanalPodLicencom`: kanal koji pravi dokumente ili pripada modulu.
fn pod_licencom(kanal: &str) -> bool {
    BLOKIRANI_KANALI.contains(&kanal) || katalog()["kanali"].get(kanal).is_some()
}

/// `razlogBlokade`: `Some((istekla, poruka))` kad licenca ne dozvoljava kanal.
pub fn razlog_blokade(s: &Value, kanal: &str) -> Option<(bool, String)> {
    if BLOKIRANI_KANALI.contains(&kanal) && !smije_raditi(s) {
        return Some((true, "Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.".into()));
    }
    let trazi = katalog()["kanali"].get(kanal)?.as_array()?;
    // Stari token (bez "moduli") i stanje bez licence dozvoljavaju sve.
    let lista = s["licenca"].get("moduli").and_then(Value::as_array)?;
    let fali = trazi.iter().find(|m| !lista.contains(m))?.as_str()?;
    Some((false, format!("Modul {} nije uključen u licencu.", katalog()["nazivi"][fali].as_str().unwrap_or(fali))))
}

/// Baca grešku ako licenca ne dozvoljava kanal (istekla ili modul nije licenciran).
pub fn provjeri_kanal(b: &Backend, kanal: &str) -> R<()> {
    if !b.provjera_licence || !pod_licencom(kanal) {
        return Ok(());
    }
    match razlog_blokade(&stanje_licence(b)?, kanal) {
        None => Ok(()),
        Some((istekla, poruka)) => {
            if istekla {
                b.licenca_blokirana();
            }
            Err(Greska(poruka))
        }
    }
}
```
Ažuriraj doc komentar na vrhu fajla: dodaj red "Moduli i kanal → moduli: `src/lib/moduliKatalog.json`."

- [ ] **Step 4: Pokreni, mora proći**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend licenca`
Expected: PASS (`stanja_licence` i `moduli_u_licenci`).

- [ ] **Step 5: Ugovorni testovi i dalje prolaze**

Run: `bun run test:rust`
Expected: PASS, isti broj testova kao prije (ugovor radi s otključanom licencom, pa se ništa ne mijenja — ovo hvata greške kompajliranja ugovor-servera).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/backend/src/licenca.rs
git commit -m "feat(licenca): moduli u licenci i u Rust backendu"
```

---

### Task 4: Izbor modula u generatoru licenci (CLI i GUI)

**Files:**
- Modify: `tools/licenca-zajednicko.ts`
- Modify: `tools/licenca.ts`
- Modify: `tools/licenca-gui/server.ts`
- Modify: `tools/licenca-gui/index.html`

**Interfaces:**
- Consumes: `Modul`, `LICENCIRANI_MODULI`, `opisModula` (Task 1–2); `Licenca.moduli`.
- Produces: `izdaj(unos: { klijent; vrijediDo; uredjaj?; moduli: Modul[] })`; `PODRAZUMIJEVANI_MODULI: Modul[]`.

- [ ] **Step 1: `tools/licenca-zajednicko.ts`**

Import: `import type { Modul } from '../src/lib/moduli';`. Dodaj konstantu:
```ts
/** Novi klijent dobija sve osim Generatora (interni alat). */
export const PODRAZUMIJEVANI_MODULI: Modul[] = ['skladiste', 'ponude', 'proizvodnja'];
```
U `izdaj` potpis postaje `unos: { klijent: string; vrijediDo: string; uredjaj?: string; moduli: Modul[] }`, a u objekat `licenca` dodaj `moduli: unos.moduli,` (poslije `izdana`). `izdajLicencu` validira nepoznate module.

- [ ] **Step 2: CLI `tools/licenca.ts`**

Dodaj `moduli: { type: 'string' },` u `parseArgs` opcije. Prije `let token`:
```ts
  const moduli = (values.moduli === undefined ? PODRAZUMIJEVANI_MODULI : values.moduli.split(',').map(m => m.trim()).filter(Boolean)) as Modul[];
```
Proslijedi `moduli` u `izdajLicencu({ ..., moduli })`. Ispis poslije "Važi do": `console.error(\`Moduli:    ${opisModula(moduli)}\`);`
U `provjeri` poslije "Uređaj" linije: `console.log(\`Moduli:    ${opisModula(licenca.moduli)}\`);`
Importi: `PODRAZUMIJEVANI_MODULI` iz `./licenca-zajednicko`, `opisModula, type Modul` iz `../src/lib/moduli`.
Ažuriraj upotrebu u zaglavlju i `default` poruci: `izdaj --klijent X (--dana N | --do YYYY-MM-DD) [--uredjaj ID] [--moduli skladiste,ponude,proizvodnja,generator | --moduli ""]`.

- [ ] **Step 3: Provjeri CLI na privremenom ključu**

```bash
export PAZAR_LICENCA_KLJUC="$(mktemp -d)/privatni.pem"
cp src/lib/licencaJavniKljuc.ts /tmp/javni-backup.ts
bun tools/licenca.ts kljucevi
T=$(bun tools/licenca.ts izdaj --klijent Test --dana 5 --moduli ponude,proizvodnja 2>/dev/null); bun tools/licenca.ts provjeri "$T"
T=$(bun tools/licenca.ts izdaj --klijent Test --dana 5 --moduli "" 2>/dev/null); bun tools/licenca.ts provjeri "$T"
bun tools/licenca.ts izdaj --klijent Test --dana 5 --moduli racunovodstvo; echo "exit $?"
cp /tmp/javni-backup.ts src/lib/licencaJavniKljuc.ts && git diff --exit-code src/lib/licencaJavniKljuc.ts
unset PAZAR_LICENCA_KLJUC
```
Expected: `Moduli:    Ponude, Proizvodnja`, pa `Moduli:    samo osnovni`, pa `Greška: Nepoznat modul: racunovodstvo` i `exit 1`. `kljucevi` prepisuje `licencaJavniKljuc.ts` — zadnja linija ga vraća i mora pokazati da nema razlike.

- [ ] **Step 4: GUI server `tools/licenca-gui/server.ts`**

Import: `import { LICENCIRANI_MODULI, NAZIV_MODULA, opisModula, type Modul } from '../../src/lib/moduli';` i `PODRAZUMIJEVANI_MODULI` iz `../licenca-zajednicko`.
Dodaj pomoćnu: `const saOpisom = <T extends { moduli?: Modul[] }>(l: T) => ({ ...l, opisModula: opisModula(l.moduli) });`
- `/api/stanje` vraća `{ kljuc, izdane: izdaneLicence().reverse().map(saOpisom), moduli: LICENCIRANI_MODULI.map(id => ({ id, naziv: NAZIV_MODULA[id] })), podrazumijevani: PODRAZUMIJEVANI_MODULI }`.
- `/api/izdaj`: tijelo ima `moduli?: string[]`; poslije provjere klijenta: `if (!Array.isArray(b.moduli)) return greska('Odaberi module');` i proslijedi `moduli: b.moduli as Modul[]` u `izdaj`. Odgovor: `Response.json(saOpisom(izdaj({...})))`.
- `/api/provjeri`: `licenca: saOpisom(licenca)`.

- [ ] **Step 5: GUI `tools/licenca-gui/index.html`**

U formi, iza polja `uredjaj`, dodaj:
```html
        <label>Moduli <span style="font-weight:400;color:var(--blijed)">(Kasa, Šifarnik, Računi i Izvještaji su uvijek uključeni)</span></label>
        <div class="brzo" id="paketi">
          <button type="button" data-paket="">Start</button>
          <button type="button" data-paket="skladiste">Trgovina</button>
          <button type="button" data-paket="skladiste,ponude,proizvodnja">Biznis</button>
        </div>
        <div id="moduli" style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px"></div>
```
U tabeli dodaj kolonu: `<th>Moduli</th>` iza `Uređaj`, i u redu `<td>${esc(l.opisModula)}</td>` iza ćelije uređaja; `colspan="6"` → `colspan="7"`.
U skripti:
```js
let sviModuli = [];
function crtajModule(odabrani) {
  $('moduli').innerHTML = sviModuli.map((m) =>
    `<label style="display:flex;gap:6px;align-items:center;font-weight:400;margin:0"><input type="checkbox" value="${m.id}" style="width:auto" ${odabrani.includes(m.id) ? 'checked' : ''}>${esc(m.naziv)}</label>`).join('');
}
function odabraniModuli() { return [...$('moduli').querySelectorAll('input:checked')].map((i) => i.value); }
$('paketi').addEventListener('click', (e) => { if (e.target.dataset.paket !== undefined) crtajModule(e.target.dataset.paket.split(',').filter(Boolean)); });
```
U `ucitaj()` poslije `izdane = s.izdane;`: `sviModuli = s.moduli; crtajModule(s.podrazumijevani);`.
U submit-u `api('/api/izdaj', {...})` dodaj `moduli: odabraniModuli()`, a poruka uspjeha postaje `` `Izdana za ${l.klijent}, važi do ${prikaz(l.vrijediDo)}. Moduli: ${l.opisModula}.` ``.
U "Produži": poslije `$('uredjaj').value = ...` dodaj `crtajModule(l.moduli ?? sviModuli.map((m) => m.id));` (stara licenca bez liste = sve).
U provjeri, u `info.innerHTML` dodaj `<dt>Moduli</dt><dd>${esc(l.opisModula)}</dd>`.

- [ ] **Step 6: Provjeri GUI**

```bash
export PAZAR_LICENCA_KLJUC="$(mktemp -d)/privatni.pem"; cp src/lib/licencaJavniKljuc.ts /tmp/javni-backup.ts
bun tools/licenca.ts kljucevi >/dev/null
BEZ_BROWSERA=1 PORT=4799 bun tools/licenca-gui/server.ts & sleep 1
curl -s localhost:4799/api/stanje | head -c 400; echo
curl -s -XPOST localhost:4799/api/izdaj -d '{"klijent":"Test","dana":5,"moduli":["ponude"]}' | head -c 300; echo
curl -s -XPOST localhost:4799/api/izdaj -d '{"klijent":"Test","dana":5}'; echo
kill %1; cp /tmp/javni-backup.ts src/lib/licencaJavniKljuc.ts; git diff --exit-code src/lib/licencaJavniKljuc.ts; unset PAZAR_LICENCA_KLJUC
```
Expected: stanje ima `moduli` i `podrazumijevani`; izdavanje vraća `"opisModula":"Ponude"`; bez modula `{"greska":"Odaberi module"}`. Zatim ručno otvori GUI (`bun tools/licenca-gui/server.ts`) s pravim ključem i pogledaj formu — checkboxovi, paketi, kolona Moduli.

- [ ] **Step 7: Commit**

```bash
git add tools/
git commit -m "feat(licenca): izbor modula u generatoru licenci"
```

---

### Task 5: Renderer — `useModuli`, navigacija i kartica licence

**Files:**
- Create: `src/hooks/useModuli.ts`
- Modify: `src/hooks/useProizvodnja.ts`
- Modify: `src/components/MainLayout.tsx`
- Modify: `src/components/licenca/LicencaKartica.tsx`

**Interfaces:**
- Consumes: `licenciraniModuli`, `stanjeModula`, `StanjeModula`, `Modul`, `opisModula` (Task 2); `useLicenca` (postojeći).
- Produces: `useModuli(): StanjeModula | null`; `useProizvodnja(): boolean | null` (isti potpis, sada svjestan licence).

- [ ] **Step 1: Zabilježi baseline typecheck grešaka**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS" > /tmp/tsc-prije.txt; cat /tmp/tsc-prije.txt`
(Lint/tsc već pada na `main` zbog `@/` resolvera — poredimo broj grešaka, ne tražimo nulu.)

- [ ] **Step 2: `src/hooks/useModuli.ts`**

```ts
import { useEffect, useMemo, useState } from 'react';
import { useLicenca } from './useLicenca';
import { licenciraniModuli, stanjeModula, type PostavkeModula, type StanjeModula } from '@/lib/moduli';

/** Moduli iz licence i postavki. null = još se učitava. */
export function useModuli(): StanjeModula | null {
  const licenca = useLicenca();
  const [postavke, setPostavke] = useState<PostavkeModula | null>(null);

  useEffect(() => {
    Promise.all([window.api.getSetting('proizvodnja.enabled'), window.api.getSetting('ui.showGenerator')])
      .then(([p, g]) => setPostavke({ proizvodnja: p === 'true', generator: g === 'true' }));
    // Postavke javljaju promjenu odmah, bez ponovnog ulaska u aplikaciju
    const promjena = (kljuc: keyof PostavkeModula) => (e: Event) =>
      setPostavke(s => s && { ...s, [kljuc]: Boolean((e as CustomEvent).detail) });
    const onProizvodnja = promjena('proizvodnja');
    const onGenerator = promjena('generator');
    window.addEventListener('ui:proizvodnja', onProizvodnja);
    window.addEventListener('ui:showGenerator', onGenerator);
    return () => {
      window.removeEventListener('ui:proizvodnja', onProizvodnja);
      window.removeEventListener('ui:showGenerator', onGenerator);
    };
  }, []);

  return useMemo(
    () => (licenca && postavke ? stanjeModula(licenciraniModuli(licenca), postavke) : null),
    [licenca, postavke],
  );
}
```

- [ ] **Step 3: `src/hooks/useProizvodnja.ts`** — zamijeni cijeli sadržaj:

```ts
import { useModuli } from './useModuli';

/** Da li je modul Proizvodnja uključen (licenca + postavka). null = još se učitava. */
export function useProizvodnja(): boolean | null {
  const moduli = useModuli();
  return moduli ? moduli.ukljuceni.proizvodnja : null;
}
```

- [ ] **Step 4: `src/components/MainLayout.tsx`**

- Import `useProizvodnja` zamijeni sa `import { useModuli } from '@/hooks/useModuli';` i dodaj `import type { Modul } from '@/lib/moduli';`.
- Tip `NAV_ITEMS` dobija `modul?: Modul`; stavkama dodaj: `skladiste` → `modul: 'skladiste'`, `ponude` → `modul: 'ponude'`, `proizvodnja` → `modul: 'proizvodnja'`, `generator` → `modul: 'generator'`.
- Obriši `const [showGenerator, setShowGenerator] = useState(false);`, `const proizvodnja = useProizvodnja();`, cijeli `useEffect` koji čita `ui.showGenerator` i `useEffect` za `proizvodnja === false`. Umjesto njih:
```ts
  const moduli = useModuli();

  // Modul isključen (licenca ili postavka) dok je njegov ekran otvoren → nazad na Kasu.
  useEffect(() => {
    const modul = NAV_ITEMS.find(i => i.id === screen)?.modul;
    if (moduli && modul && !moduli.ukljuceni[modul]) setScreen('kasa');
  }, [moduli, screen]);
```
- U navigaciji zamijeni dvije linije `if (item.id === 'generator' ...)` i `if (item.id === 'proizvodnja' ...)` sa:
```ts
              if (item.modul && !moduli?.ukljuceni[item.modul]) return null;
```

- [ ] **Step 5: `src/components/licenca/LicencaKartica.tsx`** — prikaži module

Import: `import { opisModula } from '@/lib/moduli';`. U `<dl>`, unutar `{licenca && (<>…</>)}` poslije "Važi do":
```tsx
              <dt className="text-slate-400">Moduli</dt>
              <dd className="text-slate-800">{opisModula(licenca.moduli)}</dd>
```

- [ ] **Step 6: Typecheck i testovi**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; cat /tmp/tsc-prije.txt; bun test src/lib`
Expected: broj grešaka nije veći od baseline-a; testovi PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useModuli.ts src/hooks/useProizvodnja.ts src/components/MainLayout.tsx src/components/licenca/LicencaKartica.tsx
git commit -m "feat(licenca): navigacija prati module iz licence"
```

---

### Task 6: Renderer — prijava, Postavke i veza Ponude–Proizvodnja

**Files:**
- Modify: `src/screens/LoginScreen.tsx`
- Modify: `src/screens/PostavkeScreen.tsx`
- Modify: `src/screens/PonudeScreen.tsx`

**Interfaces:**
- Consumes: `useModuli()` (Task 5), `Modul`.

- [ ] **Step 1: `LoginScreen.tsx`**

- Import `useProizvodnja` zamijeni sa `import { useModuli } from '@/hooks/useModuli';` i `import type { Modul } from '@/lib/moduli';`.
- `MODULI`: umjesto `opcioni: true` koristi `modul`:
```ts
const MODULI: { naziv: string; icon: typeof ScanBarcode; modul?: Modul }[] = [
  { naziv: 'Kasa', icon: ScanBarcode },
  { naziv: 'Skladište', icon: Warehouse, modul: 'skladiste' },
  { naziv: 'Šifarnik', icon: NotebookTabs },
  { naziv: 'Računi', icon: ReceiptText },
  { naziv: 'Ponude', icon: FileSignature, modul: 'ponude' },
  { naziv: 'Proizvodnja', icon: Factory, modul: 'proizvodnja' },
  { naziv: 'Izvještaji', icon: BarChart3 },
];
```
- `const proizvodnja = useProizvodnja();` → `const moduli = useModuli();`
- U mapi zamijeni početak i napomenu:
```tsx
              {MODULI.map(({ naziv, icon: Icon, modul }) => {
                const ukljucen = !modul || moduli?.ukljuceni[modul] === true;
                const napomena = ukljucen || !modul || !moduli ? null : moduli.licencirani[modul] ? 'isključen' : 'nije u licenci';
```
i `{!ukljucen && <span …>· isključen</span>}` → `{napomena && <span className="text-[11px] text-slate-600">· {napomena}</span>}`.

- [ ] **Step 2: `PostavkeScreen.tsx`** — prekidači Generator i Proizvodnja

Import: `import { useModuli } from '@/hooks/useModuli';`. U komponenti, uz ostale `useState` pozive: `const moduli = useModuli();`.
Generator `Switch`: dodaj `disabled={!moduli?.licencirani.generator}` i `checked={generatorEnabled && !!moduli?.licencirani.generator}`; opis `<p>` postaje:
```tsx
<p className="text-[12px] text-slate-400 mt-0.5">
  {moduli && !moduli.licencirani.generator ? 'Nije uključeno u licencu.' : 'Prikazuje Generator ekran u navigaciji (samo admin)'}
</p>
```
Proizvodnja `Switch`: `disabled={!moduli?.licencirani.proizvodnja}`, `checked={proizvodnjaEnabled && !!moduli?.licencirani.proizvodnja}`; iza postojećeg opisa u istom `<p>` dodaj:
```tsx
  {moduli && !moduli.licencirani.proizvodnja && <span className="block text-amber-600 mt-0.5">Nije uključeno u licencu.</span>}
```

- [ ] **Step 3: `PonudeScreen.tsx`** — veza umjesto Proizvodnje

- Import `useProizvodnja` zamijeni sa `import { useModuli } from '@/hooks/useModuli';`.
- Linije 156–157:
```ts
  // Radni nalog iz ponude — samo kad su uključene i Ponude i Proizvodnja.
  // Bez veze nalog se ne dohvata, pa "Konvertuj u račun" ostaje dostupno i za
  // ponudu koja već ima nalog (proizvodnja.ts povezuje račun ako se modul vrati).
  const veza = useModuli()?.vezaPonudaNalog ?? false;
```
- U `useEffect` koji dohvata nalog: `if (!selected || !proizvodnja) return;` → `if (!selected || !veza) return;` i dependency `[selected, proizvodnja]` → `[selected, veza]`.
- Akcije (oko linije 797 i 800): `{proizvodnja && selStatus === 'prihvacena' …` → `{veza && selStatus === 'prihvacena' …`, `{proizvodnja && nalogZaPonudu && …` → `{veza && nalogZaPonudu && …`.

- [ ] **Step 4: Typecheck i testovi**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; cat /tmp/tsc-prije.txt; bun test`
Expected: broj tsc grešaka nije veći od baseline-a; svi testovi PASS (ili isti pad kao na `main`, zabilježi koji).

- [ ] **Step 5: Ručna provjera u aplikaciji**

Izdaj s pravim ključem tri licence za ID ovog računara (vidi Postavke → Licenca) i za svaku unesi kod u aplikaciji (`bun run start` ili Tauri dev prema `src-tauri/README.md`):
1. `--moduli ""` → sidebar: samo Kasa, Šifarnik, Računi, Izvještaji (+ Postavke za admina); prijava: Skladište/Ponude/Proizvodnja "· nije u licenci"; Postavke: prekidači Proizvodnja i Generator onemogućeni; kartica licence "Moduli: samo osnovni".
2. `--moduli ponude` s postojećom prihvaćenom ponudom koja ima nalog → u Ponudama nema dugmeta za nalog, "Konvertuj u račun" je vidljivo.
3. `--moduli ponude,proizvodnja` i uključena Proizvodnja u Postavkama → dugme "Radni nalog" / "Otvori nalog" radi kao prije.
Na kraju vrati svoju pravu licencu.

- [ ] **Step 6: Commit**

```bash
git add src/screens/LoginScreen.tsx src/screens/PostavkeScreen.tsx src/screens/PonudeScreen.tsx
git commit -m "feat(licenca): prijava, Postavke i Ponude prate module iz licence"
```
