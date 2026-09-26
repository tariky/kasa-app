# Crash-safe fiskalni računi — Design

**Datum:** 2026-07-06
**Status:** Approved (brainstorming)

## Problem

Naplata na kasi radi dva odvojena upisa koji nisu atomični (`KasaScreen.tsx`
`handleFinalize`):

1. `tringPrintReceipt` — fiskalni uređaj **fizički štampa** račun i dodjeljuje mu broj.
2. `createOrder` — tek onda se `order` spremi u SQLite bazu.

Ako se između koraka 1 i 2 računar sruši (nestanak struje, crash, gašenje
aplikacije, ili `createOrder` baci grešku), fiskalni račun je isprintan i
zakonski izdat, ali u bazi **nema zapisa**. Prozor nije zanemariv — poziv za
štampu ima timeout do 30s (`TIMEOUT_MS` u `tring.ts`; samo povezivanje s
uređajem ima zaseban rok od 5 s, `CONNECT_TIMEOUT_MS` / Rust `CONNECT_TIMEOUT`).

Ručni unos (`DodajRacunDialog`, spec 2026-07-01) rješava *oporavak* već
izgubljenog računa, ali ne **sprječava** gubitak. Ovaj dizajn čini kvar
vidljivim i oporavljivim.

## Ciljevi

- Nijedan isprintan fiskalni račun ne smije nestati iz baze bez traga.
- Kada dođe do prekida, stanje mora biti **vidljivo i oporavljivo**, ne tiho izgubljeno.
- Detektovati nedostajuće fiskalne brojeve u nizu i ponuditi oporavak.
- Zadržati postojeći ručni unos kao alat za rekonstrukciju sadržaja.

## Ne-ciljevi (YAGNI)

- Nema pollinga brojača sa fiskalnog uređaja (API ga ne izlaže pouzdano).
- Nema automatske rekonstrukcije sadržaja računa sa uređaja — operater
  potvrđuje prema papirnom računu.
- Ne dira se `orders.status` CHECK constraint (izbjegava se rizičan rebuild tabele).

---

## Layer 1 — Write-ahead intent log

### Nova tabela `pending_receipts`

Dodaje se kroz postojeći migracijski stil u `db.ts` (provjera postojanja +
`CREATE TABLE IF NOT EXISTS`), bez diranja `orders`:

```sql
CREATE TABLE IF NOT EXISTS pending_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  korisnikId INTEGER NOT NULL,
  snapshot TEXT NOT NULL,   -- JSON: stavke, ukupno, pdvIznos, nacinPlacanja, kupac, napomena
  createdAt TEXT DEFAULT (datetime('now','localtime'))
);
```

`snapshot` je JSON kompletnog računa dovoljan da se rekreira `order` +
`order_items` + `stock_movements`.

### Konsolidacija naplate u jedan handler `order:finalize`

Trenutno renderer poziva `tringPrintReceipt` pa `createOrder` kao dva odvojena
IPC poziva — taj razmak je sam po sebi dio prozora za kvar. Novi handler u
main procesu radi cijeli tok:

1. Upiši red u `pending_receipts` sa snapshotom → **odmah commitovano**.
2. Pozovi `Tring.stampatiFiskalniRacun`.
3. Na **uspjeh**: u jednoj DB transakciji **prvo obriši** `pending_receipts`
   red (`preuzmiPendingRed`: `DELETE` mora obrisati tačno jedan red), pa kreiraj
   `order` + `order_items` + `stock_movements` iz snapshota sa vraćenim
   fiskalnim brojem/datumom. Vrati fiskalne podatke. Ako red više ne postoji
   (riješen ili odbačen iz dijaloga dok je štampa trajala), transakcija ne
   upisuje ništa i vraća `{ success: false, vecEvidentiran: true, error,
   brojFiskalnogRacuna }` — ekran to tretira kao završen račun, bez drugog
   zapisa (dopuna 2026-09-26).
4. Na **grešku štampe** odlučuje ishod (dopuna 2026-09-26, vidi „Nepoznat
   ishod štampe"): **siguran neuspjeh** (uređaj odgovorio greškom, veza nije ni
   uspostavljena, zahtjev odbijen prije slanja) briše `pending_receipts` red i
   vraća grešku; **nepoznat ishod** (zahtjev je stigao do uređaja, a odgovora
   nema) red ostavlja i vraća grešku s `ishodNepoznat: true`.

Nakon ovoga, tvrdi crash ili nepoznat ishod mogu ostaviti red jedino u prozoru
koraka 2 → zaostali `pending_receipts` red znači "poslano na štampu, ishod
nepoznat".

`KasaScreen.handleFinalize` se pojednostavljuje na jedan poziv
`window.api.finalizeOrder(...)`.

### Startup rekonciliacija (blokirajući modal)

