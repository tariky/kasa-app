// Mock Tring.Fiscal.Server u folder modu, za stari FoxPro ERP (forma disiz).
// TFS u tom modu skenira direktorij (default C:\Tring\XML): datoteka se zove po
// komandi (StampatiFiskalniRacun.xml ili sfr.xml, uz broj zahtjeva kao sufiks),
// a odgovor KasaOdgovor istog imena ide u poddirektorij odgovori/.
// disiz piše npr. stampatifiskalniracun.txt.<brkalk> u cp1250.
// Run standalone: bun run src/services/tring-mock-folder.ts C:\Tring\XML [--zadrzi] [--delay=2500]

import * as fs from "node:fs";
import * as path from "node:path";
import { extractTag, logReceipt } from "./tring-mock-server";

const PRINT_DELAY_MS = 2500; // kao HTTP mock: pravi printer treba par sekundi

const KOMANDE: Record<string, string> = {
  stampatifiskalniracun: "sfr",
  sfr: "sfr",
  stampatireklamiraniracun: "srr",
  srr: "srr",
  unosnovca: "un",
  un: "un",
  povratnovca: "pn",
  pn: "pn",
  stampatipresjekstanja: "sps",
  sps: "sps",
  stampatidnevniizvjestaj: "sdi",
  sdi: "sdi",
  stampatiperiodicniizvjestaj: "spi",
  spi: "spi",
  inicijalizacija: "inicijalizacija",
};

/** Kratka komanda iz imena datoteke (dio prije prve tačke), ili undefined ako nije TFS komanda. */
export function komandaIzImena(ime: string): string | undefined {
  return KOMANDE[ime.split(".")[0].toLowerCase()];
}

// cp1250 → Unicode za gornju polovinu tabele; Bun TextDecoder ne zna windows-1250.
const CP1250_GORNJA =
  "€\u0081‚\u0083„…†‡\u0088‰Š‹ŚŤŽŹ\u0090‘’“”•–—\u0098™š›śťžź" +
  "\u00a0ˇ˘Ł¤Ą¦§¨©Ş«¬\u00ad®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľż" +
  "ŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢß" +
  "ŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙";

export function dekodirajCp1250(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP1250_GORNJA[b - 0x80];
  return s;
}

function kasaOdgovor(brojZahtjeva: string, odgovori: Array<{ naziv: string; tip: string; vrijednost: string }>): string {
  const tijelo = odgovori.length
    ? "<Odgovori>\r\n" +
      odgovori
        .map((o) => `  <Odgovor>\r\n    <Naziv>${o.naziv}</Naziv>\r\n    <Vrijednost xsi:type="xsd:${o.tip}">${o.vrijednost}</Vrijednost>\r\n  </Odgovor>\r\n`)
        .join("") +
      "</Odgovori>"
    : "<Odgovori />";
  return (
    `<?xml version="1.0" encoding="utf-8"?>\r\n` +
    `<KasaOdgovor xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\r\n` +
    `${tijelo}\r\n<VrstaOdgovora>OK</VrstaOdgovora>\r\n<BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>\r\n</KasaOdgovor>`
  );
}

export type MockRacun = {
  komanda: string;
  datoteka: string;
  brojFiskalnog: number;
  stavke: Array<{ sifra: string; naziv: string; kolicina: string; cijena: string }>;
};

export type MockTringFolder = { racuni: MockRacun[]; close: () => void };

