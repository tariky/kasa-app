//! JavaScript semantika nad `serde_json::Value`.
//!
//! Backend je prepisan iz TypeScripta, a ugovor (vidi `src/ipc/ugovor`) traži
//! isto ponašanje do bajta: `||` i `??`, `String(broj)`, `Math.round`,
//! `parseInt`, `JSON.stringify`... Ovdje su te operacije na jednom mjestu, da
//! domenski kod čita kao original.

use serde_json::{Map, Value};

pub static NULL: Value = Value::Null;

/// JS istinitost (`if (x)`, `x || y`).
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// `x || null`
pub fn or_null(v: &Value) -> Value {
    if truthy(v) { v.clone() } else { Value::Null }
}

/// `a || b`
pub fn or<'a>(a: &'a Value, b: &'a Value) -> &'a Value {
    if truthy(a) { a } else { b }
}

/// `a ?? b` — `undefined` i `null` su u JSON-u isto (`Null`).
pub fn nn<'a>(a: &'a Value, b: &'a Value) -> &'a Value {
    if a.is_null() { b } else { a }
}

/// Broj iz vrijednosti bez konverzije tipa (`typeof v === 'number'`).
pub fn num(v: &Value) -> Option<f64> {
    v.as_f64()
}

/// JS `Number(v)` — NaN kad se ne da pretvoriti.
pub fn to_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() { return 0.0; }
            if let Some(h) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
                return i64::from_str_radix(h, 16).map(|x| x as f64).unwrap_or(f64::NAN);
            }
            match t {
                "Infinity" | "+Infinity" => f64::INFINITY,
                "-Infinity" => f64::NEG_INFINITY,
                _ => {
                    // Rust prihvata i "inf"/"nan", JS ne.
                    if t.chars().any(|c| c.is_ascii_alphabetic() && c != 'e' && c != 'E') { return f64::NAN; }
                    t.parse::<f64>().unwrap_or(f64::NAN)
                }
            }
        }
        Value::Array(a) => match a.len() {
            0 => 0.0,
            1 => to_number(&Value::String(to_string(&a[0]))),
            _ => f64::NAN,
        },
        Value::Object(_) => f64::NAN,
    }
}

/// `Math.round` — polovina ide prema +∞ (Rustov `round` ide od nule).
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() { return x; }
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// `round2` iz `lib/novac.ts`.
pub fn round2(n: f64) -> f64 {
    js_round((n + f64::EPSILON) * 100.0) / 100.0
}

/// Broj kao JSON vrijednost: cijeli brojevi ostaju cijeli (kao JS), NaN/±∞ → null
/// (kao `JSON.stringify`).
pub fn f(x: f64) -> Value {
    if !x.is_finite() { return Value::Null; }
    if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
        if x == 0.0 { return Value::from(0); }
        return Value::from(x as i64);
    }
    serde_json::Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null)
}

/// `Number.prototype.toString()` (baza 10).
pub fn num_str(x: f64) -> String {
    if x.is_nan() { return "NaN".into(); }
    if x.is_infinite() { return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() }; }
    if x == 0.0 { return "0".into(); }
    let abs = x.abs();
    if abs >= 1e21 || abs < 1e-6 {
        // JS eksponencijalni oblik: 1e+21, 1.5e-7
        let s = format!("{:e}", x);
        let (m, e) = s.split_once('e').unwrap();
        let e: i32 = e.parse().unwrap();
        return format!("{}e{}{}", m, if e >= 0 { "+" } else { "-" }, e.abs());
    }
    // Rust `{}` za f64 daje najkraći zapis koji se vraća u isti broj, bez eksponenta.
    let s = format!("{}", x);
    s
}

/// Broj iz `Value` kao string (JS `String(n)`).
pub fn number_str(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() { return i.to_string(); }
    if let Some(u) = n.as_u64() { return u.to_string(); }
    num_str(n.as_f64().unwrap_or(f64::NAN))
}

