//! Licenca (`ipc/licenca.ts`, `lib/licenca.ts`, `lib/licencaStanje.ts`).
//!
//! Token `PAZAR1.<payload>.<potpis>` (base64url), potpis Ed25519 nad
//! `PAZAR1.<payload>`. Zapis (token, zadnji viđeni datum) je u
//! `userData/licenca.json`, van baze. ID uređaja se računa isto kao u
//! Electronu, pa licence izdane za Electron verziju važe i ovdje.
//! Moduli i kanal → moduli: `src/lib/moduliKatalog.json`.

use std::sync::OnceLock;

use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use base64::engine::DecodePaddingMode;
use base64::{alphabet, Engine};
use chrono::NaiveDate;
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::{Signature, VerifyingKey};
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::greska::{Greska, R};
use crate::{Args, Backend};

const PREFIKS: &str = "PAZAR1";
pub const UPOZORENJE_DANA: i64 = 7;
pub const PERIOD_MILOSTI_DANA: i64 = 15;

/// Kanali koji prave nove dokumente ili mijenjaju stanje zaliha.
const BLOKIRANI_KANALI: &[&str] = &[
    "order:create", "order:createManual", "order:finalize", "order:finalizePrilog",
    "order:refund", "order:refundAndPrint",
    "tring:printReceipt", "tring:printRefund",
    "primka:create", "primka:update",
    "product:adjustStock",
    "ponuda:create", "ponuda:update", "ponuda:konvertuj",
    "nalog:create", "nalog:createIzPonude", "nalog:update", "nalog:replaceStavke",
    "nalog:setStatus", "nalog:izdajRacun",
];

/// Javni ključ iz `src/lib/licencaJavniKljuc.ts` (jedan izvor za oba backenda).
fn javni_kljuc() -> &'static VerifyingKey {
    static K: OnceLock<VerifyingKey> = OnceLock::new();
    K.get_or_init(|| {
        const TS: &str = include_str!("../../../src/lib/licencaJavniKljuc.ts");
        let od = TS.find("-----BEGIN PUBLIC KEY-----").expect("licencaJavniKljuc.ts mora imati PEM");
        let kraj = "-----END PUBLIC KEY-----";
        let do_ = TS[od..].find(kraj).expect("licencaJavniKljuc.ts mora imati PEM") + od + kraj.len();
        VerifyingKey::from_public_key_pem(&TS[od..do_]).expect("ispravan javni ključ licence")
    })
}

/// Katalog modula iz `src/lib/moduliKatalog.json` (jedan izvor za oba backenda).
fn katalog() -> &'static Value {
    static K: OnceLock<Value> = OnceLock::new();
    K.get_or_init(|| serde_json::from_str(include_str!("../../../src/lib/moduliKatalog.json")).expect("ispravan moduliKatalog.json"))
}

/// `normalizujModule`: poznati moduli redom iz kataloga; `None` kad nije niz stringova.
fn normalizuj_module(m: &Value) -> Option<Value> {
    let niz = m.as_array().filter(|n| n.iter().all(Value::is_string))?;
    Some(Value::Array(katalog()["moduli"].as_array().unwrap().iter().filter(|x| niz.contains(x)).cloned().collect()))
}

