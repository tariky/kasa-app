//! Automatski backup na R2 — isto što u Electronu rade `src/lib/backupRaspored.ts`,
//! `backupFajl.ts`, `backupTok.ts` i `src/ipc/backup.ts`. Spec:
//! docs/superpowers/specs/2026-09-25-r2-backup-design.md

use std::io::Write;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use serde_json::{json, Map, Value};

use crate::greska::{Greska, R};
use crate::kanali::Kanal;
use crate::licenca::{self, R2Podaci};
use crate::sat::iso_iz_ms;
use crate::{p, r2, Backend};

pub const INTERVAL_MS: i64 = 3 * 60 * 60 * 1000;
pub const PONOVO_NAKON_GRESKE_MS: i64 = 15 * 60 * 1000;
pub const ODGODA_STARTA_MS: i64 = 60 * 1000;
pub const TRAJNA_GRESKA_MS: i64 = 24 * 60 * 60 * 1000;

/// `userData/backup-stanje.json` (`BackupStanje`) — isti fajl i oblik kao u
/// Electron verziji (isti userData), van baze jer se baza backup-uje i vraća.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stanje {
    pub zadnji_uspjeh: Option<String>,
    pub zadnji_pokusaj: Option<String>,
    pub greska: Option<String>,
    /// Prvi pad u nizu; briše se uspjehom.
    pub greska_od: Option<String>,
}

impl Stanje {
    /// Iz pročitanog JSON-a: polje koje nije string se ignoriše, a sve što nije
    /// objekat je prazno stanje (ručno pokvaren fajl ne ruši backup).
    pub fn iz_json(v: &Value) -> Stanje {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Stanje { zadnji_uspjeh: s("zadnjiUspjeh"), zadnji_pokusaj: s("zadnjiPokusaj"), greska: s("greska"), greska_od: s("greskaOd") }
    }

    pub fn u_json(&self) -> Value {
        let mut m = Map::new();
        for (k, v) in [("zadnjiUspjeh", &self.zadnji_uspjeh), ("zadnjiPokusaj", &self.zadnji_pokusaj), ("greska", &self.greska), ("greskaOd", &self.greska_od)] {
            if let Some(v) = v {
                m.insert(k.into(), json!(v));
            }
        }
        Value::Object(m)
    }

    /// `s.greska` je istinit u JS-u (neprazan string).
    pub fn ima_gresku(&self) -> bool {
        self.greska.as_deref().is_some_and(|g| !g.is_empty())
    }
}

/// `Date.parse(iso)`; `None` je NaN.
fn ms(iso: Option<&str>) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso?).ok().map(|d| d.timestamp_millis())
}

/// Kada je sljedeći backup (`sljedeciBackup`). Pao pokušaj → pokušaj + 15 min;
/// inače uspjeh + 3 h (nikad uspjeha ili uspjeh "u budućnosti" zbog vraćenog
/// sata → odmah). Nikad prije `start + 1 min` ni prije `sada`.
pub fn sljedeci_backup(s: &Stanje, sada: i64, start: i64) -> i64 {
    let pokusaj = ms(s.zadnji_pokusaj.as_deref());
    let kandidat = match pokusaj {
        Some(p) if s.ima_gresku() && p <= sada => Some(p + PONOVO_NAKON_GRESKE_MS),
        _ => ms(s.zadnji_uspjeh.as_deref()).filter(|u| *u <= sada).map(|u| u + INTERVAL_MS),
    };
    kandidat.unwrap_or(i64::MIN).max(start + ODGODA_STARTA_MS).max(sada)
}

/// Backup pada i uspjeha nema duže od 24 h (`trajnaGreska`). Uspjeh kojeg nema,
/// koji se ne da pročitati ili je "u budućnosti" ne važi — računa se od `greskaOd`.
pub fn trajna_greska(s: &Stanje, sada: i64) -> bool {
    if !s.ima_gresku() {
        return false;
    }
    let od = match ms(s.zadnji_uspjeh.as_deref()) {
        Some(u) if u <= sada => Some(u),
        _ => ms(s.greska_od.as_deref()),
    };
    od.is_some_and(|od| sada - od > TRAJNA_GRESKA_MS)
}

