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
let loggingEnabled = false;

export function setLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

export function isLoggingEnabled(): boolean {
  return loggingEnabled;
}

export function getLogs(): TringLogEntry[] {
  return logEntries;
}

export function clearLogs(): void {
  logEntries.length = 0;
}

function addLog(entry: Omit<TringLogEntry, 'id' | 'timestamp'>): void {
  if (!loggingEnabled) return;
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
  /** HTTP status odgovora; null kad veza nije ni uspostavljena. */
  statusCode?: number | null;
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
          parsed.statusCode = res.statusCode ?? null;
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
        statusCode: null,
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
        statusCode: null,
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

/**
 * Kodovi grešaka koje vraća Tring.Fiscal.Server (Lista_greSaka uz TFS 3.4.522
 * i 3.5.x). Vrijedi samo za one na koje aplikacija zna smisleno reagovati —
 * ostali se prikazuju kako ih uređaj vrati.
 */
const TFS_GRESKE: Record<string, string> = {
  '516': 'Prekoračenje broja stavki računa ili reklamacije',
  '517': 'Prekoračenje u iznosu reklamacije',
  '518': 'Ne postoji artikal za reklamaciju',
  '521': 'Prekoračenje iznosa plaćanja',
  '522': 'Pogrešna vrsta plaćanja ili nedozvoljen režim',
  '523': 'Plaćanje karticom ili čekom veće od iznosa računa',
  '524': 'Ukupna suma plaćanja veća od sume računa',
  '535': 'Nedovoljno novca u kasi',
  '573': 'Reklamacija zahtijeva jednu vrstu plaćanja s iznosom 0',
};

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

  // Uređaj greške vraća kao <Greska><Broj/><Opis/></Greska> (greska.xsd) —
  // bez ovoga korisnik vidi samo golo "Greska".
  const broj = xml.match(/<Broj>(\d+)<\/Broj>/)?.[1];
  const opis = xml.match(/<Opis>([\s\S]*?)<\/Opis>/)?.[1]?.trim();
  const poznata = broj ? TFS_GRESKE[broj] : undefined;
  const error = broj
    ? [poznata ?? opis, opis && poznata && opis !== poznata ? `(${opis})` : '', `[${broj}]`]
        .filter(Boolean).join(' ')
    : undefined;

  return {
    success: vrstaOdgovora === "OK",
    vrstaOdgovora,
    odgovori,
    ...(error ? { error } : {}),
  };
}

/**
 * Uređaj prima samo Gotovina|Cek|Kartica|Virman, case-sensitive i bez kvačice
 * (vrstaplacanja.xsd). Aplikacija u bazi drži "Ček", pa se ovdje prevodi.
 * Nepoznata oznaka pada na Gotovinu — bolje nego da uređaj odbije račun
 * greškom 522, jer je iznos ionako naplaćen.
 */
