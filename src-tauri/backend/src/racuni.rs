//! Kanali `order:*`, `pending:*`, `prilog:*` i `fiscal:*` (handlers.ts) i
//! logika iz `lib/prilog.ts`, `lib/refund.ts` i `lib/valuta.ts`.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Mutex;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::greska::{Greska, R};
use crate::js::{self, or, or_null, round2, to_number, truthy};
use crate::sql::Db;
use crate::tring::{self, Odgovor};
use crate::sesija::{self, Korisnik};
use crate::{audit, baci, cash, fiskalni, korisnici, p, provjera_racuna, racun, tring_racun, Args, Backend};

// ─── Pomoćne ────────────────────────────────────────────────

/// `{ ...base, k: v, ... }` — ključevi koji već postoje ostaju na svom mjestu.
fn spoji(base: &Value, dodaci: Vec<(&str, Value)>) -> Value {
    let mut m = base.as_object().cloned().unwrap_or_default();
    for (k, v) in dodaci {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

/// `for (const s of stavke)` — ono što nije niz u JS-u baca TypeError.
fn niz<'a>(v: &'a Value, ime: &str) -> R<&'a Vec<Value>> {
    match v.as_array() {
        Some(a) => Ok(a),
        None => baci!("{ime} is not iterable"),
    }
}

/// `result.error || result.vrstaOdgovora || 'Nepoznata greška'`
fn greska_odgovora(result: &Odgovor) -> Value {
    or(&result["error"], or(&result["vrstaOdgovora"], &json!("Nepoznata greška"))).clone()
}

/// `result.odgovori ?? {}`
fn odgovori(result: &Odgovor) -> Value {
    js::nn(&result["odgovori"], &json!({})).clone()
}

/// `result.odgovori?.BrojFiskalnogRacuna || null`
fn broj_sa_uredjaja(result: &Odgovor) -> Value {
    or_null(&result["odgovori"]["BrojFiskalnogRacuna"])
}

/// `err?.message || 'nepoznata greška'`
fn poruka(e: &Greska) -> &str {
    if e.0.is_empty() { "nepoznata greška" } else { &e.0 }
}

/// JS `Math.max(a, b)` / `Math.min(a, b)` — NaN se širi (Rustov `max` ga preskače).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}

/// `s.slice(0, n)` — JS broji UTF-16 jedinice.
fn slice_utf16(s: &str, n: usize) -> String {
    let jedinice: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&jedinice)
}

fn kupac_polje(data: &Value, k: &str) -> Value {
    or_null(&data["kupac"][k])
}

// ─── insertCompletedOrder (handlers.ts) ─────────────────────

// Insert a completed order + items + stock movements from a snapshot-shaped payload.
// Returns the new orderId. Caller is responsible for wrapping in a transaction.
fn insert_completed_order(db: &Db, data: &Value) -> R<i64> {
    let is_manual = js::nn(&data["isManual"], &json!(0)).clone();
    let created_at = data["createdAt"].as_str().filter(|s| !s.is_empty());
    let has_created_at = created_at.is_some();

    let sql = format!(
        "
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
        kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual{}, prilogBroj, prilogNaziv, datumValute, napomena)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?{}, ?, ?, ?, ?)
    ",
        if has_created_at { ", createdAt" } else { "" },
        if has_created_at { ", ?" } else { "" },
    );
    let mut params = vec![
        data["korisnikId"].clone(),
        data["ukupno"].clone(),
        data["pdvIznos"].clone(),
        data["nacinPlacanja"].clone(),
        data["brojFiskalnogRacuna"].clone(),
        kupac_polje(data, "naziv"),
        kupac_polje(data, "idBroj"),
        kupac_polje(data, "adresa"),
        kupac_polje(data, "grad"),
        kupac_polje(data, "postanskiBroj"),
        is_manual,
    ];
    if let Some(c) = created_at {
        params.push(json!(c));
    }
    params.push(data["prilogBroj"].clone());
    params.push(data["prilogNaziv"].clone());
    // Faktura: rok plaćanja i napomena putuju kroz snapshot.
    params.push(data["datumValute"].clone());
    params.push(data["napomena"].clone());
    let order_id = db.run(&sql, &params)?.last_insert_rowid;

    for item in niz(&data["stavke"], "data.stavke")? {
        db.run(
            "INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![order_id, item["productId"], item["kolicina"], item["cijena"], item["rabat"], item["pdvStopa"]],
        )?;
        let tip = db.get("SELECT tip FROM products WHERE id = ?", p![item["productId"]])?;
        if tip.map_or(true, |t| t["tip"] != "usluga") {
            match created_at {
                Some(c) => db.run(
                    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, ?)",
                    p![item["productId"], item["kolicina"], order_id, c],
                )?,
                None => db.run(
                    "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'order', ?)",
                    p![item["productId"], item["kolicina"], order_id],
                )?,
            };
        }
    }

    Ok(order_id)
}

// ─── lib/prilog.ts ──────────────────────────────────────────

// Račun po prilogu: fiskalno se kuca jedna zbirna stavka, a stvarne stavke se
// naknadno dodjeljuju (prilog_stavke) i printaju kao prilog uz fiskalni račun sa BF
// brojem. Vidi docs/superpowers/specs/2026-08-13-racun-po-prilogu-design.md.

pub const PRILOG_SIFRA: &str = "PRILOG";

/// Zadani dijelovi naziva zbirne stavke — „Stavke po računu br. 5".
pub const PRILOG_OPIS_DEFAULT: &str = "Stavke";
pub const PRILOG_VEZA_DEFAULT: &str = "računu";

/// Fiskalni uređaj ima kratko polje naziva stavke — dijelovi se ograničavaju već na unosu.
pub const PRILOG_OPIS_MAX: usize = 24;
pub const PRILOG_VEZA_MAX: usize = 14;

/// Naziv zbirne stavke. Operater po računu bira uvodni dio i vezu — „CNC obrada
/// po fakturi br. 128" — a prazan unos pada na zadane vrijednosti.
///
/// Broj je BF broj isječka na koji se stavka kuca, pa se u trenutku štampe zna
/// samo kao predviđanje (vidi `predvidjeni_fiskalni_broj`). `null` daje naziv bez
/// broja — koristi ga pregled u dijalogu dok se broj još ne zna.
pub fn prilog_naziv(broj: &Value, opis: &Value, veza: &Value) -> String {
    let dio = |v: &Value, max: usize, zadano: &str| {
        let s = if v.is_null() { String::new() } else { js::to_string(v) };
        let s = slice_utf16(s.trim(), max);
        if s.is_empty() { zadano.to_string() } else { s }
    };
    let o = dio(opis, PRILOG_OPIS_MAX, PRILOG_OPIS_DEFAULT);
    let v = dio(veza, PRILOG_VEZA_MAX, PRILOG_VEZA_DEFAULT);
    if broj.is_null() { format!("{o} po {v}") } else { format!("{o} po {v} br. {}", js::to_string(broj)) }
}