/// `<uredjaj>/<UTC vrijeme>Z.db.age` (`imeBackupa`) — sekunde u imenu, pa se ništa ne prepisuje.
pub fn ime_backupa(uredjaj: &str, ms: i64) -> String {
    format!("{uredjaj}/{}Z.db.age", iso_iz_ms(ms)[..19].replace(':', "-"))
}

/// `sifrujBackup`: age(gzip(baza)) za X25519 primaoca `age1…`. Aplikacija ima
/// samo javni ključ — može šifrovati, ne i dešifrovati.
pub fn sifruj(baza: &[u8], primalac: &str) -> Result<Vec<u8>, String> {
    let primalac: age::x25519::Recipient = primalac.parse().map_err(|e| format!("Neispravan javni ključ za backup: {e}"))?;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(baza).map_err(|e| e.to_string())?;
    let gz = gz.finish().map_err(|e| e.to_string())?;
    age::encrypt(&primalac, &gz).map_err(|e| e.to_string())
}

// ─── Motor (backupTok.ts + ipc/backup.ts) ─────────────────────────

pub const NEMA_BACKUPA: &str = "Automatski backup nije uključen u licencu.";

fn zakljucaj<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Backup koji upravo teče; ko dođe dok traje, čeka njegov rezultat (`tekuci` promise).
#[derive(Default)]
struct Tekuci {
    info: Mutex<Option<Value>>,
    cv: Condvar,
}

impl Tekuci {
    fn zavrsi(&self, info: Value) {
        let mut g = zakljucaj(&self.info);
        if g.is_none() {
            *g = Some(info);
        }
        self.cv.notify_all();
    }

    fn cekaj(&self) -> Value {
        let mut g = zakljucaj(&self.info);
        while g.is_none() {
            g = self.cv.wait(g).unwrap_or_else(|e| e.into_inner());
        }
        g.clone().unwrap_or(Value::Null)
    }
}

/// Stanje motora (`napraviBackup`). Funkcije ispod zove neko ko drži petlju:
/// kanal, raspored (`tick`) ili posao nakon aktivacije licence.
pub struct Backup {
    /// Kad je backend pokrenut (ms): prvi backup ne ide prije start + 1 min.
    start: i64,
    /// Zadnje poznato stanje: i kad se fajl ne može upisati, raspored ne smije
    /// slati svake minute (svaki objekt je 14 dana zaključan i plaća se).
    memorija: Mutex<Option<Stanje>>,
    tekuci: Mutex<Option<Arc<Tekuci>>>,
    /// Ugovorni testovi (licenca otključana): R2 podaci umjesto licence
    /// (`postaviBackupLicencu`); `None` = licenca bez backup-a.
    testni_pristup: Mutex<Option<R2Podaci>>,
    /// `PAZAR_BACKUP_ENDPOINT` (lažni S3 u testovima); inače R2 po accountId.
    endpoint: Option<String>,
}

impl Backup {
    pub fn novi(start: i64) -> Self {
        Backup {
            start,
            memorija: Mutex::new(None),
            tekuci: Mutex::new(None),
            testni_pristup: Mutex::new(None),
            endpoint: std::env::var("PAZAR_BACKUP_ENDPOINT").ok().filter(|e| !e.is_empty()),
        }
    }

    /// Samo ugovor-server: šta "licenca" daje backup-u.
    pub fn postavi_testni_pristup(&self, r2: Option<R2Podaci>) {
        *zakljucaj(&self.testni_pristup) = r2;
    }
}

fn pristup(b: &Backend) -> Option<R2Podaci> {
    if !b.provjera_licence {
        return zakljucaj(&b.backup.testni_pristup).clone();
    }
    licenca::backup_pristup(b)
}

