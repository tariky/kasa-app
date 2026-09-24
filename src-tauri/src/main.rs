// Bez konzolnog prozora na Windowsu u release buildu.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pazar_lib::run()
}
