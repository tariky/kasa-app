//! Klijent za Tring.Fiscal.Server (`services/tring.ts`): XML preko HTTP POST-a.
//! Stanje (konfiguracija, brojač zahtjeva, dnevnik) živi u instanci, ne u
//! globalnim varijablama.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::io::ErrorKind;
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{json, Map, Value};

use crate::js::{self, to_string};
use crate::petlja::Petlja;
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
    host: Mutex<String>,
    port: AtomicI64,
    request_counter: AtomicI64,
    log_id_counter: AtomicI64,
    logs: Mutex<Vec<Value>>,
    logging: AtomicBool,
    sat: Sat,
    /// Dok se čeka uređaj, drugi pozivi rade (`await` u Electronu).
    petlja: Arc<Petlja>,
}

/// Odgovor uređaja kao JSON objekat (`TringResponse`).
pub type Odgovor = Value;

pub fn uspjeh(o: &Odgovor) -> bool {
    o["success"].as_bool().unwrap_or(false)
}

impl Tring {
    pub fn novi(sat: Sat, petlja: Arc<Petlja>) -> Self {
        Tring {
            host: Mutex::new(DEFAULT_HOST.into()),
            port: AtomicI64::new(DEFAULT_PORT),
            request_counter: AtomicI64::new(0),
            log_id_counter: AtomicI64::new(0),
            logs: Mutex::new(Vec::new()),
            logging: AtomicBool::new(false),
            sat,
            petlja,
        }
    }

    fn logs(&self) -> std::sync::MutexGuard<'_, Vec<Value>> {
        self.logs.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `configure({host, port})` — port `null` (NaN iz parseInt) pada na zadani.
    pub fn configure(&self, host: &str, port: Option<i64>) {
        *self.host.lock().unwrap_or_else(|e| e.into_inner()) = host.to_string();
        self.port.store(port.unwrap_or(DEFAULT_PORT), Ordering::SeqCst);
    }

    pub fn set_logging_enabled(&self, on: bool) {
        self.logging.store(on, Ordering::SeqCst);
    }

    pub fn is_logging_enabled(&self) -> bool {
        self.logging.load(Ordering::SeqCst)
    }

    pub fn get_logs(&self) -> Value {
        Value::Array(self.logs().clone())
    }

    pub fn clear_logs(&self) {
        self.logs().clear();
    }