export function startMockTringFolder(
  dir: string,
  opts: { delayMs?: number; zadrziZahtjev?: boolean; tiho?: boolean } = {}
): MockTringFolder {
  const delayMs = opts.delayMs ?? PRINT_DELAY_MS;
  const log = opts.tiho ? () => {} : console.log;
  const odgovoriDir = path.join(dir, "odgovori");
  fs.mkdirSync(odgovoriDir, { recursive: true });

  const racuni: MockRacun[] = [];
  const vidjene = new Set<string>();
  let brojac = 0;
  let zatvoren = false;

  function obradi(ime: string) {
    const komanda = komandaIzImena(ime);
    const puna = path.join(dir, ime);
    if (!komanda || vidjene.has(ime) || !fs.statSync(puna, { throwIfNoEntry: false })?.isFile()) return;
    vidjene.add(ime);

    // Čeka "štampanje", a i da FoxPro završi COPY MEMO prije čitanja.
    setTimeout(() => {
      if (zatvoren) return;
      const body = dekodirajCp1250(fs.readFileSync(puna));
      const brojZahtjeva = extractTag(body, "BrojZahtjeva") ?? "0";
      let odgovori: Array<{ naziv: string; tip: string; vrijednost: string }> = [];

      if (komanda === "sfr" || komanda === "srr") {
        brojac++;
        logReceipt(komanda === "sfr" ? "FISKALNI RAČUN (folder)" : "REKLAMIRANI RAČUN (folder)", String(brojac), body);
        const d = new Date();
        // ERP nema jedinstven parser za sve stare forme: gotovinska forma
        // (disiz/prracung) traži xsd:long, dok veleprodajna faktura
        // (pr_fakture/prracunf) traži xsd:int. Veleprodajni fiskalni zahtjev
        // šalje jednu zbirnu stavku "Promet po fakturi", pa ga možemo
        // pouzdano razlikovati bez promjene FoxPro binarnih formi.
        const brojTip = /<Naziv>\s*Promet po fakturi\s*<\/Naziv>/i.test(body) ? "int" : "long";
        odgovori = [
          { naziv: "BrojFiskalnogRacuna", tip: brojTip, vrijednost: String(brojac) },
          { naziv: "DatumFiskalnogRacuna", tip: "string", vrijednost: `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}` },
          { naziv: "VrijemeFiskalnogRacuna", tip: "string", vrijednost: `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` },
        ];
        const stavke = [...body.matchAll(/<RacunStavka>([\s\S]*?)<\/RacunStavka>/g)].map((m) => ({
          sifra: extractTag(m[1], "Sifra") ?? "",
          naziv: extractTag(m[1], "Naziv") ?? "",
          kolicina: extractTag(m[1], "Kolicina") ?? "",
          cijena: extractTag(m[1], "Cijena") ?? "",
        }));
        racuni.push({ komanda, datoteka: ime, brojFiskalnog: brojac, stavke });
      } else {
        log(`[mock-tring-folder] ${komanda}: ${ime}`);
      }

      fs.writeFileSync(path.join(odgovoriDir, ime), kasaOdgovor(brojZahtjeva, odgovori), "utf-8");
      if (!opts.zadrziZahtjev) fs.rmSync(puna, { force: true });
      log(`[mock-tring-folder] odgovor → ${path.join("odgovori", ime)}`);
    }, delayMs);
  }

  const skeniraj = () => {
    for (const ime of fs.readdirSync(dir)) obradi(ime);
  };
  skeniraj();
  const watcher = fs.watch(dir, (_e, ime) => {
    if (ime) obradi(ime.toString());
  });
  // fs.watch zna propustiti događaj (macOS tmp, mrežni folder), pa i periodični sken.
  const sken = setInterval(skeniraj, 250);
  log(`[mock-tring-folder] prati ${dir} (odgovori u ${odgovoriDir})`);

  return {
    racuni,
    close: () => {
      zatvoren = true;
      watcher.close();
      clearInterval(sken);
    },
  };
}

if (process.argv[1]?.endsWith("tring-mock-folder.ts") || process.argv[1]?.endsWith("tring-mock-folder.js")) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) ?? "C:\\Tring\\XML";
  const delay = args.find((a) => a.startsWith("--delay="));
  fs.mkdirSync(dir, { recursive: true });
  startMockTringFolder(dir, {
    zadrziZahtjev: args.includes("--zadrzi"),
    delayMs: delay ? parseInt(delay.split("=")[1], 10) : undefined,
  });
}
