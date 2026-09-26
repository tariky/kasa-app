//! Tabela `settings` (`lib/postavke.ts`): čitanje i upis ključa i Tring
//! postavke — jedino mjesto s njenim SQL-om. Ko smije čitati i mijenjati koji
//! ključ odlučuje sesija.rs (pristup.json). I kanali `settings:*`,
//! `savedCarts:*`, `fakturaSkice:*` i `proizvodnja:setEnabled` (handlers.ts,
//! `lib/savedCarts.ts`, `lib/fakturaSkice.ts`, `lib/firma.ts`).

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, is_integer, nn, to_string};
use crate::sql::Db;
use crate::audit::{self, NovaPostavka};
use crate::pristup::pristup;
use crate::kanali::Kanal;
use crate::{baci, p, proizvodnja, Backend};

/// Vrijednost ključa; null kad ključa nema (ili je NULL). TS: `procitajPostavku`.
pub fn procitaj(db: &Db, kljuc: impl Into<Value>) -> R<Value> {
    db.val("SELECT value FROM settings WHERE key = ?", &[kljuc.into()])
}

/// Upiše ključ (INSERT ili prepiše vrijednost). Transakciju otvara pozivalac.
pub fn upisi(db: &Db, kljuc: &str, vrijednost: impl Into<Value>) -> R<()> {
    db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        &[json!(kljuc), vrijednost.into()],
    )?;
    Ok(())
}

/// Postavke fiskalnog uređaja sa zadanim vrijednostima. TS: `procitajTringPostavke`.
pub struct TringPostavke {
    /// Zadano "localhost".
    pub host: Value,
    /// `parseInt(port ?? '8085')`; NaN je null.
    pub port: Value,
    /// `parseInt(operatorId ?? '0')`; NaN je null.
    pub operator_id: Value,
    /// Null kad lozinka nije upisana.
    pub operator_password: Value,
    /// Dnevnik zahtjeva uređaju (`dev.logging`).
    pub logovanje: bool,
}

/// Tring postavke iz baze — za uređaj (stampa.rs) i za ekran Postavki.
pub fn tring(db: &Db) -> R<TringPostavke> {
    let s = grupa(db, "tring.")?;
    let g = |k: &str, zadano: &str| s.get(k).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!(zadano));
    Ok(TringPostavke {
        host: g("host", "localhost"),
        port: js::parse_int_value(&g("port", "8085")),
        operator_id: js::parse_int_value(&g("operatorId", "0")),
        operator_password: s.get("operatorPassword").cloned().unwrap_or(Value::Null),
        logovanje: procitaj(db, "dev.logging")? == "true",
    })
}

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

/// Postavke s prefiksom, bez prefiksa u ključu. TS: `procitajGrupu`.
fn grupa(db: &Db, prefiks: &str) -> R<Map<String, Value>> {
    let mut m = Map::new();
    for r in db.all(&format!("SELECT key, value FROM settings WHERE key LIKE '{prefiks}%'"), p![])? {
        let k = r["key"].as_str().unwrap_or("").replacen(prefiks, "", 1);
        m.insert(k, r["value"].clone());
    }
    Ok(m)
}

fn get_tring(db: &Db) -> R<Value> {
    let t = tring(db)?;
    Ok(json!({
        "host": t.host,
        "port": t.port,
        "operatorId": t.operator_id,
        // Lozinka operatera ne izlazi iz backenda — UI zna samo da li je upisana.
        "imaLozinku": !t.operator_password.is_null() && t.operator_password != "",
    }))
}

