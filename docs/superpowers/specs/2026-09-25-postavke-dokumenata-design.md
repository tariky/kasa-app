# Postavke dokumenata — dizajn

**Datum:** 2026-09-25

## Cilj

Vlasnik danas ne može uticati ni na šta što se ispisuje na fakturi, ponudi, otpremnici, računu i radnom nalogu osim podataka firme, loga i položaja žiro računa. Rokovi, načini plaćanja, tekstovi uslova, potpisne linije i kolone su zakucani u kodu. Dodajemo grupu **Dokumenti** u Postavkama i tri zadane vrijednosti po kupcu.

**Uspjeh:** bez izmjene koda vlasnik može: postaviti zadani rok i način plaćanja fakture (globalno i po kupcu), rabat kupca koji se sam primjenjuje, važnost i uslove ponude, format broja ponude i prefiks naloga, tekst podnožja, nazive potpisnih linija, pečat s potpisom, i koje kolone se štampaju. Kad ništa ne dira, svaki dokument izgleda kao danas (osim popravljenog rabata s decimalama i kolone Rabat koja se krije kad je prazna).

Ovo je podprojekt 1 od 3. Podprojekt 2 (Kasa: zadani način plaćanja, auto-otvaranje fakture/otpremnice, jezik računa, apoeni) i 3 (Štampa: direktna štampa, kopije, A5) imaju svoje specove.

## Obim

**Uključeno:** grupa „Dokumenti“ u Postavkama; tri opcionalna polja kupca (rok plaćanja, način plaćanja, rabat) u oba backenda; primjena u FakturaDialog, PonudeScreen, KasaScreen i pet PDF dokumenata; popravak štampe rabata s decimalama; stopa PDV-a u jednu konstantu.

**Isključeno (YAGNI / namjerno):**
- Linija „Izrađeno programom Atlas“ ostaje (brend).
- Stopa PDV-a nije postavka (zakonski 17 %); samo se `1.17`/`17` sa ~6 mjesta skuplja u konstantu.
- Broj fakture ostaje jednak BF broju (prilog to traži); otpremnica i dalje nema svoj broj.
- Godišnji reset numeracije ponuda i naloga se ne mijenja; mijenja se samo prikazni oblik.
- Prekidači kolona po dokumentu (isti prekidači važe za sve dokumente).
- Barkodovi s vage.

## 1. Postavke (ključevi u tabeli `settings`)

Sve preko postojećih `settings:get/set` (oba backenda ih već imaju) — bez nove IPC komande. Vrijednosti su stringovi. Ključ koji nikad nije spremljen (NULL) → zadana vrijednost; nevažeći broj/izbor → zadana vrijednost; spremljen tekst se koristi takav kakav je (trim + limit), pa i prazan (npr. prazan prefiks naloga). Izuzetak: prazan naziv potpisne linije → zadani naziv.

| Ključ | Tip | Zadano | Napomena |
|---|---|---|---|
| `dokumenti.faktura.rokDana` | cijeli broj 0–365 ili prazno | prazno (bez roka) | |
| `dokumenti.faktura.nacinPlacanja` | `Gotovina`/`Kartica`/`Virman`/`Ček` | `Virman` | |
| `dokumenti.faktura.napomena` | tekst ≤ `FAKTURA_NAPOMENA_MAX` (500) | prazno | |
| `dokumenti.ponuda.vaziDana` | cijeli broj 1–365 | 8 | zamjenjuje `DEFAULT_ROK_DANA` u UI |
| `dokumenti.ponuda.uslovi` | tekst ≤ 500 | `Cijene su izražene u KM sa uračunatim PDV-om.` | „Ponuda važi do {datum}.“ ide ispred, automatski |
| `dokumenti.ponuda.nacinPlacanja` | kao gore | `Gotovina` | način plaćanja pri konverziji ponude u račun |
| `dokumenti.ponuda.prefiks` | tekst ≤ 8 | prazno | |
| `dokumenti.ponuda.cifara` | 0–6 | 0 (bez nula) | `P-` + 3 → `P-003/2026` |
| `dokumenti.nalog.prefiks` | tekst ≤ 8 | `RN-` | prazno dozvoljeno → `3/2026` |
| `dokumenti.podnozje` | tekst ≤ 300 | prazno | iznad linije „Generisano…“ na svim PDF-ovima |
| `dokumenti.potpis.<dok>.lijevo` / `.desno` | tekst ≤ 30 | vidi dolje | `<dok>` ∈ `faktura`, `ponuda`, `otpremnica`, `racun`, `nalog` |
| `dokumenti.pecat` | data URL (PNG/JPG) | prazno | isto kao `firma.logo` |
| `dokumenti.pecatVelicina` | pt 40–200 | 90 | |
| `dokumenti.pecat.<dok>` | `true`/`false` | `false` | `<dok>` ∈ `faktura`, `ponuda`, `otpremnica`, `racun` |
| `dokumenti.kolone.sifra` | `true`/`false` | `false` | |
| `dokumenti.kolone.jm` | `true`/`false` | `true` | |

