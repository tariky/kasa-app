//! Pravila dijaloga za spremanje (`dialog:saveFile`, `db:backup`,
//! `fs:writeFile`) — `src/ipc/cuvanje.ts`, ista kao u Tauri ljusci
//! (src-tauri/src/lib.rs): renderer predlaže samo ime fajla u folderu koji
//! bira korisnik, i samo vrste fajlova koje program zaista pravi. Pravila su u
//! backendu (ne samo u ljusci), jer ugovor-server ima lažnu platformu.

use serde_json::{json, Value};

pub const DOZVOLJENE_EKSTENZIJE: [&str; 5] = ["pdf", "xlsx", "csv", "db", "zip"];

fn dozvoljena(ext: &str) -> bool {
    DOZVOLJENE_EKSTENZIJE.contains(&ext.to_lowercase().as_str())
}

fn separator(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// Node `path.extname` (posix; na Windowsu i `\` odvaja folder): od zadnje
/// tačke u imenu, osim kad je ime "skriveno" (`.zip` nema ekstenziju).
pub fn extname(putanja: &str) -> String {
    let z: Vec<char> = putanja.chars().collect();
    let mut start_dot: Option<usize> = None;
    let mut start_part = 0;
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    // 0 = nema ničeg ispred tačke, 1 = tačka ispred tačke, -1 = znak ispred.
    let mut pre_dot_state = 0;
    for i in (0..z.len()).rev() {
        let c = z[i];
        if separator(c) {
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            continue;
        }
        if end.is_none() {
            matched_slash = false;
            end = Some(i + 1);
        }
        if c == '.' {
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if pre_dot_state != 1 {
                pre_dot_state = 1;
            }
        } else if start_dot.is_some() {
            pre_dot_state = -1;
        }
    }
    match (start_dot, end) {
        (Some(d), Some(e)) if pre_dot_state != 0 && !(pre_dot_state == 1 && d + 1 == e && d == start_part + 1) => {
            z[d..e].iter().collect()
        }
        _ => String::new(),
    }
}

/// Ekstenzija putanje (bez obzira na velika slova) je s liste. `.zip` bez imena nema ekstenziju.
pub fn dozvoljena_ekstenzija(putanja: &Value) -> bool {
    match putanja.as_str() {
        Some(p) => {
            let e = extname(p);
            dozvoljena(e.strip_prefix('.').unwrap_or(&e))
        }
        None => false,
    }
}

/// JS `String.prototype.trim` (Unicode razmaci i BOM).
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// Predloženo ime za dijalog: `/`, `\` i `:` postaju `-` (na Windowsu je
/// `C:ime` putanja relativna na disk C). Prazno, skriveno (počinje tačkom),
/// s NUL znakom ili bez dozvoljene ekstenzije → None (dijalog se ne otvara).
pub fn ime_za_cuvanje(predlog: &Value) -> Option<String> {
    let ime: String = js_trim(predlog.as_str()?).chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    if ime.is_empty() || ime.starts_with('.') || ime.contains('\0') || !dozvoljena_ekstenzija(&json!(ime)) {
        return None;
    }
    Some(ime)
}

/// Filteri dijaloga bez ekstenzija van liste; filter koji ostane prazan se izbacuje.
pub fn dozvoljeni_filteri(filteri: &Value) -> Value {
    let Some(filteri) = filteri.as_array() else { return json!([]) };
    Value::Array(
        filteri
            .iter()
            .map(|f| {
                let name = f["name"].as_str().unwrap_or("");
                let extensions: Vec<&str> = f["extensions"]
                    .as_array()
                    .map(|e| e.iter().filter_map(Value::as_str).filter(|e| dozvoljena(e)).collect())
                    .unwrap_or_default();
                (name, extensions)
            })
            .filter(|(_, e)| !e.is_empty())
            .map(|(name, extensions)| json!({ "name": name, "extensions": extensions }))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extname_kao_node() {
        for (p, e) in [
            ("a.pdf", ".pdf"), (".zip", ""), ("..zip", ".zip"), ("name.", "."), ("a/b.PDF", ".PDF"),
            ("x/.db", ""), ("a.b/c", ""), ("a.b/c.", "."), ("/a/b.zip/", ".zip"), ("", ""), ("bez", ""),
        ] {
            assert_eq!(extname(p), e, "{p}");
        }
    }

    #[test]
    fn ime_i_filteri() {
        assert_eq!(ime_za_cuvanje(&json!("  Račun 5.pdf ")), Some("Račun 5.pdf".into()));
        assert_eq!(ime_za_cuvanje(&json!("../../etc/x.PDF")), None);
        assert_eq!(ime_za_cuvanje(&json!("izvoz/x.PDF")), Some("izvoz-x.PDF".into()));
        assert_eq!(ime_za_cuvanje(&json!("C:\\tmp\\x.csv")), Some("C--tmp-x.csv".into()));
        for lose in [json!(".zip"), json!("x.exe"), json!(""), json!("a\u{0}.pdf"), json!(5), json!(null)] {
            assert_eq!(ime_za_cuvanje(&lose), None, "{lose}");
        }
        assert_eq!(
            dozvoljeni_filteri(&json!([{ "name": "PDF", "extensions": ["pdf", "exe"] }, { "name": 5, "extensions": ["XLSX"] }, { "name": "Sve", "extensions": ["*"] }])),
            json!([{ "name": "PDF", "extensions": ["pdf"] }, { "name": "", "extensions": ["XLSX"] }])
        );
        assert_eq!(dozvoljeni_filteri(&json!(null)), json!([]));
    }
}
