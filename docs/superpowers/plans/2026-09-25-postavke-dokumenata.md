# Postavke dokumenata — implementacioni plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grupa „Dokumenti“ u Postavkama + zadane vrijednosti po kupcu, primijenjene na fakturu, ponudu, kasu i pet PDF dokumenata.

**Architecture:** Postavke su ključevi `dokumenti.*` u tabeli `settings` preko postojećih `settings:get/set` (nema nove IPC komande). Čisti TS modul `src/lib/dokumentPostavke.ts` parsira ih u tipiziran objekat; React context ih dijeli ekranima, a `ucitajZaStampu()` ih svježe čita za PDF. Kupac dobija tri NULL kolone u oba backenda (TS + Rust) s ugovornim testovima.

**Tech Stack:** Electron + React + TypeScript, `@react-pdf/renderer`, bun test, Rust backend (`src-tauri/backend`), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-25-postavke-dokumenata-design.md`

## Global Constraints

- Sve komande preko Bun-a: `bun test`, `bun run test:rust`, `bunx …` (nikad npm/npx).
- UI tekst i imena u kodu su na bosanskom, u stilu okolnog koda (npr. `postavi`, `ucitaj`, `zadano`).
- Kad korisnik ništa ne dira, svaki dokument izgleda kao danas — osim: kolona Rabat se krije kad nijedna stavka nema rabat, i rabat se štampa s do 2 decimale.
- Spremljeni dokumenti se nikad ne preračunavaju.
- Ključ koji nikad nije spremljen (`null`) → zadana vrijednost; nevažeći broj/izbor → zadana vrijednost; spremljen tekst se koristi (trim + limit), pa i prazan; izuzetak: prazan naziv potpisne linije → zadani naziv.
- Limiti: napomena fakture 500, uslovi ponude 500, prefiks 8, podnožje 300, naziv potpisne linije 30 znakova; cifara 0–6; rok fakture 0–365; važnost ponude 1–365; pečat 40–200 pt (zadano 90); rabat kupca 0 ≤ r < 100.
- Načini plaćanja: `Gotovina`, `Kartica`, `Virman`, `Ček` (tim redom).
- Oba backenda moraju dati isti rezultat: svaka izmjena u `src/ipc/handlers.ts` / `src/lib/*.ts` koju zove backend ima par u `src-tauri/backend/src/*.rs`, a ugovorni test prolazi i sa `bun test src/ipc/ugovor` i sa `bun run test:rust`.
- WKWebView (Tauri) ne prikazuje `window.confirm/alert` — koristiti `potvrdi/obavijesti` iz `src/lib/dijalog.ts`.
- Lint: `bun run lint` pada i na `main` (@/ resolver). Gate: `bunx eslint <dodirnuti fajlovi>` bez NOVIH kategorija grešaka u odnosu na prije izmjene.
- Commit poruke završavaju s: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **Kupac iz ponude/skice**: faktura otvorena iz skice ne dobija ništa (skica čuva svoje), a iz ponude dobija rok/način kupca ali NE rabat (stavke nose rabat ponude) — test `zadanoZaFakturu` u Task 11.
2. **Ručno upisan kupac** (nije u šifarniku) na kasi/fakturi — nema zadanih vrijednosti, ništa ne puca (`zadanoZaKupca(null, …)` test u Task 1; lookup po idBroj u Task 9/11 vraća `undefined`).
3. **Stara baza bez novih kolona** (backup iz starije verzije) — migracija doda kolone, `kupac:getAll` vraća `null` za njih (migrations test u Task 4).
4. **Pečat uključen, a slika nije učitana** (ili je spremljen smeće-string) — dokument se štampa bez pečata, bez greške (`pecatZa` test u Task 1: slika koja ne počinje s `data:image/` → `null`).
5. **Dug tekst podnožja** (300 znakova, prelama se u 2–3 reda) — ne preklapa sadržaj stranice (PDF render test u Task 6 s 300 znakova; stranica dobija `paddingBottom` + 24).

---

## File Structure

| Fajl | Odgovornost |
|---|---|
| `src/lib/dokumentPostavke.ts` (novi) | tip, zadane vrijednosti, ključevi, parse/serialize, `formatBroja`, `zadanoZaKupca`, `primijeniRabatKupca`, `pecatZa`, `formatRabat`, `nastavakNumeracije` (backend) |
| `src/lib/dokumentPostavke.test.ts` (novi) | unit testovi |
| `src/lib/pdv.ts` (novi) | `PDV_STOPA_E_PCT`, `PDV_FAKTOR_E` |
| `src/lib/stampa.ts` (novi) | `ucitajDokumentPostavke()`, `ucitajZaStampu()` (renderer, `window.api`) |
| `src/components/DokumentPostavkeProvider.tsx` (novi) | context + `useDokumentPostavke()` |
| `src/components/pdf/PotpisBlok.tsx` (novi) | potpisne linije + pečat |
| `src/components/pdf/PdfPodnozje.tsx` (novi) | footer sa slobodnim tekstom |
| `src/components/pdf/pdf.render.test.tsx` (novi) | render test svih 5 PDF-ova |
| `src/components/postavke/DokumentiGrupa.tsx` (novi) | UI grupe |
| `src/components/postavke/SlikaBirac.tsx` (novi) | upload slike (izdvojen iz FirmaGrupe, koriste ga logo i pečat) |
| `src/database/schema.ts`, `migrations.ts`, `migrations.test.ts` | kolone kupca |
| `src-tauri/backend/src/baza.rs`, `katalog.rs`, `ponude.rs` | Rust par |
| `src/ipc/handlers.ts` | kupac validacija |
| `src/ipc/ugovor/katalog.ugovor.test.ts`, `ponude.ugovor.test.ts` | ugovor |
| `src/types.ts`, `src/global.d.ts` | `Kupac`, `OrderItem.productSifra` |
| 5 PDF komponenti, `stampaFakture.tsx`, `RacunDetailDialog.tsx`, `NalogDetailDialog.tsx`, `PonudeScreen.tsx`, `KasaScreen.tsx`, `FakturaDialog.tsx`, `KupciTab.tsx`, `ProizvodnjaScreen.tsx`, proizvodnja dijalozi, `PostavkeScreen.tsx`, `MainLayout.tsx` | primjena |

---

### Task 0: Priprema grane

**Preduslov:** necommitan rad paralelne sesije (`src/components/postavke/`, R2 backup, izmjene u `types.ts`, `handlers.ts`, `firma.ts`, `PrilogPdf.tsx`, `PonudeScreen.tsx`…) je commitan na `main`. Provjera: `git status --short` ne smije prikazivati `?? src/components/postavke/`.

- [ ] **Step 1:** `git status --short` — ako postoji necommitan rad koji nije naš, STOP i javi koordinatoru.
- [ ] **Step 2:** `git switch -c feat/postavke-dokumenata`
- [ ] **Step 3:** Snimi polazno stanje: `bun test 2>&1 | tail -5` i `bun run test:rust 2>&1 | tail -5` — zapiši broj pass/fail (ako nešto već pada na `main`, to nije naše i ne popravlja se).

---

### Task 1: Jezgro `dokumentPostavke.ts`

**Files:**
- Create: `src/lib/dokumentPostavke.ts`
- Test: `src/lib/dokumentPostavke.test.ts`

**Interfaces:**
- Produces (koriste svi kasniji taskovi):
  - `type NacinPlacanja = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček'`, `NACINI_PLACANJA: NacinPlacanja[]`
  - `type DokumentSaPotpisom = 'faktura' | 'ponuda' | 'otpremnica' | 'racun' | 'nalog'`, `type DokumentSaPecatom = Exclude<DokumentSaPotpisom, 'nalog'>`
  - `interface PotpisLinije { lijevo: string; desno: string }`, `interface FormatBroja { prefiks: string; cifara: number }`
  - `interface DokumentPostavke` (vidi kod), `ZADANE_DOKUMENT_POSTAVKE`, `KLJUCEVI_DOKUMENATA: string[]`, `LIMITI`, `PECAT_VELICINA`
  - `procitajDokumentPostavke(raw: Record<string, string | null | undefined>): DokumentPostavke`
  - `uKljuceve(p: DokumentPostavke): Record<string, string>`
  - `formatBroja(n: { broj: number; godina: number }, f: FormatBroja): string`
  - `zadanoZaKupca(kupac: KupacZadano | null | undefined, p: DokumentPostavke, dokument: 'faktura' | 'ponuda'): { rokDana: number | null; nacinPlacanja: NacinPlacanja; rabat: number }`
  - `primijeniRabatKupca<T extends { rabat: number }>(stavke: T[], rabat: number): T[]`
  - `pecatZa(p: DokumentPostavke, dok: DokumentSaPecatom): { slika: string; velicina: number } | null`
  - `formatRabat(r: number): string`

- [ ] **Step 1: Napiši test** `src/lib/dokumentPostavke.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import {
  ZADANE_DOKUMENT_POSTAVKE as Z, KLJUCEVI_DOKUMENATA, procitajDokumentPostavke, uKljuceve,
  formatBroja, zadanoZaKupca, primijeniRabatKupca, pecatZa, formatRabat,
} from './dokumentPostavke';

describe('procitajDokumentPostavke', () => {
  test('prazna baza daje zadane vrijednosti (današnji izgled)', () => {
    const p = procitajDokumentPostavke({});
    expect(p).toEqual(Z);
    expect(p.faktura).toEqual({ rokDana: null, nacinPlacanja: 'Virman', napomena: '' });
    expect(p.ponuda.vaziDana).toBe(8);
    expect(p.ponuda.uslovi).toBe('Cijene su izražene u KM sa uračunatim PDV-om.');
    expect(p.ponuda.nacinPlacanja).toBe('Gotovina');
    expect(p.ponuda.broj).toEqual({ prefiks: '', cifara: 0 });
    expect(p.nalog.broj).toEqual({ prefiks: 'RN-', cifara: 0 });
    expect(p.potpisi.faktura).toEqual({ lijevo: 'Izdao', desno: 'Primio' });
    expect(p.potpisi.ponuda).toEqual({ lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' });
    expect(p.potpisi.racun).toEqual({ lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' });
    expect(p.potpisi.otpremnica).toEqual({ lijevo: 'Robu izdao', desno: 'Robu primio' });
    expect(p.potpisi.nalog).toEqual({ lijevo: 'Izradio', desno: 'Preuzeo' });
    expect(p.pecat).toEqual({ slika: '', velicina: 90, na: { faktura: false, ponuda: false, otpremnica: false, racun: false } });
    expect(p.kolone).toEqual({ sifra: false, jm: true });
    expect(p.podnozje).toBe('');
  });

  test('čita spremljene vrijednosti', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '30',
      'dokumenti.faktura.nacinPlacanja': 'Gotovina',
      'dokumenti.faktura.napomena': '  Poziv na broj: 123 ',
      'dokumenti.ponuda.vaziDana': '15',
      'dokumenti.ponuda.prefiks': 'P-',
      'dokumenti.ponuda.cifara': '3',
      'dokumenti.nalog.prefiks': '',
      'dokumenti.potpis.faktura.lijevo': 'Fakturisao',
      'dokumenti.pecat': 'data:image/png;base64,AAA',
      'dokumenti.pecat.faktura': 'true',
      'dokumenti.kolone.sifra': 'true',
      'dokumenti.kolone.jm': 'false',
    });
    expect(p.faktura).toEqual({ rokDana: 30, nacinPlacanja: 'Gotovina', napomena: 'Poziv na broj: 123' });
    expect(p.ponuda.vaziDana).toBe(15);
    expect(p.ponuda.broj).toEqual({ prefiks: 'P-', cifara: 3 });
    expect(p.nalog.broj).toEqual({ prefiks: '', cifara: 0 });
    expect(p.potpisi.faktura).toEqual({ lijevo: 'Fakturisao', desno: 'Primio' });
    expect(p.pecat.na.faktura).toBe(true);
    expect(p.kolone).toEqual({ sifra: true, jm: false });
  });

  test('nevažeći brojevi i izbori padaju na zadano', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '-1',
      'dokumenti.faktura.nacinPlacanja': 'Bitcoin',
      'dokumenti.ponuda.vaziDana': '0',
      'dokumenti.ponuda.cifara': '9',
      'dokumenti.pecatVelicina': '500',
      'dokumenti.kolone.jm': 'možda',
    });
    expect(p.faktura.rokDana).toBeNull();
    expect(p.faktura.nacinPlacanja).toBe('Virman');
    expect(p.ponuda.vaziDana).toBe(8);
    expect(p.ponuda.broj.cifara).toBe(0);
    expect(p.pecat.velicina).toBe(90);
    expect(p.kolone.jm).toBe(true);
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '366' }).faktura.rokDana).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '2.5' }).faktura.rokDana).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '0' }).faktura.rokDana).toBe(0);
  });

  test('prazan string: tekst ostaje prazan, naziv potpisa pada na zadano', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.ponuda.uslovi': '',
      'dokumenti.potpis.ponuda.desno': '   ',
      'dokumenti.faktura.rokDana': '',
    });
    expect(p.ponuda.uslovi).toBe('');
    expect(p.potpisi.ponuda.desno).toBe('Potpis primaoca');
    expect(p.faktura.rokDana).toBeNull();
  });

  test('tekstovi se skraćuju na limit', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.podnozje': 'x'.repeat(400),
      'dokumenti.ponuda.prefiks': 'PREDUGACKI-',
      'dokumenti.potpis.nalog.lijevo': 'y'.repeat(50),
    });
    expect(p.podnozje).toHaveLength(300);
    expect(p.ponuda.broj.prefiks).toBe('PREDUGAC');
    expect(p.potpisi.nalog.lijevo).toHaveLength(30);
  });

  test('uKljuceve i procitaj su inverzni i pokrivaju sve ključeve', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '15', 'dokumenti.ponuda.prefiks': 'P-', 'dokumenti.pecat.racun': 'true',
    });
    const k = uKljuceve(p);
    expect(Object.keys(k).sort()).toEqual([...KLJUCEVI_DOKUMENATA].sort());
    expect(procitajDokumentPostavke(k)).toEqual(p);
    expect(uKljuceve(Z)['dokumenti.faktura.rokDana']).toBe('');
  });
});

describe('formatBroja', () => {
  test('bez prefiksa i nula = današnji oblik', () => {
    expect(formatBroja({ broj: 12, godina: 2026 }, { prefiks: '', cifara: 0 })).toBe('12/2026');
  });
  test('prefiks i nule', () => {
    expect(formatBroja({ broj: 3, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-003/2026');
    expect(formatBroja({ broj: 1234, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-1234/2026');
    expect(formatBroja({ broj: 2, godina: 2026 }, { prefiks: 'RN-', cifara: 0 })).toBe('RN-2/2026');
  });
});

describe('zadanoZaKupca', () => {
  const p = procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '15' });
  test('bez kupca: globalno', () => {
    expect(zadanoZaKupca(null, p, 'faktura')).toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 });
    expect(zadanoZaKupca(undefined, p, 'ponuda')).toEqual({ rokDana: null, nacinPlacanja: 'Gotovina', rabat: 0 });
  });
  test('kupac gazi globalno, NULL polja padaju na globalno', () => {
    expect(zadanoZaKupca({ rokPlacanjaDana: 30, nacinPlacanja: 'Kartica', rabat: 5 }, p, 'faktura'))
      .toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 5 });
    expect(zadanoZaKupca({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null }, p, 'faktura'))
      .toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 });
    expect(zadanoZaKupca({ rokPlacanjaDana: 0, nacinPlacanja: 'Gotovina', rabat: 2.5 }, p, 'ponuda'))
      .toEqual({ rokDana: 0, nacinPlacanja: 'Gotovina', rabat: 2.5 });
  });
  test('nepoznat način plaćanja kupca se ignoriše', () => {
    expect(zadanoZaKupca({ nacinPlacanja: 'Bitcoin' }, p, 'faktura').nacinPlacanja).toBe('Virman');
  });
});

describe('primijeniRabatKupca', () => {
  test('dira samo stavke s rabatom 0', () => {
    const s = [{ id: 1, rabat: 0 }, { id: 2, rabat: 10 }, { id: 3, rabat: 0 }];
    expect(primijeniRabatKupca(s, 5)).toEqual([{ id: 1, rabat: 5 }, { id: 2, rabat: 10 }, { id: 3, rabat: 5 }]);
  });
  test('rabat 0 ne mijenja ništa i vraća isti niz', () => {
    const s = [{ id: 1, rabat: 0 }];
    expect(primijeniRabatKupca(s, 0)).toBe(s);
  });
});

describe('pecatZa', () => {
  const slika = 'data:image/png;base64,AAA';
  test('slika + uključen dokument', () => {
    const p = procitajDokumentPostavke({ 'dokumenti.pecat': slika, 'dokumenti.pecat.faktura': 'true', 'dokumenti.pecatVelicina': '120' });
    expect(pecatZa(p, 'faktura')).toEqual({ slika, velicina: 120 });
    expect(pecatZa(p, 'ponuda')).toBeNull();
  });
  test('uključen bez slike ili sa smećem → null', () => {
    expect(pecatZa(procitajDokumentPostavke({ 'dokumenti.pecat.faktura': 'true' }), 'faktura')).toBeNull();
    expect(pecatZa(procitajDokumentPostavke({ 'dokumenti.pecat': 'nije-slika', 'dokumenti.pecat.faktura': 'true' }), 'faktura')).toBeNull();
  });
});

describe('formatRabat', () => {
  test('do 2 decimale, zarez, bez suvišnih nula', () => {
    expect(formatRabat(5)).toBe('5%');
    expect(formatRabat(2.5)).toBe('2,5%');
    expect(formatRabat(12.75)).toBe('12,75%');
    expect(formatRabat(3.333)).toBe('3,33%');
  });
});
```

- [ ] **Step 2:** `bun test src/lib/dokumentPostavke.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 3: Implementacija** `src/lib/dokumentPostavke.ts`:

```ts
/**
 * Postavke dokumenata (faktura, ponuda, otpremnica, račun, radni nalog) — ključevi
 * `dokumenti.*` u tabeli settings. Ključ koji nikad nije spremljen daje zadanu
 * vrijednost, pa dokument bez podešavanja izgleda kao prije ovih postavki.
 */

