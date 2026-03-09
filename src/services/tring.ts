import * as http from "node:http";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 8085;
const TIMEOUT_MS = 30_000;

let requestCounter = 0;

export interface TringConfig {
  host?: string;
  port?: number;
}

export interface TringResponse {
  success: boolean;
  vrstaOdgovora: string;
  odgovori: Record<string, string>;
  error?: string;
}

export interface Artikal {
  sifra: string;
  naziv: string;
  jm: string;
  cijena: number;
  stopa: "E" | "K";
  grupa?: number;
  plu?: number;
}

export interface RacunStavka {
  artikal: Artikal;
  kolicina: number;
  rabat: number;
}

export interface VrstaPlacanja {
  oznaka: string;
  iznos: number;
}

export interface Kupac {
  idBroj: string;       // 13 digits - JIB
  pdvBroj?: string;     // 12 digits - optional
  naziv: string;        // up to 32 chars
  adresa: string;       // up to 32 chars
  postanskiBroj: string; // 5 digits
  grad: string;         // up to 26 chars
}

export interface Racun {
  stavke: RacunStavka[];
  vrstePlacanja: VrstaPlacanja[];
  kupac?: Kupac;
  napomena?: string;
  brojRacuna?: number;
}

export interface ReklamiraniRacun {
  stavke: RacunStavka[];
  vrstePlacanja: VrstaPlacanja[];
  kupac?: Kupac;
  napomena?: string;
  brojRacuna: number; // original fiscal receipt number
}

let config: TringConfig = {};

export function configure(cfg: TringConfig): void {
  config = { ...cfg };
}

function nextRequestNumber(): number {
  return ++requestCounter;
}

function postXml(path: string, body: string): Promise<TringResponse> {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
          "Content-Length": Buffer.byteLength(body, "utf-8"),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const xml = Buffer.concat(chunks).toString("utf-8");
          resolve(parseResponse(xml));
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        vrstaOdgovora: "Greska",
        odgovori: {},
        error: "Request timed out",
      });
    });

    req.on("error", (err) => {
      resolve({
        success: false,
        vrstaOdgovora: "Greska",
        odgovori: {},
        error: err.message,
      });
    });

    req.write(body);
    req.end();
  });
}

