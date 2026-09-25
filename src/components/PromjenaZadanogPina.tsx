import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { porukaGreske } from '@/lib/utils';

/**
 * Prijava sa zadanim PIN-om (0000) ne ulazi u program dok korisnik ne postavi
 * svoj PIN. Sesija u main procesu već postoji, pa promjena ide kroz
 * user:promijeniSvojPin; odustajanje je odjava.
 */
export default function PromjenaZadanogPina({ open, stariPin, onPromijenjen, onOdustani }: {
  open: boolean;
  stariPin: string;
  onPromijenjen: () => void;
  onOdustani: () => void;
}) {
  const [novi, setNovi] = useState('');
  const [ponovo, setPonovo] = useState('');
  const [greska, setGreska] = useState('');
  const [sprema, setSprema] = useState(false);

  const spreman = novi.length >= 4 && ponovo.length >= 4 && !sprema;

  const spremi = async () => {
    if (!spreman) return;
    if (novi !== ponovo) { setGreska('PIN-ovi se ne podudaraju'); return; }
    setSprema(true);
    try {
      await window.api.promijeniSvojPin(stariPin, novi);
      onPromijenjen();
    } catch (err) {
      setGreska(porukaGreske(err));
    } finally {
      setSprema(false);
    }
  };

  const cifre = (v: string) => v.replace(/\D/g, '');

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onOdustani(); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound size={16} className="text-amber-500" /> Promijenite zadani PIN</DialogTitle>
          <DialogDescription>
            Prijavili ste se zadanim PIN-om {stariPin}, koji svako može pogoditi. Prije ulaska postavite svoj PIN.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); spremi(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="novi-pin" className="text-[12px] text-slate-600">Novi PIN (4 do 6 cifara)</Label>
            <Input id="novi-pin" type="password" inputMode="numeric" maxLength={6} autoFocus autoComplete="off"
              value={novi} onChange={e => { setNovi(cifre(e.target.value)); setGreska(''); }}
              className="font-mono text-center text-lg h-10 tracking-[0.3em]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ponovi-pin" className="text-[12px] text-slate-600">Ponovite novi PIN</Label>
            <Input id="ponovi-pin" type="password" inputMode="numeric" maxLength={6} autoComplete="off"
              value={ponovo} onChange={e => { setPonovo(cifre(e.target.value)); setGreska(''); }}
              className="font-mono text-center text-lg h-10 tracking-[0.3em]" />
          </div>
          {greska && <p role="alert" className="text-[12px] font-medium text-rose-600">{greska}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onOdustani}>Odustani</Button>
            <Button type="submit" disabled={!spreman}>Spremi i uđi</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
