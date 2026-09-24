// Veličina prikaza: zoom cijelog webviewa, pamti se po uređaju u postavci
// `ui.skala`. Skalira i fontove zadane u px (`text-[12px]`), što promjena
// root font-size ne bi. Samo pod Tauri-jem — Electron build ostaje na 100 %.

export const SKALA_KLJUC = 'ui.skala';

// Najmanji prozor je 1024×700: na 125 % to je ~820×560 CSS px, a veće
// skale lome kasa ekran.
export const SKALE = [0.8, 0.9, 1, 1.1, 1.25] as const;

export const skalaPodrzana = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Sačuvana vrijednost → jedna od SKALE; sve ostalo je 100 %. */
export function procitajSkalu(v: string | null | undefined): number {
  const n = Number(v);
  return (SKALE as readonly number[]).includes(n) ? n : 1;
}

export async function primijeniSkalu(skala: number): Promise<void> {
  if (!skalaPodrzana()) return;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview().setZoom(skala);
}

/** Pri pokretanju: pročitaj postavku i primijeni je (100 % se ne dira). */
export async function primijeniSacuvanuSkalu(): Promise<void> {
  if (!skalaPodrzana()) return;
  const skala = procitajSkalu(await window.api.getSetting(SKALA_KLJUC));
  if (skala !== 1) await primijeniSkalu(skala);
}
