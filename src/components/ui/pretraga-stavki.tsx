import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Search, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Key, mod } from '@/components/ui/ledger';
import { parsirajUpit, pretrazi, type Pogodak, type PoljaPretrage } from '@/lib/pretraga';

/** Koliko redova lista najviše crta — ostatak se dobije kucanjem. */
const PRIKAZ_MAX = 60;
const NEDAVNO_MAX = 4;

export interface PretragaStavkiHandle {
  focus: () => void;
}

export interface PretragaStavkiProps<T extends object> {
  /** Katalog u memoriji; null dok se učitava. */
  stavke: readonly T[] | null;
  polja: (s: T) => PoljaPretrage;
  kljuc: (s: T) => string | number;
  /** kolicina je broj iz prefiksa "3*…", inače null. */
  onIzaberi: (s: T, kolicina: number | null) => void;
  /** Desna strana reda (stanje, cijena…). */
  meta?: (s: T) => ReactNode;
  /** Sitna oznaka ispod naziva (tip, dimenzija ploče…). */
  oznaka?: (s: T) => ReactNode;
  /** Naslov grupe dok je upit prazan; grupe idu redom kojim se prvi put pojave u `stavke`. */
  grupa?: (s: T) => string;
  /** Naslov liste bez upita kad nema grupa. */
  naslovSvih?: string;
  /** Prazan rezultat nudi dugme za novu stavku s ukucanim tekstom (i ⌘/Ctrl+Enter). */
  onNova?: (tekst: string) => void;
  novaLabel?: string;
  /** localStorage ključ pod kojim se pamte nedavno izabrane stavke. */
  nedavnoKljuc?: string;
  /** Dodatak skoru — čita se pri svakoj pretrazi. */
  bonus?: (s: T, upit: string) => number;
  /** Zove se kad se lista otvori (npr. osvježi stanje u katalogu). */
  onOtvori?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Podnožje nudi "3*" za količinu; isključi gdje količina nema smisla (npr. kupci). */
  kolicine?: boolean;
  /** Glagol u podnožju uz Enter. */
  akcija?: string;
  debounceMs?: number;
  velicina?: 'lg' | 'md' | 'sm';
  /** Fokus otvara listu; isključi kad roditelj stalno vraća fokus u polje (kasa) — lista se tada otvara kucanjem, klikom ili ↓. */
  otvoriNaFokus?: boolean;
  /** Tipka koju roditelj hvata za fokus (samo se prikazuje). */
  precica?: string;
  /** Lista je barem ovoliko široka i kad je polje uže (npr. u ćeliji tabele). */
  minSirinaListe?: number;
  /** Kolona sa šifrom lijevo; isključi za liste bez šifri (npr. kupci). */
  sifre?: boolean;
  /** Dodatne klase na okviru polja (npr. označavanje obaveznog polja). */
  poljeClassName?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  ref?: Ref<PretragaStavkiHandle>;
}

type Red<T> =
  | { vrsta: 'sekcija'; naslov: string; broj?: number }
  | { vrsta: 'stavka'; p: Pogodak<T>; i: number };

