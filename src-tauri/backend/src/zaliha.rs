//! Knjiga zalihe (`lib/zaliha.ts`): stanje artikla = SUM(ulaz) − SUM(izlaz)
//! iz `stock_movements`. Svako kretanje zalihe se upisuje i briše ovdje.
//! `STANJE_SQL` se ne prepisuje — čita se iz zaliha.ts, pa je isti u oba backenda.

use std::sync::OnceLock;

use serde_json::Value;

use crate::greska::R;
use crate::p;
use crate::sql::Db;

const ZALIHA_TS: &str = include_str!("../../../src/lib/zaliha.ts");

/// Tolerancija za stanje zalihe (`TOLERANCIJA_ZALIHE`): |stanje| < 1e-9 je
/// nula. Stanje je zbir kretanja u REAL-u, pa ostaje šum (0,1 + 0,2 − 0,3 ≠ 0)
/// — takva "zaliha" ne pravi nivelaciju, upozorenje ni korekciju. Ista
/// granica važi u izvozu i proizvodnji. TS: lib/tolerancije.ts.
pub const TOLERANCIJA_ZALIHE: f64 = 1e-9;

/// Stanje artikla kao SQL izraz za SELECT (podupit nad aliasom `p`; bez
/// kretanja 0 kao INTEGER, inače zbir u REAL-u) — tekst između backtickova
/// u zaliha.ts (`STANJE_SQL`).
pub fn stanje_sql() -> &'static str {
    ZALIHA_TS.split('`').nth(1).expect("zaliha.ts mora imati STANJE_SQL između backtickova")
}

/// Dokument kretanja: `referenceType` i `referenceId` (`{ vrsta, id }`).
#[derive(Clone, Copy)]
pub struct Dokument<'a> {
    pub vrsta: &'a str,
    pub id: &'a Value,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Smjer {
    Ulaz,
    Izlaz,
}

impl Smjer {
    fn tip(self) -> &'static str {
        match self {
            Smjer::Ulaz => "ulaz",
            Smjer::Izlaz => "izlaz",
        }
    }
}

/// Prodaja (račun, prilog) ne razdužuje uslugu — usluga nema zalihu. Tip
/// artikla se čita iz baze u trenutku knjiženja. Ostala kretanja knjiže tačno
/// zadano: storno vraća ono što je račun skinuo (artikal je mogao postati
/// usluga), korekcija i nalog imaju svoju količinu.
const PRODAJA: [&str; 2] = ["order", "prilog"];

/// Upiše kretanje za svaku stavku `(productId, kolicina)`, redom. `datum` je
/// datum dokumenta (izvještaj „Zalihe na dan" ide po njemu); `null` je
/// lokalno vrijeme sada — kao zadana vrijednost kolone. TS: `knjizi`.
pub fn knjizi<'a>(
    db: &Db,
    dok: Dokument,
    smjer: Smjer,
    stavke: impl IntoIterator<Item = (&'a Value, &'a Value)>,
    datum: &Value,
) -> R<()> {
    let prodaja = smjer == Smjer::Izlaz && PRODAJA.contains(&dok.vrsta);
    for (product_id, kolicina) in stavke {
        if prodaja && db.get("SELECT tip FROM products WHERE id = ?", p![product_id])?.is_some_and(|a| a["tip"] == "usluga") {
            continue;
        }
        db.run(
            "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))",
            p![product_id, smjer.tip(), kolicina, dok.vrsta, dok.id, datum],
        )?;
    }
    Ok(())
}

/// Obriše sva kretanja dokumenta (izmjena ili brisanje primke, priloga, naloga).
pub fn ponisti(db: &Db, dok: Dokument) -> R<()> {
    db.run("DELETE FROM stock_movements WHERE referenceType = ? AND referenceId = ?", p![dok.vrsta, dok.id])?;
    Ok(())
}