fn putanja_stanja(b: &Backend) -> std::path::PathBuf {
    b.user_data().join("backup-stanje.json")
}

fn stanje(b: &Backend) -> Stanje {
    zakljucaj(&b.backup.memorija)
        .get_or_insert_with(|| {
            std::fs::read_to_string(putanja_stanja(b))
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .map(|v| Stanje::iz_json(&v))
                .unwrap_or_default()
        })
        .clone()
}

fn pisi(b: &Backend, s: Stanje) {
    let json = serde_json::to_string_pretty(&s.u_json()).unwrap_or_default();
    *zakljucaj(&b.backup.memorija) = Some(s);
    if let Err(e) = std::fs::write(putanja_stanja(b), json) {
        eprintln!("Backup: stanje nije upisano: {e}");
    }
}

fn javi(b: &Backend, d: Value) {
    b.dogadjaj("backup:stanje", d);
}

/// `backup:info`
pub fn info(b: &Backend) -> Value {
    let u_toku = zakljucaj(&b.backup.tekuci).is_some();
    let Some(r2) = pristup(b) else { return json!({ "aktivan": false, "uToku": u_toku }) };
    let s = stanje(b);
    let mut o = json!({ "aktivan": true, "bucket": r2.bucket, "uToku": u_toku });
    if let Some(u) = s.zadnji_uspjeh.as_ref().filter(|u| !u.is_empty()) {
        o["zadnjiUspjeh"] = json!(u);
    }
    if s.ima_gresku() {
        o["greska"] = json!(s.greska);
        if let Some(od) = s.greska_od.as_ref().filter(|od| !od.is_empty()) {
            o["greskaOd"] = json!(od);
        }
    }
    o["sljedeci"] = json!(iso_iz_ms(sljedeci_backup(&s, b.sat.ms(), b.backup.start)));
    o
}

/// Dosljedna kopija baze: `VACUUM INTO` temp fajl na aktivnoj konekciji, pod
/// petljom — kao sinhroni better-sqlite3 u Electronu (desetine ms), pa ni
/// transakcija ni uvoz backup-a ne mogu upasti usred kopije. Temp fajl se briše.
fn kopija_baze(b: &Backend) -> Result<Vec<u8>, String> {
    let mut id = [0u8; 8];
    getrandom::getrandom(&mut id).map_err(|e| e.to_string())?;
    let ime: String = id.iter().map(|x| format!("{x:02x}")).collect();
    let cilj = std::env::temp_dir().join(format!("pazar-backup-{ime}.db"));
    let r = b
        .db()
        .run("VACUUM INTO ?", p![cilj.to_string_lossy().into_owned()])
        .map_err(|g| g.0)
        .and_then(|_| std::fs::read(&cilj).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&cilj);
    r
}

