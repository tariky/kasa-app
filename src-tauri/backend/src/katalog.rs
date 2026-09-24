//! Kanali `product:*`, `materijal:search`, `dobavljac:*` i `kupac:*` (handlers.ts).

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, has};
use crate::proizvodnja::je_artikal_u_proizvodnji;
use crate::skladiste::{is_dobavljac_used, zapisi_promjene_cijena};
use crate::sql::Db;
use crate::{baci, p, Args, Backend};

// Napomena: `data.x !== undefined` je ovdje `has(data, "x")`. JSON gubi samo
// `undefined` (polje nestane), a `null` ostaje `null` — i u originalu je
// `null !== undefined`, pa poslan `null` znači "poslano".

// ─── Products ────────────────────────────────────────────

const PRODUCT_TIPOVI: [&str; 3] = ["artikal", "usluga", "materijal"];

fn normalizuj_tip(t: &Value) -> &str {
    match t.as_str() {
        Some(s) if !s.is_empty() && PRODUCT_TIPOVI.contains(&s) => s,
        _ => "artikal",
    }
}

const PDV_STOPE: [&str; 2] = ["E", "K"];

/// Stanje artikla iz kretanja zaliha (podupit u product:getAll/search).
const SELECT_SA_STANJEM: &str = "
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje
        FROM products p";

fn product_get_all(db: &Db, tip: &Value) -> R<Value> {
    if js::truthy(tip) {
        return db
            .all(&format!("{SELECT_SA_STANJEM}\n        WHERE p.tip = ?\n        ORDER BY p.naziv\n      "), p![normalizuj_tip(tip)])
            .map(Value::from);
    }
    db.all(&format!("{SELECT_SA_STANJEM}\n        \n        ORDER BY p.naziv\n      "), p![]).map(Value::from)
}

/// Trimovane šifra, naziv i barkod (prazan barkod = null) spremni za upis;
/// `None` = polje nije ni poslano ni provjereno.
#[derive(Default)]
struct UpisArtikla {
    sifra: Option<String>,
    naziv: Option<String>,
    barkod: Option<Value>,
}

/// JS `x !== y` za vrijednosti iz JSON-a i baze (brojevi po vrijednosti).
fn razlicito(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x != y,
        _ => a != b,
    }
}

// Zajednička pravila za product:create (id = null) i product:update. Na create-u su
// sva polja obavezna, na update-u se provjerava samo ono što je poslano. Vraća
// trimovane šifru, naziv i barkod (prazan barkod = null) spremne za upis.
fn validiraj_artikal(db: &Db, data: &Value, id: &Value) -> R<UpisArtikla> {
    let poslano = |k: &str| id.is_null() || has(data, k);
    let mut upis = UpisArtikla::default();
    if poslano("sifra") {
        match js::trim(&data["sifra"]) {
            Some(s) if !s.is_empty() => upis.sifra = Some(s.to_string()),
            _ => baci!("Šifra artikla je obavezna"),
        }
    }
    if poslano("naziv") {
        match js::trim(&data["naziv"]) {
            Some(s) if !s.is_empty() => upis.naziv = Some(s.to_string()),
            _ => baci!("Naziv artikla je obavezan"),
        }
    }
    if poslano("cijena") && (data["cijena"].is_null() || !(js::to_number(&data["cijena"]) >= 0.0)) {
        baci!("Cijena mora biti pozitivan broj");
    }
    if poslano("pdvStopa") && !data["pdvStopa"].as_str().is_some_and(|s| PDV_STOPE.contains(&s)) {
        baci!("PDV stopa mora biti E ili K");
    }
    let osim_id = js::nn(id, &json!(-1)).clone();
    if let Some(sifra) = &upis.sifra {
        if db.ima("SELECT id FROM products WHERE sifra = ? AND id != ?", p![sifra, osim_id])? {
            baci!("Artikal sa šifrom \"{}\" već postoji", js::to_string(&data["sifra"]));
        }
    }
    if id.is_null() || has(data, "barkod") {
        let barkod = js::or_null(&js::trim(&data["barkod"]).map(Value::from).unwrap_or(Value::Null));
        if js::truthy(&barkod) && db.ima("SELECT id FROM products WHERE barkod = ? AND id != ?", p![barkod, osim_id])? {
            baci!("Artikal sa barkodom \"{}\" već postoji", js::to_string(&data["barkod"]));
        }
        upis.barkod = Some(barkod);
    }
    Ok(upis)
}

