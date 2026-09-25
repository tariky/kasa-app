import { useEffect, useRef } from 'react';
import { Minus, Plus, X, ScanBarcode } from 'lucide-react';
import { Key } from '@/components/ui/ledger';
import { cn, formatKM } from '@/lib/utils';
import { iznosStavke } from '@/lib/racun';
import type { CartItem } from '@/types';

const fmtKol = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** Redni broj · artikal · količina · cijena · rabat · iznos · ukloni — isti raspored u zaglavlju i redovima. */
const KOLONE = 'grid grid-cols-[2rem_minmax(0,1fr)_7.5rem_6rem_4.5rem_7rem_2rem] items-center gap-x-3 pl-5 pr-3';

interface Props {
  cart: CartItem[];
  /** Id zadnje dodane stavke i brojač dodavanja — isti artikal dvaput zaredom opet bljesne. */
  zadnje: { id: number; n: number } | null;
  allowZeroStock: boolean;
  onKolicina: (productId: number, delta: number) => void;
  onUrediKolicinu: (item: CartItem) => void;
  onRabat: (productId: number) => void;
  onUkloni: (productId: number) => void;
}

/**
 * Stavke računa ispod pretrage — redoslijed dodavanja je redoslijed na isječku.
 * Zadnje dodana stavka kratko zasvijetli i skroluje se u vidik.
 */
export default function StavkeRacuna({ cart, zadnje, allowZeroStock, onKolicina, onUrediKolicinu, onRabat, onUkloni }: Props) {
  const redovi = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (zadnje) redovi.current.get(zadnje.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [zadnje]);

  if (cart.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center select-none">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-dashed border-slate-300 text-slate-300">
          <ScanBarcode className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-[14px] font-medium text-slate-600">Račun je prazan</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">
          Skenirajte barkod ili počnite kucati naziv, bilo gdje na ekranu.
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-slate-400">
          Više komada odjednom: <Key className="ml-0">3*</Key> ispred naziva
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn(KOLONE, 'h-9 flex-shrink-0 border-b border-slate-200/80 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 select-none')}>
        <span>#</span>
        <span>Artikal</span>
        <span className="text-center">Količina</span>
        <span className="text-right">Cijena</span>
        <span className="text-right">Rabat</span>
        <span className="text-right">Iznos</span>
        <span />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="list" aria-label="Stavke računa">
        {cart.map((item, idx) => {
          const p = item.product;
          const iznos = iznosStavke({ cijena: p.cijena, kolicina: item.kolicina, rabat: item.rabat, pdvStopa: p.pdvStopa });
          const puno = !allowZeroStock && p.tip !== 'usluga' && item.kolicina >= (p.stanje ?? 0);
          const svjez = zadnje?.id === p.id;
          return (
            <div
              key={p.id}
              role="listitem"
              ref={el => { if (el) redovi.current.set(p.id, el); else redovi.current.delete(p.id); }}
              className={cn(KOLONE, 'group relative min-h-[52px] border-b border-slate-100 py-1.5 transition-colors hover:bg-slate-50/70')}
            >
              {svjez && <span key={zadnje.n} aria-hidden className="kasa-red-bljesak pointer-events-none absolute inset-0 bg-blue-100/70" />}
              <span className="relative font-mono text-[11.5px] tabular-nums text-slate-400">{idx + 1}</span>
              <span className="relative min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-slate-800" title={p.naziv}>{p.naziv}</span>
                  {p.tip === 'usluga' && <span className="flex-shrink-0 rounded bg-violet-50 px-1.5 text-[10.5px] font-medium text-violet-600">usluga</span>}
                </span>
                <span className="mt-px block truncate font-mono text-[11px] text-slate-400">
                  {p.slobodan ? 'slobodna stavka' : p.sifra}
                  {p.tip !== 'usluga' && !p.slobodan && p.stanje != null && (
                    <span className={cn('ml-2', puno ? 'text-amber-600' : 'text-slate-300')}>stanje {fmtKol(p.stanje)} {p.jm}</span>
                  )}
                </span>
              </span>

              <span className="relative flex items-center justify-center">
                <span className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button" onClick={() => onKolicina(p.id, -1)}
                    aria-label={`Manje: ${p.naziv}`}
                    className="grid h-full w-7 place-items-center rounded-l-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    type="button" onClick={() => onUrediKolicinu(item)}
                    title="Upiši količinu"
                    className="h-full min-w-[2.75rem] border-x border-slate-200 px-1.5 font-mono text-[13px] font-semibold tabular-nums text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    {fmtKol(item.kolicina)}
                  </button>
                  <button
                    type="button" onClick={() => onKolicina(p.id, 1)} disabled={puno}
                    aria-label={`Više: ${p.naziv}`}
                    title={puno ? 'Nema više na stanju' : undefined}
                    className="grid h-full w-7 place-items-center rounded-r-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </span>
              </span>

              <span className="relative text-right font-mono text-[12.5px] tabular-nums text-slate-500">
                {formatKM(p.cijena).replace(' KM', '')}
                <span className="block text-[10.5px] text-slate-300">/{p.jm || 'kom'}</span>
              </span>

              <span className="relative flex justify-end">
                <button
                  type="button" onClick={() => onRabat(p.id)}
                  title="Rabat na stavku"
                  className={cn(
                    'h-7 rounded-md px-2 font-mono text-[12px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                    item.rabat > 0
                      ? 'bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100'
                      : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600',
                  )}
                >
                  {item.rabat > 0 ? `−${fmtKol(item.rabat)}%` : '0%'}
                </button>
              </span>

              <span className="relative text-right font-mono text-[14px] font-semibold tabular-nums text-slate-900">
                {formatKM(iznos).replace(' KM', '')}
              </span>

              <span className="relative flex justify-end">
                <button
                  type="button" onClick={() => onUkloni(p.id)}
                  aria-label={`Ukloni: ${p.naziv}`}
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-300 opacity-60 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
