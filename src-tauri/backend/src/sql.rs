//! Tanak sloj nad rusqlite-om u obliku better-sqlite3 API-ja koji koristi
//! TypeScript original: `all`/`get`/`run` s parametrima kao JSON vrijednostima,
//! redovi kao JSON objekti, i `tx` s istom semantikom kao `db.transaction(fn)()`
//! (ugniježdena transakcija je SAVEPOINT, greška radi rollback i ide dalje).

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};

use crate::greska::R;
use crate::petlja::Petlja;

pub struct Db {
    /// `None` = zatvorena; prvi upit je otvori (kao `getDb()`).
    conn: Mutex<Option<Connection>>,
    putanja: PathBuf,
    /// Aktivna baza programa: pri otvaranju ide schema + migracije + seed.
    aktivna: bool,
    petlja: Arc<Petlja>,
}

#[derive(Debug, Clone, Copy)]
pub struct Run {
    pub changes: i64,
    pub last_insert_rowid: i64,
}

/// Parametri upita: `p![a, b, c]` → `&[Value]` (bilo šta što ide u `json!`).
#[macro_export]
macro_rules! p {
    () => { &[] as &[serde_json::Value] };
    ($($x:expr),+ $(,)?) => { &[$(serde_json::json!($x)),+] as &[serde_json::Value] };
}

/// JS vrijednost kao SQLite parametar, kako ga veže bun:sqlite/better-sqlite3.
pub fn u_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                let x = n.as_f64().unwrap_or(f64::NAN);
                if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
                    SqlValue::Integer(x as i64)
                } else {
                    SqlValue::Real(x)
                }
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(crate::js::stringify(other)),
    }
}

/// SQLite vrijednost kao JSON (INTEGER/REAL su u JS-u isti `number`).
pub fn iz_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
    }
}

fn otvori_konekciju(putanja: &Path, mora_postojati: bool) -> R<Connection> {
    let conn = if mora_postojati {
        Connection::open_with_flags(
            putanja,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
        )?
    } else {
        Connection::open(putanja)?
    };
    // better-sqlite3 čeka zaključanu bazu 5 s prije SQLITE_BUSY.
    let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
    Ok(conn)
}

impl Db {
    /// Aktivna baza programa na `putanja` (otvara se odmah; schema + migracije + seed).
    pub fn aktivna(putanja: &Path, petlja: Arc<Petlja>) -> R<Db> {
        let db = Db { conn: Mutex::new(None), putanja: putanja.to_path_buf(), aktivna: true, petlja };
        db.otvori()?;
        Ok(db)
    }

    /// Otvara postojeći fajl read-write, bez kreiranja (`fileMustExist`) i bez scheme.
    pub fn otvori_postojecu(putanja: &Path) -> R<Db> {
        let conn = otvori_konekciju(putanja, true)?;
        Ok(Db { conn: Mutex::new(Some(conn)), putanja: putanja.to_path_buf(), aktivna: false, petlja: Arc::new(Petlja::nova()) })
    }

    /// Otvori ako je zatvorena (`getDb()`), s greškom ako otvaranje ili migracije puknu.
    pub fn otvori(&self) -> R<()> {
        let mut g = self.zakljucaj();
        if g.is_none() {
            *g = Some(self.nova_konekcija()?);
        }
        Ok(())
    }

    /// `closeDb()`
    pub fn zatvori(&self) {
        let stara = self.zakljucaj().take();
        drop(stara);
    }

    pub fn putanja(&self) -> &Path {
        &self.putanja
    }

    fn nova_konekcija(&self) -> R<Connection> {
        let conn = otvori_konekciju(&self.putanja, !self.aktivna)?;
        if !self.aktivna {
            return Ok(conn);
        }
        // Schema i migracije idu kroz isti API kao i ostatak koda, nad
        // privremenim Db-om koji posjeduje novu konekciju.
        let privremena = Db { conn: Mutex::new(Some(conn)), putanja: self.putanja.clone(), aktivna: false, petlja: Arc::new(Petlja::nova()) };
        crate::baza::inicijalizuj(&privremena)?;
        let conn = privremena.zakljucaj().take().expect("konekcija postoji");
        Ok(conn)
    }

    fn zakljucaj(&self) -> MutexGuard<'_, Option<Connection>> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Radi nad konekcijom (otvori je ako je zatvorena).
    fn sa<T>(&self, f: impl FnOnce(&Connection) -> R<T>) -> R<T> {
        let mut g = self.zakljucaj();
        if g.is_none() {
            *g = Some(self.nova_konekcija()?);
        }
        f(g.as_ref().unwrap())
    }

