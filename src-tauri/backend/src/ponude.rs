//! Kanali `ponuda:*` (handlers.ts) i logika iz `lib/ponuda.ts`.

use chrono::{Datelike, Duration, NaiveDate};
use regex::Regex;
use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::pending_racun::{baci_ako_ceka_nezavrsen, preuzmi_pending_red, snapshot_kupca, vec_evidentiran, zapisi_pending};
use crate::js::{self, or, truthy};
use crate::postavke::postavka;
use crate::racun::{izracunaj_totale, upisi_racun};
use crate::sql::Db;
use crate::stampa::{self, Odstampan, UToku, Uredjaj};
use crate::tring::uspjeh;
use crate::tring_racun::build_tring_racun;
use crate::sesija;
use crate::{baci, p, provjera_racuna, Args, Backend};

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

/// Najveći broj iz starog programa za godinu, ili 0 — par `nastavakNumeracije` u dokumentPostavke.ts.
/// Važi samo kad su i broj (1–999999) i godina (2000–2999) ispravni cijeli brojevi.
pub fn nastavak_numeracije(db: &Db, dok: &str, godina: &Value) -> R<i64> {
    let cijeli = |v: Value, min: i64, max: i64| -> Option<i64> {
        let t = v.as_str()?.trim();
        if t.is_empty() || !t.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        t.parse::<i64>().ok().filter(|n| (min..=max).contains(n))
    };
    let broj = cijeli(postavka(db, &format!("dokumenti.{dok}.nastavakBroj"))?, 1, 999_999);
    let god = cijeli(postavka(db, &format!("dokumenti.{dok}.nastavakGodina"))?, 2000, 2999);
    Ok(match (broj, god) {
        (Some(b), Some(g)) if Some(g) == godina.as_i64() => b,
        _ => 0,
    })
}

