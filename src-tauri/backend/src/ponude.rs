//! Kanali `ponuda:*` (handlers.ts) i logika iz `lib/ponuda.ts`.

use std::collections::BTreeSet;
use std::sync::Mutex;

use chrono::{Datelike, Duration, NaiveDate};
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, or, truthy};
use crate::racun::{izracunaj_totale, upisi_racun};
use crate::sql::Db;
use crate::tring::uspjeh;
use crate::tring_racun::build_tring_racun;
use crate::{baci, p, Args, Backend};

/// Default rok važenja ponude (uobičajena "opcija 8 dana").
pub const DEFAULT_ROK_DANA: i64 = 8;

/// Datum ("YYYY-MM-DD") pomjeren za `dana` dana naprijed.
///
/// Original ide preko `new Date(`${datum}T00:00:00`)` po lokalnoj zoni; dan u
/// mjesecu do 31 se (kao u V8) prelije u sljedeći mjesec, a neispravan datum
/// daje "NaN-NaN-NaN".
pub fn plus_dana(datum: &str, dana: i64) -> String {
    thread_local!(static ISO: Regex = Regex::new(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$").unwrap());
    let d = ISO.with(|re| {
        let c = re.captures(datum)?;
        let (g, m, d): (i32, u32, i64) = (c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?);
        if !(1..=31).contains(&d) {
            return None;
        }
        NaiveDate::from_ymd_opt(g, m, 1)?.checked_add_signed(Duration::days(d - 1 + dana))
    });
    match d {
        Some(d) => format!("{}-{}-{}", d.year(), js::pad(d.month() as i64, 2), js::pad(d.day() as i64, 2)),
        None => "NaN-NaN-NaN".into(),
    }
}

/// Broj punih dana od `od` do `do_`. Računa se preko UTC ponoći da ljetno
/// računanje vremena ne pojede/doda sat i obori rezultat za jedan dan.
pub fn dana_izmedju(od: &str, do_: &str) -> i64 {
    let dan = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    match (dan(od), dan(do_)) {
        (Some(a), Some(b)) => (b - a).num_days(),
        _ => 0,
    }
}

/// Sljedeći redni broj ponude u godini — brojanje kreće od 1 svake godine.
pub fn next_broj_ponude(db: &Db, godina: &Value) -> R<i64> {
    let max = db.val("SELECT MAX(broj) AS maxBroj FROM ponude WHERE godina = ?", &[godina.clone()])?;
    Ok(max.as_i64().unwrap_or(0) + 1)
}

/// Prikazni oblik broja ponude, npr. "3/2026".
pub fn format_broj_ponude(p: &Value) -> String {
    format!("{}/{}", js::to_string(&p["broj"]), js::to_string(&p["godina"]))
}

/// `Number(datum.slice(0, 4))` kao JSON broj (NaN → null, kako ga SQLite veže).
fn godina_iz_datuma(datum: &str) -> Value {
    let s: String = datum.chars().take(4).collect();
    js::f(js::to_number(&Value::String(s)))
}

fn stavke_niz(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn upisi_stavke(db: &Db, id: &Value, stavke: &[Value]) -> R<()> {
    for s in stavke {
        db.run(
            "INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![id, s["productId"], s["kolicina"], s["cijena"], s["rabat"], s["pdvStopa"]],
        )?;
    }
    Ok(())
}

/// Upiše ponudu sa stavkama. Cijene stavki se zamrzavaju kopiranjem u
/// `ponuda_stavke` — kasnija promjena cjenovnika ne smije mijenjati ponudu,
/// jer je ponuda obećanje kupcu. Poziva se unutar transakcije.
pub fn create_ponuda(db: &Db, data: &Value, danas: &str) -> R<Value> {
    let stavke = stavke_niz(&data["stavke"]);
    if stavke.is_empty() {
        baci!("Ponuda mora imati najmanje jednu stavku");
    }
    if !truthy(&data["kupacId"]) {
        baci!("Kupac je obavezan");
    }

    let datum = if truthy(&data["datum"]) { js::to_string(&data["datum"]) } else { danas.to_string() };
    let godina = godina_iz_datuma(&datum);
    let broj = next_broj_ponude(db, &godina)?;
    let vazi_do = if truthy(&data["vaziDo"]) { js::to_string(&data["vaziDo"]) } else { plus_dana(&datum, DEFAULT_ROK_DANA) };
    let (ukupno, pdv_iznos) = izracunaj_totale(stavke);

    let r = db.run(
        "
    INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, napomena, ukupno, pdvIznos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ",
        p![broj, godina, data["kupacId"], data["korisnikId"], datum, vazi_do, data["napomena"], js::f(ukupno), js::f(pdv_iznos)],
    )?;
    let id = r.last_insert_rowid;
    upisi_stavke(db, &json!(id), stavke)?;

    Ok(json!({ "id": id, "broj": broj, "godina": godina }))
}

/// Statusi koje baza prihvata (CHECK na ponude.status).
pub const PONUDA_STATUSI: [&str; 5] = ["draft", "poslana", "prihvacena", "odbijena", "konvertovana"];

/// Status kakav se prikazuje: 'istekla' se ne upisuje u bazu nego izvodi iz
/// roka — samo za ponude koje još čekaju odgovor (draft/poslana). Zadnji dan
/// roka ponuda još važi.
pub fn efektivni_status(p: &Value, danas: &str) -> String {
    let status = js::to_string(&p["status"]);
    // `danas > null` je u JS-u uvijek false.
    let istekao = p["vaziDo"].as_str().is_some_and(|v| danas > v);
    if (status == "draft" || status == "poslana") && istekao {
        return "istekla".into();
    }
    status
}

/// Ručna promjena statusa. 'konvertovana' smije postaviti samo konverzija.
pub fn set_status_ponude(db: &Db, id: &Value, status: &Value) -> R<()> {
    let Some(status) = status.as_str().filter(|s| PONUDA_STATUSI.contains(s)) else {
        // 'istekla' je samo prikazni status (vidi efektivni_status) — ne upisuje se.
        baci!("Nepoznat status ponude: \"{}\"", js::to_string(js::nn(status, &json!(""))));
    };
    if status == "konvertovana" {
        baci!("Status \"konvertovana\" postavlja se konverzijom u račun");
    }
    let Some(ponuda) = db.get("SELECT status FROM ponude WHERE id = ?", p![id])? else {
        baci!("Ponuda ne postoji");
    };
    if ponuda["status"] == "konvertovana" {
        baci!("Konvertovana ponuda se ne može mijenjati");
    }
    db.run("UPDATE ponude SET status = ? WHERE id = ?", p![status, id])?;
    Ok(())
}

/// Obriše ponudu i njene stavke. Konvertovana ponuda i ponuda za koju postoji
/// radni nalog se ne brišu — nalog se ne briše kaskadno, operater ga mora
/// svjesno obrisati prvo. Nepostojeća ponuda nije greška (changes: 0).
/// Poziva se unutar transakcije.
pub fn delete_ponuda(db: &Db, id: &Value) -> R<Value> {
    let Some(ponuda) = db.get("SELECT status FROM ponude WHERE id = ?", p![id])? else {
        return Ok(json!({ "changes": 0 }));
    };
    if ponuda["status"] == "konvertovana" {
        baci!("Konvertovana ponuda se ne može obrisati — po njoj je izdat račun");
    }
    if let Some(nalog) = db.get("SELECT broj, godina FROM radni_nalozi WHERE ponudaId = ? ORDER BY id LIMIT 1", p![id])? {
        baci!(
            "Ponuda je vezana za radni nalog RN-{}/{} — prvo obrišite nalog",
            js::to_string(&nalog["broj"]),
            js::to_string(&nalog["godina"])
        );
    }
    db.run("DELETE FROM ponuda_stavke WHERE ponudaId = ?", p![id])?;
    let r = db.run("DELETE FROM ponude WHERE id = ?", p![id])?;
    Ok(json!({ "changes": r.changes }))
}

/// Izmijeni ponudu (stavke, kupca, rok, napomenu) i preračunaj totale.
/// Broj i godina se nikad ne mijenjaju — dodijeljeni su pri kreiranju.
/// Konvertovana ponuda je zaključana: račun je već izdat po njoj.
/// Poziva se unutar transakcije.
pub fn update_ponuda(db: &Db, id: &Value, data: &Value) -> R<()> {
    let stavke = stavke_niz(&data["stavke"]);
    if stavke.is_empty() {
        baci!("Ponuda mora imati najmanje jednu stavku");
    }

    let Some(ponuda) = db.get("SELECT id, status, kupacId, datum, vaziDo FROM ponude WHERE id = ?", p![id])? else {
        baci!("Ponuda ne postoji");
    };
    if ponuda["status"] == "konvertovana" {
        baci!("Konvertovana ponuda se ne može mijenjati");
    }

    let (ukupno, pdv_iznos) = izracunaj_totale(stavke);

    db.run(
        "
    UPDATE ponude SET kupacId = ?, datum = ?, vaziDo = ?, napomena = COALESCE(?, napomena),
      ukupno = ?, pdvIznos = ?
    WHERE id = ?
  ",
        p![
            js::nn(&data["kupacId"], &ponuda["kupacId"]),
            js::nn(&data["datum"], &ponuda["datum"]),
            js::nn(&data["vaziDo"], &ponuda["vaziDo"]),
            data["napomena"],
            js::f(ukupno),
            js::f(pdv_iznos),
            id
        ],
    )?;

    db.run("DELETE FROM ponuda_stavke WHERE ponudaId = ?", p![id])?;
    upisi_stavke(db, id, stavke)
}

/// Načini plaćanja koje nude ekrani (u bazi se čuva "Ček" s kvačicom).
pub const NACINI_PLACANJA: [&str; 4] = ["Gotovina", "Kartica", "Virman", "Ček"];

/// Ponude kojima se konverzija trenutno štampa — zaštita od dvoklika.
static KONVERZIJE_IN_FLIGHT: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Oznaka "u toku" koja se skida kad izađe iz opsega (`finally { set.delete(id) }`).
pub(crate) struct UToku {
    skup: &'static Mutex<BTreeSet<String>>,
    kljuc: String,
}

impl UToku {
    /// `None` kad je ključ već u toku (`set.has(id)`).
    pub(crate) fn zauzmi(skup: &'static Mutex<BTreeSet<String>>, id: &Value) -> Option<UToku> {
        let kljuc = js::stringify(id);
        let mut s = skup.lock().unwrap_or_else(|e| e.into_inner());
        if !s.insert(kljuc.clone()) {
            return None;
        }
        Some(UToku { skup, kljuc })
    }

    pub(crate) fn zauzet(skup: &'static Mutex<BTreeSet<String>>, id: &Value) -> bool {
        skup.lock().unwrap_or_else(|e| e.into_inner()).contains(&js::stringify(id))
    }
}

impl Drop for UToku {
    fn drop(&mut self) {
        self.skup.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.kljuc);
    }
}

/// `print` iz handlera: štampa fiskalnog računa, uz dnevnik kad je uključen.
pub(crate) fn stampaj(b: &Backend, kanal: &str, racun: &Value) -> Value {
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] {kanal} request: {}", js::stringify(racun));
    }
    let result = b.tring.stampati_fiskalni_racun(racun);
    if b.tring.is_logging_enabled() {
        eprintln!("[Tring] {kanal} response: {}", js::stringify(&result));
    }
    result
}

