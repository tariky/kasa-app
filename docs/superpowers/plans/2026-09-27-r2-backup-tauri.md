# Automatski R2 backup u Tauri verziji — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rust backend (Tauri verzija) dobija isti automatski backup na Cloudflare R2 kao Electron: kanale `backup:info` / `backup:sada`, događaj `backup:stanje`, raspored svake 3 h, isti fajl stanja i isti format backup-a — pa kartica „Automatski backup“ i traka rade i u Tauri-ju.

**Architecture:** Novi moduli `src-tauri/backend/src/r2.rs` (SigV4 + PUT s napretkom preko `ureq`) i `backup.rs` (raspored, gzip+age, motor i kanali), a `licenca.rs` dobija dešifrovanje R2 podataka iz tokena (AES-256-GCM, ključ iz `src/lib/backupKljuc.ts` kroz `include_str!`). Kopija baze (`VACUUM INTO`) ide pod petljom kao sinhroni better-sqlite3 u Electronu; šifrovanje i slanje idu uz `Petlja::odmor`, pa kasa radi dok backup šalje. `Platforma` dobija opšti `dogadjaj` (zamjenjuje `licenca_blokirana`) i `u_pozadini`; Tauri ljuska pokreće provjeru svake minute. Ugovorni testovi `src/ipc/ugovor/backup.ugovor.test.ts` (već pisani za Electron) postaju ugovor i za Rust.

**Tech Stack:** Rust (rusqlite, ureq 3, hmac/sha2, `aes-gcm` 0.10, `age` 0.12, `flate2`), Tauri 2, Bun (`bun test`, ugovorni harness), TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-25-r2-backup-design.md` (faza 4 u „Ostaje“). Electron izvedba koju Rust prati: `src/lib/backupRaspored.ts`, `src/lib/backupTok.ts`, `src/lib/backupFajl.ts`, `src/lib/r2.ts`, `src/lib/licenca.ts` (`backupPodaci`), `src/ipc/backup.ts`, `src/ipc/licenca.ts` (`backupPristup`).

## Global Constraints

- Tekstovi za korisnika su identični Electron verziji, slovo po slovo:
  - `Automatski backup nije uključen u licencu.`
  - `R2 pristup više ne važi — zatražite novu licencu` (403, bez tačke na kraju)
  - `Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.` (403 `RequestTimeTooSkewed`)
  - `Nema veze s R2 (<opis>)`, a istek vremena je `Nema veze s R2 (isteklo vrijeme)`
  - `R2 je odbio pristup (<status> <kod>): <poruka>` za 403, `R2 greška (<status> <kod>): <poruka>` za ostalo.
- Stanje je `userData/backup-stanje.json`, isti fajl i oblik kao u Electronu: `{ zadnjiUspjeh?, zadnjiPokusaj?, greska?, greskaOd? }` (ISO stringovi, `JSON.stringify(s, null, 2)` ≙ `serde_json::to_string_pretty`).
- Ime objekta: `<uredjajId>/<UTC YYYY-MM-DDTHH-MM-SS>Z.db.age`; format `age(gzip(SQLite baza))`, X25519 primalac `age1…` iz licence.
- R2 zahtjev: AWS SigV4, `region=auto`, servis `s3`, potpisana zaglavlja `host;x-amz-content-sha256;x-amz-date`; PUT uvijek s `content-length` — **nikad chunked** (R2 ga odbija). Endpoint `https://<accountId>.r2.cloudflarestorage.com`, u testovima `PAZAR_BACKUP_ENDPOINT`.
- Raspored: uspjeh + 3 h; pao pokušaj + 15 min; ne prije `start + 1 min` ni prije `sada`; trajna greška = nema uspjeha > 24 h; provjera svake minute.
- Događaj `backup:stanje`: `{faza:'kopija'|'sifrovanje'|'slanje', procenat}` (procenat unutar faze, cijeli broj 0–100) | `{gotovo: ISO}` | `{greska, trajnaGreska}`.
- `backup:sada` samo admin, `backup:info` svaki prijavljeni — već u `src/ipc/pristup.json`, ne mijenjati.
- Backup nikad ne ruši i ne zaustavlja kasu: greška ide u stanje i događaj; šifrovanje i slanje ne drže petlju.
- `src/lib/backupKljuc.ts` NIJE u gitu (repo je javan, fajl je u `.git/info/exclude`). Worktree ga nema: prije builda `cp /Users/tarik/Documents/development/kasa-app/src/lib/backupKljuc.ts src/lib/`. Nikad ga ne commitati, ne ispisivati sadržaj, ne kopirati u testove.
- Kredencijali (accessKeyId, secret) se nikad ne loguju i ne vraćaju rendereru.
- Rust komande: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend <filter>`; ugovor nad Rustom: `cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server && KASA_BACKEND=rust bun test <fajl>`; cijeli ugovor: `bun run test:rust`. TS: `bun test`.
- Commit poruke na bosanskom, conventional prefiks (`feat(backup): …`), završavaju s `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **R2 odbija chunked upload** — lažni S3 (Bun) prima i chunked tijelo, pa bi Rust koji zaboravi `content-length` prošao sve testove i pao tek na pravom R2. Pinuje: Task 2 (unit test nad sirovim TCP serverom: `content-length` = dužina, nema `transfer-encoding`) i Task 5 (`laziS3` bilježi `content-length`, ugovor ga provjerava nad oba backenda).
2. **Kasa ne smije stajati dok backup šalje** — 100 MB baze na sporoj vezi su minute; ako slanje drži petlju, kasa je zamrznuta. Pinuje: Task 5 (lažni S3 odgađa odgovor; `user:getAll` mora proći dok `backup:sada` još čeka).
3. **R2 prihvati vezu, a ne odgovori** — backup bi zauvijek bio „u toku“ i raspored nikad ne bi pokušao ponovo. Pinuje: Task 2 (server koji ćuti; `posalji` s kratkim `cekanje` vraća `Nema veze s R2 (isteklo vrijeme)`).
4. **`backup-stanje.json` iz Electron verzije ili pokvaren** — Tauri koristi isti userData; mora nastaviti Electron raspored, a pokvaren fajl ne smije srušiti backup. Pinuje: Task 5 (ugovor: Electron stanje → `sljedeci` = uspjeh + 3 h; pokvaren fajl → backup prolazi i prepiše ga).
5. **Licenca s backup-om koju Rust ne zna pročitati** — harness zaobilazi token (`postaviBackupLicencu`), pa bi pogrešno AES-GCM dešifrovanje u Rustu tiho dalo „nije uključen u licencu“ kod svakog klijenta. Pinuje: Task 3 (ugovor: token izdan TS `izdajLicencu` → Rust `backup_podaci` daje iste R2 podatke; pokvaren `b.x` → `null`).

---

## Redoslijed i paralelizam

- **Task 1** (priprema: zavisnosti i prazni moduli) — prvi, sam.
- **Task 2, 3, 4** — nezavisni, mogu paralelno (svaki u svom worktree-u od commita Taska 1). Ne diraju iste fajlove.
- **Task 5** — nakon spajanja 2, 3 i 4.
- **Task 6** — nakon Taska 5.

## Fajlovi

| Fajl | Task | Odgovornost |
|---|---|---|
| `src-tauri/backend/Cargo.toml`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` | 1 | nove zavisnosti, opt-level za zlib/chacha u dev buildu |
| `src-tauri/backend/src/r2.rs` | 2 | SigV4, kodiranje putanje, PUT s napretkom i vremenskim ograničenjima, `R2Greska` |
| `src-tauri/backend/src/licenca.rs` | 3, 5 | `R2Podaci`, `backup_podaci(token)`, `backup_pristup(b)`; (5) `licenca:aktiviraj` pokreće prvi backup |
| `src-tauri/backend/src/sat.rs` | 4 | `iso_iz_ms` (`new Date(ms).toISOString()`) |
| `src-tauri/backend/src/backup.rs` | 4, 5 | (4) `Stanje`, raspored, ime objekta, `sifruj`; (5) motor, `info`/`sada`/`tick`/`nakon_aktivacije`, `KANALI` |
| `src-tauri/backend/src/lib.rs` | 1, 5 | moduli; (5) `Platforma::dogadjaj`/`u_pozadini`, `Backend.backup`, `u_redu`, `odmor` |
| `src-tauri/backend/src/kanali.rs` | 5 | `backup::KANALI` u tabeli |
| `src-tauri/backend/src/proba.rs` | 5 | `BezDijaloga::u_pozadini` |
| `src-tauri/backend/src/bin/ugovor_server.rs` | 3, 5 | meta `r2IzTokena`; (5) događaji, `u_pozadini`, meta `backupLicenca` |
| `src-tauri/src/lib.rs` | 5, 6 | (5) `TauriPlatforma::dogadjaj`/`u_pozadini`; (6) raspored svake minute |
| `src-tauri/capabilities/default.json`, `src-tauri/src/smoke.js`, `src-tauri/README.md` | 6 | opis događaja, smoke provjera, dokumentacija |
| `.github/workflows/build-windows-tauri.yml`, `.github/workflows/build-windows.yml` | 6 | `backupKljuc.ts` iz tajne `PAZAR_BACKUP_KLJUC_HEX` |
| `src/ipc/ugovor/backend.ts`, `tsBackend.ts`, `rustBackend.ts` | 3, 5 | `r2IzTokena`; (5) `postaviBackupLicencu` za Rust |
| `src/ipc/ugovor/laziS3.ts` | 5 | bilježi `content-length`, odgoda odgovora |
| `src/ipc/ugovor/backup.ugovor.test.ts` | 3, 5 | interop tokena; (5) ugovor za oba backenda + Review Focus 1, 2, 4 |
| `src/ipc/ugovor/kanali.ugovor.test.ts`, `sesija.ugovor.test.ts` | 5 | bez izuzetaka „samo Electron“ |
| `docs/superpowers/specs/2026-09-25-r2-backup-design.md` | 6 | stanje implementacije |

---

### Task 1: Priprema — zavisnosti i prazni moduli

Radi ga kontroler prije paralelnih taskova, da Taskovi 2–4 ne mijenjaju isti `Cargo.toml`/`Cargo.lock`/`lib.rs`.

**Files:**
- Modify: `src-tauri/backend/Cargo.toml` (kraj `[dependencies]`)
- Modify: `src-tauri/Cargo.toml` (kraj fajla, profili)
- Modify: `src-tauri/Cargo.lock` (generiše cargo)
- Modify: `src-tauri/backend/src/lib.rs:31` (moduli)
- Create: `src-tauri/backend/src/r2.rs`, `src-tauri/backend/src/backup.rs`

**Interfaces:**
- Produces: crate-ovi `aes_gcm`, `age`, `flate2` dostupni backendu; moduli `crate::r2` i `crate::backup` postoje (prazni).

- [ ] **Step 1: Zavisnosti**

Na kraj `[dependencies]` u `src-tauri/backend/Cargo.toml` (poslije `hostname = "0.4"`):

```toml
# Automatski backup (backup.rs, r2.rs): R2 podaci iz licence (AES-256-GCM, kao
# node:crypto u lib/licenca.ts) i backup fajl age(gzip(baza)) kao lib/backupFajl.ts.
aes-gcm = "0.10"
age = "0.12"
flate2 = "1"
```

Na kraj `src-tauri/Cargo.toml` (poslije `[profile.dev.package.sha2]` bloka):

```toml
# gzip i age šifrovanje backup-a: bez optimizacije desetine MB baze traju
# sekundama i u `tauri dev`.
[profile.dev.package.miniz_oxide]
opt-level = 3
[profile.dev.package.chacha20]
opt-level = 3
[profile.dev.package.poly1305]
opt-level = 3
```

- [ ] **Step 2: Prazni moduli**

`src-tauri/backend/src/r2.rs`:

```rust
//! Minimalni S3 klijent za Cloudflare R2 (`src/lib/r2.ts`): AWS Signature V4
//! i PUT s napretkom po bajtovima. Bez AWS SDK-a.
```

`src-tauri/backend/src/backup.rs`:

```rust
//! Automatski backup na R2 — isto što u Electronu rade `src/lib/backupRaspored.ts`,
//! `backupFajl.ts`, `backupTok.ts` i `src/ipc/backup.ts`. Spec:
//! docs/superpowers/specs/2026-09-25-r2-backup-design.md
```

U `src-tauri/backend/src/lib.rs`, poslije `pub mod zaliha;` (linija 31):

```rust
pub mod r2;
pub mod backup;
```

- [ ] **Step 3: Build i provjera da su crate-ovi tu**

Run: `cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend && cargo tree --manifest-path src-tauri/Cargo.toml -p pazar-backend --depth 1 | grep -E "aes-gcm|age |flate2"`
Expected: build prolazi; ispisane tri linije (`aes-gcm v0.10.x`, `age v0.12.x`, `flate2 v1.x`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/backend/Cargo.toml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/backend/src/lib.rs src-tauri/backend/src/r2.rs src-tauri/backend/src/backup.rs
git commit -m "chore(backup): zavisnosti i moduli za R2 backup u Rust backendu"
```