/// Jedan backup: kopija → šifrovanje → slanje; ishod ide u stanje i događaj,
/// nikad kao greška pozivaocu (kasa radi dalje).
fn izvrsi(b: &Backend, r2: &R2Podaci) {
    let pocetak = b.sat.ms();
    let pocetak_iso = iso_iz_ms(pocetak);
    pisi(b, Stanje { zadnji_pokusaj: Some(pocetak_iso.clone()), ..stanje(b) });
    let rezultat = (|| -> Result<(), String> {
        javi(b, json!({ "faza": "kopija", "procenat": 0 }));
        let baza = kopija_baze(b)?;
        // Šifrovanje i slanje traju (minute na sporoj vezi) — kasa za to vrijeme
        // radi, kao `await` u Electronu. Petlja se vraća na kraju ovog bloka.
        let _odmor = b.odmor();
        javi(b, json!({ "faza": "sifrovanje", "procenat": 0 }));
        let fajl = sifruj(&baza, &r2.primalac)?;
        javi(b, json!({ "faza": "slanje", "procenat": 0 }));
        let pristup = r2::Pristup {
            account_id: &r2.account_id,
            access_key_id: &r2.access_key_id,
            secret: &r2.secret,
            bucket: &r2.bucket,
            endpoint: b.backup.endpoint.as_deref(),
        };
        let mut zadnji = 0;
        let mut napredak = |poslano: u64, ukupno: u64| {
            let procenat = (poslano * 100).checked_div(ukupno).unwrap_or(100);
            if procenat > zadnji {
                zadnji = procenat;
                javi(b, json!({ "faza": "slanje", "procenat": procenat }));
            }
        };
        r2::posalji(&pristup, &ime_backupa(licenca::uredjaj_id(), pocetak), &fajl, &mut napredak, r2::CEKANJE).map_err(|e| e.za_korisnika())
    })();
    match rezultat {
        Ok(()) => {
            let kraj = b.sat.iso();
            pisi(b, Stanje { zadnji_uspjeh: Some(kraj.clone()), zadnji_pokusaj: Some(pocetak_iso), ..Default::default() });
            javi(b, json!({ "gotovo": kraj }));
        }
        Err(poruka) => {
            let s = stanje(b);
            let greska_od = s.greska_od.clone().or_else(|| Some(pocetak_iso.clone()));
            let novo = Stanje { zadnji_pokusaj: Some(pocetak_iso), greska: Some(poruka.clone()), greska_od, ..s };
            pisi(b, novo.clone());
            eprintln!("Backup nije uspio: {poruka}");
            javi(b, json!({ "greska": poruka, "trajnaGreska": trajna_greska(&novo, b.sat.ms()) }));
        }
    }
}

/// `backup:sada`: pokreće backup ili čeka tekući; vraća `backup:info` s kraja
/// (isti odgovor za sve koji su čekali). Pozivalac drži petlju; dok se čeka
/// tekući backup, petlja je slobodna.
pub fn sada(b: &Backend) -> R<Value> {
    let postojeci = zakljucaj(&b.backup.tekuci).clone();
    if let Some(t) = postojeci {
        let _odmor = b.odmor();
        return Ok(t.cekaj());
    }
    let r2 = pristup(b).ok_or_else(|| Greska::nova(NEMA_BACKUPA))?;
    let t = Arc::new(Tekuci::default());
    *zakljucaj(&b.backup.tekuci) = Some(t.clone());

    /// Kraj backup-a i kad `izvrsi` pukne (bug): tekući se oslobodi, a svi koji
    /// čekaju dobiju info — niko ne visi, raspored ide dalje.
    struct Kraj<'a>(&'a Backend, Arc<Tekuci>);
    impl Drop for Kraj<'_> {
        fn drop(&mut self) {
            *zakljucaj(&self.0.backup.tekuci) = None;
            self.1.zavrsi(info(self.0));
        }
    }
    let kraj = Kraj(b, t.clone());
    izvrsi(b, &r2);
    drop(kraj);
    Ok(t.cekaj())
}

/// Raspored (`tick`): Tauri ljuska ga zove svake minute; backup kad je vrijeme.
pub fn tick(b: &Backend) {
    b.u_redu(|| {
        if zakljucaj(&b.backup.tekuci).is_some() || pristup(b).is_none() {
            return;
        }
        let t = b.sat.ms();
        if t >= sljedeci_backup(&stanje(b), t, b.backup.start) {
            let _ = sada(b);
        }
    });
}

/// Nova licenca s backup-om: prvi backup odmah, u pozadini — to je i provjera
/// R2 podataka (`backupNakonAktivacije`).
pub fn nakon_aktivacije(b: &Backend) {
    if info(b)["aktivan"] == true {
        b.u_pozadini(Box::new(|b: &Backend| {
            b.u_redu(|| {
                let _ = sada(b);
            })
        }));
    }
}

