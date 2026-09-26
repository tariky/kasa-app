//! Storno računa (`lib/refund.ts`): reklamacija na uređaju pa atomičan upis.

use regex::Regex;
use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, or, round2, to_number, truthy};
use crate::pending_racun::{baci_ako_ceka_nezavrsen, preuzmi_pending_red, vec_evidentiran_storno, zapisi_pending};
use crate::prilog::{prilog_naziv, PRILOG_SIFRA};
use crate::sql::Db;
use crate::stampa::{self, Odstampan, UToku, Uredjaj};
use crate::tring::{self, Odgovor};
use crate::zaliha::{self, Dokument, Smjer};
use crate::{baci, cash, fiskalni, p, tring_racun, Backend};

/// JS `Math.max(a, b)` / `Math.min(a, b)` — NaN se širi (Rustov `max` ga preskače).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}

// ─── lib/refund.ts ──────────────────────────────────────────

/// Storno vraća tačno ono što je račun skinuo: za svaki izlaz računa (prodaja
/// 'order' ili prilog 'prilog') ulaz 'refund' iste količine za isti artikal.
/// Današnji tip artikla se ne gleda — artikal je mogao postati usluga i
/// obrnuto nakon prodaje. `datum` = datum storna (null: sada).
/// TS: `vratiZalihuRacuna` u lib/refund.ts.
pub fn vrati_zalihu_racuna(db: &Db, order_id: &Value, datum: &Value) -> R<()> {
    let izlazi = db.all(
        "SELECT productId, kolicina FROM stock_movements WHERE tip = 'izlaz' AND referenceType IN ('order', 'prilog') AND referenceId = ? ORDER BY id",
        p![order_id],
    )?;
    zaliha::knjizi(
        db,
        Dokument { vrsta: "refund", id: order_id },
        Smjer::Ulaz,
        izlazi.iter().map(|i| (&i["productId"], &i["kolicina"])),
        datum,
    )
}

