# Izvoz za knjigovođu — dizajn

**Datum:** 2026-09-25

## Cilj

Vlasnik jednom mjesečno (ili za proizvoljan period) šalje knjigovođi sve što treba za knjiženje. Danas to radi ručno iz više PDF izvještaja koji se samo otvaraju u prozoru. Dodajemo jedan izvoz: izabere se mjesec ili period od–do, klikne dugme, i snimi se jedan `.zip` s Excel fajlom (za rad) i PDF rekapitulacijom (za arhivu i potpis).

**Uspjeh:** knjigovođa iz jednog priloga može proknjižiti izlazne račune (KIF), ulazne (KUF), reklamacije, polog/povrat, utrošak materijala i stanje zaliha, bez dopisivanja s vlasnikom; zbirovi u Excelu, PDF-u i pregledu na ekranu su isti.

## Obim

**Uključeno:** rekapitulacija po danu/stopi/načinu plaćanja, KIF (računi), reklamacije, KUF (primke + stavke), nivelacije, polog/povrat, utrošak materijala iz radnih naloga, zalihe na zadnji dan perioda, kontrola fiskalne numeracije; Excel + PDF u jednom ZIP-u; izbor mjeseca ili perioda; tab samo za admina.

**Isključeno (YAGNI):** Z/X izvještaji (nisu u bazi — postoje samo na Tring uređaju; rekapitulacija po danima ih zamjenjuje i PDF to navodi), ponude, šifarnik kupaca/dobavljača, direktan uvoz u knjigovodstvene programe (specifični formati), slanje mailom, zakazani izvoz.

## 1. Sadržaj izvoza

Ime fajla: `Knjigovodja_<Firma>_2026-09.zip` kad je izabran cijeli mjesec, inače `Knjigovodja_<Firma>_2026-09-01_2026-09-15.zip`. `<Firma>` je `firma.naziv` očišćen od znakova nedozvoljenih u imenu fajla (prazno → izostavlja se). Unutra `…xlsx` i `…pdf` s istim osnovnim imenom.

### 1.1 Excel (`.xlsx`)

Svaki list ima zaglavlje: naziv firme, JIB, PDV broj, period, datum izvoza. Ispod tabela sa zamrznutim redom naslova, autofilterom, formatom `#,##0.00` za KM i `dd.mm.yyyy` za datume, i zbirnim redom na dnu gdje ima smisla.

| List | Kolone | Filter |
|---|---|---|
| **Rekapitulacija** | Po danu: datum, broj računa, osnovica E, PDV E, iznos K, ukupno, gotovina, kartica, virman, ček, reklamacije (iznos, negativno), neto. Zbirni red za period. | `date(orders.createdAt)`; reklamacije po `date(refundedAt)` |
| **KIF – računi** | datum i vrijeme, fiskalni broj, kupac, JIB kupca, osnovica E, PDV E, iznos K, ukupno, način plaćanja (tekst; za podijeljeno npr. „Gotovina 20,00 + Kartica 30,00“), datum valute, oznaka (ručni / po prilogu / reklamiran) | `date(createdAt)` — svi računi prodani u periodu, i oni kasnije reklamirani |
| **Reklamacije** | datum reklamacije, broj reklamacije, originalni fiskalni broj, datum originala, kupac, osnovica E, PDV E, iznos K, ukupno (negativno), način plaćanja | `date(refundedAt)` |
| **KUF – ulaz robe** | datum, broj primke, dobavljač, JIB/ID dobavljača, broj fakture, fakturna vrijednost, rabat, zavisni troškovi, nabavna vrijednost, PDV (ulazni, na nabavnu), prodajna vrijednost s PDV-om, RUC | `primke.datum` |
| **Ulaz – stavke** | broj primke, datum, šifra, artikal, JM, količina, fakturna cijena, rabat %, zavisni, nabavna cijena, prodajna cijena, PDV stopa | isto |
| **Nivelacije** | broj, datum, šifra, artikal, količina, stara cijena, nova cijena, razlika po jedinici, ukupna razlika, PDV stopa | `nivelacije.datum` |
| **Polog / povrat** | datum i vrijeme, vrsta, iznos, korisnik, napomena, status na Tringu | `date(cash_movements.createdAt)` |
| **Utrošak materijala** | Po nalogu: broj/godina, datum završetka, opis/proizvod, šifra materijala, materijal, JM, količina, nabavna cijena, vrijednost. Ispod: zbir po materijalu (šifra, naziv, JM, količina, vrijednost). | `date(radni_nalozi.zavrsenAt)`, status `zavrsen` ili `fakturisan` |
| **Zalihe na dan** | šifra, artikal, JM, tip, količina, prosječna nabavna cijena, nabavna vrijednost, prodajna cijena, prodajna vrijednost. Samo artikli s količinom ≠ 0; tip `usluga` se preskače. | `stock_movements` s `date(createdAt) <= do` |
| **Kontrola** | Rupe u numeraciji fiskalnih računa čiji brojevi padaju u raspon računa iz perioda (odbačene rupe iz `fiscal.dismissedGaps` se ne prijavljuju); računi iz perioda bez fiskalnog broja; računi čiji zbir stavki odstupa od `ukupno` > 0,01 KM; računi s nepoznatim oblikom načina plaćanja. Ako nema ničega: jedan red „Nema upozorenja“. | period |

