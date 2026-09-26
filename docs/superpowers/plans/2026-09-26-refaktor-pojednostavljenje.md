# Refaktor i pojednostavljenje — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smanjiti površinu koja se ručno drži u paritetu TS↔Rust, skupiti ponovljene tokove u duboke module i popraviti bugove nađene analizom — bez promjene ponašanja osim tamo gdje to odluke vlasnika traže.

**Architecture:** Dva backenda (Electron/TS `src/ipc/handlers.ts` + `src/lib`, Tauri/Rust `src-tauri/backend`) ostaju; ugovorni testovi `src/ipc/ugovor` su sudija pariteta. Zajednički podaci idu u JSON/TS fajlove koje Rust čita s `include_str!` (postojeći obrazac: `schema.ts`, `moduliKatalog.json`, `knjigovodja/upiti.ts`). Logika iz `handlers.ts` seli u lib module oblika koji Rust već ima.

**Tech Stack:** Bun 1.3 (`bun test`), TypeScript, React 19 + ShadCN, @react-pdf/renderer, better-sqlite3 (Electron) / bun:sqlite (testovi), Rust stable (crate `pazar-backend`), Tauri 2.

**Spec:** `docs/superpowers/specs/2026-09-26-refaktor-pojednostavljenje-design.md` (analiza, bugovi, odluke vlasnika).

## Global Constraints

- **Radno mjesto:** svaki task radi ISKLJUČIVO u svom worktree-u
  `/Users/tarik/Documents/development/kasa-app/.claude/worktrees/ref-<id>` na grani `ref/<id>`
  (napravljena od `refactor/pojednostavljenje`). Glavni folder
  `/Users/tarik/Documents/development/kasa-app` pripada drugoj sesiji (necommitan zalihe Task 4) —
  u njemu se ništa ne čita za izmjenu, ne pokreće, ne mijenja.
- **Talas A ne dira fajlove zalihe Task 4:** `src/ipc/handlers.ts` osim regiona navedenih u tasku;
  `src/lib/{pendingRacun,ponuda,prilog,proizvodnja,racun,refund}.ts`, `src/global.d.ts` osim linija
  navedenih u tasku, `src/screens/PonudeScreen.tsx`, `src/components/PendingRacuniDialog.tsx`,
  `src/components/proizvodnja/{IzdajRacunDialog,NalogDetailDialog}.tsx`,
  `src/components/racuni/RacunDetailDialog.tsx`, Rust `lib.rs`, `ponude.rs`, `proizvodnja.rs`,
  `racun.rs`, `racuni.rs`, `pending_racun.rs`; ugovorni `orders`, `ponude`, `proizvodnja`,
  `nezavrseniDokumenti`. Uvoz (samo čitanje) iz tih fajlova je dozvoljen.
- **Talas B** počinje tek kad je zalihe Task 4 spojen u `fix/zalihe`; integrator prvo radi
  `git merge fix/zalihe` u `refactor/pojednostavljenje`.
- **Dva backenda ostaju identična.** Svaka promjena ponašanja ide u oba; ugovorni testovi se
  dopunjuju i prolaze nad oba.
- **Refaktor ne mijenja ponašanje** osim stavki označenih „(odluka)" ili „(bug)" — tamo prvo
  test koji pada, pa popravka.
- **Test-first** za svako novo pravilo i svaki bug.
- Sve što može pasti na bazi provjerava se PRIJE štampe na Tring uređaju.
- UI potvrde/obavijesti samo kroz `potvrdi`/`obavijesti` iz `src/lib/dijalog.ts`.
- Migracije su idempotentne i postoje u oba backenda (`src/database/migrations.ts`, `src-tauri/backend/src/baza.rs`).
- `bun test` radi u UTC-u; datumi u bazi su lokalno vrijeme `YYYY-MM-DD HH:MM:SS`.
- Bun 1.3: `toMatchObject({x: expect.any(...)})` prepiše `x` u primljenom objektu — ne koristiti na objektu koji se kasnije čita.
- better-sqlite3 ne podržava `?1/?2` — imenovani parametri `:od`, objekat samo s imenima iz upita.
- Lint: `bun run lint` pada i na main-u (@/ resolver) — pravilo je „bez novih grešaka u dodirnutim fajlovima" (`bunx eslint <fajlovi>` prije/poslije).
- Tekst u UI-ju, komentari i poruke grešaka na bosanskom (ijekavica), stil kao okolni kod; komentari tamo gdje ih okolni kod ima.
- Commit poruke u stilu repoa (`refactor(skladiste): …`, `fix(ladica): …`), završavaju sa
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `git add` samo konkretne fajlove (nikad `-A`).
- Ne dirati `src/lib/backupKljuc.ts` (necommitan, kopiran u worktree). Ne push-ati. Ne mijenjati `fix/zalihe` ni `main`.
- Stvarna baza `~/Library/Application Support/Pazar/kasa.db` se NIKAD ne otvara direktno: kopirati `kasa.db` (+ `-wal` ako postoji) u scratchpad i čitati kopiju preko `bun:sqlite` (ne `sqlite3` CLI).
- Disk ima ~14 GB slobodno: ne praviti nove kopije `target/`, ne pokretati `cargo build` za Tauri ljusku osim gdje task to traži (`cargo check -p pazar`).

### Komande (u worktree-u taska)

```bash
R=/Users/tarik/Documents/development/kasa-app
export CARGO_TARGET_DIR=$R/.claude/worktrees/.cargo-target      # dijeljen, ne mijenjati
BIN=$R/.claude/worktrees/.bin/<id>-ugovor-server

bun test                                   # sve TS (uključuje ugovor nad TS backendom), ~105 s
bun test src/ipc/ugovor/<fajl>             # jedan ugovorni fajl nad TS-om
cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server \
  && mkdir -p $(dirname $BIN) && cp $CARGO_TARGET_DIR/debug/ugovor-server $BIN   # odmah kopirati!
KASA_RUST_BINARIJ=$BIN KASA_BACKEND=rust bun test src/ipc/ugovor   # ugovor nad Rustom
cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend
bunx tsc --noEmit -p .                     # ako pada i prije taska: bez NOVIH grešaka u dodirnutim fajlovima
bunx vite build --config vite.renderer.config.ts --outDir <scratchpad>/renderer-build   # UI taskovi
```

`bun run test:rust` se NE koristi (gradi u `src-tauri/target` worktree-a i puni disk).

## Review Focus

