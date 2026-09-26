//! Sesija i uloge (`src/ipc/sesija.ts` i sesija u `registerIpcHandlers`).
//!
//! Backend drži prijavljenog korisnika i sam odlučuje ko smije zvati koji
//! kanal — renderer ne šalje ni korisnikId ni ulogu. Uloga se pri svakom
//! pozivu čita iz baze, pa izmjena ili brisanje korisnika važi odmah.
//!
//! Stanje sesije je iza `Mutex`-a koji se drži samo koliko traje čitanje ili
//! upis, nikad preko štampe na Tringu ili dijaloga (petlja se tada otpušta i
//! drugi pozivi rade — vidi petlja.rs).

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde_json::{json, Map, Value};

use crate::greska::{Greska, R};
use crate::js;
use crate::sql::Db;
use crate::{p, Backend};

pub const PORUKA_NISTE_PRIJAVLJENI: &str = "Niste prijavljeni";
pub const PORUKA_SAMO_ADMIN: &str = "Ovu radnju može izvršiti samo administrator";
pub const PORUKA_ZADANI_PIN: &str = "Prije rada promijenite zadani PIN 0000";

/// Jedini kanali (uz KANALI_BEZ_PRIJAVE) dok prijavljeni korisnik još ima zadani PIN.
pub const KANALI_SA_ZADANIM_PINOM: &[&str] = &["user:promijeniSvojPin", "user:logout"];

/// Kanali koji rade i bez prijave (ekran za prijavu i aktivaciju licence).
pub const KANALI_BEZ_PRIJAVE: &[&str] = &[
    "licenca:stanje", "licenca:aktiviraj",
    "user:login", "user:logout",
    // LoginScreen: naziv firme u lijevom panelu.
    "settings:getFirma",
    // settings:get samo za ključeve iz POSTAVKE_BEZ_PRIJAVE (vidi provjeri_pristup).
    "settings:get",
];

/// Postavke koje renderer čita prije prijave (skala ekrana, moduli na LoginScreenu).
pub const POSTAVKE_BEZ_PRIJAVE: &[&str] = &["ui.skala", "proizvodnja.enabled", "ui.showGenerator"];

/// Kanali koji mijenjaju stanje, a UI ih nudi samo administratoru (Postavke,
/// Knjigovođa tab) ili su sami po sebi administratorski.
pub const ADMIN_KANALI: &[&str] = &[
    "user:create", "user:update", "user:delete",
    "settings:saveFirma", "settings:saveTring",
    "proizvodnja:setEnabled",
    "fiscal:setZadnjiBroj", "order:dismissFiscalGap", "pending:discard",
    "db:backup", "db:restore",
    "izvoz:knjigovodja",
    // Dijagnostika fiskalnog uređaja (Postavke → Fiskalni); log sadrži i lozinku operatera.
    "tring:init", "tring:getLogs", "tring:clearLogs",
];

/// settings:set — ključevi koje smije postaviti svaki prijavljeni korisnik (KasaScreen).
pub const POSTAVKE_ZA_SVE: &[&str] = &["kasa.scanMode"];