/// `{ success: false, error, odgovori }` za neuspjelu štampu.
pub(crate) fn neuspjela_stampa(result: &Value) -> Value {
    json!({
        "success": false,
        "error": or(&result["error"], or(&result["vrstaOdgovora"], &json!("Nepoznata greška"))),
        "odgovori": js::nn(&result["odgovori"], &json!({})),
    })
}

/// `{ success: true, racunId, brojFiskalnogRacuna, odgovori }` — `odgovori`
/// izostaje kad ga uređaj nije vratio (JS `undefined`).
pub(crate) fn uspjesna_stampa(racun_id: &Value, broj: &Value, odgovori: &Value) -> Value {
    let mut m = Map::new();
    m.insert("success".into(), json!(true));
    m.insert("racunId".into(), racun_id.clone());
    m.insert("brojFiskalnogRacuna".into(), broj.clone());
    if !odgovori.is_null() {
        m.insert("odgovori".into(), odgovori.clone());
    }
    Value::Object(m)
}

/// Kupac za Tring: prazan string umjesto null za adresu, poštanski broj i grad.
pub(crate) fn kupac_za_racun(kupac: &Option<Value>) -> Value {
    match kupac {
        Some(k) => json!({
            "idBroj": k["idBroj"], "naziv": k["naziv"], "adresa": or(&k["adresa"], &json!("")),
            "postanskiBroj": or(&k["postanskiBroj"], &json!("")), "grad": or(&k["grad"], &json!("")),
        }),
        None => Value::Null,
    }
}

