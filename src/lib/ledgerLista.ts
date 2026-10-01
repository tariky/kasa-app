/**
 * Tastatura ledger lista (Računi, Ponude, Proizvodnja, Skladište) kao čista
 * pravila: koji red bira tipka, šta tipka van polja za unos radi i koji su
 * susjedni dokumenti otvorenog. Hookovi `useLedgerLista`, `usePreciceListe` i
 * `useSusjedni` ih samo izvršavaju nad DOM-om.
 */

/** Koliko redova preskače PageUp/PageDown. */
const STRANICA = 10;

/**
 * Indeks reda na koji vodi tipka u listi, ili null kad tipka ne pomjera izbor.
 * Bez izbora (`trenutni` < 0) ↓ i ↑ idu na prvi red. Rezultat je uvijek u
 * granicama liste; prazna lista daje 0 (red ne postoji, pa se ništa ne fokusira).
 */
export function indeksZaTipku(tipka: string, trenutni: number, duzina: number): number | null {
  const tren = trenutni < 0 ? -1 : trenutni;
  const zadnji = duzina - 1;
  let i: number;
  switch (tipka) {
    case 'ArrowDown': i = tren + 1; break;
    case 'ArrowUp': i = tren < 0 ? 0 : tren - 1; break;
    case 'PageDown': i = tren + STRANICA; break;
    case 'PageUp': i = tren < 0 ? 0 : tren - STRANICA; break;
    case 'Home': i = 0; break;
    case 'End': i = zadnji; break;
    default: return null;
  }
  return Math.max(0, Math.min(zadnji, i));
}

/** Susjedni filter u traci, u krug. */
export function sljedeciFilter<F extends string>(filteri: readonly { id: F }[], trenutni: F, korak: -1 | 1): F {
  const i = filteri.findIndex(f => f.id === trenutni);
  return filteri[(i + korak + filteri.length) % filteri.length].id;
}

export interface TipkaListe { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }

/**
 * Ctrl+F (⌘F) — pretraga na svakom rasporedu tastature, jer „/“ na BiH/HR traži
 * Shift+7. AltGr na Windowsu stiže kao Ctrl+Alt, pa AltGr+F nije pretraga.
 * Nove prečice: slova, cifre, F-tipke i strelice; simbol samo uz ovakvu zamjenu.
 */
export const jeCtrlF = (t: TipkaListe) => (t.ctrlKey || t.metaKey) && !t.altKey && t.key.toLowerCase() === 'f';

/** Gdje je tipka pritisnuta. */
export interface MjestoTipke {
  /** Input, textarea, select ili contentEditable (`jePoljeZaUnos`). */
  uPolju: boolean;
  /** Polje pretrage ove liste. */
  uPretrazi: boolean;
  /** Red liste (`tbody`) — ↑↓ i ↵ tamo vodi sama lista. */
  uListi: boolean;
  /** Padajući izbornik ili njegova lista (`[role=combobox]`, `[role=listbox]`). */
  uIzborniku: boolean;
}

/** Šta ekran nudi s tastature. */
export interface MogucnostiListe {
  /** „/“ i Ctrl+F fokusiraju pretragu, esc u pretrazi briše upit. */
  pretraga?: boolean;
  novi?: boolean;
  osvjezi?: boolean;
  /** ←→ i [ ] mijenjaju filter. */
  filteri?: boolean;
  /** Ekran ima listu redova (useLedgerLista). */
  lista?: boolean;
  /** ↓ iz pretrage: na prvi pronađeni red ili na izabrani (prvi kad izabrani nije u listi). */
  izPretrage?: 'prvi' | 'izabrani';
  /** ↑↓ van liste uvode fokus u listu (zadano: kad ekran ima listu). */
  strelicomUListu?: boolean;
  /** ↵ van liste otvara izabrani dokument (zadano: kad ekran ima listu). */
  enterOtvara?: boolean;
  /** U padajućem izborniku prečice liste miruju (zadano: da). */
  preskociIzbornike?: boolean;
}

export type AkcijaListe =
  | { vrsta: 'ocistiPretragu' }
  | { vrsta: 'izPretrage'; na: 'prvi' | 'izabrani' }
  | { vrsta: 'pretraga' }
  | { vrsta: 'novi' }
  | { vrsta: 'osvjezi' }
  | { vrsta: 'filter'; korak: -1 | 1 }
  | { vrsta: 'uListu' }
  | { vrsta: 'otvori' };

/**
 * Prečica liste za tipku, `null` kad tipka tu ne smije ništa uraditi (modifikator,
 * polje za unos, izbornik, ↑↓/↵ na redu), ili `'dalje'` kad nije tipka liste pa je
 * može obraditi ekran (Ponude: P, S, U, K…). Slova se gledaju bez obzira na Shift.
 */
export function akcijaListe(t: TipkaListe, mjesto: MjestoTipke, m: MogucnostiListe): AkcijaListe | 'dalje' | null {
  if (jeCtrlF(t)) return m.pretraga ? { vrsta: 'pretraga' } : null;
  if (t.metaKey || t.ctrlKey || t.altKey) return null;
  if (mjesto.uPolju) {
    if (mjesto.uPretrazi) {
      if (t.key === 'Escape') return { vrsta: 'ocistiPretragu' };
      if (t.key === 'ArrowDown' && m.izPretrage) return { vrsta: 'izPretrage', na: m.izPretrage };
    }
    return null;
  }
  if ((m.preskociIzbornike ?? true) && mjesto.uIzborniku) return null;
  if (t.key === '/' && m.pretraga) return { vrsta: 'pretraga' };
  // Strelice rade na svakom rasporedu; zagrade su alias jer na bosanskom traže AltGr.
  if (m.filteri && (t.key === 'ArrowLeft' || t.key === '[')) return { vrsta: 'filter', korak: -1 };
  if (m.filteri && (t.key === 'ArrowRight' || t.key === ']')) return { vrsta: 'filter', korak: 1 };
  if ((t.key === 'ArrowDown' || t.key === 'ArrowUp') && (m.strelicomUListu ?? !!m.lista)) {
    return mjesto.uListi ? null : { vrsta: 'uListu' };
  }
  const slovo = t.key.toLowerCase();
  if (slovo === 'n' && m.novi) return { vrsta: 'novi' };
  if (slovo === 'r' && m.osvjezi) return { vrsta: 'osvjezi' };
  if (t.key === 'Enter' && (m.enterOtvara ?? !!m.lista)) return mjesto.uListi ? null : { vrsta: 'otvori' };
  return 'dalje';
}

export interface Susjedni {
  prev: number | null;
  next: number | null;
  /** „2 / 14“ — prazno kad dokument nije u listi (npr. filter ga skriva). */
  pozicija: string;
}

/** Prethodni i sljedeći dokument po redoslijedu liste iz koje je otvoren. */
export function susjedni(redoslijed: readonly number[], id: number | null): Susjedni {
  const i = id != null ? redoslijed.indexOf(id) : -1;
  return {
    prev: i > 0 ? redoslijed[i - 1] : null,
    next: i >= 0 && i < redoslijed.length - 1 ? redoslijed[i + 1] : null,
    pozicija: i >= 0 ? `${i + 1} / ${redoslijed.length}` : '',
  };
}