---

### Task 2: `r2.rs` — SigV4 i PUT s napretkom

**Files:**
- Modify: `src-tauri/backend/src/r2.rs`
- Test: `src-tauri/backend/src/r2.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: ništa iz drugih taskova (samo `hmac`, `sha2`, `regex`, `ureq`, `chrono`).
- Produces (Task 5 koristi tačno ovo):
  ```rust
  pub struct Pristup<'a> { pub account_id: &'a str, pub access_key_id: &'a str, pub secret: &'a str, pub bucket: &'a str, pub endpoint: Option<&'a str> }
  pub struct R2Greska { pub poruka: String, pub status: Option<u16>, pub kod: Option<String> }
  impl R2Greska { pub fn za_korisnika(&self) -> String }
  pub const CEKANJE: Duration; // 120 s
  pub fn posalji(p: &Pristup, kljuc: &str, tijelo: &[u8], napredak: &mut dyn FnMut(u64, u64), cekanje: Duration) -> Result<(), R2Greska>
  pub fn potpisi_s3(z: &ZaPotpis) -> Vec<(String, String)>
  pub fn kodiraj(s: &str, cuvaj_kosu_crtu: bool) -> String
  ```

- [ ] **Step 1: Testovi potpisa, kodiranja i poruka (padaju)**

Na kraj `src-tauri/backend/src/r2.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // Službeni primjeri iz AWS dokumentacije "Signature Calculations for the
    // Authorization Header: Transferring Payload in a Single Chunk" (isti kao r2.test.ts).
    const PRAZNO: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn aws<'a>(metoda: &'a str, putanja: &'a str, upit: &'a [(&'a str, &'a str)], zaglavlja: &'a [(&'a str, &'a str)], hash: &'a str) -> String {
        let z = ZaPotpis {
            metoda, host: "examplebucket.s3.amazonaws.com", putanja, upit, zaglavlja, hash_tijela: hash,
            access_key_id: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region: "us-east-1", amz_datum: "20130524T000000Z",
        };
        potpisi_s3(&z).into_iter().find(|(k, _)| k == "authorization").unwrap().1
    }

    #[test]
    fn sigv4_aws_primjeri() {
        assert_eq!(
            aws("GET", "/test.txt", &[], &[("range", "bytes=0-9")], PRAZNO),
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
        assert!(aws(
            "PUT", "/test$file.text", &[],
            &[("date", "Fri, 24 May 2013 00:00:00 GMT"), ("x-amz-storage-class", "REDUCED_REDUNDANCY")],
            "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
        )
        .ends_with("SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"));
        assert!(aws("GET", "/", &[("lifecycle", "")], &[], PRAZNO).ends_with("Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"));
        assert!(aws("GET", "/", &[("prefix", "J"), ("max-keys", "2")], &[], PRAZNO).ends_with("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"));
    }

    #[test]
    fn kodiranje_putanje() {
        assert_eq!(kodiraj("/b/3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age", true), "/b/3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age");
        assert_eq!(kodiraj("/a b/č$!'()*", true), "/a%20b/%C4%8D%24%21%27%28%29%2A");
        assert_eq!(kodiraj("a/b", false), "a%2Fb");
    }

    #[test]
    fn poruke_gresaka() {
        let g = greska_odgovora(403, "Forbidden", "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>");
        assert_eq!(g.poruka, "R2 je odbio pristup (403 AccessDenied): Access Denied");
        assert_eq!(g.za_korisnika(), "R2 pristup više ne važi — zatražite novu licencu");
        let sat = greska_odgovora(403, "Forbidden", "<Error><Code>RequestTimeTooSkewed</Code><Message>x</Message></Error>");
        assert_eq!(sat.za_korisnika(), "Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.");
        let g = greska_odgovora(500, "Internal Server Error", "");
        assert_eq!((g.poruka.as_str(), g.status, g.kod.clone()), ("R2 greška (500): Internal Server Error", Some(500), None));
        assert_eq!(g.za_korisnika(), g.poruka);
        let g = greska_odgovora(404, "Not Found", "<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>");
        assert_eq!(g.poruka, "R2 greška (404 NoSuchBucket): The specified bucket does not exist.");
    }
}
```

- [ ] **Step 2: Pokreni, mora pasti**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend r2::`
Expected: FAIL (compile error: `ZaPotpis`, `potpisi_s3`, `kodiraj`, `greska_odgovora` ne postoje).

- [ ] **Step 3: Potpis, kodiranje, greške**

Ispod doc komentara u `r2.rs`:

```rust
use std::io::Read;
use std::time::Duration;

use hmac::{Hmac, Mac};
use regex::Regex;
use sha2::{Digest, Sha256};

/// Kuda i s kojim ključem (`R2Pristup` u r2.ts). `endpoint` je samo za testove
/// (lažni S3); inače `https://<accountId>.r2.cloudflarestorage.com`.
pub struct Pristup<'a> {
    pub account_id: &'a str,
    pub access_key_id: &'a str,
    pub secret: &'a str,
    pub bucket: &'a str,
    pub endpoint: Option<&'a str>,
}

/// Greška R2 poziva (`R2Greska`). `status` nema kad server nije ni odgovorio;
/// `kod` je S3 `<Code>` iz tijela (npr. RequestTimeTooSkewed).
#[derive(Debug, Clone, PartialEq)]
pub struct R2Greska {
    pub poruka: String,
    pub status: Option<u16>,
    pub kod: Option<String>,
}

impl R2Greska {
    fn veza(opis: impl std::fmt::Display) -> Self {
        R2Greska { poruka: format!("Nema veze s R2 ({opis})"), status: None, kod: None }
    }

