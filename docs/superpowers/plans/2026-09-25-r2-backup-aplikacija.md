# Automatski backup u aplikaciji (Electron) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron aplikacija sama, svaka 3 h, pravi šifrovanu kopiju baze i šalje je u R2 bucket klijenta, s napretkom na tankoj traci i karticom u Postavkama.

**Architecture:** Sva logika je u dva čista modula bez Electrona — `src/lib/backupRaspored.ts` (stanje, raspored, poruke; dijeli ga i renderer) i `src/lib/backupTok.ts` (motor: jedan backup istovremeno, stanje, događaji, `tick()` za raspored; sve spoljašnje stvari dolaze kroz `BackupOkruzenje`). `src/ipc/backup.ts` je tanak Electron sloj (userData, VACUUM INTO, `webContents.send`, `setInterval`). Kanali `backup:info` / `backup:sada` i događaj `backup:stanje` se provjeravaju ugovornim testovima protiv lažnog S3 servera, isto kao ostali kanali, da bi Rust (faza 4) imao gotov ugovor.

**Tech Stack:** Electron main (better-sqlite3), `node:http(s)` za PUT s napretkom, `age-encryption`, React + Tailwind, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-25-r2-backup-design.md`

## Global Constraints

- Raspored: prvi backup 1 min nakon starta ako je zadnji uspjeh stariji od 3 h (ili ga nema); zatim svaka 3 h; nakon greške ponovo za 15 min.
- Tok: `VACUUM INTO` (temp fajl) → `sifrujBackup` → `r2Posalji`; temp fajl se uvijek briše.
- Stanje: `userData/backup-stanje.json` = `{ zadnjiUspjeh?: ISO, zadnjiPokusaj?: ISO, greska?: string, greskaOd?: ISO }` — van baze.
- `backup:info` → `{ aktivan, bucket?, zadnjiUspjeh?, greska?, greskaOd?, sljedeci?, uToku }`; `backup:sada` pokreće backup ili vraća tekući.
- Događaj `backup:stanje`: `{ faza: 'kopija'|'sifrovanje'|'slanje', procenat } | { gotovo: ISO } | { greska: string, trajnaGreska: boolean }`; `trajnaGreska` = nema uspjeha duže od 24 h.
- Aktivan = licenca važi (`smijeRaditi`: aktivna/upozorenje/milost) i ima `backup`. Nova licenca s backup-om pokreće prvi backup odmah.
- 403 → poruka tačno: `R2 pristup više ne važi — zatražite novu licencu`.
- Greška backup-a nikad ne prekida rad kase; ništa se ne loguje s kredencijalima.
- Kredencijali (`backupPodaci`) samo u main procesu, nikad u renderer.
- Traka: 2 px, `position: fixed` na vrhu (ne pomjera sadržaj), faze kopija 0–10 %, šifrovanje 10–20 %, slanje 20–100 %; pilula gore desno `☁ Backup… 45%`; gotovo: zeleno, `✓ Backup spremljen · 15:00`, nestaje za 3 s; greška: žuto, `Backup nije uspio — pokušavam ponovo za 15 min`, 5 s; `trajnaGreska`: pilula ostaje, klik vodi u Postavke; `no-print`.
- Postavke: licenca bez backup-a → `Automatski backup nije uključen u licencu`; s backup-om: bucket, zadnji uspješan, sljedeći, zadnja greška, dugme `Backup sada`.
- Endpoint u testovima: env `PAZAR_BACKUP_ENDPOINT`.
- Ne dirati `~/.pazar-licenca` osim čitanja. Test objekti u `pazar-lunatik-doo` ostaju (lock 14 dana) — očekivano.
- Bun (ne npm/node), ugovorni testovi u `src/ipc/ugovor`, `bun test` radi u UTC-u.

## Odluke koje plan donosi (spec ih ne precizira — potvrdi)

1. **`sljedeciBackup(stanje, sada, start)`** — spec kaže `(stanje, sada)`, ali pravilo "start + 1 min" traži vrijeme starta, pa je treći argument. Prednost pravila: ako je zadnji pokušaj pao (`greska` postavljena) → pokušaj + 15 min; inače uspjeh + 3 h; rezultat se nikad ne vraća prije `start + 1 min` ni prije `sada`. (Bez te prednosti "nikad uspjeha + pao pokušaj" bi se ponavljalo odmah, u petlji.)
2. **Tajmer = provjera svake minute** (`setInterval(tick, 60 s)`, `tick` pita `sljedeciBackup`) umjesto jednog dugog `setTimeout`-a. Isto ponašanje, ali preživi spavanje laptopa i sam primijeti novu licencu. Tačnost ±1 min.
3. **`procenat` u događaju je unutar faze** (0–100); traka ga preslikava na ukupni (`ukupniProcenat`). Rust šalje isto.
4. **`backup:sada` čeka kraj** i vraća `BackupInfo` (greška backup-a je u `info.greska`, ne baca se). Baca samo kad backup nije u licenci: `Automatski backup nije uključen u licencu.`
5. **Napredak po bajtovima** ide kroz `node:http(s)` (PUT s `content-length`, komadi od 64 KB) umjesto `fetch` — `fetch` sa streamom šalje chunked bez dužine, što R2 odbija za PUT. GET i lista ostaju na `fetch`.
6. **Ugovor za Rust:** `Backend` u harnessu dobija `postaviBackupLicencu(r2)` (licenca s tokenom ima svoje testove, kao i do sad) i `dogadjaji`. Ugovorni testovi backup-a su `describe.skipIf(KASA_BACKEND === 'rust')` do faze 4, da `bun run test:rust` ostane zelen.
7. **Klik na trajnu pilulu** otvara Postavke → Sistem samo za admina (kasir nema Postavke; kod njega pilula nije klikabilna).
8. **Početno stanje trake:** na mount `BackupTraka` pita `backup:info`; ako je `uToku` prikaže traku, ako je trajna greška prikaže pilulu — inače traka čeka događaje.

## Review Focus

1. **Oštećen ili nečitljiv `backup-stanje.json`** (prazan fajl, ručno izmijenjen, disk pun pri pisanju) — backup i kasa rade dalje kao da stanja nema; nikakav izuzetak ne izlazi iz motora. → test u Task 4 (`citajStanje` baca / `pisiStanje` baca).
2. **Sat vraćen unazad** (zadnji uspjeh "u budućnosti") — backup se ne smije zaglaviti do tog datuma, radi se čim može. → test u Task 1.
3. **"Backup sada" kliknut dok automatski backup teče** — jedan PUT, oba poziva dobiju isti rezultat. → test u Task 4 i ugovorni u Task 5.
4. **Licenca istekne ili se zamijeni tokenom bez backup-a dok aplikacija radi** — `tick` više ne pokreće backup, `info.aktivan` je false; bez greške u konzoli svake minute. → test u Task 4 (`pristup` vrati null / baci).
5. **Nema interneta / R2 visi** — PUT ima timeout (120 s bez aktivnosti), greška ide u stanje, sljedeći pokušaj za 15 min; temp fajl se briše i kad kopija/slanje padne. → test timeouta i brisanja u Task 2 i Task 5.

---

## Fajlovi

| Fajl | Odgovornost |
|---|---|
| `src/lib/backupRaspored.ts` (novi) | tipovi `BackupStanje`/`BackupInfo`/`BackupDogadjaj`, `sljedeciBackup`, `trajnaGreska`, `ukupniProcenat` — bez Node importa (koristi i renderer) |
| `src/lib/backupRaspored.test.ts` (novi) | |
| `src/lib/r2.ts` | `R2Greska` sa `status`; `r2Posalji(…, napredak?)` preko `node:http(s)` |
| `src/lib/r2.test.ts` | napredak, 403 status, timeout |
| `src/lib/licencaStanje.ts` (+test) | `backupDozvoljen(s)` |
| `src/ipc/licenca.ts` | `backupPristup(): R2Podaci \| null` |
| `src/lib/backupTok.ts` (novi, +test) | motor `napraviBackup(okruzenje)` → `{ info, sada, tick }`, `porukaGreske` |
| `src/ipc/backup.ts` (novi) | Electron sloj: `registrujBackup()`, `backupInfo`, `backupSada`, `backupNakonAktivacije`, `pokreniRaspored`, `zaustaviRaspored` |
| `src/ipc/handlers.ts` | kanali `backup:info`, `backup:sada`; `licenca:aktiviraj` pokreće prvi backup |
| `src/main.ts` | `pokreniRaspored()` / `zaustaviRaspored()` |
| `src/ipc/api.ts`, `src/preload.ts`, `src/tauri/api.ts`, `src/global.d.ts` | opšta pretplata `naDogadjaj(ime, cb)`; `getBackupInfo`, `backupSada`, `onBackupStanje` |
| `src/ipc/ugovor/backend.ts`, `tsBackend.ts`, `rustBackend.ts`, `stvarnaBaza.poredjenje.test.ts` | `postaviBackupLicencu`, `dogadjaji` |
| `src/ipc/ugovor/laziS3.ts` (novi) | lažni S3 koji provjerava SigV4 |
| `src/ipc/ugovor/backup.ugovor.test.ts` (novi) | ugovor `backup:*` |
| `src/lib/backupTraka.ts` (novi, +test) | čisto: događaj/info → šta traka prikazuje |
| `src/components/backup/BackupTraka.tsx` (novi) | traka + pilula |
| `src/components/postavke/AutomatskiBackup.tsx` (novi) | sekcija u Postavke → Sistem |
| `src/hooks/useBackup.ts` (novi) | info + pretplata na događaje |
| `src/components/MainLayout.tsx`, `src/screens/PostavkeScreen.tsx`, `src/components/postavke/SistemGrupa.tsx` | ugradnja |
| `src/ipc/sesija.ts`, `src/ipc/ugovor/sesija.ugovor.test.ts` | `backup:sada` samo admin; lista kanala |

---

### Task 0: Worktree

R2 osnova je na mainu (snapshot `8f3de6a`), osim `src/lib/backupKljuc.ts` koji je **namjerno necommitan (repo je javan)** i nikad se ne commita. U glavnom direktoriju radi paralelna sesija — ovaj plan se izvršava u zasebnom worktreeu.

- [ ] **Step 1:** `git worktree add ../kasa-app-r2 -b feat/r2-backup-aplikacija main`
- [ ] **Step 2:** `cp src/lib/backupKljuc.ts ../kasa-app-r2/src/lib/backupKljuc.ts` (ostaje untracked — nikad `git add` ovog fajla; commitati uvijek imenovane fajlove, ne `git add -A`).
- [ ] **Step 3:** u worktreeu `bun install`, pa `bun test` — zabilježiti polazno stanje (koliko testova, da li nešto već pada).

---

### Task 1: Raspored i stanje (`backupRaspored.ts`)

**Files:**
- Create: `src/lib/backupRaspored.ts`
- Test: `src/lib/backupRaspored.test.ts`

**Interfaces:**
- Produces:
  - `interface BackupStanje { zadnjiUspjeh?: string; zadnjiPokusaj?: string; greska?: string; greskaOd?: string }`
  - `interface BackupInfo { aktivan: boolean; bucket?: string; zadnjiUspjeh?: string; greska?: string; greskaOd?: string; sljedeci?: string; uToku: boolean }`
  - `type BackupFaza = 'kopija' | 'sifrovanje' | 'slanje'`
  - `type BackupDogadjaj = { faza: BackupFaza; procenat: number } | { gotovo: string } | { greska: string; trajnaGreska: boolean }`
  - `sljedeciBackup(s: BackupStanje, sada: Date, start: Date): Date`
  - `trajnaGreska(s: BackupStanje, sada: Date): boolean`
  - `ukupniProcenat(faza: BackupFaza, procenat: number): number`
  - konstante `INTERVAL_MS`, `PONOVO_NAKON_GRESKE_MS`, `ODGODA_STARTA_MS`, `TRAJNA_GRESKA_MS`

- [ ] **Step 1: Failing test**

```ts
// src/lib/backupRaspored.test.ts
import { test, expect } from 'bun:test';
import { sljedeciBackup, trajnaGreska, ukupniProcenat } from './backupRaspored';

