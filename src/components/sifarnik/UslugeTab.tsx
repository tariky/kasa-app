import { useState, useEffect, useRef } from 'react';
import { Product } from '@/types';
import { cn, formatKM, porukaGreske } from '@/lib/utils';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { useCijenaUnos } from '@/hooks/useCijenaUnos';
import { CijenaPdvPolje } from '@/components/CijenaPdvPolje';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import {
  Plus, Trash2, Search, Pencil, X, Wrench,
} from 'lucide-react';
import { potvrdi, obavijesti } from '@/lib/dijalog';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';

// ---------------------------------------------------------------------------
// Usluga Dialog — simplified for services
// ---------------------------------------------------------------------------

function UslugaDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  onSave: (data: any) => void;
}) {
  const [sifra, setSifra] = useState('');
  const [naziv, setNaziv] = useState('');
  const [pdvStopa, setPdvStopa] = useState<'E' | 'K'>('E');
  const cijena = useCijenaUnos(open, product, pdvStopa);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setSifra(product.sifra);
      setNaziv(product.naziv);
      setPdvStopa(product.pdvStopa);
    } else {
      setSifra('');
      setNaziv('');
      setPdvStopa('E');
    }
  }, [open, product]);

  const isEdit = !!product;
  const cijenaOk = cijena.spremno && cijena.unos !== '' && !isNaN(cijena.bruto);

  const handleSpremi = () => {
    if (!cijenaOk) return;
    onSave({ sifra, naziv, cijena: cijena.bruto, pdvStopa });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isEdit ? 'Uredi uslugu' : 'Nova usluga'}</DialogTitle>
          </div>
          <DialogDescription>
            {isEdit ? 'Izmjenite podatke o usluzi' : 'Dodajte novu uslugu'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Šifra</Label>
            <Input value={sifra} onChange={e => setSifra(e.target.value)} placeholder="USL-001" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>Naziv</Label>
            <Input value={naziv} onChange={e => setNaziv(e.target.value)} placeholder="Naziv usluge" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cijena</Label>
              <CijenaPdvPolje
                unos={cijena.unos}
                onUnos={cijena.setUnos}
                bezPdv={cijena.bezPdv}
                onRezim={cijena.setRezim}
                stopa={pdvStopa}
                bruto={cijena.bruto}
              />
            </div>
            <div className="space-y-2">
              <Label>PDV stopa</Label>
              <Select value={pdvStopa} onValueChange={(v: 'E' | 'K') => setPdvStopa(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="E">E — {PDV_STOPA_E_PCT}%</SelectItem>
                  <SelectItem value="K">K — 0%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button
            onClick={handleSpremi}
            disabled={!sifra || !naziv || !cijenaOk}
          >
            {isEdit ? 'Spremi' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Usluge se traže po nazivu i šifri. */
const poljaUsluge = (p: Product): PoljaPretrage => ({ naziv: p.naziv, sifra: p.sifra });

export function UslugeTab({ usluge, onReload }: { usluge: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<'naziv' | 'cijena'>('naziv');
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = filtriraj(usluge, search, poljaUsluge)
    .sort((a, b) => {
      if (sortBy === 'cijena') return b.cijena - a.cijena;
      return a.naziv.localeCompare(b.naziv);
    });

  const handleNew = () => { setEditProduct(null); setDialogOpen(true); };
  const handleEdit = (p: Product) => { setEditProduct(p); setDialogOpen(true); };
  const handleDelete = async (p: Product) => {
    if (!(await potvrdi(`Obrisati uslugu "${p.naziv}"?`))) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e) { await obavijesti(porukaGreske(e)); }
  };

  const handleDialogOpenChange = (v: boolean) => {
    setDialogOpen(v);
    if (!v) setEditProduct(null);
  };

  const handleSave = async (data: any) => {
    if (editProduct) {
      await window.api.updateProduct(editProduct.id, { ...data, tip: 'usluga' });
    } else {
      await window.api.createProduct({ ...data, tip: 'usluga' });
    }
    setDialogOpen(false);
    setEditProduct(null);
    onReload();
  };

  // "/" pretraga, "N" nova usluga — isto kao na listi artikala.
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
            placeholder="Naziv ili šifra usluge…"
            aria-label="Pretraga usluga"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
          <span className="hidden md:inline">Poredaj</span>
          <SegmentedFilter
            options={[{ id: 'naziv', label: 'A–Z' }, { id: 'cijena', label: 'Cijena' }]}
            value={sortBy} onChange={setSortBy} />
        </div>

        <span className="text-[11.5px] text-slate-400 whitespace-nowrap">
          {search ? <><span className="font-mono tabular-nums text-slate-600">{filtered.length}</span> od </> : 'Ukupno '}
          <span className="font-mono tabular-nums text-slate-600">{usluge.length}</span>
        </span>

        <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 pl-3 pr-2 text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Nova usluga <Key tone="dark">N</Key>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Wrench size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema usluga'}</p>
          {!search && <p className="text-[12px] text-slate-400 mt-0.5">Prvu uslugu dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <table className="w-full border-separate border-spacing-0">
            <LedgerHead columns={[
              { label: 'Šifra', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
              { label: 'Naziv', className: 'text-left px-3' },
              { label: 'PDV', className: 'text-center px-3 w-[70px] hidden lg:table-cell' },
              { label: 'Cijena', className: 'text-right px-3 w-[120px]' },
              { label: '', className: 'pr-6 pl-2 w-[1%]' },
            ]} />
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="group transition-colors hover:bg-slate-50 cursor-pointer"
                  onClick={() => handleEdit(p)}
                >
                  <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{p.sifra}</td>
                  <td className={cn(td, 'px-3 max-w-0')}>
                    <span className="block truncate text-[12.5px] font-medium text-slate-800">{p.naziv}</span>
                  </td>
                  <td className={cn(td, 'hidden lg:table-cell px-3 text-center font-mono text-[11px] whitespace-nowrap')}>
                    <span className="font-semibold text-slate-600">{p.pdvStopa}</span>
                    <span className="text-slate-400"> {p.pdvStopa === 'E' ? `${PDV_STOPA_E_PCT}%` : '0%'}</span>
                  </td>
                  <td className={cn(td, 'px-3 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                    {formatKM(p.cijena)}
                  </td>
                  <td className={cn(td, 'pr-6 pl-2 text-right')}>
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" title="Uredi" aria-label={`Uredi ${p.naziv}`}
                        onClick={(e) => { e.stopPropagation(); handleEdit(p); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Obriši" aria-label={`Obriši ${p.naziv}`}
                        onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}

      <UslugaDialog
        key={editProduct?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        product={editProduct}
        onSave={handleSave}
      />
    </div>
  );
}
