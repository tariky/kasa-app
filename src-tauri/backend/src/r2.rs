//! Minimalni S3 klijent za Cloudflare R2 (`src/lib/r2.ts`): AWS Signature V4
//! i PUT s napretkom po bajtovima. Bez AWS SDK-a.

use std::io::Read;
use std::time::Duration;

use hmac::{Hmac, Mac};
use regex::Regex;
use sha2::{Digest, Sha256};

/// Kuda i s kojim ključem (`R2Pristup` u r2.ts). `endpoint` je samo za testove
/// (lažni S3); inače `https://<accountId>.r2.cloudflarestorage.com`.
pub struct Pristup<'a> {
    pub account_id: &'a str,
    pub access_key_id: &'a str,
    pub secret: &'a str,
    pub bucket: &'a str,
    pub endpoint: Option<&'a str>,
}

/// Greška R2 poziva (`R2Greska`). `status` nema kad server nije ni odgovorio;
/// `kod` je S3 `<Code>` iz tijela (npr. RequestTimeTooSkewed).
#[derive(Debug, Clone, PartialEq)]
pub struct R2Greska {
    pub poruka: String,
    pub status: Option<u16>,
    pub kod: Option<String>,
}

impl R2Greska {
    fn veza(opis: impl std::fmt::Display) -> Self {
        R2Greska { poruka: format!("Nema veze s R2 ({opis})"), status: None, kod: None }
    }

