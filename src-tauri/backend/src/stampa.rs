//! Fiskalna štampa za sve tokove (račun, prilog, ponuda, nalog, storno,
//! gotovina, izvještaji) i zajednički oblici njenog ishoda.
//!
//! [`Uredjaj::iz_postavki`] je jedino mjesto koje učita Tring postavke iz baze
//! (`loadTringConfig`), a svaki poziv uređaja zapiše zahtjev i odgovor u
//! dnevnik kad je uključen. Uređaj se nikad ne zove u transakciji: dok čeka
//! uređaj, poziv otpušta petlju (petlja.rs), a transakcija je ne otpušta.
//! TS: `lib/fiskalniUredjaj.ts` i dijelovi `lib/pendingRacun.ts`.

use std::collections::BTreeSet;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, MutexGuard};

use serde_json::{json, Value};

use crate::greska::{Greska, R};
use crate::js::{self, or, or_null};
use crate::sql::Db;
use crate::tring::{self, Odgovor};
use crate::{p, Backend};

// ─── Uređaj ─────────────────────────────────────────────────

/// Tring klijent podešen iz postavki, za jedan poziv kanala. TS: `uredjajIzPostavki`.
pub struct Uredjaj<'a> {
    b: &'a Backend,
    operator_id: Value,
    operator_password: Value,
}

impl<'a> Uredjaj<'a> {
    /// Tring postavke iz baze → klijent (`loadTringConfig`): host, port i
    /// dnevnik (`dev.logging`), a operator i lozinka za inicijalizaciju.
    pub fn iz_postavki(b: &'a Backend) -> R<Uredjaj<'a>> {
        let db = b.db()?;
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
        b.tring.configure(&host, port);

        let dev = db.val("SELECT value FROM settings WHERE key = 'dev.logging'", p![])?;
        b.tring.set_logging_enabled(dev == "true");

        Ok(Uredjaj { b, operator_id: js::parse_int_value(&g("operatorId", "0")), operator_password: g("operatorPassword", "0") })
    }

    /// `if (Tring.isLoggingEnabled()) console.log(...)`. Ide na stderr: stdout
    /// ugovor-servera je kanal odgovora.
    fn dnevnik(&self, sta: &str, v: &Value) {
        if self.b.tring.is_logging_enabled() {
            eprintln!("[Tring] {sta}: {}", js::stringify(v));
        }
    }

    /// Transakcija ne smije čekati uređaj (better-sqlite3 transakcija ne može
    /// sadržavati `await`): sve što ide u bazu nakon štampe je nova transakcija.
    fn van_transakcije(&self) {
        debug_assert_eq!(self.b.petlja.transakcije.load(Ordering::SeqCst), 0, "štampa u transakciji");
    }

    /// Fiskalni račun. `oznaka` je tok u dnevniku (finalize, ponuda:konvertuj…).
    pub fn fiskalni(&self, oznaka: &str, racun: &Value) -> Odgovor {
        self.van_transakcije();
        self.dnevnik(&format!("{oznaka} request"), racun);
        let result = self.b.tring.stampati_fiskalni_racun(racun);
        self.dnevnik(&format!("{oznaka} response"), &result);
        result
    }

    /// Reklamirani račun (storno).
    pub fn reklamacija(&self, oznaka: &str, racun: &Value) -> Odgovor {
        self.van_transakcije();
        self.dnevnik(&format!("{oznaka} request"), racun);
        let result = self.b.tring.stampati_reklamirani_racun(racun);
        self.dnevnik(&format!("{oznaka} response"), &result);
        result
    }

    /// UnosNovca — polog ili pokriće za storno.
    pub fn unos_novca(&self, oznaka: &str, iznos: f64) -> Odgovor {
        self.van_transakcije();
        let result = self.b.tring.unos_novca(iznos);
        self.dnevnik(oznaka, &result);
        result
    }

    /// PovratNovca — gotovina iz kase.
    pub fn povrat_novca(&self, oznaka: &str, iznos: f64) -> Odgovor {
        self.van_transakcije();
        let result = self.b.tring.povrat_novca(iznos);
        self.dnevnik(oznaka, &result);
        result
    }

    pub fn inicijalizacija(&self) -> Odgovor {
        self.van_transakcije();
        // `parseInt` koji ne uspije je NaN, a `${NaN}` u XML-u je "NaN".
        let operator_id = if self.operator_id.is_null() { json!("NaN") } else { self.operator_id.clone() };
        let result = self.b.tring.inicijalizacija(&operator_id, &self.operator_password);
        self.dnevnik("init", &result);
        result
    }

    pub fn presjek_stanja(&self) -> Odgovor {
        self.van_transakcije();
        let result = self.b.tring.stampati_presjek_stanja();
        self.dnevnik("xReport", &result);
        result
    }

    pub fn dnevni_izvjestaj(&self) -> Odgovor {
        self.van_transakcije();
        let result = self.b.tring.stampati_dnevni_izvjestaj();
        self.dnevnik("zReport", &result);
        result
    }

    pub fn periodicni_izvjestaj(&self, od: &Value, do_: &Value) -> Odgovor {
        self.van_transakcije();
        let result = self.b.tring.stampati_periodicni_izvjestaj(od, do_);
        self.dnevnik("periodicReport", &result);
        result
    }
}

// ─── Zaštita od dvoklika ────────────────────────────────────

/// Dokumenti čija je štampa u toku, po ključu `vrsta:id`. Dok jedan poziv
/// čeka uređaj, drugi može stići (petlja.rs) — isti dokument se ne šalje
/// uređaju dvaput.
static U_TOKU: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

fn u_toku() -> MutexGuard<'static, BTreeSet<String>> {
    U_TOKU.lock().unwrap_or_else(|e| e.into_inner())
}