Zadane potpisne linije (današnje): faktura „Izdao“/„Primio“, ponuda i račun „Potpis izdavaoca“/„Potpis primaoca“, otpremnica „Robu izdao“/„Robu primio“, nalog „Izradio“/„Preuzeo“. Prazno polje → zadani naziv (linija se ne može ukloniti).

## 2. Kupac

Tabela `kupci` dobija tri NULL kolone: `rokPlacanjaDana INTEGER`, `nacinPlacanja TEXT`, `rabat REAL`. NULL = „koristi globalno“.

- Migracija u `src/database/schema.ts` + `migrations.ts` (provjera `PRAGMA table_info`, kao ostale kolone) i u `src-tauri/backend/src/baza.rs`.
- `kupac:create` / `kupac:update` (`handlers.ts`, `katalog.rs`) primaju i validiraju: `rokPlacanjaDana` cijeli 0–365, `rabat` 0–100 (do 2 decimale), `nacinPlacanja` iz liste; prazno → NULL. Greške istim porukama u oba backenda.
- `Kupac` tip dobija `rokPlacanjaDana?: number | null`, `nacinPlacanja?: string | null`, `rabat?: number | null`.
- Šifarnik › Kupci: tri polja u dijalogu kupca pod naslovom „Zadano za dokumente“; u listi ništa novo.

**Pravilo primjene rabata kupca:** spremljeni dokumenti se nikad ne preračunavaju (ni kad se kupcu kasnije promijeni rabat). Na dokumentu koji je još otvoren, izbor kupca s rabatom postavlja taj rabat svim stavkama koje imaju 0 %, i svakoj stavci dodanoj poslije; ručno upisan rabat se ne dira. Promjena kupca na drugog ne vraća rabat na 0. Kratka obavijest „Primijenjen rabat kupca 5 %“.

## 3. Jezgro u rendereru

**`src/lib/dokumentPostavke.ts`** (čisti TS, unit testovi):
- `interface DokumentPostavke`, `ZADANE_DOKUMENT_POSTAVKE`, `KLJUCEVI_DOKUMENATA`.
- `procitajDokumentPostavke(raw: Record<string, string | null>): DokumentPostavke` — parsira i čisti (van opsega → zadano, tekst skraćen na limit).
- `formatBroja({ broj, godina }, { prefiks, cifara })`.
- `zadanoZaKupca(kupac | null, postavke, dokument: 'faktura' | 'ponuda')` → `{ rokDana, nacinPlacanja, rabat }` po redu kupac → globalno → zadano.
- `primijeniRabatKupca(stavke, rabat)` → nove stavke (samo one s rabatom 0).

**`formatBrojPonude` / `formatBrojNaloga`** dobijaju opcionalni drugi argument (format); bez njega daju današnji oblik, pa postojeći testovi i backend ostaju isti.

**`DokumentPostavkeProvider`** (React context u `MainLayout`): učita sve ključeve jednim `Promise.all` na startu; `useDokumentPostavke()` vraća postavke (zadane dok se ne učitaju) i `osvjezi()`. Grupa Dokumenti zove `osvjezi()` nakon spremanja. Ekrani koji prikazuju broj ponude/naloga (~15 mjesta u PonudeScreen, ProizvodnjaScreen, proizvodnja dijalozima) prosljeđuju format iz hooka.

**`ucitajZaStampu()`** (`src/lib/stampa.ts`): vraća `{ firma, postavke }` svježe iz baze (ne iz contexta — PDF se pravi van React stabla i mora vidjeti zadnje spremljeno). Zamjenjuje lokalne `loadFirma()` u PonudeScreen, NalogDetailDialog, RacunDetailDialog, `stampaFakture.tsx` i KasaScreen (otpremnica).

## 4. Dokumenti (PDF)

`PrilogPdf` (faktura), `PonudaPdf`, `OtpremnicaPdf`, `RacunPdf`, `RadniNalogPdf` dobijaju prop `postavke: DokumentPostavke`.

