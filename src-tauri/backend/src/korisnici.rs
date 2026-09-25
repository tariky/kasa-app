//! Kanali `user:*` (handlers.ts) i pravila iz `lib/korisnici.ts`: PIN-ovi,
//! heš, prijava, odjava i promjena svog PIN-a.

use hmac::Hmac;
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::greska::R;
use crate::js::{self, has};
use crate::sesija::{self, Korisnik, Pokusaji};
use crate::sql::Db;
use crate::{audit, baci, p, Args, Backend};

pub const ULOGE: [&str; 2] = ["admin", "kasir"];

/// PIN zadanog admina; prijava s njim traži promjenu PIN-a prije ulaska.
pub const ZADANI_PIN: &str = "0000";

/// Tabele s FK na users(id) — korisnik s ijednim redom u njima ne može biti obrisan.
pub const VEZE_KORISNIKA: [(&str, &str); 5] = [
    ("orders", "Korisnik ima račune i ne može biti obrisan"),
    ("pending_receipts", "Korisnik ima račun u obradi i ne može biti obrisan"),
    ("cash_movements", "Korisnik ima pologe/povrate gotovine i ne može biti obrisan"),
    ("ponude", "Korisnik ima ponude i ne može biti obrisan"),
    ("radni_nalozi", "Korisnik ima radne naloge i ne može biti obrisan"),
];

/// Baca grešku ako PIN nije niz od najmanje 4 cifre.
pub fn validiraj_pin(pin: &Value) -> R<&str> {
    if pin.is_null() || pin.as_str().is_some_and(|s| s.trim().is_empty()) {
        baci!("PIN je obavezan");
    }
    thread_local!(static CIFRE: Regex = Regex::new(r"^[0-9]+$").unwrap());
    let Some(s) = pin.as_str().filter(|s| CIFRE.with(|r| r.is_match(s))) else {
        baci!("PIN smije sadržavati samo cifre");
    };
    // JS `length` broji UTF-16 jedinice; cifre su ASCII.
    if s.len() < 4 {
        baci!("PIN mora imati najmanje 4 cifre");
    }
    Ok(s)
}

pub fn validiraj_ulogu(uloga: &Value) -> R<&str> {
    match uloga.as_str() {
        Some(u) if ULOGE.contains(&u) => Ok(u),
        _ => baci!("Uloga mora biti \"admin\" ili \"kasir\""),
    }
}

// ─── Heš PIN-a ──────────────────────────────────────────────
// Format: `pbkdf2$<iteracije>$<so hex>$<heš hex>` — PBKDF2-HMAC-SHA256, 16 B
// nasumične soli, 32 B izlaza. Isti format piše i čita TS backend
// (node:crypto), pa PIN heširan u jednom radi u drugom.

pub const PBKDF2_ITERACIJE: u32 = 100_000;
const SO_BAJTOVA: usize = 16;
const HES_BAJTOVA: usize = 32;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn iz_hexa(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or(0)).collect()
}

fn pbkdf2(pin: &str, so: &[u8], iteracije: u32) -> [u8; HES_BAJTOVA] {
    let mut hes = [0u8; HES_BAJTOVA];
    pbkdf2::pbkdf2::<Hmac<Sha256>>(pin.as_bytes(), so, iteracije, &mut hes).expect("HMAC prima ključ bilo koje dužine");
    hes
}

/// Heš PIN-a s datom soli (testovi); u programu ide nasumična (`hesiraj_pin`).
pub fn hesiraj_pin_sa_soli(pin: &str, so: &[u8]) -> String {
    format!("pbkdf2${PBKDF2_ITERACIJE}${}${}", hex(so), hex(&pbkdf2(pin, so, PBKDF2_ITERACIJE)))
}

pub fn hesiraj_pin(pin: &str) -> String {
    let mut so = [0u8; SO_BAJTOVA];
    getrandom::getrandom(&mut so).expect("sistemski izvor slučajnih bajtova");
    hesiraj_pin_sa_soli(pin, &so)
}

/// Da li je vrijednost iz kolone `users.pin` već heš (a ne stari PIN u čistom tekstu).
pub fn je_hes_pina(zapis: &str) -> bool {
    zapis.starts_with("pbkdf2$")
}

