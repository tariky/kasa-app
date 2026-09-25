# Izvoz za knjigovođu — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin u Izvještajima bira mjesec ili period i jednim klikom snima `.zip` s Excelom (svi podaci za knjigovođu) i PDF rekapitulacijom.

**Architecture:** Jedan kanal samo za čitanje, `izvoz:knjigovodja(od, do)`, vraća sirove redove SQL upita. SQL tekst je u jednom TS fajlu koji Rust čita `include_str!`-om, pa su oba backenda doslovno ista. Obračun (`obracun.ts`), Excel (`exceljs`), PDF (`@react-pdf/renderer`) i ZIP (`fflate`) su u rendereru; snimanje ide kroz postojeće `dialog:saveFile` + `fs:writeFile`.

**Tech Stack:** Electron + React + ShadCN (renderer), better-sqlite3 (Electron) / rusqlite (Tauri), bun test, exceljs, fflate, @react-pdf/renderer.

**Spec:** `docs/superpowers/specs/2026-09-25-izvoz-knjigovodja-design.md`

## Global Constraints

- Radi se u worktreeju `.claude/worktrees/izvoz-knjigovodja`, grana `feat/izvoz-knjigovodja`. U glavnom folderu paralelno radi druga sesija — ne dirati ga.
- Datumi perioda su lokalni `YYYY-MM-DD`, uključivo; kolone `createdAt` su `datetime('now','localtime')`.
- SQL parametri su **imenovani** `:od` i `:do` (better-sqlite3 ne podržava `?1`/`?2`; provjereno). U TS-u se prosljeđuje objekat samo s imenima koja upit koristi; u Rustu se vežu pozicijski redom prvog pojavljivanja.
- U `upiti.ts` znak backtick smije stajati **samo** oko SQL teksta (Rust dijeli fajl po njemu).
- Kanal nije u `moduliKatalog.json` (samo čitanje).
- Novac se zaokružuje `round2` iz `src/lib/novac.ts`.
- Nove zavisnosti samo `exceljs` i `fflate`.
- Tab „Knjigovođa“ vidi samo `uloga === 'admin'`.
- Tekst u UI-ju i dokumentima na bosanskom (ijekavica), nazivi mjeseci: Januar, Februar, Mart, April, Maj, Juni, Juli, August, Septembar, Oktobar, Novembar, Decembar.
- Commit poruke u stilu repoa (`feat(izvoz): …`), s linijom `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Račun u 23:59:59 zadnjeg dana i 00:00:00 prvog dana** — mora ući tačno u jedan period. Pokriva ugovorni test u Task 1 (granice).
2. **Stari/obrisani podaci** — `order_items.rabat` NULL, stavka čiji artikal više nema šifru/naziv (LEFT JOIN → null) — izvoz ne smije pasti ni ispisati `null`. Test u Task 1 (rabat NULL → 0) i Task 3 (null naziv → `—`).
3. **Prazan period** — nema nijednog zapisa: pregled pokazuje nule, Excel ima sve listove sa zaglavljem i zbirom 0, Kontrola „Nema upozorenja“. Test u Task 3 i Task 4.
4. **Firma bez naziva ili s `/ : * ? " < > |` i dijakritikom u nazivu** — ime fajla mora biti ispravno i ASCII. Test u Task 2.
5. **Korisnik otkaže dijalog za snimanje** — ništa se ne dešava, bez poruke o grešci. Ručna provjera u Task 6 (korak ručne provjere).

---

**Prije Task 1:** u worktreeju pokreni `bun test 2>&1 | tail -3` i zabilježi broj pass/fail — to je polazna tačka za Task 7.

### Task 1: Kanal `izvoz:knjigovodja` (TS backend) + ugovorni test

**Files:**
- Create: `src/lib/knjigovodja/tipovi.ts`
- Create: `src/lib/knjigovodja/upiti.ts`
- Create: `src/lib/knjigovodja/podaci.ts`
- Modify: `src/ipc/handlers.ts` (import + `handle('izvoz:knjigovodja', …)` odmah poslije `report:getData`)
- Modify: `src/ipc/api.ts` (poslije `getReportData`)
- Modify: `src/global.d.ts` (poslije `getReportData`; `writeFile` prima `ArrayLike<number>`)
- Test: `src/ipc/ugovor/izvoz.ugovor.test.ts`

**Interfaces:**
- Produces: `KnjigovodjaPodaci` i tipovi redova (`tipovi.ts`); `UPITI` (`upiti.ts`); `dohvatiKnjigovodja(db: SqlDb, od: unknown, doDatum: unknown): KnjigovodjaPodaci`; `window.api.izvozKnjigovodja(od: string, doDatum: string): Promise<KnjigovodjaPodaci>`.

- [ ] **Step 1: Tipovi**

`src/lib/knjigovodja/tipovi.ts`:

```ts
// Odgovor kanala izvoz:knjigovodja — sirovi redovi upita iz upiti.ts, isti
// za Electron i Tauri backend. Obračun je u obracun.ts.

export interface IzvozRacun {
  id: number;
  createdAt: string;
  refundedAt: string | null;
  brojFiskalnogRacuna: string | null;
  brojReklamacije: string | null;
  status: 'completed' | 'refunded';
  ukupno: number;
  pdvIznos: number;
  nacinPlacanja: string;
  kupacNaziv: string | null;
  kupacIdBroj: string | null;
  isManual: number;
  prilogBroj: number | null;
  datumValute: string | null;
  korisnikIme: string | null;
}

export interface IzvozStavkaRacuna {
  orderId: number;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
}

export interface IzvozPrimka {
  id: number;
  brojPrimke: string;
  datum: string;
  dobavljacNaziv: string | null;
  dobavljacId: string | null;
  brojFakture: string | null;
}

export interface IzvozPrimkaStavka {
  primkaId: number;
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number;
  cijena: number;
  nabavnaCijena: number;
  rabat: number;
  zavisniTroskovi: number;
  pdvStopa: string;
}

export interface IzvozNivelacijaStavka {
  brojNivelacije: string;
  datum: string;
  sifra: string | null;
  naziv: string | null;
  kolicina: number;
  staraCijena: number;
  novaCijena: number;
  razlika: number;
  ukupnaRazlika: number;
  pdvStopa: string;
}

export interface IzvozKretanjeNovca {
  createdAt: string;
  tip: 'polog' | 'povrat';
  iznos: number;
  korisnikIme: string | null;
  napomena: string | null;
  tringStatus: string;
}

export interface IzvozUtrosak {
  nalogId: number;
  broj: number;
  godina: number;
  zavrsenAt: string;
  opis: string;
  proizvod: string | null;
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number;
  /** Cijena zamrznuta pri završetku naloga; null = uzima se prosjecnaNabavna. */
  nabavnaCijena: number | null;
  /** Prosječna nabavna materijala iz primki do dana završetka naloga. */
  prosjecnaNabavna: number;
}

export interface IzvozZaliha {
  sifra: string;
  naziv: string;
  jm: string | null;
  tip: string;
  /** Stanje na kraju dana `do` (zbir kretanja). */
  kolicina: number;
  /** Prodajna cijena važeća na dan `do`. */
  cijena: number;
  /** Zbir nabavnih vrijednosti primki do `do` — za prosječnu nabavnu. */
  nabavnaVrijednost: number;
  nabavnaKolicina: number;
}

export interface KnjigovodjaPodaci {
  od: string;
  do: string;
  racuni: IzvozRacun[];
  reklamacije: IzvozRacun[];
  stavkeRacuna: IzvozStavkaRacuna[];
  primke: IzvozPrimka[];
  primkaStavke: IzvozPrimkaStavka[];
  nivelacije: IzvozNivelacijaStavka[];
  kretanjaNovca: IzvozKretanjeNovca[];
  utrosak: IzvozUtrosak[];
  zalihe: IzvozZaliha[];
}
```

- [ ] **Step 2: Upiti**

`src/lib/knjigovodja/upiti.ts` (ključevi = polja `KnjigovodjaPodaci` osim `od`/`do`):

```ts
// SQL za kanal izvoz:knjigovodja. Rust backend (src-tauri/backend/src/izvoz.rs)
// čita ovaj fajl include_str!-om i uzima tekst između backtick navodnika, pa se
// taj znak u fajlu smije pojaviti samo oko SQL-a. Parametri su :od i :do
// (YYYY-MM-DD, uključivo); upit koristi samo one koje spominje.
export const UPITI = {
  racuni: `
    SELECT o.id, o.createdAt, o.refundedAt, o.brojFiskalnogRacuna, o.brojReklamacije, o.status,
      o.ukupno, o.pdvIznos, o.nacinPlacanja, o.kupacNaziv, o.kupacIdBroj, o.isManual, o.prilogBroj,
      o.datumValute, u.ime AS korisnikIme
    FROM orders o
    LEFT JOIN users u ON u.id = o.korisnikId
    WHERE date(o.createdAt) BETWEEN :od AND :do
    ORDER BY o.createdAt, o.id
  `,
  reklamacije: `
    SELECT o.id, o.createdAt, o.refundedAt, o.brojFiskalnogRacuna, o.brojReklamacije, o.status,
      o.ukupno, o.pdvIznos, o.nacinPlacanja, o.kupacNaziv, o.kupacIdBroj, o.isManual, o.prilogBroj,
      o.datumValute, u.ime AS korisnikIme
    FROM orders o
    LEFT JOIN users u ON u.id = o.korisnikId
    WHERE o.status = 'refunded' AND date(o.refundedAt) BETWEEN :od AND :do
    ORDER BY o.refundedAt, o.id
  `,
  stavkeRacuna: `
    SELECT x.orderId, x.kolicina, x.cijena, x.rabat, x.pdvStopa
    FROM (
      SELECT oi.id AS rb, 0 AS izvor, oi.orderId, oi.kolicina, oi.cijena, COALESCE(oi.rabat, 0) AS rabat, oi.pdvStopa
      FROM order_items oi
      UNION ALL
      SELECT ps.id, 1, ps.orderId, ps.kolicina, ps.cijena, 0, ps.pdvStopa
      FROM prilog_stavke ps
    ) x
    JOIN orders o ON o.id = x.orderId
    WHERE date(o.createdAt) BETWEEN :od AND :do
      OR (o.status = 'refunded' AND date(o.refundedAt) BETWEEN :od AND :do)
    ORDER BY x.orderId, x.izvor, x.rb
  `,
  primke: `
    SELECT id, brojPrimke, datum, dobavljacNaziv, dobavljacId, brojFakture
    FROM primke
    WHERE date(datum) BETWEEN :od AND :do
    ORDER BY datum, id
  `,
  primkaStavke: `
    SELECT ps.primkaId, p.sifra, p.naziv, p.jm, ps.kolicina, ps.cijena, ps.nabavnaCijena,
      COALESCE(ps.rabat, 0) AS rabat, COALESCE(ps.zavisniTroskovi, 0) AS zavisniTroskovi, ps.pdvStopa
    FROM primka_stavke ps
    JOIN primke pr ON pr.id = ps.primkaId
    LEFT JOIN products p ON p.id = ps.productId
    WHERE date(pr.datum) BETWEEN :od AND :do
    ORDER BY pr.datum, pr.id, ps.id
  `,
  nivelacije: `
    SELECT n.brojNivelacije, n.datum, p.sifra, p.naziv, ns.kolicina, ns.staraCijena, ns.novaCijena,
      ns.razlika, ns.ukupnaRazlika, ns.pdvStopa
    FROM nivelacija_stavke ns
    JOIN nivelacije n ON n.id = ns.nivelacijaId
    LEFT JOIN products p ON p.id = ns.productId
    WHERE date(n.datum) BETWEEN :od AND :do
    ORDER BY n.datum, n.id, ns.id
  `,
  kretanjaNovca: `
    SELECT c.createdAt, c.tip, c.iznos, u.ime AS korisnikIme, c.napomena, c.tringStatus
    FROM cash_movements c
    LEFT JOIN users u ON u.id = c.korisnikId
    WHERE date(c.createdAt) BETWEEN :od AND :do
    ORDER BY c.createdAt, c.id
  `,
  utrosak: `
    SELECT rn.id AS nalogId, rn.broj, rn.godina, rn.zavrsenAt, rn.opis, pp.naziv AS proizvod,
      m.sifra, m.naziv, m.jm, s.kolicina, s.nabavnaCijena,
      COALESCE((
        SELECT SUM(ps.kolicina * ps.nabavnaCijena * (1 - COALESCE(ps.rabat, 0) / 100.0) + COALESCE(ps.zavisniTroskovi, 0))
          / SUM(ps.kolicina)
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = s.materijalId AND date(pr.datum) <= date(rn.zavrsenAt)
        HAVING SUM(ps.kolicina) > 0
      ), 0) AS prosjecnaNabavna
    FROM radni_nalog_stavke s
    JOIN radni_nalozi rn ON rn.id = s.radniNalogId
    LEFT JOIN products m ON m.id = s.materijalId
    LEFT JOIN products pp ON pp.id = rn.productId
    WHERE rn.status IN ('zavrsen', 'fakturisan') AND date(rn.zavrsenAt) BETWEEN :od AND :do
    ORDER BY rn.zavrsenAt, rn.id, s.id
  `,
  zalihe: `
    SELECT p.sifra, p.naziv, p.jm, p.tip,
      COALESCE((
        SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
        FROM stock_movements sm
        WHERE sm.productId = p.id AND date(sm.createdAt) <= :do
      ), 0) AS kolicina,
      COALESCE(
        (SELECT ch.novaCijena FROM cijena_historija ch
          WHERE ch.productId = p.id AND date(ch.createdAt) <= :do ORDER BY ch.id DESC LIMIT 1),
        (SELECT ch.staraCijena FROM cijena_historija ch
          WHERE ch.productId = p.id AND date(ch.createdAt) > :do ORDER BY ch.id LIMIT 1),
        p.cijena
      ) AS cijena,
      COALESCE((
        SELECT SUM(ps.kolicina * ps.nabavnaCijena * (1 - COALESCE(ps.rabat, 0) / 100.0) + COALESCE(ps.zavisniTroskovi, 0))
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = p.id AND date(pr.datum) <= :do
      ), 0) AS nabavnaVrijednost,
      COALESCE((
        SELECT SUM(ps.kolicina)
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = p.id AND date(pr.datum) <= :do
      ), 0) AS nabavnaKolicina
    FROM products p
    WHERE p.tip IN ('artikal', 'materijal') AND p.slobodan = 0
    ORDER BY p.sifra
  `,
} as const;
```

- [ ] **Step 3: Dohvat podataka**

`src/lib/knjigovodja/podaci.ts`:

```ts
// Kanal izvoz:knjigovodja: rezultati upita iz upiti.ts za period od–do.
// Rust parnjak: src-tauri/backend/src/izvoz.rs.
import type { SqlDb } from '../sqldb';
import { UPITI } from './upiti';
import type { KnjigovodjaPodaci } from './tipovi';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export function dohvatiKnjigovodja(db: SqlDb, od: unknown, doDatum: unknown): KnjigovodjaPodaci {
  if (typeof od !== 'string' || typeof doDatum !== 'string' || !DATUM.test(od) || !DATUM.test(doDatum) || od > doDatum) {
    throw new Error('Neispravan period');
  }
  const vrijednosti = { od, do: doDatum };
  const out: Record<string, unknown> = { od, do: doDatum };
  for (const [ime, sql] of Object.entries(UPITI)) {
    // Samo parametri koje upit spominje — bun:sqlite (strict) ne voli višak.
    const p = Object.fromEntries(Object.entries(vrijednosti).filter(([k]) => sql.includes(`:${k}`)));
    out[ime] = db.prepare(sql).all(p);
  }
  return out as unknown as KnjigovodjaPodaci;
}
```

