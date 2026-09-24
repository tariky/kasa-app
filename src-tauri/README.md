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

## Razlike u odnosu na Electron

- `window.api` se pravi iz iste definicije (`src/ipc/api.ts`) nad komandom `api`.
- `confirm()`/`alert()` idu kroz `src/lib/dijalog.ts` — WKWebView na macOS-u
  ih ne prikazuje (confirm bi odmah vratio `false`).
- PDF pregled (`window.open(blob:)`) otvara novi prozor; štampa je u meniju
  Datoteka → Štampaj… (Cmd/Ctrl+P).