pub const KANALI: &[Kanal] = &[
    Kanal { ime: "backup:info", h: |b, _| Ok(info(b)) },
    Kanal { ime: "backup:sada", h: |b, _| sada(b) },
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// 2026-09-25T08:00:00Z
    const START: i64 = 1_790_323_200_000;
    fn min(n: i64) -> i64 {
        START + n * 60_000
    }
    fn iso(ms: i64) -> Option<String> {
        Some(iso_iz_ms(ms))
    }

    #[test]
    fn iso_kao_js() {
        assert_eq!(iso_iz_ms(START), "2026-09-25T08:00:00.000Z");
        assert_eq!(iso_iz_ms(START + 7_123), "2026-09-25T08:00:07.123Z");
    }

    #[test]
    fn raspored() {
        let prazno = Stanje::default();
        // nikad uspjeha: minut nakon starta; aplikacija radi duže: odmah
        assert_eq!(sljedeci_backup(&prazno, START, START), min(1));
        assert_eq!(sljedeci_backup(&prazno, min(90), START), min(90));
        // uspjeh stariji od 3 h: minut nakon starta; prije sat vremena: uspjeh + 3 h
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-300)), ..Default::default() }, START, START), min(1));
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-60)), ..Default::default() }, START, START), min(120));
        // pao pokušaj: + 15 min, i kad uspjeha nikad nije bilo
        let pao = Stanje { zadnji_pokusaj: iso(min(10)), greska: Some("Nema veze s R2".into()), greska_od: iso(min(10)), ..Default::default() };
        assert_eq!(sljedeci_backup(&pao, min(11), START), min(25));
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(-600)), ..pao.clone() }, min(11), START), min(25));
        // pad prije pola sata, nakon restarta: minut nakon starta
        let star_pad = Stanje { zadnji_pokusaj: iso(min(-30)), greska: Some("x".into()), greska_od: iso(min(-30)), ..Default::default() };
        assert_eq!(sljedeci_backup(&star_pad, START, START), min(1));
        // sat vraćen unazad (uspjeh u budućnosti): ne čeka taj datum
        assert_eq!(sljedeci_backup(&Stanje { zadnji_uspjeh: iso(min(60 * 24 * 30)), ..Default::default() }, START, START), min(1));
        // pokušaj bez greške (ugašeno usred backup-a) nije greška
        let prekinut = Stanje { zadnji_uspjeh: iso(min(-60)), zadnji_pokusaj: iso(min(-5)), ..Default::default() };
        assert_eq!(sljedeci_backup(&prekinut, START, START), min(120));
        // prazan string greške je kao da je nema (JS falsy)
        let prazna = Stanje { zadnji_uspjeh: iso(min(-60)), zadnji_pokusaj: iso(min(-5)), greska: Some(String::new()), ..Default::default() };
        assert_eq!(sljedeci_backup(&prazna, START, START), min(120));
    }

    #[test]
    fn trajna() {
        let dan = 24 * 60;
        let g = |od: i64| Stanje { greska: Some("x".into()), greska_od: iso(min(od)), ..Default::default() };
        assert!(!trajna_greska(&Stanje::default(), START));
        assert!(!trajna_greska(&g(-dan + 1), START));
        assert!(trajna_greska(&g(-dan - 1), START));
        // uspjeh prije 30 h, greške tek sat vremena: i dalje nema uspjeha 24 h
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: iso(min(-30 * 60)), ..g(-60) }, START));
        assert!(!trajna_greska(&Stanje { zadnji_uspjeh: iso(min(-30 * 60)), ..Default::default() }, START));
        // uspjeh "u budućnosti" ili nečitljiv → računa se od greskaOd
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: iso(min(60)), ..g(-dan - 1) }, START));
        assert!(trajna_greska(&Stanje { zadnji_uspjeh: Some("nije datum".into()), ..g(-dan - 1) }, START));
        assert!(!trajna_greska(&Stanje { zadnji_uspjeh: iso(min(60)), ..g(-60) }, START));
    }

    #[test]
    fn stanje_json_kao_electron() {
        let v = serde_json::json!({ "zadnjiUspjeh": "2026-09-25T08:00:00.000Z", "zadnjiPokusaj": 5, "greska": "x", "visak": true });
        let s = Stanje::iz_json(&v);
        assert_eq!(s, Stanje { zadnji_uspjeh: Some("2026-09-25T08:00:00.000Z".into()), greska: Some("x".into()), ..Default::default() });
        assert_eq!(s.u_json(), serde_json::json!({ "zadnjiUspjeh": "2026-09-25T08:00:00.000Z", "greska": "x" }));
        assert_eq!(Stanje::iz_json(&serde_json::json!([1, 2])), Stanje::default());
        assert_eq!(Stanje::iz_json(&Value::Null), Stanje::default());
    }

    #[test]
    fn ime_objekta() {
        // 2026-09-25T15:00:07Z (isto kao r2.test.ts)
        assert_eq!(ime_backupa("3F9A-01C2-7B44", 1_790_348_407_000), "3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age");
    }

    #[test]
    fn sifrovanje_gzip_age() {
        let id = age::x25519::Identity::generate();
        let baza: Vec<u8> = b"SQLite format 3\0".iter().copied().chain((0..50_000u32).map(|i| (i % 7) as u8)).collect();
        let fajl = sifruj(&baza, &id.to_public().to_string()).unwrap();
        assert!(fajl.starts_with(b"age-encryption.org/v1\n"));
        let gz = age::decrypt(&id, &fajl).unwrap();
        assert_eq!(&gz[..2], &[0x1f, 0x8b]);
        let mut vraceno = Vec::new();
        flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut vraceno).unwrap();
        assert_eq!(vraceno, baza);
        assert!(sifruj(b"x", "nije-age-kljuc").unwrap_err().starts_with("Neispravan javni ključ za backup"));
    }

    /// Raspored nad pravim backendom, bez mreže: primalac koji nije age ključ
    /// obori backup prije slanja. Prvi pokušaj tek minut nakon starta, poslije
    /// pada ponovo tek za 15 min.
    #[test]
    fn tick_po_rasporedu() {
        let p = crate::proba::proba("backup-tick");
        let b = p.b();
        let fajl = || {
            let s = std::fs::read_to_string(b.user_data().join("backup-stanje.json")).ok()?;
            Some(Stanje::iz_json(&serde_json::from_str(&s).unwrap()))
        };
        let u = |minuta: i64| b.backup.start + minuta * 60_000;

        b.sat.postavi(Some(u(2)));
        tick(b); // licenca bez backup-a
        assert_eq!(fajl(), None);

        let r2 = R2Podaci {
            account_id: "acc".into(), access_key_id: "k".into(), secret: "s".into(),
            bucket: "pazar-test".into(), primalac: "nije-age-kljuc".into(),
        };
        b.backup.postavi_testni_pristup(Some(r2));
        b.sat.postavi(Some(b.backup.start + 30_000));
        tick(b); // prije start + 1 min
        assert_eq!(fajl(), None);

        b.sat.postavi(Some(u(2)));
        tick(b);
        let pao = fajl().unwrap();
        assert_eq!((pao.zadnji_pokusaj.as_deref(), pao.greska_od.as_deref()), (Some(&*iso_iz_ms(u(2))), Some(&*iso_iz_ms(u(2)))));
        assert!(pao.greska.unwrap().starts_with("Neispravan javni ključ za backup"));
        assert_eq!(info(b)["uToku"], false);

        b.sat.postavi(Some(u(16)));
        tick(b);
        assert_eq!(fajl().unwrap().zadnji_pokusaj, Some(iso_iz_ms(u(2))));

        b.sat.postavi(Some(u(17)));
        tick(b);
        let opet = fajl().unwrap();
        assert_eq!((opet.zadnji_pokusaj, opet.greska_od), (Some(iso_iz_ms(u(17))), Some(iso_iz_ms(u(2)))));
    }
}