/// settings:set — ključevi iz Postavki (samo administrator). Sve ostalo se odbija.
pub const POSTAVKE_ZA_ADMINA: &[&str] = &[
    // KasaGrupa
    "kasa.pologPrompt", "kasa.allowZeroStock", "kasa.kusurKalkulacija", "kasa.requirePinRefund",
    "kasa.showDailyTotal", "cijene.unosBezPdv",
    // FiskalniGrupa
    "racun.napomena", "dev.logging",
    // SistemGrupa
    "ui.skala",
    // LicencaGrupa
    "ui.showGenerator",
    // Postavke › Dokumenti (i nastavak numeracije iz starog programa) — isto što i
    // KLJUCEVI_DOKUMENATA u src/lib/dokumentPostavke.ts; ugovorni test ih provjerava sve.
    "dokumenti.faktura.rokDana", "dokumenti.faktura.nacinPlacanja", "dokumenti.faktura.napomena",
    "dokumenti.ponuda.vaziDana", "dokumenti.ponuda.uslovi", "dokumenti.ponuda.nacinPlacanja", "dokumenti.ponuda.prefiks",
    "dokumenti.ponuda.cifara", "dokumenti.ponuda.nastavakBroj", "dokumenti.ponuda.nastavakGodina",
    "dokumenti.nalog.prefiks", "dokumenti.nalog.nastavakBroj", "dokumenti.nalog.nastavakGodina",
    "dokumenti.podnozje", "dokumenti.pecat", "dokumenti.pecatVelicina",
    "dokumenti.kolone.sifra", "dokumenti.kolone.jm",
    "dokumenti.potpis.faktura.lijevo", "dokumenti.potpis.faktura.desno",
    "dokumenti.potpis.ponuda.lijevo", "dokumenti.potpis.ponuda.desno",
    "dokumenti.potpis.otpremnica.lijevo", "dokumenti.potpis.otpremnica.desno",
    "dokumenti.potpis.racun.lijevo", "dokumenti.potpis.racun.desno",
    "dokumenti.potpis.nalog.lijevo", "dokumenti.potpis.nalog.desno",
    "dokumenti.pecat.faktura", "dokumenti.pecat.ponuda", "dokumenti.pecat.otpremnica", "dokumenti.pecat.racun",
];

/// Postavke koje settings:get nikad ne vraća (ide null). Stanje blokade PIN-a
/// je interno: ni čitanje ni upis (settings:set ga ionako odbija, nije na listi).
pub const TAJNE_POSTAVKE: &[&str] = &["tring.operatorPassword", "sigurnost.pinBlokada"];

/// Korisnik kako ga vide kanali — nikad s PIN-om ni hešom.
#[derive(Debug, Clone)]
pub struct Korisnik {
    pub id: i64,
    pub ime: Value,
    pub uloga: String,
}

impl Korisnik {
    pub fn je_admin(&self) -> bool {
        self.uloga == "admin"
    }

    /// `{ id, ime, uloga }`
    pub fn javni(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("ime".into(), self.ime.clone());
        m.insert("uloga".into(), json!(self.uloga));
        m
    }
}

#[derive(Default)]
struct Prijava {
    /// Prijavljeni korisnik (jedan prozor = jedna sesija).
    id: Option<i64>,
    /// Prijava PIN-om 0000: dok ga ne promijeni, korisnik smije samo
    /// promijeniSvojPin i odjavu.
    zadani_pin: bool,
}

/// Stanje sesije u `Backend`-u. Restart programa (novi `Backend`) počinje bez
/// prijave i s praznim budžetom promjena PIN-a; blokada PIN-a je u bazi.
#[derive(Default)]
pub struct Sesija {
    prijava: Mutex<Prijava>,
    /// Uspješne promjene svog PIN-a po korisniku (ms), za OgranicenjePromjenaPina.
    promjene_pina: Mutex<HashMap<i64, Vec<f64>>>,
}

fn zakljucaj<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Sesija {
    pub fn id(&self) -> Option<i64> {
        zakljucaj(&self.prijava).id
    }

    pub fn zadani_pin(&self) -> bool {
        zakljucaj(&self.prijava).zadani_pin
    }

    /// Nova prijava (ili odjava s `None`).
    pub fn postavi(&self, id: Option<i64>, zadani_pin: bool) {
        let mut p = zakljucaj(&self.prijava);
        p.id = id;
        p.zadani_pin = zadani_pin;
    }

    pub fn ukloni_zadani_pin(&self) {
        zakljucaj(&self.prijava).zadani_pin = false;
    }
}

/// Korisnik iz baze po id-u (`SELECT id, ime, uloga FROM users WHERE id = ?`).
fn korisnik_po_id(db: &Db, id: i64) -> R<Option<Korisnik>> {
    Ok(db.get("SELECT id, ime, uloga FROM users WHERE id = ?", p![id])?.map(|r| Korisnik {
        id: r["id"].as_i64().unwrap_or(id),
        ime: r["ime"].clone(),
        uloga: js::to_string(&r["uloga"]),
    }))
}

