// Zajedničko CLI-ju i GUI-ju: gdje je privatni ključ, izdavanje s
// provjerom i dnevnik izdanih licenci.
import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { izdajLicencu, provjeriLicencu, lokalniDatum, Licenca } from '../src/lib/licenca';

export const PRIVATNI = process.env.PAZAR_LICENCA_KLJUC ?? join(homedir(), '.pazar-licenca', 'privatni.pem');
const DNEVNIK = join(dirname(PRIVATNI), 'izdane.jsonl');

export interface IzdanaLicenca extends Licenca {
  token: string;
  vrijeme: string;
}

export function ucitajPrivatni(): KeyObject {
  if (!existsSync(PRIVATNI)) {
    throw new Error(`nema privatnog ključa na ${PRIVATNI} — prvo pokreni "bun tools/licenca.ts kljucevi"`);
  }
  return createPrivateKey(readFileSync(PRIVATNI, 'utf8'));
}

export function javniIzPrivatnog(): KeyObject {
  return createPublicKey(ucitajPrivatni());
}

/** Zadnji dan važenja kad licenca traje `dana` dana računajući i danas. */
export function doNakonDana(dana: number, od = new Date()): string {
  const d = new Date(od);
  d.setDate(d.getDate() + dana - 1);
  return lokalniDatum(d);
}

export function izdaj(unos: { klijent: string; vrijediDo: string; uredjaj?: string }): IzdanaLicenca {
  const privatni = ucitajPrivatni();
  const licenca: Licenca = {
    klijent: unos.klijent.trim(),
    vrijediDo: unos.vrijediDo,
    izdana: lokalniDatum(new Date()),
    ...(unos.uredjaj?.trim() ? { uredjaj: unos.uredjaj.trim() } : {}),
  };
  const token = izdajLicencu(licenca, privatni);

  // Provjera svojim javnim ključem da ne pošaljemo neispravan token.
  const r = provjeriLicencu(token, createPublicKey(privatni), { uredjaj: licenca.uredjaj });
  if (!r.ok) throw new Error(r.razlog === 'istekla' ? 'datum važenja je u prošlosti' : `token ne prolazi provjeru (${r.razlog})`);

  const izdana: IzdanaLicenca = { ...licenca, token, vrijeme: new Date().toISOString() };
  appendFileSync(DNEVNIK, JSON.stringify(izdana) + '\n', { mode: 0o600 });
  return izdana;
}

export function izdaneLicence(): IzdanaLicenca[] {
  if (!existsSync(DNEVNIK)) return [];
  return readFileSync(DNEVNIK, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((red) => JSON.parse(red) as IzdanaLicenca);
}