/// Trenutno stanje artikla (isti `STANJE_SQL`; artikal koji ne postoji ima 0).
/// `Value` čuva INTEGER/REAL zapis kakav vrati SQLite.
pub fn stanje(db: &Db, product_id: &Value) -> R<Value> {
    static SQL: OnceLock<String> = OnceLock::new();
    let sql = SQL.get_or_init(|| format!("SELECT {} AS stanje FROM (SELECT ? AS id) p", stanje_sql()));
    db.val(sql, p![product_id])
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::proba::baza;

    fn artikal(db: &Db, sifra: &str, tip: &str) -> Value {
        let r = db.run("INSERT INTO products (sifra, naziv, cijena, pdvStopa, tip) VALUES (?, ?, 10, 'E', ?)", p![sifra, sifra, tip]).unwrap();
        json!(r.last_insert_rowid)
    }

    fn kretanja(db: &Db) -> Vec<Value> {
        db.all("SELECT productId, tip, kolicina, referenceType, referenceId, createdAt FROM stock_movements ORDER BY id", p![]).unwrap()
    }

    fn dok<'a>(vrsta: &'a str, id: &'a Value) -> Dokument<'a> {
        Dokument { vrsta, id }
    }

    #[test]
    fn stanje_cuva_integer_i_real_zapis() {
        let db = baza("zaliha-stanje");
        let a = artikal(&db, "A", "artikal");
        assert_eq!(stanje(&db, &a).unwrap(), json!(0));
        assert_eq!(stanje(&db, &json!(999)).unwrap(), json!(0));
        knjizi(&db, dok("primka", &json!(1)), Smjer::Ulaz, [(&a, &json!(10))], &Value::Null).unwrap();
        // Zbir REAL kolone je REAL i kad je cijeli broj (JSON 10.0, ne 10).
        assert_eq!(stanje(&db, &a).unwrap(), json!(10.0));
        knjizi(&db, dok("order", &json!(1)), Smjer::Izlaz, [(&a, &json!(2.5))], &Value::Null).unwrap();
        assert_eq!(stanje(&db, &a).unwrap(), json!(7.5));
        // Id kao tekst se poredi kao broj, kao u `WHERE productId = ?`.
        assert_eq!(stanje(&db, &json!(a.to_string())).unwrap(), json!(7.5));
    }

    #[test]
    fn knjizi_redom_s_datumom_dokumenta() {
        let db = baza("zaliha-datum");
        let a = artikal(&db, "A", "artikal");
        let m = artikal(&db, "M", "materijal");
        let stavke = [json!({ "productId": a, "kolicina": 3 }), json!({ "productId": m, "kolicina": 1.25 })];
        knjizi(&db, dok("primka", &json!(7)), Smjer::Ulaz, stavke.iter().map(|s| (&s["productId"], &s["kolicina"])), &json!("2026-03-10 00:00:00"))
            .unwrap();
        assert_eq!(
            kretanja(&db),
            vec![
                json!({ "productId": a, "tip": "ulaz", "kolicina": 3.0, "referenceType": "primka", "referenceId": 7, "createdAt": "2026-03-10 00:00:00" }),
                json!({ "productId": m, "tip": "ulaz", "kolicina": 1.25, "referenceType": "primka", "referenceId": 7, "createdAt": "2026-03-10 00:00:00" }),
            ]
        );
        // Bez datuma: lokalno vrijeme sada, kao zadana vrijednost kolone.
        knjizi(&db, dok("radni_nalog", &json!(3)), Smjer::Izlaz, [(&a, &json!(1))], &Value::Null).unwrap();
        let danas = db.val("SELECT date('now','localtime')", p![]).unwrap();
        let sada = kretanja(&db)[2]["createdAt"].as_str().unwrap().to_string();
        assert_eq!(sada.len(), 19);
        assert_eq!(json!(&sada[..10]), danas);
    }

    #[test]
    fn usluga_ne_razduzuje_samo_u_prodaji() {
        let db = baza("zaliha-usluga");
        let a = artikal(&db, "A", "artikal");
        let u = artikal(&db, "U", "usluga");
        let m = artikal(&db, "M", "materijal");
        let jedan = json!(1);
        for vrsta in ["order", "prilog"] {
            knjizi(&db, dok(vrsta, &jedan), Smjer::Izlaz, [(&a, &jedan), (&u, &jedan), (&m, &jedan)], &Value::Null).unwrap();
        }
        let vrste = |k: &[Value]| k.iter().map(|k| (k["referenceType"].clone(), k["productId"].clone())).collect::<Vec<_>>();
        assert_eq!(
            vrste(&kretanja(&db)),
            vec![(json!("order"), a.clone()), (json!("order"), m.clone()), (json!("prilog"), a.clone()), (json!("prilog"), m.clone())]
        );
        // Storno, korekcija i nalog knjiže tačno zadano, i za uslugu.
        db.run("DELETE FROM stock_movements", p![]).unwrap();
        knjizi(&db, dok("refund", &jedan), Smjer::Ulaz, [(&u, &json!(2))], &Value::Null).unwrap();
        knjizi(&db, dok("adjustment", &json!(0)), Smjer::Izlaz, [(&u, &json!(0.5))], &Value::Null).unwrap();
        knjizi(&db, dok("radni_nalog", &json!(4)), Smjer::Izlaz, [(&u, &json!(0.25))], &Value::Null).unwrap();
        assert_eq!(stanje(&db, &u).unwrap(), json!(1.25));
    }

    #[test]
    fn ponisti_samo_taj_dokument() {
        let db = baza("zaliha-ponisti");
        let a = artikal(&db, "A", "artikal");
        let (jedan, dva) = (json!(1), json!(2));
        knjizi(&db, dok("primka", &jedan), Smjer::Ulaz, [(&a, &json!(10))], &Value::Null).unwrap();
        knjizi(&db, dok("primka", &dva), Smjer::Ulaz, [(&a, &json!(5))], &Value::Null).unwrap();
        knjizi(&db, dok("radni_nalog", &jedan), Smjer::Izlaz, [(&a, &json!(1))], &Value::Null).unwrap();
        ponisti(&db, dok("primka", &jedan)).unwrap();
        let ostalo: Vec<_> = kretanja(&db).iter().map(|k| (k["referenceType"].clone(), k["referenceId"].clone())).collect();
        assert_eq!(ostalo, vec![(json!("primka"), json!(2)), (json!("radni_nalog"), json!(1))]);
        assert_eq!(stanje(&db, &a).unwrap(), json!(4.0));
    }

    #[test]
    fn stanje_sql_iz_zaliha_ts() {
        // Jedini tekst između backtickova u zaliha.ts.
        assert_eq!(ZALIHA_TS.matches('`').count(), 2);
        assert!(stanje_sql().contains("FROM stock_movements sm WHERE sm.productId = p.id"));
        let db = baza("zaliha-sql");
        let a = artikal(&db, "A", "artikal");
        artikal(&db, "B", "artikal");
        knjizi(&db, dok("primka", &json!(1)), Smjer::Ulaz, [(&a, &json!(4))], &Value::Null).unwrap();
        let redovi = db.all(&format!("SELECT p.id, {} AS stanje FROM products p ORDER BY p.id", stanje_sql()), p![]).unwrap();
        for r in &redovi {
            assert_eq!(r["stanje"], stanje(&db, &r["id"]).unwrap());
        }
        assert_eq!(redovi.iter().map(|r| r["stanje"].clone()).collect::<Vec<_>>(), vec![json!(4.0), json!(0)]);
    }
}
