//! Mapiranje računa iz ekrana/baze u oblik za Tring (`lib/tringRacun.ts`).

use serde_json::{json, Map, Value};

use crate::js::{self, or, round2, to_number, truthy};

fn map_kupac(kupac: &Value) -> Value {
    if !truthy(kupac) {
        return Value::Null;
    }
    let s = |k: &str| or(&kupac[k], &json!("")).clone();
    json!({
        "idBroj": s("idBroj"),
        "naziv": s("naziv"),
        "adresa": s("adresa"),
        "postanskiBroj": s("postanskiBroj"),
        "grad": s("grad"),
    })
}

/// Stavka iz korpe (`sifra`, `naziv`) ili iz baze (`productSifra`, `productNaziv`).
fn map_stavka(item: &Value) -> Value {
    let pid = or(&item["productId"], &json!("")).clone();
    let sifra = if truthy(&item["sifra"]) {
        item["sifra"].clone()
    } else if truthy(&item["productSifra"]) {
        item["productSifra"].clone()
    } else {
        Value::String(js::to_string(&pid))
    };
    json!({
        "artikal": {
            "sifra": sifra,
            "naziv": or(&item["naziv"], or(&item["productNaziv"], &json!(""))),
            "jm": or(&item["jm"], or(&item["productJm"], &json!("kom"))),
            "cijena": item["cijena"],
            "stopa": or(&item["pdvStopa"], or(&item["stopa"], &json!("E"))),
            "plu": or(&item["plu"], or(&item["productPlu"], &json!(0))),
        },
        "kolicina": item["kolicina"],
        "rabat": or(&item["rabat"], &json!(0)),
    })
}

fn stavke(data: &Value) -> Value {
    let izvor = or(&data["items"], or(&data["stavke"], &json!([]))).clone();
    Value::Array(izvor.as_array().map(|a| a.iter().map(map_stavka).collect()).unwrap_or_default())
}

fn bez_null(m: Map<String, Value>) -> Value {
    Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).collect())
}

pub fn build_tring_racun(data: &Value) -> Value {
    let ukupno = round2(to_number(or(&data["ukupno"], &json!(0))));
    let vrste = match data["vrstePlacanja"].as_array() {
        Some(a) if !a.is_empty() => data["vrstePlacanja"].clone(),
        _ => json!([{ "oznaka": or(&data["nacinPlacanja"], &json!("Gotovina")), "iznos": js::f(ukupno) }]),
    };
    let mut m = Map::new();
    m.insert("stavke".into(), stavke(data));
    m.insert("vrstePlacanja".into(), vrste);
    m.insert("kupac".into(), map_kupac(&data["kupac"]));
    m.insert("napomena".into(), data["napomena"].clone());
    m.insert("brojRacuna".into(), data["brojRacuna"].clone());
    bez_null(m)
}

/// `brojRacuna` je već parsiran broj originalnog računa.
pub fn build_tring_reklamacija(data: &Value, broj_racuna: i64) -> Value {
    let mut m = Map::new();
    m.insert("stavke".into(), stavke(data));
    // Gotovinski povrat se uređaju javlja kao Gotovina/0 (TFS greška 573 inače).
    m.insert("vrstePlacanja".into(), json!([{ "oznaka": "Gotovina", "iznos": 0 }]));
    m.insert("kupac".into(), map_kupac(&data["kupac"]));
    m.insert("brojRacuna".into(), Value::from(broj_racuna));
    bez_null(m)
}
