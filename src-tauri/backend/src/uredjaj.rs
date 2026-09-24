//! Kanali `tring:*`, `dialog:saveFile`, `fs:writeFile`, `db:backup` i
//! `db:restore` (handlers.ts) i uvoz backup-a iz `database/restore.ts`.

use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Map, Value};

use crate::greska::{Greska, R};
use crate::js;
use crate::sql::Db;
use crate::tring::Odgovor;
use crate::{baci, fiskalni, p, tring_racun, Args, Backend};

// ─── Tring ──────────────────────────────────────────────

/// `loadTringConfig()` — aktivna baza se otvori ako je zatvorena (getDb).
fn load_tring_config(b: &Backend) -> R<(Value, Value)> {
    b.db()?;
    b.load_tring_config()
}

/// `if (Tring.isLoggingEnabled()) console.log(...)`. Ide na stderr: stdout
/// ugovor-servera je kanal odgovora.
fn loguj(b: &Backend, sta: &str, v: &Value) {
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] {sta}: {}", js::stringify(v));
    }
}

fn init(b: &Backend) -> R<Odgovor> {
    let (operator_id, operator_password) = load_tring_config(b)?;
    // `parseInt` koji ne uspije je NaN, a `${NaN}` u XML-u je "NaN".
    let operator_id = if operator_id.is_null() { json!("NaN") } else { operator_id };
    let result = b.tring.inicijalizacija(&operator_id, &operator_password);
    loguj(b, "init", &result);
    Ok(result)
}

fn print_receipt(b: &Backend, data: &Value) -> R<Odgovor> {
    load_tring_config(b)?;
    let racun = tring_racun::build_tring_racun(data);
    loguj(b, "printReceipt request", &racun);
    let result = b.tring.stampati_fiskalni_racun(&racun);
    loguj(b, "printReceipt response", &result);
    Ok(result)
}

fn print_refund(b: &Backend, data: &Value) -> R<Odgovor> {
    load_tring_config(b)?;
    let Some(broj_racuna) = fiskalni::parse_fiskalni_broj(&data["brojRacuna"]) else {
        let prikaz = js::to_string(js::nn(&data["brojRacuna"], &json!("")));
        baci!("Fiskalni broj \"{prikaz}\" nije ispravan broj računa");
    };
    let racun = tring_racun::build_tring_reklamacija(data, broj_racuna);
    loguj(b, "printRefund request", &racun);
    let result = b.tring.stampati_reklamirani_racun(&racun);
    loguj(b, "printRefund response", &result);
    Ok(result)
}

fn x_report(b: &Backend) -> R<Odgovor> {
    load_tring_config(b)?;
    let result = b.tring.stampati_presjek_stanja();
    loguj(b, "xReport", &result);
    Ok(result)
}

fn z_report(b: &Backend) -> R<Odgovor> {
    load_tring_config(b)?;
    let result = b.tring.stampati_dnevni_izvjestaj();
    loguj(b, "zReport", &result);
    Ok(result)
}

fn periodic_report(b: &Backend, from: &Value, to: &Value) -> R<Odgovor> {
    load_tring_config(b)?;
    let result = b.tring.stampati_periodicni_izvjestaj(from, to);
    loguj(b, "periodicReport", &result);
    Ok(result)
}

fn write_article(b: &Backend, data: &Value) -> R<Odgovor> {
    load_tring_config(b)?;
    let result = b.tring.upisi_artikal(data);
    loguj(b, "writeArticle", &result);
    Ok(result)
}

// ─── Dialog / File System ─────────────────────────────────

/// Objekat bez ključeva čija je vrijednost `undefined` (kao što ih Electron vidi).
fn opcije(parovi: &[(&str, &Value)]) -> Value {
    let mut m = Map::new();
    for (k, v) in parovi {
        if !v.is_null() {
            m.insert(k.to_string(), (*v).clone());
        }
    }
    Value::Object(m)
}

