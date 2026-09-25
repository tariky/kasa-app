//! Tauri ljuska oko `pazar-backend`: prozor, komanda `api` (zamjena za
//! `ipcRenderer.invoke`), sistemski dijalozi, restart i PDF prozori.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use pazar_backend::sat::Sat;
use pazar_backend::{Backend, Platforma};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, RunEvent, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};


struct TauriPlatforma {
    app: AppHandle,
}

fn filteri(opcije: &Value) -> Vec<(String, Vec<String>)> {
    opcije["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            let ext = f["extensions"].as_array().into_iter().flatten().filter_map(|e| e.as_str().map(str::to_string)).collect();
            (f["name"].as_str().unwrap_or("").to_string(), ext)
        })
        .collect()
}

/// Ekstenzije koje dijalog za čuvanje prihvata (PDF, izvoz, backup baze).
const DOZVOLJENE_EKSTENZIJE: [&str; 5] = ["pdf", "xlsx", "csv", "db", "zip"];

fn dozvoljena_ekstenzija(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| DOZVOLJENE_EKSTENZIJE.iter().any(|d| d.eq_ignore_ascii_case(e)))
}

/// Predloženo ime fajla za dijalog: samo ime (bez foldera — renderer ne bira
/// gdje se dijalog otvara) i samo dozvoljena ekstenzija, inače `None`.
fn ime_za_cuvanje(predlog: &str) -> Option<String> {
    // I `\` je separator: ime stiže iz renderera, bez obzira na OS.
    let ime = predlog.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if ime.is_empty() || ime == "." || ime == ".." || ime.contains('\0') || !dozvoljena_ekstenzija(Path::new(ime)) {
        return None;
    }
    Some(ime.to_string())
}

/// Filteri dijaloga bez ekstenzija koje se ne smiju snimati.
fn dozvoljeni_filteri(opcije: &Value) -> Vec<(String, Vec<String>)> {
    filteri(opcije)
        .into_iter()
        .map(|(ime, ext)| (ime, ext.into_iter().filter(|e| DOZVOLJENE_EKSTENZIJE.iter().any(|d| d.eq_ignore_ascii_case(e))).collect::<Vec<_>>()))
        .filter(|(_, ext)| !ext.is_empty())
        .collect()
}

impl Platforma for TauriPlatforma {
    fn dijalog_sacuvaj(&self, opcije: Value) -> Option<String> {
        // Predlog ime fajla s nedozvoljenom ekstenzijom (ili bez nje) se odbija
        // kao da je korisnik otkazao — dijalog se ni ne otvara.
        let ime = ime_za_cuvanje(opcije["defaultPath"].as_str()?)?;
        let mut d = self.app.dialog().file().set_file_name(ime);
        if let Some(t) = opcije["title"].as_str() {
            d = d.set_title(t);
        }
        for (ime, ext) in dozvoljeni_filteri(&opcije) {
            let ext: Vec<&str> = ext.iter().map(String::as_str).collect();
            d = d.add_filter(ime, &ext);
        }
        d.blocking_save_file()
            .and_then(|f| f.into_path().ok())
            .filter(|p| dozvoljena_ekstenzija(p))
            .map(|p| p.to_string_lossy().into_owned())
    }

    fn dijalog_otvori(&self, opcije: Value) -> Option<String> {
        let mut d = self.app.dialog().file();
        if let Some(t) = opcije["title"].as_str() {
            d = d.set_title(t);
        }
        for (ime, ext) in filteri(&opcije) {
            let ext: Vec<&str> = ext.iter().map(String::as_str).collect();
            d = d.add_filter(ime, &ext);
        }
        d.blocking_pick_file().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
    }

