import { cn } from '@/lib/utils';
import type { ZiroRacuniPozicija } from '@/types';

const OPCIJE: Array<{ vrijednost: ZiroRacuniPozicija; naziv: string; opis: string }> = [
  { vrijednost: 'zaglavlje', naziv: 'U zaglavlju', opis: 'Ispod adrese firme, sitnije' },
  { vrijednost: 'podnozje', naziv: 'U podnožju', opis: 'Posebna traka na dnu svake stranice' },
];

/** Minijatura A4 fakture — žiro računi (amber) tamo gdje će stvarno biti. */
function Minijatura({ pozicija, aktivna }: { pozicija: ZiroRacuniPozicija; aktivna: boolean }) {
  const racun = aktivna ? 'bg-amber-500' : 'bg-amber-300';
  return (
    <div className="relative w-[46px] h-[64px] shrink-0 rounded-[3px] bg-white border border-slate-200 shadow-sm px-[5px] pt-[6px]">
      <div className="h-[3px] w-[18px] rounded-[1px] bg-slate-800" />
      <div className="mt-[2px] h-[2px] w-[14px] rounded-[1px] bg-slate-300" />
      {pozicija === 'zaglavlje' && (
        <div className="mt-[2px] space-y-[1.5px]">
          <div className={cn('h-[1.5px] w-[16px] rounded-[1px]', racun)} />
          <div className={cn('h-[1.5px] w-[16px] rounded-[1px]', racun)} />
        </div>
      )}
      <div className="mt-[3px] h-[1.5px] bg-slate-800" />
      <div className="mt-[3px] space-y-[2.5px]">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-[1.5px] bg-slate-200" />)}
      </div>
      {pozicija === 'podnozje' && (
        <div className="absolute left-[5px] right-[5px] bottom-[5px] border-t border-slate-800 pt-[2px] flex gap-[2px]">
          {[0, 1, 2].map(i => <div key={i} className={cn('h-[3px] flex-1 rounded-[1px]', racun)} />)}
        </div>
      )}
    </div>
  );
}

export function ZiroRacuniPozicijaBirac({ value, onChange }: {
  value: ZiroRacuniPozicija;
  onChange: (v: ZiroRacuniPozicija) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Položaj žiro računa na fakturi" className="grid grid-cols-2 gap-3">
      {OPCIJE.map(o => {
        const aktivna = o.vrijednost === value;
        return (
          <button
            key={o.vrijednost}
            type="button"
            role="radio"
            aria-checked={aktivna}
            onClick={() => onChange(o.vrijednost)}
            className={cn(
              'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2',
              aktivna
                ? 'border-amber-400 bg-amber-50/60'
                : 'border-slate-200 bg-slate-50 hover:border-slate-300',
            )}
          >
            <Minijatura pozicija={o.vrijednost} aktivna={aktivna} />
            <div className="min-w-0">
              <div className={cn('text-[13px] font-medium', aktivna ? 'text-slate-900' : 'text-slate-700')}>{o.naziv}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{o.opis}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
