# Automatski backup na Cloudflare R2 — Design

**Datum:** 2026-09-25
**Status:** Approved (brainstorming) — djelimično urađeno, vidi "Stanje implementacije"

## Stanje implementacije (2026-09-26)

**Urađeno i provjereno na stvarnom bucketu** (`pazar-lunatik-doo`, dev licenca "Lunatik doo"):
- `src/lib/licenca.ts` — polje `b` u tokenu, `licenca.backup = { bucket }`, `backupPodaci(token)` (samo main proces).
- `src/lib/backupKljuc.ts` — AES ključ za `b.x` (Rust ga treba čitati `include_str!`).
- `src/lib/r2.ts` — SigV4 (4 službena AWS vektora prolaze), `r2Posalji`, `r2Preuzmi`, `r2Lista`, `imeBackupa`.
- `src/lib/backupFajl.ts` — `sifrujBackup` (gzip + age) / `desifrujBackup`.
- `src/lib/uredjaj.ts` — `uredjajId()` izvučen iz `src/ipc/licenca.ts` (bez Electrona).
- `src-tauri/backend/src/licenca.rs` — parsira `backup.bucket` (bez dešifrovanja `x`).
- Generator licenci (`tools/licenca-gui`, `tools/licenca.ts`, `tools/licenca-zajednicko.ts`) — Account ID, age ključ, bucket + ključevi po klijentu.
- `tools/backup/backup.ts` — `kljuc`, `posalji`, `lista`, `preuzmi`, `sifruj`, `desifruj`
  (`posalji` bez argumenata radi tačno ono što treba aplikacija: licenca + baza dev aplikacije → R2).

**Urađeno u aplikaciji (Electron)** — jedinični i ugovorni testovi prolaze, izgled trake i kartice provjeren
na statičkom pregledu; klik "Backup sada" u pravom Electronu prema stvarnom R2 ostaje ručna provjera vlasnika:
- `src/lib/backupRaspored.ts` — `sljedeciBackup`, `trajnaGreska`, `ukupniProcenat`, tipovi `BackupStanje` / `BackupInfo` / `BackupDogadjaj`.
- `src/lib/backupTok.ts` — `napraviBackup`: tok kopija → šifrovanje → slanje, jedan backup istovremeno, stanje, događaji, `tick`.
- `src/ipc/backup.ts` — kanali `backup:info` / `backup:sada`, događaj `backup:stanje`, VACUUM INTO preko
  better-sqlite3, `userData/backup-stanje.json`, provjera svake minute; preload dobija opštu pretplatu na događaje.
- `src/lib/r2.ts` — `r2Posalji` s napretkom po bajtovima i `R2Greska` sa HTTP statusom (403 `backupTok` pretvara u "R2 pristup više ne važi…").
- `src/lib/backupTraka.ts` + `src/components/backup/BackupTraka.tsx` — linija i pilula u `MainLayout` (tekstovi, boje, trajanje);
  stanje drži `useBackupPrikaz` (`src/hooks/useBackup.ts`), trajnu grešku crta stavka `BackupUpozorenje` u lijevom meniju.
- `src/components/postavke/AutomatskiBackup.tsx` + `src/hooks/useBackup.ts` — kartica u Postavke → Sistem.
- Ugovor: `src/ipc/ugovor/backup.ugovor.test.ts` protiv lažnog S3 (`src/ipc/ugovor/laziS3.ts`, `PAZAR_BACKUP_ENDPOINT`).

**Odluke donesene u planu** (`docs/superpowers/plans/2026-09-25-r2-backup-aplikacija.md`):
1. `sljedeciBackup(stanje, sada, start)` ima treći argument (start), pa pao pokušaj ima prednost (+15 min) i ništa ne ide prije `start + 1 min` — bez petlje kad backup-a nikad nije bilo.
2. Tajmer je provjera svake minute (`setInterval` + `sljedeciBackup`) umjesto jednog dugog `setTimeout`-a — preživi spavanje laptopa i sam primijeti novu licencu (±1 min).
3. `procenat` u događaju je unutar faze (0–100), a traka ga preslikava na ukupni (`ukupniProcenat`); Rust šalje isto.
4. `backup:sada` čeka kraj i vraća `BackupInfo` (greška backup-a je u `info.greska`); baca samo kad backup nije u licenci.
5. Napredak po bajtovima ide kroz `node:http(s)` PUT s `content-length` u komadima od 64 KB, jer `fetch` sa streamom šalje chunked što R2 odbija; GET i lista ostaju na `fetch`.
6. Ugovorni harness dobija `postaviBackupLicencu(r2)` i `dogadjaji`, a backup testovi su `describe.skipIf(KASA_BACKEND === 'rust')` dok Rust ne stigne.
7. Klik na trajno upozorenje otvara Postavke → Sistem samo za admina; kod kasira je to samo oznaka.
8. `BackupTraka` na mount pita `backup:info` i odmah prikaže traku ako backup teče, a pilulu ako je trajna greška — inače čeka događaje.
9. `backup:sada` smije samo admin, `backup:info` svaki prijavljeni korisnik.
10. Prolazna traka i pilula gore desno (klik prolazi kroz njih); trajno upozorenje (nema backup-a >24 h) je stavka u lijevom meniju iznad korisnika — klik vodi u Postavke › Sistem samo za admina (pilula na ekranu je prekrivala dugme Faktura na Kasi).

