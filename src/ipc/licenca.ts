// Licenca u main procesu: čuva token i zadnji viđeni datum u
// `userData/licenca.json` (van baze, da ga restore backupa ne pregazi),
// računa ID uređaja i blokira kanale koji prave nove dokumente kad je
// licenca zaključana.
import { app, BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { lokalniDatum } from '../lib/licenca';
import { LICENCA_JAVNI_KLJUC } from '../lib/licencaJavniKljuc';
import { izracunajStanje, efektivniDanas, smijeRaditi, type LicencaInfo } from '../lib/licencaStanje';

/** Kanali koji prave nove dokumente ili mijenjaju stanje zaliha. */
const BLOKIRANI_KANALI = new Set([
  'order:create', 'order:createManual', 'order:finalize', 'order:finalizePrilog',
  'order:refund', 'order:refundAndPrint',
  'tring:printReceipt', 'tring:printRefund',
  'primka:create', 'primka:update',
  'product:adjustStock',
  'ponuda:create', 'ponuda:update', 'ponuda:konvertuj',
  'nalog:create', 'nalog:createIzPonude', 'nalog:update', 'nalog:replaceStavke',
  'nalog:setStatus', 'nalog:izdajRacun',
]);

interface Zapis {
  token?: string;
  zadnjiDatum?: string;
}

function putanja(): string {
  return path.join(app.getPath('userData'), 'licenca.json');
}

function procitaj(): Zapis {
  try {
    return existsSync(putanja()) ? JSON.parse(readFileSync(putanja(), 'utf8')) : {};
  } catch {
    return {};
  }
}

function zapisi(z: Zapis): void {
  writeFileSync(putanja(), JSON.stringify(z, null, 2));
}

function sirovIdUredjaja(): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' });
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

export function stanjeLicence(): LicencaInfo {
  const z = procitaj();
  const danas = efektivniDanas(lokalniDatum(new Date()), z.zadnjiDatum);
  if (z.zadnjiDatum !== danas && z.token) zapisi({ ...z, zadnjiDatum: danas });
  const uredjaj = uredjajId();
  return { ...izracunajStanje(z.token, LICENCA_JAVNI_KLJUC, { danas, uredjaj }), uredjaj };
}

export function aktivirajLicencu(token: string): LicencaInfo {
  const z = procitaj();
  const danas = efektivniDanas(lokalniDatum(new Date()), z.zadnjiDatum);
  const uredjaj = uredjajId();
  const s = izracunajStanje(token, LICENCA_JAVNI_KLJUC, { danas, uredjaj });
  if (s.stanje === 'nema' || s.stanje === 'neispravna') {
    const poruke = {
      nema: 'Upišite kod licence.',
      format: 'Kod nije ispravan — provjerite da ste kopirali cijeli kod.',
      potpis: 'Kod nije ispravan — provjerite da ste kopirali cijeli kod.',
      uredjaj: 'Ovaj kod je izdan za drugi računar.',
    };
    throw new Error(poruke[s.stanje === 'nema' ? 'nema' : s.razlog]);
  }
  if (s.stanje === 'zakljucana') throw new Error(`Ovaj kod je istekao ${s.licenca.vrijediDo.split('-').reverse().join('.')}.`);
  zapisi({ token: token.trim(), zadnjiDatum: danas });
  return { ...s, uredjaj };
}

/** Baca grešku ako je kanal blokiran a licenca ne dozvoljava rad. */
export function provjeriKanal(kanal: string): void {
  if (!BLOKIRANI_KANALI.has(kanal)) return;
  if (smijeRaditi(stanjeLicence())) return;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('licenca:blokirano');
  throw new Error('Licenca je istekla — program radi samo za pregled. Unesite novi kod licence.');
}
