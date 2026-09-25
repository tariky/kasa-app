//! Kanali `settings:*`, `savedCarts:*`, `fakturaSkice:*` i `proizvodnja:setEnabled`
//! (handlers.ts, `lib/savedCarts.ts`, `lib/fakturaSkice.ts`, `lib/firma.ts`).

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, is_integer, nn, to_string};
use crate::sql::Db;
use crate::{baci, p, proizvodnja, Args, Backend};

const UPSERT: &str = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

/// Stranica loga u PDF tačkama (`LOGO_VELICINA` iz lib/firma.ts).
const LOGO_MIN: f64 = 40.0;
const LOGO_MAX: f64 = 200.0;
const LOGO_ZADANO: f64 = 100.0;

pub fn logo_velicina(v: &Value) -> f64 {
    match v.as_f64() {
        Some(x) if x.is_finite() => js::js_round(x).clamp(LOGO_MIN, LOGO_MAX),
        _ => LOGO_ZADANO,
    }
}

/// `ziroRacuniPozicija` iz lib/firma.ts: sve osim "podnozje" je zaglavlje.
pub fn ziro_racuni_pozicija(v: &Value) -> &'static str {
    if v.as_str() == Some("podnozje") { "podnozje" } else { "zaglavlje" }
}

/// Postavke s prefiksom, bez prefiksa u ključu.
fn sa_prefiksom(db: &Db, prefiks: &str) -> R<Map<String, Value>> {
    let mut m = Map::new();
    for r in db.all(&format!("SELECT key, value FROM settings WHERE key LIKE '{prefiks}%'"), p![])? {
        let k = r["key"].as_str().unwrap_or("").replacen(prefiks, "", 1);
        m.insert(k, r["value"].clone());
    }
    Ok(m)
}

fn get_tring(db: &Db) -> R<Value> {
    let s = sa_prefiksom(db, "tring.")?;
    let g = |k: &str, zadano: &str| s.get(k).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!(zadano));
    Ok(json!({
        "host": g("host", "localhost"),
        "port": js::parse_int_value(&g("port", "8085")),
        "operatorId": js::parse_int_value(&g("operatorId", "0")),
        "operatorPassword": g("operatorPassword", "0"),
    }))
}

