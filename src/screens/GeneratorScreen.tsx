import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sparkles, Play, RotateCcw, X, CheckCircle2, AlertTriangle, Loader2, Package, Clock,
} from 'lucide-react';
import { Product } from '@/types';
import { formatKM } from '@/lib/utils';
import { generirajRacune, GeneratedRacun, GenerateResult } from '@/lib/batchRacuni';

const DELAY_SECONDS = 5;

type RacunStatus = 'pending' | 'done' | 'failed';

interface Props {
  korisnikId: number;
}

export default function GeneratorScreen({ korisnikId }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [targetInput, setTargetInput] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RacunStatus>>({});

  const [running, setRunning] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'print' | 'wait'>('print');
  const [countdown, setCountdown] = useState(0);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const runningRef = useRef(false);

  const loadProducts = async () => {
    const rows = await window.api.getProducts('artikal');
    setProducts(rows as Product[]);
  };

  useEffect(() => { loadProducts(); }, []);

  const totalStockValue = products.reduce(
    (s, p) => s + p.cijena * Math.floor(p.stanje ?? 0),
    0
  );

  const generate = () => {
    const target = parseFloat(targetInput.replace(',', '.'));
    if (!target || target <= 0) {
      setMessage({ type: 'error', text: 'Unesite ispravan ciljni iznos.' });
      return;
    }
    setMessage(null);
    const res = generirajRacune(products, { target });
    setResult(res);
    setStatuses(Object.fromEntries(res.racuni.map(r => [r.id, 'pending' as RacunStatus])));
  };

  const removeRacun = (id: string) => {
    if (!result || running) return;
    const racuni = result.racuni.filter(r => r.id !== id);
    const ukupnoGenerisano = Math.round(racuni.reduce((s, r) => s + r.ukupno, 0) * 100) / 100;
    setResult({ ...result, racuni, ukupnoGenerisano, manjak: Math.max(0, Math.round((result.target - ukupnoGenerisano) * 100) / 100) });
    setStatuses(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const sleepWithCountdown = (secs: number) =>
    new Promise<void>(resolve => {
      let left = secs;
      setCountdown(left);
      const iv = setInterval(() => {
        left -= 1;
        setCountdown(left);
        if (left <= 0) { clearInterval(iv); resolve(); }
      }, 1000);
    });

  const finalizeOne = async (r: GeneratedRacun) => {
    return window.api.finalizeOrder({
      korisnikId,
      ukupno: r.ukupno,
      pdvIznos: r.pdvIznos,
      nacinPlacanja: 'Gotovina',
      stavke: r.stavke,
    });
  };

  const processAll = async () => {
    if (!result || running) return;
    const queue = result.racuni.filter(r => statuses[r.id] !== 'done');
    if (queue.length === 0) return;

    setRunning(true);
    runningRef.current = true;
    setMessage(null);

    let printed = 0;
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i];
      setActiveId(r.id);
      setPhase('print');

      // Print, with a single retry after the recovery delay (retry-then-stop).
      let res = await finalizeOne(r).catch((e: any) => ({ success: false, error: e?.message }));
      if (!res || !res.success) {
        setPhase('wait');
        await sleepWithCountdown(DELAY_SECONDS);
        setPhase('print');
        res = await finalizeOne(r).catch((e: any) => ({ success: false, error: e?.message }));
      }

      if (!res || !res.success) {
        setStatuses(prev => ({ ...prev, [r.id]: 'failed' }));
        setRunning(false);
        runningRef.current = false;
        setActiveId(null);
        setMessage({
          type: 'error',
          text: `Zaustavljeno na računu ${printed + 1}/${queue.length}: ${res?.error || 'Greška pri štampanju'}. Odštampano ${printed}, preostalo ${queue.length - printed}.`,
        });
        await loadProducts();
        return;
      }

      printed++;
      setStatuses(prev => ({ ...prev, [r.id]: 'done' }));

      // Recovery gap before the next receipt (skip after the last one).
      if (i < queue.length - 1) {
        setPhase('wait');
        await sleepWithCountdown(DELAY_SECONDS);
      }
    }

    setRunning(false);
    runningRef.current = false;
    setActiveId(null);
    setMessage({ type: 'success', text: `Gotovo — odštampano ${printed} ${printed === 1 ? 'račun' : 'računa'}.` });
    await loadProducts();
  };

  const racuni = result?.racuni ?? [];
  const doneCount = Object.values(statuses).filter(s => s === 'done').length;
  const pctOfTarget = result && result.target > 0
    ? Math.min(100, (result.ukupnoGenerisano / result.target) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="h-4 w-4 text-blue-500" />
            <span className="text-[15px] font-semibold text-slate-800">Generator računa</span>
            {racuni.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                {racuni.length}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadProducts} disabled={running} className="h-8 gap-1.5 text-[12px]">
            <RotateCcw className="h-3.5 w-3.5" />
            Osvježi zalihe
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mx-6 mt-3 rounded-lg border p-3 text-sm ${
          message.type === 'success'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
            : 'border-red-300 bg-red-50 text-red-800'
        }`}>
          {message.text}
        </div>
      )}

      {/* Config + summary */}
      <div className="flex-shrink-0 px-6 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-56">
            <Label className="text-[12px] text-slate-500">Ciljni ukupni iznos (KM)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={targetInput}
              onChange={e => setTargetInput(e.target.value)}
              placeholder="npr. 2000"
              disabled={running}
              className="mt-1 h-10 bg-white"
              onKeyDown={e => { if (e.key === 'Enter') generate(); }}
            />
          </div>
          <Button onClick={generate} disabled={running || products.length === 0} className="h-10 gap-1.5">
            <Sparkles className="h-4 w-4" />
            {racuni.length > 0 ? 'Regeneriši' : 'Generiši'}
          </Button>
          <div className="text-[12px] text-slate-500 flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5" />
            Raspoloživa vrijednost zaliha: <span className="font-semibold text-slate-700">{formatKM(totalStockValue)}</span>
          </div>
        </div>

        {result && (
          <div className="mt-4 rounded-xl border bg-white p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                Generisano <span className="font-semibold text-slate-800">{formatKM(result.ukupnoGenerisano)}</span> / cilj {formatKM(result.target)}
                <span className="text-slate-400"> · {racuni.length} računa</span>
              </span>
              {result.manjak > 0.005 && (
                <span className="flex items-center gap-1.5 text-amber-700 text-[12px]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Nedovoljno zaliha za cilj — manjak {formatKM(result.manjak)}
                </span>
              )}
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pctOfTarget}%` }} />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Button onClick={processAll} disabled={running || racuni.length === 0 || doneCount === racuni.length} className="gap-1.5">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Obradi sve
              </Button>
              {running && (
                <span className="text-[13px] text-slate-600 flex items-center gap-1.5">
                  {phase === 'print' ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> Štampam {doneCount + 1}/{racuni.length}…</>
                  ) : (
                    <><Clock className="h-3.5 w-3.5 text-amber-500" /> Oporavak fiskalnog uređaja — {countdown}s</>
                  )}
                </span>
              )}
              {!running && doneCount > 0 && (
                <span className="text-[13px] text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Odštampano {doneCount}/{racuni.length}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Review list */}
      <ScrollArea className="flex-1 px-6 pb-6">
        {racuni.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 select-none">
            <Sparkles className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">Unesite ciljni iznos i pritisnite „Generiši".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {racuni.map((r, idx) => {
              const st = statuses[r.id] ?? 'pending';
              const isActive = activeId === r.id;
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border bg-white p-3 transition-all ${
                    isActive ? 'ring-2 ring-blue-400 border-blue-300' :
                    st === 'done' ? 'border-emerald-200 bg-emerald-50/40' :
                    st === 'failed' ? 'border-red-300 bg-red-50/50' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-mono text-slate-400">#{idx + 1}</span>
                      {st === 'done' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                      {st === 'failed' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                      {isActive && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{formatKM(r.ukupno)}</span>
                      {!running && st === 'pending' && (
                        <button
                          onClick={() => removeRacun(r.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                          title="Ukloni račun"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {r.stavke.map((s, si) => (
                      <div key={si} className="flex items-center justify-between text-[12px] text-slate-600">
                        <span className="truncate pr-2">
                          <span className="text-slate-400 font-mono mr-1">{s.kolicina}×</span>
                          {s.naziv}
                        </span>
                        <span className="text-slate-500 tabular-nums">{formatKM(s.cijena * s.kolicina)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
