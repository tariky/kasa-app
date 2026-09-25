// Straža generatora licenci: server sluša na 127.0.0.1, ali to ne brani od
// stranice na internetu koju je otvorio isti preglednik (DNS rebinding,
// POST forma na localhost). Zato svaki zahtjev mora imati naš Host, POST
// naš Origin i JSON, a /api/* nasumični token koji se dobije samo iz linka
// koji server ispiše/otvori (`#t=…` — fragment ne ide ni serveru ni u Referer).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_HEADER = 'x-pazar-token';

export function noviToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Konstantno-vremensko poređenje; hash izjednači dužine da ni dužina ne curi. */
export function istiToken(dobijen: string | null, ocekivan: string): boolean {
  if (dobijen === null) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(dobijen), h(ocekivan)) && dobijen.length === ocekivan.length;
}

function odbij(poruka: string, status: number): Response {
  return Response.json({ greska: poruka }, { status });
}

/**
 * null = zahtjev smije dalje; inače odgovor s greškom. Svi zahtjevi: naš Host.
 * Sve osim GET/HEAD: naš Origin i `application/json`. Sve osim `/`: token.
 * `port` je port na kojem server stvarno sluša.
 */
export function provjeriZahtjev(req: Request, opcije: { port: number; token: string }): Response | null {
  const host = req.headers.get('host');
  if (host !== `127.0.0.1:${opcije.port}` && host !== `localhost:${opcije.port}`) {
    return odbij('Nepoznat Host', 403);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Vlastiti origin je ono na šta pokazuje (već provjeren) Host.
    if (req.headers.get('origin') !== `http://${host}`) return odbij('Nepoznat Origin', 403);
    const tip = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (tip !== 'application/json') return odbij('Očekujem application/json', 415);
  }
  // Bez tokena samo sama stranica (ona token čita iz fragmenta); sve ostalo, a to je /api/*, traži token.
  if (new URL(req.url).pathname !== '/' && !istiToken(req.headers.get(TOKEN_HEADER), opcije.token)) {
    return odbij('Nedostaje ili je pogrešan token — otvori link koji je ispisao server', 401);
  }
  return null;
}