export type NacinPlacanja = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
export const NACINI_PLACANJA: NacinPlacanja[] = ['Gotovina', 'Kartica', 'Virman', 'Ček'];

export type DokumentSaPotpisom = 'faktura' | 'ponuda' | 'otpremnica' | 'racun' | 'nalog';
export type DokumentSaPecatom = Exclude<DokumentSaPotpisom, 'nalog'>;
export const DOKUMENTI_SA_POTPISOM: DokumentSaPotpisom[] = ['faktura', 'ponuda', 'otpremnica', 'racun', 'nalog'];
export const DOKUMENTI_SA_PECATOM: DokumentSaPecatom[] = ['faktura', 'ponuda', 'otpremnica', 'racun'];

export interface PotpisLinije { lijevo: string; desno: string }
export interface FormatBroja { prefiks: string; cifara: number }

export interface DokumentPostavke {
  faktura: { rokDana: number | null; nacinPlacanja: NacinPlacanja; napomena: string };
  ponuda: { vaziDana: number; uslovi: string; nacinPlacanja: NacinPlacanja; broj: FormatBroja };
  nalog: { broj: FormatBroja };
  podnozje: string;
  potpisi: Record<DokumentSaPotpisom, PotpisLinije>;
  pecat: { slika: string; velicina: number; na: Record<DokumentSaPecatom, boolean> };
  kolone: { sifra: boolean; jm: boolean };
}

export const LIMITI = { napomena: 500, uslovi: 500, prefiks: 8, podnozje: 300, potpis: 30 } as const;
export const PECAT_VELICINA = { min: 40, max: 200, zadano: 90 } as const;
const CIFARA_MAX = 6;

