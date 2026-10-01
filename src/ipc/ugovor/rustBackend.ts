// Pokreće Rust backend (src-tauri/backend) kao proces `ugovor-server` i
// razgovara s njim JSON linijama — vidi src-tauri/backend/src/bin/ugovor_server.rs.
// Zahtjevi idu na stdin, a odgovori (stdout procesa) u fajl koji se čita tajmerom.
// Binarij se gradi prije testova (`bun run test:rust`); ovdje se samo provjeri
// da postoji.
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Backend, OdgovoriDijaloga, OtvoreniDijalog } from './backend';
import { BazaTesta } from './bazaTesta';
import { pokreniLaziTring } from './laziTring';
import { ZONA_TESTA } from './zona';

const KORIJEN = path.join(__dirname, '../../..');
const BINARIJ = process.env.KASA_RUST_BINARIJ
  ?? path.join(KORIJEN, 'src-tauri/target/debug', process.platform === 'win32' ? 'ugovor-server.exe' : 'ugovor-server');

interface Odgovor {
  id?: number;
  ok?: unknown;
  greska?: string;
  dijalozi?: OtvoreniDijalog[];
  spreman?: boolean;
  dogadjaj?: string;
}

/** `baza`: postojeći fajl baze koji se kopira kao kasa.db prije otvaranja (vidi OpcijeBackenda). */
export async function otvoriRustBackend(baza?: string): Promise<Backend> {
  const userData = mkdtempSync(path.join(tmpdir(), 'kasa-ugovor-rs-'));
  if (baza) copyFileSync(baza, path.join(userData, 'kasa.db'));
  return otvoriRustBackendNad(userData);
}

