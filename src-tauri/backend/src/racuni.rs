//! Kanali `order:*`, `pending:*`, `prilog:*` i `fiscal:*` (handlers.ts) i
//! logika iz `lib/valuta.ts`. Račun po prilogu je u prilog.rs, storno u storno.rs.

use std::collections::HashSet;

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, truthy};
use crate::sql::Db;
use crate::stampa::{self, Odstampan, Uredjaj};
use crate::tring;
use crate::sesija::{self, Korisnik};
use crate::pending_racun::{self, preuzmi_pending_red, vec_evidentiran};
use crate::prilog::{
    finalize_prilog_and_print, oznaci_ponudu_fakturisanom, prilog_naziv, save_prilog_stavke_in_transaction, PRILOG_SIFRA,
};
use crate::storno::{refund_and_print, refund_order_in_transaction};
use crate::kanali::Kanal;
use crate::{audit, baci, fiskalni, korisnici, p, ponude, proizvodnja, provjera_racuna, racun, tring_racun, Backend};

// ─── lib/valuta.ts ──────────────────────────────────────────

// Datum valute (rok plaćanja) na izdatom računu. Nije dio fiskalnog zapisa —
// upisuje se naknadno, po dogovoru s kupcem, i prikazuje se samo na A4 kopiji
// računa i na A4 fakturi (računu po prilogu). Zato se smije mijenjati i brisati
// bez ograničenja, i na stornu.

