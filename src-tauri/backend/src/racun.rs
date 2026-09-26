//! Iznosi računa i upis odštampanog računa (`lib/racun.ts`).

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{round2, to_number};
use crate::p;
use crate::sql::Db;

/// Iznos stavke zaokružen na fene (uređaj zaokružuje po stavci).
pub fn iznos_stavke(s: &Value) -> f64 {
    round2(to_number(&s["cijena"]) * to_number(&s["kolicina"]) * (1.0 - to_number(&s["rabat"]) / 100.0))
}

/// PDV sadržan u iznosu stavke; stopa 'K' je oslobođena. Nezaokružen.
pub fn pdv_stavke(s: &Value) -> f64 {
    if s["pdvStopa"] != "E" {
        return 0.0;
    }
    let iznos = iznos_stavke(s);
    iznos - iznos / 1.17
}

/// `{ ukupno, pdvIznos }`
pub fn izracunaj_totale(stavke: &[Value]) -> (f64, f64) {
    let ukupno = round2(stavke.iter().fold(0.0, |sum, s| sum + iznos_stavke(s)));
    let pdv = round2(stavke.iter().fold(0.0, |sum, s| sum + pdv_stavke(s)));
    (ukupno, pdv)
}

/// Upis već odštampanog fiskalnog računa: orders + order_items + izlaz
/// skladišta. `input` ima oblik `UpisRacunaInput` iz TS-a (s opcionim
/// `createdAt` i `isManual` za račun iz dijaloga nezavršenih). Poziva se u transakciji.
pub fn upisi_racun(db: &Db, input: &Value) -> R<i64> {
    let k = &input["kupac"];
    // Bez datuma: zadani datum kolone (sada), kao i ranije.
    let created_at = input["createdAt"].as_str().filter(|s| !s.is_empty());
    let is_manual = if input["isManual"].is_null() { json!(0) } else { input["isManual"].clone() };
    let r = db.run(
        "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
      kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, createdAt)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))",
        p![
            input["korisnikId"], input["ukupno"], input["pdvIznos"], input["nacinPlacanja"], input["brojFiskalnogRacuna"],
            k["naziv"], k["idBroj"], k["adresa"], k["grad"], k["postanskiBroj"], is_manual, created_at
        ],
    )?;
    let order_id = r.last_insert_rowid;
    for s in input["stavke"].as_array().into_iter().flatten() {
        db.run(
            "INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![order_id, s["productId"], s["kolicina"], s["cijena"], s["rabat"], s["pdvStopa"]],
        )?;
        if s["productTip"] != "usluga" {
            db.run(
                "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, COALESCE(?, datetime('now','localtime')))",
                p![s["productId"], s["kolicina"], order_id, created_at],
            )?;
        }
    }
    Ok(order_id)
}
