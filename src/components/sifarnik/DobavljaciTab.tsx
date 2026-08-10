import { useState, useEffect } from 'react';
import { Dobavljac } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Plus, Trash2, Search, Pencil, X, Building2, Phone,
} from 'lucide-react';

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
