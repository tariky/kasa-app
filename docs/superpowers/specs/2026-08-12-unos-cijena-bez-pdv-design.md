# Unos cijena bez PDV-a — dizajn

Datum: 2026-08-12

## Problem

Kod kreiranja artikla ili usluge korisnik uvijek unosi **bruto** cijenu (sa
uračunatim PDV-om). Dobavljači i cjenovnici često daju **netto** cijene, pa
korisnik mora ručno množiti sa 1,17 prije unosa. Traži se postavka koja mijenja
režim unosa.

## Rješenje u jednoj rečenici

Globalni toggle u Postavkama koji mijenja **samo način unosa** cijene u formama
artikla i usluge — korisnik upisuje netto, aplikacija dodaje PDV i u bazu sprema
bruto kao i do sada.

## Šta se NE mijenja

Ovo je namjerno mali zahvat. Ostaje netaknuto:

- **Baza** — `products.cijena` i dalje čuva bruto cijenu. Nema migracije, nema
  promjene sheme, postojeći artikli se ne diraju.
- **Kasa, ponude, narudžbe, izvještaji** — svi računaju iz bruto cijene.
- **Tring fiskal** — fiskalni uređaj traži bruto cijene; taj put ostaje isti.
- **PDF dokumenti** — račun, ponuda, otpremnica, primka, nivelacija.
- **Primka i nivelacija** — polja `nabavnaCijena` i `cijena` u primci ostaju
  potpuno van dosega. (Nivelacija nema svoju formu za unos — nova MP cijena se
  izvodi iz kolone "prodajna cijena" u dijalogu primke, `SkladisteScreen.tsx`.
  Odluka je da se taj tok ne dira.)

## Model podataka

Nova postavka koristi postojeći generički `settings` mehanizam
(`window.api.getSetting` / `setSetting`, isti obrazac kao
`kasa.showDailyTotal`):

```
key:   cijene.unosBezPdv
value: 'true' | 'false'
```

Kad ključ ne postoji, tretira se kao `'false'` — to je postojeće ponašanje, pa
je nadogradnja bez iznenađenja.

## Nova biblioteka: `src/lib/pdvUnos.ts`

Mali, čisto računski modul bez zavisnosti na UI. Koristi `round2` iz
`src/lib/novac.ts`.

```ts
export function uBruto(netto: number, pdvStopa: string): number
export function uNetto(bruto: number, pdvStopa: string): number
```

Ponašanje:

| pdvStopa | `uBruto(x)` | `uNetto(x)` |
|---|---|---|
| `'E'` (17 %) | `round2(x * 1.17)` | `round2(x / 1.17)` |
| `'K'` (0 %) | `x` | `x` |

Stopa 17 % se već pojavljuje kao literal `1.17` u `src/lib/racun.ts`; ovaj modul
zadržava isti oblik radi konzistentnosti, bez uvođenja konfigurabilne stope.

### Zaokruživanje kod izmjene

Konverzija u oba smjera nije uvijek povratna: `round2(round2(x / 1.17) * 1.17)`
može odstupiti za fening. Zato forma za **izmjenu** postojećeg artikla pamti
originalnu bruto cijenu i tekst koji je prvobitno prikazan u polju:

- ako korisnik **nije mijenjao** tekst u polju cijene → sprema se originalni
  bruto, bez ikakve konverzije;
- ako **jeste mijenjao** → sprema se `uBruto(uneseno, pdvStopa)`.

Time izmjena naziva artikla ne može tiho pomjeriti cijenu.

## UI

### 1. Postavke → tab Sistem

Novi red sa `Switch` komponentom, u istom stilu kao postojeći redovi u kartici
"Postavke kase" (`PostavkeScreen.tsx`, oko linije 958):

> **Cijene se unose bez PDV-a**
> Kod unosa artikla ili usluge upisuješ cijenu bez PDV-a; aplikacija sama dodaje 17 %.

Pri promjeni prekidača prikazuje se toast:

- uključeno → „Cijene se od sada unose bez PDV-a. Postojeći artikli nisu promijenjeni."
- isključeno → „Cijene se od sada unose sa PDV-om. Postojeći artikli nisu promijenjeni."

### 2. Forma artikla (`SkladisteScreen.tsx`) i usluge (`components/sifarnik/UslugeTab.tsx`)

Kad je režim aktivan **i** odabrana stopa je `'E'`:

- labela polja: `Cijena bez PDV-a (KM)` umjesto `Cijena (KM)`;
- ispod polja sivi live preview: `Sa PDV-om: 117,00 KM` (formatiran preko
  `formatKM`), koji se osvježava dok korisnik kuca;
- bedž pored naslova dijaloga: `Novi artikal` + oznaka `bez PDV-a`.

Kad je odabrana stopa `'K'` (0 %), režim se za to polje ne primjenjuje: labela
ostaje `Cijena (KM)`, preview se sakriva, a bedž se ne prikazuje — jer bi oznaka
„bez PDV-a" na artiklu bez PDV-a bila obmanjujuća.

Ako korisnik promijeni stopu sa `'K'` na `'E'` (ili obrnuto) dok je dijalog
otvoren, već upisani broj u polju ostaje nepromijenjen — mijenja se samo
tumačenje: labela, preview i bedž se preračunaju prema novoj stopi.

Obje forme čitaju postavku pri otvaranju dijaloga.

## Testiranje

`bun test`, novi fajl `src/lib/pdvUnos.test.ts`:

- `uBruto(100, 'E')` → `117.00`
- `uNetto(117, 'E')` → `100.00`
- `uBruto(100, 'K')` → `100` i `uNetto(100, 'K')` → `100` (nema konverzije)
- zaokruživanje na dvije decimale kod nezgodnih vrijednosti
  (npr. `uNetto(100, 'E')` → `85.47`)
- povratna konverzija: `uBruto(uNetto(100, 'E'), 'E')` → `100.00`

Ponašanje formi (labela, preview, bedž, čuvanje originalnog bruta kod
neizmijenjenog polja) provjerava se ručno u aplikaciji — projekat nema
postojeću infrastrukturu za testiranje React komponenti i ovaj zahvat je ne
opravdava.

## Rizici

- **Korisnik zaboravi da je režim aktivan i unese bruto cijenu.** Ublaženo
  bedžom u dijalogu, izmijenjenom labelom i live previewom koji odmah pokazuje
  rezultat.
- **Zaokruživanje kod izmjene.** Ublaženo pravilom „ne diraj cijenu ako polje
  nije mijenjano" (gore).
