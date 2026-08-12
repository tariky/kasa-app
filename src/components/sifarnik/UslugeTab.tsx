import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { uBruto, uNetto } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Plus, Trash2, Search, Pencil, X, Wrench,
} from 'lucide-react';

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
  const [cijena, setCijena] = useState('');
  const [pdvStopa, setPdvStopa] = useState<'E' | 'K'>('E');
  const bezPdv = useUnosBezPdv(open);
  // Tekst koji je pri otvaranju stavljen u polje — prepoznaje da cijena nije dirana.
  const [cijenaInit, setCijenaInit] = useState('');

  useEffect(() => {
    // Dok se postavka učitava ne diramo formu — inače bismo cijenu prikazali
    // u pogrešnoj jedinici pa je pregazili kad postavka stigne.
    if (!open || bezPdv === null) return;
    if (product) {
      const prikaz = String(bezPdv ? uNetto(product.cijena, product.pdvStopa) : product.cijena);
      setSifra(product.sifra);
      setNaziv(product.naziv);
      setCijena(prikaz);
      setCijenaInit(prikaz);
      setPdvStopa(product.pdvStopa);
    } else {
      setSifra('');
      setNaziv('');
      setCijena('');
      setCijenaInit('');
      setPdvStopa('E');
    }
  }, [open, product, bezPdv]);

  const isEdit = !!product;
  // Režim "bez PDV-a" vrijedi samo za stopu E — kod K (0 %) bi oznaka
  // "bez PDV-a" bila obmanjujuća.
  const nettoRezim = bezPdv === true && pdvStopa === 'E';
  const cijenaBroj = parseDecimal(cijena);
  const previewBruto = nettoRezim && !isNaN(cijenaBroj) && cijena !== ''
    ? uBruto(cijenaBroj, pdvStopa)
    : null;

  const handleSpremi = () => {
    // Uslov je napisan kao `product && ...` (a ne izdvojen u boolean varijablu)
    // da bi TypeScript suzio `product` sa `Product | null` na `Product` u
    // `true` grani — inače `product.cijena` puca na "possibly null".
    const cijenaZaBazu =
      product && cijena === cijenaInit && pdvStopa === product.pdvStopa
        ? product.cijena
        : bezPdv
          ? uBruto(parseDecimal(cijena), pdvStopa)
          : parseDecimal(cijena);
    onSave({ sifra, naziv, cijena: cijenaZaBazu, pdvStopa });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isEdit ? 'Uredi uslugu' : 'Nova usluga'}</DialogTitle>
            {nettoRezim && (
              <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                bez PDV-a
              </Badge>
            )}
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
              <Label>{nettoRezim ? 'Cijena bez PDV-a' : 'Cijena'}</Label>
              <DecimalInput value={cijena} onValueChange={text => setCijena(text)} placeholder="0,00" className="font-mono" />
              {previewBruto !== null && (
                <p className="text-[11px] text-slate-400 font-mono">
                  Sa PDV-om: {formatKM(previewBruto)}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>PDV stopa</Label>
              <Select value={pdvStopa} onValueChange={(v: 'E' | 'K') => setPdvStopa(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="E">E — 17%</SelectItem>
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
            disabled={!sifra || !naziv || !cijena || isNaN(parseDecimal(cijena))}
          >
            {isEdit ? 'Spremi' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UslugeTab({ usluge, onReload }: { usluge: Product[]; onReload: () => void }) {
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<'naziv' | 'cijena'>('naziv');

  const filtered = usluge
    .filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.naziv.toLowerCase().includes(q) || p.sifra.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'cijena') return b.cijena - a.cijena;
      return a.naziv.localeCompare(b.naziv);
    });

  const handleNew = () => { setEditProduct(null); setDialogOpen(true); };
  const handleEdit = (p: Product) => { setEditProduct(p); setDialogOpen(true); };
  const handleDelete = async (p: Product) => {
    if (!confirm(`Obrisati uslugu "${p.naziv}"?`)) return;
    await window.api.deleteProduct(p.id);
    onReload();
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 px-6 py-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Pretraži usluge..."
                className="pl-9 h-8 text-[13px] bg-slate-50 border-slate-200"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
              {(['naziv', 'cijena'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150',
                    sortBy === key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {key === 'naziv' ? 'A-Z' : 'Cijena'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Usluge</span>
              {usluge.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                  {usluge.length}
                </Badge>
              )}
            </div>

            <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Nova usluga
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <Wrench size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema usluga'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvu uslugu klikom na dugme iznad</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5 w-[80px]">Šifra</th>
                    <th className="text-left px-2 py-2.5">Naziv</th>
                    <th className="text-right px-2 py-2.5 w-[100px]">Cijena</th>
                    <th className="text-center px-2 py-2.5 w-[60px]">PDV</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr
                      key={p.id}
                      className="group border-t border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => handleEdit(p)}
                    >
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400">{p.sifra}</td>
                      <td className="px-2 py-2.5 text-[12px] font-medium text-slate-700">{p.naziv}</td>
                      <td className="px-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums text-slate-800">
                        {formatKM(p.cijena)}
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <span className={cn(
                          'inline-flex items-center justify-center w-10 h-5 rounded text-[10px] font-semibold',
                          p.pdvStopa === 'E'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                        )}>
                          {p.pdvStopa === 'E' ? '17%' : '0%'}
                        </span>
                      </td>
                      <td className="pr-5 pl-2 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); handleEdit(p); }}>
                            <Pencil className="h-3 w-3 mr-1" /> Uredi
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
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
