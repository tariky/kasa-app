//! Kanali `product:*`, `materijal:search`, `dobavljac:*` i `kupac:*` (handlers.ts).

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, has};
use crate::proizvodnja::je_artikal_u_proizvodnji;
use crate::skladiste::{is_dobavljac_used, zapisi_promjene_cijena};
use crate::sql::Db;
use crate::{audit, baci, p, Args, Backend};

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
/// Tring: naziv zajedno s JM ima 32–36 znakova, zavisno od uređaja.
const SLOBODAN_NAZIV_MAX: usize = 32;

/// Stanje artikla iz kretanja zaliha (podupit u product:getAll/search).
const SELECT_SA_STANJEM: &str = "
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje
        FROM products p";

/// Kao `SELECT_SA_STANJEM`, plus šifre dobavljača artikla u jednom stringu —
/// za pretragu u šifarniku, primci i kasi.
const SELECT_SA_SIFRAMA: &str = "
        SELECT p.*,
          COALESCE(
            (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
             FROM stock_movements sm WHERE sm.productId = p.id),
            0
          ) AS stanje,
          (SELECT GROUP_CONCAT(ds.sifra, ' ') FROM artikal_dobavljac_sifre ds
            WHERE ds.productId = p.id AND ds.sifra IS NOT NULL) AS sifreDobavljaca
        FROM products p";

fn product_get_all(db: &Db, tip: &Value) -> R<Value> {
    if js::truthy(tip) {
        return db
            .all(&format!("{SELECT_SA_SIFRAMA}\n        WHERE p.slobodan = 0 AND p.tip = ?\n        ORDER BY p.naziv\n      "), p![normalizuj_tip(tip)])
            .map(Value::from);
    }
    db.all(&format!("{SELECT_SA_SIFRAMA}\n        WHERE p.slobodan = 0\n        ORDER BY p.naziv\n      "), p![]).map(Value::from)
}

/// Trimovane šifra, naziv i barkod (prazan barkod = null) spremni za upis;
/// `None` = polje nije ni poslano ni provjereno.
#[derive(Default)]
struct UpisArtikla {
    sifra: Option<String>,
    naziv: Option<String>,
    barkod: Option<Value>,
    plu: Option<Value>,
}

/// PLU ide uređaju uz svaku stavku, pa važi Tringovo pravilo (`MAX_PLU` u
/// tring.rs): cijeli broj od 0 do 999999. Prazno = bez PLU-a (null).
fn validiraj_plu(plu: &Value) -> R<Value> {
    let n = match plu {
        Value::Null => return Ok(Value::Null),
        Value::String(s) if s.trim().is_empty() => return Ok(Value::Null),
        Value::Number(n) => n.as_f64(),
        Value::String(s) if s.trim().bytes().all(|c| c.is_ascii_digit()) => s.trim().parse::<f64>().ok(),
        _ => None,
    };
    match n {
        Some(n) if n.fract() == 0.0 && (0.0..=999_999.0).contains(&n) => Ok(json!(n as i64)),
        _ => baci!("PLU mora biti cijeli broj od 0 do 999999"),
    }
}

/// JS `x !== y` za vrijednosti iz JSON-a i baze (brojevi po vrijednosti).
pub(crate) fn razlicito(a: &Value, b: &Value) -> bool {
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
    if poslano("plu") {
        upis.plu = Some(validiraj_plu(&data["plu"])?);
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
            upis.plu.unwrap_or(Value::Null),
            upis.barkod.unwrap_or(Value::Null),
            tip,
            data["plocaSirina"],
            data["plocaVisina"],
        ],
    )?;
    Ok(json!({ "id": result.last_insert_rowid }))
}

