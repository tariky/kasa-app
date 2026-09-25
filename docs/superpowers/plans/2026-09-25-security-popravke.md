# Security popravke (nakon audita 2026-09-25)

Izvor zahtjeva ("spec"): sigurnosni audit od 2026-09-25 (6 agenata) + odluka vlasnika:
**popraviti sve nalaze OSIM onoga što je vezano za ključ za šifrovanje backupa / R2 kredencijale u tokenu** — to je namjeran dizajn i ne dira se.

Grana: `fix/security-audit` (baseline commit `8f3de6a` = snapshot vlasnikovih necommitovanih izmjena s main-a).

## Global Constraints

- **NE DIRATI (odluka vlasnika):** `src/lib/backupKljuc.ts` (ostaje necommitovan — NIKAD ga ne `git add`), AES šifrovanje `b.x` polja u `src/lib/licenca.ts`, `src/lib/r2.ts`, `src/lib/backupFajl.ts`, `tools/backup/*`, logovanje punih tokena u `izdane.jsonl`, `backupPodaci()`. Nikakav R2 Worker / presigned URL redizajn.
- Commitati samo eksplicitno navedene putanje (`git add <putanje>`), nikad `git add -A` / `git add .`.
- Oba backenda (Electron TS `src/ipc/handlers.ts` i Rust `src-tauri/backend`) moraju ostati 1-na-1 po ugovoru `src/ipc/ugovor` (`bun test src/ipc/ugovor`, `bun run test:rust`). Promjena ponašanja kanala = promjena ugovornog testa + oba backenda.
- Svaka provjera koja može pasti na bazi/validaciji ide PRIJE štampe na Tring uređaju.
- Poruke greški i UI tekstovi na bosanskom, u stilu postojećeg koda (komentari na bosanskom, ista gustina).
- Na macOS-u WKWebView (Tauri) ne prikazuje `window.confirm/alert` — koristiti `potvrdi/obavijesti` iz `src/lib/dijalog.ts`.
- `bun run lint` pada i na main (294 `import/no-unresolved`) — gate je "bez novih kategorija grešaka u dodirnutim fajlovima".
- Baseline: `bun test` = 966 pass / 4 skip / 0 fail.

## Task 1: Electron i Tauri ljuska, build i CI (worktree A)

