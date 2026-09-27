# Popravke toka zaliha — plan

Izvor: puni review toka zaliha (2026-09-26), tri paralelna reviewa (prodaja/storno/prilog,
skladište/primke/nivelacije, proizvodnja/nalozi). Nema zasebnog speca — nalazi reviewa i
odluke ispod su specifikacija. Zaliha artikla = SUM(ulaz) − SUM(izlaz) iz `stock_movements`.

## Global Constraints

- Dva backenda moraju ostati identična: TS (`src/`, better-sqlite3) i Rust
  (`src-tauri/backend/src`, crate `pazar-backend`). Svaka promjena ponašanja ide u oba.
  Ugovorni testovi `src/ipc/ugovor/*.ugovor.test.ts` se dopunjuju za svako novo pravilo i
  moraju proći nad oba backenda: `bun test` (TS) i `bun run test:rust` (Rust), plus
  `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend`.
- Test-first: za svaki nalaz prvo test koji pada (unit ili ugovorni), pa popravka.
- Sve što može pasti na bazi provjerava se PRIJE štampe na Tring uređaju.
- UI potvrde/obavijesti isključivo kroz `potvrdi`/`obavijesti` iz `src/lib/dijalog.ts`
  (WKWebView u Tauri-ju ne prikazuje `window.confirm/alert`).
- Migracije su idempotentne i postoje u oba backenda (`src/database/migrations.ts` i Rust
  ekvivalent); stare baze i uvezeni backup-i moraju raditi.
- Odluke vlasnika koje ostaju: nivelacija i ulaz primke nose današnji datum za nivelaciju /
  datum primke za ulaz (postojeće ponašanje); odbijena ponuda se ne konvertuje; negativno
  stanje NE blokira prodaju ni završetak naloga (ploča se troši prije unosa primke).
- `bun test` radi u UTC-u; datumi u bazi su lokalno vrijeme `YYYY-MM-DD HH:MM:SS`.
- Lint: `bun run lint` pada i na main-u (@/ resolver) — pravilo je "bez novih grešaka u
  dodirnutim fajlovima" (`bunx eslint <fajlovi>` prije/poslije).
- Tekst u UI-ju, komentari i poruke grešaka na bosanskom, stil kao okolni kod.
- Commit poruke u stilu repoa (`fix(skladiste): …`), završavaju sa
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Ne dirati `backupKljuc.ts`. Ne push-ati.

## Task 1: Proizvodnja — nalozi i zaliha

Fajlovi: `src/lib/proizvodnja.ts`, `src-tauri/backend/src/proizvodnja.rs`, eventualno
`src/lib/ponuda.ts` / `ponude.rs`, `src/components/proizvodnja/*`, testovi
`src/lib/proizvodnja.test.ts`, `src/ipc/ugovor/proizvodnja.ugovor.test.ts`.

