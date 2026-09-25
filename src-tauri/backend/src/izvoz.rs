//! Kanal `izvoz:knjigovodja` (handlers.ts → `lib/knjigovodja/podaci.ts`):
//! sirovi redovi za izvoz knjigovođi. SQL se ne prepisuje — čita se iz
//! `src/lib/knjigovodja/upiti.ts`, pa su upiti isti u oba backenda.

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::greska::R;
use crate::sql::Db;
use crate::{baci, Args, Backend};

const UPITI_TS: &str = include_str!("../../../src/lib/knjigovodja/upiti.ts");

/// (ime, sql) redom iz `UPITI`: tekst između backtickova je SQL, a ime je
/// identifikator ispred `:` neposredno prije njega.
fn upiti() -> &'static [(String, String)] {
    static U: OnceLock<Vec<(String, String)>> = OnceLock::new();
    U.get_or_init(|| {
        let dijelovi: Vec<&str> = UPITI_TS.split('`').collect();
        (1..dijelovi.len())
            .step_by(2)
            .map(|i| {
                let prije = dijelovi[i - 1].trim_end().trim_end_matches(':').trim_end();
                let ime: String = prije
                    .chars()
                    .rev()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                (ime, dijelovi[i].to_string())
            })
            .collect()
    })
}

/// `YYYY-MM-DD` (samo oblik, kao regex u podaci.ts).
fn datum(v: &Value) -> Option<&str> {
    let s = v.as_str()?;
    let b = s.as_bytes();
    let ok = b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
    ok.then_some(s)
}

/// Parametri `:od`/`:do` pozicijski, redom kojim se prvi put javljaju u upitu
/// (SQLite im tim redom dodjeljuje indekse).
fn parametri(sql: &str, od: &str, do_: &str) -> Vec<Value> {
    let mut p: Vec<(usize, &str)> = [(":od", od), (":do", do_)]
        .into_iter()
        .filter_map(|(ime, v)| sql.find(ime).map(|i| (i, v)))
        .collect();
    p.sort();
    p.into_iter().map(|(_, v)| Value::from(v)).collect()
}

fn knjigovodja(db: &Db, od: &Value, do_: &Value) -> R<Value> {
    let (Some(od), Some(do_)) = (datum(od), datum(do_)) else {
        baci!("Neispravan period");
    };
    if od > do_ {
        baci!("Neispravan period");
    }
    let mut out = Map::new();
    out.insert("od".into(), od.into());
    out.insert("do".into(), do_.into());
    for (ime, sql) in upiti() {
        out.insert(ime.clone(), Value::from(db.all(sql, &parametri(sql, od, do_))?));
    }
    Ok(Value::Object(out))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "izvoz:knjigovodja" => knjigovodja(db, &a[0], &a[1]),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upiti_iz_ts_fajla() {
        let imena: Vec<&str> = upiti().iter().map(|(i, _)| i.as_str()).collect();
        assert_eq!(
            imena,
            ["racuni", "reklamacije", "stavkeRacuna", "primke", "primkaStavke", "nivelacije", "kretanjaNovca", "utrosak", "zalihe"]
        );
        assert!(upiti().iter().all(|(_, sql)| sql.contains("SELECT")));
    }

    #[test]
    fn parametri_redom_pojavljivanja() {
        assert_eq!(parametri("a :od b :do c :od", "x", "y"), vec![Value::from("x"), Value::from("y")]);
        assert_eq!(parametri("a :do", "x", "y"), vec![Value::from("y")]);
    }

    #[test]
    fn oblik_datuma() {
        assert_eq!(datum(&Value::from("2026-09-01")), Some("2026-09-01"));
        assert_eq!(datum(&Value::from("2026-9-01")), None);
        assert_eq!(datum(&Value::Null), None);
    }
}
