//! Kanali `primka:*`, `nivelacija:*`, `report:getData` (handlers.ts) i logika
//! iz `lib/skladiste.ts`.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::greska::{self, Greska, R};
use crate::js;
use crate::p;
use crate::sql::Db;
use crate::katalog::razlicito;
use crate::{audit, baci, Args, Backend};

/// Tolerancija pri poređenju cijena (fening).
const EPS: f64 = 0.001;

/// Ključ za JS `Map`/`Set` po productId: `5` i `"5"` su različiti ključevi, kao u JS-u.
fn kljuc(v: &Value) -> String {
    js::stringify(v)
}

/// Polje objekta kao JS `obj.k` — `None` je `undefined` (nema ključa ili nije objekat).
fn polje<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    v.get(k)
}

/// `obj.k` u aritmetici: `undefined` → NaN, `null` → 0 (JS `Number(...)`).
fn broj(v: Option<&Value>) -> f64 {
    v.map(js::to_number).unwrap_or(f64::NAN)
}

/// `obj.k ?? null`
fn ili_null(v: Option<&Value>) -> Value {
    v.cloned().unwrap_or(Value::Null)
}

/// `String(obj.k)` — nepostojeće polje je "undefined".
fn tekst(v: Option<&Value>) -> String {
    v.map(js::to_string).unwrap_or_else(|| "undefined".into())
}

/// Niz iz vrijednosti (`data.stavke`); nije niz → prazan.
fn niz(v: &Value) -> &[Value] {
    v.as_array().map(|a| a.as_slice()).unwrap_or(&[])
}

/// Promjena prodajne cijene artikla (`PriceChange`).
#[derive(Clone)]
struct PriceChange {
    product_id: Value,
    kolicina: Value,
    stara_cijena: Value,
    nova_cijena: Value,
    pdv_stopa: Value,
}

impl PriceChange {
    fn za_historiju(c: &[PriceChange]) -> Vec<(Value, Value, Value)> {
        c.iter().map(|c| (c.product_id.clone(), c.stara_cijena.clone(), c.nova_cijena.clone())).collect()
    }
}

/// Trenutno stanje artikla izračunato iz kretanja zaliha.
fn get_product_stock(db: &Db, product_id: &Value) -> R<Value> {
    db.val(
        "
    SELECT COALESCE(
      SUM(CASE WHEN tip = 'ulaz' THEN kolicina ELSE -kolicina END), 0
    ) AS stanje
    FROM stock_movements WHERE productId = ?
  ",
        p![product_id],
    )
}

/// Razvrsta izmjene prodajne cijene sa primke u dvije grupe (dedup po artiklu):
///  - `nivelacija` — artikli sa zalihom; razlika se mora dokumentovati,
///  - `bez_zaliha` — artikli bez zalihe; nema šta da se nivelira, ali nova
///    cijena i dalje mora ući u šifarnik, inače se artikal nastavi prodavati
///    po staroj cijeni.
///
/// Mora se pozvati PRIJE upisa ulaza da bi zaliha odražavala stanje prije primke.
fn collect_price_changes<'a>(db: &Db, stavke: impl IntoIterator<Item = &'a Value>) -> R<(Vec<PriceChange>, Vec<PriceChange>)> {
    let mut nivelacija = Vec::new();
    let mut bez_zaliha = Vec::new();
    let mut seen = HashSet::new();

    for stavka in stavke {
        let pid = ili_null(polje(stavka, "productId"));
        if !seen.insert(kljuc(&pid)) {
            continue;
        }
        let Some(product) = db.get("SELECT cijena, tip FROM products WHERE id = ?", p![pid])? else { continue };
        if product["tip"] == "materijal" {
            continue;
        }
        if (js::to_number(&product["cijena"]) - broj(polje(stavka, "cijena"))).abs() <= EPS {
            continue;
        }

        let existing_stock = get_product_stock(db, &pid)?;
        let change = PriceChange {
            product_id: pid,
            kolicina: existing_stock.clone(),
            stara_cijena: product["cijena"].clone(),
            nova_cijena: ili_null(polje(stavka, "cijena")),
            pdv_stopa: ili_null(polje(stavka, "pdvStopa")),
        };
        if js::to_number(&existing_stock) > 0.0 {
            nivelacija.push(change);
        } else {
            bez_zaliha.push(change);
        }
    }
    Ok((nivelacija, bez_zaliha))
}

/// Upiše nove prodajne cijene u šifarnik. Dokument (nivelaciju) za artikle sa
/// zalihom pravi pozivalac — vidi `promjene_u_prodaji`.
fn upisi_cijene(db: &Db, changes: &[PriceChange]) -> R<()> {
    for c in changes {
        db.run("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?", p![c.nova_cijena, c.product_id])?;
    }
    Ok(())
}

/// Stara prodajna cijena koju treba zapamtiti na svakoj stavci primke
/// (`primka_stavke.staraCijena`), po redu stavki. Upisuje se samo za artikle
/// bez zalihe (kod njih nema nivelacije koja bi je čuvala) i samo na prvu
/// stavku artikla — njena cijena je ona koju je `collect_price_changes` upisao.
fn stare_cijene_stavki(stavke: &[Value], bez_zaliha: &[PriceChange]) -> Vec<Value> {
    let mut stare: HashMap<String, Value> = HashMap::new();
    for c in bez_zaliha {
        // `new Map(...)`: kasniji isti ključ pobjeđuje.
        stare.insert(kljuc(&c.product_id), c.stara_cijena.clone());
    }
    stavke
        .iter()
        .map(|s| stare.remove(&kljuc(&ili_null(polje(s, "productId")))).unwrap_or(Value::Null))
        .collect()
}

/// Promjena cijene za vraćanje: artikal, stara i nova cijena.
struct Vracanje {
    product_id: Value,
    stara_cijena: Value,
    nova_cijena: Value,
}

impl Vracanje {
    fn iz(r: &Value) -> Vracanje {
        Vracanje { product_id: r["productId"].clone(), stara_cijena: r["staraCijena"].clone(), nova_cijena: r["novaCijena"].clone() }
    }
}

/// Vrati `staraCijena` artiklima koji još uvijek stoje na `novaCijena`. Ako je
/// cijenu u međuvremenu promijenilo nešto drugo (kasnija primka, ručna izmjena),
/// ta vrijednost se ne smije pregaziti. Vraća broj vraćenih artikala.
fn vrati_cijene_ako_nepromijenjene(db: &Db, promjene: &[&Vracanje]) -> R<i64> {
    let mut reverted = 0;
    for p in promjene {
        let current = db.get("SELECT cijena FROM products WHERE id = ?", p![p.product_id])?;
        if let Some(current) = current {
            if (js::to_number(&current["cijena"]) - js::to_number(&p.nova_cijena)).abs() <= EPS {
                db.run("UPDATE products SET cijena = ?, updatedAt = datetime('now','localtime') WHERE id = ?", p![p.stara_cijena, p.product_id])?;
                reverted += 1;
            }
        }
    }
    Ok(reverted)
}

/// `!samo || samo.has(productId)`
fn u_skupu(skup: Option<&HashSet<String>>, pid: &Value) -> bool {
    skup.is_none_or(|s| s.contains(&kljuc(pid)))
}