const start = new Date('2026-09-25T08:00:00Z');
const min = (n: number) => new Date(start.getTime() + n * 60_000);
const iso = (d: Date) => d.toISOString();

test('nikad uspjeha: minut nakon starta', () => {
  expect(sljedeciBackup({}, start, start)).toEqual(min(1));
});

test('nikad uspjeha, aplikacija radi duže: odmah (sada)', () => {
  expect(sljedeciBackup({}, min(90), start)).toEqual(min(90));
});

test('uspjeh stariji od 3 h: minut nakon starta', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-300)) }, start, start)).toEqual(min(1));
});

test('uspjeh prije sat vremena: uspjeh + 3 h', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-60)) }, start, start)).toEqual(min(120));
});

test('zadnji pokušaj pao: pokušaj + 15 min, i kad uspjeha nikad nije bilo', () => {
  const s = { zadnjiPokusaj: iso(min(10)), greska: 'Nema veze s R2', greskaOd: iso(min(10)) };
  expect(sljedeciBackup(s, min(11), start)).toEqual(min(25));
  expect(sljedeciBackup({ ...s, zadnjiUspjeh: iso(min(-600)) }, min(11), start)).toEqual(min(25));
});

test('pad prije pola sata, nakon restarta: minut nakon starta', () => {
  const s = { zadnjiPokusaj: iso(min(-30)), greska: 'x', greskaOd: iso(min(-30)) };
  expect(sljedeciBackup(s, start, start)).toEqual(min(1));
});

test('sat vraćen unazad (uspjeh u budućnosti): ne čeka taj datum', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(60 * 24 * 30)) }, start, start)).toEqual(min(1));
});

test('pokušaj bez greške (aplikacija ugašena usred backup-a) ne znači grešku', () => {
  expect(sljedeciBackup({ zadnjiUspjeh: iso(min(-60)), zadnjiPokusaj: iso(min(-5)) }, start, start)).toEqual(min(120));
});

test('trajna greška: bez uspjeha duže od 24 h', () => {
  const dan = 24 * 60;
  expect(trajnaGreska({}, start)).toBe(false);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan + 1)) }, start)).toBe(false);
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-dan - 1)) }, start)).toBe(true);
  // Uspjeh prije 30 h, greške tek sat vremena (aplikacija bila ugašena): i dalje nema uspjeha 24 h.
  expect(trajnaGreska({ greska: 'x', greskaOd: iso(min(-60)), zadnjiUspjeh: iso(min(-30 * 60)) }, start)).toBe(true);
  expect(trajnaGreska({ zadnjiUspjeh: iso(min(-30 * 60)) }, start)).toBe(false);
});

test('ukupni procenat po fazama: kopija 0–10, šifrovanje 10–20, slanje 20–100', () => {
  expect(ukupniProcenat('kopija', 0)).toBe(0);
  expect(ukupniProcenat('kopija', 100)).toBe(10);
  expect(ukupniProcenat('sifrovanje', 50)).toBe(15);
  expect(ukupniProcenat('slanje', 0)).toBe(20);
  expect(ukupniProcenat('slanje', 50)).toBe(60);
  expect(ukupniProcenat('slanje', 100)).toBe(100);
});
```

- [ ] **Step 2:** `bun test src/lib/backupRaspored.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 3: Implementacija**

```ts
// src/lib/backupRaspored.ts
// Automatski backup: stanje, raspored i napredak. Čist modul bez Node-a —
// koriste ga main proces (src/lib/backupTok.ts) i renderer (traka, Postavke).
// Rust backend (faza 4) mora dati iste odgovore. Spec:
// docs/superpowers/specs/2026-09-25-r2-backup-design.md

export const INTERVAL_MS = 3 * 60 * 60 * 1000;
export const PONOVO_NAKON_GRESKE_MS = 15 * 60 * 1000;
export const ODGODA_STARTA_MS = 60 * 1000;
export const TRAJNA_GRESKA_MS = 24 * 60 * 60 * 1000;

/** `userData/backup-stanje.json` — van baze, jer se baza backup-uje i vraća. */
export interface BackupStanje {
  zadnjiUspjeh?: string;
  zadnjiPokusaj?: string;
  greska?: string;
  /** Prvi pad u nizu; briše se uspjehom. */
  greskaOd?: string;
}

/** Odgovor kanala `backup:info`. */
export interface BackupInfo {
  /** Licenca važi i ima backup. */
  aktivan: boolean;
  bucket?: string;
  zadnjiUspjeh?: string;
  greska?: string;
  greskaOd?: string;
  sljedeci?: string;
  uToku: boolean;
}

export type BackupFaza = 'kopija' | 'sifrovanje' | 'slanje';

/** Događaj `backup:stanje`. `procenat` je unutar faze (0–100). */
export type BackupDogadjaj =
  | { faza: BackupFaza; procenat: number }
  | { gotovo: string }
  | { greska: string; trajnaGreska: boolean };

const ms = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/**
 * Kada je sljedeći backup. Pao pokušaj → pokušaj + 15 min; inače uspjeh + 3 h
 * (nikad uspjeha ili uspjeh "u budućnosti" zbog vraćenog sata → odmah). Nikad
 * prije `start + 1 min` (aplikacija se prvo pokrene) ni prije `sada`.
 */
export function sljedeciBackup(s: BackupStanje, sada: Date, start: Date): Date {
  const t = sada.getTime();
  const pokusaj = ms(s.zadnjiPokusaj);
  const uspjeh = ms(s.zadnjiUspjeh);
  let kandidat: number;
  if (s.greska && pokusaj <= t) kandidat = pokusaj + PONOVO_NAKON_GRESKE_MS;
  else kandidat = Number.isNaN(uspjeh) || uspjeh > t ? -Infinity : uspjeh + INTERVAL_MS;
  return new Date(Math.max(kandidat, start.getTime() + ODGODA_STARTA_MS, t));
}

/** Backup pada i uspjeha nema duže od 24 h. */
export function trajnaGreska(s: BackupStanje, sada: Date): boolean {
  if (!s.greska) return false;
  const od = s.zadnjiUspjeh ? ms(s.zadnjiUspjeh) : ms(s.greskaOd);
  return !Number.isNaN(od) && sada.getTime() - od > TRAJNA_GRESKA_MS;
}

const OPSEG: Record<BackupFaza, [number, number]> = { kopija: [0, 10], sifrovanje: [10, 20], slanje: [20, 100] };

/** Procenat cijelog backup-a iz faze i procenta unutar nje. */
export function ukupniProcenat(faza: BackupFaza, procenat: number): number {
  const [od, doP] = OPSEG[faza];
  return Math.round(od + ((doP - od) * Math.min(100, Math.max(0, procenat))) / 100);
}
```

Napomena: `s.greska && pokusaj <= t` — kad je `pokusaj` NaN, poređenje je `false`, pa pada na granu uspjeha (ispravno).

- [ ] **Step 4:** `bun test src/lib/backupRaspored.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/backupRaspored.ts src/lib/backupRaspored.test.ts
git commit -m "feat(backup): raspored i stanje automatskog backup-a"
```

---

### Task 2: `r2Posalji` s napretkom po bajtovima, `R2Greska` sa statusom

**Files:**
- Modify: `src/lib/r2.ts` (`zahtjev`, `r2Posalji`)
- Test: `src/lib/r2.test.ts`

**Interfaces:**
- Produces:
  - `class R2Greska extends Error { status?: number }` — baca je svaki R2 poziv (mreža: bez `status`)
  - `r2Posalji(r2: R2Pristup, kljuc: string, tijelo: Uint8Array, napredak?: (poslano: number, ukupno: number) => void): Promise<void>`
  - poruke grešaka ostaju iste (`R2 je odbio pristup (403 AccessDenied): …`, `Nema veze s R2 (…)`) — `tools/backup` i postojeći testovi se ne mijenjaju.

- [ ] **Step 1: Failing testovi** (dodati na kraj `src/lib/r2.test.ts`; `R2Greska` dodati u import na vrhu)

```ts
test('r2Posalji: napredak po bajtovima, tijelo stiže cijelo s dužinom', async () => {
  const primljeno: { duzina: string | null; tijelo: Uint8Array }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      primljeno.push({ duzina: req.headers.get('content-length'), tijelo: new Uint8Array(await req.arrayBuffer()) });
      return new Response(null, { status: 200 });
    },
  });
  try {
    const tijelo = new Uint8Array(300_000).map((_, i) => i % 251);
    const napredak: [number, number][] = [];
    await r2Posalji(pristup(server.url.origin), 'A/x.db.age', tijelo, (p, u) => napredak.push([p, u]));
    expect(primljeno[0].duzina).toBe('300000');
    expect(primljeno[0].tijelo).toEqual(tijelo);
    expect(napredak.length).toBeGreaterThan(1);
    expect(napredak.at(-1)).toEqual([300_000, 300_000]);
    for (let i = 1; i < napredak.length; i++) expect(napredak[i][0]).toBeGreaterThan(napredak[i - 1][0]);
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: 403 je R2Greska sa statusom, poruka ostaje ista', async () => {
  const { server } = lazniS3();
  try {
    const e = await r2Posalji(pristup(server.url.origin, { accessKeyId: 'POGRESAN' }), 'x', new Uint8Array([1])).catch(x => x);
    expect(e).toBeInstanceOf(R2Greska);
    expect(e.status).toBe(403);
    expect(e.message).toContain('R2 je odbio pristup (403 AccessDenied)');
  } finally {
    server.stop(true);
  }
});

test('r2Posalji: nema servera → R2Greska bez statusa', async () => {
  const e = await r2Posalji(pristup('http://127.0.0.1:1'), 'x', new Uint8Array([1])).catch(x => x);
  expect(e).toBeInstanceOf(R2Greska);
  expect(e.status).toBeUndefined();
  expect(e.message).toStartWith('Nema veze s R2');
});

test('r2Posalji: server koji ne odgovara → greška nakon isteka vremena', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  try {
    const e = await r2Posalji(pristup(server.url.origin), 'x', new Uint8Array([1]), undefined, 200).catch(x => x);
    expect(e).toBeInstanceOf(R2Greska);
    expect(e.message).toContain('isteklo vrijeme');
  } finally {
    server.stop(true);
  }
});
```

