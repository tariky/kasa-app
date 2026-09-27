//! Licenca (`ipc/licenca.ts`, `lib/licenca.ts`, `lib/licencaStanje.ts`).
//!
//! Token `PAZAR1.<payload>.<potpis>` (base64url), potpis Ed25519 nad
//! `PAZAR1.<payload>`. Zapis (token, zadnji viđeni datum) je u
//! `userData/licenca.json`, van baze. ID uređaja se računa isto kao u
//! Electronu, pa licence izdane za Electron verziju važe i ovdje. Datum za
//! istek je najveći od sata, `zadnjiDatum` i najnovijeg računa u bazi.
//! Moduli i kanal → moduli: `src/lib/moduliKatalog.json`; kanali koji bez
//! licence ne rade: `blokiraniBezLicence` u `src/ipc/pristup.json`.

use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
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
use crate::js;
use crate::pristup::pristup;
use crate::sql::Db;
use crate::kanali::Kanal;
use crate::Backend;

const PREFIKS: &str = "PAZAR1";
pub const UPOZORENJE_DANA: i64 = 7;
pub const PERIOD_MILOSTI_DANA: i64 = 15;

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

/// Ed25519 potpis: tačno 86 znakova base64url bez paddinga i bez viška, s
/// kanonskim zadnjim znakom (kao `POTPIS` u licenca.ts) — bez Node popustljivosti.
fn potpis(s: &str) -> Option<Signature> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    if s.len() != 86 {
        return None;
    }
    let bajtovi = URL_SAFE_NO_PAD.decode(s).ok()?;
    Signature::from_slice(&bajtovi).ok()
}

/// `citajB`: bucket iz `b` kad su `c` ispravno ime i `x` string; pokvaren
/// `b` znači "bez backup-a", ne neispravnu licencu.
fn backup_bucket(b: &Value) -> Option<&str> {
    thread_local!(static K: Regex = Regex::new(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$").unwrap());
    let c = b["c"].as_str().filter(|c| K.with(|r| r.is_match(c)))?;
    b["x"].is_string().then_some(c)
}

/// AES-256-GCM ključ za R2 podatke u licenci (`b.x`) iz `src/lib/backupKljuc.ts`
/// — jedan izvor za oba backenda. Fajl nije u gitu (repo je javan); CI ga
/// piše iz tajne. Skriva kredencijale od onoga ko vidi token, ne i od onoga
/// ko rastavi program — pravu zaštitu nose pravila bucketa.
fn backup_kljuc() -> &'static [u8; 32] {
    static K: OnceLock<[u8; 32]> = OnceLock::new();
    K.get_or_init(|| kljuc_iz_ts(include_str!("../../../src/lib/backupKljuc.ts")).expect("backupKljuc.ts mora imati ključ od 64 hex znaka"))
}

/// Ključ iz `'<64 hex znaka>'` u TS izvoru — mala ili velika slova, kao Node
/// `Buffer.from(hex, 'hex')`.
fn kljuc_iz_ts(ts: &str) -> Option<[u8; 32]> {
    let hex = Regex::new(r"'([0-9a-fA-F]{64})'").unwrap().captures(ts)?.get(1)?.as_str();
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(k)
}

/// R2 pristup (token samo za bucket klijenta) i javni age ključ kojim se
/// backup šifruje (`R2Podaci`). Nikad ne ide rendereru.
#[derive(Clone, PartialEq)]
pub struct R2Podaci {
    pub account_id: String,
    pub access_key_id: String,
    pub secret: String,
    pub bucket: String,
    /// `age1…` — privatni par je samo kod izdavača.
    pub primalac: String,
}

/// Bez kredencijala: `{:?}` ili panika ne smiju ispisati ključ ni tajnu.
impl std::fmt::Debug for R2Podaci {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("R2Podaci")
            .field("account_id", &self.account_id)
            .field("access_key_id", &"…")
            .field("secret", &"…")
            .field("bucket", &self.bucket)
            .field("primalac", &self.primalac)
            .finish()
    }
}

