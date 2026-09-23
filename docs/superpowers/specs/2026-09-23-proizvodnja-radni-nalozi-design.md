# Proizvodnja: materijal, normativi i radni nalozi — dizajn

**Datum:** 2026-09-23
**Status:** odobren dizajn u razgovoru, čeka pregled speca

## Problem

Jedna firma korisnik app-a izrađuje pločasti namještaj (kuhinje, plakari,
komode). Nabavlja materijal (iverica, MDF, lesonit, kant traka, baglame,
klizači, ručke, konfirmati, ljepilo, radne ploče) i od njega izrađuje finalni
proizvod. Proizvod je najčešće **po narudžbi** za poznatog kupca (jedinstven
komad, nema zalihe gotovih proizvoda), a ponekad **standardni** komad koji se
radi na zalihu i prodaje na kasi.

Treba voditi: stanje materijala, utrošak materijala po poslu, kalkulaciju
(trošak vs. dogovorena cijena), i vezu s prodajom (ponuda → nalog → račun).

Modul je **opcija**: uključuje se u Postavkama i ostale firme ga ne vide.

## Odluke (dogovoreno s korisnikom)

1. Materijal je **treći tip artikla** (`materijal`) u postojećem šifarniku.
   Ulazi kroz **postojeće primke** i `stock_movements`; ne prodaje se na kasi.
2. Radni nalog ima dvije vrste: **po narudžbi** (kupac, dogovorena cijena, bez
   ulaza gotovog proizvoda) i **za zalihu** (standardni proizvod, N komada,
   knjiži ulaz gotovog proizvoda).
3. Utrošak materijala se **unosi ručno** po nalogu. Za standardne proizvode
   postoji **normativ** kao predložak (normativ × količina, može se korigovati).
4. Nalog po narudžbi nastaje **iz prihvaćene ponude ili samostalno**.
5. Ploče se vode **u m²**, ali unos mora biti jednostavan: artikal ima
   dimenziju ploče, primka se unosi u komadima ploča i preračuna u m², nalog
   ima kalkulator elemenata (širina × visina × kom → m²).
6. Ostali materijal ide u svojoj jm bez preračuna: kant traka `m`, okovi `kom`,
   ljepilo `kg`/`l`, pakovanja `pak`.
7. Nabavna cijena materijala = **prosječna ponderisana** iz primki; zamrzava se
   na stavci naloga u trenutku završetka.
8. Kalkulacija: materijal + ručno upisan trošak rada; za narudžbu marža prema
   dogovorenoj cijeni, za zalihu trošak po komadu.
9. Print radnog naloga A4 **bez cijena** (ide u radionicu).
10. Ostatak ploče (iskoristivi otpad) se **ne prati**.

## Dizajn

### 1. Baza (migracija)

**`products`**
- `tip` CHECK proširen na `('artikal', 'usluga', 'materijal')`.
- `plocaSirina INTEGER NULL`, `plocaVisina INTEGER NULL` — dimenzija ploče u
  mm. Popunjeno samo za ploče (jm `m²`). Artikal sa jm `m²` i dimenzijom je
  "ploča" i dobija preračun kom ↔ m²; bez dimenzije je običan materijal u m².

**`normativi`** — predložak utroška za standardni proizvod:

```sql
CREATE TABLE normativi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL,        -- finalni proizvod (tip 'artikal')
  materijalId INTEGER NOT NULL,      -- products.id, tip 'materijal'
  kolicina REAL NOT NULL,            -- po 1 kom proizvoda, u jm materijala
  napomena TEXT,
  UNIQUE(productId, materijalId),
  FOREIGN KEY (productId) REFERENCES products(id),
  FOREIGN KEY (materijalId) REFERENCES products(id)
);
```

**`radni_nalozi`**

