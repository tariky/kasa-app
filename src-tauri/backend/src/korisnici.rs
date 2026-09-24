//! Kanali `user:*` (handlers.ts) i pravila iz `lib/korisnici.ts`.

use regex::Regex;
use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, has};
use crate::sql::Db;
use crate::{baci, p, Args, Backend};

pub const ULOGE: [&str; 2] = ["admin", "kasir"];

/// Tabele s FK na users(id) — korisnik s ijednim redom u njima ne može biti obrisan.
pub const VEZE_KORISNIKA: [(&str, &str); 5] = [
    ("orders", "Korisnik ima račune i ne može biti obrisan"),
    ("pending_receipts", "Korisnik ima račun u obradi i ne može biti obrisan"),
    ("cash_movements", "Korisnik ima pologe/povrate gotovine i ne može biti obrisan"),
    ("ponude", "Korisnik ima ponude i ne može biti obrisan"),
    ("radni_nalozi", "Korisnik ima radne naloge i ne može biti obrisan"),
];

/// Baca grešku ako PIN nije niz od najmanje 4 cifre.
pub fn validiraj_pin(pin: &Value) -> R<&str> {
    if pin.is_null() || pin.as_str().is_some_and(|s| s.trim().is_empty()) {
        baci!("PIN je obavezan");
    }
    thread_local!(static CIFRE: Regex = Regex::new(r"^\d+$").unwrap());
    let Some(s) = pin.as_str().filter(|s| CIFRE.with(|r| r.is_match(s))) else {
        baci!("PIN smije sadržavati samo cifre");
    };
    // JS `length` broji UTF-16 jedinice; cifre su ASCII.
    if s.len() < 4 {
        baci!("PIN mora imati najmanje 4 cifre");
    }
    Ok(s)
}

pub fn validiraj_ulogu(uloga: &Value) -> R<&str> {
    match uloga.as_str() {
        Some(u) if ULOGE.contains(&u) => Ok(u),
        _ => baci!("Uloga mora biti \"admin\" ili \"kasir\""),
    }
}

/// Admin koji je jedini admin u bazi — ne smije se obrisati ni degradirati.
fn je_posljednji_admin(db: &Db, id: &Value) -> R<bool> {
    if db.val("SELECT uloga FROM users WHERE id = ?", p![id])? != "admin" {
        return Ok(false);
    }
    Ok(db.val("SELECT COUNT(*) AS n FROM users WHERE uloga = 'admin'", p![])?.as_i64().unwrap_or(0) <= 1)
}

fn login(db: &Db, pin: &Value) -> R<Value> {
    Ok(db.get("SELECT id, ime, pin, uloga FROM users WHERE pin = ?", p![pin])?.unwrap_or(Value::Null))
}

fn verify_admin_pin(db: &Db, pin: &Value) -> R<Value> {
    let Some(user) = db.get("SELECT id, ime FROM users WHERE pin = ? AND uloga = 'admin'", p![pin])? else {
        baci!("Neispravan admin PIN");
    };
    Ok(json!({ "success": true, "ime": user["ime"] }))
}

fn create(db: &Db, data: &Value) -> R<Value> {
    if js::blank(&data["ime"]) {
        baci!("Ime korisnika je obavezno");
    }
    let pin = validiraj_pin(&data["pin"])?;
    let uloga = validiraj_ulogu(&data["uloga"])?;
    if db.ima("SELECT id FROM users WHERE pin = ?", p![pin])? {
        baci!("Korisnik sa PIN-om \"{pin}\" već postoji");
    }
    let r = db.run("INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)", p![js::trim(&data["ime"]), pin, uloga])?;
    Ok(json!({ "id": r.last_insert_rowid }))
}

fn update(db: &Db, id: &Value, data: &Value) -> R<Value> {
    let mut fields: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if has(data, "ime") && !data["ime"].is_null() {
        if js::blank(&data["ime"]) {
            baci!("Ime korisnika je obavezno");
        }
        fields.push("ime = ?");
        values.push(json!(js::trim(&data["ime"])));
    }
    if has(data, "pin") && !data["pin"].is_null() {
        let pin = validiraj_pin(&data["pin"])?;
        if db.ima("SELECT id FROM users WHERE pin = ? AND id != ?", p![pin, id])? {
            baci!("Korisnik sa PIN-om \"{pin}\" već postoji");
        }
        fields.push("pin = ?");
        values.push(json!(pin));
    }
    if has(data, "uloga") && !data["uloga"].is_null() {
        let uloga = validiraj_ulogu(&data["uloga"])?;
        if uloga != "admin" && je_posljednji_admin(db, id)? {
            baci!("Posljednji administrator ne može postati kasir");
        }
        fields.push("uloga = ?");
        values.push(json!(uloga));
    }

    if fields.is_empty() {
        return Ok(json!({ "changes": 0 }));
    }
    values.push(id.clone());
    let r = db.run(&format!("UPDATE users SET {} WHERE id = ?", fields.join(", ")), &values)?;
    Ok(json!({ "changes": r.changes }))
}

fn delete(db: &Db, id: &Value) -> R<Value> {
    for (tabela, poruka) in VEZE_KORISNIKA {
        if db.ima(&format!("SELECT 1 FROM {tabela} WHERE korisnikId = ? LIMIT 1"), p![id])? {
            baci!("{poruka}");
        }
    }
    if je_posljednji_admin(db, id)? {
        baci!("Posljednji administrator ne može biti obrisan");
    }
    let r = db.run("DELETE FROM users WHERE id = ?", p![id])?;
    Ok(json!({ "changes": r.changes }))
}

pub fn obradi(b: &mut Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "user:login" => login(db, &a[0]),
        "user:verifyAdminPin" => verify_admin_pin(db, &a[0]),
        "user:getAll" => db.all("SELECT * FROM users ORDER BY ime", p![]).map(Value::from),
        "user:create" => create(db, &a[0]),
        "user:update" => update(db, &a[0], &a[1]),
        "user:delete" => delete(db, &a[0]),
        _ => return None,
    })
}