1. **Stara baza ili uvezen backup s „prljavim" `nacinPlacanja`** (`'gotovina'`, `' Gotovina '`, `'cek'`, JSON `{"Gotovina":5}`) — migracija ih normalizuje, ladica i izvoz daju isti gotovinski iznos, ništa ne pada pri pokretanju. Test: Task A6 (migrations.test + ugovor cash nad oba backenda).
2. **Primka s mješavinom artikala i materijala, rabatom i zavisnim troškovima** — RUC na ekranu Izvještaja, u PDF-u primki i u `UlazDialog` je isti broj. Test: Task A3 (`izvjestaji.test.ts` poredi sa `kalkulacijaPrimke`).
3. **Firma sa `ziroRacuniPozicija='podnozje'`, bez žiro računa, i s dugim tekstom podnožja** — ništa se ne preklapa, a Otpremnica sada nosi žiro račune. Test: Task A4 (poređenje slika za obje pozicije i firmu bez računa).
4. **Pregled primke/izmjene/brisanja nakon seljenja u lib** — pregled ništa ne upisuje, ni audit; potvrda koja ne odgovara stanju baca `PromijenjenoOdPregleda`. Test: Task A2 (`primka.test.ts`).
5. **Greška iz backenda na Electronu i Tauri-ju** — operater vidi istu poruku bez „Error invoking remote method". Test: Task A5 (unit test čistača poruke + postojeći `api.test.ts`).

---

# TALAS A (paralelno, bez fajlova zalihe Task 4)

### Task A1: Politika pristupa i spisak kanala kao zajednički podaci; mrtvi kanali

**Files:**
- Create: `src/ipc/pristup.json`, `src/ipc/pristup.test.ts`
- Modify: `src/ipc/sesija.ts:12-73` (liste → iz JSON-a), `src/lib/licencaStanje.ts:125-134` (`BLOKIRANI_KANALI` → iz JSON-a)
- Modify: `src-tauri/backend/src/sesija.rs:21-86`, `src-tauri/backend/src/licenca.rs:31-40` (liste → `include_str!` + `OnceLock`)
- Modify (mrtvi kanali `product:search`, `kupac:search`, `materijal:search`): `src/ipc/handlers.ts` (samo ta tri `handle(...)` bloka, ~517/643/729), `src/ipc/api.ts:41,57,125`, `src/global.d.ts` (samo linije te tri metode i `getStock`), `src-tauri/backend/src/katalog.rs:632,637,649` + njihove funkcije, `src-tauri/backend/src/kanali.rs:15-18`, ugovorni testovi koji ih zovu (`katalog.ugovor.test.ts`, spisak kanala u `sesija.ugovor.test.ts`)

**Interfaces:**
- Produces: `src/ipc/pristup.json` oblika
  ```json
  {
    "kanaliBezPrijave": ["..."], "kanaliSaZadanimPinom": ["..."], "adminKanali": ["..."],
    "blokiraniBezLicence": ["..."],
    "postavke": { "bezPrijave": ["..."], "zaSve": ["..."], "zaAdmina": ["..."], "tajne": ["..."] }
  }
  ```
  Sadržaj = tačno današnje liste iz `sesija.ts` / `licencaStanje.ts`, s tim da `postavke.zaAdmina` eksplicitno sadrži sve ključeve iz `KLJUCEVI_DOKUMENATA`, a `blokiraniBezLicence` NE sadrži uklonjene `order:create`, `order:refund`, `tring:printReceipt`, `tring:printRefund`. Kanali koji postoje samo u Electronu (`backup:*`) ostaju u listama (Rust ih odbija jer ne postoje).
- TS izvozi ostaju istih imena i tipova (`KANALI_BEZ_PRIJAVE: ReadonlySet<string>` itd.) — pozivaoci se ne mijenjaju.
- `product:findByDobavljacSifra` OSTAJE (odluka 5).

- [ ] **Step 1:** Napiši `src/ipc/pristup.test.ts` koji pada: (a) svaki kanal iz `adminKanali`, `kanaliBezPrijave`, `kanaliSaZadanimPinom`, `blokiraniBezLicence` postoji u `await b.kanali()` TS ugovornog backenda (`src/ipc/ugovor/tsBackend.ts`), osim eksplicitne liste samo-Electron kanala; (b) `KLJUCEVI_DOKUMENATA ⊆ postavke.zaAdmina`; (c) liste nemaju duplikata. Pokreni — pada jer JSON ne postoji.
- [ ] **Step 2:** Napravi `pristup.json`, prebaci `sesija.ts` i `licencaStanje.ts` da grade `Set`-ove iz njega (kao `moduli.ts` iz `moduliKatalog.json`). `bun test src/ipc` prolazi.
- [ ] **Step 3:** Rust: `sesija.rs` i `licenca.rs` čitaju isti fajl (`include_str!("../../../src/ipc/pristup.json")` + `serde_json` u `OnceLock`, po uzoru na `licenca.rs:57`). Dodaj Rust unit test da se JSON parsira i da su liste neprazne. `cargo test -p pazar-backend` prolazi.
- [ ] **Step 4:** Ugovorni test (u `katalog.ugovor.test.ts`): poziv `product:search`, `kupac:search`, `materijal:search` baca grešku nepoznatog kanala nad oba backenda. Pada. Ukloni kanale kroz sve slojeve (handlers, katalog.rs, kanali.rs, api.ts, global.d.ts linije, stari testovi pretrage). Ukloni `getStock` iz `global.d.ts`.
- [ ] **Step 5:** `sesija.ugovor.test.ts` zadržava SVOJE nezavisne spiskove (specifikacija) — ne čitati JSON u njemu; samo uskladi spisak kanala s uklanjanjem.
- [ ] **Step 6:** Pokreni `bun test`, Rust ugovor, `cargo test`. Commit: `refactor(pristup): liste pristupa i kanala kao zajednički JSON; uklonjeni mrtvi kanali pretrage`.

### Task A2: Orkestracija primke i nivelacije u `lib/primka.ts`

**Files:**
- Create: `src/lib/primka.ts`, `src/lib/primka.test.ts`
- Modify: `src/ipc/handlers.ts` SAMO: import blok za `../lib/skladiste`, region primke (~880-1104: `unesiPrimku`, `izmijeniPrimku`, `obrisiPrimku`, `sPregledom`, `spremiPotvrdjeno`, `bezUpisa`, `auditCijenaPrimke` i handleri `primka:create/update/delete/pregled*`) i region nivelacije (~1874-1915: `getNextBrojNivelacije`, `createNivelacija`)
- Modify: `src/lib/skladiste.ts` (ukloniti `export` sa funkcija koje više koristi samo `primka.ts`), `src/lib/skladiste.test.ts` (testovi internih funkcija koje su pokrivene kroz `primka.ts` se brišu)