    /// Poruka za korisnika (`porukaGreske` u backupTok.ts). Bez kredencijala —
    /// R2 poruke ih ne sadrže.
    pub fn za_korisnika(&self) -> String {
        match (self.status, self.kod.as_deref()) {
            // x-amz-date odstupa > 15 min: sat računara, ne licenca.
            (Some(403), Some("RequestTimeTooSkewed")) => {
                "Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.".into()
            }
            (Some(403), _) => "R2 pristup više ne važi — zatražite novu licencu".into(),
            _ => self.poruka.clone(),
        }
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn sha256_hex(x: &[u8]) -> String {
    hex(&Sha256::digest(x))
}

fn hmac(kljuc: &[u8], x: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(kljuc).expect("HMAC prima ključ bilo koje dužine");
    m.update(x.as_bytes());
    m.finalize().into_bytes().to_vec()
}

/// RFC 3986 kao što ga S3 traži: sve osim A-Z a-z 0-9 - _ . ~ (i `/` u putanji).
pub fn kodiraj(s: &str, cuvaj_kosu_crtu: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b'/' if cuvaj_kosu_crtu => out.push('/'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Ulaz za `potpisi_s3` (`ZahtjevZaPotpis`).
pub struct ZaPotpis<'a> {
    pub metoda: &'a str,
    pub host: &'a str,
    /// Nekodirana putanja, npr. `/bucket/uredjaj/vrijeme.db.age`.
    pub putanja: &'a str,
    pub upit: &'a [(&'a str, &'a str)],
    /// Dodatna zaglavlja koja se potpisuju.
    pub zaglavlja: &'a [(&'a str, &'a str)],
    pub hash_tijela: &'a str,
    pub access_key_id: &'a str,
    pub secret: &'a str,
    pub region: &'a str,
    /// `YYYYMMDDTHHMMSSZ`
    pub amz_datum: &'a str,
}

/// Zaglavlja za zahtjev (imena malim slovima, sortirana), uključujući
/// `authorization` (SigV4, servis s3) — `potpisiS3` u r2.ts.
pub fn potpisi_s3(z: &ZaPotpis) -> Vec<(String, String)> {
    let mut zaglavlja: Vec<(String, String)> = z.zaglavlja.iter().map(|(k, v)| (k.to_lowercase(), v.to_string())).collect();
    zaglavlja.push(("host".into(), z.host.into()));
    zaglavlja.push(("x-amz-content-sha256".into(), z.hash_tijela.into()));
    zaglavlja.push(("x-amz-date".into(), z.amz_datum.into()));
    zaglavlja.sort();
    let potpisana = zaglavlja.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");
    let razmaci = Regex::new(r"\s+").unwrap();
    let kanonska: String = zaglavlja.iter().map(|(k, v)| format!("{k}:{}\n", razmaci.replace_all(v.trim(), " "))).collect();
    let mut upit = z.upit.to_vec();
    upit.sort();
    let kanonski_upit = upit.iter().map(|(k, v)| format!("{}={}", kodiraj(k, false), kodiraj(v, false))).collect::<Vec<_>>().join("&");
    let kanonski = [z.metoda, &kodiraj(z.putanja, true), &kanonski_upit, &kanonska, &potpisana, z.hash_tijela].join("\n");

    let dan = &z.amz_datum[..8];
    let opseg = format!("{dan}/{}/s3/aws4_request", z.region);
    let za_potpis = ["AWS4-HMAC-SHA256", z.amz_datum, &opseg, &sha256_hex(kanonski.as_bytes())].join("\n");
    let kljuc = hmac(&hmac(&hmac(&hmac(format!("AWS4{}", z.secret).as_bytes(), dan), z.region), "s3"), "aws4_request");
    let potpis = hex(&hmac(&kljuc, &za_potpis));
    zaglavlja.push((
        "authorization".into(),
        format!("AWS4-HMAC-SHA256 Credential={}/{opseg},SignedHeaders={potpisana},Signature={potpis}", z.access_key_id),
    ));
    zaglavlja
}

/// Greška iz odgovora s HTTP statusom (`greskaOdgovora`).
fn greska_odgovora(status: u16, status_tekst: &str, xml: &str) -> R2Greska {
    let polje = |ime: &str| Regex::new(&format!("<{ime}>([^<]*)</{ime}>")).unwrap().captures(xml).map(|c| c[1].to_string());
    let kod = polje("Code").filter(|k| !k.is_empty());
    let poruka = polje("Message").unwrap_or_else(|| status_tekst.to_string());
    let opis = match &kod {
        Some(k) => format!("{status} {k}"),
        None => status.to_string(),
    };
    let poruka = if status == 403 { format!("R2 je odbio pristup ({opis}): {poruka}") } else { format!("R2 greška ({opis}): {poruka}") };
    R2Greska { poruka, status: Some(status), kod }
}
```

- [ ] **Step 4: Pokreni, mora proći**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend r2::`
Expected: PASS (3 testa).

- [ ] **Step 5: Testovi slanja nad sirovim TCP serverom (padaju)**

U isti `mod tests` dodaj (lažni server čita zaglavlja i tijelo tačno po `content-length`, pa se vidi i chunked):

```rust
    /// Jedan zahtjev na 127.0.0.1: pročita ga, sačeka `odgoda`, odgovori `odgovor`.
    /// Vraća adresu i nit koja daje (zaglavlja malim slovima imena, tijelo).
    fn server(odgovor: String, odgoda: Duration) -> (String, std::thread::JoinHandle<(Vec<(String, String)>, Vec<u8>)>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let adresa = format!("http://{}", l.local_addr().unwrap());
        let nit = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = Vec::new();
            let mut komad = [0u8; 16384];
            let kraj = loop {
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
                let n = s.read(&mut komad).unwrap();
                assert!(n > 0, "veza zatvorena prije kraja zaglavlja");
                buf.extend_from_slice(&komad[..n]);
            };
            let zaglavlja: Vec<(String, String)> = String::from_utf8_lossy(&buf[..kraj])
                .lines()
                .skip(1)
                .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string())))
                .collect();
            let duzina = zaglavlja.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse::<usize>().ok()).unwrap_or(0);
            while buf.len() < kraj + duzina {
                let n = s.read(&mut komad).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&komad[..n]);
            }
            std::thread::sleep(odgoda);
            let _ = s.write_all(odgovor.as_bytes());
            (zaglavlja, buf[kraj..].to_vec())
        });
        (adresa, nit)
    }

    fn odgovor(status: &str, tijelo: &str) -> String {
        format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{tijelo}", tijelo.len())
    }

    fn pristup(endpoint: &str) -> Pristup<'_> {
        Pristup { account_id: "acc", access_key_id: "KLJUC", secret: "tajna", bucket: "pazar-test", endpoint: Some(endpoint) }
    }

    #[test]
    fn put_s_duzinom_potpisom_i_napretkom() {
        let (adresa, nit) = server(odgovor("200 OK", ""), Duration::ZERO);
        let tijelo: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut napredak = Vec::new();
        posalji(&pristup(&adresa), "UREDJAJ/2026-09-25T15-00-07Z.db.age", &tijelo, &mut |p, u| napredak.push((p, u)), CEKANJE).unwrap();
        let (z, primljeno) = nit.join().unwrap();
        let h = |k: &str| z.iter().find(|(x, _)| x == k).map(|(_, v)| v.clone());

        assert_eq!(primljeno, tijelo);
        // R2 odbija chunked: dužina mora biti poslana unaprijed.
        assert_eq!(h("content-length"), Some(tijelo.len().to_string()));
        assert_eq!(h("transfer-encoding"), None);
        assert_eq!(h("x-amz-content-sha256"), Some(sha256_hex(&tijelo)));
        // Potpis se poklapa s onim koji bi server izračunao (kao laziS3.ts).
        let host = adresa.trim_start_matches("http://");
        let datum = h("x-amz-date").unwrap();
        let ocekivano = potpisi_s3(&ZaPotpis {
            metoda: "PUT", host, putanja: "/pazar-test/UREDJAJ/2026-09-25T15-00-07Z.db.age", upit: &[], zaglavlja: &[],
            hash_tijela: &sha256_hex(&tijelo), access_key_id: "KLJUC", secret: "tajna", region: "auto", amz_datum: &datum,
        });
        assert_eq!(h("authorization"), ocekivano.into_iter().find(|(k, _)| k == "authorization").map(|(_, v)| v));
        // Napredak raste po komadima i završava na ukupnoj dužini.
        assert!(napredak.len() >= 3, "{napredak:?}");
        assert!(napredak.windows(2).all(|w| w[0].0 < w[1].0));
        assert_eq!(napredak.last(), Some(&(tijelo.len() as u64, tijelo.len() as u64)));
    }

    #[test]
    fn put_403_daje_s3_kod() {
        let xml = "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>";
        let (adresa, nit) = server(odgovor("403 Forbidden", xml), Duration::ZERO);
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, CEKANJE).unwrap_err();
        nit.join().unwrap();
        assert_eq!((g.status, g.kod.as_deref()), (Some(403), Some("AccessDenied")));
        assert_eq!(g.za_korisnika(), "R2 pristup više ne važi — zatražite novu licencu");
    }

    #[test]
    fn server_ne_odgovara_isteklo_vrijeme() {
        let (adresa, nit) = server(odgovor("200 OK", ""), Duration::from_secs(2));
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, Duration::from_millis(300)).unwrap_err();
        assert_eq!(g, R2Greska { poruka: "Nema veze s R2 (isteklo vrijeme)".into(), status: None, kod: None });
        nit.join().unwrap();
    }

    #[test]
    fn nema_servera() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let adresa = format!("http://{}", l.local_addr().unwrap());
        drop(l);
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, CEKANJE).unwrap_err();
        assert!(g.poruka.starts_with("Nema veze s R2 ("), "{}", g.poruka);
        assert_eq!(g.status, None);
    }
```

- [ ] **Step 6: Pokreni, mora pasti**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend r2::`
Expected: FAIL (compile error: `posalji`, `CEKANJE` ne postoje).

- [ ] **Step 7: `posalji`**

Dodaj u `r2.rs` (poslije `greska_odgovora`):

```rust
/// Koliko se čeka veza i odgovor R2 (`cekanjeMs` u r2Posalji).
pub const CEKANJE: Duration = Duration::from_secs(120);
/// Gornja granica cijelog slanja: zaglavljen upload ne smije zauvijek držati
/// backup "u toku" (raspored tada ne bi pokušao ponovo).
const NAJDUZE_SLANJE: Duration = Duration::from_secs(30 * 60);
const KOMAD: usize = 64 * 1024;

/// Tijelo PUT-a u komadima od 64 KB; `napredak` se javi kad komad ode ureq-u.
struct SaNapretkom<'a, 'n> {
    tijelo: &'a [u8],
    poslano: usize,
    napredak: &'n mut dyn FnMut(u64, u64),
}

impl Read for SaNapretkom<'_, '_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = buf.len().min(KOMAD).min(self.tijelo.len() - self.poslano);
        if n == 0 {
            return Ok(0);
        }
        buf[..n].copy_from_slice(&self.tijelo[self.poslano..self.poslano + n]);
        self.poslano += n;
        (self.napredak)(self.poslano as u64, self.tijelo.len() as u64);
        Ok(n)
    }
}

/// PUT objekta (`r2Posalji`). Dužina ide u `content-length` unaprijed — R2
/// odbija chunked, a bez streama ne bi bilo napretka. Datum potpisa je pravi
/// sat (ne `Sat` backenda): R2 odbija zahtjev koji odstupa > 15 min.
pub fn posalji(p: &Pristup, kljuc: &str, tijelo: &[u8], napredak: &mut dyn FnMut(u64, u64), cekanje: Duration) -> Result<(), R2Greska> {
    let baza = match p.endpoint {
        Some(e) => e.trim_end_matches('/').to_string(),
        None => format!("https://{}.r2.cloudflarestorage.com", p.account_id),
    };
    let host = baza.split("://").nth(1).unwrap_or(&baza).split('/').next().unwrap_or("").to_string();
    let putanja = format!("/{}/{kljuc}", p.bucket);
    let datum = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let hash = sha256_hex(tijelo);
    let zaglavlja = potpisi_s3(&ZaPotpis {
        metoda: "PUT", host: &host, putanja: &putanja, upit: &[], zaglavlja: &[], hash_tijela: &hash,
        access_key_id: p.access_key_id, secret: p.secret, region: "auto", amz_datum: &datum,
    });

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(cekanje))
        .timeout_recv_response(Some(cekanje))
        .timeout_global(Some(NAJDUZE_SLANJE))
        .build()
        .into();
    // `host` postavlja ureq iz URL-a (isti kao potpisani).
    let mut z = agent.put(&format!("{baza}{}", kodiraj(&putanja, true))).header("content-length", tijelo.len().to_string());
    for (k, v) in zaglavlja.iter().filter(|(k, _)| k != "host") {
        z = z.header(k.as_str(), v.as_str());
    }
    let mut citac = SaNapretkom { tijelo, poslano: 0, napredak };
    let mut odg = z.send(ureq::SendBody::from_reader(&mut citac)).map_err(|e| match e {
        ureq::Error::Timeout(_) => R2Greska::veza("isteklo vrijeme"),
        e => R2Greska::veza(e),
    })?;
    let status = odg.status();
    if status.is_success() {
        return Ok(());
    }
    let xml = odg.body_mut().read_to_string().unwrap_or_default();
    Err(greska_odgovora(status.as_u16(), status.canonical_reason().unwrap_or(""), &xml))
}
```

Ako se `ureq` API razlikuje u sitnici (npr. ime metode konfiguracije), provjeri u `~/.cargo/registry/src/*/ureq-3.4.2/src/config.rs` i `request.rs`; ponašanje mora ostati isto: eksplicitan `content-length` (ureq tada ne šalje chunked — `has_send_body_mode` u `run.rs`), status ≥ 400 se čita kao odgovor, ne kao greška.

- [ ] **Step 8: Pokreni, mora proći**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend r2::`
Expected: PASS (7 testova).

- [ ] **Step 9: Clippy i commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -p pazar-backend --all-targets 2>&1 | grep -A5 "r2.rs" ; true`
Expected: nema upozorenja u `r2.rs`.

```bash
git add src-tauri/backend/src/r2.rs
git commit -m "feat(backup): R2 klijent u Rustu — SigV4 i PUT s content-length i napretkom"
```

---

### Task 3: R2 podaci iz licence (`licenca.rs`) + interop s TS tokenom

**Files:**
- Modify: `src-tauri/backend/src/licenca.rs` (poslije `backup_bucket`, i `mod tests`)
- Modify: `src-tauri/backend/src/bin/ugovor_server.rs` (meta `r2IzTokena`, doc komentar)
- Modify: `src/ipc/ugovor/backend.ts` (interfejs `Backend`)
- Modify: `src/ipc/ugovor/tsBackend.ts`, `src/ipc/ugovor/rustBackend.ts`
- Modify: `src/ipc/ugovor/backup.ugovor.test.ts` (novi `describe` van `skipIf`)

**Interfaces:**
- Consumes: `crate::licenca::{procitaj_licencu, base64url, backup_bucket, stanje_licence, smije_raditi, procitaj}` (postoje).
- Produces (Task 5 koristi tačno ovo):
  ```rust
  #[derive(Clone, Debug, PartialEq)]
  pub struct R2Podaci { pub account_id: String, pub access_key_id: String, pub secret: String, pub bucket: String, pub primalac: String }
  impl R2Podaci { pub fn iz_json(v: &Value) -> Option<R2Podaci>; pub fn u_json(&self) -> Value }
  pub fn backup_podaci(token: &str) -> Option<R2Podaci>
  pub fn backup_pristup(b: &Backend) -> Option<R2Podaci>
  ```
  Harness: `Backend.r2IzTokena(token: string): Promise<R2Podaci | null>`; ugovor-server meta `{"id":N,"meta":"r2IzTokena","token":"…"}` → `{"id":N,"ok":{accountId,accessKeyId,secret,bucket,primalac}|null}`.

**Prije svega:** u worktree-u `cp /Users/tarik/Documents/development/kasa-app/src/lib/backupKljuc.ts src/lib/` (Global Constraints) — bez njega `include_str!` ne kompajlira.

- [ ] **Step 1: Rust test (pada)**

U `mod tests` u `licenca.rs` dodaj (postojeći `izdaj(k, payload)` pomoćnik se koristi):

```rust
    /// `b.x` kao `sifrujR2` u lib/licenca.ts: nonce(12) | AES-256-GCM(JSON) | tag(16), base64url.
    fn x_za(json: &str) -> String {
        use aes_gcm::aead::{Aead, KeyInit};
        let c = aes_gcm::Aes256Gcm::new_from_slice(backup_kljuc()).unwrap();
        let nonce = [9u8; 12];
        let mut buf = nonce.to_vec();
        buf.extend(c.encrypt(aes_gcm::Nonce::from_slice(&nonce), json.as_bytes()).unwrap());
        URL_SAFE_NO_PAD.encode(buf)
    }

    fn token_s_b(k: &SigningKey, b: &str) -> String {
        izdaj(k, &format!(r#"{{"k":"F","d":"2026-10-10","i":"2026-01-01","b":{b}}}"#))
    }

    #[test]
    fn r2_podaci_iz_licence() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let x = x_za(r#"{"a":"acc","k":"kid","s":"tajna/+=","r":"age1primalac"}"#);
        let t = token_s_b(&k, &format!(r#"{{"c":"pazar-pekara","x":"{x}"}}"#));
        let ocekivano = R2Podaci {
            account_id: "acc".into(), access_key_id: "kid".into(), secret: "tajna/+=".into(),
            bucket: "pazar-pekara".into(), primalac: "age1primalac".into(),
        };
        assert_eq!(backup_podaci(&t), Some(ocekivano.clone()));
        assert_eq!(R2Podaci::iz_json(&ocekivano.u_json()), Some(ocekivano));

        // Pokvaren ili nepotpun `b` = bez backup-a, ne panika.
        let mut pokvaren = x.clone().into_bytes();
        pokvaren[20] = if pokvaren[20] == b'A' { b'B' } else { b'A' };
        let pokvaren = String::from_utf8(pokvaren).unwrap();
        for b in [
            format!(r#"{{"c":"pazar-pekara","x":"{pokvaren}"}}"#),
            r#"{"c":"pazar-pekara","x":"AAAA"}"#.to_string(),
            format!(r#"{{"c":"Los_Bucket","x":"{x}"}}"#),
            format!(r#"{{"c":"pazar-pekara","x":"{}"}}"#, x_za(r#"{"a":"acc","k":"kid","s":"","r":"age1p"}"#)),
            format!(r#"{{"c":"pazar-pekara","x":"{}"}}"#, x_za("nije json")),
        ] {
            assert_eq!(backup_podaci(&token_s_b(&k, &b)), None, "{b}");
        }
        assert_eq!(backup_podaci(&izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01"}"#)), None);
        assert_eq!(backup_podaci("PAZAR1.x.y"), None);
        assert_eq!(R2Podaci::iz_json(&json!({"accountId": "a"})), None);
        assert_eq!(R2Podaci::iz_json(&Value::Null), None);
    }
```

- [ ] **Step 2: Pokreni, mora pasti**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend licenca::`
Expected: FAIL (compile error: `backup_kljuc`, `R2Podaci`, `backup_podaci` ne postoje).

- [ ] **Step 3: Implementacija u `licenca.rs`**

Importi na vrhu (uz postojeće):

```rust
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
```

Poslije `backup_bucket` funkcije:

```rust
/// AES-256-GCM ključ za R2 podatke u licenci (`b.x`) iz `src/lib/backupKljuc.ts`
/// — jedan izvor za oba backenda. Fajl nije u gitu (repo je javan); CI ga
/// piše iz tajne. Skriva kredencijale od onoga ko vidi token, ne i od onoga
/// ko rastavi program — pravu zaštitu nose pravila bucketa.
fn backup_kljuc() -> &'static [u8; 32] {
    static K: OnceLock<[u8; 32]> = OnceLock::new();
    K.get_or_init(|| {
        const TS: &str = include_str!("../../../src/lib/backupKljuc.ts");
        let hex = Regex::new(r"'([0-9a-f]{64})'").unwrap().captures(TS).expect("backupKljuc.ts mora imati ključ od 64 hex znaka")[1].to_string();
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
        }
        k
    })
}

/// R2 pristup (token samo za bucket klijenta) i javni age ključ kojim se
/// backup šifruje (`R2Podaci`). Nikad ne ide rendereru.
#[derive(Clone, Debug, PartialEq)]
pub struct R2Podaci {
    pub account_id: String,
    pub access_key_id: String,
    pub secret: String,
    pub bucket: String,
    /// `age1…` — privatni par je samo kod izdavača.
    pub primalac: String,
}

impl R2Podaci {
    /// Iz JSON oblika `R2Podaci` (TS, camelCase); `None` kad polje fali ili je prazno.
    pub fn iz_json(v: &Value) -> Option<R2Podaci> {
        let s = |k: &str| v.get(k)?.as_str().filter(|x| !x.is_empty()).map(str::to_string);
        Some(R2Podaci {
            account_id: s("accountId")?,
            access_key_id: s("accessKeyId")?,
            secret: s("secret")?,
            bucket: s("bucket")?,
            primalac: s("primalac")?,
        })
    }

    pub fn u_json(&self) -> Value {
        json!({
            "accountId": self.account_id,
            "accessKeyId": self.access_key_id,
            "secret": self.secret,
            "bucket": self.bucket,
            "primalac": self.primalac,
        })
    }
}

/// `desifrujR2`: nonce(12) | AES-256-GCM(JSON {a, k, s, r}) | tag(16).
fn desifruj_r2(bucket: &str, x: &str) -> Option<R2Podaci> {
    let buf = base64url(x)?;
    if buf.len() < 12 + 16 {
        return None;
    }
    let json = Aes256Gcm::new_from_slice(backup_kljuc()).ok()?.decrypt(Nonce::from_slice(&buf[..12]), &buf[12..]).ok()?;
    let p: Value = serde_json::from_slice(&json).ok()?;
    let s = |k: &str| p.get(k)?.as_str().filter(|x| !x.is_empty()).map(str::to_string);
    Some(R2Podaci { account_id: s("a")?, access_key_id: s("k")?, secret: s("s")?, bucket: bucket.to_string(), primalac: s("r")? })
}

/// R2 podaci iz tokena (`backupPodaci`). Ne provjerava potpis — pozivalac
/// koristi token koji je već prošao provjeru licence.
pub fn backup_podaci(token: &str) -> Option<R2Podaci> {
    procitaj_licencu(token)?;
    let payload = token.trim().split('.').nth(1)?;
    let p: Value = serde_json::from_slice(&base64url(payload)?).ok()?;
    let bucket = backup_bucket(&p["b"])?;
    desifruj_r2(bucket, p["b"]["x"].as_str()?)
}
```

Poslije `stanje_licence` funkcije:

```rust
/// R2 podaci za automatski backup (`backupPristup`); `None` kad licenca ne
/// dozvoljava rad ili nema backup. Samo backend, nikad renderer.
pub fn backup_pristup(b: &Backend) -> Option<R2Podaci> {
    let s = stanje_licence(b).ok()?;
    if !smije_raditi(&s) || !s["licenca"]["backup"].is_object() {
        return None;
    }
    backup_podaci(procitaj(b)["token"].as_str()?)
}
```

- [ ] **Step 4: Pokreni, mora proći**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend licenca::`
Expected: PASS (svi licenca testovi, uključujući `r2_podaci_iz_licence` i postojeći `backup_u_licenci`).

- [ ] **Step 5: Ugovorni test interopa (pada)**

U `src/ipc/ugovor/backup.ugovor.test.ts`: `import type { R2Podaci } from '../../lib/licenca';` postaje
`import { izdajLicencu, type R2Podaci } from '../../lib/licenca';`, a uz ostale importe ide

```ts
import { generateKeyPairSync } from 'node:crypto';
```

i na kraj fajla (van postojećeg `describe.skipIf`):

```ts
// Harness zaobilazi token (postaviBackupLicencu), pa ovdje posebno: token koji
// izdaje generator (TS) backend mora pročitati u iste R2 podatke. Za Rust je to
// jedini dokaz da AES-GCM dešifrovanje iz licence radi kao u Electronu.
describe('R2 podaci iz licence (TS izdaje, backend čita)', () => {
  let b: Backend;
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });
  afterEach(async () => { await b.close(); });

  const licenca = { klijent: 'Ugovor d.o.o.', vrijediDo: '2099-12-31', izdana: '2026-09-27', backup: { bucket: 'pazar-ugovor' } };
  const potpis = () => generateKeyPairSync('ed25519').privateKey;

  test('token s backup-om daje iste R2 podatke', async () => {
    const r2: R2Podaci = {
      accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'KLJUČ-ugovor', secret: 'tajna/+=ugovor',
      bucket: 'pazar-ugovor', primalac: await identityToRecipient(await generateIdentity()),
    };
    expect(await b.r2IzTokena(izdajLicencu(licenca, potpis(), r2))).toEqual(r2);
  });

  test('token bez backup-a ili s pokvarenim b.x: null', async () => {
    const { backup: _, ...bezBackupa } = licenca;
    expect(await b.r2IzTokena(izdajLicencu(bezBackupa, potpis()))).toBeNull();

    const r2: R2Podaci = { accountId: 'a', accessKeyId: 'k', secret: 's', bucket: 'pazar-ugovor', primalac: 'age1xyz' };
    const [prefiks, payload, sig] = izdajLicencu(licenca, potpis(), r2).split('.');
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const x: string = p.b.x;
    p.b.x = x.slice(0, 20) + (x[20] === 'A' ? 'B' : 'A') + x.slice(21);
    expect(await b.r2IzTokena(`${prefiks}.${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`)).toBeNull();
  });
});
```

U `src/ipc/ugovor/backend.ts`, interfejs `Backend`, poslije `postaviBackupLicencu`:

```ts
  /**
   * R2 podaci iz tokena licence kako ih backend čita (TS `backupPodaci`, Rust
   * `backup_podaci`) — bez provjere potpisa; `null` = token bez (ispravnog) backup-a.
   */
  r2IzTokena(token: string): Promise<import('../../lib/licenca').R2Podaci | null>;
