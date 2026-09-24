// src/components/skladiste/UlazStavkeEditor.tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Product } from '@/types';
import { praznaStavka, redStatus, trebaProdajnu, type UlazRed, type Nedostaje } from '@/lib/ulaz';
import { jePloca, komUM2 } from '@/lib/ploca';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Key } from '@/components/ui/ledger';
import { Search, X, Plus } from 'lucide-react';

export interface UlazStavkeHandle {
  /** Doda prazan red (ako zadnji nije već prazan) i stavi fokus na njegovu pretragu. */
  noviRed: () => void;
}

const TH = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 pb-2 border-b border-slate-200/80 whitespace-nowrap';
const TD = 'py-1.5 border-b border-slate-100 align-top';
const CELL_INPUT = 'h-8 font-mono text-[12.5px] text-right bg-white';
const MISSING = 'border-amber-300 bg-amber-50/40 focus-visible:ring-amber-400/40';

type Polje = 'artikal' | 'kolicina' | 'nabavna' | 'rabat' | 'prodajna';

function pretrazi(products: Product[], q: string): Product[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const rijeci = s.split(/\s+/);
  return products
    .filter(p => rijeci.every(r => p.naziv.toLowerCase().includes(r) || p.sifra.toLowerCase().includes(r) || (p.barkod ?? '').toLowerCase().includes(r)))
    .slice(0, 12);
}

/**
 * Redovi ulaza kao tabela u kojoj se kuca: artikal se traži po nazivu/šifri (↑↓ ↵), ↵ vodi
 * na sljedeće polje, a ↵ na zadnjem polju zadnjeg reda otvara novi red. Polja koja fale
 * da bi red bio potpun su označena — zato dugme "Spremi" nikad nije nijemo ugašeno.
 */