Listovi **KUF – ulaz robe**, **Ulaz – stavke**, **Nivelacije** i **Zalihe na dan** postoje samo ako je modul `skladiste` aktivan u licenci; **Utrošak materijala** samo ako je aktivan `proizvodnja` (i `proizvodnja.enabled`). Kad modul nije aktivan, list se ne pravi (ne prazan list).

### 1.2 PDF rekapitulacija

1–2 strane A4, u stilu `PrometPdf`:

- Zaglavlje: firma (naziv, adresa, JIB, PDV broj), „Izvještaj za knjigovodstvo“, period, datum izvoza.
- Promet: osnovica E, PDV E, iznos K, ukupno; po načinu plaćanja; broj računa.
- Reklamacije: broj i iznos po stopi.
- Neto promet (promet − reklamacije).
- Ulaz robe (ako skladište): broj primki, nabavna vrijednost, ulazni PDV, prodajna vrijednost; nivelacije ukupna razlika.
- Polog / povrat: zbir pologa, zbir povrata.
- Utrošak materijala (ako proizvodnja): broj naloga, ukupna vrijednost.
- Zalihe na dan `do` (ako skladište): nabavna i prodajna vrijednost.
- Upozorenja iz lista Kontrola (ili „Nema upozorenja“).
- Napomena: „Z i X izvještaji se vode na fiskalnom uređaju i nisu dio ovog izvoza.“
- Dno: mjesta za potpis (sastavio / primio) i datum.

## 2. Pravila obračuna

