import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';
import { MJESECI, mjesecPerioda, periodMjeseca, type Period } from '@/lib/knjigovodja/period';

interface PeriodPickerProps {
  value: Period;
  onChange: (p: Period) => void;
  /** 'YYYY-MM-DD' — mjeseci poslije ovog datuma se ne mogu izabrati. */
  max: string;
}

// Izgled okidača isti kao izbor perioda na ostalim tabovima Izvještaja.
const OKIDAC = 'h-9 text-[13px] bg-slate-50 border-slate-200';

export function PeriodPicker({ value, onChange, max }: PeriodPickerProps) {
  const [rezim, setRezim] = React.useState<'mjesec' | 'period'>(mjesecPerioda(value) ? 'mjesec' : 'period');
  const [open, setOpen] = React.useState(false);
  const izabran = mjesecPerioda(value);
  const [godina, setGodina] = React.useState(Number(value.od.slice(0, 4)));
  const [maxG, maxM] = max.split('-').map(Number);

  const promijeniRezim = (r: 'mjesec' | 'period') => {
    setRezim(r);
    if (r === 'mjesec' && !izabran) {
      const [g, m] = value.od.split('-').map(Number);
      onChange(periodMjeseca(g, m));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center bg-slate-100 rounded-lg p-0.5" role="tablist" aria-label="Vrsta perioda">
        {(['mjesec', 'period'] as const).map(r => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={rezim === r}
            onClick={() => promijeniRezim(r)}
            className={cn(
              'px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
              rezim === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {r === 'mjesec' ? 'Mjesec' : 'Period'}
          </button>
        ))}
      </div>

      {rezim === 'mjesec' ? (
        <Popover open={open} onOpenChange={o => { setOpen(o); if (o && izabran) setGodina(izabran.godina); }}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn(OKIDAC, 'min-w-44 justify-start font-medium text-slate-800')}>
              <CalendarDays size={14} className="mr-2 text-slate-400" />
              {izabran ? `${MJESECI[izabran.mjesec - 1]} ${izabran.godina}` : 'Izaberite mjesec'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="flex items-center justify-between mb-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setGodina(g => g - 1)} aria-label="Prethodna godina">
                <ChevronLeft size={16} />
              </Button>
              <span className="text-sm font-semibold tabular-nums">{godina}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={godina >= maxG} onClick={() => setGodina(g => g + 1)} aria-label="Sljedeća godina">
                <ChevronRight size={16} />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MJESECI.map((naziv, i) => {
                const m = i + 1;
                const buduci = godina > maxG || (godina === maxG && m > maxM);
                const aktivan = izabran?.godina === godina && izabran.mjesec === m;
                return (
                  <button
                    key={naziv}
                    type="button"
                    disabled={buduci}
                    title={naziv}
                    aria-pressed={aktivan}
                    onClick={() => { onChange(periodMjeseca(godina, m)); setOpen(false); }}
                    className={cn(
                      'h-9 rounded-md text-[13px] transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
                      aktivan ? 'bg-slate-900 text-white font-medium' : 'hover:bg-slate-100 text-slate-700',
                      buduci && 'opacity-30 pointer-events-none',
                    )}
                  >
                    {naziv.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-1.5">
          <DatePicker
            className={cn(OKIDAC, 'w-36')}
            value={value.od}
            onChange={od => onChange({ od, do: value.do < od ? od : value.do })}
          />
          <ChevronRight size={14} className="text-slate-300" />
          <DatePicker className={cn(OKIDAC, 'w-36')} value={value.do} minDate={value.od} onChange={d => onChange({ od: value.od, do: d })} />
        </div>
      )}
    </div>
  );
}