fn save_tring(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db();
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
        let promjene = audit::promjene_postavki(|k| procitaj(db, k), &nove, &["tring.operatorPassword"])?;
        for (k, v) in &nove {
            upisi(db, k, v.clone())?;
        }
        if !promjene.is_empty() {
            audit::zabiljezi(b, "postavke:tring", json!({ "promjene": promjene }))?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn get_firma(db: &Db) -> R<Value> {
    let s = grupa(db, "firma.")?;
    let g = |k: &str| s.get(k).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!(""));
    let bank_accounts: Vec<Value> = (1..=3)
        .map(|i| json!({ "bankName": g(&format!("bank{i}.name")), "accountNumber": g(&format!("bank{i}.number")) }))
        .filter(|b| !to_string(&b["bankName"]).trim().is_empty() || !to_string(&b["accountNumber"]).trim().is_empty())
        .collect();
    // `Number(undefined)` je NaN → zadana veličina.
    let logo = s.get("logoVelicina").map(js::to_number).unwrap_or(f64::NAN);
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
    let db = b.db();
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
        let promjene = audit::promjene_postavki(|k| procitaj(db, k), &nove, &["firma.logo"])?;
        for (k, v) in &nove {
            upisi(db, k, v.clone())?;
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
    let db = b.db();
    let Some(nova) = vrijednost.as_str() else {
        baci!("Vrijednost postavke mora biti tekst");
    };
    let k = to_string(kljuc);
    db.tx(|| {
        let stara = procitaj(db, k.as_str())?;
        upisi(db, &k, nova)?;
        if k != "kasa.scanMode" && stara != nova {
            audit::zabiljezi(b, "postavke:set", json!({ "kljuc": k, "staraVrijednost": stara, "novaVrijednost": nova }))?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn set_enabled(b: &Backend, enabled: &Value) -> R<Value> {
    let db = b.db();
    let nova = to_string(enabled);
    db.tx(|| {
        let stara = procitaj(db, "proizvodnja.enabled")?;
        upisi(db, "proizvodnja.enabled", nova.as_str())?;
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
    if js::length(items).is_none_or(|n| n == 0) {
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

/// `settings:get` — tajne postavke se ne vraćaju (null).
fn get(db: &Db, kljuc: &Value) -> R<Value> {
    match kljuc.as_str() {
        Some(k) if pristup().tajne_postavke.contains(k) => Ok(Value::Null),
        _ => procitaj(db, kljuc.clone()),
    }
}

fn uspjesno(r: R<crate::sql::Run>) -> R<Value> {
    r.map(|_| json!({ "success": true }))
}

pub const KANALI: &[Kanal] = &[
    Kanal { ime: "settings:getTring", h: |b, _| get_tring(b.db()) },
    Kanal { ime: "settings:saveTring", h: |b, a| save_tring(b, &a[0]) },
    Kanal { ime: "settings:getFirma", h: |b, _| get_firma(b.db()) },
    Kanal { ime: "settings:get", h: |b, a| get(b.db(), &a[0]) },
    Kanal { ime: "settings:set", h: |b, a| set(b, &a[0], &a[1]) },
    Kanal { ime: "settings:saveFirma", h: |b, a| save_firma(b, &a[0]) },
    Kanal { ime: "savedCarts:list", h: |b, _| b.db().all("SELECT * FROM saved_carts ORDER BY id DESC", p![]).map(Value::from) },
    Kanal { ime: "savedCarts:save", h: |b, a| save_cart(b.db(), &a[0], &a[1], &a[2]) },
    Kanal { ime: "savedCarts:delete", h: |b, a| uspjesno(b.db().run("DELETE FROM saved_carts WHERE id = ?", p![a[0]])) },
    Kanal {
        ime: "fakturaSkice:list",
        h: |b, _| b.db().all("SELECT * FROM faktura_skice ORDER BY spremljeno DESC, id DESC", p![]).map(Value::from),
    },
    Kanal { ime: "fakturaSkice:save", h: |b, a| spremi_skicu_fakture(b.db(), &a[0], &a[1], &a[2], &a[3]) },
    Kanal { ime: "fakturaSkice:delete", h: |b, a| uspjesno(b.db().run("DELETE FROM faktura_skice WHERE id = ?", p![a[0]])) },
    Kanal { ime: "proizvodnja:setEnabled", h: |b, a| set_enabled(b, &a[0]) },
];
