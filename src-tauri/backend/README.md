# pazar-backend

Rust port Electron main procesa (`src/ipc/handlers.ts` + `src/lib/*` koje on
koristi). Tauri aplikacija (`src-tauri/src`) ga zove kroz jednu komandu `api`.

## Pravila porta

- Ponašanje je ugovor: `src/ipc/ugovor/*.ugovor.test.ts` mora prolaziti i nad
  TS i nad Rust backendom (`bun run test` / `bun run test:rust`).
- Svaka domena (`korisnici.rs`, `skladiste.rs`, …) ima `obradi(b, kanal, a)`
  koja vrati `None` za kanal koji nije njen; raspodjela je u `kanali.rs`.
- Argumenti i rezultati su `serde_json::Value`; JS semantika (`||`, `??`,
  `String(n)`, `Math.round`, `JSON.stringify`) je u `js.rs`. `a[i]` je `null`
  za argument koji nije poslan, `v["k"]` je `null` za polje kojeg nema.
- SQL: `db.all/get/val/run/ima` s parametrima `p![...]`; `db.tx(|| ...)` je
  `db.transaction(fn)()` iz better-sqlite3 (ugniježđeno = SAVEPOINT).
- Greška: `baci!("poruka")` — renderer dobije `new Error(poruka)`.
- Vrijeme: `b.sat` (`danas()`, `godina()`, `iso()`), nikad direktno `Local::now()`
  — ugovorni testovi pomjeraju sat.
- Tring: `b.load_tring_config()?` pa `b.tring.stampati_fiskalni_racun(&racun)`.