export const UlazStavkeEditor = forwardRef<UlazStavkeHandle, {
  rows: UlazRed[]; onChange: (rows: UlazRed[]) => void; products: Product[];
}>(function UlazStavkeEditor({ rows, onChange, products }, ref) {
  const [query, setQuery] = useState<Record<number, string>>({});
  const [active, setActive] = useState(0);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const pendingFocus = useRef<string | null>(null);
  const key = (i: number, polje: Polje) => `${i}:${polje}`;
  const reg = (i: number, polje: Polje) => (el: HTMLInputElement | null) => { if (el) inputs.current.set(key(i, polje), el); else inputs.current.delete(key(i, polje)); };
  const focus = (i: number, polje: Polje) => { const el = inputs.current.get(key(i, polje)); el?.focus(); el?.select(); };

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = inputs.current.get(pendingFocus.current);
    pendingFocus.current = null;
    el?.focus();
  }, [rows]);

  const set = (i: number, patch: Partial<UlazRed>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ukloni = (i: number) => onChange(rows.length === 1 ? [praznaStavka()] : rows.filter((_, j) => j !== i));
  const dodajRed = (): number => {
    const zadnji = rows[rows.length - 1];
    if (zadnji && redStatus(zadnji, products).stanje === 'prazan') return rows.length - 1;
    onChange([...rows, praznaStavka()]);
    return rows.length;
  };
  const noviRed = () => { const i = dodajRed(); pendingFocus.current = key(i, 'artikal'); if (i < rows.length) focus(i, 'artikal'); };
  useImperativeHandle(ref, () => ({ noviRed }));

  const odaberi = (i: number, p: Product) => {
    set(i, { productId: p.id, cijena: trebaProdajnu(p) ? String(p.cijena) : '' });
    setQuery(q => ({ ...q, [i]: '' })); setOpenRow(null);
    pendingFocus.current = key(i, 'kolicina');
  };

  const poljaReda = (p: Product | undefined): Polje[] => (trebaProdajnu(p) ? ['kolicina', 'nabavna', 'rabat', 'prodajna'] : ['kolicina', 'nabavna']);

  /** ↵ u polju: sljedeće polje u redu, a sa zadnjeg polja zadnjeg reda — novi red. */
  const onEnter = (i: number, polje: Polje) => {
    const p = products.find(x => x.id === rows[i].productId);
    const polja = poljaReda(p);
    const idx = polja.indexOf(polje);
    if (idx >= 0 && idx < polja.length - 1) return focus(i, polja[idx + 1]);
    if (i < rows.length - 1) return focus(i + 1, rows[i + 1].productId ? 'kolicina' : 'artikal');
    noviRed();
  };

  const rezultati = useMemo(() => (openRow != null ? pretrazi(products, query[openRow] ?? '') : []), [openRow, query, products]);

  const onSearchKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { if (query[i]) { setQuery(q => ({ ...q, [i]: '' })); } return; }
    if (rezultati.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(rezultati.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); odaberi(i, rezultati[active]); }
  };

  const fali = (i: number, sta: Nedostaje) => { const s = redStatus(rows[i], products); return s.stanje === 'nepotpun' && s.nedostaje.includes(sta); };

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-separate border-spacing-0 min-w-[720px]">
        <thead>
          <tr>
            <th className={cn(TH, 'text-right w-6 pr-2')}>#</th>
            <th className={cn(TH, 'text-left px-2')}>Artikal</th>
            <th className={cn(TH, 'text-right px-2 w-[118px]')}>Količina</th>
            <th className={cn(TH, 'text-right px-2 w-[108px]')}>Nabavna</th>
            <th className={cn(TH, 'text-right px-2 w-[76px]')}>Rabat %</th>
            <th className={cn(TH, 'text-right px-2 w-[108px]')}>Prodajna</th>
            <th className={cn(TH, 'text-right px-2 w-[104px] hidden lg:table-cell')}>Iznos</th>
            <th className={cn(TH, 'w-8')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = products.find(x => x.id === r.productId);
            const kol = parseDecimal(r.kolicina) || 0;
            const nab = parseDecimal(r.nabavnaCijena) || 0;
            const prodajna = trebaProdajnu(p);
            const jeMat = !!p && !prodajna;
            return (
              <tr key={i} className="group">
                <td className={cn(TD, 'text-right pr-2 pt-[11px] font-mono text-[10.5px] tabular-nums text-slate-300')}>{i + 1}</td>
                <td className={cn(TD, 'px-2 min-w-[220px]')}>
                  {p ? (
                    <button type="button" onClick={() => { set(i, { productId: null, cijena: '' }); setOpenRow(i); pendingFocus.current = key(i, 'artikal'); }}
                      title="Promijeni artikal"
                      className="w-full text-left rounded-md px-2 py-1 -mx-2 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
                      <span className="block text-[12.5px] font-medium text-slate-800 leading-snug">{p.naziv}</span>
                      <span className="block text-[10.5px] font-mono text-slate-400">
                        {p.sifra}
                        {jeMat && <span className="ml-1.5 font-sans font-semibold text-violet-500">materijal</span>}
                        {jePloca(p) && <span className="ml-1.5 font-sans text-slate-400">ploča {p.plocaSirina}×{p.plocaVisina}</span>}
                      </span>
                    </button>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                      <Input ref={reg(i, 'artikal')} value={query[i] ?? ''} role="combobox" aria-label={`Artikal red ${i + 1}`}
                        aria-expanded={openRow === i && rezultati.length > 0} aria-autocomplete="list"
                        onChange={e => { setQuery(q => ({ ...q, [i]: e.target.value })); setOpenRow(i); setActive(0); }}
                        onFocus={() => setOpenRow(i)} onBlur={() => setTimeout(() => setOpenRow(o => (o === i ? null : o)), 120)}
                        onKeyDown={e => onSearchKey(i, e)}
                        placeholder="Naziv, šifra ili barkod…"
                        className={cn('pl-8 h-8 text-[12.5px] bg-slate-50 focus-visible:bg-white', fali(i, 'artikal') && MISSING)} />
                      {openRow === i && rezultati.length > 0 && (
                        <ul role="listbox" className="absolute left-0 z-20 mt-1 w-[min(520px,90vw)] rounded-lg border border-slate-200 bg-white shadow-lg shadow-slate-900/10 max-h-64 overflow-auto py-1">
                          {rezultati.map((m, k) => (
                            <li key={m.id} role="option" aria-selected={k === active}
                              onMouseEnter={() => setActive(k)} onMouseDown={e => e.preventDefault()} onClick={() => odaberi(i, m)}
                              className={cn('flex items-center gap-3 px-3 py-2 text-[12px] cursor-pointer', k === active ? 'bg-blue-50 text-slate-900' : 'text-slate-700')}>
                              <span className="font-mono text-[11px] text-slate-400 w-[72px] flex-shrink-0 truncate">{m.sifra}</span>
                              <span className="min-w-0 flex-1 truncate">{m.naziv}</span>
                              {m.tip === 'materijal'
                                ? <span className="text-[10px] font-semibold text-violet-500 flex-shrink-0">materijal</span>
                                : <span className="font-mono text-[11px] tabular-nums text-slate-400 flex-shrink-0">{formatKM(m.cijena)}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </td>
                <td className={cn(TD, 'px-2')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <DecimalInput ref={reg(i, 'kolicina')} maxDecimals={3} value={r.kolicina} onValueChange={t => set(i, { kolicina: t })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'kolicina'); } }}
                      placeholder="0" aria-label={`Količina red ${i + 1}`}
                      className={cn(CELL_INPUT, 'w-[72px]', fali(i, 'kolicina') && MISSING)} />
                    <span className="text-[11px] text-slate-400 w-7 truncate">{p ? (jePloca(p) ? 'kom' : p.jm) : ''}</span>
                  </div>
                  {p && jePloca(p) && kol > 0 && (
                    <span className="block text-right pr-[34px] text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">= {komUM2(kol, p.plocaSirina!, p.plocaVisina!)} m²</span>
                  )}
                </td>
                <td className={cn(TD, 'px-2')}>
                  <DecimalInput ref={reg(i, 'nabavna')} value={r.nabavnaCijena} onValueChange={t => set(i, { nabavnaCijena: t })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'nabavna'); } }}
                    placeholder={p && jePloca(p) ? 'po ploči' : '0,00'} aria-label={`Nabavna cijena red ${i + 1}`}
                    className={cn(CELL_INPUT, 'w-full', fali(i, 'nabavna') && MISSING)} />
                </td>
                <td className={cn(TD, 'px-2')}>
                  <DecimalInput ref={reg(i, 'rabat')} value={r.rabat} onValueChange={t => set(i, { rabat: t })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'rabat'); } }}
                    placeholder="0" aria-label={`Rabat red ${i + 1}`} disabled={jeMat}
                    className={cn(CELL_INPUT, 'w-full', jeMat && 'invisible')} />
                </td>
                <td className={cn(TD, 'px-2')}>
                  {jeMat ? (
                    <span className="block h-8 leading-8 text-right text-[11px] text-slate-400 pr-1" title="Materijal se ne prodaje na kasi">bez prodajne</span>
                  ) : (
                    <DecimalInput ref={reg(i, 'prodajna')} value={r.cijena} onValueChange={t => set(i, { cijena: t })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'prodajna'); } }}
                      placeholder="0,00" aria-label={`Prodajna cijena red ${i + 1}`} disabled={!p}
                      className={cn(CELL_INPUT, 'w-full', fali(i, 'prodajna') && MISSING)} />
                  )}
                </td>
                <td className={cn(TD, 'hidden lg:table-cell px-2 text-right pt-[11px] font-mono text-[12px] tabular-nums text-slate-700 whitespace-nowrap')}>
                  {kol > 0 && r.nabavnaCijena ? formatKM(kol * nab) : <span className="text-slate-300">—</span>}
                </td>
                <td className={cn(TD, 'text-right')}>
                  <button type="button" title="Ukloni red" aria-label={`Ukloni red ${i + 1}`} onClick={() => ukloni(i)}
                    className="h-8 w-7 flex items-center justify-center rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><X size={14} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={noviRed}
        className="mt-2 h-8 flex items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
        <Plus size={13} /> Dodaj red <Key className="ml-0.5">/</Key>
      </button>
    </div>
  );
});
