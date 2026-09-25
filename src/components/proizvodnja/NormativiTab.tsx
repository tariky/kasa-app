// src/components/proizvodnja/NormativiTab.tsx
import { useEffect, useState } from 'react';
import type { NormativStavka, Product } from '@/types';
import { cn, parseDecimal } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eyebrow } from '@/components/ui/ledger';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { filtriraj, uvecajKolicinu, type PoljaPretrage } from '@/lib/pretraga';
import { Search, X, Save, ClipboardList, AlertTriangle } from 'lucide-react';

interface Red { materijalId: number; naziv: string; sifra: string; jm: string; kolicina: string; napomena: string }

/** Normativ = utrošak materijala za 1 kom standardnog proizvoda; predložak za nalog za zalihu. */
/** Lista artikala za normativ se traži po nazivu i šifri. */
const poljaArtikla = (a: Product): PoljaPretrage => ({ naziv: a.naziv, sifra: a.sifra });

export function NormativiTab() {
  const [artikli, setArtikli] = useState<Product[]>([]);
  const [filter, setFilter] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [redovi, setRedovi] = useState<Red[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { window.api.getProducts('artikal').then(setArtikli); }, []);

  const odaberi = async (id: number) => {
    setProductId(id); setMsg(null);
    try {
      const n: NormativStavka[] = await window.api.getNormativ(id);
      setRedovi(n.map(s => ({ materijalId: s.materijalId, naziv: s.materijalNaziv ?? '', sifra: s.materijalSifra ?? '', jm: s.materijalJm ?? '', kolicina: String(s.kolicina), napomena: s.napomena ?? '' })));
      setDirty(false);
    } catch (e: any) {
      setRedovi([]); setDirty(false);
      setMsg({ type: 'error', text: e?.message || 'Greška pri učitavanju normativa' });
    }
  };

  const dodaj = (m: Product, kol: number | null) => {
    const k = kol != null ? String(kol).replace('.', ',') : '';
    setRedovi(r => r.some(x => x.materijalId === m.id)
      ? (k ? r.map(x => (x.materijalId === m.id ? { ...x, kolicina: uvecajKolicinu(x.kolicina, kol!) } : x)) : r)
      : [...r, { materijalId: m.id, naziv: m.naziv, sifra: m.sifra, jm: m.jm, kolicina: k, napomena: '' }]);
    setDirty(true);
  };
  const set = (i: number, patch: Partial<Red>) => { setRedovi(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };

  const spremi = async () => {
    if (productId == null) return;
    try {
      await window.api.saveNormativ(productId, redovi.map(r => ({ materijalId: r.materijalId, kolicina: parseDecimal(r.kolicina) || 0, napomena: r.napomena || null })));
      setDirty(false); setMsg({ type: 'success', text: 'Normativ spremljen' });
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  const listaArtikala = filtriraj(artikli, filter, poljaArtikla);
  const odabrani = artikli.find(a => a.id === productId);

  return (
    <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">
      <div className="w-[340px] flex-shrink-0 bg-white rounded-2xl border border-slate-200/70 shadow-sm flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 relative">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Proizvod…" className="pl-8 h-8 text-[12.5px] bg-slate-50" />
        </div>
        <ScrollArea className="flex-1">
          {listaArtikala.map(a => (
            <button key={a.id} onClick={() => odaberi(a.id)}
              className={cn('w-full text-left px-4 py-2.5 border-b border-slate-50 text-[12px] hover:bg-slate-50', productId === a.id && 'bg-blue-50/80 text-blue-700')}>
              <span className="font-mono text-slate-400 mr-2">{a.sifra}</span>{a.naziv}
            </button>
          ))}
        </ScrollArea>
      </div>

      <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200/70 shadow-sm flex flex-col overflow-hidden">
        {!odabrani ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
            <ClipboardList size={22} className="text-slate-300 mb-2" />
            <p className="text-[13px] font-medium text-slate-500">Odaberite proizvod</p>
            <p className="text-[12px]">Normativ je utrošak materijala za jedan komad.</p>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-3 border-b border-slate-100">
              <Eyebrow>Normativ za 1 kom</Eyebrow>
              <h3 className="text-[16px] font-semibold text-slate-800 mt-0.5">{odabrani.naziv}</h3>
            </div>
            <div className="px-5 py-2">
              <PretragaProizvoda tipovi={['materijal']} onIzaberi={dodaj} nedavnoKljuc="materijal"
                velicina="sm" placeholder="Dodaj materijal: naziv ili šifra" />
            </div>
            <ScrollArea className="flex-1">
              <div className="divide-y divide-slate-50">
                {redovi.length === 0 && <p className="px-5 py-4 text-[12px] text-slate-400">Nema stavki. Dodajte materijal iznad.</p>}
                {redovi.map((r, i) => (
                  <div key={r.materijalId} className="px-5 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-slate-700 truncate">{r.naziv}</p>
                      <Input value={r.napomena} onChange={e => set(i, { napomena: e.target.value })} placeholder="Napomena" className="mt-0.5 h-6 text-[11px] bg-transparent border-0 border-b border-slate-100 rounded-none px-0 shadow-none" />
                    </div>
                    <DecimalInput maxDecimals={4} value={r.kolicina} onValueChange={t => set(i, { kolicina: t })} className="h-8 w-24 font-mono text-sm text-right" placeholder="0" />
                    <span className="text-[11px] text-slate-400 w-7">{r.jm}</span>
                    <button onClick={() => { setRedovi(x => x.filter((_, j) => j !== i)); setDirty(true); }} className="h-8 w-8 flex items-center justify-center rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              {msg && (
                <span className={cn('flex items-center gap-1 text-[11.5px]', msg.type === 'error' ? 'text-rose-600' : 'text-emerald-600')}>
                  {msg.type === 'error' && <AlertTriangle size={12} />} {msg.text}
                </span>
              )}
              <Button size="sm" className="ml-auto h-8 gap-1.5 text-[12px]" onClick={spremi} disabled={!dirty}><Save className="h-3.5 w-3.5" /> Spremi normativ</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
