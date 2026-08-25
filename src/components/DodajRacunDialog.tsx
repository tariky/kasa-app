import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Trash2, Search, Banknote, CreditCard, Landmark, FileCheck,
  ChevronRight, Building2, AlertTriangle, PackageOpen, CornerDownLeft, X,
} from 'lucide-react';
import { Kupac, Product } from '@/types';
import { izracunajTotale, iznosStavke } from '@/lib/racun';
import { cn, formatKM } from '@/lib/utils';

interface StavkaUnos {
  product: Product;
  kolicina: number;
  rabat: number;
  cijena: number;
}

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

const PAYMENTS: { id: PaymentType; icon: typeof Banknote }[] = [
  { id: 'Gotovina', icon: Banknote },
  { id: 'Kartica', icon: CreditCard },
  { id: 'Virman', icon: Landmark },
  { id: 'Ček', icon: FileCheck },
];

/** Kolone reda stavke — isti raster za zaglavlje i za redove. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_74px_96px_74px_100px_30px] gap-2 items-center';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  korisnikId: number;
  onSaved: () => void;
  prefillBroj?: string;
}

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400', className)}>
      {children}
    </span>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded border border-slate-200 bg-white px-[3px] font-mono text-[9px] font-semibold leading-none text-slate-400">
      {children}
    </kbd>
  );
}

function ComboHint({ verb }: { verb: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
      <Key>↑</Key><Key>↓</Key> izbor <Key>↵</Key> {verb}
    </span>
  );
}

interface ComboProps<T> {
  items: T[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  onPick: (item: T) => void;
  refs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
}

/** Strelice biraju, Enter potvrđuje. Escape hvata onEscapeKeyDown na dijalogu. */
function comboKeyHandler<T>({ items, activeIdx, setActiveIdx, onPick, refs }: ComboProps<T>) {
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Ctrl+Enter je prečica za snimanje — ne smije usput odabrati i stavku.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (items.length === 0) return;
    const last = items.length - 1;
    const go = (i: number) => {
      e.preventDefault();
      const next = Math.max(0, Math.min(last, i));
      setActiveIdx(next);
      refs.current[next]?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      case 'ArrowDown': return go(activeIdx + 1);
      case 'ArrowUp': return go(activeIdx - 1);
      case 'Home': return go(0);
      case 'End': return go(last);
      case 'Enter':
        e.preventDefault();
        onPick(items[activeIdx]);
        return;
      default:
    }
  };
}

/** Rezultati stoje u toku, ne apsolutno — apsolutni sloj bi ScrollArea odsjekla. */
function ComboList<T>({ items, activeIdx, setActiveIdx, onPick, refs, render }: ComboProps<T> & {
  render: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      {items.map((item, i) => (
        <button
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="button"
          onMouseEnter={() => setActiveIdx(i)}
          onClick={() => onPick(item)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
            i === activeIdx ? 'bg-blue-50' : 'hover:bg-slate-50',
          )}
        >
          {render(item)}
        </button>
      ))}
    </div>
  );
}

