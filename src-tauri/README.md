# Pazar — Tauri verzija

Isti renderer (React, `src/`) kao Electron verzija, a main proces je prepisan u
Rust (`backend/`). Paket za macOS ima ~6 MB (Electron: ~290 MB).

## Pokretanje i build

| Šta | Komanda |
|---|---|
| Razvoj (Vite na :1420 + prozor) | `bun run tauri:dev` |
| Paket za ovaj OS | `bun run tauri:build` (macOS: `--bundles app` za samo `.app`) |
| Debug binarij s ugrađenim frontendom | `bunx tauri build --debug --no-bundle` |

Potrebno: Rust (stable), Bun, na Windowsu WebView2 (dolazi s Windowsom 10/11).
Windows paket se gradi na Windowsu (`bun run tauri:build` → MSI/NSIS).
Probni NSIS instaler može i s macOS-a: `bun run tauri:build:win` (kros-kompajliranje
preko cargo-xwin; prije toga `brew install nsis llvm lld`,
`rustup target add x86_64-pc-windows-msvc`, `cargo install --locked cargo-xwin`).
Bez MSI-ja i bez Windows ugovornih testova — izdanja idu kroz CI.

Podaci su u istom folderu kao kod Electron verzije (`appData/Pazar`:
`kasa.db`, `licenca.json`), pa Tauri verzija nastavlja nad postojećom bazom i
licencom. `PAZAR_USER_DATA=<folder>` pokrene program nad drugim folderom.

## Testovi

- `bun run test:rust` — svi ugovorni testovi (`src/ipc/ugovor`) nad Rust
  backendom; isti testovi nad TS backendom su dio `bun test`.
- `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend` — unit testovi.
- Smoke test prave aplikacije (webview, UI prijava, pozivi, licenca, PDF prozor):
  `PAZAR_SMOKE=1 PAZAR_USER_DATA=$(mktemp -d) src-tauri/target/debug/pazar` —
  ispiše JSON s provjerama i izađe s 0/1. Skripta je `src/smoke.js`.
- Poređenje s TS backendom nad kopijom stvarne baze (original se ne dira):
  `KASA_STVARNA_BAZA=<putanja do kasa.db> bun test src/ipc/ugovor/stvarnaBaza.poredjenje.test.ts`

## Automatski backup (R2)

Isti kao u Electron verziji (spec `docs/superpowers/specs/2026-09-25-r2-backup-design.md`):
`backup.rs` (raspored, stanje u `userData/backup-stanje.json`, gzip + age, kanali
`backup:info`/`backup:sada`, događaj `backup:stanje`) i `r2.rs` (SigV4, PUT).
Ljuska provjerava raspored svake minute. Kopija baze (`VACUUM INTO`) ide pod
petljom, šifrovanje i slanje bez nje — kasa radi dok backup šalje.

- R2 podaci su u licenci, šifrovani ključem iz `src/lib/backupKljuc.ts`, koji
  NIJE u gitu: lokalno ga kopirati u svaki worktree, a CI ga piše iz tajne
  `PAZAR_BACKUP_KLJUC_HEX`. Bez fajla backend se ne kompajlira.
- `PAZAR_BACKUP_ENDPOINT=<url>` šalje backup na drugi S3 endpoint (testovi, lažni S3).

## Razlike u odnosu na Electron

- `window.api` se pravi iz iste definicije (`src/ipc/api.ts`) nad komandom `api`.
- `confirm()`/`alert()` idu kroz `src/lib/dijalog.ts` — WKWebView na macOS-u
  ih ne prikazuje (confirm bi odmah vratio `false`).
- PDF pregled (`window.open(blob:)`) otvara novi prozor; štampa je u meniju
  Datoteka → Štampaj… (Cmd/Ctrl+P).