(Peti argument `cekanjeMs` postoji samo zbog testa; podrazumijevano 120 000.)

- [ ] **Step 2:** `bun test src/lib/r2.test.ts` → novi testovi FAIL.

- [ ] **Step 3: Implementacija** — u `src/lib/r2.ts`:

Importi:
```ts
import { request as httpZahtjev } from 'node:http';
import { request as httpsZahtjev } from 'node:https';
```

Greška i zajednički dijelovi (zamijeniti postojeću `zahtjev` ovim):
```ts
/** Svaka greška R2 poziva. `status` je HTTP status; nema ga kad server nije ni odgovorio. */
export class R2Greska extends Error {
  constructor(poruka: string, readonly status?: number) {
    super(poruka);
    this.name = 'R2Greska';
  }
}

function greskaOdgovora(status: number, statusTekst: string, xml: string): R2Greska {
  const kod = xml.match(/<Code>([^<]*)<\/Code>/)?.[1] ?? '';
  const poruka = xml.match(/<Message>([^<]*)<\/Message>/)?.[1] ?? statusTekst;
  const opis = `${status}${kod ? ` ${kod}` : ''}`;
  return new R2Greska(status === 403 ? `R2 je odbio pristup (${opis}): ${poruka}` : `R2 greška (${opis}): ${poruka}`, status);
}

/** URL i potpisana zaglavlja (bez `host` — postavlja ga klijent). */
function pripremi(r2: R2Pristup, metoda: string, kljuc: string, upit: Record<string, string>, tijelo?: Uint8Array) {
  const baza = new URL(r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`);
  const putanja = `/${r2.bucket}${kljuc ? `/${kljuc}` : ''}`;
  const zaglavlja = potpisiS3({
    metoda, host: baza.host, putanja, upit, zaglavlja: {},
    hashTijela: sha256(tijelo ?? ''), accessKeyId: r2.accessKeyId, secret: r2.secret, region: 'auto', amzDatum: amzDatum(),
  });
  delete zaglavlja.host;
  const q = Object.keys(upit).sort().map(k => `${kodiraj(k)}=${kodiraj(upit[k])}`).join('&');
  return { url: new URL(`${baza.origin}${kodiraj(putanja, true)}${q ? `?${q}` : ''}`), zaglavlja };
}

async function zahtjev(r2: R2Pristup, metoda: string, kljuc: string, upit: Record<string, string> = {}): Promise<Response> {
  const { url, zaglavlja } = pripremi(r2, metoda, kljuc, upit);
  let odg: Response;
  try {
    odg = await fetch(url, { method: metoda, headers: zaglavlja });
  } catch (e) {
    throw new R2Greska(`Nema veze s R2 (${(e as Error).message})`);
  }
  if (!odg.ok) throw greskaOdgovora(odg.status, odg.statusText, await odg.text());
  return odg;
}
```

(`zahtjev` više ne prima tijelo — koriste ga samo GET i lista.)

`r2Posalji` (zamijeniti postojeći):
```ts
const KOMAD = 64 * 1024;

/**
 * PUT preko node:http(s), a ne fetch: fetch sa streamom šalje chunked bez
 * dužine, što R2 odbija, a bez streama nema napretka. `napredak` se javlja
 * kad komad ode na mrežu.
 */
export function r2Posalji(
  r2: R2Pristup, kljuc: string, tijelo: Uint8Array,
  napredak?: (poslano: number, ukupno: number) => void, cekanjeMs = 120_000,
): Promise<void> {
  const { url, zaglavlja } = pripremi(r2, 'PUT', kljuc, {}, tijelo);
  return new Promise((resolve, reject) => {
    const posalji = url.protocol === 'https:' ? httpsZahtjev : httpZahtjev;
    const z = posalji(url, { method: 'PUT', headers: { ...zaglavlja, 'content-length': String(tijelo.length) } }, odg => {
      const dijelovi: Buffer[] = [];
      odg.on('data', (d: Buffer) => dijelovi.push(d));
      odg.on('end', () => {
        const status = odg.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else reject(greskaOdgovora(status, odg.statusMessage ?? '', Buffer.concat(dijelovi).toString('utf8')));
      });
      odg.on('error', e => reject(new R2Greska(`Nema veze s R2 (${e.message})`)));
    });
    z.on('error', e => reject(new R2Greska(`Nema veze s R2 (${e.message})`)));
    z.setTimeout(cekanjeMs, () => z.destroy(new Error('isteklo vrijeme')));

    let poslano = 0;
    const salji = () => {
      while (poslano < tijelo.length) {
        const kraj = Math.min(poslano + KOMAD, tijelo.length);
        const komad = tijelo.subarray(poslano, kraj);
        poslano = kraj;
        if (!z.write(komad, () => napredak?.(kraj, tijelo.length))) {
          z.once('drain', salji);
          return;
        }
      }
      z.end();
    };
    salji();
  });
}
```

- [ ] **Step 4:** `bun test src/lib/r2.test.ts` → svi PASS (i stari: pošalji/izlistaj/preuzmi, greške servera).

- [ ] **Step 5: Stvarni R2** (PUT ide novim putem):
```bash
bun run backup posalji
bun run backup lista pazar-lunatik-doo
```
Očekivano: novi objekat s trenutnim vremenom u listi. Ako R2 odbije (npr. 411/`MissingContentLength` ili potpis), stati i javiti — ne mijenjati potpis nasumice.

- [ ] **Step 6: Commit**
```bash
git add src/lib/r2.ts src/lib/r2.test.ts
git commit -m "feat(r2): napredak slanja po bajtovima i R2Greska sa statusom"
```

---

### Task 3: Da li licenca dozvoljava backup

**Files:**
- Modify: `src/lib/licencaStanje.ts`, `src/lib/licencaStanje.test.ts`
- Modify: `src/ipc/licenca.ts`

**Interfaces:**
- Consumes: `smijeRaditi(s)` (postoji), `backupPodaci(token)` iz `src/lib/licenca.ts` (postoji), `R2Podaci`.
- Produces:
  - `backupDozvoljen(s: StanjeLicence): boolean` (licencaStanje.ts)
  - `backupPristup(): R2Podaci | null` (src/ipc/licenca.ts; samo main proces)

- [ ] **Step 1: Failing test** (u `src/lib/licencaStanje.test.ts`; dodati `backupDozvoljen` u import)

```ts
test('backup: samo kad licenca radi i ima backup', () => {
  const licenca = { klijent: 'Pekara', vrijediDo: '2026-10-31', izdana: '2026-10-01' };
  const sa = { ...licenca, backup: { bucket: 'pazar-pekara' } };
  expect(backupDozvoljen({ stanje: 'aktivna', licenca: sa, danaDoIsteka: 20 })).toBe(true);
  expect(backupDozvoljen({ stanje: 'upozorenje', licenca: sa, danaDoIsteka: 3 })).toBe(true);
  expect(backupDozvoljen({ stanje: 'milost', licenca: sa, danaDoBlokade: 5 })).toBe(true);
  expect(backupDozvoljen({ stanje: 'zakljucana', licenca: sa })).toBe(false);
  expect(backupDozvoljen({ stanje: 'aktivna', licenca, danaDoIsteka: 20 })).toBe(false);
  expect(backupDozvoljen({ stanje: 'nema' })).toBe(false);
  expect(backupDozvoljen({ stanje: 'neispravna', razlog: 'potpis' })).toBe(false);
});
```

- [ ] **Step 2:** `bun test src/lib/licencaStanje.test.ts` → FAIL.

- [ ] **Step 3: Implementacija**

`src/lib/licencaStanje.ts` (ispod `smijeRaditi`):
```ts
/** Automatski backup radi dok program smije raditi i licenca ima `backup`. */
export function backupDozvoljen(s: StanjeLicence): boolean {
  return smijeRaditi(s) && 'licenca' in s && !!s.licenca.backup;
}
```

`src/ipc/licenca.ts` — importi `backupPodaci, type R2Podaci` iz `../lib/licenca` i `backupDozvoljen` iz `../lib/licencaStanje`, pa:
```ts
/** R2 podaci za automatski backup; null kad licenca ne važi ili nema backup. Samo main proces. */
export function backupPristup(): R2Podaci | null {
  if (!backupDozvoljen(stanjeLicence())) return null;
  const token = procitaj().token;
  return token ? backupPodaci(token) : null;
}
```

- [ ] **Step 4:** `bun test src/lib/licencaStanje.test.ts src/lib/licenca.test.ts` → PASS; `bunx tsc --noEmit -p .` bez novih grešaka u ovim fajlovima.
- [ ] **Step 5: Commit**
```bash
git add src/lib/licencaStanje.ts src/lib/licencaStanje.test.ts src/ipc/licenca.ts
git commit -m "feat(backup): licenca odlučuje da li backup radi"
```

---

### Task 4: Motor backup-a (`backupTok.ts`)

**Files:**
- Create: `src/lib/backupTok.ts`
- Test: `src/lib/backupTok.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BackupStanje`, `BackupInfo`, `BackupDogadjaj`, `sljedeciBackup`, `trajnaGreska`), Task 2 (`R2Greska`, `R2Pristup`, `imeBackupa`), `sifrujBackup` (postoji), `R2Podaci`.
- Produces:
  ```ts
  interface BackupOkruzenje {
    pristup(): R2Podaci | null;
    citajStanje(): BackupStanje;
    pisiStanje(s: BackupStanje): void;
    /** Dosljedna kopija baze; sam čisti svoj temp fajl. */
    kopijaBaze(): Uint8Array | Promise<Uint8Array>;
    posalji(r2: R2Pristup, kljuc: string, tijelo: Uint8Array, napredak: (poslano: number, ukupno: number) => void): Promise<void>;
    javi(d: BackupDogadjaj): void;
    uredjaj(): string;
    sada(): Date;
    endpoint?: string;
  }
  napraviBackup(o: BackupOkruzenje): { info(): BackupInfo; sada(): Promise<BackupInfo>; tick(): Promise<void> }
  porukaGreske(e: unknown): string
  const NEMA_BACKUPA = 'Automatski backup nije uključen u licencu.'
  ```

- [ ] **Step 1: Failing testovi**

```ts
// src/lib/backupTok.test.ts
import { test, expect, beforeEach } from 'bun:test';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { gunzipSync } from 'node:zlib';
import { Decrypter } from 'age-encryption';
import { napraviBackup, NEMA_BACKUPA, type BackupOkruzenje } from './backupTok';
import { R2Greska, type R2Pristup } from './r2';
import type { BackupDogadjaj, BackupStanje } from './backupRaspored';
import type { R2Podaci } from './licenca';