1. **Nalog iz ponude dvaput skida robu (visok).** Nalog po narudžbi iz ponude pri završetku
   skida materijal, a pri izdavanju računa (`izdajRacunZaNalog` → `konvertujPonudu` →
   `upisiRacun`, `racun.ts:88-91`) se skida i svaka ne-usluga stavka ponude — a gotov proizvod
   nikad nije ušao na zalihu → stanje proizvoda −kolicina.
   **Odluka (vlasnik, 2026-09-26): sve što se prodaje mora biti skinuto** — i izrađeni
   proizvod i kupljena roba sa zalihe (npr. sudopera) na istoj ponudi. Zato nalog eksplicitno
   zna koje stavke ponude IZRAĐUJE:
   - Nova tabela `radni_nalog_proizvodi (id, radniNalogId FK, productId FK, kolicina REAL
     NOT NULL)` — schema.ts + idempotentna migracija u oba backenda.
   - Pri kreiranju naloga iz ponude korisnik u dijalogu bira (checkbox po stavci) koje
     stavke ponude (samo artikli koji nisu `usluga` ni `materijal`) nalog izrađuje; zadano
     označeno je stavka čiji artikal trenutno nema dovoljno zalihe (stanje < količina
     stavke), neoznačeno ako je roba na zalihi. Izbor se može mijenjati dok je nalog
     `otvoren`/`u_izradi` (detalj/izmjena naloga), zaključan nakon završetka.
     Backend validira: artikal je na ponudi naloga, nije usluga/materijal, količina > 0 i
     ne veća od količine na ponudi.
   - `zavrsiNalog` upisuje `ulaz 'radni_nalog'` samo za izabrane proizvode (količina iz
     `radni_nalog_proizvodi`). Prodaja (račun iz ponude) i dalje skida SVE ne-usluga stavke
     → izrađeni proizvod: ulaz pa izlaz = 0; kupljena roba: samo izlaz (skinuta sa zalihe).
     Ishod je isti bez obzira da li se ponuda fakturiše prije ili poslije završetka naloga.
   - Samostalni nalog po narudžbi (bez ponude) ide kroz uslugu i ne mijenja se. Stari
     nalozi iz ponude bez redova u novoj tabeli ponašaju se kao do sada (bez ulaza).
   `vratiUIzradu` briše i te ulaze (već briše sve `radni_nalog` kretanja naloga).
   Postojeći ugovorni test koji maskira problem početnim stanjem (`proizvodnja.ugovor.test.ts`
   ~755) prepraviti da provjerava stvarni ishod (stanje proizvoda 0 nakon završetka+računa).
2. **„Vrati u izradu" nakon prodaje (visok).** `vratiUIzradu` briše ulaz gotovog proizvoda i
   kad je roba prodana → stanje negativno, a nalog se onda može i obrisati.
   **Odluka:** prije brisanja kretanja, za svaki artikal koji je nalog uveo `ulaz`-om
   provjeriti da je trenutno stanje ≥ ulazna količina (tolerancija 1e-9); inače greška
   „Proizvod … je već prodan/izdat — nalog se ne može vratiti u izradu" (navesti artikal i
   stanje). Provjera u istoj transakciji, oba backenda.
3. **Nalog čija je ponuda već fakturisana na ekranu Ponude (nizak).** Takav nalog se može
   vratiti u izradu i obrisati → nestane utrošak materijala za fakturisan posao.
   **Odluka:** `vratiUIzradu` i `deleteNalog` odbijaju nalog čija je ponuda
   `status='konvertovana'` (poruka da je ponuda već fakturisana).
