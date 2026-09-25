// Licenca u main procesu: čuva token i zadnji viđeni datum u
// `userData/licenca.json` (van baze, da ga restore backupa ne pregazi),
// računa ID uređaja i blokira kanale koji prave nove dokumente kad je
// licenca zaključana ili modul nije licenciran.
import { app, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { lokalniDatum } from '../lib/licenca';
import { LICENCA_JAVNI_KLJUC } from '../lib/licencaJavniKljuc';
import { uredjajId } from '../lib/uredjaj';
import { izracunajStanje, efektivniDanas, kanalPodLicencom, razlogBlokade, type LicencaInfo } from '../lib/licencaStanje';

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

/** Baca grešku ako licenca ne dozvoljava kanal (istekla ili modul nije licenciran). */
export function provjeriKanal(kanal: string): void {
  if (!kanalPodLicencom(kanal)) return;
  const blokada = razlogBlokade(stanjeLicence(), kanal);
  if (!blokada) return;
  if (blokada.razlog === 'istekla') {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('licenca:blokirano');
  }
  throw new Error(blokada.poruka);
}