fn product_create(db: &Db, data: &Value) -> R<Value> {
    let upis = validiraj_artikal(db, data, &Value::Null)?;
    let tip = normalizuj_tip(&data["tip"]);
    let jm_zadano = json!(if tip == "usluga" { "usl" } else { "kom" });
    let result = db.run(
        "
        INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, barkod, tip, plocaSirina, plocaVisina)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ",
        p![
            upis.sifra,
            upis.naziv,
            js::nn(&data["jm"], &jm_zadano),
            data["cijena"],
            data["pdvStopa"],
            data["plu"],
            upis.barkod.unwrap_or(Value::Null),
            tip,
            data["plocaSirina"],
            data["plocaVisina"],
        ],
    )?;
    Ok(json!({ "id": result.last_insert_rowid }))
}

fn product_update(db: &Db, id: &Value, data: &Value) -> R<Value> {
    let upis = validiraj_artikal(db, data, id)?;
    let mut fields: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(s) = upis.sifra { fields.push("sifra = ?"); values.push(json!(s)); }
    if let Some(n) = upis.naziv { fields.push("naziv = ?"); values.push(json!(n)); }
    if has(data, "jm") { fields.push("jm = ?"); values.push(data["jm"].clone()); }
    if has(data, "cijena") { fields.push("cijena = ?"); values.push(data["cijena"].clone()); }
    if has(data, "pdvStopa") { fields.push("pdvStopa = ?"); values.push(data["pdvStopa"].clone()); }
    if has(data, "plu") { fields.push("plu = ?"); values.push(data["plu"].clone()); }
    if let Some(b) = upis.barkod { fields.push("barkod = ?"); values.push(b); }
    if has(data, "tip") { fields.push("tip = ?"); values.push(json!(normalizuj_tip(&data["tip"]))); }
    if has(data, "plocaSirina") { fields.push("plocaSirina = ?"); values.push(data["plocaSirina"].clone()); }
    if has(data, "plocaVisina") { fields.push("plocaVisina = ?"); values.push(data["plocaVisina"].clone()); }

    if fields.is_empty() {
        return Ok(json!({ "changes": 0 }));
    }

    fields.push("updatedAt = datetime('now','localtime')");
    values.push(id.clone());

    db.tx(|| {
        let prije = db.get("SELECT cijena FROM products WHERE id = ?", p![id])?;
        let result = db.run(&format!("UPDATE products SET {} WHERE id = ?", fields.join(", ")), &values)?;
        // Ručna izmjena cijene ulazi u historiju: poništavanje ranije primke je ne smije pregaziti.
        if let Some(prije) = prije {
            if has(data, "cijena") && razlicito(&data["cijena"], &prije["cijena"]) {
                zapisi_promjene_cijena(db, "rucno", &Value::Null, &[(id.clone(), prije["cijena"].clone(), data["cijena"].clone())])?;
            }
        }
        Ok(json!({ "changes": result.changes }))
    })
}

fn product_delete(db: &Db, id: &Value) -> R<Value> {
    if db.ima("SELECT id FROM order_items WHERE productId = ? LIMIT 1", p![id])? {
        baci!("Artikal se koristi u računima i ne može biti obrisan");
    }
    if db.ima("SELECT id FROM primka_stavke WHERE productId = ? LIMIT 1", p![id])? {
        baci!("Artikal se koristi u primkama i ne može biti obrisan");
    }
    if je_artikal_u_proizvodnji(db, id)? {
        baci!("Artikal se koristi u proizvodnji (normativ ili radni nalog) i ne može biti obrisan");
    }
    // Ostali strani ključevi na products (vidi schema.ts). Kretanja zalihe idu zadnja:
    // račun i primka ih i sami prave, pa za njih važi konkretnija poruka iznad.
    let ostale_veze = [
        ("prilog_stavke", "Artikal se koristi u prilozima i ne može biti obrisan"),
        ("ponuda_stavke", "Artikal se koristi u ponudama i ne može biti obrisan"),
        ("nivelacija_stavke", "Artikal se koristi u nivelacijama i ne može biti obrisan"),
        ("stock_movements", "Artikal ima kretanja zalihe i ne može biti obrisan"),
    ];
    for (tabela, poruka) in ostale_veze {
        if db.ima(&format!("SELECT 1 FROM {tabela} WHERE productId = ? LIMIT 1"), p![id])? {
            baci!("{poruka}");
        }
    }
    // Historija cijena artikla bez primki ima samo ručne izmjene — ide s artiklom.
    db.tx(|| {
        db.run("DELETE FROM cijena_historija WHERE productId = ?", p![id])?;
        let result = db.run("DELETE FROM products WHERE id = ?", p![id])?;
        Ok(json!({ "changes": result.changes }))
    })
}

