# Račun po prilogu — dizajn

**Datum:** 2026-08-13
**Status:** odobren dizajn, čeka plan implementacije
**Regulativa:** vidi `docs/research/2026-08-13-fiskalni-racun-zbirna-stavka-regulativa.md`

## Problem

Korisnici ponekad ne žele sve stavke kucati na fiskalni račun, nego uz fiskalni
račun prilažu specifikaciju (fakturu) sa stvarnim stavkama. Na fiskalnom računu
tada treba biti **jedna zbirna stavka**, a stvarni artikli/usluge se naknadno
dodjeljuju računu u sekciji Računi i printaju kao poseban A4 dokument koji se
fizički prilaže uz fiskalni račun.

Zakonski okvir (FBiH, Zakon o fiskalnim sistemima 81/09): zbirna stavka je
prihvatljiva za fakturisani promet, a **priloženi dokument mora sadržavati broj
fiskalnog računa (BF)** — veza ide od fakture ka fiskalnom računu, ne obratno.
BF broj nastaje tek fiskalizacijom pa ne može biti u nazivu stavke; u naziv ide
interni broj priloga.

## Odluke (dogovoreno s korisnikom)

1. Kasir na kasi **ručno unosi iznos** — stavke se dodjeljuju kasnije.
2. Naziv zbirne stavke: **"Stavke po računu br. N"**, gdje je N interni broj
   priloga dodijeljen prije fiskalizacije. Isprintani prilog nosi isti broj N
   **i obavezni BF broj**.
3. Dodijeljeni artikli **skidaju stanje sa skladišta**, tačno jednom.
4. **Suma stavki priloga mora biti jednaka** fiskalnom iznosu — print blokiran
   dok se ne poklopi.
5. Print priloga: **A4 PDF** u stilu postojećih dokumenata.
6. Kasa UI: **posebno dugme + dijalog** (korpa se ne koristi; račun uvijek ima
   samo jednu zbirnu stavku).

## Dizajn

### 1. Baza (migracija)

- `orders` dobija kolonu `prilogBroj INTEGER NULL`.
  - `NULL` za obične račune; popunjena vrijednost ujedno je flag "račun po
    prilogu" i interni broj priloga.
  - Dodjela: `COALESCE(MAX(prilogBroj), 0) + 1` u trenutku fiskalizacije.
- Nova tabela:

  ```sql
  CREATE TABLE prilog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );
  ```

- **Bez skrivenog proizvoda:** za prilog račune `order_items` ostaje prazan.
  Zbirna stavka "Stavke po računu br. N" se sintetizuje iz polja `orders`
  (prilogBroj + ukupno) svugdje gdje se prikazuje ili šalje: fiskalni print
  (Tring), detalji računa, kopija računa.

### 2. Kasa ekran

- Stalno dugme **"Račun po prilogu"** uz korpu na `KasaScreen`.
- Dijalog:
  - iznos (decimal input, obavezno, > 0),
  - način plaćanja (gotovina/kartica, kao postojeća naplata),
  - opcionalno podaci kupca (ista polja kao postojeći ručni unos računa),
  - informativni prikaz naziva stavke koja će biti otkucana:
    "Stavke po računu br. N".
- Potvrda fiskalizuje račun sa jednom stavkom (naziv kao gore, količina 1,
  cijena = iznos, PDV stopa `E`), zatim snima order sa `prilogBroj` i
  `brojFiskalnogRacuna` iz odgovora printera. `pdvIznos` se računa standardno.

### 2a. Dopuna (2026-08-14): stavke se mogu unijeti odmah na kasi

Dijalog na kasi je prerastao u radnu površinu (širok ~1180px, 92vh) sa dvije
kolone i prekidačem izvora iznosa:

- **Tab "Stavke"** (podrazumijevan): pretraga šifarnika (samo stopa `E`),
  lista sa količinom i cijenom po stavci. Iznos je **izveden** — suma stavki,
  polje se ne kuca. Tastatura: `↑↓` izbor, `Enter` dodaj, `F2` promjena taba,
  `F5` fiskalizuj, `Esc` čisti pretragu pa zatvara dijalog.
- **Tab "Ručni iznos"**: raniji tok — ukuca se samo ukupan iznos, stavke se
  dodjeljuju kasnije u sekciji Računi.
