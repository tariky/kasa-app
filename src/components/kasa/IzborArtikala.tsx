import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Search, X, ScanBarcode, PencilLine } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key } from '@/components/ui/ledger';
import { cn, formatKM } from '@/lib/utils';
import { artikalZaEnter, nemaNaStanju, pomjeriKursor } from '@/lib/izborArtikala';
import type { Product } from '@/types';

export type TipFilter = 'svi' | 'proizvodi' | 'usluge';

interface Props {
  /** Artikli koji se prikazuju — već filtrirani po pretrazi i tipu. Mora biti memoizirano: promjena reference resetuje kursor. */
  artikli: Product[];
  query: string;
  onQueryChange: (q: string) => void;
  tipFilter: TipFilter;
  onTipFilterChange: (t: TipFilter) => void;
  /** Brzi sken: artikal ide u košaricu odmah s količinom 1, bez dijaloga. */
  brziSken: boolean;
  onBrziSkenChange: (on: boolean) => void;
  /** Otvara unos stavke bez šifre (F3). */
  onSlobodnaStavka: () => void;
  allowZeroStock: boolean;
  /** Globalne prečice (F2, Esc, kucanje bilo gdje) rade samo dok je picker aktivan — bez otvorenog dijaloga. */
  aktivan: boolean;
  onOdaberi: (product: Product) => void;
  /** Roditelj vraća fokus u pretragu poslije dodavanja i zatvaranja dijaloga. */
  searchRef: RefObject<HTMLInputElement | null>;
}

const FILTERI: { value: TipFilter; label: string }[] = [
  { value: 'svi', label: 'Svi' },
  { value: 'proizvodi', label: 'Proizvodi' },
  { value: 'usluge', label: 'Usluge' },
];

/** Jedan red = jedan artikal: šifra · naziv · stanje · cijena · (↵ na redu pod kursorom). */
const KOLONE = 'grid grid-cols-[6rem_minmax(0,1fr)_5.5rem_6.5rem_1.75rem] items-center gap-3 px-4';