/// Zbir stavki priloga — zaokruživanje po stavci kao na fiskalnom uređaju.
pub fn suma_priloga(stavke: &[Value]) -> f64 {
    round2(stavke.iter().fold(0.0, |sum, s| sum + racun::iznos_stavke(&spoji(s, vec![("rabat", js::nn(&s["rabat"], &json!(0)).clone())]))))
}

/// Provjeri stavke priloga i vrati tip proizvoda po id-u (usluge ne diraju
/// zalihu). Odvojeno od upisa da se stavke mogu odbiti i prije štampe —
/// greška poslije štampe znači papir bez pokrića.
pub fn validiraj_prilog_stavke(db: &Db, stavke: &[Value]) -> R<HashMap<String, Value>> {
    let mut tipovi = HashMap::new();
    for s in stavke {
        // JS `!s || typeof s !== 'object'` — niz prolazi (i padne na količini).
        if !(s.is_object() || s.is_array()) {
            baci!("Neispravna stavka računa");
        }
        provjera_racuna::provjeri_iznose_stavke(s)?;
        if s["pdvStopa"] != "E" {
            baci!("U prilog smiju samo stavke sa PDV stopom E (zbirna stavka je fiskalizovana sa E)");
        }
        let Some(product) = db.get("SELECT tip FROM products WHERE id = ?", p![s["productId"]])? else {
            baci!("Proizvod #{} ne postoji", provjera_racuna::prikaz_polja(s, "productId"));
        };
        tipovi.insert(js::stringify(&s["productId"]), product["tip"].clone());
    }
    Ok(tipovi)
}

/// Zamijeni kompletan set stavki priloga i sinhronizuj zalihe.
///
/// Poziva se unutar transakcije (handler omotava u `db.tx`). Diff je
/// najjednostavniji mogući: obriši stara kretanja tipa 'prilog' pa upiši nova —
/// neto efekat na zalihu je isti kao ručni diff, a nema stanja za greške.
///
/// Sve provjere idu prije prvog upisa da poziv bez transakcije (testovi) ne
/// ostavi pola stavki u bazi.
pub fn save_prilog_stavke_in_transaction(db: &Db, order_id: &Value, stavke: &Value) -> R<()> {
    let Some(order) = db.get("SELECT prilogBroj, status, ukupno FROM orders WHERE id = ?", p![order_id])? else {
        baci!("Račun ne postoji");
    };
    if order["prilogBroj"].is_null() {
        baci!("Ovo nije račun po prilogu");
    }
    if order["status"] != "completed" {
        baci!("Račun je storniran — prilog se ne može mijenjati");
    }
    // Stavke se dodjeljuju dok se ne poklope s fiskalnim iznosom; tad je faktura završena.
    let postojece = db.all("SELECT kolicina, cijena, rabat, pdvStopa FROM prilog_stavke WHERE orderId = ?", p![order_id])?;
    if !postojece.is_empty() && suma_priloga(&postojece) == round2(to_number(&order["ukupno"])) {
        baci!("Faktura je završena — stavke se ne mogu mijenjati");
    }

    let stavke = niz(stavke, "stavke")?;
    let tipovi = validiraj_prilog_stavke(db, stavke)?;

    db.run("DELETE FROM prilog_stavke WHERE orderId = ?", p![order_id])?;
    db.run("DELETE FROM stock_movements WHERE referenceType = 'prilog' AND referenceId = ?", p![order_id])?;

    for s in stavke {
        db.run(
            "INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![order_id, s["productId"], s["kolicina"], s["cijena"], js::nn(&s["rabat"], &json!(0)), s["pdvStopa"]],
        )?;
        if tipovi.get(&js::stringify(&s["productId"])).map_or(true, |t| t != "usluga") {
            db.run(
                "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'prilog', ?)",
                p![s["productId"], s["kolicina"], order_id],
            )?;
        }
    }
    Ok(())
}

/// Zbirna stavka kako se šalje fiskalnom uređaju (i sintetizuje u prikazima).
pub fn build_prilog_fiskalna_stavka(prilog_broj: &Value, iznos: f64, naziv: &Value) -> Value {
    let naziv = if truthy(naziv) { naziv.clone() } else { json!(prilog_naziv(prilog_broj, &Value::Null, &Value::Null)) };
    json!({
        "productId": 0,
        "sifra": PRILOG_SIFRA,
        "naziv": naziv,
        "jm": "kom",
        "plu": 0,
        "cijena": js::f(round2(iznos)),
        "kolicina": 1,
        "rabat": 0,
        "pdvStopa": "E",
    })
}

/// Napomena na fakturi — stane u nekoliko redova ispod stavki.
pub const FAKTURA_NAPOMENA_MAX: usize = 500;

/// Datum valute, napomena i ponuda se provjeravaju prije štampe — greška poslije
/// štampe znači papir bez zapisa. Vraća normalizovane vrijednosti za upis
/// `(datumValute, napomena, ponudaId)`.
pub fn provjeri_dodatke_fakture(db: &Db, data: &Value) -> R<(Value, Value, Value)> {
    // `x?.trim() || null`
    let ocisti = |v: &Value| js::trim(v).filter(|s| !s.is_empty()).map(Value::from).unwrap_or(Value::Null);
    let datum_valute = ocisti(&data["datumValute"]);
    if let Some(d) = datum_valute.as_str() {
        if !validan_datum_valute(d) {
            baci!("Neispravan datum valute: {d}");
        }
    }
    let napomena = ocisti(&data["napomena"]);
    if js::length(&napomena).is_some_and(|n| n > FAKTURA_NAPOMENA_MAX) {
        baci!("Napomena može imati najviše {FAKTURA_NAPOMENA_MAX} znakova");
    }
    let ponuda_id = data["ponudaId"].clone();
    if !ponuda_id.is_null() {
        let Some(ponuda) = db.get("SELECT status FROM ponude WHERE id = ?", p![ponuda_id])? else {
            baci!("Ponuda ne postoji");
        };
        if ponuda["status"] == "konvertovana" {
            baci!("Ponuda je već konvertovana u račun");
        }
        if ponuda["status"] == "odbijena" {
            baci!("Odbijena ponuda se ne može pretvoriti u fakturu — ako kupac ipak prihvata, prvo promijenite status");
        }
    }
    Ok((datum_valute, napomena, ponuda_id))
}