const identitet = await generateIdentity();
const R2: R2Podaci = { accountId: 'acc', accessKeyId: 'K', secret: 'S', bucket: 'pazar-test', primalac: await identityToRecipient(identitet) };
const BAZA = new TextEncoder().encode('SQLite format 3\0 lažna baza');
const START = new Date('2026-09-25T08:00:00Z');
const min = (n: number) => new Date(START.getTime() + n * 60_000);

let sat: Date;
let stanje: BackupStanje;
let dogadjaji: BackupDogadjaj[];
let poslano: { r2: R2Pristup; kljuc: string; tijelo: Uint8Array }[];
let greskaSlanja: Error | null;
let o: BackupOkruzenje;

beforeEach(() => {
  sat = START;
  stanje = {};
  dogadjaji = [];
  poslano = [];
  greskaSlanja = null;
  o = {
    pristup: () => R2,
    citajStanje: () => stanje,
    pisiStanje: s => { stanje = s; },
    kopijaBaze: () => BAZA,
    async posalji(r2, kljuc, tijelo, napredak) {
      if (greskaSlanja) throw greskaSlanja;
      napredak(tijelo.length / 2, tijelo.length);
      napredak(tijelo.length, tijelo.length);
      poslano.push({ r2, kljuc, tijelo });
    },
    javi: d => { dogadjaji.push(d); },
    uredjaj: () => 'AAAA-BBBB-CCCC',
    sada: () => sat,
    endpoint: 'http://lazni',
  };
});

async function desifruj(f: Uint8Array) {
  const d = new Decrypter();
  d.addIdentity(identitet);
  return new Uint8Array(gunzipSync(await d.decrypt(f)));
}

test('bez backup-a u licenci: neaktivan, "Backup sada" odbija', async () => {
  o.pristup = () => null;
  const b = napraviBackup(o);
  expect(b.info()).toEqual({ aktivan: false, uToku: false });
  await expect(b.sada()).rejects.toThrow(NEMA_BACKUPA);
});

test('uspjeh: šifrovana baza pod imenom uređaj/vrijeme, događaji redom, stanje upisano', async () => {
  const b = napraviBackup(o);
  sat = min(2);
  const info = await b.sada();
  expect(poslano).toHaveLength(1);
  expect(poslano[0].kljuc).toBe('AAAA-BBBB-CCCC/2026-09-25T08-02-00Z.db.age');
  expect(poslano[0].r2).toMatchObject({ bucket: 'pazar-test', endpoint: 'http://lazni' });
  expect(await desifruj(poslano[0].tijelo)).toEqual(BAZA);
  expect(dogadjaji).toEqual([
    { faza: 'kopija', procenat: 0 },
    { faza: 'sifrovanje', procenat: 0 },
    { faza: 'slanje', procenat: 0 },
    { faza: 'slanje', procenat: 50 },
    { faza: 'slanje', procenat: 100 },
    { gotovo: min(2).toISOString() },
  ]);
  expect(stanje).toEqual({ zadnjiUspjeh: min(2).toISOString(), zadnjiPokusaj: min(2).toISOString() });
  expect(info).toEqual({
    aktivan: true, bucket: 'pazar-test', uToku: false,
    zadnjiUspjeh: min(2).toISOString(), sljedeci: min(182).toISOString(),
  });
});

test('403: čitljiva poruka, greška u stanju, greskaOd ostaje od prvog pada, uspjeh je briše', async () => {
  const b = napraviBackup(o);
  greskaSlanja = new R2Greska('R2 je odbio pristup (403 AccessDenied): Access Denied', 403);
  sat = min(2);
  const info = await b.sada();
  expect(info.greska).toBe('R2 pristup više ne važi — zatražite novu licencu');
  expect(dogadjaji.at(-1)).toEqual({ greska: 'R2 pristup više ne važi — zatražite novu licencu', trajnaGreska: false });
  expect(stanje.greskaOd).toBe(min(2).toISOString());

  greskaSlanja = new R2Greska('Nema veze s R2 (ECONNREFUSED)');
  sat = min(20);
  await b.sada();
  expect(stanje).toMatchObject({ greska: 'Nema veze s R2 (ECONNREFUSED)', greskaOd: min(2).toISOString(), zadnjiPokusaj: min(20).toISOString() });

  greskaSlanja = null;
  sat = min(40);
  await b.sada();
  expect(stanje).toEqual({ zadnjiUspjeh: min(40).toISOString(), zadnjiPokusaj: min(40).toISOString() });
});

test('trajna greška kad uspjeha nema duže od 24 h', async () => {
  stanje = { greska: 'x', greskaOd: min(-25 * 60).toISOString(), zadnjiPokusaj: min(-20).toISOString() };
  greskaSlanja = new Error('Nema veze s R2 (offline)');
  await napraviBackup(o).sada();
  expect(dogadjaji.at(-1)).toEqual({ greska: 'Nema veze s R2 (offline)', trajnaGreska: true });
});

test('pad kopije baze je obična greška backup-a', async () => {
  o.kopijaBaze = () => { throw new Error('disk pun'); };
  const info = await napraviBackup(o).sada();
  expect(info.greska).toBe('disk pun');
  expect(poslano).toHaveLength(0);
});

test('"Backup sada" dok backup teče: jedno slanje, isti rezultat', async () => {
  let pusti!: () => void;
  const ceka = new Promise<void>(r => { pusti = r; });
  const staro = o.posalji;
  o.posalji = async (...a) => { await ceka; return staro(...a); };
  const b = napraviBackup(o);
  const p1 = b.sada();
  const p2 = b.sada();
  expect(b.info().uToku).toBe(true);
  pusti();
  const [i1, i2] = await Promise.all([p1, p2]);
  expect(poslano).toHaveLength(1);
  expect(i1).toEqual(i2);
  expect(i1.uToku).toBe(false);
});

test('ništa iz okruženja ne izlazi kao izuzetak (kasa radi dalje)', async () => {
  o.citajStanje = () => { throw new SyntaxError('Unexpected end of JSON input'); };
  o.pisiStanje = () => { throw new Error('ENOSPC'); };
  o.javi = () => { throw new Error('prozor zatvoren'); };
  const b = napraviBackup(o);
  expect(b.info()).toMatchObject({ aktivan: true, uToku: false });
  await expect(b.sada()).resolves.toMatchObject({ aktivan: true });
  await expect(b.tick()).resolves.toBeUndefined();

  o.pristup = () => { throw new Error('licenca.json oštećen'); };
  expect(napraviBackup(o).info()).toEqual({ aktivan: false, uToku: false });
  await expect(napraviBackup(o).tick()).resolves.toBeUndefined();
});

test('tick: minut nakon starta, pa svaka 3 h; nakon pada za 15 min', async () => {
  const b = napraviBackup(o);
  await b.tick();
  expect(poslano).toHaveLength(0);
  sat = min(1);
  await b.tick();
  expect(poslano).toHaveLength(1);

  sat = min(1 + 179);
  await b.tick();
  expect(poslano).toHaveLength(1);
  greskaSlanja = new Error('offline');
  sat = min(1 + 180);
  await b.tick();
  expect(stanje.greska).toBe('offline');

  greskaSlanja = null;
  sat = min(181 + 14);
  await b.tick();
  expect(poslano).toHaveLength(1);
  sat = min(181 + 15);
  await b.tick();
  expect(poslano).toHaveLength(2);
});

test('tick ne radi ništa kad licenca izgubi backup', async () => {
  const b = napraviBackup(o);
  o.pristup = () => null;
  sat = min(10);
  await b.tick();
  expect(poslano).toHaveLength(0);
  expect(dogadjaji).toHaveLength(0);
});
```

- [ ] **Step 2:** `bun test src/lib/backupTok.test.ts` → FAIL (modul ne postoji).

- [ ] **Step 3: Implementacija**

```ts
// src/lib/backupTok.ts
// Motor automatskog backup-a, bez Electrona: kopija baze → age → R2, stanje,
// događaji i raspored. Sve spoljašnje (disk, baza, mreža, prozori, sat) dolazi
// kroz `BackupOkruzenje` — Electron sloj je src/ipc/backup.ts. Ništa odavde ne
// smije baciti izuzetak u kasu: greška backup-a ide u stanje i događaj.
import { sifrujBackup } from './backupFajl';
import { sljedeciBackup, trajnaGreska, type BackupDogadjaj, type BackupInfo, type BackupStanje } from './backupRaspored';
import type { R2Podaci } from './licenca';
import { imeBackupa, R2Greska, type R2Pristup } from './r2';

export const NEMA_BACKUPA = 'Automatski backup nije uključen u licencu.';

export interface BackupOkruzenje {
  /** R2 podaci iz licence; null = licenca ne važi ili nema backup. */
  pristup(): R2Podaci | null;
  citajStanje(): BackupStanje;
  pisiStanje(s: BackupStanje): void;
  /** Dosljedna kopija baze; sam čisti svoj temp fajl. */
  kopijaBaze(): Uint8Array | Promise<Uint8Array>;
  posalji(r2: R2Pristup, kljuc: string, tijelo: Uint8Array, napredak: (poslano: number, ukupno: number) => void): Promise<void>;
  javi(d: BackupDogadjaj): void;
  uredjaj(): string;
  sada(): Date;
  /** `PAZAR_BACKUP_ENDPOINT` (testovi); inače R2 po accountId. */
  endpoint?: string;
}

/** Poruka za korisnika. Bez kredencijala — R2 poruke ih ne sadrže. */
export function porukaGreske(e: unknown): string {
  if (e instanceof R2Greska && e.status === 403) return 'R2 pristup više ne važi — zatražite novu licencu';
  return e instanceof Error ? e.message : String(e);
}