fn product_adjust_stock(db: &Db, product_id: &Value, new_stanje: &Value) -> R<Value> {
    if !db.ima("SELECT 1 FROM products WHERE id = ?", p![product_id])? {
        baci!("Artikal ne postoji");
    }
    // Calculate current stock
    let stanje = db.val(
        "
      SELECT COALESCE(
        SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
      ) AS stanje
      FROM stock_movements WHERE productId = ?
    ",
        p![product_id],
    )?;

    let diff = js::to_number(new_stanje) - js::to_number(&stanje);
    if diff == 0.0 {
        return Ok(json!({ "changes": 0 }));
    }

    let tip = if diff > 0.0 { "ulaz" } else { "izlaz" };
    let kolicina = js::f(diff.abs());

    db.run(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, ?, ?, 'adjustment', 0)",
        p![product_id, tip, kolicina],
    )?;

    Ok(json!({ "changes": 1 }))
}

fn product_search(db: &Db, query: &Value) -> R<Value> {
    let like = format!("%{}%", js::to_string(query));
    db.all(
        &format!("{SELECT_SA_STANJEM}\n        WHERE (p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?) AND p.tip != 'materijal'\n        ORDER BY p.naziv\n      "),
        p![like, like, like],
    )
    .map(Value::from)
}

fn materijal_search(db: &Db, query: &Value) -> R<Value> {
    let like = format!("%{}%", js::to_string(query));
    db.all(
        &format!("{SELECT_SA_STANJEM}\n        WHERE p.tip = 'materijal' AND (p.naziv LIKE ? OR p.sifra LIKE ?)\n        ORDER BY p.naziv\n        LIMIT 30\n      "),
        p![like, like],
    )
    .map(Value::from)
}

// ─── Dobavljači ─────────────────────────────────────────

// Zajednička pravila za dobavljac:create (id = null) i dobavljac:update — na update-u
// se naziv provjerava samo ako je poslan. Vraća trimovan naziv spreman za upis.
fn validiraj_dobavljaca(data: &Value, id: &Value) -> R<Option<String>> {
    if !id.is_null() && !has(data, "naziv") {
        return Ok(None);
    }
    match js::trim(&data["naziv"]) {
        Some(s) if !s.is_empty() => Ok(Some(s.to_string())),
        _ => baci!("Naziv dobavljača je obavezan"),
    }
}

fn dobavljac_create(db: &Db, data: &Value) -> R<Value> {
    let naziv = validiraj_dobavljaca(data, &Value::Null)?;
    let result = db.run(
        "INSERT INTO dobavljaci (naziv, idBroj, pdvBroj, adresa, kontakt) VALUES (?, ?, ?, ?, ?)",
        p![naziv, data["idBroj"], data["pdvBroj"], data["adresa"], data["kontakt"]],
    )?;
    Ok(json!({ "id": result.last_insert_rowid }))
}

/// `UPDATE <tabela> SET ... WHERE id = ?` samo za poslana polja; `upis` su već
/// provjerene vrijednosti koje idu prve.
fn azuriraj(db: &Db, tabela: &str, id: &Value, data: &Value, upis: Vec<(&str, String)>, polja: &[&str]) -> R<Value> {
    let mut fields: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for (k, v) in upis {
        fields.push(format!("{k} = ?"));
        values.push(json!(v));
    }
    for k in polja {
        if has(data, k) {
            fields.push(format!("{k} = ?"));
            values.push(data[*k].clone());
        }
    }
    if fields.is_empty() {
        return Ok(json!({ "changes": 0 }));
    }
    values.push(id.clone());
    let result = db.run(&format!("UPDATE {tabela} SET {} WHERE id = ?", fields.join(", ")), &values)?;
    Ok(json!({ "changes": result.changes }))
}

fn dobavljac_update(db: &Db, id: &Value, data: &Value) -> R<Value> {
    let naziv = validiraj_dobavljaca(data, id)?;
    let upis = naziv.map(|n| vec![("naziv", n)]).unwrap_or_default();
    azuriraj(db, "dobavljaci", id, data, upis, &["idBroj", "pdvBroj", "adresa", "kontakt"])
}

fn dobavljac_delete(db: &Db, id: &Value) -> R<Value> {
    let Some(dobavljac) = db.get("SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = ?", p![id])? else {
        return Ok(json!({ "changes": 0 }));
    };
    if is_dobavljac_used(db, &dobavljac["naziv"], &dobavljac["idBroj"], &dobavljac["pdvBroj"])? {
        baci!("Dobavljač se koristi u primkama i ne može biti obrisan");
    }
    let result = db.run("DELETE FROM dobavljaci WHERE id = ?", p![id])?;
    Ok(json!({ "changes": result.changes }))
}

