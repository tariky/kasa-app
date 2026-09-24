// src/components/proizvodnja/StatusRail.tsx
import type { RadniNalog } from '@/types';
import { nalogKoraci, korakIndex } from '@/lib/nalogPrikaz';
import { cn, formatDate } from '@/lib/utils';
import { Check } from 'lucide-react';

/**
 * Putanja naloga kroz radionicu — kao traka na radnom listu koja se štiklira.
 * Koraci su stvarni redoslijed statusa, pa ispod svakog stoji datum kad je pređen.
 */
export function StatusRail({ nalog }: { nalog: RadniNalog }) {
  const koraci = nalogKoraci(nalog.vrsta);
  const cur = korakIndex(nalog.vrsta, nalog.status);

  const datumZa = (status: string): string | null => {
    if (status === 'otvoren') return formatDate(nalog.datum);
    if (status === 'zavrsen' && nalog.zavrsenAt) return formatDate(nalog.zavrsenAt.slice(0, 10));
    if (status === 'fakturisan' && nalog.racunBroj) return `račun #${nalog.racunBroj}`;
    return null;
  };

  return (
    <ol className="flex items-start" aria-label="Tok naloga">
      {koraci.map((k, i) => {
        const done = i < cur;
        const active = i === cur;
        const sub = i <= cur ? datumZa(k.status) : null;
        return (
          <li key={k.status} className={cn('flex items-start min-w-0', i < koraci.length - 1 && 'flex-1')} aria-current={active ? 'step' : undefined}>
            <div className="flex flex-col items-start min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-mono font-semibold transition-colors',
                  done && 'bg-white/90 border-white/90 text-[#0f1629]',
                  active && 'bg-blue-500 border-blue-400 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.25)]',
                  !done && !active && 'border-white/20 text-white/35',
                )}>
                  {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn('text-[12px] font-medium whitespace-nowrap', active ? 'text-white' : done ? 'text-white/80' : 'text-white/35')}>
                  {k.label}
                </span>
              </div>
              <span className={cn('pl-7 mt-0.5 h-[14px] text-[10.5px] font-mono tabular-nums', active ? 'text-white/60' : 'text-white/40')}>{sub ?? ''}</span>
            </div>
            {i < koraci.length - 1 && (
              <span className={cn('flex-1 h-px mt-[10px] mx-3 min-w-[16px]', i < cur ? 'bg-white/70' : 'bg-white/15')} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