```sql
CREATE TABLE radni_nalozi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broj INTEGER NOT NULL,
  godina INTEGER NOT NULL,
  datum TEXT NOT NULL,
  rok TEXT,                                -- datum isporuke, opciono
  vrsta TEXT NOT NULL CHECK(vrsta IN ('narudzba', 'zaliha')),
  kupacId INTEGER,                         -- narudžba
  ponudaId INTEGER,                        -- narudžba iz ponude
  opis TEXT NOT NULL,                      -- "Kuhinja 3.2 m, bijela mat"
  productId INTEGER,                       -- zaliha: finalni proizvod
  kolicina REAL NOT NULL DEFAULT 1,        -- zaliha: broj komada
  dogovorenaCijena REAL,                   -- narudžba, bruto KM
  trosakRada REAL NOT NULL DEFAULT 0,      -- ručno, KM
  status TEXT NOT NULL DEFAULT 'otvoren'
    CHECK(status IN ('otvoren', 'u_izradi', 'zavrsen', 'fakturisan')),
  racunId INTEGER,                         -- orders.id kad je fakturisan
  korisnikId INTEGER NOT NULL,
  napomena TEXT,
  zavrsenAt TEXT,
  createdAt TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(broj, godina),
  FOREIGN KEY (kupacId) REFERENCES kupci(id),
  FOREIGN KEY (ponudaId) REFERENCES ponude(id),
  FOREIGN KEY (productId) REFERENCES products(id),
  FOREIGN KEY (racunId) REFERENCES orders(id),
  FOREIGN KEY (korisnikId) REFERENCES users(id)
);
```

Numeracija: `RN-{broj}/{godina}`, `broj = MAX(broj) + 1` unutar godine (isti
obrazac kao ponude).

**`radni_nalog_stavke`** — utrošak materijala:

```sql
CREATE TABLE radni_nalog_stavke (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  radniNalogId INTEGER NOT NULL,
  materijalId INTEGER NOT NULL,
  kolicina REAL NOT NULL,                  -- u jm materijala
  nabavnaCijena REAL,                      -- zamrznuta pri završetku, NULL dok je otvoren
  napomena TEXT,                           -- npr. "korpus 600×720 ×2, 800×720 ×1"
  FOREIGN KEY (radniNalogId) REFERENCES radni_nalozi(id),
  FOREIGN KEY (materijalId) REFERENCES products(id)
);
```

**`stock_movements`** — bez izmjene sheme. Novi `referenceType = 'radni_nalog'`,
`referenceId = radni_nalozi.id`: `izlaz` po stavci utroška, `ulaz` gotovog
proizvoda samo za vrstu `zaliha`.

**`settings`** — `proizvodnja.enabled` = `'true'` uključuje modul.

Indeksi: `radni_nalog_stavke(radniNalogId)`, `radni_nalozi(status)`,
`normativi(productId)`.

### 2. Domenska logika — `src/lib/proizvodnja.ts`

Čiste funkcije nad `SqlDb`, bez UI ovisnosti, po uzoru na `ponuda.ts`:

- `nextBrojNaloga(db, godina)`
- `createNalog(db, input)` — validacija: narudžba traži `kupacId` (ili
  `ponudaId` iz koje se izvuče kupac) i `opis`; zaliha traži `productId` tipa
  `artikal` i `kolicina > 0`. Za zalihu, ako postoji normativ, stavke se
  popune `normativ × kolicina`.
- `createNalogIzPonude(db, ponudaId, korisnikId)` — kupac iz ponude, opis =
  nazivi stavki ponude spojeni zarezom, `dogovorenaCijena = ponuda.ukupno`.
  Odbija ako ponuda nije `prihvacena` ili već ima nalog.
- `updateNalog(db, id, input)` i `replaceStavke(db, id, stavke)` — dozvoljeno
  samo u statusu `otvoren` ili `u_izradi`.
- `setStatus(db, id, status)` — prelazi: `otvoren → u_izradi`,
  `u_izradi → zavrsen` (= `zavrsiNalog`), `zavrsen → u_izradi`
  (= `vratiUIzradu`, samo admin, provjera u handleru), `zavrsen → fakturisan`
  (= `fakturisiNalog`, samo narudžba).
- `zavrsiNalog(db, id)` — jedna transakcija: za svaku stavku upiše
  `nabavnaCijena = getProsjecnaNabavna(db, materijalId)` i `izlaz` u
  `stock_movements`; za zalihu upiše `ulaz` `kolicina` komada `productId`;
  postavi `status = 'zavrsen'`, `zavrsenAt`. Nalog bez stavki se ne može
  završiti. Negativno stanje materijala **ne blokira** (upozorenje u UI-u).