- [ ] **Step 4: Napiši ugovorni test (pada — kanal ne postoji)**

`src/ipc/ugovor/izvoz.ugovor.test.ts`:

```ts
// Ugovor za kanal izvoz:knjigovodja — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina 'Admin'
const SEP = ['2026-09-01', '2026-09-30'] as const;

function ins(sql: string, ...params: any[]): number {
  return Number(b.db.prepare(sql).run(...params).lastInsertRowid);
}

function artikal(sifra: string, cijena: number, opts: { pdvStopa?: string; tip?: string; slobodan?: number } = {}): number {
  return ins(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, slobodan) VALUES (?, ?, 'kom', ?, ?, ?, ?)",
    sifra, `Artikal ${sifra}`, cijena, opts.pdvStopa ?? 'E', opts.tip ?? 'artikal', opts.slobodan ?? 0,
  );
}

function racun(o: {
  createdAt: string; ukupno?: number; pdvIznos?: number; broj?: string | null; nacin?: string;
  refundedAt?: string | null; brojReklamacije?: string | null; prilogBroj?: number | null;
}): number {
  return ins(
    `INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, refundedAt, brojReklamacije, prilogBroj, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ADMIN, o.ukupno ?? 10, o.pdvIznos ?? 0, o.nacin ?? 'Gotovina', o.broj ?? null,
    o.refundedAt ? 'refunded' : 'completed', o.refundedAt ?? null, o.brojReklamacije ?? null, o.prilogBroj ?? null, o.createdAt,
  );
}

function primka(broj: string, datum: string): number {
  return ins("INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, brojFakture) VALUES (?, ?, 'Dobavljač', '4200000000000', 'F-1')", broj, datum);
}

function primkaStavka(primkaId: number, productId: number, kolicina: number, nabavnaCijena: number, extra: { rabat?: number; zavisni?: number; cijena?: number } = {}): void {
  ins(
    "INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, 'E')",
    primkaId, productId, kolicina, extra.cijena ?? 0, nabavnaCijena, extra.rabat ?? 0, extra.zavisni ?? 0,
  );
}

function kretanje(productId: number, tip: 'ulaz' | 'izlaz', kolicina: number, createdAt: string): void {
  ins("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, ?, ?, 'test', 0, ?)", productId, tip, kolicina, createdAt);
}

const izvoz = (od: string, doDatum: string) => b.call('izvoz:knjigovodja', od, doDatum);

describe('izvoz:knjigovodja', () => {
  test('računi po datumu prodaje, reklamacije po datumu reklamacije, granice uključive', async () => {
    racun({ createdAt: '2026-08-31 23:59:59', broj: '1' });
    const prvi = racun({ createdAt: '2026-09-01 00:00:00', broj: '2' });
    const zadnji = racun({ createdAt: '2026-09-30 23:59:59', broj: '3' });
    racun({ createdAt: '2026-10-01 00:00:00', broj: '4' });
    const stariReklamiran = racun({ createdAt: '2026-08-20 10:00:00', broj: '5', refundedAt: '2026-09-05 11:00:00', brojReklamacije: 'R-1' });
    const istiDan = racun({ createdAt: '2026-09-10 09:00:00', broj: '6', refundedAt: '2026-09-10 12:00:00', brojReklamacije: 'R-2' });

    const r = await izvoz(...SEP);
    expect(r.od).toBe('2026-09-01');
    expect(r.do).toBe('2026-09-30');
    expect(r.racuni.map((x: any) => x.id)).toEqual([prvi, istiDan, zadnji]);
    expect(r.reklamacije.map((x: any) => x.id)).toEqual([stariReklamiran, istiDan]);
    expect(r.racuni[0]).toEqual({
      id: prvi, createdAt: '2026-09-01 00:00:00', refundedAt: null, brojFiskalnogRacuna: '2', brojReklamacije: null,
      status: 'completed', ukupno: 10, pdvIznos: 0, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null,
      isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'Admin',
    });
  });

  test('stavke računa i priloga za prodane i reklamirane račune; rabat NULL je 0', async () => {
    const a = artikal('A', 11.7);
    const k = artikal('K', 5, { pdvStopa: 'K' });
    const van = racun({ createdAt: '2026-08-01 10:00:00' });
    const obican = racun({ createdAt: '2026-09-02 10:00:00' });
    const prilog = racun({ createdAt: '2026-09-03 10:00:00', prilogBroj: 7 });
    const reklamiran = racun({ createdAt: '2026-08-15 10:00:00', refundedAt: '2026-09-04 10:00:00' });
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 1, 0, ?)', van, a, 'E');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 2, 11.7, 10, ?)', obican, a, 'E');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, NULL, ?)', obican, k, 'K');
    ins('INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 3, 5, ?)', prilog, k, 'K');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 11.7, 0, ?)', reklamiran, a, 'E');

    const r = await izvoz(...SEP);
    expect(r.stavkeRacuna).toEqual([
      { orderId: obican, kolicina: 2, cijena: 11.7, rabat: 10, pdvStopa: 'E' },
      { orderId: obican, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: prilog, kolicina: 3, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: reklamiran, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' },
    ]);
  });

  test('primke, stavke primki i nivelacije po datumu dokumenta', async () => {
    const a = artikal('A', 10);
    primkaStavka(primka('U-0', '2026-08-31'), a, 1, 1);
    const u1 = primka('U-1', '2026-09-30');
    primkaStavka(u1, a, 10, 5, { rabat: 10, zavisni: 5, cijena: 10 });
    const n = ins("INSERT INTO nivelacije (brojNivelacije, datum) VALUES ('NIV-2026-001', '2026-09-15')");
    ins("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 4, 10, 12, 2, 8, 'E')", n, a);
    ins("INSERT INTO nivelacije (brojNivelacije, datum) VALUES ('NIV-2026-002', '2026-10-01')");

    const r = await izvoz(...SEP);
    expect(r.primke).toEqual([{ id: u1, brojPrimke: 'U-1', datum: '2026-09-30', dobavljacNaziv: 'Dobavljač', dobavljacId: '4200000000000', brojFakture: 'F-1' }]);
    expect(r.primkaStavke).toEqual([{
      primkaId: u1, sifra: 'A', naziv: 'Artikal A', jm: 'kom', kolicina: 10, cijena: 10, nabavnaCijena: 5, rabat: 10, zavisniTroskovi: 5, pdvStopa: 'E',
    }]);
    expect(r.nivelacije).toEqual([{
      brojNivelacije: 'NIV-2026-001', datum: '2026-09-15', sifra: 'A', naziv: 'Artikal A', kolicina: 4, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 8, pdvStopa: 'E',
    }]);
  });

  test('polog i povrat s imenom korisnika', async () => {
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('polog', 50, ?, 'ok', NULL, '2026-09-01 07:00:00')", ADMIN);
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('povrat', 20, ?, 'error', 'banka', '2026-09-30 20:00:00')", ADMIN);
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('polog', 50, ?, 'ok', NULL, '2026-10-01 07:00:00')", ADMIN);

    const r = await izvoz(...SEP);
    expect(r.kretanjaNovca).toEqual([
      { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'Admin', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-30 20:00:00', tip: 'povrat', iznos: 20, korisnikIme: 'Admin', napomena: 'banka', tringStatus: 'error' },
    ]);
  });

  test('utrošak: samo završeni nalozi u periodu; prosječna nabavna do dana završetka', async () => {
    const mat = artikal('M', 0, { tip: 'materijal' });
    const proizvod = artikal('P', 100);
    primkaStavka(primka('U-1', '2026-09-01'), mat, 10, 2);
    primkaStavka(primka('U-2', '2026-09-10'), mat, 10, 4);
    primkaStavka(primka('U-3', '2026-09-25'), mat, 10, 100);
    const nalog = (broj: number, status: string, zavrsenAt: string | null) => ins(
      "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, opis, productId, status, korisnikId, zavrsenAt) VALUES (?, 2026, '2026-09-01', 'zaliha', ?, ?, ?, ?, ?)",
      broj, `Nalog ${broj}`, proizvod, status, ADMIN, zavrsenAt,
    );
    const zamrznut = nalog(1, 'zavrsen', '2026-09-05 10:00:00');
    const bezCijene = nalog(2, 'fakturisan', '2026-09-20 10:00:00');
    const uIzradi = nalog(3, 'u_izradi', null);
    const kasni = nalog(4, 'zavrsen', '2026-10-02 10:00:00');
    for (const [n, cijena] of [[zamrznut, 7], [bezCijene, null], [uIzradi, 1], [kasni, 1]] as const) {
      ins('INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina, nabavnaCijena) VALUES (?, ?, 2, ?)', n, mat, cijena);
    }

    const r = await izvoz(...SEP);
    expect(r.utrosak).toEqual([
      { nalogId: zamrznut, broj: 1, godina: 2026, zavrsenAt: '2026-09-05 10:00:00', opis: 'Nalog 1', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: 7, prosjecnaNabavna: 2 },
      { nalogId: bezCijene, broj: 2, godina: 2026, zavrsenAt: '2026-09-20 10:00:00', opis: 'Nalog 2', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: null, prosjecnaNabavna: 3 },
    ]);
  });

  test('zalihe na kraju dana "do": kretanja, prodajna cijena tog dana, nabavna iz primki do tog dana', async () => {
    const a = artikal('A', 15);
    const bezPromjene = artikal('B', 9);
    artikal('S', 1, { tip: 'usluga' });
    artikal('F', 1, { slobodan: 1 });
    kretanje(a, 'ulaz', 10, '2026-09-01 08:00:00');
    kretanje(a, 'izlaz', 3, '2026-09-30 23:59:59');
    kretanje(a, 'izlaz', 5, '2026-10-01 00:00:00');
    primkaStavka(primka('U-1', '2026-09-01'), a, 10, 5, { rabat: 10, zavisni: 5 });
    primkaStavka(primka('U-2', '2026-10-01'), a, 10, 50);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 10, 12, '2026-09-10 10:00:00')", a);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 12, 15, '2026-10-05 10:00:00')", a);

    const r = await izvoz(...SEP);
    expect(r.zalihe.map((z: any) => z.sifra)).toEqual(['A', 'B']);
    expect(r.zalihe[0]).toMatchObject({ sifra: 'A', naziv: 'Artikal A', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12, nabavnaKolicina: 10 });
    expect(r.zalihe[0].nabavnaVrijednost).toBeCloseTo(50, 9);
    expect(r.zalihe[1]).toMatchObject({ sifra: 'B', kolicina: 0, cijena: 9, nabavnaVrijednost: 0, nabavnaKolicina: 0 });
    expect(bezPromjene).toBeGreaterThan(0);
  });

  test('cijena prije prve promjene je staraCijena te promjene', async () => {
    const a = artikal('A', 20);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 14, 20, '2026-10-05 10:00:00')", a);
    const r = await izvoz(...SEP);
    expect(r.zalihe[0].cijena).toBe(14);
  });

  test('prazan period vraća prazne liste', async () => {
    expect(await izvoz(...SEP)).toEqual({
      od: '2026-09-01', do: '2026-09-30', racuni: [], reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [],
      nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
    });
  });

  test('neispravan period je greška', async () => {
    await expect(izvoz('2026-09-30', '2026-09-01')).rejects.toThrow('Neispravan period');
    await expect(izvoz('2026-9-1', '2026-09-30')).rejects.toThrow('Neispravan period');
    await expect(b.call('izvoz:knjigovodja', null, '2026-09-30')).rejects.toThrow('Neispravan period');
    await expect(b.call('izvoz:knjigovodja')).rejects.toThrow('Neispravan period');
  });
});
```

- [ ] **Step 5: Pokreni test — mora pasti**

Run: `bun test src/ipc/ugovor/izvoz.ugovor.test.ts`
Expected: FAIL (kanal nije registrovan — `izvoz:knjigovodja` nema handler).

- [ ] **Step 6: Registruj kanal i API**

`src/ipc/handlers.ts` — import uz ostale lib importe:

```ts
import { dohvatiKnjigovodja } from '../lib/knjigovodja/podaci';
```

odmah poslije `handle('report:getData', …)` bloka:

```ts
  // Izvoz za knjigovođu: sirovi redovi za period, obračun je u rendereru.
  handle('izvoz:knjigovodja', (od: string, doDatum: string) => dohvatiKnjigovodja(db, od, doDatum));
```

`src/ipc/api.ts` poslije `getReportData`:

```ts
    izvozKnjigovodja: (od: string, doDatum: string) => pozovi('izvoz:knjigovodja', od, doDatum),
```

`src/global.d.ts` poslije `getReportData`:

```ts
    izvozKnjigovodja: (od: string, doDatum: string) => Promise<import('./lib/knjigovodja/tipovi').KnjigovodjaPodaci>;
```

i promijeni potpis `writeFile` (api.ts ga već tako prima):

```ts
    writeFile: (path: string, buffer: ArrayLike<number>) => Promise<any>;
```

- [ ] **Step 7: Pokreni test — mora proći**

Run: `bun test src/ipc/ugovor/izvoz.ugovor.test.ts`
Expected: PASS (9 testova). Zatim `bunx tsc --noEmit -p .` → bez novih grešaka u dirnutim fajlovima.

- [ ] **Step 8: Provjeri pravi better-sqlite3 (imenovani parametri)**

Napiši u scratchpad `p.cjs` koji `require`-a `better-sqlite3` iz glavnog repoa (`/Users/tarik/Documents/development/kasa-app/node_modules/better-sqlite3`, jer je tamo build za Electron), otvori `:memory:`, izvrši `schema` tekst iz `src/database/schema.ts` (uzmi između prva dva backticka) i pozovi svaki upit iz `UPITI` s objektom parametara filtriranim kao u `podaci.ts`. Pokreni s `ELECTRON_RUN_AS_NODE=1 /Users/tarik/Documents/development/kasa-app/node_modules/.bin/electron p.cjs`. Expected: nijedan izuzetak. (Upite iz TS fajla najlakše je prvo izvesti u JSON: `bun -e "import {UPITI} from './src/lib/knjigovodja/upiti'; await Bun.write('<scratchpad>/upiti.json', JSON.stringify(UPITI))"`.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/knjigovodja src/ipc/handlers.ts src/ipc/api.ts src/global.d.ts src/ipc/ugovor/izvoz.ugovor.test.ts
git commit -m "feat(izvoz): kanal izvoz:knjigovodja sa sirovim podacima za period"
```

---

### Task 2: Kanal u Rust backendu + poređenje na stvarnoj bazi