fn save_file(b: &Backend, data: &Value) -> R<Value> {
    let izbor = b.dijalog_sacuvaj(opcije(&[("defaultPath", &data["defaultName"]), ("filters", &data["filters"])]));
    // Otkazan dijalog poništava i ranije odobrenje — upisiva je samo putanja
    // iz zadnjeg dijaloga.
    let mut odobrena = b.odobrena_putanja.lock().unwrap_or_else(|e| e.into_inner());
    *odobrena = None;
    match izbor.filter(|p| !p.is_empty()) {
        Some(p) => {
            *odobrena = Some(p.clone());
            Ok(Value::String(p))
        }
        None => Ok(Value::Null),
    }
}

/// `Buffer.from(number[])` — svaki element ide kroz ToUint8 (NaN → 0, modulo 256).
fn u_bajt(v: &Value) -> u8 {
    let x = js::to_number(v);
    if !x.is_finite() {
        return 0;
    }
    (x.trunc() % 256.0 + 256.0) as u64 as u8
}

fn write_file(b: &Backend, data: &Value) -> R<Value> {
    let mut odobrena = b.odobrena_putanja.lock().unwrap_or_else(|e| e.into_inner());
    let putanja = match (data["path"].as_str(), odobrena.as_deref()) {
        (Some(p), Some(o)) if p == o => p.to_string(),
        _ => baci!("Write path not approved by save dialog"),
    };
    *odobrena = None;
    drop(odobrena);
    let bajtovi: Vec<u8> = data["buffer"].as_array().map(|a| a.iter().map(u_bajt).collect()).unwrap_or_default();
    std::fs::write(&putanja, bajtovi)?;
    Ok(json!({ "success": true }))
}

// ─── Database Backup ───────────────────────────────────────

fn backup(b: &Backend) -> R<Value> {
    let db_path = b.db_putanja();
    let timestamp = b.sat.danas();
    let izbor = b.dijalog_sacuvaj(json!({
        "defaultPath": format!("kasa-backup-{timestamp}.db"),
        "filters": [{ "name": "SQLite Database", "extensions": ["db"] }],
    }));
    let Some(cilj) = izbor.filter(|p| !p.is_empty()) else {
        return Ok(Value::Null);
    };

    // Samostalan fajl (DELETE journal mode): gola kopija WAL baze se ne
    // otvara read-only, pa je ni db:restore ne bi mogao provjeriti.
    samostalna_kopija(b, &db_path, Path::new(&cilj))?;
    Ok(Value::String(cilj))
}

// Uvoz backup-a. Handler radi samo dijaloge; sam rad s fajlovima je niže
// (`database/restore.ts`). Otvaranje baze nakon zamjene odradi schemu +
// migracije, pa backup iz starije verzije programa radi bez dodatnih koraka.
fn restore(b: &Backend) -> R<Value> {
    let db_path = b.db_putanja();

    let picked = b.dijalog_otvori(json!({
        "title": "Odaberi backup baze",
        "properties": ["openFile"],
        "filters": [{ "name": "SQLite Database", "extensions": ["db"] }],
    }));
    let Some(source) = picked.filter(|p| !p.is_empty()) else {
        return Ok(Value::Null);
    };

    // Provjera prije potvrde — nema smisla plašiti korisnika upozorenjem ako
    // odabrani fajl ionako nije upotrebljiv backup.
    validate_backup(Path::new(&source))?;

    let confirm = b.dijalog_potvrda(json!({
        "type": "warning",
        "buttons": ["Otkaži", "Uvezi i restartuj"],
        "defaultId": 0,
        "cancelId": 0,
        "title": "Uvoz backup-a",
        "message": "Zamijeniti trenutnu bazu podataka?",
        "detail": "Svi trenutni podaci (računi, artikli, primke, korisnici) bit će zamijenjeni \
                   podacima iz backup-a. Kopija trenutne baze se sprema automatski. \
                   Program će se restartovati nakon uvoza.",
    }));
    if confirm != 1 {
        return Ok(Value::Null);
    }

    let stamp: String = b.sat.iso().replace([':', '.'], "-").chars().take(19).collect();
    let safety_path = b.user_data().join(format!("kasa-prije-uvoza-{stamp}.db"));
    swap_in_backup(b, Path::new(&source), &db_path, &safety_path)?;

    // Renderer drži stanje stare baze (prijavljeni korisnik, korpa) — restart je
    // jedini pouzdan način da se sve osvježi.
    b.restartuj_za(500);

    Ok(json!({ "source": source, "safetyPath": safety_path.to_string_lossy() }))
}

