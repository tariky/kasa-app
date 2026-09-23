// src/components/proizvodnja/NalogDialog.tsx
import { useEffect, useState } from 'react';
import type { Kupac, Product, RadniNalog, NalogVrsta } from '@/types';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User, Package } from 'lucide-react';

export function NalogDialog({ open, onOpenChange, korisnikId, nalog, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; korisnikId: number;
  nalog: RadniNalog | null; onSaved: (id: number) => void;
}) {
  const [vrsta, setVrsta] = useState<NalogVrsta>('narudzba');
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [artikli, setArtikli] = useState<Product[]>([]);
  const [kupacId, setKupacId] = useState('');
  const [productId, setProductId] = useState('');
  const [kolicina, setKolicina] = useState('1');
  const [opis, setOpis] = useState('');
  const [datum, setDatum] = useState(localDateStr());
  const [rok, setRok] = useState('');
  const [cijena, setCijena] = useState('');
  const [napomena, setNapomena] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    window.api.getKupci().then(setKupci);
    window.api.getProducts('artikal').then(setArtikli);
    setError('');
    if (nalog) {
      setVrsta(nalog.vrsta);
      setKupacId(nalog.kupacId ? String(nalog.kupacId) : '');
      setProductId(nalog.productId ? String(nalog.productId) : '');
      setKolicina(String(nalog.kolicina));
      setOpis(nalog.opis);
      setDatum(nalog.datum);
      setRok(nalog.rok ?? '');
      setCijena(nalog.dogovorenaCijena != null ? String(nalog.dogovorenaCijena) : '');
      setNapomena(nalog.napomena ?? '');
    } else {
      setVrsta('narudzba'); setKupacId(''); setProductId(''); setKolicina('1'); setOpis('');
      setDatum(localDateStr()); setRok(''); setCijena(''); setNapomena('');
    }
  }, [open, nalog]);

  const isEdit = !!nalog;
  const zavrsen = nalog?.status === 'zavrsen';
  const valid = vrsta === 'narudzba'
    ? !!kupacId && opis.trim().length > 0
    : !!productId && parseDecimal(kolicina) > 0;

  const spremi = async () => {
    setSaving(true); setError('');
    try {
      let payload: any;
      if (zavrsen) {
        payload = { dogovorenaCijena: cijena ? parseDecimal(cijena) : null, rok: rok || null, napomena: napomena || null };
      } else {
        payload = {
          opis: opis.trim(), datum, rok: rok || null, napomena: napomena || null,
          dogovorenaCijena: cijena ? parseDecimal(cijena) : null,
        };
        if (vrsta === 'narudzba') payload.kupacId = Number(kupacId);
        else { payload.productId = Number(productId); payload.kolicina = parseDecimal(kolicina); }
      }
      let id: number;
      if (isEdit) { await window.api.updateNalog(nalog!.id, payload); id = nalog!.id; }
      else { const r = await window.api.createNalog({ ...payload, vrsta, korisnikId }); id = r.id; }
      onOpenChange(false);
      onSaved(id);
    } catch (e: any) { setError(e?.message || 'Greška pri spremanju'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Uredi nalog` : 'Novi radni nalog'}</DialogTitle>
          <DialogDescription>
            {vrsta === 'narudzba' ? 'Izrada po narudžbi za poznatog kupca.' : 'Standardni proizvod koji ide na zalihu.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {zavrsen && (
            <p className="text-[11.5px] text-amber-700 bg-amber-50/70 border border-amber-100 rounded-lg px-3 py-2">
              Nalog je završen — može se mijenjati samo cijena, rok i napomena.
            </p>
          )}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2">
              {([['narudzba', 'Po narudžbi', User], ['zaliha', 'Za zalihu', Package]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" onClick={() => setVrsta(v)} aria-pressed={vrsta === v}
                  className={cn('h-10 flex items-center justify-center gap-2 rounded-lg border text-[12.5px] font-medium',
                    vrsta === v ? 'bg-[#0f1629] text-white border-[#0f1629]' : 'text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}

          {vrsta === 'narudzba' ? (
            <div className="space-y-2">
              <Label>Kupac</Label>
              <Select value={kupacId} onValueChange={setKupacId} disabled={zavrsen}>
                <SelectTrigger><SelectValue placeholder="Odaberi kupca…" /></SelectTrigger>
                <SelectContent>
                  {kupci.map(k => <SelectItem key={k.id} value={String(k.id)}>{k.naziv}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <div className="space-y-2">
                <Label>Proizvod</Label>
                <Select value={productId} onValueChange={setProductId} disabled={isEdit || zavrsen}>
                  <SelectTrigger><SelectValue placeholder="Odaberi proizvod…" /></SelectTrigger>
                  <SelectContent>
                    {artikli.map(p => <SelectItem key={p.id} value={String(p.id)}><span className="font-mono text-xs text-slate-400 mr-2">{p.sifra}</span>{p.naziv}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Komada</Label>
                <DecimalInput maxDecimals={0} value={kolicina} onValueChange={t => setKolicina(t)} className="font-mono" disabled={zavrsen} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Opis {vrsta === 'zaliha' && <span className="text-slate-400 font-normal">— opciono</span>}</Label>
            <Input value={opis} onChange={e => setOpis(e.target.value)} placeholder="Kuhinja 3,2 m, bijela mat, radna ploča hrast" disabled={zavrsen} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2"><Label>Datum</Label><DatePicker value={datum} onChange={setDatum} disabled={zavrsen} /></div>
            <div className="space-y-2"><Label>Rok isporuke</Label><DatePicker value={rok} onChange={setRok} /></div>
            {vrsta === 'narudzba' && (
              <div className="space-y-2">
                <Label>Dogovorena cijena</Label>
                <DecimalInput value={cijena} onValueChange={t => setCijena(t)} placeholder="0,00" className="font-mono" />
                {cijena && <p className="text-[10.5px] text-slate-400 font-mono">{formatKM(parseDecimal(cijena) || 0)} sa PDV-om</p>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Napomena</Label>
            <Input value={napomena} onChange={e => setNapomena(e.target.value)} placeholder="Opcionalno" />
          </div>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button onClick={spremi} disabled={!valid || saving}>{isEdit ? 'Spremi' : 'Otvori nalog'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
