import { forwardRef } from 'react';
import { DecimalInput } from '@/components/ui/decimal-input';
import { cn, formatKM } from '@/lib/utils';
import { round2 } from '@/lib/novac';
import { uNetto } from '@/lib/pdvUnos';

interface Props {
  id?: string;
  unos: string;
  onUnos: (text: string) => void;
  bezPdv: boolean;
  onRezim: (bezPdv: boolean) => void;
  stopa: 'E' | 'K';
  /** Bruto iznos izveden iz unosa (NaN dok unos nije broj). */
  bruto: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  inputClassName?: string;
}

const REZIMI: { bezPdv: boolean; label: string }[] = [
  { bezPdv: false, label: 'sa PDV-om' },
  { bezPdv: true, label: 'bez PDV-a' },
];

/**
 * Polje za cijenu uz koje operator bira upisuje li cijenu sa PDV-om ili bez.
 * Ispod polja uvijek stoji drugi iznos, da se odmah vidi šta kupac plaća.
 * Kod stope K (0 %) izbor nema smisla pa se ne prikazuje.
 */
export const CijenaPdvPolje = forwardRef<HTMLInputElement, Props>(function CijenaPdvPolje(
  { id, unos, onUnos, bezPdv, onRezim, stopa, bruto, onKeyDown, inputClassName }, ref,
) {
  const saPdv = stopa === 'E';
  const netto = bezPdv && saPdv;
  const ima = unos.trim() !== '' && !isNaN(bruto);
  const osnovica = uNetto(bruto, stopa);
  const pdv = round2(bruto - osnovica);

  return (
    <div className="space-y-1.5">
      <DecimalInput
        id={id}
        ref={ref}
        value={unos}
        onValueChange={text => onUnos(text)}
        onKeyDown={onKeyDown}
        placeholder="0,00"
        aria-label={netto ? 'Cijena bez PDV-a' : 'Cijena sa PDV-om'}
        className={inputClassName}
      />
      {saPdv ? (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Upisana cijena je">
          {REZIMI.map(r => (
            <button
              key={r.label}
              type="button"
              role="radio"
              aria-checked={bezPdv === r.bezPdv}
              onClick={() => onRezim(r.bezPdv)}
              className={cn(
                'h-6 px-2.5 rounded-md text-[11.5px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                bezPdv === r.bezPdv ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">Stopa K — bez PDV-a</p>
      )}
      {saPdv && (
        <p className="text-[12px] leading-[18px] text-slate-600 min-h-[36px]" aria-live="polite">
          {ima && (netto ? (
            <>Kupac plaća <span className="font-mono font-semibold text-slate-900">{formatKM(bruto)}</span> <span className="block text-slate-400">u tome PDV {formatKM(pdv)}</span></>
          ) : (
            <>Bez PDV-a <span className="font-mono font-semibold text-slate-900">{formatKM(osnovica)}</span> <span className="block text-slate-400">+ PDV {formatKM(pdv)}</span></>
          ))}
        </p>
      )}
    </div>
  );
});