/// Vrati cijene koje je nivelacija ove primke postavila — ali samo za artikle
/// koji još uvijek stoje na toj cijeni. Ako je kasnija primka u međuvremenu
/// promijenila cijenu, njena vrijednost se ne smije pregaziti.
/// Stari put za primke bez historije cijena (`cijena_historija`); artikli iz
/// `preskoci` su već vraćeni iz historije. Vraća broj vraćenih artikala.
fn revert_nivelacija_prices(db: &Db, primka_id: &Value, preskoci: &HashSet<String>, samo: Option<&HashSet<String>>) -> R<i64> {
    // Nivelacije se ne brišu, pa promjena artikla koji je izmjenom već uklonjen
    // s primke ostaje u njenoj nivelaciji — ta je poništena pri uklanjanju i ne
    // smije se vraćati ponovo (samo artikli koji su još na primci). Isto tako se
    // ne gazi cijena koju je poslije primke postavila druga primka ili ručna
    // izmjena. Protunivelacije nemaju primkaId, pa se ovdje nikad ne čitaju.
    let old_niv_stavke: Vec<Vracanje> = db
        .all(
            "
    SELECT ns.productId, ns.staraCijena, ns.novaCijena
    FROM nivelacija_stavke ns
    JOIN nivelacije n ON n.id = ns.nivelacijaId
    WHERE n.primkaId = ?
      AND ns.productId IN (SELECT productId FROM primka_stavke WHERE primkaId = ?)
    ORDER BY ns.id
  ",
            p![primka_id, primka_id],
        )?
        .iter()
        .map(Vracanje::iz)
        .collect();

    let mut odabrane = Vec::new();
    for p in &old_niv_stavke {
        if !preskoci.contains(&kljuc(&p.product_id))
            && u_skupu(samo, &p.product_id)
            && !cijena_kasnije_mijenjana(db, primka_id, &p.product_id)?
        {
            odabrane.push(p);
        }
    }
    vrati_cijene_ako_nepromijenjene(db, &odabrane)
}

/// Isto kao `revert_nivelacija_prices`, ali za cijene koje je primka promijenila
/// artiklima bez zalihe (zapamćene u `primka_stavke.staraCijena`). Stavke bez
/// zapamćene cijene (stare primke) se ne diraju.
fn revert_prices_without_stock(db: &Db, primka_id: &Value, preskoci: &HashSet<String>, samo: Option<&HashSet<String>>) -> R<i64> {
    let promjene: Vec<Vracanje> = db
        .all(
            "
    SELECT productId, staraCijena, cijena AS novaCijena
    FROM primka_stavke
    WHERE primkaId = ? AND staraCijena IS NOT NULL
  ",
            p![primka_id],
        )?
        .iter()
        .map(Vracanje::iz)
        .collect();
    let odabrane: Vec<&Vracanje> =
        promjene.iter().filter(|p| !preskoci.contains(&kljuc(&p.product_id)) && u_skupu(samo, &p.product_id)).collect();
    vrati_cijene_ako_nepromijenjene(db, &odabrane)
}

// ── Historija promjena cijena (cijena_historija) ───────────────────────

/// Upis promjena prodajne cijene u `cijena_historija` (`zapisiPromjeneCijena`),
/// poslije upisa u products. `izvor` je 'primka' ili 'rucno'; `izvor_id` je
/// primkaId ili null. Promjena je (productId, staraCijena, novaCijena).
pub fn zapisi_promjene_cijena(db: &Db, izvor: &str, izvor_id: &Value, promjene: &[(Value, Value, Value)]) -> R<()> {
    for (product_id, stara, nova) in promjene {
        db.run(
            "INSERT INTO cijena_historija (productId, izvor, izvorId, staraCijena, novaCijena) VALUES (?, ?, ?, ?, ?)",
            p![product_id, izvor, izvor_id, stara, nova],
        )?;
    }
    Ok(())
}

/// Poništi promjene cijena koje je primka upisala u historiju, kao da primke
/// nikad nije bilo. Za svaku promjenu artikla:
///  - ima kasniju promjenu (druga primka, ručna izmjena): cijena artikla ostaje,
///    a kasnija promjena preuzima staru cijenu ove (lanac se premosti) — pa
///    njeno kasnije poništavanje vraća cijenu koja stvarno važi bez ove primke;
///  - posljednja je: artikal se vraća na staru cijenu, ali samo ako još stoji
///    na cijeni ove primke (zaštita od izmjene mimo historije).
///
/// Vraća artikle koje je historija pokrila (za njih se stari put ne koristi).
/// `samo` ograniči poništavanje na te artikle (izmjena primke).
fn ponisti_promjene_cijena_primke(db: &Db, primka_id: &Value, samo: Option<&HashSet<String>>) -> R<HashSet<String>> {
    let promjene: Vec<Value> = db
        .all(
            "SELECT id, productId, staraCijena, novaCijena FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ? ORDER BY id",
            p![primka_id],
        )?
        .into_iter()
        .filter(|p| u_skupu(samo, &p["productId"]))
        .collect();

    let mut pokriveni = HashSet::new();
    for p in &promjene {
        pokriveni.insert(kljuc(&p["productId"]));
        let s = db.get("SELECT id FROM cijena_historija WHERE productId = ? AND id > ? ORDER BY id LIMIT 1", p![p["productId"], p["id"]])?;
        if let Some(s) = s {
            db.run("UPDATE cijena_historija SET staraCijena = ? WHERE id = ?", p![p["staraCijena"], s["id"]])?;
        } else {
            vrati_cijene_ako_nepromijenjene(db, &[&Vracanje::iz(p)])?;
        }
        db.run("DELETE FROM cijena_historija WHERE id = ?", p![p["id"]])?;
    }
    Ok(pokriveni)
}

/// Vrati sve prodajne cijene koje je primka promijenila. Poziva se prije
/// brisanja stavki/nivelacije u primka:update i primka:delete. Primke upisane
/// u historiju cijena poništavaju se kroz nju (ispravno i u lancu primki);
/// starije primke bez historije idu starim putem — nivelacija + artikli bez
/// zalihe, vraćanje samo ako artikal još stoji na cijeni primke.
/// `samo` ograniči poništavanje na te artikle (izmjena primke).
fn revert_primka_prices(db: &Db, primka_id: &Value, samo: Option<&HashSet<String>>) -> R<i64> {
    let pokriveni = ponisti_promjene_cijena_primke(db, primka_id, samo)?;
    Ok(pokriveni.len() as i64
        + revert_nivelacija_prices(db, primka_id, &pokriveni, samo)?
        + revert_prices_without_stock(db, primka_id, &pokriveni, samo)?)
}

// ── Nivelacija kao dokument promjene cijene u prodaji ──────────────────
//
// Nivelacija se nikad ne briše: roba se prodavala po cijeni iz nje. Kad
// brisanje ili izmjena primke promijeni cijenu u prodaji, razlika se
// dokumentuje novom nivelacijom (protunivelacija) — od cijene koja je bila u
// prodaji do nove, na zalihi koja ostaje bez robe iz te primke.

/// Artikli čiju prodajnu cijenu primka određuje ili je mijenjala (stavke + historija).
fn artikli_primke(db: &Db, primka_id: &Value) -> R<Vec<Value>> {
    Ok(db
        .all(
            "
    SELECT productId FROM primka_stavke WHERE primkaId = ?
    UNION
    SELECT productId FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ?
  ",
            p![primka_id, primka_id],
        )?
        .into_iter()
        .map(|r| r["productId"].clone())
        .collect())
}

/// Snimak prodajnih cijena (JS `Map<productId, cijena>`), redom umetanja.
#[derive(Default)]
struct Cijene {
    red: Vec<(Value, Value)>,
    kljucevi: HashSet<String>,
}

/// Snimak trenutnih prodajnih cijena (prije poništavanja/izmjene primke), redom artikala.
fn cijene_artikala(db: &Db, product_ids: &[Value]) -> R<Cijene> {
    let mut m = Cijene::default();
    for id in product_ids {
        if m.kljucevi.contains(&kljuc(id)) {
            continue;
        }
        if let Some(r) = db.get("SELECT cijena FROM products WHERE id = ?", p![id])? {
            m.kljucevi.insert(kljuc(id));
            m.red.push((id.clone(), r["cijena"].clone()));
        }
    }
    Ok(m)
}