function parseResponse(xml: string): TringResponse {
  const odgovori: Record<string, string> = {};

  // Extract VrstaOdgovora
  const vrstaMatch = xml.match(/<VrstaOdgovora>(.*?)<\/VrstaOdgovora>/);
  const vrstaOdgovora = vrstaMatch ? vrstaMatch[1] : "Greska";

  // Extract all Odgovor name-value pairs (Vrijednost may have xsi:type attributes)
  const odgovorRegex =
    /<Odgovor>\s*<Naziv>(.*?)<\/Naziv>\s*<Vrijednost[^>]*>(.*?)<\/Vrijednost>\s*<\/Odgovor>/g;
  let match: RegExpExecArray | null;
  while ((match = odgovorRegex.exec(xml)) !== null) {
    odgovori[match[1]] = match[2];
  }

  return {
    success: vrstaOdgovora === "OK",
    vrstaOdgovora,
    odgovori,
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function artikalToXml(a: Artikal): string {
  return (
    `<Sifra>${escapeXml(a.sifra)}</Sifra>` +
    `<Naziv>${escapeXml(a.naziv)}</Naziv>` +
    `<JM>${escapeXml(a.jm)}</JM>` +
    `<Cijena>${a.cijena}</Cijena>` +
    `<Stopa>${a.stopa}</Stopa>` +
    `<Grupa>${a.grupa ?? 0}</Grupa>` +
    `<PLU>${a.plu ?? 0}</PLU>`
  );
}

function kupacToXml(k: Kupac): string {
  return (
    `<Kupac>` +
    `<IDbroj>${escapeXml(k.idBroj)}</IDbroj>` +
    `<Naziv>${escapeXml(k.naziv)}</Naziv>` +
    `<Adresa>${escapeXml(k.adresa)}</Adresa>` +
    `<PostanskiBroj>${escapeXml(k.postanskiBroj)}</PostanskiBroj>` +
    `<Grad>${escapeXml(k.grad)}</Grad>` +
    `</Kupac>`
  );
}

// POST /init.xml
export function inicijalizacija(
  operatorId: number,
  password: string
): Promise<TringResponse> {
  const body =
    `<Operator>` +
    `<BrojOperatora>${operatorId}</BrojOperatora>` +
    `<Lozinka>${password}</Lozinka>` +
    `</Operator>`;

  return postXml("/init.xml", body);
}

// POST /ua.xml - VrstaZahtjeva=105
export function upisiArtikal(artikal: Artikal): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>105</VrstaZahtjeva>` +
    `<NoviObjekat>${artikalToXml(artikal)}</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/ua.xml", body);
}

// POST /sfr.xml - VrstaZahtjeva=0
export function stampatiFiskalniRacun(racun: Racun): Promise<TringResponse> {
  const n = nextRequestNumber();

  const stavkeXml = racun.stavke
    .map(
      (s) =>
        `<RacunStavka>` +
        `<artikal>${artikalToXml(s.artikal)}</artikal>` +
        `<Kolicina>${s.kolicina}</Kolicina>` +
        `<Rabat>${s.rabat}</Rabat>` +
        `</RacunStavka>`
    )
    .join("");

  const placanjaXml = racun.vrstePlacanja
    .map(
      (v) =>
        `<VrstaPlacanja>` +
        `<Oznaka>${escapeXml(v.oznaka)}</Oznaka>` +
        `<Iznos>${v.iznos}</Iznos>` +
        `</VrstaPlacanja>`
    )
    .join("");

  const kupacXml = racun.kupac ? kupacToXml(racun.kupac) : "";

  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>0</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    kupacXml +
    `<StavkeRacuna>${stavkeXml}</StavkeRacuna>` +
    `<VrstePlacanja>${placanjaXml}</VrstePlacanja>` +
    `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
    `<BrojRacuna>${racun.brojRacuna ?? 0}</BrojRacuna>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/sfr.xml", body);
}

// POST /srr.xml - VrstaZahtjeva=2
export function stampatiReklamiraniRacun(
  racun: ReklamiraniRacun
): Promise<TringResponse> {
  const n = nextRequestNumber();

  const stavkeXml = racun.stavke
    .map(
      (s) =>
        `<RacunStavka>` +
        `<artikal>${artikalToXml(s.artikal)}</artikal>` +
        `<Kolicina>${s.kolicina}</Kolicina>` +
        `<Rabat>${s.rabat}</Rabat>` +
        `</RacunStavka>`
    )
    .join("");

  const placanjaXml = racun.vrstePlacanja
    .map(
      (v) =>
        `<VrstaPlacanja>` +
        `<Oznaka>${escapeXml(v.oznaka)}</Oznaka>` +
        `<Iznos>${v.iznos}</Iznos>` +
        `</VrstaPlacanja>`
    )
    .join("");

  const kupacXml = racun.kupac ? kupacToXml(racun.kupac) : "";

  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>2</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    kupacXml +
    `<StavkeRacuna>${stavkeXml}</StavkeRacuna>` +
    `<VrstePlacanja>${placanjaXml}</VrstePlacanja>` +
    `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
    `<BrojRacuna>${racun.brojRacuna}</BrojRacuna>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/srr.xml", body);
}

// POST /sps.xml - VrstaZahtjeva=3 (X-report)
export function stampatiPresjekStanja(): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>3</VrstaZahtjeva>` +
    `</RacunZahtjev>`;

  return postXml("/sps.xml", body);
}

// POST /sdi.xml - VrstaZahtjeva=4 (Z-report)
export function stampatiDnevniIzvjestaj(): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>4</VrstaZahtjeva>` +
    `</RacunZahtjev>`;

  return postXml("/sdi.xml", body);
}

// POST /spi.xml - VrstaZahtjeva=5
export function stampatiPeriodicniIzvjestaj(
  odDatuma: string,
  doDatuma: string
): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `<RacunZahtjev>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>5</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    `<OdDatuma>${escapeXml(odDatuma)}</OdDatuma>` +
    `<DoDatuma>${escapeXml(doDatuma)}</DoDatuma>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/spi.xml", body);
}
