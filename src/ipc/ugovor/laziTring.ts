// Lažni Tring.Fiscal.Server za ugovorne testove: odgovara odmah (osim
// zahtjeva koji test zadrži), pamti svaki zahtjev i dozvoljava da se
// sljedeći odgovor na nekoj putanji namjesti kao greška. Stoji van backenda,
// pa ga isto gađaju i TS handleri i budući Rust backend.
import * as net from 'node:net';

export interface TringZahtjev {
  putanja: string;
  tijelo: string;
}

export interface LaziTring {
  port: number;
  zahtjevi: TringZahtjev[];
  /**
   * Sljedeći zahtjev na `putanja` dobije `Greska` u formatu uređaja
   * (`<Greska><Broj/><Opis/></Greska>`); `broj` je TFS kod greške.
   */
  greskaNa(putanja: string, opis: string, broj?: number): void;
  /** Putanja od sada vraća HTTP 404, kao na uređaju koji ne zna tu komandu. */
  bez(putanja: string): void;
  /**
   * Sljedeći zahtjev na `putanja` čeka odgovor dok test ne pozove `pusti()`
   * (printer koji štampa) — `stigao` se ispuni kad zahtjev stigne.
   */
  zadrzi(putanja: string): { stigao: Promise<void>; pusti: () => void };
  stop(): void;
}

function ok(odgovori: Record<string, string> = {}): string {
  const tijelo = Object.entries(odgovori)
    .map(([naziv, vrijednost]) => `<Odgovor><Naziv>${naziv}</Naziv><Vrijednost>${vrijednost}</Vrijednost></Odgovor>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><RacunOdgovor><VrstaOdgovora>OK</VrstaOdgovora>${tijelo}</RacunOdgovor>`;
}

function greska(opis: string, broj?: number): string {
  const kod = broj === undefined ? '' : `<Broj>${broj}</Broj>`;
  return `<?xml version="1.0" encoding="utf-8"?><RacunOdgovor><VrstaOdgovora>Greska</VrstaOdgovora>` +
    `<Greska>${kod}<Opis>${opis}</Opis></Greska></RacunOdgovor>`;
}

/**
 * Kako se pokvaren uređaj ponaša nakon što primi zahtjev:
 * `prekid` — zatvori vezu bez odgovora (pad servera, prekid mreže);
 * `smece` — odgovori HTTP 200 s tijelom koje nije odgovor uređaja;
 * `pola` — pošalje zaglavlje i dio tijela pa prekine vezu;
 * `visi` — nikad ne odgovori (timeout).
 * U svim slučajevima zahtjev je stigao, pa ishod štampe nije poznat.
 */
export type Kvar = 'prekid' | 'smece' | 'pola' | 'visi';

export interface PokvareniTring {
  port: number;
  /** Koliko je zahtjeva stiglo (tijelo pročitano bar djelimično). */
  primljeno(): number;
  stop(): void;
}

/** Sirovi TCP server — Bun.serve ne zna prekinuti vezu usred odgovora. */
export async function pokreniPokvareniTring(kvar: Kvar): Promise<PokvareniTring> {
  let primljeno = 0;
  const veze = new Set<net.Socket>();
  const server = net.createServer((s) => {
    veze.add(s);
    s.on('close', () => veze.delete(s));
    s.on('error', () => undefined);
    s.once('data', () => {
      primljeno++;
      if (kvar === 'prekid') s.destroy();
      else if (kvar === 'smece') s.end('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 15\r\n\r\n<html>ok</html>');
      else if (kvar === 'pola') {
        s.write('HTTP/1.1 200 OK\r\nContent-Type: application/xml\r\nContent-Length: 500\r\n\r\n<RacunOdgovor><VrstaOd');
        setTimeout(() => s.destroy(), 20);
      }
    });
  });
  await slusaj(server);
  return {
    port: (server.address() as net.AddressInfo).port,
    primljeno: () => primljeno,
    stop: () => { for (const s of veze) s.destroy(); server.close(); },
  };
}

/** Server počne slušati na slobodnom portu; greška (npr. zauzeta adresa) odbije obećanje. */
function slusaj(server: net.Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** Port na kojem sigurno niko ne sluša (uređaj ugašen → veza odbijena). */
export async function slobodanPort(): Promise<number> {
  const server = net.createServer();
  await slusaj(server);
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(r => server.close(() => r()));
  return port;
}

export function pokreniLaziTring(): LaziTring {
  const zahtjevi: TringZahtjev[] = [];
  const greske = new Map<string, { opis: string; broj?: number }>();
  const nepoznate = new Set<string>();
  const zadrzani = new Map<string, { stigao: () => void; pusten: Promise<void> }>();
  let racun = 100;
  let reklamacija = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const putanja = new URL(req.url).pathname;
      zahtjevi.push({ putanja, tijelo: await req.text() });

      const zadrzan = zadrzani.get(putanja);
      if (zadrzan) {
        zadrzani.delete(putanja);
        zadrzan.stigao();
        await zadrzan.pusten;
      }

      if (nepoznate.has(putanja)) {
        return new Response(greska('Nepoznat endpoint'), { status: 404, headers: { 'Content-Type': 'application/xml' } });
      }

      const g = greske.get(putanja);
      if (g !== undefined) {
        greske.delete(putanja);
        return new Response(greska(g.opis, g.broj), { headers: { 'Content-Type': 'application/xml' } });
      }

      let xml: string;
      if (putanja === '/sfr') xml = ok({ BrojFiskalnogRacuna: String(++racun) });
      else if (putanja === '/srr') xml = ok({ BrojFiskalnogRacuna: `R-${++reklamacija}` });
      else xml = ok();
      return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
    },
  });

  return {
    port: server.port!,
    zahtjevi,
    greskaNa: (putanja, opis, broj) => { greske.set(putanja, { opis, broj }); },
    bez: (putanja) => { nepoznate.add(putanja); },
    zadrzi: (putanja) => {
      let stigao!: () => void;
      let pusti!: () => void;
      const s = new Promise<void>(r => { stigao = r; });
      const pusten = new Promise<void>(r => { pusti = r; });
      zadrzani.set(putanja, { stigao, pusten });
      return { stigao: s, pusti };
    },
    stop: () => server.stop(true),
  };
}
