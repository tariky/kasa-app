import { cn } from '@/lib/utils';

/**
 * Mala izvještajna kartica — labela, broj i opciona napomena.
 * Za brojeve koji se čitaju, ne filtriraju; filter ide u SegmentedFilter s brojačem.
 */
export function Stat({ label, value, note, strong, tone = 'default', className }: {
  label: string;
  value: string;
  note?: string;
  /** Glavni broj u nizu — krupniji i tamniji. */
  strong?: boolean;
  /** Boja broja kad nosi smjer (plus/minus); 'default' ostavlja slate. */
  tone?: 'default' | 'positive' | 'negative';
  className?: string;
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200/70 px-4 py-3 min-w-0', className)}>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 truncate">{label}</span>
      <span className={cn(
        'mt-1 block font-mono tabular-nums tracking-tight leading-none truncate',
        strong ? 'text-[18px] font-bold' : 'text-[16px] font-semibold',
        tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-rose-600' : strong ? 'text-slate-900' : 'text-slate-700',
      )}>
        {value}
        {note && <span className="ml-1.5 text-[11px] font-normal tracking-normal text-slate-400">{note}</span>}
      </span>
    </div>
  );
}
