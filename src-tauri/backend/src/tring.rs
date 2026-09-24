//! Klijent za Tring.Fiscal.Server (`services/tring.ts`): XML preko HTTP POST-a.
//! Stanje (konfiguracija, brojač zahtjeva, dnevnik) živi u instanci, ne u
//! globalnim varijablama.

use std::cell::{Cell, RefCell};
use std::io::ErrorKind;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::js::{self, to_string};
use crate::sat::Sat;

const DEFAULT_HOST: &str = "localhost";
const DEFAULT_PORT: i64 = 8085;
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LOG_ENTRIES: usize = 200;

const XML_DECL: &str = r#"<?xml version="1.0" encoding="utf-8"?>"#;
const XMLNS: &str = r#"xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema""#;

const UNOS_NOVCA_PATHS: [&str; 2] = ["/unosnovca", "/un"];
const POVRAT_NOVCA_PATHS: [&str; 2] = ["/povratnovca", "/pn"];

pub struct Tring {
    host: RefCell<String>,
    port: Cell<i64>,
    request_counter: Cell<i64>,
    log_id_counter: Cell<i64>,
    logs: RefCell<Vec<Value>>,
    logging: Cell<bool>,
    sat: Sat,
}

/// Odgovor uređaja kao JSON objekat (`TringResponse`).
pub type Odgovor = Value;

pub fn uspjeh(o: &Odgovor) -> bool {
    o["success"].as_bool().unwrap_or(false)
}

impl Tring {
    pub fn novi(sat: Sat) -> Self {
        Tring {
            host: RefCell::new(DEFAULT_HOST.into()),
            port: Cell::new(DEFAULT_PORT),
            request_counter: Cell::new(0),
            log_id_counter: Cell::new(0),
            logs: RefCell::new(Vec::new()),
            logging: Cell::new(false),
            sat,
        }
    }

    /// `configure({host, port})` — port `null` (NaN iz parseInt) pada na zadani.
    pub fn configure(&self, host: &str, port: Option<i64>) {
        *self.host.borrow_mut() = host.to_string();
        self.port.set(port.unwrap_or(DEFAULT_PORT));
    }

    pub fn set_logging_enabled(&self, on: bool) {
        self.logging.set(on);
    }

    pub fn is_logging_enabled(&self) -> bool {
        self.logging.get()
    }

    pub fn get_logs(&self) -> Value {
        Value::Array(self.logs.borrow().clone())
    }

    pub fn clear_logs(&self) {
        self.logs.borrow_mut().clear();
    }

    fn next_request_number(&self) -> i64 {
        let n = self.request_counter.get() + 1;
        self.request_counter.set(n);
        n
    }

    fn add_log(&self, path: &str, request_xml: &str, response_xml: &str, status: Value, parsed: &Value, trajanje: Duration) {
        if !self.logging.get() {
            return;
        }
        let id = self.log_id_counter.get() + 1;
        self.log_id_counter.set(id);
        let mut logs = self.logs.borrow_mut();
        logs.push(json!({
            "id": id,
            "timestamp": self.sat.iso(),
            "method": "POST",
            "path": path,
            "requestXml": request_xml,
            "responseXml": response_xml,
            "statusCode": status,
            "parsed": parsed,
            "durationMs": trajanje.as_millis() as i64,
        }));
        if logs.len() > MAX_LOG_ENTRIES {
            let visak = logs.len() - MAX_LOG_ENTRIES;
            logs.drain(0..visak);
        }
    }

    fn post_xml(&self, url_path: &str, body: &str) -> Odgovor {
        let host = self.host.borrow().clone();
        let port = self.port.get();
        let start = Instant::now();
        let url = format!("http://{}:{}{}", url_host(&host), port, url_path);

        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .http_status_as_error(false)
            .build()
            .into();

        let odgovor = agent
            .post(&url)
            .header("Content-Type", "text/xml")
            .send(body)
            .and_then(|mut res| {
                let status = res.status().as_u16() as i64;
                let xml = res.body_mut().read_to_string()?;
                Ok((status, xml))
            });

        match odgovor {
            Ok((status, xml)) => {
                let mut parsed = parse_response(&xml);
                parsed.as_object_mut().unwrap().insert("statusCode".into(), Value::from(status));
                self.add_log(url_path, body, &xml, Value::from(status), &parsed, start.elapsed());
                parsed
            }
            Err(e) => {
                let poruka = poruka_greske(&e, &host, port);
                let result = json!({
                    "success": false,
                    "vrstaOdgovora": "Greska",
                    "odgovori": {},
                    "error": poruka,
                    "statusCode": null,
                });
                self.add_log(url_path, body, "", Value::Null, &result, start.elapsed());
                result
            }
        }
    }