/// Ponuda po kojoj je izdana faktura — isto stanje kao nakon konverzije u račun.
pub fn oznaci_ponudu_fakturisanom(db: &Db, ponuda_id: &Value, order_id: &Value) -> R<()> {
    db.run("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?", p![order_id, ponuda_id])?;
    Ok(())
}

/// Fiskalizuje račun po prilogu: jedna zbirna stavka na uređaju.
///
/// Iznos dolazi na dva načina — ručno ukucan, ili izveden iz stavki koje je
/// operater unio odmah na kasi. Kad stavke postoje, one su jedini izvor
/// istine za iznos i upisuju se u istoj transakciji kao i račun, pa nema
/// stanja u kojem je račun fiskalizovan a stavke izgubljene.
///
/// Isti write-ahead obrazac kao order:finalize — snapshot u pending_receipts
/// prije štampe, pa atomični upis ordera + brisanje pending reda.
fn finalize_prilog_and_print(b: &Backend, data: &Value) -> R<Value> {
    let db = b.baza()?;
    if !truthy(&data["korisnikId"]) {
        baci!("Korisnik nije prijavljen");
    }

    let stavke_v = js::nn(&data["stavke"], &json!([])).clone();
    let Some(stavke) = stavke_v.as_array() else {
        baci!("Neispravna stavka računa");
    };
    // Prije bilo kakve štampe: neispravna stavka ne smije proizvesti papir.
    if !stavke.is_empty() {
        validiraj_prilog_stavke(db, stavke)?;
    }
    let iznos = if !stavke.is_empty() { Some(suma_priloga(stavke)) } else { js::nn(&data["iznos"], &json!(0)).as_f64() };
    let Some(iznos) = iznos.filter(|x| x.is_finite() && *x > 0.0) else {
        baci!("Iznos mora biti veći od 0");
    };
    let nacin_placanja = json!(provjera_racuna::provjeri_nacin_placanja(&data["nacinPlacanja"])?);
    let kupac = provjera_racuna::provjeri_kupca(&data["kupac"])?;
    let kupac_v = kupac.clone().unwrap_or(Value::Null);
    let (datum_valute, napomena, ponuda_id) = provjeri_dodatke_fakture(db, data)?;

    // Naziv stavke mora nositi broj isječka na koji se kuca, a njega uređaj vrati
    // tek nakon štampe — zato predviđanje iz fiskalnog niza. Poslije štampe se
    // poredi sa stvarnim BF-om i razlika se prijavljuje operateru.
    let Some(predvidjeni_broj) = fiskalni::predvidjeni_fiskalni_broj(db)? else {
        baci!(
            "Nije poznat posljednji fiskalni broj, pa se broj fakture ne može odštampati na isječku. \
             Upišite posljednji izdati fiskalni broj prije štampe."
        );
    };
    // Naziv se zamrzava ovdje: storno i kopija računa moraju odštampati isti
    // tekst koji je otišao na fiskalni uređaj, pa se čuva uz račun.
    let naziv = prilog_naziv(&json!(predvidjeni_broj), &data["prilogOpis"], &data["prilogVeza"]);
    let stavka = build_prilog_fiskalna_stavka(&json!(predvidjeni_broj), iznos, &json!(naziv));
    let (ukupno, pdv_iznos) = racun::izracunaj_totale(std::slice::from_ref(&stavka));

    // Write-ahead: stavke:[] + prilogBroj → pending:resolve rekonstruiše prilog
    // račun; prilogStavke nosi stvarne stavke da se ne izgube pri spašavanju.
    // `JSON.stringify` izostavlja ključeve čija je vrijednost `undefined`.
    let mut snapshot = Map::new();
    snapshot.insert("korisnikId".into(), data["korisnikId"].clone());
    snapshot.insert("ukupno".into(), js::f(ukupno));
    snapshot.insert("pdvIznos".into(), js::f(pdv_iznos));
    snapshot.insert("nacinPlacanja".into(), nacin_placanja.clone());
    if let Some(k) = &kupac {
        snapshot.insert("kupac".into(), k.clone());
    }
    snapshot.insert("stavke".into(), json!([]));
    snapshot.insert("prilogBroj".into(), json!(predvidjeni_broj));
    snapshot.insert("prilogNaziv".into(), json!(naziv));
    snapshot.insert("prilogStavke".into(), stavke_v.clone());
    snapshot.insert("datumValute".into(), datum_valute.clone());
    snapshot.insert("napomena".into(), napomena.clone());
    snapshot.insert("ponudaId".into(), ponuda_id.clone());
    let pending_id = db
        .run(
            "INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)",
            p![data["korisnikId"], js::stringify(&Value::Object(snapshot))],
        )?
        .last_insert_rowid;

    // Štampa u Rustu ne baca — greška veze stiže kao neuspješan odgovor, pa
    // grana "izuzetak iz štampe → počisti write-ahead red" pada u granu ispod.
    let racun = tring_racun::build_tring_racun(&json!({
        "ukupno": js::f(ukupno),
        "nacinPlacanja": nacin_placanja,
        "kupac": kupac_v,
        "items": [stavka],
    }));
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] finalizePrilog request: {}", js::stringify(&racun));
    }
    let result = b.tring.stampati_fiskalni_racun(&racun);
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] finalizePrilog response: {}", js::stringify(&result));
    }

    if !tring::uspjeh(&result) {
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
        return Ok(json!({
            "success": false,
            "error": greska_odgovora(&result),
            "odgovori": odgovori(&result),
        }));
    }

    let broj_fiskalnog_racuna = broj_sa_uredjaja(&result);
    // Faktura nosi isti broj kao fiskalni isječak uz koji ide. Kad uređaj vrati
    // broj različit od predviđenog, papir već nosi pogrešan broj u nazivu stavke —
    // faktura ide po stvarnom, a operater to mora saznati odmah.
    let prilog_broj = fiskalni::parse_fiskalni_broj(&broj_fiskalnog_racuna).unwrap_or(predvidjeni_broj);
    let upozorenje = (prilog_broj != predvidjeni_broj).then(|| {
        format!(
            "Na isječku je odštampan br. {predvidjeni_broj}, a uređaj je vratio BF {}. Faktura nosi br. {prilog_broj} — provjerite isječak.",
            js::to_string(&broj_fiskalnog_racuna)
        )
    });
    let upis = db.tx(|| {
        let r = db.run(
            "
        INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
          kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, prilogBroj, prilogNaziv,
          datumValute, napomena)
        VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      ",
            p![
                data["korisnikId"], js::f(ukupno), js::f(pdv_iznos), nacin_placanja, broj_fiskalnog_racuna,
                or_null(&kupac_v["naziv"]), or_null(&kupac_v["idBroj"]), or_null(&kupac_v["adresa"]),
                or_null(&kupac_v["grad"]), or_null(&kupac_v["postanskiBroj"]), prilog_broj, naziv,
                datum_valute, napomena
            ],
        )?;
        let order_id = r.last_insert_rowid;
        if !stavke.is_empty() {
            save_prilog_stavke_in_transaction(db, &json!(order_id), &stavke_v)?;
        }
        if !ponuda_id.is_null() {
            oznaci_ponudu_fakturisanom(db, &ponuda_id, &json!(order_id))?;
        }
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
        Ok(order_id)
    });
    let order_id = match upis {
        Ok(id) => id,
        // Račun je već na papiru; pending red namjerno ostaje da se može riješiti
        // kroz pending:resolve, ali operater to mora znati odmah.
        Err(e) => baci!(
            "Fiskalni račun po prilogu br. {prilog_broj} (BF {}) JE odštampan, ali nije zabilježen u bazi: {}. Riješite ga kroz nezavršene račune.",
            if broj_fiskalnog_racuna.is_null() { "?".to_string() } else { js::to_string(&broj_fiskalnog_racuna) },
            poruka(&e)
        ),
    };

    let mut out = Map::new();
    out.insert("success".into(), json!(true));
    out.insert("id".into(), json!(order_id));
    out.insert("prilogBroj".into(), json!(prilog_broj));
    out.insert("brojFiskalnogRacuna".into(), broj_fiskalnog_racuna);
    if let Some(u) = upozorenje {
        out.insert("upozorenje".into(), json!(u));
    }
    out.insert("odgovori".into(), result["odgovori"].clone());
    Ok(Value::Object(out))
}

