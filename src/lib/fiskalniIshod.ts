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
 * ali nije zabilježen u bazi", "Reklamacija #X JE odštampana, ali …" — svih pet
 * tokova (lib/fiskalizacija.ts `porukaNakonStampe`, lib/proizvodnja.ts; Rust
 * stampa.rs `nije_zabiljezen`, `poruka_nakon_stampe`). Dokument je na papiru,
 * a write-ahead red ostaje (rollback) za dijalog nezavršenih računa.
 */
const ODSTAMPAN_NIJE_UPISAN = /JE odštampan/;

function odgovoriUredjaja(odgovori: Record<string, string> | undefined): string {
  return odgovori ? Object.entries(odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
}

/**
 * Odgovor fiskalnog kanala ili greška koju je poziv bacio → ishod za ekran.
 * Bačena greška s oznakom "JE odštampan" je `nepoznat`; ostale bačene greške
 * su validacija prije štampe (`greska`) — osim kad poziv ostavi novi
 * write-ahead red, što provjerava `izvrsiFiskalno`.
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

/** Id-evi write-ahead redova koji čekaju dijalog nezavršenih računa (AUTOINCREMENT — id se ne ponavlja). */
export async function idNezavrsenih(): Promise<number[]> {
  const redovi = await window.api.listPending();
  if (!Array.isArray(redovi)) throw new Error('Nezavršeni računi nisu pročitani');
  return redovi.map(r => r.id);
}

async function procitaj(nezavrseni: () => Promise<number[]>): Promise<Set<number> | null> {
  try { return new Set(await nezavrseni()); } catch { return null; }
}

/**
 * Pozove fiskalni kanal i pročita ishod. Greška bačena bez oznake nije uvijek
 * validacija: IPC može pasti bez odgovora, ili poziv baci poslije write-ahead
 * reda (upis koji padne poslije štampe oba backenda javljaju s oznakom —
 * `ODSTAMPAN_NIJE_UPISAN`). Tada ostaje write-ahead red koji je upisao ovaj
 * poziv, pa se nezavršeni čitaju prije i poslije: novi red (ili čitanje koje
 * nije uspjelo) → `nepoznat`, inače `greska`. Red koji je čekao i prije ne
 * odlučuje — nevezan dokument ne smije pretvoriti grešku validacije u nepoznat
 * ishod, a red istog dokumenta ionako odbija štampu (`baciAkoCekaNezavrsen`).
 */
export async function izvrsiFiskalno<R extends FiskalniOdgovor>(
  poziv: () => Promise<R | null | undefined>,
  nezavrseni: () => Promise<number[]> = idNezavrsenih,
): Promise<{ ishod: Ishod; res: R | null }> {
  const prije = await procitaj(nezavrseni);
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

  const poslije = await procitaj(nezavrseni);
  const noviRed = !prije || !poslije || [...poslije].some(id => !prije.has(id));
  if (!noviRed) return { ishod, res };
  return {
    ishod: {
      vrsta: 'nepoznat',
      poruka: `Ishod štampe nije poznat (${ishod.poruka}). Provjerite papirni isječak i riješite zapis u nezavršenim računima.`,
    },
    res,
  };
}
