//! Raspodjela kanala po domenama. Svaka domena u `obradi` vrati `None` za
//! kanal koji nije njen.

use crate::greska::{Greska, R};
use crate::{cash, katalog, korisnici, licenca, ponude, postavke, proizvodnja, racuni, skladiste, uredjaj};
use crate::{Args, Backend};
use serde_json::Value;

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> R<Value> {
    let domena = kanal.split(':').next().unwrap_or("");
    let r = match domena {
        "licenca" => licenca::obradi(b, kanal, a),
        "user" => korisnici::obradi(b, kanal, a),
        "settings" | "savedCarts" | "proizvodnja" => postavke::obradi(b, kanal, a),
        "product" | "materijal" | "dobavljac" | "kupac" => katalog::obradi(b, kanal, a),
        "primka" | "nivelacija" | "report" => skladiste::obradi(b, kanal, a),
        "order" | "pending" | "prilog" | "fiscal" => racuni::obradi(b, kanal, a),
        "cash" => cash::obradi(b, kanal, a),
        "ponuda" => ponude::obradi(b, kanal, a),
        "nalog" | "normativ" => proizvodnja::obradi(b, kanal, a),
        "tring" | "dialog" | "fs" | "db" => uredjaj::obradi(b, kanal, a),
        _ => None,
    };
    r.unwrap_or_else(|| Err(Greska(format!("Kanal ne postoji: {kanal}"))))
}