- **Iznos i PDV po stavci** računaju se postojećim `iznosStavke` / `pdvStavke` iz `src/lib/racun.ts` (zaokruživanje po stavci kao fiskalni uređaj). Osnovica E = iznos E − PDV E. Zbir po računu zaokružen jednom (`round2`), isto kao `izracunajTotale`.
- **Račun po prilogu** nema `order_items`; stavke dolaze iz `prilog_stavke` (rabat 0). Ako prilog nema ni tih stavki, cijeli `ukupno` se tretira kao jedna stavka stope E (isto kao `order:get`).
- **Odstupanje od `orders.ukupno`**: ako zbir stavki odstupa od `orders.ukupno` za više od 0,01 KM, račun se prijavljuje na listu Kontrola; u KIF ide `orders.ukupno` a razlika se pripisuje stopi E, da zbir KIF-a odgovara fiskalnom prometu.
- **Način plaćanja**: tekst (`Gotovina`, `Kartica`, `Virman`, `Ček`) → cijeli iznos u tu kolonu; JSON (`{gotovina, kartica, virman, cek}`) → raspoređuje se po ključevima. Nepoznat oblik (ni tekst ni JSON s poznatim ključevima) → cijeli iznos ide u gotovinu, a račun se prijavljuje u Kontroli. Parsiranje u jednoj funkciji uz `gotovinskiIznos` u `src/lib/drawer.ts`.
- **Reklamacija** je u periodu kad je `refundedAt` u periodu, bez obzira kad je račun prodan. Račun prodan i reklamiran u istom periodu pojavljuje se i u KIF-u i u Reklamacijama (isto pravilo kao `ocekivanoStanje` za ladicu).
- **KUF vrijednosti** preko `src/lib/kalkulacija.ts` (`fakturnaVrijednost`, `rabatIznos`, `nabavnaVrijednost`); ulazni PDV = nabavna vrijednost × stopa (`pdvStopaPct`); prodajna vrijednost = Σ `cijena × kolicina` (materijal: 0); RUC = prodajna bez PDV-a − nabavna.
- **Prosječna nabavna cijena** (zalihe) ista formula kao `getProsjecnaNabavna`, ali samo nad `primka_stavke` čija primka ima `datum <= do`. Bez primki → 0.
- **Utrošak materijala**: vrijednost = `radni_nalog_stavke.kolicina × nabavnaCijena` (snimljena na nalogu; ako je NULL → prosječna nabavna na dan završetka, ista formula kao gore).
- **Mjesec** = od prvog do zadnjeg dana u mjesecu; sve granice su lokalni datumi `YYYY-MM-DD`, uključivo.

## 3. Arhitektura

### 3.1 Kanal `izvoz:knjigovodja(od: string, do: string) → KnjigovodjaPodaci`

Jedan kanal samo za čitanje. Vraća **sirove redove**, sva logika obračuna je u TS-u u rendereru — Rust nema šta da duplira osim SQL upita.

```ts
interface KnjigovodjaPodaci {
  od: string; do: string;
  izvezeno: string;               // 'YYYY-MM-DD HH:MM:SS' lokalno
  firma: FirmaSettings;
  moduli: { skladiste: boolean; proizvodnja: boolean };
  racuni: IzvozRacun[];           // prodani u periodu (createdAt)
  reklamacije: IzvozRacun[];      // reklamirani u periodu (refundedAt)
  stavkeRacuna: IzvozStavkaRacuna[]; // za sve račune iz obje liste: orderId, cijena, kolicina, rabat, pdvStopa, izvor 'order'|'prilog'
  primke: IzvozPrimka[];          // [] ako skladište nije aktivno
  primkaStavke: IzvozPrimkaStavka[];
  nivelacije: IzvozNivelacijaStavka[];
  kretanjaNovca: IzvozKretanjeNovca[];
  utrosak: IzvozUtrosak[];        // [] ako proizvodnja nije aktivna
  zalihe: IzvozZaliha[];          // agregirano u SQL-u po artiklu
  fiskalnePraznine: number[];
}
```

Tačan oblik tipova definiše se u `src/types.ts` u fazi plana. `od > do` ili neispravan datum → greška `Neispravan period`. Nema zapisa → prazne liste (ne greška).

- **TS:** upiti u `src/lib/izvozKnjigovodja.ts` (`dohvatiKnjigovodja(db, od, do)`), registracija u `src/ipc/handlers.ts`; `src/ipc/api.ts` + `src/global.d.ts` (`window.api.izvozKnjigovodja`).
- **Rust:** novi modul `src-tauri/backend/src/izvoz.rs` s istim upitima, krak `"izvoz"` u `kanali.rs`.
- **Licenca:** kanal je samo za čitanje, ne ide u `kanali` u `moduliKatalog.json`; aktivnost modula se čita iz licence u backendu i vraća u `moduli`.
- Fiskalne praznine: postojeći `izracunajPraznine` (TS) / njegov Rust parnjak, nad brojevima iz perioda.

### 3.2 Renderer — `src/lib/knjigovodja/`

