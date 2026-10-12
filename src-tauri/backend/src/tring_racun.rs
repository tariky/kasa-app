//! Mapiranje računa iz ekrana/baze u oblik za Tring (`lib/tringRacun.ts`).

use serde_json::{json, Map, Value};

use crate::js::{self, or, round2, to_number, truthy};
use crate::provjera_racuna;

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

/// Kako reklamacija vraća novac (`povratReklamacije` u lib/tringRacun.ts).
/// Tring traži tačno jednu vrstu plaćanja na reklamaciji (TFS 573), a uređaj
/// smanjuje stanje upravo te vrste: račun plaćen jednom bezgotovinskom vrstom
/// vraća se na nju negativnim iznosom računa; gotovinski, razbijeni ili
/// nepoznat oblik gotovinom (`Gotovina`/0), uz `pokrice` — bezgotovinski dio
/// koji se prije storna unese u gotovinu uređaja.
pub struct PovratReklamacije {
    /// Vrsta plaćanja na reklamaciji (`{oznaka, iznos}`).
    pub placanje: Value,
    /// Oznaka vrste povrata kako je uređaj prima.
    pub oznaka: &'static str,
    pub pokrice: f64,
}

pub fn povrat_reklamacije(nacin_placanja: &Value, ukupno: f64) -> PovratReklamacije {
    let iznos = round2(ukupno);
    let raspodjela = provjera_racuna::raspodjela_placanja(&js::to_string(nacin_placanja), iznos);
    if let Some(p) = &raspodjela {
        let bezgotovinske: Vec<&'static str> = [(p.kartica, "Kartica"), (p.virman, "Virman"), (p.cek, "Cek")]
            .into_iter()
            .filter(|&(x, _)| x != 0.0)
            .map(|(_, oznaka)| oznaka)
            .collect();
        if p.gotovina == 0.0 && bezgotovinske.len() == 1 {
            let oznaka = bezgotovinske[0];
            return PovratReklamacije { placanje: json!({ "oznaka": oznaka, "iznos": js::f(-iznos) }), oznaka, pokrice: 0.0 };
        }
    }
    let gotovina = raspodjela.map_or(0.0, |p| p.gotovina);
    PovratReklamacije {
        placanje: json!({ "oznaka": "Gotovina", "iznos": 0 }),
        oznaka: "Gotovina",
        pokrice: js::max(0.0, round2(iznos - gotovina)),
    }
}

/// `brojRacuna` je već parsiran broj originalnog računa; `placanje` je vrsta
/// povrata iz [`povrat_reklamacije`].
pub fn build_tring_reklamacija(data: &Value, broj_racuna: i64, placanje: &Value) -> Value {
    let mut m = Map::new();
    m.insert("stavke".into(), stavke(data));
    // Gotovinski povrat se uređaju javlja kao Gotovina/0 (TFS greška 573 inače).
    m.insert("vrstePlacanja".into(), json!([placanje]));
    m.insert("kupac".into(), map_kupac(&data["kupac"]));
    m.insert("brojRacuna".into(), Value::from(broj_racuna));
    bez_null(m)
}