fn save_tring(db: &Db, data: &Value) -> R<Value> {
    if js::blank(&data["host"]) {
        baci!("Host je obavezan");
    }
    let port = data["port"].as_f64();
    if !is_integer(&data["port"]) || port < Some(1.0) || port > Some(65535.0) {
        baci!("Port mora biti cijeli broj između 1 i 65535");
    }
    if !is_integer(&data["operatorId"]) || data["operatorId"].as_f64() < Some(0.0) {
        baci!("Operator ID mora biti nenegativan cijeli broj");
    }
    db.tx(|| {
        db.run(UPSERT, p!["tring.host", data["host"]])?;
        db.run(UPSERT, p!["tring.port", to_string(&data["port"])])?;
        db.run(UPSERT, p!["tring.operatorId", to_string(&data["operatorId"])])?;
        db.run(UPSERT, p!["tring.operatorPassword", data["operatorPassword"]])?;
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn get_firma(db: &Db) -> R<Value> {
    let s = sa_prefiksom(db, "firma.")?;
    let g = |k: &str| s.get(k).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!(""));
    let bank_accounts: Vec<Value> = (1..=3)
        .map(|i| json!({ "bankName": g(&format!("bank{i}.name")), "accountNumber": g(&format!("bank{i}.number")) }))
        .filter(|b| !to_string(&b["bankName"]).trim().is_empty() || !to_string(&b["accountNumber"]).trim().is_empty())
        .collect();
    // `Number(undefined)` je NaN → zadana veličina.
    let logo = s.get("logoVelicina").map(|v| js::to_number(v)).unwrap_or(f64::NAN);
    Ok(json!({
        "naziv": g("naziv"),
        "adresa": g("adresa"),
        "grad": g("grad"),
        "idBroj": g("idBroj"),
        "pdvBroj": g("pdvBroj"),
        "skladiste": g("skladiste"),
        "web": g("web"),
        "email": g("email"),
        "logo": g("logo"),
        "logoVelicina": js::f(logo_velicina(&js::f(logo))),
        "ziroRacuniPozicija": ziro_racuni_pozicija(s.get("ziroRacuniPozicija").unwrap_or(&Value::Null)),
        "bankAccounts": bank_accounts,
    }))
}

fn save_firma(db: &Db, data: &Value) -> R<Value> {
    db.tx(|| {
        for k in ["naziv", "adresa", "grad", "idBroj", "pdvBroj", "skladiste", "logo"] {
            db.run(UPSERT, p![format!("firma.{k}"), data[k]])?;
        }
        db.run(UPSERT, p!["firma.web", nn(&data["web"], &json!(""))])?;
        db.run(UPSERT, p!["firma.email", nn(&data["email"], &json!(""))])?;
        db.run(UPSERT, p!["firma.logoVelicina", js::num_str(logo_velicina(&data["logoVelicina"]))])?;
        db.run(UPSERT, p!["firma.ziroRacuniPozicija", ziro_racuni_pozicija(&data["ziroRacuniPozicija"])])?;

        let accounts = data["bankAccounts"].as_array().cloned().unwrap_or_default();
        for i in 0..3 {
            let a = accounts.get(i).filter(|a| !a.is_null()).cloned().unwrap_or_else(|| json!({ "bankName": "", "accountNumber": "" }));
            db.run(UPSERT, p![format!("firma.bank{}.name", i + 1), nn(&a["bankName"], &json!(""))])?;
            db.run(UPSERT, p![format!("firma.bank{}.number", i + 1), nn(&a["accountNumber"], &json!(""))])?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn save_cart(db: &Db, naziv: &Value, items: &Value, ukupno: &Value) -> R<Value> {
    if js::length(items).map_or(true, |n| n == 0) {
        baci!("Košarica je prazna");
    }
    let r = db.run("INSERT INTO saved_carts (naziv, items, ukupno) VALUES (?, ?, ?)", p![naziv, js::stringify(items), ukupno])?;
    Ok(json!(r.last_insert_rowid))
}

/// `spremiSkicuFakture`: s id-em prepisuje skicu, a ako je obrisana, nastaje nova.
fn spremi_skicu_fakture(db: &Db, id: &Value, naziv: &Value, podaci: &Value, ukupno: &Value) -> R<Value> {
    if !podaci.is_object() {
        baci!("Skica je prazna");
    }
    let json = js::stringify(podaci);
    if !id.is_null() {
        let r = db.run(
            "UPDATE faktura_skice SET naziv = ?, podaci = ?, ukupno = ?, spremljeno = datetime('now','localtime') WHERE id = ?",
            p![naziv, json.clone(), ukupno, id],
        )?;
        if r.changes > 0 {
            return Ok(id.clone());
        }
    }
    let r = db.run("INSERT INTO faktura_skice (naziv, podaci, ukupno) VALUES (?, ?, ?)", p![naziv, json, ukupno])?;
    Ok(json!(r.last_insert_rowid))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "settings:getTring" => get_tring(db),
        "settings:saveTring" => save_tring(db, &a[0]),
        "settings:getFirma" => get_firma(db),
        "settings:saveFirma" => save_firma(db, &a[0]),
        "settings:get" => db.val("SELECT value FROM settings WHERE key = ?", p![a[0]]),
        "settings:set" => db.run(UPSERT, p![a[0], a[1]]).map(|_| json!({ "success": true })),
        "savedCarts:list" => db.all("SELECT * FROM saved_carts ORDER BY id DESC", p![]).map(Value::from),
        "savedCarts:save" => save_cart(db, &a[0], &a[1], &a[2]),
        "savedCarts:delete" => db.run("DELETE FROM saved_carts WHERE id = ?", p![a[0]]).map(|_| json!({ "success": true })),
        "fakturaSkice:list" => db.all("SELECT * FROM faktura_skice ORDER BY spremljeno DESC, id DESC", p![]).map(Value::from),
        "fakturaSkice:save" => spremi_skicu_fakture(db, &a[0], &a[1], &a[2], &a[3]),
        "fakturaSkice:delete" => db.run("DELETE FROM faktura_skice WHERE id = ?", p![a[0]]).map(|_| json!({ "success": true })),
        "proizvodnja:setEnabled" => (|| {
            db.run(UPSERT, p!["proizvodnja.enabled", to_string(&a[0])])?;
            if js::truthy(&a[0]) {
                proizvodnja::osiguraj_prodajnu_uslugu(db)?;
            }
            Ok(json!({ "success": true }))
        })(),
        _ => return None,
    })
}