**Interfaces:**
- Consumes: postojeće iz `skladiste.ts` (`collectPriceChanges`, `upisiCijene`, `revertPrimkaPrices`, `zapisiPromjeneCijena`, `validirajPrimku`, `pripremiIzmjenuPrimke`, `pocetakPregleda`, `rezultatPregleda`, `istiPregled`, …), `SqlDb` iz `sqldb.ts`, tipovi `PregledCijenaUlaza`, `PromijenjenoOdPregleda` iz `src/types.ts`.
- Produces:
  ```ts
  export interface PrimkaDeps {
    db: SqlDb;
    /** Isti audit koji handlers danas koristi (zapisiAudit vezan za trenutnog korisnika). */
    audit: (akcija: string, detalji: Record<string, unknown>) => void;
  }
  export function napraviPrimke(deps: PrimkaDeps): {
    unesi(unos: unknown, potvrda: unknown): unknown;          // = današnji primka:create
    izmijeni(unos: unknown, potvrda: unknown): unknown;       // = primka:update
    obrisi(id: number, potvrda: unknown): unknown;            // = primka:delete
    pregledUnosa(unos: unknown): PregledCijenaUlaza;
    pregledIzmjene(unos: unknown): PregledCijenaUlaza;
    pregledBrisanja(id: number): PregledCijenaUlaza;
  };
  export function upisiNivelaciju(db: SqlDb, ...): ...;      // premješten createNivelacija, isti potpis/povrat
  ```
  Tipovi povrata tačno kao danas u handlerima (pročitaj ih; `unknown` gore je mjesto za tačan tip). Transakcije i rollback pregleda (`PONISTI`) žive UNUTAR modula. Komentari referenciraju Rust parnjake (`skladiste.rs` `s_pregledom`, `spremi_potvrdjeno`).
- Handleri postaju jednolinijski: `handle('primka:create', (data, potvrda) => primke.unesi(data, potvrda))`.

- [ ] **Step 1:** Napiši `primka.test.ts` (bun:sqlite `:memory:` + `schema.ts`, obrazac iz `skladiste.test.ts`) koji pada jer modul ne postoji. Slučajevi: unos s promjenom prodajne cijene pravi nivelaciju i historiju cijena; `pregledUnosa` ne upisuje ništa (ni primku, ni nivelaciju, ni audit red) i vraća isti pregled kao kasniji `unesi`; `unesi` s potvrdom koja ne odgovara stanju baca `PromijenjenoOdPregleda`; izmjena primke s protunivelacijom; brisanje primke vraća cijene; materijal nikad ne ide u nivelaciju.
- [ ] **Step 2:** Premjesti kod (premjestiti, ne prepisivati) u `primka.ts`; handleri pozivaju modul. `bun test src/lib/primka.test.ts` prolazi.
- [ ] **Step 3:** `bun test src/ipc/ugovor/skladiste.ugovor.test.ts` — svih ~134 prolazi bez izmjene testova.
- [ ] **Step 4:** Očisti `skladiste.ts` izvoze (samo ono što koristi još neko osim `primka.ts` i testova) i izbriši testove u `skladiste.test.ts` koji testiraju sada-privatne funkcije i pokriveni su `primka.test.ts` ili ugovorom. Uporedi `bun test --coverage src/lib/primka.test.ts src/lib/skladiste.test.ts src/ipc/ugovor/skladiste.ugovor.test.ts` prije/poslije za `skladiste.ts` + `primka.ts` — pokrivenost linija ne pada.
- [ ] **Step 5:** `bun test` cijeli. Rust se ne mijenja. Commit: `refactor(skladiste): orkestracija primke i nivelacije u lib/primka.ts`.

### Task A3: Izvještaji — RUC knjigovodstveno ispravan, sume u lib, tabovi

**Files:**
- Create: `src/lib/izvjestaji.ts`, `src/lib/izvjestaji.test.ts`, `src/components/izvjestaji/{PrometTab,PrimkeTab,NivelacijeTab,FiskalniTab}.tsx`
- Modify: `src/screens/IzvjestajiScreen.tsx`, `src/components/PrimkePdf.tsx`, `src/components/PrometPdf.tsx`, `src/components/NivelacijaPdf.tsx` (samo računica i oznake), `src/lib/pdv.ts` (dodaje `izluciPdv`)
- Modify po potrebi (ako izvještaju primki fale polja za kalkulaciju): `report:getData` grana `'primke'` u `src/ipc/handlers.ts:~1870-1886` i `report_get_data` u `src-tauri/backend/src/skladiste.rs:~1259`, + ugovorni test u `skladiste.ugovor.test.ts`

**Interfaces:**
- Consumes: `kalkulacijaPrimke(stavke: StavkaZaKalkulaciju[]): KalkulacijaPrimke` iz `src/lib/kalkulacija.ts` (ne mijenjati njegovu matematiku; `round2` u njemu popravlja A5).
- Produces:
  ```ts
  // src/lib/pdv.ts
  export function izluciPdv(bruto: number, stopaPct: number): number;   // bruto * stopa / (100 + stopa), zaokruženo round2
  // src/lib/izvjestaji.ts
  export interface SumePrimki { nabavna: number; nabavnaArtikala: number; prodajnaBezPdv: number; prodajnaSaPdv: number; ruc: number; rucPct: number }
  export function sumePrimke(primke: Array<{ stavke: StavkaZaKalkulaciju[] }>): SumePrimki;   // zbir kalkulacijaPrimke po primkama; rucPct = ruc / nabavnaArtikala * 100
  export function rucPrimke(primka: { stavke: StavkaZaKalkulaciju[] }): { ruc: number; rucPct: number };
  export function sumePrometa(orders: Array<{ ukupno: number; pdvIznos: number; nacinPlacanja: string; status?: string }>): { ukupno: number; pdv: number; bezPdv: number; brojRacuna: number };
  export function sumeNivelacija(nivelacije: Array<{ stavke: Array<{ kolicina: number; staraCijena: number; novaCijena: number; pdvStopa: string }> }>): { razlika: number; pdvRazlike: number };
  ```
  (Tačna polja redova uzmi iz postojećih reduce-a u ekranu/PDF-ovima; zadrži ista značenja, samo s `round2` i na jednom mjestu.)

- [ ] **Step 1 (odluka 2):** Test u `izvjestaji.test.ts` koji pada: primka s jednom stavkom nabavna 100 KM, prodajna 117 KM sa PDV-om (stopa E 17 %) → `ruc = 0`, `rucPct = 0` (danas ekran kaže +17 %). Dodatni slučajevi: stavka materijala (cijena 0) ne ulazi u RUC niti u `nabavnaArtikala`; zavisni troškovi i rabat ulaze u nabavnu; rezultat `sumePrimke([p])` jednak `kalkulacijaPrimke(p.stavke)` za `ruc`/`rucPct`; `izluciPdv(117, 17) === 17`.
- [ ] **Step 2:** Implementiraj `izvjestaji.ts` + `izluciPdv`. Ako `primka_stavke` u izvještaju nema sve što `StavkaZaKalkulaciju` traži (npr. `pdvStopa`), dopuni upit u oba backenda (JOIN na `products`) i ugovorni test koji to provjerava nad oba.
- [ ] **Step 3:** Ekran i `PrimkePdf` koriste `sumePrimke`/`rucPrimke`; oznaka „Marža" → „RUC" (kolona, sažetak, PDF). `PrometPdf`, `NivelacijaPdf` (`*17/117` → `izluciPdv`) i ekran koriste iste sume.
- [ ] **Step 4:** Razbij `IzvjestajiScreen` na tabove (`PrometTab`, `PrimkeTab`, `NivelacijeTab`, `FiskalniTab`, kao što su `VrijednostZalihe` i `KnjigovodjaTab` već izdvojeni); lokalni `toDateStr` → `localDateStr` iz `novac.ts`. Bez vizuelne promjene osim oznake RUC i ispravljenog broja.
- [ ] **Step 5:** `bun test`, `bunx tsc` (bez novih grešaka), renderer build. Ako je dirano `report:getData`: Rust ugovor + `cargo test`. Commit(ovi): `fix(izvjestaji): RUC kao na kalkulaciji (bez PDV-a, samo artikli)` i `refactor(izvjestaji): sume u lib, ekran po tabovima`.

