// src/components/proizvodnja/StavkeUtroska.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RadniNalogStavka } from '@/types';
import type { NalogStavkaInput } from '@/lib/proizvodnja';
import { jePloca, napomenaUElemente } from '@/lib/ploca';
import { cn, parseDecimal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eyebrow } from '@/components/ui/ledger';
import { ElementiDialog } from './ElementiDialog';
import { Search, X, Ruler, Save, AlertTriangle } from 'lucide-react';

export interface StavkaDraft {
  materijalId: number; naziv: string; sifra: string; jm: string;
  kolicina: string; napomena: string; stanje: number;
  plocaSirina?: number | null; plocaVisina?: number | null;
}

function izStavke(s: RadniNalogStavka): StavkaDraft {
  return {
    materijalId: s.materijalId, naziv: s.materijalNaziv ?? `#${s.materijalId}`, sifra: s.materijalSifra ?? '',
    jm: s.materijalJm ?? '', kolicina: String(s.kolicina), napomena: s.napomena ?? '', stanje: s.stanje ?? 0,
    plocaSirina: s.plocaSirina, plocaVisina: s.plocaVisina,
  };
}

export function StavkeUtroska({ nalogId, stavke, uredivo, onSave, onDirtyChange }: {
  nalogId: number; stavke: RadniNalogStavka[]; uredivo: boolean; onSave: (stavke: NalogStavkaInput[]) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<StavkaDraft[]>(stavke.map(izStavke));
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [elementiZa, setElementiZa] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Nalog se promijenio (druga stavka je izabrana u listi) — odbaci draft bez obzira na dirty.
  useEffect(() => { setDraft(stavke.map(izStavke)); setDirty(false); }, [nalogId]);

  // Osvježenje istog naloga (npr. nakon promjene troška rada) ne smije obrisati neusnimljene
  // izmjene korisnika; kad se spremanje završi, dirty pređe na false i ovaj efekat tad povuče
  // svježe stanje sa servera.
  useEffect(() => { if (!dirty) setDraft(stavke.map(izStavke)); }, [stavke, dirty]);

  // Nalog je izgubio uređivost (npr. završen ispod ruku) — odbaci draft i otključaj dirty
  // da se disabled dugmad koja zavise o njemu ne zaglave uklj.
  useEffect(() => { if (!uredivo) { setDirty(false); setDraft(stavke.map(izStavke)); } }, [uredivo]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!query.trim()) { setResults([]); return; }
    debounce.current = setTimeout(async () => setResults(await window.api.searchMaterijal(query.trim())), 150);
  }, [query]);

  const dodaj = (m: any) => {
    setDraft(d => d.some(x => x.materijalId === m.id) ? d : [...d, {
      materijalId: m.id, naziv: m.naziv, sifra: m.sifra, jm: m.jm, kolicina: '', napomena: '',
      stanje: m.stanje ?? 0, plocaSirina: m.plocaSirina, plocaVisina: m.plocaVisina,
    }]);
    setDirty(true); setQuery(''); setResults([]);
  };
  const set = (i: number, patch: Partial<StavkaDraft>) => { setDraft(d => d.map((s, j) => (j === i ? { ...s, ...patch } : s))); setDirty(true); };
  const ukloni = (i: number) => { setDraft(d => d.filter((_, j) => j !== i)); setDirty(true); };

  // Stabilna referenca dok je dijalog otvoren — inače bi svaki re-render StavkeUtroska (npr.
  // izmjena druge stavke) rekreirao niz, ponovo pokrenuo ElementiDialog-ov [open, initial]
  // efekat i pregazio redove koje korisnik trenutno kuca.
  const elementiNapomena = elementiZa != null ? draft[elementiZa]?.napomena ?? '' : '';
  const elementiInitial = useMemo(
    () => (elementiZa != null ? napomenaUElemente(elementiNapomena) : []),
    [elementiZa, elementiNapomena]
  );

  const spremi = async () => {
    setSaving(true); setError('');
    try {
      await onSave(draft.map(s => ({ materijalId: s.materijalId, kolicina: parseDecimal(s.kolicina) || 0, napomena: s.napomena || null })));
      setDirty(false);
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-2 bg-slate-50/40">
        <Eyebrow>Utrošak materijala</Eyebrow>
        <span className="font-mono text-[10px] tabular-nums text-slate-400">{draft.length}</span>
      </div>

      {uredivo && (
        <div className="px-5 pb-2 relative">
          <Search className="absolute left-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Dodaj materijal (naziv ili šifra)…" className="pl-8 h-8 text-[12.5px] bg-slate-50" />
          {results.length > 0 && (
            <div className="absolute left-5 right-5 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-auto">
              {results.map(m => (
                <button key={m.id} onClick={() => dodaj(m)} className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 text-[12px]">
                  <span><span className="font-mono text-slate-400 mr-2">{m.sifra}</span>{m.naziv}</span>
                  <span className={cn('font-mono text-[11px]', (m.stanje ?? 0) <= 0 ? 'text-rose-500' : 'text-slate-400')}>{m.stanje} {m.jm}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="divide-y divide-slate-50">
          {draft.length === 0 && <p className="px-5 py-4 text-[12px] text-slate-400">Još nema stavki utroška.</p>}
          {draft.map((s, i) => {
            const kol = parseDecimal(s.kolicina) || 0;
            const prekoracenje = uredivo && kol > s.stanje;
            return (
              <div key={s.materijalId} className="px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-slate-700 truncate">{s.naziv}</p>
                    <p className={cn('text-[10px] font-mono', prekoracenje ? 'text-rose-500' : 'text-slate-400')}>
                      stanje {s.stanje} {s.jm}{prekoracenje ? ' · nedovoljno' : ''}
                    </p>
                  </div>
                  {uredivo ? (
                    <>
                      <DecimalInput maxDecimals={4} value={s.kolicina} onValueChange={t => set(i, { kolicina: t })} placeholder="0" className="h-8 w-24 font-mono text-sm text-right" />
                      <span className="text-[11px] text-slate-400 w-7">{s.jm}</span>
                      {jePloca(s) && (
                        <button title="Elementi" onClick={() => setElementiZa(i)} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"><Ruler size={14} /></button>
                      )}
                      <button onClick={() => ukloni(i)} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50"><X size={14} /></button>
                    </>
                  ) : (
                    <span className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">{s.kolicina} {s.jm}</span>
                  )}
                </div>
                {uredivo ? (
                  <Input value={s.napomena} onChange={e => set(i, { napomena: e.target.value })} placeholder="Napomena (npr. korpus 600×720 ×2)" className="mt-1.5 h-7 text-[11px] bg-transparent border-0 border-b border-slate-100 rounded-none px-0 shadow-none" />
                ) : s.napomena ? <p className="mt-1 text-[11px] text-slate-400">{s.napomena}</p> : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {uredivo && (
        <div className="flex-shrink-0 px-5 py-2.5 border-t border-slate-100 flex items-center gap-2">
          {error && <span className="flex items-center gap-1 text-[11px] text-rose-600"><AlertTriangle size={12} /> {error}</span>}
          <Button size="sm" className="ml-auto h-8 gap-1.5 text-[12px]" onClick={spremi} disabled={!dirty || saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Spremam…' : 'Spremi stavke'}
          </Button>
        </div>
      )}

      <ElementiDialog
        open={elementiZa != null}
        onOpenChange={v => { if (!v) setElementiZa(null); }}
        initial={elementiInitial}
        onConfirm={(m2, nap) => { if (elementiZa != null) set(elementiZa, { kolicina: String(m2), napomena: nap }); }}
      />
    </div>
  );
}