**Files:**
- Create: `src-tauri/backend/src/izvoz.rs`
- Modify: `src-tauri/backend/src/lib.rs` (`pub mod izvoz;` u listi domena)
- Modify: `src-tauri/backend/src/kanali.rs` (use + krak `"izvoz"`)
- Modify: `src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts` (poziv u `pozivi()`)

**Interfaces:**
- Consumes: `src/lib/knjigovodja/upiti.ts` (tekst), ugovorni test iz Task 1.
- Produces: isti odgovor kanala kao TS.

- [ ] **Step 1: Pokreni ugovorni test nad Rustom — mora pasti**

Run: `bun run test:rust 2>&1 | grep -E "izvoz|pass|fail" | tail -20`
Expected: testovi iz `izvoz.ugovor.test.ts` padaju s `Kanal ne postoji: izvoz:knjigovodja`.

- [ ] **Step 2: Modul `izvoz.rs`**

```rust
//! Kanal `izvoz:knjigovodja` (handlers.ts → `lib/knjigovodja/podaci.ts`):
//! sirovi redovi za izvoz knjigovođi. SQL se ne prepisuje — čita se iz
//! `src/lib/knjigovodja/upiti.ts`, pa su upiti isti u oba backenda.

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::greska::R;
use crate::sql::Db;
use crate::{baci, Args, Backend};

const UPITI_TS: &str = include_str!("../../../src/lib/knjigovodja/upiti.ts");

/// (ime, sql) redom iz `UPITI`: tekst između backtickova je SQL, a ime je
/// identifikator ispred `:` neposredno prije njega.
fn upiti() -> &'static [(String, String)] {
    static U: OnceLock<Vec<(String, String)>> = OnceLock::new();
    U.get_or_init(|| {
        let dijelovi: Vec<&str> = UPITI_TS.split('`').collect();
        (1..dijelovi.len())
            .step_by(2)
            .map(|i| {
                let prije = dijelovi[i - 1].trim_end().trim_end_matches(':').trim_end();
                let ime: String = prije
                    .chars()
                    .rev()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                (ime, dijelovi[i].to_string())
            })
            .collect()
    })
}

/// `YYYY-MM-DD` (samo oblik, kao regex u podaci.ts).
fn datum(v: &Value) -> Option<&str> {
    let s = v.as_str()?;
    let b = s.as_bytes();
    let ok = b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
    ok.then_some(s)
}

/// Parametri `:od`/`:do` pozicijski, redom kojim se prvi put javljaju u upitu
/// (SQLite im tim redom dodjeljuje indekse).
fn parametri(sql: &str, od: &str, do_: &str) -> Vec<Value> {
    let mut p: Vec<(usize, &str)> = [(":od", od), (":do", do_)]
        .into_iter()
        .filter_map(|(ime, v)| sql.find(ime).map(|i| (i, v)))
        .collect();
    p.sort();
    p.into_iter().map(|(_, v)| Value::from(v)).collect()
}

fn knjigovodja(db: &Db, od: &Value, do_: &Value) -> R<Value> {
    let (Some(od), Some(do_)) = (datum(od), datum(do_)) else {
        baci!("Neispravan period");
    };
    if od > do_ {
        baci!("Neispravan period");
    }
    let mut out = Map::new();
    out.insert("od".into(), od.into());
    out.insert("do".into(), do_.into());
    for (ime, sql) in upiti() {
        out.insert(ime.clone(), Value::from(db.all(sql, &parametri(sql, od, do_))?));
    }
    Ok(Value::Object(out))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "izvoz:knjigovodja" => knjigovodja(db, &a[0], &a[1]),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upiti_iz_ts_fajla() {
        let imena: Vec<&str> = upiti().iter().map(|(i, _)| i.as_str()).collect();
        assert_eq!(
            imena,
            ["racuni", "reklamacije", "stavkeRacuna", "primke", "primkaStavke", "nivelacije", "kretanjaNovca", "utrosak", "zalihe"]
        );
        assert!(upiti().iter().all(|(_, sql)| sql.contains("SELECT")));
    }

    #[test]
    fn parametri_redom_pojavljivanja() {
        assert_eq!(parametri("a :od b :do c :od", "x", "y"), vec![Value::from("x"), Value::from("y")]);
        assert_eq!(parametri("a :do", "x", "y"), vec![Value::from("y")]);
    }

    #[test]
    fn oblik_datuma() {
        assert_eq!(datum(&Value::from("2026-09-01")), Some("2026-09-01"));
        assert_eq!(datum(&Value::from("2026-9-01")), None);
        assert_eq!(datum(&Value::Null), None);
    }
}
```

- [ ] **Step 3: Registruj modul**

`src-tauri/backend/src/lib.rs` — u listi domena poslije `pub mod uredjaj;`:

```rust
pub mod izvoz;
```

`src-tauri/backend/src/kanali.rs` — dodaj `izvoz` u `use crate::{…}` i krak prije `_ => None`:

```rust
        "izvoz" => izvoz::obradi(b, kanal, a),
```

- [ ] **Step 4: Rust unit testovi i ugovor nad Rustom**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend izvoz`
Expected: 3 passed.

Run: `bun run test:rust 2>&1 | tail -5`
Expected: svi testovi prolaze (uključujući 9 iz `izvoz.ugovor.test.ts`), 0 fail.

- [ ] **Step 5: Poređenje na stvarnoj bazi**

U `src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts`, u niz `p` u `pozivi()` iza dva `report:getData` poziva dodaj:

```ts
      ['izvoz:knjigovodja', '2000-01-01', '2100-12-31'], ['izvoz:knjigovodja', '2026-09-01', '2026-09-30'],
```

Run: `bun test src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts`
Expected: PASS ili `skip` ako na mašini nema stvarne baze / Rust binarnog — prepiši šta je ispisano.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/backend/src/izvoz.rs src-tauri/backend/src/lib.rs src-tauri/backend/src/kanali.rs src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts
git commit -m "feat(izvoz): izvoz:knjigovodja u Rust backendu, isti SQL iz upiti.ts"
```

---

### Task 3: Period i ime fajla

**Files:**
- Create: `src/lib/knjigovodja/period.ts`
- Test: `src/lib/knjigovodja/period.test.ts`

**Interfaces:**
- Produces:
  - `MJESECI: readonly string[]` (12 naziva)
  - `interface Period { od: string; do: string }`
  - `periodMjeseca(godina: number, mjesec: number): Period` (mjesec 1–12)
  - `prosliMjesec(danas: Date): { godina: number; mjesec: number }`
  - `mjesecPerioda(p: Period): { godina: number; mjesec: number } | null`
  - `prikazPerioda(p: Period): string` (`'Septembar 2026'` ili `'01.09.2026. – 15.09.2026.'`)
  - `prikazDatuma(iso: string): string` (`'2026-09-01'` ili `'2026-09-01 10:00:00'` → `'01.09.2026.'`)
  - `imeFajla(nazivFirme: string, p: Period): string` (bez ekstenzije)

- [ ] **Step 1: Test (pada — modul ne postoji)**

`src/lib/knjigovodja/period.test.ts`:

```ts
import { test, expect } from 'bun:test';
import { periodMjeseca, prosliMjesec, mjesecPerioda, prikazPerioda, prikazDatuma, imeFajla, MJESECI } from './period';

test('period mjeseca uključuje zadnji dan, i u prestupnoj godini', () => {
  expect(periodMjeseca(2026, 9)).toEqual({ od: '2026-09-01', do: '2026-09-30' });
  expect(periodMjeseca(2024, 2)).toEqual({ od: '2024-02-01', do: '2024-02-29' });
  expect(periodMjeseca(2026, 2)).toEqual({ od: '2026-02-01', do: '2026-02-28' });
  expect(periodMjeseca(2026, 12)).toEqual({ od: '2026-12-01', do: '2026-12-31' });
});

test('prošli mjesec prelazi granicu godine', () => {
  expect(prosliMjesec(new Date(2026, 8, 25))).toEqual({ godina: 2026, mjesec: 8 });
  expect(prosliMjesec(new Date(2026, 0, 3))).toEqual({ godina: 2025, mjesec: 12 });
});

test('cijeli mjesec se prepoznaje, dio mjeseca ne', () => {
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-09-30' })).toEqual({ godina: 2026, mjesec: 9 });
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-09-29' })).toBeNull();
  expect(mjesecPerioda({ od: '2026-09-01', do: '2026-10-31' })).toBeNull();
});

test('prikaz perioda i datuma', () => {
  expect(MJESECI).toHaveLength(12);
  expect(prikazPerioda({ od: '2026-09-01', do: '2026-09-30' })).toBe('Septembar 2026');
  expect(prikazPerioda({ od: '2026-09-01', do: '2026-09-15' })).toBe('01.09.2026. – 15.09.2026.');
  expect(prikazPerioda({ od: '2026-09-05', do: '2026-09-05' })).toBe('05.09.2026.');
  expect(prikazDatuma('2026-09-01 10:00:00')).toBe('01.09.2026.');
});

test('ime fajla: ASCII, bez nedozvoljenih znakova, mjesec ili raspon', () => {
  expect(imeFajla('Čaplja d.o.o.', { od: '2026-09-01', do: '2026-09-30' })).toBe('Knjigovodja_Caplja_d.o.o_2026-09');
  expect(imeFajla('A/B: "Đak" <x>|?*', { od: '2026-09-01', do: '2026-09-15' })).toBe('Knjigovodja_AB_Dak_x_2026-09-01_2026-09-15');
  expect(imeFajla('   ', { od: '2026-09-01', do: '2026-09-30' })).toBe('Knjigovodja_2026-09');
});
```

- [ ] **Step 2: Run** — `bun test src/lib/knjigovodja/period.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 3: Implementacija**

`src/lib/knjigovodja/period.ts`:

```ts
// Period izvoza za knjigovođu: cijeli mjesec ili od–do (lokalni YYYY-MM-DD,
// uključivo) i ime fajla izvoza.

export const MJESECI = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar',
] as const;

export interface Period {
  od: string;
  do: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function periodMjeseca(godina: number, mjesec: number): Period {
  const zadnji = new Date(godina, mjesec, 0).getDate();
  return { od: `${godina}-${pad(mjesec)}-01`, do: `${godina}-${pad(mjesec)}-${pad(zadnji)}` };
}

export function prosliMjesec(danas: Date): { godina: number; mjesec: number } {
  const m = danas.getMonth(); // 0 = januar → prošli je decembar prošle godine
  return m === 0 ? { godina: danas.getFullYear() - 1, mjesec: 12 } : { godina: danas.getFullYear(), mjesec: m };
}

/** Period koji pokriva tačno jedan kalendarski mjesec; inače null. */
export function mjesecPerioda(p: Period): { godina: number; mjesec: number } | null {
  const [g, m] = p.od.split('-').map(Number);
  const cijeli = periodMjeseca(g, m);
  return cijeli.od === p.od && cijeli.do === p.do ? { godina: g, mjesec: m } : null;
}

export function prikazDatuma(iso: string): string {
  const [g, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${g}.`;
}

export function prikazPerioda(p: Period): string {
  const mj = mjesecPerioda(p);
  if (mj) return `${MJESECI[mj.mjesec - 1]} ${mj.godina}`;
  if (p.od === p.do) return prikazDatuma(p.od);
  return `${prikazDatuma(p.od)} – ${prikazDatuma(p.do)}`;
}

/** ASCII bez dijakritike i znakova koje Windows/mail ne vole; razmaci → _. */
function ocisti(s: string): string {
  return s
    .replace(/[đĐ]/g, c => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[._]+$/, '');
}

export function imeFajla(nazivFirme: string, p: Period): string {
  const mj = mjesecPerioda(p);
  const oznaka = mj ? `${mj.godina}-${pad(mj.mjesec)}` : `${p.od}_${p.do}`;
  const firma = ocisti(nazivFirme);
  return ['Knjigovodja', firma, oznaka].filter(Boolean).join('_');
}
```

- [ ] **Step 4: Run** — `bun test src/lib/knjigovodja/period.test.ts` → PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/knjigovodja/period.ts src/lib/knjigovodja/period.test.ts
git commit -m "feat(izvoz): period izvoza i ime fajla"
```

---

### Task 4: Obračun izvještaja

**Files:**
- Create: `src/lib/knjigovodja/obracun.ts`
- Test: `src/lib/knjigovodja/obracun.test.ts`

**Interfaces:**
- Consumes: tipovi iz Task 1; `iznosStavke` (`src/lib/racun.ts`), `fakturnaVrijednost`, `rabatIznos`, `nabavnaVrijednost`, `pdvStopaPct` (`src/lib/kalkulacija.ts`), `parseFiskalniBroj`, `izracunajPraznine`, `MAX_PRAZNINA` (`src/lib/fiskalni.ts`), `round2` (`src/lib/novac.ts`), `prikazDatuma` (Task 3).
- Produces: `obracunaj(p: KnjigovodjaPodaci, opcije: { moduli: Moduli; odbacenePraznine?: number[] }): KnjigovodjaIzvjestaj`, `raspodjelaPlacanja(nacin: string, ukupno: number)`, i svi tipovi redova ispod (Excel, PDF i tab ih koriste po imenu).

- [ ] **Step 1: Test (pada)**

`src/lib/knjigovodja/obracun.test.ts`:

```ts
import { test, expect, describe } from 'bun:test';
import { obracunaj, raspodjelaPlacanja } from './obracun';
import type { KnjigovodjaPodaci, IzvozRacun } from './tipovi';

const SVI = { skladiste: true, proizvodnja: true };

function prazno(): KnjigovodjaPodaci {
  return {
    od: '2026-09-01', do: '2026-09-30', racuni: [], reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [],
    nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
  };
}

function racun(id: number, o: Partial<IzvozRacun> = {}): IzvozRacun {
  return {
    id, createdAt: '2026-09-02 10:00:00', refundedAt: null, brojFiskalnogRacuna: String(id), brojReklamacije: null,
    status: 'completed', ukupno: 11.7, pdvIznos: 1.7, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null,
    isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'Admin', ...o,
  };
}

describe('raspodjelaPlacanja', () => {
  test('tekst nosi cijeli iznos', () => {
    expect(raspodjelaPlacanja('Kartica', 30)).toEqual({ iznosi: { gotovina: 0, kartica: 30, virman: 0, cek: 0 }, opis: 'Kartica', poznat: true });
    expect(raspodjelaPlacanja('Ček', 5).iznosi.cek).toBe(5);
  });
  test('JSON je podijeljeno plaćanje', () => {
    expect(raspodjelaPlacanja(JSON.stringify({ gotovina: 20, kartica: 30 }), 50)).toEqual({
      iznosi: { gotovina: 20, kartica: 30, virman: 0, cek: 0 }, opis: 'Gotovina 20,00 + Kartica 30,00', poznat: true,
    });
  });
  test('nepoznat oblik ide u gotovinu i nije poznat', () => {
    expect(raspodjelaPlacanja('Bitcoin', 10)).toEqual({ iznosi: { gotovina: 10, kartica: 0, virman: 0, cek: 0 }, opis: 'Bitcoin', poznat: false });
    expect(raspodjelaPlacanja('{"zlato": 10}', 10).poznat).toBe(false);
  });
});

describe('obracunaj', () => {
  test('prazan period: nule i bez upozorenja', () => {
    const r = obracunaj(prazno(), { moduli: SVI });
    expect(r.kif).toEqual([]);
    expect(r.dani).toEqual([]);
    expect(r.zbir.promet).toEqual({ osnovicaE: 0, pdvE: 0, iznosK: 0, ukupno: 0, gotovina: 0, kartica: 0, virman: 0, cek: 0, brojRacuna: 0 });
    expect(r.zbir.neto).toBe(0);
    expect(r.upozorenja).toEqual([]);
  });

  test('KIF: ukupno i PDV iz računa, iznos K iz stavki, osnovica E ostatak', () => {
    const p = prazno();
    p.racuni = [racun(1, { ukupno: 26.7, pdvIznos: 1.7, nacinPlacanja: JSON.stringify({ gotovina: 6.7, kartica: 20 }), kupacNaziv: 'Kupac', kupacIdBroj: '4200000000001', isManual: 1 })];
    p.stavkeRacuna = [
      { orderId: 1, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' },
      { orderId: 1, kolicina: 3, cijena: 5, rabat: 0, pdvStopa: 'K' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif).toEqual([{
      id: 1, datum: '2026-09-02 10:00:00', fiskalniBroj: '1', kupac: 'Kupac', jib: '4200000000001',
      osnovicaE: 10, pdvE: 1.7, iznosK: 15, ukupno: 26.7,
      placanje: 'Gotovina 6,70 + Kartica 20,00', datumValute: null, oznaka: 'ručni',
    }]);
    expect(r.dani).toEqual([{
      datum: '2026-09-02', brojRacuna: 1, osnovicaE: 10, pdvE: 1.7, iznosK: 15, ukupno: 26.7,
      gotovina: 6.7, kartica: 20, virman: 0, cek: 0, reklamacije: 0, neto: 26.7,
    }]);
    expect(r.upozorenja).toEqual([]);
  });

  test('račun po prilogu bez stavki je sav na stopi E', () => {
    const p = prazno();
    p.racuni = [racun(1, { prilogBroj: 7 })];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif[0]).toMatchObject({ osnovicaE: 10, pdvE: 1.7, iznosK: 0, ukupno: 11.7, oznaka: 'prilog 7' });
  });

  test('odstupanje stavki od ukupnog i nepoznato plaćanje idu u Kontrolu', () => {
    const p = prazno();
    p.racuni = [racun(1, { nacinPlacanja: 'Bitcoin' })];
    p.stavkeRacuna = [{ orderId: 1, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif[0].ukupno).toBe(11.7);
    expect(r.upozorenja.map(u => u.vrsta)).toEqual(['odstupanje', 'placanje']);
  });

  test('reklamacije su negativne, u danu reklamacije, i umanjuju neto', () => {
    const p = prazno();
    p.racuni = [racun(1)];
    p.reklamacije = [racun(9, { createdAt: '2026-08-20 10:00:00', refundedAt: '2026-09-02 12:00:00', brojReklamacije: 'R-1', status: 'refunded', brojFiskalnogRacuna: '9' })];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.reklamacije).toEqual([{
      id: 9, datum: '2026-09-02 12:00:00', brojReklamacije: 'R-1', fiskalniBroj: '9', datumOriginala: '2026-08-20 10:00:00',
      kupac: '', osnovicaE: -10, pdvE: -1.7, iznosK: 0, ukupno: -11.7, placanje: 'Gotovina',
    }]);
    expect(r.dani[0]).toMatchObject({ datum: '2026-09-02', ukupno: 11.7, reklamacije: -11.7, neto: 0 });
    expect(r.zbir.reklamacije).toMatchObject({ broj: 1, ukupno: -11.7 });
    expect(r.zbir.neto).toBe(0);
  });

  test('rupe u fiskalnoj numeraciji (bez odbačenih) i računi bez broja', () => {
    const p = prazno();
    p.racuni = [racun(1, { brojFiskalnogRacuna: '10' }), racun(2, { brojFiskalnogRacuna: '14' }), racun(3, { brojFiskalnogRacuna: null })];
    const r = obracunaj(p, { moduli: SVI, odbacenePraznine: [12] });
    expect(r.upozorenja.filter(u => u.vrsta === 'praznina').map(u => u.opis)).toEqual([
      'Nedostaje fiskalni račun br. 11', 'Nedostaje fiskalni račun br. 13',
    ]);
    expect(r.upozorenja.filter(u => u.vrsta === 'bezBroja')).toHaveLength(1);
  });

  test('KUF i stavke ulaza preko kalkulacije', () => {
    const p = prazno();
    p.primke = [{ id: 1, brojPrimke: 'U-1', datum: '2026-09-05', dobavljacNaziv: 'Dob', dobavljacId: '42', brojFakture: 'F-1' }];
    p.primkaStavke = [
      { primkaId: 1, sifra: 'A', naziv: 'Art', jm: 'kom', kolicina: 10, cijena: 11.7, nabavnaCijena: 5, rabat: 10, zavisniTroskovi: 5, pdvStopa: 'E' },
      { primkaId: 1, sifra: null, naziv: null, jm: null, kolicina: 2, cijena: 0, nabavnaCijena: 10, rabat: 0, zavisniTroskovi: 0, pdvStopa: 'E' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    // fakturna 50+20; rabat 5; zavisni 5; nabavna 50+20; PDV 17% na (fakturna − rabat) = 65 × 0,17
    // prodajna 117; RUC samo za stavke s prodajnom: 117/1,17 − 50 = 50
    expect(r.kuf).toEqual([{
      datum: '2026-09-05', brojPrimke: 'U-1', dobavljac: 'Dob', dobavljacId: '42', brojFakture: 'F-1',
      fakturna: 70, rabat: 5, zavisni: 5, nabavna: 70, pdv: 11.05, prodajna: 117, ruc: 50,
    }]);
    expect(r.ulazStavke[0]).toMatchObject({ brojPrimke: 'U-1', sifra: 'A', nabavnaCijena: 5, prodajnaCijena: 11.7 });
    expect(r.ulazStavke[1]).toMatchObject({ sifra: '—', naziv: '—', jm: '' });
    expect(r.zbir.ulaz).toEqual({ brojPrimki: 1, nabavna: 70, pdv: 11.05, prodajna: 117 });
  });

  test('utrošak: zamrznuta cijena ili prosječna; zbir po materijalu', () => {
    const p = prazno();
    const u = { broj: 1, godina: 2026, zavrsenAt: '2026-09-05 10:00:00', opis: 'N', proizvod: 'P', sifra: 'M', naziv: 'Mat', jm: 'm', kolicina: 2 };
    p.utrosak = [
      { nalogId: 1, ...u, nabavnaCijena: 7, prosjecnaNabavna: 2 },
      { nalogId: 2, ...u, broj: 2, nabavnaCijena: null, prosjecnaNabavna: 3 },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.utrosak.map(x => [x.nalog, x.nabavnaCijena, x.vrijednost])).toEqual([['1/2026', 7, 14], ['2/2026', 3, 6]]);
    expect(r.utrosakZbir).toEqual([{ sifra: 'M', naziv: 'Mat', jm: 'm', kolicina: 4, vrijednost: 20 }]);
    expect(r.zbir.utrosak).toEqual({ brojNaloga: 2, vrijednost: 20 });
  });

  test('zalihe: bez nula, minus u Kontroli i van zbira, materijal samo s proizvodnjom', () => {
    const p = prazno();
    p.zalihe = [
      { sifra: 'A', naziv: 'Art', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12, nabavnaVrijednost: 50, nabavnaKolicina: 10 },
      { sifra: 'B', naziv: 'Nula', jm: 'kom', tip: 'artikal', kolicina: 0, cijena: 9, nabavnaVrijednost: 0, nabavnaKolicina: 0 },
      { sifra: 'C', naziv: 'Minus', jm: 'kom', tip: 'artikal', kolicina: -2, cijena: 5, nabavnaVrijednost: 0, nabavnaKolicina: 0 },
      { sifra: 'M', naziv: 'Mat', jm: 'm', tip: 'materijal', kolicina: 3, cijena: 0, nabavnaVrijednost: 6, nabavnaKolicina: 3 },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.zalihe.map(z => z.sifra)).toEqual(['A', 'C', 'M']);
    expect(r.zalihe[0]).toEqual({ sifra: 'A', naziv: 'Art', jm: 'kom', tip: 'artikal', kolicina: 7, prosjecnaNabavna: 5, nabavnaVrijednost: 35, prodajnaCijena: 12, prodajnaVrijednost: 84 });
    expect(r.zbir.zalihe).toEqual({ nabavna: 41, prodajna: 84 });
    expect(r.upozorenja.map(u => u.vrsta)).toEqual(['minus']);

    const bezProizvodnje = obracunaj(p, { moduli: { skladiste: true, proizvodnja: false } });
    expect(bezProizvodnje.zalihe.map(z => z.sifra)).toEqual(['A', 'C']);
  });

  test('isključeni moduli daju prazne listove i nule', () => {
    const p = prazno();
    p.primke = [{ id: 1, brojPrimke: 'U-1', datum: '2026-09-05', dobavljacNaziv: null, dobavljacId: null, brojFakture: null }];
    p.nivelacije = [{ brojNivelacije: 'N', datum: '2026-09-05', sifra: 'A', naziv: 'A', kolicina: 1, staraCijena: 1, novaCijena: 2, razlika: 1, ukupnaRazlika: 1, pdvStopa: 'E' }];
    p.utrosak = [{ nalogId: 1, broj: 1, godina: 2026, zavrsenAt: '2026-09-05', opis: '', proizvod: null, sifra: 'M', naziv: 'M', jm: 'm', kolicina: 1, nabavnaCijena: 1, prosjecnaNabavna: 1 }];
    p.zalihe = [{ sifra: 'A', naziv: 'A', jm: 'kom', tip: 'artikal', kolicina: -1, cijena: 1, nabavnaVrijednost: 0, nabavnaKolicina: 0 }];
    const r = obracunaj(p, { moduli: { skladiste: false, proizvodnja: false } });
    expect([r.kuf, r.ulazStavke, r.nivelacije, r.zalihe, r.utrosak, r.utrosakZbir]).toEqual([[], [], [], [], [], []]);
    expect(r.zbir.ulaz.brojPrimki).toBe(0);
    expect(r.zbir.nivelacijeRazlika).toBe(0);
    expect(r.upozorenja).toEqual([]);
  });

  test('polog i povrat se sabiraju odvojeno', () => {
    const p = prazno();
    p.kretanjaNovca = [
      { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-01 20:00:00', tip: 'povrat', iznos: 20.1, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-02 07:00:00', tip: 'polog', iznos: 50.2, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect([r.zbir.polozi, r.zbir.povrati]).toEqual([100.2, 20.1]);
  });
});
```

- [ ] **Step 2: Run** — `bun test src/lib/knjigovodja/obracun.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 3: Implementacija**

`src/lib/knjigovodja/obracun.ts`:

```ts
// Izvještaj za knjigovođu: sirovi podaci kanala izvoz:knjigovodja → redovi i
// zbirovi. Jedini izvor brojeva za Excel, PDF i pregled na ekranu. Pravila su
// u specu (docs/superpowers/specs/2026-09-25-izvoz-knjigovodja-design.md, §2).
import { round2 } from '../novac';
import { iznosStavke } from '../racun';
import { fakturnaVrijednost, rabatIznos, nabavnaVrijednost, pdvStopaPct } from '../kalkulacija';
import { parseFiskalniBroj, izracunajPraznine, MAX_PRAZNINA } from '../fiskalni';
import { prikazDatuma } from './period';
import type {
  KnjigovodjaPodaci, IzvozRacun, IzvozStavkaRacuna, IzvozNivelacijaStavka, IzvozKretanjeNovca,
} from './tipovi';

export interface Moduli {
  skladiste: boolean;
  proizvodnja: boolean;
}

export interface Stope {
  osnovicaE: number;
  pdvE: number;
  iznosK: number;
  ukupno: number;
}

export interface Placanja {
  gotovina: number;
  kartica: number;
  virman: number;
  cek: number;
}

export interface KifRed extends Stope {
  id: number;
  datum: string;
  fiskalniBroj: string;
  kupac: string;
  jib: string;
  placanje: string;
  datumValute: string | null;
  oznaka: string;
}

export interface ReklamacijaRed extends Stope {
  id: number;
  datum: string;
  brojReklamacije: string;
  fiskalniBroj: string;
  datumOriginala: string;
  kupac: string;
  placanje: string;
}

export interface DanRed extends Stope, Placanja {
  datum: string;
  brojRacuna: number;
  reklamacije: number;
  neto: number;
}

export interface KufRed {
  datum: string;
  brojPrimke: string;
  dobavljac: string;
  dobavljacId: string;
  brojFakture: string;
  fakturna: number;
  rabat: number;
  zavisni: number;
  nabavna: number;
  pdv: number;
  prodajna: number;
  ruc: number;
}

export interface UlazStavkaRed {
  brojPrimke: string;
  datum: string;
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  fakturnaCijena: number;
  rabat: number;
  zavisni: number;
  nabavnaCijena: number;
  prodajnaCijena: number;
  pdvStopa: string;
}

export interface UtrosakRed {
  nalog: string;
  zavrsen: string;
  opis: string;
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  nabavnaCijena: number;
  vrijednost: number;
}

export interface UtrosakZbir {
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  vrijednost: number;
}

export interface ZalihaRed {
  sifra: string;
  naziv: string;
  jm: string;
  tip: string;
  kolicina: number;
  prosjecnaNabavna: number;
  nabavnaVrijednost: number;
  prodajnaCijena: number;
  prodajnaVrijednost: number;
}

export type VrstaUpozorenja = 'praznina' | 'bezBroja' | 'odstupanje' | 'placanje' | 'minus';

export interface Upozorenje {
  vrsta: VrstaUpozorenja;
  opis: string;
}

export interface Zbir {
  promet: Stope & Placanja & { brojRacuna: number };
  reklamacije: Stope & { broj: number };
  neto: number;
  ulaz: { brojPrimki: number; nabavna: number; pdv: number; prodajna: number };
  nivelacijeRazlika: number;
  polozi: number;
  povrati: number;
  utrosak: { brojNaloga: number; vrijednost: number };
  zalihe: { nabavna: number; prodajna: number };
}

export interface KnjigovodjaIzvjestaj {
  od: string;
  do: string;
  moduli: Moduli;
  dani: DanRed[];
  kif: KifRed[];
  reklamacije: ReklamacijaRed[];
  kuf: KufRed[];
  ulazStavke: UlazStavkaRed[];
  nivelacije: IzvozNivelacijaStavka[];
  kretanjaNovca: IzvozKretanjeNovca[];
  utrosak: UtrosakRed[];
  utrosakZbir: UtrosakZbir[];
  zalihe: ZalihaRed[];
  upozorenja: Upozorenje[];
  zbir: Zbir;
}

const km = (n: number) => n.toFixed(2).replace('.', ',');
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const crtica = (s: string | null | undefined) => (s && s.trim() ? s : '—');

// ── plaćanje ─────────────────────────────────────────────

