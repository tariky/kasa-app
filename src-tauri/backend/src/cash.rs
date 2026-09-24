//! Kanali `cash:*` (handlers.ts) i logika iz `lib/cash.ts` i `lib/drawer.ts`.
//!
//! Evidencija gotovine (polog/povrat) ide kroz Tring UnosNovca/PovratNovca;
//! očekivano stanje ladice koristi i storno (`order:refundAndPrint`), pa su
//! [`drawer_state`], [`deposit_cash`] i [`device_cash_in`] izloženi za `racuni.rs`.

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, round2, to_number};
use crate::sql::Db;
use crate::tring::{self, Odgovor};
use crate::{baci, p, Args, Backend};

// ─── lib/drawer.ts ──────────────────────────────────────────

/// Gotovinski dio jednog računa. `nacinPlacanja` je ili plain string
/// ('Gotovina', 'Kartica'...) — tada je gotovina puni iznos ili ništa —
/// ili JSON `{gotovina, kartica, ...}` s razbijenim iznosima.
pub fn gotovinski_iznos(nacin_placanja: &Value, ukupno: f64) -> f64 {
    // JSON.parse(x) radi nad String(x); `null` iz JSON-a ili bilo šta bez
    // `.gotovina` broja daje 0, a greška parsiranja pada na poređenje stringa.
    let tekst = js::to_string(nacin_placanja);
    match js::parse(&tekst) {
        // `null.gotovina` baca u JS-u — catch grana, koja za "null" daje 0.
        Ok(Value::Null) => 0.0,
        Ok(parsed) => match &parsed["gotovina"] {
            Value::Number(n) => n.as_f64().unwrap_or(0.0),
            _ => 0.0,
        },
        Err(_) => {
            if nacin_placanja.as_str() == Some("Gotovina") { ukupno } else { 0.0 }
        }
    }
}

/// `prodaje` su računi prodani u periodu (bez obzira na kasniji storno —
/// prodaja je tada unijela gotovinu), a `reklamirani` računi stornirani u
/// periodu (mogu biti prodani i ranije). Račun prodan i storniran isti dan
/// pojavi se u obje liste pa se gotovinski efekat poništi.
pub fn ocekivano_stanje(movements: &[Value], prodaje: &[Value], reklamirani: &[Value]) -> Value {
    let mut polozi = 0.0;
    let mut povrati = 0.0;
    for m in movements {
        if m["tip"] == "polog" {
            polozi += to_number(&m["iznos"]);
        } else {
            povrati += to_number(&m["iznos"]);
        }
    }

    let mut gotovinski_promet = 0.0;
    let mut gotovinske_reklamacije = 0.0;
    for o in prodaje {
        gotovinski_promet += gotovinski_iznos(&o["nacinPlacanja"], to_number(&o["ukupno"]));
    }
    for o in reklamirani {
        gotovinske_reklamacije += gotovinski_iznos(&o["nacinPlacanja"], to_number(&o["ukupno"]));
    }

    json!({
        "polozi": js::f(round2(polozi)),
        "gotovinskiPromet": js::f(round2(gotovinski_promet)),
        "povrati": js::f(round2(povrati)),
        "gotovinskeReklamacije": js::f(round2(gotovinske_reklamacije)),
        "ocekivanoStanje": js::f(round2(polozi + gotovinski_promet - povrati - gotovinske_reklamacije)),
    })
}

// ─── lib/cash.ts ────────────────────────────────────────────

/// Pošalje UnosNovca/PovratNovca (`cashDeps().send`). U aplikaciji integracija
/// uvijek odgovara, pa status 'skipped' (odgovor `null`) ovdje ne nastaje.
fn send(b: &Backend, tip: &str, iznos: f64) -> Odgovor {
    let result = if tip == "polog" { b.tring.unos_novca(iznos) } else { b.tring.povrat_novca(iznos) };
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] {tip}: {}", js::stringify(&result));
    }
    result
}

fn tring_status(result: &Odgovor) -> &'static str {
    if tring::uspjeh(result) { "ok" } else { "error" }
}

/// `{ id, tringStatus, error? }` — `error` samo kad uređaj nije prihvatio.
fn rezultat(id: Value, tring_status: &str, result: &Odgovor) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), id);
    m.insert("tringStatus".into(), json!(tring_status));
    if !tring::uspjeh(result) {
        let e = js::or(&result["error"], &result["vrstaOdgovora"]);
        if !e.is_null() {
            m.insert("error".into(), e.clone());
        }
    }
    Value::Object(m)
}