// ─── lib/refund.ts ──────────────────────────────────────────

/// Označi račun storniranim, vrati zalihu i upiši broj reklamacije.
///
/// Poziva se unutar transakcije. Provjera statusa je ujedno i zaštita od
/// dvostrukog storna: drugi poziv za isti račun više ne nađe 'completed' red.
/// Usluge nemaju zalihu pa se za njih ne kreira kretanje.
pub fn refund_order_in_transaction(db: &Db, id: &Value, broj_reklamacije: &Value) -> R<()> {
    let Some(order) = db.get("SELECT id, prilogBroj FROM orders WHERE id = ? AND status = 'completed'", p![id])? else {
        baci!("Račun ne postoji ili je već storniran");
    };

    db.run(
        "UPDATE orders SET status = 'refunded', refundedAt = datetime('now','localtime'), brojReklamacije = COALESCE(?, brojReklamacije) WHERE id = ?",
        p![broj_reklamacije, id],
    )?;

    // Prilog račun nema order_items — zaliha se vraća po stavkama priloga.
    let items = if !order["prilogBroj"].is_null() {
        db.all("SELECT productId, kolicina FROM prilog_stavke WHERE orderId = ?", p![id])?
    } else {
        db.all("SELECT productId, kolicina FROM order_items WHERE orderId = ?", p![id])?
    };

    for item in items {
        let product = db.get("SELECT tip FROM products WHERE id = ?", p![item["productId"]])?;
        if product.map_or(true, |p| p["tip"] != "usluga") {
            db.run(
                "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'refund', ?)",
                p![item["productId"], item["kolicina"], id],
            )?;
        }
    }
    Ok(())
}

/// Tring ne vraća šifru greške za praznu ladicu, samo tekst, pa se prepoznaje
/// po ključnim riječima. Ako se tekst promijeni, override se i dalje nudi jer
/// ga pali i lokalno stanje ladice.
fn je_nedovoljno_sredstava(r: &Odgovor) -> bool {
    thread_local!(static NEDOVOLJNO_RE: Regex =
        Regex::new(r"(?i)nedovoljno|nema dovoljno|insufficient|nedostaje|manjak|prazna kasa").unwrap());
    let tekst = |v: &Value| if v.is_null() { String::new() } else { js::to_string(v) };
    let mut dijelovi = vec![tekst(&r["error"]), tekst(&r["vrstaOdgovora"])];
    if let Some(o) = r["odgovori"].as_object() {
        dijelovi.extend(o.values().map(|v| js::to_string(v)));
    }
    NEDOVOLJNO_RE.with(|re| re.is_match(&dijelovi.join(" ")))
}

/// Računi kojima se storno trenutno štampa — zaštita od dvoklika (dok jedan
/// poziv čeka uređaj, drugi može stići; vidi petlja.rs).
static REFUNDS_IN_FLIGHT: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

fn refunds_in_flight() -> std::sync::MutexGuard<'static, BTreeSet<String>> {
    REFUNDS_IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Skida račun iz `REFUNDS_IN_FLIGHT` kad storno završi (JS `finally`).
struct UToku(String);

impl Drop for UToku {
    fn drop(&mut self) {
        refunds_in_flight().remove(&self.0);
    }
}

fn print_reklamacija(b: &Backend, racun: &Value) -> Odgovor {
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] refundAndPrint request: {}", js::stringify(racun));
    }
    let result = b.tring.stampati_reklamirani_racun(racun);
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] refundAndPrint response: {}", js::stringify(&result));
    }
    result
}