4. **Promjena količine naloga ne preračunava utrošak (nizak, po dizajnu).** Backend ostaje
   kakav je (ugovorni test „stavke se ne preračunavaju"). U `NalogDialog.tsx` pri izmjeni
   količine nalog na zalihu s artiklom koji ima normativ: prikazati upozorenje da stavke
   utroška nisu preračunate i ponuditi dugme „Preračunaj po normativu" koje popuni stavke
   iz normativa × nova količina (isto kao pri kreiranju).
5. **Upozorenje „prelazi stanje" ne sabira ponovljeni materijal (nizak).** Kalkulacija
   (`proizvodnja.ts` ~383, Rust ~508) i prikaz u `StavkeUtroska.tsx` porede svaku stavku
   posebno sa stanjem. **Odluka:** porediti zbir količina istog materijala na nalogu sa
   stanjem; u UI-ju ključ reda ne smije biti samo `materijalId` (duplikati kolidiraju).

## Task 2: Skladište — primke, nivelacije, korekcije

Fajlovi: `src/ipc/handlers.ts` (primka:create/update/delete, pregled, adjustStock),
`src/lib/skladiste.ts`, `src/lib/ploca.ts`, `src/components/skladiste/UlazDialog.tsx`,
`PregledCijenaUlaza.tsx`, `src/lib/knjigovodja/*`, Rust `skladiste.rs`, `katalog.rs`,
`izvoz.rs`, `baza.rs` (migracije), testovi `src/lib/skladiste.test.ts`,
`src/ipc/ugovor/skladiste.ugovor.test.ts`, `src/lib/knjigovodja/*.test.ts`.

1. **Izmjena/brisanje primke čija je roba već prodana (srednje-visok).** Nivelacija se
   računa na „zalihu bez ove primke" (`skladiste.ts:265-275`, `collectPriceChanges`
   `:52-61`); kad je roba primke djelimično prodana to je ≤ 0, pa pregled kaže „nema zalihe",
   `dokumenti` je prazan i `UlazDialog.spremi` sprema bez ikakve potvrde. Brisanje primke od
   10 kad je 8 prodano daje −8 bez upozorenja (`pregledBrisanja` prazan).
   **Odluka (ne blokirati — negativno stanje je dozvoljeno po odluci vlasnika — nego
   obavezno upozoriti i tražiti potvrdu):** pregled izmjene i pregled brisanja primke
   dobijaju listu upozorenja: (a) artikli čije bi stanje nakon operacije bilo negativno
   (ili negativnije nego prije) — naziv, sadašnje stanje, stanje poslije; (b) artikli čija
   se prodajna cijena mijenja a roba iz ove primke je već (djelimično) prodana (stanje bez
   primke < 0 prije promjene) — „roba je prodavana po staroj cijeni". UI (`UlazDialog`,
   brisanje u `SkladisteScreen`) prikazuje upozorenja i traži potvrdu kroz `potvrdi` kad god
   lista nije prazna, i kad je `dokumenti` prazan. Upozorenja ulaze u postojeći mehanizam
   „spremi samo ako odgovara potvrđenom pregledu" (commit db599575, fingerprint), tako da
   backend odbije spremanje ako se stanje promijenilo od potvrđenog pregleda.
2. **Brisanje/izmjena primke mijenja izvoz za već zatvoren period (srednji).**
   `ponistiPromjeneCijenaPrimke` (`skladiste.ts:193-213`) briše redove `cijena_historija`, a
   vraćanje cijene ne upisuje novi red → „Zalihe na dan" u izvozu za raniji period pokazuje
   drugu cijenu nego prije i ne slaže se s nivelacijom koja je i dalje u izvozu.
   **Odluka:** historija cijena je samo-dodavanje za potrebe izvoza: poništenje primke ne
   smije promijeniti cijenu na dan prije današnjeg. Implementer bira mehanizam (npr. red
   historije se označi poništenim umjesto brisanja + vraćanje cijene upiše novi red s
   današnjim datumom; lanac „staraCijena" za buduća poništenja mora i dalje raditi kao
   sada). Ako treba nova kolona/izvor, dodati idempotentnu migraciju u oba backenda (CHECK na
   `izvor` se ne može mijenjati bez rebuild-a tabele — radije kolona). Test: izvoz za januar
   prije i poslije brisanja primke u martu daje istu cijenu na 31.01.
3. **Spremanje primke s pločom tiho mijenja količinu (nizak-srednji).** `m2UKom`
   (`ploca.ts:31-35`) zaokružuje na 2 decimale; `UlazDialog` (`izBazePrimke` → `uPayload` →
   `uBazuPrimke`) pri svakom spremanju pretvori m² → kom → m² (10 m² → 10,0271 m²).
   **Odluka:** spremljena količina u m² se ne mijenja ako je korisnik nije mijenjao
   (npr. čuvati izvornu m² vrijednost stavke i koristiti je dok se polje ne dira; kom je samo
   prikaz). Unos u kom s 3 decimale ne smije gubiti preciznost pri ponovnom spremanju.