/// Prihvata samo `YYYY-MM-DD` koji zaista postoji u kalendaru (ne 2026-02-30).
pub fn validan_datum_valute(datum: &str) -> bool {
    // ISO datum bez vremena, onako kako ga vraća `DatePicker`.
    if !js::iso_datum(datum) {
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
    let db = b.db();
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
        let id = racun::upisi_racun(
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
    let db = b.db();
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
    // Sve što može pasti prije štampe (postavke uređaja, račun za uređaj) ide
    // prije write-ahead reda — greška ovdje ne ostavlja nezavršen račun.
    let uredjaj = Uredjaj::iz_postavki(b)?;
    let racun = tring_racun::build_tring_racun(&js::spoji(&data, vec![("items", data["stavke"].clone())]));

    // 1. Write-ahead: persist the snapshot BEFORE printing (committed immediately).
    let pending_id = db
        .run("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)", p![data["korisnikId"], js::stringify(&data)])?
        .last_insert_rowid;

    // 2. Print.
    let result = uredjaj.fiskalni("finalize", &racun);

    // 3b. Print failed → surely not printed: drop the pending row; unknown
    // outcome (timeout, dropped connection): keep it for the pending dialog.
    if !tring::uspjeh(&result) {
        return stampa::neuspjeh(db, pending_id, &result);
    }

    // 3a. Print succeeded → delete pending row + create order atomically. A
    // row already resolved from the dialog meanwhile means no second order.
    let broj_fiskalnog_racuna = stampa::broj_sa_uredjaja(&result);
    let upis = db.tx(|| {
        if !preuzmi_pending_red(db, pending_id)? {
            return Ok(None);
        }
        racun::upisi_racun(
            db,
            &js::spoji(&data, vec![("brojFiskalnogRacuna", broj_fiskalnog_racuna.clone()), ("isManual", json!(0))]),
        )
        .map(Some)
    });
    let order_id = match upis {
        Ok(Some(id)) => id,
        Ok(None) => return Ok(vec_evidentiran(&broj_fiskalnog_racuna)),
        // Račun je već na papiru; pending red ostaje (rollback) za dijalog.
        Err(e) => return Err(stampa::nije_zabiljezen(Odstampan::Racun(&broj_fiskalnog_racuna), &e)),
    };

    Ok(json!({ "success": true, "id": order_id, "brojFiskalnogRacuna": broj_fiskalnog_racuna, "odgovori": result["odgovori"] }))
}

/// `order:refundAndPrint`. Kasir uz uključen "PIN za reklamaciju" šalje admin
/// PIN u istom pozivu; provjera je ovdje, prije štampe — odvojen korak
/// provjere renderer bi mogao preskočiti.
fn storno(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db();
    let k: Korisnik = sesija::korisnik(b)?;
    let mut odobrio_admin_id = Value::Null;
    if db.val("SELECT value FROM settings WHERE key = ?", p!["kasa.requirePinRefund"])? == "true" && !k.je_admin() {
        if !truthy(&data["adminPin"]) {
            baci!("Reklamacija traži PIN administratora");
        }
        odobrio_admin_id = json!(korisnici::provjeri_admin_pin(b, &data["adminPin"])?.id);
    }
    let original = db.get("SELECT brojFiskalnogRacuna, ukupno FROM orders WHERE id = ?", p![data["id"]])?;
    let rezultat = refund_and_print(b, data, k.id, &odobrio_admin_id)?;
    if truthy(&rezultat["success"]) {
        // Storno je već odštampan i upisan — greška traga ne smije to sakriti.
        // Korisnik je onaj s početka poziva: dok se čekala štampa, neko se mogao
        // odjaviti ili prijaviti drugi korisnik.
        let o = |kljuc: &str| original.as_ref().map(|o| o[kljuc].clone()).unwrap_or(Value::Null);
        let trag = audit::zapisi(
            db,
            Some(k.id),
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

fn pending_resolve(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db();
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
    // Snapshot bez `vrsta` ili s `vrsta: null` je običan račun (TS: `?? undefined`).
    let vrsta = &snap["vrsta"];
    if !vrsta.is_null() && !["ponuda", "nalog", "storno"].iter().any(|v| vrsta == *v) {
        baci!("Nepoznata vrsta nezavršenog zapisa: \"{}\"", js::to_string(vrsta));
    }

    // Storno ne upisuje račun: nosi broj reklamacije (drugi niz, ne broj
    // računa) i nema način plaćanja.
    if vrsta != "storno" {
        pending_racun::provjeri_nacin_placanja_snapshota(&snap)?;
        if db.ima("SELECT id FROM orders WHERE brojFiskalnogRacuna = ?", p![broj])? {
            baci!("Fiskalni račun sa tim brojem već postoji");
        }
    }

    let id = db.tx(|| {
        // Odštampan dokument upisuje se istom operacijom kao nakon uspješne
        // štampe, s brojem i datumom s papira (ručni račun).
        let order_id = if vrsta == "ponuda" {
            json!(ponude::upisi_konverziju_ponude(db, &snap, &broj, &data["createdAt"], 1)?)
        } else if vrsta == "nalog" {
            json!(proizvodnja::upisi_racun_naloga(db, &snap, &broj, &data["createdAt"], 1)?)
        } else if vrsta == "storno" {
            refund_order_in_transaction(db, &snap["orderId"], &broj, &data["createdAt"])?;
            // Jedini trag 'storno' za ovaj storno (nepoznat ishod ga nije upisao):
            // isti oblik kao order:refundAndPrint, pod pokretačem, uz ko je red riješio.
            audit::zapisi(
                db,
                snap["korisnikId"].as_i64(),
                "storno",
                json!({
                    "orderId": snap["orderId"], "brojFiskalnogRacuna": snap["brojRacuna"], "brojReklamacije": broj,
                    "ukupno": snap["ukupno"], "odobrioAdminId": snap["odobrioAdminId"],
                    "pologIznos": js::nn(&snap["pologIznos"], &json!(0)),
                    "pendingId": data["id"], "rijesioKorisnikId": b.sesija.id(),
                }),
            )?;
            snap["orderId"].clone()
        } else {
            // Snapshot bez vrste: račun sa kase ili faktura (i sve stare baze).
            // Prilog račun: broj fakture je BF koji operater ovdje ukuca; rezervni
            // broj iz snapshota ostaje samo kad BF nije numerički.
            let prilog_broj = if snap["prilogBroj"].is_null() {
                Value::Null
            } else {
                fiskalni::parse_fiskalni_broj(&broj).map(Value::from).unwrap_or_else(|| snap["prilogBroj"].clone())
            };
            let order_id = racun::upisi_racun(
                db,
                &js::spoji(
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
            // Faktura iz skice: odštampana faktura se ne smije moći fiskalizovati ponovo.
            if !snap["skicaId"].is_null() {
                db.run("DELETE FROM faktura_skice WHERE id = ?", p![snap["skicaId"]])?;
            }
            json!(order_id)
        };
        db.run("DELETE FROM pending_receipts WHERE id = ?", p![data["id"]])?;
        let mut trag = json!({ "pendingId": data["id"], "brojFiskalnogRacuna": broj, "orderId": order_id });
        if !vrsta.is_null() {
            trag["vrsta"] = vrsta.clone();
        }
        audit::zabiljezi(b, "pending:rijesi", trag)?;
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
    let db = b.db();
    let mut dismissed = odbacene_praznine(db)?;
    // `includes` poredi brojeve po vrijednosti (5 i 5.0 su isti).
    if dismissed.iter().any(|v| js::jednako(v, broj)) {
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
    let db = b.db();
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
    let db = b.db();
    db.tx(|| {
        let stari_broj = fiskalni::zadnji_upisani_fiskalni_broj(db)?;
        fiskalni::postavi_zadnji_fiskalni_broj(db, broj)?;
        audit::zabiljezi(b, "fiskalni:zadnjiBroj", json!({ "stariBroj": stari_broj, "noviBroj": broj }))
    })?;
    Ok(json!({ "success": true, "predvidjeni": fiskalni::predvidjeni_fiskalni_broj(db)? }))
}

/// Fiskalni niz: račun po prilogu mora znati broj isječka prije nego ga odštampa.
fn numeracija(db: &Db) -> R<Value> {
    Ok(json!({
        "zadnjiUBazi": fiskalni::zadnji_fiskalni_broj(db)?,
        "zadnjiUpisani": fiskalni::zadnji_upisani_fiskalni_broj(db)?,
        "predvidjeni": fiskalni::predvidjeni_fiskalni_broj(db)?,
    }))
}

fn prilog_stavke(db: &Db, order_id: &Value) -> R<Value> {
    db.all(
        "
      SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra, p.tip AS productTip
      FROM prilog_stavke ps
      LEFT JOIN products p ON p.id = ps.productId
      WHERE ps.orderId = ?
      ORDER BY ps.id
    ",
        p![order_id],
    )
    .map(Value::from)
}

pub const KANALI: &[Kanal] = &[
    Kanal { ime: "order:getAll", h: |b, _| get_all(b.db()) },
    Kanal { ime: "order:get", h: |b, a| get(b.db(), &a[0]) },
    Kanal { ime: "order:createManual", h: |b, a| create_manual(b, &a[0]) },
    Kanal { ime: "order:finalize", h: |b, a| finalize(b, &a[0]) },
    // Račun po prilogu: jedna zbirna stavka na fiskalnom računu, stvarne stavke
    // se dodjeljuju naknadno.
    Kanal {
        ime: "order:finalizePrilog",
        h: |b, a| sesija::korisnik(b).and_then(|k| finalize_prilog_and_print(b, &sesija::sa_korisnikom(&a[0], k.id))),
    },
    Kanal { ime: "fiscal:getNumeracija", h: |b, _| numeracija(b.db()) },
    Kanal { ime: "fiscal:setZadnjiBroj", h: |b, a| set_zadnji_broj(b, &a[0]) },
    Kanal { ime: "prilog:getStavke", h: |b, a| prilog_stavke(b.db(), &a[0]) },
    Kanal {
        ime: "prilog:saveStavke",
        h: |b, a| b.db().tx(|| save_prilog_stavke_in_transaction(b.db(), &a[0], &a[1])).map(|_| json!({ "success": true })),
    },
    Kanal { ime: "order:setDatumValute", h: |b, a| postavi_datum_valute(b.db(), &a[0], &a[1]).map(|d| json!({ "datumValute": d })) },
    // Orkestracija (štampa → atomični upis) je u `refund_and_print`.
    Kanal { ime: "order:refundAndPrint", h: |b, a| storno(b, &a[0]) },
    Kanal { ime: "pending:list", h: |b, _| pending_list(b.db()) },
    Kanal { ime: "pending:resolve", h: |b, a| pending_resolve(b, &a[0]) },
    Kanal { ime: "pending:discard", h: |b, a| pending_discard(b, &a[0]) },
    Kanal { ime: "order:getFiscalGaps", h: |b, _| get_fiscal_gaps(b.db()) },
    Kanal { ime: "order:dismissFiscalGap", h: |b, a| dismiss_fiscal_gap(b, &a[0]) },
];

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::racun::tests::proba;

    /// Ruling 8: pending:resolve prije ikakvog upisa provjerava način plaćanja
    /// iz snapshota — kanonski tekst s liste ili JSON raspodjela koju
    /// `raspodjela_placanja` prepoznaje. Inače greška, ništa upisano, red ostaje.
    #[test]
    fn pending_resolve_odbija_nepoznat_nacin_placanja() {
        let p = proba("resolve-nacin");
        let a = p.artikal("A1", "artikal");
        let snapshot = |vrsta: Option<&str>, nacin: Option<Value>| {
            let mut s = json!({
                "korisnikId": 1, "ukupno": 5, "pdvIznos": 0.73,
                "stavke": [{ "productId": a, "kolicina": 1, "cijena": 5, "rabat": 0, "pdvStopa": "E", "productTip": "artikal" }],
            });
            if let Some(v) = vrsta {
                s["vrsta"] = json!(v);
                s[if v == "ponuda" { "ponudaId" } else { "nalogId" }] = json!(999);
            }
            if let Some(n) = nacin {
                s["nacinPlacanja"] = n;
            }
            s
        };
        let rijesi = |id: i64, broj: &str| {
            p.call("pending:resolve", vec![json!({ "id": id, "brojFiskalnogRacuna": broj, "createdAt": "2026-03-03 10:00:00" })])
        };
        let broj = |sql: &str| p.all(sql)[0]["n"].clone();

        let odbijeni: Vec<(Option<&str>, Option<Value>, &str)> = vec![
            (None, Some(json!("gotovina")), "gotovina"),
            (None, Some(json!(" Gotovina ")), " Gotovina "),
            (None, Some(json!("cek")), "cek"),
            (None, Some(json!("Bitcoin")), "Bitcoin"),
            (None, Some(json!(r#"{"gotovina":5,"zlato":1}"#)), r#"{"gotovina":5,"zlato":1}"#),
            (None, Some(json!(r#"{"gotovina":0}"#)), r#"{"gotovina":0}"#),
            (None, Some(json!("")), ""),
            // Ruling 15: kao TS `String(nacin ?? '')` — null i nedostajući ključ su "".
            (None, Some(Value::Null), ""),
            (None, None, ""),
            (None, Some(json!(5)), "5"),
            (Some("ponuda"), Some(json!("KARTICA")), "KARTICA"),
            (Some("nalog"), Some(json!("virman")), "virman"),
        ];
        for (vrsta, nacin, prikaz) in odbijeni {
            let id = p.pending(snapshot(vrsta, nacin));
            assert_eq!(
                rijesi(id, "700"),
                Err(format!("Nepoznat način plaćanja: \"{prikaz}\"")),
                "{vrsta:?} {prikaz}"
            );
        }
        assert_eq!(broj("SELECT COUNT(*) AS n FROM orders"), json!(0));
        assert_eq!(broj("SELECT COUNT(*) AS n FROM pending_receipts"), json!(12));
        assert_eq!(broj("SELECT COUNT(*) AS n FROM stock_movements"), json!(0));

        // Kanonski tekst i prepoznata JSON raspodjela (ključevi bez obzira na slova) prolaze.
        for (i, nacin) in ["Gotovina", "Kartica", "Virman", "Ček", r#"{"gotovina":3,"cek":2}"#, r#"{"Gotovina":5}"#].iter().enumerate() {
            let id = p.pending(snapshot(None, Some(json!(nacin))));
            assert!(rijesi(id, &format!("80{i}")).is_ok(), "{nacin}");
        }
        assert_eq!(broj("SELECT COUNT(*) AS n FROM orders"), json!(6));

        // Storno ne upisuje način plaćanja — njegov snapshot ga nema.
        let order = p.run(
            "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status) VALUES (1, 5, 0.73, 'Gotovina', '900', 'completed')",
            &[],
        );
        let storno = p.pending(json!({ "vrsta": "storno", "orderId": order, "brojRacuna": "900", "korisnikId": 1, "ukupno": 5, "stavke": [] }));
        assert!(rijesi(storno, "R-1").is_ok());
        assert_eq!(p.all(&format!("SELECT status FROM orders WHERE id = {order}"))[0]["status"], json!("refunded"));
    }
}