impl R2Podaci {
    /// Iz JSON oblika `R2Podaci` (TS, camelCase); `None` kad polje fali ili je prazno.
    pub fn iz_json(v: &Value) -> Option<R2Podaci> {
        let s = |k: &str| v.get(k)?.as_str().filter(|x| !x.is_empty()).map(str::to_string);
        Some(R2Podaci {
            account_id: s("accountId")?,
            access_key_id: s("accessKeyId")?,
            secret: s("secret")?,
            bucket: s("bucket")?,
            primalac: s("primalac")?,
        })
    }

    pub fn u_json(&self) -> Value {
        json!({
            "accountId": self.account_id,
            "accessKeyId": self.access_key_id,
            "secret": self.secret,
            "bucket": self.bucket,
            "primalac": self.primalac,
        })
    }
}

/// `desifrujR2`: nonce(12) | AES-256-GCM(JSON {a, k, s, r}) | tag(16).
fn desifruj_r2(bucket: &str, x: &str) -> Option<R2Podaci> {
    let buf = base64url(x)?;
    if buf.len() < 12 + 16 {
        return None;
    }
    let json = Aes256Gcm::new_from_slice(backup_kljuc()).ok()?.decrypt(Nonce::from_slice(&buf[..12]), &buf[12..]).ok()?;
    let p: Value = serde_json::from_slice(&json).ok()?;
    let s = |k: &str| p.get(k)?.as_str().filter(|x| !x.is_empty()).map(str::to_string);
    Some(R2Podaci { account_id: s("a")?, access_key_id: s("k")?, secret: s("s")?, bucket: bucket.to_string(), primalac: s("r")? })
}

/// R2 podaci iz tokena (`backupPodaci`). Ne provjerava potpis — pozivalac
/// koristi token koji je već prošao provjeru licence.
pub fn backup_podaci(token: &str) -> Option<R2Podaci> {
    procitaj_licencu(token)?;
    let payload = token.trim().split('.').nth(1)?;
    let p: Value = serde_json::from_slice(&base64url(payload)?).ok()?;
    let bucket = backup_bucket(&p["b"])?;
    desifruj_r2(bucket, p["b"]["x"].as_str()?)
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
    let d = p["d"].as_str().filter(|d| js::iso_datum(d))?;
    let i = p["i"].as_str().filter(|i| js::iso_datum(i))?;
    // `u` koji nije string je neispravan token (kao u licenca.ts); prazan = bilo koji uređaj.
    if p.get("u").is_some_and(|u| !u.is_string()) {
        return None;
    }
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
    if let Some(c) = backup_bucket(&p["b"]) {
        l.insert("backup".into(), json!({ "bucket": c }));
    }
    Some(Value::Object(l))
}