/// Da li `pin` odgovara zapisu. Neispravan zapis (ili čist tekst) nikad ne
/// odgovara. Iteracije se čitaju iz zapisa (manje od 100000 ili više od
/// 1000000 se odbija), a poređenje je konstantno-vremensko.
pub fn provjeri_pin(pin: &Value, zapis: &str) -> bool {
    thread_local!(static FORMAT_HESA: Regex = Regex::new(r"^pbkdf2\$([0-9]+)\$([0-9a-f]{32})\$([0-9a-f]{64})$").unwrap());
    let Some(pin) = pin.as_str() else { return false };
    let Some((iteracije, so, ocekivano)) = FORMAT_HESA.with(|r| {
        r.captures(zapis).map(|m| (m[1].to_string(), iz_hexa(&m[2]), iz_hexa(&m[3])))
    }) else {
        return false;
    };
    // `Number("000100000")` je 100000; predugačak niz cifara je van granica.
    let iteracije = iteracije.trim_start_matches('0').parse::<u64>().unwrap_or(u64::MAX);
    if iteracije < PBKDF2_ITERACIJE as u64 || iteracije > 10 * PBKDF2_ITERACIJE as u64 {
        return false;
    }
    let hes = pbkdf2(pin, &so, iteracije as u32);
    hes.ct_eq(&ocekivano).into()
}

// ─── Baza ───────────────────────────────────────────────────

/// Migracija: svaki PIN koji još nije heš postaje heš. Vraća broj izmijenjenih redova.
///
/// Stari seed je vraćao Admin/0000 pri svakom pokretanju nakon što je vlasnik
/// promijenio PIN zadanog admina, pa bi heširanje tog reda ostavilo živog
/// admina s PIN-om 0000. Zato se, dok još ima PIN-ova u čistom tekstu, admin
/// s PIN-om '0000' onemogući kad postoji drugi admin s drugačijim PIN-om:
/// obriše se ako ga ništa ne referencira, a inače dobije nasumičan heš s kojim
/// se niko ne može prijaviti. Ako je on jedini admin, ostaje (prijava traži
/// promjenu PIN-a). TS: `hesirajStarePinove` u lib/korisnici.ts.
pub fn hesiraj_stare_pinove(db: &Db) -> R<usize> {
    let redovi = db.all("SELECT id, ime, uloga, pin FROM users ORDER BY id", p![])?;
    let pin = |r: &Value| js::to_string(&r["pin"]);
    if redovi.iter().all(|r| je_hes_pina(&pin(r))) {
        return Ok(0);
    }

    let admin = |r: &Value| r["uloga"] == "admin";
    let ima_drugog_admina = redovi.iter().any(|r| {
        let p = pin(r);
        admin(r) && if je_hes_pina(&p) { !provjeri_pin(&json!(ZADANI_PIN), &p) } else { p != ZADANI_PIN }
    });
    let mut ugaseni: Vec<Value> = Vec::new();
    if ima_drugog_admina {
        for r in redovi.iter().filter(|r| admin(r) && pin(r) == ZADANI_PIN) {
            let mut referenciran = false;
            for (tabela, _) in VEZE_KORISNIKA {
                referenciran = referenciran || db.ima(&format!("SELECT 1 FROM {tabela} WHERE korisnikId = ? LIMIT 1"), p![r["id"]])?;
            }
            if referenciran {
                // Nasumičan PIN koji niko ne zna: red ostaje zbog računa/pologa, ali se s njim ne može prijaviti.
                let mut tajna = [0u8; 32];
                getrandom::getrandom(&mut tajna).expect("sistemski izvor slučajnih bajtova");
                db.run("UPDATE users SET pin = ? WHERE id = ?", p![hesiraj_pin(&hex(&tajna)), r["id"]])?;
            } else {
                db.run("DELETE FROM users WHERE id = ?", p![r["id"]])?;
            }
            audit::zapisi(db, None, "korisnik:zadaniUklonjen", json!({ "id": r["id"], "ime": r["ime"], "obrisan": !referenciran }))?;
            ugaseni.push(r["id"].clone());
        }
    }

    let mut n = ugaseni.len();
    for r in &redovi {
        if ugaseni.contains(&r["id"]) || je_hes_pina(&pin(r)) {
            continue;
        }
        db.run("UPDATE users SET pin = ? WHERE id = ?", p![hesiraj_pin(&pin(r)), r["id"]])?;
        n += 1;
    }
    Ok(n)
}