/** Rust backend nad postojećim folderom (npr. kopija stvarne baze); `close` ga briše. */
export async function otvoriRustBackendNad(userData: string): Promise<Backend> {
  if (!existsSync(BINARIJ)) {
    throw new Error(`Nema ${BINARIJ} — prvo: cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server`);
  }
  const radniFolder = path.join(userData, 'radni');
  mkdirSync(radniFolder, { recursive: true });

  let restart = false;
  const dogadjaji: { ime: string; podaci: unknown }[] = [];
  let cekaju = new Map<number, (o: Odgovor) => void>();
  let brojProcesa = 0;

  /** Pokrene ugovor-server nad `userData` i sačeka da javi da je spreman. */
  async function pokreni() {
    // Odgovori idu u fajl, ne kroz pipe: bun na Windowsu (1.3.14–1.4.2) ne
    // dostavi stdout podprocesa dok `expect(poziv).rejects` čeka odgovor koji
    // stiže poslije sporog prethodnog (npr. provjera PIN-a) — test visi, iako
    // je ugovor-server odgovor upisao. Tajmeri za to vrijeme rade, pa se fajl
    // čita tajmerom.
    const izlaz = path.join(userData, `ugovor-stdout-${++brojProcesa}.jsonl`);
    const proc = Bun.spawn([BINARIJ, userData], {
      // Backend računa "danas" i SQLite `localtime` u istoj zoni kao test (zona.ts).
      env: { ...process.env, TZ: ZONA_TESTA },
      stdin: 'pipe',
      stdout: Bun.file(izlaz),
      stderr: process.env.KASA_UGOVOR_LOG ? 'inherit' : 'ignore',
    });
    // Svaki proces ima svoje zahtjeve na čekanju (stari se gasi prije novog).
    const mojiZahtjevi = new Map<number, (o: Odgovor) => void>();
    cekaju = mojiZahtjevi;
    let spreman!: (o: Odgovor) => void;
    const pokrenut = new Promise<Odgovor>(r => { spreman = r; });

    const dekoder = new TextDecoder();
    let buf = '';
    function obradi(dio: Uint8Array) {
      buf += dekoder.decode(dio, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const linija = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!linija.trim()) continue;
        const o = JSON.parse(linija) as Odgovor;
        if (o.spreman !== undefined) spreman(o);
        else if (o.dogadjaj === 'restart') restart = true;
        else if (o.dogadjaj) dogadjaji.push({ ime: o.dogadjaj, podaci: (o as { podaci?: unknown }).podaci ?? null });
        else if (o.id !== undefined) { mojiZahtjevi.get(o.id)?.(o); mojiZahtjevi.delete(o.id); }
      }
    }

    let fd: number | null = null;
    let pozicija = 0;
    const komad = new Uint8Array(64 * 1024);
    function procitaj() {
      if (fd === null) {
        try { fd = openSync(izlaz, 'r'); } catch { return; }
      }
      let n: number;
      while ((n = readSync(fd, komad, 0, komad.length, pozicija)) > 0) {
        pozicija += n;
        obradi(komad.subarray(0, n));
      }
    }
    const tajmer = setInterval(procitaj, 2);
    // Fajl se zatvori prije nego close() obriše userData (Windows ne da obrisati otvoren fajl).
    void proc.exited.then(() => {
      clearInterval(tajmer);
      procitaj();
      if (fd !== null) closeSync(fd);
    });

    const start = await pokrenut;
    if (!start.spreman) throw new Error(`ugovor-server nije pokrenut: ${start.greska}`);
    return proc;
  }

  /** Ugasi proces: zatvoren stdin = kraj petlje zahtjeva, pa proces izađe. */
  async function ugasi(p: Awaited<ReturnType<typeof pokreni>>) {
    p.stdin.end();
    await p.exited;
  }

  let proc = await pokreni();

  const putanjaBaze = path.join(userData, 'kasa.db');
  let db = new BazaTesta(putanjaBaze, { strict: true });
  const tring = pokreniLaziTring();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(tring.port));

  const dijalog: OdgovoriDijaloga = { sacuvaj: null, otvori: null, potvrda: 0 };
  const otvoreniDijalozi: OtvoreniDijalog[] = [];
  let sljedeci = 0;

  /** Jedan zahtjev ugovor-serveru i njegov odgovor. */
  async function zahtjev(tijelo: Record<string, unknown>): Promise<Odgovor> {
    const id = ++sljedeci;
    const odgovor = new Promise<Odgovor>(r => cekaju.set(id, r));
    proc.stdin.write(JSON.stringify({ id, ...tijelo }) + '\n');
    proc.stdin.flush();
    return odgovor;
  }

  let backupR2: import('../../lib/licenca').R2Podaci | null = null;
  /** R2 podaci "licence" (bez odgovora — server ih obradi prije sljedećeg zahtjeva). */
  function posaljiBackupLicencu() {
    proc.stdin.write(JSON.stringify({ meta: 'backupLicenca', r2: backupR2 }) + '\n');
    proc.stdin.flush();
  }

  const backend: Backend = {
    get db() { return db; },
    tring,
    dijalog,
    otvoreniDijalozi,
    dogadjaji,
    postaviBackupLicencu(r2) {
      backupR2 = r2;
      posaljiBackupLicencu();
    },
    async r2IzTokena(token) {
      return ((await zahtjev({ meta: 'r2IzTokena', token })).ok ?? null) as import('../../lib/licenca').R2Podaci | null;
    },
    radniFolder,
    restartovan: () => restart,
    async kanali() {
      const o = await zahtjev({ meta: 'kanali' });
      return [...(o.ok as string[])].sort();
    },
    async ponovoPokreni() {
      // Novi proces nad istom bazom: shema, migracije i seed se ponove, a
      // sesija i budžet promjena PIN-a počinju iz početka (blokada je u bazi).
      await ugasi(proc);
      proc = await pokreni();
      if (backupR2) posaljiBackupLicencu();
    },
    // Isti poziv; tipove argumenata i rezultata daje Backend.pozovi.
    pozovi: (kanal, ...args) => (backend.call as unknown as (kanal: string, ...args: unknown[]) => Promise<never>)(kanal, ...args),
    async call(kanal, ...args) {
      // db:restore briše i zamjenjuje kasa.db; Windows ne da obrisati fajl koji
      // drži druga konekcija (ova, iz procesa testa), pa se ona pusti za vrijeme
      // uvoza. Nova konekcija gleda bazu kakva je poslije uvoza.
      const uvoz = kanal === 'db:restore';
      if (uvoz) db.close();
      let o: Odgovor;
      try {
        // Date.now() prati setSystemTime iz testa — backend računa "danas" po njemu.
        o = await zahtjev({ kanal, args, dijalog, sada: Date.now() });
      } finally {
        if (uvoz) db = new BazaTesta(putanjaBaze, { strict: true });
      }
      otvoreniDijalozi.push(...(o.dijalozi ?? []));
      if (o.greska !== undefined) throw new Error(o.greska);
      return o.ok ?? null;
    },
    async close() {
      await ugasi(proc);
      tring.stop();
      db.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
  return backend;
}
