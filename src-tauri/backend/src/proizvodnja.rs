//! Kanali `nalog:*`, `normativ:*` (handlers.ts) i logika iz `lib/proizvodnja.ts`.

use std::collections::{BTreeSet, HashSet};
use std::sync::Mutex;

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, has, round2, to_number, truthy};
use crate::ponude::{self, UToku};
use crate::racun::{izracunaj_totale, upisi_racun};
use crate::sql::Db;
use crate::tring::uspjeh;
use crate::tring_racun::build_tring_racun;
use crate::{baci, p, Args, Backend};

/// Usluga preko koje se prodaje rad po mjeri — kreira se pri uključivanju modula.
pub const PRODAJNA_USLUGA_SIFRA: &str = "NAMJ";
pub const PRODAJNA_USLUGA_NAZIV: &str = "Namještaj po mjeri";

fn round4(n: f64) -> f64 {
    js::js_round(n * 10000.0) / 10000.0
}

/// `Number(datum.slice(0, 4))` kao JSON broj (NaN → null, kako ga SQLite veže).
fn godina_iz_datuma(datum: &str) -> Value {
    let s: String = datum.chars().take(4).collect();
    js::f(to_number(&Value::String(s)))
}

/// `for (const s of stavke)` — sve osim niza nije iterabilno.
fn niz<'a>(v: &'a Value, ime: &str) -> R<&'a [Value]> {
    match v.as_array() {
        Some(a) => Ok(a),
        None => baci!("{ime} is not iterable"),
    }
}

/// Stanje artikla iz kretanja zalihe (`getProductStock` iz lib/skladiste.ts).
fn stanje_artikla(db: &Db, product_id: &Value) -> R<Value> {
    db.val(
        "
    SELECT COALESCE(
      SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
    ) AS stanje
    FROM stock_movements WHERE productId = ?
  ",
        p![product_id],
    )
}

// ── numeracija ───────────────────────────────────────────

pub fn next_broj_naloga(db: &Db, godina: &Value) -> R<i64> {
    let max = db.val("SELECT MAX(broj) AS maxBroj FROM radni_nalozi WHERE godina = ?", &[godina.clone()])?;
    Ok(max.as_i64().unwrap_or(0) + 1)
}

pub fn format_broj_naloga(n: &Value) -> String {
    format!("RN-{}/{}", js::to_string(&n["broj"]), js::to_string(&n["godina"]))
}

// ── validacija ───────────────────────────────────────────

fn product_tip(db: &Db, id: &Value) -> R<Option<Value>> {
    db.get("SELECT tip, naziv FROM products WHERE id = ?", p![id])
}

fn validiraj_stavke(db: &Db, stavke: &[Value]) -> R<()> {
    for s in stavke {
        let p = product_tip(db, &s["materijalId"])?;
        if !p.is_some_and(|p| p["tip"] == "materijal") {
            baci!("Stavka utroška mora biti materijal");
        }
        if !(to_number(&s["kolicina"]) > 0.0) {
            baci!("Količina stavke mora biti veća od nule");
        }
    }
    Ok(())
}

/// Normativ drži jedan red po materijalu (UNIQUE productId+materijalId). Nalog
/// namjerno dozvoljava isti materijal više puta — npr. ista ploča u dvije
/// dimenzije krojenja, svaka sa svojom napomenom.
fn baci_ako_dupli_materijal(db: &Db, stavke: &[Value]) -> R<()> {
    let mut vidjeni = HashSet::new();
    for s in stavke {
        if !vidjeni.insert(js::stringify(&s["materijalId"])) {
            let naziv = match product_tip(db, &s["materijalId"])? {
                Some(p) if !p["naziv"].is_null() => js::to_string(&p["naziv"]),
                _ => format!("#{}", js::to_string(&s["materijalId"])),
            };
            baci!("Materijal \"{naziv}\" je unesen više puta — saberite količine u jednu stavku");
        }
    }
    Ok(())
}

/// `{ status, vrsta, kolicina, productId, ponudaId }` naloga.
fn ucitaj_nalog_ili_baci(db: &Db, id: &Value) -> R<Value> {
    match db.get("SELECT status, vrsta, kolicina, productId, ponudaId FROM radni_nalozi WHERE id = ?", p![id])? {
        Some(n) => Ok(n),
        None => baci!("Radni nalog ne postoji"),
    }
}

fn baci_ako_zakljucan(status: &Value) -> R<()> {
    if status == "zavrsen" || status == "fakturisan" {
        baci!("Nalog je završen i ne može se mijenjati");
    }
    Ok(())
}

// ── stavke ───────────────────────────────────────────────