- Desna kolona je zajednička: displej iznosa, način plaćanja, kupac
  (pretraga sačuvanih kupaca + ručni unos), dugme za fiskalizaciju.

`finalizePrilogAndPrint` prima opcione `stavke`; kad ih ima, one su jedini
izvor istine za iznos (`sumaPriloga`), a ukucani `iznos` se ignoriše. Stavke
se validiraju **prije štampe** (`validirajPrilogStavke`) da neispravan unos ne
proizvede papir bez pokrića, i upisuju se u **istoj transakciji** kao i račun.
Write-ahead snapshot nosi `prilogStavke`, pa ih `pending:resolve` ne izgubi
kad baza padne nakon uspješne štampe.

Stavke unesene na kasi ostaju izmjenjive kroz "Uredi prilog" — fiskalni iznos
je zaključan štampom, suma stavki se i dalje mora poklopiti s njim.

### 3. Sekcija Računi (NarudzbeScreen)

- Prilog računi u listi označeni badge-om "Prilog br. N".
- Akcija **"Uredi prilog"** otvara dijalog:
  - pretraga šifarnika (artikli i usluge),
  - po stavci: količina i cijena (default iz šifarnika, može se mijenjati),
  - live prikaz sume stavki naspram fiskalnog iznosa računa.
- Spremanje:
  - upisuje `prilog_stavke` (zamjena kompletnog seta: obriši stare, upiši nove),
  - sinhronizuje `stock_movements`: obriši postojeće movements
    `referenceType='prilog'` za taj order, upiši nove (`tip='izlaz'`,
    `referenceType='prilog'`, `referenceId=orderId`) — **samo za proizvode
    `tip='artikal'`**; usluge ne diraju stanje.
  - Spremanje je dozvoljeno i s nepotpunom sumom (rad u više navrata), ali:
- **Print PDF-a dozvoljen tek kad je suma stavki == `orders.ukupno`**
  (poređenje na 2 decimale).
- **Samo stavke sa PDV stopom `E`** smiju u prilog: zbirna stavka je fiskalno
  otkucana sa stopom `E`, pa bi stavka sa stopom `K` napravila raskorak u PDV
  rekapitulaciji između fiskalnog računa i priloga. Dijalog ne nudi proizvode
  sa stopom `K` (ili ih odbija uz poruku).
- **Storno** prilog računa vraća stanje po `prilog_stavke` (ne po
  `order_items`) — insert `ulaz` movements po artiklima priloga. Uređivanje
  priloga blokirano nakon storniranja.

### 4. PrilogPdf (A4)

Novi komponent u stilu postojećih PDF-ova (`RacunPdf`/`OtpremnicaPdf`):

- zaglavlje firme (postojeća firma polja iz postavki),
- naslov: **"Specifikacija br. N uz fiskalni račun BF {brojFiskalnogRacuna}"**,
- datum, kupac (ako je unesen na računu),
- tabela stavki: šifra, naziv, JM, količina, cijena, iznos,
- ukupno + PDV rekapitulacija.

Ovim prilog zadovoljava zakonsku obavezu da faktura/specifikacija nosi BF broj.

### 5. Zašto nema duplog računanja

- **Promet/izvještaji:** računaju se iz `orders` (`ukupno`, `pdvIznos`) —
  prilog račun je jedan order s jednim iznosom, kao i do sada.
- **Skladište:** samo iz `stock_movements`; movements za prilog stavke se
  upisuju jednom (uz diff pri ponovnom uređivanju).
- **`order_items`:** prazan za prilog račune, pa nijedna agregacija po
  stavkama ne vidi ni zbirnu ni stvarne stavke dvaput.

### 6. Testovi

- Unit: dodjela `prilogBroj` (prvi i sljedeći), validacija sume (jednaka /
  različita / zaokruživanje na 2 decimale), diff logika stock movements
  (dodavanje, izmjena, brisanje stavki), usluge ne generišu movements.
- Integration: kreiranje prilog računa → dodjela stavki → stanje skladišta
  tačno → storno vraća stanje → ponovno uređivanje blokirano.

## Van opsega (YAGNI)

- Miješanje zbirne stavke s običnim stavkama u istoj korpi.
- POS (termalna) štampa priloga.
- Fiskalizacija po stavci prema novom Zakonu o fiskalizaciji FBiH (9/26) —
  primjena tek nakon podzakonskih akata; zabilježeno kao srednjoročna stavka u
  research dokumentu.