    fn next_request_number(&self) -> i64 {
        self.request_counter.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn add_log(&self, path: &str, request_xml: &str, response_xml: &str, status: Value, parsed: &Value, trajanje: Duration) {
        if !self.logging.load(Ordering::SeqCst) {
            return;
        }
        let id = self.log_id_counter.fetch_add(1, Ordering::SeqCst) + 1;
        let mut logs = self.logs();
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
        let host = self.host.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let port = self.port.load(Ordering::SeqCst);
        let start = Instant::now();
        let url = format!("http://{}:{}{}", url_host(&host), port, url_path);

        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .http_status_as_error(false)
            // Node `http` ne gleda HTTP(S)_PROXY; uređaj je na localhostu/LAN-u.
            .proxy(None)
            .build()
            .into();

        let odmor = self.petlja.odmor();
        let odgovor = agent
            .post(&url)
            .header("Content-Type", "text/xml")
            .send(body)
            .and_then(|mut res| {
                let status = res.status().as_u16() as i64;
                let xml = res.body_mut().read_to_string()?;
                Ok((status, xml))
            });
        drop(odmor);

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
        self.post_xml("/inicijalizacija", &operator_xml(operator_id, password))
    }

    // POST /ua - VrstaZahtjeva=105
    pub fn upisi_artikal(&self, artikal: &Value) -> Odgovor {
        match artikal_to_xml(artikal) {
            Ok(objekat) => self.post_xml("/ua", &racun_zahtjev(self.next_request_number(), 105, &objekat)),
            Err(e) => odbijeno(&e),
        }
    }

    // POST /sfr - VrstaZahtjeva=0
    pub fn stampati_fiskalni_racun(&self, racun: &Value) -> Odgovor {
        match fiskalni_racun_objekat(racun) {
            Ok(objekat) => self.post_xml("/sfr", &racun_zahtjev(self.next_request_number(), 0, &objekat)),
            Err(e) => odbijeno(&e),
        }
    }

    // POST /srr - VrstaZahtjeva=2
    pub fn stampati_reklamirani_racun(&self, racun: &Value) -> Odgovor {
        match reklamirani_racun_objekat(racun) {
            Ok(objekat) => self.post_xml("/srr", &racun_zahtjev(self.next_request_number(), 2, &objekat)),
            Err(e) => odbijeno(&e),
        }
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
        self.novac(&UNOS_NOVCA_PATHS, 7, iznos)
    }

    /// Službeni iznos gotovine iz kase.
    pub fn povrat_novca(&self, iznos: f64) -> Odgovor {
        self.novac(&POVRAT_NOVCA_PATHS, 8, iznos)
    }

    fn novac(&self, paths: &[&str], vrsta_zahtjeva: i64, iznos: f64) -> Odgovor {
        // Provjera prije brojača zahtjeva, kao `broj(iznos)` u services/tring.ts.
        if let Err(e) = broj(&js::f(iznos), "Iznos") {
            return odbijeno(&e);
        }
        match novac_xml(self.next_request_number(), vrsta_zahtjeva, iznos, "Gotovina") {
            Ok(body) => self.post_xml_fallback(paths, &body),
            Err(e) => odbijeno(&e),
        }
    }

    // POST /spi - VrstaZahtjeva=5
    pub fn stampati_periodicni_izvjestaj(&self, od: &Value, do_: &Value) -> Odgovor {
        match periodicni_parametri(od, do_) {
            Ok(parametri) => self.post_xml("/spi", &periodicni_xml(self.next_request_number(), &parametri)),
            Err(e) => odbijeno(&e),
        }
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
        static BROJ: Regex = Regex::new(r"<Broj>([0-9]+)</Broj>").unwrap();
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

// ─── Validacija polja prije slanja ──────────────────────────────
// Kao u services/tring.ts: svako polje ide kroz escape ili validaciju, a
// nevaljan zahtjev se odbija prije HTTP-a istom porukom kao u Electronu.

/// Opis nevaljanog polja (bez prefiksa) ili gotov XML.
type Xml = Result<String, String>;

const MAX_PLU: i64 = 999_999;
const MAX_GRUPA: i64 = 999_999;
const MAX_BROJ_RACUNA: i64 = 999_999_999;

fn odbijeno(greska: &str) -> Odgovor {
    json!({
        "success": false,
        "vrstaOdgovora": "Greska",
        "odgovori": {},
        "error": format!("Zahtjev nije poslan fiskalnom uređaju: {greska}"),
        "statusCode": null,
    })
}

/// Broj ili decimalni string ("2.5", " 12 ", "1e3") → konačan broj i njegov JS
/// zapis; "0x10", "1,5", "Infinity", null... su `None`.
fn konacan_broj(v: &Value) -> Option<(f64, String)> {
    thread_local! {
        static DECIMALNI: Regex = Regex::new(r"^[ \t\r\n]*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?[ \t\r\n]*$").unwrap();
    }
    let (n, zapis) = match v {
        // Broj se ispisuje kao i dosad (`String(n)`), da ispravan XML ostane isti.
        Value::Number(n) => (n.as_f64()?, js::number_str(n)),
        Value::String(s) if DECIMALNI.with(|r| r.is_match(s)) => {
            let n = js::to_number(v);
            (n, js::num_str(n))
        }
        _ => return None,
    };
    n.is_finite().then_some((n, zapis))
}

/// Numeričko polje kako ga uređaj i dosad dobija: JS zapis broja, bez fiksnih
/// decimala — tako za ispravne ulaze XML ostaje bajt po bajt isti.
fn broj(v: &Value, polje: &str) -> Xml {
    konacan_broj(v).map(|(_, zapis)| zapis).ok_or_else(|| format!("neispravna vrijednost polja {polje} (mora biti broj)"))
}

fn cijeli_broj(v: &Value, opis: &str, max: i64) -> Xml {
    match konacan_broj(v) {
        Some((n, zapis)) if n.fract() == 0.0 && n >= 0.0 && n <= max as f64 => Ok(zapis),
        _ => Err(format!("{opis} (mora biti cijeli broj od 0 do {max})")),
    }
}

/// Uređaj zna samo stope E (17 %) i K (oslobođeno) — isto kao CHECK u bazi.
fn stopa(v: &Value) -> Xml {
    match v.as_str() {
        Some(s @ ("E" | "K")) => Ok(s.to_string()),
        _ => Err("neispravna PDV stopa (dozvoljeno E ili K)".into()),
    }
}

fn racun_zahtjev(n: i64, vrsta_zahtjeva: i64, novi_objekat: &str) -> String {
    format!("{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>{vrsta_zahtjeva}</VrstaZahtjeva><NoviObjekat>{novi_objekat}</NoviObjekat></RacunZahtjev>")
}

fn operator_xml(operator_id: &Value, password: &Value) -> String {
    format!(
        "{XML_DECL}<Operator {XMLNS}><BrojOperatora>{}</BrojOperatora><Lozinka>{}</Lozinka></Operator>",
        esc(operator_id),
        esc(password)
    )
}

fn artikal_to_xml(a: &Value) -> Xml {
    Ok(format!(
        "<Sifra>{}</Sifra><Naziv>{}</Naziv><JM>{}</JM><Cijena>{}</Cijena><Stopa>{}</Stopa><Grupa>{}</Grupa><PLU>{}</PLU>",
        esc(&a["sifra"]),
        esc(&a["naziv"]),
        esc(&a["jm"]),
        broj(&a["cijena"], "Cijena")?,
        stopa(&a["stopa"])?,
        cijeli_broj(js::nn(&a["grupa"], &json!(0)), "neispravna Grupa", MAX_GRUPA)?,
        cijeli_broj(js::nn(&a["plu"], &json!(0)), "neispravan PLU", MAX_PLU)?,
    ))
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

fn stavke_xml(stavke: &Value) -> Xml {
    let mut out = String::new();
    for s in stavke.as_array().map(Vec::as_slice).unwrap_or_default() {
        out += &format!(
            "<RacunStavka><artikal>{}</artikal><Kolicina>{}</Kolicina><Rabat>{}</Rabat></RacunStavka>",
            artikal_to_xml(&s["artikal"])?,
            broj(&s["kolicina"], "Kolicina")?,
            broj(&s["rabat"], "Rabat")?,
        );
    }
    Ok(out)
}

fn placanja_xml(placanja: &[Value]) -> Xml {
    let mut out = String::new();
    for v in placanja {
        out += &format!(
            "<VrstaPlacanja><Oznaka>{}</Oznaka><Iznos>{}</Iznos></VrstaPlacanja>",
            normalize_oznaka(&to_string(&v["oznaka"])),
            broj(&v["iznos"], "Iznos")?,
        );
    }
    Ok(out)
}

fn napomena_xml(n: &Value) -> String {
    if js::truthy(n) { esc(n) } else { String::new() }
}

/// `<NoviObjekat>` računa i reklamacije (redoslijed provjera kao u TS-u).
fn racun_objekat(racun: &Value, placanja: &[Value], broj_racuna: &Value) -> Xml {
    Ok(format!(
        "{}<StavkeRacuna>{}</StavkeRacuna><VrstePlacanja>{}</VrstePlacanja><Napomena>{}</Napomena><BrojRacuna>{}</BrojRacuna>",
        kupac_xml(&racun["kupac"]),
        stavke_xml(&racun["stavke"])?,
        placanja_xml(placanja)?,
        napomena_xml(&racun["napomena"]),
        cijeli_broj(broj_racuna, "neispravan BrojRacuna", MAX_BROJ_RACUNA)?,
    ))
}

fn fiskalni_racun_objekat(racun: &Value) -> Xml {
    let placanja = racun["vrstePlacanja"].as_array().cloned().unwrap_or_default();
    racun_objekat(racun, &placanja, js::nn(&racun["brojRacuna"], &json!(0)))
}

/// Reklamacija mora nositi tačno jednu vrstu plaćanja — gotovinski povrat se
/// šalje kao Gotovina/0 (vidi services/tring.ts).
fn reklamirani_racun_objekat(racun: &Value) -> Xml {
    let mut placanja = racun["vrstePlacanja"].as_array().cloned().unwrap_or_default();
    if placanja.is_empty() {
        placanja = vec![json!({"oznaka": "Gotovina", "iznos": 0})];
    }
    racun_objekat(racun, &placanja, &racun["brojRacuna"])
}

fn novac_xml(broj_zahtjeva: i64, vrsta_zahtjeva: i64, iznos: f64, oznaka: &str) -> Xml {
    let iznos = broj(&js::f(js::round2(iznos)), "Iznos")?;
    Ok(format!(
        "{XML_DECL}<RacunZahtjev {XMLNS}><BrojZahtjeva>{broj_zahtjeva}</BrojZahtjeva><VrstaZahtjeva>{vrsta_zahtjeva}</VrstaZahtjeva><NoviObjekat><Oznaka>{}</Oznaka><Iznos>{iznos}</Iznos></NoviObjekat></RacunZahtjev>",
        escape_xml(oznaka)
    ))
}

/// "GGGG-MM-DD" → "d.M.gggg vrijeme", format koji Tring očekuje.
fn datum_izvjestaja(d: &Value, vrijeme: &str) -> Xml {
    thread_local! {
        static DATUM: Regex = Regex::new(r"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$").unwrap();
    }
    let dijelovi = d.as_str().and_then(|s| DATUM.with(|r| {
        r.captures(s).map(|c| (c[1].to_string(), c[2].parse::<u32>().unwrap(), c[3].parse::<u32>().unwrap()))
    }));
    match dijelovi {
        Some((godina, mjesec, dan)) => Ok(format!("{dan}.{mjesec}.{godina} {vrijeme}")),
        None => Err("neispravan datum (očekuje se GGGG-MM-DD)".into()),
    }
}

fn periodicni_parametri(od: &Value, do_: &Value) -> Xml {
    Ok(format!(
        "<Parametar><Naziv>odDatuma</Naziv><Vrijednost>{}</Vrijednost></Parametar><Parametar><Naziv>doDatuma</Naziv><Vrijednost>{}</Vrijednost></Parametar>",
        datum_izvjestaja(od, "00:00:00")?,
        datum_izvjestaja(do_, "23:59:59")?,
    ))
}

fn periodicni_xml(n: i64, parametri: &str) -> String {
    format!("{XML_DECL}<Zahtjev {XMLNS}><BrojZahtjeva>{n}</BrojZahtjeva><VrstaZahtjeva>5</VrstaZahtjeva><Parametri>{parametri}</Parametri></Zahtjev>")
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

    fn stavka(artikal: Value, kolicina: Value, rabat: Value) -> Value {
        json!({ "artikal": artikal, "kolicina": kolicina, "rabat": rabat })
    }

    fn kafa() -> Value {
        json!({ "sifra": "A1", "naziv": "Kafa", "jm": "kom", "cijena": 2.5, "stopa": "E", "plu": 7 })
    }

    fn sa(mut v: Value, kljuc: &str, vrijednost: Value) -> Value {
        v[kljuc] = vrijednost;
        v
    }

    fn racun_sa_stavkom(s: Value) -> Value {
        json!({ "stavke": [s], "vrstePlacanja": [{ "oznaka": "Gotovina", "iznos": 2.5 }] })
    }

    /// Isti ulazi kao u `services/tring.validacija.test.ts` — oba backenda moraju
    /// dati bajt po bajt `tring.zlatni.txt` (XML prije uvođenja validacije).
    #[test]
    fn ispravni_ulazi_daju_zlatni_xml() {
        let pun = json!({
            "stavke": [
                stavka(json!({ "sifra": "A&1", "naziv": "Kafa <dupla>", "jm": "kom", "cijena": 2.5, "stopa": "E", "grupa": 3, "plu": 7 }), json!(2), json!(0)),
                stavka(json!({ "sifra": "B2", "naziv": "Sok 'o\"", "jm": "l", "cijena": 10, "stopa": "K" }), json!(0.1 + 0.2), json!(12.5)),
                stavka(json!({ "sifra": "C3", "naziv": "Mali", "jm": "g", "cijena": 0.000001, "stopa": "E", "plu": 999999 }), json!(1.5e-7), json!(-1)),
            ],
            "vrstePlacanja": [{ "oznaka": "Ček", "iznos": 20.3 }, { "oznaka": "Gotovina", "iznos": 0 }],
            "kupac": { "idBroj": "4200000000001", "naziv": "Firma & sin", "adresa": "Ulica 1", "postanskiBroj": "71000", "grad": "Sarajevo" },
            "napomena": "Hvala <3",
            "brojRacuna": 12,
        });
        let reklamacija = sa(sa(pun.clone(), "vrstePlacanja", json!([])), "brojRacuna", json!(101));
        let kratki = json!({ "stavke": [pun["stavke"][0]], "vrstePlacanja": [{ "oznaka": "Kartica", "iznos": 5 }] });
        let artikal = json!({ "sifra": "S<1>", "naziv": "Sok", "jm": "l", "cijena": 1.2, "stopa": "K", "plu": 12 });

        let zahtjevi = [
            ("/sfr", racun_zahtjev(1, 0, &fiskalni_racun_objekat(&pun).unwrap())),
            ("/srr", racun_zahtjev(1, 2, &reklamirani_racun_objekat(&reklamacija).unwrap())),
            ("/sfr", racun_zahtjev(1, 0, &fiskalni_racun_objekat(&kratki).unwrap())),
            ("/ua", racun_zahtjev(1, 105, &artikal_to_xml(&artikal).unwrap())),
            ("/inicijalizacija", operator_xml(&json!(5), &json!("tajna"))),
            ("/spi", periodicni_xml(1, &periodicni_parametri(&json!("2026-01-05"), &json!("2026-02-10")).unwrap())),
            ("/unosnovca", novac_xml(1, 7, 120.33, "Gotovina").unwrap()),
        ];
        let dobiveno: String = zahtjevi.iter().map(|(p, xml)| format!("{p}\n{xml}\n")).collect();
        assert_eq!(dobiveno, include_str!("../../../src/services/tring.zlatni.txt"));
    }

    #[test]
    fn broj_kao_string_ide_kao_broj() {
        let artikal = json!({ "sifra": "A1", "naziv": "Kafa", "jm": "kom", "cijena": " 2.50 ", "stopa": "E", "grupa": "3", "plu": "7" });
        assert!(artikal_to_xml(&artikal).unwrap().ends_with("<Cijena>2.5</Cijena><Stopa>E</Stopa><Grupa>3</Grupa><PLU>7</PLU>"));
    }

    #[test]
    fn lozinka_ide_kroz_escape() {
        let xml = operator_xml(&json!(5), &json!("a<b>&\"'</Lozinka>"));
        assert!(xml.contains("<Lozinka>a&lt;b&gt;&amp;&quot;&apos;&lt;/Lozinka&gt;</Lozinka></Operator>"));
    }

    fn greska(r: Xml) -> String {
        r.expect_err("nevaljan ulaz mora biti odbijen")
    }

    #[test]
    fn stopa_samo_e_ili_k() {
        for stopa in [json!("E</Stopa><Stopa>K"), json!("e"), json!("A"), json!(""), json!(null), json!(1)] {
            assert_eq!(greska(artikal_to_xml(&sa(kafa(), "stopa", stopa))), "neispravna PDV stopa (dozvoljeno E ili K)");
        }
    }

    fn nevaljani_brojevi() -> Vec<Value> {
        vec![json!("1</Cijena><Cijena>0"), json!(""), json!("  "), json!(null), json!("1,5"), json!("0x10"),
             json!("Infinity"), json!("NaN"), json!(true), json!({}), json!([]), json!("١")]
    }

    #[test]
    fn numericka_polja_moraju_biti_konacan_broj() {
        for v in nevaljani_brojevi() {
            assert_eq!(greska(artikal_to_xml(&sa(kafa(), "cijena", v.clone()))), "neispravna vrijednost polja Cijena (mora biti broj)");
            let r = racun_sa_stavkom(stavka(kafa(), v.clone(), json!(0)));
            assert_eq!(greska(fiskalni_racun_objekat(&r)), "neispravna vrijednost polja Kolicina (mora biti broj)");
            let r = sa(racun_sa_stavkom(stavka(kafa(), json!(1), v.clone())), "brojRacuna", json!(3));
            assert_eq!(greska(reklamirani_racun_objekat(&r)), "neispravna vrijednost polja Rabat (mora biti broj)");
            let r = sa(racun_sa_stavkom(stavka(kafa(), json!(1), json!(0))), "vrstePlacanja", json!([{ "oznaka": "Gotovina", "iznos": v }]));
            assert_eq!(greska(fiskalni_racun_objekat(&r)), "neispravna vrijednost polja Iznos (mora biti broj)");
        }
        for iznos in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(greska(novac_xml(1, 7, iznos, "Gotovina")), "neispravna vrijednost polja Iznos (mora biti broj)");
        }
    }

    #[test]
    fn cijeli_brojevi_u_rasponu() {
        for plu in [json!(-1), json!(1.5), json!(1_000_000), json!("7</PLU><PLU>8"), json!("")] {
            assert_eq!(greska(artikal_to_xml(&sa(kafa(), "plu", plu))), "neispravan PLU (mora biti cijeli broj od 0 do 999999)");
        }
        assert!(artikal_to_xml(&sa(kafa(), "plu", json!(null))).unwrap().ends_with("<PLU>0</PLU>"));
        for grupa in [json!(-1), json!(2.5), json!("3</Grupa>")] {
            assert_eq!(greska(artikal_to_xml(&sa(kafa(), "grupa", grupa))), "neispravna Grupa (mora biti cijeli broj od 0 do 999999)");
        }
        for broj in [json!(-1), json!(1.5), json!("12</BrojRacuna>"), json!(1_000_000_000)] {
            let r = sa(racun_sa_stavkom(stavka(kafa(), json!(1), json!(0))), "brojRacuna", broj);
            assert_eq!(greska(fiskalni_racun_objekat(&r)), "neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)");
            assert_eq!(greska(reklamirani_racun_objekat(&r)), "neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)");
        }
        // Reklamacija nema zadani broj originalnog računa.
        let r = racun_sa_stavkom(stavka(kafa(), json!(1), json!(0)));
        assert_eq!(greska(reklamirani_racun_objekat(&r)), "neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)");
    }

    #[test]
    fn datum_periodicnog_izvjestaja() {
        for d in [json!("2026</Vrijednost><X>-01-05"), json!("26-01-05"), json!("2026-01"), json!("2026-01-05T00:00"), json!(""), json!(20260105)] {
            assert_eq!(greska(periodicni_parametri(&d, &json!("2026-02-10"))), "neispravan datum (očekuje se GGGG-MM-DD)");
            assert_eq!(greska(periodicni_parametri(&json!("2026-01-05"), &d)), "neispravan datum (očekuje se GGGG-MM-DD)");
        }
    }
}
