# Polog novca (službeni unos/iznos gotovine) — dizajn

**Datum:** 2026-08-11
**Istraživanje:** [docs/research/2026-08-11-tring-polog-novca.md](../../research/2026-08-11-tring-polog-novca.md)

## Cilj

Kasir svako jutro fizički ubaci početni polog (npr. 50 KM) u ladicu. Aplikacija to trenutno nigdje ne evidentira, pa se stanje ladice ne slaže s fiskalnim printerom (X izvještaj, blok "STANJE U KASI") — rizik pri inspekciji. Dodajemo evidenciju pologa i povrata novca, slanje Tring komandi `UnosNovca`/`PovratNovca`, i prikaz očekivanog stanja ladice.

Zakonski kontekst (iz istraživanja): jutarnji polog nije eksplicitno propisan, ali FBiH Zakon o fiskalnim sistemima (Sl. novine 81/09, čl. 2) definiše "gotovinu u kasi" tako da uključuje novac koji je unio blagajnik — svaki fizički polog mora biti evidentiran kroz fiskalni uređaj. Polog se pojavljuje na presjeku stanja (X izvještaj), ne na Z izvještaju. Tring uputstvo zahtijeva `UnosNovca` prije gotovinske reklamacije kad u kasi nema dovoljno evidentirane gotovine.

## Obim

**Uključeno:** polog i povrat gotovine (samo `Gotovina` vrsta plaćanja), lokalna evidencija, Tring komande, login prompt, kartica stanja ladice na Izvještajima, provjera prije gotovinske reklamacije, retry neuspjelih slanja, podrška u mock serveru, testovi.

**Isključeno (YAGNI):** model smjena (open/close shift), polog karticom/virmanom, brojanje novca na kraju dana s razlikom (manjak/višak), višednevni obračun ladice.

## 1. Baza podataka

Nova tabela u `src/database/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tip TEXT NOT NULL CHECK(tip IN ('polog', 'povrat')),
  iznos REAL NOT NULL,
  korisnikId INTEGER NOT NULL,
  tringStatus TEXT NOT NULL CHECK(tringStatus IN ('ok', 'error', 'skipped')),
  napomena TEXT,
  createdAt TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (korisnikId) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_createdAt ON cash_movements(createdAt);
```

- `iznos` je uvijek pozitivan; smjer određuje `tip`.
- `tringStatus`: `ok` = komanda potvrđena od printera; `error` = slanje nije uspjelo (može se ponoviti); `skipped` = fiskalna integracija nije konfigurisana.
- Tabela se kreira kroz postojeći `CREATE TABLE IF NOT EXISTS` mehanizam u `schema.ts` — nema posebnih migracija (postojeći obrazac projekta).

## 2. Tring servis (`src/services/tring.ts`)

Dvije nove funkcije po obrascu postojećih (`stampatiPresjekStanja` itd.):

```ts
export function unosNovca(iznos: number): Promise<TringResponse>
export function povratNovca(iznos: number): Promise<TringResponse>
```

- Vrsta plaćanja fiksno `Gotovina` (case-sensitive po Tring uputstvu).
- **Pretpostavke koje treba potvrditi na stvarnom printeru:** HTTP putanje `/un` i `/pn`, vrsta zahtjeva `7` (unos) i `8` (povrat). Izolovati u imenovane konstante na vrhu datoteke s komentarom `// NEPOTVRĐENO — provjeriti uz Tring.Fiscal install (xml/primjeri)`.
- XML envelope identičan postojećim komandama (isti header, broj zahtjeva, escape).

`src/services/tring-mock-server.ts`: dodati rute za obje komande koje vraćaju uspješan odgovor u istom formatu kao ostale, radi ručnog testiranja.

## 3. IPC (`src/ipc/handlers.ts`, `preload.ts`, `global.d.ts`)

Novi handleri po postojećem obrascu (`handle('cash:...')`):

- `cash:add({ tip: 'polog' | 'povrat', iznos: number, korisnikId: number, napomena?: string })`
  1. Ako je Tring konfigurisan: pošalje `UnosNovca`/`PovratNovca`, status = `ok` ili `error` po odgovoru.
  2. Ako nije konfigurisan: status = `skipped`.
  3. Upiše red u `cash_movements` (uvijek, i kad slanje ne uspije).
  4. Vrati `{ id, tringStatus, tringResult }`.
