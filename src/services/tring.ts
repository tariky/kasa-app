import * as http from "node:http";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 8085;
const TIMEOUT_MS = 30_000;
const MAX_LOG_ENTRIES = 200;

let requestCounter = 0;

export interface TringLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  requestXml: string;
  responseXml: string;
  statusCode: number | null;
  parsed: TringResponse | null;
  durationMs: number;
}

let logIdCounter = 0;
const logEntries: TringLogEntry[] = [];

export function getLogs(): TringLogEntry[] {
  return logEntries;
}

export function clearLogs(): void {
  logEntries.length = 0;
}

function addLog(entry: Omit<TringLogEntry, 'id' | 'timestamp'>): void {
  logEntries.push({
    id: ++logIdCounter,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }
}

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

const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>';
const XMLNS = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';

let config: TringConfig = {};

export function configure(cfg: TringConfig): void {
  config = { ...cfg };
}

function nextRequestNumber(): number {
  return ++requestCounter;
}

function postXml(urlPath: string, body: string): Promise<TringResponse> {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: host,
        port,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "Content-Length": Buffer.byteLength(body, "utf-8"),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const xml = Buffer.concat(chunks).toString("utf-8");
          const parsed = parseResponse(xml);
          addLog({
            method: "POST",
            path: urlPath,
            requestXml: body,
            responseXml: xml,
            statusCode: res.statusCode ?? null,
            parsed,
            durationMs: Date.now() - startTime,
          });
          resolve(parsed);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      const result: TringResponse = {
        success: false,
        vrstaOdgovora: "Greska",
        odgovori: {},
        error: "Request timed out",
      };
      addLog({
        method: "POST",
        path: urlPath,
        requestXml: body,
        responseXml: "",
        statusCode: null,
        parsed: result,
        durationMs: Date.now() - startTime,
      });
      resolve(result);
    });

    req.on("error", (err) => {
      const result: TringResponse = {
        success: false,
        vrstaOdgovora: "Greska",
        odgovori: {},
        error: err.message,
      };
      addLog({
        method: "POST",
        path: urlPath,
        requestXml: body,
        responseXml: "",
        statusCode: null,
        parsed: result,
        durationMs: Date.now() - startTime,
      });
      resolve(result);
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

  // Extract all Odgovor name-value pairs
  // Vrijednost may have xsi:type attributes and can be self-closing (empty value)
  const odgovorRegex =
    /<Odgovor>\s*<Naziv>(.*?)<\/Naziv>\s*(?:<Vrijednost[^>]*\/>\s*|<Vrijednost[^>]*>(.*?)<\/Vrijednost>\s*)<\/Odgovor>/g;
  let match: RegExpExecArray | null;
  while ((match = odgovorRegex.exec(xml)) !== null) {
    odgovori[match[1]] = match[2] ?? '';
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

// POST /inicijalizacija
export function inicijalizacija(
  operatorId: number,
  password: string
): Promise<TringResponse> {
  const body =
    `${XML_DECL}` +
    `<Operator ${XMLNS}>` +
    `<BrojOperatora>${operatorId}</BrojOperatora>` +
    `<Lozinka>${password}</Lozinka>` +
    `</Operator>`;

  return postXml("/inicijalizacija", body);
}

// POST /ua - VrstaZahtjeva=105
export function upisiArtikal(artikal: Artikal): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>105</VrstaZahtjeva>` +
    `<NoviObjekat>${artikalToXml(artikal)}</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/ua", body);
}

// POST /sfr - VrstaZahtjeva=0
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
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>0</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    kupacXml +
    `<StavkeRacuna>${stavkeXml}</StavkeRacuna>` +
    `<VrstaPlacanja>${placanjaXml}</VrstaPlacanja>` +
    `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
    `<BrojRacuna>${racun.brojRacuna ?? 0}</BrojRacuna>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/sfr", body);
}

// POST /srr - VrstaZahtjeva=2
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

  const kupacXml = racun.kupac ? kupacToXml(racun.kupac) : "";

  const body =
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>2</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    kupacXml +
    `<StavkeRacuna>${stavkeXml}</StavkeRacuna>` +
    `<VrstePlacanja />` +
    `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
    `<BrojRacuna>${racun.brojRacuna}</BrojRacuna>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`;

  return postXml("/srr", body);
}

// POST /sps - VrstaZahtjeva=3 (X-report)
export function stampatiPresjekStanja(): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `${XML_DECL}` +
    `<Zahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>3</VrstaZahtjeva>` +
    `<Parametri />` +
    `</Zahtjev>`;

  return postXml("/sps", body);
}

// POST /sdi - VrstaZahtjeva=4 (Z-report)
export function stampatiDnevniIzvjestaj(): Promise<TringResponse> {
  const n = nextRequestNumber();
  const body =
    `${XML_DECL}` +
    `<Zahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>4</VrstaZahtjeva>` +
    `<Parametri />` +
    `</Zahtjev>`;

  return postXml("/sdi", body);
}

// POST /spi - VrstaZahtjeva=5
export function stampatiPeriodicniIzvjestaj(
  odDatuma: string,
  doDatuma: string
): Promise<TringResponse> {
  const n = nextRequestNumber();

  // Convert YYYY-MM-DD to d.M.yyyy HH:mm:ss format expected by Tring
  const fromParts = odDatuma.split('-');
  const toParts = doDatuma.split('-');
  const fromFormatted = `${parseInt(fromParts[2])}.${parseInt(fromParts[1])}.${fromParts[0]} 00:00:00`;
  const toFormatted = `${parseInt(toParts[2])}.${parseInt(toParts[1])}.${toParts[0]} 23:59:59`;

  const body =
    `${XML_DECL}` +
    `<Zahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${n}</BrojZahtjeva>` +
    `<VrstaZahtjeva>5</VrstaZahtjeva>` +
    `<Parametri>` +
    `<Parametar><Naziv>odDatuma</Naziv><Vrijednost>${fromFormatted}</Vrijednost></Parametar>` +
    `<Parametar><Naziv>doDatuma</Naziv><Vrijednost>${toFormatted}</Vrijednost></Parametar>` +
    `</Parametri>` +
    `</Zahtjev>`;

  return postXml("/spi", body);
}