/// `provjeriLicencu`: Ok(licenca) ili Err((razlog, licenca?)).
pub fn provjeri_licencu(token: &str, kljuc: &VerifyingKey, danas: &str, uredjaj: &str) -> Result<Value, (&'static str, Option<Value>)> {
    let Some(licenca) = procitaj_licencu(token) else { return Err(("format", None)) };
    let dijelovi: Vec<&str> = token.trim().split('.').collect();
    let poruka = format!("{}.{}", dijelovi[0], dijelovi[1]);
    let ispravan = potpis(dijelovi[2])
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

/// `efektivniDanas`: najveći od stvarnog, zadnjeg viđenog i najnovijeg iz baze;
/// vrijednost koja nije `YYYY-MM-DD` se ignoriše.
pub fn efektivni_danas(stvarni: &str, zadnji: Option<&str>, iz_baze: Option<&str>) -> String {
    let mut danas = stvarni;
    for d in [zadnji, iz_baze].into_iter().flatten() {
        if js::iso_datum(d) && d > danas {
            danas = d;
        }
    }
    danas.to_string()
}

/// `UPIT_NAJNOVIJI_DATUM` iz licencaStanje.ts: računi bez ručno unesenih
/// (`isManual` nosi datum koji je korisnik ukucao) i polozi/povrati.
const UPIT_NAJNOVIJI_DATUM: &str = "
  SELECT MAX(d) AS d FROM (
    SELECT MAX(substr(createdAt, 1, 10)) AS d FROM orders
      WHERE isManual = 0 AND createdAt GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    UNION ALL
    SELECT MAX(substr(createdAt, 1, 10)) FROM cash_movements
      WHERE createdAt GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
  )";

/// Najnoviji datum iz baze (`najnovijiDatumIzBaze`): `YYYY-MM-DD` ili `None`.
fn procitaj_datum(db: &Db) -> R<Option<String>> {
    Ok(db.val(UPIT_NAJNOVIJI_DATUM, &[])?.as_str().filter(|d| js::iso_datum(d)).map(str::to_string))
}

/// `najnovijiDatumIzBazeJednom`: najnoviji datum iz baze, pročitan jednom po
/// otvaranju baze — upit prolazi kroz sve račune (~56 ms na 300k), a zove se
/// pri svakom licenciranom kanalu. Računi nastali kasnije nose sat računara,
/// koji ionako ulazi u efektivni datum. `Backend::zatvori_db*` ga zaboravi
/// (restore), a neuspjelo čitanje se ne pamti.
#[derive(Default)]
pub struct DatumIzBaze(Mutex<Option<Option<String>>>);

impl DatumIzBaze {
    pub fn procitaj(&self, db: &Db) -> Option<String> {
        let mut zapamceno = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(d) = zapamceno.as_ref() {
            return d.clone();
        }
        let d = procitaj_datum(db).ok()?;
        *zapamceno = Some(d.clone());
        d
    }

    pub fn zaboravi(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

fn danas_za_licencu(b: &Backend, z: &Value) -> String {
    let iz_baze = b.datum_iz_baze.procitaj(b.db());
    efektivni_danas(&b.sat.danas(), z["zadnjiDatum"].as_str(), iz_baze.as_deref())
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

/// `regPutanja` iz uredjaj.ts: apsolutna putanja, da `reg` iz PATH-a ili
/// radnog foldera ne podmetne tuđi ID.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn reg_putanja(system_root: Option<&str>) -> String {
    let root = system_root.filter(|r| !r.is_empty()).unwrap_or(r"C:\Windows");
    format!(r"{}\System32\reg.exe", root.trim_end_matches(['\\', '/']))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const IOREG: &str = "/usr/sbin/ioreg";

fn sirov_id_uredjaja() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let root = std::env::var("SystemRoot").ok();
        if let Ok(out) = std::process::Command::new(reg_putanja(root.as_deref()))
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
        if let Ok(out) = std::process::Command::new(IOREG).args(["-rd1", "-c", "IOPlatformExpertDevice"]).output() {
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
    // Ostaje: postojeće licence mogu biti vezane za hash hostname-a.
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
    let danas = danas_za_licencu(b, &z);
    let token = z["token"].as_str().map(str::to_string);
    if z["zadnjiDatum"].as_str() != Some(danas.as_str()) && token.as_deref().is_some_and(|t| !t.is_empty()) {
        z["zadnjiDatum"] = json!(danas);
        zapisi(b, &z)?;
    }
    Ok(sa_uredjajem(izracunaj_stanje(token.as_deref(), javni_kljuc(), &danas, uredjaj_id())))
}

/// R2 podaci za automatski backup (`backupPristup`); `None` kad licenca ne
/// dozvoljava rad ili nema backup. Samo backend, nikad renderer.
pub fn backup_pristup(b: &Backend) -> Option<R2Podaci> {
    let s = stanje_licence(b).ok()?;
    if !smije_raditi(&s) || !s["licenca"]["backup"].is_object() {
        return None;
    }
    backup_podaci(procitaj(b)["token"].as_str()?)
}

pub fn aktiviraj_licencu(b: &Backend, token: &str) -> R<Value> {
    let z = procitaj(b);
    let danas = danas_za_licencu(b, &z);
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

/// Kanal pripada modulu (svi takvi kanali nešto mijenjaju).
fn kanal_modula(kanal: &str) -> bool {
    katalog()["kanali"].get(kanal).is_some()
}

/// `kanalPodLicencom`: kanal koji pravi dokumente ili pripada modulu.
fn pod_licencom(kanal: &str) -> bool {
    pristup().blokirani_bez_licence.contains(kanal) || kanal_modula(kanal)
}

/// `razlogBlokade`: `Some((istekla, poruka))` kad licenca ne dozvoljava kanal.
/// Bez važeće licence (samo pregled) i kanali modula su blokirani; čitanja nisu.
pub fn razlog_blokade(s: &Value, kanal: &str) -> Option<(bool, String)> {
    if pod_licencom(kanal) && !smije_raditi(s) {
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

/// Ugovorni testovi rade s otključanom licencom (kao mock u tsBackend.ts).
fn otkljucana() -> R<Value> {
    Ok(json!({ "stanje": "aktivna" }))
}

pub const KANALI: &[Kanal] = &[
    Kanal { ime: "licenca:stanje", h: |b, _| if b.provjera_licence { stanje_licence(b) } else { otkljucana() } },
    Kanal {
        ime: "licenca:aktiviraj",
        h: |b, a| {
            let info = if b.provjera_licence { aktiviraj_licencu(b, a[0].as_str().unwrap_or(""))? } else { otkljucana()? };
            // Nova licenca s backup-om: prvi backup odmah (handlers.ts: backupNakonAktivacije).
            crate::backup::nakon_aktivacije(b);
            Ok(info)
        },
    },
];

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
        assert_eq!(razlog_blokade(&s, "order:finalize"), None);
        let s_stari = izracunaj_stanje(Some(&stari), &v, "2026-09-01", "X");
        assert_eq!(razlog_blokade(&s_stari, "nalog:createIzPonude"), None);
        let zakljucana = izracunaj_stanje(Some(&samo_proizvodnja), &v, "2026-12-01", "X");
        assert!(razlog_blokade(&zakljucana, "ponuda:create").unwrap().0);
        assert!(pod_licencom("normativ:save") && pod_licencom("order:finalize") && !pod_licencom("product:getAll"));
    }

    #[test]
    fn d_i_u_moraju_biti_stringovi() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let v = k.verifying_key();
        for los in [r#""d":["2026-10-31"]"#, r#""d":20261031"#, r#""i":["2026-10-01"]"#, r#""u":1"#, r#""u":["A"]"#, r#""u":{"x":1}"#, r#""u":null"#, r#""u":true"#] {
            let payload = format!(r#"{{"k":"F","d":"2026-10-31","i":"2026-10-01",{los}}}"#);
            // Kasniji ključ u JSON-u pobjeđuje (kao JSON.parse).
            let t = izdaj(&k, &payload);
            assert!(procitaj_licencu(&t).is_none(), "{los}");
            assert_eq!(izracunaj_stanje(Some(&t), &v, "2026-10-05", "X"), json!({"stanje": "neispravna", "razlog": "format"}), "{los}");
        }
        let prazan_u = izdaj(&k, r#"{"k":"F","d":"2026-10-31","i":"2026-10-01","u":""}"#);
        assert_eq!(izracunaj_stanje(Some(&prazan_u), &v, "2026-10-05", "X")["stanje"], "aktivna");
    }

    #[test]
    fn potpis_tacne_duzine_bez_viska() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let v = k.verifying_key();
        let t = izdaj(&k, r#"{"k":"F","d":"2026-10-31","i":"2026-10-01"}"#);
        let (tijelo, potpis) = t.rsplit_once('.').unwrap();
        assert_eq!(potpis.len(), 86);
        let sa = |p: &str| izracunaj_stanje(Some(&format!("{tijelo}.{p}")), &v, "2026-10-05", "X");
        assert_eq!(sa(potpis)["stanje"], "aktivna");
        let zadnji = potpis.chars().last().unwrap();
        let drugi = match zadnji { 'A' => 'B', 'Q' => 'R', 'g' => 'h', _ => 'x' };
        let losi = [
            format!("{potpis}A"),
            format!("{potpis}AA"),
            format!("{potpis}=="),
            format!("{} {}", &potpis[..40], &potpis[40..]),
            format!("{}{drugi}", &potpis[..85]),
            potpis.replace('-', "+").replace('_', "/"),
            potpis[..84].to_string(),
            String::new(),
        ];
        for los in losi.iter().filter(|l| l.as_str() != potpis) {
            assert_eq!(sa(los), json!({"stanje": "neispravna", "razlog": "potpis"}), "{los}");
        }
    }

    #[test]
    fn efektivni_datum_i_baza() {
        assert_eq!(efektivni_danas("2026-10-01", Some("2026-11-20"), None), "2026-11-20");
        assert_eq!(efektivni_danas("2026-11-21", Some("2026-11-20"), None), "2026-11-21");
        assert_eq!(efektivni_danas("2026-10-01", None, Some("2026-11-20")), "2026-11-20");
        assert_eq!(efektivni_danas("2026-10-01", Some("2026-11-25"), Some("2026-11-20")), "2026-11-25");
        assert_eq!(efektivni_danas("2026-12-01", Some("2026-11-25"), Some("2026-11-20")), "2026-12-01");
        assert_eq!(efektivni_danas("2026-12-01", Some("zzzz"), Some("9999")), "2026-12-01");

        let db = crate::proba::baza("licenca-datum");
        assert_eq!(procitaj_datum(&db).unwrap(), None);
        let racun = |manual: i64, kad: &str| {
            db.run(
                "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, isManual, createdAt) VALUES (1, 1, 0, 'Gotovina', 'completed', ?, ?)",
                &[json!(manual), json!(kad)],
            )
            .unwrap();
        };
        racun(0, "2026-11-02 08:00:00");
        racun(0, "2026-11-20 23:59:59");
        racun(0, "2026-11-03 10:00:00");
        assert_eq!(procitaj_datum(&db).unwrap().as_deref(), Some("2026-11-20"));
        db.run("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 1, 1, 'ok', '2026-11-21 07:00:00')", &[]).unwrap();
        assert_eq!(procitaj_datum(&db).unwrap().as_deref(), Some("2026-11-21"));
        // Ručni račun: datum je ukucao korisnik — ne broji se.
        racun(1, "2099-01-01 00:00:00");
        assert_eq!(procitaj_datum(&db).unwrap().as_deref(), Some("2026-11-21"));
        db.run("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 1, 1, 'ok', 'smeće')", &[]).unwrap();
        assert_eq!(procitaj_datum(&db).unwrap().as_deref(), Some("2026-11-21"));
    }

    #[test]
    fn datum_iz_baze_jednom_po_otvaranju() {
        let db = crate::proba::baza("licenca-jednom");
        let polog = |kad: &str| {
            db.run("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 1, 1, 'ok', ?)", &[json!(kad)])
                .unwrap();
        };
        let d = DatumIzBaze::default();
        assert_eq!(d.procitaj(&db), None);
        // Prazna baza se pamti — upit se ne ponavlja ni kad se pojavi novi zapis.
        polog("2026-11-20 10:00:00");
        assert_eq!(d.procitaj(&db), None);
        d.zaboravi();
        assert_eq!(d.procitaj(&db).as_deref(), Some("2026-11-20"));
        polog("2026-11-25 10:00:00");
        assert_eq!(d.procitaj(&db).as_deref(), Some("2026-11-20"));
        d.zaboravi();
        assert_eq!(d.procitaj(&db).as_deref(), Some("2026-11-25"));
        // Neuspjelo čitanje se ne pamti.
        db.exec("ALTER TABLE cash_movements RENAME TO cm").unwrap();
        d.zaboravi();
        assert_eq!(d.procitaj(&db), None);
        db.exec("ALTER TABLE cm RENAME TO cash_movements").unwrap();
        assert_eq!(d.procitaj(&db).as_deref(), Some("2026-11-25"));
    }

    #[test]
    fn kanali_samo_modula_bez_vazece_licence() {
        let samo_modul = ["primka:delete", "ponuda:delete", "ponuda:setStatus", "nalog:delete", "normativ:save", "proizvodnja:setEnabled"];
        let stari = json!({"klijent": "F", "vrijediDo": "2026-01-01", "izdana": "2025-01-01"});
        let bez_prava = [
            json!({"stanje": "nema"}),
            json!({"stanje": "neispravna", "razlog": "potpis"}),
            json!({"stanje": "neispravna", "razlog": "uredjaj"}),
            json!({"stanje": "zakljucana", "licenca": stari}),
        ];
        for s in &bez_prava {
            for kanal in samo_modul {
                assert!(razlog_blokade(s, kanal).is_some_and(|(istekla, _)| istekla), "{s} {kanal}");
            }
            for kanal in ["ponuda:getAll", "nalog:getAll", "primka:getAll", "normativ:get", "product:getAll"] {
                assert_eq!(razlog_blokade(s, kanal), None, "{s} {kanal}");
            }
        }
        let milost = json!({"stanje": "milost", "licenca": stari, "danaDoBlokade": 3});
        for kanal in samo_modul {
            assert_eq!(razlog_blokade(&milost, kanal), None);
        }
        let bez_ponuda = json!({"stanje": "aktivna", "danaDoIsteka": 9, "licenca": {"klijent": "F", "vrijediDo": "2026-01-01", "izdana": "2025-01-01", "moduli": ["proizvodnja"]}});
        assert_eq!(razlog_blokade(&bez_ponuda, "ponuda:delete"), Some((false, "Modul Ponude nije uključen u licencu.".to_string())));
        assert_eq!(razlog_blokade(&bez_ponuda, "normativ:save"), None);
    }

    #[test]
    fn apsolutne_putanje_alata() {
        assert_eq!(reg_putanja(Some(r"D:\WIN")), r"D:\WIN\System32\reg.exe");
        assert_eq!(reg_putanja(None), r"C:\Windows\System32\reg.exe");
        assert_eq!(reg_putanja(Some("")), r"C:\Windows\System32\reg.exe");
        assert_eq!(IOREG, "/usr/sbin/ioreg");
    }

    #[test]
    fn backup_u_licenci() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let sa = izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01","b":{"c":"pazar-pekara","x":"abc"}}"#);
        assert_eq!(procitaj_licencu(&sa).unwrap()["backup"], json!({"bucket": "pazar-pekara"}));
        for los in ["null", r#""x""#, r#"{"c":"Loš Bucket","x":"abc"}"#, r#"{"c":"dobar-bucket"}"#, r#"{"c":"ab","x":"abc"}"#] {
            let t = izdaj(&k, &format!(r#"{{"k":"F","d":"2026-10-10","i":"2026-01-01","b":{los}}}"#));
            let l = procitaj_licencu(&t).expect(los);
            assert!(l.get("backup").is_none(), "{los}");
        }
    }

    /// `b.x` kao `sifrujR2` u lib/licenca.ts: nonce(12) | AES-256-GCM(JSON) | tag(16), base64url.
    fn x_za(json: &str) -> String {
        use aes_gcm::aead::{Aead, KeyInit};
        let c = aes_gcm::Aes256Gcm::new_from_slice(backup_kljuc()).unwrap();
        let nonce = [9u8; 12];
        let mut buf = nonce.to_vec();
        buf.extend(c.encrypt(aes_gcm::Nonce::from_slice(&nonce), json.as_bytes()).unwrap());
        URL_SAFE_NO_PAD.encode(buf)
    }

    fn token_s_b(k: &SigningKey, b: &str) -> String {
        izdaj(k, &format!(r#"{{"k":"F","d":"2026-10-10","i":"2026-01-01","b":{b}}}"#))
    }

    #[test]
    fn r2_podaci_iz_licence() {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        let x = x_za(r#"{"a":"acc","k":"kid","s":"tajna/+=","r":"age1primalac"}"#);
        let t = token_s_b(&k, &format!(r#"{{"c":"pazar-pekara","x":"{x}"}}"#));
        let ocekivano = R2Podaci {
            account_id: "acc".into(), access_key_id: "kid".into(), secret: "tajna/+=".into(),
            bucket: "pazar-pekara".into(), primalac: "age1primalac".into(),
        };
        assert_eq!(backup_podaci(&t), Some(ocekivano.clone()));
        assert_eq!(R2Podaci::iz_json(&ocekivano.u_json()), Some(ocekivano));

        // Pokvaren ili nepotpun `b` = bez backup-a, ne panika.
        let mut pokvaren = x.clone().into_bytes();
        pokvaren[20] = if pokvaren[20] == b'A' { b'B' } else { b'A' };
        let pokvaren = String::from_utf8(pokvaren).unwrap();
        for b in [
            format!(r#"{{"c":"pazar-pekara","x":"{pokvaren}"}}"#),
            r#"{"c":"pazar-pekara","x":"AAAA"}"#.to_string(),
            format!(r#"{{"c":"Los_Bucket","x":"{x}"}}"#),
            format!(r#"{{"c":"pazar-pekara","x":"{}"}}"#, x_za(r#"{"a":"acc","k":"kid","s":"","r":"age1p"}"#)),
            format!(r#"{{"c":"pazar-pekara","x":"{}"}}"#, x_za("nije json")),
        ] {
            assert_eq!(backup_podaci(&token_s_b(&k, &b)), None, "{b}");
        }
        assert_eq!(backup_podaci(&izdaj(&k, r#"{"k":"F","d":"2026-10-10","i":"2026-01-01"}"#)), None);
        assert_eq!(backup_podaci("PAZAR1.x.y"), None);
        assert_eq!(R2Podaci::iz_json(&json!({"accountId": "a"})), None);
        assert_eq!(R2Podaci::iz_json(&Value::Null), None);
    }

    #[test]
    fn r2_podaci_debug_bez_kredencijala() {
        let r2 = R2Podaci {
            account_id: "acc".into(), access_key_id: "KLJUC-KOJI-SE-NE-VIDI".into(), secret: "tajna-koja-se-ne-vidi".into(),
            bucket: "pazar-pekara".into(), primalac: "age1primalac".into(),
        };
        let d = format!("{r2:?}");
        assert!(d.contains("acc") && d.contains("pazar-pekara") && d.contains("age1primalac"), "{d}");
        assert!(!d.contains("KLJUC-KOJI-SE-NE-VIDI") && !d.contains("tajna-koja-se-ne-vidi"), "{d}");
    }

    #[test]
    fn backup_kljuc_mala_i_velika_slova() {
        let mala = format!("export const BACKUP_KLJUC = '{}';", "0a1b2c3d4e5f".repeat(5) + "6f7e");
        let velika = mala.replace("0a1b2c3d4e5f", "0A1B2C3D4E5F").replace("6f7e", "6F7E");
        let k = kljuc_iz_ts(&mala).unwrap();
        assert_eq!(&k[..6], &[0x0a, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f]);
        assert_eq!(&k[30..], &[0x6f, 0x7e]);
        assert_eq!(kljuc_iz_ts(&velika), Some(k));
        assert_eq!(kljuc_iz_ts("export const BACKUP_KLJUC = 'abc';"), None);
    }

    /// Bez licence ili s licencom koju ovaj program nije izdao nema backup-a, i
    /// kad `b` u tokenu daje ispravne R2 podatke (pozitivan put traži pravi ključ
    /// izdavača — ručna provjera u Tauri aplikaciji).
    #[test]
    fn backup_pristup_bez_vazece_licence() {
        let p = crate::proba::proba("backup-pristup");
        let b = p.b();
        assert_eq!(backup_pristup(b), None);

        let k = SigningKey::from_bytes(&[7u8; 32]);
        let x = x_za(r#"{"a":"acc","k":"kid","s":"tajna","r":"age1primalac"}"#);
        let t = token_s_b(&k, &format!(r#"{{"c":"pazar-pekara","x":"{x}"}}"#));
        assert!(backup_podaci(&t).is_some());
        std::fs::write(b.user_data().join("licenca.json"), json!({ "token": t }).to_string()).unwrap();
        assert_eq!(stanje_licence(b).unwrap(), sa_uredjajem(json!({"stanje": "neispravna", "razlog": "potpis"})));
        assert_eq!(backup_pristup(b), None);
    }
}