// ─── Kupci ──────────────────────────────────────────────

fn kupac_search(db: &Db, query: &Value) -> R<Value> {
    let like = format!("%{}%", js::to_string(query));
    db.all("SELECT * FROM kupci WHERE naziv LIKE ? OR idBroj LIKE ? OR kontakt LIKE ? ORDER BY naziv", p![like, like, like])
        .map(Value::from)
}

// Zajednička pravila za kupac:create (id = null) i kupac:update — na update-u se
// provjerava samo ono što je poslano. Vraća trimovane naziv i JIB spremne za upis.
fn validiraj_kupca(db: &Db, data: &Value, id: &Value) -> R<Vec<(&'static str, String)>> {
    let mut upis = Vec::new();
    if id.is_null() || has(data, "naziv") {
        match js::trim(&data["naziv"]) {
            Some(s) if !s.is_empty() => upis.push(("naziv", s.to_string())),
            _ => baci!("Naziv kupca je obavezan"),
        }
    }
    if id.is_null() || has(data, "idBroj") {
        let id_broj = match js::trim(&data["idBroj"]) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => baci!("ID broj (JIB) kupca je obavezan"),
        };
        if db.ima("SELECT id FROM kupci WHERE idBroj = ? AND id != ?", p![id_broj, js::nn(id, &json!(-1))])? {
            baci!("Kupac sa JIB-om \"{}\" već postoji", js::to_string(&data["idBroj"]));
        }
        upis.push(("idBroj", id_broj));
    }
    Ok(upis)
}

fn kupac_create(db: &Db, data: &Value) -> R<Value> {
    let upis = validiraj_kupca(db, data, &Value::Null)?;
    let (naziv, id_broj) = (&upis[0].1, &upis[1].1);
    let result = db.run(
        "INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        p![naziv, id_broj, data["pdvBroj"], data["adresa"], data["postanskiBroj"], data["grad"], data["kontakt"]],
    )?;
    Ok(json!({ "id": result.last_insert_rowid }))
}

fn kupac_update(db: &Db, id: &Value, data: &Value) -> R<Value> {
    let upis = validiraj_kupca(db, data, id)?;
    azuriraj(db, "kupci", id, data, upis, &["pdvBroj", "adresa", "postanskiBroj", "grad", "kontakt"])
}

fn kupac_delete(db: &Db, id: &Value) -> R<Value> {
    if let Some(kupac) = db.get("SELECT idBroj FROM kupci WHERE id = ?", p![id])? {
        if db.ima("SELECT id FROM orders WHERE kupacIdBroj = ? LIMIT 1", p![kupac["idBroj"]])? {
            baci!("Kupac se koristi u računima i ne može biti obrisan");
        }
    }
    if db.ima("SELECT 1 FROM ponude WHERE kupacId = ? LIMIT 1", p![id])? {
        baci!("Kupac se koristi u ponudama i ne može biti obrisan");
    }
    if db.ima("SELECT 1 FROM radni_nalozi WHERE kupacId = ? LIMIT 1", p![id])? {
        baci!("Kupac se koristi u radnim nalozima i ne može biti obrisan");
    }
    let result = db.run("DELETE FROM kupci WHERE id = ?", p![id])?;
    Ok(json!({ "changes": result.changes }))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "product:getAll" => product_get_all(db, &a[0]),
        "product:get" => db.get("SELECT * FROM products WHERE id = ?", p![a[0]]).map(|r| r.unwrap_or(Value::Null)),
        "product:create" => product_create(db, &a[0]),
        "product:update" => product_update(db, &a[0], &a[1]),
        "product:delete" => product_delete(db, &a[0]),
        "product:adjustStock" => product_adjust_stock(db, &a[0], &a[1]),
        "product:search" => product_search(db, &a[0]),
        "materijal:search" => materijal_search(db, &a[0]),
        "dobavljac:getAll" => db.all("SELECT * FROM dobavljaci ORDER BY naziv", p![]).map(Value::from),
        "dobavljac:create" => dobavljac_create(db, &a[0]),
        "dobavljac:update" => dobavljac_update(db, &a[0], &a[1]),
        "dobavljac:delete" => dobavljac_delete(db, &a[0]),
        "kupac:getAll" => db.all("SELECT * FROM kupci ORDER BY naziv", p![]).map(Value::from),
        "kupac:search" => kupac_search(db, &a[0]),
        "kupac:create" => kupac_create(db, &a[0]),
        "kupac:update" => kupac_update(db, &a[0], &a[1]),
        "kupac:delete" => kupac_delete(db, &a[0]),
        _ => return None,
    })
}