/// Zadani Admin/0000 — samo kad u bazi nema nijednog korisnika.
pub fn osiguraj_zadanog_admina(db: &Db) -> R<()> {
    if js::to_number(&db.val("SELECT COUNT(*) AS n FROM users", p![])?) > 0.0 {
        return Ok(());
    }
    db.run("INSERT INTO users (ime, pin, uloga) VALUES ('Admin', ?, 'admin')", p![hesiraj_pin(ZADANI_PIN)])?;
    Ok(())
}

/// JS `r.id === osimId` (id iz baze je broj; id iz payload-a je šta god je poslano).
fn isti_id(id: i64, osim: &Value) -> bool {
    osim.as_f64() == Some(id as f64)
}

/// Korisnik čiji PIN odgovara (opcionalno samo među adminima, osim datog id-a).
/// Provjerava se svaki red, bez ranog izlaza, da trajanje ne otkriva koji je
/// korisnik pogođen.
pub fn nadji_po_pinu(db: &Db, pin: &Value, samo_admin: bool, osim_id: Option<&Value>) -> R<Option<Korisnik>> {
    let mut nadjen = None;
    for r in db.all("SELECT id, ime, uloga, pin FROM users ORDER BY id", p![])? {
        let odgovara = provjeri_pin(pin, &js::to_string(&r["pin"]));
        if !odgovara || nadjen.is_some() {
            continue;
        }
        let id = r["id"].as_i64().unwrap_or(0);
        let uloga = js::to_string(&r["uloga"]);
        if samo_admin && uloga != "admin" {
            continue;
        }
        if osim_id.is_some_and(|o| isti_id(id, o)) {
            continue;
        }
        nadjen = Some(Korisnik { id, ime: r["ime"].clone(), uloga });
    }
    Ok(nadjen)
}

/// Da li `pin` već pripada nekom drugom korisniku (PIN je ujedno prijava, pa mora biti jedinstven).
pub fn pin_zauzet(db: &Db, pin: &Value, osim_id: Option<&Value>) -> R<bool> {
    Ok(nadji_po_pinu(db, pin, false, osim_id)?.is_some())
}

/// Da li `pin` odgovara PIN-u korisnika `id`.
pub fn pin_korisnika(db: &Db, id: i64, pin: &Value) -> R<bool> {
    Ok(db.get("SELECT pin FROM users WHERE id = ?", p![id])?.is_some_and(|r| provjeri_pin(pin, &js::to_string(&r["pin"]))))
}

/// Admin PIN za radnju kasira (storno). Neuspjeh ulazi u ograničenje
/// pokušaja; baca 'Neispravan admin PIN'. Uspjeh ne briše ranije neuspjehe.
pub fn provjeri_admin_pin(b: &Backend, pin: &Value) -> R<Korisnik> {
    let db = b.db()?;
    let pokusaji = Pokusaji::novi(db, b.sat.ms());
    pokusaji.provjeri()?;
    match nadji_po_pinu(db, pin, true, None)? {
        Some(admin) => Ok(admin),
        None => {
            pokusaji.neuspjeh()?;
            baci!("Neispravan admin PIN")
        }
    }
}

/// Admin koji je jedini admin u bazi — ne smije se obrisati ni degradirati.
fn je_posljednji_admin(db: &Db, id: &Value) -> R<bool> {
    if db.val("SELECT uloga FROM users WHERE id = ?", p![id])? != "admin" {
        return Ok(false);
    }
    Ok(db.val("SELECT COUNT(*) AS n FROM users WHERE uloga = 'admin'", p![])?.as_i64().unwrap_or(0) <= 1)
}

// ─── Kanali ─────────────────────────────────────────────────

