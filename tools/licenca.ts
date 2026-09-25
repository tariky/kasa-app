#!/usr/bin/env bun
// Generator licenci za Pazar. Privatni ključ živi VAN repoa
// (~/.pazar-licenca/privatni.pem ili $PAZAR_LICENCA_KLJUC) — ko ga ima,
// može izdati licencu bilo kome, zato ga ne commitati i čuvati backup.
//
//   bun tools/licenca.ts kljucevi
//   bun tools/licenca.ts izdaj --klijent "Pekara X" --dana 31
//   bun tools/licenca.ts izdaj --klijent "Pekara X" --do 2026-12-31 --uredjaj <id>
//   bun tools/licenca.ts izdaj --klijent X (--dana N | --do YYYY-MM-DD) [--uredjaj ID] [--moduli skladiste,ponude,proizvodnja,generator | --moduli ""] [--backup BUCKET [--r2-kljuc ID --r2-secret S]]
//   bun tools/licenca.ts provjeri <token>
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { provjeriLicencu, procitajLicencu } from '../src/lib/licenca';
import { opisModula, type Modul } from '../src/lib/moduli';
import { PODRAZUMIJEVANI_MODULI, PRIVATNI, doNakonDana, izdaj as izdajLicencu, javniIzPrivatnog } from './licenca-zajednicko';
const JAVNI_TS = join(import.meta.dir, '..', 'src', 'lib', 'licencaJavniKljuc.ts');

function greska(poruka: string): never {
  console.error(`Greška: ${poruka}`);
  process.exit(1);
}

function javni() {
  try {
    return javniIzPrivatnog();
  } catch (e) {
    greska((e as Error).message);
  }
}

function kljucevi(prepisi: boolean) {
  if (existsSync(PRIVATNI) && !prepisi) {
    greska(`ključ već postoji (${PRIVATNI}). Novi ključ poništava SVE izdane licence — ako to stvarno želiš, dodaj --prepisi`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(PRIVATNI), { recursive: true, mode: 0o700 });
  writeFileSync(PRIVATNI, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  zapisiJavni(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  console.log(`Privatni ključ: ${PRIVATNI}  (napravi backup, ne commitaj)`);
  console.log(`Javni ključ:    ${JAVNI_TS}  (ide u aplikaciju)`);
}

function zapisiJavni(pem: string) {
  writeFileSync(
    JAVNI_TS,
    `// Generisano sa \`bun tools/licenca.ts kljucevi\` — ne mijenjati ručno.\n` +
      `export const LICENCA_JAVNI_KLJUC = \`${pem.trim()}\n\`;\n`,
  );
}

async function izdaj(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      klijent: { type: 'string' },
      dana: { type: 'string' },
      do: { type: 'string' },
      uredjaj: { type: 'string' },
      moduli: { type: 'string' },
      backup: { type: 'string' },
      'r2-kljuc': { type: 'string' },
      'r2-secret': { type: 'string' },
    },
  });
  if (!values.klijent) greska('--klijent je obavezan');
  if (!values.dana === !values.do) greska('zadaj tačno jedno: --dana N ili --do YYYY-MM-DD');

  let vrijediDo = values.do;
  if (values.dana) {
    const n = Number(values.dana);
    if (!Number.isInteger(n) || n < 1) greska('--dana mora biti pozitivan cijeli broj');
    vrijediDo = doNakonDana(n);
  }

  const moduli = (values.moduli === undefined ? PODRAZUMIJEVANI_MODULI : values.moduli.split(',').map(m => m.trim()).filter(Boolean)) as Modul[];

  let izdana: Awaited<ReturnType<typeof izdajLicencu>>;
  try {
    izdana = await izdajLicencu({ klijent: values.klijent, vrijediDo: vrijediDo!, uredjaj: values.uredjaj, moduli,
      backup: values.backup ? { bucket: values.backup, accessKeyId: values['r2-kljuc'], secret: values['r2-secret'] } : undefined,
    });
  } catch (e) {
    greska((e as Error).message);
  }

  console.error(`Klijent:   ${values.klijent}`);
  console.error(`Važi do:   ${vrijediDo} (uključivo)`);
  console.error(`Moduli:    ${opisModula(izdana.moduli)}`);
  if (values.uredjaj) console.error(`Uređaj:    ${values.uredjaj}`);
  if (values.backup) console.error(`Backup:    ${values.backup}`);
  console.error('');
  console.log(izdana.token);
}

function provjeri(token: string | undefined) {
  if (!token) greska('zadaj token');
  const licenca = procitajLicencu(token);
  if (!licenca) greska('token nije u ispravnom formatu');
  const r = provjeriLicencu(token, javni(), { uredjaj: licenca.uredjaj });
  console.log(`Klijent:   ${licenca.klijent}`);
  console.log(`Izdana:    ${licenca.izdana}`);
  console.log(`Važi do:   ${licenca.vrijediDo}`);
  if (licenca.uredjaj) console.log(`Uređaj:    ${licenca.uredjaj}`);
  console.log(`Moduli:    ${opisModula(licenca.moduli)}`);
  if (licenca.backup) console.log(`Backup:    ${licenca.backup.bucket}`);
  console.log(`Status:    ${r.ok ? 'ISPRAVNA' : r.razlog.toUpperCase()}`);
  process.exit(r.ok ? 0 : 1);
}

const [komanda, ...ostalo] = process.argv.slice(2);
switch (komanda) {
  case 'kljucevi':
    kljucevi(ostalo.includes('--prepisi'));
    break;
  case 'izdaj':
    await izdaj(ostalo);
    break;
  case 'provjeri':
    provjeri(ostalo[0]);
    break;
  default:
    console.log('Upotreba: bun tools/licenca.ts <kljucevi [--prepisi] | izdaj --klijent X (--dana N | --do YYYY-MM-DD) [--uredjaj ID] [--moduli skladiste,ponude,proizvodnja,generator | --moduli ""] [--backup BUCKET [--r2-kljuc ID --r2-secret S]] | provjeri TOKEN>');
    process.exit(komanda ? 1 : 0);
}