/// Odštampa reklamaciju i tek nakon uspješne štampe upiše storno u bazu, u
/// jednoj transakciji. Ranije su štampa, promjena statusa i upis broja bila tri
/// odvojena IPC poziva iz renderera, pa je pad ili dvoklik između njih ostavljao
/// odštampan fiskalni storno bez ikakvog traga u bazi.
fn refund_and_print(b: &Backend, data: &Value, korisnik_id: i64) -> R<Value> {
    let db = b.baza()?;
    let id = &data["id"];
    let kljuc = js::stringify(id);

    if refunds_in_flight().contains(&kljuc) {
        baci!("Storniranje ovog računa je već u toku");
    }

    let Some(order) = db.get("SELECT * FROM orders WHERE id = ? AND status = 'completed'", p![id])? else {
        baci!("Račun ne postoji ili je već storniran");
    };

    let Some(broj_racuna) = fiskalni::parse_fiskalni_broj(&order["brojFiskalnogRacuna"]) else {
        let broj = if order["brojFiskalnogRacuna"].is_null() { String::new() } else { js::to_string(&order["brojFiskalnogRacuna"]) };
        baci!("Fiskalni broj \"{broj}\" nije ispravan broj računa — reklamacija se ne može odštampati");
    };

    // Reklamacija mora imati istu stavku kao original — prilog račun je
    // fiskalizovan jednom zbirnom stavkom, pa se ona ovdje sintetizuje.
    let stavke = if !order["prilogBroj"].is_null() {
        let naziv = if truthy(&order["prilogNaziv"]) {
            order["prilogNaziv"].clone()
        } else {
            json!(prilog_naziv(&order["prilogBroj"], &Value::Null, &Value::Null))
        };
        json!([{
            "sifra": PRILOG_SIFRA, "naziv": naziv, "jm": "kom", "plu": 0,
            "cijena": order["ukupno"], "kolicina": 1, "rabat": 0, "pdvStopa": "E",
        }])
    } else {
        Value::from(db.all(
            "
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?
      ",
            p![id],
        )?)
    };

    // Tring povrat po reklamiranom računu ide isključivo gotovinom, bez obzira
    // kako je original plaćen — uređaj traži pokriće u punom iznosu računa i
    // inače vrati ERROR_FISCAL_INSUFFICIENT_MONEY. Iz ladice, međutim, fizički
    // izlazi samo gotovinski dio originala.
    let ukupno = to_number(&order["ukupno"]);
    let potrebno_uredjaj = round2(ukupno);
    let potrebno_ladica = cash::gotovinski_iznos(&order["nacinPlacanja"], ukupno);
    let mut manjak_uredjaj = 0.0;
    let mut manjak_ladica = 0.0;
    // Stanje ladice je informativno — ne smije oboriti storno.
    if let Ok(stanje) = cash::drawer_state(db) {
        let stanje_ladice = to_number(&stanje["ocekivanoStanje"]);
        manjak_uredjaj = js_max(0.0, round2(potrebno_uredjaj - stanje_ladice));
        manjak_ladica = js_max(0.0, round2(js_min(potrebno_ladica, potrebno_uredjaj) - stanje_ladice));
    }

    refunds_in_flight().insert(kljuc.clone());
    let _u_toku = UToku(kljuc);

    let dozvoli_polog = truthy(&data["dozvoliPolog"]);
    let mut uneseno = 0.0;

    // Nenovčani dio pokrića ide automatski — nema odluke za operatera jer
    // nikakav stvaran novac ne mijenja vlasnika (virmanski račun se ovdje
    // pokriva u cijelosti, pa storno prolazi bez ijednog dodatnog klika).
    let samo_uredjaj = js_max(0.0, round2(manjak_uredjaj - manjak_ladica));
    if samo_uredjaj > 0.0 {
        cash::device_cash_in(b, samo_uredjaj)?;
        uneseno = samo_uredjaj;
    }

    // Gotovinski manjak je stvaran novac iz ladice — samo se on gura kroz
    // override i samo se on evidentira kao polog.
    let mut polog_iznos = 0.0;
    if dozvoli_polog && manjak_ladica > 0.0 {
        let napomena = format!("Automatski polog za reklamaciju računa #{}", js::to_string(id));
        cash::deposit_cash(b, manjak_ladica, &napomena, &json!(korisnik_id))?;
        polog_iznos = manjak_ladica;
        uneseno = round2(uneseno + manjak_ladica);
    }

    let kupac = if truthy(&order["kupacIdBroj"]) {
        let s = |k: &str| or(&order[k], &json!("")).clone();
        json!({
            "idBroj": order["kupacIdBroj"],
            "naziv": s("kupacNaziv"),
            "adresa": s("kupacAdresa"),
            "postanskiBroj": s("kupacPostanskiBroj"),
            "grad": s("kupacGrad"),
        })
    } else {
        Value::Null
    };
    let racun = tring_racun::build_tring_reklamacija(&json!({ "stavke": stavke, "kupac": kupac }), broj_racuna);

    let mut result = print_reklamacija(b, &racun);

    // Stanje ladice je samo procjena brojača u uređaju (pologi se mogu voditi
    // i mimo aplikacije), pa ako uređaj i dalje javlja manjak — dopuni do
    // punog iznosa računa i pokušaj još jednom. Storno taj iznos odmah
    // potroši, tako da brojač uređaja ne ostane napuhan. Bez pitanja kad
    // gotovinski manjak ne postoji; inače tek uz override.
    if (manjak_ladica == 0.0 || dozvoli_polog) && !tring::uspjeh(&result) && je_nedovoljno_sredstava(&result) {
        let dopuna = round2(potrebno_uredjaj - uneseno);
        if dopuna > 0.0 {
            cash::device_cash_in(b, dopuna)?;
            uneseno = round2(uneseno + dopuna);
            result = print_reklamacija(b, &racun);
        }
    }

    if !tring::uspjeh(&result) {
        // Override se nudi samo ako može pomoći: kad fali stvarna gotovina, ili
        // kad uređaj i dalje traži novac a nismo ga dopunili do punog iznosa.
        let nedovoljno = !dozvoli_polog
            && (manjak_ladica > 0.0 || (je_nedovoljno_sredstava(&result) && uneseno < potrebno_uredjaj));
        let manjak = if manjak_ladica > 0.0 { manjak_ladica } else { round2(potrebno_uredjaj - uneseno) };
        return Ok(json!({
            "success": false,
            "error": greska_odgovora(&result),
            "odgovori": odgovori(&result),
            "nedovoljnoSredstava": nedovoljno,
            "manjak": js::f(manjak),
        }));
    }

    let unesen_broj = data["brojReklamacije"].as_str().map(str::trim).unwrap_or("");
    let broj_reklamacije = if !unesen_broj.is_empty() { json!(unesen_broj) } else { broj_sa_uredjaja(&result) };

    if let Err(e) = db.tx(|| refund_order_in_transaction(db, id, &broj_reklamacije)) {
        // Storno je već na papiru i u fiskalnom uređaju — operater to mora znati.
        baci!(
            "Reklamacija #{} JE odštampana, ali nije zabilježena u bazi: {}. Evidentirajte račun ručno.",
            if broj_reklamacije.is_null() { "?".to_string() } else { js::to_string(&broj_reklamacije) },
            poruka(&e)
        );
    }

    Ok(json!({
        "success": true,
        "brojReklamacije": broj_reklamacije,
        "odgovori": result["odgovori"],
        "pologIznos": js::f(polog_iznos),
    }))
}

