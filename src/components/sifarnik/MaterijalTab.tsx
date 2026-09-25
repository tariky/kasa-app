import { useState, useEffect, useRef } from 'react';
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
import { Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import { Plus, Trash2, Search, Pencil, X, Layers } from 'lucide-react';
import { potvrdi } from '@/lib/dijalog';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';

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
          <DialogDescription>Materijal se nabavlja ulazom robe i troši na radnim nalozima; ne prodaje se na kasi.</DialogDescription>
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

type StanjeFilter = 'svi' | 'nema';

const STANJE_FILTERI: { id: StanjeFilter; label: string }[] = [
  { id: 'svi', label: 'Svi' },
  { id: 'nema', label: 'Nema na stanju' },
];

/** Materijal se traži po nazivu i šifri. */
const poljaMaterijala = (p: Product): PoljaPretrage => ({ naziv: p.naziv, sifra: p.sifra });

export function MaterijalTab({ materijali, onReload }: { materijali: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState<StanjeFilter>('svi');
  const searchRef = useRef<HTMLInputElement>(null);

  const trazeni = filtriraj(materijali, search, poljaMaterijala);
  // Brojači idu po pretrazi, kao na listi artikala.
  const counts: Record<StanjeFilter, number> = { svi: trazeni.length, nema: trazeni.filter(p => (p.stanje ?? 0) <= 0).length };
  const filtered = trazeni
    .filter(p => filter === 'svi' || (p.stanje ?? 0) <= 0)
    .sort((a, b) => a.naziv.localeCompare(b.naziv));

  const handleNew = () => { setEdit(null); setDialogOpen(true); };
  const handleEdit = (p: Product) => { setEdit(p); setDialogOpen(true); };

  const handleSave = async (data: any) => {
    if (edit) await window.api.updateProduct(edit.id, { ...data, tip: 'materijal' });
    else await window.api.createProduct({ ...data, cijena: 0, pdvStopa: 'E', tip: 'materijal' });
    setDialogOpen(false); setEdit(null); onReload();
  };

  const handleDelete = async (p: Product) => {
    if (!(await potvrdi(`Obrisati materijal "${p.naziv}"?`))) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e: any) { setMsg(e?.message || 'Greška'); }
  };

  // "/" pretraga, "N" novi materijal — isto kao na listi artikala.
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (t === searchRef.current && e.key === 'Escape') { setSearch(''); t.blur(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); handleNew(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen]);

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Naziv ili šifra materijala…"
            aria-label="Pretraga materijala"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <SegmentedFilter options={STANJE_FILTERI} value={filter} onChange={setFilter} counts={counts} />

        <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 pl-3 pr-2 text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Novi materijal <Key tone="dark">N</Key>
        </Button>
      </div>
      {msg && <p className="flex-shrink-0 px-6 py-2 text-[12px] text-rose-600 bg-rose-50 border-b border-rose-100">{msg}</p>}

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Layers size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">
            {search ? 'Nema rezultata pretrage' : filter !== 'svi' ? 'Nema materijala u ovom filteru' : 'Nema materijala'}
          </p>
          {!search && filter === 'svi' && (
            <p className="text-[12px] text-slate-400 mt-0.5">Ploče, kant traku i okove dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <table className="w-full border-separate border-spacing-0">
            <LedgerHead columns={[
              { label: 'Šifra', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
              { label: 'Naziv', className: 'text-left px-3' },
              { label: 'JM', className: 'text-left px-3 w-[70px] hidden lg:table-cell' },
              { label: 'Ploča', className: 'text-left px-3 w-[130px] hidden xl:table-cell' },
              { label: 'Stanje', className: 'text-right px-3 w-[150px]' },
              { label: '', className: 'pr-6 pl-2 w-[1%]' },
            ]} />
            <tbody>
              {filtered.map(p => {
                const stanje = p.stanje ?? 0;
                const nema = stanje <= 0;
                const ploca = jePloca(p);
                return (
                  <tr key={p.id} className="group transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => handleEdit(p)}>
                    <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{p.sifra}</td>
                    <td className={cn(td, 'px-3 max-w-0')}>
                      <span className="block truncate text-[12.5px] font-medium text-slate-800">{p.naziv}</span>
                      {ploca && <span className="xl:hidden block font-mono text-[10.5px] text-slate-400 truncate">{p.plocaSirina}×{p.plocaVisina} mm</span>}
                    </td>
                    <td className={cn(td, 'hidden lg:table-cell px-3 text-[12px] text-slate-500 whitespace-nowrap')}>{p.jm}</td>
                    <td className={cn(td, 'hidden xl:table-cell px-3 font-mono text-[11.5px] text-slate-400 whitespace-nowrap')}>
                      {ploca ? `${p.plocaSirina}×${p.plocaVisina}` : <span className="text-slate-200">—</span>}
                    </td>
                    <td className={cn(td, 'px-3 text-right whitespace-nowrap')}>
                      <span className="flex items-baseline justify-end gap-1.5 font-mono text-[12.5px] tabular-nums leading-5">
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full self-center', nema ? 'bg-rose-500' : 'bg-emerald-500')} />
                        <span className={cn('font-semibold', nema ? 'text-rose-600' : 'text-slate-800')}>
                          {ploca ? stanje.toFixed(2).replace('.', ',') : stanje}
                        </span>
                        <span className="text-[11px] text-slate-400">{p.jm}</span>
                      </span>
                      {ploca && (
                        <span className="block font-mono text-[10px] tabular-nums text-slate-400">
                          ≈ {m2UKom(stanje, p.plocaSirina!, p.plocaVisina!)} ploča
                        </span>
                      )}
                    </td>
                    <td className={cn(td, 'pr-6 pl-2 text-right')}>
                      <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" title="Uredi" aria-label={`Uredi ${p.naziv}`}
                          onClick={e => { e.stopPropagation(); handleEdit(p); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Obriši" aria-label={`Obriši ${p.naziv}`}
                          onClick={e => { e.stopPropagation(); handleDelete(p); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      )}
      <MaterijalDialog key={edit?.id ?? 'new'} open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEdit(null); }} product={edit} onSave={handleSave} />
    </div>
  );
}
