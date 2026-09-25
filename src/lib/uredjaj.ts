// ID ovog računara (licenca vezana za uređaj, ime backup-a). Bez Electrona,
// da ga koristi i tools/backup. Rust: `uredjaj_id()` u licenca.rs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { win32 } from 'node:path';

/**
 * Alati se zovu apsolutnom putanjom i bez shell-a: `reg`/`ioreg` iz PATH-a ili
 * radnog foldera mogao bi podmetnuti tuđi ID. Rust: `reg_putanja()` u licenca.rs.
 */
export function regPutanja(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
}
export const IOREG = '/usr/sbin/ioreg';

function sirovIdUredjaja(): string {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(regPutanja(), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync(IOREG, ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (existsSync(f)) return readFileSync(f, 'utf8').trim();
      }
    }
  } catch {
    // pada na hostname ispod
  }
  // Ostaje: postojeće licence mogu biti vezane za hash hostname-a.
  return hostname();
}

let idUredjaja: string | null = null;

/** Kratak, stabilan ID ovog računara, npr. `3F9A-01C2-7B44`. */
export function uredjajId(): string {
  if (!idUredjaja) {
    const h = createHash('sha256').update(`pazar:${sirovIdUredjaja()}`).digest('hex').slice(0, 12).toUpperCase();
    idUredjaja = h.match(/.{4}/g)!.join('-');
  }
  return idUredjaja;
}
