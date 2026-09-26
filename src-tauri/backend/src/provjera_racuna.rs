//! Provjera računa i ponuda prije ikakve štampe ili upisa (`lib/provjeraRacuna.ts`)
//! i način plaćanja (`lib/placanje.ts`): renderer šalje stavke, a iznosi se
//! ovdje računaju iz njih (`izracunaj_totale`). Cijenu stavke kasir smije
//! mijenjati (ručni račun, ponuda, rabat na kasi), pa se ne poredi s
//! cjenovnikom — provjerava se samo da je smislena.

use serde_json::{json, Map, Value};

use crate::greska::R;
use crate::js::{self, round2};
use crate::sql::Db;
use crate::{baci, p, racun};

pub const PDV_STOPE: [&str; 2] = ["E", "K"];

/// Koliko iznos koji pošalje ekran smije odstupati od iznosa izračunatog iz
/// stavki (pola feninga; iznad toga backend odbija račun) — `TOLERANCIJA_IZNOSA`.
pub const TOLERANCIJA_IZNOSA: f64 = 0.005;

/// `typeof x === 'number' && Number.isFinite(x)` (JSON broj je uvijek konačan).
fn konacan(v: &Value) -> Option<f64> {
    v.as_f64().filter(|x| x.is_finite())
}

/// JS prikaz polja u poruci (`${x.polje}`): nepostojeće polje je "undefined".
pub fn prikaz_polja(o: &Value, k: &str) -> String {
    if js::has(o, k) { js::to_string(&o[k]) } else { "undefined".into() }
}

/// Količina, cijena i rabat jedne stavke (račun, ponuda, prilog): količina
/// konačan broj > 0, cijena konačan broj ≥ 0, rabat (nedostaje = 0) konačan
/// broj u [0, 100] — 100 % je stavka od 0 KM (kasa ga nudi).
pub fn provjeri_iznose_stavke(s: &Value) -> R<()> {
    if !konacan(&s["kolicina"]).is_some_and(|k| k > 0.0) {
        baci!("Količina mora biti veća od 0");
    }
    let Some(cijena) = konacan(&s["cijena"]) else {
        baci!("Cijena mora biti broj");
    };
    if cijena < 0.0 {
        baci!("Cijena ne može biti negativna");
    }
    let rabat = js::nn(&s["rabat"], &json!(0)).clone();
    if !konacan(&rabat).is_some_and(|r| (0.0..=100.0).contains(&r)) {
        baci!("Rabat mora biti od 0 do 100 %");
    }
    Ok(())
}

/// Stavka svedena na polja ugovora, s artiklom iz baze.
#[derive(Debug, Clone)]
pub struct ProvjerenaStavka {
    /// `{ productId, kolicina, cijena, rabat, pdvStopa }`
    pub stavka: Value,
    /// `{ sifra, naziv, jm, plu, tip, pdvStopa }` iz `products`.
    pub artikal: Value,
}

/// Provjeri svaku stavku (iznosi, stopa E/K, artikal postoji — productId mora
/// biti cijeli broj) i vrati je svedenu na polja ugovora. Prazna lista nije
/// greška ovdje: poruku za nju daje pozivalac.
pub fn provjeri_stavke(db: &Db, stavke: &Value) -> R<Vec<ProvjerenaStavka>> {
    let Some(stavke) = stavke.as_array() else {
        baci!("Neispravna stavka računa");
    };
    let mut out = Vec::with_capacity(stavke.len());
    for x in stavke {
        if !x.is_object() {
            baci!("Neispravna stavka računa");
        }
        provjeri_iznose_stavke(x)?;
        if !x["pdvStopa"].as_str().is_some_and(|s| PDV_STOPE.contains(&s)) {
            baci!("PDV stopa mora biti E ili K");
        }
        let artikal = if js::is_integer(&x["productId"]) {
            db.get("SELECT sifra, naziv, jm, plu, tip, pdvStopa FROM products WHERE id = ?", p![x["productId"]])?
        } else {
            None
        };
        let Some(artikal) = artikal else {
            baci!("Proizvod #{} ne postoji", prikaz_polja(x, "productId"));
        };
        out.push(ProvjerenaStavka {
            stavka: json!({
                "productId": x["productId"], "kolicina": x["kolicina"], "cijena": x["cijena"],
                "rabat": js::nn(&x["rabat"], &json!(0)), "pdvStopa": x["pdvStopa"],
            }),
            artikal,
        });
    }
    Ok(out)
}

