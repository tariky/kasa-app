//! Raspodjela kanala po domenama. Svaka domena u `obradi` vrati `None` za
//! kanal koji nije njen.

use crate::greska::{Greska, R};
use crate::{cash, izvoz, katalog, korisnici, licenca, ponude, postavke, proizvodnja, racuni, skladiste, uredjaj};
use crate::{Args, Backend};
use serde_json::Value;

/// Svi kanali backenda — isto što `ipcMain.handle` registruje u handlers.ts
/// (ugovorni test `sesija.ugovor.test.ts › lista kanala` ih poredi). Kanal van
/// liste ne postoji ni kad ga neka domena još zna.
pub const SVI_KANALI: &[&str] = &[
    "licenca:stanje", "licenca:aktiviraj",
    "user:login", "user:logout", "user:promijeniSvojPin", "user:getAll", "user:create", "user:update", "user:delete",
    "product:getAll", "product:get", "product:create", "product:update", "product:delete", "product:adjustStock", "product:search",
    "product:getDobavljacSifre", "product:setDobavljacSifre", "product:findByDobavljacSifra", "dobavljac:getSifre", "product:slobodan",
    "materijal:search", "dobavljac:getAll", "dobavljac:create", "dobavljac:update", "dobavljac:delete",
    "kupac:getAll", "kupac:search", "kupac:create", "kupac:update", "kupac:delete",
    "primka:getAll", "primka:get", "primka:nextBroj", "primka:create", "primka:update", "primka:delete",
    "primka:pregledUnosa", "primka:pregledIzmjene", "primka:pregledBrisanja", "nivelacija:getAll", "nivelacija:get",
    "order:getAll", "order:get", "order:createManual", "order:finalize", "order:finalizePrilog",
    "fiscal:getNumeracija", "fiscal:setZadnjiBroj", "prilog:getStavke", "prilog:saveStavke", "order:setDatumValute", "order:refundAndPrint",
    "pending:list", "pending:resolve", "pending:discard", "order:getFiscalGaps", "order:dismissFiscalGap",
    "ponuda:getAll", "ponuda:get", "ponuda:nextBroj", "ponuda:create", "ponuda:update", "ponuda:setStatus", "ponuda:delete", "ponuda:konvertuj",
    "nalog:getAll", "nalog:get", "nalog:nextBroj", "nalog:create", "nalog:createIzPonude", "nalog:zaPonudu", "nalog:update",
    "nalog:replaceStavke", "nalog:setStatus", "nalog:delete", "nalog:kalkulacija", "nalog:izdajRacun",
    "normativ:get", "normativ:save", "proizvodnja:setEnabled",
    "settings:getTring", "settings:saveTring", "settings:getFirma", "settings:get", "settings:set", "settings:saveFirma",
    "savedCarts:list", "savedCarts:save", "savedCarts:delete", "fakturaSkice:list", "fakturaSkice:save", "fakturaSkice:delete",
    "report:getData", "izvoz:knjigovodja",
    "tring:init", "tring:xReport", "tring:zReport", "tring:periodicReport", "tring:getLogs", "tring:clearLogs",
    "cash:add", "cash:retry", "cash:getToday", "cash:lastPolog", "cash:drawerState",
    "dialog:saveFile", "fs:writeFile", "db:backup", "db:restore",
];

fn ne_postoji(kanal: &str) -> Greska {
    Greska(format!("Kanal ne postoji: {kanal}"))
}

/// Nepostojeći kanal se odbija prije licence i sesije (u Electronu ga
/// `ipcRenderer.invoke` odbije jer nema handlera).
pub fn postoji(kanal: &str) -> R<()> {
    if SVI_KANALI.contains(&kanal) { Ok(()) } else { Err(ne_postoji(kanal)) }
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> R<Value> {
    postoji(kanal)?;
    let domena = kanal.split(':').next().unwrap_or("");
    let r = match domena {
        "licenca" => licenca::obradi(b, kanal, a),
        "user" => korisnici::obradi(b, kanal, a),
        "settings" | "savedCarts" | "fakturaSkice" | "proizvodnja" => postavke::obradi(b, kanal, a),
        "product" | "materijal" | "dobavljac" | "kupac" => katalog::obradi(b, kanal, a),
        "primka" | "nivelacija" | "report" => skladiste::obradi(b, kanal, a),
        "order" | "pending" | "prilog" | "fiscal" => racuni::obradi(b, kanal, a),
        "cash" => cash::obradi(b, kanal, a),
        "ponuda" => ponude::obradi(b, kanal, a),
        "nalog" | "normativ" => proizvodnja::obradi(b, kanal, a),
        "tring" | "dialog" | "fs" | "db" => uredjaj::obradi(b, kanal, a),
        "izvoz" => izvoz::obradi(b, kanal, a),
        _ => None,
    };
    r.unwrap_or_else(|| Err(ne_postoji(kanal)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sat::Sat;
    use crate::Platforma;

    struct BezDijaloga;
    impl Platforma for BezDijaloga {
        fn dijalog_sacuvaj(&self, _: Value) -> Option<String> { None }
        fn dijalog_otvori(&self, _: Value) -> Option<String> { None }
        fn dijalog_potvrda(&self, _: Value) -> i64 { 0 }
        fn restartuj_za(&self, _: u64) {}
    }

    /// Svaki kanal sa liste ima domenu koja ga obrađuje, a uklonjeni kanali
    /// (sirovi račun, storno, reklamacija, upis artikla, provjera admin PIN-a)
    /// ne postoje ni kad ih domena više ne zna.
    #[test]
    fn svaki_kanal_ima_handler() {
        let dir = std::env::temp_dir().join(format!("kasa-kanali-test-{}", std::process::id()));
        let b = Backend::novi(&dir, Box::new(BezDijaloga), Sat::sistemski(), false).unwrap();
        // Tring bez uređaja: veza se odbije odmah.
        b.db().unwrap().run("UPDATE settings SET value = '1' WHERE key = 'tring.port'", &[]).unwrap();
        b.sesija.postavi(Some(1), false);
        for kanal in SVI_KANALI {
            let r = b.call(kanal, vec![]);
            assert_ne!(r.as_ref().err(), Some(&format!("Kanal ne postoji: {kanal}")), "{kanal}");
            // Odjava bi zatvorila sesiju za ostale kanale.
            b.sesija.postavi(Some(1), false);
        }
        for kanal in [
            "order:create", "order:refund", "order:updateReklamacija", "tring:printReceipt", "tring:printRefund",
            "tring:writeArticle", "user:verifyAdminPin", "audit:getAll",
        ] {
            assert_eq!(b.call(kanal, vec![Value::Null]), Err(format!("Kanal ne postoji: {kanal}")));
        }
        let mut sortirani = SVI_KANALI.to_vec();
        sortirani.sort();
        sortirani.dedup();
        assert_eq!(sortirani.len(), SVI_KANALI.len(), "kanal naveden dvaput");
        drop(b);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