```

Run: `bun test src/ipc/ugovor/backup.ugovor.test.ts`
Expected: FAIL (`b.r2IzTokena is not a function`).

- [ ] **Step 6: Harness — TS i Rust**

`src/ipc/ugovor/tsBackend.ts`, u objektu `backend` poslije `postaviBackupLicencu`:

```ts
    async r2IzTokena(token) {
      return (await import('../../lib/licenca')).backupPodaci(token);
    },
```

`src/ipc/ugovor/rustBackend.ts`, u objektu `backend` poslije `postaviBackupLicencu`:

```ts
    async r2IzTokena(token) {
      return ((await zahtjev({ meta: 'r2IzTokena', token })).ok ?? null) as import('../../lib/licenca').R2Podaci | null;
    },
```

`src-tauri/backend/src/bin/ugovor_server.rs`: u petlji poslije `if z["meta"] == "kanali" { … }`:

```rust
        if z["meta"] == "r2IzTokena" {
            let r2 = pazar_backend::licenca::backup_podaci(z["token"].as_str().unwrap_or(""));
            posalji(&json!({ "id": z["id"], "ok": r2.map(|r| r.u_json()) }));
            continue;
        }
```

i u doc komentaru na vrhu, poslije pasusa o `{"meta":"kanali"}`:

```rust
//! `{"id":3,"meta":"r2IzTokena","token":"PAZAR1…"}` vraća R2 podatke iz
//! tokena (`Backend.r2IzTokena`) ili `null`.
```

- [ ] **Step 7: Pokreni nad oba backenda, mora proći**

Run: `bun test src/ipc/ugovor/backup.ugovor.test.ts`
Expected: PASS (postojećih 9 + 2 nova).

Run: `cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server && KASA_BACKEND=rust bun test src/ipc/ugovor/backup.ugovor.test.ts`
Expected: PASS 2 (nova), 9 skip.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/backend/src/licenca.rs src-tauri/backend/src/bin/ugovor_server.rs src/ipc/ugovor/backend.ts src/ipc/ugovor/tsBackend.ts src/ipc/ugovor/rustBackend.ts src/ipc/ugovor/backup.ugovor.test.ts
git commit -m "feat(backup): Rust čita R2 podatke iz licence (AES-GCM), interop s TS tokenom u ugovoru"
```