export const ZADANE_DOKUMENT_POSTAVKE: DokumentPostavke = {
  faktura: { rokDana: null, nacinPlacanja: 'Virman', napomena: '' },
  ponuda: {
    vaziDana: 8,
    uslovi: 'Cijene su izražene u KM sa uračunatim PDV-om.',
    nacinPlacanja: 'Gotovina',
    broj: { prefiks: '', cifara: 0 },
  },
  nalog: { broj: { prefiks: 'RN-', cifara: 0 } },
  podnozje: '',
  potpisi: {
    faktura: { lijevo: 'Izdao', desno: 'Primio' },
    ponuda: { lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' },
    otpremnica: { lijevo: 'Robu izdao', desno: 'Robu primio' },
    racun: { lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' },
    nalog: { lijevo: 'Izradio', desno: 'Preuzeo' },
  },
  pecat: { slika: '', velicina: PECAT_VELICINA.zadano, na: { faktura: false, ponuda: false, otpremnica: false, racun: false } },
  kolone: { sifra: false, jm: true },
};

const K = {
  fakturaRok: 'dokumenti.faktura.rokDana',
  fakturaNacin: 'dokumenti.faktura.nacinPlacanja',
  fakturaNapomena: 'dokumenti.faktura.napomena',
  ponudaVazi: 'dokumenti.ponuda.vaziDana',
  ponudaUslovi: 'dokumenti.ponuda.uslovi',
  ponudaNacin: 'dokumenti.ponuda.nacinPlacanja',
  ponudaPrefiks: 'dokumenti.ponuda.prefiks',
  ponudaCifara: 'dokumenti.ponuda.cifara',
  nalogPrefiks: 'dokumenti.nalog.prefiks',
  podnozje: 'dokumenti.podnozje',
  pecat: 'dokumenti.pecat',
  pecatVelicina: 'dokumenti.pecatVelicina',
  sifra: 'dokumenti.kolone.sifra',
  jm: 'dokumenti.kolone.jm',
} as const;
const potpisKljuc = (d: DokumentSaPotpisom, strana: keyof PotpisLinije) => `dokumenti.potpis.${d}.${strana}`;
const pecatKljuc = (d: DokumentSaPecatom) => `dokumenti.pecat.${d}`;

export const KLJUCEVI_DOKUMENATA: string[] = [
  ...Object.values(K),
  ...DOKUMENTI_SA_POTPISOM.flatMap(d => [potpisKljuc(d, 'lijevo'), potpisKljuc(d, 'desno')]),
  ...DOKUMENTI_SA_PECATOM.map(pecatKljuc),
];

type Raw = Record<string, string | null | undefined>;

function cijeli(v: string | null | undefined, min: number, max: number): number | null {
  const t = (v ?? '').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

/** Spremljen tekst se koristi i kad je prazan; nikad spremljen → zadano. */
function tekst(v: string | null | undefined, zadano: string, limit: number): string {
  return v == null ? zadano : v.trim().slice(0, limit);
}

function nacin(v: string | null | undefined, zadano: NacinPlacanja): NacinPlacanja {
  return NACINI_PLACANJA.includes(v as NacinPlacanja) ? (v as NacinPlacanja) : zadano;
}

function prekidac(v: string | null | undefined, zadano: boolean): boolean {
  return v === 'true' ? true : v === 'false' ? false : zadano;
}

const jeSlika = (v: string) => v.startsWith('data:image/');

export function procitajDokumentPostavke(raw: Raw): DokumentPostavke {
  const Z = ZADANE_DOKUMENT_POSTAVKE;
  const potpis = (d: DokumentSaPotpisom, s: keyof PotpisLinije) =>
    (raw[potpisKljuc(d, s)] ?? '').trim().slice(0, LIMITI.potpis) || Z.potpisi[d][s];
  const slika = raw[K.pecat] ?? '';
  return {
    faktura: {
      rokDana: cijeli(raw[K.fakturaRok], 0, 365),
      nacinPlacanja: nacin(raw[K.fakturaNacin], Z.faktura.nacinPlacanja),
      napomena: tekst(raw[K.fakturaNapomena], Z.faktura.napomena, LIMITI.napomena),
    },
    ponuda: {
      vaziDana: cijeli(raw[K.ponudaVazi], 1, 365) ?? Z.ponuda.vaziDana,
      uslovi: tekst(raw[K.ponudaUslovi], Z.ponuda.uslovi, LIMITI.uslovi),
      nacinPlacanja: nacin(raw[K.ponudaNacin], Z.ponuda.nacinPlacanja),
      broj: {
        prefiks: tekst(raw[K.ponudaPrefiks], Z.ponuda.broj.prefiks, LIMITI.prefiks),
        cifara: cijeli(raw[K.ponudaCifara], 0, CIFARA_MAX) ?? 0,
      },
    },
    nalog: { broj: { prefiks: tekst(raw[K.nalogPrefiks], Z.nalog.broj.prefiks, LIMITI.prefiks), cifara: 0 } },
    podnozje: tekst(raw[K.podnozje], Z.podnozje, LIMITI.podnozje),
    potpisi: Object.fromEntries(DOKUMENTI_SA_POTPISOM.map(d => [d, { lijevo: potpis(d, 'lijevo'), desno: potpis(d, 'desno') }])) as DokumentPostavke['potpisi'],
    pecat: {
      slika: jeSlika(slika) ? slika : '',
      velicina: cijeli(raw[K.pecatVelicina], PECAT_VELICINA.min, PECAT_VELICINA.max) ?? PECAT_VELICINA.zadano,
      na: Object.fromEntries(DOKUMENTI_SA_PECATOM.map(d => [d, prekidac(raw[pecatKljuc(d)], false)])) as DokumentPostavke['pecat']['na'],
    },
    kolone: { sifra: prekidac(raw[K.sifra], Z.kolone.sifra), jm: prekidac(raw[K.jm], Z.kolone.jm) },
  };
}

/** Sve postavke kao string vrijednosti za `settings:set` — pokriva svaki ključ iz KLJUCEVI_DOKUMENATA. */
export function uKljuceve(p: DokumentPostavke): Record<string, string> {
  const out: Record<string, string> = {
    [K.fakturaRok]: p.faktura.rokDana == null ? '' : String(p.faktura.rokDana),
    [K.fakturaNacin]: p.faktura.nacinPlacanja,
    [K.fakturaNapomena]: p.faktura.napomena,
    [K.ponudaVazi]: String(p.ponuda.vaziDana),
    [K.ponudaUslovi]: p.ponuda.uslovi,
    [K.ponudaNacin]: p.ponuda.nacinPlacanja,
    [K.ponudaPrefiks]: p.ponuda.broj.prefiks,
    [K.ponudaCifara]: String(p.ponuda.broj.cifara),
    [K.nalogPrefiks]: p.nalog.broj.prefiks,
    [K.podnozje]: p.podnozje,
    [K.pecat]: p.pecat.slika,
    [K.pecatVelicina]: String(p.pecat.velicina),
    [K.sifra]: String(p.kolone.sifra),
    [K.jm]: String(p.kolone.jm),
  };
  for (const d of DOKUMENTI_SA_POTPISOM) {
    out[potpisKljuc(d, 'lijevo')] = p.potpisi[d].lijevo;
    out[potpisKljuc(d, 'desno')] = p.potpisi[d].desno;
  }
  for (const d of DOKUMENTI_SA_PECATOM) out[pecatKljuc(d)] = String(p.pecat.na[d]);
  return out;
}

/** „P-003/2026“ — broj se nulama dopunjava do `cifara`, duži broj ostaje cijel. */
export function formatBroja(n: { broj: number; godina: number }, f: FormatBroja): string {
  return `${f.prefiks}${String(n.broj).padStart(f.cifara, '0')}/${n.godina}`;
}

/** Polja kupca iz šifarnika koja nose zadane vrijednosti; NULL = koristi globalno. */
export interface KupacZadano {
  rokPlacanjaDana?: number | null;
  nacinPlacanja?: string | null;
  rabat?: number | null;
}

/** Redoslijed: kupac → globalna postavka dokumenta → zadano. */
export function zadanoZaKupca(
  kupac: KupacZadano | null | undefined,
  p: DokumentPostavke,
  dokument: 'faktura' | 'ponuda',
): { rokDana: number | null; nacinPlacanja: NacinPlacanja; rabat: number } {
  const globalno = dokument === 'faktura' ? p.faktura : { rokDana: null, nacinPlacanja: p.ponuda.nacinPlacanja };
  return {
    rokDana: kupac?.rokPlacanjaDana ?? globalno.rokDana,
    nacinPlacanja: nacin(kupac?.nacinPlacanja, globalno.nacinPlacanja),
    rabat: kupac?.rabat ?? 0,
  };
}

/** Rabat kupca dobijaju samo stavke bez rabata — ručno upisan rabat ostaje. */
export function primijeniRabatKupca<T extends { rabat: number }>(stavke: T[], rabat: number): T[] {
  if (!(rabat > 0)) return stavke;
  return stavke.map(s => (s.rabat === 0 ? { ...s, rabat } : s));
}

/** Pečat za dokument, ili null kad nije uključen ili slika nije učitana. */
export function pecatZa(p: DokumentPostavke, dok: DokumentSaPecatom): { slika: string; velicina: number } | null {
  return p.pecat.na[dok] && jeSlika(p.pecat.slika) ? { slika: p.pecat.slika, velicina: p.pecat.velicina } : null;
}

/** Rabat za štampu: „5%“, „2,5%“, „12,75%“. */
export function formatRabat(r: number): string {
  return `${String(Math.round(r * 100) / 100).replace('.', ',')}%`;
}
```

- [ ] **Step 4:** `bun test src/lib/dokumentPostavke.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/dokumentPostavke.ts src/lib/dokumentPostavke.test.ts
git commit -m "feat(dokumenti): jezgro postavki dokumenata

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: PDV konstanta na jednom mjestu

**Files:**
- Create: `src/lib/pdv.ts`
- Modify: `src/lib/kalkulacija.ts:25`, `src/lib/pdvUnos.ts:9-12`, `src/lib/racun.ts:31`, `src/components/PrilogPdf.tsx:203,332`, `src/components/RacunPdf.tsx:52,85`, `src/components/PonudaPdf.tsx:469`

**Interfaces:**
- Produces: `PDV_STOPA_E_PCT = 17`, `PDV_FAKTOR_E = 1.17` iz `@/lib/pdv`.

- [ ] **Step 1:** Kreiraj `src/lib/pdv.ts`:

```ts
/** Stopa PDV-a za stopu 'E' (BiH, 17 %). Stopa 'K' je oslobođena. Rust backend ima svoj par. */
export const PDV_STOPA_E_PCT = 17;
/** Bruto = neto × faktor. Drži se kao literal (ne 1 + 17/100) da zaokruživanje ostane bit-identično dosadašnjem. */
export const PDV_FAKTOR_E = 1.17;
```

- [ ] **Step 2:** Zamijeni literale: `kalkulacija.ts` → `stopa === 'E' ? PDV_STOPA_E_PCT : 0`; `pdvUnos.ts` → `const FAKTOR_E = PDV_FAKTOR_E;` (import, komentar prilagodi); `racun.ts:31` → `iznos - iznos / PDV_FAKTOR_E`; `PrilogPdf.tsx` → `round2(si.cijena / PDV_FAKTOR_E)` i labela `` `PDV ${PDV_STOPA_E_PCT}%` ``; `RacunPdf.tsx` translations → `` vat: `PDV (${PDV_STOPA_E_PCT}%)` `` / `` `VAT (${PDV_STOPA_E_PCT}%)` ``; `PonudaPdf.tsx` → `` `PDV (${PDV_STOPA_E_PCT}%)` ``.
- [ ] **Step 3:** `grep -rn "1\.17\|(17%)\|PDV 17" src --include=*.ts --include=*.tsx | grep -v test` → samo `src/lib/pdv.ts` (i komentari ako postoje).
- [ ] **Step 4:** `bun test src/lib` → isti broj prolaza kao u Task 0.
- [ ] **Step 5:** Commit `refactor(pdv): stopa E na jednom mjestu`.

---

### Task 3: Format broja ponude i naloga + backend poruka

**Files:**
- Modify: `src/lib/ponuda.ts:52-55,144`, `src/lib/proizvodnja.ts:42-44`, `src-tauri/backend/src/ponude.rs:162`, `src-tauri/backend/src/proizvodnja.rs:60-62` (ne dirati osim ako se koristi — vidi korak 4)
- Test: `src/lib/ponuda.test.ts`, `src/lib/proizvodnja.test.ts`, `src/ipc/ugovor/ponude.ugovor.test.ts`

**Interfaces:**
- Consumes: `formatBroja`, `FormatBroja`, `ZADANE_DOKUMENT_POSTAVKE` (Task 1)
- Produces: `formatBrojPonude(p, f?: FormatBroja)`, `formatBrojNaloga(n, f?: FormatBroja)` — bez `f` daju današnji oblik (`12/2026`, `RN-2/2026`).

- [ ] **Step 1: Test** — dodaj u `src/lib/ponuda.test.ts`:

```ts
test('formatBrojPonude prima format iz postavki', () => {
  expect(formatBrojPonude({ broj: 3, godina: 2026 })).toBe('3/2026');
  expect(formatBrojPonude({ broj: 3, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-003/2026');
});
```

i u `src/lib/proizvodnja.test.ts` pored postojećeg `RN-2/2026` testa:

```ts
expect(formatBrojNaloga({ broj: 2, godina: 2026 }, { prefiks: 'NAL ', cifara: 0 })).toBe('NAL 2/2026');
expect(formatBrojNaloga({ broj: 2, godina: 2026 }, { prefiks: '', cifara: 0 })).toBe('2/2026');
```

U `src/ipc/ugovor/ponude.ugovor.test.ts` nađi test koji očekuje `'Ponuda je vezana za radni nalog RN-` (grep) i promijeni očekivanje u `'Ponuda je vezana za radni nalog br. <broj>/<godina> — prvo obrišite nalog'` (isti brojevi kao u testu).

- [ ] **Step 2:** `bun test src/lib/ponuda.test.ts src/lib/proizvodnja.test.ts src/ipc/ugovor/ponude.ugovor.test.ts` → FAIL.
- [ ] **Step 3: Implementacija**

`src/lib/ponuda.ts`:
```ts
import { formatBroja, ZADANE_DOKUMENT_POSTAVKE, type FormatBroja } from './dokumentPostavke';

/** Prikazni oblik broja ponude, npr. "3/2026" ili "P-003/2026" s formatom iz postavki. */
export function formatBrojPonude(p: { broj: number; godina: number }, f: FormatBroja = ZADANE_DOKUMENT_POSTAVKE.ponuda.broj): string {
  return formatBroja(p, f);
}
```
Poruka na liniji ~144: `` `Ponuda je vezana za radni nalog br. ${nalog.broj}/${nalog.godina} — prvo obrišite nalog` ``.

`src/lib/proizvodnja.ts`:
```ts
export function formatBrojNaloga(n: { broj: number; godina: number }, f: FormatBroja = ZADANE_DOKUMENT_POSTAVKE.nalog.broj): string {
  return formatBroja(n, f);
}
```
(import kao gore).

`src-tauri/backend/src/ponude.rs:162`: `"Ponuda je vezana za radni nalog br. {}/{} — prvo obrišite nalog"`.

- [ ] **Step 4:** `grep -n "format_broj_naloga" src-tauri/backend/src/*.rs` — ako se funkcija nigdje ne poziva osim definicije, ostavi je; ako se koristi u poruci koja ide korisniku, promijeni poruku u `br. {}/{}` i ažuriraj pripadni ugovorni test.
- [ ] **Step 5:** `bun test src/lib/ponuda.test.ts src/lib/proizvodnja.test.ts src/ipc/ugovor/ponude.ugovor.test.ts` → PASS; `bun run test:rust 2>&1 | tail -5` → isti broj kao Task 0 (ništa novo ne pada).
- [ ] **Step 6:** Commit `feat(dokumenti): format broja ponude i naloga iz postavki`.

---

### Task 3a: Nastavak numeracije iz starog programa

**Files:**
- Modify: `src/lib/dokumentPostavke.ts` (+ test), `src/lib/ponuda.ts:47-51`, `src/lib/proizvodnja.ts:37-40`, `src-tauri/backend/src/ponude.rs:54-57`, `src-tauri/backend/src/proizvodnja.rs:55-58`
- Test: `src/lib/ponuda.test.ts`, `src/lib/proizvodnja.test.ts`, `src/ipc/ugovor/ponude.ugovor.test.ts`, `src/ipc/ugovor/proizvodnja.ugovor.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `DokumentPostavke.ponuda.nastavak` i `DokumentPostavke.nalog.nastavak`: `{ broj: number; godina: number } | null`
  - ključevi `dokumenti.ponuda.nastavakBroj`, `dokumenti.ponuda.nastavakGodina`, `dokumenti.nalog.nastavakBroj`, `dokumenti.nalog.nastavakGodina` (u `KLJUCEVI_DOKUMENATA`)
  - `nastavakNumeracije(db: SqlDb, dok: 'ponuda' | 'nalog', godina: number): number` u `src/lib/dokumentPostavke.ts` — 0 kad nema nastavka za tu godinu

- [ ] **Step 1: Testovi**

U `dokumentPostavke.test.ts`:
```ts
test('nastavak numeracije se čita samo kad su broj i godina ispravni', () => {
  expect(procitajDokumentPostavke({}).ponuda.nastavak).toBeNull();
  expect(procitajDokumentPostavke({ 'dokumenti.ponuda.nastavakBroj': '12', 'dokumenti.ponuda.nastavakGodina': '2026' }).ponuda.nastavak)
    .toEqual({ broj: 12, godina: 2026 });
  expect(procitajDokumentPostavke({ 'dokumenti.ponuda.nastavakBroj': '12' }).ponuda.nastavak).toBeNull();
  expect(procitajDokumentPostavke({ 'dokumenti.nalog.nastavakBroj': '0', 'dokumenti.nalog.nastavakGodina': '2026' }).nalog.nastavak).toBeNull();
  expect(procitajDokumentPostavke({ 'dokumenti.nalog.nastavakBroj': '', 'dokumenti.nalog.nastavakGodina': '' }).nalog.nastavak).toBeNull();
});
```
(Postojeći test „uKljuceve i procitaj su inverzni“ mora i dalje proći — `uKljuceve` za `null` nastavak piše `''` u oba ključa.)

U `ponuda.test.ts` (koristi postojeći `db` i `ubaciPonudu` iz fajla):
```ts
const postaviNastavak = (broj: string, godina: string) => {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dokumenti.ponuda.nastavakBroj', ?)").run(broj);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dokumenti.ponuda.nastavakGodina', ?)").run(godina);
};

test('nastavak iz starog programa: prva ponuda dobija broj iza upisanog', () => {
  postaviNastavak('12', '2026');
  expect(nextBrojPonude(db, 2026)).toBe(13);
});

test('nastavak manji od baze se ignoriše', () => {
  postaviNastavak('2', '2026');
  ubaciPonudu(5, 2026);
  expect(nextBrojPonude(db, 2026)).toBe(6);
});

test('nastavak važi samo za svoju godinu', () => {
  postaviNastavak('12', '2025');
  expect(nextBrojPonude(db, 2026)).toBe(1);
});
```
Isto za `nextBrojNaloga` u `proizvodnja.test.ts` s ključevima `dokumenti.nalog.*`. (Ako test-baza nema tabelu `settings`, fajl koristi `schema` — provjeri; `settings` je u `schema.ts`.)

Ugovorni: u `ponude.ugovor.test.ts` — `settings:set` za oba ključa (`'12'`, tekuća godina iz `new Date().getFullYear()`), pa `ponuda:nextBroj` → `{ broj: 13, godina }`, i `ponuda:create` upiše ponudu s `broj = 13`. Isto u `proizvodnja.ugovor.test.ts` za `nalog:nextBroj` / `nalog:create`. (Pogledaj kako postojeći testovi u tim fajlovima zovu `create` i preuzmi isti payload.)

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: TS**

`dokumentPostavke.ts` — tip: `ponuda: { …; nastavak: { broj: number; godina: number } | null }`, `nalog: { broj: FormatBroja; nastavak: … | null }`; zadano `null`. Ključevi u `K`: `ponudaNastavakBroj: 'dokumenti.ponuda.nastavakBroj'`, `ponudaNastavakGodina: 'dokumenti.ponuda.nastavakGodina'`, `nalogNastavakBroj`, `nalogNastavakGodina` (analogno). Čitanje:
```ts
function nastavak(broj: string | null | undefined, godina: string | null | undefined) {
  const b = cijeli(broj, 1, 999999);
  const g = cijeli(godina, 2000, 2999);
  return b != null && g != null ? { broj: b, godina: g } : null;
}
```
`uKljuceve`: `String(n?.broj ?? '')` / `String(n?.godina ?? '')` (za `null` oba `''`).
Backend helper (isti fajl, bez `window`):
```ts
/** Najveći broj iz starog programa za godinu, ili 0. Čita se iz settings — radi i u Electron i u test bazi. */
export function nastavakNumeracije(db: { prepare(sql: string): { get(...a: unknown[]): unknown } }, dok: 'ponuda' | 'nalog', godina: number): number {
  const v = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value;
  const n = nastavak(v(`dokumenti.${dok}.nastavakBroj`), v(`dokumenti.${dok}.nastavakGodina`));
  return n && n.godina === godina ? n.broj : 0;
}
```
`ponuda.ts`:
```ts
/** Sljedeći redni broj ponude u godini — od 1, ili iza posljednjeg broja iz starog programa. */
export function nextBrojPonude(db: SqlDb, godina: number): number {
  const row = db.prepare('SELECT MAX(broj) AS maxBroj FROM ponude WHERE godina = ?')
    .get(godina) as { maxBroj: number | null };
  return Math.max(row.maxBroj ?? 0, nastavakNumeracije(db, 'ponuda', godina)) + 1;
}
```
Isto `nextBrojNaloga` s `'nalog'`.

- [ ] **Step 4:** `bun test src/lib src/ipc/ugovor/ponude.ugovor.test.ts src/ipc/ugovor/proizvodnja.ugovor.test.ts` → PASS.

- [ ] **Step 5: Rust** — u `ponude.rs` (ili zajednički modul ako postoji helper za settings; grep `FROM settings WHERE key` u `src-tauri/backend/src`):
```rust
/// Najveći broj iz starog programa za godinu, ili 0 — par `nastavakNumeracije` u dokumentPostavke.ts.
pub fn nastavak_numeracije(db: &Db, dok: &str, godina: &Value) -> R<i64> {
    let v = |k: String| -> R<Option<String>> {
        Ok(db.get("SELECT value FROM settings WHERE key = ?", p![k])?.and_then(|r| r["value"].as_str().map(str::to_string)))
    };
    let cijeli = |s: Option<String>, min: i64, max: i64| -> Option<i64> {
        let t = s?.trim().to_string();
        if t.is_empty() || !t.chars().all(|c| c.is_ascii_digit()) { return None; }
        t.parse::<i64>().ok().filter(|n| (min..=max).contains(n))
    };
    let broj = cijeli(v(format!("dokumenti.{dok}.nastavakBroj"))?, 1, 999_999);
    let god = cijeli(v(format!("dokumenti.{dok}.nastavakGodina"))?, 2000, 2999);
    Ok(match (broj, god) {
        (Some(b), Some(g)) if Some(g) == godina.as_i64() => b,
        _ => 0,
    })
}

pub fn next_broj_ponude(db: &Db, godina: &Value) -> R<i64> {
    let max = db.val("SELECT MAX(broj) AS maxBroj FROM ponude WHERE godina = ?", &[godina.clone()])?;
    Ok(max.as_i64().unwrap_or(0).max(nastavak_numeracije(db, "ponuda", godina)?) + 1)
}
```
`proizvodnja.rs` `next_broj_naloga`: isto s `crate::ponude::nastavak_numeracije(db, "nalog", godina)?` (ili gdje god je helper smješten). `godina` može stići kao broj — `as_i64()` ga pokriva.

- [ ] **Step 6:** `bun run test:rust 2>&1 | tail -5` → novi testovi prolaze, ništa staro ne pada.
- [ ] **Step 7:** Commit `feat(dokumenti): nastavak numeracije ponuda i naloga iz starog programa`.

### Task 4: Kupac — tri zadane vrijednosti u oba backenda

**Files:**
- Modify: `src/database/schema.ts` (tabela `kupci`), `src/database/migrations.ts`, `src-tauri/backend/src/baza.rs` (schema + `run_migrations`), `src/ipc/handlers.ts:591-642`, `src-tauri/backend/src/katalog.rs:425-510`, `src/types.ts` (`Kupac`), `src/global.d.ts` (tipovi `createKupac`/`updateKupac` ako su eksplicitni)
- Test: `src/ipc/ugovor/katalog.ugovor.test.ts`, `src/database/migrations.test.ts`

**Interfaces:**
- Produces: kolone `kupci.rokPlacanjaDana INTEGER`, `kupci.nacinPlacanja TEXT`, `kupci.rabat REAL` (sve NULL); `kupac:create`/`kupac:update` primaju ih; `Kupac` tip:
  ```ts
  /** Zadano za dokumente; null = globalna postavka. */
  rokPlacanjaDana?: number | null;
  nacinPlacanja?: string | null;
  rabat?: number | null;
  ```
- Poruke grešaka (identične u TS i Rust):
  - `Rok plaćanja mora biti cijeli broj dana od 0 do 365`
  - `Rabat kupca mora biti od 0 do manje od 100 %`
  - `Nepoznat način plaćanja "<v>"`

- [ ] **Step 1: Ugovorni testovi** — dodaj u `katalog.ugovor.test.ts` (nakon `describe('kupac:update'`):

```ts
// ─── kupac: zadane vrijednosti za dokumente ─────────────────

describe('kupac: zadano za dokumente', () => {
  test('create upisuje rok, način plaćanja i rabat; bez njih su null', async () => {
    const a = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5.5 });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', a.id))
      .toEqual({ rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5.5 });
    const bez = await b.call('kupac:create', { naziv: 'B', idBroj: '2' });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', bez.id))
      .toEqual({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null });
  });

  test('prazno i null brišu vrijednost na update-u', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, nacinPlacanja: 'Virman', rabat: 5 });
    expect(await b.call('kupac:update', r.id, { rokPlacanjaDana: null, nacinPlacanja: '', rabat: null })).toEqual({ changes: 1 });
    expect(red('SELECT rokPlacanjaDana, nacinPlacanja, rabat FROM kupci WHERE id = ?', r.id))
      .toEqual({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null });
  });

  test('update mijenja samo poslana zadana polja', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 30, rabat: 5 });
    await b.call('kupac:update', r.id, { rabat: 7.25 });
    expect(red('SELECT rokPlacanjaDana, rabat FROM kupci WHERE id = ?', r.id)).toEqual({ rokPlacanjaDana: 30, rabat: 7.25 });
  });

  test('validacija', async () => {
    const rok = 'Rok plaćanja mora biti cijeli broj dana od 0 do 365';
    const rab = 'Rabat kupca mora biti od 0 do manje od 100 %';
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: -1 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 366 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rokPlacanjaDana: 2.5 })).rejects.toThrow(rok);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 100 })).rejects.toThrow(rab);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: -0.5 })).rejects.toThrow(rab);
    await expect(b.call('kupac:create', { naziv: 'A', idBroj: '1', nacinPlacanja: 'Bitcoin' })).rejects.toThrow('Nepoznat način plaćanja "Bitcoin"');
    expect(broj('SELECT COUNT(*) AS n FROM kupci')).toBe(0);
    const id = dodajKupca('B', '2');
    await expect(b.call('kupac:update', id, { rabat: 150 })).rejects.toThrow(rab);
  });

  test('rabat se zaokružuje na 2 decimale', async () => {
    const r = await b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 3.14159 });
    expect(red('SELECT rabat FROM kupci WHERE id = ?', r.id)).toEqual({ rabat: 3.14 });
  });

  test('getAll vraća nova polja', async () => {
    await b.call('kupac:create', { naziv: 'A', idBroj: '1', rabat: 5 });
    const [k] = await b.call('kupac:getAll');
    expect(k.rabat).toBe(5);
    expect(k.rokPlacanjaDana).toBeNull();
    expect(k.nacinPlacanja).toBeNull();
  });
});
```

U `src/database/migrations.test.ts` dodaj test (koristi postojeći `LEGACY_SCHEMA` i obrazac ostalih testova u fajlu — pročitaj ih prvo):

```ts
test('kupci dobijaju kolone za zadane vrijednosti dokumenata', () => {
  const db = new Database(':memory:');
  db.exec(LEGACY_SCHEMA);
  runMigrations(db as Db);
  const cols = (db.prepare('PRAGMA table_info(kupci)').all() as { name: string }[]).map(c => c.name);
  expect(cols).toEqual(expect.arrayContaining(['rokPlacanjaDana', 'nacinPlacanja', 'rabat']));
  runMigrations(db as Db); // idempotentno
});
```

(Ako `LEGACY_SCHEMA` nema tabelu `kupci`, migracija je kreira `CREATE TABLE IF NOT EXISTS` — u tom slučaju ALTER mora doći POSLIJE tog CREATE-a u `migrations.ts`.)

- [ ] **Step 2:** `bun test src/ipc/ugovor/katalog.ugovor.test.ts src/database/migrations.test.ts` → FAIL.

- [ ] **Step 3: TS šema i migracija** — u `schema.ts` tabela `kupci` dobija `rokPlacanjaDana INTEGER, nacinPlacanja TEXT, rabat REAL,` prije `createdAt`. U `migrations.ts`, iza bloka `CREATE TABLE IF NOT EXISTS kupci`:

```ts
  // Zadane vrijednosti za dokumente po kupcu (NULL = globalna postavka)
  const kupciCols = database.prepare("PRAGMA table_info(kupci)").all() as { name: string }[];
  if (!kupciCols.find(c => c.name === 'rokPlacanjaDana')) {
    database.exec("ALTER TABLE kupci ADD COLUMN rokPlacanjaDana INTEGER");
  }
  if (!kupciCols.find(c => c.name === 'nacinPlacanja')) {
    database.exec("ALTER TABLE kupci ADD COLUMN nacinPlacanja TEXT");
  }
  if (!kupciCols.find(c => c.name === 'rabat')) {
    database.exec("ALTER TABLE kupci ADD COLUMN rabat REAL");
  }