/// Označi račun storniranim, vrati zalihu i upiši broj reklamacije. `datum` je
/// datum storna s papira kad se storno upisuje iz dijaloga nezavršenih računa.
///
/// Poziva se unutar transakcije. Provjera statusa je ujedno i zaštita od
/// dvostrukog storna: drugi poziv za isti račun više ne nađe 'completed' red.
pub fn refund_order_in_transaction(db: &Db, id: &Value, broj_reklamacije: &Value, datum: &Value) -> R<()> {
    if !db.ima("SELECT id FROM orders WHERE id = ? AND status = 'completed'", p![id])? {
        baci!("Račun ne postoji ili je već storniran");
    }

    db.run(
        "UPDATE orders SET status = 'refunded', refundedAt = COALESCE(?, datetime('now','localtime')), brojReklamacije = COALESCE(?, brojReklamacije) WHERE id = ?",
        p![datum, broj_reklamacije, id],
    )?;

    vrati_zalihu_racuna(db, id, datum)
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

/// Odštampa reklamaciju i tek nakon uspješne štampe upiše storno u bazu, u
/// jednoj transakciji. Ranije su štampa, promjena statusa i upis broja bila tri
/// odvojena IPC poziva iz renderera, pa je pad ili dvoklik između njih ostavljao
/// odštampan fiskalni storno bez ikakvog traga u bazi.
///
/// Write-ahead kao order:finalize (pending_racun.rs): snapshot `vrsta:
/// 'storno'` prije unosa novca i štampe; nepoznat ishod ostavlja red (račun
/// ostaje 'completed' dok ga dijalog nezavršenih ne riješi).
/// `odobrio_admin_id` (admin koji je odobrio storno kasira PIN-om) ide u
/// snapshot — trag 'storno' se upisuje i kad se storno riješi iz dijaloga.
pub fn refund_and_print(b: &Backend, data: &Value, korisnik_id: i64, odobrio_admin_id: &Value) -> R<Value> {
    let db = b.db();
    let id = &data["id"];

    let _u_toku = UToku::zauzmi(b, "storno", id, "Storniranje ovog računa je već u toku")?;

    let Some(order) = db.get("SELECT * FROM orders WHERE id = ? AND status = 'completed'", p![id])? else {
        baci!("Račun ne postoji ili je već storniran");
    };
    baci_ako_ceka_nezavrsen(db, "orderId", &order["id"], "Storno ovog računa", "prije nove štampe")?;

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
    // Reklamacija koju uređaj ne bi primio (npr. PLU artikla van opsega) se
    // odbija prije ikakvog unosa novca — inače bi pokriće ostalo u brojaču
    // uređaja i u pologu bez storna.
    if let Err(poruka) = tring::provjeri_reklamaciju(&racun) {
        baci!("{poruka}");
    }

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

    let dozvoli_polog = truthy(&data["dozvoliPolog"]);
    // Gotovinski manjak je stvaran novac iz ladice — samo se on gura kroz
    // override i samo se on evidentira kao polog (poznat prije štampe → snapshot).
    let planirani_polog = if dozvoli_polog && manjak_ladica > 0.0 { manjak_ladica } else { 0.0 };

    let snapshot = json!({
        "vrsta": "storno", "orderId": order["id"], "brojRacuna": order["brojFiskalnogRacuna"],
        "korisnikId": korisnik_id, "ukupno": order["ukupno"],
        "odobrioAdminId": odobrio_admin_id, "pologIznos": js::f(planirani_polog),
        "stavke": stavke.as_array().into_iter().flatten().map(|s| {
            // `s.naziv ?? s.productNaziv ?? ''`
            let naziv = js::nn(&s["naziv"], js::nn(&s["productNaziv"], &json!(""))).clone();
            json!({ "naziv": naziv, "kolicina": s["kolicina"], "cijena": s["cijena"], "rabat": js::nn(&s["rabat"], &json!(0)) })
        }).collect::<Vec<_>>(),
    });
    let uredjaj = Uredjaj::iz_postavki(b)?;
    let pending_id = zapisi_pending(db, &json!(korisnik_id), &snapshot)?;

    let mut uneseno = 0.0;
    let mut polog_iznos = 0.0;

    let pokusaj = (|| -> R<Odgovor> {
        // Nenovčani dio pokrića ide automatski — nema odluke za operatera jer
        // nikakav stvaran novac ne mijenja vlasnika (virmanski račun se ovdje
        // pokriva u cijelosti, pa storno prolazi bez ijednog dodatnog klika).
        let samo_uredjaj = js_max(0.0, round2(manjak_uredjaj - manjak_ladica));
        if samo_uredjaj > 0.0 {
            cash::device_cash_in(b, samo_uredjaj)?;
            uneseno = samo_uredjaj;
        }

        if planirani_polog > 0.0 {
            let napomena = format!("Automatski polog za reklamaciju računa #{}", js::to_string(id));
            cash::deposit_cash(b, planirani_polog, &napomena, &json!(korisnik_id))?;
            polog_iznos = planirani_polog;
            uneseno = round2(uneseno + planirani_polog);
        }

        let mut result = uredjaj.reklamacija("refundAndPrint", &racun);

        // Stanje ladice je samo procjena brojača u uređaju (pologi se mogu voditi
        // i mimo aplikacije), pa ako uređaj i dalje javlja manjak — dopuni do
        // punog iznosa računa i pokušaj još jednom. Storno taj iznos odmah
        // potroši, tako da brojač uređaja ne ostane napuhan. Bez pitanja kad
        // gotovinski manjak ne postoji; inače tek uz override. Nikad nakon
        // nepoznatog ishoda — storno je možda već odštampan.
        if (manjak_ladica == 0.0 || dozvoli_polog)
            && !tring::uspjeh(&result)
            && !tring::ishod_nepoznat(&result)
            && je_nedovoljno_sredstava(&result)
        {
            let dopuna = round2(potrebno_uredjaj - uneseno);
            if dopuna > 0.0 {
                cash::device_cash_in(b, dopuna)?;
                uneseno = round2(uneseno + dopuna);
                result = uredjaj.reklamacija("refundAndPrint", &racun);
            }
        }
        Ok(result)
    })();
    let result = match pokusaj {
        Ok(r) => r,
        Err(e) => {
            // Unos novca nije prihvaćen — storno nije odštampan.
            db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
            return Err(e);
        }
    };

    if !tring::uspjeh(&result) {
        // Siguran neuspjeh briše pending red; nepoznat ishod ga ostavlja (bez
        // ponude pologa — storno se ne smije slati ponovo dok se ne riješi).
        let mut neuspjeh = stampa::neuspjeh(db, pending_id, &result)?;
        if truthy(&neuspjeh["ishodNepoznat"]) {
            return Ok(neuspjeh);
        }
        // Override se nudi samo ako može pomoći: kad fali stvarna gotovina, ili
        // kad uređaj i dalje traži novac a nismo ga dopunili do punog iznosa.
        let nedovoljno = !dozvoli_polog
            && (manjak_ladica > 0.0 || (je_nedovoljno_sredstava(&result) && uneseno < potrebno_uredjaj));
        let manjak = if manjak_ladica > 0.0 { manjak_ladica } else { round2(potrebno_uredjaj - uneseno) };
        neuspjeh["nedovoljnoSredstava"] = json!(nedovoljno);
        neuspjeh["manjak"] = js::f(manjak);
        return Ok(neuspjeh);
    }

    let unesen_broj = data["brojReklamacije"].as_str().map(str::trim).unwrap_or("");
    let broj_reklamacije = if !unesen_broj.is_empty() { json!(unesen_broj) } else { stampa::broj_sa_uredjaja(&result) };

    let upis = db.tx(|| {
        // Red riješen iz dijaloga dok je štampa trajala → bez drugog storna.
        if !preuzmi_pending_red(db, pending_id)? {
            return Ok(false);
        }
        refund_order_in_transaction(db, id, &broj_reklamacije, &Value::Null)?;
        Ok(true)
    });
    match upis {
        Ok(true) => {}
        Ok(false) => return Ok(vec_evidentiran_storno(&broj_reklamacije)),
        // Storno je već na papiru; pending red ostaje (rollback) za dijalog.
        Err(e) => return Err(stampa::nije_zabiljezen(Odstampan::Reklamacija(&broj_reklamacije), &e)),
    }

    Ok(json!({
        "success": true,
        "brojReklamacije": broj_reklamacije,
        "odgovori": result["odgovori"],
        "pologIznos": js::f(polog_iznos),
    }))
}
