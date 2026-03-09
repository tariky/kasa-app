// Mock Tring.Fiscal.Server for development testing.
// Run standalone: bun run src/services/tring-mock-server.ts

import * as http from "node:http";

const DEFAULT_PORT = 8085;

let receiptCounter = 0;
let refundCounter = 0;

function now(): { date: string; time: string } {
  const d = new Date();
  const date = [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join(".");
  const time = [
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join(":");
  return { date, time };
}

function okResponse(odgovori: Array<{ naziv: string; vrijednost: string }> = []): string {
  const odgovoriXml = odgovori
    .map(
      (o) =>
        `<Odgovor><Naziv>${o.naziv}</Naziv><Vrijednost>${o.vrijednost}</Vrijednost></Odgovor>`
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<RacunOdgovor>` +
    `<VrstaOdgovora>OK</VrstaOdgovora>` +
    odgovoriXml +
    `</RacunOdgovor>`
  );
}

function errorResponse(message: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<RacunOdgovor>` +
    `<VrstaOdgovora>Greska</VrstaOdgovora>` +
    `<Odgovor><Naziv>Poruka</Naziv><Vrijednost>${message}</Vrijednost></Odgovor>` +
    `</RacunOdgovor>`
  );
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : null;
}

function parseKupac(body: string): { idBroj: string; naziv: string; adresa: string; postanskiBroj: string; grad: string } | null {
  const kupacBlock = extractTag(body, "Kupac");
  if (!kupacBlock || !kupacBlock.includes("<IDbroj>")) return null;
  return {
    idBroj: extractTag(kupacBlock, "IDbroj") ?? "",
    naziv: extractTag(kupacBlock, "Naziv") ?? "",
    adresa: extractTag(kupacBlock, "Adresa") ?? "",
    postanskiBroj: extractTag(kupacBlock, "PostanskiBroj") ?? "",
    grad: extractTag(kupacBlock, "Grad") ?? "",
  };
}

function parseStavke(body: string): Array<{ sifra: string; naziv: string; cijena: string; kolicina: string; rabat: string }> {
  const stavke: Array<{ sifra: string; naziv: string; cijena: string; kolicina: string; rabat: string }> = [];
  const stavkaRegex = /<RacunStavka>([\s\S]*?)<\/RacunStavka>/g;
  let match: RegExpExecArray | null;
  while ((match = stavkaRegex.exec(body)) !== null) {
    const s = match[1];
    stavke.push({
      sifra: extractTag(s, "Sifra") ?? "?",
      naziv: extractTag(s, "Naziv") ?? "?",
      cijena: extractTag(s, "Cijena") ?? "0",
      kolicina: extractTag(s, "Kolicina") ?? "0",
      rabat: extractTag(s, "Rabat") ?? "0",
    });
  }
  return stavke;
}

function parsePlacanja(body: string): Array<{ oznaka: string; iznos: string }> {
  const placanja: Array<{ oznaka: string; iznos: string }> = [];
  const placanjeRegex = /<VrstaPlacanja>([\s\S]*?)<\/VrstaPlacanja>/g;
  let match: RegExpExecArray | null;
  while ((match = placanjeRegex.exec(body)) !== null) {
    const p = match[1];
    placanja.push({
      oznaka: extractTag(p, "Oznaka") ?? "?",
      iznos: extractTag(p, "Iznos") ?? "0",
    });
  }
  return placanja;
}

function logReceipt(type: string, num: string, body: string): void {
  const kupac = parseKupac(body);
  const stavke = parseStavke(body);
  const placanja = parsePlacanja(body);

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${type} #${num}`);
  console.log(`${"═".repeat(50)}`);

  if (kupac) {
    console.log(`  Kupac: ${kupac.naziv}`);
    console.log(`  JIB:   ${kupac.idBroj}`);
    if (kupac.adresa) console.log(`  Adresa: ${kupac.adresa}`);
    if (kupac.postanskiBroj || kupac.grad) console.log(`  ${kupac.postanskiBroj} ${kupac.grad}`.trim());
    console.log(`${"─".repeat(50)}`);
  }

  if (stavke.length > 0) {
    console.log("  Rb  Artikal                    Kol   Cijena   Rabat");
    console.log(`  ${"─".repeat(46)}`);
    stavke.forEach((s, i) => {
      const naziv = s.naziv.substring(0, 28).padEnd(28);
      console.log(`  ${String(i + 1).padStart(2)}  ${naziv} ${s.kolicina.padStart(4)}  ${s.cijena.padStart(8)}  ${s.rabat.padStart(5)}%`);
    });
    console.log(`${"─".repeat(50)}`);
  }

  if (placanja.length > 0) {
    placanja.forEach(p => {
      console.log(`  Plaćanje: ${p.oznaka} ${p.iznos === "0" ? "(cjelokupni iznos)" : p.iznos + " KM"}`);
    });
  }

  console.log(`${"═".repeat(50)}\n`);
}

function handleRequest(
  url: string,
  body: string
): { status: number; xml: string } {
  const path = url.split("?")[0];

  switch (path) {
    case "/init.xml": {
      const operator = extractTag(body, "BrojOperatora") ?? "?";
      console.log(`[mock-tring] Inicijalizacija operatora ${operator}`);
      return { status: 200, xml: okResponse() };
    }

    case "/ua.xml": {
      const sifra = extractTag(body, "Sifra") ?? "?";
      const naziv = extractTag(body, "Naziv") ?? "?";
      const cijena = extractTag(body, "Cijena") ?? "?";
      console.log(`[mock-tring] Upis artikla: ${sifra} - ${naziv} (${cijena} KM)`);
      return { status: 200, xml: okResponse() };
    }

    case "/sfr.xml": {
      receiptCounter++;
      const { date, time } = now();
      logReceipt("FISKALNI RAČUN", String(receiptCounter), body);
      return {
        status: 200,
        xml: okResponse([
          { naziv: "BrojFiskalnogRacuna", vrijednost: String(receiptCounter) },
          { naziv: "DatumFiskalnogRacuna", vrijednost: date },
          { naziv: "VrijemeFiskalnogRacuna", vrijednost: time },
        ]),
      };
    }

    case "/srr.xml": {
      refundCounter++;
      const { date, time } = now();
      const origBroj = extractTag(body, "BrojRacuna") ?? "?";
      logReceipt(`REKLAMIRANI RAČUN (orig: ${origBroj})`, `R-${refundCounter}`, body);
      return {
        status: 200,
        xml: okResponse([
          { naziv: "BrojFiskalnogRacuna", vrijednost: `R-${refundCounter}` },
          { naziv: "DatumFiskalnogRacuna", vrijednost: date },
          { naziv: "VrijemeFiskalnogRacuna", vrijednost: time },
        ]),
      };
    }

    case "/sps.xml": {
      console.log("[mock-tring] sps.xml - Presjek stanja (X-report)");
      console.log("[mock-tring] Body:", body);
      return { status: 200, xml: okResponse() };
    }

    case "/sdi.xml": {
      console.log("[mock-tring] sdi.xml - Dnevni izvjestaj (Z-report)");
      console.log("[mock-tring] Body:", body);
      return { status: 200, xml: okResponse() };
    }

    case "/spi.xml": {
      console.log("[mock-tring] spi.xml - Periodicni izvjestaj");
      console.log("[mock-tring] Body:", body);
      return { status: 200, xml: okResponse() };
    }

    default: {
      console.log(`[mock-tring] Unknown endpoint: ${path}`);
      return { status: 404, xml: errorResponse("Nepoznat endpoint") };
    }
  }
}

export function startMockTringServer(port: number = DEFAULT_PORT): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/xml" });
      res.end(errorResponse("Samo POST metoda je podrzana"));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      const { status, xml } = handleRequest(req.url ?? "/", body);

      res.writeHead(status, {
        "Content-Type": "application/xml",
        "Content-Length": Buffer.byteLength(xml, "utf-8"),
      });
      res.end(xml);
    });
  });

  server.listen(port, () => {
    console.log(
      `[mock-tring] Tring.Fiscal.Server mock running on http://localhost:${port}`
    );
  });

  return server;
}

// Run standalone
const isMain =
  typeof require !== "undefined"
    ? require.main === module
    : process.argv[1]?.endsWith("tring-mock-server.ts") ||
      process.argv[1]?.endsWith("tring-mock-server.js");

if (isMain) {
  const port = parseInt(process.argv[2] ?? String(DEFAULT_PORT), 10);
  startMockTringServer(port);
}