/// `order:refundAndPrint`. Kasir uz uključen "PIN za reklamaciju" šalje admin
/// PIN u istom pozivu; provjera je ovdje, prije štampe — odvojen korak
/// provjere renderer bi mogao preskočiti.
fn storno(b: &Backend, data: &Value) -> R<Value> {
    let db = b.baza()?;
    let k: Korisnik = sesija::korisnik(b)?;
    let mut odobrio_admin_id = Value::Null;
    if db.val("SELECT value FROM settings WHERE key = ?", p!["kasa.requirePinRefund"])? == "true" && !k.je_admin() {
        if !truthy(&data["adminPin"]) {
            baci!("Reklamacija traži PIN administratora");
        }
        odobrio_admin_id = json!(korisnici::provjeri_admin_pin(b, &data["adminPin"])?.id);
    }
    let original = db.get("SELECT brojFiskalnogRacuna, ukupno FROM orders WHERE id = ?", p![data["id"]])?;
    b.load_tring_config()?;
    let rezultat = refund_and_print(b, data, k.id)?;
    if truthy(&rezultat["success"]) {
        // Storno je već odštampan i upisan — greška traga ne smije to sakriti.
        let o = |kljuc: &str| original.as_ref().map(|o| o[kljuc].clone()).unwrap_or(Value::Null);
        let trag = audit::zabiljezi(
            b,
            "storno",
            json!({
                "orderId": data["id"], "brojFiskalnogRacuna": o("brojFiskalnogRacuna"),
                "brojReklamacije": rezultat["brojReklamacije"], "ukupno": o("ukupno"),
                "odobrioAdminId": odobrio_admin_id, "pologIznos": js::nn(&rezultat["pologIznos"], &json!(0)),
            }),
        );
        if let Err(e) = trag {
            eprintln!("[audit] storno {}", e.0);
        }
    }
    Ok(rezultat)
}

// ─── lib/valuta.ts ──────────────────────────────────────────

// Datum valute (rok plaćanja) na izdatom računu. Nije dio fiskalnog zapisa —
// upisuje se naknadno, po dogovoru s kupcem, i prikazuje se samo na A4 kopiji
// računa i na A4 fakturi (računu po prilogu). Zato se smije mijenjati i brisati
// bez ograničenja, i na stornu.

/// Prihvata samo `YYYY-MM-DD` koji zaista postoji u kalendaru (ne 2026-02-30).
pub fn validan_datum_valute(datum: &str) -> bool {
    // ISO datum bez vremena, onako kako ga vraća `DatePicker`.
    thread_local!(static ISO_DATUM: Regex = Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    if !ISO_DATUM.with(|r| r.is_match(datum)) {
        return false;
    }
    let broj = |od: usize, do_: usize| datum[od..do_].parse::<u32>().unwrap_or(0);
    chrono::NaiveDate::from_ymd_opt(broj(0, 4) as i32, broj(5, 7), broj(8, 10)).is_some()
}

/// Postavlja ili (uz `null`) uklanja datum valute. Vraća upisanu vrijednost.
pub fn postavi_datum_valute(db: &Db, order_id: &Value, datum: &Value) -> R<Value> {
    if !db.ima("SELECT id FROM orders WHERE id = ?", p![order_id])? {
        baci!("Račun ne postoji");
    }

    if !datum.is_null() && !validan_datum_valute(&js::to_string(datum)) {
        baci!("Neispravan datum valute: {}", js::to_string(datum));
    }

    db.run("UPDATE orders SET datumValute = ? WHERE id = ?", p![datum, order_id])?;
    Ok(datum.clone())
}

// ─── Kanali ─────────────────────────────────────────────────

fn get_all(db: &Db) -> R<Value> {
    db.all(
        "
        SELECT o.*, u.ime AS korisnikIme, k.pdvBroj AS kupacPdvBroj
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
        LEFT JOIN kupci k ON k.idBroj = o.kupacIdBroj
        ORDER BY o.createdAt DESC
      ",
        p![],
    )
    .map(Value::from)
}

fn get(db: &Db, id: &Value) -> R<Value> {
    let Some(mut order) = db.get(
        "
        SELECT o.*, u.ime AS korisnikIme, k.pdvBroj AS kupacPdvBroj
        FROM orders o
        LEFT JOIN users u ON u.id = o.korisnikId
        LEFT JOIN kupci k ON k.idBroj = o.kupacIdBroj
        WHERE o.id = ?
      ",
        p![id],
    )?
    else {
        baci!("Račun ne postoji");
    };

    let mut stavke = Value::from(db.all(
        "
        SELECT oi.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
        FROM order_items oi
        LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?
      ",
        p![id],
    )?);

    // Prilog račun nema order_items — prikaz i kopija računa dobiju zbirnu stavku.
    if !order["prilogBroj"].is_null() {
        let naziv = if truthy(&order["prilogNaziv"]) {
            order["prilogNaziv"].clone()
        } else {
            json!(prilog_naziv(&order["prilogBroj"], &Value::Null, &Value::Null))
        };
        stavke = json!([{
            "id": 0, "orderId": order["id"], "productId": 0, "kolicina": 1, "cijena": order["ukupno"], "rabat": 0,
            "pdvStopa": "E", "productNaziv": naziv,
            "productJm": "kom", "productSifra": PRILOG_SIFRA, "productPlu": 0,
        }]);
    }

    order.as_object_mut().unwrap().insert("stavke".into(), stavke);
    Ok(order)
}

// Račun izdat mimo programa (npr. dok program nije radio), upisan naknadno.
// Stavke, iznosi i plaćanje se provjeravaju kao na kasi (pripremi_racun), ali
// stopa i cijena stavke smiju odstupati od današnjeg artikla — prepisuje se
// stari isječak.
fn create_manual(b: &Backend, unos: &Value) -> R<Value> {
    let db = b.baza()?;
    let korisnik_id = sesija::korisnik(b)?.id;
    let r = provjera_racuna::pripremi_racun(db, unos, false)?;
    let broj = unos["brojFiskalnogRacuna"].as_str().map(str::trim).unwrap_or("").to_string();
    if broj.is_empty() {
        baci!("Fiskalni broj je obavezan");
    }
    let created_at = unos["createdAt"].as_str().unwrap_or("").to_string();
    if created_at.trim().is_empty() {
        baci!("Datum računa je obavezan");
    }

    if db.ima("SELECT id FROM orders WHERE brojFiskalnogRacuna = ?", p![broj])? {
        baci!("Fiskalni račun sa tim brojem već postoji");
    }

    let stavke: Vec<Value> = r.stavke.iter().map(|s| s.stavka.clone()).collect();
    db.tx(|| {
        let id = insert_completed_order(
            db,
            &json!({
                "korisnikId": korisnik_id, "ukupno": js::f(r.ukupno), "pdvIznos": js::f(r.pdv_iznos),
                "nacinPlacanja": r.nacin_placanja, "brojFiskalnogRacuna": broj,
                "kupac": r.kupac.clone().unwrap_or(Value::Null), "stavke": stavke, "isManual": 1, "createdAt": created_at,
            }),
        )?;
        audit::zabiljezi(
            b,
            "racun:rucni",
            json!({ "orderId": id, "brojFiskalnogRacuna": broj, "ukupno": js::f(r.ukupno), "createdAt": created_at }),
        )?;
        Ok(json!({ "id": id }))
    })
}

fn finalize(b: &Backend, unos: &Value) -> R<Value> {
    let db = b.baza()?;
    // Račun izdaje prijavljeni korisnik — korisnikId iz payload-a se ne čita.
    let korisnik_id = sesija::korisnik(b)?.id;
    // Sve provjere prije write-ahead zapisa i štampe; iznosi se računaju iz stavki.
    let r = provjera_racuna::pripremi_racun(db, unos, true)?;
    let mut m = Map::new();
    m.insert("korisnikId".into(), json!(korisnik_id));
    m.insert("ukupno".into(), js::f(r.ukupno));
    m.insert("pdvIznos".into(), js::f(r.pdv_iznos));
    m.insert("nacinPlacanja".into(), json!(r.nacin_placanja));
    m.insert("vrstePlacanja".into(), r.vrste_placanja.clone());
    // `undefined` JSON.stringify izostavlja (snapshot).
    if let Some(k) = &r.kupac {
        m.insert("kupac".into(), k.clone());
    }
    if let Some(n) = &r.napomena {
        m.insert("napomena".into(), n.clone());
    }
    // Uređaj dobija šifru, naziv, JM i PLU artikla iz baze, ne iz payload-a.
    let stavke: Vec<Value> = r
        .stavke
        .iter()
        .map(|s| {
            let (x, a) = (&s.stavka, &s.artikal);
            json!({
                "productId": x["productId"], "sifra": a["sifra"], "naziv": a["naziv"],
                "jm": js::nn(&a["jm"], &json!("kom")), "plu": js::nn(&a["plu"], &json!(0)),
                "cijena": x["cijena"], "kolicina": x["kolicina"], "rabat": x["rabat"], "pdvStopa": x["pdvStopa"],
            })
        })
        .collect();
    m.insert("stavke".into(), Value::from(stavke));
    let data = Value::Object(m);

    // 1. Write-ahead: persist the snapshot BEFORE printing (committed immediately).
    let pending_id = db
        .run("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)", p![data["korisnikId"], js::stringify(&data)])?
        .last_insert_rowid;

    // 2. Print.
    b.load_tring_config()?;
    let racun = tring_racun::build_tring_racun(&spoji(&data, vec![("items", data["stavke"].clone())]));
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] finalize request: {}", js::stringify(&racun));
    }
    let result = b.tring.stampati_fiskalni_racun(&racun);
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] finalize response: {}", js::stringify(&result));
    }

    // 3b. Print failed → nothing was printed, drop the pending row.
    if !tring::uspjeh(&result) {
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
        return Ok(json!({
            "success": false,
            "error": greska_odgovora(&result),
            "odgovori": odgovori(&result),
        }));
    }

    // 3a. Print succeeded → create order + delete pending row atomically.
    let broj_fiskalnog_racuna = broj_sa_uredjaja(&result);
    let order_id = db.tx(|| {
        let order_id = insert_completed_order(
            db,
            &spoji(&data, vec![("brojFiskalnogRacuna", broj_fiskalnog_racuna.clone()), ("isManual", json!(0))]),
        )?;
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
        Ok(order_id)
    })?;

    Ok(json!({ "success": true, "id": order_id, "brojFiskalnogRacuna": broj_fiskalnog_racuna, "odgovori": result["odgovori"] }))
}

