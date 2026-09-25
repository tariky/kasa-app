//! Audit log (tabela `audit_log`, `lib/audit.ts`): trag osjetljivih radnji.
//! Samo upis — nijedan kanal ga ne čita, ne mijenja i ne briše. Pozivalac
//! bira akciju i detalje; ovdje je samo zaštitna mreža da PIN, lozinka ili heš
//! nikad ne uđu u detalje.

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js;
use crate::sql::Db;
use crate::{p, Backend};

/// Tekst koji liči na heš PIN-a (korisnici.rs) se zamijeni ovim.
pub const SKRIVENO: &str = "[skriveno]";

/// Ključevi koji se izbacuju iz detalja, na bilo kojoj dubini.
fn tajni_kljuc(k: &str) -> bool {
    thread_local!(static TAJNI: Regex = Regex::new(r"(?i)^(pin|adminPin|operatorPassword|lozinka|password)$").unwrap());
    TAJNI.with(|r| r.is_match(k))
}

fn ocisti(v: &Value) -> Value {
    match v {
        Value::String(s) if s.starts_with("pbkdf2$") => json!(SKRIVENO),
        Value::Array(a) => Value::Array(a.iter().map(ocisti).collect()),
        Value::Object(m) => Value::Object(m.iter().filter(|(k, _)| !tajni_kljuc(k)).map(|(k, x)| (k.clone(), ocisti(x))).collect()),
        other => other.clone(),
    }
}

/// Upiše jednu radnju. `korisnik_id` je prijavljeni korisnik (None = niko).
pub fn zapisi(db: &Db, korisnik_id: Option<i64>, akcija: &str, detalji: Value) -> R<()> {
    db.run(
        "INSERT INTO audit_log (korisnikId, akcija, detalji) VALUES (?, ?, ?)",
        p![korisnik_id, akcija, js::stringify(&ocisti(&detalji))],
    )?;
    Ok(())
}

/// Trag radnje s prijavljenim korisnikom iz sesije, u aktivnu bazu.
pub fn zabiljezi(b: &Backend, akcija: &str, detalji: Value) -> R<()> {
    zapisi(b.db()?, b.sesija.id(), akcija, detalji)
}

/// Nova vrijednost postavke; `None` = JS `undefined` (polje nije poslano).
pub type NovaPostavka = (String, Option<Value>);

/// JS `a === b` za vrijednost postavke (tekst iz baze ili null) i novu vrijednost.
fn isto(stara: &Value, nova: &Option<Value>) -> bool {
    match nova {
        None => false,
        Some(n) => match (stara.as_f64(), n.as_f64()) {
            (Some(x), Some(y)) => x == y,
            _ => stara == n,
        },
    }
}

/// Promjene postavki za audit: samo ključevi čija se vrijednost promijenila,
/// redom kako su dati. Za ključeve iz `bez_vrijednosti` ide samo
/// `{ kljuc, promijenjena: true }` (lozinka, logo).
pub fn promjene_postavki(
    stare: impl Fn(&str) -> R<Value>,
    nove: &[NovaPostavka],
    bez_vrijednosti: &[&str],
) -> R<Vec<Value>> {
    let mut promjene = Vec::new();
    for (kljuc, nova) in nove {
        let stara = stare(kljuc)?;
        if isto(&stara, nova) {
            continue;
        }
        let mut m = Map::new();
        m.insert("kljuc".into(), json!(kljuc));
        if bez_vrijednosti.contains(&kljuc.as_str()) {
            m.insert("promijenjena".into(), json!(true));
        } else {
            m.insert("staraVrijednost".into(), stara);
            // `undefined` JSON.stringify izostavlja.
            if let Some(n) = nova {
                m.insert("novaVrijednost".into(), n.clone());
            }
        }
        promjene.push(Value::Object(m));
    }
    Ok(promjene)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detalji_bez_tajni() {
        let d = json!({
            "id": 3, "PIN": "1234", "adminPin": "9", "ugnijezdeno": { "Lozinka": "x", "hes": "pbkdf2$100000$aa$bb", "ok": 1 },
            "lista": [{ "password": "p", "a": "pbkdf2$1" }, "pbkdf2$2", 5],
        });
        assert_eq!(
            js::stringify(&ocisti(&d)),
            r#"{"id":3,"ugnijezdeno":{"hes":"[skriveno]","ok":1},"lista":[{"a":"[skriveno]"},"[skriveno]",5]}"#
        );
    }

    #[test]
    fn promjene_samo_razlike() {
        let stare = |k: &str| Ok(if k == "a" { json!("1") } else { Value::Null });
        let nove = vec![
            ("a".to_string(), Some(json!("1"))),
            ("b".to_string(), Some(json!("2"))),
            ("c".to_string(), None),
            ("d".to_string(), Some(Value::Null)),
            ("logo".to_string(), Some(json!("x"))),
        ];
        assert_eq!(
            Value::from(promjene_postavki(stare, &nove, &["logo"]).unwrap()),
            json!([
                { "kljuc": "b", "staraVrijednost": null, "novaVrijednost": "2" },
                { "kljuc": "c", "staraVrijednost": null },
                { "kljuc": "logo", "promijenjena": true },
            ])
        );
    }
}