**Ostaje:**
1. Tauri/Rust: isto (crates `age`, `hmac`, `aes-gcm`; `ureq`, `sha2` već postoje), ugovorni testovi protiv lažnog S3 (`PAZAR_BACKUP_ENDPOINT`), interop Rust age → JS `desifrujBackup`.
   Ugovor `backup.ugovor.test.ts` već postoji i čeka Rust (`describe.skipIf`); `ugovor_server.rs` treba
   `postaviBackupLicencu` i događaje `{"dogadjaj":"backup:stanje","podaci":…}`.


## Problem

Jedini backup danas je ručni: `db:backup` u Postavkama sprema kopiju baze na
disk istog računara. Ako računar izgori, ukrade se ili disk otkaže, podaci
klijenta (računi, fiskalni brojevi, zalihe) su izgubljeni.

## Ciljevi

- Svaka 3 sata dok aplikacija radi, šifrovana kopija baze ide na R2.
- Svaki klijent ima svoj bucket (npr. `pazar-pekara-seher`) i svoj R2 token samo za taj bucket.
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
- Backup nije poseban modul u katalogu — polje `b` u licenci je prekidač.
- Klijent sam ne može dešifrovati backup (nema lozinke za povrat).

## Model prijetnje

Kredencijali su u aplikaciji, pa ih odlučan korisnik može izvući. Zato
zaštitu nosi konfiguracija bucketa, ne skrivanje ključa:

| Mjera | Gdje | Šta sprječava |
|---|---|---|
| R2 token po klijentu, "Object Read & Write" samo za njegov bucket | Cloudflare | pristup ostatku naloga i tuđim backup-ima |
| Bucket lock 14 dana | Cloudflare | brisanje/prepisivanje vlastitih backup-a izvučenim ključem (npr. ransomware) |
| Lifecycle "obriši nakon 15 dana" | Cloudflare | gomilanje; ovo je i automatsko brisanje |
| age šifrovanje javnim ključem | aplikacija | čitanje backup-a bilo kome osim vlasniku |
| AES-GCM nad R2 podacima u licenci | aplikacija | čitanje kredencijala iz Viber poruke i licenca.json (samo obfuskacija) |

Lock je 14 a ne 15 dana da lifecycle nikad ne naleti na zaključan objekat.
Najgore što izvučeni ključ može: slati smeće u bucket tog klijenta (nestaje za 15 dana).

