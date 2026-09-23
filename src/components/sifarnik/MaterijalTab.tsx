import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { cn } from '@/lib/utils';
import { jePloca, m2PoPloci, m2UKom, JM_PLOCA } from '@/lib/ploca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Search, Pencil, X, Layers } from 'lucide-react';

const JEDINICE = [JM_PLOCA, 'kom', 'm', 'kg', 'l', 'pak'] as const;

function MaterijalDialog({ open, onOpenChange, product, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; product: Product | null;
  onSave: (data: { sifra: string; naziv: string; jm: string; plocaSirina: number | null; plocaVisina: number | null }) => Promise<void>;
}) {
  const [sifra, setSifra] = useState('');
  const [naziv, setNaziv] = useState('');
  const [jm, setJm] = useState<string>(JM_PLOCA);
  const [sirina, setSirina] = useState('');
  const [visina, setVisina] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (product) {
      setSifra(product.sifra); setNaziv(product.naziv); setJm(product.jm);
      setSirina(product.plocaSirina ? String(product.plocaSirina) : '');
      setVisina(product.plocaVisina ? String(product.plocaVisina) : '');
    } else {
      setSifra(''); setNaziv(''); setJm(JM_PLOCA); setSirina(''); setVisina('');
    }
  }, [open, product]);

  const jeM2 = jm === JM_PLOCA;
  const s = parseInt(sirina, 10); const v = parseInt(visina, 10);
  const dimOk = jeM2 && s > 0 && v > 0;

  const spremi = async () => {
    try {
      await onSave({
        sifra: sifra.trim(), naziv: naziv.trim(), jm,
        plocaSirina: dimOk ? s : null, plocaVisina: dimOk ? v : null,
      });
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{product ? 'Uredi materijal' : 'Novi materijal'}</DialogTitle>
          <DialogDescription>Materijal se nabavlja primkom i troši na radnim nalozima; ne prodaje se na kasi.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-[120px_1fr] gap-4">
            <div className="space-y-2">
              <Label>Šifra</Label>
              <Input value={sifra} onChange={e => setSifra(e.target.value)} placeholder="IV-18-B" className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>Naziv</Label>
              <Input value={naziv} onChange={e => setNaziv(e.target.value)} placeholder="Iverica bijela 18 mm" autoFocus />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Jedinica mjere</Label>
            <Select value={jm} onValueChange={setJm}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {JEDINICE.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {jeM2 && (
            <div className="space-y-2">
              <Label>Dimenzija ploče (mm) <span className="text-slate-400 font-normal">— opciono</span></Label>
              <div className="flex items-center gap-2">
                <Input value={sirina} onChange={e => setSirina(e.target.value.replace(/\D/g, ''))} placeholder="2800" className="font-mono w-28" />
                <span className="text-slate-400">×</span>
                <Input value={visina} onChange={e => setVisina(e.target.value.replace(/\D/g, ''))} placeholder="2070" className="font-mono w-28" />
                {dimOk && <span className="text-[12px] text-slate-500 font-mono">= {m2PoPloci(s, v)} m²/ploči</span>}
              </div>
              <p className="text-[11px] text-slate-400">
                S dimenzijom se ploče na primci unose u komadima, a app ih preračuna u m².
              </p>
            </div>
          )}
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button onClick={spremi} disabled={!sifra.trim() || !naziv.trim()}>{product ? 'Spremi' : 'Dodaj'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterijalTab({ materijali, onReload }: { materijali: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [msg, setMsg] = useState('');

  const filtered = materijali
    .filter(p => !search || p.naziv.toLowerCase().includes(search.toLowerCase()) || p.sifra.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.naziv.localeCompare(b.naziv));

  const handleSave = async (data: any) => {
    if (edit) await window.api.updateProduct(edit.id, { ...data, tip: 'materijal' });
    else await window.api.createProduct({ ...data, cijena: 0, pdvStopa: 'E', tip: 'materijal' });
    setDialogOpen(false); setEdit(null); onReload();
  };

  const handleDelete = async (p: Product) => {
    if (!confirm(`Obrisati materijal "${p.naziv}"?`)) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e: any) { setMsg(e?.message || 'Greška'); }
  };

  const prikazStanja = (p: Product) => {
    const st = p.stanje ?? 0;
    if (jePloca(p)) return `${st.toFixed(2)} m² (≈ ${m2UKom(st, p.plocaSirina!, p.plocaVisina!)} pl.)`;
    return `${st} ${p.jm}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 px-6 py-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži materijal..." className="pl-9 h-8 text-[13px] bg-slate-50 border-slate-200" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Materijal</span>
              {materijali.length > 0 && <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">{materijali.length}</Badge>}
            </div>
            <Button size="sm" onClick={() => { setEdit(null); setDialogOpen(true); }} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Novi materijal
            </Button>
          </div>
          {msg && <p className="px-5 py-2 text-[12px] text-rose-600 bg-rose-50 border-b border-rose-100">{msg}</p>}

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Layers size={24} className="text-slate-300" /></div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata' : 'Nema materijala'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte ploče, kant traku, okove…</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5 w-[90px]">Šifra</th>
                    <th className="text-left px-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[60px]">JM</th>
                    <th className="text-left px-2 py-2.5 w-[120px]">Ploča</th>
                    <th className="text-right px-2 py-2.5 w-[170px]">Stanje</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className="group border-t border-slate-50 hover:bg-slate-50/50 cursor-pointer" onClick={() => { setEdit(p); setDialogOpen(true); }}>
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400">{p.sifra}</td>
                      <td className="px-2 py-2.5 text-[12px] font-medium text-slate-700">{p.naziv}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500">{p.jm}</td>
                      <td className="px-2 py-2.5 text-[11px] font-mono text-slate-400">
                        {jePloca(p) ? `${p.plocaSirina}×${p.plocaVisina}` : '—'}
                      </td>
                      <td className={cn('px-2 py-2.5 text-[12px] font-mono text-right tabular-nums', (p.stanje ?? 0) <= 0 ? 'text-rose-500' : 'text-slate-700')}>
                        {prikazStanja(p)}
                      </td>
                      <td className="pr-5 pl-2 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); setEdit(p); setDialogOpen(true); }}><Pencil className="h-3 w-3 mr-1" /> Uredi</Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={e => { e.stopPropagation(); handleDelete(p); }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>
      <MaterijalDialog key={edit?.id ?? 'new'} open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEdit(null); }} product={edit} onSave={handleSave} />
    </div>
  );
}
