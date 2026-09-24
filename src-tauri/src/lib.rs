//! Tauri ljuska oko `pazar-backend`: prozor, komanda `api` (zamjena za
//! `ipcRenderer.invoke`), sistemski dijalozi, restart i PDF prozori.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use pazar_backend::sat::Sat;
use pazar_backend::{Backend, Platforma};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

type Stanje = Mutex<Backend>;

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
            if let Ok(mut b) = app.state::<Stanje>().lock() {
                b.zatvori_db();
            }
            app.restart();
        });
    }

    fn licenca_blokirana(&self) {
        let _ = self.app.emit("licenca:blokirano", ());
    }
}

/// `ipcRenderer.invoke(kanal, ...args)` — isti kanali i isti oblik podataka
/// kao u Electronu. Backend blokira (baza, štampa), pa radi van glavne niti.
#[tauri::command]
async fn api(app: AppHandle, kanal: String, args: Vec<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stanje = app.state::<Stanje>();
        let mut b = stanje.lock().unwrap_or_else(|e| e.into_inner());
        b.call(&kanal, args)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Isti folder kao Electron `app.getPath('userData')` (appData/Pazar), da
/// Tauri verzija otvori postojeću bazu i licencu.
fn user_data(app: &AppHandle) -> PathBuf {
    let baza = app.path().config_dir().unwrap_or_else(|_| std::env::temp_dir());
    baza.join("Pazar")
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
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Pazar")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .background_color(tauri::window::Color(0x0f, 0x17, 0x2a, 0xff))
        .on_new_window(move |url, features| novi_prozor(&a, url, features))
        .build()
}

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
    #[cfg(target_os = "macos")]
    {
        let o_programu = PredefinedMenuItem::about(
            app,
            Some("O programu Pazar"),
            Some(tauri::menu::AboutMetadata {
                name: Some("Pazar".into()),
                version: Some(app.package_info().version.to_string()),
                copyright: Some("© 2026 Tarik Caplja / Lunatik".into()),
                credits: Some("Razvio: Tarik Caplja\ntarik@lunatik.ba".into()),
                ..Default::default()
            }),
        )?;
        let pazar = Submenu::with_items(
            app,
            "Pazar",
            true,
            &[&o_programu, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::hide(app, None)?, &PredefinedMenuItem::quit(app, Some("Zatvori Pazar"))?],
        )?;
        return Menu::with_items(app, &[&pazar, &datoteka, &uredi]);
    }
    #[allow(unreachable_code)]
    Menu::with_items(app, &[&datoteka, &uredi])
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![api])
        .menu(|app| meni(app))
        .on_menu_event(|app, e| {
            if e.id() == "stampaj" {
                if let Some(w) = app.webview_windows().values().find(|w| w.is_focused().unwrap_or(false)) {
                    let _ = w.print();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let folder = user_data(&handle);
            let platforma = Box::new(TauriPlatforma { app: handle.clone() });
            match Backend::novi(&folder, platforma, Sat::sistemski(), true) {
                Ok(b) => {
                    app.manage::<Stanje>(Mutex::new(b));
                }
                Err(e) => {
                    handle
                        .dialog()
                        .message(format!("Baza podataka se ne može otvoriti:\n{}\n\n{}", folder.display(), e))
                        .title("Pazar")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    std::process::exit(1);
                }
            }
            glavni_prozor(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("greška pri pokretanju Pazara");
}
