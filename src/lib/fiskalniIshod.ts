import { porukaGreske } from './utils';

/**
 * Ishod poziva koji štampa fiskalni dokument (order:finalize,
 * order:finalizePrilog, ponuda:konvertuj, nalog:izdajRacun,
 * order:refundAndPrint) kako ga čita renderer — jedno mjesto umjesto kopije
 * po ekranu. Pravilo: dokument se ponovo šalje uređaju samo poslije
 * `greska`; `nepoznat` ide u dijalog nezavršenih računa, a `vecEvidentiran`
 * je završen posao.
 */
export type VrstaIshoda = 'uspjeh' | 'vecEvidentiran' | 'nepoznat' | 'greska';

export interface Ishod {
  vrsta: VrstaIshoda;
  /** Tekst za operatera; prazan kod uspjeha (ekran slaže svoju poruku). */
  poruka: string;
}

/** Zajednički dio odgovora fiskalnih kanala (lib/pendingRacun.ts, services/tring.ts). */
export interface FiskalniOdgovor {
  success?: boolean;
  error?: string;
  vrstaOdgovora?: string;
  odgovori?: Record<string, string>;
  /** Uređaj nije potvrdio dokument — write-ahead red ostaje za dijalog nezavršenih. */
  ishodNepoznat?: boolean;
  /** Odštampan i već upisan iz dijaloga nezavršenih — drugi zapis nije napravljen. */
  vecEvidentiran?: boolean;
}

/**
 * Oznaka bačene greške upisa POSLIJE uspješne štampe: "Račun X JE odštampan,
 * ali nije zabilježen u bazi", "Reklamacija #X JE odštampana, ali …" (lib/ponuda.ts,
 * lib/proizvodnja.ts, lib/prilog.ts, lib/refund.ts; Rust ponude.rs
 * `poruka_nakon_stampe`, racuni.rs). Dokument je na papiru, a write-ahead
 * red ostaje (rollback) za dijalog nezavršenih računa.
 */
const ODSTAMPAN_NIJE_UPISAN = /JE odštampan/;

const NEZAVRSENI = /nezavršen/i;

function odgovoriUredjaja(odgovori: Record<string, string> | undefined): string {
  return odgovori ? Object.entries(odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
}

/**
 * Odgovor fiskalnog kanala ili greška koju je poziv bacio → ishod za ekran.
 * Bačena greška s oznakom "JE odštampan" je `nepoznat`; ostale bačene greške
 * su validacija prije štampe (`greska`) — osim kad write-ahead red ostane,
 * što provjerava `izvrsiFiskalno`.
 */
export function procitajIshod(res: FiskalniOdgovor | null | undefined, bacio?: unknown): Ishod {
  if (bacio !== undefined) {
    const poruka = porukaGreske(bacio);
    return { vrsta: ODSTAMPAN_NIJE_UPISAN.test(poruka) ? 'nepoznat' : 'greska', poruka };
  }
  if (!res) return { vrsta: 'greska', poruka: 'Nepoznata greška' };
  if (res.success) return { vrsta: 'uspjeh', poruka: '' };
  // Prije ishodNepoznat: poruka već evidentiranog računa i sama kaže "JE odštampan".
  if (res.vecEvidentiran) return { vrsta: 'vecEvidentiran', poruka: res.error || 'Dokument je već evidentiran.' };
  if (res.ishodNepoznat) return { vrsta: 'nepoznat', poruka: res.error || 'Ishod štampe nije poznat.' };
  const detalji = odgovoriUredjaja(res.odgovori);
  const greska = res.error || res.vrstaOdgovora || 'Nepoznata greška';
  return { vrsta: 'greska', poruka: detalji ? `${greska} (${detalji})` : greska };
}

/** Postoji li write-ahead red koji čeka dijalog nezavršenih računa. */
export async function imaNezavrsenihRacuna(): Promise<boolean> {
  const redovi = await window.api.listPending();
  return Array.isArray(redovi) && redovi.length > 0;
}

/**
 * Pozove fiskalni kanal i pročita ishod. Greška bačena bez oznake nije uvijek
 * validacija: order:finalize (oba backenda) grešku transakcije upisa poslije
 * uspješne štampe baca sirovu, a IPC može pasti bez odgovora. U svim tim
 * slučajevima write-ahead red ostaje, pa njegovo postojanje odlučuje: red
 * postoji (ili se ne može provjeriti) → `nepoznat`, inače `greska`.
 */
export async function izvrsiFiskalno<R extends FiskalniOdgovor>(
  poziv: () => Promise<R | null | undefined>,
  cekaNezavrsen: () => Promise<boolean> = imaNezavrsenihRacuna,
): Promise<{ ishod: Ishod; res: R | null }> {
  let res: R | null = null;
  let ishod: Ishod;
  try {
    res = (await poziv()) ?? null;
    ishod = procitajIshod(res);
    if (res) return { ishod, res };
  } catch (e) {
    ishod = procitajIshod(undefined, e ?? 'Nepoznata greška');
    if (ishod.vrsta !== 'greska') return { ishod, res: null };
  }

  let ceka = true;
  try { ceka = await cekaNezavrsen(); } catch { /* ne zna se — kao da čeka */ }
  if (!ceka) return { ishod, res };
  const poruka = NEZAVRSENI.test(ishod.poruka)
    ? ishod.poruka
    : `Ishod štampe nije poznat (${ishod.poruka}). Provjerite papirni isječak i riješite zapis u nezavršenim računima.`;
  return { ishod: { vrsta: 'nepoznat', poruka }, res };
}
