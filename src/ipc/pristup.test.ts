// pristup.json je jedini izvor lista pristupa za oba backenda (sesija.ts,
// licencaStanje.ts, sesija.rs, licenca.rs). Ovdje se drži tačnim: svaki kanal
// s liste postoji, ključevi dokumenata su u admin postavkama, bez duplikata.
import { test, expect } from 'bun:test';
import pristup from './pristup.json';
import { otvoriBackend } from './ugovor/backend';
import { KLJUCEVI_DOKUMENATA } from '../lib/dokumentPostavke';

/** Kanali koje ima samo Electron (automatski backup) — Rust ih odbija jer ne postoje. */
const SAMO_ELECTRON = ['backup:sada'];

const LISTE_KANALA: Record<string, string[]> = {
  kanaliBezPrijave: pristup.kanaliBezPrijave,
  kanaliSaZadanimPinom: pristup.kanaliSaZadanimPinom,
  adminKanali: pristup.adminKanali,
  blokiraniBezLicence: pristup.blokiraniBezLicence,
};

const SVE_LISTE: Record<string, string[]> = {
  ...LISTE_KANALA,
  'postavke.bezPrijave': pristup.postavke.bezPrijave,
  'postavke.zaSve': pristup.postavke.zaSve,
  'postavke.zaAdmina': pristup.postavke.zaAdmina,
  'postavke.tajne': pristup.postavke.tajne,
};

test('svaki kanal s liste postoji u backendu', async () => {
  const b = await otvoriBackend({ prijava: null });
  try {
    const postoje = new Set(await b.kanali());
    const preskoci = process.env.KASA_BACKEND === 'rust' ? SAMO_ELECTRON : [];
    const nepostojeci = Object.entries(LISTE_KANALA).flatMap(([lista, kanali]) =>
      kanali.filter(k => !postoje.has(k) && !preskoci.includes(k)).map(k => `${lista}: ${k}`));
    expect(nepostojeci).toEqual([]);
  } finally {
    await b.close();
  }
});

test('svi ključevi dokumenata su u postavkama za admina', () => {
  expect(KLJUCEVI_DOKUMENATA.filter(k => !pristup.postavke.zaAdmina.includes(k))).toEqual([]);
});

test('liste nemaju duplikata', () => {
  for (const [lista, stavke] of Object.entries(SVE_LISTE)) {
    expect({ lista, duplikati: stavke.filter((x, i) => stavke.indexOf(x) !== i) }).toEqual({ lista, duplikati: [] });
  }
});