/// Prijavljeni korisnik ili `None` (niko, ili je u međuvremenu obrisan).
pub fn trenutni(b: &Backend) -> R<Option<Korisnik>> {
    match b.sesija.id() {
        None => Ok(None),
        Some(id) => korisnik_po_id(b.db()?, id),
    }
}

/// Prijavljeni korisnik; kanal je već prošao provjeru pristupa, ali korisnik je mogao biti obrisan.
pub fn korisnik(b: &Backend) -> R<Korisnik> {
    trenutni(b)?.ok_or_else(|| Greska(PORUKA_NISTE_PRIJAVLJENI.into()))
}

/// `{ ...unos, korisnikId }` — payload s korisnikom iz sesije (vrijednost iz
/// payload-a nema efekta; ključ koji je već postojao ostaje na svom mjestu).
pub fn sa_korisnikom(unos: &Value, korisnik_id: i64) -> Value {
    let mut m = unos.as_object().cloned().unwrap_or_default();
    m.insert("korisnikId".into(), json!(korisnik_id));
    Value::Object(m)
}

/// Baca grešku ako `korisnik` (None = niko nije prijavljen) ne smije zvati
/// `kanal` s ovim argumentima. Poziva se prije handlera. `zadani_pin` =
/// korisnik se prijavio PIN-om 0000 i još ga nije promijenio: smije samo ono
/// što smije neprijavljen, plus promjenu svog PIN-a i odjavu.
pub fn provjeri_pristup(kanal: &str, args: &[Value], korisnik: Option<&Korisnik>, zadani_pin: bool) -> R<()> {
    let Some(k) = korisnik.filter(|_| !zadani_pin) else {
        if korisnik.is_some() && KANALI_SA_ZADANIM_PINOM.contains(&kanal) {
            return Ok(());
        }
        let poruka = if korisnik.is_some() { PORUKA_ZADANI_PIN } else { PORUKA_NISTE_PRIJAVLJENI };
        if !KANALI_BEZ_PRIJAVE.contains(&kanal) {
            return Err(Greska(poruka.into()));
        }
        let kljuc = args.first().and_then(Value::as_str);
        if kanal == "settings:get" && !kljuc.is_some_and(|k| POSTAVKE_BEZ_PRIJAVE.contains(&k)) {
            return Err(Greska(poruka.into()));
        }
        return Ok(());
    };
    if ADMIN_KANALI.contains(&kanal) && !k.je_admin() {
        return Err(Greska(PORUKA_SAMO_ADMIN.into()));
    }
    if kanal == "settings:set" {
        provjeri_upis_postavke(args.first().unwrap_or(&js::NULL), k)?;
    }
    Ok(())
}

fn provjeri_upis_postavke(kljuc: &Value, korisnik: &Korisnik) -> R<()> {
    let k = kljuc.as_str().unwrap_or("");
    if POSTAVKE_ZA_SVE.contains(&k) {
        return Ok(());
    }
    if !POSTAVKE_ZA_ADMINA.contains(&k) {
        return Err(Greska(format!("Postavka \"{k}\" se ne može mijenjati")));
    }
    if !korisnik.je_admin() {
        return Err(Greska(PORUKA_SAMO_ADMIN.into()));
    }
    Ok(())
}

// ─── Ograničenje pokušaja ───────────────────────────────────
// Zajednički brojač za svaku provjeru PIN-a (prijava, admin PIN pri stornu,
// promjena svog PIN-a). Neuspjesi se broje u kliznom prozoru od 15 min i uspjeh
// ih NE briše — inače bi "4 pogrešna + prijava svojim PIN-om" išlo u beskraj.
// Kad blokada jednom počne, eskalacija ostaje dok ne prođe 60 min bez ijednog
// neuspjeha: svaki novi neuspjeh blokira duplo duže (do 15 min), pa uporan
// napad dobije najviše jedan pokušaj u 15 min. Stanje je u bazi (postavka
// KLJUC_BLOKADE, nevidljiva za settings:get/set) i preživi restart programa.

