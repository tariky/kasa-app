import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn, formatKM, formatKolicina, parseDecimal } from '@/lib/utils';
import { prijedloziApoena, round2 } from '@/lib/novac';

/**
 * Kalkulacija kusura poslije gotovinskog računa: kasir upiše koliko je mušterija
 * dala (ili ↑↓ bira apoen), kusur je velik da ga vidi i mušterija. `iznos` null =
 * zatvoren; svako zatvaranje ide kroz `onZatvori` (roditelj vraća fokus u pretragu).
 */
export default function KusurDialog({ iznos, onZatvori }: { iznos: number | null; onZatvori: () => void }) {
  const [dato, setDato] = useState('');

  const zatvori = () => {
    setDato('');
    onZatvori();
  };

  return (
    <Dialog open={iznos !== null} onOpenChange={(open) => { if (!open) zatvori(); }}>
      <DialogContent className="sm:max-w-[400px] p-0 gap-0 rounded-2xl">
        {iznos !== null && (() => {
          const apoeni = prijedloziApoena(iznos);
          const datoBroj = dato ? parseDecimal(dato) : null;
          const kusur = datoBroj !== null ? round2(datoBroj - iznos) : null;
          const cycleApoen = (dir: 1 | -1) => {
            if (apoeni.length === 0) return;
            const current = apoeni.indexOf(datoBroj ?? NaN);
            const next = current === -1
              ? (dir === 1 ? 0 : apoeni.length - 1)
              : (current + dir + apoeni.length) % apoeni.length;
            setDato(formatKolicina(apoeni[next]));
          };
          return (
            <>
              <DialogHeader className="px-6 pt-6">
                <DialogTitle className="text-[15px]">Kalkulacija kusura</DialogTitle>
                <DialogDescription className="text-[12px] text-slate-500 mt-0.5">
                  Upišite koliko je mušterija dala — kusur se računa automatski
                </DialogDescription>
              </DialogHeader>

              <DialogBody className="px-6 pb-5">
                {/* Ukupno */}
                <div className="mt-4 flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ukupno</span>
                  <span className="text-[24px] font-bold font-mono tabular-nums text-slate-900 leading-none">
                    {formatKM(iznos)}
                  </span>
                </div>

                {/* Mušterija dala */}
                <DecimalInput
                  placeholder="Mušterija dala..."
                  value={dato}
                  onValueChange={text => setDato(text)}
                  onKeyDown={e => {
                    // Enter u prazno polje zatvara — s upisanim iznosom kusur
                    // ostaje na ekranu dok kasir ne pritisne Esc.
                    if (e.key === 'Enter') { e.preventDefault(); if (!dato.trim()) zatvori(); }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); cycleApoen(1); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); cycleApoen(-1); }
                  }}
                  className="mt-4 h-12 text-center font-mono text-xl font-bold rounded-xl border-slate-200"
                  autoFocus
                />

                {/* Apoeni — klik ili ↑/↓ */}
                <div className="flex gap-1.5 mt-2.5">
                  {apoeni.map(a => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setDato(formatKolicina(a))}
                      className={cn(
                        'flex-1 h-9 rounded-lg text-[12px] font-semibold font-mono tabular-nums transition-all duration-150',
                        datoBroj === a
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400',
                      )}
                    >
                      {a === round2(iznos) ? formatKM(a) : a}
                    </button>
                  ))}
                </div>

                {/* Kusur — ogromno, vidi ga i mušterija */}
                {kusur !== null && kusur >= 0 && (
                  <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 px-5 py-4 text-center">
                    <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Kusur</p>
                    <p className="text-[40px] font-bold font-mono tabular-nums text-emerald-600 leading-tight">
                      {formatKM(kusur)}
                    </p>
                  </div>
                )}
                {kusur !== null && kusur < 0 && (
                  <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-5 py-3 text-center">
                    <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Nedostaje</p>
                    <p className="text-[26px] font-bold font-mono tabular-nums text-amber-600 leading-tight">
                      {formatKM(-kusur)}
                    </p>
                  </div>
                )}
              </DialogBody>

              <div className="shrink-0 border-t border-slate-100 px-6 py-3 bg-slate-50/50 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Esc za zatvaranje
                </span>
                <Button size="sm" className="rounded-lg px-5" onClick={zatvori}>
                  Gotovo
                </Button>
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