    /// Puni naziv komande je dokumentovan, kratki nije — 404 znači "probaj drugi".
    fn post_xml_fallback(&self, paths: &[&str], body: &str) -> Odgovor {
        let mut last = Value::Null;
        for p in paths {
            let r = self.post_xml(p, body);
            if uspjeh(&r) || r["statusCode"] != json!(404) {
                return r;
            }
            last = r;
        }
        last
    }

    // POST /inicijalizacija
    pub fn inicijalizacija(&self, operator_id: &Value, password: &Value) -> Odgovor {
        let body = format!(
            "{XML_DECL}<Operator {XMLNS}><BrojOperatora>{}</BrojOperatora><Lozinka>{}</Lozinka></Operator>",
            to_string(operator_id),
            to_string(password)
        );
        self.post_xml("/inicijalizacija", &body)
    }

    // POST /ua - VrstaZahtjeva=105
    pub fn upisi_artikal(&self, artikal: &Value) -> Odgovor {
        let n = self.next_request_number();
        let body = format!(
            "{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>105</VrstaZahtjeva><NoviObjekat>{}</NoviObjekat></RacunZahtjev>",
            artikal_to_xml(artikal)
        );
        self.post_xml("/ua", &body)
    }

    // POST /sfr - VrstaZahtjeva=0
    pub fn stampati_fiskalni_racun(&self, racun: &Value) -> Odgovor {
        let n = self.next_request_number();
        let placanja = racun["vrstePlacanja"].as_array().cloned().unwrap_or_default();
        let body = format!(
            "{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>0</VrstaZahtjeva><NoviObjekat>{}<StavkeRacuna>{}</StavkeRacuna><VrstePlacanja>{}</VrstePlacanja><Napomena>{}</Napomena><BrojRacuna>{}</BrojRacuna></NoviObjekat></RacunZahtjev>",
            kupac_xml(&racun["kupac"]),
            stavke_xml(&racun["stavke"]),
            placanja_xml(&placanja),
            napomena_xml(&racun["napomena"]),
            to_string(js::nn(&racun["brojRacuna"], &json!(0))),
        );
        self.post_xml("/sfr", &body)
    }

    // POST /srr - VrstaZahtjeva=2
    pub fn stampati_reklamirani_racun(&self, racun: &Value) -> Odgovor {
        let n = self.next_request_number();
        // Reklamacija mora nositi tačno jednu vrstu plaćanja — gotovinski povrat
        // se šalje kao Gotovina/0 (vidi services/tring.ts).
        let mut placanja = racun["vrstePlacanja"].as_array().cloned().unwrap_or_default();
        if placanja.is_empty() {
            placanja = vec![json!({"oznaka": "Gotovina", "iznos": 0})];
        }
        let body = format!(
            "{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>2</VrstaZahtjeva><NoviObjekat>{}<StavkeRacuna>{}</StavkeRacuna><VrstePlacanja>{}</VrstePlacanja><Napomena>{}</Napomena><BrojRacuna>{}</BrojRacuna></NoviObjekat></RacunZahtjev>",
            kupac_xml(&racun["kupac"]),
            stavke_xml(&racun["stavke"]),
            placanja_xml(&placanja),
            napomena_xml(&racun["napomena"]),
            to_string(&racun["brojRacuna"]),
        );
        self.post_xml("/srr", &body)
    }

    // POST /sps - VrstaZahtjeva=3 (X-report)
    pub fn stampati_presjek_stanja(&self) -> Odgovor {
        let n = self.next_request_number();
        let body = format!("{XML_DECL}<Zahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>3</VrstaZahtjeva><Parametri /></Zahtjev>");
        self.post_xml("/sps", &body)
    }

    // POST /sdi - VrstaZahtjeva=4 (Z-report)
    pub fn stampati_dnevni_izvjestaj(&self) -> Odgovor {
        let n = self.next_request_number();
        let body = format!("{XML_DECL}<Zahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>4</VrstaZahtjeva><Parametri /></Zahtjev>");
        self.post_xml("/sdi", &body)
    }

    /// Službeni unos gotovine u kasu (polog), uvijek Gotovina.
    pub fn unos_novca(&self, iznos: f64) -> Odgovor {
        let body = novac_xml(self.next_request_number(), 7, iznos, "Gotovina");
        self.post_xml_fallback(&UNOS_NOVCA_PATHS, &body)
    }

    /// Službeni iznos gotovine iz kase.
    pub fn povrat_novca(&self, iznos: f64) -> Odgovor {
        let body = novac_xml(self.next_request_number(), 8, iznos, "Gotovina");
        self.post_xml_fallback(&POVRAT_NOVCA_PATHS, &body)
    }