const VRSTE: Record<string, keyof Placanja> = { gotovina: 'gotovina', kartica: 'kartica', virman: 'virman', cek: 'cek', 'ček': 'cek' };
const NAZIV_VRSTE: Record<keyof Placanja, string> = { gotovina: 'Gotovina', kartica: 'Kartica', virman: 'Virman', cek: 'Ček' };
const nulaPlacanja = (): Placanja => ({ gotovina: 0, kartica: 0, virman: 0, cek: 0 });

/**
 * Način plaćanja → iznosi po vrsti. Tekst ('Kartica') nosi cijeli iznos,
 * JSON ({gotovina, kartica…}) je podijeljeno plaćanje (kao `gotovinskiIznos`
 * u drawer.ts). Nepoznat oblik: sve u gotovinu, `poznat: false` (Kontrola).
 */
export function raspodjelaPlacanja(nacin: string, ukupno: number): { iznosi: Placanja; opis: string; poznat: boolean } {
  const tekst = VRSTE[nacin.trim().toLowerCase()];
  if (tekst) return { iznosi: { ...nulaPlacanja(), [tekst]: ukupno }, opis: NAZIV_VRSTE[tekst], poznat: true };

  let json: unknown = null;
  try { json = JSON.parse(nacin); } catch { /* nije JSON */ }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const iznosi = nulaPlacanja();
    const opis: string[] = [];
    let poznat = true;
    for (const [k, v] of Object.entries(json)) {
      const vrsta = VRSTE[k.toLowerCase()];
      if (!vrsta || typeof v !== 'number') { poznat = false; break; }
      if (v === 0) continue;
      iznosi[vrsta] = round2(iznosi[vrsta] + v);
      opis.push(`${NAZIV_VRSTE[vrsta]} ${km(v)}`);
    }
    if (poznat && opis.length) return { iznosi, opis: opis.join(' + '), poznat };
  }
  return { iznosi: { ...nulaPlacanja(), gotovina: ukupno }, opis: nacin, poznat: false };
}

// ── računi ───────────────────────────────────────────────

/** Ukupno i PDV su fiskalizovani iznosi računa; stavke samo izdvajaju stopu K. */
function stopeRacuna(r: IzvozRacun, stavke: IzvozStavkaRacuna[]): { stope: Stope; odstupanje: number } {
  const ukupno = round2(r.ukupno);
  const pdvE = round2(r.pdvIznos);
  const iznosK = round2(stavke.filter(s => s.pdvStopa !== 'E').reduce((a, s) => a + iznosStavke(s), 0));
  const zbirStavki = stavke.length ? round2(stavke.reduce((a, s) => a + iznosStavke(s), 0)) : ukupno;
  return { stope: { osnovicaE: round2(ukupno - iznosK - pdvE), pdvE, iznosK, ukupno }, odstupanje: round2(ukupno - zbirStavki) };
}

// 0 ostaje 0 (ne -0): Excel i toEqual ne trebaju „-0,00“.
const minus = (n: number) => (n === 0 ? 0 : -n);
const negiraj = (s: Stope): Stope => ({ osnovicaE: minus(s.osnovicaE), pdvE: minus(s.pdvE), iznosK: minus(s.iznosK), ukupno: minus(s.ukupno) });

function oznakaRacuna(r: IzvozRacun): string {
  return [r.isManual ? 'ručni' : '', r.prilogBroj != null ? `prilog ${r.prilogBroj}` : '', r.status === 'refunded' ? 'reklamiran' : '']
    .filter(Boolean).join(', ');
}

function opisRacuna(r: IzvozRacun): string {
  return `Račun ${r.brojFiskalnogRacuna ?? `#${r.id}`} od ${prikazDatuma(r.createdAt)} (${km(r.ukupno)} KM)`;
}

function saberi<T extends object>(redovi: T[], kljucevi: (keyof T)[]): Record<keyof T, number> {
  const out = {} as Record<keyof T, number>;
  for (const k of kljucevi) out[k] = round2(redovi.reduce((a, r) => a + (r[k] as number), 0));
  return out;
}

const KLJUCEVI_STOPA: (keyof Stope)[] = ['osnovicaE', 'pdvE', 'iznosK', 'ukupno'];
const KLJUCEVI_PLACANJA: (keyof Placanja)[] = ['gotovina', 'kartica', 'virman', 'cek'];

export function obracunaj(p: KnjigovodjaPodaci, opcije: { moduli: Moduli; odbacenePraznine?: number[] }): KnjigovodjaIzvjestaj {
  const { moduli } = opcije;
  const upozorenja: Upozorenje[] = [];
  const odstupanja: Upozorenje[] = [];
  const placanjaUpoz: Upozorenje[] = [];

  const stavkePoRacunu = new Map<number, IzvozStavkaRacuna[]>();
  for (const s of p.stavkeRacuna) {
    const lista = stavkePoRacunu.get(s.orderId) ?? [];
    lista.push(s);
    stavkePoRacunu.set(s.orderId, lista);
  }

  const dani = new Map<string, DanRed>();
  const dan = (datum: string): DanRed => {
    let d = dani.get(datum);
    if (!d) {
      d = { datum, brojRacuna: 0, osnovicaE: 0, pdvE: 0, iznosK: 0, ukupno: 0, ...nulaPlacanja(), reklamacije: 0, neto: 0 };
      dani.set(datum, d);
    }
    return d;
  };

  const kif: KifRed[] = p.racuni.map(r => {
    const { stope, odstupanje } = stopeRacuna(r, stavkePoRacunu.get(r.id) ?? []);
    const pl = raspodjelaPlacanja(r.nacinPlacanja, stope.ukupno);
    if (Math.abs(odstupanje) > 0.01) {
      odstupanja.push({ vrsta: 'odstupanje', opis: `${opisRacuna(r)}: zbir stavki odstupa za ${km(odstupanje)} KM` });
    }
    if (!pl.poznat) placanjaUpoz.push({ vrsta: 'placanje', opis: `${opisRacuna(r)}: nepoznat način plaćanja „${r.nacinPlacanja}“, uzeto kao gotovina` });
    const d = dan(r.createdAt.slice(0, 10));
    d.brojRacuna += 1;
    for (const k of KLJUCEVI_STOPA) d[k] += stope[k];
    for (const k of KLJUCEVI_PLACANJA) d[k] += pl.iznosi[k];
    return {
      id: r.id, datum: r.createdAt, fiskalniBroj: r.brojFiskalnogRacuna ?? '', kupac: r.kupacNaziv ?? '', jib: r.kupacIdBroj ?? '',
      ...stope, placanje: pl.opis, datumValute: r.datumValute, oznaka: oznakaRacuna(r),
    };
  });

  const reklamacije: ReklamacijaRed[] = p.reklamacije.map(r => {
    const stope = negiraj(stopeRacuna(r, stavkePoRacunu.get(r.id) ?? []).stope);
    dan((r.refundedAt ?? r.createdAt).slice(0, 10)).reklamacije += stope.ukupno;
    return {
      id: r.id, datum: r.refundedAt ?? '', brojReklamacije: r.brojReklamacije ?? '', fiskalniBroj: r.brojFiskalnogRacuna ?? '',
      datumOriginala: r.createdAt, kupac: r.kupacNaziv ?? '', ...stope, placanje: raspodjelaPlacanja(r.nacinPlacanja, r.ukupno).opis,
    };
  });

  const daniRedovi = [...dani.values()]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map(d => {
      const out = { ...d };
      for (const k of [...KLJUCEVI_STOPA, ...KLJUCEVI_PLACANJA, 'reklamacije'] as const) out[k] = round2(out[k]);
      out.neto = round2(out.ukupno + out.reklamacije);
      return out;
    });

  // ── Kontrola fiskalne numeracije ──
  const brojevi = p.racuni.map(r => parseFiskalniBroj(r.brojFiskalnogRacuna)).filter((n): n is number => n !== null);
  for (const n of izracunajPraznine(brojevi, MAX_PRAZNINA, new Set(opcije.odbacenePraznine ?? []))) {
    upozorenja.push({ vrsta: 'praznina', opis: `Nedostaje fiskalni račun br. ${n}` });
  }
  for (const r of p.racuni) {
    if (parseFiskalniBroj(r.brojFiskalnogRacuna) === null) upozorenja.push({ vrsta: 'bezBroja', opis: `${opisRacuna(r)} nema fiskalni broj` });
  }
  upozorenja.push(...odstupanja, ...placanjaUpoz);

  // ── Skladište ──
  const kuf: KufRed[] = [];
  const ulazStavke: UlazStavkaRed[] = [];
  if (moduli.skladiste) {
    for (const pr of p.primke) {
      const stavke = p.primkaStavke.filter(s => s.primkaId === pr.id);
      let fakturna = 0, rabat = 0, zavisni = 0, nabavna = 0, pdv = 0, prodajna = 0, ruc = 0;
      for (const s of stavke) {
        const nv = nabavnaVrijednost(s);
        const pct = pdvStopaPct(s.pdvStopa) / 100;
        fakturna += fakturnaVrijednost(s);
        rabat += rabatIznos(s);
        zavisni += s.zavisniTroskovi || 0;
        nabavna += nv;
        pdv += (fakturnaVrijednost(s) - rabatIznos(s)) * pct;
        const pv = s.cijena * s.kolicina;
        prodajna += pv;
        if (pv > 0) ruc += pv / (1 + pct) - nv;
        ulazStavke.push({
          brojPrimke: pr.brojPrimke, datum: pr.datum, sifra: crtica(s.sifra), naziv: crtica(s.naziv), jm: s.jm ?? '',
          kolicina: s.kolicina, fakturnaCijena: s.nabavnaCijena, rabat: s.rabat, zavisni: s.zavisniTroskovi,
          nabavnaCijena: s.kolicina ? round4(nv / s.kolicina) : 0, prodajnaCijena: s.cijena, pdvStopa: s.pdvStopa,
        });
      }
      kuf.push({
        datum: pr.datum, brojPrimke: pr.brojPrimke, dobavljac: pr.dobavljacNaziv ?? '', dobavljacId: pr.dobavljacId ?? '',
        brojFakture: pr.brojFakture ?? '', fakturna: round2(fakturna), rabat: round2(rabat), zavisni: round2(zavisni),
        nabavna: round2(nabavna), pdv: round2(pdv), prodajna: round2(prodajna), ruc: round2(ruc),
      });
    }
  }
  const nivelacije = moduli.skladiste ? p.nivelacije : [];

  const tipoviZaliha = moduli.proizvodnja ? ['artikal', 'materijal'] : ['artikal'];
  const zalihe: ZalihaRed[] = moduli.skladiste
    ? p.zalihe
      .filter(z => tipoviZaliha.includes(z.tip) && Math.abs(z.kolicina) > 1e-9)
      .map(z => {
        const kolicina = round3(z.kolicina);
        const prosjecna = z.nabavnaKolicina > 0 ? round4(z.nabavnaVrijednost / z.nabavnaKolicina) : 0;
        return {
          sifra: z.sifra, naziv: z.naziv, jm: z.jm ?? '', tip: z.tip, kolicina, prosjecnaNabavna: prosjecna,
          nabavnaVrijednost: round2(kolicina * prosjecna), prodajnaCijena: z.cijena, prodajnaVrijednost: round2(kolicina * z.cijena),
        };
      })
    : [];
  for (const z of zalihe) {
    if (z.kolicina < 0) upozorenja.push({ vrsta: 'minus', opis: `Artikal ${z.sifra} ${z.naziv} je u minusu (${z.kolicina} ${z.jm})` });
  }
  const pozitivne = zalihe.filter(z => z.kolicina > 0);

  // ── Proizvodnja ──
  const utrosak: UtrosakRed[] = moduli.proizvodnja
    ? p.utrosak.map(u => {
      const cijena = u.nabavnaCijena ?? u.prosjecnaNabavna;
      return {
        nalog: `${u.broj}/${u.godina}`, zavrsen: u.zavrsenAt, opis: u.proizvod ? `${u.opis} — ${u.proizvod}` : u.opis,
        sifra: crtica(u.sifra), naziv: crtica(u.naziv), jm: u.jm ?? '', kolicina: u.kolicina,
        nabavnaCijena: round4(cijena), vrijednost: round2(u.kolicina * cijena),
      };
    })
    : [];
  const zbirMaterijala = new Map<string, UtrosakZbir>();
  for (const u of utrosak) {
    const k = `${u.sifra}\u0000${u.naziv}`;
    const z = zbirMaterijala.get(k) ?? { sifra: u.sifra, naziv: u.naziv, jm: u.jm, kolicina: 0, vrijednost: 0 };
    z.kolicina = round3(z.kolicina + u.kolicina);
    z.vrijednost = round2(z.vrijednost + u.vrijednost);
    zbirMaterijala.set(k, z);
  }
  const brojNaloga = moduli.proizvodnja ? new Set(p.utrosak.map(u => u.nalogId)).size : 0;

  const promet = { ...saberi(kif, KLJUCEVI_STOPA), ...saberi(daniRedovi, KLJUCEVI_PLACANJA), brojRacuna: kif.length };
  const rekl = { ...saberi(reklamacije, KLJUCEVI_STOPA), broj: reklamacije.length };

  return {
    od: p.od, do: p.do, moduli,
    dani: daniRedovi, kif, reklamacije,
    kuf, ulazStavke, nivelacije, kretanjaNovca: p.kretanjaNovca,
    utrosak, utrosakZbir: [...zbirMaterijala.values()], zalihe,
    upozorenja,
    zbir: {
      promet,
      reklamacije: rekl,
      neto: round2(promet.ukupno + rekl.ukupno),
      ulaz: { brojPrimki: kuf.length, ...saberi(kuf, ['nabavna', 'pdv', 'prodajna']) },
      nivelacijeRazlika: round2(nivelacije.reduce((a, n) => a + n.ukupnaRazlika, 0)),
      polozi: round2(p.kretanjaNovca.filter(k => k.tip === 'polog').reduce((a, k) => a + k.iznos, 0)),
      povrati: round2(p.kretanjaNovca.filter(k => k.tip === 'povrat').reduce((a, k) => a + k.iznos, 0)),
      utrosak: { brojNaloga, vrijednost: round2(utrosak.reduce((a, u) => a + u.vrijednost, 0)) },
      zalihe: saberi(pozitivne.map(z => ({ nabavna: z.nabavnaVrijednost, prodajna: z.prodajnaVrijednost })), ['nabavna', 'prodajna']),
    },
  };
}
```

Napomena za implementatora: redoslijed upozorenja je praznine → bez broja → odstupanja → plaćanje → minus (test to provjerava). `saberi` nad praznim nizom daje nule. `toEqual` razlikuje `-0` od `0` — zato `minus()` čuva nulu.

- [ ] **Step 4: Run** — `bun test src/lib/knjigovodja/obracun.test.ts` → PASS (14).

- [ ] **Step 5: Commit**

```bash
git add src/lib/knjigovodja/obracun.ts src/lib/knjigovodja/obracun.test.ts
git commit -m "feat(izvoz): obračun izvještaja za knjigovođu"
```

---

### Task 5: Excel i ZIP

**Files:**
- Modify: `package.json` / `bun.lock` (`bun add exceljs fflate`)
- Create: `src/lib/knjigovodja/excel.ts`
- Create: `src/lib/knjigovodja/zip.ts`
- Create: `src/lib/knjigovodja/listovi.ts`
- Test: `src/lib/knjigovodja/excel.test.ts`

**Interfaces:**
- Consumes: `KnjigovodjaIzvjestaj` i tipovi redova (Task 4), `prikazPerioda` (Task 3), `FirmaSettings` (`src/types.ts`).
- Produces:
  - `napraviExcel(iz: KnjigovodjaIzvjestaj, firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>, izvezeno: Date): Promise<Uint8Array>`
  - `NAZIVI_LISTOVA` i `listoviIzvjestaja(iz: KnjigovodjaIzvjestaj): Array<{ naziv: string; redova: number }>` u `listovi.ts` (bez exceljs — tab ga importuje statički)
  - `zapakuj(fajlovi: Array<{ ime: string; bajtovi: Uint8Array }>): Uint8Array`

- [ ] **Step 1: Zavisnosti**

Run: `bun add exceljs fflate`
Expected: obje u `dependencies`.

- [ ] **Step 2: Test (pada)**

`src/lib/knjigovodja/excel.test.ts`:

```ts
import { test, expect } from 'bun:test';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { napraviExcel } from './excel';
import { zapakuj } from './zip';
import { obracunaj } from './obracun';
import type { KnjigovodjaPodaci } from './tipovi';