/// `izracunajTotale` nad provjerenim stavkama.
pub fn totali(stavke: &[ProvjerenaStavka]) -> (f64, f64) {
    let s: Vec<Value> = stavke.iter().map(|s| s.stavka.clone()).collect();
    racun::izracunaj_totale(&s)
}

fn prikaz_iznosa(v: &Value) -> String {
    match konacan(v) {
        Some(x) => js::to_fixed(x, 2),
        None => js::stringify(v),
    }
}

/// Ukupno/PDV koje je poslao ekran smiju odstupati od izračunatih najviše
/// TOLERANCIJA_IZNOSA; izostavljeni (null) se ne provjeravaju. U bazu i na
/// uređaj uvijek ide izračunata vrijednost.
pub fn provjeri_totale(zadano: &Value, ukupno: f64, pdv_iznos: f64) -> R<()> {
    let provjeri = |vrijednost: &Value, tacno: f64, naziv: &str| -> R<()> {
        if vrijednost.is_null() {
            return Ok(());
        }
        if !konacan(vrijednost).is_some_and(|x| (x - tacno).abs() <= TOLERANCIJA_IZNOSA + 1e-9) {
            baci!("{naziv} ({}) ne odgovara stavkama ({})", prikaz_iznosa(vrijednost), js::to_fixed(tacno, 2));
        }
        Ok(())
    };
    provjeri(&zadano["ukupno"], ukupno, "Ukupan iznos")?;
    provjeri(&zadano["pdvIznos"], pdv_iznos, "Iznos PDV-a")
}

const POLJA_KUPCA: [&str; 5] = ["naziv", "idBroj", "adresa", "grad", "postanskiBroj"];

/// Kupac s računa: nema ga (null) ili je objekat čija su poznata polja tekst
/// (ili nedostaju). Ostala polja se odbacuju. Upis objekta u kolonu bi pao
/// tek nakon štampe. `None` = nema kupca (JS `undefined`).
pub fn provjeri_kupca(kupac: &Value) -> R<Option<Value>> {
    if kupac.is_null() {
        return Ok(None);
    }
    let Some(k) = kupac.as_object() else {
        baci!("Neispravni podaci kupca");
    };
    let mut rezultat = Map::new();
    for polje in POLJA_KUPCA {
        match k.get(polje) {
            None | Some(Value::Null) => continue,
            Some(Value::String(s)) => {
                rezultat.insert(polje.into(), json!(s));
            }
            Some(_) => baci!("Neispravni podaci kupca"),
        }
    }
    Ok(Some(Value::Object(rezultat)))
}

// ─── Način plaćanja (lib/placanje.ts) ───────────────────────

/// Načini plaćanja koje nude ekrani (u bazi se čuva "Ček" s kvačicom).
pub const NACINI_PLACANJA: [&str; 4] = ["Gotovina", "Kartica", "Virman", "Ček"];

/// Vrsta plaćanja, redom kao `NACINI_PLACANJA`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Vrsta {
    Gotovina,
    Kartica,
    Virman,
    Cek,
}

const VRSTE: [Vrsta; 4] = [Vrsta::Gotovina, Vrsta::Kartica, Vrsta::Virman, Vrsta::Cek];

impl Vrsta {
    /// Iz naziva ili JSON ključa, bez obzira na velika/mala slova; "cek" i
    /// "ček" su Ček (`VRSTE` u placanje.ts).
    fn iz(naziv: &str) -> Option<Vrsta> {
        match naziv.to_lowercase().as_str() {
            "gotovina" => Some(Vrsta::Gotovina),
            "kartica" => Some(Vrsta::Kartica),
            "virman" => Some(Vrsta::Virman),
            "cek" | "ček" => Some(Vrsta::Cek),
            _ => None,
        }
    }

