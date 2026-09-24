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
pub mod petlja;

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
use std::sync::{Arc, Mutex};

use serde_json::Value;

pub use greska::{Greska, R};
use petlja::Petlja;
use sat::Sat;
use sql::Db;
use tring::Tring;

/// Okruženje u kojem backend radi: Tauri prozor ili test harness.
pub trait Platforma: Send + Sync {
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

/// Backend je `Sync`: pozivi stižu s više niti, a [`Petlja`] ih pušta
/// jedan po jedan (osim dok neki čeka uređaj ili dijalog).
pub struct Backend {
    db: Db,
    user_data: PathBuf,
    pub sat: Sat,
    pub tring: Tring,
    platforma: Box<dyn Platforma>,
    petlja: Arc<Petlja>,
    /// `false` u ugovornim testovima: licenca je otključana (ima svoje testove).
    pub provjera_licence: bool,
    /// Jedina putanja koju `fs:writeFile` smije upisati — iz zadnjeg dijaloga.
    pub odobrena_putanja: Mutex<Option<String>>,
}

impl Backend {
    pub fn novi(user_data: &Path, platforma: Box<dyn Platforma>, sat: Sat, provjera_licence: bool) -> R<Backend> {
        std::fs::create_dir_all(user_data)?;
        let petlja = Arc::new(Petlja::nova());
        Ok(Backend {
            db: baza::otvori(&user_data.join("kasa.db"), petlja.clone())?,
            user_data: user_data.to_path_buf(),
            tring: Tring::novi(sat.clone(), petlja.clone()),
            sat,
            platforma,
            petlja,
            provjera_licence,
            odobrena_putanja: Mutex::new(None),
        })
    }

    pub fn user_data(&self) -> &Path {
        &self.user_data
    }

    pub fn db_putanja(&self) -> PathBuf {
        self.db.putanja().to_path_buf()
    }

    /// Aktivna baza (`getDb()`); zatvorena se otvori pri prvom upitu.
    pub fn db(&self) -> R<&Db> {
        Ok(&self.db)
    }

    /// Isto što i [`Backend::db`] (ostalo iz vremena kad je `db()` tražio `&mut`).
    pub fn baza(&self) -> R<&Db> {
        Ok(&self.db)
    }

    /// Otvori aktivnu bazu odmah, s greškom ako schema/migracije puknu.
    pub fn otvori_db(&self) -> R<()> {
        self.db.otvori()
    }

    pub fn zatvori_db(&self) {
        self.db.zatvori();
    }

    /// Zatvori bazu kad dođe red (restart, izlaz iz programa) — nikad usred
    /// tuđeg poziva ili transakcije, kao `closeDb()` na JS niti.
    pub fn zatvori_db_u_redu(&self) {
        let _z = self.petlja.uzmi(self.tiket());
        self.db.zatvori();
    }

    /// Sistemski dijalozi; dok su otvoreni, drugi pozivi rade (kao `await dialog...`).
    pub fn dijalog_sacuvaj(&self, opcije: Value) -> Option<String> {
        let _o = self.petlja.odmor();
        self.platforma.dijalog_sacuvaj(opcije)
    }

    pub fn dijalog_otvori(&self, opcije: Value) -> Option<String> {
        let _o = self.petlja.odmor();
        self.platforma.dijalog_otvori(opcije)
    }

    pub fn dijalog_potvrda(&self, opcije: Value) -> i64 {
        let _o = self.petlja.odmor();
        self.platforma.dijalog_potvrda(opcije)
    }

    pub fn restartuj_za(&self, ms: u64) {
        self.platforma.restartuj_za(ms);
    }

    pub fn licenca_blokirana(&self) {
        self.platforma.licenca_blokirana();
    }

    /// Mjesto u redu poziva; uzmi ga čim poziv stigne, da redoslijed ostane
    /// redoslijed dolaska i kad se izvršava na drugoj niti.
    pub fn tiket(&self) -> petlja::Tiket {
        self.petlja.tiket()
    }

    /// Poziv kanala kao iz renderera. Greška je poruka za `new Error(...)`.
    pub fn call(&self, kanal: &str, args: Vec<Value>) -> Result<Value, String> {
        self.call_u_redu(self.tiket(), kanal, args)
    }

    pub fn call_u_redu(&self, tiket: petlja::Tiket, kanal: &str, args: Vec<Value>) -> Result<Value, String> {
        let _z = self.petlja.uzmi(tiket);
        let a = Args(args);
        // Panika (bug) u jednom pozivu je greška tog poziva, kao izuzetak u
        // Electron handleru — program i ostali pozivi rade dalje.
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            licenca::provjeri_kanal(self, kanal).and_then(|_| kanali::obradi(self, kanal, &a))
        }))
        .unwrap_or_else(|p| {
            let poruka = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned());
            Err(Greska(format!("Interna greška: {}", poruka.unwrap_or_else(|| "nepoznata".into()))))
        });
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