| Fajl | Odgovornost |
|---|---|
| `obracun.ts` | `KnjigovodjaPodaci → KnjigovodjaIzvjestaj`: KIF redovi, reklamacije, rekapitulacija po danu, zbirovi, KUF, utrošak, zalihe, upozorenja. Čist TS, bez Reacta. Jedini izvor brojeva za Excel, PDF i pregled na ekranu. |
| `excel.ts` | `KnjigovodjaIzvjestaj → Uint8Array` (.xlsx) preko **exceljs**. |
| `KnjigovodjaPdf.tsx` | react-pdf dokument; `pdf(...).toBlob()` → bajtovi. |
| `zip.ts` | `{ime, bajtovi}[] → Uint8Array` preko **fflate** (`zipSync`). |
| `imeFajla.ts` | ime fajla iz firme i perioda. |

Snimanje: `window.api.showSaveDialog({ defaultName, filters: [{ name: 'ZIP', extensions: ['zip'] }] })` → `window.api.writeFile(path, bajtovi)` (postojeći kanali, oba backenda).

Nove zavisnosti: `exceljs`, `fflate` — samo renderer.

### 3.3 UI

- `IzvjestajiScreen` dobija `uloga` iz `MainLayout`; novi tab **„Knjigovođa“** prikazuje se samo za `uloga === 'admin'`.
- Tab ima svoj izbor perioda (ne dijeli postojeći od–do s ostalim tabovima, jer je podrazumijevano prošli mjesec).
- Nova komponenta `src/components/ui/period-picker.tsx`: prekidač **Mjesec / Period**.
  - Mjesec: strelice za godinu + mreža 12 mjeseci (bosanski nazivi); budući mjeseci onemogućeni. Podrazumijevano: prošli mjesec.
  - Period: dva `DatePicker`-a od–do; `do` ne može biti prije `od`.
  - `value/onChange` kao `{ od: 'YYYY-MM-DD', do: 'YYYY-MM-DD', mjesec?: 'YYYY-MM' }`.
- Nova komponenta `src/components/izvjestaji/KnjigovodjaTab.tsx`: na promjenu perioda poziva kanal, računa `obracun` i prikazuje pregled (broj računa, promet, PDV, reklamacije, ulaz, polog/povrat, utrošak, zalihe) + upozorenja iz Kontrole; dugme **„Izvezi za knjigovođu (.zip)“** sa stanjem učitavanja; poruka o uspjehu (putanja) ili grešci; otkazan dijalog → ništa.
- Vizuelni dizajn taba i picker-a radi se kroz `/frontend-design` u implementaciji, u skladu s postojećim izgledom Izvještaja.

## 4. Greške

- Kanal pada → poruka u tabu, dugme za izvoz onemogućeno.
- Generisanje Excel/PDF/ZIP pada → poruka „Izvoz nije uspio: …“, ništa se ne snima.
- `writeFile` pada → poruka s razlogom.
- Prazan period → pregled pokazuje nule, izvoz je dozvoljen (knjigovođa i to treba znati).

## 5. Testovi

- **Ugovorni** `src/ipc/ugovor/izvoz.ugovor.test.ts` (TS i Rust, `bun test` / `bun run test:rust`): pripremljena baza s računom obje stope, računom s rabatom, podijeljenim plaćanjem, računom po prilogu, reklamacijom računa iz prethodnog perioda, računom prodanim i reklamiranim u periodu, primkom na granici perioda, nivelacijom, pologom i povratom, završenim nalogom (i nezavršenim — ne ulazi), kretanjima zaliha prije/poslije `do`, rupom u fiskalnoj numeraciji i odbačenom rupom; `od > do` → greška; moduli isključeni → prazne liste. Kanal se dodaje u `stvarnaBaza.poredjenje.test.ts`.
- **Unit** (`bun test`): `obracun.ts` (zaokruživanje po stavci, raspodjela plaćanja, prilog bez stavki, odstupanje od `ukupno`, reklamacije, zbirovi = zbir redova), `excel.ts` (fajl se ponovo učita kroz exceljs, listovi prema modulima, zbirni redovi), `zip.ts` (fflate `unzipSync` vraća oba fajla), `imeFajla.ts`, period-picker logika (granice mjeseca, prestupna godina).
- **Ručno**: screenshot taba kroz statički build + Playwright; otvaranje generisanog `.xlsx` i `.pdf`.