fn login(b: &Backend, pin: &Value) -> R<Value> {
    // Nova prijava uvijek poništi staru sesiju, i kad ne uspije.
    b.sesija.postavi(None, false);
    let db = b.db()?;
    let pokusaji = Pokusaji::novi(db, b.sat.ms());
    pokusaji.provjeri()?;
    let Some(u) = nadji_po_pinu(db, pin, false, None)? else {
        pokusaji.neuspjeh()?;
        return Ok(Value::Null);
    };
    let zadani = pin.as_str() == Some(ZADANI_PIN);
    b.sesija.postavi(Some(u.id), zadani);
    let mut m = u.javni();
    m.insert("zadaniPin".into(), json!(zadani));
    Ok(Value::Object(m))
}

/// Prijavljeni korisnik mijenja svoj PIN (obavezno nakon prijave sa zadanim 0000).
/// Kanal ne smije postati proročište za tuđe PIN-ove: uspjeh ne briše neuspjehe,
/// zauzet PIN se broji kao neuspjeh, a i uspješne promjene su ograničene.
fn promijeni_svoj_pin(b: &Backend, stari: &Value, novi: &Value) -> R<Value> {
    let k = sesija::korisnik(b)?;
    let novi_pin = validiraj_pin(novi)?;
    if novi_pin == ZADANI_PIN {
        baci!("Novi PIN ne smije biti {ZADANI_PIN}");
    }
    let db = b.db()?;
    let sada = b.sat.ms();
    let pokusaji = Pokusaji::novi(db, sada);
    pokusaji.provjeri()?;
    b.sesija.provjeri_promjenu_pina(k.id, sada)?;
    if !pin_korisnika(db, k.id, stari)? {
        pokusaji.neuspjeh()?;
        baci!("Trenutni PIN nije tačan");
    }
    if pin_zauzet(db, novi, Some(&json!(k.id)))? {
        pokusaji.neuspjeh()?;
        baci!("Taj PIN je zauzet, odaberite drugi");
    }
    db.tx(|| {
        db.run("UPDATE users SET pin = ? WHERE id = ?", p![hesiraj_pin(novi_pin), k.id])?;
        audit::zabiljezi(b, "korisnik:promjenaPina", json!({ "id": k.id }))
    })?;
    b.sesija.zabiljezi_promjenu_pina(k.id, sada);
    b.sesija.ukloni_zadani_pin();
    Ok(json!({ "success": true }))
}

fn create(b: &Backend, data: &Value) -> R<Value> {
    let db = b.db()?;
    if js::blank(&data["ime"]) {
        baci!("Ime korisnika je obavezno");
    }
    let pin = validiraj_pin(&data["pin"])?;
    let uloga = validiraj_ulogu(&data["uloga"])?;
    if pin_zauzet(db, &data["pin"], None)? {
        baci!("Korisnik sa PIN-om \"{pin}\" već postoji");
    }
    let ime = js::trim(&data["ime"]);
    db.tx(|| {
        let r = db.run("INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)", p![ime, hesiraj_pin(pin), uloga])?;
        audit::zabiljezi(b, "korisnik:create", json!({ "id": r.last_insert_rowid, "ime": ime, "uloga": uloga }))?;
        Ok(json!({ "id": r.last_insert_rowid }))
    })
}

fn update(b: &Backend, id: &Value, data: &Value) -> R<Value> {
    let db = b.db()?;
    let mut fields: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();
    // Audit: nova imena i uloga, a za PIN samo da je promijenjen.
    let mut trag = Map::new();
    trag.insert("id".into(), id.clone());

    if has(data, "ime") {
        if js::blank(&data["ime"]) {
            baci!("Ime korisnika je obavezno");
        }
        fields.push("ime = ?");
        values.push(json!(js::trim(&data["ime"])));
        trag.insert("ime".into(), json!(js::trim(&data["ime"])));
    }
    // Prazan PIN = PIN ostaje kakav je (UI ga više ne zna, pa ga ne može ni poslati).
    if !data["pin"].is_null() && data["pin"] != "" {
        let pin = validiraj_pin(&data["pin"])?;
        if pin_zauzet(db, &data["pin"], Some(id))? {
            baci!("Korisnik sa PIN-om \"{pin}\" već postoji");
        }
        fields.push("pin = ?");
        values.push(json!(hesiraj_pin(pin)));
    }
    if has(data, "uloga") {
        let uloga = validiraj_ulogu(&data["uloga"])?;
        if uloga != "admin" && je_posljednji_admin(db, id)? {
            baci!("Posljednji administrator ne može postati kasir");
        }
        fields.push("uloga = ?");
        values.push(json!(uloga));
        trag.insert("uloga".into(), json!(uloga));
    }
    trag.insert("pinPromijenjen".into(), json!(fields.contains(&"pin = ?")));

    if fields.is_empty() {
        return Ok(json!({ "changes": 0 }));
    }
    values.push(id.clone());
    db.tx(|| {
        let r = db.run(&format!("UPDATE users SET {} WHERE id = ?", fields.join(", ")), &values)?;
        if r.changes > 0 {
            audit::zabiljezi(b, "korisnik:update", Value::Object(trag))?;
        }
        Ok(json!({ "changes": r.changes }))
    })
}