/// Node `Buffer.from(x, 'base64url')`: prihvata i s paddingom i bez.
fn base64url(s: &str) -> Option<Vec<u8>> {
    const E: GeneralPurpose = GeneralPurpose::new(
        &alphabet::URL_SAFE,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    // Node ignoriše razmake/prelome reda i prihvata i obični base64 alfabet (+/).
    let cist: String = s.chars().filter(|c| !c.is_whitespace()).map(|c| match c { '+' => '-', '/' => '_', c => c }).collect();
    E.decode(cist.trim_end_matches('=')).ok()
}

fn datum_ok(s: &str) -> bool {
    thread_local!(static D: Regex = Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    D.with(|r| r.is_match(s))
}

/// Čita token bez provjere potpisa; `None` kad format nije ispravan.
pub fn procitaj_licencu(token: &str) -> Option<Value> {
    let dijelovi: Vec<&str> = token.trim().split('.').collect();
    if dijelovi.len() != 3 || dijelovi[0] != PREFIKS {
        return None;
    }
    let bajtovi = base64url(dijelovi[1])?;
    let p: Value = serde_json::from_slice(&bajtovi).ok()?;
    let k = p["k"].as_str()?;
    let d = p["d"].as_str().filter(|d| datum_ok(d))?;
    let i = p["i"].as_str().filter(|i| datum_ok(i))?;
    let mut l = Map::new();
    l.insert("klijent".into(), json!(k));
    l.insert("vrijediDo".into(), json!(d));
    l.insert("izdana".into(), json!(i));
    if let Some(u) = p["u"].as_str().filter(|u| !u.is_empty()) {
        l.insert("uredjaj".into(), json!(u));
    }
    if let Some(m) = p.get("m") {
        l.insert("moduli".into(), normalizuj_module(m)?);
    }
    Some(Value::Object(l))
}

/// `provjeriLicencu`: Ok(licenca) ili Err((razlog, licenca?)).
pub fn provjeri_licencu(token: &str, kljuc: &VerifyingKey, danas: &str, uredjaj: &str) -> Result<Value, (&'static str, Option<Value>)> {
    let Some(licenca) = procitaj_licencu(token) else { return Err(("format", None)) };
    let dijelovi: Vec<&str> = token.trim().split('.').collect();
    let poruka = format!("{}.{}", dijelovi[0], dijelovi[1]);
    let ispravan = base64url(dijelovi[2])
        .and_then(|p| Signature::from_slice(&p).ok())
        .map(|sig| kljuc.verify_strict(poruka.as_bytes(), &sig).is_ok())
        .unwrap_or(false);
    if !ispravan {
        return Err(("potpis", None));
    }
    if let Some(u) = licenca["uredjaj"].as_str() {
        if u != uredjaj {
            return Err(("uredjaj", Some(licenca)));
        }
    }
    if danas > licenca["vrijediDo"].as_str().unwrap_or("") {
        return Err(("istekla", Some(licenca)));
    }
    Ok(licenca)
}

fn dan_broj(datum: &str) -> i64 {
    let mut d = datum.split('-').map(|x| x.parse::<i64>().unwrap_or(0));
    let (g, m, dan) = (d.next().unwrap_or(0), d.next().unwrap_or(1), d.next().unwrap_or(1));
    // Date.UTC(g, m-1, d) prelijeva dane/mjesece kao JS; ovdje su datumi provjereni regexom.
    match NaiveDate::from_ymd_opt(g as i32, 1, 1) {
        Some(p) => {
            let pocetak = p.signed_duration_since(NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()).num_days();
            let mjeseci = (1..m).map(|mj| dana_u_mjesecu(g, mj)).sum::<i64>();
            pocetak + mjeseci + dan - 1
        }
        None => 0,
    }
}

fn dana_u_mjesecu(g: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => if (g % 4 == 0 && g % 100 != 0) || g % 400 == 0 { 29 } else { 28 },
    }
}

pub fn razlika_dana(od: &str, do_: &str) -> i64 {
    dan_broj(do_) - dan_broj(od)
}

pub fn efektivni_danas(stvarni: &str, zadnji: Option<&str>) -> String {
    match zadnji {
        Some(z) if !z.is_empty() && z > stvarni => z.to_string(),
        _ => stvarni.to_string(),
    }
}

pub fn izracunaj_stanje(token: Option<&str>, kljuc: &VerifyingKey, danas: &str, uredjaj: &str) -> Value {
    let Some(token) = token.filter(|t| !t.trim().is_empty()) else { return json!({ "stanje": "nema" }) };
    let licenca = match provjeri_licencu(token, kljuc, danas, uredjaj) {
        Ok(l) => l,
        Err(("istekla", Some(l))) => l,
        Err((razlog, _)) => return json!({ "stanje": "neispravna", "razlog": razlog }),
    };
    let dana = razlika_dana(danas, licenca["vrijediDo"].as_str().unwrap_or(""));
    if dana >= 0 {
        let stanje = if dana <= UPOZORENJE_DANA { "upozorenje" } else { "aktivna" };
        return json!({ "stanje": stanje, "licenca": licenca, "danaDoIsteka": dana });
    }
    let do_blokade = PERIOD_MILOSTI_DANA + dana;
    if do_blokade >= 0 {
        json!({ "stanje": "milost", "licenca": licenca, "danaDoBlokade": do_blokade })
    } else {
        json!({ "stanje": "zakljucana", "licenca": licenca })
    }
}

pub fn smije_raditi(s: &Value) -> bool {
    matches!(s["stanje"].as_str(), Some("aktivna" | "upozorenje" | "milost"))
}

fn sirov_id_uredjaja() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        if let Ok(out) = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
            .creation_flags(0x0800_0000)
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(c) = Regex::new(r"MachineGuid\s+REG_SZ\s+(\S+)").unwrap().captures(&s) {
                return c[1].to_string();
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(c) = Regex::new(r#""IOPlatformUUID"\s*=\s*"([^"]+)""#).unwrap().captures(&s) {
                return c[1].to_string();
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        for f in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = std::fs::read_to_string(f) {
                return s.trim().to_string();
            }
        }
    }
    hostname::get().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Kratak, stabilan ID ovog računara, npr. `3F9A-01C2-7B44`.
pub fn uredjaj_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| {
        let h = Sha256::digest(format!("pazar:{}", sirov_id_uredjaja()).as_bytes());
        let hex: String = h.iter().map(|b| format!("{b:02x}")).collect::<String>()[..12].to_uppercase();
        format!("{}-{}-{}", &hex[0..4], &hex[4..8], &hex[8..12])
    })
}