fn pending_list(db: &Db) -> R<Value> {
    let rows = db.all("SELECT id, korisnikId, snapshot, createdAt FROM pending_receipts ORDER BY id", p![])?;
    let mut out = Vec::new();
    for r in rows {
        out.push(json!({
            "id": r["id"], "korisnikId": r["korisnikId"], "createdAt": r["createdAt"],
            "snapshot": js::parse(&js::to_string(&r["snapshot"]))?,
        }));
    }
    Ok(Value::from(out))
}

fn pending_resolve(db: &Db, data: &Value) -> R<Value> {
    if js::blank(&data["brojFiskalnogRacuna"]) {
        baci!("Fiskalni broj je obavezan");
    }
    if js::blank(&data["createdAt"]) {
        baci!("Datum računa je obavezan");
    }

    let Some(row) = db.get("SELECT snapshot FROM pending_receipts WHERE id = ?", p![data["id"]])? else {
        baci!("Zapis više ne postoji");
    };
    let snap = js::parse(&js::to_string(&row["snapshot"]))?;
    let broj = js::trim(&data["brojFiskalnogRacuna"]).map(Value::from).unwrap_or_else(|| data["brojFiskalnogRacuna"].clone());

    if db.ima("SELECT id FROM orders WHERE brojFiskalnogRacuna = ?", p![broj])? {
        baci!("Fiskalni račun sa tim brojem već postoji");
    }

    let id = db.tx(|| {
        // Prilog račun: broj fakture je BF koji operater ovdje ukuca; rezervni
        // broj iz snapshota ostaje samo kad BF nije numerički.
        let prilog_broj = if snap["prilogBroj"].is_null() {
            Value::Null
        } else {
            fiskalni::parse_fiskalni_broj(&broj).map(Value::from).unwrap_or_else(|| snap["prilogBroj"].clone())
        };
        let order_id = insert_completed_order(
            db,
            &spoji(
                &snap,
                vec![
                    ("brojFiskalnogRacuna", broj.clone()),
                    ("prilogBroj", prilog_broj),
                    ("isManual", json!(1)),
                    ("createdAt", data["createdAt"].clone()),
                ],
            ),
        )?;
        // Prilog račun: stvarne stavke žive u snapshotu odvojeno od order_items.
        if snap["prilogStavke"].as_array().is_some_and(|a| !a.is_empty()) {
            save_prilog_stavke_in_transaction(db, &json!(order_id), &snap["prilogStavke"])?;
        }
        // Faktura iz ponude: ponuda se veže tek kad račun stvarno postoji u bazi.
        if !snap["ponudaId"].is_null() {
            let ponuda = db.get("SELECT status FROM ponude WHERE id = ?", p![snap["ponudaId"]])?;
            if ponuda.is_some_and(|p| p["status"] != "konvertovana") {
                oznaci_ponudu_fakturisanom(db, &snap["ponudaId"], &json!(order_id))?;
            }
        }
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![data["id"]])?;
        Ok(order_id)
    })?;
    Ok(json!({ "id": id }))
}

