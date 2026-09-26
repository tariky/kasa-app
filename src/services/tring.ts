import * as http from "node:http";
import * as net from "node:net";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 8085;
const TIMEOUT_MS = 30_000;
/**
 * Koliko se čeka TCP veza s uređajem. Kraće od TIMEOUT_MS: dok veza nije
 * uspostavljena, zahtjev sigurno nije poslan, pa ugašen uređaj na mreži (SYN
 * bez odgovora) brzo daje običnu grešku umjesto nepoznatog ishoda. Uređaj je
 * na localhostu/LAN-u — 5 s je višestruko više od stvarnog povezivanja.
 * Rust: CONNECT_TIMEOUT u tring.rs.
 */
const CONNECT_TIMEOUT_MS = 5_000;
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
  /** Koliko se čeka uređaj (ms); zadano 30 s — kraće samo u testovima. */
  timeoutMs?: number;
  /** Koliko se čeka TCP veza (ms); zadano 5 s — kraće samo u testovima. */
  connectTimeoutMs?: number;
}

export interface TringResponse {
  success: boolean;
  vrstaOdgovora: string;
  odgovori: Record<string, string>;
  error?: string;
  /** HTTP status odgovora; null kad veza nije ni uspostavljena. */
  statusCode?: number | null;
  /**
   * Zahtjev je stigao do uređaja, ali odgovor izostao ili nije razumljiv
   * (timeout, prekid veze, neparsiran odgovor) — račun je možda odštampan.
   * Nema ga kad je neuspjeh siguran. Vidi `ishodNepoznat()`.
   */
  ishodNepoznat?: boolean;
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

/**
 * Greške veze kod kojih zahtjev sigurno nije stigao do uređaja (veza nije ni
 * uspostavljena) — račun nije odštampan. Svaka druga greška nakon što je
 * zahtjev krenuo (timeout, prekid veze, neparsiran odgovor) znači da je
 * uređaj možda štampao: ishod nije poznat. Rust: `nije_poslano` u tring.rs.
 *
 * Lista važi samo dok zahtjev nije preuzeo vezu: u Electronu (Node) zahtjev
 * ide preko veze koju `postXml` sam uspostavi, i tada je SVAKA greška —
 * uključujući EHOSTUNREACH/ENETUNREACH kad LAN pukne dok se čeka odgovor —
 * nepoznat ishod. Bez preuzete veze (Bun u testovima: `node:http` ne koristi
 * `createConnection` nego otvara svoju vezu) mrežni kodovi su greške
 * povezivanja te druge veze.
 */
const NIJE_POSLANO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'EADDRNOTAVAIL']);

/**
 * Da li greška HTTP zahtjeva (poslije uspostavljene probne veze) znači
 * nepoznat ishod. `vezaPreuzeta` — zahtjev ide baš preko veze koja je već
 * uspostavljena, pa je mogao stići do uređaja. Rust: `nije_poslano`.
 */
export function greskaZahtjevaNepoznata(kod: string | undefined, vezaPreuzeta: boolean): boolean {
  return vezaPreuzeta || !NIJE_POSLANO.has(kod ?? "");
}

/** Odgovor uređaja ima `<VrstaOdgovora>` (OK/Greska) ili `<Greska>` (greska.xsd). */
function odgovorUredjaja(xml: string): boolean {
  return /<VrstaOdgovora>/.test(xml) || /<Greska>/.test(xml);
}

/**
 * Uređaj nije potvrdio ni uspjeh ni grešku, a zahtjev je do njega stigao —
 * račun je možda odštampan. Pozivalac tada NE smije brisati write-ahead red
 * (pending_receipts); operater ishod razrješava ručno.
 */
export function ishodNepoznat(r: TringResponse | null | undefined): boolean {
  return !!r && !r.success && r.ishodNepoznat === true;
}

/**
 * XML zahtjeva za ispis u konzolu: lozinka operatera (/inicijalizacija) se ne
 * ispisuje. Lozinka u XML-u prolazi kroz escape, pa u njoj nema `<`.
 */
export function bezLozinke(xml: string): string {
  return xml.replace(/<Lozinka>[^<]*<\/Lozinka>/g, '<Lozinka>***</Lozinka>');
}