export function napraviBackup(o: BackupOkruzenje) {
  const start = o.sada();
  let tekuci: Promise<BackupInfo> | null = null;

  const pristup = () => { try { return o.pristup(); } catch { return null; } };
  const stanje = (): BackupStanje => { try { return o.citajStanje() ?? {}; } catch { return {}; } };
  const pisi = (s: BackupStanje) => {
    try { o.pisiStanje(s); } catch (e) { console.error('Backup: stanje nije upisano:', porukaGreske(e)); }
  };
  const javi = (d: BackupDogadjaj) => { try { o.javi(d); } catch { /* prozor zatvoren */ } };

  function info(): BackupInfo {
    const r2 = pristup();
    if (!r2) return { aktivan: false, uToku: !!tekuci };
    const s = stanje();
    return {
      aktivan: true,
      bucket: r2.bucket,
      uToku: !!tekuci,
      ...(s.zadnjiUspjeh ? { zadnjiUspjeh: s.zadnjiUspjeh } : {}),
      ...(s.greska ? { greska: s.greska, ...(s.greskaOd ? { greskaOd: s.greskaOd } : {}) } : {}),
      sljedeci: sljedeciBackup(s, o.sada(), start).toISOString(),
    };
  }

  async function izvrsi(r2: R2Podaci): Promise<void> {
    const pocetak = o.sada();
    pisi({ ...stanje(), zadnjiPokusaj: pocetak.toISOString() });
    try {
      javi({ faza: 'kopija', procenat: 0 });
      const baza = await o.kopijaBaze();
      javi({ faza: 'sifrovanje', procenat: 0 });
      const fajl = await sifrujBackup(baza, r2.primalac);
      javi({ faza: 'slanje', procenat: 0 });
      let zadnji = 0;
      const { primalac: _, ...pristupR2 } = r2;
      await o.posalji({ ...pristupR2, ...(o.endpoint ? { endpoint: o.endpoint } : {}) }, imeBackupa(o.uredjaj(), pocetak), fajl, (p, u) => {
        const procenat = u ? Math.floor((p / u) * 100) : 100;
        if (procenat > zadnji) { zadnji = procenat; javi({ faza: 'slanje', procenat }); }
      });
      const kraj = o.sada().toISOString();
      pisi({ zadnjiUspjeh: kraj, zadnjiPokusaj: pocetak.toISOString() });
      javi({ gotovo: kraj });
    } catch (e) {
      const poruka = porukaGreske(e);
      const s = stanje();
      const novo: BackupStanje = { ...s, zadnjiPokusaj: pocetak.toISOString(), greska: poruka, greskaOd: s.greskaOd ?? pocetak.toISOString() };
      pisi(novo);
      console.error('Backup nije uspio:', poruka);
      javi({ greska: poruka, trajnaGreska: trajnaGreska(novo, o.sada()) });
    }
  }

  /** Pokreće backup ili vraća tekući. Čeka kraj; greška backup-a je u `info.greska`. */
  function sada(): Promise<BackupInfo> {
    if (tekuci) return tekuci;
    const r2 = pristup();
    if (!r2) return Promise.reject(new Error(NEMA_BACKUPA));
    tekuci = izvrsi(r2).finally(() => { tekuci = null; }).then(() => info());
    return tekuci;
  }

  /** Zove se svake minute: pokrene backup kad je vrijeme. */
  async function tick(): Promise<void> {
    if (tekuci || !pristup()) return;
    const t = o.sada();
    if (t.getTime() >= sljedeciBackup(stanje(), t, start).getTime()) await sada().catch(() => undefined);
  }

  return { info, sada, tick };
}
```

Pažnja: `tekuci = izvrsi(...).finally(...).then(...)` — `finally` postavi `tekuci = null` prije nego `then` pozove `info()`, pa rezultat ima `uToku: false`. Test "dok backup teče" to provjerava.

- [ ] **Step 4:** `bun test src/lib/backupTok.test.ts` → PASS. Ako `toEqual` na `info` pada zbog reda ključeva — ne pada (toEqual ne gleda red); ako pada zbog `undefined` polja, provjeriti da se polja dodaju samo kad postoje (kao gore).
- [ ] **Step 5: Commit**
```bash
git add src/lib/backupTok.ts src/lib/backupTok.test.ts
git commit -m "feat(backup): motor automatskog backup-a (jedan istovremeno, stanje, događaji, raspored)"
```

---

### Task 5: Kanali `backup:*` u Electronu + ugovorni testovi

**Files:**
- Create: `src/ipc/backup.ts`
- Modify: `src/ipc/handlers.ts` (kanali, `licenca:aktiviraj`)
- Modify: `src/ipc/ugovor/backend.ts`, `src/ipc/ugovor/tsBackend.ts`, `src/ipc/ugovor/rustBackend.ts`, `src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts`
- Create: `src/ipc/ugovor/laziS3.ts`, `src/ipc/ugovor/backup.ugovor.test.ts`

**Interfaces:**
- Consumes: `napraviBackup`, `NEMA_BACKUPA` (Task 4), `backupPristup` (Task 3), `r2Posalji` (Task 2), `potpisiS3` (postoji), `getDb` (postoji), `uredjajId` (postoji).
- Produces:
  - `src/ipc/backup.ts`: `registrujBackup(): void`, `backupInfo(): BackupInfo`, `backupSada(): Promise<BackupInfo>`, `backupNakonAktivacije(): void`, `pokreniRaspored(): void`, `zaustaviRaspored(): void`
  - kanali `backup:info`, `backup:sada`; događaj `backup:stanje` (`webContents.send('backup:stanje', BackupDogadjaj)`)
  - `Backend.postaviBackupLicencu(r2: R2Podaci | null): void`, `Backend.dogadjaji: { ime: string; podaci: unknown }[]`
  - `pokreniLaziS3(opcije?: { status?: number }): LaziS3` gdje `LaziS3 = { url: string; zahtjevi: S3Zahtjev[]; status: number; stop(): void }`, `S3Zahtjev = { metoda: string; bucket: string; kljuc: string; tijelo: Uint8Array; potpisIspravan: boolean; hashIspravan: boolean }`

- [ ] **Step 1: Harness — lažni S3**

```ts
// src/ipc/ugovor/laziS3.ts
// Lažni S3 za ugovor backup-a: prima PUT, provjerava SigV4 potpis (ponovo ga
// računa s poznatim tajnim ključem) i SHA-256 tijela. Rust backend (faza 4)
// mora proći iste provjere — to je jedini dokaz da ga R2 neće odbiti.
import { createHash } from 'node:crypto';
import { potpisiS3 } from '../../lib/r2';

export const S3_KLJUC = 'UGOVOR-KLJUC';
export const S3_TAJNA = 'ugovor-tajna';

export interface S3Zahtjev {
  metoda: string;
  bucket: string;
  kljuc: string;
  tijelo: Uint8Array;
  potpisIspravan: boolean;
  hashIspravan: boolean;
}

export interface LaziS3 {
  url: string;
  zahtjevi: S3Zahtjev[];
  /** Status kojim server odgovara (200, 403, 500…). */
  status: number;
  stop(): void;
}

export function pokreniLaziS3(): LaziS3 {
  const s3: LaziS3 = { url: '', zahtjevi: [], status: 200, stop: () => undefined };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const tijelo = new Uint8Array(await req.arrayBuffer());
      const [, bucket, ...dijelovi] = url.pathname.split('/');
      const hash = req.headers.get('x-amz-content-sha256') ?? '';
      const auth = req.headers.get('authorization') ?? '';
      const potpisana = auth.match(/SignedHeaders=([^,]+)/)?.[1].split(';') ?? [];
      const zaglavlja: Record<string, string> = {};
      for (const k of potpisana) if (k !== 'host' && k !== 'x-amz-content-sha256' && k !== 'x-amz-date') zaglavlja[k] = req.headers.get(k) ?? '';
      const ocekivano = potpisiS3({
        metoda: req.method, host: url.host, putanja: decodeURIComponent(url.pathname), upit: Object.fromEntries(url.searchParams),
        zaglavlja, hashTijela: hash, accessKeyId: S3_KLJUC, secret: S3_TAJNA, region: 'auto', amzDatum: req.headers.get('x-amz-date') ?? '',
      }).authorization;
      s3.zahtjevi.push({
        metoda: req.method, bucket, kljuc: decodeURIComponent(dijelovi.join('/')), tijelo,
        potpisIspravan: auth === ocekivano,
        hashIspravan: hash === createHash('sha256').update(tijelo).digest('hex'),
      });
      if (s3.status === 403) return new Response('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 });
      return new Response(null, { status: s3.status });
    },
  });
  s3.url = server.url.origin;
  s3.stop = () => server.stop(true);
  return s3;
}
```

- [ ] **Step 2: Harness — `Backend` dobija licencu s backup-om i događaje**

`src/ipc/ugovor/backend.ts` — u `interface Backend` dodati:
```ts
  /**
   * R2 podaci koje "licenca" daje automatskom backup-u (null = licenca bez
   * backup-a). Token → R2 podaci imaju svoje testove (licenca.test.ts, licenca.rs).
   */
  postaviBackupLicencu(r2: import('../../lib/licenca').R2Podaci | null): void;
  /** Događaji koje je backend poslao prozoru (`backup:stanje`, `licenca:blokirano`…), redom. */
  dogadjaji: { ime: string; podaci: unknown }[];
```

`src/ipc/ugovor/tsBackend.ts`:
- na vrhu, pored `otvoreniDijalozi`:
```ts
const dogadjaji: { ime: string; podaci: unknown }[] = [];
let backupR2: import('../../lib/licenca').R2Podaci | null = null;
```
- u `mock.module('electron', …)` zamijeniti `BrowserWindow`:
```ts
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: (ime: string, podaci: unknown) => { dogadjaji.push({ ime, podaci: JSON.parse(JSON.stringify(podaci ?? null)) }); } } }],
  },