pub const DOZVOLJENI_NEUSPJESI: usize = 5;
pub const PROZOR_NEUSPJEHA_MS: f64 = 15.0 * 60_000.0;
pub const PRVA_BLOKADA_MS: f64 = 30_000.0;
pub const NAJDUZA_BLOKADA_MS: f64 = 15.0 * 60_000.0;
/// Eskalacija se poništava tek kad ovoliko prođe bez ijednog neuspjeha.
pub const SMIRENJE_MS: f64 = 60.0 * 60_000.0;
/// Postavka u kojoj živi stanje blokade (JSON, vidi StanjeBlokade).
pub const KLJUC_BLOKADE: &str = "sigurnost.pinBlokada";

const UPSERT: &str = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";

pub fn poruka_blokade(preostalo_ms: f64) -> String {
    format!("Previše pogrešnih pokušaja. Pokušajte ponovo za {} s.", js::num_str((preostalo_ms / 1000.0).ceil()))
}

/// Stanje kako se upisuje: `neuspjesi` su vremena (ms) neuspjeha iz zadnjih
/// 60 min, rastuće; `trajanje` je zadnja blokada (0 = nema eskalacije);
/// `blokiranDo` je kraj tekuće blokade (ms).
#[derive(Debug, Clone, Default, PartialEq)]
struct StanjeBlokade {
    neuspjesi: Vec<f64>,
    trajanje: f64,
    blokiran_do: f64,
}

impl StanjeBlokade {
    fn json(&self) -> String {
        js::stringify(&json!({
            "neuspjesi": self.neuspjesi.iter().map(|x| js::f(*x)).collect::<Vec<_>>(),
            "trajanje": js::f(self.trajanje),
            "blokiranDo": js::f(self.blokiran_do),
        }))
    }
}

/// Stanje iz zapisa, svedeno na `sada`. Neispravan ili nepostojeći zapis =
/// čisto stanje (bez blokade). Sat vraćen unazad ne smije produžiti ni prozor
/// ni eskalaciju: neuspjeh "iz budućnosti" postaje `sada`, a blokada traje
/// najviše NAJDUZA_BLOKADA_MS od `sada`. Drugi član = nešto je svedeno i treba
/// ga upisati.
fn procitaj_stanje(zapis: Option<&str>, sada: f64) -> (StanjeBlokade, bool) {
    let mut s = StanjeBlokade::default();
    if let Some(Value::Object(z)) = zapis.and_then(|t| serde_json::from_str::<Value>(t).ok()) {
        let neuspjesi = z.get("neuspjesi").and_then(Value::as_array);
        let brojevi: Option<Vec<f64>> = neuspjesi.and_then(|a| a.iter().map(Value::as_f64).collect());
        if let (Some(n), Some(t), Some(d)) = (brojevi, z.get("trajanje").and_then(Value::as_f64), z.get("blokiranDo").and_then(Value::as_f64)) {
            s = StanjeBlokade { neuspjesi: n, trajanje: t, blokiran_do: d };
        }
    }
    let mut svedeno = false;
    if s.neuspjesi.iter().any(|&x| x > sada) {
        s.neuspjesi = s.neuspjesi.iter().map(|&x| x.min(sada)).collect();
        svedeno = true;
    }
    if s.blokiran_do > sada + NAJDUZA_BLOKADA_MS {
        s.blokiran_do = sada + NAJDUZA_BLOKADA_MS;
        svedeno = true;
    }
    (s, svedeno)
}

/// Ograničenje pokušaja nad bazom (`OgranicenjePokusaja` sa skladištem u `settings`).
pub struct Pokusaji<'a> {
    db: &'a Db,
    sada: f64,
}

impl<'a> Pokusaji<'a> {
    pub fn novi(db: &'a Db, sada_ms: i64) -> Self {
        Pokusaji { db, sada: sada_ms as f64 }
    }

    fn ucitaj(&self) -> R<Option<String>> {
        let v = self.db.val("SELECT value FROM settings WHERE key = ?", p![KLJUC_BLOKADE])?;
        Ok(if v.is_null() { None } else { Some(js::to_string(&v)) })
    }

