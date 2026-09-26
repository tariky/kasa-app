import { Banknote, Building, CreditCard, FileCheck, type LucideIcon } from 'lucide-react';
import { Key } from '@/components/ui/ledger';
import { cn } from '@/lib/utils';
import { NACINI_PLACANJA, type NacinPlacanja } from '@/lib/placanje';

export const IKONA_PLACANJA: Record<NacinPlacanja, LucideIcon> = {
  Gotovina: Banknote, Kartica: CreditCard, Virman: Building, 'Ček': FileCheck,
};

/**
 * Izbor načina plaćanja. `traka`: četiri polja u redu, strelice lijevo/desno
 * (kasa, faktura); `mreza`: 2×2 s oznakama tipki 1–4 (dijalog naplate — tipke
 * hvata dijalog).
 */
export function NacinPlacanjaBirac({ value, onChange, redoslijed = NACINI_PLACANJA, varijanta = 'traka', className }: {
  value: NacinPlacanja;
  onChange: (nacin: NacinPlacanja) => void;
  redoslijed?: readonly NacinPlacanja[];
  varijanta?: 'traka' | 'mreza';
  className?: string;
}) {
  if (varijanta === 'mreza') {
    return (
      <div className={cn('grid grid-cols-2 gap-2', className)}>
        {redoslijed.map((nacin, i) => {
          const Ikona = IKONA_PLACANJA[nacin];
          const aktivan = value === nacin;
          return (
            <button
              key={nacin}
              type="button"
              onClick={() => onChange(nacin)}
              aria-pressed={aktivan}
              className={cn(
                'h-10 flex items-center gap-2 rounded-lg border px-3 text-[12px] font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                aktivan ? 'bg-[#0f1629] text-white border-[#0f1629]' : 'text-slate-600 border-slate-200 hover:bg-slate-50',
              )}
            >
              <Ikona size={14} />
              {nacin}
              <Key tone={aktivan ? 'dark' : 'light'}>{i + 1}</Key>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn('grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1', className)}
      role="radiogroup"
      aria-label="Način plaćanja"
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const i = redoslijed.indexOf(value);
        const next = e.key === 'ArrowRight' ? (i + 1) % redoslijed.length : (i - 1 + redoslijed.length) % redoslijed.length;
        onChange(redoslijed[next]);
        (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
      }}
    >
      {redoslijed.map(nacin => {
        const Ikona = IKONA_PLACANJA[nacin];
        const aktivan = value === nacin;
        return (
          <button
            key={nacin}
            type="button"
            role="radio"
            aria-checked={aktivan}
            tabIndex={aktivan ? 0 : -1}
            onClick={() => onChange(nacin)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-lg py-2 text-[11.5px] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
              aktivan ? 'bg-[#0f1629] font-medium text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
            )}
          >
            <Ikona className={cn('h-4 w-4', aktivan ? 'text-white' : 'text-slate-400')} />
            {nacin}
          </button>
        );
      })}
    </div>
  );
}
