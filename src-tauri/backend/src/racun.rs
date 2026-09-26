//! Iznosi računa i jedini upis računa u `orders` (`lib/racun.ts`).

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, round2, to_number};
use crate::sql::Db;
use crate::{baci, p};

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

/// `for (const s of stavke)` — ono što nije niz u JS-u baca TypeError.
pub(crate) fn niz<'a>(v: &'a Value, ime: &str) -> R<&'a Vec<Value>> {
    match v.as_array() {
        Some(a) => Ok(a),
        None => baci!("{ime} is not iterable"),
    }
}

/// Kupac kolona u `orders` (odluka 3): bez vrijednosti ili tekst prazan nakon
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
/// Usluga (tip artikla iz baze) ne razdužuje skladište. Poziva se u transakciji.
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
    for s in niz(&input["stavke"], "data.stavke")? {
        db.run(
            "INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, ?, ?, ?, ?)",
            p![order_id, s["productId"], s["kolicina"], s["cijena"], s["rabat"], s["pdvStopa"]],
        )?;
        let artikal = db.get("SELECT tip FROM products WHERE id = ?", p![s["productId"]])?;
        if artikal.is_none_or(|a| a["tip"] != "usluga") {
            db.run(
                "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'izlaz', ?, 'order', ?, COALESCE(?, datetime('now','localtime')))",
                p![s["productId"], s["kolicina"], order_id, created_at],
            )?;
        }
    }
    Ok(order_id)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
    use std::sync::Arc;

    use serde_json::{json, Value};

    use crate::sat::Sat;
    use crate::{Backend, Platforma};

    struct BezDijaloga;
    impl Platforma for BezDijaloga {
        fn dijalog_sacuvaj(&self, _: Value) -> Option<String> { None }
        fn dijalog_otvori(&self, _: Value) -> Option<String> { None }
        fn dijalog_potvrda(&self, _: Value) -> i64 { 0 }
        fn restartuj_za(&self, _: u64) {}
    }

    /// Lažni fiskalni uređaj: svaki zahtjev dobije OK s BF brojem od 101 naviše.
    /// Vraća port i brojač primljenih zahtjeva.
    fn lazi_tring() -> (u16, Arc<AtomicUsize>) {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let zahtjevi = Arc::new(AtomicUsize::new(0));
        let brojac = zahtjevi.clone();
        std::thread::spawn(move || {
            let mut bf = 100;
            for veza in server.incoming() {
                let Ok(mut veza) = veza else { continue };
                // Zaglavlja pa tijelo (Content-Length) — odgovor tek kad stigne cijeli zahtjev.
                let mut procitano = Vec::new();
                let mut dio = [0u8; 4096];
                loop {
                    let n = veza.read(&mut dio).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    procitano.extend_from_slice(&dio[..n]);
                    let Some(kraj) = procitano.windows(4).position(|w| w == b"\r\n\r\n") else { continue };
                    let zaglavlja = String::from_utf8_lossy(&procitano[..kraj]).to_lowercase();
                    let duzina = zaglavlja
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if procitano.len() >= kraj + 4 + duzina {
                        break;
                    }
                }
                brojac.fetch_add(1, Ordering::SeqCst);
                bf += 1;
                let xml = format!(
                    "<RacunOdgovor><VrstaOdgovora>OK</VrstaOdgovora><Odgovor><Naziv>BrojFiskalnogRacuna</Naziv><Vrijednost>{bf}</Vrijednost></Odgovor></RacunOdgovor>"
                );
                let _ = write!(
                    veza,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{xml}",
                    xml.len()
                );
            }
        });
        (port, zahtjevi)
    }

    /// Backend nad novom bazom u privremenom folderu: prijavljen zadani admin
    /// (id 1), Tring na lažnom uređaju. Folder se briše na kraju testa.
    pub(crate) struct Proba {
        pub b: Option<Backend>,
        dir: PathBuf,
        zahtjevi: Arc<AtomicUsize>,
    }

    impl Proba {
        /// Koliko je zahtjeva stiglo lažnom uređaju.
        pub fn zahtjevi(&self) -> usize {
            self.zahtjevi.load(Ordering::SeqCst)
        }

        pub fn b(&self) -> &Backend {
            self.b.as_ref().unwrap()
        }

        pub fn run(&self, sql: &str, params: &[Value]) -> i64 {
            self.b().db().unwrap().run(sql, params).unwrap().last_insert_rowid
        }

        pub fn all(&self, sql: &str) -> Vec<Value> {
            self.b().db().unwrap().all(sql, &[]).unwrap()
        }

        pub fn call(&self, kanal: &str, args: Vec<Value>) -> Result<Value, String> {
            self.b().call(kanal, args)
        }

        pub fn artikal(&self, sifra: &str, tip: &str) -> i64 {
            self.run(
                "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', 5, 'E', 1, ?)",
                &[json!(sifra), json!(format!("Artikal {sifra}")), json!(tip)],
            )
        }

        /// Write-ahead red kakav ostavi nepoznat ishod štampe.
        pub fn pending(&self, snapshot: Value) -> i64 {
            self.run("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (1, ?)", &[json!(snapshot.to_string())])
        }
    }

    impl Drop for Proba {
        fn drop(&mut self) {
            drop(self.b.take());
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    pub(crate) fn proba(ime: &str) -> Proba {
        static BROJ: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "kasa-{ime}-test-{}-{}",
            std::process::id(),
            BROJ.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let b = Backend::novi(&dir, Box::new(BezDijaloga), Sat::sistemski(), false).unwrap();
        let db = b.db().unwrap();
        db.run("UPDATE settings SET value = '127.0.0.1' WHERE key = 'tring.host'", &[]).unwrap();
        let (port, zahtjevi) = lazi_tring();
        db.run("UPDATE settings SET value = ? WHERE key = 'tring.port'", &[json!(port.to_string())]).unwrap();
        b.sesija.postavi(Some(1), false);
        Proba { b: Some(b), dir, zahtjevi }
    }

    const KOLONE_KUPCA: &str = "kupacNaziv, kupacIdBroj, kupacAdresa, kupacGrad, kupacPostanskiBroj";

    /// Odluka 3: prazan kupac (null, nema ga, ili tekst prazan nakon trim-a)
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