```

- [ ] **Step 4: TS handleri** — u `handlers.ts` ispod `validirajKupca`:

```ts
  const NACINI_PLACANJA = ['Gotovina', 'Kartica', 'Virman', 'Ček'];
  const prazno = (v: unknown) => v === null || v === '';
  // Zadane vrijednosti kupca za dokumente — samo poslana polja; prazno/null briše vrijednost.
  const validirajZadanoKupca = (data: { rokPlacanjaDana?: unknown; nacinPlacanja?: unknown; rabat?: unknown }) => {
    const upis: { rokPlacanjaDana?: number | null; nacinPlacanja?: string | null; rabat?: number | null } = {};
    if (data.rokPlacanjaDana !== undefined) {
      const v = data.rokPlacanjaDana;
      if (prazno(v)) upis.rokPlacanjaDana = null;
      else if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 365) throw new Error('Rok plaćanja mora biti cijeli broj dana od 0 do 365');
      else upis.rokPlacanjaDana = v;
    }
    if (data.nacinPlacanja !== undefined) {
      const v = data.nacinPlacanja;
      if (prazno(v)) upis.nacinPlacanja = null;
      else if (typeof v !== 'string' || !NACINI_PLACANJA.includes(v)) throw new Error(`Nepoznat način plaćanja "${String(v)}"`);
      else upis.nacinPlacanja = v;
    }
    if (data.rabat !== undefined) {
      const v = data.rabat;
      if (prazno(v)) upis.rabat = null;
      else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 100) throw new Error('Rabat kupca mora biti od 0 do manje od 100 %');
      else upis.rabat = Math.round(v * 100) / 100;
    }
    return upis;
  };
```

`kupac:create`: pozovi `const zadano = validirajZadanoKupca(data);` odmah poslije `validirajKupca` (prije INSERT-a), i proširi INSERT:
```ts
      .prepare('INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt, rokPlacanjaDana, nacinPlacanja, rabat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(upis.naziv, upis.idBroj, data.pdvBroj ?? null, data.adresa ?? null, data.postanskiBroj ?? null, data.grad ?? null, data.kontakt ?? null,
        zadano.rokPlacanjaDana ?? null, zadano.nacinPlacanja ?? null, zadano.rabat ?? null);
