//! Kanali `settings:*`, `savedCarts:*`, `fakturaSkice:*` i `proizvodnja:setEnabled`
//! (handlers.ts, `lib/savedCarts.ts`, `lib/fakturaSkice.ts`, `lib/firma.ts`).

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, is_integer, nn, to_string};
use crate::sql::Db;
use crate::audit::{self, NovaPostavka};
use crate::sesija::TAJNE_POSTAVKE;
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
        // Lozinka operatera ne izlazi iz backenda — UI zna samo da li je upisana.
        "imaLozinku": s.get("operatorPassword").is_some_and(|v| !v.is_null() && v != ""),
    }))
}

/// `postavka(key)` — vrijednost ili null.
fn postavka(db: &Db, kljuc: &str) -> R<Value> {
    db.val("SELECT value FROM settings WHERE key = ?", p![kljuc])
}

fn save_tring(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db()?;
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
    let mut nove: Vec<NovaPostavka> = vec![
        ("tring.host".into(), Some(data["host"].clone())),
        ("tring.port".into(), Some(json!(to_string(&data["port"])))),
        ("tring.operatorId".into(), Some(json!(to_string(&data["operatorId"])))),
    ];
    // Prazna lozinka = stara ostaje (UI je ne zna, pa je ni ne šalje nazad).
    if data["operatorPassword"].as_str().is_some_and(|l| !l.is_empty()) {
        nove.push(("tring.operatorPassword".into(), Some(data["operatorPassword"].clone())));
    }
    db.tx(|| {
        // Audit: lozinka samo kao "promijenjena", nikad vrijednost.
        let promjene = audit::promjene_postavki(|k| postavka(db, k), &nove, &["tring.operatorPassword"])?;
        for (k, v) in &nove {
            db.run(UPSERT, p![k, v])?;
        }
        if !promjene.is_empty() {
            audit::zabiljezi(b, "postavke:tring", json!({ "promjene": promjene }))?;
        }
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

fn save_firma(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db()?;
    // `data.naziv` koji nije poslan je `undefined` (None): upisuje se kao null,
    // a za audit je uvijek promjena.
    let polje = |k: &str| js::has(data, k).then(|| data[k].clone());
    let mut nove: Vec<NovaPostavka> = ["naziv", "adresa", "grad", "idBroj", "pdvBroj", "skladiste", "logo"]
        .into_iter()
        .map(|k| (format!("firma.{k}"), polje(k)))
        .collect();
    nove.push(("firma.web".into(), Some(nn(&data["web"], &json!("")).clone())));
    nove.push(("firma.email".into(), Some(nn(&data["email"], &json!("")).clone())));
    nove.push(("firma.logoVelicina".into(), Some(json!(js::num_str(logo_velicina(&data["logoVelicina"]))))));
    nove.push(("firma.ziroRacuniPozicija".into(), Some(json!(ziro_racuni_pozicija(&data["ziroRacuniPozicija"])))));
    let accounts = data["bankAccounts"].as_array().cloned().unwrap_or_default();
    for i in 0..3 {
        let a = accounts.get(i).filter(|a| !a.is_null()).cloned().unwrap_or_else(|| json!({ "bankName": "", "accountNumber": "" }));
        nove.push((format!("firma.bank{}.name", i + 1), Some(nn(&a["bankName"], &json!("")).clone())));
        nove.push((format!("firma.bank{}.number", i + 1), Some(nn(&a["accountNumber"], &json!("")).clone())));
    }
    db.tx(|| {
        // Audit: stara i nova vrijednost promijenjenih ključeva; logo (slika) samo kao "promijenjen".
        let promjene = audit::promjene_postavki(|k| postavka(db, k), &nove, &["firma.logo"])?;
        for (k, v) in &nove {
            db.run(UPSERT, p![k, v.clone().unwrap_or(Value::Null)])?;
        }
        if !promjene.is_empty() {
            audit::zabiljezi(b, "postavke:firma", json!({ "promjene": promjene }))?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

/// `settings:set` — ključ je već prošao allowlistu i provjeru uloge (sesija.rs).
/// Audit: svaka promjena vrijednosti osim kasa.scanMode (prekidač skenera na
/// kasi, F2 — UI izbor kasira, ne postavka programa).
fn set(b: &Backend, kljuc: &Value, vrijednost: &Value) -> R<Value> {
    let db = b.db()?;
    let Some(nova) = vrijednost.as_str() else {
        baci!("Vrijednost postavke mora biti tekst");
    };
    let k = to_string(kljuc);
    db.tx(|| {
        let stara = postavka(db, &k)?;
        db.run(UPSERT, p![kljuc, nova])?;
        if k != "kasa.scanMode" && stara != nova {
            audit::zabiljezi(b, "postavke:set", json!({ "kljuc": k, "staraVrijednost": stara, "novaVrijednost": nova }))?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn set_enabled(b: &Backend, enabled: &Value) -> R<Value> {
    let db = b.db()?;
    let nova = to_string(enabled);
    db.tx(|| {
        let stara = postavka(db, "proizvodnja.enabled")?;
        db.run(UPSERT, p!["proizvodnja.enabled", nova])?;
        if stara != nova.as_str() {
            audit::zabiljezi(
                b,
                "postavke:set",
                json!({ "kljuc": "proizvodnja.enabled", "staraVrijednost": stara, "novaVrijednost": nova }),
            )?;
        }
        if js::truthy(enabled) {
            proizvodnja::osiguraj_prodajnu_uslugu(db)?;
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
        "settings:saveTring" => save_tring(b, &a[0]),
        "settings:getFirma" => get_firma(db),
        "settings:saveFirma" => save_firma(b, &a[0]),
        "settings:get" => match a[0].as_str() {
            Some(k) if TAJNE_POSTAVKE.contains(&k) => Ok(Value::Null),
            _ => db.val("SELECT value FROM settings WHERE key = ?", p![a[0]]),
        },
        "settings:set" => set(b, &a[0], &a[1]),
        "savedCarts:list" => db.all("SELECT * FROM saved_carts ORDER BY id DESC", p![]).map(Value::from),
        "savedCarts:save" => save_cart(db, &a[0], &a[1], &a[2]),
        "savedCarts:delete" => db.run("DELETE FROM saved_carts WHERE id = ?", p![a[0]]).map(|_| json!({ "success": true })),
        "fakturaSkice:list" => db.all("SELECT * FROM faktura_skice ORDER BY spremljeno DESC, id DESC", p![]).map(Value::from),
        "fakturaSkice:save" => spremi_skicu_fakture(db, &a[0], &a[1], &a[2], &a[3]),
        "fakturaSkice:delete" => db.run("DELETE FROM faktura_skice WHERE id = ?", p![a[0]]).map(|_| json!({ "success": true })),
        "proizvodnja:setEnabled" => set_enabled(b, &a[0]),
        _ => return None,
    })
}