Za svakog klijenta u Cloudflareu: bucket (ime iz generatora), lifecycle,
lock, token samo za taj bucket. Uputstvo je i u generatoru.

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
<bucket klijenta>/<uredjajId>/<UTC ISO, sekunde, ':'→'-'>Z.db.age
pazar-pekara-seher/3f9a…/2026-09-25T15-00-00Z.db.age
```

- Bucket ostaje isti kad klijent promijeni računar (novi računar = novi
  `uredjajId`, isti bucket) — tako se nalaze stari backup-i.
- `uredjajId` je postojeći ID računara iz licence (`uredjajId()` u
  `src/ipc/licenca.ts`, `uredjaj_id()` u `licenca.rs`).
- Sekunde u imenu + bucket lock: ništa se ne prepisuje.

## Backup podaci u licenci

Umjesto zasebnog koda, R2 podaci idu u licencni token (polje `b`), pa klijent
unosi jedan kod, a backup prati licencu (nova licenca = novi R2 podaci).
Payload je potpisan, pa se `b` ne može izmijeniti ni prenijeti iz tuđeg tokena.

```
payload.b = { "c": bucket, "x": base64url(nonce 12B | AES-256-GCM(JSON) | tag 16B) }
JSON: { "a": accountId, "k": accessKeyId, "s": secret, "r": "age1…" }
```

- AES ključ: `src/lib/backupKljuc.ts` (Rust ga čita `include_str!`).
- `procitajLicencu` → `licenca.backup = { bucket }` — ide i u renderer.
  Kredencijali samo kroz `backupPodaci(token)` u main procesu.
- Pokvaren/nepotpun `b` = licenca bez backup-a, ne neispravna licenca.
- Stare verzije aplikacije ignorišu nepoznato polje `b` — novi token radi i kod njih.
- `r` (javni age ključ) je u tokenu, ne u buildu — promjena ključa ne traži novu verziju.
- Token s backup-om ~580 znakova.
- Generator (`tools/licenca-gui`):
  - sekcija "Backup (R2)": Cloudflare Account ID → `~/.pazar-licenca/r2.json`;
    "Napravi ključ" → `backup-kljuc.txt`;
  - forma licence, "Automatski backup na R2": bucket (predlog `pazar-<slug klijenta>`,
    "Kopiraj" za Cloudflare), Access Key ID i Secret tokena tog bucketa;
  - ključevi po bucketu → `~/.pazar-licenca/r2-bucketi.json` (0600) —
    produženje ih ne traži ponovo, povrat (`lista`/`preuzmi`) ih čita odatle;
    bucket drugog klijenta se odbija; secret-i se ne vraćaju u preglednik.
  - CLI: `bun tools/licenca.ts izdaj … --backup <bucket> [--r2-kljuc ID --r2-secret S]`.
  - Dnevnik `izdane.jsonl` bilježi samo bucket, ne ključeve.
- Ime bucketa: `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`.

**Urađeno (2026-09-25):** token, generator, CLI, Rust parsiranje `backup.bucket`
(dešifrovanje u Rustu dolazi sa slanjem). Bucket po klijentu, ne zajednički.

## Pohrana na računaru klijenta

Kredencijali se ne spremaju posebno — žive u licenci (`userData/licenca.json`,
van baze). Stanje backup-a je takođe van baze, jer se baza backup-uje i vraća:
- **stanje:** `userData/backup-stanje.json`
  `{ zadnjiUspjeh?: ISO, zadnjiPokusaj?: ISO, greska?: string, greskaOd?: ISO }`.


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
| `backup:info` | — | `{ aktivan, bucket?, zadnjiUspjeh?, greska?, greskaOd?, sljedeci?, uToku }` |
| `backup:sada` | — | pokreće backup (ili vraća tekući) |

Aktivan = licenca važi (nije zaključana/neispravna) i ima `backup`. Nova
licenca s backup-om pokreće prvi backup odmah (to je i provjera R2 podataka).

Događaj `backup:stanje` (backend → renderer):
`{ faza: 'kopija'|'sifrovanje'|'slanje', procenat } | { gotovo: ISO } | { greska: string, trajnaGreska: boolean }`.
`trajnaGreska` = nema uspjeha duže od 24 h.

Preload danas pretplaćuje samo `licenca:blokirano`; postaje opšta
`naDogadjaj(ime, cb) → odjava` (Electron `ipcRenderer.on`, Tauri `listen`).

## UI

**Postavke → kartica "Automatski backup"**
- licenca bez backup-a: "Automatski backup nije uključen u licencu";
- s backup-om: bucket, zadnji uspješan backup, sljedeći, zadnja greška,
  dugme "Backup sada".

**Traka napretka (`BackupTraka` u `MainLayout`, iznad sadržaja pored `LicencaTraka`)**
- 2 px linija preko cijele širine, `position: fixed` na vrhu — ne pomjera
  sadržaj (kasa se ne trese usred prodaje); puni se po fazama
  (kopija 0–10 %, šifrovanje 10–20 %, slanje 20–100 %).
- pilula gore desno: `☁ Backup… 45%`.
- gotovo: linija zelena i puna, `✓ Backup spremljen · 15:00`, nestaje za 3 s.
- greška: linija žuta, `Backup nije uspio — pokušavam ponovo za 15 min`, 5 s.
- `trajnaGreska`: pilula ostaje, klik vodi u Postavke.
  _Izmijenjeno:_ trajno upozorenje je stavka u lijevom meniju, ne pilula — vidi odluku 10 u "Stanje implementacije".
- `no-print`.

## Povrat (izgorio računar)

`tools/backup/backup.ts` dobija komande (koriste `r2.json` + `r2-bucketi.json`):
- `lista <bucket>` — backup-i po računaru i vremenu;
- `preuzmi <bucket> [uredjajId] [vrijeme]` — zadnji (ili odabrani) →
  dešifruj → provjeri → `.db`.

Zatim na novom računaru: "Uvoz backup-a" u Postavkama + nova licenca s istim bucketom.
Lista koristi S3 `ListObjectsV2` s istim SigV4 potpisom.

## Greške

- Nema interneta / R2 odbije → `greska` sa porukom, ponovo za 15 min.
- 403 → poruka "R2 pristup više ne važi — zatražite novu licencu" (ključ rotiran).
- Greška backup-a nikad ne prekida rad kase; ništa se ne loguje s kredencijalima.

## Testiranje

- **Jedinični (bun test):** `sljedeciBackup`, ime objekta, `b` u licenci
  (urađeno: `licenca.test.ts`, `licenca.rs::backup_u_licenci`), SigV4 nad
  službenim AWS test vektorima.
- **Ugovor (`src/ipc/ugovor`, oba backenda):** `backup:*` kanali protiv lažnog
  S3 servera (`Bun.serve`, `PAZAR_BACKUP_ENDPOINT`): licenca s backup-om → PUT stigne s
  ispravnim imenom i potpisom → tijelo se dešifruje JS `age-encryption`-om i
  prolazi provjeru baze. Pokriva i interop Rust `age` → JS age.
- **Ručno:** stvarni R2 bucket s lockom i lifecycle pravilom; `preuzmi` vrati
  bazu koja prolazi "Uvoz backup-a".
