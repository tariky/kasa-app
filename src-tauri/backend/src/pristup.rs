//! Liste pristupa iz `src/ipc/pristup.json` — isti fajl čitaju sesija.ts i
//! licencaStanje.ts, pa su pravila ista u oba backenda. Ko smije koji kanal i
//! postavku odlučuje sesija.rs, a koji kanali ne rade bez licence licenca.rs.

use std::collections::HashSet;
use std::sync::OnceLock;

use serde_json::Value;

/// Liste pristupa (`pristup.json`).
pub struct Pristup {
    /// Kanali koji rade i bez prijave (ekran za prijavu i aktivaciju licence);
    /// settings:get samo za ključeve iz `postavke_bez_prijave` (vidi provjeri_pristup).
    pub kanali_bez_prijave: HashSet<String>,
    /// Jedini kanali (uz `kanali_bez_prijave`) dok prijavljeni korisnik još ima zadani PIN.
    pub kanali_sa_zadanim_pinom: HashSet<String>,
    /// Kanali koji mijenjaju stanje, a UI ih nudi samo administratoru (Postavke,
    /// Knjigovođa tab) ili su sami po sebi administratorski.
    pub admin_kanali: HashSet<String>,
    /// Kanali koji prave nove dokumente ili mijenjaju stanje zaliha — bez važeće
    /// licence blokirani (licenca.rs).
    pub blokirani_bez_licence: HashSet<String>,
    /// Postavke koje renderer čita prije prijave (skala ekrana, moduli na LoginScreenu).
    pub postavke_bez_prijave: HashSet<String>,
    /// settings:set — ključevi koje smije postaviti svaki prijavljeni korisnik (KasaScreen).
    pub postavke_za_sve: HashSet<String>,
    /// settings:set — ključevi iz Postavki (samo administrator). Sve ostalo se odbija.
    pub postavke_za_admina: HashSet<String>,
    /// Postavke koje settings:get nikad ne vraća (ide null). Stanje blokade PIN-a
    /// je interno: ni čitanje ni upis (settings:set ga ionako odbija, nije na listi).
    pub tajne_postavke: HashSet<String>,
}

pub fn pristup() -> &'static Pristup {
    static P: OnceLock<Pristup> = OnceLock::new();
    P.get_or_init(|| {
        let v: Value = serde_json::from_str(include_str!("../../../src/ipc/pristup.json")).expect("ispravan pristup.json");
        let lista = |put: &str| -> HashSet<String> {
            let niz = v.pointer(put).and_then(Value::as_array).unwrap_or_else(|| panic!("pristup.json nema liste {put}"));
            niz.iter().map(|x| x.as_str().unwrap_or_else(|| panic!("pristup.json {put}: {x} nije string")).to_owned()).collect()
        };
        Pristup {
            kanali_bez_prijave: lista("/kanaliBezPrijave"),
            kanali_sa_zadanim_pinom: lista("/kanaliSaZadanimPinom"),
            admin_kanali: lista("/adminKanali"),
            blokirani_bez_licence: lista("/blokiraniBezLicence"),
            postavke_bez_prijave: lista("/postavke/bezPrijave"),
            postavke_za_sve: lista("/postavke/zaSve"),
            postavke_za_admina: lista("/postavke/zaAdmina"),
            tajne_postavke: lista("/postavke/tajne"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pristup_json_se_parsira() {
        let p = pristup();
        for (ime, lista) in [
            ("kanaliBezPrijave", &p.kanali_bez_prijave),
            ("kanaliSaZadanimPinom", &p.kanali_sa_zadanim_pinom),
            ("adminKanali", &p.admin_kanali),
            ("blokiraniBezLicence", &p.blokirani_bez_licence),
            ("postavke.bezPrijave", &p.postavke_bez_prijave),
            ("postavke.zaSve", &p.postavke_za_sve),
            ("postavke.zaAdmina", &p.postavke_za_admina),
            ("postavke.tajne", &p.tajne_postavke),
        ] {
            assert!(!lista.is_empty(), "{ime} je prazna");
        }
    }
}