    // POST /spi - VrstaZahtjeva=5
    pub fn stampati_periodicni_izvjestaj(&self, od: &Value, do_: &Value) -> Odgovor {
        let n = self.next_request_number();
        let fmt = |d: &Value, vrijeme: &str| {
            let s = to_string(d);
            let dijelovi: Vec<&str> = s.split('-').collect();
            let dio = |i: usize| dijelovi.get(i).copied().unwrap_or("");
            let broj = |x: &str| js::parse_int(x).map(|n| n.to_string()).unwrap_or_else(|| "NaN".into());
            let godina = dijelovi.get(0).map(|x| x.to_string()).unwrap_or_default();
            format!("{}.{}.{} {}", broj(dio(2)), broj(dio(1)), godina, vrijeme)
        };
        let body = format!(
            "{XML_DECL}<Zahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>5</VrstaZahtjeva><Parametri><Parametar><Naziv>odDatuma</Naziv><Vrijednost>{}</Vrijednost></Parametar><Parametar><Naziv>doDatuma</Naziv><Vrijednost>{}</Vrijednost></Parametar></Parametri></Zahtjev>",
            fmt(od, "00:00:00"),
            fmt(do_, "23:59:59"),
        );
        self.post_xml("/spi", &body)
    }
}

/// IPv6 adresa u URL-u mora biti u uglastim zagradama.
fn url_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') { format!("[{host}]") } else { host.to_string() }
}

/// Poruke kao Node `http` (`err.message`), da ih ekran prikaže isto.
fn poruka_greske(e: &ureq::Error, host: &str, port: i64) -> String {
    match e {
        ureq::Error::Timeout(_) => "Request timed out".into(),
        ureq::Error::Io(io) => match io.kind() {
            ErrorKind::ConnectionRefused => {
                let ip = if host == "localhost" { "127.0.0.1" } else { host };
                format!("connect ECONNREFUSED {ip}:{port}")
            }
            ErrorKind::TimedOut => "Request timed out".into(),
            ErrorKind::ConnectionReset => "socket hang up".into(),
            _ => io.to_string(),
        },
        ureq::Error::HostNotFound => format!("getaddrinfo ENOTFOUND {host}"),
        other => other.to_string(),
    }
}

/// Kodovi grešaka Tring.Fiscal.Server-a na koje aplikacija zna reagovati.
fn tfs_greska(broj: &str) -> Option<&'static str> {
    Some(match broj {
        "516" => "Prekoračenje broja stavki računa ili reklamacije",
        "517" => "Prekoračenje u iznosu reklamacije",
        "518" => "Ne postoji artikal za reklamaciju",
        "521" => "Prekoračenje iznosa plaćanja",
        "522" => "Pogrešna vrsta plaćanja ili nedozvoljen režim",
        "523" => "Plaćanje karticom ili čekom veće od iznosa računa",
        "524" => "Ukupna suma plaćanja veća od sume računa",
        "535" => "Nedovoljno novca u kasi",
        "573" => "Reklamacija zahtijeva jednu vrstu plaćanja s iznosom 0",
        _ => return None,
    })
}

pub fn parse_response(xml: &str) -> Value {
    thread_local! {
        static VRSTA: Regex = Regex::new(r"<VrstaOdgovora>(.*?)</VrstaOdgovora>").unwrap();
        static ODGOVOR: Regex = Regex::new(r"<Odgovor>\s*<Naziv>(.*?)</Naziv>\s*(?:<Vrijednost[^>]*/>\s*|<Vrijednost[^>]*>(.*?)</Vrijednost>\s*)</Odgovor>").unwrap();
        static BROJ: Regex = Regex::new(r"<Broj>(\d+)</Broj>").unwrap();
        static OPIS: Regex = Regex::new(r"(?s)<Opis>(.*?)</Opis>").unwrap();
    }
    let vrsta = VRSTA.with(|r| r.captures(xml).map(|c| c[1].to_string())).unwrap_or_else(|| "Greska".into());
    let mut odgovori = Map::new();
    ODGOVOR.with(|r| {
        for c in r.captures_iter(xml) {
            odgovori.insert(c[1].to_string(), Value::String(c.get(2).map(|m| m.as_str()).unwrap_or("").to_string()));
        }
    });
    let broj = BROJ.with(|r| r.captures(xml).map(|c| c[1].to_string()));
    let opis = OPIS.with(|r| r.captures(xml).map(|c| c[1].trim().to_string()));

    let mut out = Map::new();
    out.insert("success".into(), Value::Bool(vrsta == "OK"));
    out.insert("vrstaOdgovora".into(), Value::String(vrsta));
    out.insert("odgovori".into(), Value::Object(odgovori));
    if let Some(broj) = broj {
        let poznata = tfs_greska(&broj);
        let opis = opis.filter(|o| !o.is_empty());
        let mut dijelovi: Vec<String> = Vec::new();
        if let Some(prvi) = poznata.map(str::to_string).or_else(|| opis.clone()) {
            dijelovi.push(prvi);
        }
        if let (Some(o), Some(p)) = (&opis, poznata) {
            if o != p {
                dijelovi.push(format!("({o})"));
            }
        }
        dijelovi.push(format!("[{broj}]"));
        out.insert("error".into(), Value::String(dijelovi.join(" ")));
    }
    Value::Object(out)
}

