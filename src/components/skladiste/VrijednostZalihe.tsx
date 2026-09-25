import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product } from '@/types';
import { cn, formatKM, porukaGreske } from '@/lib/utils';
import { round2, localDateStr } from '@/lib/novac';
import { uNetto } from '@/lib/pdvUnos';
import { jePloca } from '@/lib/ploca';
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LedgerHead } from '@/components/ui/ledger';
import { Stat } from '@/components/ui/stat';
import { AlertTriangle, Boxes, RefreshCw } from 'lucide-react';

const danas = () => localDateStr().split('-').reverse().join('.');

/**
 * Vrijednost robe na skladištu po prodajnim cijenama, na današnji dan.
 * Artikli u minusu se ne uračunavaju — minus je greška u evidenciji, ne roba.
 */
export function VrijednostZalihe() {
  const proizvodnja = useProizvodnja();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [greska, setGreska] = useState('');

  const load = useCallback(async () => {
    if (proizvodnja === null) return;
    setLoading(true);
    setGreska('');
    try {
      const artikli = await window.api.getProducts('artikal');
      const materijal = proizvodnja ? await window.api.getProducts('materijal') : [];
      setProducts([...artikli, ...materijal]);
    } catch (e) {
      setGreska(porukaGreske(e));
    } finally {
      setLoading(false);
    }
  }, [proizvodnja]);

  useEffect(() => { load(); }, [load]);

  const r = useMemo(() => {
    const redovi = products
      .filter(p => (p.stanje ?? 0) > 0)
      .map(p => ({ p, vrijednost: round2(p.cijena * (p.stanje ?? 0)) }))
      .sort((a, b) => b.vrijednost - a.vrijednost);
    const ukupno = round2(redovi.reduce((s, x) => s + x.vrijednost, 0));
    const osnovica = round2(redovi.reduce((s, x) => s + uNetto(x.vrijednost, x.p.pdvStopa), 0));
    const uMinusu = products.filter(p => (p.stanje ?? 0) < 0).length;
    return { redovi, ukupno, osnovica, pdv: round2(ukupno - osnovica), uMinusu };
  }, [products]);

  const najveca = r.redovi[0]?.vrijednost ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-6 pt-5 pb-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Vrijednost sa PDV-om" value={formatKM(r.ukupno)} strong />
          <Stat label="Osnovica" value={formatKM(r.osnovica)} />
          <Stat label="PDV" value={formatKM(r.pdv)} />
          <Stat label="Artikala na stanju" value={String(r.redovi.length)} note={`od ${products.length}`} />
        </div>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-5">
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <span className="text-[13px] font-semibold text-slate-700">Zaliha po prodajnim cijenama</span>
            <span className="text-[12px] text-slate-400 tabular-nums">stanje na dan {danas()}</span>
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="ml-auto h-8 gap-1.5 text-[12px]">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Osvježi
            </Button>
          </div>

          {(greska || r.uMinusu > 0) && (
            <div className={cn('flex items-center gap-2 px-5 py-2 text-[12px] border-b',
              greska ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-amber-50/70 border-amber-100 text-amber-800')}>
              <AlertTriangle size={13} className="flex-shrink-0" />
              {greska || `${r.uMinusu} ${r.uMinusu === 1 ? 'artikal je' : 'artikala je'} u minusu i nije uračunato u vrijednost.`}
            </div>
          )}

          {r.redovi.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Boxes size={20} className="text-slate-300" /></div>
              <p className="text-[13px] font-medium text-slate-500">Skladište je prazno</p>
              <p className="text-[12px] text-slate-400 mt-0.5">Robu na stanje dodaje ulaz robe.</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full border-separate border-spacing-0">
                <LedgerHead columns={[
                  { label: 'Šifra', className: 'text-left pl-5 pr-2 w-[1%] whitespace-nowrap' },
                  { label: 'Naziv', className: 'text-left px-2' },
                  { label: 'Stanje', className: 'text-right px-2 w-[110px]' },
                  { label: 'Cijena', className: 'text-right px-2 w-[110px] hidden md:table-cell' },
                  { label: 'Vrijednost', className: 'text-right pl-2 pr-5 w-[200px]' },
                ]} />
                <tbody>
                  {r.redovi.map(({ p, vrijednost }) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="pl-5 pr-2 py-2.5 border-b border-slate-100 font-mono text-[12px] text-slate-400 whitespace-nowrap">{p.sifra}</td>
                      <td className="px-2 py-2.5 border-b border-slate-100 text-[12.5px] font-medium text-slate-800 max-w-0 truncate">{p.naziv}</td>
                      <td className="px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12px] tabular-nums text-slate-600 whitespace-nowrap">
                        {jePloca(p) ? (p.stanje ?? 0).toFixed(2).replace('.', ',') : p.stanje} <span className="text-slate-400">{p.jm}</span>
                      </td>
                      <td className="hidden md:table-cell px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12px] tabular-nums text-slate-500 whitespace-nowrap">{formatKM(p.cijena)}</td>
                      <td className="pl-2 pr-5 py-2.5 border-b border-slate-100 text-right whitespace-nowrap">
                        <span className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">{formatKM(vrijednost)}</span>
                        {/* Udio u najvećoj stavci — vidi se gdje je roba zarobljena. */}
                        <span className="block ml-auto mt-1 h-[3px] w-24 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
                          <span className="block h-full rounded-full bg-slate-400" style={{ width: `${najveca > 0 ? Math.max(2, (vrijednost / najveca) * 100) : 0}%` }} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm border-t border-slate-200 pl-5 pr-2 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Ukupno</td>
                    <td className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm border-t border-slate-200" />
                    <td className="hidden md:table-cell sticky bottom-0 bg-slate-50/95 backdrop-blur-sm border-t border-slate-200" />
                    <td className="sticky bottom-0 bg-slate-50/95 backdrop-blur-sm border-t border-slate-200 pl-2 pr-5 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-slate-900 whitespace-nowrap">{formatKM(r.ukupno)}</td>
                  </tr>
                </tfoot>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
