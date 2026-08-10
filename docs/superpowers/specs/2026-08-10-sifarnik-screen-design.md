# Šifarnik ekran — reorganizacija Skladišta

**Datum:** 2026-08-10

## Problem

`SkladisteScreen` ima 5 tabova: Artikli, Usluge, Ulaz robe, Dobavljači, Kupci. Kupci
nemaju veze sa skladištem (koriste se u Kasi, Računima i Ponudama — to je opšti
šifarnik), a Usluge nisu roba i nemaju stanje. Fajl je ujedno narastao na ~2500 linija.

## Rješenje

Nova stavka u sidebaru **Šifarnik** koja preuzima matične evidencije; Skladište
zadržava samo ono što se tiče robe.

```
Sidebar:
  Kasa
  Skladište      → [Artikli | Ulaz robe]
  Šifarnik       → [Kupci | Dobavljači | Usluge]
  Računi
  Ponude
  Izvještaji
  Generator (admin)
  Postavke (admin)
```

## Izmjene

1. **Novi ekran `src/screens/SifarnikScreen.tsx`** sa tabovima Kupci, Dobavljači,
   Usluge. Komponente `KupciTab`, `DobavljaciTab` i `UslugeTab` se premještaju iz
   `SkladisteScreen.tsx`, svaka u zaseban fajl pod `src/components/sifarnik/`
   (`KupciTab.tsx`, `DobavljaciTab.tsx`, `UslugeTab.tsx`). `SifarnikScreen` ih samo
   slaže i drži tab-state, po istom obrascu kao `SkladisteScreen`.
2. **`SkladisteScreen.tsx`** zadržava tabove Artikli i Ulaz robe. Forma za primku
   (Ulaz robe) i dalje učitava listu dobavljača preko IPC-a za svoj dropdown —
   premješta se samo *uređivanje* dobavljača, ne i podaci.
3. **`MainLayout.tsx`**: tip `Screen` se proširuje sa `'sifarnik'`; nova stavka
   `{ id: 'sifarnik', label: 'Šifarnik', icon: BookUser }` odmah iza Skladišta,
   dostupna svim korisnicima (nije `adminOnly`).
4. **Zajednički helperi**: lokalne helper komponente/stilovi koje premješteni tabovi
   dijele sa ostatkom `SkladisteScreen.tsx` izdvajaju se u zajednički fajl
   (npr. `src/components/sifarnik/shared.tsx`) samo ako se pokaže potrebnim.

## Van opsega

- Nema promjena u bazi, IPC handlerima niti poslovnoj logici — čisto premještanje UI-ja.
- Postojeći testovi ostaju netaknuti; ne dodaju se novi (nema nove logike).

## Kriterij uspjeha

- Šifarnik u sidebaru prikazuje Kupce, Dobavljače i Usluge sa istim funkcionalnostima
  kao prije (dodavanje, izmjena, pretraga).
- Skladište prikazuje samo Artikli i Ulaz robe; primka i dalje nudi izbor dobavljača.
- Aplikacija se builda i svi postojeći testovi prolaze.
