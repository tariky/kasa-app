# Automatski backup na Cloudflare R2 — Design

**Datum:** 2026-09-25
**Status:** Approved (brainstorming)

## Problem

Jedini backup danas je ručni: `db:backup` u Postavkama sprema kopiju baze na
disk istog računara. Ako računar izgori, ukrade se ili disk otkaže, podaci
klijenta (računi, fiskalni brojevi, zalihe) su izgubljeni.

## Ciljevi

- Svaka 3 sata dok aplikacija radi, šifrovana kopija baze ide na R2.
- Jedan bucket za sve klijente; ime objekta veže backup za klijenta i računar.
- Backup-i stariji od 15 dana se brišu automatski.
- R2 kredencijali nisu čitljivi klijentu ni u poruci ni na disku.
- Backup može dešifrovati samo vlasnik (Tarik), s bilo kojeg računara —
  izgorio računar klijenta ne znači izgubljen backup.
- Korisnik vidi da backup teče i kad je gotov (tanka traka na vrhu).
- Isto ponašanje u Electron i Tauri backendu.

## Ne-ciljevi (YAGNI)

- Nema servera/Workera — aplikacija šalje direktno na R2.
- Nema brisanja iz aplikacije — brisanje radi lifecycle pravilo bucketa.
- Nema backup-a dok je aplikacija ugašena.
- Nema povrata iz aplikacije — povrat ide preko alata + postojećeg "Uvoz backup-a".
- Backup nije poseban modul u licenci — backup kod je prekidač.
- Klijent sam ne može dešifrovati backup (nema lozinke za povrat).

## Model prijetnje

Kredencijali su u aplikaciji, pa ih odlučan korisnik može izvući. Zato
zaštitu nosi konfiguracija bucketa, ne skrivanje ključa:

| Mjera | Gdje | Šta sprječava |
|---|---|---|
| R2 token samo za `pazar-backup`, "Object Read & Write" | Cloudflare | pristup ostatku naloga |
| Bucket lock 14 dana | Cloudflare | brisanje/prepisivanje tuđih backup-a izvučenim ključem |
| Lifecycle "obriši nakon 15 dana" | Cloudflare | gomilanje; ovo je i automatsko brisanje |
| age šifrovanje javnim ključem | aplikacija | čitanje backup-a bilo kome osim vlasniku |
| AES-GCM nad backup kodom | aplikacija | čitanje kredencijala iz Viber poruke (samo obfuskacija) |
| safeStorage / OS keychain | aplikacija | čitanje kredencijala s diska u čistom tekstu |

Lock je 14 a ne 15 dana da lifecycle nikad ne naleti na zaključan objekat.
Najgore što izvučeni ključ može: slati smeće u bucket (nestaje za 15 dana).

Jednokratno podešavanje bucketa (lock, lifecycle, token) ide u
`tools/backup/README.md`.

## Format backup fajla

`age(gzip(SQLite baza))`, X25519 primalac (`age1…`). Standardni age format:
- aplikacija ima samo javni ključ → može šifrovati, ne i dešifrovati;
- privatni ključ je u `~/.pazar-licenca/backup-kljuc.txt` (pored licencnog),
  format kao `age-keygen`, pa u nuždi radi i
  `age -d -i backup-kljuc.txt x.db.age | gunzip > x.db`.

Probni alat `tools/backup/backup.ts` (`kljuc`, `sifruj`, `desifruj`) već
postoji i provjeren je na stvarnoj bazi (708 KB → 355 KB, dešifrovano i
provjereno; pogrešan ključ i oštećen fajl se odbijaju).

## Ime objekta

```
<klijentId>/<uredjajId>/<UTC ISO, sekunde, ':'→'-'>Z.db.age
salon-ana-7k2f/3f9a…/2026-09-25T15-00-00Z.db.age
```

- `klijentId` dolazi iz backup koda i ostaje isti kad klijent promijeni računar
  (novi računar = novi `uredjajId`, isti prefiks) — tako se nalaze stari backup-i.
- `uredjajId` je postojeći ID računara iz licence (`uredjajId()` u
  `src/ipc/licenca.ts`, `uredjaj_id()` u `licenca.rs`).
- Sekunde u imenu + bucket lock: ništa se ne prepisuje.

## Backup kod (`PAZARB1`)

```
PAZARB1.<base64url(nonce 12B | AES-256-GCM(JSON) | tag 16B)>
JSON: { "a": accountId, "k": accessKeyId, "s": secret, "b": bucket,
        "c": klijentId, "r": "age1…" }
```

- AES ključ je konstanta u aplikaciji (TS i Rust ista). Dužina koda ~370 znakova.
- `r` (javni age ključ) je u kodu, ne u buildu — promjena ključa ne traži novu verziju.
- Izdaje ga `bun run backup kod <klijentId>` i nova sekcija "Backup kod" u
  `tools/licenca-gui`. R2 podaci za izdavanje su u
  `~/.pazar-licenca/r2.json` (`accountId`, `accessKeyId`, `secret`, `bucket`).
- `klijentId`: slug `[a-z0-9-]{3,40}`; generator predlaže slug od naziva
  klijenta + 4 nasumična znaka.

## Pohrana na računaru klijenta

Van baze, jer se baza backup-uje i vraća na drugi računar:
- **kod:** Electron — `userData/backup-kod.bin` šifrovan `safeStorage`-om;
  Tauri — OS keychain (`keyring` crate, servis `Pazar`, nalog `backup-kod`).
- **stanje:** `userData/backup-stanje.json`
  `{ zadnjiUspjeh?: ISO, zadnjiPokusaj?: ISO, greska?: string, greskaOd?: ISO }`.

