//! Kanali `primka:*`, `nivelacija:*`, `report:getData` i logika iz `lib/skladiste.ts`.

use serde_json::Value;

use crate::greska::R;
use crate::js;
use crate::p;
use crate::sql::Db;
use crate::{Args, Backend};

/// Upis promjena prodajne cijene u `cijena_historija` (`zapisiPromjeneCijena`).
/// `izvor` je 'primka' ili 'rucno'; `izvor_id` je primkaId ili null.
pub fn zapisi_promjene_cijena(db: &Db, izvor: &str, izvor_id: &Value, promjene: &[(Value, Value, Value)]) -> R<()> {
    for (product_id, stara, nova) in promjene {
        db.run(
            "INSERT INTO cijena_historija (productId, izvor, izvorId, staraCijena, novaCijena) VALUES (?, ?, ?, ?, ?)",
            p![product_id, izvor, izvor_id, stara, nova],
        )?;
    }
    Ok(())
}

/// Da li se dobavljač koristi u primkama (po nazivu ili ID/PDV broju).
pub fn is_dobavljac_used(db: &Db, naziv: &Value, id_broj: &Value, pdv_broj: &Value) -> R<bool> {
    let oznake: Vec<Value> = [id_broj, pdv_broj]
        .into_iter()
        .filter_map(|v| js::trim(v).filter(|s| !s.is_empty()).map(Value::from))
        .collect();
    if oznake.is_empty() {
        return db.ima("SELECT id FROM primke WHERE dobavljacNaziv = ? LIMIT 1", p![naziv]);
    }
    let upitnici = vec!["?"; oznake.len()].join(", ");
    let mut params = vec![naziv.clone()];
    params.extend(oznake);
    db.ima(
        &format!("SELECT id FROM primke\n         WHERE dobavljacNaziv = ? OR dobavljacId IN ({upitnici})\n         LIMIT 1"),
        &params,
    )
}

pub fn obradi(_b: &mut Backend, _kanal: &str, _a: &Args) -> Option<R<Value>> {
    None
}