fn upisi_stavke(db: &Db, nalog_id: &Value, stavke: &[Value]) -> R<()> {
    for s in stavke {
        db.run(
            "INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)",
            p![nalog_id, s["materijalId"], js::f(round4(to_number(&s["kolicina"]))), s["napomena"]],
        )?;
    }
    Ok(())
}

/// Zamijeni sve stavke utroška. Poziva se u transakciji.
pub fn replace_stavke(db: &Db, id: &Value, stavke: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    baci_ako_zakljucan(&n["status"])?;
    let stavke = niz(stavke, "stavke")?;
    validiraj_stavke(db, stavke)?;
    db.run("DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?", p![id])?;
    upisi_stavke(db, id, stavke)
}

// ── kreiranje / izmjena ──────────────────────────────────

/// `(x ?? '').trim()`
fn trim_ili_prazno(v: &Value, ime: &str) -> R<String> {
    match v {
        Value::Null => Ok(String::new()),
        Value::String(s) => Ok(s.trim().to_string()),
        _ => baci!("{ime}.trim is not a function"),
    }
}

/// Upiše nalog. Za zalihu, ako proizvod ima normativ, popuni stavke normativ × količina. U transakciji.
pub fn create_nalog(db: &Db, input: &Value, danas: &str) -> R<Value> {
    if !truthy(&input["korisnikId"]) {
        baci!("Korisnik nije prijavljen");
    }
    let datum = if truthy(&input["datum"]) { js::to_string(&input["datum"]) } else { danas.to_string() };
    let godina = godina_iz_datuma(&datum);
    let mut opis = trim_ili_prazno(&input["opis"], "opis")?;
    let mut kolicina = 1.0;
    let vrsta = &input["vrsta"];

    if vrsta == "narudzba" {
        if !truthy(&input["kupacId"]) {
            baci!("Kupac je obavezan za nalog po narudžbi");
        }
        if opis.is_empty() {
            baci!("Opis je obavezan");
        }
    } else if vrsta == "zaliha" {
        if !truthy(&input["productId"]) {
            baci!("Proizvod je obavezan za nalog za zalihu");
        }
        let p = match product_tip(db, &input["productId"])? {
            Some(p) if p["tip"] == "artikal" => p,
            _ => baci!("Nalog za zalihu može biti samo za artikal"),
        };
        kolicina = round4(to_number(js::nn(&input["kolicina"], &json!(0))));
        if !(kolicina > 0.0) {
            baci!("Količina mora biti veća od nule");
        }
        if opis.is_empty() {
            opis = js::to_string(&p["naziv"]);
        }
    } else {
        baci!("Nepoznata vrsta naloga");
    }

    let broj = next_broj_naloga(db, &godina)?;
    let zaliha = vrsta == "zaliha";
    let res = db.run(
        "
    INSERT INTO radni_nalozi (broj, godina, datum, rok, vrsta, kupacId, ponudaId, opis, productId, kolicina,
      dogovorenaCijena, trosakRada, korisnikId, napomena)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ",
        p![
            broj, godina, datum, input["rok"], vrsta,
            if vrsta == "narudzba" { input["kupacId"].clone() } else { Value::Null },
            input["ponudaId"], opis,
            if zaliha { input["productId"].clone() } else { Value::Null }, js::f(kolicina),
            input["dogovorenaCijena"], js::nn(&input["trosakRada"], &json!(0)), input["korisnikId"], input["napomena"]
        ],
    )?;
    let id = json!(res.last_insert_rowid);

    if zaliha {
        let normativ = get_normativ(db, &input["productId"])?;
        if !normativ.is_empty() {
            let stavke: Vec<Value> = normativ
                .iter()
                .map(|n| {
                    json!({
                        "materijalId": n["materijalId"],
                        "kolicina": js::f(round4(to_number(&n["kolicina"]) * kolicina)),
                        "napomena": n["napomena"],
                    })
                })
                .collect();
            upisi_stavke(db, &id, &stavke)?;
        }
    }

    Ok(json!({ "id": id, "broj": broj, "godina": godina }))
}

