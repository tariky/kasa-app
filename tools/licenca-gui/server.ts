#!/usr/bin/env bun
// Mali lokalni GUI za izdavanje licenci: `bun tools/licenca-gui/server.ts`.
// Sluša samo na 127.0.0.1 — privatni ključ nikad ne napušta ovaj računar.
import index from './index.html';
import { procitajLicencu, provjeriLicencu } from '../../src/lib/licenca';
import { PRIVATNI, doNakonDana, izdaj, izdaneLicence, javniIzPrivatnog } from '../licenca-zajednicko';

function greska(poruka: string, status = 400) {
  return Response.json({ greska: poruka }, { status });
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 4747),
  routes: {
    '/': index,
    '/api/stanje': {
      GET: () => {
        try {
          javniIzPrivatnog();
          return Response.json({ kljuc: PRIVATNI, izdane: izdaneLicence().reverse() });
        } catch (e) {
          return greska((e as Error).message, 500);
        }
      },
    },
    '/api/izdaj': {
      POST: async (req) => {
        const b = (await req.json()) as { klijent?: string; dana?: number; vrijediDo?: string; uredjaj?: string };
        if (!b.klijent?.trim()) return greska('Upiši ime klijenta');
        let vrijediDo = b.vrijediDo;
        if (b.dana !== undefined) {
          if (!Number.isInteger(b.dana) || b.dana < 1) return greska('Broj dana mora biti pozitivan cijeli broj');
          vrijediDo = doNakonDana(b.dana);
        }
        if (!vrijediDo) return greska('Zadaj broj dana ili datum');
        try {
          return Response.json(izdaj({ klijent: b.klijent, vrijediDo, uredjaj: b.uredjaj }));
        } catch (e) {
          return greska((e as Error).message);
        }
      },
    },
    '/api/provjeri': {
      POST: async (req) => {
        const { token } = (await req.json()) as { token?: string };
        const licenca = procitajLicencu(token ?? '');
        if (!licenca) return greska('Token nije u ispravnom formatu');
        const r = provjeriLicencu(token!, javniIzPrivatnog(), { uredjaj: licenca.uredjaj });
        return Response.json({ licenca, ok: r.ok, razlog: r.ok ? null : r.razlog });
      },
    },
  },
});

console.log(`Generator licenci: ${server.url}`);
if (!process.env.BEZ_BROWSERA) Bun.spawn(['open', server.url.href]);