fn product_update(b: &Backend, id: &Value, data: &Value) -> R<Value> {
    let db = b.db()?;
    let upis = validiraj_artikal(db, data, id)?;
    let mut fields: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(s) = upis.sifra { fields.push("sifra = ?"); values.push(json!(s)); }
    if let Some(n) = upis.naziv { fields.push("naziv = ?"); values.push(json!(n)); }
    if has(data, "jm") { fields.push("jm = ?"); values.push(data["jm"].clone()); }
    if has(data, "cijena") { fields.push("cijena = ?"); values.push(data["cijena"].clone()); }
    if has(data, "pdvStopa") { fields.push("pdvStopa = ?"); values.push(data["pdvStopa"].clone()); }
    if let Some(plu) = upis.plu { fields.push("plu = ?"); values.push(plu); }
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
                audit::zabiljezi(
                    b,
                    "artikal:cijena",
                    json!({ "productId": id, "staraCijena": prije["cijena"], "novaCijena": data["cijena"], "izvor": "rucno" }),
                )?;
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
    // Historija cijena artikla bez primki ima samo ručne izmjene, a šifre dobavljača su
    // samo šifarnik — obje idu s artiklom.
    db.tx(|| {
        db.run("DELETE FROM cijena_historija WHERE productId = ?", p![id])?;
        db.run("DELETE FROM artikal_dobavljac_sifre WHERE productId = ?", p![id])?;
        let result = db.run("DELETE FROM products WHERE id = ?", p![id])?;
        Ok(json!({ "changes": result.changes }))
    })
}

fn product_adjust_stock(b: &Backend, product_id: &Value, new_stanje: &Value) -> R<Value> {
    let db = b.db()?;
    if !db.ima("SELECT 1 FROM products WHERE id = ?", p![product_id])? {
        baci!("Artikal ne postoji");
    }
    let Some(novo) = new_stanje.as_f64().filter(|x| x.is_finite()) else {
        baci!("Stanje mora biti broj");
    };
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

    let diff = novo - js::to_number(&stanje);
    if diff == 0.0 {
        return Ok(json!({ "changes": 0 }));
    }

    let tip = if diff > 0.0 { "ulaz" } else { "izlaz" };
    let kolicina = js::f(diff.abs());

    db.tx(|| {
        db.run(
            "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, ?, ?, 'adjustment', 0)",
            p![product_id, tip, kolicina],
        )?;
        audit::zabiljezi(b, "zaliha:korekcija", json!({ "productId": product_id, "staroStanje": stanje, "novoStanje": new_stanje }))
    })?;

    Ok(json!({ "changes": 1 }))
}

fn product_search(db: &Db, query: &Value) -> R<Value> {
    let like = format!("%{}%", js::to_string(query));
    db.all(
        &format!("{SELECT_SA_SIFRAMA}\n        WHERE (p.naziv LIKE ? OR p.sifra LIKE ? OR p.barkod LIKE ?\n          OR EXISTS (SELECT 1 FROM artikal_dobavljac_sifre ds WHERE ds.productId = p.id AND ds.sifra LIKE ?))\n          AND p.tip != 'materijal' AND p.slobodan = 0\n        ORDER BY p.naziv\n      "),
        p![like, like, like, like],
    )
    .map(Value::from)
}

// ─── Šifre dobavljača ───────────────────────────────────

fn product_get_dobavljac_sifre(db: &Db, product_id: &Value) -> R<Value> {
    db.all(
        "
      SELECT ds.dobavljacId, d.naziv AS dobavljacNaziv, ds.sifra
      FROM artikal_dobavljac_sifre ds JOIN dobavljaci d ON d.id = ds.dobavljacId
      WHERE ds.productId = ?
      ORDER BY d.naziv, ds.dobavljacId
    ",
        p![product_id],
    )
    .map(Value::from)
}

