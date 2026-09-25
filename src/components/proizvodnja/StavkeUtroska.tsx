// src/components/proizvodnja/StavkeUtroska.tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Product, RadniNalogStavka } from '@/types';
import type { NalogStavkaInput, KalkulacijaStavka } from '@/lib/proizvodnja';
import { jePloca, napomenaUElemente } from '@/lib/ploca';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PretragaStavkiHandle } from '@/components/ui/pretraga-stavki';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { uvecajKolicinu } from '@/lib/pretraga';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Eyebrow, Key, mod } from '@/components/ui/ledger';
import { ElementiDialog } from './ElementiDialog';
import { X, Ruler, Save, AlertTriangle, Lock } from 'lucide-react';

export interface StavkaDraft {
  materijalId: number; naziv: string; sifra: string; jm: string;
  kolicina: string; napomena: string; stanje: number;
  plocaSirina?: number | null; plocaVisina?: number | null;
}

export interface StavkeHandle {
  /** Spremi draft; true kad je prošlo (ili nije bilo šta spremiti). */
  save: () => Promise<boolean>;
  focusSearch: () => void;
}

function izStavke(s: RadniNalogStavka): StavkaDraft {
  return {
    materijalId: s.materijalId, naziv: s.materijalNaziv ?? `#${s.materijalId}`, sifra: s.materijalSifra ?? '',
    jm: s.materijalJm ?? '', kolicina: String(s.kolicina), napomena: s.napomena ?? '', stanje: s.stanje ?? 0,
    plocaSirina: s.plocaSirina, plocaVisina: s.plocaVisina,
  };
}

const TH = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 pb-2 border-b border-slate-200/80 whitespace-nowrap';
const TD = 'py-2 border-b border-slate-100 align-top';

/**
 * Utrošak materijala — glavna radna površina naloga. Široka tabela: materijal, napomena,
 * stanje, nabavna cijena i iznos iz kalkulacije, količina. Pretraga radi s tastature
 * (↑↓ ↵ esc), a nova stavka odmah dobija fokus na količini.
 */