- **`PotpisBlok`** (novi zajednički dio, `src/components/pdf/PotpisBlok.tsx`): dvije linije s nazivima iz postavki; pečat (ako postoji slika i uključen je za taj dokument) iznad lijeve linije, visine `pecatVelicina` pt, bez pomjeranja teksta ispod. Nalog nema pečat.
- **Podnožje:** tekst `podnozje` (ako nije prazan) kao prvi red footera, iznad „{firma} · Generisano…“ i linije Atlas.
- **Kolone:** šifra (`productSifra`, već dolazi iz upita stavki — tip `OrderItem` i ostali dobijaju polje; slobodne stavke prazno) i JM po prekidačima; kolona Rabat se prikazuje samo ako neka stavka ima rabat > 0. Širine preostalih kolona se preraspodijele na Opis.
- **Rabat** se štampa s do 2 decimale bez nula na kraju (`5`, `2,5`, `12,75`) — danas `toFixed(0)` gubi decimale.
- **Ponuda:** „Ponuda važi do {datum}. {uslovi}“; broj u formatu iz postavki.
- **Nalog:** broj s prefiksom iz postavki.
- Stopa PDV-a: `PDV_STOPA_E = 17` i `FAKTOR_E` iz jednog mjesta (`src/lib/pdv.ts` ili postojeći `pdvUnos.ts`), labela „PDV (17%)“ iz nje.

## 5. Ekrani

- **FakturaDialog:** pri otvaranju nove fakture (ne skice) i pri izboru firme/kupca: `zadanoZaKupca` daje rok (8/15/30/60 → taj chip, drugi broj → „datum“ s izračunatim danom, prazno → bez roka), način plaćanja i rabat. Napomena: `dokumenti.faktura.napomena`, osim kad faktura nastaje iz ponude („Po ponudi br. X“ ostaje). Skica zadržava svoje spremljene vrijednosti.
- **PonudeScreen:** nova ponuda važi `vaziDana`; konverzija u račun kreće s `dokumenti.ponuda.nacinPlacanja`; izbor kupca primjenjuje rabat kupca; nove stavke dobijaju rabat kupca.
- **KasaScreen:** izbor kupca iz šifarnika postavlja njegov način plaćanja (ako ga ima) i primjenjuje rabat na košaricu. Ručno upisan kupac (nije u šifarniku) nema zadane vrijednosti.
- **Postavke › Dokumenti:** nova grupa između „Fiskalni uređaj“ i „Korisnici“, ikona `FileText`, podnaslov „Fakture, ponude, štampa“. Sekcije: Faktura · Ponuda · Radni nalog · Izgled dokumenata (kolone, podnožje) · Potpis i pečat (upload kao logo u FirmaGrupi — izdvojiti zajedničku komponentu za sliku; prekidači po dokumentu; nazivi linija). Spremanje kao u FirmaGrupi: cijela grupa je jedna forma sa sticky trakom „Spremi postavke dokumenata“ / „Odbaci“; nespremljene izmjene se javljaju u listi grupa kao kod Firme.

## 6. Backend poruka

`deletePonuda` (`ponuda.ts:144`, `ponude.rs:162`): „Ponuda je vezana za radni nalog RN-3/2026 — prvo obrišite nalog“ → „Ponuda je vezana za radni nalog br. 3/2026 — prvo obrišite nalog“ (backend ne zna prefiks iz postavki). Ugovorni test ažurirati.

## 7. Testiranje

- **Unit (`bun test`):** `dokumentPostavke.test.ts` — parsiranje svih ključeva, nevažeće → zadano, limiti teksta; `formatBroja` (prefiks, nule, prazan prefiks); `zadanoZaKupca` (kupac gazi globalno, NULL pada na globalno, bez kupca); `primijeniRabatKupca` (dira samo 0 %). Format rabata za štampu.
- **Ugovorni (`bun test src/ipc/ugovor` i `bun run test:rust`):** kupac create/update/getAll s novim poljima, validacija (rabat 101, dani −1, nepoznat način → greška), prazno → NULL; migracija baze bez novih kolona; nova poruka `deletePonuda`.
- **PDF render test:** svaki od 5 dokumenata se renderuje (`pdf(...).toBuffer()`) sa zadanim postavkama i sa „sve uključeno“ (pečat, podnožje, šifra, bez JM, rabat s decimalama) bez greške.
- **Vizuelno:** preview screenshot grupe Dokumenti i jedne fakture/ponude (postupak iz memorije: statički Vite build + headless chromium); korisnik provjerava štampu u Electronu.
- Lint: bez novih kategorija grešaka u dodirnutim fajlovima.

## 8. Zavisnost

Grupa Postavki (`src/components/postavke/`) i dio izmjena u `types.ts`, `handlers.ts`, `firma.ts`, `PrilogPdf.tsx`, `PonudeScreen.tsx` su necommitan rad paralelne sesije. Implementacija kreće na novoj grani tek kad je taj rad commitan na `main`.