    fn spremi(&self, s: &StanjeBlokade) -> R<()> {
        self.db.run(UPSERT, p![KLJUC_BLOKADE, s.json()])?;
        Ok(())
    }

    /// Baca grešku dok traje blokada — tada se PIN ni ne provjerava.
    pub fn provjeri(&self) -> R<()> {
        let t = self.sada;
        let (s, svedeno) = procitaj_stanje(self.ucitaj()?.as_deref(), t);
        if svedeno {
            self.spremi(&s)?;
        }
        let preostalo = s.blokiran_do - t;
        if preostalo > 0.0 {
            return Err(Greska(poruka_blokade(preostalo)));
        }
        Ok(())
    }

    /// Neuspjeh ulazi u prozor. Bez eskalacije: kad prozor od 15 min ima ≥ 5
    /// neuspjeha, blokada 30 s. Uz eskalaciju (bilo je blokade, a od zadnjeg
    /// neuspjeha nije prošlo 60 min): svaki neuspjeh blokira duplo duže od
    /// prethodne blokade, najviše 15 min.
    pub fn neuspjeh(&self) -> R<()> {
        let t = self.sada;
        let (mut s, _) = procitaj_stanje(self.ucitaj()?.as_deref(), t);
        match s.neuspjesi.last() {
            Some(&zadnji) if t - zadnji < SMIRENJE_MS => {}
            _ => s = StanjeBlokade::default(),
        }
        s.neuspjesi.retain(|&x| t - x < SMIRENJE_MS);
        s.neuspjesi.push(t);
        let u_prozoru = s.neuspjesi.iter().filter(|&&x| t - x < PROZOR_NEUSPJEHA_MS).count();
        if s.trajanje > 0.0 {
            s.trajanje = (s.trajanje * 2.0).min(NAJDUZA_BLOKADA_MS);
        } else if u_prozoru >= DOZVOLJENI_NEUSPJESI {
            s.trajanje = PRVA_BLOKADA_MS;
        }
        if s.trajanje > 0.0 {
            s.blokiran_do = t + s.trajanje;
        }
        self.spremi(&s)
    }
}

// ─── Promjena svog PIN-a ────────────────────────────────────
// Uspješna promjena otkriva da novi PIN nije ničiji, pa je i ona ograničena:
// najviše 3 po korisniku u 10 min (u memoriji — restart programa ga poništi).

pub const PROMJENA_PINA_MAKS: usize = 3;
pub const PROMJENA_PINA_PROZOR_MS: f64 = 10.0 * 60_000.0;

pub fn poruka_previse_promjena(preostalo_ms: f64) -> String {
    format!("Previše promjena PIN-a. Pokušajte ponovo za {} s.", js::num_str((preostalo_ms / 1000.0).ceil()))
}