```
`kupac:update`: `const zadano = validirajZadanoKupca(data);` poslije `validirajKupca`, pa prije `if (fields.length === 0)`:
```ts
    for (const k of ['rokPlacanjaDana', 'nacinPlacanja', 'rabat'] as const) {
      if (zadano[k] !== undefined) { fields.push(`${k} = ?`); values.push(zadano[k]); }
    }
```
Tipove parametara `data` u oba handlera proširi sa `rokPlacanjaDana?: number | null; nacinPlacanja?: string | null; rabat?: number | null;`. Isto u `src/global.d.ts` za `createKupac`/`updateKupac` ako su tamo tipizirani, i u `src/types.ts` `Kupac` (vidi Interfaces).

- [ ] **Step 5:** `bun test src/ipc/ugovor/katalog.ugovor.test.ts src/database/migrations.test.ts` → PASS.

- [ ] **Step 6: Rust** — `baza.rs`: u `CREATE TABLE IF NOT EXISTS kupci` (schema i u `run_migrations`, oba mjesta gdje postoji) dodaj kolone; iza tog CREATE-a u `run_migrations`:

```rust
    // Zadane vrijednosti za dokumente po kupcu (NULL = globalna postavka)
    let kupci = kolone(db, "kupci")?;
    if !ima(&kupci, "rokPlacanjaDana") {
        db.exec("ALTER TABLE kupci ADD COLUMN rokPlacanjaDana INTEGER")?;
    }
    if !ima(&kupci, "nacinPlacanja") {
        db.exec("ALTER TABLE kupci ADD COLUMN nacinPlacanja TEXT")?;
    }
    if !ima(&kupci, "rabat") {
        db.exec("ALTER TABLE kupci ADD COLUMN rabat REAL")?;
    }
```

(Ako Rust šemu čita iz `schema.ts` preko `include_str!` — provjeri `fn schema()` u `baza.rs` — onda je šema već pokrivena Step 3 i dodaje se samo migracija.)

`katalog.rs`: promijeni `azuriraj` da prima `upis: Vec<(&str, Value)>` (u tijelu `values.push(v)` umjesto `json!(v)`), a pozivaoce: `dobavljac_update` → `naziv.map(|n| vec![("naziv", json!(n))])`, `kupac_update` → mapiraj `upis` u `Value`. Dodaj:

```rust
const NACINI_PLACANJA: [&str; 4] = ["Gotovina", "Kartica", "Virman", "Ček"];

// Zadane vrijednosti kupca za dokumente — samo poslana polja; prazno/null briše vrijednost.
fn validiraj_zadano_kupca(data: &Value) -> R<Vec<(&'static str, Value)>> {
    let prazno = |v: &Value| v.is_null() || v.as_str() == Some("");
    let mut upis = Vec::new();
    if has(data, "rokPlacanjaDana") {
        let v = &data["rokPlacanjaDana"];
        if prazno(v) {
            upis.push(("rokPlacanjaDana", Value::Null));
        } else {
            match v.as_f64() {
                Some(n) if js::is_integer(v) && (0.0..=365.0).contains(&n) => upis.push(("rokPlacanjaDana", json!(n as i64))),
                _ => baci!("Rok plaćanja mora biti cijeli broj dana od 0 do 365"),
            }
        }
    }
    if has(data, "nacinPlacanja") {
        let v = &data["nacinPlacanja"];
        if prazno(v) {
            upis.push(("nacinPlacanja", Value::Null));
        } else {
            match v.as_str() {
                Some(s) if NACINI_PLACANJA.contains(&s) => upis.push(("nacinPlacanja", json!(s))),
                _ => baci!("Nepoznat način plaćanja \"{}\"", js::to_string(v)),
            }
        }
    }
    if has(data, "rabat") {
        let v = &data["rabat"];
        if prazno(v) {
            upis.push(("rabat", Value::Null));
        } else {
            match v.as_f64() {
                Some(n) if n.is_finite() && n >= 0.0 && n < 100.0 => upis.push(("rabat", json!((n * 100.0).round() / 100.0))),
                _ => baci!("Rabat kupca mora biti od 0 do manje od 100 %"),
            }
        }
    }
    Ok(upis)
}
```

`kupac_create`: poslije `validiraj_kupca` → `let zadano = validiraj_zadano_kupca(data)?;` i uzmi vrijednost po imenu (`zadano.iter().find(|(k, _)| *k == "rabat").map(|(_, v)| v.clone()).unwrap_or(Value::Null)`) za tri nove kolone u INSERT-u. `kupac_update`: `let mut upis: Vec<(&str, Value)> = validiraj_kupca(...)?.into_iter().map(|(k, v)| (k, json!(v))).collect(); upis.extend(validiraj_zadano_kupca(data)?);` pa `azuriraj(...)` s istim listom običnih polja.

Pažnja: JS `Number.isInteger(30)` je true i za `30.0`; `js::is_integer` to već prati. Rust vraća `rokPlacanjaDana` iz SQLite-a kao integer, a `rabat` kao real — `bun run test:rust` to provjerava.

- [ ] **Step 7:** `cargo test -p pazar-backend --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3` (ili iz `src-tauri/`), pa `bun run test:rust 2>&1 | tail -5` → novi testovi prolaze, ništa staro ne pada.
- [ ] **Step 8:** Commit `feat(kupci): zadani rok, način plaćanja i rabat po kupcu`.

---

### Task 5: Učitavanje postavki — provider i `ucitajZaStampu`

**Files:**
- Create: `src/lib/stampa.ts`, `src/components/DokumentPostavkeProvider.tsx`
- Modify: `src/components/MainLayout.tsx` (omotaj sadržaj)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `ucitajDokumentPostavke(): Promise<DokumentPostavke>` (greška → zadane)
  - `ucitajZaStampu(): Promise<{ firma: FirmaSettings; postavke: DokumentPostavke }>` (greška firme → prazna firma, kao današnji `loadFirma`)
  - `<DokumentPostavkeProvider>` i `useDokumentPostavke(): { postavke: DokumentPostavke; osvjezi: () => Promise<void> }`

- [ ] **Step 1:** `src/lib/stampa.ts`:

```ts
import type { FirmaSettings } from '@/types';
import { LOGO_VELICINA } from './firma';
import { KLJUCEVI_DOKUMENATA, ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke, type DokumentPostavke } from './dokumentPostavke';

const PRAZNA_FIRMA: FirmaSettings = {
  naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', web: '', email: '',
  logo: '', logoVelicina: LOGO_VELICINA.zadano, ziroRacuniPozicija: 'zaglavlje', bankAccounts: [],
};

export async function ucitajDokumentPostavke(): Promise<DokumentPostavke> {
  try {
    const vr = await Promise.all(KLJUCEVI_DOKUMENATA.map(k => window.api.getSetting(k)));
    return procitajDokumentPostavke(Object.fromEntries(KLJUCEVI_DOKUMENATA.map((k, i) => [k, vr[i]])));
  } catch {
    return ZADANE_DOKUMENT_POSTAVKE;
  }
}

/** Firma i postavke dokumenata svježe iz baze — PDF se pravi van React stabla i mora vidjeti zadnje spremljeno. */
export async function ucitajZaStampu(): Promise<{ firma: FirmaSettings; postavke: DokumentPostavke }> {
  const [firma, postavke] = await Promise.all([
    window.api.getFirmaSettings().catch(() => PRAZNA_FIRMA),
    ucitajDokumentPostavke(),
  ]);
  return { firma, postavke };
}
```

(Ako `FirmaSettings` iz `@/types` ima polja koja PRAZNA_FIRMA ne pokriva nakon rada paralelne sesije, dopuni ih po tipu — `bunx tsc --noEmit -p .` javlja.)

- [ ] **Step 2:** `src/components/DokumentPostavkeProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ZADANE_DOKUMENT_POSTAVKE, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { ucitajDokumentPostavke } from '@/lib/stampa';

interface Vrijednost { postavke: DokumentPostavke; osvjezi: () => Promise<void> }

const Ctx = createContext<Vrijednost>({ postavke: ZADANE_DOKUMENT_POSTAVKE, osvjezi: async () => {} });

/** Postavke dokumenata za ekrane (format brojeva, zadani rokovi…); Postavke zovu `osvjezi` nakon spremanja. */
export function DokumentPostavkeProvider({ children }: { children: React.ReactNode }) {
  const [postavke, setPostavke] = useState<DokumentPostavke>(ZADANE_DOKUMENT_POSTAVKE);
  const osvjezi = useCallback(async () => { setPostavke(await ucitajDokumentPostavke()); }, []);
  useEffect(() => { osvjezi(); }, [osvjezi]);
  return <Ctx.Provider value={{ postavke, osvjezi }}>{children}</Ctx.Provider>;
}

export const useDokumentPostavke = () => useContext(Ctx);
```

- [ ] **Step 3:** U `MainLayout.tsx` omotaj povratni JSX (najvanjski element koji `return (` vraća) u `<DokumentPostavkeProvider>…</DokumentPostavkeProvider>`.
- [ ] **Step 4:** `bunx tsc --noEmit -p . 2>&1 | grep -E "stampa|DokumentPostavkeProvider|MainLayout"` → prazno.
- [ ] **Step 5:** Commit `feat(dokumenti): učitavanje postavki dokumenata`.

---

### Task 6: Zajednički PDF dijelovi + render test

**Files:**
- Create: `src/components/pdf/PotpisBlok.tsx`, `src/components/pdf/PdfPodnozje.tsx`, `src/components/pdf/pdf.render.test.tsx`

**Interfaces:**
- Consumes: `PotpisLinije` (Task 1), `POTPIS_AUTORA` (`@/lib/brend`), `PDF_FONT_FAMILY_BOLD`.
- Produces:
  - `PotpisBlok({ linije: PotpisLinije; pecat?: { slika: string; velicina: number } | null })`
  - `PdfPodnozje({ firmaNaziv: string; danas: string; tekst?: string; potpisAutora?: string; generisano?: string })` — fixed footer
  - `DODATAK_PODNOZJA = 24` — koliko page `paddingBottom` raste kad `tekst` nije prazan
  - test helper u testu: `renderuj(el): Promise<Buffer>`

- [ ] **Step 1:** `PotpisBlok.tsx` (stilovi identični današnjim `signatures*` u PDF-ovima):

```tsx
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import type { PotpisLinije } from '@/lib/dokumentPostavke';

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 40, paddingBottom: 20 },
  blok: { width: '42%', position: 'relative' },
  linija: { borderTop: '0.5pt solid #000', marginBottom: 4 },
  labela: {
    fontSize: 7, fontFamily: PDF_FONT_FAMILY_BOLD, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#000', textAlign: 'center',
  },
  // Pečat leži preko linije kao pravi otisak — ne gura tekst ispod.
  pecat: { position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' },
});