export function normalizeOznaka(oznaka: string): OznakaPlacanja {
  switch (oznaka.trim().toLowerCase()) {
    case 'gotovina': return 'Gotovina';
    case 'kartica': return 'Kartica';
    case 'virman': return 'Virman';
    case 'ček':
    case 'cek':
    case 'ĉek': return 'Cek';
    default: return 'Gotovina';
  }
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
        `<Oznaka>${normalizeOznaka(v.oznaka)}</Oznaka>` +
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
    // Omotač je VrstePlacanja (množina) — ime iz stampatifiskalniracun.xsd.
    // Ranije je stajalo VrstaPlacanja, što TFS-ov deserializator tiho ignoriše,
    // pa je uređaj svaki račun knjižio kao gotovinski bez obzira na plaćanje.
    `<VrstePlacanja>${placanjaXml}</VrstePlacanja>` +
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

  // Reklamacija mora nositi tačno jednu vrstu plaćanja — gotovinski povrat se
  // šalje kao Gotovina/0 (tako radi i Tringov vlastiti POS na FP1, a isporučeni
  // primjer srr.reklamirani.xml je identičan). Prazan <VrstePlacanja/> iz teksta
  // uputstva je zastario i TFS ga odbija greškom 573. Pozitivan iznos NIJE
  // povrat nego doplata kupca, pa se nikad ne šalje.
  const placanja = racun.vrstePlacanja.length > 0
    ? racun.vrstePlacanja
    : [{ oznaka: 'Gotovina', iznos: 0 }];
  const placanjaXml = placanja
    .map(
      (v) =>
        `<VrstaPlacanja>` +
        `<Oznaka>${normalizeOznaka(v.oznaka)}</Oznaka>` +
        `<Iznos>${v.iznos}</Iznos>` +
        `</VrstaPlacanja>`
    )
    .join("");

  const body =
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
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

// Oblik potvrđen iz isporučenih Tring primjera (unosnovca.xml / povratnovca.xml)
// i XSD šema: korijen je RacunZahtjev, tijelo <NoviObjekat><Oznaka/><Iznos/>.
// UnosNovca je VrstaZahtjeva 7, PovratNovca 8 (tekst uputstva za obje piše 7,
// ali isporučeni povratnovca.xml kaže 8). Dokumentovan HTTP path je puni naziv
// komande; kratki oblik (/un, /pn) je konvencija imena datoteke pa ostaje kao
// rezerva ako server puni naziv ne poznaje.
const UNOS_NOVCA_PATHS = ["/unosnovca", "/un"];
const POVRAT_NOVCA_PATHS = ["/povratnovca", "/pn"];
const UNOS_NOVCA_VRSTA_ZAHTJEVA = 7;
const POVRAT_NOVCA_VRSTA_ZAHTJEVA = 8;

/** Oznake su case-sensitive i iz zatvorene liste (vrstaplacanja.xsd). */
export type OznakaPlacanja = "Gotovina" | "Cek" | "Kartica" | "Virman";

function novacXml(brojZahtjeva: number, vrstaZahtjeva: number, iznos: number, oznaka: OznakaPlacanja): string {
  const iznosZaokruzen = Math.round((iznos + Number.EPSILON) * 100) / 100;
  return (
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>` +
    `<VrstaZahtjeva>${vrstaZahtjeva}</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    `<Oznaka>${oznaka}</Oznaka>` +
    `<Iznos>${iznosZaokruzen}</Iznos>` +
    `</NoviObjekat>` +
    `</RacunZahtjev>`
  );
}

export function buildUnosNovcaXml(brojZahtjeva: number, iznos: number, oznaka: OznakaPlacanja = "Gotovina"): string {
  return novacXml(brojZahtjeva, UNOS_NOVCA_VRSTA_ZAHTJEVA, iznos, oznaka);
}

export function buildPovratNovcaXml(brojZahtjeva: number, iznos: number, oznaka: OznakaPlacanja = "Gotovina"): string {
  return novacXml(brojZahtjeva, POVRAT_NOVCA_VRSTA_ZAHTJEVA, iznos, oznaka);
}

/** Puni naziv komande je dokumentovan, kratki nije — 404 znači "probaj drugi". */
async function postXmlFallback(paths: string[], body: string): Promise<TringResponse> {
  let last: TringResponse | null = null;
  for (const path of paths) {
    const result = await postXml(path, body);
    if (result.success || result.statusCode !== 404) return result;
    last = result;
  }
  return last as TringResponse;
}

// Službeni unos gotovine u kasu (polog). Uvijek Gotovina — polog drugim
// sredstvima ne mijenja ladicu pa ga aplikacija ne nudi.
export function unosNovca(iznos: number, oznaka: OznakaPlacanja = "Gotovina"): Promise<TringResponse> {
  return postXmlFallback(UNOS_NOVCA_PATHS, buildUnosNovcaXml(nextRequestNumber(), iznos, oznaka));
}

// Službeni iznos gotovine iz kase (npr. pražnjenje ladice na kraju dana).
export function povratNovca(iznos: number, oznaka: OznakaPlacanja = "Gotovina"): Promise<TringResponse> {
  return postXmlFallback(POVRAT_NOVCA_PATHS, buildPovratNovcaXml(nextRequestNumber(), iznos, oznaka));
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