### Task A4: Komercijalni PDF dokumenti — sigurnosna mreža, bugovi, zajednički okvir

**Files:**
- Create: `tools/pdf-poredjenje/poredjenje.tsx` (skripta), `src/components/pdf/{A4Dokument,TabelaStavki,stil}.tsx|ts`, `src/lib/dokumentStavke.ts` + test
- Modify: `src/components/{RacunPdf,PonudaPdf,OtpremnicaPdf,PrilogPdf,RadniNalogPdf,UlazPdf}.tsx`, `src/components/ZaglavljePrikaz.tsx`, `src/components/pdf/*` (postojeći `PotpisBlok`, `SifraTekst`, `PdfPodnozje`)
- NE dirati: `PrimkePdf`, `PrometPdf`, `NivelacijaPdf` (Task A3), `KnjigovodjaPdf`

**Interfaces:**
- Consumes: `iznosStavke`/`izracunajTotale` iz `src/lib/racun.ts` (samo uvoz), `kalkulacijaPrimke` iz `kalkulacija.ts`, `ziroRacuniPozicija(firma)` iz `src/lib/firma.ts`, `dokumentPostavke`.
- Produces:
  ```ts
  // src/lib/dokumentStavke.ts
  export function linijaDokumenta(s: { cijena: number; kolicina: number; rabat?: number; pdvStopa: string }): { cijenaBezPdv: number; pdv: number; iznos: number };  // iznos = round2 kao iznosStavke
  // src/components/pdf/A4Dokument.tsx
  export function A4Dokument(p: { vrsta: 'racun'|'ponuda'|'otpremnica'|'prilog'|'nalog'; firma: FirmaSettings; postavke: DokumentPostavke; naslov: string; broj: string; podnaslov?: React.ReactNode; lang?: 'bs'|'en'; ziro: boolean; children: React.ReactNode }): JSX.Element;
  // src/components/pdf/TabelaStavki.tsx
  export interface KolonaStavke<R> { naslov: string; sirina: number | string; desno?: boolean; bold?: boolean; vidljiva?: boolean; vrijednost: (r: R, i: number) => React.ReactNode }
  export function TabelaStavki<R>(p: { kolone: KolonaStavke<R>[]; redovi: R[] }): JSX.Element;
  // src/components/pdf/stil.ts
  export const MJERE_ZAGLAVLJA: { razmakIspodZaglavlja: number; razmakIspodLinije: number; ... };
  ```

- [ ] **Step 1 (sigurnosna mreža):** Skripta renderuje svih 10 PDF komponenti s fiksnim podacima (firma s logom i 2 žiro računa; firma bez žiro računa; `ziroRacuniPozicija` `'zaglavlje'` i `'podnozje'`; dugačak tekst podnožja; stavke s rabatom i bez; EN varijanta računa) i zamrznutim datumom, pa `pdftoppm -r 72 -png` (u `/opt/homebrew/bin`). Režimi: `--baza <dir>` pravi referentne slike, `--uporedi <dir>` radi `magick compare -metric AE` po stranici i ispisuje razlike (0 = identično). Renderovanje po uzoru na postojeći `pdf.render.test.tsx`. Napravi referentne slike NA POČETNOM stanju (prije ijedne izmjene), u scratchpad. Commit skripte: `test(pdf): poređenje PDF-ova slikama`.
- [ ] **Step 2 (bug 3):** Test za `linijaDokumenta` (2,675 KM red → `iznos` 2,68, isto kao `iznosStavke`), pa `PonudaPdf`, `RacunPdf`, `PrilogPdf` koriste `linijaDokumenta` umjesto lokalne računice; `UlazPdf` zbirove uzima iz `kalkulacijaPrimke` (17-kolonski KCM raspored se NE dira). Poređenje: razlike samo gdje je iznos reda bio pogrešan.
- [ ] **Step 3 (odluka 6, bug 7):** Račun, Ponuda i Otpremnica poštuju `ziroRacuniPozicija` kao Prilog (zaglavlje ili podnožje; Otpremnica ih sada prikazuje; firma bez računa → bez bloka). `ZaglavljePrikaz` uzima mjere iz `MJERE_ZAGLAVLJA` (iste kao PDF). Commit: `fix(pdf): žiro računi po postavci na svim dokumentima prema kupcu; iznos reda zaokružen`.
- [ ] **Step 4:** Uvedi `A4Dokument` + `TabelaStavki` + `stil.ts` i prebaci Račun, Ponudu, Otpremnicu, Prilog i Radni nalog. Poređenje slika: **0 razlika** u odnosu na stanje poslije Step 3 (napravi novu referencu poslije Step 3). Ukloni lokalne `today`/`pad`/`fmt` kopije u tim fajlovima. Commit: `refactor(pdf): zajednički okvir A4 dokumenta i tabela stavki`.
- [ ] **Step 5:** `bun test`, `bunx tsc` (bez novih grešaka), renderer build. U izvještaju taska navedi broj linija prije/poslije za 5 dokumenata.

### Task A5: Brze pobjede (bez preklapanja s drugim taskovima)

**Files:**
- Modify: `src/preload.ts`, `src/tauri/api.ts`, `src/lib/utils.ts` (+ test), `src-tauri/src/lib.rs:22-61` i njegovi testovi (~360-395), `src/services/tring.ts:~507` (`upisiArtikal`), `src-tauri/backend/src/tring.rs:~181` (`upisi_artikal`), `src/lib/izborArtikala.ts` (+ test), `src/screens/ProizvodnjaScreen.tsx:~24` (`StatusChip`), `src/lib/kalkulacija.ts:25`, `src/lib/ploca.ts:15`, `src/lib/batchRacuni.ts:46`, `src/screens/GeneratorScreen.tsx:~59-67`, `src/components/skladiste/UlazDialog.tsx:~39`, `src/lib/knjigovodja/excel.ts:~114`, `src/lib/licenca.ts:~94`, `src/services/tring-mock-server.ts`, `src/lib/{refund,prilog,batchRacuni}.integration.test.ts` + `src/services/tring.xml.test.ts` (samo setup lažnog servera), mjesta s lokalnim `fmtKol`/`formatQty` (`KasaScreen.tsx:~49`, `FakturaDialog.tsx:~117`, `PretragaProizvoda.tsx:~36`, `components/ui/pretraga-stavki.tsx:~78`, `StavkeRacuna.tsx:~8`), `FakturaDialog.tsx` (`fmtDatum`, `plusDana`, množina na ~661), `KasaScreen.tsx` (`formatArtikliCount`), `DodajRacunDialog.tsx:~46,52`
- NE dirati: `IzvjestajiScreen.tsx`, PDF komponente, `handlers.ts`, fajlove zalihe Task 4 (npr. `nowLocalInput` u `PendingRacuniDialog` ostaje)

