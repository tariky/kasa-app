// Jedna vremenska zona za test i oba backenda. bun test računa JS datume u
// UTC-u (ili u TZ iz okruženja), a SQLite u procesu testa — TS backend i
// `b.db` — računa `localtime` po zoni koju je proces dobio pri pokretanju:
// bez TZ u okruženju to je sistemska zona, pa se `datetime('now','localtime')`
// razilazio s "danas" testa i Rust backenda (u Evropi 1–2 h). Uvoz ovog modula
// prebaci libc zonu procesa (setenv + tzset) na zonu JS-a, a Rust dijete
// dobija istu kroz TZ (rustBackend.ts).
import { dlopen, FFIType } from 'bun:ffi';

/** Zona u kojoj test računa datume; ista za SQLite u procesu i za Rust dijete. */
export const ZONA_TESTA = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Koliko je lokalno vrijeme iz baze (YYYY-MM-DD HH:MM:SS) daleko od sata
 * testa, u sekundama — "upisano sada, po lokalnom vremenu".
 */
export function sekundiOdSada(datum: string): number {
  return Math.abs(Date.parse(datum.replace(' ', 'T')) - Date.now()) / 1000;
}

function uskladiZonuSqlite(): void {
  // Windows (CI build-windows-tauri): CRT ima svoju zonu, a runner je u UTC-u
  // kao i bun test — ostaje kako jeste.
  if (process.platform === 'win32') return;
  const libc = dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
    setenv: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    tzset: { args: [], returns: FFIType.void },
  });
  const kljuc = Buffer.from('TZ\0');
  const vrijednost = Buffer.from(`${ZONA_TESTA}\0`);
  if (libc.symbols.setenv(kljuc, vrijednost, 1) !== 0) throw new Error(`setenv TZ=${ZONA_TESTA} nije uspio`);
  libc.symbols.tzset();
  libc.close();
}

uskladiZonuSqlite();