/** Dvije potpisne linije; pečat (ako je uključen za dokument) iznad lijeve. */
export function PotpisBlok({ linije, pecat }: { linije: PotpisLinije; pecat?: { slika: string; velicina: number } | null }) {
  return (
    <View style={[s.wrap, pecat ? { paddingTop: Math.max(40, Math.round(pecat.velicina * 0.75)) } : {}]} wrap={false}>
      <View style={s.blok}>
        {pecat && (
          <View style={s.pecat}>
            <Image src={pecat.slika} style={{ height: pecat.velicina, width: pecat.velicina * 1.6, objectFit: 'contain' }} />
          </View>
        )}
        <View style={s.linija} />
        <Text style={s.labela}>{linije.lijevo}</Text>
      </View>
      <View style={s.blok}>
        <View style={s.linija} />
        <Text style={s.labela}>{linije.desno}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2:** `PdfPodnozje.tsx`:

```tsx
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { POTPIS_AUTORA } from '@/lib/brend';

/** Koliko `paddingBottom` stranice raste kad firma ima svoj tekst podnožja (do 3 reda). */
export const DODATAK_PODNOZJA = 24;

const s = StyleSheet.create({
  footer: {
    position: 'absolute', bottom: 30, left: 50, right: 50,
    borderTop: '0.5pt solid #ccc', paddingTop: 8, fontSize: 7, color: '#999',
  },
  tekst: { fontSize: 6.5, color: '#555', lineHeight: 1.35, marginBottom: 4 },
  red: { flexDirection: 'row', justifyContent: 'space-between' },
});

/** Podnožje na svakoj stranici: tekst firme (ako postoji), pa autor · firma · datum · stranica. */
export function PdfPodnozje({ firmaNaziv, danas, tekst, potpisAutora = POTPIS_AUTORA, generisano = 'Generisano' }: {
  firmaNaziv: string; danas: string; tekst?: string; potpisAutora?: string; generisano?: string;
}) {
  return (
    <View style={s.footer} fixed>
      {tekst ? <Text style={s.tekst}>{tekst}</Text> : null}
      <View style={s.red}>
        <Text>{potpisAutora}</Text>
        <Text>{firmaNaziv} · {generisano}: {danas}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Render test** `src/components/pdf/pdf.render.test.tsx` — za sad samo dijelovi; Taskovi 7–9 dodaju dokumente u isti fajl:

```tsx
import { test, expect } from 'bun:test';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import { PotpisBlok } from './PotpisBlok';
import { PdfPodnozje } from './PdfPodnozje';

// 1×1 PNG
export const SLIKA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function renderuj(el: React.ReactElement): Promise<Buffer> {
  const buf = await renderToBuffer(el as any);
  expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  return buf;
}

test('potpis s pečatom i podnožje s dugim tekstom se renderuju', async () => {
  await renderuj(
    <Document>
      <Page size="A4" style={{ padding: 50, paddingBottom: 94 }}>
        <PotpisBlok linije={{ lijevo: 'Izdao', desno: 'Primio' }} pecat={{ slika: SLIKA, velicina: 120 }} />
        <PdfPodnozje firmaNaziv="Firma" danas="25.09.2026" tekst={'Upisano u registar. '.repeat(15).slice(0, 300)} />
      </Page>
    </Document>,
  );
});
```

- [ ] **Step 4:** `bun test src/components/pdf/pdf.render.test.tsx` → PASS. Ako pada zbog učitavanja fontova (`.ttf` import u `pdf-fonts.ts`) ili `@/` aliasa pod bun-om: dodaj na vrh testa `mock.module('@/assets/fonts/DMSans-Regular.ttf', () => ({ default: require.resolve('../../assets/fonts/DMSans-Regular.ttf') }))` (i za Bold) iz `bun:test`; ako i dalje ne ide, javi koordinatoru s tačnom greškom — NE brisati test.
- [ ] **Step 5:** Commit `feat(pdf): zajednički potpis s pečatom i podnožje`.

---

### Task 7: Faktura (PrilogPdf) i štampa fakture

**Files:**
- Modify: `src/components/PrilogPdf.tsx`, `src/components/stampaFakture.tsx`, `src/components/racuni/RacunDetailDialog.tsx:181`
- Test: `src/components/pdf/pdf.render.test.tsx`

**Interfaces:**
- Consumes: `DokumentPostavke`, `pecatZa`, `formatRabat` (Task 1), `PotpisBlok`, `PdfPodnozje`, `DODATAK_PODNOZJA` (Task 6), `ucitajZaStampu` (Task 5)
- Produces: `PrilogPdfProps.postavke: DokumentPostavke` (obavezno)

- [ ] **Step 1: Test** — dodaj u `pdf.render.test.tsx`:

```tsx
import { PrilogPdf } from '../PrilogPdf';
import { ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke } from '@/lib/dokumentPostavke';

const FIRMA = {
  naziv: 'Firma d.o.o.', adresa: 'Ulica 1', grad: 'Sarajevo', idBroj: '4200000000001', pdvBroj: '200000000001',
  skladiste: 'Glavno', web: '', email: '', logo: '', logoVelicina: 100, ziroRacuniPozicija: 'zaglavlje' as const,
  bankAccounts: [{ bankName: 'Banka', accountNumber: '1234567890123456' }],
};
export const SVE_UKLJUCENO = procitajDokumentPostavke({
  'dokumenti.pecat': SLIKA, 'dokumenti.pecat.faktura': 'true', 'dokumenti.pecat.ponuda': 'true',
  'dokumenti.pecat.otpremnica': 'true', 'dokumenti.pecat.racun': 'true',
  'dokumenti.podnozje': 'Upisano u sudski registar Općinskog suda u Sarajevu. '.repeat(6),
  'dokumenti.kolone.sifra': 'true', 'dokumenti.kolone.jm': 'false',
  'dokumenti.potpis.faktura.lijevo': 'Fakturisao',
});
const ORDER: any = {
  id: 1, korisnikId: 1, ukupno: 23.4, pdvIznos: 3.4, nacinPlacanja: 'Virman', status: 'completed',
  brojFiskalnogRacuna: '15', prilogBroj: 15, createdAt: '2026-09-25 10:00:00', korisnikIme: 'Admin',
  kupacNaziv: 'Kupac', kupacIdBroj: '4200000000002',
  stavke: [
    { id: 1, orderId: 1, productId: 1, kolicina: 2, cijena: 11.7, rabat: 2.5, pdvStopa: 'E', productNaziv: 'Artikal', productJm: 'kom', productSifra: 'A1' },
  ],
};

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`faktura (${ime})`, async () => {
    await renderuj(<PrilogPdf order={ORDER} firma={FIRMA} stavke={ORDER.stavke} postavke={postavke} />);
    await renderuj(<PrilogPdf order={ORDER} firma={{ ...FIRMA, ziroRacuniPozicija: 'podnozje' }} stavke={ORDER.stavke} postavke={postavke} />);
  });
}
```

- [ ] **Step 2:** `bun test src/components/pdf/pdf.render.test.tsx` → FAIL (TS/prop `postavke`) ili PASS bez efekta — u oba slučaja nastavi.
- [ ] **Step 3: PrilogPdf izmjene**
  - Props: `postavke: DokumentPostavke`; destrukturiraj.
  - Kolone: `const kol = postavke.kolone;`. Zaglavlje i red: kolona Šifra samo ako `kol.sifra`, JM samo ako `kol.jm`, Rabat samo ako `imaRabat` (već postoji). Stil `colNaziv` postaje `{ flex: 1, paddingRight: 10 }`; obriši `colNazivUzRabat` i `const colNaziv = …` (koristi `s.colNaziv` svuda) — flex preuzme širinu skrivenih kolona.
  - Rabat: `fmtRabat` zamijeni s `formatRabat` iz `@/lib/dokumentPostavke`.
  - Potpisi: blok `{/* ── Signatures ── */}` zamijeni s `<PotpisBlok linije={postavke.potpisi.faktura} pecat={pecatZa(postavke, 'faktura')} />`; obriši `signatures*` stilove.
  - Podnožje: varijanta bez žiro računa u podnožju → `<PdfPodnozje firmaNaziv={firma.naziv} danas={today} tekst={postavke.podnozje} />` (obriši `footer` stil). Varijanta s računima dolje: u `s.podnozje` View-u, iznad `podnozjeMeta`, dodaj `{postavke.podnozje ? <Text style={{ fontSize: 6.5, color: '#555', lineHeight: 1.35, marginBottom: 4 }}>{postavke.podnozje}</Text> : null}`.
  - Page padding: `const dodatak = postavke.podnozje ? { paddingBottom: (racuniDolje ? 118 : 70) + DODATAK_PODNOZJA } : {};` i `style={[s.page, racuniDolje ? s.pagePodnozje : {}, dodatak]}`.
- [ ] **Step 4: Pozivaoci** — `stampaFakture.tsx`: `const { firma, postavke } = await ucitajZaStampu();` i `<PrilogPdf … postavke={postavke} />`. `RacunDetailDialog.tsx:181`: isto (`const { firma, postavke } = await ucitajZaStampu();`).
- [ ] **Step 5:** `bun test src/components/pdf/pdf.render.test.tsx` → PASS; `bunx tsc --noEmit -p . 2>&1 | grep -E "PrilogPdf|stampaFakture|RacunDetailDialog"` → prazno.
- [ ] **Step 6:** Commit `feat(dokumenti): faktura prati postavke dokumenata`.

---

### Task 8: Račun i otpremnica (RacunPdf, OtpremnicaPdf)

**Files:**
- Modify: `src/components/RacunPdf.tsx`, `src/components/OtpremnicaPdf.tsx`, `src/components/racuni/RacunDetailDialog.tsx:133-148`, `src/screens/KasaScreen.tsx:~466-475` (otpremnica), `src/types.ts` (`OrderItem.productSifra?: string`)
- Test: `src/components/pdf/pdf.render.test.tsx`

**Interfaces:**
- Consumes: kao Task 7.
- Produces: `RacunPdfProps.postavke`, `OtpremnicaPdfProps.postavke` (obavezno).

- [ ] **Step 1: Test** — u `pdf.render.test.tsx` (koristi `ORDER`, `FIRMA`, `SVE_UKLJUCENO` iz Task 7):

```tsx
import { RacunPdf } from '../RacunPdf';
import { OtpremnicaPdf } from '../OtpremnicaPdf';

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`račun bs/en i otpremnica (${ime})`, async () => {
    await renderuj(<RacunPdf order={ORDER} firma={FIRMA} postavke={postavke} />);
    await renderuj(<RacunPdf order={ORDER} firma={FIRMA} postavke={postavke} lang="en" />);
    await renderuj(<RacunPdf order={{ ...ORDER, stavke: ORDER.stavke.map((s: any) => ({ ...s, rabat: 0 })) }} firma={FIRMA} postavke={postavke} />);
    await renderuj(<OtpremnicaPdf order={ORDER} firma={FIRMA} postavke={postavke} />);
  });
}
```

- [ ] **Step 2:** `bun test src/components/pdf/pdf.render.test.tsx` → FAIL/TS greška.
- [ ] **Step 3: RacunPdf**
  - Props `postavke: DokumentPostavke`.
  - Kolone: dodaj `colSifra: { width: 44 }` (pt, kao ostale); zaglavlje/red: Šifra (`si.productSifra ?? ''`) ako `postavke.kolone.sifra`, JM ako `postavke.kolone.jm`, Rabat samo ako `const imaRabat = stavke.some(si => si.rabat > 0)`. `colArtikal` već ima `flex: 1`.
  - Rabat: `formatRabat(si.rabat)`.
  - Labela šifre: `translations` dobija `colCode: 'Šifra'` / `'Code'`.
  - Potpisi: `lang === 'bs'` → `postavke.potpisi.racun`; `lang === 'en'` → `{ lijevo: t.signatureIssuer, desno: t.signatureRecipient }` (engleski ostaje fiksan). `<PotpisBlok linije={…} pecat={pecatZa(postavke, 'racun')} />`.
  - Podnožje: `<PdfPodnozje firmaNaziv={firma.naziv} danas={today} tekst={postavke.podnozje} potpisAutora={lang === 'en' ? POTPIS_AUTORA_EN : POTPIS_AUTORA} generisano={t.generated} />`; page `paddingBottom` + `DODATAK_PODNOZJA` kad `postavke.podnozje`.
  - Obriši nekorištene `signatures*`/`footer` stilove.
- [ ] **Step 4: OtpremnicaPdf**
  - Props `postavke`. `colArtikal` → `{ flex: 1 }`; dodaj `colSifra: { width: '12%' }`; Šifra/JM po prekidačima (nema cijena ni rabata).
  - `<PotpisBlok linije={postavke.potpisi.otpremnica} pecat={pecatZa(postavke, 'otpremnica')} />`, `<PdfPodnozje … tekst={postavke.podnozje} />`, padding kao gore.
- [ ] **Step 5: Tip** — `src/types.ts` `OrderItem` dobija `productSifra?: string;` (upiti `orders:*` ga već vraćaju: `handlers.ts:975`, `racuni.rs:580`).
- [ ] **Step 6: Pozivaoci** — `RacunDetailDialog.tsx`: obriši lokalni `loadFirma`; `racunBlob`/`otpremnicaBlob` koriste `const { firma, postavke } = await ucitajZaStampu();`. `KasaScreen.tsx` (gdje se pravi `OtpremnicaPdf`, ~l.466-475): isto umjesto `getFirmaSettings`.
- [ ] **Step 7:** `bun test src/components/pdf/pdf.render.test.tsx` → PASS; `bunx tsc --noEmit -p . 2>&1 | grep -E "RacunPdf|OtpremnicaPdf|RacunDetailDialog|KasaScreen"` → prazno.
- [ ] **Step 8:** Commit `feat(dokumenti): račun i otpremnica prate postavke dokumenata`.

---

### Task 9: Ponuda i radni nalog (PonudaPdf, RadniNalogPdf)

**Files:**
- Modify: `src/components/PonudaPdf.tsx`, `src/components/RadniNalogPdf.tsx`, `src/screens/PonudeScreen.tsx:404-418` (loadFirma/buildPdfBlob), `src/components/proizvodnja/NalogDetailDialog.tsx:115-119`
- Test: `src/components/pdf/pdf.render.test.tsx`

**Interfaces:**
- Consumes: kao Task 7, `formatBrojPonude(p, f)`, `formatBrojNaloga(n, f)` (Task 3).
- Produces: `PonudaPdfProps.postavke`, `RadniNalogPdf({ nalog, firma, postavke })`.

- [ ] **Step 1: Test** — u `pdf.render.test.tsx`:

```tsx
import { PonudaPdf } from '../PonudaPdf';
import { RadniNalogPdf } from '../RadniNalogPdf';