(`src/lib/backupKljuc.ts` NE ide u commit — `git status` ga ne smije prikazati kao dodanog.)

---

### Task 4: Čisti dio `backup.rs` — stanje, raspored, ime, šifrovanje

**Files:**
- Modify: `src-tauri/backend/src/sat.rs` (`iso_iz_ms`)
- Modify: `src-tauri/backend/src/backup.rs`

**Interfaces:**
- Consumes: ništa iz Taskova 2–3.
- Produces (Task 5 koristi tačno ovo):
  ```rust
  // sat.rs
  pub fn iso_iz_ms(ms: i64) -> String;              // new Date(ms).toISOString()
  // backup.rs
  pub struct Stanje { pub zadnji_uspjeh, pub zadnji_pokusaj, pub greska, pub greska_od: Option<String> } // Clone, Debug, Default, PartialEq
  impl Stanje { pub fn iz_json(v: &Value) -> Stanje; pub fn u_json(&self) -> Value; pub fn ima_gresku(&self) -> bool }
  pub fn sljedeci_backup(s: &Stanje, sada: i64, start: i64) -> i64;   // ms
  pub fn trajna_greska(s: &Stanje, sada: i64) -> bool;
  pub fn ime_backupa(uredjaj: &str, ms: i64) -> String;
  pub fn sifruj(baza: &[u8], primalac: &str) -> Result<Vec<u8>, String>;
  ```

- [ ] **Step 1: Testovi (padaju)**

Na kraj `src-tauri/backend/src/backup.rs` (isti slučajevi kao `src/lib/backupRaspored.test.ts`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// 2026-09-25T08:00:00Z
    const START: i64 = 1_790_323_200_000;
    fn min(n: i64) -> i64 {
        START + n * 60_000
    }
    fn iso(ms: i64) -> Option<String> {
        Some(iso_iz_ms(ms))
    }

    #[test]
    fn iso_kao_js() {
        assert_eq!(iso_iz_ms(START), "2026-09-25T08:00:00.000Z");
        assert_eq!(iso_iz_ms(START + 7_123), "2026-09-25T08:00:07.123Z");
    }

    #[test]
    fn raspored() {
        let prazno = Stanje::default();
        // nikad uspjeha: minut nakon starta; aplikacija radi duže: odmah
        assert_eq!(sljedeci_backup(&prazno, START, START), min(1));
        assert_eq!(sljedeci_backup(&prazno, min(90), START), min(90));
        // uspjeh stariji od 3 h: minut nakon starta; prije sat vremena: uspjeh + 3 h
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-300)), ..Default::default() }, START, START), min(1));
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-60)), ..Default::default() }, START, START), min(120));
        // pao pokušaj: + 15 min, i kad uspjeha nikad nije bilo
        let pao = Stanje { zadnji_pokusaj: iso(min(10)), greska: Some("Nema veze s R2".into()), greska_od: iso(min(10)), ..Default::default() };
        assert_eq!(sljedeci_backup(&pao, min(11), START), min(25));
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-600)), ..pao.clone() }, min(11), START), min(25));
        // pad prije pola sata, nakon restarta: minut nakon starta
        let star_pad = Stanje { zadnji_pokusaj: iso(min(-30)), greska: Some("x".into()), greska_od: iso(min(-30)), ..Default::default() };
        assert_eq!(sljedeci_backup(&star_pad, START, START), min(1));
        // sat vraćen unazad (uspjeh u budućnosti): ne čeka taj datum
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(60 * 24 * 30)), ..Default::default() }, START, START), min(1));
        // pokušaj bez greške (ugašeno usred backup-a) nije greška
        let prekinut = Stanje { zadnji_uspjeh: iso(min(-60)), zadnji_pokusaj: iso(min(-5)), ..Default::default() };
        assert_eq!(sljedeci_backup(&prekinut, START, START), min(120));
        // prazan string greške je kao da je nema (JS falsy)
        let prazna = Stanje { zadnji_uspjeh: iso(min(-60)), zadnji_pokusaj: iso(min(-5)), greska: Some(String::new()), ..Default::default() };
        assert_eq!(sljedeci_backup(&prazna, START, START), min(120));
    }

    #[test]
    fn trajna() {
        let dan = 24 * 60;
        let g = |od: i64| Stanje { greska: Some("x".into()), greska_od: iso(min(od)), ..Default::default() };
        assert!(!trajna_greska(&Stanje::default(), START));
        assert!(!trajna_greska(&g(-dan + 1), START));
        assert!(trajna_greska(&g(-dan - 1), START));
        // uspjeh prije 30 h, greške tek sat vremena: i dalje nema uspjeha 24 h
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: iso(min(-30 * 60)), ..g(-60) }, START));
        assert!(!trajna_greska(&Stanje { zadnji_uspjeh: iso(min(-30 * 60)), ..Default::default() }, START));
        // uspjeh "u budućnosti" ili nečitljiv → računa se od greskaOd
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: iso(min(60)), ..g(-dan - 1) }, START));
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: Some("nije datum".into()), ..g(-dan - 1) }, START));
        assert!(!trajna_greska(&Stanje { zadnji_uspjeh: iso(min(60)), ..g(-60) }, START));
    }

    #[test]
    fn stanje_json_kao_electron() {
        let v = serde_json::json!({ "zadnjiUspjeh": "2026-09-25T08:00:00.000Z", "zadnjiPokusaj": 5, "greska": "x", "visak": true });
        let s = Stanje::iz_json(&v);
        assert_eq!(s, Stanje { zadnji_uspjeh: Some("2026-09-25T08:00:00.000Z".into()), greska: Some("x".into()), ..Default::default() });
        assert_eq!(s.u_json(), serde_json::json!({ "zadnjiUspjeh": "2026-09-25T08:00:00.000Z", "greska": "x" }));
        assert_eq!(Stanje::iz_json(&serde_json::json!([1, 2])), Stanje::default());
        assert_eq!(Stanje::iz_json(&Value::Null), Stanje::default());
    }

    #[test]
    fn ime_objekta() {
        // 2026-09-25T15:00:07Z (isto kao r2.test.ts)
        assert_eq!(ime_backupa("3F9A-01C2-7B44", 1_790_348_407_000), "3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age");
    }

    #[test]
    fn sifrovanje_gzip_age() {
        let id = age::x25519::Identity::generate();
        let baza: Vec<u8> = b"SQLite format 3\0".iter().copied().chain((0..50_000u32).map(|i| (i % 7) as u8)).collect();
        let fajl = sifruj(&baza, &id.to_public().to_string()).unwrap();
        assert!(fajl.starts_with(b"age-encryption.org/v1\n"));
        let gz = age::decrypt(&id, &fajl).unwrap();
        assert_eq!(&gz[..2], &[0x1f, 0x8b]);
        let mut vraceno = Vec::new();
        flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut vraceno).unwrap();
        assert_eq!(vraceno, baza);
        assert!(sifruj(b"x", "nije-age-kljuc").unwrap_err().starts_with("Neispravan javni ključ za backup"));
    }
}
```

- [ ] **Step 2: Pokreni, mora pasti**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend backup::`
Expected: FAIL (compile error: `Stanje`, `sljedeci_backup`, `iso_iz_ms`… ne postoje).

- [ ] **Step 3: `sat.rs`**

Na kraj `src-tauri/backend/src/sat.rs`:

```rust
/// `new Date(ms).toISOString()`
pub fn iso_iz_ms(ms: i64) -> String {
    Utc.timestamp_millis_opt(ms).single().unwrap_or_default().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
```

i `Sat::iso` da koristi isto:

```rust
    /// `new Date().toISOString()`
    pub fn iso(&self) -> String {
        iso_iz_ms(self.ms())
    }
```

- [ ] **Step 4: Čisti dio `backup.rs`**

Ispod doc komentara:

```rust
use std::io::Write;

use serde_json::{json, Map, Value};

use crate::sat::iso_iz_ms;

pub const INTERVAL_MS: i64 = 3 * 60 * 60 * 1000;
pub const PONOVO_NAKON_GRESKE_MS: i64 = 15 * 60 * 1000;
pub const ODGODA_STARTA_MS: i64 = 60 * 1000;
pub const TRAJNA_GRESKA_MS: i64 = 24 * 60 * 60 * 1000;

/// `userData/backup-stanje.json` (`BackupStanje`) — isti fajl i oblik kao u
/// Electron verziji (isti userData), van baze jer se baza backup-uje i vraća.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stanje {
    pub zadnji_uspjeh: Option<String>,
    pub zadnji_pokusaj: Option<String>,
    pub greska: Option<String>,
    /// Prvi pad u nizu; briše se uspjehom.
    pub greska_od: Option<String>,
}

impl Stanje {
    /// Iz pročitanog JSON-a: polje koje nije string se ignoriše, a sve što nije
    /// objekat je prazno stanje (ručno pokvaren fajl ne ruši backup).
    pub fn iz_json(v: &Value) -> Stanje {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Stanje { zadnji_uspjeh: s("zadnjiUspjeh"), zadnji_pokusaj: s("zadnjiPokusaj"), greska: s("greska"), greska_od: s("greskaOd") }
    }

    pub fn u_json(&self) -> Value {
        let mut m = Map::new();
        for (k, v) in [("zadnjiUspjeh", &self.zadnji_uspjeh), ("zadnjiPokusaj", &self.zadnji_pokusaj), ("greska", &self.greska), ("greskaOd", &self.greska_od)] {
            if let Some(v) = v {
                m.insert(k.into(), json!(v));
            }
        }
        Value::Object(m)
    }

    /// `s.greska` je istinit u JS-u (neprazan string).
    pub fn ima_gresku(&self) -> bool {
        self.greska.as_deref().is_some_and(|g| !g.is_empty())
    }
}

/// `Date.parse(iso)`; `None` je NaN.
fn ms(iso: Option<&str>) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso?).ok().map(|d| d.timestamp_millis())
}

/// Kada je sljedeći backup (`sljedeciBackup`). Pao pokušaj → pokušaj + 15 min;
/// inače uspjeh + 3 h (nikad uspjeha ili uspjeh "u budućnosti" zbog vraćenog
/// sata → odmah). Nikad prije `start + 1 min` ni prije `sada`.
pub fn sljedeci_backup(s: &Stanje, sada: i64, start: i64) -> i64 {
    let pokusaj = ms(s.zadnji_pokusaj.as_deref());
    let kandidat = match pokusaj {
        Some(p) if s.ima_gresku() && p <= sada => Some(p + PONOVO_NAKON_GRESKE_MS),
        _ => ms(s.zadnji_uspjeh.as_deref()).filter(|u| *u <= sada).map(|u| u + INTERVAL_MS),
    };
    kandidat.unwrap_or(i64::MIN).max(start + ODGODA_STARTA_MS).max(sada)
}

/// Backup pada i uspjeha nema duže od 24 h (`trajnaGreska`). Uspjeh kojeg nema,
/// koji se ne da pročitati ili je "u budućnosti" ne važi — računa se od `greskaOd`.
pub fn trajna_greska(s: &Stanje, sada: i64) -> bool {
    if !s.ima_gresku() {
        return false;
    }
    let od = match ms(s.zadnji_uspjeh.as_deref()) {
        Some(u) if u <= sada => Some(u),
        _ => ms(s.greska_od.as_deref()),
    };
    od.is_some_and(|od| sada - od > TRAJNA_GRESKA_MS)
}

/// `<uredjaj>/<UTC vrijeme>Z.db.age` (`imeBackupa`) — sekunde u imenu, pa se ništa ne prepisuje.
pub fn ime_backupa(uredjaj: &str, ms: i64) -> String {
    format!("{uredjaj}/{}Z.db.age", iso_iz_ms(ms)[..19].replace(':', "-"))
}

/// `sifrujBackup`: age(gzip(baza)) za X25519 primaoca `age1…`. Aplikacija ima
/// samo javni ključ — može šifrovati, ne i dešifrovati.
pub fn sifruj(baza: &[u8], primalac: &str) -> Result<Vec<u8>, String> {
    let primalac: age::x25519::Recipient = primalac.parse().map_err(|e| format!("Neispravan javni ključ za backup: {e}"))?;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(baza).map_err(|e| e.to_string())?;
    let gz = gz.finish().map_err(|e| e.to_string())?;
    age::encrypt(&primalac, &gz).map_err(|e| e.to_string())
}
```

