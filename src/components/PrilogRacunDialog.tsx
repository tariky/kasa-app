import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Paperclip, Search, X, UserRound, Pencil, AlertCircle, Trash2, Package,
  Banknote, CreditCard, Landmark, ReceiptText, type LucideIcon,
} from 'lucide-react';
import {
  prilogNaziv, sumaPriloga,
  PRILOG_OPIS_DEFAULT, PRILOG_VEZA_DEFAULT, PRILOG_OPIS_MAX, PRILOG_VEZA_MAX,
} from '@/lib/prilog';
import { iznosStavke } from '@/lib/racun';
import { formatKM, cn } from '@/lib/utils';
import type { Kupac, Product } from '@/types';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
type Mode = 'stavke' | 'iznos';

const PAYMENTS: Array<{ tip: PaymentType; Icon: LucideIcon }> = [
  { tip: 'Gotovina', Icon: Banknote },
  { tip: 'Kartica', Icon: CreditCard },
  { tip: 'Virman', Icon: Landmark },
  { tip: 'Ček', Icon: ReceiptText },
];

/** Electron IPC greške dolaze umotane u "Error invoking remote method '…': Error: …". */
function porukaGreske(err: any): string {
  const raw = err?.message || 'Nepoznata greška';
  return raw.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '');
}

interface StavkaRed {
  productId: number;
  naziv: string;
  jm: string;
  sifra: string;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
}

interface PrilogRacunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  korisnikId: number;
  onSuccess: (res: {
    id: number; prilogBroj: number; brojFiskalnogRacuna: string | null;
    /** Broj stavki unesenih odmah na kasi (0 = dodjeljuju se kasnije). */
    brojStavki: number;
  }) => void;
}

/**
 * Fiskalizacija računa po prilogu. Operater bira izvor iznosa: unese stavke
 * odmah (iznos je njihova suma) ili ukuca samo ukupan iznos i stavke dodijeli
 * kasnije u sekciji Računi. Na fiskalni račun u oba slučaja ide jedna zbirna
 * stavka „Stavke po računu br. N".
 */
