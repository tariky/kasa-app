//! Fiskalna štampa za sve tokove (račun, prilog, ponuda, nalog, storno,
//! gotovina, izvještaji) i tok fiskalnog dokumenta ([`fiskalizuj`]).
//!
//! [`Uredjaj::iz_postavki`] učita Tring postavke iz baze (`postavke::tring`),
//! a svaki poziv uređaja zapiše zahtjev i odgovor u dnevnik kad je uključen.
//! Uređaj se nikad ne zove u transakciji: dok čeka uređaj, poziv otpušta
//! petlju (petlja.rs), a transakcija je ne otpušta. TS:
//! `lib/fiskalniUredjaj.ts`, `lib/fiskalizacija.ts` i dijelovi `lib/pendingRacun.ts`.

use std::collections::BTreeSet;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, MutexGuard};

use serde_json::{json, Value};

use crate::greska::{Greska, R};
use crate::js::{self, or, or_null};
use crate::pending_racun::{preuzmi_pending_red, vec_evidentiran, zapisi_pending};
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
    /// njegova štampa već u toku, greška s porukom `poruka`. Ključ je JS
    /// template `${vrsta}:${id}` kao TS `uToku` — id 5 i "5" su isti dokument.
    pub fn zauzmi(b: &'a Backend, vrsta: &str, id: &Value, poruka: &str) -> R<UToku<'a>> {
        let kljuc = format!("{vrsta}:{}", js::to_string(id));
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
fn broj_sa_uredjaja(result: &Odgovor) -> Value {
    or_null(&result["odgovori"]["BrojFiskalnogRacuna"])
}

/// Štampa nije uspjela. Siguran neuspjeh (uređaj odbio, veza odbijena) briše
/// write-ahead red; nepoznat ishod ga ostavlja i vraća poruku koja operatera
/// šalje u dijalog nezavršenih računa (`ishodNepoznat: true` za renderer).
/// TS: `neuspjelaStampa`.
fn neuspjeh(db: &Db, pending_id: i64, result: &Odgovor) -> R<Value> {
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

/// `Račun <bf>` — fiskalni račun (kasa, ponuda, nalog) u poruci operateru.
pub fn racun_s_brojem(bf: &Value) -> String {
    format!("Račun {}", prikaz_broja(bf))
}

/// Rod dokumenta u poruci poslije štampe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rod {
    /// „Račun … JE odštampan, ali nije zabilježen"
    Muski,
    /// „Reklamacija … JE odštampana, ali nije zabilježena"
    Zenski,
}

/// `<dokument> JE odštampan, ali nije zabilježen u bazi: <greška>. Riješite ga
/// kroz nezavršene račune.` — jedina poruka za upis koji padne nakon štampe
/// (`Rod::Zenski` za reklamaciju). TS: `porukaNakonStampe`.
pub fn poruka_nakon_stampe(dokument: &str, greska: &str, rod: Rod) -> String {
    match rod {
        Rod::Muski => format!("{dokument} JE odštampan, ali nije zabilježen u bazi: {greska}. Riješite ga kroz nezavršene račune."),
        Rod::Zenski => {
            format!("{dokument} JE odštampana, ali nije zabilježena u bazi: {greska}. Riješite je kroz nezavršene račune.")
        }
    }
}

/// Štampa je uspjela, a upis nije: dokument je na papiru, transakcija je
/// poništena pa write-ahead red ostaje za dijalog nezavršenih računa.
fn nije_zabiljezen(dokument: &str, rod: Rod, greska: &Greska) -> Greska {
    Greska(poruka_nakon_stampe(dokument, prikaz_greske(greska.poruka()), rod))
}

// ─── Tok fiskalnog dokumenta ────────────────────────────────

/// Ono što tok izvede iz broja koji je vratio uređaj (upis, naziv dokumenta, odgovor).
type IzBroja<'a, X> = Box<dyn FnOnce(&Value) -> X + 'a>;

/// Jedan fiskalni dokument za [`fiskalizuj`] (TS `Fiskalizacija`). Pozivalac
/// PRIJE `fiskalizuj` uradi sve što može pasti: provjere koje bi oborile upis
/// (odštampan fiskalni dokument se ne može povući), postavke uređaja
/// (`Uredjaj::iz_postavki`) i dokument za uređaj — write-ahead red se upisuje
/// tek kad preostaje samo slanje.
pub struct Fiskalizacija<'a, T> {
    /// Write-ahead snapshot (oblik po vrsti dokumenta — pending_racun.rs);
    /// red pripada `snapshot.korisnikId`.
    pub snapshot: &'a Value,
    /// Štampa na uređaju (račun, ili reklamacija s unosom novca i ponovnim
    /// pokušajem). Greška znači da ništa nije odštampano.
    pub stampaj: Box<dyn FnOnce() -> R<Odgovor> + 'a>,
    /// Upis nakon uspješne štampe, u istoj transakciji u kojoj se preuzima
    /// write-ahead red (s vezama: ponuda konvertovana, nalog fakturisan…).
    /// Dobija broj koji je vratio uređaj.
    pub upisi: IzBroja<'a, R<T>>,
    /// Naziv dokumenta u poruci kad upis nakon štampe padne
    /// (`poruka_nakon_stampe`), iz broja koji je vratio uređaj.
    pub dokument: IzBroja<'a, String>,
    /// `Rod::Zenski` za reklamaciju.
    pub rod: Rod,
    /// Odgovor kad je red u međuvremenu riješen iz dijaloga nezavršenih.
    pub vec_evidentiran: IzBroja<'a, Value>,
}

impl<'a, T> Fiskalizacija<'a, T> {
    /// Fiskalni račun (kasa, faktura, ponuda, nalog): u poruci „Račun <bf>", a
    /// za red riješen iz dijaloga `vec_evidentiran` (BF).
    pub fn racun(
        snapshot: &'a Value,
        stampaj: impl FnOnce() -> R<Odgovor> + 'a,
        upisi: impl FnOnce(&Value) -> R<T> + 'a,
    ) -> Self {
        Fiskalizacija {
            snapshot,
            stampaj: Box::new(stampaj),
            upisi: Box::new(upisi),
            dokument: Box::new(racun_s_brojem),
            rod: Rod::Muski,
            vec_evidentiran: Box::new(vec_evidentiran),
        }
    }
}

/// Dokument je odštampan i upisan (TS `Uspjeh`).
pub struct Uspjeh<T> {
    /// Ono što je vratio `upisi`.
    pub id: T,
    /// Broj koji je vratio uređaj (null kad ga nije vratio).
    pub bf: Value,
    /// `odgovori` uređaja.
    pub odgovori: Value,
}

/// Write-ahead red (odmah, van transakcije) → štampa → ishod (TS `fiskalizuj`):
/// - greška iz štampe: ništa nije odštampano, red se briše, greška ide dalje;
/// - siguran neuspjeh briše red, nepoznat ishod ga ostavlja (`neuspjeh`);
/// - uspjeh: u jednoj transakciji preuzmi red → `upisi`. Red koji je dijalog
///   nezavršenih u međuvremenu riješio ili odbacio znači bez drugog zapisa
///   (`vec_evidentiran`). Pad upisa poništi transakciju — red ostaje za
///   dijalog, a greška kaže da je dokument odštampan (`nije_zabiljezen`).
///
/// `Ok(Err(odgovor))` je odgovor rendereru bez novog upisa: štampa nije
/// uspjela ili je dokument već evidentiran.
pub fn fiskalizuj<T>(db: &Db, f: Fiskalizacija<T>) -> R<Result<Uspjeh<T>, Value>> {
    let Fiskalizacija { snapshot, stampaj, upisi, dokument, rod, vec_evidentiran } = f;
    let pending_id = zapisi_pending(db, &snapshot["korisnikId"], snapshot)?;

    let result = match stampaj() {
        Ok(r) => r,
        Err(e) => {
            db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
            return Err(e);
        }
    };
    if !tring::uspjeh(&result) {
        return neuspjeh(db, pending_id, &result).map(Err);
    }

    let bf = broj_sa_uredjaja(&result);
    let upis = db.tx(|| if preuzmi_pending_red(db, pending_id)? { upisi(&bf).map(Some) } else { Ok(None) });
    match upis {
        Ok(Some(id)) => Ok(Ok(Uspjeh { id, bf, odgovori: result["odgovori"].clone() })),
        Ok(None) => Ok(Err(vec_evidentiran(&bf))),
        // Dokument je već na papiru; red ostaje (rollback) za dijalog nezavršenih.
        Err(e) => Err(nije_zabiljezen(&dokument(&bf), rod, &e)),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::proba::{proba, Proba};

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

    /// Jedna poruka za upis koji padne poslije štampe, kao TS `porukaNakonStampe`.
    #[test]
    fn poruka_nakon_stampe_po_rodu() {
        assert_eq!(
            poruka_nakon_stampe("Račun 7", "disk pun", Rod::Muski),
            "Račun 7 JE odštampan, ali nije zabilježen u bazi: disk pun. Riješite ga kroz nezavršene račune."
        );
        assert_eq!(
            poruka_nakon_stampe("Reklamacija #3", "disk pun", Rod::Zenski),
            "Reklamacija #3 JE odštampana, ali nije zabilježena u bazi: disk pun. Riješite je kroz nezavršene račune."
        );
        assert_eq!(nije_zabiljezen(&racun_s_brojem(&Value::Null), Rod::Muski, &Greska::nova("")).0, poruka_nakon_stampe("Račun ?", "nepoznata greška", Rod::Muski));
    }

    fn pending(p: &Proba) -> Value {
        p.all("SELECT COUNT(*) AS n FROM pending_receipts")[0]["n"].clone()
    }

    /// Ključ „u toku" je JS template `${vrsta}:${id}` kao TS `uToku`: id 5 i
    /// "5" su isti dokument, a ključ je `ponuda:5`, ne `ponuda:"5"`.
    #[test]
    fn u_toku_kljuc_kao_js_template() {
        let p = proba("u-toku-kljuc");
        let greska = |r: R<UToku>| r.err().map(|e| e.0);
        let prvi = UToku::zauzmi(p.b(), "ponuda", &json!("5"), "Konverzija ove ponude je već u toku").unwrap();
        assert_eq!(prvi.kljuc, "ponuda:5");
        assert_eq!(
            greska(UToku::zauzmi(p.b(), "ponuda", &json!(5), "Konverzija ove ponude je već u toku")),
            Some("Konverzija ove ponude je već u toku".to_string())
        );
        // Drugi dokument i druga vrsta s istim id-em nisu zauzeti.
        assert!(UToku::zauzmi(p.b(), "ponuda", &json!(6), "x").is_ok());
        assert!(UToku::zauzmi(p.b(), "nalog", &json!(5), "x").is_ok());
        drop(prvi);
        assert!(UToku::zauzmi(p.b(), "ponuda", &json!(5), "x").is_ok());
    }

    /// Write-ahead red se upisuje tek kad je prošlo sve što može pasti prije
    /// štampe (postavke uređaja, račun za uređaj) — greška prije štampe ne
    /// ostavlja red u nezavršenim računima.
    #[test]
    fn greska_prije_stampe_ne_ostavlja_red() {
        let p = proba("prije-stampe");
        let d = dokumenti(&p);
        // Samo postavke uređaja (tring.*) se ne mogu pročitati: ostale postavke
        // (fiskalni niz za prilog, PIN za storno) rade, pa svaki tok stigne do
        // uređaja i padne baš tu (abs najmanjeg cijelog broja je prekoračenje).
        p.b()
            .db()
            .exec(
                "ALTER TABLE settings RENAME TO settings_prave;
                 CREATE VIEW settings AS SELECT key,
                   CASE WHEN key LIKE 'tring.%' THEN abs(-9223372036854775807 - 1) ELSE value END AS value
                 FROM settings_prave;",
            )
            .unwrap();
        for (tok, r) in stampaj_sve(&p, &d) {
            assert_eq!(r, Err("integer overflow".to_string()), "{tok}");
        }
        assert_eq!(pending(&p), json!(0));
        assert_eq!(p.zahtjevi(), 0);
    }

    /// Štampa uspjela, upis pao — svaki tok javlja „JE odštampan,
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
