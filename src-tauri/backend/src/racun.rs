//! Iznosi računa i jedini upis računa u `orders` (`lib/racun.ts`).

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, round2, to_number};
use crate::sql::Db;
use crate::zaliha::{self, Dokument, Smjer};
use crate::p;

/// Iznos stavke zaokružen na fene (uređaj zaokružuje po stavci).
pub fn iznos_stavke(s: &Value) -> f64 {
    round2(to_number(&s["cijena"]) * to_number(&s["kolicina"]) * (1.0 - to_number(&s["rabat"]) / 100.0))
}

/// PDV sadržan u iznosu stavke; stopa 'K' je oslobođena. Nezaokružen.
pub fn pdv_stavke(s: &Value) -> f64 {
    if s["pdvStopa"] != "E" {
        return 0.0;
    }
    let iznos = iznos_stavke(s);
    iznos - iznos / 1.17
}

/// `{ ukupno, pdvIznos }`
pub fn izracunaj_totale(stavke: &[Value]) -> (f64, f64) {
    let ukupno = round2(stavke.iter().fold(0.0, |sum, s| sum + iznos_stavke(s)));
    let pdv = round2(stavke.iter().fold(0.0, |sum, s| sum + pdv_stavke(s)));
    (ukupno, pdv)
}

/// Kupac kolona u `orders`: bez vrijednosti ili tekst prazan nakon
/// trim-a je NULL; ostalo se upisuje kako je uneseno.
fn kupac_kolona(kupac: &Value, polje: &str) -> Value {
    match &kupac[polje] {
        Value::String(s) if s.trim().is_empty() => Value::Null,
        v => v.clone(),
    }
}