    fn dijalog_potvrda(&self, opcije: Value) -> i64 {
        // Electron: `buttons` redom, `cancelId` je dugme za odustajanje. Sistemski
        // dijalog ima "potvrdi" i "otkaži"; potvrda je dugme koje nije cancelId.
        let dugmad: Vec<String> = opcije["buttons"].as_array().into_iter().flatten().filter_map(|b| b.as_str().map(str::to_string)).collect();
        let cancel = opcije["cancelId"].as_i64().unwrap_or(0);
        let potvrda = (0..dugmad.len() as i64).find(|i| *i != cancel).unwrap_or(0);
        let tekst = [opcije["message"].as_str(), opcije["detail"].as_str()].into_iter().flatten().collect::<Vec<_>>().join("\n\n");
        let mut d = self.app.dialog().message(tekst);
        if let Some(t) = opcije["title"].as_str() {
            d = d.title(t);
        }
        d = d.kind(match opcije["type"].as_str() {
            Some("warning") => MessageDialogKind::Warning,
            Some("error") => MessageDialogKind::Error,
            _ => MessageDialogKind::Info,
        });
        if dugmad.len() >= 2 {
            let ok = dugmad[potvrda as usize].clone();
            let otkazi = dugmad.get(cancel as usize).cloned().unwrap_or_else(|| "Otkaži".into());
            d = d.buttons(MessageDialogButtons::OkCancelCustom(ok.clone(), otkazi));
            return match d.blocking_show_with_result() {
                MessageDialogResult::Ok => potvrda,
                MessageDialogResult::Custom(s) if s == ok => potvrda,
                _ => cancel,
            };
        }
        d.blocking_show();
        0
    }

    fn restartuj_za(&self, ms: u64) {
        let app = self.app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            app.state::<Backend>().zatvori_db_u_redu();
            app.restart();
        });
    }

    fn licenca_blokirana(&self) {
        let _ = self.app.emit("licenca:blokirano", ());
    }
}

/// `ipcRenderer.invoke(kanal, ...args)` — isti kanali i isti oblik podataka
/// kao u Electronu. Sinhrona komanda radi na glavnoj niti, redom kojim su
/// pozivi stigli: tu se uzme mjesto u redu, a sam poziv (baza, štampa) ide na
/// drugu nit i odgovor vrati kroz `odgovor` kanal (`{ok}` ili `{greska}`).
#[tauri::command]
fn api(app: AppHandle, kanal: String, args: Vec<Value>, odgovor: Channel<Value>) {
    let tiket = app.state::<Backend>().tiket();
    std::thread::spawn(move || {
        let r = app.state::<Backend>().call_u_redu(tiket, &kanal, args);
        let _ = odgovor.send(match r {
            Ok(v) => serde_json::json!({ "ok": v }),
            Err(g) => serde_json::json!({ "greska": g }),
        });
    });
}

/// Isti folder kao Electron `app.getPath('userData')` (appData/Pazar — stari naziv
/// programa, ostaje i nakon preimenovanja u Atlas), da
/// Tauri verzija otvori postojeću bazu i licencu. `PAZAR_USER_DATA` ga
/// zamijeni (testovi, rad nad kopijom baze).
fn user_data(app: &AppHandle) -> PathBuf {
    if let Some(p) = std::env::var_os("PAZAR_USER_DATA") {
        return PathBuf::from(p);
    }
    let baza = app.path().config_dir().unwrap_or_else(|_| std::env::temp_dir());
    baza.join("Pazar")
}

/// Smoke test (`PAZAR_SMOKE`) postoji samo u debug buildu: u release buildu
/// varijabla okruženja ne mijenja ništa (ni skripta, ni izlaz iz programa).
fn smoke() -> bool {
    cfg!(debug_assertions) && std::env::var_os("PAZAR_SMOKE").is_some()
}