/// Nalog iz prihvaćene ponude: kupac, opis (nazivi stavki) i cijena sa ponude. U transakciji.
pub fn create_nalog_iz_ponude(db: &Db, ponuda_id: &Value, korisnik_id: &Value, danas: &str) -> R<Value> {
    let Some(ponuda) = db.get("SELECT id, kupacId, status, ukupno FROM ponude WHERE id = ?", p![ponuda_id])? else {
        baci!("Ponuda ne postoji");
    };
    if ponuda["status"] != "prihvacena" {
        baci!("Ponuda mora biti prihvaćena da bi se otvorio radni nalog");
    }
    if !nalog_za_ponudu(db, ponuda_id)?.is_null() {
        baci!("Za ovu ponudu radni nalog već postoji");
    }

    let nazivi = db.all(
        "
    SELECT p.naziv FROM ponuda_stavke ps LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ? ORDER BY ps.id
  ",
        p![ponuda_id],
    )?;
    let opis = nazivi.iter().map(|n| &n["naziv"]).filter(|n| truthy(n)).map(js::to_string).collect::<Vec<_>>().join(", ");
    let opis = if opis.is_empty() { format!("Ponuda {}", js::to_string(ponuda_id)) } else { opis };

    create_nalog(
        db,
        &json!({
            "vrsta": "narudzba", "korisnikId": korisnik_id, "kupacId": ponuda["kupacId"], "ponudaId": ponuda_id, "opis": opis,
            "dogovorenaCijena": ponuda["ukupno"],
        }),
        danas,
    )
}

/// `{ id, broj, godina }` naloga za ponudu ili `null`.
pub fn nalog_za_ponudu(db: &Db, ponuda_id: &Value) -> R<Value> {
    Ok(db.get("SELECT id, broj, godina FROM radni_nalozi WHERE ponudaId = ? LIMIT 1", p![ponuda_id])?.unwrap_or(Value::Null))
}

/// Polja koja se smiju mijenjati na završenom nalogu bez cijene — dogovor sa kupcem stigne i poslije.
const DOZVOLJENO_ZAVRSEN: [&str; 3] = ["dogovorenaCijena", "rok", "napomena"];

/// `patch.x !== undefined` — ključ je poslan (i `null` je poslana vrijednost).
pub fn update_nalog(db: &Db, id: &Value, patch: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    if n["status"] == "zavrsen" {
        let Some(kljucevi) = patch.as_object().map(|o| o.keys()) else {
            if patch.is_null() {
                baci!("Cannot convert undefined or null to object");
            }
            return Ok(());
        };
        if kljucevi.into_iter().any(|k| !DOZVOLJENO_ZAVRSEN.contains(&k.as_str())) {
            baci_ako_zakljucan(&n["status"])?;
        }
    } else {
        baci_ako_zakljucan(&n["status"])?;
    }
    if patch.is_null() {
        baci!("Cannot read properties of null (reading 'opis')");
    }

    let mut fields: Vec<String> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    let mut set = |col: &str, v: Value| {
        fields.push(format!("{col} = ?"));
        values.push(v);
    };

    if has(patch, "opis") {
        let Some(opis) = patch["opis"].as_str().map(str::trim) else {
            baci!("Cannot read properties of null (reading 'trim')");
        };
        if opis.is_empty() {
            baci!("Opis je obavezan");
        }
        set("opis", json!(opis));
    }
    if has(patch, "kupacId") && n["vrsta"] == "narudzba" {
        if !truthy(&patch["kupacId"]) {
            baci!("Kupac je obavezan za nalog po narudžbi");
        }
        set("kupacId", patch["kupacId"].clone());
    }
    if has(patch, "kolicina") && n["vrsta"] == "zaliha" {
        let kolicina = round4(to_number(&patch["kolicina"]));
        if !(kolicina > 0.0) {
            baci!("Količina mora biti veća od nule");
        }
        set("kolicina", js::f(kolicina));
    }
    if has(patch, "datum") {
        thread_local!(static DATUM: Regex = Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}").unwrap());
        let Some(datum) = patch["datum"].as_str().filter(|d| DATUM.with(|r| r.is_match(d))) else {
            baci!("Datum naloga nije ispravan");
        };
        set("datum", json!(datum));
        // Numeracija ide po godini: prelazak u drugu godinu daje sljedeći slobodan broj te godine.
        let godina = godina_iz_datuma(datum);
        let trenutna = db.val("SELECT godina FROM radni_nalozi WHERE id = ?", p![id])?;
        if trenutna.as_f64() != godina.as_f64() {
            let broj = next_broj_naloga(db, &godina)?;
            set("godina", godina);
            set("broj", json!(broj));
        }
    }
    if has(patch, "rok") {
        set("rok", js::or_null(&patch["rok"]));
    }
    if has(patch, "dogovorenaCijena") {
        set("dogovorenaCijena", patch["dogovorenaCijena"].clone());
    }
    if has(patch, "trosakRada") {
        set("trosakRada", js::nn(&patch["trosakRada"], &json!(0)).clone());
    }
    if has(patch, "napomena") {
        set("napomena", js::or_null(&patch["napomena"]));
    }

    if fields.is_empty() {
        return Ok(());
    }
    values.push(id.clone());
    db.run(&format!("UPDATE radni_nalozi SET {} WHERE id = ?", fields.join(", ")), &values)?;
    Ok(())
}