- `vratiUIzradu(db, id)` — obriše sve `stock_movements` sa
  `referenceType = 'radni_nalog'` za taj nalog, postavi `nabavnaCijena = NULL`
  na stavkama, `status = 'u_izradi'`, `zavrsenAt = NULL`. Odbija ako je
  `fakturisan`.
- `fakturisiNalog(db, id, racunId)` — postavi `racunId` i `status`.
- `deleteNalog(db, id)` — samo `otvoren`/`u_izradi`.
- `getProsjecnaNabavna(db, materijalId)` —
  `SUM(kolicina × nabavnaCijena) / SUM(kolicina)` iz `primka_stavke`; `0` ako
  nema primki.
- `kalkulacija(nalog, stavke, cijeneMaterijala)` — čista funkcija:
  - `materijal = Σ kolicina × (stavka.nabavnaCijena ?? trenutnaProsjecna)`
  - `ukupno = materijal + trosakRada`
  - narudžba: `neto = uNetto(dogovorenaCijena, 'E')` (postojeći `pdvUnos`),
    `marza = neto − ukupno`, `marzaPct = marza / neto` (0 ako `neto = 0`)
  - zaliha: `poKomadu = ukupno / kolicina`
  - `upozorenja[]`: materijali s cijenom 0 (nema primke), stavke čiji utrošak
    prelazi stanje.
- `ploca.ts` (ili u istom fajlu): `m2PoPloci(sirina, visina)` =
  `sirina × visina / 1e6`, zaokruženo na 4 decimale;
  `komUM2(kom, sirina, visina)`; `m2UKom(m2, sirina, visina)`;
  `elementiUM2(elementi: {sirina, visina, kom}[])`;
  `elementiUNapomenu(elementi)` → `"600×720 ×2, 800×720 ×1"`.

### 3. Ponašanje postojećih dijelova

- **Šifarnik / dijalog artikla**: tip "Materijal" se nudi samo kad je modul
  uključen. Za materijal s jm `m²` prikazuju se polja "Dimenzija ploče" (širina
  × visina mm, opciono). Materijal nema PLU i ne šalje se na Tring
  (`tring:writeArticle` ga preskače).
- **Skladište / stanje**: za ploče stanje "28.98 m² (≈ 5.0 ploča)".
- **Primka**: kad je stavka ploča, količina se unosi u **komadima ploča**, uz
  živi prikaz "5 kom × 5.796 m² = 28.98 m²"; u `primka_stavke.kolicina` ide
  m², a `nabavnaCijena` se preračuna na cijenu po m² (cijena ploče / m² po
  ploči). Ostali materijal kao i sad. Materijal ne pokreće nivelaciju
  (nema prodajnu cijenu; `collectPriceChanges` ga preskače).
- **Kasa**: materijal se ne prikazuje u listi i ne može se dodati u korpu
  (`product:search` i lista filtriraju `tip != 'materijal'`).
- **Ponude**: na ponudi u statusu `prihvacena` dugme **"Radni nalog"**; ako
  nalog već postoji, dugme vodi na njega (prebaci na ekran Proizvodnja s
  otvorenim nalogom).
- **Brisanje materijala** iz šifarnika blokirano ako figuriše na normativu ili
  stavci naloga (isti obrazac kao `isDobavljacUsed`).

### 4. IPC (`handlers.ts`)

`nalog:getAll (filter status?)`, `nalog:get`, `nalog:nextBroj`,
`nalog:create`, `nalog:createIzPonude`, `nalog:update`,
`nalog:replaceStavke`, `nalog:setStatus`, `nalog:delete`,
`nalog:kalkulacija`, `nalog:fakturisi`,
`normativ:get (productId)`, `normativ:save (productId, stavke)`,
`materijal:prosjecnaNabavna (materijalId)`.

Handleri su tanki: validacija korisnika/uloge, transakcija, poziv u
`proizvodnja.ts`.

### 5. UI

**Postavke**: prekidač "Proizvodnja (radni nalozi i materijal)", ključ
`proizvodnja.enabled`. Kad je isključen: stavka menija nestaje (isti obrazac
kao Generator), tip "Materijal" se ne nudi u šifarniku, dugme "Radni nalog"
na ponudi se ne prikazuje. Postojeći podaci ostaju netaknuti.