/// `Račun X JE odštampan, ali ...` — greška upisa nakon uspješne štampe.
pub(crate) fn poruka_nakon_stampe(broj: &Value, sredina: &str, greska: &str, kraj: &str) -> String {
    let broj = if broj.is_null() { "?".to_string() } else { js::to_string(broj) };
    let greska = if greska.is_empty() { "nepoznata greška" } else { greska };
    format!("Račun {broj} JE odštampan, ali {sredina}: {greska}. {kraj}")
}

/// Odštampa fiskalni račun po ponudi i tek nakon uspješne štampe upiše račun,
/// razduži skladište i zaključa ponudu — u jednoj transakciji (isti obrazac
/// kao refundAndPrint). Račun ide po cijenama zamrznutim na ponudi, ne po
/// trenutnom cjenovniku. Istekla ponuda se smije konvertovati — operater
/// odlučuje da li dogovor još važi; odbijena ne smije.
///
/// Sve što bi upis u bazu moglo oboriti (korisnik, način plaćanja, artikli)
/// provjerava se PRIJE štampe — odštampan fiskalni račun se ne može povući.
///
/// `kanal` je samo oznaka za dnevnik štampe (ponuda:konvertuj / nalog:izdajRacun).
pub fn konvertuj_ponudu(b: &Backend, kanal: &str, data: &Value) -> R<Value> {
    let db = b.baza()?;
    let id = &data["id"];

    if UToku::zauzet(&KONVERZIJE_IN_FLIGHT, id) {
        baci!("Konverzija ove ponude je već u toku");
    }

    let korisnik = if truthy(&data["korisnikId"]) {
        db.get("SELECT id FROM users WHERE id = ?", p![data["korisnikId"]])?
    } else {
        None
    };
    if korisnik.is_none() {
        baci!("Korisnik nije prijavljen");
    }

    let nacin_placanja = data["nacinPlacanja"].as_str().map(str::trim).unwrap_or("");
    if nacin_placanja.is_empty() {
        baci!("Način plaćanja je obavezan");
    }
    if !NACINI_PLACANJA.contains(&nacin_placanja) {
        baci!("Nepoznat način plaćanja: \"{nacin_placanja}\"");
    }

    let Some(ponuda) = db.get("SELECT * FROM ponude WHERE id = ?", p![id])? else {
        baci!("Ponuda ne postoji");
    };
    if ponuda["status"] == "konvertovana" {
        baci!("Ponuda je već konvertovana u račun");
    }
    if ponuda["status"] == "odbijena" {
        baci!("Odbijena ponuda se ne može pretvoriti u račun — ako kupac ipak prihvata, prvo promijenite status");
    }

    let stavke = db.all(
        "
    SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra,
           p.plu AS productPlu, p.tip AS productTip
    FROM ponuda_stavke ps
    LEFT JOIN products p ON p.id = ps.productId
    WHERE ps.ponudaId = ?
  ",
        p![id],
    )?;
    if stavke.is_empty() {
        baci!("Ponuda nema stavki");
    }
    // LEFT JOIN: artikal koji je nestao daje NULL naziv — upis stavke bi pao na
    // stranom ključu tek nakon štampe.
    if stavke.iter().any(|s| s["productNaziv"].is_null()) {
        baci!("Artikal na stavci ponude više ne postoji — izmijenite ponudu prije izdavanja računa");
    }

    let kupac = db.get("SELECT * FROM kupci WHERE id = ?", p![ponuda["kupacId"]])?;

    let _u_toku = UToku::zauzmi(&KONVERZIJE_IN_FLIGHT, id);
    let racun = build_tring_racun(&json!({
        "stavke": stavke,
        "ukupno": ponuda["ukupno"],
        "nacinPlacanja": nacin_placanja,
        "kupac": kupac_za_racun(&kupac),
    }));

    let result = stampaj(b, kanal, &racun);

    if !uspjeh(&result) {
        return Ok(neuspjela_stampa(&result));
    }

    let broj_fiskalnog_racuna = js::or_null(&result["odgovori"]["BrojFiskalnogRacuna"]);

    let upis = db.tx(|| {
        let order_id = upisi_racun(
            db,
            &json!({
                "korisnikId": data["korisnikId"], "ukupno": ponuda["ukupno"], "pdvIznos": ponuda["pdvIznos"],
                "nacinPlacanja": nacin_placanja, "brojFiskalnogRacuna": broj_fiskalnog_racuna,
                "kupac": kupac.clone().unwrap_or(Value::Null), "stavke": stavke,
            }),
        )?;
        db.run("UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ?", p![order_id, id])?;
        Ok(order_id)
    });

    match upis {
        Ok(racun_id) => Ok(uspjesna_stampa(&json!(racun_id), &broj_fiskalnog_racuna, &result["odgovori"])),
        // Račun je već na papiru i u fiskalnom uređaju — operater to mora znati.
        Err(e) => baci!(
            "{}",
            poruka_nakon_stampe(&broj_fiskalnog_racuna, "nije zabilježen u bazi", e.poruka(), "Evidentirajte račun ručno.")
        ),
    }
}