/// Briše nalog i stavke. Samo nezavršen nalog. U transakciji.
pub fn delete_nalog(db: &Db, id: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    baci_ako_zakljucan(&n["status"])?;
    db.run("DELETE FROM radni_nalog_stavke WHERE radniNalogId = ?", p![id])?;
    db.run("DELETE FROM radni_nalozi WHERE id = ?", p![id])?;
    Ok(())
}

/// Da li artikal figuriše u proizvodnji (normativ, stavka naloga, proizvod naloga) — tada se ne briše.
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

// ── čitanje ──────────────────────────────────────────────

const NALOG_SELECT: &str = "
  SELECT rn.*,
    k.naziv AS kupacNaziv, k.idBroj AS kupacIdBroj, k.adresa AS kupacAdresa,
    k.grad AS kupacGrad, k.postanskiBroj AS kupacPostanskiBroj,
    p.naziv AS productNaziv, p.cijena AS productCijena,
    u.ime AS korisnikIme,
    o.brojFiskalnogRacuna AS racunBroj, o.status AS racunStatus,
    po.broj AS ponudaBroj, po.godina AS ponudaGodina
  FROM radni_nalozi rn
  LEFT JOIN kupci k ON k.id = rn.kupacId
  LEFT JOIN products p ON p.id = rn.productId
  LEFT JOIN users u ON u.id = rn.korisnikId
  LEFT JOIN orders o ON o.id = rn.racunId
  LEFT JOIN ponude po ON po.id = rn.ponudaId
";

pub fn get_nalog_stavke(db: &Db, id: &Value) -> R<Vec<Value>> {
    let mut stavke = db.all(
        "
    SELECT s.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm,
      m.plocaSirina, m.plocaVisina
    FROM radni_nalog_stavke s
    LEFT JOIN products m ON m.id = s.materijalId
    WHERE s.radniNalogId = ?
    ORDER BY s.id
  ",
        p![id],
    )?;
    for s in &mut stavke {
        s["stanje"] = stanje_artikla(db, &s["materijalId"])?;
    }
    Ok(stavke)
}

pub fn get_nalog(db: &Db, id: &Value) -> R<Value> {
    let Some(mut n) = db.get(&format!("{NALOG_SELECT} WHERE rn.id = ?"), p![id])? else {
        baci!("Radni nalog ne postoji");
    };
    n["stavke"] = Value::from(get_nalog_stavke(db, id)?);
    Ok(n)
}

/// `filter` je status ili 'aktivni' (sve osim fakturisanih); prazan = svi.
pub fn list_nalozi(db: &Db, filter: &Value) -> R<Value> {
    let mut where_ = "";
    let mut params: Vec<Value> = Vec::new();
    if filter == "aktivni" {
        where_ = "WHERE rn.status != 'fakturisan'";
    } else if truthy(filter) {
        where_ = "WHERE rn.status = ?";
        params.push(filter.clone());
    }
    Ok(Value::from(db.all(&format!("{NALOG_SELECT} {where_} ORDER BY rn.godina DESC, rn.broj DESC"), &params)?))
}

// ── normativi ────────────────────────────────────────────

pub fn get_normativ(db: &Db, product_id: &Value) -> R<Vec<Value>> {
    db.all(
        "
    SELECT n.*, m.naziv AS materijalNaziv, m.sifra AS materijalSifra, m.jm AS materijalJm
    FROM normativi n LEFT JOIN products m ON m.id = n.materijalId
    WHERE n.productId = ? ORDER BY n.id
  ",
        p![product_id],
    )
}

/// Zamijeni normativ proizvoda. U transakciji.
pub fn save_normativ(db: &Db, product_id: &Value, stavke: &Value) -> R<()> {
    if !product_tip(db, product_id)?.is_some_and(|p| p["tip"] == "artikal") {
        baci!("Normativ se vodi samo za artikal");
    }
    let stavke = niz(stavke, "stavke")?;
    validiraj_stavke(db, stavke)?;
    baci_ako_dupli_materijal(db, stavke)?;
    db.run("DELETE FROM normativi WHERE productId = ?", p![product_id])?;
    for s in stavke {
        db.run(
            "INSERT INTO normativi (productId, materijalId, kolicina, napomena) VALUES (?, ?, ?, ?)",
            p![product_id, s["materijalId"], js::f(round4(to_number(&s["kolicina"]))), s["napomena"]],
        )?;
    }
    Ok(())
}

// ── nabavna cijena ───────────────────────────────────────