4. **Ostaci zaokruživanja (nizak-srednji).** `> 0` u `skladiste.ts:60, :272`, `diff === 0` u
   `handlers.ts:501` (adjustStock), Rust `skladiste.rs` `> 0.0`, `katalog.rs:260`
   `diff == 0.0`. 0,1+0,2−0,3 = 2,8e-17 → pravi NIV dokument s tom količinom; korekcija na
   isto stanje upiše `adjustment` od 5,55e-17. **Odluka:** zajednička tolerancija 1e-9 (kao
   izvoz): stanje |x| < 1e-9 je 0 za nivelaciju, pregled i korekciju.
5. **Backend ne provjerava stavke primke (nizak).** `validirajPrimku` (`skladiste.ts:544-563`,
   Rust `:349-369`) provjerava samo postojanje artikla. **Odluka:** odbiti količinu koja nije
   konačan broj > 0, cijene/nabavne < 0 ili nekonačne, i artikal tipa `usluga` ili
   `slobodan = 1` (poruka navodi artikal).
6. **Izvoz — početno stanje bez nabavne:** po specu izvoza, ne mijenja se (Ruling u ledgeru).

## Task 3: Računi — fiskalni ishod, prilog, storno

Fajlovi: `src/ipc/handlers.ts` (order:finalize, prilog finalize, pending:*),
`src/lib/prilog.ts`, `src/lib/refund.ts`, `src/services/tring.ts`, PendingRacuniDialog i
kasa UI po potrebi, Rust `racuni.rs`, `tring.rs`, `racun.rs`, testovi
`src/lib/refund*.test.ts`, `src/lib/prilog*.test.ts`, `src/ipc/ugovor/orders.ugovor.test.ts`.

1. **Timeout fiskalnog uređaja = „nije štampano" (srednje-visok).** Na timeout (30 s) ili
   prekid veze nakon slanja, `tring.ts:166-199` / `tring.rs` vraćaju običan neuspjeh, a
   `handlers.ts:1248-1251`, `prilog.ts:281-290`, Rust `racuni.rs:912-915`, `:387-390` brišu
   `pending_receipts` → ako uređaj ipak odštampa, fiskalni račun nema narudžbe ni izlaza robe.
   **Odluka:** Tring odgovor razlikuje „uređaj je odgovorio greškom / veza odbijena prije
   slanja" (sigurno nije štampano → pending red se briše kao sada) od „ishod nepoznat"
   (timeout, prekid nakon slanja zahtjeva, neparsiran odgovor) → pending red OSTAJE, a
   renderer dobija grešku s oznakom nepoznatog ishoda i odmah otvara postojeći dijalog za
   nezavršene račune (PendingRacuniDialog) umjesto da korisnik ponovo šalje korpu.
2. **Dvostruka narudžba nakon oporavka (nizak).** Ako je pending red riješen iz dijaloga dok
   je štampa još trajala, uspješan završetak upiše drugu narudžbu. **Odluka:** transakcija
   završetka (`handlers.ts:1260-1264`, `prilog.ts:322`, Rust `racuni.rs:925-930`, `:430`)
   provjeri da je DELETE pending reda obrisao tačno jedan red; inače ne upisuje narudžbu i
   vraća jasnu grešku (račun je već evidentiran).
3. **Kretanja priloga nose današnji datum umjesto datuma računa (srednji).**
   `prilog.ts:124-131` (Rust `racuni.rs:235-238`) upisuje `izlaz 'prilog'` bez `createdAt`,
   a svako spremanje stavki briše i ponovo upisuje sva kretanja → „Zalihe na dan" pogrešan.
   **Odluka:** kretanja priloga uvijek nose `createdAt` narudžbe (`orders.createdAt`), i pri
   oporavku i pri ponovnom spremanju.
4. **Storno odlučuje po trenutnom tipu artikla (nizak).** `refund.ts:37-46` (Rust
   `racuni.rs:474-488`) vraća zalihu za stavke koje su SADA ne-usluga. **Odluka:** storno
   vraća tačno ono što je račun skinuo: za svaki `izlaz` s `referenceType IN ('order',
   'prilog')` i `referenceId = orderId` upiše `ulaz 'refund'` iste količine za isti artikal.
   (Ponovno spremanje priloga ostaje po tipu artikla — tu se kretanja prave iznova.)