// Zamjenjuje sve šifre dobavljača artikla. Prazna šifra = artikal je vezan za
// dobavljača bez šifre. Sve se provjeri prije upisa, pa greška ništa ne mijenja.
fn product_set_dobavljac_sifre(db: &Db, product_id: &Value, lista: &Value) -> R<Value> {
    if !db.ima("SELECT 1 FROM products WHERE id = ?", p![product_id])? {
        baci!("Artikal ne postoji");
    }
    let mut upis: Vec<(Value, Value)> = Vec::new();
    for s in lista.as_array().map(Vec::as_slice).unwrap_or_default() {
        let dobavljac_id = &s["dobavljacId"];
        let Some(dobavljac) = db.get("SELECT naziv FROM dobavljaci WHERE id = ?", p![dobavljac_id])? else {
            baci!("Dobavljač ne postoji");
        };
        let naziv = js::to_string(&dobavljac["naziv"]);
        if upis.iter().any(|(d, _)| d == dobavljac_id) {
            baci!("Dobavljač \"{naziv}\" je naveden više puta");
        }
        let sifra = js::trim(&s["sifra"]).filter(|t| !t.is_empty()).map(str::to_string);
        if let Some(sifra) = &sifra {
            let zauzeo = db.get(
                "
          SELECT p.sifra, p.naziv FROM artikal_dobavljac_sifre ds JOIN products p ON p.id = ds.productId
          WHERE ds.dobavljacId = ? AND ds.sifra = ? AND ds.productId != ?
        ",
                p![dobavljac_id, sifra, product_id],
            )?;
            if let Some(z) = zauzeo {
                baci!(
                    "Dobavljač \"{naziv}\" već ima šifru \"{sifra}\" na artiklu \"{}\" ({})",
                    js::to_string(&z["naziv"]),
                    js::to_string(&z["sifra"])
                );
            }
        }
        upis.push((dobavljac_id.clone(), sifra.map(Value::from).unwrap_or(Value::Null)));
    }
    db.tx(|| {
        db.run("DELETE FROM artikal_dobavljac_sifre WHERE productId = ?", p![product_id])?;
        for (dobavljac_id, sifra) in &upis {
            db.run(
                "INSERT INTO artikal_dobavljac_sifre (productId, dobavljacId, sifra) VALUES (?, ?, ?)",
                p![product_id, dobavljac_id, sifra],
            )?;
        }
        Ok(json!({ "changes": upis.len() }))
    })
}

// Temelj automatskog unosa robe: artikal po tačnoj šifri s dobavljačeve fakture.
fn product_find_by_dobavljac_sifra(db: &Db, dobavljac_id: &Value, sifra: &Value) -> R<Value> {
    let Some(s) = js::trim(sifra).filter(|t| !t.is_empty()) else {
        return Ok(Value::Null);
    };
    db.get(
        "
      SELECT p.*,
        COALESCE(
          (SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
           FROM stock_movements sm WHERE sm.productId = p.id),
          0
        ) AS stanje
      FROM artikal_dobavljac_sifre ds JOIN products p ON p.id = ds.productId
      WHERE ds.dobavljacId = ? AND ds.sifra = ?
    ",
        p![dobavljac_id, s],
    )
    .map(|r| r.unwrap_or(Value::Null))
}

