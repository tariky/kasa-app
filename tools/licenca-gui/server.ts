#!/usr/bin/env bun
// Mali lokalni GUI za izdavanje licenci: `bun tools/licenca-gui/server.ts`.
// Sluša samo na 127.0.0.1 — privatni ključ nikad ne napušta ovaj računar.
// Svaki zahtjev prolazi `provjeriZahtjev` (Host, Origin, JSON, token iz linka).
import { join } from 'node:path';
import { procitajLicencu, provjeriLicencu } from '../../src/lib/licenca';
import { LICENCIRANI_MODULI, NAZIV_MODULA, opisModula, type Modul } from '../../src/lib/moduli';
import {
  BACKUP_KLJUC, BUCKETI_FAJL, PODRAZUMIJEVANI_MODULI, PRIVATNI, R2_FAJL, doNakonDana, izdaj, izdaneLicence, javniBackupKljuc,
  javniIzPrivatnog, napraviBackupKljuc, spremiAccountId, ucitajAccountId, ucitajBuckete, uredjajZaIzdavanje, type BackupUnos,
} from '../licenca-zajednicko';
import { noviToken, provjeriZahtjev } from './straza';

function greska(poruka: string, status = 400) {
  return Response.json({ greska: poruka }, { status });
}

/** R2 stanje za formu — secret-i se ne vraćaju u preglednik. */
async function backupStanje() {
  return {
    accountId: ucitajAccountId(),
    r2Fajl: R2_FAJL,
    bucketi: Object.entries(ucitajBuckete()).map(([bucket, b]) => ({ bucket, klijent: b.klijent, accessKeyId: b.accessKeyId })),
    bucketiFajl: BUCKETI_FAJL,
    kljuc: await javniBackupKljuc(),
    kljucFajl: BACKUP_KLJUC,
  };
}

const saOpisom = <T extends { moduli?: Modul[] }>(l: T) => ({ ...l, opisModula: opisModula(l.moduli) });

/** JSON tijelo kao objekat; smeće je greška 400, ne 500. */
async function tijelo<T>(req: Request): Promise<Partial<T>> {
  const b: unknown = await req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Neispravan zahtjev');
  return b as Partial<T>;
}

const STRANICA = join(import.meta.dir, 'index.html');
/** Stranica se ne smije ugraditi u tuđi okvir niti keširati. */
const ZAGLAVLJA_STRANICE = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

type Ruta = (req: Request) => Promise<Response> | Response;

const API: Record<string, Partial<Record<'GET' | 'POST', Ruta>>> = {
  '/api/stanje': {
    GET: async () => {
      try {
        javniIzPrivatnog();
        return Response.json({
          backup: await backupStanje(),
          kljuc: PRIVATNI,
          izdane: izdaneLicence().reverse().map(saOpisom),
          moduli: LICENCIRANI_MODULI.map((id) => ({ id, naziv: NAZIV_MODULA[id] })),
          podrazumijevani: PODRAZUMIJEVANI_MODULI,
        });
      } catch (e) {
        return greska((e as Error).message, 500);
      }
    },
  },
  '/api/izdaj': {
    POST: async (req) => {
      const b = await tijelo<{ klijent: string; dana: number; vrijediDo: string; uredjaj: string; biloKojiUredjaj: boolean; moduli: string[]; backup: BackupUnos }>(req);
      if (typeof b.klijent !== 'string' || !b.klijent.trim()) return greska('Upiši ime klijenta');
      if (!Array.isArray(b.moduli)) return greska('Odaberi module');
      let vrijediDo = b.vrijediDo;
      if (b.dana !== undefined) {
        if (!Number.isInteger(b.dana) || b.dana < 1) return greska('Broj dana mora biti pozitivan cijeli broj');
        vrijediDo = doNakonDana(b.dana);
      }
      if (typeof vrijediDo !== 'string' || !vrijediDo) return greska('Zadaj broj dana ili datum');
      try {
        const uredjaj = uredjajZaIzdavanje(b.uredjaj, b.biloKojiUredjaj);
        return Response.json(saOpisom(await izdaj({ klijent: b.klijent, vrijediDo, uredjaj, moduli: b.moduli as Modul[], backup: b.backup?.bucket ? b.backup : undefined })));
      } catch (e) {
        return greska((e as Error).message);
      }
    },
  },
  '/api/r2': {
    POST: async (req) => {
      const b = await tijelo<{ accountId: string }>(req);
      try {
        spremiAccountId(typeof b.accountId === 'string' ? b.accountId : '');
        return Response.json(await backupStanje());
      } catch (e) {
        return greska((e as Error).message);
      }
    },
  },
  '/api/backup-kljuc': {
    POST: async () => {
      try {
        await napraviBackupKljuc();
        return Response.json(await backupStanje());
      } catch (e) {
        return greska((e as Error).message);
      }
    },
  },
  '/api/provjeri': {
    POST: async (req) => {
      const { token } = await tijelo<{ token: string }>(req);
      const licenca = typeof token === 'string' ? procitajLicencu(token) : null;
      if (!licenca) return greska('Token nije u ispravnom formatu');
      const r = provjeriLicencu(token!, javniIzPrivatnog(), { uredjaj: licenca.uredjaj });
      return Response.json({ licenca: saOpisom(licenca), ok: r.ok, razlog: r.ok ? null : r.razlog });
    },
  },
};

async function obradi(req: Request, port: number, token: string): Promise<Response> {
  const odbijen = provjeriZahtjev(req, { port, token });
  if (odbijen) return odbijen;
  const { pathname } = new URL(req.url);
  if (pathname === '/') {
    return req.method === 'GET' ? new Response(Bun.file(STRANICA), { headers: ZAGLAVLJA_STRANICE }) : greska('Metoda nije dozvoljena', 405);
  }
  const ruta = API[pathname];
  if (!ruta) return greska('Nema te stranice', 404);
  const f = ruta[req.method as 'GET' | 'POST'];
  if (!f) return greska('Metoda nije dozvoljena', 405);
  try {
    return await f(req);
  } catch (e) {
    return greska((e as Error).message);
  }
}

const token = noviToken();
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 4747),
  // Bez porta (unix socket) Host provjera sve odbija.
  fetch: (req, srv) => obradi(req, srv.port ?? 0, token),
});

// Token je samo u fragmentu linka: preglednik ga ne šalje serveru ni u Referer.
const link = `${server.url.href}#t=${token}`;
console.log(`Generator licenci: ${link}`);
if (!process.env.BEZ_BROWSERA) Bun.spawn(['open', link]);
