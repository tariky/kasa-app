// Pokreće Rust backend (src-tauri/backend) kao proces `ugovor-server` i
// razgovara s njim JSON linijama — vidi src-tauri/backend/src/bin/ugovor_server.rs.
// Binarij se gradi prije testova (`bun run test:rust`); ovdje se samo provjeri
// da postoji.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Backend, OdgovoriDijaloga, OtvoreniDijalog } from './backend';
import { pokreniLaziTring } from './laziTring';

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

export async function otvoriRustBackend(): Promise<Backend> {
  if (!existsSync(BINARIJ)) {
    throw new Error(`Nema ${BINARIJ} — prvo: cargo build --manifest-path src-tauri/Cargo.toml -p pazar-backend --bin ugovor-server`);
  }
  const userData = mkdtempSync(path.join(tmpdir(), 'kasa-ugovor-rs-'));
  const radniFolder = path.join(userData, 'radni');
  mkdirSync(radniFolder);

  const proc = Bun.spawn([BINARIJ, userData], {
    // bun test radi u UTC-u (ili u TZ iz okruženja); backend mora računati
    // "danas" u istoj zoni kao test.
    env: { ...process.env, TZ: Intl.DateTimeFormat().resolvedOptions().timeZone },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: process.env.KASA_UGOVOR_LOG ? 'inherit' : 'ignore',
  });

  let restart = false;
  const cekaju = new Map<number, (o: Odgovor) => void>();
  let spreman!: (o: Odgovor) => void;
  const pokrenut = new Promise<Odgovor>(r => { spreman = r; });

  (async () => {
    const dekoder = new TextDecoder();
    let buf = '';
    for await (const dio of proc.stdout) {
      buf += dekoder.decode(dio, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const linija = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!linija.trim()) continue;
        const o = JSON.parse(linija) as Odgovor;
        if (o.spreman !== undefined) spreman(o);
        else if (o.dogadjaj === 'restart') restart = true;
        else if (o.id !== undefined) { cekaju.get(o.id)?.(o); cekaju.delete(o.id); }
      }
    }
  })();

  const start = await pokrenut;
  if (!start.spreman) throw new Error(`ugovor-server nije pokrenut: ${start.greska}`);

  const db = new Database(path.join(userData, 'kasa.db'), { strict: true });
  const tring = pokreniLaziTring();
  db.prepare("UPDATE settings SET value = ? WHERE key = 'tring.port'").run(String(tring.port));

  const dijalog: OdgovoriDijaloga = { sacuvaj: null, otvori: null, potvrda: 0 };
  const otvoreniDijalozi: OtvoreniDijalog[] = [];
  let sljedeci = 0;

  return {
    db,
    tring,
    dijalog,
    otvoreniDijalozi,
    radniFolder,
    restartovan: () => restart,
    async call(kanal, ...args) {
      const id = ++sljedeci;
      const odgovor = new Promise<Odgovor>(r => cekaju.set(id, r));
      // Date.now() prati setSystemTime iz testa — backend računa "danas" po njemu.
      proc.stdin.write(JSON.stringify({ id, kanal, args, dijalog, sada: Date.now() }) + '\n');
      proc.stdin.flush();
      const o = await odgovor;
      otvoreniDijalozi.push(...(o.dijalozi ?? []));
      if (o.greska !== undefined) throw new Error(o.greska);
      return o.ok ?? null;
    },
    async close() {
      proc.stdin.end();
      await proc.exited;
      tring.stop();
      db.close();
      rmSync(userData, { recursive: true, force: true });
    },
  };
}
