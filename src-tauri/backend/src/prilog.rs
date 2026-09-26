//! Račun po prilogu (`lib/prilog.ts`): fiskalno se kuca jedna zbirna
//! stavka, a stvarne stavke se dodjeljuju naknadno.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, round2, to_number, truthy};
use crate::pending_racun::{baci_ako_ceka_nezavrsen, preuzmi_pending_red, vec_evidentiran};
use crate::racun::niz;
use crate::racuni::{spoji, validan_datum_valute};
use crate::sql::Db;
use crate::stampa::{self, Uredjaj};
use crate::{baci, fiskalni, p, provjera_racuna, racun, tring, tring_racun, Backend};

/// `s.slice(0, n)` — JS broji UTF-16 jedinice.
fn slice_utf16(s: &str, n: usize) -> String {
    let jedinice: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&jedinice)
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
/// Kretanja nose datum računa, ne dan dodjele — „Zalihe na dan" inače skidaju
/// robu na pogrešan datum.
///
/// Sve provjere idu prije prvog upisa da poziv bez transakcije (testovi) ne
/// ostavi pola stavki u bazi.
pub fn save_prilog_stavke_in_transaction(db: &Db, order_id: &Value, stavke: &Value) -> R<()> {
    let Some(order) = db.get("SELECT prilogBroj, status, ukupno, createdAt FROM orders WHERE id = ?", p![order_id])? else {
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
                "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'prilog', ?, ?)",
                p![s["productId"], s["kolicina"], order_id, order["createdAt"]],
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
pub fn finalize_prilog_and_print(b: &Backend, data: &Value) -> R<Value> {
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
    // Faktura iz ponude čiji račun još čeka u nezavršenim bila bi drugi račun za isti posao.
    if !ponuda_id.is_null() {
        baci_ako_ceka_nezavrsen(db, "ponudaId", &ponuda_id, "Račun po ovoj ponudi", "prije nove štampe")?;
    }
    // Skica iz koje je faktura nastala: briše se kad račun postoji u bazi (i kad
    // se nezavršeni račun riješi kao odštampan), da se ne fiskalizuje ponovo.
    // `Number.isInteger(data.skicaId)`.
    let skica_id = data["skicaId"].as_f64().filter(|x| x.fract() == 0.0).map(|x| x as i64);

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
    // Samo kad postoji — stari snapshoti i računi bez skice ostaju isti.
    if let Some(id) = skica_id {
        snapshot.insert("skicaId".into(), json!(id));
    }
    let uredjaj = Uredjaj::iz_postavki(b)?;
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
    let result = uredjaj.fiskalni("finalizePrilog", &racun);

    // Siguran neuspjeh briše pending red; nepoznat ishod ga ostavlja.
    if !tring::uspjeh(&result) {
        return stampa::neuspjeh(db, pending_id, &result);
    }

    let broj_fiskalnog_racuna = stampa::broj_sa_uredjaja(&result);
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
        // Red riješen iz dijaloga dok je štampa trajala → bez drugog zapisa.
        if !preuzmi_pending_red(db, pending_id)? {
            return Ok(None);
        }
        // Prilog račun nema order_items: fiskalizovana je samo zbirna stavka.
        let order_id = racun::upisi_racun(
            db,
            &json!({
                "korisnikId": data["korisnikId"], "ukupno": js::f(ukupno), "pdvIznos": js::f(pdv_iznos),
                "nacinPlacanja": nacin_placanja, "brojFiskalnogRacuna": broj_fiskalnog_racuna, "kupac": kupac_v,
                "stavke": [], "isManual": 0, "prilogBroj": prilog_broj, "prilogNaziv": naziv,
                "datumValute": datum_valute, "napomena": napomena,
            }),
        )?;
        if !stavke.is_empty() {
            save_prilog_stavke_in_transaction(db, &json!(order_id), &stavke_v)?;
        }
        if !ponuda_id.is_null() {
            oznaci_ponudu_fakturisanom(db, &ponuda_id, &json!(order_id))?;
        }
        if let Some(id) = skica_id {
            db.run("DELETE FROM faktura_skice WHERE id = ?", p![id])?;
        }
        Ok(Some(order_id))
    });
    let order_id = match upis {
        Ok(Some(id)) => id,
        Ok(None) => return Ok(vec_evidentiran(&broj_fiskalnog_racuna)),
        // Račun je već na papiru; pending red namjerno ostaje da se može riješiti
        // kroz pending:resolve, ali operater to mora znati odmah.
        Err(e) => baci!(
            "Fiskalni račun po prilogu br. {prilog_broj} (BF {}) JE odštampan, ali nije zabilježen u bazi: {}. Riješite ga kroz nezavršene račune.",
            stampa::prikaz_broja(&broj_fiskalnog_racuna),
            stampa::prikaz_greske(e.poruka())
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