**Interfaces:**
- Produces: `src/lib/utils.ts` → `export function formatKolicina(n: number): string` (ponašanje identično postojećim kopijama; ako se kopije razlikuju, zamijeni samo one s istim izlazom i navedi razliku u izvještaju); `startMockTringServer(port?: number, opts?: { kasnjenjeMs?: number }): http.Server` (zadano 2500 za /sfr i /srr, 300 ostalo — kao danas).

- [ ] **Step 1 (bug 5):** Test: čista funkcija `ocistiPorukuIpc(poruka: string): string` (u `src/ipc/api.ts` ili `utils.ts`) skida `Error invoking remote method '<kanal>': Error: `. Preload omota `invoke` i baca `new Error(ocistiPorukuIpc(e.message))`; Tauri adapter mora davati istu poruku (provjeri). `porukaGreske` koristi istu funkciju. 44 mjesta `err?.message || …` u UI-ju time postaju ispravna bez izmjene.
- [ ] **Step 2:** Tauri ljuska (`src-tauri/src/lib.rs:22-61`) koristi `pazar_backend::cuvanje::*` umjesto treće kopije pravila; ukloni duple testove iz ljuske (ostaju testovi u `cuvanje.rs`). Provjera: `cargo check --manifest-path src-tauri/Cargo.toml -p pazar` + `cargo test -p pazar-backend`.
- [ ] **Step 3:** Mrtav kod: `Tring.upisiArtikal` + `upisi_artikal` (i njihovi testovi), `izborArtikala.pomjeriKursor`/`artikalZaEnter` (+ testovi), `StatusChip` — prvo `grep` potvrdi da nema pozivalaca.
- [ ] **Step 4 (bug 2):** Test u `kalkulacija.test.ts` / `batchRacuni.test.ts` koji pada s lokalnim `round2` (npr. vrijednost x.xx5 gdje `Math.round(n*100)/100` daje niže od `round2` iz `novac.ts`), pa svi uvoze `round2` iz `novac.ts`; inline `Math.round(x*100)/100` u Generatoru, UlazDialogu i `excel.ts` → `round2`.
- [ ] **Step 5:** `formatKolicina` umjesto 5 kopija; `lokalniDatum` → `localDateStr`; u Fakturi `fmtDatum` → `formatDatumValute`, lokalni `plusDana` → `plusDana` iz `lib/ponuda.ts` (samo uvoz); `mnozina` iz `utils.ts` za „N stavki/artikala" (Faktura ~661, Kasa `formatArtikliCount`); lokalni `Eyebrow` u DodajRacunDialog → iz `ledger.tsx`.
- [ ] **Step 6:** Lažni Tring: `kasnjenjeMs` opcija; integracijski testovi i `tring.xml.test.ts` prosljeđuju 0, osim testa „dvoklik ne odštampa dva storna" (`refund.integration.test.ts:~120`) koji zadržava kašnjenje (svoj server ili `kasnjenjeMs` za taj slučaj). Izmjeri `time bun test` prije i poslije i navedi u izvještaju.
- [ ] **Step 7:** `bun test`, Rust ugovor (dirano `tring.rs`), `cargo test`, `bunx tsc` (bez novih), renderer build. Commitovi po stavkama (`fix(ipc): …`, `refactor(tauri): …`, `chore: mrtav kod …`, `fix(novac): …`, `refactor(ui): …`, `test: …`).

### Task A6: Način plaćanja nikad nepoznat (odluka 4, bug 4)

**Files:**
- Modify: `src/lib/drawer.ts`, `src/lib/placanje.ts`, `src/lib/cash.ts` (ako čita način plaćanja), `src/database/migrations.ts` (+ `migrations.test.ts`), `src-tauri/backend/src/cash.rs`, `src-tauri/backend/src/baza.rs` (migracija), `src/lib/dokumentPostavke.ts:~9-10` (`NACINI_PLACANJA`/`NacinPlacanja` → uvoz iz `placanje.ts`), `src/screens/KasaScreen.tsx:~35` (samo lokalna lista načina → uvoz), ugovorni test za ladicu (`src/ipc/ugovor/uredjaj.ugovor.test.ts` ili gdje je `cash:drawerState` pokriven)
- Putevi upisa u Task-4 fajlovima (`handlers.ts` finalize/createManual/pending, `ponuda.ts`, `prilog.ts`, `racuni.rs`…) se u ovom tasku samo POPISUJU i pokrivaju ugovornim testom ako testa nema; ako neki put ne provjerava vrijednost, zapiši ga u izvještaj — popravka ide u Task B1/B2.

**Interfaces:**
- Consumes: `raspodjelaPlacanja(nacin, ukupno)` i `NACINI_PLACANJA` iz `placanje.ts`.
- Produces: `gotovinskiIznos(nacinPlacanja, ukupno)` zadržava potpis, ali računa kao `raspodjelaPlacanja(...).iznosi.gotovina` kada je `poznat`, a 0 kada nije (nepoznat oblik nakon migracije je nemoguć; knjigovođa ga i dalje označava kroz `poznat:false`). Rust `cash.rs` ima identičnu logiku (case-insensitive tekst, JSON ključevi case-insensitive, `ček`/`cek`).
- Migracija `normalizujNacinPlacanja` (TS i Rust, idempotentna): `trim`, tekst case-insensitive → kanonski (`Gotovina`, `Kartica`, `Virman`, `Ček`; `cek` → `Ček`); JSON → ključevi mala slova kanonski (`gotovina`, `kartica`, `virman`, `cek`), vrijednosti nepromijenjene.

- [ ] **Step 1:** Popis: `grep` svih INSERT/UPDATE `orders.nacinPlacanja` u oba backenda; za svaki put potvrdi da vrijednost prolazi `provjeriNacinPlacanja`/`pripremiPlacanje` (ili Rust ekvivalent) PRIJE štampe. Kopiraj stvarnu bazu u scratchpad (vidi Global Constraints) i ispiši `SELECT nacinPlacanja, COUNT(*) FROM orders GROUP BY 1` — koje varijante stvarno postoje. Oboje u izvještaj.
- [ ] **Step 2:** Testovi koji padaju: `drawer.test.ts` — `'gotovina'` → cijeli iznos, `' Gotovina '` → cijeli iznos, `'{"Gotovina":5,"kartica":3}'` → 5, `'cek'` → 0; `migrations.test.ts` — stari redovi `'gotovina'`, `'cek'`, `'{"Gotovina":5,"Kartica":3}'` postaju `'Gotovina'`, `'Ček'`, `'{"gotovina":5,"kartica":3}'`, drugi prolaz ne mijenja ništa; ugovorni test ladice nad oba backenda s ručno upisanim `'gotovina'` računom → isti `gotovinskiPromet`.
- [ ] **Step 3:** Implementiraj TS (drawer preko `raspodjelaPlacanja`, migracija) i Rust (`cash.rs`, `baza.rs`). `NACINI_PLACANJA` jedan izvor u TS-u (dokumentPostavke, KasaScreen uvoze).
- [ ] **Step 4:** Za svaki put upisa bez ugovornog testa „nepoznat način plaćanja → greška, ništa upisano, ništa odštampano" dodaj test (ako put nije u Task-4 fajlu i test pada, popravi; ako jeste, zapiši za B1/B2).
- [ ] **Step 5:** `bun test`, Rust ugovor, `cargo test`. Commit: `fix(ladica): jedan parser načina plaćanja; migracija normalizuje stare zapise`.