/// Kraj smoke testa (`smoke.js`): ispiše rezultat i prozore, pa ugasi program.
/// Bez `PAZAR_SMOKE` ne radi ništa.
#[tauri::command]
fn smoke_kraj(app: AppHandle, rezultat: Value) {
    if !smoke() {
        return;
    }
    let mut prozori: Vec<String> = app.webview_windows().keys().cloned().collect();
    prozori.sort();
    let pao = rezultat["greska"].is_string()
        || rezultat["provjere"].as_array().into_iter().flatten().any(|p| p["ok"] != Value::Bool(true));
    println!("{}", serde_json::json!({ "rezultat": rezultat, "prozori": prozori }));
    if pao {
        // `app.exit(1)` na macOS-u završi s kodom 0 — pad mora biti vidljiv i skripti.
        use std::io::Write;
        let _ = std::io::stdout().flush();
        std::process::exit(1);
    }
    app.exit(0);
}

static PDF_PROZORI: AtomicU32 = AtomicU32::new(0);

/// `window.open(blobUrl)` za PDF pregled: novi prozor dijeli webview
/// konfiguraciju s glavnim (inače blob: URL ne postoji u novom prozoru).
/// Capability (`capabilities/default.json`) važi samo za `main`; na macOS-u
/// WebKit ipak daje popupu konfiguraciju otvarača (i njegov IPC), pa PDF
/// prozor ne smije učitati ništa osim svog blob: sadržaja.
fn novi_prozor(app: &AppHandle, url: tauri::Url, features: tauri::webview::NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if url.scheme() != "blob" {
        return NewWindowResponse::Deny;
    }
    let n = PDF_PROZORI.fetch_add(1, Ordering::SeqCst) + 1;
    let prozor = WebviewWindowBuilder::new(app, format!("pdf-{n}"), WebviewUrl::External("about:blank".parse().unwrap()))
        .window_features(features)
        .title("PDF")
        .inner_size(900.0, 700.0)
        .on_document_title_changed(|w, naslov| {
            let _ = w.set_title(&naslov);
        })
        // Samo svoj PDF (blob:); nikakva navigacija dalje ni novi prozori.
        .on_navigation(|url| url.scheme() == "blob" || url.as_str() == "about:blank")
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build();
    match prozor {
        Ok(window) => NewWindowResponse::Create { window },
        Err(_) => NewWindowResponse::Deny,
    }
}

fn glavni_prozor(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let a = app.clone();
    let prozor = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Atlas")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .background_color(tauri::window::Color(0x0f, 0x17, 0x2a, 0xff))
        .on_new_window(move |url, features| novi_prozor(&a, url, features))
        .on_page_load(|w, p| {
            if smoke() && p.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = w.eval(include_str!("smoke.js"));
            }
        })
        .build()?;
    iskljuci_precice_preglednika(&prozor);
    Ok(prozor)
}

