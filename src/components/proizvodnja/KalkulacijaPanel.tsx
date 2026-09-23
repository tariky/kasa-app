// src/components/proizvodnja/KalkulacijaPanel.tsx
import { useEffect, useState } from 'react';
import type { RadniNalog } from '@/types';
import type { Kalkulacija } from '@/lib/proizvodnja';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Eyebrow } from '@/components/ui/ledger';
import { AlertTriangle, Lock } from 'lucide-react';

export function KalkulacijaPanel({ nalog, kalkulacija, uredivo, onTrosakRada }: {
  nalog: RadniNalog; kalkulacija: Kalkulacija | null; uredivo: boolean; onTrosakRada: (iznos: number) => Promise<void>;
}) {
  const [rad, setRad] = useState(String(nalog.trosakRada ?? 0));
  useEffect(() => { setRad(String(nalog.trosakRada ?? 0)); }, [nalog.id, nalog.trosakRada]);
  const k = kalkulacija;
  const zamrznuto = nalog.status === 'zavrsen' || nalog.status === 'fakturisan';

  const Red = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-slate-400">{label}</span>
      <span className={cn('font-mono tabular-nums text-slate-600', cls)}>{value}</span>
    </div>
  );

  return (
    <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <Eyebrow>Kalkulacija</Eyebrow>
        {zamrznuto && <span className="flex items-center gap-1 text-[10px] text-slate-400"><Lock size={10} /> zamrznuta pri završetku</span>}
      </div>
      {k && k.upozorenja.length > 0 && (
        <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5 mb-1.5">
          {k.upozorenja.map((u, i) => <p key={i} className="flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={11} /> {u}</p>)}
        </div>
      )}
      <Red label="Materijal" value={formatKM(k?.materijal ?? 0)} />
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-slate-400">Rad</span>
        {uredivo ? (
          <DecimalInput value={rad} onValueChange={t => setRad(t)} onBlur={() => onTrosakRada(parseDecimal(rad) || 0)}
            className="h-7 w-24 font-mono text-[12px] text-right" placeholder="0,00" />
        ) : <span className="font-mono tabular-nums text-slate-600">{formatKM(k?.rad ?? 0)}</span>}
      </div>
      <div className="pt-1.5 border-t border-slate-100 flex items-baseline justify-between">
        <span className="text-[12px] font-semibold text-slate-800">Ukupan trošak</span>
        <span className="text-[16px] font-bold font-mono tabular-nums text-slate-900">{formatKM(k?.ukupno ?? 0)}</span>
      </div>
      {nalog.vrsta === 'narudzba' && k && (
        <div className="pt-1.5 space-y-1">
          <Red label="Dogovorena cijena (bruto)" value={formatKM(nalog.dogovorenaCijena ?? 0)} />
          <Red label="Bez PDV-a" value={formatKM(k.neto ?? 0)} />
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-slate-800">Marža</span>
            <span className={cn('text-[16px] font-bold font-mono tabular-nums', (k.marza ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {formatKM(k.marza ?? 0)} <span className="text-[11px] font-medium">({(k.marzaPct ?? 0).toFixed(1)} %)</span>
            </span>
          </div>
        </div>
      )}
      {nalog.vrsta === 'zaliha' && k && (
        <div className="pt-1.5 space-y-1">
          <Red label={`Trošak po komadu (×${nalog.kolicina})`} value={formatKM(k.poKomadu ?? 0)} cls="font-semibold text-slate-800" />
          <Red label="Prodajna cijena iz šifarnika" value={formatKM(nalog.productCijena ?? 0)} />
        </div>
      )}
    </div>
  );
}
