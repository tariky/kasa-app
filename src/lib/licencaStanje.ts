// Stanje licence u aplikaciji: iz tokena i današnjeg datuma izračuna da li
// program radi normalno, upozorava, radi u periodu milosti ili je zaključan
// (samo pregled). Čista funkcija — main proces joj daje datum i ID uređaja.
import type { KeyObject } from 'node:crypto';
import { provjeriLicencu } from './licenca';
import { UPOZORENJE_DANA, PERIOD_MILOSTI_DANA, type StanjeLicence } from './licencaTipovi';

export * from './licencaTipovi';

function danBroj(datum: string): number {
  const [g, m, d] = datum.split('-').map(Number);
  return Date.UTC(g, m - 1, d) / 86_400_000;
}

/** Razlika u danima `do - od` za datume `YYYY-MM-DD`. */
export function razlikaDana(od: string, doDatuma: string): number {
  return danBroj(doDatuma) - danBroj(od);
}

/**
 * Datum s kojim se računa licenca: veći od stvarnog i zadnjeg viđenog, da
 * vraćanje sata unazad ne produži licencu.
 */
export function efektivniDanas(stvarni: string, zadnjiVidjeni?: string | null): string {
  return zadnjiVidjeni && zadnjiVidjeni > stvarni ? zadnjiVidjeni : stvarni;
}

export function izracunajStanje(
  token: string | null | undefined,
  javniKljuc: string | KeyObject,
  opcije: { danas: string; uredjaj: string },
): StanjeLicence {
  if (!token?.trim()) return { stanje: 'nema' };

  const [g, m, d] = opcije.danas.split('-').map(Number);
  const r = provjeriLicencu(token, javniKljuc, { sada: new Date(g, m - 1, d, 12), uredjaj: opcije.uredjaj });
  if (!r.ok && r.razlog !== 'istekla') return { stanje: 'neispravna', razlog: r.razlog };

  const licenca = r.ok ? r.licenca : r.licenca!;
  const danaDoIsteka = razlikaDana(opcije.danas, licenca.vrijediDo);
  if (danaDoIsteka >= 0) {
    return danaDoIsteka <= UPOZORENJE_DANA
      ? { stanje: 'upozorenje', licenca, danaDoIsteka }
      : { stanje: 'aktivna', licenca, danaDoIsteka };
  }
  const danaDoBlokade = PERIOD_MILOSTI_DANA + danaDoIsteka;
  return danaDoBlokade >= 0 ? { stanje: 'milost', licenca, danaDoBlokade } : { stanje: 'zakljucana', licenca };
}

/** Da li program smije praviti nove dokumente (račune, primke, naloge…). */
export function smijeRaditi(s: StanjeLicence): boolean {
  return s.stanje === 'aktivna' || s.stanje === 'upozorenje' || s.stanje === 'milost';
}
