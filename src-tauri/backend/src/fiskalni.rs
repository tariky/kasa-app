//! Fiskalni niz: brojevi računa, praznine, predviđeni sljedeći BF (`lib/fiskalni.ts`).

use std::collections::HashSet;

use regex::Regex;
use serde_json::Value;

use crate::greska::R;
use crate::js;
use crate::p;
use crate::sql::Db;

/// Broj fiskalnog računa; `None` za reklamacije (R-...), prazno ili nenumeričko.
pub fn parse_fiskalni_broj(raw: &Value) -> Option<i64> {
    if raw.is_null() {
        return None;
    }
    let t = js::to_string(raw);
    let t = t.trim();
    thread_local!(static CIFRE: Regex = Regex::new(r"^[0-9]+$").unwrap());
    if !CIFRE.with(|r| r.is_match(t)) {
        return None;
    }
    js::parse_int(t)
}

pub const MAX_PRAZNINA: usize = 200;

/// Brojevi koji nedostaju strogo između najmanjeg i najvećeg, najviše `max_gaps`.
pub fn izracunaj_praznine(brojevi: &[i64], max_gaps: usize, ignorisani: &HashSet<i64>) -> Vec<i64> {
    let present: HashSet<i64> = brojevi.iter().copied().collect();
    let mut sorted: Vec<i64> = present.iter().copied().collect();
    sorted.sort();
    if sorted.len() < 2 || max_gaps == 0 {
        return vec![];
    }
    let mut gaps = Vec::new();
    let max = *sorted.last().unwrap();
    let mut n = sorted[0] + 1;
    while n < max {
        if !present.contains(&n) && !ignorisani.contains(&n) {
            gaps.push(n);
            if gaps.len() >= max_gaps {
                break;
            }
        }
        n += 1;
    }
    gaps
}

pub const ZADNJI_FISKALNI_KEY: &str = "fiscal.zadnjiBroj";
pub const ZADNJI_FISKALNI_AT_KEY: &str = "fiscal.zadnjiBrojAt";

/// BF sa posljednjeg fiskalizovanog računa (po datumu, ne najveći broj).
pub fn zadnji_fiskalni_racun(db: &Db) -> R<Option<(i64, String)>> {
    let rows = db.all(
        "SELECT brojFiskalnogRacuna, createdAt FROM orders
      WHERE brojFiskalnogRacuna IS NOT NULL
      ORDER BY createdAt DESC, id DESC
      LIMIT 200",
        p![],
    )?;
    for r in rows {
        if let Some(broj) = parse_fiskalni_broj(&r["brojFiskalnogRacuna"]) {
            let at = r["createdAt"].as_str().unwrap_or("").to_string();
            return Ok(Some((broj, at)));
        }
    }
    Ok(None)
}

pub fn zadnji_fiskalni_broj(db: &Db) -> R<Option<i64>> {
    Ok(zadnji_fiskalni_racun(db)?.map(|(b, _)| b))
}

/// Ručno upisan posljednji broj iz postavki.
pub fn zadnji_upisani_fiskalni_broj(db: &Db) -> R<Option<i64>> {
    let v = db.val("SELECT value FROM settings WHERE key = ?", p![ZADNJI_FISKALNI_KEY])?;
    if v.is_null() {
        return Ok(None);
    }
    Ok(js::parse_int(&js::to_string(&v)).filter(|b| *b >= 0))
}

fn zadnji_upis_at(db: &Db) -> R<Option<String>> {
    let v = db.val("SELECT value FROM settings WHERE key = ?", p![ZADNJI_FISKALNI_AT_KEY])?;
    Ok(if v.is_null() { None } else { Some(js::to_string(&v)) })
}

pub fn postavi_zadnji_fiskalni_broj(db: &Db, broj: &Value) -> R<i64> {
    if !js::is_integer(broj) || broj.as_f64().unwrap() < 0.0 {
        crate::baci!("Posljednji fiskalni broj mora biti cijeli broj 0 ili veći");
    }
    let broj = broj.as_f64().unwrap() as i64;
    let upsert = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
    db.run(upsert, p![ZADNJI_FISKALNI_KEY, broj.to_string()])?;
    let sada = db.val("SELECT datetime('now','localtime') AS sada", p![])?;
    db.run(upsert, p![ZADNJI_FISKALNI_AT_KEY, sada])?;
    Ok(broj)
}

/// Broj koji će uređaj po svoj prilici dati sljedećem isječku.
pub fn predvidjeni_fiskalni_broj(db: &Db) -> R<Option<i64>> {
    let racun = zadnji_fiskalni_racun(db)?;
    let upisani = zadnji_upisani_fiskalni_broj(db)?;
    let Some(upisani) = upisani else {
        return Ok(racun.map(|(b, _)| b + 1));
    };
    let Some((broj, created)) = racun else {
        return Ok(Some(upisani + 1));
    };
    let upis_at = zadnji_upis_at(db)?.unwrap_or_default();
    Ok(Some(if upis_at > created { upisani } else { broj } + 1))
}
