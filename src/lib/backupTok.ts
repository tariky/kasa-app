// Motor automatskog backup-a, bez Electrona: kopija baze → age → R2, stanje,
// događaji i raspored. Sve spoljašnje (disk, baza, mreža, prozori, sat) dolazi
// kroz `BackupOkruzenje` — Electron sloj je src/ipc/backup.ts. Ništa odavde ne
// smije baciti izuzetak u kasu: greška backup-a ide u stanje i događaj.
import { sifrujBackup } from './backupFajl';
import { sljedeciBackup, trajnaGreska, type BackupDogadjaj, type BackupInfo, type BackupStanje } from './backupRaspored';
import type { R2Podaci } from './licenca';
import { imeBackupa, R2Greska, type R2Pristup } from './r2';

export const NEMA_BACKUPA = 'Automatski backup nije uključen u licencu.';

export interface BackupOkruzenje {
  /** R2 podaci iz licence; null = licenca ne važi ili nema backup. */
  pristup(): R2Podaci | null;
  citajStanje(): BackupStanje;
  pisiStanje(s: BackupStanje): void;
  /** Dosljedna kopija baze; sam čisti svoj temp fajl. */
  kopijaBaze(): Uint8Array | Promise<Uint8Array>;
  posalji(r2: R2Pristup, kljuc: string, tijelo: Uint8Array, napredak: (poslano: number, ukupno: number) => void): Promise<void>;
  javi(d: BackupDogadjaj): void;
  uredjaj(): string;
  sada(): Date;
  /** `PAZAR_BACKUP_ENDPOINT` (testovi); inače R2 po accountId. */
  endpoint?: string;
}

/** Poruka za korisnika. Bez kredencijala — R2 poruke ih ne sadrže. */
export function porukaGreske(e: unknown): string {
  if (e instanceof R2Greska && e.status === 403) {
    // x-amz-date odstupa > 15 min: sat računara, ne licenca.
    if (e.kod === 'RequestTimeTooSkewed') return 'Sat na ovom računaru nije tačan — podesite datum i vrijeme, pa će backup proći.';
    return 'R2 pristup više ne važi — zatražite novu licencu';
  }
  return e instanceof Error ? e.message : String(e);
}

export function napraviBackup(o: BackupOkruzenje) {
  const start = o.sada();
  let tekuci: Promise<BackupInfo> | null = null;

  const pristup = () => { try { return o.pristup(); } catch { return null; } };
  // Zadnje poznato stanje u memoriji: i kad se fajl ne može upisati, raspored
  // ne smije slati svake minute (svaki objekt je 14 dana zaključan i plaća se).
  let memorija: BackupStanje | null = null;
  const stanje = (): BackupStanje => {
    if (!memorija) { try { memorija = o.citajStanje() ?? {}; } catch { memorija = {}; } }
    return memorija;
  };
  const pisi = (s: BackupStanje) => {
    memorija = s;
    try { o.pisiStanje(s); } catch (e) { console.error('Backup: stanje nije upisano:', porukaGreske(e)); }
  };
  const javi = (d: BackupDogadjaj) => { try { o.javi(d); } catch { /* prozor zatvoren */ } };

  function info(): BackupInfo {
    const r2 = pristup();
    if (!r2) return { aktivan: false, uToku: !!tekuci };
    const s = stanje();
    return {
      aktivan: true,
      bucket: r2.bucket,
      uToku: !!tekuci,
      ...(s.zadnjiUspjeh ? { zadnjiUspjeh: s.zadnjiUspjeh } : {}),
      ...(s.greska ? { greska: s.greska, ...(s.greskaOd ? { greskaOd: s.greskaOd } : {}) } : {}),
      sljedeci: sljedeciBackup(s, o.sada(), start).toISOString(),
    };
  }

  async function izvrsi(r2: R2Podaci): Promise<void> {
    const pocetak = o.sada();
    pisi({ ...stanje(), zadnjiPokusaj: pocetak.toISOString() });
    try {
      javi({ faza: 'kopija', procenat: 0 });
      const baza = await o.kopijaBaze();
      javi({ faza: 'sifrovanje', procenat: 0 });
      const fajl = await sifrujBackup(baza, r2.primalac);
      javi({ faza: 'slanje', procenat: 0 });
      let zadnji = 0;
      const { primalac: _, ...pristupR2 } = r2;
      await o.posalji({ ...pristupR2, ...(o.endpoint ? { endpoint: o.endpoint } : {}) }, imeBackupa(o.uredjaj(), pocetak), fajl, (p, u) => {
        const procenat = u ? Math.floor((p / u) * 100) : 100;
        if (procenat > zadnji) { zadnji = procenat; javi({ faza: 'slanje', procenat }); }
      });
      const kraj = o.sada().toISOString();
      pisi({ zadnjiUspjeh: kraj, zadnjiPokusaj: pocetak.toISOString() });
      javi({ gotovo: kraj });
    } catch (e) {
      const poruka = porukaGreske(e);
      const s = stanje();
      const novo: BackupStanje = { ...s, zadnjiPokusaj: pocetak.toISOString(), greska: poruka, greskaOd: s.greskaOd ?? pocetak.toISOString() };
      pisi(novo);
      console.error('Backup nije uspio:', poruka);
      javi({ greska: poruka, trajnaGreska: trajnaGreska(novo, o.sada()) });
    }
  }

  /** Pokreće backup ili vraća tekući. Čeka kraj; greška backup-a je u `info.greska`. */
  function sada(): Promise<BackupInfo> {
    if (tekuci) return tekuci;
    const r2 = pristup();
    if (!r2) return Promise.reject(new Error(NEMA_BACKUPA));
    tekuci = izvrsi(r2).finally(() => { tekuci = null; }).then(() => info());
    return tekuci;
  }

  /** Zove se svake minute: pokrene backup kad je vrijeme. */
  async function tick(): Promise<void> {
    if (tekuci || !pristup()) return;
    const t = o.sada();
    if (t.getTime() >= sljedeciBackup(stanje(), t, start).getTime()) await sada().catch(() => undefined);
  }

  return { info, sada, tick };
}