const PONUDA: any = {
  id: 1, broj: 3, godina: 2026, datum: '2026-09-25', vaziDo: '2026-10-03', napomena: 'Isporuka 5 dana',
  ukupno: 22.82, pdvIznos: 3.32, korisnikIme: 'Admin', kupacNaziv: 'Kupac',
  stavke: [{ id: 1, productNaziv: 'Artikal', productJm: 'kom', productSifra: 'A1', kolicina: 2, cijena: 11.7, rabat: 2.5 }],
};
const NALOG: any = {
  id: 1, broj: 2, godina: 2026, datum: '2026-09-25', vrsta: 'narudzba', status: 'otvoren', opis: 'Izrada',
  stavke: [{ id: 1, materijalSifra: 'M1', materijalNaziv: 'Ploča', materijalJm: 'm2', kolicina: 1.5, napomena: '' }],
};

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`ponuda i nalog (${ime})`, async () => {
    await renderuj(<PonudaPdf ponuda={PONUDA} firma={FIRMA} postavke={postavke} />);
    await renderuj(<PonudaPdf ponuda={{ ...PONUDA, stavke: [{ ...PONUDA.stavke[0], rabat: 0 }] }} firma={FIRMA} postavke={{ ...postavke, ponuda: { ...postavke.ponuda, uslovi: '' } }} />);
    await renderuj(<RadniNalogPdf nalog={NALOG} firma={FIRMA} postavke={postavke} />);
  });
}
```

(Ako `RadniNalog` tip traži još polja, dopuni `NALOG` po tipu iz `src/types.ts`.)

- [ ] **Step 2:** FAIL.
- [ ] **Step 3: PonudaPdf**
  - Props `postavke`; `stavke` tip dobija `productSifra?: string`.
  - Broj: `br. {formatBrojPonude(ponuda, postavke.ponuda.broj)}`.
  - Kolone: `colArtikal` → `{ flex: 1 }`; dodaj `colSifra: { width: '11%' }`; Šifra/JM po prekidačima; Rabat samo ako neka stavka ima rabat > 0; rabat `formatRabat`.
  - Uslovi: `Ponuda važi do {fmtDateStr(ponuda.vaziDo)}.{postavke.ponuda.uslovi ? ` ${postavke.ponuda.uslovi}` : ''}`.
  - `<PotpisBlok linije={postavke.potpisi.ponuda} pecat={pecatZa(postavke, 'ponuda')} />`, `<PdfPodnozje … />`, page padding.
- [ ] **Step 4: RadniNalogPdf**
  - Props `postavke`; broj `formatBrojNaloga(nalog, postavke.nalog.broj)`.
  - `<PotpisBlok linije={postavke.potpisi.nalog} />` (bez pečata), `<PdfPodnozje … />`, page padding. Kolone naloga se NE mijenjaju (materijal uvijek ima šifru).
- [ ] **Step 5: Pozivaoci** — `PonudeScreen.tsx`: obriši `loadFirma`; `buildPdfBlob` → `const { firma, postavke } = await ucitajZaStampu(); return pdf(<PonudaPdf ponuda={full as any} firma={firma} postavke={postavke} />).toBlob();`. Ime fajla pri izvozu (`Ponuda-{broj}-{godina}.pdf`, ~l.429) ostaje. `NalogDetailDialog.tsx`: isto za `RadniNalogPdf`. Ako `LOGO_VELICINA` import u tim fajlovima ostane nekorišten — obriši ga.
- [ ] **Step 6:** `bun test src/components/pdf/pdf.render.test.tsx` → PASS; `bunx tsc --noEmit -p . 2>&1 | grep -E "PonudaPdf|RadniNalogPdf|PonudeScreen|NalogDetailDialog"` → prazno; `grep -rn "loadFirma" src` → prazno.
- [ ] **Step 7:** Commit `feat(dokumenti): ponuda i radni nalog prate postavke dokumenata`.

---

### Task 10: Format broja na ekranima

**Files:**
- Modify: `src/screens/PonudeScreen.tsx` (sve `formatBrojPonude(`/`formatBrojNaloga(`), `src/screens/ProizvodnjaScreen.tsx:244,302`, `src/components/proizvodnja/IzdajRacunDialog.tsx:61`, `NalogDetailDialog.tsx:186,306,327,340`, `NalogDialog.tsx:156`

**Interfaces:**
- Consumes: `useDokumentPostavke` (Task 5), `formatBrojPonude/Naloga(x, f)` (Task 3).

- [ ] **Step 1:** U svakoj komponenti: `const { postavke } = useDokumentPostavke();` i svaki poziv `formatBrojPonude(x)` → `formatBrojPonude(x, postavke.ponuda.broj)`, `formatBrojNaloga(x)` → `formatBrojNaloga(x, postavke.nalog.broj)`. Za `poljaPonude` (module-level funkcija u PonudeScreen ~l.135 koja pravi `sifra`/`dodatno` za pretragu): pretvori u funkciju koja prima format, npr. `const poljaPonude = (f: FormatBroja) => (p: PonudaRow) => ({ … formatBrojPonude(p, f) … })`, i u `useMemo` filtera proslijedi `poljaPonude(postavke.ponuda.broj)` (dodaj `postavke.ponuda.broj` u zavisnosti).
- [ ] **Step 2:** `grep -rn "formatBrojPonude(\|formatBrojNaloga(" src --include=*.tsx | grep -v "postavke\.\(ponuda\|nalog\)\.broj"` → samo PDF-ovi (već riješeni) i nijedan ekran.
- [ ] **Step 3:** `bunx tsc --noEmit -p . 2>&1 | grep -E "PonudeScreen|Proizvodnja|Nalog|IzdajRacun"` → prazno; `bun test src/lib` → PASS.
- [ ] **Step 4:** Commit `feat(dokumenti): ekrani prikazuju broj ponude i naloga po postavkama`.

---

### Task 11: Faktura — zadane vrijednosti (FakturaDialog)

**Files:**
- Modify: `src/components/FakturaDialog.tsx`
- Modify: `src/lib/dokumentPostavke.ts` (+ test) — dodaje `rokUIzbor` i `zadanoZaFakturu`

**Interfaces:**
- Consumes: `useDokumentPostavke`, `zadanoZaKupca`, `primijeniRabatKupca`, `formatRabat`.
- Produces: `zadanoZaFakturu(kupac, p, izvor: 'nova' | 'ponuda' | 'skica')` (vidi kod), `rokUIzbor(dana: number | null, brzi: readonly number[]): { rok: number | 'datum' | null; dana: number | null }` — `dana` je broj za `plusDana` kad je `rok === 'datum'`.

- [ ] **Step 1: Test** u `dokumentPostavke.test.ts`:

```ts
import { rokUIzbor } from './dokumentPostavke';
describe('rokUIzbor', () => {
  const BRZI = [8, 15, 30, 60] as const;
  test('bez roka', () => expect(rokUIzbor(null, BRZI)).toEqual({ rok: null, dana: null }));
  test('brzi izbor', () => expect(rokUIzbor(30, BRZI)).toEqual({ rok: 30, dana: 30 }));
  test('ostali dani idu na datum', () => expect(rokUIzbor(45, BRZI)).toEqual({ rok: 'datum', dana: 45 }));
  test('0 dana = danas, kao datum', () => expect(rokUIzbor(0, BRZI)).toEqual({ rok: 'datum', dana: 0 }));
});
```

i:

```ts
import { zadanoZaFakturu } from './dokumentPostavke';
describe('zadanoZaFakturu', () => {
  const p = procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '15' });
  const kupac = { rokPlacanjaDana: 30, nacinPlacanja: 'Kartica', rabat: 5 };
  test('nova faktura: sve od kupca', () =>
    expect(zadanoZaFakturu(kupac, p, 'nova')).toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 5 }));
  test('iz ponude: rok i način od kupca, rabat ne', () =>
    expect(zadanoZaFakturu(kupac, p, 'ponuda')).toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 0 }));
  test('skica: ništa', () => expect(zadanoZaFakturu(kupac, p, 'skica')).toBeNull());
  test('ručno upisana firma (nema u šifarniku): globalno', () =>
    expect(zadanoZaFakturu(undefined, p, 'nova')).toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 }));
});
```

- [ ] **Step 2:** FAIL → implementacija u `dokumentPostavke.ts`:

```ts
/** Rok u danima → izbor u dijalogu fakture: brzi chip ako postoji, inače tačan datum. */
export function rokUIzbor(dana: number | null, brzi: readonly number[]): { rok: number | 'datum' | null; dana: number | null } {
  if (dana == null) return { rok: null, dana: null };
  return { rok: brzi.includes(dana) ? dana : 'datum', dana };
}

/**
 * Zadane vrijednosti fakture prema tome odakle je nastala: skica čuva sve svoje (null),
 * faktura iz ponude uzima rok i način kupca ali ne rabat — stavke nose rabat iz ponude.
 */
export function zadanoZaFakturu(
  kupac: KupacZadano | null | undefined,
  p: DokumentPostavke,
  izvor: 'nova' | 'ponuda' | 'skica',
): { rokDana: number | null; nacinPlacanja: NacinPlacanja; rabat: number } | null {
  if (izvor === 'skica') return null;
  const z = zadanoZaKupca(kupac, p, 'faktura');
  return izvor === 'ponuda' ? { ...z, rabat: 0 } : z;
}
```
→ PASS.

- [ ] **Step 3: FakturaDialog**
  - `const { postavke } = useDokumentPostavke();`
  - Pomoćna u komponenti:
    ```ts
    /** Rok i način plaćanja za firmu; stavke dobijaju rabat kupca samo na novoj fakturi. */
    const primijeniZadano = (kupac: Kupac | undefined, izvor: 'nova' | 'ponuda') => {
      const z = zadanoZaFakturu(kupac, postavke, izvor)!;
      const saRabatom = z.rabat > 0;
      const r = rokUIzbor(z.rokDana, ROKOVI);
      setRok(r.rok as Rok);
      setRokDatum(r.rok === 'datum' && r.dana != null ? plusDana(r.dana) : '');
      setNacinPlacanja(z.nacinPlacanja as PaymentType);
      if (saRabatom) {
        setStavke(prev => primijeniRabatKupca(prev, z.rabat));
        setRabatKupca(z.rabat);
        setObavijest(`Primijenjen rabat kupca ${formatRabat(z.rabat)}`);
      } else setRabatKupca(0);
    };
    ```
    (`plusDana` u ovom fajlu vraća `YYYY-MM-DD` — provjeri; ako vraća drugi oblik, koristi isti oblik koji `rokDatum` očekuje.)
  - Novi state: `const [rabatKupca, setRabatKupca] = useState(0);` — reset na 0 u open-efektu.
  - Open-efekat (`useEffect(…, [open])`): kad NIJE skica (`!s`):
    - `setNacinPlacanja(postavke.faktura.nacinPlacanja as PaymentType)`; rok iz `rokUIzbor(postavke.faktura.rokDana, ROKOVI)` (isto kao gore);
    - napomena: `pocetno ? \`Po ponudi br. ${pocetno.ponudaOznaka}\` : postavke.faktura.napomena`.
    - Skica (`s`) zadržava sve svoje vrijednosti — postojeći kod za skicu se ne mijenja.
  - U `getKupci().then(…)` u open-efektu: `if (!s && pocetno) primijeniZadano(k.find(x => x.idBroj === pocetno.firma.idBroj), 'ponuda');` — faktura iz ponude dobija rok/način kupca, ali NE rabat (stavke nose rabat iz ponude).
  - `potvrdiFirmu(f)`: ako nije skica (drži `skicaId == null` ili zaseban flag) i nije iz ponude (`ponuda == null`): `primijeniZadano(allKupci?.find(k => k.idBroj === f.idBroj), 'nova')`. Ručno unesena firma (nema je u šifarniku) → `primijeniZadano(undefined, 'nova')` vraća globalne vrijednosti, bez rabata.
  - `addProduct`: nova stavka dobija `rabat: rabatKupca` umjesto `rabat: 0` (postojeća stavka kojoj se samo povećava količina ostaje ista).
- [ ] **Step 4:** `bun test src/lib/dokumentPostavke.test.ts` → PASS; `bunx tsc --noEmit -p . 2>&1 | grep FakturaDialog` → prazno.
- [ ] **Step 5:** Commit `feat(faktura): zadani rok, način plaćanja, napomena i rabat kupca`.

---

### Task 12: Ponude i kasa — zadane vrijednosti

**Files:**
- Modify: `src/screens/PonudeScreen.tsx`, `src/screens/KasaScreen.tsx`

**Interfaces:**
- Consumes: `useDokumentPostavke`, `zadanoZaKupca`, `primijeniRabatKupca`, `formatRabat`, `postaviRabat` (`@/lib/kosarica`).

- [ ] **Step 1: PonudeScreen**
  - `const { postavke } = useDokumentPostavke();`
  - `DEFAULT_ROK_DANA` u UI → `postavke.ponuda.vaziDana` (`openNova` i `rokDana` fallback). Konstanta u `lib/ponuda.ts` ostaje (backend/testovi).
  - Svaki `setPaymentType('Gotovina')` koji otvara konverziju (useState init ~l.160, prečica `k` ~l.534, i dugme „Konvertuj“ — grep `setKonvertujOpen(true)`) → `setPaymentType(zadanoZaKupca(kupacIzabrane, postavke, 'ponuda').nacinPlacanja as PaymentType)`, gdje je `kupacIzabrane` kupac ponude iz `kupci` liste po `selected.kupacId` (ako lista nije učitana: `undefined` → globalno). Ako `kupci` nisu učitani na tom ekranu van forme, učitaj ih jednom (`window.api.getKupci()`) pri mountu.
  - Novi state `rabatKupca` (0). Kad korisnik u formi promijeni kupca (handler koji zove `setKupacId(...)` iz UI-a — ne `openUredi`/`openNova`): `const k = kupci.find(x => String(x.id) === novi); const r = k?.rabat ?? 0; setRabatKupca(r); if (r > 0) { setStavke(prev => primijeniRabatKupca(prev, r)); setFormError(''); /* obavijest */ }`. Prikaži kratku obavijest istim mehanizmom kojim forma prikazuje poruke (ako postoji samo `formError`, dodaj mali `formInfo` state i prikaži ga ispod izbora kupca sivim tekstom: „Primijenjen rabat kupca 5%“).
  - `openUredi`: `setRabatKupca(0)` — postojeća ponuda se ne preračunava dok se kupac ne promijeni.
  - `addStavka`: nova stavka `rabat: rabatKupca`.
