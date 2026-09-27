# Refaktor i pojednostavljenje — analiza i odluke

Izvor: analiza 2026-09-26 (pet paralelnih pregleda: IPC/Electron main, Rust backend,
`src/lib`, UI, PDF + testovi), stanje `c299e42` na grani `fix/zalihe`. Rječnik:
**dubok modul** = mali interfejs, puno ponašanja; **šav** = mjesto gdje se ponašanje mijenja
bez editovanja tog mjesta; test brisanja = obriši modul — ako se kompleksnost pojavi kod N
pozivalaca, modul zaslužuje mjesto.

## Zaključak analize

Kod je uglavnom zdrav (`handle()` / `call_u_redu`, šav `napraviApi` s dva adaptera,
`pripremiRacun`, obrazac knjigovođe su duboki moduli). Cijena se plaća na tri mjesta:

1. **Ručni paritet TS↔Rust** — spiskovi kanala, allowliste postavki, konstante i migracije
   ručno kopirani na 2–4 mjesta.
2. **Tok fiskalne štampe** — isti tok „pripremi → provjeri → štampaj → upiši" u 5 varijanti
   u TS-u i 5 u Rustu; već proizveo stvaran bug (dupli fiskalni račun, rješava ga zalihe Task 4).
3. **Poslovna logika na pogrešnom mjestu** — ~1900 od 2110 linija `handlers.ts` je domenska
   logika (52 handlera sa SQL-om u tijelu); ista računica ponovljena u UI-ju i PDF-ovima.

## Bugovi nađeni usput

| # | Problem | Gdje | Status |
|---|---|---|---|
| 1 | Ponuda/nalog/storno ne razlikuju nepoznat ishod štampe → mogući dupli fiskalni račun | `ponuda.ts`, `proizvodnja.ts`, `refund.ts` (+Rust) | **zalihe Task 4** (druga sesija) |
| 2 | Lokalni `round2` bez `EPSILON` (1.005 → 1.00) | `kalkulacija.ts:25`, `batchRacuni.ts:46`, `ploca.ts:15` | Task A5 |
| 3 | Iznos reda na ponudi nezaokružen (red 2,67, UKUPNO 2,68) | `PonudaPdf.tsx:417` | Task A4 |
| 4 | Dva parsera načina plaćanja; ladica za `'gotovina'` vidi 0 | `drawer.ts:31` vs `placanje.ts` | Task A6 |
| 5 | Electron prefiks „Error invoking remote method" na 44 mjesta u UI-ju | `preload.ts` | Task A5 |
| 6 | Prazan kupac `''` vs `NULL` u tri INSERT-a u `orders` | `handlers.ts:106`, `racun.ts:72`, `prilog.ts:321` | Task B1/B2 |
| 7 | `ziroRacuniPozicija` poštuje samo Prilog; `ZaglavljePrikaz` ima druge mjere od PDF-a | PDF-ovi | Task A4 |
| 8 | „Marža" u Izvještajima i PDF-u primki = (MP sa PDV − nabavna)/nabavna; primka pokazuje RUC bez PDV-a | `IzvjestajiScreen.tsx:541,570`, `PrimkePdf.tsx:69` | Task A3 |

## Odluke vlasnika (2026-09-26)

1. **Ponuda, nalog i storno na nepoznat ishod štampe** dobijaju pending red kao `finalize`
   (preporuka prihvaćena). Implementira je zalihe Task 4; ovaj refaktor gradi na tome.
2. **Marža se računa knjigovodstveno ispravno**: kao obrazac KCM i `kalkulacijaPrimke` —
   RUC = prodajna vrijednost bez PDV-a − nabavna vrijednost (fakturna − rabat + zavisni
   troškovi), samo stavke koje se prodaju (materijal isključen); stopa RUC = RUC / nabavna
   vrijednost tih stavki × 100. Naziv u UI-ju i PDF-u: „RUC".
3. **Prazan kupac se upisuje kao `NULL`** (svi putevi upisa računa, oba backenda).
4. **Ladica ne smije imati nepoznat način plaćanja**: svaki put upisa `orders.nacinPlacanja`
   provjerava vrijednost prije štampe; postojeće varijante (mala slova, razmaci, ključevi JSON-a
   drugačijeg slova) normalizuje idempotentna migracija; ladica, izvoz i ekran koriste jedan
   parser.
5. **`product:findByDobavljacSifra` ostaje** (osnova za automatski unos robe).
6. **`ziroRacuniPozicija` važi za sve dokumente prema kupcu**: Račun, Ponuda, Otpremnica i
   Prilog (Radni nalog je interni dokument i ostaje bez žiro računa).

## Teme refaktora

- **T1** Politika pristupa i spisak kanala kao zajednički podaci (`src/ipc/pristup.json`,
  Rust čita `include_str!`); Rust dispatch kao tabela kanala.
- **T2** Fiskalizacija kao jedan dubok modul (`fiskalizuj`, adapter `FiskalniUredjaj`, jedan
  `upisiRacun`; Rust `stampa.rs`); UI `fiskalniIshod.ts`.
- **T3** Orkestracija primke iz `handlers.ts` u `lib/primka.ts` (oblik koji Rust već ima).
- **T4** Knjiga zalihe (`zaliha.ts` / `zaliha.rs`).
- **T5** Tipiziran šav IPC-a (`Api = ReturnType<typeof napraviApi>`, tip `Kanali`).
- **T6** Novac, PDV, datumi, konstante na jednom mjestu.
- **T7** Sesija, katalog i postavke izvan `handlers.ts`.
- **T8** UI: stavke dokumenta, fiskalna naplata, `useIpcPodaci`, `ModuliProvider`, navigacija
  liste, šifarnik ljuska; tek onda razbijanje Kase i Ponuda.
- **T9** PDF: računica u lib, `otvoriPdf()`, `<A4Dokument>` + `<TabelaStavki>`, izvještajna
  porodica — uz poređenje slika kao sigurnosnu mrežu.
- **T10** Testovi: lažni Tring bez kašnjenja, `scenarij(b)`, „zamijeni, ne slaži".

## Šta se NE dira

- `handle()` i `call_u_redu`; šav `napraviApi`; obrazac s deps u lib modulima.
- Emulacija JS-a u Rustu (`js.rs`, JS poruke grešaka), `petlja.rs`.
- Mapiranje funkcija 1:1 TS↔Rust u `skladiste.rs` i `proizvodnja.rs` — TS se primiče Rustu,
  ne obrnuto.
- Podjela backup i licenca modula (prati granice procesa).
- `KnjigovodjaPdf` + `lib/knjigovodja/obracun` (obrazac za ostale), 17-kolonski KCM u `UlazPdf`,
  XML u `tring.ts`.
- Nema generičke CRUD tabele za šifarnik (forme se previše razlikuju) — samo ljuska.
- Poruke grešaka i SQL se ne izvlače u katalog (ugovorni testovi ih provjeravaju doslovno).