/// Evidencija se upisuje i kad printer ne odgovori (tringStatus='error') —
/// fizički novac je već u ladici, pa zapis ne smije ovisiti o štampi.
/// Neuspjelo slanje se ponavlja kroz `retry_cash_movement`.
///
/// Kao `addCashMovement(cashDeps(), data)`: Tring postavke se učitaju prije
/// provjera.
pub fn add_cash_movement(b: &Backend, data: &Value) -> R<Value> {
    b.load_tring_config()?;
    let db = b.baza()?;
    // Sve provjere prije slanja: uređaj je fizički primio/izdao novac čim
    // odgovori, pa upis nakon toga ne smije pasti na CHECK ili FOREIGN KEY.
    let tip = match data["tip"].as_str() {
        Some(t @ ("polog" | "povrat")) => t,
        _ => baci!("Nepoznata vrsta unosa gotovine: {}", js::to_string(&data["tip"])),
    };
    let iznos = round2(to_number(&data["iznos"]));
    if !iznos.is_finite() || iznos <= 0.0 {
        baci!("Iznos mora biti veći od nule");
    }
    if !db.ima("SELECT 1 FROM users WHERE id = ?", p![data["korisnikId"]])? {
        baci!("Korisnik ne postoji");
    }

    let result = send(b, tip, iznos);
    let tring_status = tring_status(&result);

    let r = db.run(
        "INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena) VALUES (?, ?, ?, ?, ?)",
        p![tip, js::f(iznos), data["korisnikId"], tring_status, data["napomena"]],
    )?;

    Ok(rezultat(json!(r.last_insert_rowid), tring_status, &result))
}

pub fn retry_cash_movement(b: &Backend, id: &Value) -> R<Value> {
    b.load_tring_config()?;
    let db = b.baza()?;
    let Some(row) = db.get("SELECT * FROM cash_movements WHERE id = ?", p![id])? else {
        baci!("Zapis ne postoji");
    };
    if row["tringStatus"] != "error" {
        baci!("Samo neuspjela slanja se mogu ponoviti");
    }

    let tip = js::to_string(&row["tip"]);
    let result = send(b, &tip, to_number(&row["iznos"]));
    let tring_status = tring_status(&result);
    db.run("UPDATE cash_movements SET tringStatus = ? WHERE id = ?", p![tring_status, id])?;

    Ok(rezultat(id.clone(), tring_status, &result))
}

pub fn get_today_movements(db: &Db) -> R<Value> {
    db.all(
        "
    SELECT cm.*, u.ime AS korisnikIme
    FROM cash_movements cm
    LEFT JOIN users u ON u.id = cm.korisnikId
    WHERE date(cm.createdAt) = date('now', 'localtime')
    ORDER BY cm.id
  ",
        p![],
    )
    .map(Value::from)
}

/// Iznos zadnjeg unesenog pologa (bilo koji dan) — prijedlog za jutarnji prompt.
pub fn get_last_polog_iznos(db: &Db) -> R<Value> {
    db.val("SELECT iznos FROM cash_movements WHERE tip = 'polog' ORDER BY id DESC LIMIT 1", p![])
}

/// `DrawerState`: `{ polozi, gotovinskiPromet, povrati, gotovinskeReklamacije, ocekivanoStanje }`.
pub fn drawer_state(db: &Db) -> R<Value> {
    let movements = db.all(
        "
    SELECT tip, iznos FROM cash_movements
    WHERE date(createdAt) = date('now', 'localtime')
  ",
        p![],
    )?;

    let prodaje = db.all(
        "
    SELECT nacinPlacanja, ukupno FROM orders
    WHERE date(createdAt) = date('now', 'localtime')
  ",
        p![],
    )?;

    let reklamirani = db.all(
        "
    SELECT nacinPlacanja, ukupno FROM orders
    WHERE refundedAt IS NOT NULL AND date(refundedAt) = date('now', 'localtime')
  ",
        p![],
    )?;

    Ok(ocekivano_stanje(&movements, &prodaje, &reklamirani))
}

// ─── Pokriće za storno (handlers.ts, order:refundAndPrint) ──

/// Override iz UI-ja: manjak se evidentira kao pravi polog (Tring
/// UnosNovca + cash_movements) da uređaj dozvoli gotovinski storno.
pub fn deposit_cash(b: &Backend, iznos: f64, napomena: &str, korisnik_id: &Value) -> R<()> {
    let res = add_cash_movement(
        b,
        &json!({ "tip": "polog", "iznos": js::f(iznos), "korisnikId": js::nn(korisnik_id, &json!(0)), "napomena": napomena }),
    )?;
    if res["tringStatus"] == "error" {
        let e = if res["error"].is_null() { "nepoznata greška".to_string() } else { js::to_string(&res["error"]) };
        baci!("Polog od {} KM nije prihvaćen na printeru: {e}", js::num_str(iznos));
    }
    Ok(())
}

/// Pokriće koje fizički ne ulazi u ladicu — samo brojač uređaja.
pub fn device_cash_in(b: &Backend, iznos: f64) -> R<()> {
    b.load_tring_config()?;
    let res = b.tring.unos_novca(iznos);
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] deviceCashIn: {}", js::stringify(&res));
    }
    if !tring::uspjeh(&res) {
        baci!(
            "Unos novca od {} KM nije prihvaćen na printeru: {}",
            js::num_str(iznos),
            js::to_string(js::or(&res["error"], &res["vrstaOdgovora"]))
        );
    }
    Ok(())
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    if !matches!(kanal, "cash:add" | "cash:retry" | "cash:getToday" | "cash:lastPolog" | "cash:drawerState") {
        return None;
    }
    if let Err(e) = b.otvori_db() {
        return Some(Err(e));
    }
    let b: &Backend = b;
    let db = match b.baza() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "cash:add" => add_cash_movement(b, &a[0]),
        "cash:retry" => retry_cash_movement(b, &a[0]),
        "cash:getToday" => get_today_movements(db),
        "cash:lastPolog" => get_last_polog_iznos(db),
        "cash:drawerState" => drawer_state(db),
        _ => return None,
    })
}
