// Komande aplikacije prolaze kroz ACL kao i komande pluginova: dozvola
// `allow-<komanda>` mora biti u capability prozora (capabilities/default.json
// je daje samo prozoru `main`; PDF prozori `pdf-N` nemaju IPC).
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["api", "smoke_kraj"])),
    )
    .expect("tauri-build nije uspio");
}
