// src/components/proizvodnja/KalkulacijaPanel.tsx
import { useEffect, useState } from 'react';
import type { RadniNalog } from '@/types';
import type { Kalkulacija } from '@/lib/proizvodnja';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Eyebrow } from '@/components/ui/ledger';
import { AlertTriangle, Lock } from 'lucide-react';

function Red({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11.5px] min-h-[22px]">
      <span className={strong ? 'font-semibold text-slate-700' : 'text-slate-400'}>{label}</span>
      <span className={cn('font-mono tabular-nums text-right', strong ? 'font-semibold text-slate-800' : 'text-slate-600')}>{value}</span>
    </div>
  );
}

/** Završni iznos — ista mjera kao "Ukupno" na računu. */
function Iznos({ label, value, tone = 'default', sufiks }: { label: string; value: string; tone?: 'default' | 'plus' | 'minus'; sufiks?: string }) {
  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-baseline justify-between gap-3">
      <span className="text-[12.5px] font-semibold text-slate-800">{label}</span>
      <span className="flex items-baseline gap-1.5 min-w-0">
        {sufiks && <span className={cn('font-mono text-[11px] font-medium tabular-nums', tone === 'minus' ? 'text-rose-500' : tone === 'plus' ? 'text-emerald-600/80' : 'text-slate-400')}>{sufiks}</span>}
        <span className={cn('text-[22px] font-bold font-mono tabular-nums tracking-tight leading-none',
          tone === 'minus' ? 'text-rose-600' : tone === 'plus' ? 'text-emerald-600' : 'text-slate-900')}>{value}</span>
      </span>
    </div>
  );
}

export function KalkulacijaPanel({ nalog, kalkulacija, uredivo, onTrosakRada }: {
  nalog: RadniNalog; kalkulacija: Kalkulacija | null; uredivo: boolean; onTrosakRada: (iznos: number) => Promise<void>;
}) {
  const [rad, setRad] = useState(String(nalog.trosakRada ?? 0));
  useEffect(() => { setRad(String(nalog.trosakRada ?? 0)); }, [nalog.id, nalog.trosakRada]);
  const k = kalkulacija;
  const zamrznuto = nalog.status === 'zavrsen' || nalog.status === 'fakturisan';
  const marza = k?.marza ?? 0;

  return (
    <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <Eyebrow>Kalkulacija</Eyebrow>
        {zamrznuto && <span className="flex items-center gap-1 text-[10.5px] text-slate-400"><Lock size={10} /> zamrznuta pri završetku</span>}
      </div>
      {k && k.upozorenja.length > 0 && (
        <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5 mb-2">
          {k.upozorenja.map((u, i) => <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={11} className="mt-[2px] flex-shrink-0" /> {u}</p>)}
        </div>
      )}

      <Red label="Materijal" value={formatKM(k?.materijal ?? 0)} />
      <Red label="Rad" value={uredivo ? (
        <DecimalInput value={rad} onValueChange={t => setRad(t)} onBlur={() => onTrosakRada(parseDecimal(rad) || 0)}
          aria-label="Trošak rada" className="h-7 w-28 font-mono text-[12px] text-right" placeholder="0,00" />
      ) : formatKM(k?.rad ?? 0)} />

      {nalog.vrsta === 'narudzba' ? (
        <>
          <Red label="Ukupan trošak" value={formatKM(k?.ukupno ?? 0)} strong />
          {k && (
            <>
              <div className="mt-1.5 pt-1.5 border-t border-dashed border-slate-100">
                <Red label="Dogovorena cijena" value={formatKM(nalog.dogovorenaCijena ?? 0)} />
                <Red label="Bez PDV-a" value={formatKM(k.neto ?? 0)} />
              </div>
              <Iznos label="Marža" value={formatKM(marza)} tone={marza < 0 ? 'minus' : 'plus'}
                sufiks={`${(k.marzaPct ?? 0).toFixed(1)} %`} />
            </>
          )}
        </>
      ) : (
        <>
          {k && (
            <>
              <Red label={`Po komadu (×${nalog.kolicina})`} value={formatKM(k.poKomadu ?? 0)} />
              <Red label="Prodajna cijena" value={formatKM(nalog.productCijena ?? 0)} />
            </>
          )}
          <Iznos label="Ukupan trošak" value={formatKM(k?.ukupno ?? 0)} />
        </>
      )}
    </div>
  );
}