/// Jedini upis računa u `orders` (+ order_items + izlaz skladišta), za sve
/// tokove: kasa, ručni račun, prilog, ponuda, nalog i dijalog nezavršenih
/// računa. Račun je već odštampan (ili se prepisuje s papira). `input` ima
/// oblik `UpisRacunaInput` iz TS-a: `korisnikId, ukupno, pdvIznos,
/// nacinPlacanja, brojFiskalnogRacuna, kupac?, stavke, isManual?, createdAt?`,
/// a faktura i još `prilogBroj?, prilogNaziv?, datumValute?, napomena?`.
/// Izlaz ide kroz knjigu zalihe (usluga ne razdužuje; tip artikla iz baze).
/// Poziva se u transakciji.
pub fn upisi_racun(db: &Db, input: &Value) -> R<i64> {
    let k = &input["kupac"];
    // Bez datuma: sada (zadani datum kolone), inače datum s papira.
    let created_at = input["createdAt"].as_str().filter(|s| !s.is_empty());
    let r = db.run(
        "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status,
      kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj, isManual, createdAt,
      prilogBroj, prilogNaziv, datumValute, napomena)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?)",
        p![
            input["korisnikId"], input["ukupno"], input["pdvIznos"], input["nacinPlacanja"], input["brojFiskalnogRacuna"],
            kupac_kolona(k, "naziv"), kupac_kolona(k, "idBroj"), kupac_kolona(k, "adresa"), kupac_kolona(k, "grad"),
            kupac_kolona(k, "postanskiBroj"), js::nn(&input["isManual"], &json!(0)), created_at,
            input["prilogBroj"], input["prilogNaziv"], input["datumValute"], input["napomena"]
        ],
    )?;
    let order_id = r.last_insert_rowid;
    let stavke = js::iter_ili_baci(&input["stavke"], "data.stavke")?;
    for s in stavke {
        db.run(
            "INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![order_id, s["productId"], s["kolicina"], s["cijena"], s["rabat"], s["pdvStopa"]],
        )?;
    }
    zaliha::knjizi(
        db,
        Dokument { vrsta: "order", id: &Value::from(order_id) },
        Smjer::Izlaz,
        stavke.iter().map(|s| (&s["productId"], &s["kolicina"])),
        &created_at.map_or(Value::Null, Value::from),
    )?;
    Ok(order_id)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::proba::proba;

    const KOLONE_KUPCA: &str = "kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj";

    /// Prazan kupac (null, nema ga, ili tekst prazan nakon trim-a)
    /// je NULL na svakom putu upisa računa; neprazan tekst ide kako je unesen.
    #[test]
    fn prazan_kupac_je_null_na_svim_putevima() {
        let p = proba("kupac");
        let a = p.artikal("A1", "artikal");
        let kupac = json!({ "naziv": " Firma ", "idBroj": "", "adresa": "  ", "grad": "", "postanskiBroj": "\t" });
        let ocekivano = json!([" Firma ", null, null, null, null]);
        let stavka = json!({ "productId": a, "kolicina": 1, "cijena": 5, "rabat": 0, "pdvStopa": "E" });
        let racun = json!({ "stavke": [stavka], "nacinPlacanja": "Gotovina", "kupac": kupac });
        let kupac_id = p.run(
            "INSERT INTO kupci (naziv, idBroj, adresa, grad, postanskiBroj) VALUES (?, ?, ?, ?, ?)",
            &[json!(" Firma "), json!(""), json!("  "), Value::Null, json!("\t")],
        );
        let ponuda = p.run(
            "INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, status, ukupno, pdvIznos)
             VALUES (1, 2026, ?, 1, '2026-03-01', '2026-03-31', 'prihvacena', 5, 0.73)",
            &[json!(kupac_id)],
        );
        p.run(
            "INSERT INTO ponuda_stavke (ponudaId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, 0, 'E')",
            &[json!(ponuda), json!(a)],
        );
        let nalog = |broj: i64| {
            p.run(
                "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, kupacId, opis, dogovorenaCijena, status, korisnikId)
                 VALUES (?, 2026, '2026-03-01', 'narudzba', ?, 'Po mjeri', 100, 'zavrsen', 1)",
                &[json!(broj), json!(kupac_id)],
            )
        };
        let nalog_stampa = nalog(1);
        let nalog_pending = nalog(2);
        p.call("fiscal:setZadnjiBroj", vec![json!(100)]).unwrap();

        let rijesi = |snapshot: Value, broj: &str| {
            let id = p.pending(snapshot);
            p.call("pending:resolve", vec![json!({ "id": id, "brojFiskalnogRacuna": broj, "createdAt": "2026-03-03 10:00:00" })])
        };
        let snap = |dodaci: Value| {
            let mut s = json!({
                "korisnikId": 1, "ukupno": 5, "pdvIznos": 0.73, "nacinPlacanja": "Gotovina", "kupac": kupac,
                "stavke": [{ "productId": a, "kolicina": 1, "cijena": 5, "rabat": 0, "pdvStopa": "E", "productTip": "artikal" }],
            });
            s.as_object_mut().unwrap().extend(dodaci.as_object().unwrap().clone());
            s
        };

        let putevi: Vec<(&str, Result<Value, String>)> = vec![
            ("order:finalize", p.call("order:finalize", vec![racun.clone()])),
            (
                "order:createManual",
                p.call(
                    "order:createManual",
                    vec![json!({ "stavke": [stavka], "nacinPlacanja": "Gotovina", "kupac": kupac,
                                 "brojFiskalnogRacuna": "500", "createdAt": "2026-03-02 09:00:00" })],
                ),
            ),
            ("order:finalizePrilog", p.call("order:finalizePrilog", vec![json!({ "iznos": 10, "nacinPlacanja": "Gotovina", "kupac": kupac })])),
            ("ponuda:konvertuj", p.call("ponuda:konvertuj", vec![json!({ "id": ponuda, "nacinPlacanja": "Gotovina" })])),
            ("nalog:izdajRacun", p.call("nalog:izdajRacun", vec![json!({ "id": nalog_stampa, "nacinPlacanja": "Gotovina" })])),
            ("pending:resolve (račun)", rijesi(snap(json!({})), "701")),
            ("pending:resolve (prilog)", rijesi(snap(json!({ "stavke": [], "prilogBroj": 9, "prilogNaziv": "Stavke po računu br. 9" })), "702")),
            ("pending:resolve (ponuda)", rijesi(snap(json!({ "vrsta": "ponuda", "ponudaId": 999 })), "703")),
            ("pending:resolve (nalog)", rijesi(snap(json!({ "vrsta": "nalog", "nalogId": nalog_pending })), "704")),
        ];
        for (put, r) in &putevi {
            assert!(r.is_ok(), "{put}: {r:?}");
        }

        let redovi = p.all(&format!("SELECT {KOLONE_KUPCA} FROM orders ORDER BY id"));
        assert_eq!(redovi.len(), putevi.len());
        let pogresni: Vec<String> = putevi
            .iter()
            .zip(&redovi)
            .map(|((put, _), red)| (put, json!(KOLONE_KUPCA.split(", ").map(|k| red[k].clone()).collect::<Vec<_>>())))
            .filter(|(_, kupac)| *kupac != ocekivano)
            .map(|(put, kupac)| format!("{put}: {kupac}"))
            .collect();
        assert!(pogresni.is_empty(), "očekivano {ocekivano}, a upisano:\n{}", pogresni.join("\n"));
    }

    /// Račun bez kupca (null ili bez ključa) ostaje bez kupca.
    #[test]
    fn racun_bez_kupca() {
        let p = proba("bez-kupca");
        let a = p.artikal("A1", "artikal");
        let stavka = json!({ "productId": a, "kolicina": 1, "cijena": 5, "rabat": 0, "pdvStopa": "E" });
        p.call("order:finalize", vec![json!({ "stavke": [stavka], "nacinPlacanja": "Gotovina" })]).unwrap();
        p.call("order:finalize", vec![json!({ "stavke": [stavka], "nacinPlacanja": "Gotovina", "kupac": null })]).unwrap();
        for red in p.all(&format!("SELECT {KOLONE_KUPCA} FROM orders")) {
            assert!(red.as_object().unwrap().values().all(Value::is_null), "{red}");
        }
    }
}