export const StavkeUtroska = forwardRef<StavkeHandle, {
  nalogId: number; stavke: RadniNalogStavka[]; uredivo: boolean;
  kalkStavke?: KalkulacijaStavka[];
  onSave: (stavke: NalogStavkaInput[]) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}>(function StavkeUtroska({ nalogId, stavke, uredivo, kalkStavke, onSave, onDirtyChange }, ref) {
  const [draft, setDraft] = useState<StavkaDraft[]>(stavke.map(izStavke));
  const [dirty, setDirty] = useState(false);
  const [elementiZa, setElementiZa] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchRef = useRef<PretragaStavkiHandle>(null);
  const kolRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const focusAfterAdd = useRef<number | null>(null);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Nalog se promijenio — odbaci draft bez obzira na dirty.
  useEffect(() => { setDraft(stavke.map(izStavke)); setDirty(false); }, [nalogId]);

  // Osvježenje istog naloga (npr. nakon promjene troška rada) ne smije obrisati neusnimljene
  // izmjene; kad spremanje prođe, dirty padne na false i ovaj efekat povuče svježe stanje.
  useEffect(() => { if (!dirty) setDraft(stavke.map(izStavke)); }, [stavke, dirty]);

  // Nalog je izgubio uređivost (npr. završen) — odbaci draft i otključaj dirty.
  useEffect(() => { if (!uredivo) { setDirty(false); setDraft(stavke.map(izStavke)); } }, [uredivo]);

  // Nova stavka: fokus ide pravo na količinu, jer je to sljedeće što se kuca.
  useEffect(() => {
    if (focusAfterAdd.current == null) return;
    const el = kolRefs.current.get(focusAfterAdd.current);
    focusAfterAdd.current = null;
    el?.focus(); el?.select();
  }, [draft]);

  const cijene = useMemo(() => {
    const m = new Map<number, KalkulacijaStavka>();
    for (const s of kalkStavke ?? []) m.set(s.materijalId, s);
    return m;
  }, [kalkStavke]);

  /** Uz "3*…" količina je već upisana pa fokus ostaje u pretrazi; inače ide na količinu. */
  const dodaj = (m: Product, kol: number | null) => {
    const postoji = draft.some(x => x.materijalId === m.id);
    const k = kol != null ? String(kol).replace('.', ',') : '';
    if (!postoji) {
      setDraft(d => [...d, {
        materijalId: m.id, naziv: m.naziv, sifra: m.sifra, jm: m.jm, kolicina: k, napomena: '',
        stanje: m.stanje ?? 0, plocaSirina: m.plocaSirina, plocaVisina: m.plocaVisina,
      }]);
    } else if (k) {
      setDraft(d => d.map(x => (x.materijalId === m.id ? { ...x, kolicina: uvecajKolicinu(x.kolicina, kol!) } : x)));
    }
    if (!postoji || k) setDirty(true);
    if (k) return;
    focusAfterAdd.current = m.id;
    if (postoji) { const el = kolRefs.current.get(m.id); el?.focus(); el?.select(); }
  };
  const set = (i: number, patch: Partial<StavkaDraft>) => { setDraft(d => d.map((s, j) => (j === i ? { ...s, ...patch } : s))); setDirty(true); };
  const ukloni = (i: number) => { setDraft(d => d.filter((_, j) => j !== i)); setDirty(true); };

  // Stabilna referenca dok je dijalog otvoren — inače bi svaki re-render rekreirao niz i
  // ElementiDialog-ov [open, initial] efekat pregazio redove koje korisnik trenutno kuca.
  const elementiNapomena = elementiZa != null ? draft[elementiZa]?.napomena ?? '' : '';
  const elementiInitial = useMemo(
    () => (elementiZa != null ? napomenaUElemente(elementiNapomena) : []),
    [elementiZa, elementiNapomena]
  );

  const spremi = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (saving) return false;
    setSaving(true); setError('');
    try {
      await onSave(draft.map(s => ({ materijalId: s.materijalId, kolicina: parseDecimal(s.kolicina) || 0, napomena: s.napomena || null })));
      setDirty(false);
      return true;
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); return false; }
    finally { setSaving(false); }
  };

  useImperativeHandle(ref, () => ({ save: spremi, focusSearch: () => searchRef.current?.focus() }));

  const zamrznuto = !uredivo && (kalkStavke?.some(s => s.zamrznuto) ?? false);

  return (
    <section className="flex flex-col min-h-0" aria-label="Utrošak materijala">
      <div className="flex items-center gap-2.5 h-9">
        <Eyebrow>Utrošak materijala</Eyebrow>
        <span className="font-mono text-[10.5px] tabular-nums text-slate-400">{draft.length}</span>
        {zamrznuto && <span className="flex items-center gap-1 text-[10.5px] text-slate-400"><Lock size={10} /> cijene zamrznute pri završetku</span>}
        {uredivo && dirty && (
          <div className="ml-auto flex items-center gap-2 animate-fade-in">
            {error
              ? <span className="flex items-center gap-1 text-[11px] text-rose-600"><AlertTriangle size={12} /> {error}</span>
              : <span className="text-[11px] font-medium text-amber-600">nespremljeno</span>}
            <Button size="sm" className="h-7 gap-1.5 pl-2.5 pr-2 text-[12px]" onClick={spremi} disabled={saving}>
              <Save className="h-3.5 w-3.5" /> {saving ? 'Spremam…' : 'Spremi'}
              <Key tone="dark" className="ml-1">{mod('S')}</Key>
            </Button>
          </div>
        )}
      </div>

      {uredivo && (
        <PretragaProizvoda ref={searchRef} tipovi={['materijal']} onIzaberi={dodaj} nedavnoKljuc="materijal"
          precica="/" placeholder="Dodaj materijal: naziv ili šifra" ariaLabel="Dodaj materijal" className="mt-1 mb-2" />
      )}

      {draft.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center">
          <p className="text-[12.5px] text-slate-500">{uredivo ? 'Nalog još nema stavki.' : 'Nalog nema stavki utroška.'}</p>
          {uredivo && <p className="text-[11.5px] text-slate-400 mt-0.5">Potražite materijal iznad — tipka <Key className="ml-0 mx-0.5">/</Key> otvara pretragu.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full border-separate border-spacing-0 min-w-[640px]">
            <thead>
              <tr>
                <th className={cn(TH, 'text-right w-6 pr-2')}>#</th>
                <th className={cn(TH, 'text-left px-2')}>Materijal</th>
                <th className={cn(TH, 'text-left px-2 w-[26%]')}>Napomena</th>
                <th className={cn(TH, 'text-right px-2 w-[96px]')}>Stanje</th>
                <th className={cn(TH, 'text-right px-2 w-[96px] hidden xl:table-cell')}>Nab. cijena</th>
                <th className={cn(TH, 'text-right px-2 w-[104px] hidden lg:table-cell')}>Iznos</th>
                <th className={cn(TH, 'text-right pl-2', uredivo ? 'w-[190px]' : 'w-[120px]')}>Količina</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((s, i) => {
                const kol = parseDecimal(s.kolicina) || 0;
                const prekoracenje = uredivo && kol > s.stanje;
                const c = cijene.get(s.materijalId);
                return (
                  <tr key={s.materijalId} className="group">
                    <td className={cn(TD, 'text-right pr-2 pt-[11px] font-mono text-[10.5px] tabular-nums text-slate-300')}>{i + 1}</td>
                    <td className={cn(TD, 'px-2 min-w-[180px]')}>
                      <p className="text-[12.5px] font-medium text-slate-800 leading-snug pt-[3px]">{s.naziv}</p>
                      {s.sifra && <p className="text-[10.5px] font-mono text-slate-400">{s.sifra}</p>}
                    </td>
                    <td className={cn(TD, 'px-2')}>
                      {uredivo ? (
                        <Input value={s.napomena} onChange={e => set(i, { napomena: e.target.value })} placeholder="npr. korpus 600×720 ×2"
                          aria-label={`Napomena ${s.naziv}`}
                          className="h-8 text-[11.5px] placeholder:text-slate-300 bg-transparent border-transparent hover:border-slate-200 focus-visible:border-blue-400 focus-visible:bg-white shadow-none px-2 -mx-2 w-[calc(100%+1rem)]" />
                      ) : <p className="text-[11.5px] text-slate-500 pt-[5px]">{s.napomena || <span className="text-slate-300">—</span>}</p>}
                    </td>
                    <td className={cn(TD, 'px-2 text-right pt-[11px] font-mono text-[11.5px] tabular-nums whitespace-nowrap', prekoracenje ? 'text-rose-500 font-medium' : 'text-slate-500')}>
                      {s.stanje} {s.jm}
                      {prekoracenje && <span className="block text-[10px] font-sans font-medium">nedovoljno</span>}
                    </td>
                    <td className={cn(TD, 'hidden xl:table-cell px-2 text-right pt-[11px] font-mono text-[11.5px] tabular-nums text-slate-500')}>
                      {c ? formatKM(c.cijena) : '—'}
                    </td>
                    <td className={cn(TD, 'hidden lg:table-cell px-2 text-right pt-[11px] font-mono text-[12px] tabular-nums text-slate-700')}>
                      {c ? formatKM(c.iznos) : '—'}
                    </td>
                    <td className={cn(TD, 'pl-2 text-right')}>
                      {uredivo ? (
                        <div className="flex items-center justify-end gap-1">
                          {jePloca(s) && (
                            <button title="Elementi (širina × visina × kom)" aria-label={`Elementi ${s.naziv}`} onClick={() => setElementiZa(i)}
                              className="h-8 w-7 flex items-center justify-center rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><Ruler size={14} /></button>
                          )}
                          <DecimalInput maxDecimals={4} value={s.kolicina} onValueChange={t => set(i, { kolicina: t })} placeholder="0"
                            ref={el => { if (el) kolRefs.current.set(s.materijalId, el); else kolRefs.current.delete(s.materijalId); }}
                            aria-label={`Količina ${s.naziv}`}
                            className={cn('h-8 w-[84px] font-mono text-[12.5px] text-right', prekoracenje && 'border-rose-300 text-rose-600 focus-visible:ring-rose-400/40')} />
                          <span className="text-[11px] text-slate-400 w-7 text-left truncate">{s.jm}</span>
                          <button title="Ukloni" aria-label={`Ukloni ${s.naziv}`} onClick={() => ukloni(i)}
                            className="h-8 w-7 flex items-center justify-center rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><X size={14} /></button>
                        </div>
                      ) : (
                        <span className="block pt-[3px] font-mono text-[13px] font-semibold tabular-nums text-slate-900 whitespace-nowrap">{s.kolicina} <span className="text-[11px] font-normal text-slate-400">{s.jm}</span></span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ElementiDialog
        open={elementiZa != null}
        onOpenChange={v => { if (!v) setElementiZa(null); }}
        initial={elementiInitial}
        onConfirm={(m2, nap) => { if (elementiZa != null) set(elementiZa, { kolicina: String(m2), napomena: nap }); }}
      />
    </section>
  );
});
