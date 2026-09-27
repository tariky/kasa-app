//! Backend za ugovorne testove (`src/ipc/ugovor/rustBackend.ts`).
//!
//! `ugovor-server <userData>` otvori bazu u tom folderu, javi
//! `{"spreman":true}` i onda čita zahtjeve, jedan JSON po liniji:
//!
//!   {"id":1,"kanal":"user:login","args":["0000"],"sada":1758700000000,
//!    "dijalog":{"sacuvaj":null,"otvori":null,"potvrda":0}}
//!
//! i odgovara `{"id":1,"ok":…}` ili `{"id":1,"greska":"…"}`, uz
//! `"dijalozi":[{"vrsta":"sacuvaj","opcije":{…}}]` koje je poziv otvorio.
//! Restart (nakon uvoza backup-a) stiže kasnije kao `{"dogadjaj":"restart"}`.
//!
//! Meta zahtjev `{"id":2,"meta":"kanali"}` vraća `{"id":2,"ok":[…]}` — sve
//! kanale backenda (`Backend.kanali()` u harnessu).
//! `{"id":3,"meta":"r2IzTokena","token":"PAZAR1…"}` vraća R2 podatke iz
//! tokena (`Backend.r2IzTokena`) ili `null`.
//! Događaji backenda (`backup:stanje`, `licenca:blokirano`) stižu kao
//! `{"dogadjaj":"backup:stanje","podaci":{…}}`. Meta `{"meta":"backupLicenca",
//! "r2":{…}|null}` (bez odgovora) postavi R2 podatke koje "licenca" daje backup-u.
//!
//! Svaki zahtjev radi u svojoj niti, s mjestom u redu uzetim pri čitanju:
//! kao u Electronu, drugi poziv može raditi dok prvi čeka uređaj.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::thread::ThreadId;

use pazar_backend::licenca::R2Podaci;
use pazar_backend::sat::Sat;
use pazar_backend::{Backend, Platforma};
use serde_json::{json, Value};

#[derive(Default)]
struct Stanje {
    sacuvaj: Option<String>,
    otvori: Option<String>,
    potvrda: i64,
    /// Otvoreni dijalozi po niti poziva.
    otvoreni: Vec<(ThreadId, Value)>,
}

struct TestPlatforma {
    stanje: Arc<Mutex<Stanje>>,
    /// Backend za poslove u pozadini — postavlja se čim je napravljen.
    backend: Arc<OnceLock<Weak<Backend>>>,
}

fn posalji(v: &Value) {
    // Jedna linija po poruci; zaključan stdout da se restart ne umiješa u odgovor.
    let out = std::io::stdout();
    let mut l = out.lock();
    writeln!(l, "{}", serde_json::to_string(v).unwrap()).unwrap();
    l.flush().unwrap();
}

impl Platforma for TestPlatforma {
    fn dijalog_sacuvaj(&self, opcije: Value) -> Option<String> {
        let mut s = self.stanje.lock().unwrap();
        s.otvoreni.push((std::thread::current().id(), json!({ "vrsta": "sacuvaj", "opcije": opcije })));
        s.sacuvaj.clone()
    }
    fn dijalog_otvori(&self, opcije: Value) -> Option<String> {
        let mut s = self.stanje.lock().unwrap();
        s.otvoreni.push((std::thread::current().id(), json!({ "vrsta": "otvori", "opcije": opcije })));
        s.otvori.clone()
    }
    fn dijalog_potvrda(&self, opcije: Value) -> i64 {
        let mut s = self.stanje.lock().unwrap();
        s.otvoreni.push((std::thread::current().id(), json!({ "vrsta": "potvrda", "opcije": opcije })));
        s.potvrda
    }
    fn restartuj_za(&self, ms: u64) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            posalji(&json!({ "dogadjaj": "restart" }));
        });
    }
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
}

fn main() {
    let user_data = PathBuf::from(std::env::args().nth(1).expect("ugovor-server <userData>"));
    let stanje = Arc::new(Mutex::new(Stanje::default()));
    let sat = Sat::sistemski();
    // Licenca je u ugovornim testovima otključana (kao mock u tsBackend.ts);
    // KASA_UGOVOR_LICENCA=1 uključi pravu provjeru (licenca.json u userData).
    let licenca = std::env::var("KASA_UGOVOR_LICENCA").is_ok_and(|v| v == "1");
    let ja = Arc::new(OnceLock::new());
    let b = match Backend::novi(&user_data, Box::new(TestPlatforma { stanje: stanje.clone(), backend: ja.clone() }), sat.clone(), licenca) {
        Ok(b) => Arc::new(b),
        Err(e) => {
            posalji(&json!({ "spreman": false, "greska": e.0 }));
            std::process::exit(1);
        }
    };
    let _ = ja.set(Arc::downgrade(&b));
    posalji(&json!({ "spreman": true }));

    let mut niti = Vec::new();
    for linija in std::io::stdin().lock().lines() {
        let Ok(linija) = linija else { break };
        if linija.trim().is_empty() {
            continue;
        }
        let z: Value = match serde_json::from_str(&linija) {
            Ok(z) => z,
            Err(e) => {
                posalji(&json!({ "greska": format!("Neispravan zahtjev: {e}") }));
                continue;
            }
        };
        if z["meta"] == "kanali" {
            posalji(&json!({ "id": z["id"], "ok": *pazar_backend::kanali::SVI_KANALI }));
            continue;
        }
        if z["meta"] == "r2IzTokena" {
            let r2 = pazar_backend::licenca::backup_podaci(z["token"].as_str().unwrap_or(""));
            posalji(&json!({ "id": z["id"], "ok": r2.map(|r| r.u_json()) }));
            continue;
        }
        if z["meta"] == "backupLicenca" {
            // Bez odgovora: obradi se prije sljedećeg zahtjeva (redom sa stdin-a).
            b.backup.postavi_testni_pristup(R2Podaci::iz_json(&z["r2"]));
            continue;
        }
        {
            let mut s = stanje.lock().unwrap();
            let d = &z["dijalog"];
            s.sacuvaj = d["sacuvaj"].as_str().map(str::to_string);
            s.otvori = d["otvori"].as_str().map(str::to_string);
            s.potvrda = d["potvrda"].as_i64().unwrap_or(0);
        }
        sat.postavi(z["sada"].as_f64().map(|ms| ms as i64));
        let tiket = b.tiket();
        let (b, stanje) = (b.clone(), stanje.clone());
        niti.push(std::thread::spawn(move || {
            let args = z["args"].as_array().cloned().unwrap_or_default();
            let r = b.call_u_redu(tiket, z["kanal"].as_str().unwrap_or(""), args);
            let ja = std::thread::current().id();
            let dijalozi: Vec<Value> = {
                let mut s = stanje.lock().unwrap();
                let (moji, ostali) = std::mem::take(&mut s.otvoreni).into_iter().partition(|(t, _)| *t == ja);
                s.otvoreni = ostali;
                moji.into_iter().map(|(_, d)| d).collect::<Vec<_>>()
            };
            let mut odgovor = match r {
                Ok(v) => json!({ "id": z["id"], "ok": v }),
                Err(g) => json!({ "id": z["id"], "greska": g }),
            };
            odgovor["dijalozi"] = Value::Array(dijalozi);
            posalji(&odgovor);
        }));
        niti.retain(|n| !n.is_finished());
    }
    for n in niti {
        let _ = n.join();
    }
}