/// Sljedeći redni broj ponude u godini — od 1, ili iza posljednjeg broja iz starog programa.
pub fn next_broj_ponude(db: &Db, godina: &Value) -> R<i64> {
    let max = db.val("SELECT MAX(broj) AS maxBroj FROM ponude WHERE godina = ?", &[godina.clone()])?;
    Ok(max.as_i64().unwrap_or(0).max(nastavak_numeracije(db, "ponuda", godina)?) + 1)
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

fn upisi_stavke(db: &Db, id: &Value, stavke: &[Value]) -> R<()> {
    for s in stavke {
        db.run(
            "INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![id, s["productId"], s["kolicina"], s["cijena"], s["rabat"], s["pdvStopa"]],
        )?;
    }
    Ok(())
}

/// `!data.stavke || data.stavke.length === 0`
fn bez_stavki(v: &Value) -> bool {
    !truthy(v) || js::length(v) == Some(0)
}

/// Provjerene stavke ponude (iznosi, stopa, artikal) svedene na polja ugovora.
fn provjerene_stavke(db: &Db, stavke: &Value) -> R<Vec<Value>> {
    Ok(provjera_racuna::provjeri_stavke(db, stavke)?.into_iter().map(|s| s.stavka).collect())
}

/// Upiše ponudu sa stavkama. Cijene stavki se zamrzavaju kopiranjem u
/// `ponuda_stavke` — kasnija promjena cjenovnika ne smije mijenjati ponudu,
/// jer je ponuda obećanje kupcu. Poziva se unutar transakcije.
pub fn create_ponuda(db: &Db, data: &Value, danas: &str) -> R<Value> {
    if bez_stavki(&data["stavke"]) {
        baci!("Ponuda mora imati najmanje jednu stavku");
    }
    if !truthy(&data["kupacId"]) {
        baci!("Kupac je obavezan");
    }
    let stavke = &provjerene_stavke(db, &data["stavke"])?;

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
    // Račun po ponudi koji čeka konvertuje ponudu kad se riješi.
    baci_ako_ceka_nezavrsen(db, "ponudaId", id, "Račun po ovoj ponudi", "prije promjene statusa ponude")?;
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
    baci_ako_ceka_nezavrsen(db, "ponudaId", id, "Račun po ovoj ponudi", "prije brisanja ponude")?;
    if ponuda["status"] == "konvertovana" {
        baci!("Konvertovana ponuda se ne može obrisati — po njoj je izdat račun");
    }
    if let Some(nalog) = db.get("SELECT broj, godina FROM radni_nalozi WHERE ponudaId = ? ORDER BY id LIMIT 1", p![id])? {
        baci!(
            "Ponuda je vezana za radni nalog br. {}/{} — prvo obrišite nalog",
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
    if bez_stavki(&data["stavke"]) {
        baci!("Ponuda mora imati najmanje jednu stavku");
    }

    let Some(ponuda) = db.get("SELECT id, status, kupacId, datum, vaziDo FROM ponude WHERE id = ?", p![id])? else {
        baci!("Ponuda ne postoji");
    };
    // Snapshot računa koji čeka nosi stare stavke — izmjena bi ih razdvojila od ponude.
    baci_ako_ceka_nezavrsen(db, "ponudaId", id, "Račun po ovoj ponudi", "prije izmjene ponude")?;
    if ponuda["status"] == "konvertovana" {
        baci!("Konvertovana ponuda se ne može mijenjati");
    }
    let stavke = &provjerene_stavke(db, &data["stavke"])?;

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

/// Upis računa po ponudi iz write-ahead snapshota: račun + razduženje skladišta,
/// ponuda → konvertovana, a nalog iz kojeg je račun izdat → fakturisan. Isti
/// upis ide nakon uspješne štampe i iz dijaloga nezavršenih računa (tada s
/// datumom s papira, kao ručni račun). Ponuda koja je u međuvremenu već
/// konvertovana i nalog koji više nije završen ostaju kakvi jesu — račun je na
/// papiru i mora postojati u bazi. U transakciji. TS: `upisiKonverzijuPonude`.
pub fn upisi_konverziju_ponude(db: &Db, snap: &Value, broj_fiskalnog_racuna: &Value, created_at: &Value, is_manual: i64) -> R<i64> {
    let order_id = upisi_racun(
        db,
        &json!({
            "korisnikId": snap["korisnikId"], "ukupno": snap["ukupno"], "pdvIznos": snap["pdvIznos"],
            "nacinPlacanja": snap["nacinPlacanja"], "brojFiskalnogRacuna": broj_fiskalnog_racuna,
            "kupac": snap["kupac"], "stavke": snap["stavke"], "createdAt": created_at, "isManual": is_manual,
        }),
    )?;
    db.run(
        "UPDATE ponude SET status = 'konvertovana', racunId = ? WHERE id = ? AND status <> 'konvertovana'",
        p![order_id, snap["ponudaId"]],
    )?;
    // Kao fakturisiNalog (proizvodnja.rs), bez bacanja: nalog vraćen u izradu ostaje.
    if !snap["nalogId"].is_null() {
        db.run(
            "UPDATE radni_nalozi SET status = 'fakturisan', racunId = ? WHERE id = ? AND status = 'zavrsen' AND vrsta = 'narudzba'",
            p![order_id, snap["nalogId"]],
        )?;
    }
    Ok(order_id)
}

/// Odštampa fiskalni račun po ponudi i tek nakon uspješne štampe upiše račun,
/// razduži skladište i zaključa ponudu — u jednoj transakciji. Račun ide po
/// cijenama zamrznutim na ponudi, ne po trenutnom cjenovniku. Istekla ponuda se
/// smije konvertovati — operater odlučuje da li dogovor još važi; odbijena ne smije.
///
/// Sve što bi upis u bazu moglo oboriti (korisnik, način plaćanja, artikli)
/// provjerava se PRIJE štampe — odštampan fiskalni račun se ne može povući.
/// Write-ahead kao order:finalize (pending_racun.rs): snapshot `vrsta:
/// 'ponuda'` prije štampe; nepoznat ishod ga ostavlja za dijalog nezavršenih.
///
/// `kanal` je samo oznaka za dnevnik štampe (ponuda:konvertuj / nalog:izdajRacun).
/// `nalog_id` (samo iz `izdaj_racun_za_nalog`, ne iz IPC payload-a): nalog iz
/// kojeg se račun izdaje — fakturiše se u istoj transakciji.
pub fn konvertuj_ponudu(b: &Backend, kanal: &str, data: &Value, nalog_id: Option<&Value>) -> R<Value> {
    let db = b.db();
    let id = &data["id"];

    let _u_toku = UToku::zauzmi(b, "ponuda", id, "Konverzija ove ponude je već u toku")?;

    let korisnik = if truthy(&data["korisnikId"]) {
        db.get("SELECT id FROM users WHERE id = ?", p![data["korisnikId"]])?
    } else {
        None
    };
    if korisnik.is_none() {
        baci!("Korisnik nije prijavljen");
    }

    let nacin_placanja = provjera_racuna::provjeri_nacin_placanja(&data["nacinPlacanja"])?;

    let Some(ponuda) = db.get("SELECT * FROM ponude WHERE id = ?", p![id])? else {
        baci!("Ponuda ne postoji");
    };
    if ponuda["status"] == "konvertovana" {
        baci!("Ponuda je već konvertovana u račun");
    }
    if ponuda["status"] == "odbijena" {
        baci!("Odbijena ponuda se ne može pretvoriti u račun — ako kupac ipak prihvata, prvo promijenite status");
    }
    baci_ako_ceka_nezavrsen(db, "ponudaId", &ponuda["id"], "Račun po ovoj ponudi", "prije nove štampe")?;

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

    let racun = build_tring_racun(&json!({
        "stavke": stavke,
        "ukupno": ponuda["ukupno"],
        "nacinPlacanja": nacin_placanja,
        "kupac": kupac_za_racun(&kupac),
    }));

    let mut snapshot = json!({
        "vrsta": "ponuda", "ponudaId": ponuda["id"], "ponudaBroj": ponuda["broj"], "ponudaGodina": ponuda["godina"],
        "korisnikId": data["korisnikId"], "ukupno": ponuda["ukupno"], "pdvIznos": ponuda["pdvIznos"],
        "nacinPlacanja": nacin_placanja, "kupac": snapshot_kupca(&kupac),
        "stavke": stavke.iter().map(|s| json!({
            "productId": s["productId"], "naziv": s["productNaziv"], "kolicina": s["kolicina"], "cijena": s["cijena"],
            "rabat": s["rabat"], "pdvStopa": s["pdvStopa"], "productTip": s["productTip"],
        })).collect::<Vec<_>>(),
    });
    if let Some(n) = nalog_id {
        snapshot["nalogId"] = n.clone();
    }
    let uredjaj = Uredjaj::iz_postavki(b)?;
    let pending_id = zapisi_pending(db, &data["korisnikId"], &snapshot)?;

    // Štampa u Rustu ne baca — greška veze stiže kao neuspješan odgovor.
    let result = uredjaj.fiskalni(kanal, &racun);

    // Siguran neuspjeh briše pending red; nepoznat ishod ga ostavlja.
    if !uspjeh(&result) {
        return stampa::neuspjeh(db, pending_id, &result);
    }

    let broj_fiskalnog_racuna = stampa::broj_sa_uredjaja(&result);

    let upis = db.tx(|| {
        // Red riješen iz dijaloga dok je štampa trajala → bez drugog zapisa.
        if !preuzmi_pending_red(db, pending_id)? {
            return Ok(None);
        }
        upisi_konverziju_ponude(db, &snapshot, &broj_fiskalnog_racuna, &Value::Null, 0).map(Some)
    });

    match upis {
        Ok(Some(racun_id)) => Ok(uspjesna_stampa(&json!(racun_id), &broj_fiskalnog_racuna, &result["odgovori"])),
        Ok(None) => Ok(vec_evidentiran(&broj_fiskalnog_racuna)),
        // Račun je već na papiru; pending red ostaje (rollback) za dijalog.
        Err(e) => Err(stampa::nije_zabiljezen(Odstampan::Racun(&broj_fiskalnog_racuna), &e)),
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
    let db = b.db();
    Some(match kanal {
        "ponuda:getAll" => get_all(db),
        "ponuda:get" => get(db, &a[0]),
        "ponuda:nextBroj" => {
            let godina = b.sat.godina();
            next_broj_ponude(db, &json!(godina)).map(|broj| json!({ "broj": broj, "godina": godina }))
        }
        "ponuda:create" => sesija::korisnik(b).and_then(|k| create(db, &sesija::sa_korisnikom(&a[0], k.id), &b.sat.danas())),
        "ponuda:update" => db.tx(|| update_ponuda(db, &a[0], &a[1])).map(|_| json!({ "success": true })),
        "ponuda:setStatus" => set_status_ponude(db, &a[0], &a[1]).map(|_| json!({ "success": true })),
        "ponuda:delete" => db.tx(|| delete_ponuda(db, &a[0])),
        // Orkestracija (štampa → atomični upis) je u `konvertuj_ponudu`, isto
        // kao što je u TS-u živjela u lib/ponuda.ts.
        "ponuda:konvertuj" => sesija::korisnik(b).and_then(|k| {
            let data = sesija::sa_korisnikom(&a[0], k.id);
            konvertuj_ponudu(b, kanal, &data, None)
        }),
        _ => return None,
    })
}