/// Prosječna ponderisana nabavna cijena iz svih primki materijala, po kalkulaciji
/// ulaza: fakturna − rabat + zavisni troškovi (prevoz i sl.). 0 bez primki.
pub fn get_prosjecna_nabavna(db: &Db, materijal_id: &Value) -> R<f64> {
    let row = db
        .get(
            "
    SELECT SUM(kolicina * nabavnaCijena * (1 - COALESCE(rabat, 0) / 100.0) + COALESCE(zavisniTroskovi, 0)) AS vrijednost, SUM(kolicina) AS kolicina
    FROM primka_stavke WHERE productId = ?
  ",
            p![materijal_id],
        )?
        .unwrap_or(Value::Null);
    if !truthy(&row["kolicina"]) || to_number(&row["kolicina"]) <= 0.0 {
        return Ok(0.0);
    }
    Ok(round4(to_number(js::nn(&row["vrijednost"], &json!(0))) / to_number(&row["kolicina"])))
}

// ── kalkulacija ──────────────────────────────────────────

/// Čista kalkulacija — bez baze, testabilna. `nalog` ima `vrsta`, `kolicina`,
/// `dogovorenaCijena`, `trosakRada`, `status`; stavke su stavke naloga s
/// dodanim `trenutnaCijena`.
///
/// Rezultat: `{ stavke, materijal, rad, ukupno, upozorenja }` i za narudžbu
/// neto dogovorene cijene, maržu KM i %, a za zalihu trošak po komadu.
/// Stavka ima `zamrznuto`: true = cijena zamrznuta pri završetku, false = trenutna prosječna.
pub fn kalkulacija(nalog: &Value, stavke: &[Value]) -> Value {
    let mut upozorenja: Vec<Value> = Vec::new();
    let otvoren = nalog["status"] == "otvoren" || nalog["status"] == "u_izradi";

    let ks: Vec<Value> = stavke
        .iter()
        .map(|s| {
            let naziv = if !s["naziv"].is_null() {
                js::to_string(&s["naziv"])
            } else if !s["materijalNaziv"].is_null() {
                js::to_string(&s["materijalNaziv"])
            } else {
                format!("#{}", js::to_string(&s["materijalId"]))
            };
            let zamrznuto = !s["nabavnaCijena"].is_null();
            let cijena = if zamrznuto { &s["nabavnaCijena"] } else { &s["trenutnaCijena"] };
            let stanje = &js::nn(&s["stanje"], &json!(0)).clone();
            if to_number(cijena) <= 0.0 {
                upozorenja.push(json!(format!("{naziv}: nema nabavne cijene (nema primke)")));
            }
            if otvoren && to_number(&s["kolicina"]) > to_number(stanje) {
                upozorenja.push(json!(format!(
                    "{naziv}: utrošak {} prelazi stanje {}",
                    js::to_string(&s["kolicina"]),
                    js::to_string(stanje)
                )));
            }
            json!({
                "materijalId": s["materijalId"], "naziv": naziv, "jm": js::nn(&s["materijalJm"], &json!("")),
                "kolicina": s["kolicina"], "cijena": cijena,
                "iznos": js::f(round2(to_number(&s["kolicina"]) * to_number(cijena))), "stanje": stanje,
                "zamrznuto": zamrznuto,
            })
        })
        .collect();

    let materijal = round2(ks.iter().fold(0.0, |sum, s| sum + to_number(&s["iznos"])));
    let rad = round2(to_number(js::nn(&nalog["trosakRada"], &json!(0))));
    let ukupno = round2(materijal + rad);
    let mut out = Map::new();
    out.insert("stavke".into(), Value::from(ks));
    out.insert("materijal".into(), js::f(materijal));
    out.insert("rad".into(), js::f(rad));
    out.insert("ukupno".into(), js::f(ukupno));
    out.insert("upozorenja".into(), Value::from(upozorenja));

    if nalog["vrsta"] == "narudzba" {
        let bruto = to_number(js::nn(&nalog["dogovorenaCijena"], &json!(0)));
        // uNetto(bruto, 'E') iz lib/pdvUnos.ts
        let neto = round2(round2(bruto / 1.17));
        let marza = round2(neto - ukupno);
        out.insert("neto".into(), js::f(neto));
        out.insert("marza".into(), js::f(marza));
        out.insert("marzaPct".into(), js::f(if neto > 0.0 { round2((marza / neto) * 100.0) } else { 0.0 }));
    } else {
        let kolicina = to_number(&nalog["kolicina"]);
        out.insert("poKomadu".into(), js::f(if kolicina > 0.0 { round2(ukupno / kolicina) } else { 0.0 }));
    }
    Value::Object(out)
}

pub fn kalkulacija_naloga(db: &Db, id: &Value) -> R<Value> {
    let n = get_nalog(db, id)?;
    let mut stavke = Vec::new();
    for s in n["stavke"].as_array().into_iter().flatten() {
        let mut s = s.clone();
        s["trenutnaCijena"] = js::f(get_prosjecna_nabavna(db, &s["materijalId"])?);
        stavke.push(s);
    }
    Ok(kalkulacija(&n, &stavke))
}

