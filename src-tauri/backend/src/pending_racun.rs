//! Write-ahead računa (`lib/pendingRacun.ts`). Snapshot u pending_receipts se
//! upiše prije štampe, a briše tek kad je ishod poznat — neuspjeh sa sigurnim
//! ishodom ga briše, nepoznat ishod ga ostavlja za dijalog nezavršenih
//! računa, a uspjeh ga briše u istoj transakciji s upisom računa
//! (docs/superpowers/specs/2026-07-06-crash-safe-racuni-design.md).
//!
//! Ponuda→račun, nalog→račun i storno idu kroz isti red; snapshot nosi
//! `vrsta` ('ponuda' | 'nalog' | 'storno') da dijalog zna kojom operacijom ga
//! upisati. Snapshot bez `vrsta` je običan račun (kasa, faktura) — stare baze.

use serde_json::{json, Value};

use crate::greska::R;
use crate::js::{self, or};
use crate::sql::Db;
use crate::tring::{self, Odgovor};
use crate::{baci, p};

/// Štampa nije uspjela. Siguran neuspjeh (uređaj odbio, veza odbijena) briše
/// write-ahead red; nepoznat ishod ga ostavlja i vraća poruku koja operatera
/// šalje u dijalog nezavršenih računa (`ishodNepoznat: true` za renderer).
pub fn neuspjela_stampa(db: &Db, pending_id: i64, result: &Odgovor) -> R<Value> {
    // `result.error || result.vrstaOdgovora || 'Nepoznata greška'`, `result.odgovori ?? {}`
    let greska = or(&result["error"], or(&result["vrstaOdgovora"], &json!("Nepoznata greška"))).clone();
    let odgovori = js::nn(&result["odgovori"], &json!({})).clone();
    if tring::ishod_nepoznat(result) {
        return Ok(json!({
            "success": false,
            "error": format!(
                "Uređaj nije potvrdio račun ({}) — ishod štampe nije poznat. \
                 Provjerite da li je račun odštampan i riješite ga u dijalogu nezavršenih računa.",
                js::to_string(&greska)
            ),
            "odgovori": odgovori,
            "ishodNepoznat": true,
        }));
    }
    db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?;
    Ok(json!({ "success": false, "error": greska, "odgovori": odgovori }))
}

/// Tekst odgovora `vec_evidentiran`.
pub fn poruka_vec_evidentiran(broj_fiskalnog_racuna: &Value) -> String {
    format!(
        "Fiskalni račun BF {} JE odštampan, ali je njegov nezavršeni zapis u međuvremenu riješen ili odbačen — \
         račun je već evidentiran i drugi zapis nije napravljen. Ako je zapis odbačen, unesite račun ručno.",
        if broj_fiskalnog_racuna.is_null() { "?".to_string() } else { js::to_string(broj_fiskalnog_racuna) }
    )
}

/// Prvi korak transakcije upisa nakon uspješne štampe: obriše write-ahead red i
/// time preuzme račun. `false` = red više ne postoji (riješen ili odbačen iz
/// dijaloga dok je štampa trajala) — pozivalac tada ne upisuje drugi zapis
/// istog računa nego vraća `vec_evidentiran(...)`.
pub fn preuzmi_pending_red(db: &Db, pending_id: i64) -> R<bool> {
    Ok(db.run("DELETE FROM pending_receipts WHERE id = ?", p![pending_id])?.changes == 1)
}

/// Račun je odštampan i već upisan iz dijaloga — ekran ga tretira kao završen,
/// bez novog id-a (`vecEvidentiran: true`).
pub fn vec_evidentiran(broj_fiskalnog_racuna: &Value) -> Value {
    json!({
        "success": false,
        "vecEvidentiran": true,
        "error": poruka_vec_evidentiran(broj_fiskalnog_racuna),
        "brojFiskalnogRacuna": broj_fiskalnog_racuna,
    })
}

/// Kupac u snapshotu ponude/naloga (`snapshotKupca`): samo polja računa.
pub fn snapshot_kupca(k: &Option<Value>) -> Value {
    match k {
        Some(k) => json!({
            "naziv": k["naziv"], "idBroj": k["idBroj"], "adresa": k["adresa"],
            "grad": k["grad"], "postanskiBroj": k["postanskiBroj"],
        }),
        None => Value::Null,
    }
}

/// Write-ahead: snapshot se upiše (odmah, van transakcije) prije štampe.
pub fn zapisi_pending(db: &Db, korisnik_id: &Value, snapshot: &Value) -> R<i64> {
    Ok(db
        .run("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)", p![korisnik_id, js::stringify(snapshot)])?
        .last_insert_rowid)
}

/// Nova štampa dokumenta za koji postoji nerazriješen write-ahead red mogla bi
/// dati drugi fiskalni račun za isti posao — odbija se prije štampe, dok
/// operater ne riješi red (odštampan) ili ga admin ne odbaci. `kljuc` je polje
/// snapshota (i stara faktura iz ponude nosi `ponudaId`); obje strane se
/// porede kao cijeli brojevi. TS: `baciAkoCekaNezavrsen`.
pub fn baci_ako_ceka_nezavrsen(db: &Db, kljuc: &str, id: &Value, dokument: &str) -> R<()> {
    let ceka = db.ima(
        "
    SELECT id FROM pending_receipts
    WHERE CAST(CASE WHEN json_valid(snapshot) THEN json_extract(snapshot, ?) END AS INTEGER) = CAST(? AS INTEGER)
    LIMIT 1
  ",
        p![format!("$.{kljuc}"), id],
    )?;
    if ceka {
        baci!("{dokument} čeka u nezavršenim računima (ishod štampe nije poznat) — riješite ga prije nove štampe");
    }
    Ok(())
}