// Slobodna stavka na kasi: kasir upiše naziv, cijenu i stopu, a stavka dobije
// skriveni artikal (slobodan = 1, bez zalihe, van šifarnika) s automatskom šifrom.
// Tring pamti naziv, JM i stopu po artiklu i u toku dana ih ne smije mijenjati,
// a svaki novi artikal trajno zauzme mjesto (PLU) u memoriji uređaja — zato se
// isti naziv (bez obzira na velika slova), stopa i JM uvijek vraćaju na isti
// artikal, kome se mijenja samo cijena.
fn product_slobodan(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db()?;
    let naziv = js::trim(&data["naziv"]).unwrap_or("").to_string();
    if naziv.is_empty() {
        baci!("Naziv stavke je obavezan");
    }
    if naziv.encode_utf16().count() > SLOBODAN_NAZIV_MAX {
        baci!("Naziv stavke može imati najviše {SLOBODAN_NAZIV_MAX} znaka");
    }
    let cijena = js::to_number(&data["cijena"]);
    if data["cijena"].is_null() || !(0.01..=9_999_999.99).contains(&cijena) {
        baci!("Cijena mora biti između 0,01 i 9.999.999,99");
    }
    let Some(stopa) = data["pdvStopa"].as_str().filter(|s| PDV_STOPE.contains(s)) else {
        baci!("PDV stopa mora biti E ili K");
    };
    let jm = js::trim(&data["jm"]).filter(|s| !s.is_empty()).unwrap_or("kom").to_string();

    db.tx(|| {
        // SQLite-ov lower() zna samo ASCII (Š ≠ š), pa se naziv poredi ovdje.
        let kandidati = db.all("SELECT id, naziv, cijena FROM products WHERE slobodan = 1 AND pdvStopa = ? AND jm = ?", p![stopa, jm])?;
        let mali = naziv.to_lowercase();
        let postojeci = kandidati.iter().find(|k| k["naziv"].as_str().is_some_and(|n| n.to_lowercase() == mali));
        let id = match postojeci {
            Some(k) => {
                db.run("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?", p![data["cijena"], k["id"]])?;
                if razlicito(&data["cijena"], &k["cijena"]) {
                    audit::zabiljezi(
                        b,
                        "artikal:cijena",
                        json!({ "productId": k["id"], "staraCijena": k["cijena"], "novaCijena": data["cijena"], "izvor": "slobodan" }),
                    )?;
                }
                k["id"].clone()
            }
            None => {
                let zadnji = db.val("SELECT MAX(CAST(substr(sifra, 2) AS INTEGER)) AS n FROM products WHERE slobodan = 1", p![])?;
                let mut broj = zadnji.as_i64().unwrap_or(0) + 1;
                let sifra_za = |n: i64| format!("S{}", js::pad(n, 6));
                while db.ima("SELECT 1 FROM products WHERE sifra = ?", p![sifra_za(broj)])? {
                    broj += 1;
                }
                let r = db.run(
                    "
          INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, slobodan)
          VALUES (?, ?, ?, ?, ?, 'usluga', 1)
        ",
                    p![sifra_za(broj), naziv, jm, data["cijena"], stopa],
                )?;
                json!(r.last_insert_rowid)
            }
        };
        db.get("SELECT p.*, 0 AS stanje FROM products p WHERE p.id = ?", p![id]).map(|r| r.unwrap_or(Value::Null))
    })
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
fn azuriraj(db: &Db, tabela: &str, id: &Value, data: &Value, upis: Vec<(&str, Value)>, polja: &[&str]) -> R<Value> {
    let mut fields: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    for (k, v) in upis {
        fields.push(format!("{k} = ?"));
        values.push(v);
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
    let upis = naziv.map(|n| vec![("naziv", json!(n))]).unwrap_or_default();
    azuriraj(db, "dobavljaci", id, data, upis, &["idBroj", "pdvBroj", "adresa", "kontakt"])
}

fn dobavljac_delete(db: &Db, id: &Value) -> R<Value> {
    let Some(dobavljac) = db.get("SELECT naziv, idBroj, pdvBroj FROM dobavljaci WHERE id = ?", p![id])? else {
        return Ok(json!({ "changes": 0 }));
    };
    if is_dobavljac_used(db, &dobavljac["naziv"], &dobavljac["idBroj"], &dobavljac["pdvBroj"])? {
        baci!("Dobavljač se koristi u primkama i ne može biti obrisan");
    }
    if db.ima("SELECT 1 FROM artikal_dobavljac_sifre WHERE dobavljacId = ? LIMIT 1", p![id])? {
        baci!("Dobavljač je vezan za artikle i ne može biti obrisan");
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

const NACINI_PLACANJA: [&str; 4] = ["Gotovina", "Kartica", "Virman", "Ček"];

// Zadane vrijednosti kupca za dokumente — samo poslana polja; prazno/null briše vrijednost.
fn validiraj_zadano_kupca(data: &Value) -> R<Vec<(&'static str, Value)>> {
    let prazno = |v: &Value| v.is_null() || v.as_str() == Some("");
    let mut upis = Vec::new();
    if has(data, "rokPlacanjaDana") {
        let v = &data["rokPlacanjaDana"];
        if prazno(v) {
            upis.push(("rokPlacanjaDana", Value::Null));
        } else {
            match v.as_f64() {
                Some(n) if js::is_integer(v) && (0.0..=365.0).contains(&n) => upis.push(("rokPlacanjaDana", json!(n as i64))),
                _ => baci!("Rok plaćanja mora biti cijeli broj dana od 0 do 365"),
            }
        }
    }
    if has(data, "nacinPlacanja") {
        let v = &data["nacinPlacanja"];
        if prazno(v) {
            upis.push(("nacinPlacanja", Value::Null));
        } else {
            match v.as_str() {
                Some(s) if NACINI_PLACANJA.contains(&s) => upis.push(("nacinPlacanja", json!(s))),
                _ => baci!("Nepoznat način plaćanja \"{}\"", js::to_string(v)),
            }
        }
    }
    if has(data, "rabat") {
        let v = &data["rabat"];
        if prazno(v) {
            upis.push(("rabat", Value::Null));
        } else {
            // Gornja granica se provjerava nakon zaokruživanja (99.995 → 100); negativno se
            // odbija prije, jer JS Math.round i f64::round različito zaokružuju -x.5.
            match v.as_f64().map(|n| (n, (n * 100.0).round() / 100.0)) {
                Some((n, r)) if n.is_finite() && n >= 0.0 && r < 100.0 => upis.push(("rabat", json!(r))),
                _ => baci!("Rabat kupca mora biti od 0 do manje od 100 %"),
            }
        }
    }
    Ok(upis)
}

fn kupac_create(db: &Db, data: &Value) -> R<Value> {
    let upis = validiraj_kupca(db, data, &Value::Null)?;
    let (naziv, id_broj) = (&upis[0].1, &upis[1].1);
    let zadano = validiraj_zadano_kupca(data)?;
    let zadano_po = |k: &str| zadano.iter().find(|(z, _)| *z == k).map(|(_, v)| v.clone()).unwrap_or(Value::Null);
    let result = db.run(
        "INSERT INTO kupci (naziv, idBroj, pdvBroj, adresa, postanskiBroj, grad, kontakt, rokPlacanjaDana, nacinPlacanja, rabat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p![
            naziv, id_broj, data["pdvBroj"], data["adresa"], data["postanskiBroj"], data["grad"], data["kontakt"],
            zadano_po("rokPlacanjaDana"), zadano_po("nacinPlacanja"), zadano_po("rabat")
        ],
    )?;
    Ok(json!({ "id": result.last_insert_rowid }))
}

fn kupac_update(db: &Db, id: &Value, data: &Value) -> R<Value> {
    let mut upis: Vec<(&str, Value)> = validiraj_kupca(db, data, id)?.into_iter().map(|(k, v)| (k, json!(v))).collect();
    upis.extend(validiraj_zadano_kupca(data)?);
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
        "product:update" => product_update(b, &a[0], &a[1]),
        "product:delete" => product_delete(db, &a[0]),
        "product:adjustStock" => product_adjust_stock(b, &a[0], &a[1]),
        "product:search" => product_search(db, &a[0]),
        "product:slobodan" => product_slobodan(b, &a[0]),
        "product:getDobavljacSifre" => product_get_dobavljac_sifre(db, &a[0]),
        "product:setDobavljacSifre" => product_set_dobavljac_sifre(db, &a[0], &a[1]),
        "product:findByDobavljacSifra" => product_find_by_dobavljac_sifra(db, &a[0], &a[1]),
        "materijal:search" => materijal_search(db, &a[0]),
        "dobavljac:getAll" => db.all("SELECT * FROM dobavljaci ORDER BY naziv", p![]).map(Value::from),
        "dobavljac:create" => dobavljac_create(db, &a[0]),
        "dobavljac:update" => dobavljac_update(db, &a[0], &a[1]),
        "dobavljac:delete" => dobavljac_delete(db, &a[0]),
        "dobavljac:getSifre" => db
            .all(
                "SELECT productId, sifra FROM artikal_dobavljac_sifre WHERE dobavljacId = ? AND sifra IS NOT NULL ORDER BY sifra",
                p![a[0]],
            )
            .map(Value::from),
        "kupac:getAll" => db.all("SELECT * FROM kupci ORDER BY naziv", p![]).map(Value::from),
        "kupac:search" => kupac_search(db, &a[0]),
        "kupac:create" => kupac_create(db, &a[0]),
        "kupac:update" => kupac_update(db, &a[0], &a[1]),
        "kupac:delete" => kupac_delete(db, &a[0]),
        _ => return None,
    })
}