/// Odbačene praznine iz postavki (`fiscal.dismissedGaps`), kao JSON niz.
fn odbacene_praznine(db: &Db) -> R<Vec<Value>> {
    let row = db.get("SELECT value FROM settings WHERE key = 'fiscal.dismissedGaps'", p![])?;
    Ok(match row {
        Some(r) => match js::parse(&js::to_string(&r["value"]))? {
            Value::Array(a) => a,
            _ => Vec::new(),
        },
        None => Vec::new(),
    })
}

fn get_fiscal_gaps(db: &Db) -> R<Value> {
    let rows = db.all("SELECT brojFiskalnogRacuna FROM orders WHERE brojFiskalnogRacuna IS NOT NULL", p![])?;
    let brojevi: Vec<i64> = rows.iter().filter_map(|r| fiskalni::parse_fiskalni_broj(&r["brojFiskalnogRacuna"])).collect();
    let dismissed: HashSet<i64> = odbacene_praznine(db)?
        .iter()
        .filter_map(|v| v.as_f64().filter(|x| x.fract() == 0.0).map(|x| x as i64))
        .collect();
    // Odbačene praznine se preskaču unutar računa da ne troše ograničenje.
    Ok(json!(fiskalni::izracunaj_praznine(&brojevi, fiskalni::MAX_PRAZNINA, &dismissed)))
}

fn dismiss_fiscal_gap(b: &Backend, broj: &Value) -> R<Value> {
    let db = b.baza()?;
    let mut dismissed = odbacene_praznine(db)?;
    // `includes` poredi brojeve po vrijednosti (5 i 5.0 su isti).
    let isti = |v: &Value| match (v.as_f64(), broj.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => v == broj,
    };
    if dismissed.iter().any(isti) {
        return Ok(json!({ "success": true }));
    }
    dismissed.push(broj.clone());
    db.tx(|| {
        db.run(
            "INSERT INTO settings (key, value) VALUES ('fiscal.dismissedGaps', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            p![js::stringify(&Value::from(dismissed))],
        )?;
        audit::zabiljezi(b, "fiskalni:odbaciPrazninu", json!({ "broj": broj }))
    })?;
    Ok(json!({ "success": true }))
}

fn pending_discard(b: &Backend, id: &Value) -> R<Value> {
    let db = b.baza()?;
    db.tx(|| {
        let row = db.get("SELECT snapshot FROM pending_receipts WHERE id = ?", p![id])?;
        let r = db.run("DELETE FROM pending_receipts WHERE id = ?", p![id])?;
        if let Some(row) = row.filter(|_| r.changes > 0) {
            let tekst = js::to_string(&row["snapshot"]);
            let snapshot = js::parse(&tekst).unwrap_or(row["snapshot"].clone());
            audit::zabiljezi(b, "pending:odbaci", json!({ "pendingId": id, "snapshot": snapshot }))?;
        }
        Ok(())
    })?;
    Ok(json!({ "success": true }))
}

fn set_zadnji_broj(b: &Backend, broj: &Value) -> R<Value> {
    let db = b.baza()?;
    db.tx(|| {
        let stari_broj = fiskalni::zadnji_upisani_fiskalni_broj(db)?;
        fiskalni::postavi_zadnji_fiskalni_broj(db, broj)?;
        audit::zabiljezi(b, "fiskalni:zadnjiBroj", json!({ "stariBroj": stari_broj, "noviBroj": broj }))
    })?;
    Ok(json!({ "success": true, "predvidjeni": fiskalni::predvidjeni_fiskalni_broj(db)? }))
}

const KANALI: [&str; 16] = [
    "order:getAll", "order:get", "order:createManual", "order:finalize", "order:finalizePrilog",
    "order:setDatumValute", "order:refundAndPrint",
    "order:getFiscalGaps", "order:dismissFiscalGap",
    "pending:list", "pending:resolve", "pending:discard",
    "prilog:getStavke", "prilog:saveStavke",
    "fiscal:getNumeracija", "fiscal:setZadnjiBroj",
];

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    if !KANALI.contains(&kanal) {
        return None;
    }
    if let Err(e) = b.otvori_db() {
        return Some(Err(e));
    }
    // `&Backend` da baza i Tring klijent idu zajedno.
    let b: &Backend = b;
    let db = match b.baza() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "order:getAll" => get_all(db),
        "order:get" => get(db, &a[0]),
        "order:createManual" => create_manual(b, &a[0]),
        "order:finalize" => finalize(b, &a[0]),
        // Račun po prilogu: jedna zbirna stavka na fiskalnom računu, stvarne stavke
        // se dodjeljuju naknadno.
        "order:finalizePrilog" => sesija::korisnik(b).and_then(|k| {
            let data = sesija::sa_korisnikom(&a[0], k.id);
            b.load_tring_config()?;
            finalize_prilog_and_print(b, &data)
        }),
        // Fiskalni niz: račun po prilogu mora znati broj isječka prije nego ga odštampa.
        "fiscal:getNumeracija" => (|| {
            Ok(json!({
                "zadnjiUBazi": fiskalni::zadnji_fiskalni_broj(db)?,
                "zadnjiUpisani": fiskalni::zadnji_upisani_fiskalni_broj(db)?,
                "predvidjeni": fiskalni::predvidjeni_fiskalni_broj(db)?,
            }))
        })(),
        "fiscal:setZadnjiBroj" => set_zadnji_broj(b, &a[0]),
        "prilog:getStavke" => db
            .all(
                "
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.tip AS productTip
      FROM prilog_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.orderId = ?
      ORDER BY ps.id
    ",
                p![a[0]],
            )
            .map(Value::from),
        "prilog:saveStavke" => db
            .tx(|| save_prilog_stavke_in_transaction(db, &a[0], &a[1]))
            .map(|_| json!({ "success": true })),
        "order:setDatumValute" => postavi_datum_valute(db, &a[0], &a[1]).map(|d| json!({ "datumValute": d })),
        // Orkestracija (štampa → atomični upis) je u `refund_and_print`.
        "order:refundAndPrint" => storno(b, &a[0]),
        "pending:list" => pending_list(db),
        "pending:resolve" => pending_resolve(db, &a[0]),
        "pending:discard" => pending_discard(b, &a[0]),
        "order:getFiscalGaps" => get_fiscal_gaps(db),
        "order:dismissFiscalGap" => dismiss_fiscal_gap(b, &a[0]),
        _ => return None,
    })
}
