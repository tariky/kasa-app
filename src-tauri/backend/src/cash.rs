//! Kanali `cash:*` (handlers.ts) i logika iz `lib/cash.ts` i `lib/drawer.ts`.
//!
//! Evidencija gotovine (polog/povrat) ide kroz Tring UnosNovca/PovratNovca;
//! očekivano stanje ladice koristi i storno (`order:refundAndPrint`), pa su
//! [`drawer_state`], [`deposit_cash`] i [`device_cash_in`] izloženi za `storno.rs`.

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, round2, to_number};
use crate::sql::Db;
use crate::stampa::Uredjaj;
use crate::tring::{self, Odgovor};
use crate::kanali::Kanal;
use crate::{baci, p, provjera_racuna, sesija, Backend};

// ─── lib/drawer.ts ──────────────────────────────────────────

/// Gotovinski dio jednog računa, čitan istim parserom kao izvoz knjigovođi
/// (`raspodjela_placanja`): tekst ('Gotovina', 'Kartica'...) — gotovina je puni
/// iznos ili ništa — ili JSON `{gotovina, kartica, ...}` s razbijenim iznosima.
/// Nepoznat oblik ne nosi gotovinu (izvoz ga označi kao nepoznat).
pub fn gotovinski_iznos(nacin_placanja: &Value, ukupno: f64) -> f64 {
    provjera_racuna::raspodjela_placanja(&js::to_string(nacin_placanja), ukupno).map_or(0.0, |p| p.gotovina)
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
fn send(uredjaj: &Uredjaj, tip: &str, iznos: f64) -> Odgovor {
    if tip == "polog" { uredjaj.unos_novca(tip, iznos) } else { uredjaj.povrat_novca(tip, iznos) }
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
    let uredjaj = Uredjaj::iz_postavki(b)?;
    let db = b.db();
    // Sve provjere prije slanja: uređaj je fizički primio/izdao novac čim
    // odgovori, pa upis nakon toga ne smije pasti na CHECK ili FOREIGN KEY.
    let tip = match data["tip"].as_str() {
        Some(t @ ("polog" | "povrat")) => t,
        _ => baci!("Nepoznata vrsta unosa gotovine: {}", js::to_string(&data["tip"])),
    };
    let iznos = js::round2_js(&data["iznos"]);
    if !iznos.is_finite() || iznos <= 0.0 {
        baci!("Iznos mora biti veći od nule");
    }
    if !db.ima("SELECT 1 FROM users WHERE id = ?", p![data["korisnikId"]])? {
        baci!("Korisnik ne postoji");
    }

    let result = send(&uredjaj, tip, iznos);
    let tring_status = tring_status(&result);

    let r = db.run(
        "INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena) VALUES (?, ?, ?, ?, ?)",
        p![tip, js::f(iznos), data["korisnikId"], tring_status, data["napomena"]],
    )?;

    Ok(rezultat(json!(r.last_insert_rowid), tring_status, &result))
}

pub fn retry_cash_movement(b: &Backend, id: &Value) -> R<Value> {
    let uredjaj = Uredjaj::iz_postavki(b)?;
    let db = b.db();
    let Some(row) = db.get("SELECT * FROM cash_movements WHERE id = ?", p![id])? else {
        baci!("Zapis ne postoji");
    };
    if row["tringStatus"] != "error" {
        baci!("Samo neuspjela slanja se mogu ponoviti");
    }

    let tip = js::to_string(&row["tip"]);
    let result = send(&uredjaj, &tip, to_number(&row["iznos"]));
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
    let res = Uredjaj::iz_postavki(b)?.unos_novca("deviceCashIn", iznos);
    if !tring::uspjeh(&res) {
        baci!(
            "Unos novca od {} KM nije prihvaćen na printeru: {}",
            js::num_str(iznos),
            js::to_string(js::or(&res["error"], &res["vrstaOdgovora"]))
        );
    }
    Ok(())
}

pub const KANALI: &[Kanal] = &[
    Kanal {
        ime: "cash:add",
        h: |b, a| sesija::korisnik(b).and_then(|k| add_cash_movement(b, &sesija::sa_korisnikom(&a[0], k.id))),
    },
    Kanal { ime: "cash:retry", h: |b, a| retry_cash_movement(b, &a[0]) },
    Kanal { ime: "cash:getToday", h: |b, _| get_today_movements(b.db()) },
    Kanal { ime: "cash:lastPolog", h: |b, _| get_last_polog_iznos(b.db()) },
    Kanal { ime: "cash:drawerState", h: |b, _| drawer_state(b.db()) },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gotovina_iz_starih_zapisa() {
        let g = |n: &str, ukupno: f64| gotovinski_iznos(&json!(n), ukupno);
        assert_eq!(g("Gotovina", 25.5), 25.5);
        assert_eq!(g("gotovina", 25.5), 25.5);
        assert_eq!(g(" Gotovina ", 25.5), 25.5);
        assert_eq!(g(r#"{"Gotovina":5,"kartica":3}"#, 8.0), 5.0);
        assert_eq!(g("cek", 100.0), 0.0);
        assert_eq!(g("Kartica", 25.5), 0.0);
        assert_eq!(g("Bitcoin", 100.0), 0.0);
        assert_eq!(g(r#"{"gotovina":5,"zlato":3}"#, 8.0), 0.0);
        assert_eq!(g(r#"{"gotovina":5,"constructor":3}"#, 8.0), 0.0);
        assert_eq!(gotovinski_iznos(&Value::Null, 8.0), 0.0);

        let stanje = ocekivano_stanje(
            &[],
            &[json!({ "nacinPlacanja": "gotovina", "ukupno": 10 }), json!({ "nacinPlacanja": r#"{"Gotovina":5,"kartica":3}"#, "ukupno": 8 })],
            &[json!({ "nacinPlacanja": " Gotovina ", "ukupno": 4 })],
        );
        assert_eq!(stanje["gotovinskiPromet"], json!(15));
        assert_eq!(stanje["gotovinskeReklamacije"], json!(4));
        assert_eq!(stanje["ocekivanoStanje"], json!(11));
    }
}
