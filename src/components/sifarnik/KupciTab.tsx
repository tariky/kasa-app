import { useState, useEffect } from 'react';
import { Kupac } from '@/types';
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
  Plus, Trash2, Search, Pencil, X, Users, Phone,
} from 'lucide-react';

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
                onChange={(e) => setIdBroj(e.target.value.replace(/\D/g, ''))}
                placeholder="4200000000000"
                maxLength={13}
                inputMode="numeric"
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
                onChange={(e) => setPdvBroj(e.target.value.replace(/\D/g, ''))}
                placeholder="200000000000"
                maxLength={12}
                inputMode="numeric"
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
                onChange={(e) => setPostanskiBroj(e.target.value.replace(/\D/g, ''))}
                placeholder="75000"
                maxLength={5}
                inputMode="numeric"
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

export function KupciTab({
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
