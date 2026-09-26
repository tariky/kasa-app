import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { cn, formatKM } from '@/lib/utils';
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
import { LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import {
  Trash2, Pencil, Wrench,
} from 'lucide-react';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';
import { useIpcPodaci } from '@/hooks/useIpcPodaci';
import { SifarnikLista, PraznaLista, useObrisi } from './SifarnikLista';

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

export function UslugeTab() {
  const ucitavanje = useIpcPodaci(() => window.api.getProducts('usluga'), []);
  const usluge = ucitavanje.podaci ?? [];
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<'naziv' | 'cijena'>('naziv');

  const filtered = filtriraj(usluge, search, poljaUsluge)
    .sort((a, b) => {
      if (sortBy === 'cijena') return b.cijena - a.cijena;
      return a.naziv.localeCompare(b.naziv);
    });

  const handleNew = () => { setEditProduct(null); setDialogOpen(true); };
  const handleEdit = (p: Product) => { setEditProduct(p); setDialogOpen(true); };
  const handleDelete = useObrisi(
    (p: Product) => `Obrisati uslugu "${p.naziv}"?`,
    async (p: Product) => { await window.api.deleteProduct(p.id); await ucitavanje.osvjezi(); },
  );

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
    ucitavanje.osvjezi();
  };

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <>
      <SifarnikLista
        naslov="Nova usluga"
        placeholder="Naziv ili šifra usluge…"
        oznakaPretrage="Pretraga usluga"
        pretraga={search}
        onPretraga={setSearch}
        broj={filtered.length}
        ukupno={usluge.length}
        onNovi={handleNew}
        precice={!dialogOpen}
        ucitavanje={ucitavanje}
        alati={
          <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
            <span className="hidden md:inline">Poredaj</span>
            <SegmentedFilter
              options={[{ id: 'naziv', label: 'A–Z' }, { id: 'cijena', label: 'Cijena' }]}
              value={sortBy} onChange={setSortBy} />
          </div>
        }
        prazno={<PraznaLista ikona={Wrench} poruka={search ? 'Nema rezultata pretrage' : 'Nema usluga'} kakoDodati={!search && 'Prvu uslugu dodaješ'} />}
      >
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
      </SifarnikLista>

      <UslugaDialog
        key={editProduct?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        product={editProduct}
        onSave={handleSave}
      />
    </>
  );
}
