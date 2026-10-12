// Podiže verziju aplikacije na svim mjestima odjednom — svako izdanje (Electron
// i Tauri, i probni Windows instaler) mora nositi novu verziju.
//
//   bun run verzija            1.0.0 → 1.0.1
//   bun run verzija minor      1.0.3 → 1.1.0
//   bun run verzija major      1.4.2 → 2.0.0
//   bun run verzija 1.2.0      tačno ta verzija
import { join } from 'node:path';

export type Dio = 'patch' | 'minor' | 'major';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Sljedeća verzija: dio (patch/minor/major) ili izričita verzija (mora biti veća). */
export function sljedecaVerzija(trenutna: string, zahtjev: string = 'patch'): string {
  const t = SEMVER.exec(trenutna);
  if (!t) throw new Error(`Trenutna verzija nije oblika X.Y.Z: "${trenutna}"`);
  const [maj, min, pat] = t.slice(1).map(Number);
  if (zahtjev === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (zahtjev === 'minor') return `${maj}.${min + 1}.0`;
  if (zahtjev === 'major') return `${maj + 1}.0.0`;
  const n = SEMVER.exec(zahtjev);
  if (!n) throw new Error(`Nepoznat zahtjev "${zahtjev}" — patch, minor, major ili X.Y.Z`);
  const a = [maj, min, pat];
  const b = n.slice(1).map(Number);
  const veca = b[0] !== a[0] ? b[0] > a[0] : b[1] !== a[1] ? b[1] > a[1] : b[2] > a[2];
  if (!veca) throw new Error(`Nova verzija ${zahtjev} mora biti veća od ${trenutna}`);
  return zahtjev;
}

/** Zamijeni tačno jedno pojavljivanje `stari` u tekstu fajla, inače greška (format se promijenio). */
function zamijeni(tekst: string, stari: RegExp, novi: string, fajl: string): string {
  const pogodaka = tekst.match(new RegExp(stari.source, stari.flags.includes('g') ? stari.flags : stari.flags + 'g'))?.length ?? 0;
  if (pogodaka !== 1) throw new Error(`${fajl}: očekivano tačno jedno mjesto verzije, nađeno ${pogodaka}`);
  return tekst.replace(stari, novi);
}

/** Fajlovi i obrasci: verzija je uvijek ista na svim mjestima. */
function mjesta(nova: string): Array<{ fajl: string; obrazac: RegExp; zamjena: string }> {
  return [
    { fajl: 'package.json', obrazac: /^  "version": "[^"]+",$/m, zamjena: `  "version": "${nova}",` },
    { fajl: 'src-tauri/tauri.conf.json', obrazac: /^  "version": "[^"]+",$/m, zamjena: `  "version": "${nova}",` },
    { fajl: 'src-tauri/Cargo.toml', obrazac: /^version = "[^"]+"$/m, zamjena: `version = "${nova}"` },
    { fajl: 'src-tauri/backend/Cargo.toml', obrazac: /^version = "[^"]+"$/m, zamjena: `version = "${nova}"` },
    { fajl: 'src-tauri/Cargo.lock', obrazac: /^name = "pazar"\nversion = "[^"]+"$/m, zamjena: `name = "pazar"\nversion = "${nova}"` },
    { fajl: 'src-tauri/Cargo.lock', obrazac: /^name = "pazar-backend"\nversion = "[^"]+"$/m, zamjena: `name = "pazar-backend"\nversion = "${nova}"` },
  ];
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..');
  const trenutna = (await Bun.file(join(root, 'package.json')).json()).version as string;
  const nova = sljedecaVerzija(trenutna, process.argv[2] ?? 'patch');

  // Sve se prvo pripremi u memoriji — greška u jednom fajlu ne ostavlja pola izmijenjeno.
  const sadrzaj = new Map<string, string>();
  for (const { fajl, obrazac, zamjena } of mjesta(nova)) {
    const tekst = sadrzaj.get(fajl) ?? (await Bun.file(join(root, fajl)).text());
    sadrzaj.set(fajl, zamijeni(tekst, obrazac, zamjena, fajl));
  }
  for (const [fajl, tekst] of sadrzaj) await Bun.write(join(root, fajl), tekst);
  console.log(`${trenutna} → ${nova}`);
}
