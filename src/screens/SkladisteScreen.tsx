import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Product, Primka, Dobavljac } from '@/types';
import { cn, formatKM, formatDate, parseDecimal, porukaGreske } from '@/lib/utils';
import { uBruto, uNetto, cijenaZaSpremanje } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { jePloca, m2UKom } from '@/lib/ploca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Key, LedgerHead } from '@/components/ui/ledger';
import { UlazDialog, type UlazStanje } from '@/components/skladiste/UlazDialog';
import {
  Plus, Trash2, FileText, Package, Search, Pencil, X,
  PackagePlus, Hash, Barcode,
  DollarSign, Layers, Ruler, ChevronRight, Building2,
  ArrowUpRight, ArrowDownRight, Lock, RefreshCw,
} from 'lucide-react';
import { potvrdi, obavijesti } from '@/lib/dijalog';

type SkladisteTab = 'artikli' | 'primke';

// ---------------------------------------------------------------------------
// Artikal Dialog — refined two-section layout
// ---------------------------------------------------------------------------

interface ArtikalFormData {
  sifra: string;
  barkod: string;
  naziv: string;
  jm: string;
  cijena: string;
  pdvStopa: 'E' | 'K';
  stanje: string;
}

const emptyArtikalForm: ArtikalFormData = {
  sifra: '',
  barkod: '',
  naziv: '',
  jm: 'kom',
  cijena: '',
  pdvStopa: 'E',
  stanje: '',
};

function ArtikalDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  onSave: () => void;
}) {
  const [form, setForm] = useState<ArtikalFormData>(emptyArtikalForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const bezPdv = useUnosBezPdv(open);
  // Tekst koji je pri otvaranju stavljen u polje cijene — služi da prepoznamo
  // da korisnik cijenu uopšte nije dirao.
  const [cijenaInit, setCijenaInit] = useState('');

  useEffect(() => {
    // Dok se postavka učitava ne diramo formu — inače bismo cijenu prikazali
    // u pogrešnoj jedinici pa je pregazili kad postavka stigne.
    if (!open) return;
    setError('');
    if (bezPdv === null) return;
    if (product) {
      const prikaz = String(bezPdv ? uNetto(product.cijena, product.pdvStopa) : product.cijena);
      setCijenaInit(prikaz);
      setForm({
        sifra: product.sifra,
        barkod: product.barkod ?? '',
        naziv: product.naziv,
        jm: product.jm,
        cijena: prikaz,
        pdvStopa: product.pdvStopa,
        stanje: String(product.stanje ?? 0),
      });
    } else {
      setCijenaInit('');
      setForm(emptyArtikalForm);
    }
  }, [open, product, bezPdv]);

  // Režim "bez PDV-a" vrijedi samo za stopu E — kod K (0 %) bi oznaka
  // "bez PDV-a" bila obmanjujuća.
  const nettoRezim = bezPdv === true && form.pdvStopa === 'E';
  const cijenaBroj = parseDecimal(form.cijena);
  // Rule 2: dok je polje cijene nedirano (isti tekst i ista stopa kao pri
  // otvaranju), pregled mora prikazati STVARNU spremljenu (bruto) cijenu, a
  // ne preračunatu — inače korisnik vidi fening razlike i "ispravi" ga, čime
  // cijena stvarno postane pogrešna (vidi cijenaZaSpremanje).
  const nedirano = !!product && form.cijena === cijenaInit && form.pdvStopa === product.pdvStopa;
  const previewBruto = nettoRezim && !isNaN(cijenaBroj) && form.cijena !== ''
    ? (nedirano ? product!.cijena : uBruto(cijenaBroj, form.pdvStopa))
    : null;

  const handleSave = async () => {
    if (bezPdv === null) return;
    if (!form.sifra || !form.naziv || !form.cijena || isNaN(parseDecimal(form.cijena))) return;
    setSaving(true);
    setError('');
    try {
      const cijenaZaBazu = cijenaZaSpremanje({
        unos: form.cijena,
        unosInit: cijenaInit,
        stopa: form.pdvStopa,
        original: product,
        bezPdv,
      });

      const payload = {
        sifra: form.sifra,
        barkod: form.barkod || null,
        naziv: form.naziv,
        jm: form.jm,
        cijena: cijenaZaBazu,
        pdvStopa: form.pdvStopa,
      };
      if (product) {
        await window.api.updateProduct(product.id, payload);
        const newStanje = parseDecimal(form.stanje);
        if (!isNaN(newStanje) && newStanje !== (product.stanje ?? 0)) {
          await window.api.adjustStock(product.id, newStanje);
        }
      } else {
        const result = await window.api.createProduct(payload);
        const initialStock = parseDecimal(form.stanje);
        if (!isNaN(initialStock) && initialStock > 0 && result?.id) {
          await window.api.adjustStock(Number(result.id), initialStock);
        }
      }
      onSave();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Greška pri spremanju');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!product;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                isEdit
                  ? 'bg-blue-50 text-blue-600'
                  : 'bg-emerald-50 text-emerald-600'
              )}>
                {isEdit ? <Pencil className="h-5 w-5" /> : <PackagePlus className="h-5 w-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg">{isEdit ? 'Uredi artikal' : 'Novi artikal'}</DialogTitle>
                  {nettoRezim && (
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                      bez PDV-a
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-xs mt-0.5">
                  {isEdit ? `Šifra: ${product.sifra}` : 'Unesite podatke o novom artiklu'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Separator />

        {/* Form body */}
        <div className="px-6 py-5 space-y-5">
          {/* Naziv — hero field */}
          <div className="space-y-1.5">
            <Label htmlFor="naziv" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Naziv artikla
            </Label>
            <Input
              id="naziv"
              value={form.naziv}
              onChange={(e) => setForm({ ...form, naziv: e.target.value })}
              placeholder="Npr. Coca-Cola 0.5L"
              className="h-11 text-base"
              autoFocus
            />
          </div>

          {/* Identifikacija row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sifra" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Hash className="h-3 w-3" />
                Šifra
              </Label>
              <Input
                id="sifra"
                className="font-mono"
                value={form.sifra}
                onChange={(e) => setForm({ ...form, sifra: e.target.value })}
                placeholder="001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="barkod" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Barcode className="h-3 w-3" />
                Barkod
              </Label>
              <Input
                id="barkod"
                className="font-mono"
                value={form.barkod}
                onChange={(e) => setForm({ ...form, barkod: e.target.value })}
                placeholder="Opcionalno"
              />
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Cijena & PDV row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="cijena" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="h-3 w-3" />
                {nettoRezim ? 'Cijena bez PDV-a (KM)' : 'Cijena (KM)'}
              </Label>
              <DecimalInput
                id="cijena"
                className="font-mono text-base h-11"
                value={form.cijena}
                onValueChange={(text) => setForm({ ...form, cijena: text })}
                placeholder="0,00"
              />
              {previewBruto !== null && (
                <p className="text-[11px] text-slate-400 font-mono">
                  Sa PDV-om: {formatKM(previewBruto)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                PDV Stopa
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, pdvStopa: 'E' })}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-medium transition-all duration-150',
                    form.pdvStopa === 'E'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  E — 17%
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, pdvStopa: 'K' })}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-medium transition-all duration-150',
                    form.pdvStopa === 'K'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  K — 0%
                </button>
              </div>
            </div>
          </div>

          {/* Stanje & JM row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="stanje" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="h-3 w-3" />
                Stanje na skladištu
              </Label>
              <DecimalInput
                id="stanje"
                maxDecimals={3}
                className="font-mono"
                placeholder="0"
                value={form.stanje}
                onValueChange={(text) => setForm({ ...form, stanje: text })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jm" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Ruler className="h-3 w-3" />
                Jedinica mjere
              </Label>
              <Input
                id="jm"
                value={form.jm}
                onChange={(e) => setForm({ ...form, jm: e.target.value })}
                placeholder="kom"
              />
            </div>
          </div>
        </div>

        {/* Error + Footer */}
        <div className="border-t bg-slate-50/50">
          {error && (
            <div className="mx-6 mt-4 text-sm px-3 py-2.5 rounded-lg bg-red-50 text-red-600 border border-red-100 flex items-center gap-2">
              <X className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Otkaži
            </Button>
            <Button onClick={handleSave} disabled={saving || bezPdv === null || !form.sifra || !form.naziv || !form.cijena} className="min-w-[120px]">
              {saving ? 'Spremam...' : isEdit ? 'Spremi izmjene' : 'Dodaj artikal'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Artikli Tab — refined data table with search & summary
// ---------------------------------------------------------------------------

function ArtikliTab({
  products,
  onReload,
}: {
  products: Product[];
  onReload: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'naziv' | 'stanje' | 'cijena'>('naziv');

  const handleNew = () => {
    setEditProduct(null);
    setDialogOpen(true);
  };

  const handleEdit = (p: Product) => {
    setEditProduct(p);
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (v: boolean) => {
    setDialogOpen(v);
    if (!v) setEditProduct(null);
  };

  const handleDelete = async (p: Product) => {
    if (!(await potvrdi(`Obrisati artikal "${p.naziv}"?`))) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e) { await obavijesti(porukaGreske(e)); }
  };

  const filtered = products
    .filter(p => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.naziv.toLowerCase().includes(q) ||
        p.sifra.toLowerCase().includes(q) ||
        (p.barkod?.toLowerCase().includes(q) ?? false)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'stanje') return (b.stanje ?? 0) - (a.stanje ?? 0);
      if (sortBy === 'cijena') return b.cijena - a.cijena;
      return a.naziv.localeCompare(b.naziv, 'bs');
    });

  const totalValue = products.reduce((sum, p) => sum + p.cijena * (p.stanje ?? 0), 0);
  const outOfStock = products.filter(p => (p.stanje ?? 0) <= 0).length;

  return (
    <div className="flex flex-col h-full">
      {/* Metric cards */}
      <div className="flex-shrink-0 px-6 pt-5 pb-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Artikli</span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Package size={16} className="text-blue-500" />
              </div>
            </div>
            <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
              {products.length}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">ukupno u bazi</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Vrijednost</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <ArrowUpRight size={16} className="text-emerald-500" />
              </div>
            </div>
            <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
              {formatKM(totalValue)}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">ukupna vrijednost skladišta</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Nema na stanju</span>
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <ArrowDownRight size={16} className="text-red-500" />
              </div>
            </div>
            <p className={cn(
              'text-[22px] font-bold font-mono tracking-tight leading-none',
              outOfStock > 0 ? 'text-red-500' : 'text-slate-900'
            )}>
              {outOfStock}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">artikala bez zaliha</p>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="flex-1 min-h-0 px-6 pb-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
          {/* Table header bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Pretraži po nazivu, šifri ili barkodu..."
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
              {(['naziv', 'cijena', 'stanje'] as const).map(key => (
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
                  {key === 'naziv' ? 'A-Z' : key === 'cijena' ? 'Cijena' : 'Stanje'}
                </button>
              ))}
            </div>

            {search && filtered.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                {filtered.length}/{products.length}
              </Badge>
            )}

            <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Novi artikal
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <Package size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema artikala'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvi artikal klikom na dugme iznad</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5 w-[1%] whitespace-nowrap">Šifra</th>
                    <th className="text-left px-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[50px]">JM</th>
                    <th className="text-right px-2 py-2.5 w-[100px]">Cijena</th>
                    <th className="text-center px-2 py-2.5 w-[60px]">PDV</th>
                    <th className="text-center px-2 py-2.5 w-[110px]">Stanje</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[1%]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const stock = p.stanje ?? 0;
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          'group border-t border-slate-100 transition-colors hover:bg-slate-50',
                          p.tip === 'materijal' ? 'cursor-default' : 'cursor-pointer'
                        )}
                        onClick={() => { if (p.tip !== 'materijal') handleEdit(p); }}
                      >
                        <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400 whitespace-nowrap">{p.sifra}</td>
                        <td className="px-2 py-2.5">
                          <span className="text-[12px] font-medium text-slate-700">{p.naziv}</span>
                          {p.tip === 'materijal' && (
                            <span className="ml-2 inline-flex items-center rounded px-1.5 py-px text-[9.5px] font-semibold bg-violet-50 text-violet-600 border border-violet-100">materijal</span>
                          )}
                          {p.barkod && (
                            <span className="ml-2 font-mono text-[10px] text-slate-300">{p.barkod}</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-[12px] text-slate-400">{p.jm}</td>
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
                        <td className="px-2 py-2.5 text-center">
                          <span className={cn(
                            'inline-flex items-center justify-center min-w-[36px] h-6 rounded-md px-2 font-mono text-xs font-semibold tabular-nums whitespace-nowrap',
                            stock > 10
                              ? 'bg-emerald-50 text-emerald-700'
                              : stock > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-600'
                          )}>
                            {jePloca(p) ? `${stock.toFixed(2).replace('.', ',')} m²` : stock}
                          </span>
                          {jePloca(p) && (
                            <span className="block mt-0.5 font-mono text-[10px] tabular-nums text-slate-400 whitespace-nowrap">
                              ≈ {m2UKom(stock, p.plocaSirina!, p.plocaVisina!)} ploča
                            </span>
                          )}
                        </td>
                        <td className="pr-5 pl-2 py-2.5 text-right">
                          {p.tip === 'materijal' ? (
                            <span title="Materijal se uređuje u Šifarniku, na kartici Materijal"
                              className="inline-flex h-7 items-center gap-1 px-2 whitespace-nowrap text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Lock className="h-3 w-3" /> Šifarnik
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                onClick={(e) => { e.stopPropagation(); handleEdit(p); }}
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Uredi
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </div>
      </div>

      <ArtikalDialog
        key={editProduct?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        product={editProduct}
        onSave={onReload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ulaz robe Tab — lista preko cijele širine, dokument u dijalogu preko svega
// ---------------------------------------------------------------------------

function PrimkeTab({ products, dobavljaci, onReloadProducts }: { products: Product[]; dobavljaci: Dobavljac[]; onReloadProducts: () => void }) {
  const [primke, setPrimke] = useState<Primka[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stanje, setStanje] = useState<UlazStanje>({ kind: 'zatvoren' });
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadPrimke = useCallback(async () => { setPrimke(await window.api.getPrimke()); }, []);
  useEffect(() => { loadPrimke(); }, [loadPrimke]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return primke;
    return primke.filter(p => p.brojPrimke.toLowerCase().includes(q) || (p.dobavljacNaziv?.toLowerCase().includes(q) ?? false)
      || (p.brojFakture?.toLowerCase().includes(q) ?? false) || (p.napomena?.toLowerCase().includes(q) ?? false));
  }, [primke, search]);
  const visibleIds = useMemo(() => visible.map(p => p.id), [visible]);
  const selIndex = visible.findIndex(p => p.id === selectedId);

  const focusRow = useCallback((index: number) => {
    const p = visible[index];
    if (!p) return;
    setSelectedId(p.id);
    const el = rowRefs.current[index];
    el?.focus(); el?.scrollIntoView({ block: 'nearest' });
  }, [visible]);

  const otvori = (id: number) => { setSelectedId(id); setStanje({ kind: 'pregled', id }); };
  const novi = () => setStanje({ kind: 'novi' });

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const current = selIndex < 0 ? -1 : selIndex;
    const last = visible.length - 1;
    const go = (i: number) => { e.preventDefault(); focusRow(Math.max(0, Math.min(last, i))); };
    switch (e.key) {
      case 'ArrowDown': return go(current + 1);
      case 'ArrowUp': return go(current < 0 ? 0 : current - 1);
      case 'PageDown': return go(current + 10);
      case 'PageUp': return go(current < 0 ? 0 : current - 10);
      case 'Home': return go(0);
      case 'End': return go(last);
      case 'Enter': case ' ':
        if (selectedId != null) { e.preventDefault(); otvori(selectedId); }
        return;
      default:
    }
  };

  const dialogOpen = stanje.kind !== 'zatvoren';
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const uPolju = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (uPolju) {
        // Iz pretrage ↓ vodi na listu, esc briše upit.
        if (t === searchRef.current && e.key === 'ArrowDown') { e.preventDefault(); focusRow(selIndex < 0 ? 0 : selIndex); }
        if (t === searchRef.current && e.key === 'Escape') { setSearch(''); (t as HTMLInputElement).blur(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!t?.closest('tbody')) { e.preventDefault(); focusRow(selIndex < 0 ? 0 : selIndex); } return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); novi(); return; }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); loadPrimke(); return; }
      if (e.key === 'Enter' && selectedId != null) { e.preventDefault(); otvori(selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, selectedId, selIndex, focusRow, loadPrimke]);

  const zatvori = () => {
    setStanje({ kind: 'zatvoren' });
    requestAnimationFrame(() => { const i = visible.findIndex(p => p.id === selectedId); if (i >= 0) rowRefs.current[i]?.focus(); });
  };

  return (
    <div className="flex flex-col h-full">
      {msg && (
        <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-medium bg-emerald-50/70 border-emerald-200 text-emerald-700">
          <PackagePlus size={14} /> {msg}
          <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setMsg(null)} aria-label="Sakrij poruku"><X size={13} /></button>
        </div>
      )}
      <div className="flex-1 min-h-0 px-6 py-5">
        <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži po broju, dobavljaču, fakturi…"
                className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200" aria-label="Pretraga ulaza" />
              {search
                ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
            </div>
            <span className="text-[13px] font-semibold text-slate-700">Ulaz robe</span>
            <span className="font-mono text-[10.5px] tabular-nums text-slate-400">{primke.length}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadPrimke} className="h-8 gap-1.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Osvježi</Button>
              <Button size="sm" onClick={novi} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]"><Plus className="h-3.5 w-3.5" /> Novi ulaz <Key tone="dark">N</Key></Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><FileText size={20} className="text-slate-300" /></div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata' : 'Nema ulaza robe'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Prvi ulaz otvarate tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1">
                <table className="w-full border-separate border-spacing-0">
                  <LedgerHead columns={[
                    { label: 'Broj', className: 'text-left pl-5 pr-2 w-[130px]' },
                    { label: 'Datum', className: 'text-left px-2 w-[100px]' },
                    { label: 'Dobavljač', className: 'text-left px-2 w-[34%]' },
                    { label: 'Faktura', className: 'text-left px-2 w-[130px] hidden lg:table-cell' },
                    { label: 'Napomena', className: 'text-left px-2 hidden xl:table-cell' },
                    { label: '', className: 'w-[60px] pr-5' },
                  ]} />
                  <tbody onKeyDown={handleListKeyDown}>
                    {visible.map((p, i) => {
                      const isSel = selectedId === p.id;
                      return (
                        <tr key={p.id}
                          ref={el => { rowRefs.current[i] = el; }}
                          tabIndex={isSel || (selIndex < 0 && i === 0) ? 0 : -1}
                          aria-selected={isSel}
                          onClick={() => otvori(p.id)}
                          onFocus={() => setSelectedId(p.id)}
                          className={cn('cursor-pointer transition-colors duration-100 group',
                            'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                            isSel ? 'bg-blue-50/70' : 'hover:bg-slate-50')}>
                          <td className={cn('pl-5 pr-2 py-3 border-b border-slate-100 font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap',
                            isSel ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-500')}>{p.brojPrimke}</td>
                          <td className="px-2 py-3 border-b border-slate-100 text-[12px] text-slate-500 tabular-nums whitespace-nowrap">{formatDate(p.datum)}</td>
                          <td className="px-2 py-3 border-b border-slate-100 text-[12.5px] text-slate-800 max-w-0">
                            <span className="flex items-center gap-2 min-w-0">
                              <Building2 size={13} className="text-slate-300 flex-shrink-0" />
                              <span className="truncate font-medium">{p.dobavljacNaziv || <span className="text-slate-300 font-normal">bez dobavljača</span>}</span>
                            </span>
                          </td>
                          <td className="hidden lg:table-cell px-2 py-3 border-b border-slate-100 font-mono text-[12px] text-slate-500 truncate max-w-0">{p.brojFakture || <span className="text-slate-300">—</span>}</td>
                          <td className="hidden xl:table-cell px-2 py-3 border-b border-slate-100 text-[12px] text-slate-500 truncate max-w-0 w-full">{p.napomena}</td>
                          <td className="pr-5 py-3 border-b border-slate-100 text-right">
                            <ChevronRight size={14} className="inline text-slate-300 group-hover:text-slate-500" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollArea>
              <div className="flex-shrink-0 border-t border-slate-100 px-5 h-9 flex items-center gap-3 text-[10.5px] text-slate-400 select-none">
                <span className="font-mono tabular-nums">{selIndex >= 0 ? `${selIndex + 1} / ${visible.length}` : `${visible.length}`}</span>
                <span className="text-slate-300">·</span>
                <span className="hidden sm:flex items-center gap-3">
                  <span className="flex items-center gap-1"><Key className="ml-0">↑↓</Key> odaberi</span>
                  <span className="flex items-center gap-1"><Key className="ml-0">↵</Key> otvori</span>
                  <span className="flex items-center gap-1"><Key className="ml-0">/</Key> pretraga</span>
                  <span className="flex items-center gap-1"><Key className="ml-0">N</Key> novi</span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <UlazDialog
        stanje={stanje}
        products={products}
        dobavljaci={dobavljaci}
        redoslijed={visibleIds}
        onClose={zatvori}
        onNavigate={otvori}
        onSaved={async (id) => { await loadPrimke(); onReloadProducts(); if (id) { setSelectedId(id); setStanje({ kind: 'pregled', id }); } else setStanje({ kind: 'zatvoren' }); }}
        onDeleted={async (p) => { setStanje({ kind: 'zatvoren' }); setSelectedId(null); await loadPrimke(); onReloadProducts(); setMsg(`Ulaz ${p.brojPrimke} obrisan`); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function SkladisteScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [activeTab, setActiveTab] = useState<SkladisteTab>('artikli');
  const proizvodnja = useProizvodnja();

  const loadProducts = useCallback(async () => {
    const artikli = await window.api.getProducts('artikal');
    const materijal = proizvodnja ? await window.api.getProducts('materijal') : [];
    setProducts([...artikli, ...materijal]);
  }, [proizvodnja]);

  const loadDobavljaci = useCallback(async () => {
    const data = await window.api.getDobavljaci();
    setDobavljaci(data);
  }, []);

  useEffect(() => {
    loadProducts();
    loadDobavljaci();
  }, [loadProducts, loadDobavljaci]);

  const tabs: { id: SkladisteTab; label: string; icon: typeof Package }[] = [
    { id: 'artikli', label: 'Artikli', icon: Package },
    { id: 'primke', label: 'Ulaz robe', icon: FileText },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar with tabs */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'artikli' && <ArtikliTab products={products} onReload={loadProducts} />}
        {activeTab === 'primke' && <PrimkeTab products={products} dobavljaci={dobavljaci} onReloadProducts={loadProducts} />}
      </div>
    </div>
  );
}
