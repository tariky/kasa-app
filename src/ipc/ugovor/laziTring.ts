// Lažni Tring.Fiscal.Server za ugovorne testove: odgovara odmah (bez
// simuliranog kašnjenja printera), pamti svaki zahtjev i dozvoljava da se
// sljedeći odgovor na nekoj putanji namjesti kao greška. Stoji van backenda,
// pa ga isto gađaju i TS handleri i budući Rust backend.

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

export function pokreniLaziTring(): LaziTring {
  const zahtjevi: TringZahtjev[] = [];
  const greske = new Map<string, { opis: string; broj?: number }>();
  const nepoznate = new Set<string>();
  let racun = 100;
  let reklamacija = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const putanja = new URL(req.url).pathname;
      zahtjevi.push({ putanja, tijelo: await req.text() });

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
    stop: () => server.stop(true),
  };
}
