//! Tabela kanala: svaka domena ima svoj `KANALI` (ime kanala → handler, kao
//! `handle(kanal, fn)` u handlers.ts), a ovdje se spajaju u jedan spisak.
//! Kanal kojeg nema u tabeli ne postoji.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde_json::Value;

use crate::greska::{Greska, R};
use crate::{cash, izvoz, katalog, korisnici, licenca, ponude, postavke, proizvodnja, racuni, skladiste, uredjaj};
use crate::{Args, Backend};

/// Kanal i njegov handler. Argumenti su redom kako ih šalje renderer.
pub struct Kanal {
    pub ime: &'static str,
    pub h: fn(&Backend, &Args) -> R<Value>,
}

/// Tabele domena, redom kao u handlers.ts.
const DOMENE: &[&[Kanal]] = &[
    licenca::KANALI,
    korisnici::KANALI,
    katalog::KANALI,
    skladiste::KANALI,
    racuni::KANALI,
    ponude::KANALI,
    proizvodnja::KANALI,
    postavke::KANALI,
    izvoz::KANALI,
    uredjaj::KANALI,
    cash::KANALI,
];

fn svi() -> impl Iterator<Item = &'static Kanal> {
    DOMENE.iter().flat_map(|d| d.iter())
}

/// Svi kanali backenda — isto što `ipcMain.handle` registruje u handlers.ts
/// (ugovorni test `sesija.ugovor.test.ts › lista kanala` ih poredi).
pub static SVI_KANALI: LazyLock<Vec<&'static str>> = LazyLock::new(|| svi().map(|k| k.ime).collect());

static PO_IMENU: LazyLock<HashMap<&'static str, &'static Kanal>> = LazyLock::new(|| svi().map(|k| (k.ime, k)).collect());

/// Kanal po imenu. Nepostojeći se odbija prije licence i sesije (u Electronu
/// ga `ipcRenderer.invoke` odbije jer nema handlera).
pub fn kanal(ime: &str) -> R<&'static Kanal> {
    PO_IMENU.get(ime).copied().ok_or_else(|| Greska(format!("Kanal ne postoji: {ime}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Svaki kanal je u tabeli tačno jednom, a uklonjeni kanali (sirovi račun,
    /// storno, reklamacija, upis artikla, provjera admin PIN-a, pretrage) ne
    /// postoje.
    #[test]
    fn tabela_kanala() {
        assert_eq!(PO_IMENU.len(), SVI_KANALI.len(), "kanal naveden dvaput");
        for kanal in [
            "order:create", "order:refund", "order:updateReklamacija", "tring:printReceipt", "tring:printRefund",
            "tring:writeArticle", "user:verifyAdminPin", "audit:getAll", "product:search", "kupac:search", "materijal:search",
        ] {
            assert_eq!(super::kanal(kanal).err(), Some(Greska(format!("Kanal ne postoji: {kanal}"))));
        }
    }
}
