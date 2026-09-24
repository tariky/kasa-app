//! Pazar backend: sve što je u Electronu radio main proces (`src/ipc/handlers.ts`
//! i `src/lib/*` koje on koristi), prepisano u Rust.
//!
//! Ulaz je jedan: [`Backend::call`] — kanal i argumenti kao JSON, isto kao
//! `ipcRenderer.invoke(kanal, ...args)`. Tauri aplikacija ga zove iz komande
//! `api`, a ugovorni testovi (`src/ipc/ugovor`, `KASA_BACKEND=rust`) preko
//! `ugovor-server` binarija. Sve što zavisi od okruženja (dijalozi, restart,
//! obavijest o licenci) ide kroz [`Platforma`].

pub mod greska;
pub mod js;
pub mod sql;
pub mod baza;
pub mod sat;
pub mod tring;
pub mod tring_racun;
pub mod fiskalni;
pub mod racun;
pub mod licenca;
pub mod kanali;

// Domene (po grupama kanala)
pub mod korisnici;
pub mod postavke;
pub mod katalog;
pub mod skladiste;
pub mod racuni;
pub mod cash;
pub mod ponude;
pub mod proizvodnja;
pub mod uredjaj;

use std::ops::Index;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub use greska::{Greska, R};
use sat::Sat;
use sql::Db;
use tring::Tring;

/// Okruženje u kojem backend radi: Tauri prozor ili test harness.
pub trait Platforma: Send {
    /// Dijalog za spremanje (`dialog.showSaveDialog`); opcije u Electron obliku
    /// (`defaultPath`, `filters`). `None` = korisnik otkazao.
    fn dijalog_sacuvaj(&self, opcije: Value) -> Option<String>;
    /// Dijalog za otvaranje fajla (`title`, `properties`, `filters`).
    fn dijalog_otvori(&self, opcije: Value) -> Option<String>;
    /// Poruka s dugmadima (`type`, `buttons`, `defaultId`, `cancelId`, `title`,
    /// `message`, `detail`); vraća indeks pritisnutog dugmeta.
    fn dijalog_potvrda(&self, opcije: Value) -> i64;
    /// Zatvori program i pokreni ga ponovo nakon `ms` milisekundi (renderer
    /// za to vrijeme dobije odgovor).
    fn restartuj_za(&self, ms: u64);
    /// Licenca je blokirala kanal — renderer prikazuje dijalog (`licenca:blokirano`).
    fn licenca_blokirana(&self) {}
}

/// Argumenti poziva; nepostojeći argument je `null` (JS `undefined`).
pub struct Args(pub Vec<Value>);

impl Index<usize> for Args {
    type Output = Value;
    fn index(&self, i: usize) -> &Value {
        self.0.get(i).unwrap_or(&js::NULL)
    }
}

pub struct Backend {
    db: Option<Db>,
    user_data: PathBuf,
    pub sat: Sat,
    pub tring: Tring,
    pub platforma: Box<dyn Platforma>,
    /// `false` u ugovornim testovima: licenca je otključana (ima svoje testove).
    pub provjera_licence: bool,
    /// Jedina putanja koju `fs:writeFile` smije upisati — iz zadnjeg dijaloga.
    pub odobrena_putanja: Option<String>,
}

impl Backend {
    pub fn novi(user_data: &Path, platforma: Box<dyn Platforma>, sat: Sat, provjera_licence: bool) -> R<Backend> {
        std::fs::create_dir_all(user_data)?;
        let mut b = Backend {
            db: None,
            user_data: user_data.to_path_buf(),
            tring: Tring::novi(sat.clone()),
            sat,
            platforma,
            provjera_licence,
            odobrena_putanja: None,
        };
        b.otvori_db()?;
        Ok(b)
    }

    pub fn user_data(&self) -> &Path {
        &self.user_data
    }

    pub fn db_putanja(&self) -> PathBuf {
        self.user_data.join("kasa.db")
    }

    /// Aktivna baza (`getDb()`), otvara je ako je zatvorena.
    pub fn db(&mut self) -> R<&Db> {
        if self.db.is_none() {
            self.otvori_db()?;
        }
        Ok(self.db.as_ref().unwrap())
    }

    /// Aktivna baza bez ponovnog otvaranja — za kod koji drži `&self`.
    pub fn baza(&self) -> R<&Db> {
        self.db.as_ref().ok_or_else(|| Greska::nova("Baza nije otvorena"))
    }

    pub fn otvori_db(&mut self) -> R<()> {
        if self.db.is_none() {
            self.db = Some(baza::otvori(&self.db_putanja())?);
        }
        Ok(())
    }

    pub fn zatvori_db(&mut self) {
        self.db = None;
    }

    /// Poziv kanala kao iz renderera. Greška je poruka za `new Error(...)`.
    pub fn call(&mut self, kanal: &str, args: Vec<Value>) -> Result<Value, String> {
        let a = Args(args);
        let r = licenca::provjeri_kanal(self, kanal).and_then(|_| kanali::obradi(self, kanal, &a));
        r.map_err(|g| {
            eprintln!("[IPC {kanal}] {}", g.0);
            if g.0.is_empty() { "Nepoznata greška".to_string() } else { g.0 }
        })
    }

    /// Tring postavke iz baze → klijent (`loadTringConfig`). Vraća operatora i lozinku.
    pub fn load_tring_config(&self) -> R<(Value, Value)> {
        let db = self.baza()?;
        let rows = db.all("SELECT key, value FROM settings WHERE key LIKE 'tring.%'", p![])?;
        let mut map = serde_json::Map::new();
        for r in rows {
            let k = r["key"].as_str().unwrap_or("").replacen("tring.", "", 1);
            map.insert(k, r["value"].clone());
        }
        let g = |k: &str, zadano: &str| -> Value {
            match map.get(k) {
                Some(v) if !v.is_null() => v.clone(),
                _ => Value::String(zadano.into()),
            }
        };
        let host = js::to_string(&g("host", "localhost"));
        let port = js::parse_int(&js::to_string(&g("port", "8085")));
        self.tring.configure(&host, port);

        let dev = db.val("SELECT value FROM settings WHERE key = 'dev.logging'", p![])?;
        self.tring.set_logging_enabled(dev == "true");

        Ok((js::parse_int_value(&g("operatorId", "0")), g("operatorPassword", "0")))
    }
}
