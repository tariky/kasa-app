//! Automatski backup na R2 — isto što u Electronu rade `src/lib/backupRaspored.ts`,
//! `backupFajl.ts`, `backupTok.ts` i `src/ipc/backup.ts`. Spec:
//! docs/superpowers/specs/2026-09-25-r2-backup-design.md

use std::io::Write;

use serde_json::{json, Map, Value};

use crate::sat::iso_iz_ms;

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
}