Fajlovi: `src/main.ts`, `forge.config.ts`, `index.html`, fontovi (self-host), `package.json`/`bun.lock` (samo electron + png-to-ico + fontovi), `package-lock.json`, `.github/workflows/*`, `.gitignore`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/capabilities/*`, `src-tauri/src/lib.rs`, `vite.*.config.ts`.

1. DevTools isključeni u packaged buildu (`webPreferences.devTools: !app.isPackaged`); vlastiti aplikacijski meni bez View/Toggle DevTools/Reload u packaged buildu (zadržati Edit role — copy/paste mora raditi, na macOS-u i appMenu).
2. `app.on('web-contents-created')`: blokirati `will-navigate` na sve osim URL-a aplikacije; `setWindowOpenHandler` dozvoljava samo `blob:` i otvara ga BEZ preloada (`overrideBrowserWindowOptions.webPreferences: { preload: undefined, sandbox: true, contextIsolation: true, nodeIntegration: false }`); popupi takođe ne smiju navigirati.
3. CSP za Electron produkciju (npr. header preko `session.webRequest.onHeadersReceived` kad je `app.isPackaged`, ili meta ubačen samo u build) — dev (Vite HMR) mora i dalje raditi. Polazna politika: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src blob:; base-uri 'none'; form-action 'none'` — prilagoditi stvarnim potrebama (@react-pdf: blob/worker/wasm) i dokazati da štampa PDF-a radi.
4. Google Fonts izbaciti iz `index.html`; DM Sans i JetBrains Mono servirati lokalno (npr. `@fontsource/*` ili postojeći TTF-ovi iz `src/assets`/`pdf-fonts`).
5. `forge.config.ts`: `asar: true` (+ `@electron-forge/plugin-auto-unpack-natives` za better-sqlite3), fuse `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`, `GrantFileProtocolExtraPrivileges: false`. Dokazati da `bun run package` prolazi i da se upakovana aplikacija pokreće i otvara bazu.
6. Electron na najnoviji 40.x patch (tačna verzija, bez `^`), `bun audit` više ne prijavljuje Electron advisorije koje taj patch rješava.
7. CI (`.github/workflows/*`): `permissions: contents: read`; third-party akcije pinovane na commit SHA (s komentarom verzije); instalacija iz zaključanog lockfile-a (`bun install --frozen-lockfile` ili regenerisan `package-lock.json` + `npm ci`); `png-to-ico` kao pinovana devDependency (ne `npx` s mreže).
8. `.gitignore`: dodati `.env.local`, `.env.*.local`, `.env.production` (NE dodavati backupKljuc.ts).
9. Tauri: `tauri.conf.json` strogi CSP (mora raditi Tauri IPC `ipc: http://ipc.localhost`, blob PDF prozori) i `"freezePrototype": true`; `build.rs` s `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))` i capability koja komande daje samo prozoru `main` (PDF prozori `pdf-N` bez IPC-a); `PAZAR_SMOKE` samo u debug buildu (`cfg!(debug_assertions)`).
10. Tauri save dialog (`src-tauri/src/lib.rs` ~37-44): od `defaultName` uzeti samo ime fajla (bez foldera); dozvoljene ekstenzije `pdf, xlsx, csv, db, zip` — ostalo odbiti.
11. Dokaz: `bun test` zelen, `bunx tauri build --debug --no-bundle` prolazi, smoke `PAZAR_SMOKE=1 PAZAR_USER_DATA=$(mktemp -d) src-tauri/target/debug/pazar` prolazi.

## Task 2: Licenciranje i alati (worktree B)

Fajlovi: `tools/licenca-gui/server.ts`, `tools/licenca-gui/index.html`, `tools/licenca.ts`, `tools/licenca-zajednicko.ts` (osim logovanja tokena), `src/ipc/licenca.ts`, `src/lib/licenca.ts` (samo verifikacija/datum/moduli — NE `b.x`/backup dio), `src/lib/uredjaj.ts`, `src/lib/moduli.ts`, `src-tauri/backend/src/licenca.rs`, njihovi testovi.

1. `licenca-gui` server: odbiti zahtjev čiji `Host` nije `127.0.0.1:<port>` ili `localhost:<port>`; za POST tražiti `Origin` jednak vlastitom originu i `Content-Type: application/json`; nasumični token po pokretanju (u URL-u koji se otvara, npr. `#t=...`), stranica ga šalje kao header na svaki `/api/*` poziv, server odbija bez njega (konstantno-vremensko poređenje). Testovi za sve tri provjere.
2. `licenca-gui` UI: vezanje za uređaj je zadana opcija za novu licencu ("bilo koji uređaj" mora se eksplicitno izabrati).
3. Zaštita od vraćanja sata: efektivni datum za provjeru isteka = max(sistemski datum, `zadnjiDatum`, najnoviji datum iz baze — `MAX(createdAt)` iz `orders` i `cash_movements`), i u TS i u Rustu identično. Brisanje `zadnjiDatum` iz `licenca.json` više ne omogućava produženje.
4. Device ID: `reg` i `ioreg` pozivati apsolutnom putanjom (`%SystemRoot%\System32\reg.exe` — SystemRoot iz env s fallbackom `C:\Windows`; `/usr/sbin/ioreg`) u TS (`src/lib/uredjaj.ts`) i Rustu (`licenca.rs`). Fallback na hostname OSTAJE (Ruling: postojeće licence mogu biti vezane za hostname hash).
5. Kanali koji pripadaju samo modulu (`primka:delete`, `ponuda:delete`, `ponuda:setStatus`, `nalog:delete`, `normativ:save`, `proizvodnja:setEnabled`, i generator kanali — provjeriti koje kanale zove `GeneratorScreen`/`batchRacuni`) blokirati kad modul nije licenciran — u TS i Rustu identično; stanja "nema/neispravna licenca" ne smiju značiti "sve licencirano" za te kanale (provjeriti šta je namjera "samo pregled" moda i ostaviti čitanje).
6. Poravnati TS i Rust verifikator: `typeof`/tip provjere za `d` (string datum) i `u` (string) — nestring = neispravna licenca u oba; base64url potpis mora biti tačne dužine (bez viška na kraju) u oba.
7. Dokaz: `bun test` zelen (uključujući licenca testove), `cargo test -p pazar-backend` zelen.

## Task 3: TS backend — sesija, uloge, korisnici i PIN-ovi (worktree C)

Fajlovi: `src/ipc/handlers.ts`, `src/ipc/api.ts`, `src/preload.ts` (samo ako treba), novi `src/ipc/sesija.ts` (ili sl.), `src/lib/korisnici.ts`, `src/database/db.ts`, `src/database/schema.ts`/migracije, renderer (`App.tsx`, `LoginScreen`, `MainLayout`, `RacunDetailDialog`, `KorisniciGrupa`, `NalogDetailDialog`, ekrani koji šalju `korisnikId`), `src/ipc/ugovor/*` (TS strana + zajednički testovi). NE dirati `src/services/tring.ts`, `src/lib/licenca.ts`, `src/ipc/licenca.ts`.

1. Seed: zadani `Admin`/`0000` upisuje se SAMO kad je tabela `users` prazna.
2. PIN hash: PBKDF2-SHA256, 100000 iteracija, 16 B nasumična so, 32 B izlaz, format `pbkdf2$100000$<so hex>$<hash hex>`; migracija pri otvaranju baze hešira svaki PIN koji ne počinje s `pbkdf2$`. Login/verifyAdminPin/jedinstvenost PIN-a rade verifikacijom nad svim korisnicima (nema više `WHERE pin = ?`). Poređenje konstantno-vremensko.
3. Nijedan kanal ne vraća `pin` (ni hash): `user:getAll` i `user:login` vraćaju `id, ime, uloga`. Edit korisnika: prazan PIN = nepromijenjen.
4. Sesija u main procesu: `user:login` postavlja trenutnog korisnika, novi kanal `user:logout` ga briše (renderer ga zove pri odjavi). Svi kanali osim `licenca:*`, `user:login`, `user:logout` i onoga što `LoginScreen`/`AktivacijaScreen` stvarno zovu prije prijave traže prijavljenog korisnika ("Niste prijavljeni").
5. Uloge: tabela admin-only kanala u main procesu. Admin-only = kanali koji mijenjaju stanje a zovu se samo s admin površina UI-ja (Postavke ekran i `src/components/postavke/*`, Generator, Knjigovođa tab, "Vrati u izradu" naloga) + `fiscal:setZadnjiBroj`, `order:dismissFiscalGap`, `pending:discard`, `db:*`, `user:create/update/delete`, `settings:saveFirma`, `settings:saveTring`, `izvoz:*`. Z-izvještaj ostaje dostupan svakom prijavljenom (Ruling: UI ga daje kasiru). Čitanja potrebna za štampu/kasu ostaju svima.
6. `korisnikId` se nigdje ne uzima iz payload-a — uvijek iz sesije (finalize, createManual, cash, refund, konverzija ponude, nalog status, …). `nalog:setStatus` "vrati" provjerava ulogu iz sesije.
7. Storno: kad je `kasa.requirePinRefund` = `'true'` i trenutni korisnik nije admin, `order:refundAndPrint` mora u istom pozivu dobiti `adminPin` koji se verifikuje u main procesu (prije štampe); `RacunDetailDialog` šalje PIN s pozivom umjesto odvojenog `verifyAdminPin` koraka.
8. Ograničenje pokušaja: brojač neuspjelih PIN provjera (login, verifyAdminPin, adminPin u stornu) u main procesu: nakon 5 uzastopnih neuspjeha blokada 30 s, svaka sljedeća greška udvostručuje (max 15 min); uspjeh resetuje. Poruka kaže koliko sekundi čekati.
9. Zadani PIN: `user:login` vraća i `zadaniPin: true` kad je PIN korisnika `0000`; renderer tada prije ulaska traži novi PIN (novi kanal npr. `user:promijeniSvojPin(stari, novi)` koji radi samo za prijavljenog korisnika).
10. Ukloniti neiskorištene opasne kanale iz `api.ts`, handlera i ugovornih testova — nakon grep provjere da ih renderer ne zove: `order:refund`, `order:create`, `order:updateReklamacija`, `tring:printRefund`, `tring:printReceipt`, `tring:writeArticle` (ako se neki ipak koristi — zadržati i staviti ga iza uloge, zabilježiti u izvještaju).
11. `settings:set`: allowlist ključeva koje renderer stvarno postavlja (`kasa.*` iz KasaGrupa/KasaScreen, `racun.napomena`, `dev.logging`, `ui.*`, skala iz SistemGrupa …); postavke koje su admin-only u UI-ju traže admina; sve ostalo odbiti. `settings:get` ne smije vratiti `tring.operatorPassword`. `settings:getTring` vraća `imaLozinku: boolean` umjesto lozinke; `settings:saveTring` s praznom lozinkom zadržava staru.
12. Ugovorni harness: `Backend` interfejs dobija način prijave (npr. `prijavi(pin)` ili se `call('user:login', pin)` koristi u setupu); postojeći testovi se prijavljuju kao admin; novi ugovorni testovi pokrivaju tačke 1–11 (uključujući odbijanja). Rust adapter će to implementirati u Tasku 5 — `test:rust` smije biti crven do tada.
13. Dokaz: `bun test` zelen; renderer build `bunx vite build --config vite.renderer.config.ts --outDir <scratch>` prolazi; `bunx tsc --noEmit` bez novih grešaka.

## Task 4: TS backend — iznosi, restore, save dialog, audit log (worktree C, nakon Taska 3)

Fajlovi: `src/ipc/handlers.ts`, `src/lib/*` (validacija stavki/totala, `ponuda.ts`), `src/database/restore.ts`, `src/database/schema.ts`, `src/ipc/ugovor/*`.

1. `order:finalize` (i `createPonuda`/`updatePonuda`/`order:createManual` stavke): validacija svake stavke — `kolicina` konačan broj > 0, `cijena` konačan ≥ 0, `rabat` konačan 0 ≤ r < 100, `pdvStopa` iz dozvoljenog skupa, `productId` postoji; `ukupno` i `pdvIznos` računaju se u main procesu iz stavki (postojeći `izracunajTotale`/ista formula kao prilog) — vrijednost iz payload-a se ignoriše ili odbija ako odstupa > 0.005; `nacinPlacanja` whitelist oblika i zbir = ukupno. Sve PRIJE štampe.
2. Restore (`validateBackup`): odbiti fajl koji u `sqlite_master` ima `trigger` ili `view` (aplikacija ih ne definiše — provjeriti) ili tabele kojih nema u shemi; `PRAGMA trusted_schema=OFF` na konekciji aplikacije.
3. Electron save dialog (`handlers.ts` ~1830-1852): `defaultName` → samo `path.basename`; filteri/ekstenzije iz allowliste `pdf, xlsx, csv, db, zip`; `fs:writeFile` dodatno provjerava ekstenziju.
4. Audit log: tabela `audit_log(id, createdAt, korisnikId, akcija, detalji TEXT JSON)` u shemi (dijeljena shema — Rust je čita `include_str!`), upis za: storno, `product:adjustStock`, promjene postavki (`settings:*` save/set), `fiscal:setZadnjiBroj`, `order:dismissFiscalGap`, `pending:discard`, `user:create/update/delete`, `db:restore`, `order:createManual`, promjena cijene artikla. Samo append (nema kanala za brisanje/izmjenu). UI nije potreban.
5. Ugovorni testovi za 1–4.
6. Dokaz: `bun test` zelen.

## Task 5: Tring XML — escaping i validacija (worktree D, paralelno)

Fajlovi: `src/services/tring.ts`, `src-tauri/backend/src/tring.rs`, `src-tauri/backend/src/tring_racun.rs` (ako gradi XML), njihovi testovi.

1. Svako polje u XML-u ide kroz escape (`Lozinka`, `PLU`, `Stopa`, `Grupa`, `Cijena`, `Kolicina`, `Rabat`, `Iznos`, `BrojRacuna`, godina u periodičnom izvještaju).
2. Numerička polja: `Number()` + `isFinite` (Rust: `f64::is_finite`), formatirana fiksnim brojem decimala kakav uređaj očekuje (provjeriti postojeći format da se ne promijeni izlaz za ispravne vrijednosti); `stopa` samo iz skupa koji uređaj prima (provjeriti: E/K ili dr.); `plu` cijeli broj u dozvoljenom rasponu; nevaljano → greška PRIJE slanja uređaju.
3. TS i Rust identičan XML za iste ulaze (postojeći ugovorni testovi s laziTring-om moraju ostati zeleni; dodati testove za injekciju).
4. Dokaz: `bun test` zelen, `cargo test -p pazar-backend` zelen, `bun run test:rust` zelen.

## Task 6: Rust backend — paritet Taskova 3 i 4 (grana nakon merge-a)

Fajlovi: `src-tauri/backend/src/*` (`korisnici.rs`, `kanali.rs`, `lib.rs` backend, `baza.rs`, `racuni.rs`, `postavke.rs`, `uredjaj.rs`, `cash.rs`, `ponude.rs`, `proizvodnja.rs`, …), `src-tauri/backend/Cargo.toml`, `src/ipc/ugovor/rustBackend.ts`.

1. Sve iz Taska 3 i 4 implementirano u Rustu identično (sesija u `Backend`, role tabela u `call_u_redu`, PBKDF2 format i migracija, seed, rate-limit, zadani PIN, uklonjeni kanali, settings allowlist, getTring, finalize validacija, restore provjera + `trusted_schema=OFF`, `fs:writeFile` ekstenzije, audit log).
2. Ako su PBKDF2/crypto crate-ovi prespori u debug buildu, dodati `[profile.dev.package."*"] opt-level = 3` (ili sl.).
3. Dokaz: `bun run test:rust` zelen (svi ugovorni testovi nad Rustom), `cargo test -p pazar-backend` zelen, `bun test` zelen.