/// Trag svake promjene cijene u šifarniku od snimka `prije` (cijene_artikala) —
/// primka je mijenja nivelacijom, bez zalihe direktno, a brisanje je vraća.
/// U pregledu (poništena transakcija) nestaje zajedno s ostalim.
fn audit_cijena_primke(db: &Db, korisnik: Option<i64>, prije: &Cijene, izvor: &str, primka_id: &Value) -> R<()> {
    let ids: Vec<Value> = prije.red.iter().map(|(id, _)| id.clone()).collect();
    let sada = cijene_artikala(db, &ids)?;
    for (product_id, stara_cijena) in &prije.red {
        let nova = sada.red.iter().find(|(id, _)| kljuc(id) == kljuc(product_id)).map(|(_, c)| c);
        if let Some(nova_cijena) = nova.filter(|n| razlicito(n, stara_cijena)) {
            audit::zapisi(
                db,
                korisnik,
                "artikal:cijena",
                json!({
                    "productId": product_id, "staraCijena": stara_cijena, "novaCijena": nova_cijena,
                    "izvor": izvor, "primkaId": js::f(js::to_number(primka_id)),
                }),
            )?;
        }
    }
    Ok(())
}

/// Stavke nivelacije za promjene cijene u prodaji od snimka `prije` do sada:
/// stara = cijena koja je bila u prodaji, nova = trenutna, količina = trenutna
/// zaliha. Samo artikli sa zalihom (bez zalihe nema šta nivelisati); materijal
/// nema prodajnu cijenu. Poziva se dok ulaz primke NIJE na zalihi — cijena se
/// mijenja na robi koja ostaje u prodavnici.
fn promjene_u_prodaji(db: &Db, prije: &Cijene) -> R<Vec<PriceChange>> {
    let mut out = Vec::new();
    for (product_id, stara_cijena) in &prije.red {
        let Some(p) = db.get("SELECT cijena, pdvStopa, tip FROM products WHERE id = ?", p![product_id])? else { continue };
        if p["tip"] == "materijal" || (js::to_number(&p["cijena"]) - js::to_number(stara_cijena)).abs() <= EPS {
            continue;
        }
        let kolicina = get_product_stock(db, product_id)?;
        if js::to_number(&kolicina) > 0.0 {
            out.push(PriceChange {
                product_id: product_id.clone(),
                kolicina,
                stara_cijena: stara_cijena.clone(),
                nova_cijena: p["cijena"].clone(),
                pdv_stopa: p["pdvStopa"].clone(),
            });
        }
    }
    Ok(out)
}

/// Brojevi nivelacija primke koje sadrže neki od artikala — za napomenu protunivelacije.
fn brojevi_nivelacija_primke(db: &Db, primka_id: &Value, product_ids: Vec<Value>) -> R<Vec<String>> {
    if product_ids.is_empty() {
        return Ok(Vec::new());
    }
    let upitnici = vec!["?"; product_ids.len()].join(", ");
    let mut params = vec![primka_id.clone()];
    params.extend(product_ids);
    Ok(db
        .all(
            &format!(
                "
    SELECT n.brojNivelacije FROM nivelacije n
    WHERE n.primkaId = ? AND EXISTS (
      SELECT 1 FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id AND ns.productId IN ({upitnici})
    )
    ORDER BY n.id
  "
            ),
            &params,
        )?
        .iter()
        .map(|r| js::to_string(&r["brojNivelacije"]))
        .collect())
}

/// Napomena protunivelacije: razlog i nivelacije primke čije se cijene poništavaju.
fn napomena_protunivelacije(razlog: &str, brojevi: &[String]) -> String {
    if brojevi.is_empty() { razlog.to_string() } else { format!("{razlog} ({})", brojevi.join(", ")) }
}

// ── Izmjena primke ─────────────────────────────────────────────────────

/// Promjena cijene artikla koju je primka upisala u historiju (najviše jedna po artiklu).
fn promjena_cijene_primke(db: &Db, primka_id: &Value, product_id: &Value) -> R<Option<Value>> {
    db.get(
        "SELECT id, staraCijena, novaCijena FROM cijena_historija WHERE izvor = 'primka' AND izvorId = ? AND productId = ? ORDER BY id DESC LIMIT 1",
        p![primka_id, product_id],
    )
}

fn sljedeca_promjena(db: &Db, product_id: &Value, id: &Value) -> R<Option<Value>> {
    db.get("SELECT id FROM cijena_historija WHERE productId = ? AND id > ? ORDER BY id LIMIT 1", p![product_id, id])
}

/// Da li je prodajnu cijenu artikla poslije ove primke mijenjalo nešto drugo
/// (kasnija primka ili ručna izmjena) — tada ta kasnija promjena određuje
/// trenutnu cijenu, a izmjena cijene na ovoj primci je ne smije pregaziti.
///
/// Ako je primka mijenjala cijenu, gleda se lanac u historiji. Ako nije (cijena
/// je bila ista, ili je primka iz vremena prije historije), kasnija je svaka
/// promjena iz novije primke ili ručna izmjena upisana od unosa ove primke.
/// Stare primke bez ikakve historije to ne mogu znati — za njih vraća false.
fn cijena_kasnije_mijenjana(db: &Db, primka_id: &Value, product_id: &Value) -> R<bool> {
    if let Some(h) = promjena_cijene_primke(db, primka_id, product_id)? {
        return Ok(sljedeca_promjena(db, product_id, &h["id"])?.is_some());
    }
    db.ima(
        "
    SELECT 1 FROM cijena_historija
    WHERE productId = ? AND (
      (izvor = 'primka' AND izvorId > ?) OR
      (izvor = 'rucno' AND createdAt >= (SELECT createdAt FROM primke WHERE id = ?))
    ) LIMIT 1
  ",
        p![product_id, primka_id, primka_id],
    )
}

/// Prodajna cijena po artiklu iz stavki — važi prva stavka artikla, kao u
/// `collect_price_changes`. Redom umetanja: (ključ, productId, stavka).
fn prve_cijene(stavke: &[Value]) -> Vec<(String, Value, Value)> {
    let mut vidjeni = HashSet::new();
    let mut out = Vec::new();
    for s in stavke {
        let pid = ili_null(polje(s, "productId"));
        let k = kljuc(&pid);
        if vidjeni.insert(k.clone()) {
            out.push((k, pid, s.clone()));
        }
    }
    out
}

fn nadji<'a>(m: &'a [(String, Value, Value)], k: &str) -> Option<&'a Value> {
    m.iter().find(|(x, _, _)| x == k).map(|(_, _, s)| s)
}

struct IzmjenaPrimke {
    /// Artikli za koje se cijena računa kao kod nove primke (dodani, ili promijenjena cijena u zadnjoj promjeni).
    kreiraj: HashSet<String>,
    /// Zapamćena stara cijena (`primka_stavke.staraCijena`) artikala čije se promjene zadržavaju.
    zadrzane_stare_cijene: HashMap<String, Value>,
}

