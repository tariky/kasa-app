import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DecimalInput } from '@/components/ui/decimal-input';

interface Props {
  open: boolean;
  tip: 'polog' | 'povrat';
  korisnikId: number;
  /** Predloženi iznos pri otvaranju (npr. zadnji polog). */
  suggested?: number;
  /** Tekst iznad forme — jutarnji prompt objašnjava zašto se ovo pita. */
  intro?: string;
  onClose: () => void;
  /** Poziva se nakon uspješnog upisa (Tring slanje može biti i error — zapis postoji). */
  onSaved?: () => void;
}

const NASLOVI = { polog: 'Polog gotovine', povrat: 'Povrat novca iz kase' };

export default function CashMovementDialog({ open, tip, korisnikId, suggested, intro, onClose, onSaved }: Props) {
  const [iznosText, setIznosText] = useState('');
  const [iznos, setIznos] = useState(NaN);
  const [napomena, setNapomena] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setIznosText(suggested ? String(suggested).replace('.', ',') : '');
      setIznos(suggested ?? NaN);
      setNapomena('');
      setError('');
    }
  }, [open, suggested]);

  const save = async () => {
    if (!Number.isFinite(iznos) || iznos <= 0) { setError('Unesi iznos veći od nule'); return; }
    setLoading(true);
    setError('');
    try {
      const r = await window.api.addCashMovement({ tip, iznos, korisnikId, napomena: napomena.trim() || undefined });
      if (r.tringStatus === 'error') {
        // Zapis je u bazi; korisnik mora znati da printer nije potvrdio.
        setError(`Zapisano, ali slanje na fiskalni printer nije uspjelo (${r.error || 'nepoznata greška'}). Ponovi slanje na Izvještajima.`);
        onSaved?.();
        return;
      }
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Greška');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{NASLOVI[tip]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {intro && <p className="text-sm text-slate-600">{intro}</p>}
          <div className="space-y-1.5">
            <Label>Iznos (KM)</Label>
            <DecimalInput
              value={iznosText}
              onValueChange={(text, value) => { setIznosText(text); setIznos(value); }}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Napomena (opcionalno)</Label>
            <Input value={napomena} onChange={(e) => setNapomena(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {tip === 'polog' ? 'Preskoči' : 'Odustani'}
            </Button>
            <Button onClick={save} disabled={loading}>
              {loading ? 'Slanje…' : 'Unesi'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
