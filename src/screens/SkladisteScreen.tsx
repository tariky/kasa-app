import { useState, useEffect, useCallback } from 'react';
import { Product, Primka, PrimkaStavka, Dobavljac, Kupac } from '@/types';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { pdf } from '@react-pdf/renderer';
import { UlazPdf } from '@/components/UlazPdf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Plus, Trash2, FileText, Package, Search, Pencil, X,
  ClipboardList, PackagePlus, Hash, Barcode,
  DollarSign, Layers, Ruler, ChevronRight, Printer, Building2, Phone, Download, Wrench, Users,
  ArrowUpRight, ArrowDownRight, AlertTriangle,
} from 'lucide-react';

type SkladisteTab = 'artikli' | 'usluge' | 'primke' | 'dobavljaci' | 'kupci';

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

  useEffect(() => {
    if (open) {
      setError('');
      if (product) {
        setForm({
          sifra: product.sifra,
          barkod: product.barkod ?? '',
          naziv: product.naziv,
          jm: product.jm,
          cijena: String(product.cijena),
          pdvStopa: product.pdvStopa,
          stanje: String(product.stanje ?? 0),
        });
      } else {
        setForm(emptyArtikalForm);
      }
    }
  }, [open, product]);

  const handleSave = async () => {
    if (!form.sifra || !form.naziv || !form.cijena) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        sifra: form.sifra,
        barkod: form.barkod || null,
        naziv: form.naziv,
        jm: form.jm,
        cijena: parseFloat(form.cijena),
        pdvStopa: form.pdvStopa,
      };
      if (product) {
        await window.api.updateProduct(product.id, payload);
        const newStanje = parseFloat(form.stanje);
        if (!isNaN(newStanje) && newStanje !== (product.stanje ?? 0)) {
          await window.api.adjustStock(product.id, newStanje);
        }
      } else {
        const result = await window.api.createProduct(payload);
        const initialStock = parseFloat(form.stanje);
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
                <DialogTitle className="text-lg">{isEdit ? 'Uredi artikal' : 'Novi artikal'}</DialogTitle>
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
                Cijena (KM)
              </Label>
              <Input
                id="cijena"
                type="number"
                step="0.01"
                className="font-mono text-base h-11"
                value={form.cijena}
                onChange={(e) => setForm({ ...form, cijena: e.target.value })}
                placeholder="0.00"
              />
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
              <Input
                id="stanje"
                type="number"
                step="1"
                className="font-mono"
                placeholder="0"
                value={form.stanje}
                onChange={(e) => setForm({ ...form, stanje: e.target.value })}
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
            <Button onClick={handleSave} disabled={saving || !form.sifra || !form.naziv || !form.cijena} className="min-w-[120px]">
              {saving ? 'Spremam...' : isEdit ? 'Spremi izmjene' : 'Dodaj artikal'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Nova Primka Dialog — cleaner table-like rows
// ---------------------------------------------------------------------------

interface StavkaRow {
  productId: number | null;
  kolicina: string;
  nabavnaCijena: string;
  rabat: string;
  cijena: string;
}

function NovaPrimkaDialog({
  open,
  onOpenChange,
  products,
  dobavljaci,
  onSave,
  editPrimka,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: Product[];
  dobavljaci: Dobavljac[];
  onSave: () => void;
  editPrimka?: Primka | null;
}) {
  const [brojPrimke, setBrojPrimke] = useState('');
  const [brojFakture, setBrojFakture] = useState('');
  const [napomena, setNapomena] = useState('');
  const [datum, setDatum] = useState('');
  const [dobavljacNaziv, setDobavljacNaziv] = useState('');
  const [dobavljacId, setDobavljacId] = useState('');
  const [dobavljacAdresa, setDobavljacAdresa] = useState('');
  const [stavke, setStavke] = useState<StavkaRow[]>([
    { productId: null, kolicina: '', nabavnaCijena: '', rabat: '', cijena: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [nivelacijaItems, setNivelacijaItems] = useState<Array<{
    productId: number;
    productNaziv: string;
    kolicina: number;
    staraCijena: number;
    novaCijena: number;
    razlika: number;
    ukupnaRazlika: number;
  }>>([]);
  const [showNivelacija, setShowNivelacija] = useState(false);

  useEffect(() => {
    if (open) {
      if (editPrimka) {
        setBrojPrimke(editPrimka.brojPrimke);
        setBrojFakture(editPrimka.brojFakture ?? '');
        setNapomena(editPrimka.napomena ?? '');
        setDatum(editPrimka.datum);
        setDobavljacNaziv(editPrimka.dobavljacNaziv ?? '');
        setDobavljacId(editPrimka.dobavljacId ?? '');
        setDobavljacAdresa(editPrimka.dobavljacAdresa ?? '');
        setStavke(
          (editPrimka.stavke ?? []).map((s) => ({
            productId: s.productId,
            kolicina: String(s.kolicina),
            nabavnaCijena: String(s.nabavnaCijena),
            rabat: String(s.rabat || ''),
            cijena: String(s.cijena),
          }))
        );
      } else {
        setNapomena('');
        setBrojFakture('');
        setDobavljacNaziv('');
        setDobavljacId('');
        setDobavljacAdresa('');
        const d = new Date();
        setDatum(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        setStavke([{ productId: null, kolicina: '', nabavnaCijena: '', rabat: '', cijena: '' }]);
        window.api.getNextBrojUlaza().then(setBrojPrimke).catch(() => setBrojPrimke(''));
      }
    }
  }, [open, editPrimka]);

  const addStavka = () =>
    setStavke((prev) => [...prev, { productId: null, kolicina: '', nabavnaCijena: '', rabat: '', cijena: '' }]);

  const removeStavka = (idx: number) =>
    setStavke((prev) => prev.filter((_, i) => i !== idx));

  const updateStavka = (idx: number, patch: Partial<StavkaRow>) => {
    setStavke((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const updated = { ...s, ...patch };
        if (patch.productId != null) {
          const p = products.find((pr) => pr.id === patch.productId);
          if (p) updated.cijena = String(p.cijena);
        }
        return updated;
      }),
    );
  };

  const stavkeNabavnaTotal = stavke.reduce((sum, s) => {
    if (!s.kolicina || !s.nabavnaCijena) return sum;
    return sum + parseFloat(s.kolicina) * parseFloat(s.nabavnaCijena);
  }, 0);

  const stavkeProdajnaTotal = stavke.reduce((sum, s) => {
    if (!s.kolicina || !s.cijena) return sum;
    return sum + parseFloat(s.kolicina) * parseFloat(s.cijena);
  }, 0);

  const validCount = stavke.filter(s => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena).length;

  const handleSave = async () => {
    if (!brojPrimke) return;
    const validStavke = stavke.filter(
      (s) => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena,
    );
    if (validStavke.length === 0) return;

    // Check for price differences
    const diffs: typeof nivelacijaItems = [];
    for (const s of validStavke) {
      const product = products.find(p => p.id === s.productId);
      if (product && Math.abs(product.cijena - parseFloat(s.cijena)) > 0.001) {
        const existingStock = product.stanje ?? 0;
        if (existingStock > 0) {
          const razlika = parseFloat(s.cijena) - product.cijena;
          diffs.push({
            productId: product.id,
            productNaziv: product.naziv,
            kolicina: existingStock,
            staraCijena: product.cijena,
            novaCijena: parseFloat(s.cijena),
            razlika,
            ukupnaRazlika: razlika * existingStock,
          });
        }
      }
    }

    if (diffs.length > 0) {
      setNivelacijaItems(diffs);
      setShowNivelacija(true);
      return;
    }

    await doSave();
  };

  const doSave = async () => {
    const validStavke = stavke.filter(
      (s) => s.productId != null && s.kolicina && s.nabavnaCijena && s.cijena,
    );
    setSaving(true);
    try {
      const payload = {
        ...(editPrimka ? { id: editPrimka.id } : {}),
        brojPrimke,
        datum: datum || undefined,
        dobavljacNaziv: dobavljacNaziv || undefined,
        dobavljacId: dobavljacId || undefined,
        dobavljacAdresa: dobavljacAdresa || undefined,
        brojFakture: brojFakture || undefined,
        napomena: napomena || undefined,
        stavke: validStavke.map((s) => ({
          productId: s.productId,
          kolicina: parseFloat(s.kolicina),
          nabavnaCijena: parseFloat(s.nabavnaCijena),
          rabat: parseFloat(s.rabat) || 0,
          cijena: parseFloat(s.cijena),
          pdvStopa: products.find(p => p.id === s.productId)?.pdvStopa ?? 'E',
        })),
      };

      if (editPrimka) {
        await window.api.updatePrimka(payload);
      } else {
        await window.api.createPrimka(payload);
      }
      onOpenChange(false);
      onSave();
    } catch (err: any) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">{editPrimka ? 'Uredi ulaz robe' : 'Novi ulaz robe'}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Prijemnica — popunite podatke o dobavljaču i stavkama
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Separator />

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Primka info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="brojPrimke" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Broj ulaza
              </Label>
              <Input
                id="brojPrimke"
                className={cn("font-mono", !editPrimka && "bg-muted")}
                value={brojPrimke}
                onChange={(e) => editPrimka && setBrojPrimke(e.target.value)}
                readOnly={!editPrimka}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="datum" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Datum prijema
              </Label>
              <Input
                id="datum"
                type="date"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
              />
            </div>
          </div>

          {/* Dobavljač section */}
          <div className="rounded-lg border bg-slate-50/50 p-4 space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dobavljač</span>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Odaberi dobavljača</Label>
              <Select
                value={dobavljacNaziv ? dobavljaci.find(d => d.naziv === dobavljacNaziv)?.id?.toString() ?? '' : ''}
                onValueChange={(v) => {
                  const d = dobavljaci.find(d => d.id === parseInt(v, 10));
                  if (d) {
                    setDobavljacNaziv(d.naziv);
                    setDobavljacId(d.idBroj || d.pdvBroj || '');
                    setDobavljacAdresa(d.adresa || '');
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Odaberi dobavljača..." />
                </SelectTrigger>
                <SelectContent>
                  {dobavljaci.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <span className="font-medium">{d.naziv}</span>
                      {d.idBroj && <span className="text-muted-foreground text-xs ml-2 font-mono">{d.idBroj}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {dobavljacNaziv && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Naziv:</span>
                  <span className="ml-1.5 font-medium">{dobavljacNaziv}</span>
                </div>
                {dobavljacId && (
                  <div>
                    <span className="text-muted-foreground">ID/PDV:</span>
                    <span className="ml-1.5 font-mono">{dobavljacId}</span>
                  </div>
                )}
                {dobavljacAdresa && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Adresa:</span>
                    <span className="ml-1.5">{dobavljacAdresa}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Broj fakture + Napomena */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="brojFakture" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Broj fakture dobavljača
              </Label>
              <Input
                id="brojFakture"
                value={brojFakture}
                onChange={(e) => setBrojFakture(e.target.value)}
                placeholder="Npr. 208/26"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="napomena" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Napomena
              </Label>
              <Input
                id="napomena"
                value={napomena}
                onChange={(e) => setNapomena(e.target.value)}
                placeholder="Opcionalno"
              />
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Stavke header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Stavke
              </Label>
              {validCount > 0 && (
                <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                  {validCount}
                </Badge>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={addStavka} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" />
              Stavka
            </Button>
          </div>

          {/* Stavke table-style */}
          <div className="rounded-lg border overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_70px_90px_60px_90px_36px] gap-0 bg-slate-50 border-b px-3 py-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Artikal</span>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Kol.</span>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Nabavna</span>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Rabat%</span>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider text-right">Prodajna</span>
              <span />
            </div>

            <ScrollArea className="max-h-52">
              <div className="divide-y">
                {stavke.map((s, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_70px_90px_60px_90px_36px] gap-0 items-center px-3 py-1.5 hover:bg-slate-50/50 transition-colors">
                    <div className="pr-2">
                      <Select
                        value={s.productId != null ? String(s.productId) : ''}
                        onValueChange={(v) => updateStavka(idx, { productId: parseInt(v, 10) })}
                      >
                        <SelectTrigger className="h-8 text-sm border-0 shadow-none bg-transparent px-0 hover:bg-slate-100 rounded">
                          <SelectValue placeholder="Odaberi artikal..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              <span className="font-mono text-muted-foreground text-xs mr-2">{p.sifra}</span>
                              {p.naziv}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 font-mono text-sm text-right border-0 shadow-none bg-transparent hover:bg-slate-100 rounded"
                      placeholder="0"
                      value={s.kolicina}
                      onChange={(e) => updateStavka(idx, { kolicina: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 font-mono text-sm text-right border-0 shadow-none bg-transparent hover:bg-slate-100 rounded"
                      placeholder="0.00"
                      value={s.nabavnaCijena}
                      onChange={(e) => updateStavka(idx, { nabavnaCijena: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 font-mono text-sm text-right border-0 shadow-none bg-transparent hover:bg-slate-100 rounded"
                      placeholder="0"
                      value={s.rabat}
                      onChange={(e) => updateStavka(idx, { rabat: e.target.value })}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 font-mono text-sm text-right border-0 shadow-none bg-transparent hover:bg-slate-100 rounded"
                      placeholder="0.00"
                      value={s.cijena}
                      onChange={(e) => updateStavka(idx, { cijena: e.target.value })}
                    />
                    <button
                      onClick={() => removeStavka(idx)}
                      disabled={stavke.length === 1}
                      className={cn(
                        'h-8 w-8 flex items-center justify-center rounded transition-colors',
                        stavke.length === 1
                          ? 'text-slate-200 cursor-not-allowed'
                          : 'text-slate-400 hover:text-red-500 hover:bg-red-50'
                      )}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Total bar */}
            {(stavkeNabavnaTotal > 0 || stavkeProdajnaTotal > 0) && (
              <div className="border-t bg-slate-50 px-3 py-2.5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ukupno</span>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Nabavna</span>
                    <span className="font-mono font-semibold text-sm">{formatKM(stavkeNabavnaTotal)}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Prodajna</span>
                    <span className="font-mono font-semibold text-sm">{formatKM(stavkeProdajnaTotal)}</span>
                  </div>
                  {stavkeNabavnaTotal > 0 && stavkeProdajnaTotal > 0 && (
                    <>
                      <div className="text-right">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">RUC</span>
                        <span className="font-mono font-semibold text-sm">
                          {formatKM(stavkeProdajnaTotal - stavkeNabavnaTotal)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">RUC %</span>
                        <span className="font-mono font-semibold text-sm text-emerald-600">
                          {(((stavkeProdajnaTotal - stavkeNabavnaTotal) / stavkeNabavnaTotal) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button onClick={handleSave} disabled={saving || !brojPrimke || validCount === 0} className="min-w-[120px]">
            {saving ? 'Spremam...' : 'Spremi ulaz'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showNivelacija} onOpenChange={setShowNivelacija}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Nivelacija cijena
          </DialogTitle>
          <DialogDescription>
            Sljedeći artikli imaju različitu prodajnu cijenu od trenutne. Sačuvanje primke će automatski kreirati nivelaciju i ažurirati cijene.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left py-2">Artikal</th>
                <th className="text-right py-2">Kol.</th>
                <th className="text-right py-2">Stara</th>
                <th className="text-right py-2">Nova</th>
                <th className="text-right py-2">Razlika</th>
              </tr>
            </thead>
            <tbody>
              {nivelacijaItems.map((item) => (
                <tr key={item.productId} className="border-b border-slate-50">
                  <td className="py-2 text-sm">{item.productNaziv}</td>
                  <td className="py-2 text-right font-mono text-sm">{item.kolicina}</td>
                  <td className="py-2 text-right font-mono text-sm">{formatKM(item.staraCijena)}</td>
                  <td className="py-2 text-right font-mono text-sm">{formatKM(item.novaCijena)}</td>
                  <td className={cn(
                    "py-2 text-right font-mono text-sm font-medium",
                    item.ukupnaRazlika > 0 ? "text-emerald-600" : "text-red-500"
                  )}>
                    {item.ukupnaRazlika > 0 ? '+' : ''}{formatKM(item.ukupnaRazlika)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td colSpan={4} className="py-2 text-sm font-semibold">Ukupna razlika</td>
                <td className={cn(
                  "py-2 text-right font-mono text-sm font-bold",
                  nivelacijaItems.reduce((s, i) => s + i.ukupnaRazlika, 0) > 0 ? "text-emerald-600" : "text-red-500"
                )}>
                  {formatKM(nivelacijaItems.reduce((s, i) => s + i.ukupnaRazlika, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setShowNivelacija(false)}>
            Otkaži
          </Button>
          <Button
            onClick={() => {
              setShowNivelacija(false);
              doSave();
            }}
          >
            Sačuvaj sa nivelacijom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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

  const handleDelete = async (p: Product) => {
    if (!confirm(`Obrisati artikal "${p.naziv}"?`)) return;
    await window.api.deleteProduct(p.id);
    onReload();
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
                    <th className="text-left pl-5 pr-2 py-2.5 w-[80px]">Šifra</th>
                    <th className="text-left px-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[50px]">JM</th>
                    <th className="text-right px-2 py-2.5 w-[100px]">Cijena</th>
                    <th className="text-center px-2 py-2.5 w-[60px]">PDV</th>
                    <th className="text-center px-2 py-2.5 w-[80px]">Stanje</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const stock = p.stanje ?? 0;
                    return (
                      <tr
                        key={p.id}
                        className="group border-t border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                        onClick={() => handleEdit(p)}
                      >
                        <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400">{p.sifra}</td>
                        <td className="px-2 py-2.5">
                          <span className="text-[12px] font-medium text-slate-700">{p.naziv}</span>
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
                            'inline-flex items-center justify-center min-w-[36px] h-6 rounded-md px-2 font-mono text-xs font-semibold tabular-nums',
                            stock > 10
                              ? 'bg-emerald-50 text-emerald-700'
                              : stock > 0
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-600'
                          )}>
                            {stock}
                          </span>
                        </td>
                        <td className="pr-5 pl-2 py-2.5 text-right">
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editProduct}
        onSave={onReload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ulaz robe Tab — master-detail with polished cards
// ---------------------------------------------------------------------------

function PrimkeTab({ products, dobavljaci, onReloadProducts }: { products: Product[]; dobavljaci: Dobavljac[]; onReloadProducts: () => void }) {
  const [primke, setPrimke] = useState<Primka[]>([]);
  const [selectedPrimka, setSelectedPrimka] = useState<Primka | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPrimka, setEditPrimka] = useState<Primka | null>(null);

  const loadPrimke = useCallback(async () => {
    const data = await window.api.getPrimke();
    setPrimke(data);
  }, []);

  useEffect(() => {
    loadPrimke();
  }, [loadPrimke]);

  const handleSelect = async (p: Primka) => {
    const detail = await window.api.getPrimka(p.id);
    setSelectedPrimka(detail);
  };

  const handleEditPrimka = (primka: Primka) => {
    setEditPrimka(primka);
    setDialogOpen(true);
  };

  const handleDeletePrimka = async (primka: Primka) => {
    if (!confirm(`Obrisati ulaz ${primka.brojPrimke}?`)) return;
    await window.api.deletePrimka(primka.id);
    setSelectedPrimka(null);
    loadPrimke();
    onReloadProducts();
  };

  const handleSavePrimka = () => {
    loadPrimke();
    onReloadProducts();
    setEditPrimka(null);
    if (selectedPrimka) {
      window.api.getPrimka(selectedPrimka.id).then(setSelectedPrimka).catch(() => setSelectedPrimka(null));
    }
  };

  const handlePrintPdf = async (primka: Primka) => {
    const firma = await window.api.getFirmaSettings();
    const blob = await pdf(<UlazPdf primka={primka} firma={firma} />).toBlob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const handleExportPdf = async (primka: Primka) => {
    const firma = await window.api.getFirmaSettings();
    const blob = await pdf(<UlazPdf primka={primka} firma={firma} />).toBlob();
    const filePath = await window.api.showSaveDialog({
      defaultName: `${primka.brojPrimke}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!filePath) return;

    const buffer = await blob.arrayBuffer();
    await window.api.writeFile(filePath, Array.from(new Uint8Array(buffer)) as any);
  };

  const totalNabavna = (stavke: PrimkaStavka[]) =>
    stavke.reduce((sum, s) => sum + s.kolicina * (s.nabavnaCijena || 0), 0);

  const totalProdajna = (stavke: PrimkaStavka[]) =>
    stavke.reduce((sum, s) => sum + s.kolicina * s.cijena, 0);

  const totalPdv = (stavke: PrimkaStavka[]) =>
    stavke.reduce((sum, s) => {
      if (s.pdvStopa !== 'E') return sum;
      const lineTotal = s.kolicina * s.cijena;
      return sum + (lineTotal - lineTotal / 1.17);
    }, 0);

  const [search, setSearch] = useState('');

  const filteredPrimke = primke.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.brojPrimke.toLowerCase().includes(q) ||
      (p.dobavljacNaziv?.toLowerCase().includes(q) ?? false) ||
      (p.napomena?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="flex flex-col h-full">
      {/* Table card with master-detail */}
      <div className="flex-1 min-h-0 px-6 py-5">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
          {/* Header bar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Pretraži po broju, dobavljaču..."
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
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Ulaz robe</span>
              {primke.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                  {primke.length}
                </Badge>
              )}
            </div>
            <Button size="sm" onClick={() => { setEditPrimka(null); setDialogOpen(true); }} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Novi ulaz
            </Button>
          </div>

          <div className="flex flex-1 min-h-0">
            {/* Left: primke list */}
            <div className="w-[280px] min-w-[240px] flex-shrink-0 border-r border-slate-100">
              <ScrollArea className="h-full">
                {filteredPrimke.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-400 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                      <FileText size={24} className="text-slate-300" />
                    </div>
                    <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata' : 'Nema ulaza robe'}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {filteredPrimke.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelect(p)}
                        className={cn(
                          'w-full text-left px-4 py-3 flex items-center gap-3 transition-all duration-100',
                          'hover:bg-slate-50/80',
                          selectedPrimka?.id === p.id
                            ? 'bg-slate-900 text-white hover:bg-slate-900'
                            : ''
                        )}
                      >
                        <div className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                          selectedPrimka?.id === p.id
                            ? 'bg-white/10 text-white'
                            : 'bg-slate-50 text-slate-400'
                        )}>
                          <FileText className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono font-semibold text-[13px] block leading-tight">{p.brojPrimke}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn(
                              'text-[11px] tabular-nums',
                              selectedPrimka?.id === p.id ? 'text-white/50' : 'text-slate-400'
                            )}>
                              {(() => { const d = new Date(p.datum); const pad = (n: number) => String(n).padStart(2, '0'); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; })()}
                            </span>
                            {p.dobavljacNaziv && (
                              <>
                                <span className={cn(
                                  'text-[11px]',
                                  selectedPrimka?.id === p.id ? 'text-white/30' : 'text-slate-300'
                                )}>·</span>
                                <span className={cn(
                                  'text-[11px] truncate',
                                  selectedPrimka?.id === p.id ? 'text-white/50' : 'text-slate-400'
                                )}>{p.dobavljacNaziv}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right: detail panel */}
            <div className="flex-1 min-w-0 flex flex-col">
              {selectedPrimka && selectedPrimka.stavke ? (
                <>
                  {/* Compact toolbar */}
                  <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-100 bg-slate-50/40">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <h3 className="font-mono font-bold text-[15px] tracking-tight text-slate-800">{selectedPrimka.brojPrimke}</h3>
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          {(() => { const d = new Date(selectedPrimka.datum); const pad = (n: number) => String(n).padStart(2, '0'); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; })()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Štampaj" onClick={() => handlePrintPdf(selectedPrimka)}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Izvezi PDF" onClick={() => handleExportPdf(selectedPrimka)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Uredi" onClick={() => handleEditPrimka(selectedPrimka)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" title="Obriši" onClick={() => handleDeletePrimka(selectedPrimka)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Document meta */}
                  {(selectedPrimka.dobavljacNaziv || selectedPrimka.brojFakture || selectedPrimka.napomena) && (
                    <div className="px-4 py-2.5 border-b border-slate-100 space-y-1.5">
                      {selectedPrimka.dobavljacNaziv && (
                        <div className="flex items-start gap-2">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-[13px] font-medium text-slate-700">{selectedPrimka.dobavljacNaziv}</span>
                            {(selectedPrimka.dobavljacId || selectedPrimka.dobavljacAdresa) && (
                              <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                                {[selectedPrimka.dobavljacId && `ID: ${selectedPrimka.dobavljacId}`, selectedPrimka.dobavljacAdresa].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      {selectedPrimka.brojFakture && (
                        <div className="flex items-center gap-2 pl-5">
                          <span className="text-[11px] text-slate-400">Faktura:</span>
                          <span className="text-[12px] font-mono font-medium text-slate-600">{selectedPrimka.brojFakture}</span>
                        </div>
                      )}
                      {selectedPrimka.napomena && (
                        <p className="text-[11px] text-slate-400 italic pl-5">
                          {selectedPrimka.napomena}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Stavke list */}
                  <ScrollArea className="flex-1">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                        <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="text-left pl-4 pr-2 py-2">Artikal</th>
                          <th className="text-right px-2 py-2 w-[60px]">Kol.</th>
                          <th className="text-right px-2 py-2 w-[80px]">Nabavna</th>
                          <th className="text-right px-2 py-2 w-[80px]">Prodajna</th>
                          <th className="text-right pr-4 pl-2 py-2 w-[80px]">Ukupno</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPrimka.stavke.map((s, i) => (
                          <tr key={s.id} className="border-t border-slate-50 transition-colors hover:bg-slate-50/50">
                            <td className="pl-4 pr-2 py-2">
                              <div className="min-w-0 flex items-center gap-2">
                                <span className="text-[10px] text-slate-300 font-mono tabular-nums w-4 text-right flex-shrink-0">{i + 1}</span>
                                <span className="text-[12px] font-medium text-slate-700 truncate">{s.productNaziv ?? `#${s.productId}`}</span>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {s.rabat > 0 && (
                                    <span className="text-[9px] font-bold px-1 py-px rounded bg-blue-500/10 text-blue-600">-{s.rabat}%</span>
                                  )}
                                  <span className={cn(
                                    'text-[9px] font-bold px-1 py-px rounded',
                                    s.pdvStopa === 'E' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-100 text-slate-400'
                                  )}>
                                    {s.pdvStopa === 'E' ? 'E' : 'K'}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-[12px] font-mono tabular-nums text-right text-slate-500">
                              {s.kolicina} <span className="text-[10px]">{s.productJm || 'kom'}</span>
                            </td>
                            <td className="px-2 py-2 text-[12px] font-mono tabular-nums text-right text-slate-500">{formatKM(s.nabavnaCijena || 0)}</td>
                            <td className="px-2 py-2 text-[12px] font-mono tabular-nums text-right text-slate-600">{formatKM(s.cijena)}</td>
                            <td className="pr-4 pl-2 py-2 text-[13px] font-mono tabular-nums text-right font-semibold text-slate-800">{formatKM(s.kolicina * s.cijena)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>

                  {/* Totals */}
                  {(() => {
                    const nabavna = totalNabavna(selectedPrimka.stavke);
                    const prodajna = totalProdajna(selectedPrimka.stavke);
                    const pdv = totalPdv(selectedPrimka.stavke);
                    const ruc = prodajna - nabavna;
                    const marza = ruc - pdv;
                    return (
                      <div className="border-t border-slate-100 bg-slate-50/40">
                        <div className="grid grid-cols-2 divide-x divide-slate-100">
                          <div className="px-4 py-2.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Nabavna</span>
                            <span className="font-mono text-sm tabular-nums font-semibold text-slate-800">{formatKM(nabavna)}</span>
                          </div>
                          <div className="px-4 py-2.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Prodajna</span>
                            <span className="font-mono text-sm tabular-nums font-semibold text-slate-800">{formatKM(prodajna)}</span>
                          </div>
                        </div>

                        {nabavna > 0 && (
                          <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-4 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">RUC</span>
                              <span className="font-mono tabular-nums font-bold text-slate-700">{formatKM(ruc)}</span>
                              <span className="text-[10px] text-slate-400 font-mono">({((ruc / nabavna) * 100).toFixed(1)}%)</span>
                            </div>
                            <div className="w-px h-3 bg-slate-200" />
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">PDV</span>
                              <span className="font-mono tabular-nums text-slate-600">{formatKM(pdv)}</span>
                            </div>
                            <div className="w-px h-3 bg-slate-200" />
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-400">Marža</span>
                              <span className="font-mono tabular-nums font-bold text-emerald-600">{formatKM(marza)}</span>
                              <span className="text-[10px] text-emerald-600 font-mono">({((marza / nabavna) * 100).toFixed(1)}%)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 select-none">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                    <ChevronRight size={24} className="text-slate-300" />
                  </div>
                  <p className="text-[13px] font-medium text-slate-500">Odaberite dokument</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">iz liste za prikaz detalja</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <NovaPrimkaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        products={products}
        dobavljaci={dobavljaci}
        onSave={handleSavePrimka}
        editPrimka={editPrimka}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dobavljači Tab
// ---------------------------------------------------------------------------

interface DobavljacFormData {
  naziv: string;
  idBroj: string;
  pdvBroj: string;
  adresa: string;
  kontakt: string;
}

const emptyDobavljacForm: DobavljacFormData = {
  naziv: '',
  idBroj: '',
  pdvBroj: '',
  adresa: '',
  kontakt: '',
};

function DobavljacDialog({
  open,
  onOpenChange,
  dobavljac,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dobavljac: Dobavljac | null;
  onSave: () => void;
}) {
  const [form, setForm] = useState<DobavljacFormData>(emptyDobavljacForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      if (dobavljac) {
        setForm({
          naziv: dobavljac.naziv,
          idBroj: dobavljac.idBroj ?? '',
          pdvBroj: dobavljac.pdvBroj ?? '',
          adresa: dobavljac.adresa ?? '',
          kontakt: dobavljac.kontakt ?? '',
        });
      } else {
        setForm(emptyDobavljacForm);
      }
    }
  }, [open, dobavljac]);

  const handleSave = async () => {
    if (!form.naziv) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        naziv: form.naziv,
        idBroj: form.idBroj || null,
        pdvBroj: form.pdvBroj || null,
        adresa: form.adresa || null,
        kontakt: form.kontakt || null,
      };
      if (dobavljac) {
        await window.api.updateDobavljac(dobavljac.id, payload);
      } else {
        await window.api.createDobavljac(payload);
      }
      onSave();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Greška pri spremanju');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!dobavljac;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                isEdit ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
              )}>
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">{isEdit ? 'Uredi dobavljača' : 'Novi dobavljač'}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {isEdit ? `ID: ${dobavljac.idBroj || dobavljac.id}` : 'Unesite podatke o dobavljaču'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Separator />

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="dob-naziv" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Naziv firme
            </Label>
            <Input
              id="dob-naziv"
              value={form.naziv}
              onChange={(e) => setForm({ ...form, naziv: e.target.value })}
              placeholder="Npr. Distributer d.o.o."
              className="h-11 text-base"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dob-idbroj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                ID broj
              </Label>
              <Input
                id="dob-idbroj"
                className="font-mono"
                value={form.idBroj}
                onChange={(e) => setForm({ ...form, idBroj: e.target.value })}
                placeholder="4200000000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dob-pdvbroj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                PDV broj
              </Label>
              <Input
                id="dob-pdvbroj"
                className="font-mono"
                value={form.pdvBroj}
                onChange={(e) => setForm({ ...form, pdvBroj: e.target.value })}
                placeholder="200000000000"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dob-adresa" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Adresa
            </Label>
            <Input
              id="dob-adresa"
              value={form.adresa}
              onChange={(e) => setForm({ ...form, adresa: e.target.value })}
              placeholder="Ulica i broj, Grad"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dob-kontakt" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              Kontakt
            </Label>
            <Input
              id="dob-kontakt"
              value={form.kontakt}
              onChange={(e) => setForm({ ...form, kontakt: e.target.value })}
              placeholder="Telefon, email..."
            />
          </div>
        </div>

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
            <Button onClick={handleSave} disabled={saving || !form.naziv} className="min-w-[120px]">
              {saving ? 'Spremam...' : isEdit ? 'Spremi izmjene' : 'Dodaj dobavljača'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DobavljaciTab({
  dobavljaci,
  onReload,
}: {
  dobavljaci: Dobavljac[];
  onReload: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDobavljac, setEditDobavljac] = useState<Dobavljac | null>(null);
  const [search, setSearch] = useState('');

  const handleNew = () => {
    setEditDobavljac(null);
    setDialogOpen(true);
  };

  const handleEdit = (d: Dobavljac) => {
    setEditDobavljac(d);
    setDialogOpen(true);
  };

  const handleDelete = async (d: Dobavljac) => {
    if (!confirm(`Obrisati dobavljača "${d.naziv}"?`)) return;
    await window.api.deleteDobavljac(d.id);
    onReload();
  };

  const filtered = dobavljaci.filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.naziv.toLowerCase().includes(q) ||
      (d.idBroj?.toLowerCase().includes(q) ?? false) ||
      (d.pdvBroj?.toLowerCase().includes(q) ?? false) ||
      (d.adresa?.toLowerCase().includes(q) ?? false)
    );
  });

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
                placeholder="Pretraži dobavljače..."
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
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Dobavljači</span>
              {dobavljaci.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                  {dobavljaci.length}
                </Badge>
              )}
            </div>
            <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Novi dobavljač
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <Building2 size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema dobavljača'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvog dobavljača klikom na dugme iznad</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[140px]">ID broj</th>
                    <th className="text-left px-2 py-2.5 w-[140px]">PDV broj</th>
                    <th className="text-left px-2 py-2.5">Adresa</th>
                    <th className="text-left px-2 py-2.5 w-[120px]">Kontakt</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr
                      key={d.id}
                      className="group border-t border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => handleEdit(d)}
                    >
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-medium text-slate-700">{d.naziv}</td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-slate-400">{d.idBroj || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-slate-400">{d.pdvBroj || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500 truncate max-w-[200px]">{d.adresa || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500">{d.kontakt || '—'}</td>
                      <td className="pr-5 pl-2 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); handleEdit(d); }}>
                            <Pencil className="h-3 w-3 mr-1" /> Uredi
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); handleDelete(d); }}>
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

      <DobavljacDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dobavljac={editDobavljac}
        onSave={onReload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kupac Dialog
// ---------------------------------------------------------------------------

function KupacDialog({
  open,
  onOpenChange,
  kupac,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kupac: Kupac | null;
  onSave: () => void;
}) {
  const [naziv, setNaziv] = useState('');
  const [idBroj, setIdBroj] = useState('');
  const [pdvBroj, setPdvBroj] = useState('');
  const [adresa, setAdresa] = useState('');
  const [postanskiBroj, setPostanskiBroj] = useState('');
  const [grad, setGrad] = useState('');
  const [kontakt, setKontakt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      if (kupac) {
        setNaziv(kupac.naziv);
        setIdBroj(kupac.idBroj);
        setPdvBroj(kupac.pdvBroj ?? '');
        setAdresa(kupac.adresa ?? '');
        setPostanskiBroj(kupac.postanskiBroj ?? '');
        setGrad(kupac.grad ?? '');
        setKontakt(kupac.kontakt ?? '');
      } else {
        setNaziv(''); setIdBroj(''); setPdvBroj(''); setAdresa('');
        setPostanskiBroj(''); setGrad(''); setKontakt('');
      }
    }
  }, [open, kupac]);

  const handleSave = async () => {
    if (!naziv || !idBroj) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        naziv, idBroj,
        pdvBroj: pdvBroj || null,
        adresa: adresa || null,
        postanskiBroj: postanskiBroj || null,
        grad: grad || null,
        kontakt: kontakt || null,
      };
      if (kupac) {
        await window.api.updateKupac(kupac.id, payload);
      } else {
        await window.api.createKupac(payload);
      }
      onSave();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Greška pri spremanju');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!kupac;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center',
                isEdit ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
              )}>
                <Users className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">{isEdit ? 'Uredi kupca' : 'Novi kupac'}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {isEdit ? `JIB: ${kupac.idBroj}` : 'Unesite podatke o kupcu'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <Separator />

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="kup-naziv" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Naziv
            </Label>
            <Input
              id="kup-naziv"
              value={naziv}
              onChange={(e) => setNaziv(e.target.value)}
              placeholder="Npr. Firma d.o.o."
              className="h-11 text-base"
              maxLength={32}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="kup-idbroj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                ID broj (JIB)
              </Label>
              <Input
                id="kup-idbroj"
                className="font-mono"
                value={idBroj}
                onChange={(e) => setIdBroj(e.target.value)}
                placeholder="4200000000000"
                maxLength={13}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kup-pdvbroj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                PDV broj
              </Label>
              <Input
                id="kup-pdvbroj"
                className="font-mono"
                value={pdvBroj}
                onChange={(e) => setPdvBroj(e.target.value)}
                placeholder="200000000000"
                maxLength={12}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kup-adresa" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Adresa
            </Label>
            <Input
              id="kup-adresa"
              value={adresa}
              onChange={(e) => setAdresa(e.target.value)}
              placeholder="Ulica i broj"
              maxLength={32}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="kup-postbroj" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Poštanski broj
              </Label>
              <Input
                id="kup-postbroj"
                className="font-mono"
                value={postanskiBroj}
                onChange={(e) => setPostanskiBroj(e.target.value)}
                placeholder="75000"
                maxLength={5}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kup-grad" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Grad
              </Label>
              <Input
                id="kup-grad"
                value={grad}
                onChange={(e) => setGrad(e.target.value)}
                placeholder="Tuzla"
                maxLength={26}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kup-kontakt" className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="h-3 w-3" />
              Kontakt
            </Label>
            <Input
              id="kup-kontakt"
              value={kontakt}
              onChange={(e) => setKontakt(e.target.value)}
              placeholder="Telefon, email..."
            />
          </div>
        </div>

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
            <Button onClick={handleSave} disabled={saving || !naziv || !idBroj} className="min-w-[120px]">
              {saving ? 'Spremam...' : isEdit ? 'Spremi izmjene' : 'Dodaj kupca'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Kupci Tab
// ---------------------------------------------------------------------------

function KupciTab({
  kupci,
  onReload,
}: {
  kupci: Kupac[];
  onReload: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editKupac, setEditKupac] = useState<Kupac | null>(null);
  const [search, setSearch] = useState('');

  const handleNew = () => {
    setEditKupac(null);
    setDialogOpen(true);
  };

  const handleEdit = (k: Kupac) => {
    setEditKupac(k);
    setDialogOpen(true);
  };

  const handleDelete = async (k: Kupac) => {
    if (!confirm(`Obrisati kupca "${k.naziv}"?`)) return;
    await window.api.deleteKupac(k.id);
    onReload();
  };

  const filtered = kupci.filter(k => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      k.naziv.toLowerCase().includes(q) ||
      k.idBroj.toLowerCase().includes(q) ||
      (k.pdvBroj?.toLowerCase().includes(q) ?? false) ||
      (k.adresa?.toLowerCase().includes(q) ?? false) ||
      (k.grad?.toLowerCase().includes(q) ?? false)
    );
  });

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
                placeholder="Pretraži kupce..."
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
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-700">Kupci</span>
              {kupci.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                  {kupci.length}
                </Badge>
              )}
            </div>
            <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Novi kupac
            </Button>
          </div>

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <Users size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema kupaca'}</p>
              {!search && <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvog kupca klikom na dugme iznad</p>}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                  <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <th className="text-left pl-5 pr-2 py-2.5">Naziv</th>
                    <th className="text-left px-2 py-2.5 w-[140px]">ID broj</th>
                    <th className="text-left px-2 py-2.5 w-[140px]">PDV broj</th>
                    <th className="text-left px-2 py-2.5">Adresa</th>
                    <th className="text-left px-2 py-2.5 w-[100px]">Grad</th>
                    <th className="text-left px-2 py-2.5 w-[100px]">Kontakt</th>
                    <th className="text-right pr-5 pl-2 py-2.5 w-[100px]" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((k) => (
                    <tr
                      key={k.id}
                      className="group border-t border-slate-50 transition-colors hover:bg-slate-50/50 cursor-pointer"
                      onClick={() => handleEdit(k)}
                    >
                      <td className="pl-5 pr-2 py-2.5 text-[12px] font-medium text-slate-700">{k.naziv}</td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-slate-400">{k.idBroj}</td>
                      <td className="px-2 py-2.5 text-[12px] font-mono text-slate-400">{k.pdvBroj || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500 truncate max-w-[200px]">{k.adresa || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500">{k.grad || '—'}</td>
                      <td className="px-2 py-2.5 text-[12px] text-slate-500">{k.kontakt || '—'}</td>
                      <td className="pr-5 pl-2 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); handleEdit(k); }}>
                            <Pencil className="h-3 w-3 mr-1" /> Uredi
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); handleDelete(k); }}>
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

      <KupacDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kupac={editKupac}
        onSave={onReload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

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

  useEffect(() => {
    if (open) {
      if (product) {
        setSifra(product.sifra);
        setNaziv(product.naziv);
        setCijena(String(product.cijena));
        setPdvStopa(product.pdvStopa);
      } else {
        setSifra('');
        setNaziv('');
        setCijena('');
        setPdvStopa('E');
      }
    }
  }, [open, product]);

  const isEdit = !!product;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Uredi uslugu' : 'Nova usluga'}</DialogTitle>
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
              <Input type="number" step="0.01" value={cijena} onChange={e => setCijena(e.target.value)} placeholder="0.00" className="font-mono" />
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
            onClick={() => onSave({ sifra, naziv, cijena: parseFloat(cijena), pdvStopa })}
            disabled={!sifra || !naziv || !cijena}
          >
            {isEdit ? 'Spremi' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Usluge Tab
// ---------------------------------------------------------------------------

function UslugeTab({ usluge, onReload }: { usluge: Product[]; onReload: () => void }) {
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

  const handleSave = async (data: any) => {
    if (editProduct) {
      await window.api.updateProduct(editProduct.id, { ...data, tip: 'usluga' });
    } else {
      await window.api.createProduct({ ...data, tip: 'usluga' });
    }
    setDialogOpen(false);
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editProduct}
        onSave={handleSave}
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
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [usluge, setUsluge] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<SkladisteTab>('artikli');

  const loadProducts = useCallback(async () => {
    const data = await window.api.getProducts('artikal');
    setProducts(data);
  }, []);

  const loadDobavljaci = useCallback(async () => {
    const data = await window.api.getDobavljaci();
    setDobavljaci(data);
  }, []);

  const loadKupci = useCallback(async () => {
    const data = await window.api.getKupci();
    setKupci(data);
  }, []);

  const loadUsluge = useCallback(async () => {
    const data = await window.api.getProducts('usluga');
    setUsluge(data);
  }, []);

  useEffect(() => {
    loadProducts();
    loadDobavljaci();
    loadKupci();
    loadUsluge();
  }, [loadProducts, loadDobavljaci, loadKupci, loadUsluge]);

  const tabs: { id: SkladisteTab; label: string; icon: typeof Package }[] = [
    { id: 'artikli', label: 'Artikli', icon: Package },
    { id: 'usluge', label: 'Usluge', icon: Wrench },
    { id: 'primke', label: 'Ulaz robe', icon: FileText },
    { id: 'dobavljaci', label: 'Dobavljači', icon: Building2 },
    { id: 'kupci', label: 'Kupci', icon: Users },
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
        {activeTab === 'usluge' && <UslugeTab usluge={usluge} onReload={loadUsluge} />}
        {activeTab === 'primke' && <PrimkeTab products={products} dobavljaci={dobavljaci} onReloadProducts={loadProducts} />}
        {activeTab === 'dobavljaci' && <DobavljaciTab dobavljaci={dobavljaci} onReload={loadDobavljaci} />}
        {activeTab === 'kupci' && <KupciTab kupci={kupci} onReload={loadKupci} />}
      </div>
    </div>
  );
}