    fn red(imena: &[String], row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
        let mut m = Map::new();
        for (i, ime) in imena.iter().enumerate() {
            // Isto ime kolone dvaput (npr. `p.*, x AS id`): kao u JS objektu, pobjeđuje zadnja.
            m.insert(ime.clone(), iz_sql(row.get_ref(i)?));
        }
        Ok(Value::Object(m))
    }

    /// Svi redovi kao JSON objekti.
    pub fn all(&self, sql: &str, params: &[Value]) -> R<Vec<Value>> {
        self.sa(|c| {
            let mut stmt = c.prepare_cached(sql)?;
            let imena: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let vals: Vec<SqlValue> = params.iter().map(u_sql).collect();
            let mut rows = stmt.query(rusqlite::params_from_iter(vals.iter()))?;
            let mut out = Vec::new();
            while let Some(row) = rows.next()? {
                out.push(Db::red(&imena, row)?);
            }
            Ok(out)
        })
    }

    /// Prvi red ili `None` (JS `undefined`).
    pub fn get(&self, sql: &str, params: &[Value]) -> R<Option<Value>> {
        self.sa(|c| {
            let mut stmt = c.prepare_cached(sql)?;
            let imena: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let vals: Vec<SqlValue> = params.iter().map(u_sql).collect();
            let mut rows = stmt.query(rusqlite::params_from_iter(vals.iter()))?;
            match rows.next()? {
                Some(row) => Ok(Some(Db::red(&imena, row)?)),
                None => Ok(None),
            }
        })
    }

    /// Prva kolona prvog reda (`Null` kad reda nema).
    pub fn val(&self, sql: &str, params: &[Value]) -> R<Value> {
        self.sa(|c| {
            let mut stmt = c.prepare_cached(sql)?;
            let vals: Vec<SqlValue> = params.iter().map(u_sql).collect();
            let mut rows = stmt.query(rusqlite::params_from_iter(vals.iter()))?;
            match rows.next()? {
                Some(row) => Ok(iz_sql(row.get_ref(0)?)),
                None => Ok(Value::Null),
            }
        })
    }

    /// Da li upit vraća ijedan red (`!!db.prepare(...).get(...)`).
    pub fn ima(&self, sql: &str, params: &[Value]) -> R<bool> {
        Ok(self.get(sql, params)?.is_some())
    }

    pub fn run(&self, sql: &str, params: &[Value]) -> R<Run> {
        self.sa(|c| {
            let mut stmt = c.prepare_cached(sql)?;
            let vals: Vec<SqlValue> = params.iter().map(u_sql).collect();
            let changes = stmt.execute(rusqlite::params_from_iter(vals.iter()))? as i64;
            Ok(Run { changes, last_insert_rowid: c.last_insert_rowid() })
        })
    }

    pub fn exec(&self, sql: &str) -> R<()> {
        self.sa(|c| Ok(c.execute_batch(sql)?))
    }

    /// `PRAGMA x` kao niz redova (better-sqlite3 `db.pragma`).
    pub fn pragma(&self, izraz: &str) -> R<Vec<Value>> {
        self.all(&format!("PRAGMA {izraz}"), &[])
    }

    pub fn u_transakciji(&self) -> R<bool> {
        self.sa(|c| Ok(!c.is_autocommit()))
    }

    /// `db.transaction(fn)()`: BEGIN (ili SAVEPOINT kad je već u transakciji),
    /// COMMIT na uspjeh, ROLLBACK na grešku koja ide dalje.
    pub fn tx<T>(&self, f: impl FnOnce() -> R<T>) -> R<T> {
        let brojac = &self.petlja.transakcije;
        let d = brojac.load(Ordering::SeqCst);
        let ugnijezdena = d > 0 || self.u_transakciji()?;
        let ime = format!("tx{d}");
        self.exec(&if ugnijezdena { format!("SAVEPOINT {ime}") } else { "BEGIN".into() })?;
        brojac.store(d + 1, Ordering::SeqCst);
        let r = f();
        brojac.store(d, Ordering::SeqCst);
        match r {
            Ok(v) => {
                self.exec(&if ugnijezdena { format!("RELEASE {ime}") } else { "COMMIT".into() })?;
                Ok(v)
            }
            Err(e) => {
                if ugnijezdena {
                    let _ = self.exec(&format!("ROLLBACK TO {ime}; RELEASE {ime}"));
                } else if self.u_transakciji().unwrap_or(false) {
                    let _ = self.exec("ROLLBACK");
                }
                Err(e)
            }
        }
    }
}
