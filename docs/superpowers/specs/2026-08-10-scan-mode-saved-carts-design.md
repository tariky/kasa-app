# Scan mode i spremljene košarice — dizajn

Datum: 2026-08-10

## Cilj

Dvije nezavisne dorade Kasa ekrana:

1. **Scan mode** — prekidač koji, kad je uključen, preskače dijalog za unos količine: svaki dodani artikal ide u košaricu s količinom 1 (ponovni sken/dodavanje povećava količinu za 1).
2. **Spremljene košarice** — mogućnost da se trenutna košarica "parkira" (npr. kupac otišao po još artikala), pa kasnije nastavi. Više košarica istovremeno, preživljava restart aplikacije.

## 1. Scan mode

### Ponašanje

- ShadCN `Switch` s labelom "Scan mode" u headeru Kasa ekrana, pored polja za pretragu.
- Stanje se čuva u `settings` tabeli pod ključem `kasa.scanMode` (`'true'`/`'false'`), učitava se pri mountu kao postojeće `kasa.*` postavke.
- Kad je **uključen**: svi putevi dodavanja (sken/Enter, klik na artikal, strelice+Enter) zaobilaze quantity dijalog i direktno dodaju artikal s količinom 1. Postojeća pravila ostaju: postojeća stavka se uvećava za 1, provjera zaliha (`allowZeroStock`, usluge) ista kao u `confirmAddToCart`.
- Kad je **isključen**: sve radi kao sada (dijalog za količinu).
- Nakon svakog dodavanja fokus se vraća u polje pretrage i pretraga se čisti (postojeće ponašanje).

### Implementacija

- U `KasaScreen.tsx`: izdvojiti čistu funkciju dodavanja `addToCart(product, qty)` iz `confirmAddToCart` (logika zaliha/sabiranja), pa:
  - scan mode ON → pozivi koji sada zovu `promptAddToCart` zovu `addToCart(product, 1)`;
  - scan mode OFF → `promptAddToCart` kao dosad, a `confirmAddToCart` koristi istu `addToCart` funkciju.

## 2. Spremljene košarice

### Model podataka

Nova tabela (stil kao `pending_receipts` — JSON snapshot, jer je košarica privremena):

```sql
CREATE TABLE IF NOT EXISTS saved_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv TEXT NOT NULL,
  items TEXT NOT NULL,           -- JSON: [{ productId, kolicina, rabat }]
  ukupno REAL NOT NULL,          -- informativno, za prikaz u listi
  createdAt TEXT DEFAULT (datetime('now','localtime'))
);
```

U JSON-u se čuva samo `productId, kolicina, rabat` — pri nastavku se proizvod ponovo učitava iz baze pa su cijena, naziv i stanje svježi.

### IPC

Po postojećem obrascu (`handlers.ts`, `preload.ts`, `global.d.ts`):

- `savedCarts:list` → sve spremljene košarice (bez parsiranja JSON-a u handleru; renderer parsira po potrebi).
- `savedCarts:save (naziv, items, ukupno)` → insert, vraća id.
- `savedCarts:delete (id)` → briše.

### UI na Kasa ekranu

- **Dugme "Spremi"** u panelu košarice, aktivno samo kad košarica nije prazna. Klik: sprema košaricu s automatskim nazivom `HH:mm — N art.` (bez obaveznog unosa naziva), prazni trenutnu košaricu, prikazuje potvrdnu poruku.
- **Dugme "Spremljene (N)"** vidljivo kad postoji bar jedna spremljena košarica; otvara dijalog sa listom: naziv, vrijeme, iznos, dugmad **Nastavi** i **Obriši**.
- **Nastavi**: ako trenutna košarica nije prazna, traži potvrdu (trenutna se odbacuje). Učitana košarica se briše iz `saved_carts`.

### Provjera stanja pri nastavku

Pri **Nastavi**, za svaku stavku se proizvod učita iz baze (`getProduct`):

- Proizvod **ne postoji više** → stavka se preskače, ide u upozorenje.
- Stanje **nedovoljno** (nije usluga, `allowZeroStock` isključen): količina se sreže na dostupno stanje; ako je stanje 0, stavka se izbacuje. Ide u upozorenje.
- Usluge i režim `allowZeroStock` → učitava se puna količina bez upozorenja o stanju.

Ako ima problematičnih stavki, prikazuje se upozorenje (postojeći `message` mehanizam ili dijalog) sa listom: naziv artikla i razlog ("obrisan", "stanje: traženo X, dostupno Y").

## Rubni slučajevi

- Spremanje košarice ne dira zalihe — zalihe se skidaju tek pri naplati (postojeće ponašanje).
- Dvije spremljene košarice mogu sadržavati isti artikal; sukob se razrješava tek provjerom stanja pri nastavku odnosno naplati.
- Restart aplikacije: košarice su u SQLite bazi, preživljavaju.

## Testiranje

- `bun test` unit/integration u postojećem stilu (`batchRacuni.integration.test.ts` kao uzor):
  - `saved_carts` round-trip: save → list → delete.
  - Logika provjere stanja pri nastavku (čista funkcija, npr. `restoreCart(items, products, allowZeroStock)` u `src/lib/` s testovima): srezivanje količina, izbacivanje obrisanih/nula-stanja, generisanje upozorenja.
  - `addToCart` logika (scan mode sabiranje, poštovanje zaliha) ako se izdvoji u čistu funkciju.

## Van opsega

- Vezivanje spremljene košarice za korisnika/kupca.
- Automatsko čuvanje trenutne košarice (bez ručnog "Spremi").
- Uređivanje spremljene košarice bez nastavka.
