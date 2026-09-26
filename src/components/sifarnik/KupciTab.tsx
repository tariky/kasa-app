import { useState, useEffect } from 'react';
import { Kupac } from '@/types';
import { cn, parseDecimal } from '@/lib/utils';
import { NACINI_PLACANJA } from '@/lib/dokumentPostavke';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LedgerHead } from '@/components/ui/ledger';
import { Separator } from '@/components/ui/separator';
import {
  Trash2, Pencil, X, Users, Phone,
} from 'lucide-react';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';
import { useIpcPodaci } from '@/hooks/useIpcPodaci';
import { SifarnikLista, PraznaLista, useObrisi } from './SifarnikLista';

// ---------------------------------------------------------------------------
// Kupac Dialog
// ---------------------------------------------------------------------------

/** Radix Select ne dozvoljava praznu vrijednost stavke — ovo znači „kao u postavkama“ (null). */
const NACIN_GLOBALNO = '__globalno';

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
  // Zadano za dokumente; prazno = globalna postavka
  const [rokPlacanja, setRokPlacanja] = useState('');
  const [nacinPlacanja, setNacinPlacanja] = useState('');
  const [rabat, setRabat] = useState('');
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
        setRokPlacanja(String(kupac.rokPlacanjaDana ?? ''));
        setNacinPlacanja(kupac.nacinPlacanja ?? '');
        setRabat(kupac.rabat != null ? String(kupac.rabat).replace('.', ',') : '');
      } else {
        setNaziv(''); setIdBroj(''); setPdvBroj(''); setAdresa('');
        setPostanskiBroj(''); setGrad(''); setKontakt('');
        setRokPlacanja(''); setNacinPlacanja(''); setRabat('');
      }
    }
  }, [open, kupac]);

  const handleSave = async () => {
    if (!naziv || !idBroj) return;
    // Opseg provjerava backend; ovdje samo da smeće ne ode kao broj („5abc“, „1.234,5“ parseFloat bi progutao)
    const rabatTekst = rabat.trim();
    const rabatBroj = rabatTekst === '' ? null : parseDecimal(rabatTekst);
    if (rabatBroj !== null && (!/^\d+([.,]\d+)?$/.test(rabatTekst) || !Number.isFinite(rabatBroj))) {
      setError('Rabat mora biti broj, npr. 5 ili 5,5');
      return;
    }
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
        rokPlacanjaDana: rokPlacanja.trim() === '' ? null : Number(rokPlacanja),
        nacinPlacanja: nacinPlacanja || null,
        rabat: rabatBroj,
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

          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Zadano za dokumente
              </Label>
              <p className="text-xs text-muted-foreground">Prazno = kao u Postavkama › Dokumenti.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kup-rok" className="text-xs font-medium text-muted-foreground">
                  Rok plaćanja (dana)
                </Label>
                <Input
                  id="kup-rok"
                  className="font-mono"
                  value={rokPlacanja}
                  onChange={(e) => setRokPlacanja(e.target.value.replace(/\D/g, ''))}
                  placeholder="npr. 30"
                  maxLength={3}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kup-nacin" className="text-xs font-medium text-muted-foreground">
                  Način plaćanja
                </Label>
                <Select
                  value={nacinPlacanja || NACIN_GLOBALNO}
                  onValueChange={(v) => setNacinPlacanja(v === NACIN_GLOBALNO ? '' : v)}
                >
                  <SelectTrigger id="kup-nacin">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NACIN_GLOBALNO}>Kao u postavkama</SelectItem>
                    {NACINI_PLACANJA.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kup-rabat" className="text-xs font-medium text-muted-foreground">
                  Rabat (%)
                </Label>
                <Input
                  id="kup-rabat"
                  className="font-mono"
                  value={rabat}
                  onChange={(e) => setRabat(e.target.value)}
                  placeholder="npr. 5"
                  inputMode="decimal"
                />
              </div>
            </div>
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

/** Pretraga kupaca: naziv, ID broj, PDV broj, adresa i grad (ID i u dodatnom, da i dio broja pogađa). */
const poljaKupca = (k: Kupac): PoljaPretrage => ({
  naziv: k.naziv,
  sifra: k.idBroj,
  dodatno: [k.idBroj, k.pdvBroj, k.adresa, k.grad].join(' '),
});

export function KupciTab() {
  const ucitavanje = useIpcPodaci(() => window.api.getKupci(), []);
  const kupci = ucitavanje.podaci ?? [];
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

  const handleDelete = useObrisi(
    (k: Kupac) => `Obrisati kupca "${k.naziv}"?`,
    async (k: Kupac) => { await window.api.deleteKupac(k.id); await ucitavanje.osvjezi(); },
  );

  const filtered = filtriraj(kupci, search, poljaKupca);

  const td = 'py-2.5 border-b border-slate-100';
  const prazno = <span className="text-slate-200">—</span>;

  return (
    <>
      <SifarnikLista
        naslov="Novi kupac"
        placeholder="Naziv, JIB, PDV broj, adresa ili grad…"
        oznakaPretrage="Pretraga kupaca"
        pretraga={search}
        onPretraga={setSearch}
        broj={filtered.length}
        ukupno={kupci.length}
        onNovi={handleNew}
        precice={!dialogOpen}
        ucitavanje={ucitavanje}
        prazno={<PraznaLista ikona={Users} poruka={search ? 'Nema rezultata pretrage' : 'Nema kupaca'} kakoDodati={!search && 'Prvog kupca dodaješ'} />}
      >
        <table className="w-full border-separate border-spacing-0">
          <LedgerHead columns={[
            { label: 'Naziv', className: 'text-left pl-6 pr-3' },
            { label: 'ID broj', className: 'text-left px-3 w-[1%] whitespace-nowrap' },
            { label: 'PDV broj', className: 'text-left px-3 w-[1%] whitespace-nowrap hidden xl:table-cell' },
            { label: 'Adresa', className: 'text-left px-3 hidden lg:table-cell' },
            { label: 'Grad', className: 'text-left px-3 w-[130px]' },
            { label: 'Kontakt', className: 'text-left px-3 w-[170px] hidden xl:table-cell' },
            { label: '', className: 'pr-6 pl-2 w-[1%]' },
          ]} />
          <tbody>
            {filtered.map((k) => (
              <tr
                key={k.id}
                className="group transition-colors hover:bg-slate-50 cursor-pointer"
                onClick={() => handleEdit(k)}
              >
                <td className={cn(td, 'pl-6 pr-3 max-w-0')}>
                  <span className="block truncate text-[12.5px] font-medium text-slate-800">{k.naziv}</span>
                  {(k.adresa || k.kontakt) && (
                    <span className="xl:hidden block truncate text-[11px] text-slate-400">
                      {k.adresa && <span className="lg:hidden">{k.adresa}</span>}
                      {k.adresa && k.kontakt && <span className="lg:hidden"> · </span>}
                      {k.kontakt}
                    </span>
                  )}
                </td>
                <td className={cn(td, 'px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>
                  {k.idBroj}
                  {k.pdvBroj && <span className="xl:hidden block font-mono text-[10.5px] text-slate-400">PDV {k.pdvBroj}</span>}
                </td>
                <td className={cn(td, 'hidden xl:table-cell px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{k.pdvBroj || prazno}</td>
                <td className={cn(td, 'hidden lg:table-cell px-3 max-w-0 truncate text-[12px] text-slate-500')}>{k.adresa || prazno}</td>
                <td className={cn(td, 'px-3 max-w-0 truncate text-[12px] text-slate-500')}>{k.grad || prazno}</td>
                <td className={cn(td, 'hidden xl:table-cell px-3 max-w-0 truncate text-[12px] text-slate-500')}>{k.kontakt || prazno}</td>
                <td className={cn(td, 'pr-6 pl-2 text-right')}>
                  <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" title="Uredi" aria-label={`Uredi ${k.naziv}`}
                      onClick={(e) => { e.stopPropagation(); handleEdit(k); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Obriši" aria-label={`Obriši ${k.naziv}`}
                      onClick={(e) => { e.stopPropagation(); handleDelete(k); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SifarnikLista>

      <KupacDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kupac={editKupac}
        onSave={ucitavanje.osvjezi}
      />
    </>
  );
}