/// Pripremi cijene za izmjenu primke — poziva se prije brisanja starih stavki.
/// Cijena artikla se mijenja samo gdje je korisnik stvarno promijenio prodajnu
/// cijenu (prva stavka artikla), dodao ili uklonio artikal:
///  - ista cijena: cijena artikla, historija, nivelacija i zapamćena stara
///    cijena ostaju netaknuti;
///  - uklonjen artikal: promjena se poništava kao pri brisanju primke;
///  - dodan artikal: kao kod nove primke;
///  - promijenjena cijena, a primka je zadnja promjena cijene artikla:
///    poništi pa upiši kao novu (nova cijena + historija); nivelacija ide od
///    cijene koja je bila u prodaji (npr. 12 → 15, ne 10 → 15) — vidi primka:update;
///  - promijenjena cijena, a poslije je cijenu mijenjalo nešto drugo: trenutna
///    cijena ostaje (kasnija promjena je važnija), nema nove nivelacije — samo
///    se u lancu ispravi nova cijena ove primke i stara cijena sljedeće
///    promjene, pa njeno kasnije poništavanje vodi na ispravljenu cijenu.
///    Primka bez zapisa u historiji za taj artikal se ne ubacuje u lanac.
fn pripremi_izmjenu_primke(db: &Db, primka_id: &Value, nove_stavke: &[Value]) -> R<IzmjenaPrimke> {
    let stare = prve_cijene(&db.all("SELECT productId, cijena, staraCijena FROM primka_stavke WHERE primkaId = ? ORDER BY id", p![primka_id])?);
    let nove = prve_cijene(nove_stavke);

    let mut kreiraj = HashSet::new();
    let mut ponisti = HashSet::new();
    let mut zadrzane_stare_cijene = HashMap::new();

    for (k, _, _) in &stare {
        if nadji(&nove, k).is_none() {
            ponisti.insert(k.clone());
        }
    }

    for (k, product_id, nova) in &nove {
        let Some(stara) = nadji(&stare, k) else {
            kreiraj.insert(k.clone());
            continue;
        };
        let razlicita = (js::to_number(&stara["cijena"]) - broj(polje(nova, "cijena"))).abs() > EPS;
        if razlicita && !cijena_kasnije_mijenjana(db, primka_id, product_id)? {
            ponisti.insert(k.clone());
            kreiraj.insert(k.clone());
            continue;
        }
        // Zadržava se: ista cijena, ili je kasnija promjena važnija od ove.
        zadrzane_stare_cijene.insert(k.clone(), stara["staraCijena"].clone());
        if (js::to_number(&stara["cijena"]) - broj(polje(nova, "cijena"))).abs() <= EPS {
            continue;
        }
        let Some(h) = promjena_cijene_primke(db, primka_id, product_id)? else { continue };
        if let Some(sljedeca) = sljedeca_promjena(db, product_id, &h["id"])? {
            let nova_cijena = ili_null(polje(nova, "cijena"));
            db.run("UPDATE cijena_historija SET novaCijena = ? WHERE id = ?", p![nova_cijena, h["id"]])?;
            db.run("UPDATE cijena_historija SET staraCijena = ? WHERE id = ?", p![nova_cijena, sljedeca["id"]])?;
        }
    }

    if !ponisti.is_empty() {
        revert_primka_prices(db, primka_id, Some(&ponisti))?;
    }
    Ok(IzmjenaPrimke { kreiraj, zadrzane_stare_cijene })
}

/// `primka_stavke.staraCijena` pri izmjeni: nove promjene (iz `stare_cijene_stavki`)
/// i zadržane stare vrijednosti — obje samo na prvu stavku artikla.
fn stare_cijene_izmjene(stavke: &[Value], bez_zaliha: &[PriceChange], zadrzane: &HashMap<String, Value>) -> Vec<Value> {
    let nove = stare_cijene_stavki(stavke, bez_zaliha);
    let mut vidjeni = HashSet::new();
    stavke
        .iter()
        .zip(nove)
        .map(|(s, nova)| {
            let k = kljuc(&ili_null(polje(s, "productId")));
            let prva = vidjeni.insert(k.clone());
            if !nova.is_null() {
                return nova;
            }
            if prva { zadrzane.get(&k).cloned().unwrap_or(Value::Null) } else { Value::Null }
        })
        .collect()
}

// ── Pregled prije spremanja/brisanja ───────────────────────────────────
//
// Operacija se pokrene u transakciji koja se poništi; ovdje se samo pročita
// šta je napravila. Tako najava na ekranu i prava operacija dijele istu logiku.

struct PocetakPregleda {
    zadnja_nivelacija: Value,
    cijene: HashMap<String, Value>,
}

/// Stanje prije operacije: zadnja nivelacija i sve prodajne cijene.
fn pocetak_pregleda(db: &Db) -> R<PocetakPregleda> {
    let zadnja = db.val("SELECT COALESCE(MAX(id), 0) AS id FROM nivelacije", p![])?;
    let cijene = db.all("SELECT id, cijena FROM products", p![])?.into_iter().map(|p| (kljuc(&p["id"]), p["cijena"].clone())).collect();
    Ok(PocetakPregleda { zadnja_nivelacija: zadnja, cijene })
}

/// Nivelacije nastale poslije `pocetak` i promjene cijena koje nisu u njima
/// (artikli bez zalihe). Nivelacija s vezom na primku nosi novu cijenu ulaza;
/// bez veze je protunivelacija (poništenje cijene).
fn rezultat_pregleda(db: &Db, pocetak: &PocetakPregleda, cijena_ostaje: Vec<Value>) -> R<Value> {
    let mut dokumenti = Vec::new();
    let mut u_dokumentu = HashSet::new();
    for n in db.all("SELECT id, brojNivelacije, datum, primkaId, napomena FROM nivelacije WHERE id > ? ORDER BY id", p![pocetak.zadnja_nivelacija])? {
        let stavke = db.all(
            "
    SELECT ns.productId, p.naziv AS productNaziv, ns.kolicina, ns.staraCijena, ns.novaCijena, ns.razlika, ns.ukupnaRazlika
    FROM nivelacija_stavke ns JOIN products p ON p.id = ns.productId
    WHERE ns.nivelacijaId = ? ORDER BY ns.id
  ",
            p![n["id"]],
        )?;
        for s in &stavke {
            u_dokumentu.insert(kljuc(&s["productId"]));
        }
        dokumenti.push(json!({
            "vrsta": if n["primkaId"].is_null() { "protunivelacija" } else { "nivelacija" },
            "brojNivelacije": n["brojNivelacije"], "datum": n["datum"], "napomena": n["napomena"],
            "stavke": stavke,
        }));
    }

    let mut promijenjene = HashSet::new();
    let mut bez_zalihe = Vec::new();
    for p in db.all("SELECT id, naziv, cijena FROM products ORDER BY id", p![])? {
        let k = kljuc(&p["id"]);
        let Some(stara) = pocetak.cijene.get(&k) else { continue };
        if (js::to_number(stara) - js::to_number(&p["cijena"])).abs() <= EPS {
            continue;
        }
        promijenjene.insert(k.clone());
        if !u_dokumentu.contains(&k) {
            bez_zalihe.push(json!({ "productId": p["id"], "productNaziv": p["naziv"], "staraCijena": stara, "novaCijena": p["cijena"] }));
        }
    }

    let cijena_ostaje: Vec<Value> = cijena_ostaje.into_iter().filter(|c| !promijenjene.contains(&kljuc(&c["productId"]))).collect();
    Ok(json!({ "dokumenti": dokumenti, "bezZalihe": bez_zalihe, "cijenaOstaje": cijena_ostaje }))
}