```
- u mock `../licenca.ts` dodati `backupPristup: () => backupR2,`
- u `otvoriTsBackend()` uz ostala resetovanja: `dogadjaji.length = 0; backupR2 = null;`
- u vraćeni objekat: `dogadjaji, postaviBackupLicencu: (r2) => { backupR2 = r2; },`

`src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts` — u mock `../licenca.ts` dodati `backupPristup: () => null,` (inače import u `src/ipc/backup.ts` pada).

`src/ipc/ugovor/rustBackend.ts`:
- `const dogadjaji: { ime: string; podaci: unknown }[] = [];` prije `(async () => {`
- u petlji čitanja zamijeniti `else if (o.dogadjaj === 'restart') restart = true;` sa:
```ts
        else if (o.dogadjaj === 'restart') restart = true;
        else if (o.dogadjaj) dogadjaji.push({ ime: o.dogadjaj, podaci: (o as { podaci?: unknown }).podaci ?? null });
```
- u vraćeni objekat:
```ts
    dogadjaji,
    postaviBackupLicencu() {
      throw new Error('Rust backend još nema automatski backup (faza 4, vidi spec)');
    },
```

- [ ] **Step 3: Failing ugovorni test**

```ts
// src/ipc/ugovor/backup.ugovor.test.ts
// Ugovor automatskog backup-a: backup:info, backup:sada i događaj
// backup:stanje, protiv lažnog S3 (PAZAR_BACKUP_ENDPOINT). Tijelo se
// dešifruje JS age-om i otvara kao baza — za Rust (faza 4) to je i interop.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { desifrujBackup } from '../../lib/backupFajl';
import type { R2Podaci } from '../../lib/licenca';
import { otvoriBackend, type Backend } from './backend';
import { pokreniLaziS3, S3_KLJUC, S3_TAJNA, type LaziS3 } from './laziS3';

const IME = /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.db\.age$/;

// Rust backend dobija backup:* u fazi 4 — do tada ovaj ugovor važi samo za TS.
describe.skipIf(process.env.KASA_BACKEND === 'rust')('backup:*', () => {
  let b: Backend;
  let s3: LaziS3;
  let identitet: string;
  let r2: R2Podaci;

  beforeEach(async () => {
    s3 = pokreniLaziS3();
    process.env.PAZAR_BACKUP_ENDPOINT = s3.url;
    identitet = await generateIdentity();
    r2 = { accountId: 'ugovor', accessKeyId: S3_KLJUC, secret: S3_TAJNA, bucket: 'pazar-ugovor', primalac: await identityToRecipient(identitet) };
    b = await otvoriBackend();
  });

  afterEach(async () => {
    await b.close();
    s3.stop();
    delete process.env.PAZAR_BACKUP_ENDPOINT;
  });

  const stanjaBackupa = () => b.dogadjaji.filter(d => d.ime === 'backup:stanje').map(d => d.podaci as Record<string, unknown>);

  test('licenca bez backup-a: info neaktivan, backup:sada odbija, ništa se ne šalje', async () => {
    expect(await b.call('backup:info')).toEqual({ aktivan: false, uToku: false });
    await expect(b.call('backup:sada')).rejects.toThrow('Automatski backup nije uključen u licencu.');
    expect(s3.zahtjevi).toHaveLength(0);
  });

  test('backup:sada šalje potpisanu, šifrovanu kopiju baze u bucket klijenta', async () => {
    b.postaviBackupLicencu(r2);
    b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac iz backup-a', '4200000000000')").run();

    const info = await b.call('backup:sada');
    expect(info.aktivan).toBe(true);
    expect(info.bucket).toBe('pazar-ugovor');
    expect(info.uToku).toBe(false);
    expect(typeof info.zadnjiUspjeh).toBe('string');
    expect(typeof info.sljedeci).toBe('string');
    expect(info.greska).toBeUndefined();

    expect(s3.zahtjevi).toHaveLength(1);
    const z = s3.zahtjevi[0];
    expect(z).toMatchObject({ metoda: 'PUT', bucket: 'pazar-ugovor', potpisIspravan: true, hashIspravan: true });
    expect(z.kljuc).toMatch(IME);

    const fajl = path.join(b.radniFolder, 'vraceno.db');
    writeFileSync(fajl, await desifrujBackup(z.tijelo, identitet));
    const vraceno = new Database(fajl, { readonly: true });
    expect(vraceno.prepare("SELECT naziv FROM kupci WHERE idBroj = '4200000000000'").get()).toEqual({ naziv: 'Kupac iz backup-a' });
    expect(vraceno.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    vraceno.close();

    const st = stanjaBackupa();
    expect(st[0]).toEqual({ faza: 'kopija', procenat: 0 });
    expect(st.map(s => s.faza).filter(Boolean)).toEqual(expect.arrayContaining(['kopija', 'sifrovanje', 'slanje']));
    expect(st.at(-1)).toEqual({ gotovo: info.zadnjiUspjeh });

    expect(await b.call('backup:info')).toMatchObject({ zadnjiUspjeh: info.zadnjiUspjeh });
  });

  test('R2 odbije (403): poruka za korisnika, greška u info i događaju, kasa radi dalje', async () => {
    b.postaviBackupLicencu(r2);
    s3.status = 403;
    const info = await b.call('backup:sada');
    expect(info.greska).toBe('R2 pristup više ne važi — zatražite novu licencu');
    expect(typeof info.greskaOd).toBe('string');
    expect(stanjaBackupa().at(-1)).toEqual({ greska: 'R2 pristup više ne važi — zatražite novu licencu', trajnaGreska: false });
    expect(await b.call('user:getAll')).toBeArray();
  });

  test('server nedostupan: greška, bez izuzetka', async () => {
    b.postaviBackupLicencu(r2);
    s3.stop();
    const info = await b.call('backup:sada');
    expect(info.greska).toStartWith('Nema veze s R2');
  });

  test('dva backup:sada odjednom: jedno slanje, isti odgovor', async () => {
    b.postaviBackupLicencu(r2);
    const [a, c] = await Promise.all([b.call('backup:sada'), b.call('backup:sada')]);
    expect(s3.zahtjevi).toHaveLength(1);
    expect(a).toEqual(c);
  });

  test('aktivacija licence s backup-om odmah pokreće prvi backup', async () => {
    b.postaviBackupLicencu(r2);
    await b.call('licenca:aktiviraj', 'PAZAR1.x.y');
    for (let i = 0; i < 100 && !stanjaBackupa().some(s => 'gotovo' in s); i++) await Bun.sleep(20);
    expect(s3.zahtjevi).toHaveLength(1);
  });
});
```

Napomene za izvršioca:
- Ako `kupci` nema kolonu `idBroj` u šemi koju pravi `getDb()`, koristiti bilo koju tabelu iz `src/database/schema.ts` s obaveznim kolonama — bitno je da se red vidi u vraćenoj bazi.
- Ne koristiti `toMatchObject({ x: expect.any(...) })` na objektu koji se kasnije čita (Bun 1.3 bug — vidi memoriju) — zato `typeof`.
- `server nedostupan` test: `s3.stop()` pa `afterEach` zove `stop()` opet — `server.stop(true)` dvaput je bezopasan; ako nije, u `afterEach` omotati u `try`.

- [ ] **Step 4:** `bun test src/ipc/ugovor/backup.ugovor.test.ts` → FAIL (`Kanal ne postoji: backup:info`).

- [ ] **Step 5: Electron sloj**

```ts
// src/ipc/backup.ts
// Automatski backup u Electron main procesu: veže motor (src/lib/backupTok.ts)
// za userData, bazu, prozore i tajmer. Stanje je u userData/backup-stanje.json
// (van baze). Kredencijali ne izlaze iz main procesa.
import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb } from '../database/db';
import type { BackupInfo } from '../lib/backupRaspored';
import { napraviBackup } from '../lib/backupTok';
import { r2Posalji } from '../lib/r2';
import { uredjajId } from '../lib/uredjaj';
import { backupPristup } from './licenca';

const PROVJERA_MS = 60_000;

const putanjaStanja = () => path.join(app.getPath('userData'), 'backup-stanje.json');

let motor: ReturnType<typeof napraviBackup> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

/** Pravi motor; zove ga registerIpcHandlers (i svaki ugovorni test ispočetka). */
export function registrujBackup(): void {
  motor = napraviBackup({
    pristup: backupPristup,
    citajStanje: () => (existsSync(putanjaStanja()) ? JSON.parse(readFileSync(putanjaStanja(), 'utf8')) : {}),
    pisiStanje: s => writeFileSync(putanjaStanja(), JSON.stringify(s, null, 2)),
    kopijaBaze: () => {
      // VACUUM INTO: dosljedna kopija i s WAL-om; sinhrono, ~desetine ms.
      const cilj = path.join(tmpdir(), `pazar-backup-${randomUUID()}.db`);
      try {
        getDb().prepare('VACUUM INTO ?').run(cilj);
        return new Uint8Array(readFileSync(cilj));
      } finally {
        rmSync(cilj, { force: true });
      }
    },
    posalji: (r2, kljuc, tijelo, napredak) => r2Posalji(r2, kljuc, tijelo, napredak),
    javi: d => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('backup:stanje', d); },
    uredjaj: uredjajId,
    sada: () => new Date(),
    endpoint: process.env.PAZAR_BACKUP_ENDPOINT,
  });
}

function m() {
  if (!motor) registrujBackup();
  return motor!;
}

export const backupInfo = (): BackupInfo => m().info();
export const backupSada = (): Promise<BackupInfo> => m().sada();

/** Nova licenca: ako ima backup, prvi backup odmah (to je i provjera R2 podataka). */
export function backupNakonAktivacije(): void {
  if (m().info().aktivan) void m().sada().catch(() => undefined);
}

export function pokreniRaspored(): void {
  interval ??= setInterval(() => { void m().tick(); }, PROVJERA_MS);
}

export function zaustaviRaspored(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
```

`src/ipc/handlers.ts`:
- import: `import { backupInfo, backupSada, backupNakonAktivacije, registrujBackup } from './backup';`
- zamijeniti liniju `handle('licenca:aktiviraj', …)`:
```ts
  handle('licenca:aktiviraj', (token: string) => {
    const info = aktivirajLicencu(token);
    backupNakonAktivacije();
    return info;
  });

  // ─── Automatski backup (src/ipc/backup.ts) ───
  registrujBackup();
  handle('backup:info', () => backupInfo());
  handle('backup:sada', () => backupSada());
```

- [ ] **Step 6: Temp fajl se briše i kad backup padne** — dodati u `backup.ugovor.test.ts` (unutar `describe`), jer to je jedini test koji ide kroz pravi `kopijaBaze`:
```ts
  test('temp kopija baze se briše i nakon uspjeha i nakon greške', async () => {
    const { readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const temp = () => readdirSync(tmpdir()).filter(f => f.startsWith('pazar-backup-'));
    const prije = temp().length;
    b.postaviBackupLicencu(r2);
    await b.call('backup:sada');
    s3.status = 500;
    await b.call('backup:sada');
    expect(temp().length).toBe(prije);
  });
```

- [ ] **Step 6b: Sesija i lista kanala** (od 2026-09-26 svaki kanal prolazi `provjeriPristup` iz `src/ipc/sesija.ts`):
  - `backup:info` traži prijavu (svaki prijavljeni — `BackupTraka` radi i kasiru); ne ide u `KANALI_BEZ_PRIJAVE`.
  - `backup:sada` je administratorski: dodati u `ADMIN_KANALI` u `src/ipc/sesija.ts` (uz `db:backup`). Prvi backup nakon `licenca:aktiviraj` ide interno, bez kanala, pa radi i bez prijave.
  - `src/ipc/ugovor/sesija.ugovor.test.ts`: u `SVI_KANALI` dodati `...(process.env.KASA_BACKEND === 'rust' ? [] : ['backup:info', 'backup:sada'])` s komentarom `// Rust: faza 4 (automatski backup)`; u tamošnji `ADMIN_KANALI` isto za `'backup:sada'`.
  - U `backup.ugovor.test.ts` dodati test: kasir (`dodajKorisnika` + `prijavi` kao u `audit.ugovor.test.ts`) dobija `backup:info`, a `backup:sada` odbija porukom `PORUKA_SAMO_ADMIN`.
  - `otvoriBackend()` se od sada sam prijavi kao admin — backup testovi to koriste bez izmjena.
  - `tsBackend.ts` ima `kanali()` i `ponovoPokreni()` — `registrujBackup()` se zove iz `registerIpcHandlers`, pa `ponovoPokreni` pravi novi motor (očekivano).

- [ ] **Step 7:** `bun test src/ipc/ugovor/backup.ugovor.test.ts` → PASS. Zatim cijeli ugovor i sve ostalo: `bun test` → PASS (ništa staro ne pada zbog novog `BrowserWindow` mocka ili `registrujBackup`).
- [ ] **Step 8:** `bun run test:rust` → PASS (backup testovi preskočeni, ostalo kao prije). Ako cargo build traje predugo ili nema toolchaina, javiti — ne preskakati tiho.
- [ ] **Step 9: Commit**
```bash
git add src/ipc/backup.ts src/ipc/handlers.ts src/ipc/ugovor/
git commit -m "feat(backup): kanali backup:info i backup:sada, događaj backup:stanje, ugovor protiv lažnog S3"
```

---

### Task 6: Raspored u main procesu i pretplata na događaje u rendereru

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ipc/api.ts`, `src/preload.ts`, `src/tauri/api.ts`, `src/global.d.ts`

**Interfaces:**
- Consumes: `pokreniRaspored`, `zaustaviRaspored` (Task 5); tipovi iz Task 1.
- Produces (renderer, `window.api`):
  - `getBackupInfo(): Promise<BackupInfo>`
  - `backupSada(): Promise<BackupInfo>`
  - `onBackupStanje(cb: (d: BackupDogadjaj) => void): () => void`
  - `napraviApi(pozovi: Pozovi, naDogadjaj: NaDogadjaj)` gdje `type NaDogadjaj = (ime: string, cb: (podaci: unknown) => void) => () => void`

Ovaj task nema automatski test (preload/Tauri zahtijevaju prozor); pokriva ga `tsc` i ručna provjera u Task 9. Promjena je mehanička.

- [ ] **Step 1: `src/ipc/api.ts`**

```ts
export type Pozovi = (kanal: string, ...args: unknown[]) => Promise<any>;
/** Pretplata na događaj backenda (Electron `ipcRenderer.on`, Tauri `listen`); vraća odjavu. */
export type NaDogadjaj = (ime: string, cb: (podaci: unknown) => void) => () => void;

export function napraviApi(pozovi: Pozovi, naDogadjaj: NaDogadjaj) {
  return {
    // Licenca
    getLicenca: () => pozovi('licenca:stanje'),
    aktivirajLicencu: (token: string) => pozovi('licenca:aktiviraj', token),
    onLicencaBlokirano: (cb: () => void) => naDogadjaj('licenca:blokirano', () => cb()),

    // Automatski backup
    getBackupInfo: () => pozovi('backup:info'),
    backupSada: () => pozovi('backup:sada'),
    onBackupStanje: (cb: (d: import('../lib/backupRaspored').BackupDogadjaj) => void) =>
      naDogadjaj('backup:stanje', d => cb(d as import('../lib/backupRaspored').BackupDogadjaj)),
    // … ostatak nepromijenjen
```

- [ ] **Step 2: `src/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { napraviApi } from './ipc/api';

contextBridge.exposeInMainWorld('api', napraviApi(
  (kanal, ...args) => ipcRenderer.invoke(kanal, ...args),
  (ime, cb) => {
    const l = (_e: unknown, podaci: unknown) => cb(podaci);
    ipcRenderer.on(ime, l);
    return () => { ipcRenderer.removeListener(ime, l); };
  },
));
```

- [ ] **Step 3: `src/tauri/api.ts`** — drugi argument:
```ts
    (ime, cb) => {
      const odjava = listen(ime, e => cb(e.payload));
      return () => { void odjava.then(f => f()); };
    },
```

- [ ] **Step 4: `src/global.d.ts`** — u `api` pored `onLicencaBlokirano`:
```ts
    getBackupInfo: () => Promise<import('./lib/backupRaspored').BackupInfo>;
    backupSada: () => Promise<import('./lib/backupRaspored').BackupInfo>;
    onBackupStanje: (cb: (d: import('./lib/backupRaspored').BackupDogadjaj) => void) => () => void;
```

- [ ] **Step 5: `src/main.ts`**
- import: `import { pokreniRaspored, zaustaviRaspored } from './ipc/backup';`
- u `app.on('ready')` nakon `registerIpcHandlers();`: `pokreniRaspored();`
- u `before-quit` prije `closeDb();`: `zaustaviRaspored();`

- [ ] **Step 6:** `bunx tsc --noEmit -p .` → nema novih grešaka (uporediti s `git stash`-om ako ih ima od ranije); `bun test` → PASS.
- [ ] **Step 7: Commit**
```bash
git add src/main.ts src/ipc/api.ts src/preload.ts src/tauri/api.ts src/global.d.ts
git commit -m "feat(backup): raspored u main procesu, opšta pretplata na događaje u preloadu"
```

---

### Task 7: Šta traka prikazuje (`backupTraka.ts`)

**Files:**
- Create: `src/lib/backupTraka.ts`
- Test: `src/lib/backupTraka.test.ts`

**Interfaces:**
- Consumes: `BackupDogadjaj`, `BackupInfo`, `ukupniProcenat`, `trajnaGreska` (Task 1).
- Produces:
  ```ts
  interface PrikazTrake {
    /** Širina linije 0–100 %; 0 = linija se ne crta. */
    sirina: number;
    ton: 'rad' | 'uspjeh' | 'greska';
    tekst: string;
    /** Pilula vodi u Postavke (trajna greška). */
    uPostavke: boolean;
    /** Za koliko ms traka nestaje; undefined = ostaje. */
    nestajeZaMs?: number;
  }
  prikazIzDogadjaja(d: BackupDogadjaj): PrikazTrake
  prikazIzInfo(i: BackupInfo, sada: Date): PrikazTrake | null
  vrijemeHHMM(iso: string): string
  ```

- [ ] **Step 1: Failing test**

```ts
// src/lib/backupTraka.test.ts
import { test, expect } from 'bun:test';
import { prikazIzDogadjaja, prikazIzInfo, vrijemeHHMM } from './backupTraka';

test('faze: ukupni procenat na liniji i u piluli', () => {
  expect(prikazIzDogadjaja({ faza: 'kopija', procenat: 0 })).toEqual({ sirina: 0, ton: 'rad', tekst: 'Backup… 0%', uPostavke: false });
  expect(prikazIzDogadjaja({ faza: 'slanje', procenat: 31 })).toEqual({ sirina: 45, ton: 'rad', tekst: 'Backup… 45%', uPostavke: false });
});

test('gotovo: puna zelena linija, vrijeme, nestaje za 3 s', () => {
  const d = new Date(2026, 8, 25, 15, 0, 7);
  expect(prikazIzDogadjaja({ gotovo: d.toISOString() })).toEqual({
    sirina: 100, ton: 'uspjeh', tekst: `Backup spremljen · ${vrijemeHHMM(d.toISOString())}`, uPostavke: false, nestajeZaMs: 3000,
  });
  expect(vrijemeHHMM(d.toISOString())).toBe('15:00');
});

test('greška: žuto, ponovo za 15 min, nestaje za 5 s', () => {
  expect(prikazIzDogadjaja({ greska: 'offline', trajnaGreska: false })).toEqual({
    sirina: 100, ton: 'greska', tekst: 'Backup nije uspio — pokušavam ponovo za 15 min', uPostavke: false, nestajeZaMs: 5000,
  });
});

test('trajna greška: pilula ostaje i vodi u Postavke, bez linije', () => {
  expect(prikazIzDogadjaja({ greska: 'offline', trajnaGreska: true })).toEqual({
    sirina: 0, ton: 'greska', tekst: 'Nema backup-a duže od 24 h', uPostavke: true,
  });
});

test('pri pokretanju: prikazuje samo backup u toku ili trajnu grešku', () => {
  const sada = new Date('2026-09-25T12:00:00Z');
  expect(prikazIzInfo({ aktivan: false, uToku: false }, sada)).toBeNull();
  expect(prikazIzInfo({ aktivan: true, uToku: false, zadnjiUspjeh: '2026-09-25T11:00:00Z' }, sada)).toBeNull();
  expect(prikazIzInfo({ aktivan: true, uToku: true }, sada)).toMatchObject({ ton: 'rad', tekst: 'Backup… 0%' });
  expect(prikazIzInfo({ aktivan: true, uToku: false, greska: 'x', greskaOd: '2026-09-24T10:00:00Z' }, sada))
    .toMatchObject({ ton: 'greska', uPostavke: true });
  expect(prikazIzInfo({ aktivan: true, uToku: false, greska: 'x', greskaOd: '2026-09-25T10:00:00Z' }, sada)).toBeNull();
});
```

- [ ] **Step 2:** `bun test src/lib/backupTraka.test.ts` → FAIL.

- [ ] **Step 3: Implementacija**

```ts
// src/lib/backupTraka.ts
// Šta BackupTraka prikazuje za događaj backup:stanje ili stanje pri pokretanju.
// Čisto, da bi se tekstovi i vremena testirali bez Reacta.
import { trajnaGreska, ukupniProcenat, type BackupDogadjaj, type BackupInfo } from './backupRaspored';

export interface PrikazTrake {
  /** Širina linije 0–100 %; 0 = linija se ne crta. */
  sirina: number;
  ton: 'rad' | 'uspjeh' | 'greska';
  tekst: string;
  /** Pilula vodi u Postavke (trajna greška). */
  uPostavke: boolean;
  /** Za koliko ms traka nestaje; undefined = ostaje. */
  nestajeZaMs?: number;
}

const dvije = (n: number) => String(n).padStart(2, '0');

/** Lokalno vrijeme `HH:MM`. */
export function vrijemeHHMM(iso: string): string {
  const d = new Date(iso);
  return `${dvije(d.getHours())}:${dvije(d.getMinutes())}`;
}

const TRAJNA: PrikazTrake = { sirina: 0, ton: 'greska', tekst: 'Nema backup-a duže od 24 h', uPostavke: true };

export function prikazIzDogadjaja(d: BackupDogadjaj): PrikazTrake {
  if ('faza' in d) {
    const p = ukupniProcenat(d.faza, d.procenat);
    return { sirina: p, ton: 'rad', tekst: `Backup… ${p}%`, uPostavke: false };
  }
  if ('gotovo' in d) {
    return { sirina: 100, ton: 'uspjeh', tekst: `Backup spremljen · ${vrijemeHHMM(d.gotovo)}`, uPostavke: false, nestajeZaMs: 3000 };
  }
  if (d.trajnaGreska) return TRAJNA;
  return { sirina: 100, ton: 'greska', tekst: 'Backup nije uspio — pokušavam ponovo za 15 min', uPostavke: false, nestajeZaMs: 5000 };
}

/** Pri pokretanju: traka samo ako backup već teče ili uspjeha nema 24 h. */
export function prikazIzInfo(i: BackupInfo, sada: Date): PrikazTrake | null {
  if (!i.aktivan) return null;
  if (i.uToku) return prikazIzDogadjaja({ faza: 'kopija', procenat: 0 });
  return trajnaGreska(i, sada) ? TRAJNA : null;
}
```

(`trajnaGreska(i, …)` prima `BackupInfo` jer on ima ista polja kao `BackupStanje` koja funkcija čita.)

- [ ] **Step 4:** `bun test src/lib/backupTraka.test.ts` → PASS. (`vrijemeHHMM` test pravi datum u lokalnoj zoni, pa prolazi i u UTC-u i van njega.)
- [ ] **Step 5: Commit**
```bash
git add src/lib/backupTraka.ts src/lib/backupTraka.test.ts
git commit -m "feat(backup): prikaz trake napretka (tekstovi, boje, trajanje)"
```

---

### Task 8: `BackupTraka` u `MainLayout` i sekcija u Postavkama

(Usklađeno s mainom od 2026-09-26: Postavke su grupe — `src/components/postavke/*Grupa.tsx` sa zajedničkim `Sekcija`/`Red`/`SekcijaPodnozje`/`IshodPoruka` iz `dijelovi.tsx`; `PostavkeScreen` pamti zadnju grupu u modulskoj varijabli `zadnjaGrupa`.)

**Files:**
- Create: `src/hooks/useBackup.ts`, `src/components/backup/BackupTraka.tsx`, `src/components/postavke/AutomatskiBackup.tsx`
- Modify: `src/components/postavke/SistemGrupa.tsx`, `src/screens/PostavkeScreen.tsx`, `src/components/MainLayout.tsx`

**Interfaces:**
- Consumes: `window.api.getBackupInfo/backupSada/onBackupStanje` (Task 6), `prikazIzDogadjaja`, `prikazIzInfo` (Task 7).
- Produces: `useBackupInfo(): { info: BackupInfo | null; osvjezi(): void }`; `<BackupTraka onOtvoriPostavke?: () => void />`; `<AutomatskiBackup />`; `otvoriPostavkeGrupu(g: Grupa): void` (izvoz iz `PostavkeScreen.tsx`).

UI nema jedinične testove u ovom repou; logika je u Task 7. Provjera je `tsc` + screenshot (Task 9).

- [ ] **Step 1: `src/hooks/useBackup.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo } from '@/lib/backupRaspored';

/** Stanje automatskog backup-a; osvježava se kad backup završi ili padne. */
export function useBackupInfo(): { info: BackupInfo | null; osvjezi: () => void } {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const osvjezi = useCallback(() => { window.api.getBackupInfo().then(setInfo).catch(() => {}); }, []);
  useEffect(() => {
    osvjezi();
    return window.api.onBackupStanje(d => { if (!('faza' in d)) osvjezi(); });
  }, [osvjezi]);
  return { info, osvjezi };
}
```

- [ ] **Step 2: `src/components/backup/BackupTraka.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { prikazIzDogadjaja, prikazIzInfo, type PrikazTrake } from '@/lib/backupTraka';

const BOJA_LINIJE = { rad: 'bg-sky-500', uspjeh: 'bg-emerald-500', greska: 'bg-amber-400' } as const;
const BOJA_PILULE = {
  rad: 'bg-white/95 text-slate-600 border-slate-200',
  uspjeh: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  greska: 'bg-amber-50 text-amber-800 border-amber-200',
} as const;

/**
 * Napredak automatskog backup-a: 2 px linija na vrhu prozora i pilula gore
 * desno. `fixed` — ne pomjera sadržaj, kasa se ne trese usred prodaje.
 */
export default function BackupTraka({ onOtvoriPostavke }: { onOtvoriPostavke?: () => void }) {
  const [prikaz, setPrikaz] = useState<PrikazTrake | null>(null);
  const skrivanje = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    window.api.getBackupInfo().then(i => setPrikaz(p => p ?? prikazIzInfo(i, new Date()))).catch(() => {});
    const odjavi = window.api.onBackupStanje(d => {
      clearTimeout(skrivanje.current);
      const p = prikazIzDogadjaja(d);
      setPrikaz(p);
      if (p.nestajeZaMs) skrivanje.current = setTimeout(() => setPrikaz(null), p.nestajeZaMs);
    });
    return () => { odjavi(); clearTimeout(skrivanje.current); };
  }, []);

  if (!prikaz) return null;
  const klik = prikaz.uPostavke && onOtvoriPostavke;
  const Ikona = prikaz.ton === 'uspjeh' ? Check : prikaz.ton === 'greska' ? CloudOff : Cloud;

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-50">
      {prikaz.sirina > 0 && (
        <div className="h-0.5 w-full">
          <div className={cn('h-full transition-[width] duration-300', BOJA_LINIJE[prikaz.ton])} style={{ width: `${prikaz.sirina}%` }} />
        </div>
      )}
      <button
        type="button"
        disabled={!klik}
        onClick={klik ? onOtvoriPostavke : undefined}
        className={cn(
          'pointer-events-auto absolute right-3 top-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm',
          BOJA_PILULE[prikaz.ton], klik ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
        )}
      >
        <Ikona size={12} className="shrink-0" />
        {prikaz.tekst}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: `src/components/postavke/AutomatskiBackup.tsx`** (isti jezik kao `Backup()` u `SistemGrupa.tsx`)

```tsx
import { useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackupInfo } from '@/hooks/useBackup';
import { porukaGreske } from '@/lib/utils';
import { IshodPoruka, Red, Sekcija, SekcijaPodnozje, SekcijaTijelo, type Ishod } from './dijelovi';

function datumVrijeme(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dv = (n: number) => String(n).padStart(2, '0');
  return `${dv(d.getDate())}.${dv(d.getMonth() + 1)}.${d.getFullYear()}. u ${dv(d.getHours())}:${dv(d.getMinutes())}`;
}

/** Sekcija "Automatski backup" u Postavke → Sistem. */
export default function AutomatskiBackup() {
  const { info, osvjezi } = useBackupInfo();
  const [radi, setRadi] = useState(false);
  const [ishod, setIshod] = useState<Ishod>(null);
  if (!info) return null;

  if (!info.aktivan) {
    return (
      <Sekcija naslov="Automatski backup" opis="Šifrovana kopija baze u oblaku svaka 3 sata.">
        <SekcijaTijelo>
          <p className="text-[12px] text-slate-500">Automatski backup nije uključen u licencu</p>
        </SekcijaTijelo>
      </Sekcija>
    );
  }

  const sada = async () => {
    setRadi(true);
    setIshod(null);
    try {
      const i = await window.api.backupSada();
      setIshod(i.greska ? { ok: false, tekst: i.greska } : { ok: true, tekst: 'Backup spremljen.' });
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    } finally {
      setRadi(false);
      osvjezi();
    }
  };
  const uToku = radi || info.uToku;

  return (
    <Sekcija naslov="Automatski backup" opis="Šifrovana kopija baze u oblaku svaka 3 sata.">
      <Red naslov="Bucket"><span className="font-mono text-[12px] text-slate-700 select-text">{info.bucket}</span></Red>
      <Red naslov="Zadnji uspješan"><span className="text-[12px] text-slate-700">{datumVrijeme(info.zadnjiUspjeh)}</span></Red>
      <Red naslov="Sljedeći"><span className="text-[12px] text-slate-700">{uToku ? 'u toku…' : datumVrijeme(info.sljedeci)}</span></Red>
      {info.greska && (
        <Red naslov="Zadnja greška" opis={<span className="text-amber-700 select-text">{info.greska}</span>}>
          <span className="text-[12px] text-slate-500">{datumVrijeme(info.greskaOd)}</span>
        </Red>
      )}
      <SekcijaPodnozje>
        <Button onClick={sada} disabled={uToku} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200">
          {uToku ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
          Backup sada
        </Button>
        <IshodPoruka ishod={ishod} className="ml-2 flex-1 min-w-[200px]" />
      </SekcijaPodnozje>
    </Sekcija>
  );
}
```

- [ ] **Step 4: `SistemGrupa.tsx`** — import `AutomatskiBackup from './AutomatskiBackup'`; u listi sekcija odmah iznad `<Backup />` dodati `<AutomatskiBackup />`; opis grupe: `"Prikaz na ovom računaru, backup baze podataka i podaci o programu."`

- [ ] **Step 5: `PostavkeScreen.tsx`** — izvesti otvaranje grupe spolja:
```ts
/** Otvara Postavke na grupi `g` (npr. klik na pilulu backup-a). */
export function otvoriPostavkeGrupu(g: Grupa): void {
  zadnjaGrupa = g;
  window.dispatchEvent(new CustomEvent('ui:postavkeGrupa', { detail: g }));
}
```
(`Grupa` tip izvesti: `export type Grupa = …`.) U komponenti, uz ostale efekte:
```ts
  useEffect(() => {
    const na = (e: Event) => setGrupa((e as CustomEvent<Grupa>).detail);
    window.addEventListener('ui:postavkeGrupa', na);
    return () => window.removeEventListener('ui:postavkeGrupa', na);
  }, []);
```

- [ ] **Step 6: `MainLayout.tsx`** — import `BackupTraka` i `{ otvoriPostavkeGrupu }` iz `@/screens/PostavkeScreen`; odmah iza `<LicencaTraka info={licenca} />`:
```tsx
          <BackupTraka
            onOtvoriPostavke={user.uloga === 'admin' ? () => { otvoriPostavkeGrupu('sistem'); setScreen('postavke'); } : undefined}
          />
```

- [ ] **Step 7:** `bunx tsc --noEmit -p .` bez novih grešaka; `bun test` → PASS.
- [ ] **Step 8: Commit**
```bash
git add src/hooks/useBackup.ts src/components/backup src/components/postavke/AutomatskiBackup.tsx src/components/postavke/SistemGrupa.tsx src/screens/PostavkeScreen.tsx src/components/MainLayout.tsx
git commit -m "feat(backup): traka napretka i sekcija Automatski backup u Postavkama"
```

---

### Task 9: Ručna provjera na stvarnom bucketu + dokumentacija

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-r2-backup-design.md` (sekcija "Stanje implementacije")

- [ ] **Step 1: Izgled bez Electrona** (vidi memoriju: renderer nije dostupan iz sandboxa, screenshot ide kroz statički Vite build + Playwright chromium). Lažni `window.api` koji šalje `onBackupStanje` redom: `slanje 31` → screenshot (linija 45 %, pilula), `gotovo` → screenshot, `greska` → screenshot, trajna → screenshot; Postavke → Sistem s aktivnim i neaktivnim backup-om. Provjeriti da se sadržaj ispod ne pomjera (isti `getBoundingClientRect().top` glavnog sadržaja sa i bez trake).
- [ ] **Step 2: Stvarni R2, Electron dev** (radi korisnik ili agent ako Electron može da se pokrene): `bun run start`; dev licenca "Lunatik doo" već ima backup. Postavke → Sistem → "Backup sada" → traka ide 0→100, zeleno, nestaje za 3 s. Zatim:
```bash
bun run backup lista pazar-lunatik-doo
bun run backup preuzmi pazar-lunatik-doo
```
Očekivano: novi objekat `<uredjajId>/<UTC>Z.db.age`, `preuzmi` vrati `.db` koji prolazi provjeru. Pokrenuti aplikaciju i sačekati ≥1 min kad je zadnji uspjeh stariji od 3 h (npr. obrisati samo `userData/backup-stanje.json` dev aplikacije) → automatski backup. Isključiti mrežu → "Backup sada" → žuta traka, kartica pokazuje grešku, kasa radi (prodaja/pretraga).
- [ ] **Step 3: Spec** — u "Stanje implementacije" premjestiti stavke 1–3 iz "Ostaje" u "Urađeno" s nazivima fajlova i odlukama 1–8 iz ovog plana (u jednoj rečenici svaka); "Ostaje" = samo stavka 4 (Tauri/Rust), uz napomenu da ugovor `backup.ugovor.test.ts` čeka Rust (`describe.skipIf`), a `ugovor_server.rs` treba `postaviBackupLicencu` i događaje `{"dogadjaj":"backup:stanje","podaci":…}`.
- [ ] **Step 4: Commit**
```bash
git add docs/superpowers/specs/2026-09-25-r2-backup-design.md
git commit -m "docs(backup): stanje implementacije nakon Electron dijela"
```