fn putanja(b: &Backend) -> std::path::PathBuf {
    b.user_data().join("licenca.json")
}

fn procitaj(b: &Backend) -> Value {
    std::fs::read_to_string(putanja(b))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn zapisi(b: &Backend, z: &Value) -> R<()> {
    std::fs::write(putanja(b), serde_json::to_string_pretty(z).unwrap())?;
    Ok(())
}

fn sa_uredjajem(mut s: Value) -> Value {
    s.as_object_mut().unwrap().insert("uredjaj".into(), json!(uredjaj_id()));
    s
}

pub fn stanje_licence(b: &Backend) -> R<Value> {
    let mut z = procitaj(b);
    let danas = efektivni_danas(&b.sat.danas(), z["zadnjiDatum"].as_str());
    let token = z["token"].as_str().map(str::to_string);
    if z["zadnjiDatum"].as_str() != Some(danas.as_str()) && token.as_deref().is_some_and(|t| !t.is_empty()) {
        z["zadnjiDatum"] = json!(danas);
        zapisi(b, &z)?;
    }
    Ok(sa_uredjajem(izracunaj_stanje(token.as_deref(), javni_kljuc(), &danas, uredjaj_id())))
}

pub fn aktiviraj_licencu(b: &Backend, token: &str) -> R<Value> {
    let z = procitaj(b);
    let danas = efektivni_danas(&b.sat.danas(), z["zadnjiDatum"].as_str());
    let s = izracunaj_stanje(Some(token), javni_kljuc(), &danas, uredjaj_id());
    match s["stanje"].as_str() {
        Some("nema") => return Err(Greska::nova("Upišite kod licence.")),
        Some("neispravna") => {
            return Err(Greska::nova(match s["razlog"].as_str() {
                Some("uredjaj") => "Ovaj kod je izdan za drugi računar.",
                _ => "Kod nije ispravan — provjerite da ste kopirali cijeli kod.",
            }))
        }
        Some("zakljucana") => {
            let d: Vec<&str> = s["licenca"]["vrijediDo"].as_str().unwrap_or("").split('-').rev().collect();
            return Err(Greska(format!("Ovaj kod je istekao {}.", d.join("."))));
        }
        _ => {}
    }
    zapisi(b, &json!({ "token": token.trim(), "zadnjiDatum": danas }))?;
    Ok(sa_uredjajem(s))
}

/// `kanalPodLicencom`: kanal koji pravi dokumente ili pripada modulu.
fn pod_licencom(kanal: &str) -> bool {
    BLOKIRANI_KANALI.contains(&kanal) || katalog()["kanali"].get(kanal).is_some()
}

/// `razlogBlokade`: `Some((istekla, poruka))` kad licenca ne dozvoljava kanal.
pub fn razlog_blokade(s: &Value, kanal: &str) -> Option<(bool, String)> {
    if BLOKIRANI_KANALI.contains(&kanal) && !smije_raditi(s) {
        return Some((true, "Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.".into()));
    }
    let trazi = katalog()["kanali"].get(kanal)?.as_array()?;
    // Stari token (bez "moduli") i stanje bez licence dozvoljavaju sve.
    let lista = s["licenca"].get("moduli").and_then(Value::as_array)?;
    let fali = trazi.iter().find(|m| !lista.contains(m))?.as_str()?;
    Some((false, format!("Modul {} nije uključen u licencu.", katalog()["nazivi"][fali].as_str().unwrap_or(fali))))
}

/// Baca grešku ako licenca ne dozvoljava kanal (istekla ili modul nije licenciran).
pub fn provjeri_kanal(b: &Backend, kanal: &str) -> R<()> {
    if !b.provjera_licence || !pod_licencom(kanal) {
        return Ok(());
    }
    match razlog_blokade(&stanje_licence(b)?, kanal) {
        None => Ok(()),
        Some((istekla, poruka)) => {
            if istekla {
                b.licenca_blokirana();
            }
            Err(Greska(poruka))
        }
    }
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    // Ugovorni testovi rade s otključanom licencom (kao mock u tsBackend.ts).
    if !b.provjera_licence {
        return match kanal {
            "licenca:stanje" | "licenca:aktiviraj" => Some(Ok(json!({ "stanje": "aktivna" }))),
            _ => None,
        };
    }
    Some(match kanal {
        "licenca:stanje" => stanje_licence(b),
        "licenca:aktiviraj" => aktiviraj_licencu(b, a[0].as_str().unwrap_or("")),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use ed25519_dalek::{Signer, SigningKey};

    fn izdaj(k: &SigningKey, payload: &str) -> String {
        let tijelo = format!("{PREFIKS}.{}", URL_SAFE_NO_PAD.encode(payload));
        let potpis = k.sign(tijelo.as_bytes());
        format!("{tijelo}.{}", URL_SAFE_NO_PAD.encode(potpis.to_bytes()))
    }

    #[test]
    fn stanja_licence() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let v = k.verifying_key();
        let t = izdaj(&k, r#"{"k":"Firma","d":"2026-10-10","i":"2026-01-01"}"#);
        assert_eq!(izracunaj_stanje(Some(&t), &v, "2026-09-01", "X")["stanje"], "aktivna");
        assert_eq!(izracunaj_stanje(Some(&t), &v, "2026-10-05", "X")["danaDoIsteka"], 5);
        assert_eq!(izracunaj_stanje(Some(&t), &v, "2026-10-12", "X")["danaDoBlokade"], 13);
        assert_eq!(izracunaj_stanje(Some(&t), &v, "2026-10-26", "X")["stanje"], "zakljucana");
        assert_eq!(izracunaj_stanje(None, &v, "2026-10-26", "X"), json!({"stanje": "nema"}));
        let tudja = izdaj(&SigningKey::from_bytes(&[8u8; 32]), r#"{"k":"F","d":"2026-10-10","i":"2026-01-01"}"#);
        assert_eq!(izracunaj_stanje(Some(&tudja), &v, "2026-09-01", "X"), json!({"stanje": "neispravna", "razlog": "potpis"}));
        let vezana = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","u":"AAAA-BBBB-CCCC"}"#);
        assert_eq!(izracunaj_stanje(Some(&vezana), &v, "2026-09-01", "X")["razlog"], "uredjaj");
        assert_eq!(izracunaj_stanje(Some("PAZAR1.x.y"), &v, "2026-09-01", "X")["razlog"], "format");
        assert_eq!(razlika_dana("2024-02-28", "2024-03-01"), 2);
        let _ = javni_kljuc();
    }

    #[test]
    fn moduli_u_licenci() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let v = k.verifying_key();
        let stari = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01"}"#);
        assert!(procitaj_licencu(&stari).unwrap().get("moduli").is_none());
        let sa = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","m":["proizvodnja","ponude","buducnost"]}"#);
        assert_eq!(procitaj_licencu(&sa).unwrap()["moduli"], json!(["ponude", "proizvodnja"]));
        for los in [r#""m":"ponude""#, r#""m":null"#, r#""m":[1]"#] {
            let t = izdaj(&k, &format!(r#"{{"k":"F","d":"2026-10-10","i":"2026-01-01",{los}}}"#));
            assert!(procitaj_licencu(&t).is_none(), "{los}");
        }

        let samo_proizvodnja = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","m":["proizvodnja"]}"#);
        let s = izracunaj_stanje(Some(&samo_proizvodnja), &v, "2026-09-01", "X");
        assert_eq!(razlog_blokade(&s, "ponuda:create"), Some((false, "Modul Ponude nije uključen u licencu.".to_string())));
        assert_eq!(razlog_blokade(&s, "nalog:createIzPonude"), Some((false, "Modul Ponude nije uključen u licencu.".to_string())));
        assert_eq!(razlog_blokade(&s, "nalog:create"), None);
        assert_eq!(razlog_blokade(&s, "order:create"), None);
        let s_stari = izracunaj_stanje(Some(&stari), &v, "2026-09-01", "X");
        assert_eq!(razlog_blokade(&s_stari, "nalog:createIzPonude"), None);
        let zakljucana = izracunaj_stanje(Some(&samo_proizvodnja), &v, "2026-12-01", "X");
        assert!(razlog_blokade(&zakljucana, "ponuda:create").unwrap().0);
        assert!(pod_licencom("normativ:save") && pod_licencom("order:create") && !pod_licencom("product:getAll"));
    }
}