### Task A7: UI — `ModuliProvider`, `useIpcPodaci`, ljuska šifarnika

**Files:**
- Create: `src/components/ModuliProvider.tsx`, `src/hooks/useIpcPodaci.ts` (+ test čiste logike ako je ima), `src/components/sifarnik/SifarnikLista.tsx`
- Modify: `src/hooks/useModuli.ts`, `src/hooks/useLicenca.ts`, `src/App.tsx`, `src/components/postavke/LicencaGrupa.tsx`, mjesta koja slušaju/šalju `ui:licenca`, `ui:proizvodnja`, `ui:showGenerator` (grep), `src/screens/SifarnikScreen.tsx`, `src/components/sifarnik/*Tab.tsx`, loaderi u `src/screens/{NarudzbeScreen,ProizvodnjaScreen,SkladisteScreen}.tsx` i `src/components/skladiste/PrimkeTab*` / `VrijednostZalihe`
- NE dirati: `PonudeScreen`, `KasaScreen`, `IzvjestajiScreen`, fajlove Task 4, `StatusChip` region u ProizvodnjaScreen (A5)

**Interfaces:**
- Produces:
  ```ts
  export function useIpcPodaci<T>(ucitaj: () => Promise<T>, deps: React.DependencyList): { podaci: T | undefined; greska: string | null; ucitava: boolean; osvjezi: () => Promise<void> };  // otkazuje zastario odgovor (StrictMode), greška kroz porukaGreske
  export function ModuliProvider(p: { children: React.ReactNode }): JSX.Element;  // jedan getLicenca + postavke + interval 1h + pretplata onLicencaBlokirano
  // useModuli() i useLicenca() zadržavaju današnji povratni oblik, ali čitaju iz konteksta
  export function SifarnikLista(p: { naslov: string; placeholder: string; pretraga: string; onPretraga: (s: string) => void; broj: number; ukupno: number; onNovi: () => void; prazno: React.ReactNode; children: React.ReactNode }): JSX.Element;
  ```

- [ ] **Step 1:** `ModuliProvider` u `App` (obuhvata i Login/Aktivaciju); `useModuli`/`useLicenca` → `useContext`; uklonjeni `window` CustomEvent-i za licencu/proizvodnju/generator (zamijenjeni metodama konteksta, npr. `postaviModul(m, v)`, `objaviLicencu(l)`); LicencaGrupa ne čita ponovo iste postavke.
- [ ] **Step 2:** `useIpcPodaci` i primjena na loadere bez `catch` (Sifarnik ×4 — svaki tab sam učitava, Skladište ×2 + PrimkeTab, Narudžbe ×2, Proizvodnja) — greška se prikazuje umjesto tihog praznog ekrana.
- [ ] **Step 3:** `SifarnikLista` + `useObrisi(opis, fn)` (brisanje s `potvrdi` i greškom kroz `obavijesti` u sva 4 taba — Materijal danas ima inline poruku). Forme i kolone ostaju u tabovima.
- [ ] **Step 4:** `bunx tsc` (bez novih), renderer build, `bun test`. Preview screenshot Šifarnika i Proizvodnje (postupak u memoriji `kasa-app-lint-i-electron-provjere`: `.preview-tmp/` s mock `window.api`, obrisati poslije) — priložiti putanje slika u izvještaj. Commitovi: `refactor(ui): moduli i licenca kroz kontekst`, `refactor(ui): useIpcPodaci`, `refactor(sifarnik): zajednička ljuska liste`.

### Task A8: Izvještajna porodica PDF-ova (poslije A3 i A4, prije talasa B ako Task 4 još nije spojen)

**Files:**
- Create: `src/components/pdf/izvjestaj.tsx`
- Modify: `src/components/{PrimkePdf,PrometPdf,NivelacijaPdf,UlazPdf}.tsx` (samo okvir/zaglavlje/podnožje/mreža — KCM kolone u UlazPdf ostaju), `src/components/pdf/PdfPodnozje.tsx` (`margina`, slot `iznad`)

**Interfaces:**
- Consumes: skripta poređenja iz A4, sume iz A3.
- Produces: `IzvjestajStrana({ naslov, podnaslov, firma, polja, orijentacija, children })`, `MrezaTabela<R>({ kolone, redovi, zbir })`.

- [ ] **Step 1:** Referentne slike 4 izvještajna PDF-a na trenutnom stanju.
- [ ] **Step 2:** Uvedi komponente i prebaci PDF-ove; poređenje **0 razlika**.
- [ ] **Step 3:** `bun test`, tsc, renderer build. Commit: `refactor(pdf): zajednički okvir izvještaja`.

---

# TALAS B (tek kad je zalihe Task 4 spojen u `fix/zalihe`)

**Preduslov (integrator):** `git -C .claude/worktrees/refactor merge fix/zalihe`, riješiti konflikte, `bun test` + Rust ugovor + `cargo test` zeleni. Tek onda se prave worktree-i za B taskove.

### Task B1: Fiskalizacija kao jedan dubok modul (TS)

**Files:**
- Create: `src/lib/fiskalizacija.ts` + test, `src/lib/fiskalniUredjaj.ts` + test
- Modify: `src/ipc/handlers.ts` (`insertCompletedOrder`, `order:finalize`, `order:createManual`, `pending:*`, `loadTringConfig`, `settings:getTring`, `cashDeps`, Tring logovanje), `src/lib/{racun,prilog,ponuda,proizvodnja,refund,pendingRacun,cash}.ts`, `src/services/tring.ts` (logovanje u `postXml`)

**Interfaces:**
- Produces:
  ```ts
  // fiskalniUredjaj.ts — adapter nad services/tring.ts; postavke se čitaju pri svakom pozivu
  export type IshodUredjaja = { ok: true; bf: string | null; odgovori: Record<string, string> } | { ok: false; greska: string; nepoznat: boolean; odgovori?: Record<string, string> };
  export interface FiskalniUredjaj { stampajRacun(r: TringRacun): Promise<IshodUredjaja>; stampajReklamaciju(r: TringReklamacija): Promise<IshodUredjaja>; unosNovca(iznos: number): Promise<IshodUredjaja>; povratNovca(iznos: number): Promise<IshodUredjaja>; /* + izvještaji koje handlers danas zove */ }
  export function uredjajIzPostavki(db: SqlDb): FiskalniUredjaj;
  export function procitajTringPostavke(db: SqlDb): TringPostavke;   // dijele settings:getTring i adapter
  // racun.ts
  export function upisiRacun(db: SqlDb, r: { korisnikId: number; ukupno: number; pdvIznos: number; nacinPlacanja: string; brojFiskalnogRacuna: string | null; kupac?: KupacRacuna | null; stavke: StavkaRacuna[]; isManual?: 0 | 1; createdAt?: string; prilog?: ...; faktura?: ... }): number;  // jedini INSERT u orders; prazan kupac → NULL; tip artikla uvijek iz baze
  // fiskalizacija.ts
  export async function fiskalizuj<S>(deps: { db: SqlDb; uredjaj: FiskalniUredjaj }, n: { kljuc: string; snapshot: S; racun: TringRacun; upisi: (bf: string | null) => number }): Promise<Uspjeh | NeuspjehStampe | VecEvidentiran>;
  ```
  Tačne tipove `Uspjeh/NeuspjehStampe/VecEvidentiran` i snapshot uzeti iz zalihe Task 4 koda (`pendingRacun.ts`) — ne izmišljati novi oblik snapshota (ugovor s rendererom i Rustom).