/// Kanonski otisak pregleda — ono što korisnik potvrđuje pri spremanju ili
/// brisanju ulaza: svaki dokument (vrsta, broj, datum, napomena, stavke s
/// artiklom, količinom, starom i novom cijenom i razlikama), promjene cijena
/// bez dokumenta i cijene koje ostaju. Naziv artikla nije dio otiska: to je
/// oznaka za prikaz, dokument artikal veže po id-u, pa preimenovanje ne mijenja
/// ništa što se upisuje. Brojevi se zaokružuju na 6 decimala (šum pri
/// sabiranju), redoslijed dokumenata ostaje (to je redoslijed brojeva).
/// Neispravan oblik → None.
fn otisak_pregleda(p: &Value) -> Option<String> {
    // `Err(())` je `throw 0` iz originala.
    type T<X> = Result<X, ()>;
    // `x.k` — na null/undefined baca, na primitivu je undefined.
    fn dio<'a>(x: Option<&'a Value>, k: &str) -> T<Option<&'a Value>> {
        match x {
            None | Some(Value::Null) => Err(()),
            Some(v) => Ok(v.get(k)),
        }
    }
    fn n(x: Option<&Value>) -> T<Value> {
        match x.and_then(|v| v.as_f64()) {
            Some(f) if f.is_finite() => Ok(js::f(js::js_round(f * 1e6) / 1e6)),
            _ => Err(()),
        }
    }
    fn niz(x: Option<&Value>) -> T<&Vec<Value>> {
        x.and_then(|v| v.as_array()).ok_or(())
    }
    // `[...xs].sort((a, b) => a.productId - b.productId)` — stabilno.
    fn po_artiklu(mut xs: Vec<(f64, Value)>) -> Vec<Value> {
        xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        xs.into_iter().map(|(_, v)| v).collect()
    }
    fn stavka(s: &Value, polja: &[&str]) -> T<(f64, Value)> {
        let pid = n(dio(Some(s), "productId")?)?;
        let mut v = Vec::new();
        for k in polja {
            v.push(n(dio(Some(s), k)?)?);
        }
        Ok((pid.as_f64().unwrap_or(0.0), json!({ "productId": pid, "v": v })))
    }
    fn otisak(q: &Value) -> T<String> {
        let mut dokumenti = Vec::new();
        for d in niz(q.get("dokumenti"))? {
            let d = Some(d);
            let mut stavke = Vec::new();
            for s in niz(dio(d, "stavke")?)? {
                stavke.push(stavka(s, &["kolicina", "staraCijena", "novaCijena", "razlika", "ukupnaRazlika"])?);
            }
            dokumenti.push(json!([
                tekst(dio(d, "vrsta")?),
                tekst(dio(d, "brojNivelacije")?),
                tekst(dio(d, "datum")?),
                ili_null(dio(d, "napomena")?),
                po_artiklu(stavke),
            ]));
        }
        let mut bez_zalihe = Vec::new();
        for s in niz(q.get("bezZalihe"))? {
            bez_zalihe.push(stavka(s, &["staraCijena", "novaCijena"])?);
        }
        let mut cijena_ostaje = Vec::new();
        for s in niz(q.get("cijenaOstaje"))? {
            cijena_ostaje.push(stavka(s, &["cijena"])?);
        }
        Ok(js::stringify(&json!({
            "dokumenti": dokumenti,
            "bezZalihe": po_artiklu(bez_zalihe),
            "cijenaOstaje": po_artiklu(cijena_ostaje),
        })))
    }
    // `!q || typeof q !== 'object'`
    if !js::truthy(p) || !(p.is_object() || p.is_array()) {
        return None;
    }
    otisak(p).ok()
}

/// Da li potvrđeni pregled (s ekrana) opisuje isto što i `pregled` — vidi `otisak_pregleda`.
fn isti_pregled(potvrda: &Value, pregled: &Value) -> bool {
    match otisak_pregleda(potvrda) {
        Some(a) => Some(a) == otisak_pregleda(pregled),
        None => false,
    }
}

/// Izmjena primke: artikli kojima korisnik mijenja prodajnu cijenu na primci,
/// a cijenu je poslije ove primke mijenjalo nešto drugo — cijena u prodaji
/// ostaje (vidi `pripremi_izmjenu_primke`). Poziva se prije izmjene.
fn cijene_koje_ostaju(db: &Db, primka_id: &Value, nove_stavke: &[Value]) -> R<Vec<Value>> {
    let stare = prve_cijene(&db.all("SELECT productId, cijena FROM primka_stavke WHERE primkaId = ? ORDER BY id", p![primka_id])?);
    let mut out = Vec::new();
    for (k, product_id, nova) in prve_cijene(nove_stavke) {
        let Some(stara) = nadji(&stare, &k) else { continue };
        if (js::to_number(&stara["cijena"]) - broj(polje(&nova, "cijena"))).abs() <= EPS
            || !cijena_kasnije_mijenjana(db, primka_id, &product_id)?
        {
            continue;
        }
        if let Some(p) = db.get("SELECT naziv, cijena, tip FROM products WHERE id = ?", p![product_id])? {
            if p["tip"] != "materijal" {
                out.push(json!({ "productId": product_id, "productNaziv": p["naziv"], "cijena": p["cijena"] }));
            }
        }
    }
    Ok(out)
}