impl Sesija {
    fn svjeze_promjene(&self, korisnik_id: i64, sada: f64) -> MutexGuard<'_, HashMap<i64, Vec<f64>>> {
        let mut m = zakljucaj(&self.promjene_pina);
        m.entry(korisnik_id).or_default().retain(|&x| sada - x < PROMJENA_PINA_PROZOR_MS);
        m
    }

    /// Baca grešku kad je korisnik iscrpio budžet uspješnih promjena PIN-a.
    pub fn provjeri_promjenu_pina(&self, korisnik_id: i64, sada_ms: i64) -> R<()> {
        let sada = sada_ms as f64;
        let m = self.svjeze_promjene(korisnik_id, sada);
        let lista = &m[&korisnik_id];
        if lista.len() >= PROMJENA_PINA_MAKS {
            return Err(Greska(poruka_previse_promjena(lista[0] + PROMJENA_PINA_PROZOR_MS - sada)));
        }
        Ok(())
    }

    pub fn zabiljezi_promjenu_pina(&self, korisnik_id: i64, sada_ms: i64) {
        let sada = sada_ms as f64;
        let mut m = self.svjeze_promjene(korisnik_id, sada);
        m.entry(korisnik_id).or_default().push(sada);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(uloga: &str) -> Korisnik {
        Korisnik { id: 2, ime: json!("K"), uloga: uloga.into() }
    }

    #[test]
    fn pristup() {
        let kasir = k("kasir");
        let admin = k("admin");
        let greska = |r: R<()>| r.err().map(|g| g.0);
        assert_eq!(greska(provjeri_pristup("product:getAll", &[], None, false)).as_deref(), Some(PORUKA_NISTE_PRIJAVLJENI));
        assert_eq!(greska(provjeri_pristup("user:login", &[], None, false)), None);
        assert_eq!(greska(provjeri_pristup("settings:get", &[json!("ui.skala")], None, false)), None);
        assert_eq!(greska(provjeri_pristup("settings:get", &[json!("tring.host")], None, false)).as_deref(), Some(PORUKA_NISTE_PRIJAVLJENI));
        assert_eq!(greska(provjeri_pristup("settings:get", &[json!(5)], None, false)).as_deref(), Some(PORUKA_NISTE_PRIJAVLJENI));
        // Zadani PIN: samo promjena PIN-a, odjava i pred-prijavni kanali.
        assert_eq!(greska(provjeri_pristup("user:promijeniSvojPin", &[], Some(&admin), true)), None);
        assert_eq!(greska(provjeri_pristup("user:promijeniSvojPin", &[], None, false)).as_deref(), Some(PORUKA_NISTE_PRIJAVLJENI));
        assert_eq!(greska(provjeri_pristup("cash:getToday", &[], Some(&admin), true)).as_deref(), Some(PORUKA_ZADANI_PIN));
        assert_eq!(greska(provjeri_pristup("settings:get", &[json!("tring.host")], Some(&admin), true)).as_deref(), Some(PORUKA_ZADANI_PIN));
        // Uloge i allowlista postavki.
        assert_eq!(greska(provjeri_pristup("db:backup", &[], Some(&kasir), false)).as_deref(), Some(PORUKA_SAMO_ADMIN));
        assert_eq!(greska(provjeri_pristup("db:backup", &[], Some(&admin), false)), None);
        assert_eq!(greska(provjeri_pristup("settings:set", &[json!("kasa.scanMode")], Some(&kasir), false)), None);
        assert_eq!(greska(provjeri_pristup("settings:set", &[json!("ui.skala")], Some(&kasir), false)).as_deref(), Some(PORUKA_SAMO_ADMIN));
        assert_eq!(
            greska(provjeri_pristup("settings:set", &[json!("tring.host")], Some(&admin), false)).as_deref(),
            Some("Postavka \"tring.host\" se ne može mijenjati")
        );
        assert_eq!(
            greska(provjeri_pristup("settings:set", &[json!(7)], Some(&admin), false)).as_deref(),
            Some("Postavka \"\" se ne može mijenjati")
        );
    }

    #[test]
    fn stanje_blokade_se_svodi_na_sada() {
        let (s, svedeno) = procitaj_stanje(Some(r#"{"neuspjesi":[100,5000],"trajanje":30000,"blokiranDo":99999999}"#), 1000.0);
        assert!(svedeno);
        assert_eq!(s, StanjeBlokade { neuspjesi: vec![100.0, 1000.0], trajanje: 30000.0, blokiran_do: 1000.0 + NAJDUZA_BLOKADA_MS });
        assert_eq!(s.json(), r#"{"neuspjesi":[100,1000],"trajanje":30000,"blokiranDo":901000}"#);
        // Neispravan zapis = čisto stanje.
        for z in [None, Some("x"), Some("5"), Some(r#"{"neuspjesi":["a"],"trajanje":0,"blokiranDo":0}"#), Some(r#"{"neuspjesi":[]}"#)] {
            assert_eq!(procitaj_stanje(z, 1.0), (StanjeBlokade::default(), false));
        }
        assert_eq!(poruka_blokade(12_500.0), "Previše pogrešnih pokušaja. Pokušajte ponovo za 13 s.");
    }
}
