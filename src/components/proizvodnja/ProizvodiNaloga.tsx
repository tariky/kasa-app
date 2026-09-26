// src/components/proizvodnja/ProizvodiNaloga.tsx
import type { ProizvodPonude, RadniNalogProizvod } from '@/types';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/ui/ledger';
import { AlertTriangle, Check } from 'lucide-react';

const broj = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');

/**
 * Izbor stavki ponude koje nalog izrađuje. Označene pri završetku naloga ulaze na
 * stanje; neoznačene su roba sa zalihe — prodaja po ponudi skida i jedne i druge.
 */
export function ProizvodiNaloga({ linije, oznacene, onToggle, zakljucano, className, neuskladjeni = [], onUkloniNeuskladjene }: {
  linije: ProizvodPonude[]; oznacene: Set<number>; onToggle: (ponudaStavkaId: number) => void;
  zakljucano?: boolean; className?: string;
  /** Spremljeni proizvodi bez odgovarajuće stavke na ponudi (ponuda mijenjana nakon izbora). */
  neuskladjeni?: RadniNalogProizvod[];
  onUkloniNeuskladjene?: () => void;
}) {
  return (
    <section aria-label="Proizvodi naloga" className={cn('space-y-2', className)}>
      <div className="flex items-baseline gap-2">
        <Eyebrow>Izrađuje se</Eyebrow>
        <span className="text-[11px] text-slate-400">označeno ulazi na stanje pri završetku, ostalo se prodaje sa zalihe</span>
      </div>
      {linije.length > 0 && <ul className="rounded-xl border border-slate-200/80 divide-y divide-slate-100">
        {linije.map(l => {
          const on = oznacene.has(l.ponudaStavkaId);
          const fali = l.stanje < l.kolicina;
          return (
            <li key={l.ponudaStavkaId}>
              <label className={cn('flex items-center gap-3 px-3 py-2', zakljucano ? 'cursor-default' : 'cursor-pointer hover:bg-slate-50')}>
                <input type="checkbox" className="sr-only peer" checked={on} disabled={zakljucano}
                  onChange={() => onToggle(l.ponudaStavkaId)} aria-label={`Izrađuje se: ${l.naziv}`} />
                <span aria-hidden className={cn(
                  'grid h-4 w-4 flex-shrink-0 place-items-center rounded border transition-colors',
                  'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/50',
                  on ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-300',
                  zakljucano && 'opacity-60',
                )}>{on && <Check size={11} strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-slate-800">{l.naziv}</span>
                  {l.sifra && <span className="block font-mono text-[10.5px] text-slate-400">{l.sifra}</span>}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-slate-700 whitespace-nowrap">× {broj(l.kolicina)} {l.jm}</span>
                <span className={cn('w-[110px] text-right text-[11px] tabular-nums whitespace-nowrap', fali ? 'text-amber-600' : 'text-slate-400')}>
                  na stanju {broj(l.stanje)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>}
      {neuskladjeni.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-800">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle size={13} className="mt-[2px] flex-shrink-0" />
            Ponuda je mijenjana nakon izbora — ovi proizvodi su spremljeni na nalogu, a na ponudi ih više nema u toj količini:
          </p>
          <ul className="mt-1.5 ml-5 space-y-0.5">
            {neuskladjeni.map(p => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="font-medium">{p.productNaziv ?? `#${p.productId}`}</span>
                <span className="font-mono tabular-nums">× {broj(p.kolicina)} {p.productJm ?? ''}</span>
              </li>
            ))}
          </ul>
          {!zakljucano && (
            <div className="mt-2 ml-5 flex items-center gap-3">
              <span className="text-[11.5px] text-amber-700">Nalog se ne može završiti dok se izbor ne uskladi. Označite stavke iznad ili</span>
              {onUkloniNeuskladjene && (
                <button type="button" onClick={onUkloniNeuskladjene}
                  className="h-7 rounded-md border border-amber-300 bg-white px-2.5 text-[12px] font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60">
                  Ukloni ih iz izbora
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