const FIRMA = { naziv: 'Firma d.o.o.', idBroj: '4200000000000', pdvBroj: '200000000000' };
const IZVEZENO = new Date(2026, 9, 2, 9, 30);

function podaci(): KnjigovodjaPodaci {
  return {
    od: '2026-09-01', do: '2026-09-30',
    racuni: [
      { id: 1, createdAt: '2026-09-02 10:15:00', refundedAt: null, brojFiskalnogRacuna: '1', brojReklamacije: null, status: 'completed', ukupno: 11.7, pdvIznos: 1.7, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null, isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'A' },
      { id: 2, createdAt: '2026-09-03 11:00:00', refundedAt: null, brojFiskalnogRacuna: '2', brojReklamacije: null, status: 'completed', ukupno: 23.4, pdvIznos: 3.4, nacinPlacanja: 'Kartica', kupacNaziv: 'Kupac', kupacIdBroj: '42', isManual: 0, prilogBroj: null, datumValute: '2026-10-03', korisnikIme: 'A' },
    ],
    reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [], nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
  };
}

async function ucitaj(bajtovi: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bajtovi);
  return wb;
}

test('svi listovi kad su moduli uključeni, s zaglavljem firme', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  expect(wb.worksheets.map(w => w.name)).toEqual([
    'Rekapitulacija', 'KIF - računi', 'Reklamacije', 'KUF - ulaz robe', 'Ulaz - stavke', 'Nivelacije',
    'Polog - povrat', 'Utrošak materijala', 'Zalihe na dan', 'Kontrola',
  ]);
  const ws = wb.getWorksheet('KIF - računi')!;
  expect(ws.getCell('A1').value).toBe('Firma d.o.o.');
  expect(String(ws.getCell('A2').value)).toContain('4200000000000');
  expect(String(ws.getCell('A3').value)).toContain('Septembar 2026');
});

test('bez modula nema listova skladišta i proizvodnje', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: false, proizvodnja: false } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  expect(wb.worksheets.map(w => w.name)).toEqual(['Rekapitulacija', 'KIF - računi', 'Reklamacije', 'Polog - povrat', 'Kontrola']);
});

test('KIF: datumi, iznosi i zbirni red s formulom i rezultatom', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: false, proizvodnja: false } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const ws = wb.getWorksheet('KIF - računi')!;
  // Red 5 su naslovi kolona, podaci od reda 6.
  expect(ws.getRow(5).getCell(1).value).toBe('Datum i vrijeme');
  const datum = ws.getRow(6).getCell(1).value as Date;
  expect([datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate(), datum.getUTCHours(), datum.getUTCMinutes()]).toEqual([2026, 8, 2, 10, 15]);
  const naslovi = (ws.getRow(5).values as any[]).slice(1);
  const kol = (ime: string) => naslovi.indexOf(ime) + 1;
  expect(ws.getRow(6).getCell(kol('Ukupno')).value).toBe(11.7);
  expect(ws.getRow(7).getCell(kol('Osnovica 17%')).value).toBe(20);
  const zbir = ws.getRow(8);
  expect(zbir.getCell(1).value).toBe('Ukupno');
  expect(zbir.getCell(kol('Ukupno')).value).toMatchObject({ result: 35.1 });
  expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
});