/// JS `String(v)` (i interpolacija u template stringu).
pub fn to_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_str(n),
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(|x| if x.is_null() { String::new() } else { to_string(x) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `parseInt(s, 10)`; `None` je NaN.
pub fn parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, rest) = if let Some(r) = t.strip_prefix('-') { (true, r) } else if let Some(r) = t.strip_prefix('+') { (false, r) } else { (false, t) };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { return None; }
    let n: i64 = digits.parse().ok()?;
    Some(if neg { -n } else { n })
}

/// `parseInt(String(v), 10)` kao JSON broj (NaN → null).
pub fn parse_int_value(v: &Value) -> Value {
    match parse_int(&to_string(v)) { Some(n) => Value::from(n), None => Value::Null }
}

/// `parseFloat(s)`; NaN kad nema broja na početku.
pub fn parse_float(s: &str) -> f64 {
    let t = s.trim_start();
    let re = regex::Regex::new(r"^[+-]?(Infinity|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)").unwrap();
    match re.find(t) {
        Some(m) => {
            let x = m.as_str();
            if x.ends_with("Infinity") { return if x.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY }; }
            x.parse().unwrap_or(f64::NAN)
        }
        None => f64::NAN,
    }
}

/// `String(n).padStart(len, '0')`
pub fn pad(n: i64, len: usize) -> String {
    format!("{:0>width$}", n, width = len)
}

/// `JSON.stringify(v)` — brojevi kao u JS-u (`5`, ne `5.0`).
pub fn stringify(v: &Value) -> String {
    let mut out = String::new();
    write_json(v, &mut out);
    out
}

fn write_json(v: &Value, out: &mut String) {
    match v {
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(f64::NAN);
            if n.is_f64() && !x.is_finite() { out.push_str("null"); } else { out.push_str(&number_str(n)); }
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 { out.push(','); }
                write_json(x, out);
            }
            out.push(']');
        }
        Value::Object(m) => {
            out.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 { out.push(','); }
                out.push_str(&serde_json::to_string(k).unwrap());
                out.push(':');
                write_json(x, out);
            }
            out.push('}');
        }
        other => out.push_str(&serde_json::to_string(other).unwrap()),
    }
}

/// `JSON.parse` — greška s porukom kao u JS-u (tekst poruke nije ugovor).
pub fn parse(s: &str) -> Result<Value, String> {
    serde_json::from_str(s).map_err(|e| format!("JSON Parse error: {e}"))
}

/// Prazan objekat za `json!`-olike konstrukcije.
pub fn obj() -> Map<String, Value> {
    Map::new()
}

/// `s?.trim()` — `None` kad vrijednost nije string.
pub fn trim(v: &Value) -> Option<&str> {
    v.as_str().map(|s| s.trim())
}

/// `!v?.trim()` — prazno, samo razmaci ili nije postavljeno.
pub fn blank(v: &Value) -> bool {
    match v {
        Value::String(s) => s.trim().is_empty(),
        Value::Null => true,
        // `broj.trim` ne postoji u JS-u — handler bi pukao; ovdje se tretira kao popunjeno.
        _ => false,
    }
}

/// Da li objekat ima ključ (`'k' in data`).
pub fn has(v: &Value, k: &str) -> bool {
    v.as_object().map(|m| m.contains_key(k)).unwrap_or(false)
}

/// `Number.isInteger(v)`
pub fn is_integer(v: &Value) -> bool {
    match v.as_f64() { Some(x) => x.is_finite() && x.fract() == 0.0, None => false }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn brojevi_kao_js() {
        assert_eq!(num_str(5.0), "5");
        assert_eq!(num_str(12.5), "12.5");
        assert_eq!(num_str(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(num_str(-3.0), "-3");
        assert_eq!(num_str(1e21), "1e+21");
        assert_eq!(num_str(1.5e-7), "1.5e-7");
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(round2(1.005), 1.01);
        assert_eq!(stringify(&json!({"a": 5.0, "b": [1.5, null, "x"]})), r#"{"a":5,"b":[1.5,null,"x"]}"#);
        assert_eq!(parse_int("8085abc"), Some(8085));
        assert_eq!(parse_int(""), None);
        assert_eq!(parse_float(" 12.50kn"), 12.5);
        assert_eq!(to_number(&json!("")), 0.0);
        assert!(to_number(&json!("abc")).is_nan());
    }
}