fn get_all(db: &Db) -> R<Value> {
    Ok(Value::from(db.all(
        "
      SELECT po.*, k.naziv AS kupacNaziv, u.ime AS korisnikIme,
        o.brojFiskalnogRacuna AS racunBroj
      FROM ponude po
      LEFT JOIN kupci k ON k.id = po.kupacId
      LEFT JOIN users u ON u.id = po.korisnikId
      LEFT JOIN orders o ON o.id = po.racunId
      ORDER BY po.godina DESC, po.broj DESC
    ",
        p![],
    )?))
}

fn get(db: &Db, id: &Value) -> R<Value> {
    let Some(mut ponuda) = db.get(
        "
      SELECT po.*, u.ime AS korisnikIme, o.brojFiskalnogRacuna AS racunBroj,
        k.naziv AS kupacNaziv, k.idBroj AS kupacIdBroj, k.pdvBroj AS kupacPdvBroj,
        k.adresa AS kupacAdresa, k.grad AS kupacGrad, k.postanskiBroj AS kupacPostanskiBroj
      FROM ponude po
      LEFT JOIN kupci k ON k.id = po.kupacId
      LEFT JOIN users u ON u.id = po.korisnikId
      LEFT JOIN orders o ON o.id = po.racunId
      WHERE po.id = ?
    ",
        p![id],
    )?
    else {
        baci!("Ponuda ne postoji");
    };

    ponuda["stavke"] = Value::from(db.all(
        "
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.plu AS productPlu
      FROM ponuda_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.ponudaId = ?
    ",
        p![id],
    )?);

    Ok(ponuda)
}