- `cash:retry(id)` — ponovo pošalje komandu za red sa `tringStatus = 'error'`; pri uspjehu ažurira status na `ok`.
- `cash:getToday()` — sva današnja kretanja (po `createdAt`, lokalni datum).
- `cash:drawerState()` — vrati objekt `{ polozi, gotovinskiPromet, povrati, gotovinskeReklamacije, ocekivanoStanje }` za današnji dan.

### Računanje stanja ladice

Čista funkcija u `src/lib/` (npr. `drawer.ts`), testabilna bez baze:

```
ocekivanoStanje = Σ polozi + Σ gotovina primljena po računima − Σ povrati − Σ gotovina vraćena po reklamacijama
```

- Gotovinski dio računa se čita iz `orders.nacinPlacanja` (JSON s poljem `gotovina`, ili string `'Gotovina'` = puni iznos — postojeća logika parsiranja kao u `NarudzbeScreen.parseNacinPlacanja`; parser izdvojiti u `src/lib` da se ne duplira).
- Kusur ne ulazi u račun: `gotovina` u `nacinPlacanja` je iznos koji je ostao u kasi.
- Reklamirani računi (`status = 'refunded'`) s gotovinskim plaćanjem oduzimaju svoj gotovinski iznos.

## 4. UI

### 4.1 Login prompt (App.tsx / novi modal)

Nakon uspješne PIN prijave: ako danas ne postoji nijedan zapis `tip = 'polog'`, otvori modal **"Početni polog"**:

- Input iznosa, predloženo zadnje uneseno (zadnji `polog` iz baze; ako nema, prazno).
- Dugmad: **Unesi** (poziva `cash:add`) i **Preskoči**.
- Preskakanje se pamti u memoriji sesije (state) — modal se ne pojavljuje ponovo do sljedećeg dana ili ponovnog pokretanja aplikacije. Polog se i dalje može unijeti ručno na Izvještajima.

### 4.2 Izvještaji ekran — kartica "Stanje ladice"

Nova kartica uz postojeće fiskalne akcije:

- Prikaz za danas: polozi, gotovinski promet, povrati, gotovinske reklamacije, **očekivano stanje ladice**.
- Dugmad **Polog** i **Povrat novca** — mali dijalog s iznosom i opcionalnom napomenom, poziva `cash:add`.
- Lista današnjih kretanja (vrijeme, tip, iznos, korisnik, status slanja) s dugmetom **Ponovi** za redove sa statusom `error`.

### 4.3 Gotovinska reklamacija (NarudzbeScreen)

Prije potvrde reklamacije računa plaćenog gotovinom: dohvati `cash:drawerState`; ako je `ocekivanoStanje < gotovinski iznos reklamacije`, prikaži upozorenje s objašnjenjem i ponudi unos pologa (isti dijalog kao 4.2) prije nastavka. Korisnik može i nastaviti bez pologa (upozorenje, ne blokada) — printer će sam odbiti ako njegovi brojači ne dozvoljavaju.

## 5. Rukovanje greškama

- Tring nedostupan/greška → zapis se upiše sa `tringStatus = 'error'`, korisniku jasna poruka (isti stil kao postojeće fiskalne poruke), retry dostupan na Izvještajima. Evidencija se nikad ne gubi.
- Fiskalna integracija isključena → `skipped`, bez poruke o grešci.
- Nevalidan iznos (≤ 0, NaN) → validacija u dijalogu i u handleru.

## 6. Testiranje

- `bun test` za čistu funkciju stanja ladice: kombinacije pologa, povrata, gotovinskih/karticnih/mješovitih računa, reklamacija.
- `bun test` za XML format `unosNovca`/`povratNovca` (isti stil kao postojeći `racun.test.ts` ako pokriva XML; inače snapshot očekivanog XML-a).
- Ručna provjera cijelog toka kroz mock server.

## Otvorena pitanja

- Tačan HTTP endpoint i vrsta zahtjeva za `UnosNovca`/`PovratNovca` — **potvrditi na stvarnom Tring.Fiscal.Server računaru** (folder `xml/primjeri`) prije produkcijske upotrebe. Konstante su izolovane pa je ispravka trivijalna.