(`JS Date.parse` kod `ms()`: fajl piše samo `toISOString()`, pa je RFC 3339 dovoljan; nečitljiv datum je `None` kao NaN.)

- [ ] **Step 5: Pokreni, mora proći**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend backup:: sat::`
Expected: PASS (6 testova u `backup::tests`).

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend`
Expected: PASS (ništa postojeće nije palo zbog `Sat::iso`).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/backend/src/sat.rs src-tauri/backend/src/backup.rs
git commit -m "feat(backup): raspored, stanje i šifrovanje (gzip + age) u Rust backendu"
```

---

### Task 5: Motor, kanali `backup:*` i ugovor nad Rustom

Nakon spajanja Taskova 2, 3 i 4. Worktree: `git merge --ff-only <vrh grane s 2–4>` i kopija `backupKljuc.ts`.

**Files:**
- Modify: `src-tauri/backend/src/lib.rs` (`Platforma`, `Backend`)
- Modify: `src-tauri/backend/src/backup.rs` (motor + `KANALI`)
- Modify: `src-tauri/backend/src/kanali.rs:11,21-33`
- Modify: `src-tauri/backend/src/licenca.rs` (`KANALI`, `licenca:aktiviraj`)
- Modify: `src-tauri/backend/src/proba.rs` (`BezDijaloga`)
- Modify: `src-tauri/backend/src/bin/ugovor_server.rs`
- Modify: `src-tauri/src/lib.rs` (`TauriPlatforma`)
- Modify: `src/ipc/ugovor/rustBackend.ts`, `src/ipc/ugovor/laziS3.ts`
- Modify: `src/ipc/ugovor/backup.ugovor.test.ts`, `src/ipc/ugovor/kanali.ugovor.test.ts:13-16,47,53`, `src/ipc/ugovor/sesija.ugovor.test.ts:61-62,71-73`

**Interfaces:**
- Consumes: `r2::{Pristup, posalji, CEKANJE, R2Greska::za_korisnika}` (Task 2); `licenca::{R2Podaci, backup_pristup, uredjaj_id}` (Task 3); `backup::{Stanje, sljedeci_backup, trajna_greska, ime_backupa, sifruj}`, `sat::iso_iz_ms` (Task 4).
- Produces (Task 6 koristi):
  ```rust
  pub trait Platforma { …; fn dogadjaj(&self, _ime: &str, _podaci: Value) {} ; fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>); }
  impl Backend { pub backup: backup::Backup; pub fn dogadjaj(&self, ime: &str, podaci: Value); pub fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>); pub fn u_redu<T>(&self, f: impl FnOnce() -> T) -> T; pub(crate) fn odmor(&self) -> petlja::Odmor<'_> }
  pub fn backup::tick(b: &Backend);          // raspored, zove Tauri ljuska svake minute
  pub fn backup::info(b: &Backend) -> Value;
  pub fn backup::sada(b: &Backend) -> R<Value>;
  ```

- [ ] **Step 1: Ugovor za oba backenda (pada nad Rustom)**

`src/ipc/ugovor/laziS3.ts`: `S3Zahtjev` dobija `duzina`, `LaziS3` dobija `odgodaMs`:

```ts
export interface S3Zahtjev {
  metoda: string;
  bucket: string;
  kljuc: string;
  tijelo: Uint8Array;
  /** `content-length` zahtjeva; null = nije poslan (chunked — R2 takav PUT odbija). */
  duzina: number | null;
  potpisIspravan: boolean;
  hashIspravan: boolean;
}

export interface LaziS3 {
  url: string;
  zahtjevi: S3Zahtjev[];
  /** Status kojim server odgovara (200, 403, 500…). */
  status: number;
  /** S3 `<Code>` u tijelu greške; bez njega 403 → AccessDenied. */
  kod?: string;
  /** Koliko server čeka prije odgovora (spora veza). */
  odgodaMs: number;
  stop(): void;
}
```

U `pokreniLaziS3`: početni objekat dobija `odgodaMs: 0`; u `s3.zahtjevi.push({...})` dodaj
`duzina: req.headers.has('content-length') ? Number(req.headers.get('content-length')) : null,`;
a odmah poslije `push` (prije odgovora):

```ts
      if (s3.odgodaMs) await Bun.sleep(s3.odgodaMs);
```

`src/ipc/ugovor/backup.ugovor.test.ts`:

1. Komentar na vrhu zamijeni s:

```ts
// Ugovor automatskog backup-a: backup:info, backup:sada i događaj
// backup:stanje, protiv lažnog S3 (PAZAR_BACKUP_ENDPOINT), nad oba backenda.
// Tijelo se dešifruje JS age-om i otvara kao baza — za Rust je to i interop.
```

2. `import { readdirSync, writeFileSync } from 'node:fs';` → `import { readdirSync, readFileSync, writeFileSync } from 'node:fs';`

3. `// Rust backend dobija backup:* u fazi 4 …` i `describe.skipIf(process.env.KASA_BACKEND === 'rust')('backup:*', () => {` → `describe('backup:*', () => {`

4. U testu `backup:sada šalje potpisanu…` poslije `expect(z.kljuc).toMatch(IME);`:

```ts
    // R2 odbija chunked PUT: dužina mora ići unaprijed (lažni S3 bi primio i chunked).
    expect(z.duzina).toBe(z.tijelo.length);
```

5. Novi testovi na kraj `describe('backup:*')`:

```ts
  test('dok backup šalje, kasa radi (slanje ne drži red poziva)', async () => {
    b.postaviBackupLicencu(r2);
    s3.odgodaMs = 1500;
    let gotov = false;
    const backup = b.pozovi('backup:sada').then(i => { gotov = true; return i; });
    for (let i = 0; i < 200 && !stanjaBackupa().some(s => s.faza === 'slanje'); i++) await Bun.sleep(10);
    expect(stanjaBackupa().some(s => s.faza === 'slanje')).toBe(true);

    expect(await b.pozovi('user:getAll')).toBeArray();
    expect(gotov).toBe(false);
    expect((await backup).greska).toBeUndefined();
  });

  const fajlStanja = () => path.join(b.radniFolder, '..', 'backup-stanje.json');

  test('backup-stanje.json iz Electron verzije: raspored se nastavlja', async () => {
    const uspjeh = new Date(Date.now() - 60 * 60_000).toISOString();
    writeFileSync(fajlStanja(), JSON.stringify({ zadnjiUspjeh: uspjeh, zadnjiPokusaj: uspjeh }, null, 2));
    b.postaviBackupLicencu(r2);
    const info = await b.pozovi('backup:info');
    expect(info.zadnjiUspjeh).toBe(uspjeh);
    expect(info.sljedeci).toBe(new Date(Date.parse(uspjeh) + 3 * 60 * 60_000).toISOString());
    expect(info.greska).toBeUndefined();
  });

  test('pokvaren backup-stanje.json: kao da backup-a nije bilo, backup prolazi i prepiše ga', async () => {
    writeFileSync(fajlStanja(), '{pokvaren');
    b.postaviBackupLicencu(r2);
    expect((await b.pozovi('backup:info')).zadnjiUspjeh).toBeUndefined();
    const info = await b.pozovi('backup:sada');
    expect(info.greska).toBeUndefined();
    expect(JSON.parse(readFileSync(fajlStanja(), 'utf8'))).toEqual({ zadnjiUspjeh: info.zadnjiUspjeh, zadnjiPokusaj: expect.any(String) });
  });
```

`src/ipc/ugovor/kanali.ugovor.test.ts`: obriši `SAMO_ELECTRON` i `preskoci` (linije 13–16); `expect(preskoci(await kanaliIzApi()))` → `expect(await kanaliIzApi())`; `preskoci(kanali).filter(` → `kanali.filter(`.

`src/ipc/ugovor/sesija.ugovor.test.ts`: dva bloka

```ts
  // Rust: faza 4 (automatski backup)
  ...(process.env.KASA_BACKEND === 'rust' ? [] : ['backup:info', 'backup:sada'] as const),
```

→ `'backup:info', 'backup:sada',` (kraj liste, uz ostale kanale), i

```ts
  // Rust: faza 4 (automatski backup)
  ...(process.env.KASA_BACKEND === 'rust' ? [] : ['backup:sada'] as const),
```

→ `'backup:sada',`.

Run: `bun test src/ipc/ugovor/backup.ugovor.test.ts src/ipc/ugovor/kanali.ugovor.test.ts src/ipc/ugovor/sesija.ugovor.test.ts`
Expected: PASS nad TS backendom (Electron već zadovoljava sve, uključujući `content-length` i kasu tokom slanja).

Run: `cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server && KASA_BACKEND=rust bun test src/ipc/ugovor/backup.ugovor.test.ts src/ipc/ugovor/kanali.ugovor.test.ts src/ipc/ugovor/sesija.ugovor.test.ts`
Expected: FAIL (`Rust backend još nema automatski backup`, `Kanal ne postoji: backup:info`, lista kanala se razlikuje).

- [ ] **Step 2: `Platforma` i `Backend` (`lib.rs`)**

U `trait Platforma` zamijeni

```rust
    /// Licenca je blokirala kanal — renderer prikazuje dijalog (`licenca:blokirano`).
    fn licenca_blokirana(&self) {}
```

s

```rust
    /// Događaj prozoru (`webContents.send(ime, podaci)`): `licenca:blokirano`,
    /// `backup:stanje`.
    fn dogadjaj(&self, _ime: &str, _podaci: Value) {}
    /// Posao nad backendom u pozadini (u Electronu `void promise`) — prvi
    /// backup nakon aktivacije licence. Posao sam čeka red (`Backend::u_redu`).
    fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>);
```

U `struct Backend` poslije `u_toku`:

```rust
    /// Automatski backup na R2 (backup.rs).
    pub backup: backup::Backup,
```

U `Backend::novi`, prije `Ok(Backend {`: `let start = sat.ms();`, a u struct literal: `backup: backup::Backup::novi(start),`.

`licenca_blokirana` postaje:

```rust
    pub fn licenca_blokirana(&self) {
        self.platforma.dogadjaj("licenca:blokirano", Value::Null);
    }

    /// Događaj prozoru (vidi `Platforma::dogadjaj`).
    pub fn dogadjaj(&self, ime: &str, podaci: Value) {
        self.platforma.dogadjaj(ime, podaci);
    }

    pub fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>) {
        self.platforma.u_pozadini(posao);
    }

    /// Posao izvan IPC poziva (raspored backup-a, posao u pozadini): čeka red
    /// kao poziv i drži petlju dok radi.
    pub fn u_redu<T>(&self, f: impl FnOnce() -> T) -> T {
        let _z = self.petlja.uzmi(self.tiket());
        f()
    }

    /// Otpusti petlju dok se čeka nešto spolja (slanje backup-a) — `Petlja::odmor`.
    pub(crate) fn odmor(&self) -> petlja::Odmor<'_> {
        self.petlja.odmor()
    }
```

`src-tauri/backend/src/proba.rs`, `impl Platforma for BezDijaloga`:

```rust
    fn u_pozadini(&self, _: Box<dyn FnOnce(&Backend) + Send>) {}
```