fn create(db: &Db, data: &Value, danas: &str) -> R<Value> {
    if !truthy(&data["korisnikId"]) {
        baci!("Korisnik nije prijavljen");
    }
    db.tx(|| create_ponuda(db, data, danas))
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
    Some(match kanal {
        "ponuda:getAll" => get_all(db),
        "ponuda:get" => get(db, &a[0]),
        "ponuda:nextBroj" => {
            let godina = b.sat.godina();
            next_broj_ponude(db, &json!(godina)).map(|broj| json!({ "broj": broj, "godina": godina }))
        }
        "ponuda:create" => create(db, &a[0], &b.sat.danas()),
        "ponuda:update" => db.tx(|| update_ponuda(db, &a[0], &a[1])).map(|_| json!({ "success": true })),
        "ponuda:setStatus" => set_status_ponude(db, &a[0], &a[1]).map(|_| json!({ "success": true })),
        "ponuda:delete" => db.tx(|| delete_ponuda(db, &a[0])),
        // Orkestracija (štampa → atomični upis) je u `konvertuj_ponudu`, isto
        // kao što je u TS-u živjela u lib/ponuda.ts.
        "ponuda:konvertuj" => b.load_tring_config().and_then(|_| konvertuj_ponudu(b, kanal, &a[0])),
        _ => return None,
    })
}
