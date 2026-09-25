import { useState, useEffect, useRef } from 'react';
import { Dobavljac } from '@/types';
import { cn, porukaGreske } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key, LedgerHead } from '@/components/ui/ledger';
import { Separator } from '@/components/ui/separator';
import {
  Plus, Trash2, Search, Pencil, X, Building2, Phone,
} from 'lucide-react';
import { potvrdi, obavijesti } from '@/lib/dijalog';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';

// ---------------------------------------------------------------------------
// Dobavljač Dialog
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

/** Pretraga dobavljača: naziv, ID broj, PDV broj i adresa (ID i u dodatnom, da i dio broja pogađa). */
const poljaDobavljaca = (d: Dobavljac): PoljaPretrage => ({
  naziv: d.naziv,
  sifra: d.idBroj,
  dodatno: [d.idBroj, d.pdvBroj, d.adresa].join(' '),
});

export function DobavljaciTab({
  dobavljaci,
  onReload,
}: {
  dobavljaci: Dobavljac[];
  onReload: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDobavljac, setEditDobavljac] = useState<Dobavljac | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const handleNew = () => {
    setEditDobavljac(null);
    setDialogOpen(true);
  };

  const handleEdit = (d: Dobavljac) => {
    setEditDobavljac(d);
    setDialogOpen(true);
  };

  const handleDelete = async (d: Dobavljac) => {
    if (!(await potvrdi(`Obrisati dobavljača "${d.naziv}"?`))) return;
    try { await window.api.deleteDobavljac(d.id); onReload(); }
    catch (e) { await obavijesti(porukaGreske(e)); }
  };

  const filtered = filtriraj(dobavljaci, search, poljaDobavljaca);

  // "/" pretraga, "N" novi dobavljač — isto kao na listi artikala.
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
  const prazno = <span className="text-slate-200">—</span>;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Naziv, ID broj, PDV broj ili adresa…"
            aria-label="Pretraga dobavljača"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <span className="text-[11.5px] text-slate-400 whitespace-nowrap">
          {search ? <><span className="font-mono tabular-nums text-slate-600">{filtered.length}</span> od </> : 'Ukupno '}
          <span className="font-mono tabular-nums text-slate-600">{dobavljaci.length}</span>
        </span>

        <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 pl-3 pr-2 text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Novi dobavljač <Key tone="dark">N</Key>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Building2 size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema dobavljača'}</p>
          {!search && <p className="text-[12px] text-slate-400 mt-0.5">Prvog dobavljača dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <table className="w-full border-separate border-spacing-0">
            <LedgerHead columns={[
              { label: 'Naziv', className: 'text-left pl-6 pr-3' },
              { label: 'ID broj', className: 'text-left px-3 w-[1%] whitespace-nowrap' },
              { label: 'PDV broj', className: 'text-left px-3 w-[1%] whitespace-nowrap hidden xl:table-cell' },
              { label: 'Adresa', className: 'text-left px-3 hidden lg:table-cell' },
              { label: 'Kontakt', className: 'text-left px-3 w-[170px] hidden xl:table-cell' },
              { label: '', className: 'pr-6 pl-2 w-[1%]' },
            ]} />
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className="group transition-colors hover:bg-slate-50 cursor-pointer"
                  onClick={() => handleEdit(d)}
                >
                  <td className={cn(td, 'pl-6 pr-3 max-w-0')}>
                    <span className="block truncate text-[12.5px] font-medium text-slate-800">{d.naziv}</span>
                    {(d.adresa || d.kontakt) && (
                      <span className="xl:hidden block truncate text-[11px] text-slate-400">
                        {d.adresa && <span className="lg:hidden">{d.adresa}</span>}
                        {d.adresa && d.kontakt && <span className="lg:hidden"> · </span>}
                        {d.kontakt}
                      </span>
                    )}
                  </td>
                  <td className={cn(td, 'px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>
                    {d.idBroj || prazno}
                    {d.pdvBroj && <span className="xl:hidden block font-mono text-[10.5px] text-slate-400">PDV {d.pdvBroj}</span>}
                  </td>
                  <td className={cn(td, 'hidden xl:table-cell px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{d.pdvBroj || prazno}</td>
                  <td className={cn(td, 'hidden lg:table-cell px-3 max-w-0 truncate text-[12px] text-slate-500')}>{d.adresa || prazno}</td>
                  <td className={cn(td, 'hidden xl:table-cell px-3 max-w-0 truncate text-[12px] text-slate-500')}>{d.kontakt || prazno}</td>
                  <td className={cn(td, 'pr-6 pl-2 text-right')}>
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" title="Uredi" aria-label={`Uredi ${d.naziv}`}
                        onClick={(e) => { e.stopPropagation(); handleEdit(d); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Obriši" aria-label={`Obriši ${d.naziv}`}
                        onClick={(e) => { e.stopPropagation(); handleDelete(d); }}>
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

      <DobavljacDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dobavljac={editDobavljac}
        onSave={onReload}
      />
    </div>
  );
}
