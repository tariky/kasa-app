//! Sat backenda. U aplikaciji je to sistemski sat; ugovorni testovi ga
//! pomjeraju (`setSystemTime`), pa harness prije svakog poziva postavi vrijeme
//! iz test procesa.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use chrono::{DateTime, Datelike, Local, TimeZone, Utc};

#[derive(Clone, Default)]
pub struct Sat(Arc<AtomicI64>);

const SISTEMSKI: i64 = i64::MIN;

impl Sat {
    pub fn sistemski() -> Self {
        Sat(Arc::new(AtomicI64::new(SISTEMSKI)))
    }

    /// Fiksira sat na `ms` od epohe (JS `Date.now()`); `None` vraća sistemski.
    pub fn postavi(&self, ms: Option<i64>) {
        self.0.store(ms.unwrap_or(SISTEMSKI), Ordering::SeqCst);
    }

    /// `new Date()`
    pub fn sada(&self) -> DateTime<Local> {
        match self.0.load(Ordering::SeqCst) {
            SISTEMSKI => Local::now(),
            ms => Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now),
        }
    }

    /// `Date.now()` — ms od epohe.
    pub fn ms(&self) -> i64 {
        self.sada().timestamp_millis()
    }

    /// `localDateStr()` — YYYY-MM-DD po lokalnoj zoni.
    pub fn danas(&self) -> String {
        self.sada().format("%Y-%m-%d").to_string()
    }

    /// `new Date().getFullYear()`
    pub fn godina(&self) -> i32 {
        self.sada().year()
    }

    /// `new Date().toISOString()`
    pub fn iso(&self) -> String {
        self.sada().with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }
}