function postXml(urlPath: string, body: string): Promise<TringResponse> {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Timeout i prekid veze mogu stići oba (req.destroy() izazove i 'error') —
    // prvi ishod je konačan, i u dnevniku ostaje jedan zapis.
    let gotovo = false;
    const zavrsi = (result: TringResponse, responseXml: string) => {
      if (gotovo) return;
      gotovo = true;
      const durationMs = Date.now() - startTime;
      addLog({
        method: "POST",
        path: urlPath,
        requestXml: body,
        responseXml,
        statusCode: result.statusCode ?? null,
        parsed: result,
        durationMs,
      });
      // Jedino mjesto ispisa u konzolu (dev.logging) — pozivaoci ne loguju.
      if (loggingEnabled) {
        console.log(`[Tring] POST ${urlPath} (${durationMs} ms) zahtjev: ${bezLozinke(body)} odgovor: ${JSON.stringify(result)}`);
      }
      resolve(result);
    };
    const neuspjeh = (error: string, nepoznat: boolean, statusCode: number | null = null): TringResponse => ({
      success: false,
      vrstaOdgovora: "Greska",
      odgovori: {},
      error,
      statusCode,
      ...(nepoznat ? { ishodNepoznat: true } : {}),
    });

    // 1. Veza. Dok TCP veza nije uspostavljena, zahtjev sigurno nije poslan:
    // svaka greška (odbijena, nepoznat host, Windowsov ETIMEDOUT) i isteklo
    // vrijeme povezivanja su siguran neuspjeh — ugašen uređaj na mreži ne
    // smije otvoriti dijalog nezavršenih računa.
    let spojeno = false;
    const veza = net.connect({ host, port });
    const tajmer = setTimeout(() => {
      veza.destroy();
      zavrsi(neuspjeh(`connect ETIMEDOUT ${host}:${port}`, false), "");
    }, config.connectTimeoutMs ?? CONNECT_TIMEOUT_MS);
    veza.once("error", (err: NodeJS.ErrnoException & { errors?: Error[] }) => {
      if (spojeno) return; // poslije povezivanja greške vodi HTTP zahtjev
      clearTimeout(tajmer);
      // "localhost" → više adresa: greška je AggregateError s praznom porukom.
      const poruka = err.message || err.errors?.[0]?.message || `connect ${err.code ?? "greška"} ${host}:${port}`;
      zavrsi(neuspjeh(poruka, false), "");
    });
    veza.once("connect", () => {
      spojeno = true;
      clearTimeout(tajmer);
      if (!gotovo) posaljiZahtjev();
    });

    // 2. Zahtjev preko uspostavljene veze — od sada je ishod nepoznat osim
    // kad uređaj odgovori.
    const posaljiZahtjev = () => {
      let vezaPreuzeta = false;
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
          // Bez agenta: jedna veza po zahtjevu (Connection: close), i to baš ova.
          createConnection: () => { vezaPreuzeta = true; return veza; },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const xml = Buffer.concat(chunks).toString("utf-8");
            const parsed = parseResponse(xml);
            parsed.statusCode = res.statusCode ?? null;
            if (!odgovorUredjaja(xml)) {
              parsed.error ??= "Neispravan odgovor fiskalnog uređaja";
              parsed.ishodNepoznat = true;
            }
            zavrsi(parsed, xml);
          });
          // Veza prekinuta usred odgovora — bez ovoga obećanje nikad ne završi.
          res.on("error", (err) => {
            zavrsi(neuspjeh(err.message, true, res.statusCode ?? null), Buffer.concat(chunks).toString("utf-8"));
          });
        }
      );

      // Opcija `timeout` bi išla samo u net.createConnection, a veza je već
      // uspostavljena — zato na zahtjevu (tišina na vezi duža od timeouta).
      req.setTimeout(config.timeoutMs ?? TIMEOUT_MS);
      req.on("timeout", () => {
        req.destroy();
        zavrsi(neuspjeh("Request timed out", true), "");
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        zavrsi(neuspjeh(err.message, greskaZahtjevaNepoznata(err.code, vezaPreuzeta)), "");
      });

      // Bun ignoriše createConnection i otvara svoju vezu — probna se zatvara.
      if (!vezaPreuzeta) veza.destroy();

      req.write(body);
      req.end();
    };
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
    if (e instanceof NevaljanZahtjev) {
      const r = odbijeno(e);
      if (loggingEnabled) console.log(`[Tring] ${r.error}`);
      return Promise.resolve(r);
    }
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