    /// Naziv s liste `NACINI_PLACANJA`.
    fn naziv(self) -> &'static str {
        NACINI_PLACANJA[self as usize]
    }

    /// Ključ u JSON raspodjeli razbijenog plaćanja — oblik koji čita
    /// `raspodjela_placanja` (ladica, cash.rs) i knjigovođa.
    fn kljuc(self) -> &'static str {
        ["gotovina", "kartica", "virman", "cek"][self as usize]
    }
}

/// Način plaćanja iz payload-a: tekst s liste NACINI_PLACANJA (trimovan).
pub fn provjeri_nacin_placanja(nacin: &Value) -> R<&'static str> {
    provjerena_vrsta(nacin).map(Vrsta::naziv)
}

fn provjerena_vrsta(nacin: &Value) -> R<Vrsta> {
    let n = nacin.as_str().map(str::trim).unwrap_or("");
    if n.is_empty() {
        baci!("Način plaćanja je obavezan");
    }
    match VRSTE.into_iter().find(|v| v.naziv() == n) {
        Some(v) => Ok(v),
        None => baci!("Nepoznat način plaćanja: \"{n}\""),
    }
}

/// Plaćanje računa kako ide uređaju i u bazu: `(nacinPlacanja, vrstePlacanja)`.
/// `nacinPlacanja` je uvijek obavezan i s liste. Bez `vrstePlacanja` cijeli
/// iznos ide tim načinom. Razbijeno plaćanje: svaka vrsta s liste i najviše
/// jednom, iznos > 0 (na fening), zbir = ukupno. Tada se u bazu upisuje ono
/// što je uređaj dobio: jedna vrsta → njen naziv, više → JSON raspodjela
/// (`{"gotovina":3,"cek":2}`), da ladica i izvoz vide stvarnu gotovinu.
pub fn pripremi_placanje(nacin: &Value, vrste: &Value, ukupno: f64) -> R<(String, Value)> {
    let osnovni = provjeri_nacin_placanja(nacin)?;
    if vrste.is_null() || vrste.as_array().is_some_and(|a| a.is_empty()) {
        return Ok((osnovni.into(), json!([{ "oznaka": osnovni, "iznos": js::f(ukupno) }])));
    }
    let Some(vrste) = vrste.as_array() else {
        baci!("Neispravne vrste plaćanja");
    };

    let mut raspodjela: Vec<(Vrsta, f64)> = Vec::new();
    for v in vrste {
        // JS `typeof v !== 'object'` — niz je objekat.
        if !(v.is_object() || v.is_array()) {
            baci!("Neispravne vrste plaćanja");
        }
        let vrsta = provjerena_vrsta(&v["oznaka"])?;
        if !konacan(&v["iznos"]).is_some_and(|x| round2(x) > 0.0) {
            baci!("Iznos plaćanja mora biti veći od 0");
        }
        if raspodjela.iter().any(|(o, _)| *o == vrsta) {
            baci!("Način plaćanja \"{}\" je naveden više puta", vrsta.naziv());
        }
        raspodjela.push((vrsta, round2(v["iznos"].as_f64().unwrap_or(0.0))));
    }
    let zbir = round2(raspodjela.iter().fold(0.0, |s, (_, x)| s + x));
    if (zbir - ukupno).abs() > TOLERANCIJA_IZNOSA {
        baci!("Zbir plaćanja ({}) ne odgovara iznosu računa ({})", js::to_fixed(zbir, 2), js::to_fixed(ukupno, 2));
    }

    let vrste_placanja: Vec<Value> = raspodjela.iter().map(|(v, x)| json!({ "oznaka": v.naziv(), "iznos": js::f(*x) })).collect();
    let nacin_placanja = if raspodjela.len() == 1 {
        raspodjela[0].0.naziv().to_string()
    } else {
        let mut m = Map::new();
        for (v, x) in &raspodjela {
            m.insert(v.kljuc().into(), js::f(*x));
        }
        js::stringify(&Value::Object(m))
    };
    Ok((nacin_placanja, Value::Array(vrste_placanja)))
}

// ─── Čitanje upisanog načina plaćanja ───────────────────────
// Jedini parser za `orders.nacinPlacanja` (`raspodjelaPlacanja` u placanje.ts).

