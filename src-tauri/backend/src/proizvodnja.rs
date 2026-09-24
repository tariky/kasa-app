//! Kanali `nalog:*`, `normativ:*` i logika iz `lib/proizvodnja.ts`.

use serde_json::Value;

use crate::greska::R;
use crate::p;
use crate::sql::Db;
use crate::{Args, Backend};

/// Usluga preko koje se prodaje rad po mjeri — kreira se pri uključivanju modula.
pub const PRODAJNA_USLUGA_SIFRA: &str = "NAMJ";
pub const PRODAJNA_USLUGA_NAZIV: &str = "Namještaj po mjeri";

/// Da li se artikal koristi u normativu ili radnom nalogu.
pub fn je_artikal_u_proizvodnji(db: &Db, product_id: &Value) -> R<bool> {
    db.ima(
        "
    SELECT 1 AS x FROM normativi WHERE materijalId = ? OR productId = ?
    UNION ALL SELECT 1 FROM radni_nalog_stavke WHERE materijalId = ?
    UNION ALL SELECT 1 FROM radni_nalozi WHERE productId = ?
    LIMIT 1
  ",
        p![product_id, product_id, product_id, product_id],
    )
}

/// Pri uključivanju modula: kreira uslugu NAMJ ako šifra nije zauzeta.
pub fn osiguraj_prodajnu_uslugu(db: &Db) -> R<i64> {
    let id = db.val("SELECT id FROM products WHERE sifra = ?", p![PRODAJNA_USLUGA_SIFRA])?;
    if let Some(id) = id.as_i64() {
        return Ok(id);
    }
    let r = db.run(
        "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', 0, 'E', 'usluga')",
        p![PRODAJNA_USLUGA_SIFRA, PRODAJNA_USLUGA_NAZIV],
    )?;
    Ok(r.last_insert_rowid)
}

pub fn obradi(_b: &mut Backend, _kanal: &str, _a: &Args) -> Option<R<Value>> {
    None
}
