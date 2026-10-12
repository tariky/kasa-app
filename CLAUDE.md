# App configuration

- Electron Forge - typescript app
- React
- ShadCN UI
- Bun
- Tauri 2 port (`src-tauri/`, backend u Rustu) — vidi `src-tauri/README.md`; ugovor oba backenda: `src/ipc/ugovor` (`bun run test:rust`)

# Verzija

- Svaka izmjena koja ide u `main` (i svaki build za korisnika) podiže verziju: `bun run verzija` (patch; `minor`/`major`/`X.Y.Z` po potrebi) — mijenja package.json, tauri.conf.json, oba Cargo.toml i Cargo.lock zajedno. Commit verzije ide uz merge.