- [ ] **Step 3: Motor u `backup.rs`**

Importi na vrhu `backup.rs` postaju:

```rust
use std::io::Write;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use serde_json::{json, Map, Value};

use crate::greska::{Greska, R};
use crate::kanali::Kanal;
use crate::licenca::{self, R2Podaci};
use crate::sat::iso_iz_ms;
use crate::{p, r2, Backend};
```

Poslije `sifruj` (prije `#[cfg(test)]`):

```rust
// ─── Motor (backupTok.ts + ipc/backup.ts) ─────────────────────────

pub const NEMA_BACKUPA: &str = "Automatski backup nije uključen u licencu.";

fn zakljucaj<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Backup koji upravo teče; ko dođe dok traje, čeka njegov rezultat (`tekuci` promise).
#[derive(Default)]
struct Tekuci {
    info: Mutex<Option<Value>>,
    cv: Condvar,
}

impl Tekuci {
    fn zavrsi(&self, info: Value) {
        let mut g = zakljucaj(&self.info);
        if g.is_none() {
            *g = Some(info);
        }
        self.cv.notify_all();
    }

    fn cekaj(&self) -> Value {
        let mut g = zakljucaj(&self.info);
        while g.is_none() {
            g = self.cv.wait(g).unwrap_or_else(|e| e.into_inner());
        }
        g.clone().unwrap_or(Value::Null)
    }
}

/// Stanje motora (`napraviBackup`). Funkcije ispod zove neko ko drži petlju:
/// kanal, raspored (`tick`) ili posao nakon aktivacije licence.
pub struct Backup {
    /// Kad je backend pokrenut (ms): prvi backup ne ide prije start + 1 min.
    start: i64,
    /// Zadnje poznato stanje: i kad se fajl ne može upisati, raspored ne smije
    /// slati svake minute (svaki objekt je 14 dana zaključan i plaća se).
    memorija: Mutex<Option<Stanje>>,
    tekuci: Mutex<Option<Arc<Tekuci>>>,
    /// Ugovorni testovi (licenca otključana): R2 podaci umjesto licence
    /// (`postaviBackupLicencu`); `None` = licenca bez backup-a.
    testni_pristup: Mutex<Option<R2Podaci>>,
    /// `PAZAR_BACKUP_ENDPOINT` (lažni S3 u testovima); inače R2 po accountId.
    endpoint: Option<String>,
}

impl Backup {
    pub fn novi(start: i64) -> Self {
        Backup {
            start,
            memorija: Mutex::new(None),
            tekuci: Mutex::new(None),
            testni_pristup: Mutex::new(None),
            endpoint: std::env::var("PAZAR_BACKUP_ENDPOINT").ok().filter(|e| !e.is_empty()),
        }
    }

    /// Samo ugovor-server: šta "licenca" daje backup-u.
    pub fn postavi_testni_pristup(&self, r2: Option<R2Podaci>) {
        *zakljucaj(&self.testni_pristup) = r2;
    }
}

fn pristup(b: &Backend) -> Option<R2Podaci> {
    if !b.provjera_licence {
        return zakljucaj(&b.backup.testni_pristup).clone();
    }
    licenca::backup_pristup(b)
}

fn putanja_stanja(b: &Backend) -> std::path::PathBuf {
    b.user_data().join("backup-stanje.json")
}

fn stanje(b: &Backend) -> Stanje {
    zakljucaj(&b.backup.memorija)
        .get_or_insert_with(|| {
            std::fs::read_to_string(putanja_stanja(b))
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .map(|v| Stanje::iz_json(&v))
                .unwrap_or_default()
        })
        .clone()
}

fn pisi(b: &Backend, s: Stanje) {
    let json = serde_json::to_string_pretty(&s.u_json()).unwrap_or_default();
    *zakljucaj(&b.backup.memorija) = Some(s);
    if let Err(e) = std::fs::write(putanja_stanja(b), json) {
        eprintln!("Backup: stanje nije upisano: {e}");
    }
}

fn javi(b: &Backend, d: Value) {
    b.dogadjaj("backup:stanje", d);
}

/// `backup:info`
pub fn info(b: &Backend) -> Value {
    let u_toku = zakljucaj(&b.backup.tekuci).is_some();
    let Some(r2) = pristup(b) else { return json!({ "aktivan": false, "uToku": u_toku }) };
    let s = stanje(b);
    let mut o = json!({ "aktivan": true, "bucket": r2.bucket, "uToku": u_toku });
    if let Some(u) = s.zadnji_uspjeh.as_ref().filter(|u| !u.is_empty()) {
        o["zadnjiUspjeh"] = json!(u);
    }
    if s.ima_gresku() {
        o["greska"] = json!(s.greska);
        if let Some(od) = s.greska_od.as_ref().filter(|od| !od.is_empty()) {
            o["greskaOd"] = json!(od);
        }
    }
    o["sljedeci"] = json!(iso_iz_ms(sljedeci_backup(&s, b.sat.ms(), b.backup.start)));
    o
}

/// Dosljedna kopija baze: `VACUUM INTO` temp fajl na aktivnoj konekciji, pod
/// petljom — kao sinhroni better-sqlite3 u Electronu (desetine ms), pa ni
/// transakcija ni uvoz backup-a ne mogu upasti usred kopije. Temp fajl se briše.
fn kopija_baze(b: &Backend) -> Result<Vec<u8>, String> {
    let mut id = [0u8; 8];
    getrandom::getrandom(&mut id).map_err(|e| e.to_string())?;
    let ime: String = id.iter().map(|x| format!("{x:02x}")).collect();
    let cilj = std::env::temp_dir().join(format!("pazar-backup-{ime}.db"));
    let r = b
        .db()
        .run("VACUUM INTO ?", p![cilj.to_string_lossy().into_owned()])
        .map_err(|g| g.0)
        .and_then(|_| std::fs::read(&cilj).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&cilj);
    r
}

/// Jedan backup: kopija → šifrovanje → slanje; ishod ide u stanje i događaj,
/// nikad kao greška pozivaocu (kasa radi dalje).
fn izvrsi(b: &Backend, r2: &R2Podaci) {
    let pocetak = b.sat.ms();
    let pocetak_iso = iso_iz_ms(pocetak);
    pisi(b, Stanje { zadnji_pokusaj: Some(pocetak_iso.clone()), ..stanje(b) });
    let rezultat = (|| -> Result<(), String> {
        javi(b, json!({ "faza": "kopija", "procenat": 0 }));
        let baza = kopija_baze(b)?;
        // Šifrovanje i slanje traju (minute na sporoj vezi) — kasa za to vrijeme
        // radi, kao `await` u Electronu. Petlja se vraća na kraju ovog bloka.
        let _odmor = b.odmor();
        javi(b, json!({ "faza": "sifrovanje", "procenat": 0 }));
        let fajl = sifruj(&baza, &r2.primalac)?;
        javi(b, json!({ "faza": "slanje", "procenat": 0 }));
        let pristup = r2::Pristup {
            account_id: &r2.account_id,
            access_key_id: &r2.access_key_id,
            secret: &r2.secret,
            bucket: &r2.bucket,
            endpoint: b.backup.endpoint.as_deref(),
        };
        let mut zadnji = 0;
        let mut napredak = |poslano: u64, ukupno: u64| {
            let procenat = if ukupno == 0 { 100 } else { poslano * 100 / ukupno };
            if procenat > zadnji {
                zadnji = procenat;
                javi(b, json!({ "faza": "slanje", "procenat": procenat }));
            }
        };
        r2::posalji(&pristup, &ime_backupa(licenca::uredjaj_id(), pocetak), &fajl, &mut napredak, r2::CEKANJE).map_err(|e| e.za_korisnika())
    })();
    match rezultat {
        Ok(()) => {
            let kraj = b.sat.iso();
            pisi(b, Stanje { zadnji_uspjeh: Some(kraj.clone()), zadnji_pokusaj: Some(pocetak_iso), ..Default::default() });
            javi(b, json!({ "gotovo": kraj }));
        }
        Err(poruka) => {
            let s = stanje(b);
            let greska_od = s.greska_od.clone().or_else(|| Some(pocetak_iso.clone()));
            let novo = Stanje { zadnji_pokusaj: Some(pocetak_iso), greska: Some(poruka.clone()), greska_od, ..s };
            pisi(b, novo.clone());
            eprintln!("Backup nije uspio: {poruka}");
            javi(b, json!({ "greska": poruka, "trajnaGreska": trajna_greska(&novo, b.sat.ms()) }));
        }
    }
}

/// `backup:sada`: pokreće backup ili čeka tekući; vraća `backup:info` s kraja
/// (isti odgovor za sve koji su čekali). Pozivalac drži petlju; dok se čeka
/// tekući backup, petlja je slobodna.
pub fn sada(b: &Backend) -> R<Value> {
    let postojeci = zakljucaj(&b.backup.tekuci).clone();
    if let Some(t) = postojeci {
        let _odmor = b.odmor();
        return Ok(t.cekaj());
    }
    let r2 = pristup(b).ok_or_else(|| Greska::nova(NEMA_BACKUPA))?;
    let t = Arc::new(Tekuci::default());
    *zakljucaj(&b.backup.tekuci) = Some(t.clone());

    /// Kraj backup-a i kad `izvrsi` pukne (bug): tekući se oslobodi, a svi koji
    /// čekaju dobiju info — niko ne visi, raspored ide dalje.
    struct Kraj<'a>(&'a Backend, Arc<Tekuci>);
    impl Drop for Kraj<'_> {
        fn drop(&mut self) {
            *zakljucaj(&self.0.backup.tekuci) = None;
            self.1.zavrsi(info(self.0));
        }
    }
    let kraj = Kraj(b, t.clone());
    izvrsi(b, &r2);
    drop(kraj);
    Ok(t.cekaj())
}

/// Raspored (`tick`): Tauri ljuska ga zove svake minute; backup kad je vrijeme.
pub fn tick(b: &Backend) {
    b.u_redu(|| {
        if zakljucaj(&b.backup.tekuci).is_some() || pristup(b).is_none() {
            return;
        }
        let t = b.sat.ms();
        if t >= sljedeci_backup(&stanje(b), t, b.backup.start) {
            let _ = sada(b);
        }
    });
}

/// Nova licenca s backup-om: prvi backup odmah, u pozadini — to je i provjera
/// R2 podataka (`backupNakonAktivacije`).
pub fn nakon_aktivacije(b: &Backend) {
    if info(b)["aktivan"] == true {
        b.u_pozadini(Box::new(|b: &Backend| {
            b.u_redu(|| {
                let _ = sada(b);
            })
        }));
    }
}

pub const KANALI: &[Kanal] = &[
    Kanal { ime: "backup:info", h: |b, _| Ok(info(b)) },
    Kanal { ime: "backup:sada", h: |b, _| sada(b) },
];
```

- [ ] **Step 4: Kanali i aktivacija licence**

`src-tauri/backend/src/kanali.rs`: u `use crate::{cash, izvoz, …}` dodaj `backup`; u `DOMENE` poslije `licenca::KANALI,` dodaj `backup::KANALI,` (redom kao u handlers.ts).

`src-tauri/backend/src/licenca.rs`, `KANALI`, kanal `licenca:aktiviraj` postaje:

```rust
    Kanal {
        ime: "licenca:aktiviraj",
        h: |b, a| {
            let info = if b.provjera_licence { aktiviraj_licencu(b, a[0].as_str().unwrap_or(""))? } else { otkljucana()? };
            // Nova licenca s backup-om: prvi backup odmah (handlers.ts: backupNakonAktivacije).
            crate::backup::nakon_aktivacije(b);
            Ok(info)
        },
    },
```

- [ ] **Step 5: ugovor-server i Tauri platforma**

`src-tauri/backend/src/bin/ugovor_server.rs`:

- importi: `use std::sync::{Arc, Mutex, OnceLock, Weak};` i `use pazar_backend::licenca::R2Podaci;`
- `struct TestPlatforma` dobija polje:

```rust
    /// Backend za poslove u pozadini — postavlja se čim je napravljen.
    backend: Arc<OnceLock<Weak<Backend>>>,
```

- u `impl Platforma for TestPlatforma`:

```rust
    fn dogadjaj(&self, ime: &str, podaci: Value) {
        posalji(&json!({ "dogadjaj": ime, "podaci": podaci }));
    }
    fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>) {
        let b = self.backend.get().and_then(Weak::upgrade);
        std::thread::spawn(move || {
            if let Some(b) = b {
                posao(&b);
            }
        });
    }
```

- u `main`: `let ja = Arc::new(OnceLock::new());`, `TestPlatforma { stanje: stanje.clone(), backend: ja.clone() }`, a poslije `Ok(b) => Arc::new(b)` bloka: `let _ = ja.set(Arc::downgrade(&b));`
- u petlji, poslije `r2IzTokena` bloka:

```rust
        if z["meta"] == "backupLicenca" {
            // Bez odgovora: obradi se prije sljedećeg zahtjeva (redom sa stdin-a).
            b.backup.postavi_testni_pristup(R2Podaci::iz_json(&z["r2"]));
            continue;
        }
```

- doc komentar na vrhu dopuni:

```rust
//! Događaji backenda (`backup:stanje`, `licenca:blokirano`) stižu kao
//! `{"dogadjaj":"backup:stanje","podaci":{…}}`. Meta `{"meta":"backupLicenca",
//! "r2":{…}|null}` (bez odgovora) postavi R2 podatke koje "licenca" daje backup-u.
```

`src-tauri/src/lib.rs`, `impl Platforma for TauriPlatforma`: obriši `licenca_blokirana` i dodaj

```rust
    fn dogadjaj(&self, ime: &str, podaci: Value) {
        let _ = self.app.emit(ime, podaci);
    }

    fn u_pozadini(&self, posao: Box<dyn FnOnce(&Backend) + Send>) {
        let app = self.app.clone();
        std::thread::spawn(move || {
            if let Some(b) = app.try_state::<Backend>() {
                posao(b.inner());
            }
        });
    }
```

`src/ipc/ugovor/rustBackend.ts`: prije `const backend: Backend = {` dodaj `let backupR2: import('../../lib/licenca').R2Podaci | null = null;` i funkciju

```ts
  /** R2 podaci "licence" (bez odgovora — server ih obradi prije sljedećeg zahtjeva). */
  function posaljiBackupLicencu() {
    proc.stdin.write(JSON.stringify({ meta: 'backupLicenca', r2: backupR2 }) + '\n');
    proc.stdin.flush();
  }
```

`postaviBackupLicencu` postaje

```ts
    postaviBackupLicencu(r2) {
      backupR2 = r2;
      posaljiBackupLicencu();
    },
```

a u `ponovoPokreni`, poslije `proc = await pokreni();`: `if (backupR2) posaljiBackupLicencu();` (TS harness zadržava licencu kroz ponovno pokretanje — isto i ovdje).

- [ ] **Step 6: Pokreni ugovor nad Rustom, mora proći**

Run: `cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server && KASA_BACKEND=rust bun test src/ipc/ugovor/backup.ugovor.test.ts src/ipc/ugovor/kanali.ugovor.test.ts src/ipc/ugovor/sesija.ugovor.test.ts`
Expected: PASS, 0 skip u `backup.ugovor.test.ts`.

Ako `dva backup:sada odjednom` ili `dok backup šalje, kasa radi` padnu: provjeri da čekanje tekućeg i šifrovanje/slanje idu uz `b.odmor()` i da `tekuci` postavlja/čita samo onaj ko drži petlju.

- [ ] **Step 7: Sve provjere**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -p pazar-backend`
Expected: PASS.

Run: `cargo check --manifest-path src-tauri/Cargo.toml -p pazar`
Expected: Tauri ljuska kompajlira (nova `Platforma`).

Run: `bun run test:rust`
Expected: PASS, 0 fail (baseline 723 + novi backup testovi).

Run: `bun test`
Expected: PASS, 0 fail (baseline 1609 + novi).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/backend/src src-tauri/src/lib.rs src/ipc/ugovor
git commit -m "feat(backup): backup:info/backup:sada u Rust backendu, ugovor nad oba backenda"
```

---

### Task 6: Tauri ljuska — raspored, CI ključ, dokumentacija, provjera u pravoj aplikaciji

**Files:**
- Modify: `src-tauri/src/lib.rs` (raspored u `setup`)
- Modify: `src-tauri/src/smoke.js` (provjera `backup:info`)
- Modify: `src-tauri/capabilities/default.json` (opis)
- Modify: `.github/workflows/build-windows-tauri.yml`, `.github/workflows/build-windows.yml`
- Modify: `src-tauri/README.md`, `docs/superpowers/specs/2026-09-25-r2-backup-design.md`

**Interfaces:**
- Consumes: `pazar_backend::backup::tick(&Backend)` (Task 5).

- [ ] **Step 1: Raspored svake minute**

`src-tauri/src/lib.rs`: import `use pazar_backend::{backup, cuvanje};` (umjesto `use pazar_backend::cuvanje;`), i funkcija (npr. iza `user_data`):

```rust
/// Automatski backup (`pokreniRaspored` u Electronu): provjera svake minute —
/// preživi spavanje računara i sama primijeti novu licencu (±1 min).
fn pokreni_raspored_backupa(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        let Some(b) = app.try_state::<Backend>() else { continue };
        // Bug u jednom pokušaju ne smije ugasiti raspored.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| backup::tick(b.inner())));
    });
}
```

U `setup`, u `Ok(b) => { app.manage(b); }` grani poslije `app.manage(b);`: `pokreni_raspored_backupa(handle.clone());`

- [ ] **Step 2: Smoke provjera**

`src-tauri/src/smoke.js`, poslije provjere `licenca:stanje` (prijavljeni admin, licence nema):

```js
    const backup = await window.api.getBackupInfo();
    ok('backup:info bez licence', backup?.aktivan === false && backup?.uToku === false, JSON.stringify(backup));
```

`src-tauri/capabilities/default.json`, `description`: `događaj licenca:blokirano` → `događaji licenca:blokirano i backup:stanje`.

- [ ] **Step 3: Build i smoke**

Run: `bunx tauri build --debug --no-bundle && PAZAR_SMOKE=1 PAZAR_USER_DATA=$(mktemp -d) src-tauri/target/debug/pazar`
Expected: JSON sa svim provjerama `ok: true` (uključujući `događaj licenca:blokirano` — sada ide kroz `Platforma::dogadjaj` — i `backup:info bez licence`), izlaz 0.

- [ ] **Step 4: Prava aplikacija s licencom → lažni S3 (raspored + licenca + slanje)**

Kopija stvarnog userData (original se ne dira i ne otvara `sqlite3` CLI-jem):

```bash
K=$(mktemp -d); cp ~/Library/Application\ Support/Pazar/kasa.db* "$K"/ ; cp ~/Library/Application\ Support/Pazar/licenca.json "$K"/
cat > "$K/s3.ts" <<'EOF'
import { pokreniLaziS3 } from '/Users/tarik/Documents/development/kasa-app/src/ipc/ugovor/laziS3';
const s3 = pokreniLaziS3();
console.log(s3.url);
setInterval(() => console.log(JSON.stringify(s3.zahtjevi.map(z => ({ bucket: z.bucket, kljuc: z.kljuc, duzina: z.duzina, bajtova: z.tijelo.length })))), 10_000);
EOF
bun "$K/s3.ts"   # u pozadini; zapamti URL
PAZAR_USER_DATA="$K" PAZAR_BACKUP_ENDPOINT=<URL> src-tauri/target/debug/pazar   # u pozadini
```

Sačekaj ~70 s (prvi backup ide minut nakon starta).
Expected: lažni S3 ispiše jedan PUT s `bucket` iz licence, `kljuc` oblika `XXXX-XXXX-XXXX/…Z.db.age`, `duzina === bajtova`; `"$K/backup-stanje.json"` ima `zadnjiUspjeh`. Ako licenca nema backup, zabilježi to (prolaz je tada: nema PUT-a, `backup-stanje.json` ne nastaje) i reci kontroleru. Ugasi aplikaciju i server, obriši `$K`.

- [ ] **Step 5: CI — ključ iz tajne**

U `.github/workflows/build-windows-tauri.yml` prije koraka `Contract tests over Rust backend`, i u `.github/workflows/build-windows.yml` prije `Make Windows installer`:

```yaml
      # Ključ za R2 podatke u licenci (src/lib/backupKljuc.ts) nije u javnom
      # repou; Electron ga uvozi, Rust ga ugrađuje (include_str!). Bez tajne
      # build pada — ne smije izaći verzija u kojoj backup tiho ne radi.
      - name: Backup key
        shell: bash
        env:
          PAZAR_BACKUP_KLJUC_HEX: ${{ secrets.PAZAR_BACKUP_KLJUC_HEX }}
        run: |
          if [[ ! "$PAZAR_BACKUP_KLJUC_HEX" =~ ^[0-9a-f]{64}$ ]]; then
            echo "Nedostaje tajna PAZAR_BACKUP_KLJUC_HEX (64 hex znaka)"; exit 1
          fi
          printf "export const BACKUP_KLJUC_HEX = '%s';\n" "$PAZAR_BACKUP_KLJUC_HEX" > src/lib/backupKljuc.ts
```

Tajnu `PAZAR_BACKUP_KLJUC_HEX` u GitHub postavkama repoa dodaje vlasnik (vrijednost iz njegovog `src/lib/backupKljuc.ts`) — ne dirati, samo navesti u izvještaju.

- [ ] **Step 6: Dokumentacija**

`src-tauri/README.md`, nova sekcija prije „Razlike u odnosu na Electron“:

```markdown
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
```

`docs/superpowers/specs/2026-09-25-r2-backup-design.md`: u „Stanje implementacije“ dodaj pasus

```markdown
**Urađeno u Tauri verziji (2026-09-27)** — plan `docs/superpowers/plans/2026-09-27-r2-backup-tauri.md`:
`src-tauri/backend/src/r2.rs`, `backup.rs`, `licenca.rs` (`backup_podaci`, `backup_pristup`); ugovor
`backup.ugovor.test.ts` prolazi nad oba backenda (i interop TS token → Rust, Rust age → JS). Kopija baze
ide pod petljom na aktivnoj konekciji (kao sinhroni better-sqlite3), ne na posebnoj konekciji.
```

a stavku 1 u „Ostaje“ zamijeni s: `1. Ručno: „Backup sada“ u pravoj Tauri aplikaciji prema stvarnom R2 (vlasnik), pa \`bun run backup lista <bucket>\`.`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/smoke.js src-tauri/capabilities/default.json .github/workflows src-tauri/README.md docs/superpowers/specs/2026-09-25-r2-backup-design.md
git commit -m "feat(backup): raspored u Tauri ljusci, CI ključ iz tajne, dokumentacija"
```

---

## Ručne provjere za vlasnika (poslije spajanja)

1. GitHub → Settings → Secrets → `PAZAR_BACKUP_KLJUC_HEX` (vrijednost iz `src/lib/backupKljuc.ts`), inače oba Windows builda padaju na koraku „Backup key“.
2. Tauri aplikacija s licencom koja ima backup: Postavke › Sistem › „Backup sada“ → „Backup spremljen.“; traka na vrhu prolazi kopija → šifrovanje → slanje; `bun run backup lista <bucket>` pokazuje novi objekat; `bun run backup preuzmi <bucket>` vraća bazu koja prolazi „Uvoz backup-a“.