Pri pokretanju aplikacije, ako postoji ijedan `pending_receipts` red, prikaže se
**blokirajući modal** (kasa se ne može koristiti dok se ne razriješi). Za svaki
red modal prikazuje snapshot (stavke, ukupno) i poruku:

> "Ovaj račun je možda odštampan. Provjerite papirni račun."

Dvije akcije:

- **[Odštampan — unesi fiskalni broj]** — operater unese fiskalni broj i
  datum/vrijeme sa papira; kreira se `order` + `order_items` + `stock_movements`
  iz snapshota, `pending_receipts` red se briše. (Ista logika kao ručni unos.)
- **[Nije odštampan — odbaci]** — briše se `pending_receipts` red (nema ordera,
  nema promjene zaliha, jer ništa nije isprintano).

## Dopuna 2026-09-26 — nepoznat ishod, drugi dokumenti

Izvor: `docs/superpowers/plans/2026-09-26-zalihe-popravke.md` (Task 3 i 4).

### Nepoznat ishod štampe

Tring klijent (`services/tring.ts`, Rust `tring.rs`) razlikuje:

- **Sigurno nije odštampano** (odgovor bez oznake): uređaj je odgovorio
  (`<VrstaOdgovora>` ili `<Greska>`) — uspjeh ili greška; zahtjev odbijen prije
  slanja (validacija); **bilo koja greška prije uspostavljene TCP veze** —
  odbijena veza, nepoznat host/DNS, mreža nedostupna, isteklo povezivanje (5 s).
- **Ishod nepoznat** (`ishodNepoznat: true`): sve poslije uspostavljene veze —
  timeout odgovora (30 s), prekid veze, prekid usred odgovora, odgovor koji
  nije odgovor uređaja, i mrežna greška (npr. `EHOSTUNREACH`/`ENETUNREACH`
  kad LAN pukne dok se čeka odgovor). Račun je možda odštampan.

Pravilo za sve pozivaoce: siguran neuspjeh briše write-ahead red, nepoznat ga
ostavlja (`neuspjelaStampa` / `neuspjela_stampa`) uz poruku „Uređaj nije
potvrdio račun (…) — ishod štampe nije poznat…". Renderer na `ishodNepoznat`
odmah otvara dijalog nezavršenih računa (ne čeka restart), ne ponavlja slanje
(ni generator računa) i prazni korpu; na `vecEvidentiran` tretira račun kao
završen.

### Vrste snapshota

Isti write-ahead red pokriva i dokumente s vlastitom operacijom upisa; snapshot
nosi diskriminator `vrsta`:

| `vrsta` | Tok | Rješavanje („odštampan") |
|---|---|---|
| bez polja ili `null` | kasa, faktura/prilog (i sve stare baze) | račun iz snapshota (kao ranije) |
| `'ponuda'` | ponuda → račun (ekran Ponude, ili nalog iz ponude: tada i `nalogId`) | račun, ponuda `konvertovana`; s `nalogId` i završenim nalogom i nalog `fakturisan` |
| `'nalog'` | samostalni nalog → račun (usluga NAMJ) | račun, nalog `fakturisan` |
| `'storno'` | storno računa (`orderId`, `brojRacuna`, pokretač `korisnikId`, `odobrioAdminId`, `pologIznos`) | račun `refunded` s brojem reklamacije i datumom s papira, zaliha vraćena po kretanjima |

Nepoznata vrsta (npr. baza iz novije verzije) se ne rješava — `pending:resolve`
baca „Nepoznata vrsta nezavršenog zapisa" i ništa ne upisuje. Za storno se
provjera „Fiskalni račun sa tim brojem već postoji" preskače (broj reklamacije
je drugi niz). Uspjeh i rješavanje iz dijaloga dijele istu funkciju upisa, pa
„odštampan" daje isto stanje kao uspješna štampa. Odbacivanje samo briše red
(audit `pending:odbaci` s cijelim snapshotom).

### Zaštita dokumenta dok red čeka

Dok postoji red za isti dokument (`json_extract(snapshot, '$.ponudaId' |
'$.nalogId' | '$.orderId' | '$.skicaId')`, `baciAkoCekaNezavrsen`), odbija se prije štampe ili
izmjene: nova štampa iste ponude (račun ili faktura iz ponude), nova faktura iz
iste skice, novo izdavanje
za isti nalog, novi storno istog računa; vraćanje naloga u izradu i brisanje
naloga (po `nalogId` i po `ponudaId` naloga); izmjena, brisanje i promjena
statusa ponude.

### Skica fakture

Faktura iz skice nosi `skicaId` u snapshotu (ključ samo kad postoji). Uspješan
upis i rješavanje reda brišu `faktura_skice` u istoj transakciji; odbacivanje
je ostavlja (nije odštampano — skica se može ponovo koristiti). Dok red čeka,
skica ostaje, ali nova faktura iz nje se odbija prije štampe (vidi gore).

### Trag storna