/// Oznaka "u toku" koja se skida kad izađe iz opsega (`finally { set.delete(id) }`).
pub struct UToku(String);

impl UToku {
    /// Zauzme dokument `id` vrste `vrsta` (ponuda, nalog, storno); kad je
    /// njegova štampa već u toku, greška s porukom `poruka`.
    pub fn zauzmi(vrsta: &str, id: &Value, poruka: &str) -> R<UToku> {
        let kljuc = format!("{vrsta}:{}", js::stringify(id));
        if !u_toku().insert(kljuc.clone()) {
            return Err(Greska::nova(poruka));
        }
        Ok(UToku(kljuc))
    }
}

impl Drop for UToku {
    fn drop(&mut self) {
        u_toku().remove(&self.0);
    }
}

// ─── Ishod štampe ───────────────────────────────────────────

/// Broj koji je uređaj vratio: `result.odgovori?.BrojFiskalnogRacuna || null`.
pub fn broj_sa_uredjaja(result: &Odgovor) -> Value {
    or_null(&result["odgovori"]["BrojFiskalnogRacuna"])
}

/// Štampa nije uspjela. Siguran neuspjeh (uređaj odbio, veza odbijena) briše
/// write-ahead red; nepoznat ishod ga ostavlja i vraća poruku koja operatera
/// šalje u dijalog nezavršenih računa (`ishodNepoznat: true` za renderer).
/// TS: `neuspjelaStampa`.
pub fn neuspjeh(db: &Db, pending_id: i64, result: &Odgovor) -> R<Value> {
    // `result.error || result.vrstaOdgovora || 'Nepoznata greška'`, `result.odgovori ?? {}`
    let greska = or(&result["error"], or(&result["vrstaOdgovora"], &json!("Nepoznata greška"))).clone();
    let odgovori = js::nn(&result["odgovori"], &json!({})).clone();
    if tring::ishod_nepoznat(result) {
        return Ok(json!({
            "success": false,
            "error": format!(
                "Uređaj nije potvrdio račun ({}) — ishod štampe nije poznat. \
                 Provjerite da li je račun odštampan i riješite ga u dijalogu nezavršenih računa.",
                js::to_string(&greska)
            ),
            "odgovori": odgovori,
            "ishodNepoznat": true,
        }));
    }
    db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
    Ok(json!({ "success": false, "error": greska, "odgovori": odgovori }))
}

/// Broj s uređaja u poruci operateru; bez broja je "?".
pub fn prikaz_broja(broj: &Value) -> String {
    if broj.is_null() { "?".to_string() } else { js::to_string(broj) }
}

/// `err?.message || 'nepoznata greška'`
pub fn prikaz_greske(greska: &str) -> &str {
    if greska.is_empty() { "nepoznata greška" } else { greska }
}

/// `Račun X JE odštampan, ali ...` — greška upisa nakon uspješne štampe.
pub fn poruka_nakon_stampe(broj: &Value, sredina: &str, greska: &str, kraj: &str) -> String {
    format!("Račun {} JE odštampan, ali {sredina}: {}. {kraj}", prikaz_broja(broj), prikaz_greske(greska))
}