- [ ] **Step 1 (odluka 3):** Ugovorni test (u `orders.ugovor.test.ts` / `ponude` / `proizvodnja`): račun s praznim kupcem (`''` u svim poljima) upisuje `NULL` na svim putevima (finalize, createManual, prilog, ponuda→račun, nalog→račun, pending:resolve). Pada nad TS-om bar za jedan put.
- [ ] **Step 2:** `upisiRacun` kao jedini INSERT u `orders` (+ `order_items` + izlaz sa skladišta); svi putevi ga koriste.
- [ ] **Step 3:** `FiskalniUredjaj` + `uredjajIzPostavki`: nema više `loadTringConfig()` prije poziva ni `if (isLoggingEnabled) console.log` po handlerima; logovanje u jednom sloju.
- [ ] **Step 4:** `fiskalizuj`: zaključavanje po ključu (zamjenjuje 3 `Set`-a), write-ahead, štampa, ishod, transakcija {preuzmi pending → `upisi` → veze}, jedna poruka „JE odštampan, ali nije zabilježen". Svi tokovi (finalize, prilog, ponuda, nalog, storno gdje oblik dozvoljava) ga koriste. Test putanje „štampa uspjela, upis pao" preko SQLite triggera `BEFORE INSERT ON orders … RAISE(ABORT)` — i u ugovornom testu (radi nad oba backenda).
- [ ] **Step 5:** Putevi upisa `nacinPlacanja` koje je A6 zapisao kao neprovjerene — popravi uz ugovorni test.
- [ ] **Step 6:** `bun test`; Rust ugovor očekivano pada samo na novim testovima (B2 ih zatvara). Commitovi po koraku.

### Task B2: Fiskalizacija i štampa u Rustu (paralelno s B1, isti ugovor)

**Files:** Create `src-tauri/backend/src/stampa.rs`, `prilog.rs`, `storno.rs` (iz `racuni.rs`); Modify `racuni.rs`, `ponude.rs`, `proizvodnja.rs`, `racun.rs`, `pending_racun.rs`, `lib.rs`, `uredjaj.rs`.

- [ ] **Step 1:** `stampa.rs`: `UToku`, `fiskalni`, `reklamacija`, `broj_sa_uredjaja`, `neuspjeh`, `poruka_nakon_stampe`; jedno mjesto učita Tring konfiguraciju i zapiše u dnevnik; `debug_assert!` da se ne štampa u transakciji. Obje `neuspjela_stampa` (`racuni.rs`, `ponude.rs`) spojene/preimenovane.
- [ ] **Step 2:** Jedan INSERT u `orders` (`racun.rs`), prazan kupac → NULL (ugovorni test iz B1).
- [ ] **Step 3:** `racuni.rs` razdvojen na `prilog.rs` i `storno.rs` po TS modulima (samo premještanje).
- [ ] **Step 4:** Rust ugovor + `cargo test` + `cargo clippy -p pazar-backend` (bez novih upozorenja). Commitovi po koraku.

### Task B3: UI fiskalnog ishoda i naplate

**Files:** Create `src/lib/fiskalniIshod.ts` + test, `src/components/FiskalnaNaplataDialog.tsx`, `src/components/NacinPlacanjaBirac.tsx`; Modify `KasaScreen`, `FakturaDialog`, `GeneratorScreen`, `PonudeScreen`, `proizvodnja/IzdajRacunDialog`, `racuni/RacunDetailDialog`, `postavke/FiskalniGrupa`.

- `procitajIshod(res, bacio?: unknown): { vrsta: 'uspjeh' | 'vecEvidentiran' | 'nepoznat' | 'greska'; poruka: string }` — jedno formatiranje `odgovori` (danas 6 kopija). Pravilo „ne šalji ponovo" izvesti iz ponašanja backenda poslije Task 4: bačena greška koja može doći poslije štampe tretira se kao `nepoznat` (otvara nezavršene račune, korpa se ne šalje ponovo); greška validacije prije štampe je `greska`. Test pokriva oba.
- `FiskalnaNaplataDialog({ naslov, opis, iznos, zadaniNacin, onIzdaj, onUspjeh })` zamjenjuje IzdajRacunDialog i dijalog u Ponudama; `PaymentType` jedan tip iz `placanje.ts`.
- [ ] Test-first za `procitajIshod`; tsc, renderer build, `bun test`, preview screenshot Kase i Ponuda. Commitovi.

### Task B4: Knjiga zalihe (TS + Rust)

**Files:** Create `src/lib/zaliha.ts` + test, `src-tauri/backend/src/zaliha.rs`; Modify svih 10 mjesta `INSERT INTO stock_movements` i 7 upita stanja (grep) u oba backenda, `upiti.ts` ako koristi fragment.

