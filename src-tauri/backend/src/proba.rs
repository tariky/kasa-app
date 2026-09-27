//! Pomoćni kod za testove backenda: privremena baza, backend nad njom s
//! lažnim fiskalnim uređajem i platforma bez dijaloga. Folderi se brišu na
//! kraju testa.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::ops::Deref;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use crate::petlja::Petlja;
use crate::sat::Sat;
use crate::sql::Db;
use crate::{Backend, Platforma};

/// Prazan privremeni folder `kasa-<ime>-test-<pid>-<n>`.
fn privremeni_folder(ime: &str) -> PathBuf {
    static BROJ: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("kasa-{ime}-test-{}-{}", std::process::id(), BROJ.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Platforma bez dijaloga: čuvanje i otvaranje su otkazani, potvrda je prvo dugme.
pub struct BezDijaloga;

impl Platforma for BezDijaloga {
    fn dijalog_sacuvaj(&self, _: Value) -> Option<String> {
        None
    }
    fn dijalog_otvori(&self, _: Value) -> Option<String> {
        None
    }
    fn dijalog_potvrda(&self, _: Value) -> i64 {
        0
    }
    fn restartuj_za(&self, _: u64) {}
    fn u_pozadini(&self, _: Box<dyn FnOnce(&Backend) + Send>) {}
}

/// Aktivna baza (schema, migracije, seed) u privremenom folderu.
pub struct Baza {
    db: Option<Db>,
    dir: PathBuf,
}

pub fn baza(ime: &str) -> Baza {
    let dir = privremeni_folder(ime);
    let db = Db::aktivna(&dir.join("kasa.db"), Arc::new(Petlja::nova())).unwrap();
    Baza { db: Some(db), dir }
}

impl Deref for Baza {
    type Target = Db;
    fn deref(&self) -> &Db {
        self.db.as_ref().unwrap()
    }
}

impl Drop for Baza {
    fn drop(&mut self) {
        drop(self.db.take());
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Lažni fiskalni uređaj: svaki zahtjev dobije OK s BF brojem od 101 naviše.
/// Vraća port i brojač primljenih zahtjeva.
fn lazi_tring() -> (u16, Arc<AtomicUsize>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = server.local_addr().unwrap().port();
    let zahtjevi = Arc::new(AtomicUsize::new(0));
    let brojac = zahtjevi.clone();
    std::thread::spawn(move || {
        let mut bf = 100;
        for veza in server.incoming() {
            let Ok(mut veza) = veza else { continue };
            // Zaglavlja pa tijelo (Content-Length) — odgovor tek kad stigne cijeli zahtjev.
            let mut procitano = Vec::new();
            let mut dio = [0u8; 4096];
            loop {
                let n = veza.read(&mut dio).unwrap_or(0);
                if n == 0 {
                    break;
                }
                procitano.extend_from_slice(&dio[..n]);
                let Some(kraj) = procitano.windows(4).position(|w| w == b"\r\n\r\n") else { continue };
                let zaglavlja = String::from_utf8_lossy(&procitano[..kraj]).to_lowercase();
                let duzina = zaglavlja
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if procitano.len() >= kraj + 4 + duzina {
                    break;
                }
            }
            brojac.fetch_add(1, Ordering::SeqCst);
            bf += 1;
            let xml = format!(
                "<RacunOdgovor><VrstaOdgovora>OK</VrstaOdgovora><Odgovor><Naziv>BrojFiskalnogRacuna</Naziv><Vrijednost>{bf}</Vrijednost></Odgovor></RacunOdgovor>"
            );
            let _ = write!(
                veza,
                "HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{xml}",
                xml.len()
            );
        }
    });
    (port, zahtjevi)
}

/// Backend nad novom bazom u privremenom folderu: prijavljen zadani admin
/// (id 1), Tring na lažnom uređaju.
pub struct Proba {
    b: Option<Backend>,
    dir: PathBuf,
    zahtjevi: Arc<AtomicUsize>,
}

pub fn proba(ime: &str) -> Proba {
    let dir = privremeni_folder(ime);
    let b = Backend::novi(&dir, Box::new(BezDijaloga), Sat::sistemski(), false).unwrap();
    let db = b.db();
    db.run("UPDATE settings SET value = '127.0.0.1' WHERE key = 'tring.host'", &[]).unwrap();
    let (port, zahtjevi) = lazi_tring();
    db.run("UPDATE settings SET value = ? WHERE key = 'tring.port'", &[json!(port.to_string())]).unwrap();
    b.sesija.postavi(Some(1), false);
    Proba { b: Some(b), dir, zahtjevi }
}

impl Proba {
    /// Koliko je zahtjeva stiglo lažnom uređaju.
    pub fn zahtjevi(&self) -> usize {
        self.zahtjevi.load(Ordering::SeqCst)
    }

    pub fn b(&self) -> &Backend {
        self.b.as_ref().unwrap()
    }

    pub fn run(&self, sql: &str, params: &[Value]) -> i64 {
        self.b().db().run(sql, params).unwrap().last_insert_rowid
    }

    pub fn all(&self, sql: &str) -> Vec<Value> {
        self.b().db().all(sql, &[]).unwrap()
    }

    pub fn call(&self, kanal: &str, args: Vec<Value>) -> Result<Value, String> {
        self.b().call(kanal, args)
    }

    pub fn artikal(&self, sifra: &str, tip: &str) -> i64 {
        self.run(
            "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', 5, 'E', 1, ?)",
            &[json!(sifra), json!(format!("Artikal {sifra}")), json!(tip)],
        )
    }

    /// Write-ahead red kakav ostavi nepoznat ishod štampe.
    pub fn pending(&self, snapshot: Value) -> i64 {
        self.run("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (1, ?)", &[json!(snapshot.to_string())])
    }
}

impl Drop for Proba {
    fn drop(&mut self) {
        drop(self.b.take());
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