export default function DodajRacunDialog({ open, onOpenChange, korisnikId, onSaved, prefillBroj }: Props) {
  const [brojFiskalnog, setBrojFiskalnog] = useState('');
  const [datum, setDatum] = useState(nowLocalInput());
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Gotovina');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stavke, setStavke] = useState<StavkaUnos[]>([]);
  const [kupacOpen, setKupacOpen] = useState(false);
  const [kupacQuery, setKupacQuery] = useState('');
  const [kupacResults, setKupacResults] = useState<Kupac[]>([]);
  const [kupacActiveIdx, setKupacActiveIdx] = useState(0);
  const [kupacIzSifarnika, setKupacIzSifarnika] = useState(false);
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const kupacRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (open && prefillBroj) setBrojFiskalnog(prefillBroj);
  }, [open, prefillBroj]);

  const { ukupno, pdvIznos } = useMemo(
    () => izracunajTotale(stavke.map(s => ({
      cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
    }))),
    [stavke]
  );

  const search = async (q: string) => {
    setQuery(q);
    setActiveIdx(0);
    if (!q.trim()) { setResults([]); return; }
    const found = await window.api.searchProducts(q);
    setResults(found);
  };

  const addProduct = (p: Product) => {
    setStavke(prev => {
      const existing = prev.find(s => s.product.id === p.id);
      if (existing) return prev.map(s => s.product.id === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      return [...prev, { product: p, kolicina: 1, rabat: 0, cijena: p.cijena }];
    });
    setQuery(''); setResults([]); setActiveIdx(0);
  };

  const updateStavka = (id: number, patch: Partial<StavkaUnos>) => {
    setStavke(prev => prev.map(s => s.product.id === id ? { ...s, ...patch } : s));
  };
  const removeStavka = (id: number) => setStavke(prev => prev.filter(s => s.product.id !== id));

  const searchKupac = async (q: string) => {
    setKupacQuery(q);
    setKupacActiveIdx(0);
    if (!q.trim()) { setKupacResults([]); return; }
    const found = await window.api.searchKupci(q);
    setKupacResults(found as Kupac[]);
  };

  const pickKupac = (k: Kupac) => {
    setKupacIdBroj(k.idBroj || '');
    setKupacNaziv(k.naziv || '');
    setKupacAdresa(k.adresa || '');
    setKupacGrad(k.grad || '');
    setKupacPostanskiBroj(k.postanskiBroj || '');
    setKupacIzSifarnika(true);
    setKupacQuery(''); setKupacResults([]); setKupacActiveIdx(0);
  };

  const clearKupac = () => {
    setKupacIdBroj(''); setKupacNaziv(''); setKupacAdresa('');
    setKupacGrad(''); setKupacPostanskiBroj('');
    setKupacIzSifarnika(false);
    setKupacQuery(''); setKupacResults([]); setKupacActiveIdx(0);
  };

  const reset = () => {
    setBrojFiskalnog(''); setDatum(nowLocalInput()); setNacinPlacanja('Gotovina');
    setQuery(''); setResults([]); setActiveIdx(0); setStavke([]);
    setKupacOpen(false);
    setKupacQuery(''); setKupacResults([]); setKupacActiveIdx(0); setKupacIzSifarnika(false);
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setError('');
  };

  const handleSave = async () => {
    setError('');
    if (!brojFiskalnog.trim()) { setError('Unesi fiskalni broj računa'); return; }
    if (stavke.length === 0) { setError('Dodaj bar jednu stavku'); return; }
    if (!datum) { setError('Unesi datum i vrijeme računa'); return; }

    const createdAt = datum.replace('T', ' ') + ':00';
    const kupac = kupacIdBroj.trim()
      ? { idBroj: kupacIdBroj.trim(), naziv: kupacNaziv.trim(), adresa: kupacAdresa.trim(), grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim() }
      : undefined;

    setLoading(true);
    try {
      await window.api.createManualOrder({
        korisnikId, ukupno, pdvIznos, nacinPlacanja,
        brojFiskalnogRacuna: brojFiskalnog.trim(), createdAt, kupac,
        stavke: stavke.map(s => ({
          productId: s.product.id, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
        })),
      });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  };

  const kupacPopunjen = Boolean(kupacIdBroj.trim() || kupacNaziv.trim());

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent
        className="max-w-3xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
        onEscapeKeyDown={(e) => {
          // Prvi Escape zatvara otvorenu listu rezultata, tek drugi zatvara dijalog.
          if (results.length > 0 || kupacResults.length > 0) {
            e.preventDefault();
            setResults([]);
            setKupacResults([]);
          }
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        {/* ── Zaglavlje računa ── */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <DialogHeader className="mb-4">
            <Eyebrow>Ručni unos</Eyebrow>
            <DialogTitle className="text-[17px] font-bold tracking-tight text-slate-900 leading-tight">
              Fiskalni račun
            </DialogTitle>
          </DialogHeader>

          {prefillBroj && (
            <div className="flex items-center gap-2 mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
              <p className="text-[11.5px] text-amber-800">
                Popunjavate prazninu u fiskalnom nizu — broj <span className="font-mono font-semibold">#{prefillBroj}</span> nedostaje u bazi.
              </p>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <div className="space-y-1.5">
              <Eyebrow>Fiskalni broj <span className="text-rose-400">*</span></Eyebrow>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[15px] font-semibold text-slate-300 pointer-events-none">#</span>
                <Input
                  autoFocus
                  value={brojFiskalnog}
                  onChange={e => setBrojFiskalnog(e.target.value)}
                  placeholder="1234"
                  className="h-11 pl-7 font-mono text-[16px] font-semibold tracking-tight tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Eyebrow>Datum i vrijeme <span className="text-rose-400">*</span></Eyebrow>
              <DateTimePicker
                value={datum}
                onChange={setDatum}
                className="h-11 text-[13px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Eyebrow className="flex-shrink-0">Plaćanje</Eyebrow>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {PAYMENTS.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setNacinPlacanja(id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[6px] px-2.5 h-7 text-[11.5px] font-medium transition-colors duration-150',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                    nacinPlacanja === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Icon size={13} strokeWidth={1.75} />
                  {id}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Stavke ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-4">

            <div>
              <div className="flex items-center justify-between mb-2">
                <Eyebrow>Stavke</Eyebrow>
                {results.length > 0 && <ComboHint verb="dodaj" />}
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  className="pl-9 h-9 text-[12.5px]"
                  value={query}
                  onChange={e => search(e.target.value)}
                  onKeyDown={comboKeyHandler({
                    items: results, activeIdx, setActiveIdx, onPick: addProduct, refs: resultRefs,
                  })}
                  placeholder="Pretraži šifru, barkod ili naziv artikla…"
                />
              </div>

              <ComboList
                items={results}
                activeIdx={activeIdx}
                setActiveIdx={setActiveIdx}
                onPick={addProduct}
                refs={resultRefs}
                render={(p) => (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium text-slate-700 truncate">{p.naziv}</p>
                      <p className="font-mono text-[10px] text-slate-400 mt-0.5">{p.sifra}</p>
                    </div>
                    <span className="font-mono text-[12px] font-semibold text-slate-700 tabular-nums flex-shrink-0">
                      {formatKM(p.cijena)}
                    </span>
                  </>
                )}
              />
            </div>

            {stavke.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-8 select-none">
                <PackageOpen size={20} className="text-slate-300 mb-2" strokeWidth={1.5} />
                <p className="text-[12.5px] font-medium text-slate-500">Račun je još prazan</p>
                <p className="text-[11.5px] text-slate-400 mt-0.5">Pretražite artikal iznad da ga dodate.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className={cn(GRID, 'bg-slate-50/70 border-b border-slate-200 px-3 py-2')}>
                  <Eyebrow>Artikal</Eyebrow>
                  <Eyebrow className="text-right">Kol.</Eyebrow>
                  <Eyebrow className="text-right">Cijena</Eyebrow>
                  <Eyebrow className="text-right">Rabat</Eyebrow>
                  <Eyebrow className="text-right">Iznos</Eyebrow>
                  <span />
                </div>
                <div className="divide-y divide-slate-100">
                  {stavke.map(s => (
                    <div key={s.product.id} className={cn(GRID, 'px-3 py-2 hover:bg-slate-50/50 transition-colors')}>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-slate-700 truncate">{s.product.naziv}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-400">{s.product.sifra}</span>
                          {s.product.pdvStopa === 'K' && (
                            <span className="inline-flex h-3.5 items-center rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[8.5px] font-bold text-slate-500" title="Oslobođeno PDV-a">
                              K
                            </span>
                          )}
                        </div>
                      </div>
                      <DecimalInput
                        value={s.kolicina} maxDecimals={3}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.product.id, { kolicina: n || 0 })}
                      />
                      <DecimalInput
                        value={s.cijena}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.product.id, { cijena: n || 0 })}
                      />
                      <DecimalInput
                        value={s.rabat}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.product.id, { rabat: Math.min(100, n || 0) })}
                      />
                      <span className="text-right font-mono text-[12.5px] font-semibold text-slate-800 tabular-nums">
                        {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.product.pdvStopa }))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStavka(s.product.id)}
                        title={`Ukloni ${s.product.naziv}`}
                        aria-label={`Ukloni ${s.product.naziv}`}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Kupac (opciono) ── */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setKupacOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                <ChevronRight size={14} className={cn('text-slate-400 transition-transform duration-150', kupacOpen && 'rotate-90')} />
                <Building2 size={14} className="text-slate-400" />
                <span className="text-[12.5px] font-medium text-slate-600">Kupac</span>
                <span className="text-[11px] text-slate-400">opciono</span>
                {!kupacOpen && kupacPopunjen && (
                  <span className="ml-auto text-[11.5px] text-slate-500 truncate max-w-[45%]">
                    {kupacNaziv || '—'}
                    {kupacIdBroj && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{kupacIdBroj}</span>}
                  </span>
                )}
              </button>
              {kupacOpen && (
                <div className="border-t border-slate-100 px-3 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <Eyebrow>Iz šifarnika</Eyebrow>
                    {kupacResults.length > 0 && <ComboHint verb="odaberi" />}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                    <Input
                      className="pl-9 h-9 text-[12.5px]"
                      value={kupacQuery}
                      onChange={e => searchKupac(e.target.value)}
                      onKeyDown={comboKeyHandler({
                        items: kupacResults,
                        activeIdx: kupacActiveIdx,
                        setActiveIdx: setKupacActiveIdx,
                        onPick: pickKupac,
                        refs: kupacRefs,
                      })}
                      placeholder="Pretraži kupca po nazivu, JIB-u ili kontaktu…"
                    />
                  </div>
                  <ComboList
                    items={kupacResults}
                    activeIdx={kupacActiveIdx}
                    setActiveIdx={setKupacActiveIdx}
                    onPick={pickKupac}
                    refs={kupacRefs}
                    render={(k) => (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-medium text-slate-700 truncate">{k.naziv}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                            <span className="font-mono">{k.idBroj}</span>
                            {k.grad && <span className="ml-1.5">{k.grad}</span>}
                          </p>
                        </div>
                      </>
                    )}
                  />

                  {kupacIzSifarnika && (
                    <div className="flex items-center gap-2 mt-2 rounded-lg bg-slate-50 px-3 py-1.5">
                      <Building2 size={12} className="text-slate-400 flex-shrink-0" />
                      <span className="text-[11px] text-slate-500 truncate">
                        Popunjeno iz šifarnika — polja ispod možete izmijeniti.
                      </span>
                      <button
                        type="button"
                        onClick={clearKupac}
                        className="ml-auto flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 rounded"
                      >
                        <X size={11} /> Očisti
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-slate-100">
                    {([
                      ['ID broj', kupacIdBroj, setKupacIdBroj, true],
                      ['Naziv', kupacNaziv, setKupacNaziv, false],
                      ['Adresa', kupacAdresa, setKupacAdresa, false],
                      ['Grad', kupacGrad, setKupacGrad, false],
                      ['Poštanski broj', kupacPostanskiBroj, setKupacPostanskiBroj, true],
                    ] as [string, string, (v: string) => void, boolean][]).map(([label, value, setter, mono]) => (
                      <div key={label} className="space-y-1">
                        <Eyebrow>{label}</Eyebrow>
                        <Input
                          value={value}
                          onChange={e => setter(e.target.value)}
                          className={cn('h-9 text-[12.5px]', mono && 'font-mono tabular-nums')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {kupacOpen && (
                <p className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-[11px] text-slate-400">
                  Kupac se upisuje na račun samo ako je popunjen ID broj.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* ── Total + akcije ── */}
        <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          {error && (
            <div className="flex items-center gap-2 mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-4 text-[11px] text-slate-400">
                <span>Osnovica <span className="ml-1 font-mono tabular-nums text-slate-500">{formatKM(ukupno - pdvIznos)}</span></span>
                <span>PDV <span className="ml-1 font-mono tabular-nums text-slate-500">{formatKM(pdvIznos)}</span></span>
              </div>
              <div className="flex items-baseline gap-2.5 mt-1">
                <Eyebrow>Ukupno</Eyebrow>
                <span className="font-mono text-[24px] font-bold tabular-nums tracking-tight text-slate-900">
                  {formatKM(ukupno)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={loading}>
                Otkaži
              </Button>
              <Button onClick={handleSave} disabled={loading} className="gap-2 min-w-[150px]">
                {loading ? 'Spremam…' : 'Spremi račun'}
                {!loading && (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-white/20 bg-white/10 px-1 py-px font-mono text-[9px] font-semibold text-white/70">
                    ⌃<CornerDownLeft size={9} />
                  </kbd>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
