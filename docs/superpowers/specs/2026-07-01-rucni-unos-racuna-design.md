# Ručni unos fiskalnog računa — Design

**Datum:** 2026-07-01
**Status:** Approved (brainstorming)

## Problem

Aplikacija prvo štampa na Tring fiskalni uređaj, dobije `brojFiskalnogRacuna`,
pa tek onda spremi `order` u SQLite bazu. Ako se računar sruši (crash) između
uspješnog štampanja i spremanja, fiskalni račun je fizički isprintan i uređaj mu
je dodijelio broj, ali u bazi nema zapisa — pa nedostaje u evidenciji,
izvještajima i prometu.

Potrebna je opcija za **ručni unos** takvog računa na osnovu podataka sa
isprintanog fiskalnog računa (fiskalni broj, datum/vrijeme, stavke, iznos).

Scenario je rijedak, obično 1 račun odjednom.

## Ciljevi

- Ubaciti kompletan račun (sa punim stavkama) u bazu bez ponovnog štampanja.
- Koristiti fiskalni broj i datum/vrijeme **sa isprintanog računa** (ne trenutno vrijeme).
- Automatski oduzeti zalihe, isto kao normalna prodaja.
- Spriječiti dupli unos istog fiskalnog broja.
- Označiti račun kao ručno unesen radi revizije.

## Ne-ciljevi (YAGNI)

- Nema bulk unosa (jedan račun po unosu).
- Ne dira se Tring servis — nema komunikacije sa uređajem.
- Ne dira se postojeći normalni `order:create` flow.
- Ne generiše se fiskalni broj — unosi se ručno.

## Komponente

### 1. Migracija baze

- Nova kolona `isManual INTEGER DEFAULT 0` u `orders` tabeli.
- Dodaje se kroz postojeći `runMigrations` mehanizam u
  `src/database/db.ts` / `src/database/schema.ts` (idempotentno, bez gubitka podataka).

### 2. Tip

- `Order` interface (`src/types.ts`) dobija `isManual?: boolean`.

### 3. IPC handler `order:createManual`

Lokacija: `src/ipc/handlers.ts`, izložen kroz `src/preload.ts`.

Prima:
- `brojFiskalnogRacuna: string` (obavezno)
- `createdAt: string` (datum/vrijeme sa isprintanog računa, obavezno)
- `korisnikId: number`
- `nacinPlacanja: string`
- `ukupno: number`, `pdvIznos: number`
- `kupac?` (opciono: naziv, idBroj, adresa, grad, postanskiBroj)
- `stavke: Array<{ productId; kolicina; cijena; rabat; pdvStopa }>`
- `napomena?` (opciono)

Ponašanje (unutar jedne DB transakcije):
1. **Provjera duplikata**: `SELECT` po `brojFiskalnogRacuna`; ako postoji → vratiti
   grešku (npr. `{ error: 'duplicate' }` ili throw) i ne unijeti ništa.
2. Insert u `orders` sa `status='completed'`, `isManual=1`, i **proslijeđenim**
   `createdAt` (ne `CURRENT_TIMESTAMP`).
3. Insert `order_items` za svaku stavku.
4. Kreirati `stock_movements` ('izlaz') za svaku ne-uslugu, isto kao normalni
   `order:create`.
5. **Ne** poziva Tring.

Napomena: `stock_movements` zapis koristi isti `createdAt` kao račun radi
konzistentnosti izvještaja zaliha (uskladiti sa načinom na koji normalni flow
piše stock movement — provjeriti tokom implementacije).

### 4. UI — dijalog za unos

- Dugme **"Dodaj račun ručno"** na vrhu liste u `src/screens/NarudzbeScreen.tsx`.
- Nova komponenta `DodajRacunDialog` (dijalog/forma).

Polja:
- Fiskalni broj (obavezno)
- Datum + vrijeme (default trenutno, editabilno — treba odgovarati isprintanom računu)
- Način plaćanja
- Kupac (opciono — ista polja kao inače)
- Stavke: biranje proizvoda + količina, cijena, rabat, PDV stopa (više artikala)
- Napomena (opciono)
- **Ukupno i PDV se automatski računaju iz stavki** — koristiti istu kalkulaciju
  kao `KasaScreen` (izdvojiti/ponovo upotrijebiti postojeću logiku ako postoji helper).

Na submit:
- Poziva `order:createManual`.
- Ako handler vrati duplikat → prikazati grešku, forma ostaje otvorena.
- Na uspjeh → zatvoriti dijalog, osvježiti listu računa.

### 5. Prikaz oznake ručnog unosa

- Badge/oznaka "Ručno unesen" u detaljima računa i u listi (`NarudzbeScreen.tsx`),
  vidljivo radi razlikovanja od normalno štampanih računa.

## Rizici / napomene

- Fiskalni broj i datum se moraju pažljivo prepisati sa papirnog računa — otud
  provjera duplikata kao zaštita od slučajnog dvostrukog unosa.
- Ako je korisnik već ručno korigovao zalihe prije ovog unosa, doći će do
  dvostrukog oduzimanja. Prema odluci, ručni unos **uvijek** oduzima zalihe
  (nema opcionalnog checkboxa); korisnik treba to imati na umu.
