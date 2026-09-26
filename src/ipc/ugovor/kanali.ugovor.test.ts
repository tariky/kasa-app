// Spisak kanala na tri mjesta mora biti isti: ono što zove window.api
// (napraviApi), ono što backend registruje i liste pristupa iz pristup.json
// (jedini izvor za sesija.ts, licencaStanje.ts, sesija.rs, licenca.rs). Ide
// nad oba backenda (KASA_BACKEND=rust bun test src/ipc/ugovor). Ovdje se drži
// i pristup.json tačnim: ključevi dokumenata su u admin postavkama, bez duplikata.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import pristup from '../pristup.json';
import { napraviApi } from '../api';
import { otvoriBackend, type Backend } from './backend';
import { primka, scenarij, spremljena, stavkaPrimke } from './scenarij';
import { KLJUCEVI_DOKUMENATA } from '../../lib/dokumentPostavke';

/** Kanali koje ima samo Electron (automatski backup, faza 4) — Rust ih nema. */
const SAMO_ELECTRON = ['backup:info', 'backup:sada'];
const preskoci = (kanali: string[]) =>
  process.env.KASA_BACKEND === 'rust' ? kanali.filter(k => !SAMO_ELECTRON.includes(k)) : kanali;

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

/** Kanali koje zove window.api: svaka metoda napraviApi pozvana jednom (argumenti nisu bitni). */
async function kanaliIzApi(): Promise<string[]> {
  const kanali = new Set<string>();
  const api = napraviApi(async (kanal) => { kanali.add(kanal); return null; }, () => () => undefined);
  for (const metoda of Object.values(api)) await (metoda as (...a: unknown[]) => unknown)({}, {}, {}, {});
  return [...kanali].sort();
}

describe('spisak kanala', () => {
  let b: Backend;
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });
  afterEach(async () => { await b.close(); });

  test('window.api zove tačno kanale koje backend registruje', async () => {
    expect(preskoci(await kanaliIzApi())).toEqual(await b.kanali());
  });

  test('svaki kanal s liste pristupa postoji u backendu', async () => {
    const postoje = new Set(await b.kanali());
    const nepostojeci = Object.entries(LISTE_KANALA).flatMap(([lista, kanali]) =>
      preskoci(kanali).filter(k => !postoje.has(k)).map(k => `${lista}: ${k}`));
    expect(nepostojeci).toEqual([]);
  });
});

test('svi ključevi dokumenata su u postavkama za admina', () => {
  expect(KLJUCEVI_DOKUMENATA.filter(k => !pristup.postavke.zaAdmina.includes(k))).toEqual([]);
});

test('liste nemaju duplikata', () => {
  for (const [lista, stavke] of Object.entries(SVE_LISTE)) {
    expect({ lista, duplikati: stavke.filter((x, i) => stavke.indexOf(x) !== i) }).toEqual({ lista, duplikati: [] });
  }
});

// Electron IPC prenosi `undefined` kakav jeste (structured clone), a ugovor i
// Rust za „nema vrijednosti" daju `null` — handler ga mora vratiti sam. JSON
// harnessa (Backend.call) tu razliku krije, pa se handler zove direktno.
describe.skipIf(process.env.KASA_BACKEND === 'rust')('Electron handler: nema vrijednosti je null', () => {
  let b: Backend;
  beforeEach(async () => { b = await otvoriBackend(); });
  afterEach(async () => { await b.close(); });

  test('product:get nepostojećeg artikla i uspješan primka:delete vraćaju null', async () => {
    const { pozoviHandlerBezJsona } = await import('./tsBackend');
    expect(await pozoviHandlerBezJsona('product:get', 999)).toBeNull();

    const p = scenarij(b).artikal({ sifra: 'N1', cijena: 5 });
    const { id } = spremljena(await b.pozovi('primka:create', primka('U-1', [stavkaPrimke(p, 1, 5)])));
    expect(await pozoviHandlerBezJsona('primka:delete', id)).toBeNull();
  });
});
