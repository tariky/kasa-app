//! Tauri ljuska oko `pazar-backend`: prozor, komanda `api` (zamjena za
//! `ipcRenderer.invoke`), sistemski dijalozi, restart i PDF prozori.

use std::path::PathBuf;
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

impl Platforma for TauriPlatforma {
    fn dijalog_sacuvaj(&self, opcije: Value) -> Option<String> {
        let mut d = self.app.dialog().file();
        if let Some(p) = opcije["defaultPath"].as_str() {
            // Electron prihvata i samo ime fajla i punu putanju.
            let p = PathBuf::from(p);
            if let (Some(dir), Some(ime)) = (p.parent().filter(|d| !d.as_os_str().is_empty()), p.file_name()) {
                d = d.set_directory(dir).set_file_name(ime.to_string_lossy());
            } else {
                d = d.set_file_name(p.to_string_lossy());
            }
        }
        if let Some(t) = opcije["title"].as_str() {
            d = d.set_title(t);
        }
        for (ime, ext) in filteri(&opcije) {
            let ext: Vec<&str> = ext.iter().map(String::as_str).collect();
            d = d.add_filter(ime, &ext);
        }
        d.blocking_save_file().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
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

fn smoke() -> bool {
    std::env::var_os("PAZAR_SMOKE").is_some()
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
    app.exit(if pao { 1 } else { 0 });
}

static PDF_PROZORI: AtomicU32 = AtomicU32::new(0);

/// `window.open(blobUrl)` za PDF pregled: novi prozor dijeli webview
/// konfiguraciju s glavnim (inače blob: URL ne postoji u novom prozoru).
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