/// Iznosi po vrsti plaćanja (`Placanja` u placanje.ts).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Placanja {
    pub gotovina: f64,
    pub kartica: f64,
    pub virman: f64,
    pub cek: f64,
}

impl Placanja {
    fn iznos(&mut self, vrsta: Vrsta) -> &mut f64 {
        match vrsta {
            Vrsta::Gotovina => &mut self.gotovina,
            Vrsta::Kartica => &mut self.kartica,
            Vrsta::Virman => &mut self.virman,
            Vrsta::Cek => &mut self.cek,
        }
    }
}

/// JSON objekat iz upisanog načina plaćanja; `None` kad to nije (`jsonObjekat`).
fn json_objekat(nacin: &str) -> Option<Map<String, Value>> {
    match js::parse(nacin) {
        Ok(Value::Object(m)) => Some(m),
        _ => None,
    }
}

/// Stavka JSON raspodjele (`"gotovina": 3`) je ispravna samo kad je vrsta
/// poznata, a iznos konačan broj; inače cijela raspodjela nije ispravna (`None`).
fn stavka_raspodjele(kljuc: &str, iznos: &Value) -> Option<(Vrsta, f64)> {
    Some((Vrsta::iz(kljuc)?, iznos.as_f64().filter(|x| x.is_finite())?))
}

/// Način plaćanja → iznosi po vrsti (`raspodjelaPlacanja`). Tekst (bez
/// obzira na slova i razmake) nosi cijeli iznos, JSON objekat (ključevi bez
/// obzira na slova) je razbijeno plaćanje. `None` je nepoznat oblik
/// (`poznat: false`).
pub fn raspodjela_placanja(nacin: &str, ukupno: f64) -> Option<Placanja> {
    let mut iznosi = Placanja::default();
    if let Some(vrsta) = Vrsta::iz(nacin.trim()) {
        *iznosi.iznos(vrsta) = ukupno;
        return Some(iznosi);
    }
    let mut ima = false;
    for (k, v) in &json_objekat(nacin)? {
        let (vrsta, x) = stavka_raspodjele(k, v)?;
        if x == 0.0 {
            continue;
        }
        let iznos = iznosi.iznos(vrsta);
        *iznos = round2(*iznos + x);
        ima = true;
    }
    ima.then_some(iznosi)
}

/// Upisani način plaćanja u kanonskom obliku (`kanonskiNacinPlacanja`,
/// migracija starih zapisa): tekst → naziv s liste ("cek" je "Ček"); JSON
/// raspodjela → ključevi `gotovina`, `kartica`, `virman`, `cek`, iznosi
/// nepromijenjeni. Oblik koji `raspodjela_placanja` ne razumije (nepoznata
/// vrsta, iznos koji nije broj, ista vrsta dvaput) ostaje kakav jeste.
pub fn kanonski_nacin_placanja(nacin: &str) -> String {
    if let Some(vrsta) = Vrsta::iz(nacin.trim()) {
        return vrsta.naziv().into();
    }
    let Some(json) = json_objekat(nacin) else {
        return nacin.into();
    };
    let mut kanonski = Map::new();
    for (k, v) in &json {
        match stavka_raspodjele(k, v) {
            Some((vrsta, x)) if !kanonski.contains_key(vrsta.kljuc()) => {
                kanonski.insert(vrsta.kljuc().into(), js::f(x));
            }
            _ => return nacin.into(),
        }
    }
    js::stringify(&Value::Object(kanonski))
}

/// Račun iz payload-a (`order:finalize`, `order:createManual`), provjeren.
pub struct PripremljenRacun {
    pub stavke: Vec<ProvjerenaStavka>,
    pub ukupno: f64,
    pub pdv_iznos: f64,
    pub nacin_placanja: String,
    pub vrste_placanja: Value,
    /// `None` = nema kupca (JSON.stringify ga izostavlja).
    pub kupac: Option<Value>,
    /// `None` = nema napomene.
    pub napomena: Option<Value>,
}