Prelazak Electron → Tauri na istom računaru traži ponovni unos koda (prihvatljivo).

## Raspored

Čista funkcija `sljedeciBackup(stanje, sada) → Date` (dijeljeni ugovor TS/Rust):
- nikad uspjeha, ili zadnji uspjeh stariji od 3 h → `max(start + 1 min, sada)`;
- zadnji pokušaj pao → zadnji pokušaj + 15 min;
- inače → zadnji uspjeh + 3 h.

Tajmer se nakon svakog pokušaja ponovo postavlja iz te funkcije. Samo jedan
backup istovremeno ("Backup sada" dok teče vraća postojeći).

## Tok jednog backup-a

1. **kopija** — `VACUUM INTO` u temp fajl (dosljedna kopija i s WAL-om).
   Electron: better-sqlite3 u main procesu (sinhrono; ~desetine ms za tipične
   baze). Tauri: posebna konekcija na zasebnoj niti.
2. **šifrovanje** — gzip → age (Electron: `age-encryption`; Rust: `age` crate).
3. **slanje** — `PUT https://<a>.r2.cloudflarestorage.com/<b>/<ime>`,
   AWS SigV4 (`region=auto`, `service=s3`; potpisuje se
   SHA-256 tijela). Ručni potpis (~60 linija po strani), bez AWS SDK-a.
   Napredak se broji po poslanim bajtovima.
4. **kraj** — temp fajl se briše; stanje se upisuje; događaj `gotovo`/`greska`.

Endpoint se u testovima može zamijeniti env varijablom `PAZAR_BACKUP_ENDPOINT`.

## Kanali (IPC)

| Kanal | Ulaz | Izlaz |
|---|---|---|
| `backup:info` | — | `{ aktivan, klijentId?, zadnjiUspjeh?, greska?, greskaOd?, sljedeci?, uToku }` |
| `backup:postaviKod` | `kod` | provjeri format + dešifruj, spremi, odmah pokreni backup; vraća `backup:info`. Neispravan kod → greška, ništa se ne sprema |
| `backup:ukloniKod` | — | briše kod i stanje, gasi tajmer |
| `backup:sada` | — | pokreće backup (ili vraća tekući) |

Događaj `backup:stanje` (backend → renderer):
`{ faza: 'kopija'|'sifrovanje'|'slanje', procenat } | { gotovo: ISO } | { greska: string, trajnaGreska: boolean }`.
`trajnaGreska` = nema uspjeha duže od 24 h.

Preload danas pretplaćuje samo `licenca:blokirano`; postaje opšta
`naDogadjaj(ime, cb) → odjava` (Electron `ipcRenderer.on`, Tauri `listen`).

## UI

**Postavke → kartica "Automatski backup"**
- bez koda: polje za kod + "Uključi";
- s kodom: klijent ID, zadnji uspješan backup, sljedeći, zadnja greška,
  dugmad "Backup sada" i "Isključi".

**Traka napretka (`BackupTraka` u `MainLayout`, iznad sadržaja pored `LicencaTraka`)**
- 2 px linija preko cijele širine, `position: fixed` na vrhu — ne pomjera
  sadržaj (kasa se ne trese usred prodaje); puni se po fazama
  (kopija 0–10 %, šifrovanje 10–20 %, slanje 20–100 %).
- pilula gore desno: `☁ Backup… 45%`.
- gotovo: linija zelena i puna, `✓ Backup spremljen · 15:00`, nestaje za 3 s.
- greška: linija žuta, `Backup nije uspio — pokušavam ponovo za 15 min`, 5 s.
- `trajnaGreska`: pilula ostaje, klik vodi u Postavke.
- `no-print`.

## Povrat (izgorio računar)

`tools/backup/backup.ts` dobija komande (koriste `~/.pazar-licenca/r2.json`):
- `lista <klijentId>` — backup-i po računaru i vremenu;
- `preuzmi <klijentId> [uredjajId] [vrijeme]` — zadnji (ili odabrani) →
  dešifruj → provjeri → `.db`.

Zatim na novom računaru: "Uvoz backup-a" u Postavkama + isti backup kod.
Lista koristi S3 `ListObjectsV2` s istim SigV4 potpisom.

## Greške

- Nema interneta / R2 odbije → `greska` sa porukom, ponovo za 15 min.
- 403 → poruka "Backup kod više ne važi — zatražite novi" (ključ rotiran).
- Neuspjelo dešifrovanje spremljenog koda (npr. drugi korisnik OS-a) →
  backup neaktivan, Postavke traže ponovni unos.
- Greška backup-a nikad ne prekida rad kase; ništa se ne loguje s kredencijalima.

## Testiranje

- **Jedinični (bun test):** `sljedeciBackup`, ime objekta, parse/izdavanje
  `PAZARB1` (ispravan, pogrešan prefiks, oštećen, nepoznata polja), SigV4 nad
  službenim AWS test vektorima.
- **Ugovor (`src/ipc/ugovor`, oba backenda):** `backup:*` kanali protiv lažnog
  S3 servera (`Bun.serve`, `PAZAR_BACKUP_ENDPOINT`): postavi kod → PUT stigne s
  ispravnim imenom i potpisom → tijelo se dešifruje JS `age-encryption`-om i
  prolazi provjeru baze. Pokriva i interop Rust `age` → JS age.
- **Ručno:** stvarni R2 bucket s lockom i lifecycle pravilom; `preuzmi` vrati
  bazu koja prolazi "Uvoz backup-a".
