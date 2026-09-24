// Potvrda i obavijest za ekrane. U Electronu su to window.confirm/alert; pod
// Tauri-jem na macOS-u WKWebView ih ne prikazuje (confirm odmah vrati false),
// pa idu na sistemski dijalog kroz plugin-dialog. Zato su asinhrone.

const jeTauri = () => '__TAURI_INTERNALS__' in window;

export async function potvrdi(poruka: string): Promise<boolean> {
  if (!jeTauri()) return window.confirm(poruka);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(poruka, { title: 'Atlas', kind: 'warning', okLabel: 'Da', cancelLabel: 'Ne' });
}

export async function obavijesti(poruka: string): Promise<void> {
  if (!jeTauri()) { window.alert(poruka); return; }
  const { message } = await import('@tauri-apps/plugin-dialog');
  await message(poruka, { title: 'Atlas', kind: 'error' });
}
