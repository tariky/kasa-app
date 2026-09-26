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
use crate::{p, postavke, Backend};

// ─── Uređaj ─────────────────────────────────────────────────

/// Tring klijent podešen iz postavki, za jedan poziv kanala. TS: `uredjajIzPostavki`.
pub struct Uredjaj<'a> {
    b: &'a Backend,
    operator_id: Value,
    operator_password: Value,
}

impl<'a> Uredjaj<'a> {
    /// Tring postavke iz baze (`postavke::tring`) → klijent: host, port i
    /// dnevnik (`dev.logging`), a operator i lozinka za inicijalizaciju.
    pub fn iz_postavki(b: &'a Backend) -> R<Uredjaj<'a>> {
        let t = postavke::tring(b.db())?;
        b.tring.configure(&js::to_string(&t.host), t.port.as_i64());
        b.tring.set_logging_enabled(t.logovanje);
        // `operatorPassword ?? '0'`
        let operator_password = js::nn(&t.operator_password, &json!("0")).clone();
        Ok(Uredjaj { b, operator_id: t.operator_id, operator_password })
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

/// Dokumenti čija je štampa u toku, po ključu `vrsta:id` (polje `Backend`-a).
/// Dok jedan poziv čeka uređaj, drugi može stići (petlja.rs) — isti dokument
/// se ne šalje uređaju dvaput.
#[derive(Default)]
pub struct UTokuSkup(Mutex<BTreeSet<String>>);

impl UTokuSkup {
    fn zakljucaj(&self) -> MutexGuard<'_, BTreeSet<String>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Oznaka "u toku" koja se skida kad izađe iz opsega (`finally { set.delete(id) }`).
pub struct UToku<'a> {
    skup: &'a UTokuSkup,
    kljuc: String,
}

impl<'a> UToku<'a> {
    /// Zauzme dokument `id` vrste `vrsta` (ponuda, nalog, storno); kad je
    /// njegova štampa već u toku, greška s porukom `poruka`.
    pub fn zauzmi(b: &'a Backend, vrsta: &str, id: &Value, poruka: &str) -> R<UToku<'a>> {
        let kljuc = format!("{vrsta}:{}", js::stringify(id));
        if !b.u_toku.zakljucaj().insert(kljuc.clone()) {
            return Err(Greska::nova(poruka));
        }
        Ok(UToku { skup: &b.u_toku, kljuc })
    }
}

impl Drop for UToku<'_> {
    fn drop(&mut self) {
        self.skup.zakljucaj().remove(&self.kljuc);
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
fn prikaz_greske(greska: &str) -> &str {
    if greska.is_empty() { "nepoznata greška" } else { greska }
}

/// `Račun X JE odštampan, ali ...` — greška upisa nakon uspješne štampe.
pub fn poruka_nakon_stampe(broj: &Value, sredina: &str, greska: &str, kraj: &str) -> String {
    format!("Račun {} JE odštampan, ali {sredina}: {}. {kraj}", prikaz_broja(broj), prikaz_greske(greska))
}

/// Dokument koji je uređaj odštampao, a upis u bazu nije uspio.
pub enum Odstampan<'a> {
    /// Fiskalni račun (kasa, ponuda, nalog): BF broj s uređaja.
    Racun(&'a Value),
    /// Račun po prilogu: broj fakture i BF broj.
    Prilog(i64, &'a Value),
    /// Reklamacija (storno): broj reklamacije.
    Reklamacija(&'a Value),
}

/// Štampa je uspjela, a upis nije: dokument je na papiru, transakcija je
/// poništena pa write-ahead red ostaje za dijalog nezavršenih računa. Jedina
/// poruka tog ishoda za sve tokove štampe (tekst kao u TS-u).
pub fn nije_zabiljezen(dokument: Odstampan, greska: &Greska) -> Greska {
    let g = prikaz_greske(greska.poruka());
    Greska(match dokument {
        Odstampan::Racun(broj) => {
            poruka_nakon_stampe(broj, "nije zabilježen u bazi", greska.poruka(), "Riješite ga kroz nezavršene račune.")
        }
        Odstampan::Prilog(prilog_broj, broj) => format!(
            "Fiskalni račun po prilogu br. {prilog_broj} (BF {}) JE odštampan, ali nije zabilježen u bazi: {g}. \
             Riješite ga kroz nezavršene račune.",
            prikaz_broja(broj)
        ),
        Odstampan::Reklamacija(broj) => format!(
            "Reklamacija #{} JE odštampana, ali nije zabilježena u bazi: {g}. Riješite je kroz nezavršene račune.",
            prikaz_broja(broj)
        ),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::racun::tests::{proba, Proba};

    /// Po jedan dokument za svaki tok štampe.
    struct Dokumenti {
        artikal: i64,
        ponuda: i64,
        nalog: i64,
        racun: i64,
    }

    fn dokumenti(p: &Proba) -> Dokumenti {
        let artikal = p.artikal("A1", "artikal");
        let kupac = p.run("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac d.o.o.', '4200000000009')", &[]);
        let ponuda = p.run(
            "INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
             VALUES (1, 2026, ?, 1, '2026-03-01', '2026-03-31', 'prihvacena', 5, 0.73)",
            &[json!(kupac)],
        );
        p.run(
            "INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, 0, 'E')",
            &[json!(ponuda), json!(artikal)],
        );
        let nalog = p.run(
            "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, kupacId, opis, dogovorenaCijena, status, korisnikId)
             VALUES (1, 2026, '2026-03-01', 'narudzba', ?, 'Po mjeri', 100, 'zavrsen', 1)",
            &[json!(kupac)],
        );
        // Današnji gotovinski račun: ladica pokriva storno bez unosa novca.
        let racun = p.run(
            "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status)
             VALUES (1, 5, 0.73, 'Gotovina', '55', 'completed')",
            &[],
        );
        p.run(
            "INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, 0, 'E')",
            &[json!(racun), json!(artikal)],
        );
        p.call("fiscal:setZadnjiBroj", vec![json!(100)]).unwrap();
        Dokumenti { artikal, ponuda, nalog, racun }
    }

    /// Svaki tok koji štampa, redom: kasa, prilog, ponuda, nalog, storno.
    fn stampaj_sve(p: &Proba, d: &Dokumenti) -> Vec<(&'static str, Result<Value, String>)> {
        let stavka = json!({ "productId": d.artikal, "kolicina": 1, "cijena": 5, "rabat": 0, "pdvStopa": "E" });
        vec![
            ("order:finalize", p.call("order:finalize", vec![json!({ "stavke": [stavka], "nacinPlacanja": "Gotovina" })])),
            ("order:finalizePrilog", p.call("order:finalizePrilog", vec![json!({ "iznos": 10, "nacinPlacanja": "Gotovina" })])),
            ("ponuda:konvertuj", p.call("ponuda:konvertuj", vec![json!({ "id": d.ponuda, "nacinPlacanja": "Gotovina" })])),
            ("nalog:izdajRacun", p.call("nalog:izdajRacun", vec![json!({ "id": d.nalog, "nacinPlacanja": "Gotovina" })])),
            ("order:refundAndPrint", p.call("order:refundAndPrint", vec![json!({ "id": d.racun })])),
        ]
    }

    fn pending(p: &Proba) -> Value {
        p.all("SELECT COUNT(*) AS n FROM pending_receipts")[0]["n"].clone()
    }

    /// Ruling 14 (1): write-ahead red se upisuje tek kad je prošlo sve što može
    /// pasti prije štampe (postavke uređaja, račun za uređaj) — greška prije
    /// štampe ne ostavlja red u nezavršenim računima.
    #[test]
    fn greska_prije_stampe_ne_ostavlja_red() {
        let p = proba("prije-stampe");
        let d = dokumenti(&p);
        // Postavke uređaja se ne mogu pročitati.
        p.run("ALTER TABLE settings RENAME TO settings_nema", &[]);
        for (tok, r) in stampaj_sve(&p, &d) {
            assert_eq!(r, Err("no such table: settings".to_string()), "{tok}");
        }
        assert_eq!(pending(&p), json!(0));
        assert_eq!(p.zahtjevi(), 0);
    }

    /// Ruling 14 (2): štampa uspjela, upis pao — svaki tok javlja „JE odštampan,
    /// ali nije zabilježen" (tekst kao u TS-u), a red ostaje za dijalog.
    #[test]
    fn upis_pao_poslije_stampe() {
        let p = proba("upis-pao");
        let d = dokumenti(&p);
        p.b()
            .db()
            .exec(
                "CREATE TRIGGER bez_racuna BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'upis pao'); END;
                 CREATE TRIGGER bez_storna BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, 'upis pao'); END;",
            )
            .unwrap();
        let greske: Vec<(&str, String)> = stampaj_sve(&p, &d).into_iter().map(|(tok, r)| (tok, r.unwrap_err())).collect();
        let racun = |bf: u32| format!("Račun {bf} JE odštampan, ali nije zabilježen u bazi: upis pao. Riješite ga kroz nezavršene račune.");
        assert_eq!(
            greske,
            vec![
                ("order:finalize", racun(101)),
                (
                    "order:finalizePrilog",
                    "Fiskalni račun po prilogu br. 102 (BF 102) JE odštampan, ali nije zabilježen u bazi: upis pao. \
                     Riješite ga kroz nezavršene račune."
                        .to_string()
                ),
                ("ponuda:konvertuj", racun(103)),
                ("nalog:izdajRacun", racun(104)),
                (
                    "order:refundAndPrint",
                    "Reklamacija #105 JE odštampana, ali nije zabilježena u bazi: upis pao. Riješite je kroz nezavršene račune."
                        .to_string()
                ),
            ]
        );
        assert_eq!(pending(&p), json!(5));
        assert_eq!(p.zahtjevi(), 5);
    }
}