- [ ] **Step 2: KasaScreen**
  - `const { postavke } = useDokumentPostavke();` (koristi se za `zadanoZaKupca`).
  - State `const [kupacRabat, setKupacRabat] = useState(0);`
  - `selectKupac(k)`: poslije postojećih settera:
    ```ts
    const z = zadanoZaKupca(k, postavke, 'faktura');
    if (k.nacinPlacanja) setPaymentType(z.nacinPlacanja as PaymentType);
    setKupacRabat(z.rabat);
    if (z.rabat > 0) {
      setCart(prev => primijeniRabatKupca(prev, z.rabat));
      setMessage({ type: 'success', text: `Primijenjen rabat kupca ${formatRabat(z.rabat)}` });
    }
    ```
    (dodaj `postavke` u zavisnosti `useCallback`). Globalni način plaćanja fakture se na kasi NE primjenjuje — samo kupčev (kasa ostaje na Gotovini dok kupac nema svoj).
  - `clearKupac` i reset nakon naplate (`clearKupac()` se već zove): `setKupacRabat(0)` — rabat na stavkama ostaje.
  - `addToCart`: poslije `const next = dodajUKosaricu(...)`: `const saRabatom = prije === 0 && kupacRabat > 0 ? postaviRabat(next, product.id, kupacRabat) : next;` i dalje koristi `saRabatom` (setCart, `poslije` računaj iz `saRabatom`). Dodaj `kupacRabat` u zavisnosti.
  - Ručni unos kupca (polja u dijalogu, bez izbora iz liste) ne zove `selectKupac` → nema zadanih vrijednosti.
- [ ] **Step 3:** `bunx tsc --noEmit -p . 2>&1 | grep -E "PonudeScreen|KasaScreen"` → prazno; `bun test src/lib` → PASS.
- [ ] **Step 4:** Commit `feat(ponude,kasa): zadani način plaćanja, važnost ponude i rabat kupca`.

---

### Task 13: Šifarnik › Kupci — tri polja

**Files:**
- Modify: `src/components/sifarnik/KupciTab.tsx` (dijalog kupca, ~l.30-240)

**Interfaces:**
- Consumes: `Kupac` polja (Task 4), `NACINI_PLACANJA` (Task 1), `parseDecimal` (koristi isti parser kao ostatak app-a — grep `parseDecimal` u `src/lib`).

- [ ] **Step 1:** State: `rokPlacanja` (string), `nacinPlacanja` (string, '' = globalno), `rabat` (string). Pri otvaranju za uređivanje: `String(kupac.rokPlacanjaDana ?? '')`, `kupac.nacinPlacanja ?? ''`, `kupac.rabat != null ? String(kupac.rabat).replace('.', ',') : ''`; za novog kupca prazno.
- [ ] **Step 2:** Payload (create i update): `rokPlacanjaDana: rokPlacanja.trim() === '' ? null : Number(rokPlacanja)`, `nacinPlacanja: nacinPlacanja || null`, `rabat: rabat.trim() === '' ? null : parseDecimal(rabat)`. Validaciju radi backend — greška se prikazuje postojećim `error` stateom.
- [ ] **Step 3:** UI: ispod postojećih polja, nova grupa s naslovom „Zadano za dokumente“ (isti `Label` stil kao ostala polja) i napomenom „Prazno = kao u Postavkama › Dokumenti.“; tri polja u redu (`grid grid-cols-3 gap-3`):
  - „Rok plaćanja (dana)“ — `Input inputMode="numeric"`, samo cifre (`e.target.value.replace(/\D/g, '')`), `maxLength={3}`, placeholder „npr. 30“.
  - „Način plaćanja“ — shadcn `Select` s opcijom „Kao u postavkama“ (vrijednost `__globalno` → mapira se na '') + `NACINI_PLACANJA`.
  - „Rabat (%)“ — `Input inputMode="decimal"`, placeholder „npr. 5“.
- [ ] **Step 4:** `bunx tsc --noEmit -p . 2>&1 | grep KupciTab` → prazno.
- [ ] **Step 5:** Commit `feat(sifarnik): zadane vrijednosti kupca za dokumente`.

---

### Task 14: Postavke › Dokumenti

**Files:**
- Create: `src/components/postavke/SlikaBirac.tsx`, `src/components/postavke/DokumentiGrupa.tsx`
- Modify: `src/components/postavke/FirmaGrupa.tsx` (logo koristi `SlikaBirac`), `src/screens/PostavkeScreen.tsx`

**Interfaces:**
- Consumes: sve iz Task 1, `useDokumentPostavke().osvjezi`, dijelovi iz `./dijelovi` (`GrupaZaglavlje`, `Sekcija`, `SekcijaTijelo`, `Polje`, `PrekidacRed`, `Red`, `IshodPoruka`, `POLJE`).
- Produces: `SlikaBirac({ slika, onChange, alt, dodajTekst, zamijeniTekst, napomena })`; `DokumentiGrupa({ onIzmijenjeno })`.

- [ ] **Step 1: SlikaBirac** — izdvoji iz `FirmaGrupa.tsx` blok „kvadratić + Dodaj/Zamijeni + Ukloni + napomena“ i `handleLogo` (FileReader → data URL) u komponentu:

```tsx
export function SlikaBirac({ slika, onChange, alt, dodajTekst, zamijeniTekst, napomena }: {
  slika: string; onChange: (v: string) => void; alt: string;
  dodajTekst: string; zamijeniTekst: string; napomena: string;
}) { /* markup identičan današnjem u FirmaGrupi; accept="image/png,image/jpeg" */ }
```

FirmaGrupa ga koristi: `<SlikaBirac slika={forma.logo} onChange={v => postavi('logo', v)} alt="Logo firme" dodajTekst="Dodaj logo" zamijeniTekst="Zamijeni logo" napomena="PNG, JPG ili SVG, najbolje kvadratni oko 200 × 200 px." />` (za logo zadrži `accept="image/*"` — dodaj prop `accept` s tim zadanim).

- [ ] **Step 2: DokumentiGrupa** — obrazac FirmaGrupe: `forma`/`spremljeno` (`DokumentPostavke`), učitavanje `ucitajDokumentPostavke()`, `izmijenjeno` (JSON poređenje) → `onIzmijenjeno`, sticky traka „Spremi postavke dokumenata“/„Odbaci“, spremanje:

```ts
const spremi = async () => {
  setSpremam(true);
  try {
    const kljucevi = uKljuceve(forma);
    await Promise.all(Object.entries(kljucevi).map(([k, v]) => window.api.setSetting(k, v)));
    const svjeze = procitajDokumentPostavke(kljucevi); // trim/limit kao pri čitanju
    setForma(svjeze); setSpremljeno(svjeze);
    await osvjezi();
    setIshod({ ok: true, tekst: 'Postavke dokumenata su spremljene.' });
  } catch (err) { setIshod({ ok: false, tekst: porukaGreske(err) }); }
  setSpremam(false);
};
```

`GrupaZaglavlje naslov="Dokumenti" opis="Rokovi, tekstovi, potpisi i izgled faktura, ponuda, otpremnica, računa i radnih naloga."` Sekcije (sva polja s `maxLength` iz `LIMITI`):
1. **Faktura** — „Rok plaćanja (dana)“ (numeric, prazno = „Bez roka“, placeholder „Bez roka“), „Način plaćanja“ (Select `NACINI_PLACANJA`), „Napomena na fakturi“ (textarea 3 reda; napomena: „Upisuje se u svaku novu fakturu; može se promijeniti na fakturi. Faktura iz ponude i dalje piše „Po ponudi br. …“.“).
2. **Ponuda** — „Važi (dana)“ (1–365), „Način plaćanja pri konverziji“ (Select), „Uslovi ponude“ (textarea; napomena: „Ispisuje se iza „Ponuda važi do …“.“), „Prefiks broja“ + „Broj cifara“ (Select 0–6, 0 = „bez nula“) s živim primjerom: `Primjer: {formatBroja({ broj: 3, godina: new Date().getFullYear() }, forma.ponuda.broj)}`.
3. **Radni nalog** — „Prefiks broja“ + primjer `formatBroja({ broj: 3, godina }, forma.nalog.broj)`.
   - U sekcijama Ponuda i Radni nalog: polje „Posljednji broj iz starog programa“ (numeric, prazno = nema nastavka; napomena: „Za firme koje prelaze s drugog programa. Važi samo za {tekuća godina}.“). U formi: `nastavak = broj ? { broj, godina: new Date().getFullYear() } : null`. Ispod: „Sljedeća ponuda: {formatBrojPonude(await window.api.getNextBrojPonude(), forma.ponuda.broj)}“ — učitaj pri mountu i ponovo nakon spremanja (provjeri tačno ime metode za `ponuda:nextBroj`/`nalog:nextBroj` u `src/ipc/api.ts`). Ako je nakon spremanja sljedeći broj > upisani + 1: siva napomena „U programu već postoji veći broj — nastavlja se od njega.“
4. **Izgled dokumenata** — `PrekidacRed` „Prikaži šifru artikla“, „Prikaži jedinicu mjere“ (opis: „Kolona Rabat se sama pojavi kad neka stavka ima rabat.“); „Tekst u podnožju“ (textarea 2 reda, napomena „Npr. upis u sudski registar. Ispisuje se na dnu svake stranice svih dokumenata.“).
5. **Potpis i pečat** — `SlikaBirac` (slika pečata; napomena „PNG sa providnom pozadinom izgleda najbolje.“) + Slider veličine (`PECAT_VELICINA`, kao slider loga u FirmaGrupi, s „Vrati zadano“); `PrekidacRed` po dokumentu iz `DOKUMENTI_SA_PECATOM` („Pečat na fakturi / ponudi / otpremnici / računu“, `disabled` dok nema slike); zatim tabela naziva linija: za svaki `DOKUMENTI_SA_POTPISOM` red s nazivom dokumenta i dva `Input`-a (lijevo/desno), placeholder = zadani naziv iz `ZADANE_DOKUMENT_POSTAVKE.potpisi[d]`.

Numerička polja drže se u formi kao brojevi; `Input` za rok fakture: `value={forma.faktura.rokDana ?? ''}`, `onChange` → `''` postaje `null`, inače `Math.min(365, Number(cifre))`. Važi (dana): prazno se ne dozvoljava pri spremanju — `procitajDokumentPostavke` ga vraća na 8.

- [ ] **Step 3: PostavkeScreen** — u `Grupa` tip i `GRUPE` dodaj `{ id: 'dokumenti', naziv: 'Dokumenti', ikona: FileText }` između `fiskalni` i `korisnici`; `podnaslov('dokumenti')`: `dokumentiIzmijenjeno ? { tekst: 'Nespremljene izmjene', ton: 'upozorenje' } : { tekst: 'Fakture, ponude, štampa' }`; state `dokumentiIzmijenjeno` kao `firmaIzmijenjena`; render `{g.id === 'dokumenti' && <DokumentiGrupa onIzmijenjeno={setDokumentiIzmijenjeno} />}`.
- [ ] **Step 4:** `bunx tsc --noEmit -p . 2>&1 | grep -E "postavke/|PostavkeScreen"` → prazno.
- [ ] **Step 5: Screenshot** — postupak iz memorije (`kasa-app-lint-i-electron-provjere`): privremeni `.preview-tmp/` s mock `window.api` (Proxy; `getSetting` → `null`, `getFirmaSettings` → prazna firma), renderuj `PostavkeScreen` otvoren na grupi „Dokumenti“ (postavi `zadnjaGrupa` preko klika CDP-om ili privremeno kroz query param u preview.tsx), headless chromium screenshot 1440×900 u scratchpad; obriši `.preview-tmp/`. Priloži putanju slike u izvještaju.
- [ ] **Step 6:** Commit `feat(postavke): grupa Dokumenti`.

---

### Task 15: Završna provjera

- [ ] **Step 1:** `bun test 2>&1 | tail -5` → nema novih padova u odnosu na Task 0.
- [ ] **Step 2:** `bun run test:rust 2>&1 | tail -5` → nema novih padova.
- [ ] **Step 3:** `cd src-tauri && cargo test -p pazar-backend 2>&1 | tail -3` → PASS.
- [ ] **Step 4:** `bunx tsc --noEmit -p . 2>&1 | wc -l` → ne više nego na `main` (zapiši oba broja).
- [ ] **Step 5:** `bunx eslint <svi dodirnuti fajlovi>` → bez novih kategorija grešaka osim postojećeg `import/no-unresolved`.
- [ ] **Step 6:** `bunx vite build --config vite.renderer.config.ts --outDir <scratchpad>/renderer` → build prolazi.
- [ ] **Step 7:** Izvještaj korisniku: šta ručno provjeriti u Electronu (štampa fakture s pečatom, ponuda s prefiksom, kasa s kupcem koji ima rabat, stara baza se otvara).