// ─── database/restore.ts ───────────────────────────────────

const REQUIRED_TABLES: [&str; 3] = ["users", "products", "orders"];

/// `mkdtempSync(path.join(tmpdir(), 'kasa-uvoz-'))`; folder se briše kad
/// vrijednost ode iz opsega (`finally { rmSync(tmp, …) }`).
struct Privremeni(PathBuf);

impl Privremeni {
    fn novi() -> R<Privremeni> {
        static BROJAC: AtomicU64 = AtomicU64::new(0);
        loop {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos())
                .unwrap_or(0);
            let n = BROJAC.fetch_add(1, Ordering::Relaxed);
            let p = std::env::temp_dir().join(format!("kasa-uvoz-{}-{nanos:x}-{n}", std::process::id()));
            match std::fs::create_dir(&p) {
                Ok(()) => return Ok(Privremeni(p)),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
    }
}

impl Drop for Privremeni {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// `${putanja}-wal` i sl.
fn sa_sufiksom(p: &Path, sufiks: &str) -> PathBuf {
    let mut s = OsString::from(p.as_os_str());
    s.push(sufiks);
    PathBuf::from(s)
}

/// `rmSync(p, { force: true })` za fajl.
fn obrisi(p: &Path) -> R<()> {
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// `path.resolve` — apsolutna, normalizovana putanja (bez razrješavanja linkova).
fn resolve(p: &Path) -> PathBuf {
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };
    let mut out = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Provjerava da je fajl ispravna SQLite baza ovog programa.
/// Baca grešku s objašnjenjem; ne dira ništa na disku.
fn validate_backup(file_path: &Path) -> R<()> {
    let tmp = Privremeni::novi()?;
    priprema_kopije(file_path, &tmp.0)?;
    Ok(())
}

/// Kopira backup (i njegov -wal, ako postoji) u `folder`, prebaci kopiju u
/// DELETE journal mode i provjeri je. Vraća putanju provjerene kopije.
///
/// Kopija baze u WAL modu bez -shm ne može se pouzdano otvoriti read-only
/// (SQLITE_CANTOPEN, ili "attempt to write a readonly database" kad je folder
/// read-only), a read-write otvaranje originala bi pored njega ostavilo
/// -wal/-shm. Zato se radi nad kopijom.
fn priprema_kopije(file_path: &Path, folder: &Path) -> R<PathBuf> {
    let kopija = folder.join("backup.db");
    let provjera = || -> R<()> {
        if !file_path.exists() {
            baci!("Fajl ne postoji.");
        }
        std::fs::copy(file_path, &kopija)?;
        let wal = sa_sufiksom(file_path, "-wal");
        if wal.exists() {
            std::fs::copy(&wal, sa_sufiksom(&kopija, "-wal"))?;
        }
        // Konekcija se zatvara kad `db` ode iz opsega (`finally { db?.close() }`).
        let db = Db::otvori_postojecu(&kopija)?;
        u_delete_mode(&db)?;
        let integrity = db.get("PRAGMA integrity_check", p![])?;
        if integrity.as_ref().map(|r| &r["integrity_check"]) != Some(&json!("ok")) {
            baci!("Baza je oštećena.");
        }
        let rows = db.all("SELECT name FROM sqlite_master WHERE type = 'table'", p![])?;
        let names: Vec<&str> = rows.iter().filter_map(|r| r["name"].as_str()).collect();
        let missing: Vec<&str> = REQUIRED_TABLES.iter().copied().filter(|t| !names.contains(t)).collect();
        if !missing.is_empty() {
            baci!("Fajl nije backup Kasa baze (nedostaje: {}).", missing.join(", "));
        }
        Ok(())
    };
    provjera().map_err(|e| Greska(format!("Neispravan backup fajl: {}", e.0)))?;
    Ok(kopija)
}

/// Upiše sve iz -wal u glavni fajl i prebaci bazu u DELETE journal mode.
fn u_delete_mode(db: &Db) -> R<()> {
    let r = db.get("PRAGMA journal_mode = DELETE", p![])?;
    let mode = r.as_ref().map(|r| r["journal_mode"].clone()).unwrap_or(Value::Null);
    if mode != "delete" {
        let prikaz = if mode.is_null() { "nepoznatog".to_string() } else { js::to_string(&mode) };
        baci!("Baza se ne može prebaciti iz {prikaz} journal moda.");
    }
    Ok(())
}

/// Kopija aktivne baze kao jedan samostalan fajl (DELETE journal mode), koji
/// SQLite otvara bilo kako, i read-only, bez -wal/-shm pored njega.
fn samostalna_kopija(b: &Backend, db_path: &Path, cilj: &Path) -> R<()> {
    b.db()?.pragma("wal_checkpoint(TRUNCATE)")?;
    // Ostaci ranijeg fajla na istoj putanji bi se primijenili na novu kopiju.
    obrisi(&sa_sufiksom(cilj, "-wal"))?;
    obrisi(&sa_sufiksom(cilj, "-shm"))?;
    std::fs::copy(db_path, cilj)?;
    {
        let db = Db::otvori_postojecu(cilj)?;
        u_delete_mode(&db)?;
    }
    // Neki SQLite buildovi (npr. sistemski na macOS-u) ostave prazan -shm i
    // nakon prelaska u DELETE mode; baza ga više ne koristi.
    obrisi(&sa_sufiksom(cilj, "-shm"))?;
    Ok(())
}

/// Zamjenjuje aktivnu bazu backup fajlom. Prije zamjene sprema kopiju zatečene
/// baze na `safety_path`; ako zamjena ili migracije puknu, vraća to stanje i
/// baca grešku, tako da program ostaje upotrebljiv.
fn swap_in_backup(b: &Backend, source_path: &Path, db_path: &Path, safety_path: &Path) -> R<()> {
    if resolve(source_path) == resolve(db_path) {
        baci!("Odabrana je trenutno aktivna baza, ne backup fajl.");
    }

    let tmp = Privremeni::novi()?;
    // Uvozi se provjerena kopija: transakcije iz -wal uz backup su već
    // upisane u nju, pa se prenosi samo jedan fajl.
    let kopija = priprema_kopije(source_path, &tmp.0)?;

    samostalna_kopija(b, db_path, safety_path)?;
    b.zatvori_db();

    let zamjena = replace_db_file(&kopija, db_path).and_then(|_| {
        // Otvaranje pokreće schemu + migracije, pa se backup iz starije verzije
        // programa podiže na aktuelnu strukturu.
        b.otvori_db()
    });
    if let Err(error) = zamjena {
        b.zatvori_db();
        replace_db_file(safety_path, db_path)?;
        b.otvori_db()?;
        baci!("Uvoz nije uspio, vraćena je prethodna baza: {}", error.0);
    }
    Ok(())
}

fn replace_db_file(source_path: &Path, db_path: &Path) -> R<()> {
    // WAL/SHM prethodne baze moraju otići, inače se miješaju s novim fajlom.
    obrisi(&sa_sufiksom(db_path, "-wal"))?;
    obrisi(&sa_sufiksom(db_path, "-shm"))?;
    // Stari fajl se briše prije kopiranja, pa nova baza dobije novi inode:
    // konekcija drugog procesa koja je još otvorena nad starom bazom (u WAL
    // modu drži SHARED lock na fajlu) inače bi blokirala prelazak nove baze u
    // WAL ("database is locked"). U Electronu su sve konekcije bile u istom
    // procesu, pa se POSIX lockovi nisu sudarali.
    obrisi(db_path)?;
    std::fs::copy(source_path, db_path)?;
    Ok(())
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    Some(match kanal {
        "tring:init" => init(b),
        "tring:printReceipt" => print_receipt(b, &a[0]),
        "tring:printRefund" => print_refund(b, &a[0]),
        "tring:xReport" => x_report(b),
        "tring:zReport" => z_report(b),
        "tring:periodicReport" => periodic_report(b, &a[0], &a[1]),
        "tring:writeArticle" => write_article(b, &a[0]),
        "tring:getLogs" => Ok(b.tring.get_logs()),
        "tring:clearLogs" => {
            b.tring.clear_logs();
            Ok(json!({ "success": true }))
        }
        "dialog:saveFile" => save_file(b, &a[0]),
        "fs:writeFile" => write_file(b, &a[0]),
        "db:backup" => backup(b),
        "db:restore" => restore(b),
        _ => return None,
    })
}