**Ekran `ProizvodnjaScreen.tsx`** (meni: "Proizvodnja", iza Skladišta), dvije
kartice:

- **Radni nalozi**: tabela (broj, datum, rok, vrsta, kupac ili proizvod ×
  količina, status badge, trošak, dogovorena cijena). Filter po statusu
  (podrazumijevano: sve osim fakturisanih). "Novi nalog" → dijalog: vrsta,
  kupac (pretraga) ili proizvod (pretraga, samo `artikal`) + količina, opis,
  datum, rok, dogovorena cijena. Klik na red → **detalj naloga**:
  - zaglavlje (uređivo dok nije završen),
  - **stavke utroška**: pretraga materijala (kao na primci), količina u jm
    materijala, napomena; za ploče dugme "Elementi" → kalkulator (redovi
    širina × visina × kom, zbir m² ide u količinu, redovi u napomenu). Ispod
    stavke stanje materijala, crveno ako utrošak prelazi stanje.
  - **kalkulacija**: materijal, rad (uređivo polje), ukupno; za narudžbu neto
    dogovorene cijene, marža KM i %, crveno ako negativna; za zalihu trošak po
    komadu uz prodajnu cijenu iz šifarnika. Upozorenja iz `kalkulacija()`.
  - akcije po statusu: "U izradu", "Završi" (dijalog potvrde s pregledom
    knjiženja), "Vrati u izradu" (admin), "Izdaj račun" (završena narudžba),
    "Print", "Obriši" (nezavršen).
- **Normativi**: pretraga standardnog proizvoda → tabela materijal + količina
  po komadu + napomena, spremanje zamjenjuje cijeli set.

**"Izdaj račun"** na završenoj narudžbi: otvara postojeći tok naplate s jednom
stavkom (naziv = opis naloga, količina 1, cijena = dogovorena cijena, PDV `E`)
kroz **račun po prilogu** ili običan račun, ovisno o tome što je već
implementirano za jednu zbirnu stavku; nakon fiskalizacije `fakturisiNalog`.
Ako je nalog iz ponude, koristi se postojeća konverzija ponude u račun i nalog
pokupi `racunId` iz `ponude.racunId`. Detalj toka se precizira u planu prema
postojećem `PrilogRacunDialog`/`konvertujPonudu`.

### 6. Print — `RadniNalogPdf.tsx` (A4)

U stilu postojećih PDF-ova (`PonudaPdf`, `UlazPdf`): zaglavlje firme, naslov
"Radni nalog RN-{broj}/{godina}", datum, rok, kupac ili proizvod × količina,
opis, tabela utroška (r.br., materijal, jm, količina, napomena), napomena
naloga, potpisi "Izradio / Preuzeo". **Bez cijena.** Podnožje `POTPIS_AUTORA`.

### 7. Testovi

Unit (`proizvodnja.test.ts`, `ploca.test.ts`):
- preračuni ploča: m² po ploči, kom ↔ m², elementi → m² i napomena,
- prosječna nabavna (jedna primka, više primki različitih cijena, bez primki),
- kalkulacija: narudžba s maržom + i −, zaliha po komadu, upozorenja,
- prelazi statusa: dozvoljeni i zabranjeni.

Integracija (`proizvodnja.integration.test.ts`, in-memory SQLite kao
`prilog.integration.test.ts`):
- nalog iz ponude nasljeđuje kupca, opis i cijenu; druga konverzija odbijena,
- zaliha s normativom popuni stavke normativ × količina,
- završetak knjiži izlaz materijala (i ulaz proizvoda za zalihu), zamrzava
  cijene; kasnija primka ne mijenja kalkulaciju završenog naloga,
- vraćanje u izradu briše knjiženja i otključava,
- brisanje završenog naloga odbijeno,
- primka ploče u komadima upisuje m² i cijenu po m².

## Van opsega (YAGNI)

- Praćenje ostataka ploča i optimizacija krojenja.
- Satnice i evidencija radnika po nalogu (rad je jedan iznos).
- Zaliha poluproizvoda i višefazna proizvodnja.
- Više skladišta.
- Avans po narudžbi (može kasnije kao zaseban modul).
