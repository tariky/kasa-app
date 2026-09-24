//! Greška handlera: poruka koju renderer dobije (JS `Error.message`).

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub struct Greska(pub String);

pub type R<T> = Result<T, Greska>;

/// Interni znak za poništavanje transakcije pregleda (vidi `Db::tx`).
pub const PONISTI: &str = "\u{0}pregled: poništi";

impl Greska {
    pub fn nova(poruka: impl Into<String>) -> Self {
        Greska(poruka.into())
    }
    pub fn poruka(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Greska {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Greska {}

impl From<rusqlite::Error> for Greska {
    fn from(e: rusqlite::Error) -> Self {
        // better-sqlite3 prosljeđuje poruku SQLite-a ("UNIQUE constraint failed: …").
        match &e {
            rusqlite::Error::SqliteFailure(_, Some(msg)) => Greska(msg.clone()),
            _ => Greska(e.to_string()),
        }
    }
}

impl From<std::io::Error> for Greska {
    fn from(e: std::io::Error) -> Self {
        Greska(e.to_string())
    }
}

impl From<String> for Greska {
    fn from(s: String) -> Self {
        Greska(s)
    }
}

impl From<&str> for Greska {
    fn from(s: &str) -> Self {
        Greska(s.to_string())
    }
}

/// `throw new Error(format!(...))`
#[macro_export]
macro_rules! baci {
    ($($t:tt)*) => { return Err($crate::greska::Greska(format!($($t)*))) };
}
