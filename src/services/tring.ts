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

function escapeXml(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Validacija polja prije slanja ──────────────────────────────
// Svako polje koje ide uređaju prolazi kroz escape ili validaciju. Nevaljan
// zahtjev se odbija prije HTTP-a — uređaj ga nikad ne vidi, a pozivaoci ga
// dobiju kao običan neuspjeh (isto kao grešku uređaja). Rust backend
// (src-tauri/backend/src/tring.rs) mora odbiti iste ulaze istom porukom.

class NevaljanZahtjev extends Error {}

const MAX_PLU = 999_999;
const MAX_GRUPA = 999_999;
const MAX_BROJ_RACUNA = 999_999_999;
/** Decimalni zapis ("2.5", " 12 ", "1e3"); bez "0x10", "1,5", "Infinity". */
const DECIMALNI_BROJ = /^[ \t\r\n]*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?[ \t\r\n]*$/;

/** Broj ili decimalni string → konačan broj; sve ostalo (NaN, ±∞, null...) je null. */
function konacanBroj(v: unknown): number | null {
  const n = typeof v === 'number' ? v
    : typeof v === 'string' && DECIMALNI_BROJ.test(v) ? Number(v)
    : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeričko polje kako ga uređaj i dosad dobija: JS zapis broja (`${n}`),
 * bez fiksnih decimala — tako za ispravne ulaze XML ostaje bajt po bajt isti.
 */
function broj(v: unknown, polje: string): string {
  const n = konacanBroj(v);
  if (n === null) throw new NevaljanZahtjev(`neispravna vrijednost polja ${polje} (mora biti broj)`);
  return String(n);
}

function cijeliBroj(v: unknown, opis: string, max: number): string {
  const n = konacanBroj(v);
  if (n === null || !Number.isInteger(n) || n < 0 || n > max) {
    throw new NevaljanZahtjev(`${opis} (mora biti cijeli broj od 0 do ${max})`);
  }
  return String(n);
}

/** Uređaj zna samo stope E (17 %) i K (oslobođeno) — isto kao CHECK u bazi. */
function stopa(v: unknown): string {
  if (v !== 'E' && v !== 'K') throw new NevaljanZahtjev('neispravna PDV stopa (dozvoljeno E ili K)');
  return v;
}

function odbijeno(greska: NevaljanZahtjev): TringResponse {
  return {
    success: false,
    vrstaOdgovora: "Greska",
    odgovori: {},
    error: `Zahtjev nije poslan fiskalnom uređaju: ${greska.message}`,
    statusCode: null,
  };
}

/** Sastavi tijelo pa pošalji; nevaljan ulaz vraća neuspjeh bez slanja. */
function posalji(sastavi: () => string, posaljiTijelo: (body: string) => Promise<TringResponse>): Promise<TringResponse> {
  let body: string;
  try {
    body = sastavi();
  } catch (e) {
    if (e instanceof NevaljanZahtjev) return Promise.resolve(odbijeno(e));
    throw e;
  }
  return posaljiTijelo(body);
}

function racunZahtjev(vrstaZahtjeva: number, noviObjekat: string): string {
  return (
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${nextRequestNumber()}</BrojZahtjeva>` +
    `<VrstaZahtjeva>${vrstaZahtjeva}</VrstaZahtjeva>` +
    `<NoviObjekat>${noviObjekat}</NoviObjekat>` +
    `</RacunZahtjev>`
  );
}

function artikalToXml(a: Artikal): string {
  return (
    `<Sifra>${escapeXml(a.sifra)}</Sifra>` +
    `<Naziv>${escapeXml(a.naziv)}</Naziv>` +
    `<JM>${escapeXml(a.jm)}</JM>` +
    `<Cijena>${broj(a.cijena, 'Cijena')}</Cijena>` +
    `<Stopa>${stopa(a.stopa)}</Stopa>` +
    `<Grupa>${cijeliBroj(a.grupa ?? 0, 'neispravna Grupa', MAX_GRUPA)}</Grupa>` +
    `<PLU>${cijeliBroj(a.plu ?? 0, 'neispravan PLU', MAX_PLU)}</PLU>`
  );
}

function stavkeToXml(stavke: RacunStavka[]): string {
  return stavke
    .map(
      (s) =>
        `<RacunStavka>` +
        `<artikal>${artikalToXml(s.artikal)}</artikal>` +
        `<Kolicina>${broj(s.kolicina, 'Kolicina')}</Kolicina>` +
        `<Rabat>${broj(s.rabat, 'Rabat')}</Rabat>` +
        `</RacunStavka>`
    )
    .join("");
}

function placanjaToXml(placanja: VrstaPlacanja[]): string {
  return placanja
    .map(
      (v) =>
        `<VrstaPlacanja>` +
        `<Oznaka>${normalizeOznaka(v.oznaka)}</Oznaka>` +
        `<Iznos>${broj(v.iznos, 'Iznos')}</Iznos>` +
        `</VrstaPlacanja>`
    )
    .join("");
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
    `<BrojOperatora>${escapeXml(operatorId)}</BrojOperatora>` +
    `<Lozinka>${escapeXml(password)}</Lozinka>` +
    `</Operator>`;

  return postXml("/inicijalizacija", body);
}

// POST /ua - VrstaZahtjeva=105
export function upisiArtikal(artikal: Artikal): Promise<TringResponse> {
  return posalji(() => {
    const noviObjekat = artikalToXml(artikal);
    return racunZahtjev(105, noviObjekat);
  }, (body) => postXml("/ua", body));
}

// POST /sfr - VrstaZahtjeva=0
export function stampatiFiskalniRacun(racun: Racun): Promise<TringResponse> {
  return posalji(() => {
    const noviObjekat =
      (racun.kupac ? kupacToXml(racun.kupac) : "") +
      `<StavkeRacuna>${stavkeToXml(racun.stavke)}</StavkeRacuna>` +
      // Omotač je VrstePlacanja (množina) — ime iz stampatifiskalniracun.xsd.
      // Ranije je stajalo VrstaPlacanja, što TFS-ov deserializator tiho ignoriše,
      // pa je uređaj svaki račun knjižio kao gotovinski bez obzira na plaćanje.
      `<VrstePlacanja>${placanjaToXml(racun.vrstePlacanja)}</VrstePlacanja>` +
      `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
      `<BrojRacuna>${cijeliBroj(racun.brojRacuna ?? 0, 'neispravan BrojRacuna', MAX_BROJ_RACUNA)}</BrojRacuna>`;
    return racunZahtjev(0, noviObjekat);
  }, (body) => postXml("/sfr", body));
}

/** `<NoviObjekat>` reklamacije; baca NevaljanZahtjev za polje koje uređaj ne smije dobiti. */
function reklamacijaObjekat(racun: ReklamiraniRacun): string {
  // Reklamacija mora nositi tačno jednu vrstu plaćanja — gotovinski povrat se
  // šalje kao Gotovina/0 (tako radi i Tringov vlastiti POS na FP1, a isporučeni
  // primjer srr.reklamirani.xml je identičan). Prazan <VrstePlacanja/> iz teksta
  // uputstva je zastario i TFS ga odbija greškom 573. Pozitivan iznos NIJE
  // povrat nego doplata kupca, pa se nikad ne šalje.
  const placanja = racun.vrstePlacanja.length > 0
    ? racun.vrstePlacanja
    : [{ oznaka: 'Gotovina', iznos: 0 }];
  return (
    (racun.kupac ? kupacToXml(racun.kupac) : "") +
    `<StavkeRacuna>${stavkeToXml(racun.stavke)}</StavkeRacuna>` +
    `<VrstePlacanja>${placanjaToXml(placanja)}</VrstePlacanja>` +
    `<Napomena>${racun.napomena ? escapeXml(racun.napomena) : ""}</Napomena>` +
    `<BrojRacuna>${cijeliBroj(racun.brojRacuna, 'neispravan BrojRacuna', MAX_BROJ_RACUNA)}</BrojRacuna>`
  );
}

/**
 * Provjera reklamacije bez slanja (isti sastavljač kao stampatiReklamiraniRacun):
 * null = uređaj bi je primio, inače poruka kakvu bi vratio neuspjeh
 * ("Zahtjev nije poslan fiskalnom uređaju: ..."). Storno je zove prije
 * ikakvog unosa novca na uređaj. Rust: `provjeri_reklamaciju` u tring.rs.
 */
export function provjeriReklamaciju(racun: ReklamiraniRacun): string | null {
  try {
    reklamacijaObjekat(racun);
    return null;
  } catch (e) {
    if (e instanceof NevaljanZahtjev) return odbijeno(e).error ?? e.message;
    throw e;
  }
}

// POST /srr - VrstaZahtjeva=2
export function stampatiReklamiraniRacun(
  racun: ReklamiraniRacun
): Promise<TringResponse> {
  return posalji(() => racunZahtjev(2, reklamacijaObjekat(racun)), (body) => postXml("/srr", body));
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
  const iznosZaokruzen = broj(Math.round((iznos + Number.EPSILON) * 100) / 100, 'Iznos');
  return (
    `${XML_DECL}` +
    `<RacunZahtjev ${XMLNS}>` +
    `<BrojZahtjeva>${brojZahtjeva}</BrojZahtjeva>` +
    `<VrstaZahtjeva>${vrstaZahtjeva}</VrstaZahtjeva>` +
    `<NoviObjekat>` +
    `<Oznaka>${escapeXml(oznaka)}</Oznaka>` +
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
  return posalji(() => {
    broj(iznos, 'Iznos'); // prije brojača zahtjeva
    return buildUnosNovcaXml(nextRequestNumber(), iznos, oznaka);
  }, (body) => postXmlFallback(UNOS_NOVCA_PATHS, body));
}

// Službeni iznos gotovine iz kase (npr. pražnjenje ladice na kraju dana).
export function povratNovca(iznos: number, oznaka: OznakaPlacanja = "Gotovina"): Promise<TringResponse> {
  return posalji(() => {
    broj(iznos, 'Iznos');
    return buildPovratNovcaXml(nextRequestNumber(), iznos, oznaka);
  }, (body) => postXmlFallback(POVRAT_NOVCA_PATHS, body));
}

/** "GGGG-MM-DD" → "d.M.gggg vrijeme", format koji Tring očekuje. */
function datumIzvjestaja(datum: unknown, vrijeme: string): string {
  const m = typeof datum === 'string' ? /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/.exec(datum) : null;
  if (!m) throw new NevaljanZahtjev('neispravan datum (očekuje se GGGG-MM-DD)');
  return `${parseInt(m[3], 10)}.${parseInt(m[2], 10)}.${m[1]} ${vrijeme}`;
}

// POST /spi - VrstaZahtjeva=5
export function stampatiPeriodicniIzvjestaj(
  odDatuma: string,
  doDatuma: string
): Promise<TringResponse> {
  return posalji(() => {
    const od = datumIzvjestaja(odDatuma, '00:00:00');
    const do_ = datumIzvjestaja(doDatuma, '23:59:59');
    return (
      `${XML_DECL}` +
      `<Zahtjev ${XMLNS}>` +
      `<BrojZahtjeva>${nextRequestNumber()}</BrojZahtjeva>` +
      `<VrstaZahtjeva>5</VrstaZahtjeva>` +
      `<Parametri>` +
      `<Parametar><Naziv>odDatuma</Naziv><Vrijednost>${od}</Vrijednost></Parametar>` +
      `<Parametar><Naziv>doDatuma</Naziv><Vrijednost>${do_}</Vrijednost></Parametar>` +
      `</Parametri>` +
      `</Zahtjev>`
    );
  }, (body) => postXml("/spi", body));
}