test('prazan period: listovi postoje, zbir 0, Kontrola bez upozorenja', async () => {
  const p = podaci();
  p.racuni = [];
  const iz = obracunaj(p, { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const kif = wb.getWorksheet('KIF - računi')!;
  expect(kif.getRow(6).getCell(1).value).toBe('Ukupno');
  expect(wb.getWorksheet('Kontrola')!.getRow(6).getCell(1).value).toBe('Nema upozorenja');
});

test('zip sadrži oba fajla', () => {
  const zip = zapakuj([{ ime: 'a.xlsx', bajtovi: new Uint8Array([1, 2, 3]) }, { ime: 'a.pdf', bajtovi: new TextEncoder().encode('pdf') }]);
  const raspakovano = unzipSync(zip);
  expect(Object.keys(raspakovano).sort()).toEqual(['a.pdf', 'a.xlsx']);
  expect(strFromU8(raspakovano['a.pdf'])).toBe('pdf');
});
```

- [ ] **Step 3: Run** — `bun test src/lib/knjigovodja/excel.test.ts` → FAIL (moduli ne postoje).

- [ ] **Step 4: ZIP**

`src/lib/knjigovodja/zip.ts`:

```ts
import { zipSync } from 'fflate';

/** Fajlovi → jedan .zip (za jedan dijalog snimanja i jedan prilog u mailu). */
export function zapakuj(fajlovi: Array<{ ime: string; bajtovi: Uint8Array }>): Uint8Array {
  return zipSync(Object.fromEntries(fajlovi.map(f => [f.ime, f.bajtovi])));
}
```

- [ ] **Step 5: Listovi (bez exceljs)**

`src/lib/knjigovodja/listovi.ts`:

```ts
// Koji listovi idu u Excel i koliko redova nose — dijele excel.ts i tab
// (tab ne smije statički povući exceljs).
import type { KnjigovodjaIzvjestaj } from './obracun';

export const NAZIVI_LISTOVA = {
  rekapitulacija: 'Rekapitulacija',
  kif: 'KIF - računi',
  reklamacije: 'Reklamacije',
  kuf: 'KUF - ulaz robe',
  ulazStavke: 'Ulaz - stavke',
  nivelacije: 'Nivelacije',
  polog: 'Polog - povrat',
  utrosak: 'Utrošak materijala',
  zalihe: 'Zalihe na dan',
  kontrola: 'Kontrola',
} as const;

export function listoviIzvjestaja(iz: KnjigovodjaIzvjestaj): Array<{ naziv: string; redova: number }> {
  const L = NAZIVI_LISTOVA;
  return [
    { naziv: L.rekapitulacija, redova: iz.dani.length },
    { naziv: L.kif, redova: iz.kif.length },
    { naziv: L.reklamacije, redova: iz.reklamacije.length },
    ...(iz.moduli.skladiste ? [
      { naziv: L.kuf, redova: iz.kuf.length },
      { naziv: L.ulazStavke, redova: iz.ulazStavke.length },
      { naziv: L.nivelacije, redova: iz.nivelacije.length },
    ] : []),
    { naziv: L.polog, redova: iz.kretanjaNovca.length },
    ...(iz.moduli.proizvodnja ? [{ naziv: L.utrosak, redova: iz.utrosak.length }] : []),
    ...(iz.moduli.skladiste ? [{ naziv: L.zalihe, redova: iz.zalihe.length }] : []),
    { naziv: L.kontrola, redova: iz.upozorenja.length },
  ];
}
```

U `excel.test.ts` dodaj test da je redoslijed listova u fajlu isti kao `listoviIzvjestaja`:

```ts
import { listoviIzvjestaja } from './listovi';

test('listovi u fajlu = listoviIzvjestaja', async () => {
  for (const moduli of [{ skladiste: true, proizvodnja: true }, { skladiste: true, proizvodnja: false }, { skladiste: false, proizvodnja: true }]) {
    const iz = obracunaj(podaci(), { moduli });
    const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
    expect(wb.worksheets.map(w => w.name)).toEqual(listoviIzvjestaja(iz).map(l => l.naziv));
  }
});
```

- [ ] **Step 6: Excel**

`src/lib/knjigovodja/excel.ts`:

```ts
// Excel za knjigovođu: po jedan list za svaku cjelinu izvještaja. Brojevi
// dolaze gotovi iz obracun.ts; ovdje je samo raspored i format.
import ExcelJS from 'exceljs';
import type { FirmaSettings } from '@/types';
import { prikazPerioda } from './period';
import { NAZIVI_LISTOVA } from './listovi';
import type { KnjigovodjaIzvjestaj } from './obracun';

type Format = 'km' | 'datum' | 'datumVrijeme' | 'kolicina' | 'cijena';
type Celija = string | number | Date | null;

interface Kolona<T> {
  naslov: string;
  sirina: number;
  v: (r: T) => Celija;
  format?: Format;
  /** Kolona dobija zbir u redu „Ukupno“. */
  zbir?: boolean;
}

const FORMATI: Record<Format, string> = {
  km: '#,##0.00',
  cijena: '#,##0.00##',
  kolicina: '#,##0.###',
  datum: 'dd.mm.yyyy',
  datumVrijeme: 'dd.mm.yyyy hh:mm',
};

const PRVI_RED_PODATAKA = 6;

/** 'YYYY-MM-DD[ HH:MM:SS]' → Date koji Excel prikaže tačno tako (exceljs piše UTC). */
function datum(s: string | null): Date | null {
  if (!s) return null;
  const [d, t = '00:00:00'] = s.split(' ');
  const [g, m, dan] = d.split('-').map(Number);
  const [h, min, sek] = t.split(':').map(Number);
  return new Date(Date.UTC(g, m - 1, dan, h || 0, min || 0, sek || 0));
}

const pad = (n: number) => String(n).padStart(2, '0');

function zaglavlje(ws: ExcelJS.Worksheet, firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>, iz: KnjigovodjaIzvjestaj, izvezeno: Date, naslov: string) {
  ws.getCell('A1').value = firma.naziv || '—';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = [firma.idBroj && `JIB: ${firma.idBroj}`, firma.pdvBroj && `PDV broj: ${firma.pdvBroj}`].filter(Boolean).join('   ') || ' ';
  ws.getCell('A3').value = `${naslov} · Period: ${prikazPerioda(iz)} · Izvezeno: ${pad(izvezeno.getDate())}.${pad(izvezeno.getMonth() + 1)}.${izvezeno.getFullYear()}. ${pad(izvezeno.getHours())}:${pad(izvezeno.getMinutes())}`;
  ws.getCell('A3').font = { color: { argb: 'FF555555' } };
}

/** Tabela od reda `start` (naslovi) — vraća prvi slobodan red ispod nje. */
function tabela<T>(ws: ExcelJS.Worksheet, start: number, kolone: Kolona<T>[], redovi: T[], saZbirom: boolean): number {
  const naslovi = ws.getRow(start);
  kolone.forEach((k, i) => {
    const c = naslovi.getCell(i + 1);
    c.value = k.naslov;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF2' } };
    c.border = { bottom: { style: 'thin' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });

  redovi.forEach((r, j) => {
    const red = ws.getRow(start + 1 + j);
    kolone.forEach((k, i) => {
      const c = red.getCell(i + 1);
      c.value = k.v(r);
      if (k.format) c.numFmt = FORMATI[k.format];
    });
  });

  let sljedeci = start + 1 + redovi.length;
  if (saZbirom) {
    const red = ws.getRow(sljedeci);
    red.getCell(1).value = 'Ukupno';
    red.font = { bold: true };
    kolone.forEach((k, i) => {
      if (!k.zbir) return;
      const slovo = ws.getColumn(i + 1).letter;
      const rezultat = Math.round(redovi.reduce((a, r) => a + (Number(k.v(r)) || 0), 0) * 100) / 100;
      const c = red.getCell(i + 1);
      c.value = redovi.length
        ? { formula: `SUM(${slovo}${start + 1}:${slovo}${sljedeci - 1})`, result: rezultat }
        : 0;
      c.numFmt = FORMATI[k.format ?? 'km'];
      c.border = { top: { style: 'thin' } };
    });
    sljedeci += 1;
  }
  return sljedeci;
}

function list<T>(
  wb: ExcelJS.Workbook, ime: string, ctx: { firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>; iz: KnjigovodjaIzvjestaj; izvezeno: Date },
  kolone: Kolona<T>[], redovi: T[], saZbirom = true,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(ime, { views: [{ state: 'frozen', ySplit: PRVI_RED_PODATAKA - 1 }] });
  zaglavlje(ws, ctx.firma, ctx.iz, ctx.izvezeno, ime);
  kolone.forEach((k, i) => { ws.getColumn(i + 1).width = k.sirina; });
  tabela(ws, PRVI_RED_PODATAKA - 1, kolone, redovi, saZbirom);
  ws.autoFilter = { from: { row: PRVI_RED_PODATAKA - 1, column: 1 }, to: { row: PRVI_RED_PODATAKA - 1, column: kolone.length } };
  return ws;
}

const L = NAZIVI_LISTOVA;

export async function napraviExcel(
  iz: KnjigovodjaIzvjestaj, firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>, izvezeno: Date,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = firma.naziv || 'Atlas';
  wb.created = izvezeno;
  const ctx = { firma, iz, izvezeno };

  list(wb, L.rekapitulacija, ctx, [
    { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
    { naslov: 'Broj računa', sirina: 10, v: r => r.brojRacuna, format: 'kolicina', zbir: true },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Gotovina', sirina: 13, v: r => r.gotovina, format: 'km', zbir: true },
    { naslov: 'Kartica', sirina: 13, v: r => r.kartica, format: 'km', zbir: true },
    { naslov: 'Virman', sirina: 13, v: r => r.virman, format: 'km', zbir: true },
    { naslov: 'Ček', sirina: 11, v: r => r.cek, format: 'km', zbir: true },
    { naslov: 'Reklamacije', sirina: 13, v: r => r.reklamacije, format: 'km', zbir: true },
    { naslov: 'Neto', sirina: 14, v: r => r.neto, format: 'km', zbir: true },
  ], iz.dani);

  list(wb, L.kif, ctx, [
    { naslov: 'Datum i vrijeme', sirina: 17, v: r => datum(r.datum), format: 'datumVrijeme' },
    { naslov: 'Fiskalni broj', sirina: 12, v: r => r.fiskalniBroj },
    { naslov: 'Kupac', sirina: 26, v: r => r.kupac },
    { naslov: 'JIB kupca', sirina: 16, v: r => r.jib },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Način plaćanja', sirina: 28, v: r => r.placanje },
    { naslov: 'Datum valute', sirina: 12, v: r => datum(r.datumValute), format: 'datum' },
    { naslov: 'Napomena', sirina: 18, v: r => r.oznaka },
  ], iz.kif);

  list(wb, L.reklamacije, ctx, [
    { naslov: 'Datum reklamacije', sirina: 17, v: r => datum(r.datum), format: 'datumVrijeme' },
    { naslov: 'Broj reklamacije', sirina: 14, v: r => r.brojReklamacije },
    { naslov: 'Fiskalni broj računa', sirina: 14, v: r => r.fiskalniBroj },
    { naslov: 'Datum računa', sirina: 17, v: r => datum(r.datumOriginala), format: 'datumVrijeme' },
    { naslov: 'Kupac', sirina: 24, v: r => r.kupac },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Način plaćanja', sirina: 24, v: r => r.placanje },
  ], iz.reklamacije);

  if (iz.moduli.skladiste) {
    list(wb, L.kuf, ctx, [
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Broj primke', sirina: 13, v: r => r.brojPrimke },
      { naslov: 'Dobavljač', sirina: 26, v: r => r.dobavljac },
      { naslov: 'JIB/ID dobavljača', sirina: 16, v: r => r.dobavljacId },
      { naslov: 'Broj fakture', sirina: 14, v: r => r.brojFakture },
      { naslov: 'Fakturna vrijednost', sirina: 14, v: r => r.fakturna, format: 'km', zbir: true },
      { naslov: 'Rabat', sirina: 11, v: r => r.rabat, format: 'km', zbir: true },
      { naslov: 'Zavisni troškovi', sirina: 12, v: r => r.zavisni, format: 'km', zbir: true },
      { naslov: 'Nabavna vrijednost', sirina: 14, v: r => r.nabavna, format: 'km', zbir: true },
      { naslov: 'PDV', sirina: 12, v: r => r.pdv, format: 'km', zbir: true },
      { naslov: 'Prodajna vrijednost', sirina: 14, v: r => r.prodajna, format: 'km', zbir: true },
      { naslov: 'RUC', sirina: 12, v: r => r.ruc, format: 'km', zbir: true },
    ], iz.kuf);

    list(wb, L.ulazStavke, ctx, [
      { naslov: 'Broj primke', sirina: 13, v: r => r.brojPrimke },
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Fakturna cijena', sirina: 12, v: r => r.fakturnaCijena, format: 'cijena' },
      { naslov: 'Rabat %', sirina: 8, v: r => r.rabat, format: 'kolicina' },
      { naslov: 'Zavisni troškovi', sirina: 12, v: r => r.zavisni, format: 'km', zbir: true },
      { naslov: 'Nabavna cijena', sirina: 12, v: r => r.nabavnaCijena, format: 'cijena' },
      { naslov: 'Prodajna cijena', sirina: 12, v: r => r.prodajnaCijena, format: 'km' },
      { naslov: 'PDV stopa', sirina: 8, v: r => r.pdvStopa },
    ], iz.ulazStavke);

    list(wb, L.nivelacije, ctx, [
      { naslov: 'Broj', sirina: 14, v: r => r.brojNivelacije },
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra ?? '—' },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv ?? '—' },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Stara cijena', sirina: 12, v: r => r.staraCijena, format: 'km' },
      { naslov: 'Nova cijena', sirina: 12, v: r => r.novaCijena, format: 'km' },
      { naslov: 'Razlika po jedinici', sirina: 12, v: r => r.razlika, format: 'km' },
      { naslov: 'Ukupna razlika', sirina: 14, v: r => r.ukupnaRazlika, format: 'km', zbir: true },
      { naslov: 'PDV stopa', sirina: 8, v: r => r.pdvStopa },
    ], iz.nivelacije);
  }

  list(wb, L.polog, ctx, [
    { naslov: 'Datum i vrijeme', sirina: 17, v: r => datum(r.createdAt), format: 'datumVrijeme' },
    { naslov: 'Vrsta', sirina: 10, v: r => (r.tip === 'polog' ? 'Polog' : 'Povrat') },
    { naslov: 'Polog', sirina: 12, v: r => (r.tip === 'polog' ? r.iznos : 0), format: 'km', zbir: true },
    { naslov: 'Povrat', sirina: 12, v: r => (r.tip === 'povrat' ? r.iznos : 0), format: 'km', zbir: true },
    { naslov: 'Korisnik', sirina: 16, v: r => r.korisnikIme ?? '' },
    { naslov: 'Napomena', sirina: 26, v: r => r.napomena ?? '' },
    { naslov: 'Fiskalni uređaj', sirina: 14, v: r => ({ ok: 'Evidentirano', error: 'Greška', skipped: 'Nije slano' }[r.tringStatus] ?? r.tringStatus) },
  ], iz.kretanjaNovca);

  if (iz.moduli.proizvodnja) {
    const ws = list(wb, L.utrosak, ctx, [
      { naslov: 'Nalog', sirina: 10, v: r => r.nalog },
      { naslov: 'Završen', sirina: 17, v: r => datum(r.zavrsen), format: 'datumVrijeme' },
      { naslov: 'Opis', sirina: 30, v: r => r.opis },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Materijal', sirina: 28, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Nabavna cijena', sirina: 12, v: r => r.nabavnaCijena, format: 'cijena' },
      { naslov: 'Vrijednost', sirina: 13, v: r => r.vrijednost, format: 'km', zbir: true },
    ], iz.utrosak);
    const start = PRVI_RED_PODATAKA + iz.utrosak.length + 2;
    ws.getCell(`A${start}`).value = 'Zbir po materijalu';
    ws.getCell(`A${start}`).font = { bold: true, size: 12 };
    tabela(ws, start + 1, [
      { naslov: 'Šifra', sirina: 0, v: r => r.sifra },
      { naslov: 'Materijal', sirina: 0, v: r => r.naziv },
      { naslov: 'JM', sirina: 0, v: r => r.jm },
      { naslov: 'Količina', sirina: 0, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Vrijednost', sirina: 0, v: r => r.vrijednost, format: 'km', zbir: true },
    ], iz.utrosakZbir, true);
  }

  if (iz.moduli.skladiste) {
    list(wb, L.zalihe, ctx, [
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Vrsta', sirina: 10, v: r => (r.tip === 'materijal' ? 'Materijal' : 'Roba') },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Prosječna nabavna', sirina: 13, v: r => r.prosjecnaNabavna, format: 'cijena' },
      { naslov: 'Nabavna vrijednost', sirina: 14, v: r => r.nabavnaVrijednost, format: 'km', zbir: true },
      { naslov: 'Prodajna cijena', sirina: 12, v: r => r.prodajnaCijena, format: 'km' },
      { naslov: 'Prodajna vrijednost', sirina: 14, v: r => r.prodajnaVrijednost, format: 'km', zbir: true },
    ], iz.zalihe);
  }

  const kontrola = iz.upozorenja.length ? iz.upozorenja : [{ vrsta: '', opis: '' }];
  const VRSTE: Record<string, string> = {
    praznina: 'Rupa u numeraciji', bezBroja: 'Bez fiskalnog broja', odstupanje: 'Odstupanje iznosa',
    placanje: 'Način plaćanja', minus: 'Zaliha u minusu', '': 'Nema upozorenja',
  };
  list(wb, L.kontrola, ctx, [
    { naslov: 'Vrsta', sirina: 22, v: r => VRSTE[r.vrsta] ?? r.vrsta },
    { naslov: 'Opis', sirina: 90, v: r => r.opis },
  ], kontrola, false);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
```

Napomena: zbirni red iz `tabela` za prazan list upisuje `0` (bez formule), pa prazan KIF ima „Ukupno“ u redu 6 — test to očekuje. Zbir u redu „Ukupno“ ne ide za `Količina` kolone (nema `zbir`), osim `Broj računa` na Rekapitulaciji.

- [ ] **Step 7: Run** — `bun test src/lib/knjigovodja/excel.test.ts` → PASS (6). Ako `exceljs` u bun-u ne učita `Uint8Array`, u testu proslijedi `Buffer.from(bajtovi)` — ne mijenjaj `napraviExcel`.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/lib/knjigovodja/excel.ts src/lib/knjigovodja/zip.ts src/lib/knjigovodja/listovi.ts src/lib/knjigovodja/excel.test.ts
git commit -m "feat(izvoz): Excel sa listom po cjelini i ZIP paket"
```

---

### Task 6: PDF rekapitulacija, izbor perioda i tab „Knjigovođa“

**Files:**
- Create: `src/components/KnjigovodjaPdf.tsx`
- Create: `src/components/ui/period-picker.tsx`
- Create: `src/components/izvjestaji/KnjigovodjaTab.tsx`
- Modify: `src/screens/IzvjestajiScreen.tsx` (prop `uloga`, tab `knjigovodja`, sakrij zajednički period na tom tabu)
- Modify: `src/components/MainLayout.tsx:191` (`<IzvjestajiScreen korisnikId={user.id} uloga={user.uloga} />`)

**Interfaces:**
- Consumes: `window.api.izvozKnjigovodja`, `getFirmaSettings`, `getSetting`, `showSaveDialog`, `writeFile`; `useModuli()` (`src/hooks/useModuli.ts` → `ukljuceni.skladiste/proizvodnja`); `obracunaj`, `napraviExcel` (samo dinamički import), `listoviIzvjestaja`, `zapakuj`, `imeFajla`, `periodMjeseca`, `prosliMjesec`, `mjesecPerioda`, `prikazPerioda`, `MJESECI`.
- Produces: `KnjigovodjaPdf({ izvjestaj, firma, izvezeno })`, `PeriodPicker({ value, onChange, max })`, `KnjigovodjaTab()`.

- [ ] **Step 1: Vizuelni pravac kroz `/frontend-design`**

Invoke skill `frontend-design` s kontekstom: postojeći ekran Izvještaji (bijela traka s tabovima u `bg-slate-100 rounded-xl p-1`, pozadina `hsl(220,20%,97%)`, kartice `bg-white rounded-xl border`, tekst 13px, `font-mono` za iznose, lucide ikone). Tab mora izgledati kao dio istog ekrana, ne kao novi dizajn sistem. Cilj taba: jedan jasan tok „izaberi period → vidi šta ide knjigovođi → izvezi“. Odluke iz skilla primijeni u koracima 3–4 (raspored, tipografija brojeva, stanje upozorenja, stanje dugmeta dok radi).

- [ ] **Step 2: PDF rekapitulacija**

`src/components/KnjigovodjaPdf.tsx` — A4, stil `PrometPdf` (`PDF_FONT_FAMILY`, `StyleSheet` iste gustine):

```tsx
import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';
import type { FirmaSettings } from '@/types';
import type { KnjigovodjaIzvjestaj } from '@/lib/knjigovodja/obracun';
import { prikazPerioda } from '@/lib/knjigovodja/period';

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
const km = (n: number) => n.toLocaleString('bs-BA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, '0');

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontFamily: F, fontSize: 9, color: '#000' },
  firma: { fontSize: 11, fontFamily: FB, fontWeight: 700 },
  firmaRed: { fontSize: 8, color: '#333', marginTop: 1 },
  naslov: { fontSize: 13, fontFamily: FB, fontWeight: 700, textAlign: 'center', marginTop: 18 },
  podnaslov: { fontSize: 9, textAlign: 'center', marginTop: 3, marginBottom: 14 },
  sekcija: { marginBottom: 12 },
  sekcijaNaslov: { fontSize: 9, fontFamily: FB, fontWeight: 700, borderBottom: '1pt solid #000', paddingBottom: 2, marginBottom: 3 },
  red: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5, borderBottom: '0.5pt solid #eee' },
  redJak: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderTop: '1pt solid #000', marginTop: 1 },
  vrijednost: { fontFamily: FB, fontWeight: 700 },
  upozorenje: { fontSize: 8, paddingVertical: 1 },
  napomena: { fontSize: 7.5, color: '#444', marginTop: 6 },
  potpisi: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
  potpis: { width: '40%', borderTop: '0.5pt solid #000', paddingTop: 3, fontSize: 8, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#999' },
});

function Red({ label, value, jak }: { label: string; value: string; jak?: boolean }) {
  return (
    <View style={jak ? s.redJak : s.red}>
      <Text>{label}</Text>
      <Text style={s.vrijednost}>{value}</Text>
    </View>
  );
}

export interface KnjigovodjaPdfProps {
  izvjestaj: KnjigovodjaIzvjestaj;
  firma: Pick<FirmaSettings, 'naziv' | 'adresa' | 'grad' | 'idBroj' | 'pdvBroj'>;
  izvezeno: Date;
}

export function KnjigovodjaPdf({ izvjestaj: iz, firma, izvezeno }: KnjigovodjaPdfProps) {
  const z = iz.zbir;
  const datumIzvoza = `${pad(izvezeno.getDate())}.${pad(izvezeno.getMonth() + 1)}.${izvezeno.getFullYear()}.`;
  const upozorenja = iz.upozorenja.slice(0, 40);
  return (
    <Document title={`Izvještaj za knjigovodstvo — ${prikazPerioda(iz)}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.firma}>{firma.naziv || '—'}</Text>
        {(firma.adresa || firma.grad) && <Text style={s.firmaRed}>{[firma.adresa, firma.grad].filter(Boolean).join(', ')}</Text>}
        <Text style={s.firmaRed}>{[firma.idBroj && `JIB: ${firma.idBroj}`, firma.pdvBroj && `PDV broj: ${firma.pdvBroj}`].filter(Boolean).join('   ')}</Text>

        <Text style={s.naslov}>IZVJEŠTAJ ZA KNJIGOVODSTVO</Text>
        <Text style={s.podnaslov}>Period: {prikazPerioda(iz)} · Izvezeno: {datumIzvoza}</Text>

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Promet ({z.promet.brojRacuna} računa)</Text>
          <Red label="Osnovica 17%" value={km(z.promet.osnovicaE)} />
          <Red label="PDV 17%" value={km(z.promet.pdvE)} />
          <Red label="Oslobođeno PDV-a (K)" value={km(z.promet.iznosK)} />
          <Red label="Gotovina" value={km(z.promet.gotovina)} />
          <Red label="Kartica" value={km(z.promet.kartica)} />
          <Red label="Virman" value={km(z.promet.virman)} />
          <Red label="Ček" value={km(z.promet.cek)} />
          <Red label="Ukupan promet" value={km(z.promet.ukupno)} jak />
        </View>

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Reklamacije ({z.reklamacije.broj})</Text>
          <Red label="Osnovica 17%" value={km(z.reklamacije.osnovicaE)} />
          <Red label="PDV 17%" value={km(z.reklamacije.pdvE)} />
          <Red label="Oslobođeno PDV-a (K)" value={km(z.reklamacije.iznosK)} />
          <Red label="Ukupno reklamacije" value={km(z.reklamacije.ukupno)} jak />
          <Red label="Neto promet" value={km(z.neto)} jak />
        </View>

        {iz.moduli.skladiste && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Ulaz robe ({z.ulaz.brojPrimki} primki)</Text>
            <Red label="Nabavna vrijednost" value={km(z.ulaz.nabavna)} />
            <Red label="PDV" value={km(z.ulaz.pdv)} />
            <Red label="Prodajna vrijednost" value={km(z.ulaz.prodajna)} />
            <Red label="Nivelacije — ukupna razlika" value={km(z.nivelacijeRazlika)} />
          </View>
        )}

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Gotovina u kasi</Text>
          <Red label="Polog" value={km(z.polozi)} />
          <Red label="Povrat" value={km(z.povrati)} />
        </View>

        {iz.moduli.proizvodnja && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Utrošak materijala ({z.utrosak.brojNaloga} naloga)</Text>
            <Red label="Nabavna vrijednost utrošenog materijala" value={km(z.utrosak.vrijednost)} />
          </View>
        )}

        {iz.moduli.skladiste && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Zalihe na dan {iz.do.split('-').reverse().join('.')}.</Text>
            <Red label="Nabavna vrijednost" value={km(z.zalihe.nabavna)} />
            <Red label="Prodajna vrijednost" value={km(z.zalihe.prodajna)} />
          </View>
        )}

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Kontrola</Text>
          {upozorenja.length === 0 && <Text style={s.upozorenje}>Nema upozorenja.</Text>}
          {upozorenja.map((u, i) => <Text key={i} style={s.upozorenje}>• {u.opis}</Text>)}
          {iz.upozorenja.length > upozorenja.length && (
            <Text style={s.upozorenje}>… i još {iz.upozorenja.length - upozorenja.length} (vidi list „Kontrola“ u Excelu)</Text>
          )}
          <Text style={s.napomena}>Z i X izvještaji se vode na fiskalnom uređaju i nisu dio ovog izvoza. Detalji su u priloženom Excel fajlu.</Text>
        </View>

        <View style={s.potpisi} wrap={false}>
          <Text style={s.potpis}>Sastavio</Text>
          <Text style={s.potpis}>Primio</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text render={({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
```

(Provjeri da `POTPIS_AUTORA` postoji u `src/lib/brend.ts` — `PrometPdf` ga importuje.)

- [ ] **Step 3: `PeriodPicker`**

`src/components/ui/period-picker.tsx` — dvije kontrole: segmentirani prekidač `Mjesec | Period`, pa:
- **Mjesec:** popover s godinom (`ChevronLeft`/`ChevronRight`) i mrežom 3×4 mjeseci (`MJESECI`, skraćeno na 3 slova u mreži, puni naziv u dugmetu-okidaču). Mjeseci poslije mjeseca iz `max` su `disabled`. Klik → `onChange(periodMjeseca(g, m))` i zatvori popover.
- **Period:** dva `DatePicker`-a (`src/components/ui/date-picker.tsx`); `do` ima `minDate={value.od}`; promjena `od` poslije `do` pomjera `do` na `od`.
- Početni režim: `mjesecPerioda(value) ? 'mjesec' : 'period'`. Prelazak na „Mjesec“ bira mjesec iz `value.od`.

```tsx
import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';
import { MJESECI, mjesecPerioda, periodMjeseca, type Period } from '@/lib/knjigovodja/period';

interface PeriodPickerProps {
  value: Period;
  onChange: (p: Period) => void;
  /** 'YYYY-MM-DD' — mjeseci poslije ovog datuma se ne mogu izabrati. */
  max: string;
}

export function PeriodPicker({ value, onChange, max }: PeriodPickerProps) {
  const [rezim, setRezim] = React.useState<'mjesec' | 'period'>(mjesecPerioda(value) ? 'mjesec' : 'period');
  const [open, setOpen] = React.useState(false);
  const izabran = mjesecPerioda(value);
  const [godina, setGodina] = React.useState(Number(value.od.slice(0, 4)));
  const [maxG, maxM] = max.split('-').map(Number);

  const promijeniRezim = (r: 'mjesec' | 'period') => {
    setRezim(r);
    if (r === 'mjesec' && !izabran) {
      const [g, m] = value.od.split('-').map(Number);
      onChange(periodMjeseca(g, m));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5" role="tablist" aria-label="Vrsta perioda">
        {(['mjesec', 'period'] as const).map(r => (
          <button
            key={r}
            role="tab"
            aria-selected={rezim === r}
            onClick={() => promijeniRezim(r)}
            className={cn(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              rezim === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {r === 'mjesec' ? 'Mjesec' : 'Period'}
          </button>
        ))}
      </div>

      {rezim === 'mjesec' ? (
        <Popover open={open} onOpenChange={o => { setOpen(o); if (o && izabran) setGodina(izabran.godina); }}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9 min-w-44 justify-start font-normal">
              <CalendarDays size={14} className="mr-2 text-slate-400" />
              {izabran ? `${MJESECI[izabran.mjesec - 1]} ${izabran.godina}` : 'Izaberite mjesec'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="flex items-center justify-between mb-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGodina(g => g - 1)} aria-label="Prethodna godina">
                <ChevronLeft size={16} />
              </Button>
              <span className="text-sm font-semibold tabular-nums">{godina}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={godina >= maxG} onClick={() => setGodina(g => g + 1)} aria-label="Sljedeća godina">
                <ChevronRight size={16} />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MJESECI.map((naziv, i) => {
                const m = i + 1;
                const buduci = godina > maxG || (godina === maxG && m > maxM);
                const aktivan = izabran?.godina === godina && izabran.mjesec === m;
                return (
                  <button
                    key={naziv}
                    disabled={buduci}
                    onClick={() => { onChange(periodMjeseca(godina, m)); setOpen(false); }}
                    className={cn(
                      'h-9 rounded-md text-[13px] transition-colors',
                      aktivan ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700',
                      buduci && 'opacity-30 pointer-events-none',
                    )}
                  >
                    {naziv.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-1.5">
          <DatePicker
            className="h-9 w-36"
            value={value.od}
            onChange={od => onChange({ od, do: value.do < od ? od : value.do })}
          />
          <span className="text-slate-400 text-sm">–</span>
          <DatePicker className="h-9 w-36" value={value.do} minDate={value.od} onChange={d => onChange({ od: value.od, do: d })} />
        </div>
      )}
    </div>
  );
}
```

Vizuelne detalje (boje, razmaci, stanja) uskladi s odlukama iz Step 1; ponašanje ostaje ovako.

- [ ] **Step 4: `KnjigovodjaTab`**

`src/components/izvjestaji/KnjigovodjaTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PeriodPicker } from '@/components/ui/period-picker';
import { KnjigovodjaPdf } from '@/components/KnjigovodjaPdf';
import { useModuli } from '@/hooks/useModuli';
import { formatKM, porukaGreske } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { obracunaj, type KnjigovodjaIzvjestaj } from '@/lib/knjigovodja/obracun';
import { imeFajla, periodMjeseca, prikazPerioda, prosliMjesec, type Period } from '@/lib/knjigovodja/period';
import { zapakuj } from '@/lib/knjigovodja/zip';
import type { FirmaSettings } from '@/types';

function pocetniPeriod(): Period {
  const { godina, mjesec } = prosliMjesec(new Date());
  return periodMjeseca(godina, mjesec);
}

export default function KnjigovodjaTab() {
  const moduli = useModuli();
  const [period, setPeriod] = useState<Period>(pocetniPeriod);
  const [izvjestaj, setIzvjestaj] = useState<KnjigovodjaIzvjestaj | null>(null);
  const [firma, setFirma] = useState<FirmaSettings | null>(null);
  const [ucitavanje, setUcitavanje] = useState(false);
  const [izvozi, setIzvozi] = useState(false);
  const [greska, setGreska] = useState('');
  const [snimljeno, setSnimljeno] = useState('');

  useEffect(() => {
    if (!moduli) return;
    let aktuelno = true;
    setUcitavanje(true);
    setGreska('');
    setSnimljeno('');
    Promise.all([
      window.api.izvozKnjigovodja(period.od, period.do),
      window.api.getFirmaSettings(),
      window.api.getSetting('fiscal.dismissedGaps'),
    ])
      .then(([podaci, f, odbacene]) => {
        if (!aktuelno) return;
        setFirma(f);
        setIzvjestaj(obracunaj(podaci, {
          moduli: { skladiste: moduli.ukljuceni.skladiste, proizvodnja: moduli.ukljuceni.proizvodnja },
          odbacenePraznine: odbacene ? JSON.parse(odbacene) : [],
        }));
      })
      .catch(e => { if (aktuelno) { setIzvjestaj(null); setGreska(porukaGreske(e)); } })
      .finally(() => { if (aktuelno) setUcitavanje(false); });
    return () => { aktuelno = false; };
  }, [period, moduli]);

  const izvezi = async () => {
    if (!izvjestaj || !firma) return;
    setIzvozi(true);
    setGreska('');
    setSnimljeno('');
    try {
      const izvezeno = new Date();
      const ime = imeFajla(firma.naziv, period);
      // exceljs je velik — učitava se tek kad zatreba.
      const { napraviExcel } = await import('@/lib/knjigovodja/excel');
      const [xlsx, pdfBlob] = await Promise.all([
        napraviExcel(izvjestaj, firma, izvezeno),
        pdf(<KnjigovodjaPdf izvjestaj={izvjestaj} firma={firma} izvezeno={izvezeno} />).toBlob(),
      ]);
      const zip = zapakuj([
        { ime: `${ime}.xlsx`, bajtovi: xlsx },
        { ime: `${ime}.pdf`, bajtovi: new Uint8Array(await pdfBlob.arrayBuffer()) },
      ]);
      const putanja = await window.api.showSaveDialog({ defaultName: `${ime}.zip`, filters: [{ name: 'ZIP arhiva', extensions: ['zip'] }] });
      if (!putanja) return; // korisnik otkazao
      await window.api.writeFile(putanja, zip);
      setSnimljeno(putanja);
    } catch (e) {
      setGreska(`Izvoz nije uspio: ${porukaGreske(e)}`);
    } finally {
      setIzvozi(false);
    }
  };

  const z = izvjestaj?.zbir;
  // …render: vidi opis ispod
}
```

Render (raspored po odlukama iz Step 1, klase kao ostatak ekrana):
- Gornja traka taba: `PeriodPicker` (`max={localDateStr()}`) lijevo; desno primarno dugme „Izvezi za knjigovođu (.zip)“ s `Download` ikonom, `disabled={!izvjestaj || ucitavanje || izvozi}`, `Loader2 animate-spin` dok `izvozi`.
- Ispod naslov perioda (`prikazPerioda(period)`) i kratka rečenica „Excel sa svim listovima i PDF rekapitulacija u jednom ZIP fajlu.“
- Kartice (grid, `sm:grid-cols-2 xl:grid-cols-4`): **Promet** (`z.promet.ukupno`, ispod broj računa i PDV), **Reklamacije** (`z.reklamacije.ukupno`, broj), **Neto** (`z.neto`), **Gotovina u kasi** (polog / povrat). Ako `izvjestaj.moduli.skladiste`: **Ulaz robe** (nabavna, broj primki), **Zalihe na dan** (nabavna / prodajna). Ako `proizvodnja`: **Utrošak materijala** (vrijednost, broj naloga). Iznosi `formatKM`, `font-mono tabular-nums`.
- Lista „Šta ide u Excel“: `listoviIzvjestaja(izvjestaj)` iz `listovi.ts` (naziv lista + broj redova). Nikad ne importuj `excel.ts` statički u tab — povuklo bi exceljs u glavni bundle.
- Kontrola: ako `upozorenja.length`, amber blok s `AlertTriangle`, naslov „Provjerite prije slanja (N)“, prvih 8 opisa i „… i još N“ ; inače smiraj red s `CheckCircle2` „Nema upozorenja“.
- Stanja: `ucitavanje` → skeleton/`Loader2` u karticama; `greska` → crveni blok s porukom; `snimljeno` → zeleni red „Snimljeno: <putanja>“.

- [ ] **Step 5: Uključi tab**

`src/components/MainLayout.tsx:191`:

```tsx
          {screen === 'izvjestaji' && <IzvjestajiScreen korisnikId={user.id} uloga={user.uloga} />}
```

`src/screens/IzvjestajiScreen.tsx`:
- potpis: `export default function IzvjestajiScreen({ korisnikId, uloga }: { korisnikId: number; uloga: string })`
- `type Tab = 'promet' | 'primke' | 'nivelacije' | 'fiskalni' | 'knjigovodja';`
- u `tabs` dodaj `...(uloga === 'admin' ? [{ id: 'knjigovodja' as Tab, label: 'Knjigovođa', icon: BookOpenCheck }] : [])` (`BookOpenCheck` iz `lucide-react`)
- zajednički blok „Period:“ (od–do popoveri) renderuj samo kad `activeTab !== 'knjigovodja'`
- sadržaj: `{activeTab === 'knjigovodja' && <KnjigovodjaTab />}` na istom mjestu gdje se renderuju ostali tabovi (tab ima svoj period i svoje učitavanje; postojeći `useEffect` koji učitava promet/primke po `activeTab` ne smije ništa raditi za `knjigovodja` — provjeri granu u tom efektu).

- [ ] **Step 6: Tipovi i testovi**

Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "knjigovodja|period-picker|KnjigovodjaPdf|Izvjestaji|MainLayout"`
Expected: bez izlaza.

Run: `bun test src/lib/knjigovodja src/ipc/ugovor/izvoz.ugovor.test.ts`
Expected: sve PASS.

- [ ] **Step 7: Ručna provjera u pravom renderu**

Prema memoriji (renderer nije dostupan iz sandboxa): statički Vite build + Playwright chromium, s `window.api` stubom koji vraća `KnjigovodjaPodaci` iz fixture-a (račun obje stope, reklamacija, primka, polog, nalog, zaliha u minusu, rupa u numeraciji) i hvata `showSaveDialog`/`writeFile`. Provjeri i snimi screenshot:
1. Tab „Knjigovođa“ vidljiv za admina, nevidljiv za kasira.
2. Podrazumijevano je prošli mjesec; mreža mjeseci onemogućava buduće; prelazak na Period i nazad.
3. Kartice i upozorenja odgovaraju fixture-u.
4. Klik „Izvezi“ → stub dobije ime `Knjigovodja_<Firma>_YYYY-MM.zip` i bajtove; raspakuj ih (`fflate`) i otvori `.xlsx` kroz exceljs, `.pdf` provjeri da počinje s `%PDF`.
5. Stub `showSaveDialog` vrati `null` → nema poruke o grešci ni „Snimljeno“ (Review Focus 5).
6. Stub `izvozKnjigovodja` baci grešku → crveni blok, dugme onemogućeno.

- [ ] **Step 8: Commit**

```bash
git add src/components/KnjigovodjaPdf.tsx src/components/ui/period-picker.tsx src/components/izvjestaji/KnjigovodjaTab.tsx src/screens/IzvjestajiScreen.tsx src/components/MainLayout.tsx src/lib/knjigovodja
git commit -m "feat(izvoz): tab Knjigovođa u Izvještajima s izborom perioda i ZIP izvozom"
```

---

### Task 7: Završna provjera grane

- [ ] **Step 1:** `bun test` (cijeli repo) → nema novih padova u odnosu na polaznu tačku (broj padova zabilježen prije Task 1 — vidi „Prije Task 1“ ispod zaglavlja).
- [ ] **Step 2:** `bun run test:rust` → 0 fail.
- [ ] **Step 3:** `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend` → 0 fail.
- [ ] **Step 4:** Ažuriraj spec ako se implementacija u nečemu razišla (npr. izdvojen `listovi.ts`), commit `docs(izvoz): …`.