## Task 4: Write-ahead za ponudu→račun, nalog→račun i storno

Zavisi od Task 1 i 3. Fajlovi: `src/lib/ponuda.ts`, `src/lib/proizvodnja.ts`
(`izdajRacunZaNalog`), `src/lib/refund.ts`, `src/ipc/handlers.ts` (pending:*), PendingRacuniDialog,
Rust `ponude.rs`, `proizvodnja.rs`, `racuni.rs`, testovi (ugovor ponude/proizvodnja/orders).

1. **Štampa bez write-ahead reda (srednji).** `ponuda.ts:278-298`, `proizvodnja.ts:589-604`,
   `refund.ts:196-230` (i Rust `ponude.rs:386-406`, `proizvodnja.rs:751-771`, refund u
   `racuni.rs`) štampaju prije ikakvog upisa. Nestanak struje tokom štampe: ponuda ostaje
   `prihvacena` i može se ponovo fiskalizovati (dupli fiskalni račun); storno je fiskalizovan
   a roba nije vraćena i račun ostaje `completed`.
   **Odluka:** isti obrazac kao `order:finalize` (spec
   `docs/superpowers/specs/2026-07-06-crash-safe-racuni-design.md`): prije štampe upis u
   `pending_receipts` (snapshot JSON dobija diskriminator vrste, npr. `vrsta: 'ponuda' |
   'nalog' | 'storno'`; postojeći snapshoti bez polja su obični računi — kompatibilnost s
   postojećim bazama). Neuspjeh sa sigurnim ishodom briše red; nepoznat ishod (Task 3) ga
   ostavlja. Uspjeh: upis + brisanje reda u istoj transakciji (s provjerom iz Task 3.2).
   Dijalog nezavršenih računa prikazuje vrstu i razrješava je ispravnom operacijom
   (ponuda → `konvertovana` + račun; nalog → račun + `fakturisan`; storno → `refunded` +
   povrat zalihe po Task 3.4), ili odbacuje. Dok postoji nerazriješen pending red za istu
   ponudu/nalog/račun, nova štampa za isti dokument se odbija.

## Otvoreno nakon izvršenja (follow-up, sitno — završni review: „može čekati")

- `ureq = "3"` suziti na `"~3.4"` (Rust koristi `unversioned` connector API; Cargo.lock drži 3.4.2).
- Nalog: „Preračunaj po normativu" su dva IPC poziva (ponovno Spremi oporavlja); brzi klikovi na izbor proizvoda
  mogu se pregaziti (onemogućiti listu dok se sprema); greška u PonudeScreen zatvara dijalog izbora; StavkeUtroska
  mapira n-ti red na n-tu stavku kalkulacije (samo prikaz); tekst „ne može se završiti" kad je količina na ponudi
  povećana (backend dozvoljava).
- Primka: dvostruka potvrda (dijalog + `potvrdi`) kad ima i nivelacije i upozorenja; `potvrdi` tekst s tačkom
  umjesto zareza; `kolicinaTekst` duplira `kol`.
- Računi: korpa se gubi nakon nepoznatog ishoda ako admin kasnije odbaci red (snapshot je ima); skica ostaje ako
  admin odbaci red tokom štampe koja uspije; Generator validacijske greške označava kao `nepoznat`; DNS se u Rustu
  razrješava dvaput; ponovljeni inline `DELETE FROM pending_receipts` (helper); `ishodNepoznat` kopija u
  `pendingRacun.ts`; storno pri razrješenju ne provjerava jedinstvenost `brojReklamacije`; `no-explicit-any` u
  `refund.ts`; testovi: DB greška nakon štampe čuva red, izuzetak `deviceCashIn` briše red storna.