// ── statusi i knjiženje ──────────────────────────────────

pub fn set_status_naloga(db: &Db, id: &Value, status: &str) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    if status == "u_izradi" && n["status"] == "otvoren" {
        db.run("UPDATE radni_nalozi SET status = 'u_izradi' WHERE id = ?", p![id])?;
        return Ok(());
    }
    baci!("Prelaz {} → {status} nije dozvoljen", js::to_string(&n["status"]));
}

/// Završetak: izlaz materijala po stavkama (zamrzne prosječnu nabavnu), a za
/// zalihu i ulaz gotovog proizvoda. Negativno stanje ne blokira — ploča se
/// često potroši prije nego što se primka unese. U transakciji.
pub fn zavrsi_nalog(db: &Db, id: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    if n["status"] != "otvoren" && n["status"] != "u_izradi" {
        baci!("Nalog je već završen");
    }
    let stavke = db.all("SELECT id, materijalId, kolicina FROM radni_nalog_stavke WHERE radniNalogId = ?", p![id])?;
    if stavke.is_empty() {
        baci!("Nalog nema stavki utroška");
    }

    for s in &stavke {
        db.run(
            "UPDATE radni_nalog_stavke SET nabavnaCijena = ? WHERE id = ?",
            p![js::f(get_prosjecna_nabavna(db, &s["materijalId"])?), s["id"]],
        )?;
        db.run(
            "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', ?, 'radni_nalog', ?)",
            p![s["materijalId"], s["kolicina"], id],
        )?;
    }
    if n["vrsta"] == "zaliha" && truthy(&n["productId"]) {
        db.run(
            "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', ?, 'radni_nalog', ?)",
            p![n["productId"], n["kolicina"], id],
        )?;
    }
    db.run("UPDATE radni_nalozi SET status = 'zavrsen', zavrsenAt = datetime('now','localtime') WHERE id = ?", p![id])?;
    Ok(())
}

/// Poništi knjiženja završetka i otključaj nalog. Fakturisan nalog se ne vraća. U transakciji.
pub fn vrati_u_izradu(db: &Db, id: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    if n["status"] == "fakturisan" {
        baci!("Nalog je fakturisan i ne može se vratiti u izradu");
    }
    if n["status"] != "zavrsen" {
        baci!("Samo završen nalog se vraća u izradu");
    }
    db.run("DELETE FROM stock_movements WHERE referenceType = 'radni_nalog' AND referenceId = ?", p![id])?;
    db.run("UPDATE radni_nalog_stavke SET nabavnaCijena = NULL WHERE radniNalogId = ?", p![id])?;
    db.run("UPDATE radni_nalozi SET status = 'u_izradi', zavrsenAt = NULL WHERE id = ?", p![id])?;
    Ok(())
}

pub fn fakturisi_nalog(db: &Db, id: &Value, racun_id: &Value) -> R<()> {
    let n = ucitaj_nalog_ili_baci(db, id)?;
    if n["vrsta"] != "narudzba" {
        baci!("Račun se izdaje samo za nalog po narudžbi");
    }
    if n["status"] != "zavrsen" {
        baci!("Nalog mora biti završen prije izdavanja računa");
    }
    db.run("UPDATE radni_nalozi SET status = 'fakturisan', racunId = ? WHERE id = ?", p![racun_id, id])?;
    Ok(())
}

// ── izdavanje računa ─────────────────────────────────────

/// Id postojeće usluge NAMJ ili `None` ako je još nema. Baca ako šifru drži
/// artikal/materijal — prodaja preko njega bi skidala robu sa zalihe.
fn postojeca_prodajna_usluga(db: &Db) -> R<Option<Value>> {
    let Some(row) = db.get("SELECT id, tip, naziv FROM products WHERE sifra = ?", p![PRODAJNA_USLUGA_SIFRA])? else {
        return Ok(None);
    };
    if row["tip"] != "usluga" {
        baci!(
            "Šifra {PRODAJNA_USLUGA_SIFRA} je zauzeta artiklom \"{}\" koji nije usluga — promijenite šifru tog artikla pa ponovo izdajte račun",
            js::to_string(&row["naziv"])
        );
    }
    Ok(Some(row["id"].clone()))
}

/// Pri uključivanju modula: kreira uslugu NAMJ ako šifra nije zauzeta. Postojeći
/// proizvod sa tom šifrom se ne dira (ni kad nije usluga — tada izdavanje
/// računa za nalog javi grešku prije štampe).
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