fn delete(b: &Backend, id: &Value) -> R<Value> {
    let db = b.db()?;
    for (tabela, poruka) in VEZE_KORISNIKA {
        if db.ima(&format!("SELECT 1 FROM {tabela} WHERE korisnikId = ? LIMIT 1"), p![id])? {
            baci!("{poruka}");
        }
    }
    if je_posljednji_admin(db, id)? {
        baci!("Posljednji administrator ne može biti obrisan");
    }
    db.tx(|| {
        let u = db.get("SELECT ime, uloga FROM users WHERE id = ?", p![id])?;
        let r = db.run("DELETE FROM users WHERE id = ?", p![id])?;
        if let Some(u) = u.filter(|_| r.changes > 0) {
            audit::zabiljezi(b, "korisnik:delete", json!({ "id": id, "ime": u["ime"], "uloga": u["uloga"] }))?;
        }
        Ok(json!({ "changes": r.changes }))
    })
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    Some(match kanal {
        "user:login" => login(b, &a[0]),
        "user:logout" => {
            b.sesija.postavi(None, false);
            Ok(json!({ "success": true }))
        }
        "user:promijeniSvojPin" => promijeni_svoj_pin(b, &a[0], &a[1]),
        "user:getAll" => db.all("SELECT id, ime, uloga FROM users ORDER BY ime", p![]).map(Value::from),
        "user:create" => create(b, &a[0]),
        "user:update" => update(b, &a[0], &a[1]),
        "user:delete" => delete(b, &a[0]),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Isti vektor kao ugovorni test "heš s poznatom soli" (node:crypto pbkdf2Sync).
    #[test]
    fn hes_kao_node_crypto() {
        let so = iz_hexa("00112233445566778899aabbccddeeff");
        let zapis = hesiraj_pin_sa_soli("7777", &so);
        assert_eq!(
            zapis,
            "pbkdf2$100000$00112233445566778899aabbccddeeff$d1cab965fe8763b4202ab041260f5c3e67b4d3e44d5ec0cdd6a61f1362769a57"
        );
        assert!(provjeri_pin(&json!("7777"), &zapis));
        assert!(!provjeri_pin(&json!("7778"), &zapis));
        assert!(!provjeri_pin(&json!(7777), &zapis));
    }

    #[test]
    fn neispravan_zapis_se_odbija() {
        let so = [7u8; 16];
        let mut slab = [0u8; 32];
        pbkdf2::pbkdf2::<Hmac<Sha256>>(b"5555", &so, 1000, &mut slab).unwrap();
        assert!(!provjeri_pin(&json!("5555"), &format!("pbkdf2$1000${}${}", hex(&so), hex(&slab))));
        assert!(!provjeri_pin(&json!("5555"), "5555"));
        assert!(!provjeri_pin(&json!("x"), "pbkdf2$100000$zz$zz"));
        assert!(!provjeri_pin(&json!("x"), &format!("pbkdf2$99999999999999999999999${}${}", hex(&so), hex(&slab))));
        let h = hesiraj_pin("1234");
        assert!(h.starts_with("pbkdf2$100000$") && provjeri_pin(&json!("1234"), &h));
        assert_ne!(h, hesiraj_pin("1234"));
    }
}