export default function PrilogRacunDialog({ open, onOpenChange, korisnikId, onSuccess }: PrilogRacunDialogProps) {
  const [mode, setMode] = useState<Mode>('stavke');
  const [stavke, setStavke] = useState<StavkaRed[]>([]);
  const [rucniIznos, setRucniIznos] = useState<number | null>(null);
  // Naziv zbirne stavke se bira po računu — „CNC obrada po fakturi br. 5".
  const [opis, setOpis] = useState(PRILOG_OPIS_DEFAULT);
  const [veza, setVeza] = useState(PRILOG_VEZA_DEFAULT);
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Gotovina');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [kupacSearch, setKupacSearch] = useState('');
  const [allKupci, setAllKupci] = useState<Kupac[]>([]);
  const [manualKupac, setManualKupac] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const iznosRef = useRef<HTMLInputElement>(null);
  const kupacSearchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('stavke'); setStavke([]); setRucniIznos(null); setNacinPlacanja('Gotovina');
    setOpis(PRILOG_OPIS_DEFAULT); setVeza(PRILOG_VEZA_DEFAULT);
    setQuery(''); setResults([]); setFocusedIndex(-1);
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setKupacSearch(''); setManualKupac(false);
    setError(null); setBusy(false);
    window.api.getKupci().then(setAllKupci).catch(() => setAllKupci([]));
  }, [open]);

  // Pretraga proizvoda — isti debounce obrazac kao na kasi. Zbirna stavka je
  // fiskalizovana sa stopom E, pa samo takvi proizvodi smiju u prilog.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); setFocusedIndex(-1); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await window.api.searchProducts(query.trim());
        setResults(found.filter((p: Product) => p.pdvStopa === 'E'));
        setFocusedIndex(-1);
      } catch { setResults([]); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const sumaStavki = useMemo(
    () => sumaPriloga(stavke.map(s => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, pdvStopa: s.pdvStopa }))),
    [stavke],
  );
  const iznos = mode === 'stavke' ? sumaStavki : (rucniIznos ?? 0);
  // Broj se ne kuca na isječak — faktura ga dobija iz BF broja nakon štampe.
  const nazivStavke = useMemo(() => prilogNaziv(null, opis, veza), [opis, veza]);

  const addProduct = useCallback((p: Product) => {
    setStavke(prev => {
      const existing = prev.find(s => s.productId === p.id);
      if (existing) return prev.map(s => s.productId === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      return [...prev, {
        productId: p.id, naziv: p.naziv, jm: p.jm || 'kom', sifra: p.sifra,
        kolicina: 1, cijena: p.cijena, pdvStopa: p.pdvStopa,
      }];
    });
    setQuery(''); setResults([]); setFocusedIndex(-1);
    searchRef.current?.focus();
  }, []);

  const updateStavka = (productId: number, patch: Partial<StavkaRed>) =>
    setStavke(prev => prev.map(s => s.productId === productId ? { ...s, ...patch } : s));
  /** Strelice u polju količine: ±1, sa Shiftom ±10. Ne ide ispod 1. */
  const nudgeKolicina = (s: StavkaRed, delta: number) => {
    const next = Math.max(1, Math.round((s.kolicina + delta) * 1000) / 1000);
    updateStavka(s.productId, { kolicina: next });
  };

  const removeStavka = (productId: number) => {
    setStavke(prev => prev.filter(s => s.productId !== productId));
    searchRef.current?.focus();
  };

  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const next = e.key === 'ArrowDown'
        ? (focusedIndex < results.length - 1 ? focusedIndex + 1 : 0)
        : (focusedIndex > 0 ? focusedIndex - 1 : results.length - 1);
      setFocusedIndex(next);
      (resultsRef.current?.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery(''); setResults([]); setFocusedIndex(-1);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (focusedIndex >= 0 && focusedIndex < results.length) { addProduct(results[focusedIndex]); return; }
    const q = query.trim();
    if (!q) return;
    // Bez izbora strelicama: tačan pogodak šifre/barkoda, pa jedini rezultat.
    const exact = results.find(p => p.sifra === q || p.barkod === q);
    if (exact) addProduct(exact);
    else if (results.length === 1) addProduct(results[0]);
  };

  const q = kupacSearch.trim().toLowerCase();
  const filteredKupci = useMemo(() => {
    if (!q) return allKupci;
    return allKupci.filter(k =>
      k.naziv.toLowerCase().includes(q)
      || k.idBroj.includes(q)
      || (k.grad ?? '').toLowerCase().includes(q));
  }, [allKupci, q]);

  const kupacOdabran = kupacIdBroj.trim().length > 0 || kupacNaziv.trim().length > 0;

  const selectKupac = (k: Kupac) => {
    setKupacNaziv(k.naziv);
    setKupacIdBroj(k.idBroj);
    setKupacAdresa(k.adresa ?? '');
    setKupacGrad(k.grad ?? '');
    setKupacPostanskiBroj(k.postanskiBroj ?? '');
    setKupacSearch('');
    setManualKupac(false);
    setError(null);
  };

  const clearKupac = () => {
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setManualKupac(false); setKupacSearch('');
    requestAnimationFrame(() => kupacSearchRef.current?.focus());
  };

  const virmanBezKupca = nacinPlacanja === 'Virman' && !kupacIdBroj.trim();
  const spreman = iznos > 0 && !virmanBezKupca && !busy;

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    requestAnimationFrame(() => {
      if (next === 'stavke') searchRef.current?.focus();
      else iznosRef.current?.focus();
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    setError(null);
    if (!(iznos > 0)) {
      setError(mode === 'stavke' ? 'Dodajte najmanje jednu stavku.' : 'Unesite iznos veći od 0.');
      return;
    }
    // Virman ide na žiro račun — bez kupca na računu nema ko da uplati.
    if (virmanBezKupca) {
      setError('Za virman je obavezan kupac — odaberite ga ili unesite ID broj.');
      return;
    }
    if (mode === 'stavke' && stavke.some(s => !(s.kolicina > 0))) {
      setError('Svaka stavka mora imati količinu veću od 0.');
      return;
    }

    setBusy(true);
    try {
      const res = await window.api.finalizePrilogOrder({
        korisnikId,
        nacinPlacanja,
        ...(mode === 'stavke'
          ? { stavke: stavke.map(s => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, pdvStopa: s.pdvStopa })) }
          : { iznos }),
        prilogOpis: opis.trim(),
        prilogVeza: veza.trim(),
        kupac: kupacIdBroj.trim() ? {
          naziv: kupacNaziv.trim(), idBroj: kupacIdBroj.trim(), adresa: kupacAdresa.trim(),
          grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim(),
        } : undefined,
      });

      if (res?.success) {
        onSuccess({
          id: res.id!,
          prilogBroj: res.prilogBroj!,
          brojFiskalnogRacuna: res.brojFiskalnogRacuna ?? null,
          brojStavki: mode === 'stavke' ? stavke.length : 0,
        });
        onOpenChange(false);
      } else {
        const details = res?.odgovori ? Object.entries(res.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setError(`${res?.error || 'Štampa nije uspjela'}${details ? ` (${details})` : ''}`);
      }
    } catch (err: any) {
      setError(porukaGreske(err));
    } finally {
      setBusy(false);
    }
  }, [iznos, mode, virmanBezKupca, stavke, korisnikId, nacinPlacanja, opis, veza,
      kupacIdBroj, kupacNaziv, kupacAdresa, kupacGrad, kupacPostanskiBroj, onSuccess, onOpenChange]);

  // F2 mijenja izvor iznosa, F5 fiskalizuje — isti raspored kao na kasi.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); switchMode(mode === 'stavke' ? 'iznos' : 'stavke'); }
      if (e.key === 'F5') { e.preventDefault(); if (spreman) handleConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, spreman, switchMode, handleConfirm]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1180px] flex-col gap-0 overflow-hidden rounded-2xl p-0">
        {/* ── Zaglavlje sa prekidačem izvora iznosa ── */}
        <div className="flex items-end justify-between gap-6 border-b border-slate-100 px-6 pb-0 pt-5">
          <DialogHeader className="pb-4">
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <Paperclip className="h-4 w-4 text-slate-400" />
              Račun po prilogu
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-sm text-slate-500">
              Na fiskalni račun ide jedna zbirna stavka — „{nazivStavke}".
              Faktura dobija broj fiskalnog računa.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-1" role="tablist">
            {([['stavke', 'Stavke'], ['iznos', 'Ručni iznos']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={cn(
                  'relative -mb-px px-4 pb-3 pt-2 text-[13px] transition-colors',
                  'border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                  mode === m
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── Radna površina ── */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {mode === 'stavke' ? (
              <>
                <div className="px-6 pb-3 pt-5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      ref={searchRef}
                      autoFocus
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Pretraži šifru, barkod ili naziv artikla..."
                      className="h-11 rounded-xl pl-9 text-sm"
                    />
                  </div>

                  {results.length > 0 && (
                    <div
                      ref={resultsRef}
                      className="mt-1.5 max-h-56 overflow-auto rounded-xl border border-slate-100 bg-white shadow-sm"
                    >
                      {results.map((p, i) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addProduct(p)}
                          onMouseEnter={() => setFocusedIndex(i)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 border-b border-slate-50 px-4 py-2.5 text-left last:border-b-0',
                            focusedIndex === i ? 'bg-blue-50' : 'hover:bg-slate-50',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-slate-800">{p.naziv}</span>
                            <span className="block truncate font-mono text-[11px] text-slate-400">
                              {p.sifra}{p.jm ? ` · ${p.jm}` : ''}
                              {p.stanje != null ? ` · stanje ${p.stanje}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-slate-600">
                            {formatKM(p.cijena)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Stavke */}
                <div className="min-h-0 flex-1 px-6 pb-2">
                  {stavke.length === 0 ? (
                    <div className="flex h-full select-none flex-col items-center justify-center text-slate-300">
                      <Package className="mb-3 h-8 w-8" />
                      <p className="text-[13px] text-slate-400">Nema unesenih stavki</p>
                      <p className="mt-1 text-[12px] text-slate-300">Pretražite artikal i pritisnite Enter</p>
                    </div>
                  ) : (
                    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-100">
                      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[10.5px] font-medium uppercase tracking-wider text-slate-400">
                        <span className="flex-1">Artikal</span>
                        <span className="w-24 text-center">Količina</span>
                        <span className="w-28 text-center">Cijena</span>
                        <span className="w-28 text-right">Iznos</span>
                        <span className="w-8" />
                      </div>
                      <ScrollArea className="flex-1">
                        {stavke.map(s => (
                          <div
                            key={s.productId}
                            className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 last:border-b-0"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-slate-800">{s.naziv}</p>
                              <p className="truncate font-mono text-[11px] text-slate-400">{s.sifra} · {s.jm}</p>
                            </div>
                            <DecimalInput
                              value={s.kolicina}
                              maxDecimals={3}
                              aria-label={`Količina — ${s.naziv}`}
                              onValueChange={(_, n) => updateStavka(s.productId, { kolicina: isNaN(n) ? 0 : n })}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); return; }
                                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  const step = e.shiftKey ? 10 : 1;
                                  nudgeKolicina(s, e.key === 'ArrowUp' ? step : -step);
                                }
                              }}
                              className={cn(
                                'h-9 w-24 rounded-lg text-center font-mono text-sm tabular-nums',
                                !(s.kolicina > 0) && 'border-amber-300 bg-amber-50',
                              )}
                            />
                            <DecimalInput
                              value={s.cijena}
                              aria-label={`Cijena — ${s.naziv}`}
                              onValueChange={(_, n) => updateStavka(s.productId, { cijena: isNaN(n) ? 0 : n })}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); } }}
                              className="h-9 w-28 rounded-lg text-right font-mono text-sm tabular-nums"
                            />
                            <span className="w-28 text-right font-mono text-[13px] font-semibold tabular-nums text-slate-800">
                              {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: 0, pdvStopa: s.pdvStopa }))}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeStavka(s.productId)}
                              aria-label={`Ukloni ${s.naziv}`}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                  )}
                </div>

                <div className="px-6 pb-4 pt-2 text-[11px] text-slate-400">
                  <kbd className="font-sans font-medium text-slate-500">↑↓</kbd> izbor ·{' '}
                  <kbd className="font-sans font-medium text-slate-500">Enter</kbd> dodaj ·{' '}
                  <kbd className="font-sans font-medium text-slate-500">↑↓</kbd> u količini ±1{' '}
                  (<kbd className="font-sans font-medium text-slate-500">Shift</kbd> ±10) ·{' '}
                  <kbd className="font-sans font-medium text-slate-500">F2</kbd> ručni iznos ·{' '}
                  <kbd className="font-sans font-medium text-slate-500">F5</kbd> fiskalizuj
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-10 text-center">
                <Paperclip className="mb-4 h-8 w-8 text-slate-200" />
                <p className="max-w-sm text-[13px] leading-relaxed text-slate-500">
                  Iznos kucate desno. Stavke dodijelite kasnije u sekciji Računi — prilog se štampa tek
                  kad njihova suma padne tačno na fiskalni iznos.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-5 rounded-lg"
                  onClick={() => switchMode('stavke')}
                >
                  Unesi stavke odmah
                  <span className="ml-2 text-[11px] text-slate-400">F2</span>
                </Button>
              </div>
            )}
          </div>

          {/* ── Račun ── */}
          <div className="flex w-[380px] shrink-0 flex-col border-l border-slate-100 bg-slate-50/40">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
              {/* Displej iznosa */}
              <label className={cn(
                'block rounded-xl bg-slate-900 px-5 py-4 ring-2 ring-transparent transition-shadow',
                mode === 'iznos' ? 'cursor-text focus-within:ring-blue-500/60' : 'cursor-default',
              )}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {mode === 'stavke' ? 'Suma stavki' : 'Iznos'}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">KM</span>
                </div>
                {mode === 'iznos' ? (
                  <DecimalInput
                    ref={iznosRef}
                    value={rucniIznos ?? ''}
                    onValueChange={(_, n) => setRucniIznos(isNaN(n) ? null : n)}
                    placeholder="0,00"
                    className={cn(
                      'h-auto rounded-none border-0 bg-transparent px-0 py-0 shadow-none',
                      'outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                      'text-right font-mono text-[40px] font-semibold leading-tight tabular-nums',
                      'text-white caret-blue-400 placeholder:text-slate-700',
                    )}
                  />
                ) : (
                  <p className={cn(
                    'text-right font-mono text-[40px] font-semibold leading-tight tabular-nums',
                    sumaStavki > 0 ? 'text-white' : 'text-slate-700',
                  )}>
                    {sumaStavki.toFixed(2).replace('.', ',')}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 border-t border-dashed border-slate-700 pt-2.5">
                  <Paperclip className="h-3 w-3 shrink-0 text-slate-500" />
                  <span className="truncate text-[11.5px] text-slate-400">
                    {mode === 'stavke' && stavke.length > 0
                      ? `${stavke.length} ${stavke.length === 1 ? 'stavka' : stavke.length < 5 ? 'stavke' : 'stavki'} na prilogu`
                      : nazivStavke}
                  </span>
                </div>
              </label>

              {/* Naziv zbirne stavke — ono što stvarno piše na fiskalnom računu */}
              <div className="pt-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Naziv zbirne stavke</p>
                <div className="mt-1.5 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1.5">
                  <Input
                    value={opis}
                    onChange={e => setOpis(e.target.value)}
                    placeholder={PRILOG_OPIS_DEFAULT}
                    maxLength={PRILOG_OPIS_MAX}
                    aria-label="Naziv zbirne stavke"
                    className="h-8 min-w-0 flex-1 rounded-lg border-0 px-2 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-blue-500/50"
                  />
                  <span className="shrink-0 text-[12px] text-slate-400">po</span>
                  <Input
                    value={veza}
                    onChange={e => setVeza(e.target.value)}
                    placeholder={PRILOG_VEZA_DEFAULT}
                    maxLength={PRILOG_VEZA_MAX}
                    aria-label="Veza u nazivu zbirne stavke"
                    className="h-8 w-[86px] shrink-0 rounded-lg border-0 px-2 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-blue-500/50"
                  />
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-400">
                  {`Na računu: „${nazivStavke}"`}
                </p>
              </div>

              {/* Način plaćanja */}
              <div className="pt-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Način plaćanja</p>
                <div
                  className="mt-1.5 flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
                  role="radiogroup"
                  aria-label="Način plaćanja"
                  onKeyDown={e => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                    e.preventDefault();
                    const i = PAYMENTS.findIndex(p => p.tip === nacinPlacanja);
                    const next = e.key === 'ArrowRight'
                      ? (i + 1) % PAYMENTS.length
                      : (i - 1 + PAYMENTS.length) % PAYMENTS.length;
                    setNacinPlacanja(PAYMENTS[next].tip);
                    (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
                  }}
                >
                  {PAYMENTS.map(({ tip, Icon }) => {
                    const aktivan = nacinPlacanja === tip;
                    return (
                      <button
                        key={tip}
                        type="button"
                        role="radio"
                        aria-checked={aktivan}
                        onClick={() => setNacinPlacanja(tip)}
                        className={cn(
                          'flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                          aktivan
                            ? 'bg-slate-900 font-medium text-white'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                        )}
                      >
                        <Icon className={cn('h-4 w-4', aktivan ? 'text-white' : 'text-slate-400')} />
                        {tip}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Kupac */}
              <div className="pb-5 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Kupac</p>
                  <span className={cn(
                    'text-[11px]',
                    nacinPlacanja === 'Virman' ? 'font-medium text-amber-600' : 'text-slate-400',
                  )}>
                    {nacinPlacanja === 'Virman' ? 'obavezno za virman' : 'opcionalno'}
                  </span>
                </div>

                {kupacOdabran && !manualKupac ? (
                  <div className="mt-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-slate-800">
                          {kupacNaziv || 'Bez naziva'}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{kupacIdBroj}</span>
                      </div>
                      {(kupacAdresa || kupacGrad) && (
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {[kupacAdresa, [kupacPostanskiBroj, kupacGrad].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                        </p>
                      )}
                      <div className="mt-1.5 flex gap-3">
                        <button
                          type="button"
                          onClick={() => setManualKupac(true)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-700"
                        >
                          <Pencil className="h-3 w-3" /> Uredi podatke
                        </button>
                        <button
                          type="button"
                          onClick={clearKupac}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-red-500"
                        >
                          <X className="h-3 w-3" /> Ukloni
                        </button>
                      </div>
                    </div>
                  </div>
                ) : manualKupac ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="JIB (13 cifara)" value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} className="h-9 rounded-lg font-mono text-sm" maxLength={13} />
                      <Input placeholder="Naziv" value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} className="h-9 rounded-lg text-sm" maxLength={32} />
                    </div>
                    <Input placeholder="Adresa" value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} className="h-9 rounded-lg text-sm" maxLength={32} />
                    <div className="flex gap-2">
                      <Input placeholder="Poš. br." value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} className="h-9 w-24 rounded-lg font-mono text-sm" maxLength={5} />
                      <Input placeholder="Grad" value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} className="h-9 flex-1 rounded-lg text-sm" maxLength={26} />
                    </div>
                    <button
                      type="button"
                      onClick={() => { setManualKupac(false); if (!kupacOdabran) requestAnimationFrame(() => kupacSearchRef.current?.focus()); }}
                      className="text-[11px] text-slate-400 transition-colors hover:text-slate-600"
                    >
                      Nazad na pretragu
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        ref={kupacSearchRef}
                        placeholder="Pretraži po nazivu, JIB-u ili gradu..."
                        value={kupacSearch}
                        onChange={e => setKupacSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && filteredKupci.length > 0) {
                            e.preventDefault();
                            selectKupac(filteredKupci[0]);
                          }
                        }}
                        className="h-10 rounded-xl bg-white pl-9 pr-9 text-sm"
                      />
                      {kupacSearch && (
                        <button
                          type="button"
                          onClick={() => setKupacSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                          aria-label="Očisti pretragu kupaca"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <ScrollArea className="h-40">
                        {filteredKupci.length === 0 ? (
                          <div className="flex h-40 select-none flex-col items-center justify-center text-slate-400">
                            <UserRound className="mb-2 h-6 w-6 text-slate-200" />
                            <p className="text-[13px]">
                              {allKupci.length === 0 ? 'Nema sačuvanih kupaca' : 'Nema rezultata'}
                            </p>
                          </div>
                        ) : (
                          filteredKupci.map(k => (
                            <button
                              key={k.id}
                              type="button"
                              className="w-full border-b border-slate-50 px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-slate-50"
                              onClick={() => selectKupac(k)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[13px] font-medium text-slate-800">{k.naziv}</span>
                                <span className="shrink-0 font-mono text-[11px] text-slate-400">{k.idBroj}</span>
                              </div>
                              {(k.adresa || k.grad) && (
                                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                  {[k.adresa, k.grad].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </button>
                          ))
                        )}
                      </ScrollArea>
                    </div>

                    <button
                      type="button"
                      onClick={() => setManualKupac(true)}
                      className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-slate-500 transition-colors hover:text-slate-700"
                    >
                      <Pencil className="h-3 w-3" /> Unesi kupca ručno
                    </button>
                  </>
                )}

                {error && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 bg-white px-5 py-4">
              <Button
                className="h-11 w-full rounded-xl text-[14px]"
                onClick={handleConfirm}
                disabled={!spreman}
              >
                {busy ? 'Štampam...' : `Fiskalizuj${iznos > 0 ? ` ${formatKM(iznos)}` : ''}`}
              </Button>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Esc za zatvaranje</span>
                <Button variant="ghost" size="sm" className="h-7 rounded-lg text-[12px]" onClick={() => onOpenChange(false)} disabled={busy}>
                  Otkaži
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