Jedan storno = tačno jedan zapis `storno` u `audit_log`, upisan kad je storno
upisan u bazu: uspješna štampa ga piše u handleru; nepoznat ishod ga ne piše
(pokušaj živi u redu); rješavanje iz dijaloga ga piše pod pokretačem storna s
istim detaljima (`orderId`, `brojFiskalnogRacuna`, `brojReklamacije`, `ukupno`,
`odobrioAdminId`, `pologIznos`) plus `pendingId` i `rijesioKorisnikId`;
odbacivanje ga ne piše. Kad je red riješen dok je štampa trajala, handler ne
piše drugi zapis (odgovor `vecEvidentiran`, poruka o reklamaciji).

## Layer 2 — Detekcija praznina u nizu (sequence-gap)

Fiskalni brojevi su sekvencijalni cijeli brojevi koje dodjeljuje uređaj.

### Novi handler `order:getFiscalGaps`

- Sakupi numeričke `brojFiskalnogRacuna` iz `orders` (ignoriši `R-` reklamacijske
  brojeve i `NULL`).
- Vrati cijele brojeve koji nedostaju **strogo između** min i max prisutnog broja.
- Logika detekcije je čista funkcija (`izracunajPraznine(brojevi: number[]): number[]`)
  radi lakšeg testiranja.

Ovo hvata tačno scenario koji se desio: kasnija prodaja je upisana nakon
izgubljene, pa je rupa vidljiva. Slučaj "crash na zadnjem računu dana" (nema
gornje granice) hvata Layer 1 preko zaostalog `pending_receipts` reda — dva sloja
su komplementarna.

### Banner u Narudžbe ekranu

Ako praznine postoje, prikaže se warning banner sa listom nedostajućih brojeva.
Klik na broj otvara postojeći `DodajRacunDialog` **prepopunjen tim fiskalnim
brojem**, pa se račun rekonstruiše kroz već izgrađeni ručni unos.

Praznine su **odbacive** (dismiss) da legitimna rupa (npr. reklamacija koja je
potrošila broj) ne dosađuje zauvijek — odbačeni brojevi se čuvaju u `settings`
(npr. ključ `fiscal.dismissedGaps` kao JSON niz).

---

## Tok podataka (sažetak)

```
Naplata:
  renderer.finalizeOrder(cart)
    → main order:finalize
        1. INSERT pending_receipts(snapshot)          [commit]
        2. Tring.stampatiFiskalniRacun
        3a. uspjeh → TX{ DELETE pending (tačno 1 red, inače vecEvidentiran); order + items + stock } → vrati broj
        3b. siguran neuspjeh → DELETE pending → vrati grešku
        3c. nepoznat ishod → red ostaje → greška s ishodNepoznat → dijalog nezavršenih

Startup:
  main pending:list → ako ima redova → blokirajući modal → resolve/discard

Narudžbe:
  order:getFiscalGaps → banner → klik → DodajRacunDialog(prefill broj)
```

## Rukovanje greškama

- Snapshot upis mora biti commitovan prije poziva štampe (inače nema traga).
- Ako kreiranje ordera (korak 3a) baci grešku *nakon* uspješne štampe, red
  ostaje u `pending_receipts` → hvata ga startup modal. Ne smije se progutati.
- Dupli fiskalni broj pri rekonciliaciji/ručnom unosu: postojeća provjera
  `orders WHERE brojFiskalnogRacuna = ?` sprječava dupli upis.
- Detekcija praznina radi samo na numeričkim brojevima; refundi (`R-...`) se
  preskaču.

## Testiranje

- **Unit:** `izracunajPraznine` — prazan niz, bez rupa, jedna rupa, više rupa,
  nesekvencijalni početak, ignorisanje `R-` brojeva.
- **Unit:** transformacija snapshot → order payload.
- **Integracija (Tring mock server):** `order:finalize` happy path (red se kreira
  pa obriše, order postoji), i simulirana greška štampe (red se obriše, nema ordera).
- **Manualno:** startup modal se pojavi kada postoji zaostali `pending_receipts` red.

## Zahvaćeni fajlovi

- `src/database/schema.ts` — nova tabela `pending_receipts`.
- `src/database/db.ts` — migracija za `pending_receipts`.
- `src/ipc/handlers.ts` — novi `order:finalize`, `order:getFiscalGaps`,
  `pending:list`, `pending:resolve`, `pending:discard`; refaktor postojećeg toka.
- `src/preload.ts` / `src/global.d.ts` — novi API mostovi.
- `src/screens/KasaScreen.tsx` — `handleFinalize` koristi `finalizeOrder`.
- `src/screens/NarudzbeScreen.tsx` — gap banner + prefill dialoga.
- Novi modal komponent za startup rekonciliaciju (npr. `PendingRacuniDialog.tsx`).
- `src/lib/` — čista funkcija `izracunajPraznine` + testovi.