    /// Poruka za korisnika (`porukaGreske` u backupTok.ts). Bez kredencijala —
    /// R2 poruke ih ne sadrže.
    pub fn za_korisnika(&self) -> String {
        match (self.status, self.kod.as_deref()) {
            // x-amz-date odstupa > 15 min: sat računara, ne licenca.
            (Some(403), Some("RequestTimeTooSkewed")) => {
                "Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.".into()
            }
            (Some(403), _) => "R2 pristup više ne važi — zatražite novu licencu".into(),
            _ => self.poruka.clone(),
        }
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn sha256_hex(x: &[u8]) -> String {
    hex(&Sha256::digest(x))
}

fn hmac(kljuc: &[u8], x: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(kljuc).expect("HMAC prima ključ bilo koje dužine");
    m.update(x.as_bytes());
    m.finalize().into_bytes().to_vec()
}

/// RFC 3986 kao što ga S3 traži: sve osim A-Z a-z 0-9 - _ . ~ (i `/` u putanji).
pub fn kodiraj(s: &str, cuvaj_kosu_crtu: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b'/' if cuvaj_kosu_crtu => out.push('/'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Ulaz za `potpisi_s3` (`ZahtjevZaPotpis`).
pub struct ZaPotpis<'a> {
    pub metoda: &'a str,
    pub host: &'a str,
    /// Nekodirana putanja, npr. `/bucket/uredjaj/vrijeme.db.age`.
    pub putanja: &'a str,
    pub upit: &'a [(&'a str, &'a str)],
    /// Dodatna zaglavlja koja se potpisuju.
    pub zaglavlja: &'a [(&'a str, &'a str)],
    pub hash_tijela: &'a str,
    pub access_key_id: &'a str,
    pub secret: &'a str,
    pub region: &'a str,
    /// `YYYYMMDDTHHMMSSZ`
    pub amz_datum: &'a str,
}

/// Zaglavlja za zahtjev (imena malim slovima, sortirana), uključujući
/// `authorization` (SigV4, servis s3) — `potpisiS3` u r2.ts.
pub fn potpisi_s3(z: &ZaPotpis) -> Vec<(String, String)> {
    let mut zaglavlja: Vec<(String, String)> = z.zaglavlja.iter().map(|(k, v)| (k.to_lowercase(), v.to_string())).collect();
    zaglavlja.push(("host".into(), z.host.into()));
    zaglavlja.push(("x-amz-content-sha256".into(), z.hash_tijela.into()));
    zaglavlja.push(("x-amz-date".into(), z.amz_datum.into()));
    zaglavlja.sort();
    let potpisana = zaglavlja.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");
    let razmaci = Regex::new(r"\s+").unwrap();
    let kanonska: String = zaglavlja.iter().map(|(k, v)| format!("{k}:{}\n", razmaci.replace_all(v.trim(), " "))).collect();
    let mut upit = z.upit.to_vec();
    upit.sort();
    let kanonski_upit = upit.iter().map(|(k, v)| format!("{}={}", kodiraj(k, false), kodiraj(v, false))).collect::<Vec<_>>().join("&");
    let kanonski = [z.metoda, &kodiraj(z.putanja, true), &kanonski_upit, &kanonska, &potpisana, z.hash_tijela].join("\n");

    let dan = &z.amz_datum[..8];
    let opseg = format!("{dan}/{}/s3/aws4_request", z.region);
    let za_potpis = ["AWS4-HMAC-SHA256", z.amz_datum, &opseg, &sha256_hex(kanonski.as_bytes())].join("\n");
    let kljuc = hmac(&hmac(&hmac(&hmac(format!("AWS4{}", z.secret).as_bytes(), dan), z.region), "s3"), "aws4_request");
    let potpis = hex(&hmac(&kljuc, &za_potpis));
    zaglavlja.push((
        "authorization".into(),
        format!("AWS4-HMAC-SHA256 Credential={}/{opseg},SignedHeaders={potpisana},Signature={potpis}", z.access_key_id),
    ));
    zaglavlja
}

/// Greška iz odgovora s HTTP statusom (`greskaOdgovora`).
fn greska_odgovora(status: u16, status_tekst: &str, xml: &str) -> R2Greska {
    let polje = |ime: &str| Regex::new(&format!("<{ime}>([^<]*)</{ime}>")).unwrap().captures(xml).map(|c| c[1].to_string());
    let kod = polje("Code").filter(|k| !k.is_empty());
    let poruka = polje("Message").unwrap_or_else(|| status_tekst.to_string());
    let opis = match &kod {
        Some(k) => format!("{status} {k}"),
        None => status.to_string(),
    };
    let poruka = if status == 403 { format!("R2 je odbio pristup ({opis}): {poruka}") } else { format!("R2 greška ({opis}): {poruka}") };
    R2Greska { poruka, status: Some(status), kod }
}

/// Koliko se čeka veza i odgovor R2 (`cekanjeMs` u r2Posalji).
pub const CEKANJE: Duration = Duration::from_secs(120);
/// Gornja granica cijelog slanja: zaglavljen upload ne smije zauvijek držati
/// backup "u toku" (raspored tada ne bi pokušao ponovo).
const NAJDUZE_SLANJE: Duration = Duration::from_secs(30 * 60);
const KOMAD: usize = 64 * 1024;

/// Tijelo PUT-a u komadima od 64 KB; `napredak` se javi kad komad ode ureq-u.
struct SaNapretkom<'a, 'n> {
    tijelo: &'a [u8],
    poslano: usize,
    napredak: &'n mut dyn FnMut(u64, u64),
}

impl Read for SaNapretkom<'_, '_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = buf.len().min(KOMAD).min(self.tijelo.len() - self.poslano);
        if n == 0 {
            return Ok(0);
        }
        buf[..n].copy_from_slice(&self.tijelo[self.poslano..self.poslano + n]);
        self.poslano += n;
        (self.napredak)(self.poslano as u64, self.tijelo.len() as u64);
        Ok(n)
    }
}

/// PUT objekta (`r2Posalji`). Dužina ide u `content-length` unaprijed — R2
/// odbija chunked, a bez streama ne bi bilo napretka. Datum potpisa je pravi
/// sat (ne `Sat` backenda): R2 odbija zahtjev koji odstupa > 15 min.
pub fn posalji(p: &Pristup, kljuc: &str, tijelo: &[u8], napredak: &mut dyn FnMut(u64, u64), cekanje: Duration) -> Result<(), R2Greska> {
    let baza = match p.endpoint {
        Some(e) => e.trim_end_matches('/').to_string(),
        None => format!("https://{}.r2.cloudflarestorage.com", p.account_id),
    };
    let host = baza.split("://").nth(1).unwrap_or(&baza).split('/').next().unwrap_or("").to_string();
    let putanja = format!("/{}/{kljuc}", p.bucket);
    let datum = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let hash = sha256_hex(tijelo);
    let zaglavlja = potpisi_s3(&ZaPotpis {
        metoda: "PUT", host: &host, putanja: &putanja, upit: &[], zaglavlja: &[], hash_tijela: &hash,
        access_key_id: p.access_key_id, secret: p.secret, region: "auto", amz_datum: &datum,
    });

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(cekanje))
        .timeout_recv_response(Some(cekanje))
        .timeout_global(Some(NAJDUZE_SLANJE))
        .build()
        .into();
    // `host` postavlja ureq iz URL-a (isti kao potpisani).
    let mut z = agent.put(&format!("{baza}{}", kodiraj(&putanja, true))).header("content-length", tijelo.len().to_string());
    for (k, v) in zaglavlja.iter().filter(|(k, _)| k != "host") {
        z = z.header(k.as_str(), v.as_str());
    }
    let mut citac = SaNapretkom { tijelo, poslano: 0, napredak };
    let mut odg = z.send(ureq::SendBody::from_reader(&mut citac)).map_err(|e| match e {
        ureq::Error::Timeout(_) => R2Greska::veza("isteklo vrijeme"),
        e => R2Greska::veza(e),
    })?;
    let status = odg.status();
    if status.is_success() {
        return Ok(());
    }
    let xml = odg.body_mut().read_to_string().unwrap_or_default();
    Err(greska_odgovora(status.as_u16(), status.canonical_reason().unwrap_or(""), &xml))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    // Službeni primjeri iz AWS dokumentacije "Signature Calculations for the
    // Authorization Header: Transferring Payload in a Single Chunk" (isti kao r2.test.ts).
    const PRAZNO: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    fn aws<'a>(metoda: &'a str, putanja: &'a str, upit: &'a [(&'a str, &'a str)], zaglavlja: &'a [(&'a str, &'a str)], hash: &'a str) -> String {
        let z = ZaPotpis {
            metoda, host: "examplebucket.s3.amazonaws.com", putanja, upit, zaglavlja, hash_tijela: hash,
            access_key_id: "AKIAIOSFODNN7EXAMPLE", secret: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region: "us-east-1", amz_datum: "20130524T000000Z",
        };
        potpisi_s3(&z).into_iter().find(|(k, _)| k == "authorization").unwrap().1
    }

    #[test]
    fn sigv4_aws_primjeri() {
        assert_eq!(
            aws("GET", "/test.txt", &[], &[("range", "bytes=0-9")], PRAZNO),
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
        assert!(aws(
            "PUT", "/test$file.text", &[],
            &[("date", "Fri, 24 May 2013 00:00:00 GMT"), ("x-amz-storage-class", "REDUCED_REDUNDANCY")],
            "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
        )
        .ends_with("SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"));
        assert!(aws("GET", "/", &[("lifecycle", "")], &[], PRAZNO).ends_with("Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543"));
        assert!(aws("GET", "/", &[("prefix", "J"), ("max-keys", "2")], &[], PRAZNO).ends_with("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7"));
    }

    #[test]
    fn kodiranje_putanje() {
        assert_eq!(kodiraj("/b/3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age", true), "/b/3F9A-01C2-7B44/2026-09-25T15-00-07Z.db.age");
        assert_eq!(kodiraj("/a b/č$!'()*", true), "/a%20b/%C4%8D%24%21%27%28%29%2A");
        assert_eq!(kodiraj("a/b", false), "a%2Fb");
    }

    #[test]
    fn poruke_gresaka() {
        let g = greska_odgovora(403, "Forbidden", "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>");
        assert_eq!(g.poruka, "R2 je odbio pristup (403 AccessDenied): Access Denied");
        assert_eq!(g.za_korisnika(), "R2 pristup više ne važi — zatražite novu licencu");
        let sat = greska_odgovora(403, "Forbidden", "<Error><Code>RequestTimeTooSkewed</Code><Message>x</Message></Error>");
        assert_eq!(sat.za_korisnika(), "Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.");
        let g = greska_odgovora(500, "Internal Server Error", "");
        assert_eq!((g.poruka.as_str(), g.status, g.kod.clone()), ("R2 greška (500): Internal Server Error", Some(500), None));
        assert_eq!(g.za_korisnika(), g.poruka);
        let g = greska_odgovora(404, "Not Found", "<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>");
        assert_eq!(g.poruka, "R2 greška (404 NoSuchBucket): The specified bucket does not exist.");
    }

    /// Šta je lažni server primio: zaglavlja (imena malim slovima) i tijelo.
    type Primljeno = (Vec<(String, String)>, Vec<u8>);

    /// Jedan zahtjev na 127.0.0.1: pročita ga, sačeka `odgoda`, odgovori `odgovor`.
    /// Vraća adresu i nit koja daje ono što je primljeno.
    fn server(odgovor: String, odgoda: Duration) -> (String, std::thread::JoinHandle<Primljeno>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let adresa = format!("http://{}", l.local_addr().unwrap());
        let nit = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = Vec::new();
            let mut komad = [0u8; 16384];
            let kraj = loop {
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
                let n = s.read(&mut komad).unwrap();
                assert!(n > 0, "veza zatvorena prije kraja zaglavlja");
                buf.extend_from_slice(&komad[..n]);
            };
            let zaglavlja: Vec<(String, String)> = String::from_utf8_lossy(&buf[..kraj])
                .lines()
                .skip(1)
                .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string())))
                .collect();
            let duzina = zaglavlja.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse::<usize>().ok()).unwrap_or(0);
            while buf.len() < kraj + duzina {
                let n = s.read(&mut komad).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&komad[..n]);
            }
            std::thread::sleep(odgoda);
            let _ = s.write_all(odgovor.as_bytes());
            (zaglavlja, buf[kraj..].to_vec())
        });
        (adresa, nit)
    }

    fn odgovor(status: &str, tijelo: &str) -> String {
        format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{tijelo}", tijelo.len())
    }

    fn pristup(endpoint: &str) -> Pristup<'_> {
        Pristup { account_id: "acc", access_key_id: "KLJUC", secret: "tajna", bucket: "pazar-test", endpoint: Some(endpoint) }
    }

    #[test]
    fn put_s_duzinom_potpisom_i_napretkom() {
        let (adresa, nit) = server(odgovor("200 OK", ""), Duration::ZERO);
        let tijelo: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut napredak = Vec::new();
        posalji(&pristup(&adresa), "UREDJAJ/2026-09-25T15-00-07Z.db.age", &tijelo, &mut |p, u| napredak.push((p, u)), CEKANJE).unwrap();
        let (z, primljeno) = nit.join().unwrap();
        let h = |k: &str| z.iter().find(|(x, _)| x == k).map(|(_, v)| v.clone());

        assert_eq!(primljeno, tijelo);
        // R2 odbija chunked: dužina mora biti poslana unaprijed.
        assert_eq!(h("content-length"), Some(tijelo.len().to_string()));
        assert_eq!(h("transfer-encoding"), None);
        assert_eq!(h("x-amz-content-sha256"), Some(sha256_hex(&tijelo)));
        // Potpis se poklapa s onim koji bi server izračunao (kao laziS3.ts).
        let host = adresa.trim_start_matches("http://");
        let datum = h("x-amz-date").unwrap();
        let ocekivano = potpisi_s3(&ZaPotpis {
            metoda: "PUT", host, putanja: "/pazar-test/UREDJAJ/2026-09-25T15-00-07Z.db.age", upit: &[], zaglavlja: &[],
            hash_tijela: &sha256_hex(&tijelo), access_key_id: "KLJUC", secret: "tajna", region: "auto", amz_datum: &datum,
        });
        assert_eq!(h("authorization"), ocekivano.into_iter().find(|(k, _)| k == "authorization").map(|(_, v)| v));
        // Napredak raste po komadima i završava na ukupnoj dužini.
        assert!(napredak.len() >= 3, "{napredak:?}");
        assert!(napredak.windows(2).all(|w| w[0].0 < w[1].0));
        assert_eq!(napredak.last(), Some(&(tijelo.len() as u64, tijelo.len() as u64)));
    }

    #[test]
    fn put_403_daje_s3_kod() {
        let xml = "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>";
        let (adresa, nit) = server(odgovor("403 Forbidden", xml), Duration::ZERO);
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, CEKANJE).unwrap_err();
        nit.join().unwrap();
        assert_eq!((g.status, g.kod.as_deref()), (Some(403), Some("AccessDenied")));
        assert_eq!(g.za_korisnika(), "R2 pristup više ne važi — zatražite novu licencu");
    }

    #[test]
    fn server_ne_odgovara_isteklo_vrijeme() {
        let (adresa, nit) = server(odgovor("200 OK", ""), Duration::from_secs(2));
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, Duration::from_millis(300)).unwrap_err();
        assert_eq!(g, R2Greska { poruka: "Nema veze s R2 (isteklo vrijeme)".into(), status: None, kod: None });
        nit.join().unwrap();
    }

    #[test]
    fn nema_servera() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let adresa = format!("http://{}", l.local_addr().unwrap());
        drop(l);
        let g = posalji(&pristup(&adresa), "U/x.db.age", b"abc", &mut |_, _| {}, CEKANJE).unwrap_err();
        assert!(g.poruka.starts_with("Nema veze s R2 ("), "{}", g.poruka);
        assert_eq!(g.status, None);
    }
}
