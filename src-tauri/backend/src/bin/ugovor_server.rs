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

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use pazar_backend::sat::Sat;
use pazar_backend::{Backend, Platforma};
use serde_json::{json, Value};

#[derive(Default)]
struct Stanje {
    sacuvaj: Option<String>,
    otvori: Option<String>,
    potvrda: i64,
    otvoreni: Vec<Value>,
}

struct TestPlatforma {
    stanje: Arc<Mutex<Stanje>>,
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
        s.otvoreni.push(json!({ "vrsta": "sacuvaj", "opcije": opcije }));
        s.sacuvaj.clone()
    }
    fn dijalog_otvori(&self, opcije: Value) -> Option<String> {
        let mut s = self.stanje.lock().unwrap();
        s.otvoreni.push(json!({ "vrsta": "otvori", "opcije": opcije }));
        s.otvori.clone()
    }
    fn dijalog_potvrda(&self, opcije: Value) -> i64 {
        let mut s = self.stanje.lock().unwrap();
        s.otvoreni.push(json!({ "vrsta": "potvrda", "opcije": opcije }));
        s.potvrda
    }
    fn restartuj_za(&self, ms: u64) {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(ms));
            posalji(&json!({ "dogadjaj": "restart" }));
        });
    }
}

fn main() {
    let user_data = PathBuf::from(std::env::args().nth(1).expect("ugovor-server <userData>"));
    let stanje = Arc::new(Mutex::new(Stanje::default()));
    let sat = Sat::sistemski();
    let mut b = match Backend::novi(&user_data, Box::new(TestPlatforma { stanje: stanje.clone() }), sat.clone(), false) {
        Ok(b) => b,
        Err(e) => {
            posalji(&json!({ "spreman": false, "greska": e.0 }));
            std::process::exit(1);
        }
    };
    posalji(&json!({ "spreman": true }));

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
        {
            let mut s = stanje.lock().unwrap();
            let d = &z["dijalog"];
            s.sacuvaj = d["sacuvaj"].as_str().map(str::to_string);
            s.otvori = d["otvori"].as_str().map(str::to_string);
            s.potvrda = d["potvrda"].as_i64().unwrap_or(0);
            s.otvoreni.clear();
        }
        sat.postavi(z["sada"].as_f64().map(|ms| ms as i64));
        let args = z["args"].as_array().cloned().unwrap_or_default();
        let r = b.call(z["kanal"].as_str().unwrap_or(""), args);
        let dijalozi = std::mem::take(&mut stanje.lock().unwrap().otvoreni);
        let mut odgovor = match r {
            Ok(v) => json!({ "id": z["id"], "ok": v }),
            Err(g) => json!({ "id": z["id"], "greska": g }),
        };
        odgovor["dijalozi"] = Value::Array(dijalozi);
        posalji(&odgovor);
    }
}