/** Kucanje van polja za unos ide u pretragu — skener radi i kad fokus pobjegne na dugme. */
function uPoljuZaUnos(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/**
 * Lijeva strana kase: pretraga, filter po tipu, brzi sken i lista artikala.
 * Redoslijed na ekranu je redoslijed strelica; tamni red je ono što Enter dodaje.
 */
export default function IzborArtikala({
  artikli, query, onQueryChange, tipFilter, onTipFilterChange,
  brziSken, onBrziSkenChange, onSlobodnaStavka, allowZeroStock, aktivan, onOdaberi, searchRef,
}: Props) {
  const [kursor, setKursor] = useState(-1);
  const [napomena, setNapomena] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const napomenaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rezultati pretrage odmah dobiju kursor na prvom redu; cijela lista (prazna pretraga) nema kursor.
  useEffect(() => {
    setKursor(query.trim() && artikli.length > 0 ? 0 : -1);
  }, [artikli, query]);

  useEffect(() => {
    if (kursor < 0) return;
    const red = listaRef.current?.querySelector<HTMLElement>(`[data-red="${kursor}"]`);
    red?.scrollIntoView({ block: 'nearest' });
  }, [kursor]);

  const objavi = useCallback((tekst: string) => {
    setNapomena(tekst);
    if (napomenaTimer.current) clearTimeout(napomenaTimer.current);
    napomenaTimer.current = setTimeout(() => setNapomena(null), 2500);
  }, []);
  useEffect(() => () => { if (napomenaTimer.current) clearTimeout(napomenaTimer.current); }, []);

  const odaberi = useCallback((p: Product) => {
    if (nemaNaStanju(p, allowZeroStock)) {
      objavi(`„${p.naziv}“ nema na stanju.`);
      searchRef.current?.focus();
      return;
    }
    onOdaberi(p);
  }, [allowZeroStock, objavi, onOdaberi, searchRef]);

  const ocisti = useCallback(() => {
    onQueryChange('');
    searchRef.current?.focus();
  }, [onQueryChange, searchRef]);

  // Prečice koje vrijede na cijelom ekranu kase dok nijedan dijalog nije otvoren.
  useEffect(() => {
    if (!aktivan) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); onBrziSkenChange(!brziSken); return; }
      if (e.key === 'F3') { e.preventDefault(); onSlobodnaStavka(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (uPoljuZaUnos(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); ocisti(); return; }
      // Znak ili Backspace van polja: fokus u pretragu prije nego znak stigne, pa završi u njoj.
      if (e.key.length === 1 || e.key === 'Backspace') searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aktivan, brziSken, onBrziSkenChange, onSlobodnaStavka, ocisti, searchRef]);

  const onSearchKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const novi = pomjeriKursor(kursor, e.key, artikli.length);
    if (novi !== null) { e.preventDefault(); setKursor(novi); return; }
    if (e.key === 'Escape') { if (query) { e.preventDefault(); onQueryChange(''); } return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    const rezultati: Product[] = q ? await window.api.searchProducts(q) : [];
    const p = artikalZaEnter({ query, kursor, prikazani: artikli, rezultati });
    if (p) odaberi(p);
  }, [kursor, artikli, query, onQueryChange, odaberi]);

  const aktivniId = kursor >= 0 && kursor < artikli.length ? `artikal-${artikli[kursor].id}` : undefined;
  const prazno = useMemo(() => {
    if (artikli.length > 0) return null;
    return query.trim()
      ? { naslov: `Nema artikala za „${query.trim()}“`, pomoc: 'Esc briše pretragu' }
      : { naslov: 'Nema artikala', pomoc: tipFilter === 'svi' ? 'Dodajte artikle u Šifarniku' : 'Promijenite filter ili dodajte artikle u Šifarniku' };
  }, [artikli.length, query, tipFilter]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[hsl(220,20%,97%)] p-5 gap-3">
      {/* Pretraga */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none" />
        <Input
          ref={searchRef}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Skeniraj barkod ili pretraži artikle…"
          role="combobox"
          aria-expanded={artikli.length > 0}
          aria-controls="izbor-artikala-lista"
          aria-activedescendant={aktivniId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className="pl-12 pr-11 h-14 text-[15px] md:text-[15px] bg-white border-slate-200 rounded-2xl shadow-sm shadow-slate-200/40 focus-visible:border-blue-400 focus-visible:ring-4 focus-visible:ring-blue-500/10 focus-visible:ring-offset-0"
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={ocisti}
            aria-label="Očisti pretragu"
            title="Očisti pretragu (Esc)"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter + brzi sken */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Vrsta artikala">
          {FILTERI.map(f => {
            const aktivanF = tipFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={aktivanF}
                onClick={() => { onTipFilterChange(f.value); searchRef.current?.focus(); }}
                className={cn(
                  'h-8 px-3.5 rounded-[10px] text-[12.5px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                  aktivanF ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSlobodnaStavka}
            title="Slobodna stavka: upišite naziv, cijenu i PDV stopu za stavku koja nema šifru."
            className={cn(
              'inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl border text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
              'border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300',
            )}
          >
            <PencilLine className="h-4 w-4 text-slate-400" />
            Slobodna stavka
            <Key className="ml-1" tone="light">F3</Key>
          </button>
          <button
            type="button"
            aria-pressed={brziSken}
            onClick={() => onBrziSkenChange(!brziSken)}
            title="Brzi sken: artikal odmah ide u račun s količinom 1, bez pitanja za količinu. Ponovni sken dodaje još 1."
            className={cn(
              'inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl border text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
              brziSken
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300',
            )}
          >
            <ScanBarcode className={cn('h-4 w-4', brziSken ? 'text-blue-600' : 'text-slate-400')} />
            Brzi sken
            <Key className="ml-1" tone="light">F2</Key>
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 min-h-0 flex flex-col rounded-2xl bg-white border border-slate-200/80 overflow-hidden">
        {/* Naslovi kolona; kratka napomena (npr. nema na stanju) privremeno zauzme isti red, blizu reda na koji se odnosi. */}
        <div aria-live="polite" className={cn(
          'h-8 border-b select-none transition-colors',
          napomena ? 'border-rose-100 bg-rose-50' : 'border-slate-100',
        )}>
          {napomena ? (
            <div className="h-full flex items-center px-4 text-[12px] font-medium text-rose-700">{napomena}</div>
          ) : (
            <div className={cn(KOLONE, 'h-full text-[10px] font-semibold uppercase tracking-wider text-slate-400')}>
              <span>Šifra</span>
              <span>Naziv</span>
              <span className="text-right">Stanje</span>
              <span className="text-right">Cijena</span>
              <span />
            </div>
          )}
        </div>

        {prazno ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center select-none px-6">
            <p className="text-sm font-medium text-slate-500">{prazno.naslov}</p>
            <p className="text-xs text-slate-400 mt-1">{prazno.pomoc}</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div id="izbor-artikala-lista" role="listbox" aria-label="Artikli" ref={listaRef}>
              {artikli.map((p, idx) => {
                const aktivanRed = idx === kursor;
                const nema = nemaNaStanju(p, allowZeroStock);
                const malo = !nema && p.tip !== 'usluga' && p.stanje != null && p.stanje <= 5;
                return (
                  <div
                    key={p.id}
                    id={`artikal-${p.id}`}
                    data-red={idx}
                    role="option"
                    aria-selected={aktivanRed}
                    tabIndex={-1}
                    onClick={() => odaberi(p)}
                    className={cn(
                      KOLONE, 'h-11 cursor-pointer select-none border-b border-slate-100 last:border-b-0 transition-colors',
                      aktivanRed ? 'bg-slate-900 text-white' : 'hover:bg-slate-50',
                    )}
                  >
                    <span
                      title={p.sifra}
                      className={cn('font-mono text-[11.5px] truncate', aktivanRed ? 'text-slate-300' : 'text-slate-500')}
                    >
                      {p.sifra}
                    </span>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        'text-[13.5px] font-medium truncate',
                        aktivanRed ? 'text-white' : nema ? 'text-slate-400' : 'text-slate-800',
                      )}>
                        {p.naziv}
                      </span>
                      {p.tip === 'usluga' && (
                        <span className={cn(
                          'flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full',
                          aktivanRed ? 'bg-white/15 text-violet-200' : 'bg-violet-50 text-violet-600',
                        )}>
                          Usl
                        </span>
                      )}
                    </span>
                    <span className={cn(
                      'font-mono text-[11.5px] tabular-nums text-right',
                      nema
                        ? (aktivanRed ? 'text-rose-300' : 'text-rose-500')
                        : malo
                          ? (aktivanRed ? 'text-amber-300' : 'text-amber-600')
                          : (aktivanRed ? 'text-slate-300' : 'text-slate-500'),
                    )}>
                      {p.tip !== 'usluga' && p.stanje != null ? `${p.stanje} ${p.jm || 'kom'}` : ''}
                    </span>
                    <span className={cn(
                      'font-mono text-[13px] font-semibold tabular-nums text-right',
                      aktivanRed ? 'text-white' : nema ? 'text-slate-400' : 'text-slate-900',
                    )}>
                      {formatKM(p.cijena)}
                    </span>
                    <span className="flex justify-end">
                      {aktivanRed && <Key className="ml-0" tone="dark">↵</Key>}
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Legenda prečica — iste tipke na Macu i Windowsu, bez modifikatora */}
      <div className="h-5 flex items-center gap-4 px-1 text-[11px] text-slate-400 select-none">
        <span className="flex items-center gap-1.5"><Key className="ml-0">↑↓</Key> kretanje</span>
        <span className="flex items-center gap-1.5"><Key className="ml-0">↵</Key> {brziSken ? 'dodaj 1 kom' : 'dodaj'}</span>
        <span className="flex items-center gap-1.5"><Key className="ml-0">Esc</Key> očisti pretragu</span>
        <span className="flex items-center gap-1.5"><Key className="ml-0">F2</Key> brzi sken</span>
        <span className="flex items-center gap-1.5"><Key className="ml-0">F3</Key> slobodna stavka</span>
        <span className="flex items-center gap-1.5"><Key className="ml-0">F5</Key> naplati</span>
      </div>
    </div>
  );
}