/// Račun iz payload-a, provjeren redom: stavke (bar jedna, svaka ispravna),
/// stopa stavke = stopa artikla (samo uz `stopa_artikla` — kasa; ručni račun
/// prepisuje stari isječak), ukupno i PDV (provjeri_totale), plaćanje
/// (pripremi_placanje), kupac, napomena (tekst). Sva ostala polja payload-a se
/// ignorišu.
pub fn pripremi_racun(db: &Db, unos: &Value, stopa_artikla: bool) -> R<PripremljenRacun> {
    // Payload koji nije objekat tretira se kao `{}`.
    let prazan = json!({});
    let u = if unos.is_object() || unos.is_array() { unos } else { &prazan };
    if !u["stavke"].as_array().is_some_and(|a| !a.is_empty()) {
        baci!("Račun mora imati najmanje jednu stavku");
    }
    let stavke = provjeri_stavke(db, &u["stavke"])?;
    if stopa_artikla {
        for s in &stavke {
            if s.stavka["pdvStopa"] != s.artikal["pdvStopa"] {
                baci!(
                    "PDV stopa stavke \"{}\" ne odgovara artiklu ({})",
                    js::to_string(&s.artikal["naziv"]),
                    js::to_string(&s.artikal["pdvStopa"])
                );
            }
        }
    }
    let (ukupno, pdv_iznos) = totali(&stavke);
    provjeri_totale(u, ukupno, pdv_iznos)?;
    let (nacin_placanja, vrste_placanja) = pripremi_placanje(&u["nacinPlacanja"], &u["vrstePlacanja"], ukupno)?;
    let kupac = provjeri_kupca(&u["kupac"])?;
    let napomena = &u["napomena"];
    if !napomena.is_null() && !napomena.is_string() {
        baci!("Napomena mora biti tekst");
    }
    let napomena = (!napomena.is_null()).then(|| napomena.clone());
    Ok(PripremljenRacun { stavke, ukupno, pdv_iznos, nacin_placanja, vrste_placanja, kupac, napomena })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placanje() {
        assert_eq!(pripremi_placanje(&json!(" Kartica "), &Value::Null, 5.0).unwrap(), ("Kartica".into(), json!([{ "oznaka": "Kartica", "iznos": 5 }])));
        assert_eq!(
            pripremi_placanje(&json!("Gotovina"), &json!([{ "oznaka": "Gotovina", "iznos": 3 }, { "oznaka": "Ček", "iznos": 2.004 }]), 5.0).unwrap(),
            (r#"{"gotovina":3,"cek":2}"#.into(), json!([{ "oznaka": "Gotovina", "iznos": 3 }, { "oznaka": "Ček", "iznos": 2 }]))
        );
        let greska = |n: Value, v: Value| pripremi_placanje(&n, &v, 5.0).unwrap_err().0;
        assert_eq!(greska(json!(""), Value::Null), "Način plaćanja je obavezan");
        assert_eq!(greska(json!({ "gotovina": 5 }), Value::Null), "Način plaćanja je obavezan");
        assert_eq!(greska(json!(r#"{"gotovina":5}"#), Value::Null), r#"Nepoznat način plaćanja: "{"gotovina":5}""#);
        assert_eq!(greska(json!("Gotovina"), json!("x")), "Neispravne vrste plaćanja");
        assert_eq!(greska(json!("Gotovina"), json!([5])), "Neispravne vrste plaćanja");
        assert_eq!(greska(json!("Gotovina"), json!([{ "oznaka": "Kartica", "iznos": 0.004 }])), "Iznos plaćanja mora biti veći od 0");
        assert_eq!(
            greska(json!("Gotovina"), json!([{ "oznaka": "Kartica", "iznos": 1 }, { "oznaka": "Kartica", "iznos": 4 }])),
            "Način plaćanja \"Kartica\" je naveden više puta"
        );
        assert_eq!(greska(json!("Gotovina"), json!([{ "oznaka": "Kartica", "iznos": 4 }])), "Zbir plaćanja (4.00) ne odgovara iznosu računa (5.00)");
    }

    #[test]
    fn citanje_placanja() {
        let r = |n: &str| raspodjela_placanja(n, 8.0);
        let nula = Placanja::default();
        assert_eq!(r(" gotovina "), Some(Placanja { gotovina: 8.0, ..nula }));
        assert_eq!(r("cek"), Some(Placanja { cek: 8.0, ..nula }));
        assert_eq!(r("Ček"), Some(Placanja { cek: 8.0, ..nula }));
        assert_eq!(r(r#"{"Gotovina":5,"KARTICA":3,"virman":0}"#), Some(Placanja { gotovina: 5.0, kartica: 3.0, ..nula }));
        assert_eq!(r(r#"{"gotovina":1.005,"GOTOVINA":2}"#), Some(Placanja { gotovina: 3.01, ..nula }));
        for nepoznat in ["Bitcoin", "", "constructor", "[1]", "null", r#"{"gotovina":5,"zlato":3}"#, r#"{"gotovina":"5"}"#, r#"{"gotovina":0}"#, "{}"] {
            assert_eq!(r(nepoznat), None, "{nepoznat}");
        }

        let k = kanonski_nacin_placanja;
        assert_eq!(k("gotovina"), "Gotovina");
        assert_eq!(k(" Gotovina "), "Gotovina");
        assert_eq!(k("KARTICA"), "Kartica");
        assert_eq!(k("cek"), "Ček");
        assert_eq!(k("Cek"), "Ček");
        assert_eq!(k(r#"{"Gotovina":5,"Kartica":3}"#), r#"{"gotovina":5,"kartica":3}"#);
        assert_eq!(k(r#" {"KARTICA": 2.50, "Ček": 1} "#), r#"{"kartica":2.5,"cek":1}"#);
        assert_eq!(k(r#"{"gotovina":3,"gotovina":2}"#), r#"{"gotovina":2}"#);
        for isti in ["Bitcoin", " Bitcoin ", "", "5", "null", "[1,2]", r#""Gotovina""#, r#"{"gotovina":5,"zlato":3}"#, r#"{"gotovina":"5"}"#, r#"{"Gotovina":3,"gotovina":2}"#, r#"{"constructor":1}"#] {
            assert_eq!(k(isti), isti);
        }
        for n in ["gotovina", " Ček ", r#"{"Gotovina":5,"kartica":3}"#, r#"{"VIRMAN":1.25}"#, "Bitcoin"] {
            assert_eq!(k(&k(n)), k(n));
            assert_eq!(r(&k(n)), r(n));
        }
    }

    #[test]
    fn iznosi_stavke() {
        let greska = |s: Value| provjeri_iznose_stavke(&s).err().map(|g| g.0);
        assert_eq!(greska(json!({ "kolicina": 1, "cijena": 0, "rabat": 100 })), None);
        assert_eq!(greska(json!({ "kolicina": "2", "cijena": 1 })).as_deref(), Some("Količina mora biti veća od 0"));
        assert_eq!(greska(json!({ "kolicina": 1, "cijena": null })).as_deref(), Some("Cijena mora biti broj"));
        assert_eq!(greska(json!({ "kolicina": 1, "cijena": -1 })).as_deref(), Some("Cijena ne može biti negativna"));
        assert_eq!(greska(json!({ "kolicina": 1, "cijena": 1, "rabat": 100.5 })).as_deref(), Some("Rabat mora biti od 0 do 100 %"));
        assert_eq!(greska(json!({ "kolicina": 1, "cijena": 1, "rabat": null })), None);
        assert_eq!(provjeri_totale(&json!({ "ukupno": "5" }), 5.0, 0.73).unwrap_err().0, r#"Ukupan iznos ("5") ne odgovara stavkama (5.00)"#);
        assert_eq!(provjeri_totale(&json!({ "pdvIznos": 0 }), 5.0, 0.73).unwrap_err().0, "Iznos PDV-a (0.00) ne odgovara stavkama (0.73)");
        assert!(provjeri_totale(&json!({ "ukupno": 5.004, "pdvIznos": null }), 5.0, 0.73).is_ok());
        assert_eq!(provjeri_kupca(&json!({ "naziv": "A", "x": 1, "grad": null })).unwrap(), Some(json!({ "naziv": "A" })));
        assert_eq!(provjeri_kupca(&json!([])).unwrap_err().0, "Neispravni podaci kupca");
        assert_eq!(provjeri_kupca(&json!({ "idBroj": 42 })).unwrap_err().0, "Neispravni podaci kupca");
    }
}