- `knjizi(db, ref: { vrsta: string; id: number }, smjer: 'ulaz' | 'izlaz', stavke: Array<{ productId: number; kolicina: number }>, opts?: { datum?: string }): void` (pravilo „usluga ne razdužuje" unutra), `ponisti(db, ref)`, `stanje(db, productId): number`, `STANJE_SQL` (fragment podupita), jedna `TOLERANCIJA_ZALIHE`. Rust isto; `stanje` vraća `Value` (INTEGER/REAL zapis se ne mijenja).
- [ ] Datumi kretanja moraju ostati isti (izvještaj „Zalihe na dan"). `bun test`, Rust ugovor, `cargo test`, `stvarnaBaza.poredjenje` nad kopijom stvarne baze. Commitovi.

### Task B5: Ostatak `handlers.ts` — sesija, katalog, postavke

**Files:** Modify `src/ipc/handlers.ts` (160-327 sesija, 329-844 šifarnik, postavke upserti), `src/ipc/sesija.ts`; Create `src/lib/katalog.ts` + test, `src/lib/postavke.ts` + test.

- `napraviSesiju(db, sat?)` → `{ prijavi, odjavi, promijeniSvojPin, korisnik, trenutni, provjeriAdminPin, provjeriPristup }`; provjera `nalog:setStatus 'vrati'` i `requirePinRefund` u `provjeriPristup`. Unit testovi mašine stanja (neuspjela prijava briše sesiju, zauzet PIN se broji kao neuspjeh).
- `lib/katalog.ts`: `validirajArtikal`, `slobodnaStavka` (PLU/naziv do 32 znaka), `provjeriBrisanjeArtikla`, `validirajKupca`, `azuriraj(db, tabela, id, polja, dozvoljeneKolone)` umjesto 27 `fields.push`.
- `lib/postavke.ts`: `procitajGrupu(db, prefiks)`, `upisiPostavke(db, nove, { audit, akcija, bezVrijednosti })`; lokalni `NACINI_PLACANJA` u handlers → uvoz.
- [ ] Ugovor ne mijenja; `bun test` + Rust ugovor zeleni. Commitovi po modulu.

### Task B6: Rust čišćenje (poslije B2 i B4)

- Tabela kanala: svaka domena `pub const KANALI: &[Kanal]` (`Kanal { ime, h: fn(&Backend, &Args) -> R<Value> }`), `kanali.rs` spaja i izvodi `SVI_KANALI`; nestaje rutiranje po prefiksu, `racuni.rs KANALI` i `matches!` u `cash.rs`.
- `js.rs` stvarno jedino mjesto JS semantike (`niz` ×3 → `iter_ili_baci`/`niz_ili_prazno`, `godina_iz_datuma`, JS `===`, spread, ISO regex).
- `Backend::db()` → `&Db`, obrisati `baza()`, mrtve `if let Err`, suvišne `otvori_db()`, `uredjaj::load_tring_config`; 8 mrtvih funkcija; `postavke::{procitaj, upisi, tring}` (UPSERT ×4, SELECT ×8); `katalog.rs` koristi `PDV_STOPE`/`NACINI_PLACANJA` iz `provjera_racuna.rs`; `TOLERANCIJA_KOLICINE` → `TOLERANCIJA_ZALIHE`; `PONISTI` iza `Db::tx_s_odlukom`; clippy `slice::from_ref`.
- [ ] Rust ugovor + `cargo test` + `cargo clippy` (manje upozorenja nego prije). Commitovi po stavci.

### Task B7: Tipiziran IPC šav (poslije B1/B3)

- `export type Api = ReturnType<typeof napraviApi>`; `global.d.ts` → `interface Window { api: Api }`; tipovi rezultata u `api.ts` (iz lib tipova); `Pozovi = <R>(kanal, ...args) => Promise<R>`; `tauri/api.ts` bez `as any`.
- `src/ipc/kanali.ts`: `interface Kanali { 'product:get': [[id: number], Product | null]; … }` za sve kanale; `handle`, `pozovi` i ugovorni `Backend.call` tipizirani nad njim.
- Test u `api.test.ts`: skup kanala iz `napraviApi` == `b.kanali()` (osim dogovorenih izuzetaka).
- [ ] `bunx tsc` — greške tipova koje isplivaju popraviti; `bun test`. Commitovi.

### Task B8: UI ostatak (poslije B3)

- `src/lib/stavkeDokumenta.ts` (`StavkaDokumenta`, `dodajProizvod(stavke, p, kol, { rabat })`, `izmijeni`, `ukloni`, `izReda(row)`, `uPayload`) + `useStavkeDokumenta()` za Ponude, Fakturu, PrilogStavkeDialog, DodajRacunDialog.
- Kupac na računu: `KupacRacuna`, `KUPAC_LIMITI`, `izKupca`, `zaSlanje` u lib; `<KupacRacunaPolja>`; `<PretragaKupaca>` s kešom.
- `otvoriPdf(element | blob)` / `spremiPdf` u `lib/stampa` umjesto 7/4 kopija (jedno oslobađanje URL-a).
- `useLedgerLista`, `usePreciceListe`, `jePoljeZaUnos` za Ponude, Narudžbe, Proizvodnju, Skladište; `useSusjedni` + `<SusjedniNav>`, `useCuvarIzmjena`.
- Kasa: `KusurDialog`, `BrojDialog`, `useKasaPostavke`, `kosarica.dodaj(...)` (upija poruku o stanju i dupli rabat); Ponude: `PonudaFormaDialog`.
- [ ] Test-first za lib dijelove; tsc, renderer build, `bun test`, preview screenshoti Kase, Ponuda, Fakture. Commitovi po stavci.

### Task B9: Testovi — zamijeni, ne slaži (posljednje)

- `scenarij(b)` za ugovorne testove (`artikal`, `kupac`, `korisnik`, `racun`, `stanje` preko `product:get`, `red/redovi/broj`, `postavka`, `danas`, graditelji `stavka`/`primka`); `testnaBaza()` za lib testove.
- Prenijeti u ugovor: dvoklik storna (preko `laziTring.zadrzi()`), kupac na /srr, „BF broj svog isječka"; obrisati `refund.integration`/`prilog.integration` ostatak.
- Obrisati lib testove pokrivene ugovorom (proizvodnja/skladiste/ponuda/prilog internal), zadržati čiste funkcije koje koristi ekran i DI greške; `--coverage` po fajlu prije/poslije — ne smije pasti.
- Ukloniti `export` s funkcija koje koriste samo testovi (`revertNivelacijaPrices`, `revertPricesWithoutStock`, `ponistiPromjeneCijenaPrimke`, `otisakPregleda`, `getProsjecnaNabavna`, `fakturisiNalog`, `getNalogStavke`, `getNalogProizvodi`, `validirajPrilogStavke`, `provjeriDodatkeFakture`, `zadnjiFiskalniRacun`).
- [ ] `bun test`, Rust ugovor, vrijeme `bun test` prije/poslije. Commitovi.

### Task B10: Migracije kao podaci (poslije B6)

- `src/database/migracije.json`: lista `{ tabela, kolona?, sql: string[], samoAkoTabelaPostoji?: boolean }` po kojoj iteriraju i `migrations.ts` i `baza.rs` (danas 29 `ALTER` + 5–6 `CREATE` ručno prepisano; `schema.ts` je već zajednički). Migracije koje nisu čist SQL (npr. normalizacija iz A6, hesiranje PIN-a) ostaju kod, imenovane u JSON-u kao korak `{ kod: "ime" }` koji oba backenda mapiraju na funkciju.
- [ ] `migrations.test.ts` (stara šema → nova, dvaput) nad oba backenda; `stvarnaBaza.poredjenje` nad kopijom stvarne baze: identičan rezultat TS i Rust. Commit: `refactor(baza): migracije kao zajednički podaci`.

### Task F: Završna provjera

- [ ] Integrator: svi taskovi spojeni u `refactor/pojednostavljenje`; `bun test`, Rust ugovor, `cargo test`, `cargo clippy`, `bunx tsc`, renderer build, `bunx eslint` nad dodirnutim fajlovima (bez novih kategorija), poređenje PDF slika.
- [ ] Review cijele grane (superpowers:requesting-code-review) na najjačem modelu.
- [ ] Izvještaj vlasniku; grana se NE spaja u `fix/zalihe`/`main` bez njegove odluke.