static IZDAVANJA_U_TOKU: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Upiše fakturisanje naloga (status → fakturisan, racunId) u transakciji.
/// Račun je u tom trenutku već odštampan (ili je već postojao) — greška ovdje
/// ne smije proći nezapaženo jer nalog i knjigovodstvo ispadnu iz sinhrona.
fn knjizi_fakturisanje_naloga(db: &Db, nalog_id: &Value, racun_id: &Value, broj_fiskalnog_racuna: &Value) -> R<()> {
    if let Err(e) = db.tx(|| fakturisi_nalog(db, nalog_id, racun_id)) {
        baci!(
            "{}",
            ponude::poruka_nakon_stampe(
                broj_fiskalnog_racuna,
                "nalog nije zabilježen kao fakturisan u bazi",
                e.poruka(),
                "Evidentirajte nalog ručno."
            )
        );
    }
    Ok(())
}

/// Fiskalni račun za završen nalog po narudžbi. Nalog iz ponude ide kroz
/// konverziju ponude (stvarne stavke); samostalan nalog ide kao jedna stavka
/// usluge "Namještaj po mjeri" po dogovorenoj cijeni. Upis tek nakon štampe.
/// Ako je ponuda već konvertovana direktno (npr. sa ekrana Ponude), nalog se
/// samo poveže sa postojećim računom — bez ponovne štampe.
pub fn izdaj_racun_za_nalog(b: &Backend, kanal: &str, data: &Value) -> R<Value> {
    let db = b.baza()?;
    let nalog = get_nalog(db, &data["id"])?;
    if nalog["vrsta"] != "narudzba" {
        baci!("Račun se izdaje samo za nalog po narudžbi");
    }
    if nalog["status"] != "zavrsen" {
        baci!("Nalog mora biti završen prije izdavanja računa");
    }
    let Some(_u_toku) = UToku::zauzmi(&IZDAVANJA_U_TOKU, &nalog["id"]) else {
        baci!("Izdavanje računa za ovaj nalog je već u toku");
    };
    // Sve što bi upis nakon štampe odbio (FK na korisnika) provjerava se prije štampe.
    let korisnik = if truthy(&data["korisnikId"]) {
        db.get("SELECT id FROM users WHERE id = ?", p![data["korisnikId"]])?
    } else {
        None
    };
    if korisnik.is_none() {
        baci!("Korisnik nije prijavljen");
    }
    // Štampa bez oznake plaćanja ide kao Gotovina — i u bazu se tako upisuje.
    let nacin_placanja = js::or(&data["nacinPlacanja"], &json!("Gotovina")).clone();

    if truthy(&nalog["ponudaId"]) {
        let ponuda = db.get("SELECT status, racunId FROM ponude WHERE id = ?", p![nalog["ponudaId"]])?;

        if let Some(ponuda) = ponuda.filter(|p| p["status"] == "konvertovana" && truthy(&p["racunId"])) {
            let order = db.get("SELECT brojFiskalnogRacuna FROM orders WHERE id = ?", p![ponuda["racunId"]])?;
            let broj_fiskalnog_racuna = order.map(|o| o["brojFiskalnogRacuna"].clone()).unwrap_or(Value::Null);
            knjizi_fakturisanje_naloga(db, &nalog["id"], &ponuda["racunId"], &broj_fiskalnog_racuna)?;
            return Ok(ponude::uspjesna_stampa(&ponuda["racunId"], &broj_fiskalnog_racuna, &json!({})));
        }

        let res = ponude::konvertuj_ponudu(
            b,
            kanal,
            &json!({ "id": nalog["ponudaId"], "korisnikId": data["korisnikId"], "nacinPlacanja": nacin_placanja }),
        )?;
        if truthy(&res["success"]) && truthy(&res["racunId"]) {
            knjizi_fakturisanje_naloga(db, &nalog["id"], &res["racunId"], &res["brojFiskalnogRacuna"])?;
        }
        return Ok(res);
    }

    if !(to_number(&nalog["dogovorenaCijena"]) > 0.0) {
        baci!("Dogovorena cijena mora biti upisana prije izdavanja računa");
    }
    // Usluga se kreira tek uz uspješan upis — neuspjela štampa ne ostavlja tragove.
    let postojeca_usluga = postojeca_prodajna_usluga(db)?;
    let mut stavke = vec![json!({
        "productId": postojeca_usluga.unwrap_or(json!(0)), "kolicina": 1, "cijena": nalog["dogovorenaCijena"], "rabat": 0, "pdvStopa": "E",
        "productSifra": PRODAJNA_USLUGA_SIFRA, "productNaziv": PRODAJNA_USLUGA_NAZIV, "productJm": "kom", "productTip": "usluga",
    })];
    let (ukupno, pdv_iznos) = izracunaj_totale(&stavke);
    let kupac = if truthy(&nalog["kupacId"]) { db.get("SELECT * FROM kupci WHERE id = ?", p![nalog["kupacId"]])? } else { None };

    let racun = build_tring_racun(&json!({
        "stavke": stavke, "ukupno": js::f(ukupno), "nacinPlacanja": nacin_placanja,
        "kupac": ponude::kupac_za_racun(&kupac),
    }));
    let result = ponude::stampaj(b, kanal, &racun);
    if !uspjeh(&result) {
        return Ok(ponude::neuspjela_stampa(&result));
    }
    let broj_fiskalnog_racuna = js::or_null(&result["odgovori"]["BrojFiskalnogRacuna"]);

    let upis = db.tx(|| {
        let usluga = match postojeca_prodajna_usluga(db)? {
            Some(id) => id,
            None => json!(osiguraj_prodajnu_uslugu(db)?),
        };
        stavke[0]["productId"] = usluga;
        let order_id = json!(upisi_racun(
            db,
            &json!({
                "korisnikId": data["korisnikId"], "ukupno": js::f(ukupno), "pdvIznos": js::f(pdv_iznos),
                "nacinPlacanja": nacin_placanja, "brojFiskalnogRacuna": broj_fiskalnog_racuna,
                "kupac": kupac.clone().unwrap_or(Value::Null), "stavke": stavke,
            }),
        )?);
        fakturisi_nalog(db, &nalog["id"], &order_id)?;
        Ok(order_id)
    });
    match upis {
        Ok(racun_id) => Ok(ponude::uspjesna_stampa(&racun_id, &broj_fiskalnog_racuna, &result["odgovori"])),
        Err(e) => baci!(
            "{}",
            ponude::poruka_nakon_stampe(&broj_fiskalnog_racuna, "nije zabilježen u bazi", e.poruka(), "Evidentirajte račun ručno.")
        ),
    }
}