const citajNedavno = (k?: string): string[] => {
  if (!k) return [];
  try { const v = JSON.parse(localStorage.getItem(`pretraga.nedavno.${k}`) ?? '[]'); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
};
const pisiNedavno = (k: string, ids: string[]) => {
  try { localStorage.setItem(`pretraga.nedavno.${k}`, JSON.stringify(ids)); } catch { /* bez pamćenja */ }
};

const fmtKol = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Univerzalna pretraga za unos stavki (artikli, usluge, materijali). Fokus otvara listu
 * (nedavno pa sve), kucanje filtrira fuzzy pretragom s debounceom, ↑↓/PgUp/PgDn biraju,
 * Enter dodaje (i prije isteka debouncea), Esc briše upit pa zatvara, "3*" daje količinu.
 */
export function PretragaStavki<T extends object>(props: PretragaStavkiProps<T>) {
  const {
    stavke, kljuc, onIzaberi, meta, oznaka, grupa, naslovSvih = 'Sve, abecedno', onNova, novaLabel = 'Nova stavka',
    nedavnoKljuc, onOtvori, placeholder, ariaLabel, akcija = 'dodaj', debounceMs = 120, kolicine = true, velicina = 'md', otvoriNaFokus = true, precica,
    minSirinaListe = 0, sifre = true, poljeClassName, className, autoFocus, disabled, inputRef, ref,
  } = props;
  const polja = useRef(props.polja); polja.current = props.polja;
  const bonus = useRef(props.bonus); bonus.current = props.bonus;

  const [tekst, setTekst] = useState('');
  const [upit, setUpit] = useState('');
  const [open, setOpen] = useState(false);
  const [nedavno, setNedavno] = useState<string[]>(() => citajNedavno(nedavnoKljuc));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(false);

  const inputEl = useRef<HTMLInputElement | null>(null);
  const poljeEl = useRef<HTMLDivElement>(null);
  const listaEl = useRef<HTMLUListElement>(null);
  const hlEl = useRef<HTMLDivElement>(null);
  const redEl = useRef<Map<number, HTMLLIElement>>(new Map());
  const skrolaj = useRef(false);
  const vidjeni = useRef<Set<string>>(new Set());
  const listId = useId();

  useImperativeHandle(ref, () => ({ focus: () => inputEl.current?.focus() }), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setInput = (el: HTMLInputElement | null) => {
    inputEl.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  const { kolicina } = parsirajUpit(tekst);
  const q = parsirajUpit(upit).upit;

  const rezultati = useMemo(
    () => (stavke && q ? pretrazi(stavke, q, polja.current, { bonus: bonus.current }) : null),
    [stavke, q],
  );

  const redovi = useMemo<Red<T>[]>(() => {
    const out: Red<T>[] = [];
    if (!stavke) return out;
    let i = 0;
    const dodaj = (p: Pogodak<T>) => { out.push({ vrsta: 'stavka', p, i: i++ }); };
    const pogodak = (stavka: T): Pogodak<T> => ({ stavka, skor: 0, nazivIdx: [], sifraPogodak: false, barkodPogodak: false });
    if (rezultati) {
      rezultati.slice(0, PRIKAZ_MAX).forEach(dodaj);
      return out;
    }
    const poKljucu = new Map(stavke.map(s => [String(kljuc(s)), s]));
    const ned = nedavno.map(k => poKljucu.get(k)).filter((s): s is T => !!s).slice(0, NEDAVNO_MAX);
    if (ned.length) {
      out.push({ vrsta: 'sekcija', naslov: 'Nedavno korišteno' });
      ned.forEach(s => dodaj(pogodak(s)));
    }
    const nedSet = new Set(ned);
    const ostale = stavke.filter(s => !nedSet.has(s));
    const grupe = new Map<string, T[]>();
    for (const s of ostale) {
      const g = grupa ? grupa(s) : naslovSvih;
      const lista = grupe.get(g);
      if (lista) lista.push(s); else grupe.set(g, [s]);
    }
    for (const [naslov, lista] of grupe) {
      if (i >= PRIKAZ_MAX) break;
      out.push({ vrsta: 'sekcija', naslov, broj: lista.length });
      lista.slice(0, PRIKAZ_MAX - i).forEach(s => dodaj(pogodak(s)));
    }
    return out;
  }, [stavke, rezultati, nedavno, grupa, naslovSvih, kljuc]);

  const izbor = useMemo(() => redovi.flatMap(r => (r.vrsta === 'stavka' ? [r.p] : [])), [redovi]);

  // Aktivni red važi samo za listu za koju je izabran — nova lista kreće od prvog reda u istom renderu.
  const [aktivno, setAktivno] = useState<{ za: Red<T>[]; i: number }>({ za: redovi, i: 0 });
  const active = aktivno.za === redovi ? aktivno.i : 0;
  const setActive = (i: number) => setAktivno({ za: redovi, i });
  const ukupno = rezultati ? rezultati.length : stavke?.length ?? 0;

  // Novi redovi (kojih nije bilo u prošlom crtanju) ulaze animirano; stari ostaju mirni.
  const kljucevi = useMemo(() => izbor.map(p => String(kljuc(p.stavka))), [izbor, kljuc]);
  const noviKljucevi = useMemo(() => new Set(kljucevi.filter(k => !vidjeni.current.has(k))), [kljucevi]);
  useEffect(() => { vidjeni.current = new Set(kljucevi); }, [kljucevi]);

  // Oznaka aktivnog reda klizi između redova; kad se lista promijeni, skače bez animacije.
  const prosliRedovi = useRef(redovi);
  useLayoutEffect(() => {
    const hl = hlEl.current;
    const el = redEl.current.get(active);
    if (!hl) return;
    if (!el) { hl.style.opacity = '0'; return; }
    const skok = prosliRedovi.current !== redovi;
    prosliRedovi.current = redovi;
    if (skok) hl.style.transition = 'none';
    hl.style.transform = `translateY(${el.offsetTop}px)`;
    hl.style.height = `${el.offsetHeight}px`;
    hl.style.opacity = '1';
    if (skok) { void hl.offsetHeight; hl.style.transition = ''; }
    const lista = listaEl.current;
    if (skrolaj.current && lista) {
      skrolaj.current = false;
      const top = el.offsetTop, bot = top + el.offsetHeight, pad = 32;
      if (top - pad < lista.scrollTop) lista.scrollTo({ top: Math.max(0, top - pad), behavior: 'smooth' });
      else if (bot + 6 > lista.scrollTop + lista.clientHeight) lista.scrollTo({ top: bot + 6 - lista.clientHeight, behavior: 'smooth' });
    }
  }, [active, redovi, open]);

  const otvori = () => {
    if (open || disabled) return;
    vidjeni.current = new Set();
    setActive(0);
    setNedavno(citajNedavno(nedavnoKljuc));
    setOpen(true);
    onOtvori?.();
  };
  const zatvori = () => {
    setOpen(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setPending(false);
  };
  const obrisi = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setTekst(''); setUpit(''); setPending(false);
  };

  const promijeni = (v: string) => {
    setTekst(v);
    otvori();
    if (timer.current) clearTimeout(timer.current);
    if (!debounceMs || !parsirajUpit(v).upit) { timer.current = null; setUpit(v); setPending(false); return; }
    setPending(true);
    timer.current = setTimeout(() => { timer.current = null; setUpit(v); setPending(false); }, debounceMs);
  };

  const izaberi = (s: T) => {
    onIzaberi(s, kolicina);
    if (nedavnoKljuc) {
      const k = String(kljuc(s));
      const nova = [k, ...citajNedavno(nedavnoKljuc).filter(x => x !== k)].slice(0, 8);
      pisiNedavno(nedavnoKljuc, nova);
      setNedavno(nova);
    }
    obrisi();
    zatvori();
  };

  const pomjeri = (d: number) => {
    if (!izbor.length) return;
    skrolaj.current = true;
    setActive(Math.abs(d) === 1 ? (active + d + izbor.length) % izbor.length : Math.min(izbor.length - 1, Math.max(0, active + d)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return otvori();
      pomjeri(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      if (!open) return;
      e.preventDefault();
      pomjeri(e.key === 'PageDown' ? 7 : -7);
    } else if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return;
      const { upit: sad } = parsirajUpit(tekst);
      // ⌘/Ctrl+Enter pravi novu stavku; bez onNova pripada roditelju (npr. spremanje dijaloga).
      if (e.metaKey || e.ctrlKey) {
        if (onNova && sad) { e.preventDefault(); onNova(sad); obrisi(); zatvori(); }
        return;
      }
      e.preventDefault();
      // Enter prije isteka debouncea (npr. čitač barkoda): pretraži odmah.
      if (timer.current || upit !== tekst) {
        const [prvi] = stavke && sad ? pretrazi(stavke, sad, polja.current, { bonus: bonus.current, max: 1 }) : [];
        if (prvi) izaberi(prvi.stavka);
        return;
      }
      if (open && izbor[active]) izaberi(izbor[active].stavka);
      else if (!open) otvori();
    } else if (e.key === 'Escape' && !open && tekst) {
      obrisi();
    }
  };

  const sm = velicina === 'sm';
  const lg = velicina === 'lg';

  return (
    <PopoverPrimitive.Root open={open && !disabled}>
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={poljeEl}
          className={cn(
            'group/ps relative flex items-center rounded-lg border border-slate-200 bg-slate-50',
            'transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none',
            'focus-within:bg-white focus-within:border-blue-400/70 focus-within:ring-[3px] focus-within:ring-blue-500/10',
            sm ? 'h-8' : lg ? 'h-12 rounded-xl' : 'h-10',
            disabled && 'opacity-50 pointer-events-none',
            poljeClassName, className,
          )}
        >
          <Search className={cn('absolute pointer-events-none text-slate-400 transition-colors group-focus-within/ps:text-blue-500', sm ? 'left-2.5 h-3.5 w-3.5' : lg ? 'left-4 h-[18px] w-[18px]' : 'left-3 h-4 w-4')} />
          <input
            ref={setInput}
            value={tekst}
            onChange={e => promijeni(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={otvoriNaFokus ? otvori : undefined}
            onMouseDown={() => { if (!otvoriNaFokus || document.activeElement === inputEl.current) otvori(); }}
            onBlur={() => setTimeout(() => { if (document.activeElement !== inputEl.current) zatvori(); }, 0)}
            placeholder={placeholder}
            aria-label={ariaLabel ?? placeholder}
            autoFocus={autoFocus}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && izbor[active] ? `${listId}-${active}` : undefined}
            className={cn(
              'h-full min-w-0 flex-1 bg-transparent text-slate-800 outline-none placeholder:text-slate-400',
              sm ? 'pl-8 pr-1 text-[12.5px]' : lg ? 'pl-11 pr-2 text-[15px]' : 'pl-9 pr-2 text-[13px]',
            )}
          />
          <div className={cn('flex items-center gap-1', sm ? 'pr-1' : lg ? 'pr-2.5' : 'pr-1.5')}>
            {kolicina != null && (
              <span className="inline-flex h-5 items-center rounded-md bg-blue-50 px-1.5 font-mono text-[11px] font-semibold tabular-nums text-blue-700 animate-in zoom-in-75 fade-in-0 duration-150">
                × {fmtKol(kolicina)}
              </span>
            )}
            {tekst && (
              <button
                type="button" tabIndex={-1} aria-label="Obriši pretragu"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { obrisi(); inputEl.current?.focus(); otvori(); }}
                className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
            {precica && !tekst && <Key className="ml-0 mr-1 group-focus-within/ps:hidden">{precica}</Key>}
          </div>
          <div aria-hidden className={cn('pointer-events-none absolute inset-x-2.5 -bottom-px h-[2px] overflow-hidden rounded-full transition-opacity duration-100', pending ? 'opacity-100' : 'opacity-0')}>
            <div className="h-full w-2/5 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pretraga-traka motion-reduce:animate-none" />
          </div>
        </div>
      </PopoverPrimitive.Anchor>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom" align="start" sideOffset={6} collisionPadding={8}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => { if (poljeEl.current?.contains(e.target as Node)) e.preventDefault(); else zatvori(); }}
          onEscapeKeyDown={e => { if (tekst) { e.preventDefault(); obrisi(); } else zatvori(); }}
          style={{ width: `max(var(--radix-popover-trigger-width), ${minSirinaListe}px)` }}
          className={cn(
            'z-50 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white outline-none',
            'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-12px_rgba(15,23,42,0.22)]',
            'origin-[--radix-popover-content-transform-origin] duration-150',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.985] data-[side=bottom]:slide-in-from-top-1.5 data-[side=top]:slide-in-from-bottom-1.5',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.985]',
          )}
        >
          <ul
            ref={listaEl} id={listId} role="listbox" aria-label={ariaLabel ?? 'Rezultati pretrage'}
            onMouseDown={e => e.preventDefault()}
            className="relative max-h-[min(380px,calc(var(--radix-popover-content-available-height)-48px))] overflow-y-auto overscroll-contain p-1.5"
          >
            <div ref={hlEl} aria-hidden className="pointer-events-none absolute inset-x-1.5 top-0 rounded-lg bg-blue-50 opacity-0 transition-[transform,height,opacity] duration-150 ease-[cubic-bezier(.3,.9,.3,1)] motion-reduce:transition-none" />
            {!stavke && <li className="px-3 py-6 text-center text-[12.5px] text-slate-400">Učitavam…</li>}
            {stavke && !izbor.length && (
              <li className="flex flex-col items-center gap-2.5 px-4 py-6 text-center">
                <p className="text-[12.5px] text-slate-500">
                  {q ? <>Nema stavke koja odgovara <b className="font-semibold text-slate-800">„{q}”</b>.</> : 'Lista je prazna.'}
                </p>
                {onNova && q && (
                  <button
                    type="button" onClick={() => { onNova(q); obrisi(); zatvori(); }}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 text-[12px] font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    <Plus size={13} /> {novaLabel} „{q}” <Key className="ml-1 border-blue-200 bg-white text-blue-400">{mod('↵')}</Key>
                  </button>
                )}
              </li>
            )}
            {redovi.map((r, n) => r.vrsta === 'sekcija' ? (
              <li key={`s-${r.naslov}`} role="presentation" className={cn('relative flex justify-between px-2.5 pb-1 text-[11px] font-semibold text-slate-500', n === 0 ? 'pt-1' : 'pt-2.5')}>
                {r.naslov}
                {r.broj != null && <span className="font-normal tabular-nums text-slate-400">{r.broj}</span>}
              </li>
            ) : (
              <Opcija
                key={String(kljuc(r.p.stavka))}
                id={`${listId}-${r.i}`}
                p={r.p}
                polja={polja.current(r.p.stavka)}
                aktivna={r.i === active}
                nova={noviKljucevi.has(String(kljuc(r.p.stavka)))}
                kasnjenje={Math.min(r.i, 8) * 14}
                meta={meta?.(r.p.stavka)}
                oznaka={oznaka?.(r.p.stavka)}
                sm={sm}
                sifre={sifre}
                refEl={el => { if (el) redEl.current.set(r.i, el); else redEl.current.delete(r.i); }}
                onHover={() => { if (r.i !== active) setActive(r.i); }}
                onClick={() => izaberi(r.p.stavka)}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><Key className="ml-0">↑</Key><Key className="ml-0">↓</Key> biranje</span>
            <span className="inline-flex items-center gap-1"><Key className="ml-0">↵</Key> {akcija}</span>
            {kolicine && <span className="inline-flex items-center gap-1"><Key className="ml-0">3*</Key> količina</span>}
            <span className="inline-flex items-center gap-1"><Key className="ml-0">esc</Key> zatvori</span>
            <span className="ml-auto font-mono tabular-nums text-slate-400">
              {q ? `${ukupno} od ${stavke?.length ?? 0}` : ukupno > izbor.length ? `${izbor.length} od ${ukupno}, kucajte za više` : `${ukupno}`}
            </span>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function Oznaceno({ tekst, idx }: { tekst: string; idx: number[] }) {
  if (!idx.length) return <>{tekst}</>;
  const set = new Set(idx);
  const dijelovi: ReactNode[] = [];
  const znakovi = [...tekst];
  let i = 0;
  while (i < znakovi.length) {
    const on = set.has(i);
    let j = i;
    while (j < znakovi.length && set.has(j) === on) j++;
    const s = znakovi.slice(i, j).join('');
    dijelovi.push(on ? <mark key={i} className="bg-transparent font-semibold text-blue-700">{s}</mark> : s);
    i = j;
  }
  return <>{dijelovi}</>;
}

function Opcija<T>({ id, p, polja, aktivna, nova, kasnjenje, meta, oznaka, sm, sifre, refEl, onHover, onClick }: {
  id: string; p: Pogodak<T>; polja: PoljaPretrage; aktivna: boolean; nova: boolean; kasnjenje: number;
  meta?: ReactNode; oznaka?: ReactNode; sm: boolean; sifre: boolean;
  refEl: (el: HTMLLIElement | null) => void; onHover: () => void; onClick: () => void;
}) {
  return (
    <li
      ref={refEl} id={id} role="option" aria-selected={aktivna}
      onMouseMove={onHover} onClick={onClick}
      style={nova ? { animationDelay: `${kasnjenje}ms` } : undefined}
      className={cn(
        'relative grid cursor-pointer select-none items-center gap-3 rounded-lg px-2.5',
        sifre ? 'grid-cols-[64px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]',
        sm ? 'min-h-[38px] py-1' : 'min-h-[42px] py-1.5',
        nova && 'animate-in fade-in-0 slide-in-from-bottom-[3px] duration-200 fill-mode-both motion-reduce:animate-none',
      )}
    >
      {sifre && (
        <span className="truncate font-mono text-[11px] text-slate-400">
          {p.sifraPogodak ? <mark className="bg-transparent font-semibold text-blue-700">{polja.sifra}</mark> : polja.sifra}
        </span>
      )}
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px] transition-colors', aktivna ? 'text-slate-900' : 'text-slate-700')}>
          <Oznaceno tekst={polja.naziv} idx={p.nazivIdx} />
        </span>
        {(oznaka || p.barkodPogodak) && (
          <span className="mt-px flex items-center gap-2 text-[11px] text-slate-400">
            {oznaka}
            {p.barkodPogodak && <span className="font-mono text-blue-700">barkod {polja.barkod}</span>}
          </span>
        )}
      </span>
      <span className="flex items-baseline gap-4 whitespace-nowrap text-[12px]">{meta}</span>
    </li>
  );
}
