import { forwardRef } from 'react';
import { DecimalInput } from '@/components/ui/decimal-input';
import { cn, formatKM } from '@/lib/utils';
import { round2 } from '@/lib/novac';
import { uNetto } from '@/lib/pdvUnos';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';

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
}

const iznos = (n: number) => formatKM(n).replace(/\s*KM$/, '');

/**
 * Polje za cijenu spojeno s malim obračunom ispod: osnovica, PDV i iznos sa
 * PDV-om. Red koji operator upisuje je označen — klik na drugi red prebacuje
 * unos (117 sa PDV-om postaje 100 bez PDV-a, cijena ostaje ista).
 * Kod stope K (0 %) obračun nema smisla pa se prikazuje samo napomena.
 */
export const CijenaPdvPolje = forwardRef<HTMLInputElement, Props>(function CijenaPdvPolje(
  { id, unos, onUnos, bezPdv, onRezim, stopa, bruto, onKeyDown }, ref,
) {
  const saPdv = stopa === 'E';
  const netto = bezPdv && saPdv;
  const ima = unos.trim() !== '' && !isNaN(bruto);
  const osnovica = uNetto(bruto, stopa);
  const pdv = round2(bruto - osnovica);

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white overflow-hidden transition-shadow',
        'focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20',
      )}
    >
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400"
          aria-hidden
        >
          {saPdv ? (netto ? 'bez PDV' : 'sa PDV') : 'KM'}
        </span>
        <DecimalInput
          id={id}
          ref={ref}
          value={unos}
          onValueChange={text => onUnos(text)}
          onKeyDown={onKeyDown}
          placeholder="0,00"
          aria-label={saPdv ? (netto ? 'Cijena bez PDV-a' : 'Cijena sa PDV-om') : 'Cijena'}
          className={cn(
            'h-11 border-0 rounded-none bg-transparent pl-16 pr-3 text-right font-mono text-base shadow-none',
            'focus-visible:ring-0 focus-visible:ring-offset-0',
          )}
        />
      </div>

      {saPdv ? (
        <div
          className="border-t border-slate-100 bg-slate-50/70 px-1 py-1 text-[12px]"
          role="radiogroup"
          aria-label="Upisujem cijenu"
          onKeyDown={e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const grupa = e.currentTarget;
              onRezim(e.key === 'ArrowUp');
              requestAnimationFrame(() =>
                grupa.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
            }
          }}
        >
          <Red
            odabran={netto}
            onClick={() => onRezim(true)}
            naziv="Bez PDV-a"
            vrijednost={ima ? iznos(osnovica) : '—'}
          />
          <div className="flex items-center justify-between gap-2 whitespace-nowrap pl-7 pr-2 h-6 text-slate-400">
            <span>PDV {PDV_STOPA_E_PCT} %</span>
            <span className="font-mono tabular-nums">{ima ? `+ ${iznos(pdv)}` : '—'}</span>
          </div>
          <Red
            odabran={!netto}
            onClick={() => onRezim(false)}
            naziv="Sa PDV-om"
            vrijednost={ima ? iznos(bruto) : '—'}
            istaknut
          />
        </div>
      ) : (
        <p className="border-t border-slate-100 bg-slate-50/70 px-3 py-2 text-[12px] text-slate-500">
          Stopa K — bez PDV-a
        </p>
      )}
    </div>
  );
});

function Red({ odabran, onClick, naziv, vrijednost, istaknut }: {
  odabran: boolean;
  onClick: () => void;
  naziv: string;
  vrijednost: string;
  istaknut?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={odabran}
      tabIndex={odabran ? 0 : -1}
      onClick={onClick}
      title={odabran ? 'Ovaj iznos upisuješ u polje' : `Upiši ${naziv.toLowerCase()} u polje`}
      className={cn(
        'group flex w-full items-center gap-2 whitespace-nowrap rounded-md pl-2 pr-2 h-7 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        odabran ? 'bg-white shadow-[0_0_0_1px_rgb(226_232_240)]' : 'hover:bg-white/80',
      )}
    >
      <span
        className={cn(
          'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-colors',
          odabran ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white group-hover:border-slate-500',
        )}
        aria-hidden
      >
        {odabran && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className={cn('flex-1 min-w-0 truncate', odabran ? 'text-slate-900 font-medium' : 'text-slate-500')}>{naziv}</span>
      <span
        className={cn(
          'font-mono tabular-nums',
          istaknut ? 'font-semibold text-slate-900' : odabran ? 'text-slate-900' : 'text-slate-500',
        )}
      >
        {vrijednost}
      </span>
    </button>
  );
}