fn set_status(db: &Db, data: &Value) -> R<Value> {
    let status = &data["status"];
    if status == "u_izradi" {
        set_status_naloga(db, &data["id"], "u_izradi")?;
    } else if status == "zavrsen" {
        db.tx(|| zavrsi_nalog(db, &data["id"]))?;
    } else if status == "vrati" {
        let u = db.get("SELECT uloga FROM users WHERE id = ?", p![data["korisnikId"]])?;
        if !u.is_some_and(|u| u["uloga"] == "admin") {
            baci!("Vraćanje naloga u izradu može samo administrator");
        }
        db.tx(|| vrati_u_izradu(db, &data["id"]))?;
    } else {
        baci!("Nepoznat status");
    }
    Ok(json!({ "success": true }))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    if let Err(e) = b.db() {
        return Some(Err(e));
    }
    let b: &Backend = b;
    let db = match b.baza() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    let ok = |r: R<()>| r.map(|_| json!({ "success": true }));
    Some(match kanal {
        "nalog:getAll" => list_nalozi(db, &a[0]),
        "nalog:get" => get_nalog(db, &a[0]),
        "nalog:nextBroj" => {
            let godina = b.sat.godina();
            next_broj_naloga(db, &json!(godina)).map(|broj| json!({ "broj": broj, "godina": godina }))
        }
        "nalog:create" => {
            if !truthy(&a[0]["korisnikId"]) {
                return Some(Err("Korisnik nije prijavljen".into()));
            }
            let danas = b.sat.danas();
            db.tx(|| create_nalog(db, &a[0], &danas))
        }
        "nalog:createIzPonude" => {
            if !truthy(&a[1]) {
                return Some(Err("Korisnik nije prijavljen".into()));
            }
            let danas = b.sat.danas();
            db.tx(|| create_nalog_iz_ponude(db, &a[0], &a[1], &danas))
        }
        "nalog:zaPonudu" => nalog_za_ponudu(db, &a[0]),
        "nalog:update" => ok(update_nalog(db, &a[0], &a[1])),
        "nalog:replaceStavke" => ok(db.tx(|| replace_stavke(db, &a[0], &a[1]))),
        "nalog:setStatus" => set_status(db, &a[0]),
        "nalog:delete" => ok(db.tx(|| delete_nalog(db, &a[0]))),
        "nalog:kalkulacija" => kalkulacija_naloga(db, &a[0]),
        "nalog:izdajRacun" => b.load_tring_config().and_then(|_| izdaj_racun_za_nalog(b, kanal, &a[0])),
        "normativ:get" => get_normativ(db, &a[0]).map(Value::from),
        "normativ:save" => ok(db.tx(|| save_normativ(db, &a[0], &a[1]))),
        _ => return None,
    })
}