/// WebView2 na Windowsu sam obradi tipke preglednika (F5 = osvježi, Ctrl+F = traži,
/// F3, Ctrl+P…) prije nego stignu do stranice, pa `preventDefault` u Reactu ne
/// pomaže: F5 bi osvježio kasu umjesto da naplati. Isključujemo ih isto kao wry
/// (`with_browser_accelerator_keys(false)`), što Tauri ne izlaže kroz builder.
/// Nativni meni (Cmd/Ctrl+P → „Štampaj…“) i kontekstni meni ostaju.
#[cfg(windows)]
fn iskljuci_precice_preglednika(prozor: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;
    let _ = prozor.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

#[cfg(not(windows))]
fn iskljuci_precice_preglednika(_prozor: &WebviewWindow) {}

/// Meni s "Štampaj…" (Cmd/Ctrl+P): PDF pregled u WebKitu nema svoju traku za štampu.
fn meni(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let stampaj = MenuItem::with_id(app, "stampaj", "Štampaj…", true, Some("CmdOrCtrl+P"))?;
    let datoteka = Submenu::with_items(app, "Datoteka", true, &[&stampaj, &PredefinedMenuItem::close_window(app, Some("Zatvori prozor"))?])?;
    let uredi = Submenu::with_items(
        app,
        "Uredi",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    // "O programu" otvara dialog u aplikaciji (src/components/OProgramu.tsx),
    // isti na macOS-u i Windowsu, umjesto sistemskog About panela.
    let o_programu = MenuItem::with_id(app, "o-programu", "O programu Atlas", true, None::<&str>)?;
    #[cfg(target_os = "macos")]
    {
        let atlas = Submenu::with_items(
            app,
            "Atlas",
            true,
            &[&o_programu, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::hide(app, None)?, &PredefinedMenuItem::quit(app, Some("Zatvori Atlas"))?],
        )?;
        return Menu::with_items(app, &[&atlas, &datoteka, &uredi]);
    }
    #[allow(unreachable_code)]
    {
        let pomoc = Submenu::with_items(app, "Pomoć", true, &[&o_programu])?;
        Menu::with_items(app, &[&datoteka, &uredi, &pomoc])
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![api, smoke_kraj])
        .menu(|app| meni(app))
        .on_menu_event(|app, e| {
            if e.id() == "stampaj" {
                if let Some(w) = app.webview_windows().values().find(|w| w.is_focused().unwrap_or(false)) {
                    let _ = w.print();
                }
            } else if e.id() == "o-programu" {
                let _ = app.emit_to("main", "meni:o-programu", ());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let folder = user_data(&handle);
            let platforma = Box::new(TauriPlatforma { app: handle.clone() });
            match Backend::novi(&folder, platforma, Sat::sistemski(), true) {
                Ok(b) => {
                    app.manage(b);
                }
                Err(e) => {
                    handle
                        .dialog()
                        .message(format!("Baza podataka se ne može otvoriti:\n{}\n\n{}", folder.display(), e))
                        .title("Atlas")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    std::process::exit(1);
                }
            }
            glavni_prozor(&handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("greška pri pokretanju Atlasa")
        .run(|app, e| {
            // `before-quit` → closeDb(): WAL se upiše u kasa.db.
            if let RunEvent::Exit = e {
                if let Some(b) = app.try_state::<Backend>() {
                    b.zatvori_db_u_redu();
                }
            }
        });
}

#[cfg(test)]
mod testovi {
    use super::*;

    #[test]
    fn ime_za_cuvanje_samo_ime_bez_foldera() {
        assert_eq!(ime_za_cuvanje("Racun-1.pdf").as_deref(), Some("Racun-1.pdf"));
        assert_eq!(ime_za_cuvanje("/Users/x/Library/LaunchAgents/evil.pdf").as_deref(), Some("evil.pdf"));
        assert_eq!(ime_za_cuvanje("..\\..\\Startup\\izvoz.zip").as_deref(), Some("izvoz.zip"));
        assert_eq!(ime_za_cuvanje("C:\\Windows\\kasa-backup-2026-09-25.db").as_deref(), Some("kasa-backup-2026-09-25.db"));
        assert_eq!(ime_za_cuvanje("Izvjestaj.XLSX").as_deref(), Some("Izvjestaj.XLSX"));
        assert_eq!(ime_za_cuvanje("promet.csv").as_deref(), Some("promet.csv"));
    }

    #[test]
    fn ime_za_cuvanje_odbija_ostale_ekstenzije() {
        for los in ["evil.exe", "skripta.sh", "x.pdf.bat", ".bashrc", "bez-ekstenzije", "", "folder/", "..", "a\0.pdf", "plist.plist"] {
            assert_eq!(ime_za_cuvanje(los), None, "{los}");
        }
    }

    #[test]
    fn filteri_bez_nedozvoljenih_ekstenzija() {
        let opcije = serde_json::json!({ "filters": [
            { "name": "PDF", "extensions": ["pdf"] },
            { "name": "Sve", "extensions": ["exe", "zip"] },
            { "name": "Skripte", "extensions": ["sh"] },
        ]});
        assert_eq!(
            dozvoljeni_filteri(&opcije),
            vec![("PDF".to_string(), vec!["pdf".to_string()]), ("Sve".to_string(), vec!["zip".to_string()])]
        );
    }
}