/// `stock_movements.createdAt` za ulaz iz primke: datum primke u formatu
/// kretanja (`YYYY-MM-DD HH:MM:SS`). Primka nosi samo datum, pa ulaz dobija
/// ponoć — deterministično (izmjena primke ne pomjera vrijeme) i unutar dana
/// pri poređenju stringova (`BETWEEN 'D 00:00:00' AND 'D 23:59:59'`, `LIKE 'D%'`).
fn datum_kretanja_primke(datum: &Value) -> Value {
    thread_local!(static DATUM: regex::Regex = regex::Regex::new(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$").unwrap());
    let s = js::to_string(datum);
    if DATUM.with(|r| r.is_match(&s)) { Value::String(format!("{s} 00:00:00")) } else { datum.clone() }
}

/// Zajednička validacija za primka:create i primka:update. Baca grešku sa
/// porukom za korisnika; vraća trimovan broj primke koji treba upisati.
/// `primka_id` je id primke koja se mijenja (null za novu) — njen vlastiti broj nije duplikat.
fn validiraj_primku(db: &Db, data: &Value, primka_id: &Value) -> R<String> {
    let broj_primke = match js::trim(&data["brojPrimke"]) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => baci!("Broj primke je obavezan"),
    };
    let stavke = &data["stavke"];
    if !js::truthy(stavke) || stavke.as_array().is_some_and(|a| a.is_empty()) {
        baci!("Primka mora imati najmanje jednu stavku");
    }

    if db.ima("SELECT id FROM primke WHERE brojPrimke = ? AND id IS NOT ?", p![broj_primke, primka_id])? {
        baci!("Primka sa brojem \"{}\" već postoji", tekst(polje(data, "brojPrimke")));
    }

    for s in niz(stavke) {
        if !db.ima("SELECT 1 FROM products WHERE id = ?", p![ili_null(polje(s, "productId"))])? {
            baci!("Artikal (ID {}) ne postoji", tekst(polje(s, "productId")));
        }
    }
    Ok(broj_primke)
}

/// Da li dobavljač figuriše na nekoj primci.
///
/// `primke.dobavljacId` čuva JIB/PDV broj dobavljača (tako ga upisuje ekran
/// primke), a ne njegov rowid — provjera po rowid-u nikad ne pogodi ništa.
pub fn is_dobavljac_used(db: &Db, naziv: &Value, id_broj: &Value, pdv_broj: &Value) -> R<bool> {
    let oznake: Vec<Value> = [id_broj, pdv_broj]
        .into_iter()
        .filter_map(|v| js::trim(v).filter(|s| !s.is_empty()).map(Value::from))
        .collect();
    if oznake.is_empty() {
        return db.ima("SELECT id FROM primke WHERE dobavljacNaziv = ? LIMIT 1", p![naziv]);
    }
    let upitnici = vec!["?"; oznake.len()].join(", ");
    let mut params = vec![naziv.clone()];
    params.extend(oznake);
    db.ima(
        &format!("SELECT id FROM primke\n         WHERE dobavljacNaziv = ? OR dobavljacId IN ({upitnici})\n         LIMIT 1"),
        &params,
    )
}

// ─── Handleri ──────────────────────────────────────────────────

/// "Danas" jednog poziva (`localDateStr()`, `new Date().getFullYear()`).
struct Dan {
    danas: String,
    godina: i32,
    /// Prijavljeni korisnik za audit (sesija u trenutku poziva).
    korisnik: Option<i64>,
}

fn get(db: &Db, id: &Value) -> R<Value> {
    let Some(mut primka) = db.get("SELECT * FROM primke WHERE id = ?", p![id])? else {
        baci!("Primka ne postoji");
    };
    let mut stavke = db.all(
        "
        SELECT ps.*, p.naziv AS productNaziv, p.jm AS productJm, p.sifra AS productSifra
        FROM primka_stavke ps
        LEFT JOIN products p ON p.id = ps.productId
        WHERE ps.primkaId = ?
      ",
        p![id],
    )?;
    // Stavke čiju je cijenu poslije ove primke mijenjalo nešto drugo: izmjena
    // njihove cijene na primci ne mijenja cijenu u prodaji (ekran to prikazuje).
    for s in &mut stavke {
        let k = cijena_kasnije_mijenjana(db, id, &s["productId"])?;
        s["cijenaKasnijeMijenjana"] = Value::Bool(k);
    }
    primka["stavke"] = Value::from(stavke);
    Ok(primka)
}

/// Sljedeći broj u nizu `<prefix>NNN` (`primka:nextBroj`, `getNextBrojNivelacije`).
fn sljedeci_broj(db: &Db, sql: &str, prefix: &str) -> R<String> {
    let max = db.val(sql, p![prefix.len() + 1, format!("{prefix}%")])?;
    let next = js::to_number(js::nn(&max, &json!(0))) + 1.0;
    Ok(format!("{prefix}{:0>3}", js::num_str(next)))
}

fn next_broj(db: &Db, dan: &Dan) -> R<Value> {
    let prefix = format!("U-{}-", dan.godina);
    sljedeci_broj(db, "SELECT MAX(CAST(SUBSTR(brojPrimke, ?) AS INTEGER)) AS maxNum FROM primke WHERE brojPrimke LIKE ?", &prefix)
        .map(Value::from)
}

fn get_next_broj_nivelacije(db: &Db, dan: &Dan) -> R<String> {
    let prefix = format!("NIV-{}-", dan.godina);
    sljedeci_broj(
        db,
        "SELECT MAX(CAST(SUBSTR(brojNivelacije, ?) AS INTEGER)) AS maxNum FROM nivelacije WHERE brojNivelacije LIKE ?",
        &prefix,
    )
}

/// Upiše nivelaciju (dokument) s današnjim datumom i sljedećim brojem; cijene
/// u šifarniku upisuje pozivalac. `primka_id` null = protunivelacija (nije
/// nivelacija primke — stari put poništavanja je ne čita). Vraća broj, ili
/// None kad nema stavki.
fn create_nivelacija(db: &Db, dan: &Dan, primka_id: &Value, price_diffs: &[PriceChange], napomena: Option<&str>) -> R<Option<String>> {
    if price_diffs.is_empty() {
        return Ok(None);
    }
    let broj_nivelacije = get_next_broj_nivelacije(db, dan)?;
    let r = db.run(
        "INSERT INTO nivelacije (brojNivelacije, datum, primkaId, napomena) VALUES (?, ?, ?, ?)",
        p![broj_nivelacije, dan.danas, primka_id, napomena],
    )?;
    let nivelacija_id = r.last_insert_rowid;

    for d in price_diffs {
        let razlika = js::to_number(&d.nova_cijena) - js::to_number(&d.stara_cijena);
        let ukupna_razlika = razlika * js::to_number(&d.kolicina);
        db.run(
            "INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            p![nivelacija_id, d.product_id, d.kolicina, d.stara_cijena, d.nova_cijena, js::f(razlika), js::f(ukupna_razlika), d.pdv_stopa],
        )?;
    }
    Ok(Some(broj_nivelacije))
}

fn insert_stavka_i_ulaz(db: &Db, primka_id: &Value, stavka: &Value, stara_cijena: &Value, datum_ulaza: &Value) -> R<()> {
    let g = |k| ili_null(polje(stavka, k));
    db.run(
        "INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa, staraCijena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p![primka_id, g("productId"), g("kolicina"), g("cijena"), g("nabavnaCijena"), g("rabat"), js::nn(&g("zavisniTroskovi"), &json!(0)), g("pdvStopa"), stara_cijena],
    )?;
    db.run(
        "INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, 'ulaz', ?, 'primka', ?, ?)",
        p![g("productId"), g("kolicina"), primka_id, datum_ulaza],
    )?;
    Ok(())
}

/// dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture (`?? null`).
fn zaglavlje(data: &Value) -> [Value; 5] {
    ["dobavljacNaziv", "dobavljacId", "dobavljacAdresa", "napomena", "brojFakture"].map(|k| ili_null(polje(data, k)))
}

// Tijela create/update/delete bez transakcije: prava operacija ih pokrene u
// transakciji, a pregled (primka:pregled*) u transakciji koju poništi — ista
// logika, pa najava na ekranu ne može odstupiti od onoga što spremanje uradi.
fn unesi_primku(db: &Db, dan: &Dan, data: &Value) -> R<Value> {
    let broj_primke = validiraj_primku(db, data, &Value::Null)?;
    let cijene_prije = cijene_artikala(db, &niz(&data["stavke"]).iter().map(|s| ili_null(polje(s, "productId"))).collect::<Vec<_>>())?;
    let danas = Value::from(dan.danas.clone());
    let datum = js::or(&data["datum"], &danas).clone();
    let [dn, di, da, na, bf] = zaglavlje(data);
    let result = db.run(
        "INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, dobavljacAdresa, napomena, brojFakture) VALUES (?, ?, ?, ?, ?, ?, ?)",
        p![broj_primke, datum, dn, di, da, na, bf],
    )?;
    let primka_id = Value::from(result.last_insert_rowid);
    let stavke = niz(&data["stavke"]);

    // Collect price diffs BEFORE inserting stock (so stock reflects pre-delivery state)
    let (nivelacija, bez_zaliha) = collect_price_changes(db, stavke)?;

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti.
    let stare_cijene = stare_cijene_stavki(stavke, &bez_zaliha);
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    let datum_ulaza = datum_kretanja_primke(&datum);
    for (stavka, stara) in stavke.iter().zip(&stare_cijene) {
        insert_stavka_i_ulaz(db, &primka_id, stavka, stara, &datum_ulaza)?;
    }

    let sve: Vec<PriceChange> = nivelacija.iter().chain(&bez_zaliha).cloned().collect();
    upisi_cijene(db, &sve)?;
    create_nivelacija(db, dan, &primka_id, &nivelacija, None)?;
    zapisi_promjene_cijena(db, "primka", &primka_id, &PriceChange::za_historiju(&sve))?;
    audit_cijena_primke(db, dan.korisnik, &cijene_prije, "primka", &primka_id)?;

    Ok(json!({ "id": primka_id, "nivelacijaCreated": !nivelacija.is_empty() }))
}

fn izmijeni_primku(db: &Db, dan: &Dan, data: &Value) -> R<Value> {
    let id = ili_null(polje(data, "id"));
    let broj_primke = validiraj_primku(db, data, &id)?;
    let danas = Value::from(dan.danas.clone());
    let datum = js::or(&data["datum"], &danas).clone();
    let stavke = niz(&data["stavke"]);

    let [dn, di, da, na, bf] = zaglavlje(data);
    db.run(
        "UPDATE primke SET brojPrimke = ?, datum = ?, dobavljacNaziv = ?, dobavljacId = ?, dobavljacAdresa = ?, napomena = ?, brojFakture = ? WHERE id = ?",
        p![broj_primke, datum, dn, di, da, na, bf, id],
    )?;

    // Cijene u prodaji prije izmjene — nivelacije (i protunivelacije) idu od njih.
    let mut artikli = artikli_primke(db, &id)?;
    artikli.extend(stavke.iter().map(|s| ili_null(polje(s, "productId"))));
    let prije = cijene_artikala(db, &artikli)?;

    // Cijene se diraju samo za artikle kojima je korisnik promijenio prodajnu
    // cijenu (ili ih dodao/uklonio) — vidi pripremi_izmjenu_primke. Ostalima
    // ostaju cijena, historija i nivelacija; izmjena količine, datuma ili
    // dobavljača ne smije ponovo nametnuti cijenu ove primke. Postojeće
    // nivelacije se nikad ne brišu.
    let izmjena = pripremi_izmjenu_primke(db, &id, stavke)?;

    // Delete old stavke and stock movements
    db.run("DELETE FROM primka_stavke WHERE primkaId = ?", p![id])?;
    db.run("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?", p![id])?;

    // Collect price diffs BEFORE inserting stock — samo za dodane artikle i
    // promijenjene cijene koje ova primka i dalje određuje.
    let (nivelacija, bez_zaliha) =
        collect_price_changes(db, stavke.iter().filter(|s| izmjena.kreiraj.contains(&kljuc(&ili_null(polje(s, "productId"))))))?;

    let sve: Vec<PriceChange> = nivelacija.iter().chain(&bez_zaliha).cloned().collect();
    upisi_cijene(db, &sve)?;
    zapisi_promjene_cijena(db, "primka", &id, &PriceChange::za_historiju(&sve))?;

    // Dokumenti: sve što se u prodaji promijenilo, od cijene koja je bila u
    // prodaji do nove, na zalihi bez robe iz ove primke (ulaz još nije upisan).
    // Nova cijena ove primke → njena nivelacija (npr. 12 → 15; stara 10 → 12
    // ostaje). Vraćena cijena (uklonjena stavka, cijena vraćena na staru) →
    // protunivelacija bez veze na primku, da je stari put poništavanja iz
    // nivelacija primke nikad ne pročita kao njenu.
    let od_primke: HashSet<String> = sve.iter().map(|c| kljuc(&c.product_id)).collect();
    let promjene = promjene_u_prodaji(db, &prije)?;
    let (nove_cijene, vracene_cijene): (Vec<PriceChange>, Vec<PriceChange>) =
        promjene.iter().cloned().partition(|c| od_primke.contains(&kljuc(&c.product_id)));
    create_nivelacija(db, dan, &id, &nove_cijene, Some(&format!("Izmjena primke {broj_primke}")))?;
    let brojevi = brojevi_nivelacija_primke(db, &id, vracene_cijene.iter().map(|c| c.product_id.clone()).collect())?;
    let napomena = napomena_protunivelacije(&format!("Izmjena primke {broj_primke}: poništenje cijene"), &brojevi);
    create_nivelacija(db, dan, &Value::Null, &vracene_cijene, Some(&napomena))?;

    // Now insert stavke and stock movements. Artiklima bez zalihe stavka
    // pamti staru cijenu (nema nivelacije) da je update/delete može vratiti;
    // zadržane promjene zadržavaju svoju zapamćenu cijenu.
    let stare_cijene = stare_cijene_izmjene(stavke, &bez_zaliha, &izmjena.zadrzane_stare_cijene);
    // Ulaz na zalihu nosi datum primke; nivelacija ostaje s današnjim datumom.
    let datum_ulaza = datum_kretanja_primke(&datum);
    for (stavka, stara) in stavke.iter().zip(&stare_cijene) {
        insert_stavka_i_ulaz(db, &id, stavka, stara, &datum_ulaza)?;
    }

    audit_cijena_primke(db, dan.korisnik, &prije, "primka:izmjena", &id)?;

    Ok(json!({ "id": id, "nivelacijaCreated": !promjene.is_empty() }))
}

fn obrisi_primku(db: &Db, dan: &Dan, id: &Value) -> R<Value> {
    let Some(primka) = db.get("SELECT brojPrimke FROM primke WHERE id = ?", p![id])? else {
        return Ok(Value::Null);
    };
    let broj_primke = js::to_string(&primka["brojPrimke"]);

    // Vrati cijene koje je ova primka promijenila (historija, stari put iz
    // nivelacije, zapamćene cijene artikala bez zalihe — isto pravilo kao
    // primka:update).
    let prije = cijene_artikala(db, &artikli_primke(db, id)?)?;
    revert_primka_prices(db, id, None)?;

    db.run("DELETE FROM primka_stavke WHERE primkaId = ?", p![id])?;
    db.run("DELETE FROM stock_movements WHERE referenceType = 'primka' AND referenceId = ?", p![id])?;

    // Nivelacije primke su dokumenti po kojima se prodavalo i ostaju. Vraćena
    // cijena u prodaji se dokumentuje protunivelacijom s današnjim datumom,
    // na zalihi POSLIJE uklanjanja ulaza: poništena primka robu nije ni
    // unijela, a cijena se mijenja na robi koja ostaje u prodavnici (isto
    // kao pri unosu primke, gdje nivelacija ide na zalihu prije ulaza).
    let vracene = promjene_u_prodaji(db, &prije)?;
    let nivelacije_primke = db.all("SELECT id, napomena FROM nivelacije WHERE primkaId = ? ORDER BY id", p![id])?;
    // `new Set(...)` — bez duplikata, redom pojavljivanja.
    let mut ponistene: Vec<String> = Vec::new();
    for broj in brojevi_nivelacija_primke(db, id, vracene.iter().map(|c| c.product_id.clone()).collect())? {
        if !ponistene.contains(&broj) {
            ponistene.push(broj);
        }
    }
    let napomena = napomena_protunivelacije(&format!("Poništenje primke {broj_primke}"), &ponistene);
    let broj_protu = create_nivelacija(db, dan, &Value::Null, &vracene, Some(&napomena))?;

    // Veza na primku (FK) se prekida, a trag ostaje u napomeni.
    for n in &nivelacije_primke {
        let broj = js::to_string(&db.val("SELECT brojNivelacije FROM nivelacije WHERE id = ?", p![n["id"]])?);
        let mut trag = format!("Primka {broj_primke} obrisana");
        if let Some(bp) = broj_protu.as_ref().filter(|_| ponistene.contains(&broj)) {
            trag.push_str(&format!("; cijena vraćena nivelacijom {bp}"));
        }
        let napomena = if js::truthy(&n["napomena"]) { format!("{}; {trag}", js::to_string(&n["napomena"])) } else { trag };
        db.run("UPDATE nivelacije SET primkaId = NULL, napomena = ? WHERE id = ?", p![napomena, n["id"]])?;
    }

    db.run("DELETE FROM primke WHERE id = ?", p![id])?;
    audit_cijena_primke(db, dan.korisnik, &prije, "primka:brisanje", id)?;
    Ok(Value::Null)
}

/// Pokrene operaciju u transakciji i pročita šta je napravila s cijenama
/// (nivelacije i promjene cijena, vidi `rezultat_pregleda`). `zadrzi` nad tim
/// pregledom odluči: true → transakcija se potvrdi; false → rollback, u bazi
/// ne ostaje ništa — ni dokumenti, ni historija, ni zaliha, ni brojači
/// (sqlite_sequence, broj nivelacije). Greška operacije (validacija) ide
/// pozivaocu kao i bez pregleda. Vraća pregled i rezultat (None = poništeno).
fn s_pregledom(
    db: &Db,
    operacija: impl FnOnce() -> R<Value>,
    cijena_ostaje: impl FnOnce() -> R<Vec<Value>>,
    zadrzi: impl FnOnce(&Value) -> bool,
) -> R<(Value, Option<Value>)> {
    let mut ishod = None;
    let r = db.tx(|| {
        let pocetak = pocetak_pregleda(db)?;
        let ostaje = cijena_ostaje()?;
        let rezultat = operacija()?;
        let pregled = rezultat_pregleda(db, &pocetak, ostaje)?;
        if zadrzi(&pregled) {
            ishod = Some((pregled, Some(rezultat)));
            return Ok(());
        }
        ishod = Some((pregled, None));
        Err(Greska(greska::PONISTI.into()))
    });
    match r {
        Err(e) if e.0 != greska::PONISTI => Err(e),
        _ => Ok(ishod.expect("pregled je postavljen prije potvrde ili poništenja")),
    }
}

/// Spremanje/brisanje ulaza. Ekran šalje pregled koji je korisnik potvrdio;
/// operacija se izvrši i u ISTOJ transakciji uporedi s njim (`isti_pregled`). Ako
/// se stanje u međuvremenu promijenilo (prodaja, druga primka, ručna cijena,
/// ponoć, tuđa nivelacija uzela broj), ništa se ne upisuje i vraća se
/// { promijenjeno: true, pregled } s novim pregledom za ponovnu potvrdu.
/// Bez potvrde (stari klijent, skripta) operacija se izvrši bez poređenja.
fn spremi_potvrdjeno(
    db: &Db,
    operacija: impl FnOnce() -> R<Value>,
    cijena_ostaje: impl FnOnce() -> R<Vec<Value>>,
    potvrda: &Value,
) -> R<Value> {
    if potvrda.is_null() {
        return db.tx(operacija);
    }
    match s_pregledom(db, operacija, cijena_ostaje, |pregled| isti_pregled(potvrda, pregled))? {
        (_, Some(rezultat)) => Ok(rezultat),
        (pregled, None) => Ok(json!({ "promijenjeno": true, "pregled": pregled })),
    }
}

fn bez_cijena_koje_ostaju() -> R<Vec<Value>> {
    Ok(Vec::new())
}

/// `cijeneKojeOstaju(db, data.id, data.stavke ?? [])`
fn ostaju_pri_izmjeni(db: &Db, data: &Value) -> R<Vec<Value>> {
    cijene_koje_ostaju(db, &ili_null(polje(data, "id")), niz(&data["stavke"]))
}

/// Pregled promjena cijena prije spremanja/brisanja — ista operacija, uvijek
/// poništena; ništa ne upisuje, pa nije u licencnoj blokadi.
fn bez_upisa(db: &Db, operacija: impl FnOnce() -> R<Value>, cijena_ostaje: impl FnOnce() -> R<Vec<Value>>) -> R<Value> {
    Ok(s_pregledom(db, operacija, cijena_ostaje, |_| false)?.0)
}

const NIVELACIJE_SELECT: &str = "
        SELECT n.*,
          p.brojPrimke AS primkaBroj,
          (SELECT COUNT(*) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS stavkiCount,
          (SELECT COALESCE(SUM(ns.ukupnaRazlika), 0) FROM nivelacija_stavke ns WHERE ns.nivelacijaId = n.id) AS ukupnaRazlika
        FROM nivelacije n
        LEFT JOIN primke p ON p.id = n.primkaId";

fn nivelacija_get_all(db: &Db, from: &Value, to: &Value) -> R<Value> {
    if js::truthy(from) && js::truthy(to) {
        return db
            .all(&format!("{NIVELACIJE_SELECT}\n        WHERE date(n.datum) BETWEEN date(?) AND date(?)\n        ORDER BY n.datum DESC"), p![from, to])
            .map(Value::from);
    }
    db.all(&format!("{NIVELACIJE_SELECT}\n        ORDER BY n.datum DESC"), p![]).map(Value::from)
}

fn nivelacija_get(db: &Db, id: &Value) -> R<Value> {
    let Some(mut niv) = db.get(
        "
      SELECT n.*, p.brojPrimke AS primkaBroj
      FROM nivelacije n
      LEFT JOIN primke p ON p.id = n.primkaId
      WHERE n.id = ?
    ",
        p![id],
    )?
    else {
        baci!("Nivelacija ne postoji");
    };
    niv["stavke"] = Value::from(db.all(
        "
      SELECT ns.*, p.naziv AS productNaziv, p.sifra AS productSifra, p.jm AS productJm
      FROM nivelacija_stavke ns
      LEFT JOIN products p ON p.id = ns.productId
      WHERE ns.nivelacijaId = ?
    ",
        p![id],
    )?);
    Ok(niv)
}

fn report_get_data(db: &Db, tip: &Value, from: &Value, to: &Value) -> R<Value> {
    if tip == "dnevni" {
        return db
            .all(
                "
          SELECT o.*, u.ime AS korisnikIme
          FROM orders o
          LEFT JOIN users u ON u.id = o.korisnikId
          WHERE date(o.createdAt) BETWEEN date(?) AND date(?)
          ORDER BY o.createdAt DESC
        ",
                p![from, to],
            )
            .map(Value::from);
    }

    if tip == "primke" {
        let mut primke = db.all(
            "
          SELECT p.*
          FROM primke p
          WHERE date(p.datum) BETWEEN date(?) AND date(?)
          ORDER BY p.datum DESC
        ",
            p![from, to],
        )?;
        // Attach stavke for each primka so the UI can calculate nabavna/prodajna per-item
        for primka in &mut primke {
            let stavke = db.all("SELECT * FROM primka_stavke WHERE primkaId = ?", p![primka["id"]])?;
            primka["stavke"] = Value::from(stavke);
        }
        return Ok(Value::from(primke));
    }

    baci!("Nepoznat tip izvještaja: {}", js::to_string(tip))
}

pub fn obradi(b: &Backend, kanal: &str, a: &Args) -> Option<R<Value>> {
    let dan = Dan { danas: b.sat.danas(), godina: b.sat.godina(), korisnik: b.sesija.id() };
    let db = match b.db() {
        Ok(db) => db,
        Err(e) => return Some(Err(e)),
    };
    let dan = &dan;
    Some(match kanal {
        "primka:getAll" => db.all("SELECT * FROM primke ORDER BY datum DESC", p![]).map(Value::from),
        "primka:get" => get(db, &a[0]),
        "primka:nextBroj" => next_broj(db, dan),
        "primka:create" => spremi_potvrdjeno(db, || unesi_primku(db, dan, &a[0]), bez_cijena_koje_ostaju, &a[1]),
        "primka:update" => spremi_potvrdjeno(db, || izmijeni_primku(db, dan, &a[0]), || ostaju_pri_izmjeni(db, &a[0]), &a[1]),
        // Uspjeh bez povratne vrijednosti (kao i prije); samo odbijanje nosi pregled.
        "primka:delete" => spremi_potvrdjeno(db, || obrisi_primku(db, dan, &a[0]), bez_cijena_koje_ostaju, &a[1]),
        "primka:pregledUnosa" => bez_upisa(db, || unesi_primku(db, dan, &a[0]), bez_cijena_koje_ostaju),
        "primka:pregledIzmjene" => bez_upisa(db, || izmijeni_primku(db, dan, &a[0]), || ostaju_pri_izmjeni(db, &a[0])),
        "primka:pregledBrisanja" => bez_upisa(db, || obrisi_primku(db, dan, &a[0]), bez_cijena_koje_ostaju),
        "nivelacija:getAll" => nivelacija_get_all(db, &a[0], &a[1]),
        "nivelacija:get" => nivelacija_get(db, &a[0]),
        "report:getData" => report_get_data(db, &a[0], &a[1], &a[2]),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otisak_kao_js() {
        let p = json!({
            "dokumenti": [{ "vrsta": "nivelacija", "brojNivelacije": "NIV-2026-001", "datum": "2026-03-10", "napomena": null,
                "stavke": [{ "productId": 2, "productNaziv": "B", "kolicina": 5, "staraCijena": 10, "novaCijena": 12.0000001, "razlika": 2, "ukupnaRazlika": 10 },
                           { "productId": 1, "productNaziv": "A", "kolicina": 1.5, "staraCijena": 1, "novaCijena": 2, "razlika": 1, "ukupnaRazlika": 1.5 }] }],
            "bezZalihe": [],
            "cijenaOstaje": [],
        });
        assert_eq!(
            otisak_pregleda(&p).unwrap(),
            r#"{"dokumenti":[["nivelacija","NIV-2026-001","2026-03-10",null,[{"productId":1,"v":[1.5,1,2,1,1.5]},{"productId":2,"v":[5,10,12,2,10]}]]],"bezZalihe":[],"cijenaOstaje":[]}"#
        );
        assert_eq!(otisak_pregleda(&json!({ "dokumenti": [] })), None);
        assert_eq!(otisak_pregleda(&json!(null)), None);
        assert_eq!(datum_kretanja_primke(&json!("2026-03-10")), json!("2026-03-10 00:00:00"));
    }
}