/// Uređaj prima samo Gotovina|Cek|Kartica|Virman; nepoznato pada na Gotovinu.
pub fn normalize_oznaka(oznaka: &str) -> &'static str {
    match oznaka.trim().to_lowercase().as_str() {
        "gotovina" => "Gotovina",
        "kartica" => "Kartica",
        "virman" => "Virman",
        "ček" | "cek" | "ĉek" => "Cek",
        _ => "Gotovina",
    }
}

pub fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn esc(v: &Value) -> String {
    escape_xml(&to_string(v))
}

fn artikal_to_xml(a: &Value) -> String {
    format!(
        "<Sifra>{}</Sifra><Naziv>{}</Naziv><JM>{}</JM><Cijena>{}</Cijena><Stopa>{}</Stopa><Grupa>{}</Grupa><PLU>{}</PLU>",
        esc(&a["sifra"]),
        esc(&a["naziv"]),
        esc(&a["jm"]),
        to_string(&a["cijena"]),
        to_string(&a["stopa"]),
        to_string(js::nn(&a["grupa"], &json!(0))),
        to_string(js::nn(&a["plu"], &json!(0))),
    )
}

fn kupac_xml(k: &Value) -> String {
    if !js::truthy(k) {
        return String::new();
    }
    format!(
        "<Kupac><IDbroj>{}</IDbroj><Naziv>{}</Naziv><Adresa>{}</Adresa><PostanskiBroj>{}</PostanskiBroj><Grad>{}</Grad></Kupac>",
        esc(&k["idBroj"]),
        esc(&k["naziv"]),
        esc(&k["adresa"]),
        esc(&k["postanskiBroj"]),
        esc(&k["grad"]),
    )
}

fn stavke_xml(stavke: &Value) -> String {
    stavke
        .as_array()
        .map(|a| {
            a.iter()
                .map(|s| {
                    format!(
                        "<RacunStavka><artikal>{}</artikal><Kolicina>{}</Kolicina><Rabat>{}</Rabat></RacunStavka>",
                        artikal_to_xml(&s["artikal"]),
                        to_string(&s["kolicina"]),
                        to_string(&s["rabat"]),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn placanja_xml(placanja: &[Value]) -> String {
    placanja
        .iter()
        .map(|v| {
            format!(
                "<VrstaPlacanja><Oznaka>{}</Oznaka><Iznos>{}</Iznos></VrstaPlacanja>",
                normalize_oznaka(&to_string(&v["oznaka"])),
                to_string(&v["iznos"]),
            )
        })
        .collect()
}

fn napomena_xml(n: &Value) -> String {
    if js::truthy(n) { esc(n) } else { String::new() }
}

fn novac_xml(broj_zahtjeva: i64, vrsta_zahtjeva: i64, iznos: f64, oznaka: &str) -> String {
    let iznos = js::round2(iznos);
    format!(
        "{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{broj_zahtjeva}</BrojZahtjeva><VrstaZahtjeva>{vrsta_zahtjeva}</VrstaZahtjeva><NoviObjekat><Oznaka>{oznaka}</Oznaka><Iznos>{}</Iznos></NoviObjekat></RacunZahtjev>",
        js::num_str(iznos)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greska_uredjaja() {
        let r = parse_response("<RacunOdgovor><VrstaOdgovora>Greska</VrstaOdgovora><Greska><Broj>535</Broj><Opis>Nema para</Opis></Greska></RacunOdgovor>");
        assert_eq!(r["error"], "Nedovoljno novca u kasi (Nema para) [535]");
        let r = parse_response("<RacunOdgovor><VrstaOdgovora>OK</VrstaOdgovora><Odgovor><Naziv>BrojFiskalnogRacuna</Naziv><Vrijednost xsi:type=\"x\">101</Vrijednost></Odgovor><Odgovor><Naziv>Prazno</Naziv><Vrijednost /></Odgovor></RacunOdgovor>");
        assert_eq!(r, json!({"success": true, "vrstaOdgovora": "OK", "odgovori": {"BrojFiskalnogRacuna": "101", "Prazno": ""}}));
    }
}
