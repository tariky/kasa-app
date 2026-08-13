import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { Paperclip } from 'lucide-react';
import { prilogNaziv } from '@/lib/prilog';
import { formatKM } from '@/lib/utils';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

interface PrilogRacunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  korisnikId: number;
  onSuccess: (res: { id: number; prilogBroj: number; brojFiskalnogRacuna: string | null }) => void;
}

/**
 * Fiskalizacija računa po prilogu: operater unese samo ukupan iznos, a na
 * fiskalni račun ide jedna zbirna stavka. Stvarne stavke se naknadno
 * dodjeljuju u sekciji Računi i štampaju kao A4 specifikacija.
 */
export default function PrilogRacunDialog({ open, onOpenChange, korisnikId, onSuccess }: PrilogRacunDialogProps) {
  const [iznos, setIznos] = useState<number | null>(null);
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Gotovina');
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextBroj, setNextBroj] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setIznos(null); setNacinPlacanja('Gotovina');
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setError(null); setBusy(false); setNextBroj(null);
    window.api.getNextPrilogBroj().then(setNextBroj).catch(() => setNextBroj(null));
  }, [open]);

  const handleConfirm = async () => {
    setError(null);
    if (!iznos || iznos <= 0) { setError('Unesite iznos veći od 0.'); return; }
    // Virman ide na žiro račun — bez kupca na računu nema ko da uplati.
    if (nacinPlacanja === 'Virman' && !kupacIdBroj.trim()) {
      setError('Za virman je obavezan kupac — unesite ID broj kupca.');
      return;
    }

    setBusy(true);
    try {
      const res = await window.api.finalizePrilogOrder({
        korisnikId,
        iznos,
        nacinPlacanja,
        kupac: kupacIdBroj.trim() ? {
          naziv: kupacNaziv.trim(), idBroj: kupacIdBroj.trim(), adresa: kupacAdresa.trim(),
          grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim(),
        } : undefined,
      });

      if (res?.success) {
        onSuccess({
          id: res.id!,
          prilogBroj: res.prilogBroj!,
          brojFiskalnogRacuna: res.brojFiskalnogRacuna ?? null,
        });
        onOpenChange(false);
      } else {
        const details = res?.odgovori ? Object.entries(res.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setError(`${res?.error || 'Štampa nije uspjela'}${details ? ` (${details})` : ''}`);
      }
    } catch (err: any) {
      setError(err?.message || 'Nepoznata greška');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Paperclip className="h-4 w-4 text-slate-400" />
            Račun po prilogu
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            Na fiskalni račun ide jedna zbirna stavka. Stavke dodijelite kasnije u sekciji Računi.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Iznos (KM) *</Label>
            <DecimalInput
              autoFocus
              value={iznos ?? ''}
              onValueChange={(_, n) => setIznos(isNaN(n) ? null : n)}
              placeholder="0,00"
              className="h-12 text-lg font-mono tabular-nums"
            />
            {nextBroj !== null && (
              <p className="text-[11.5px] text-slate-400 mt-1.5">
                Stavka na računu: <span className="font-medium text-slate-500">&bdquo;{prilogNaziv(nextBroj)}&ldquo;</span>
              </p>
            )}
          </div>

          <div>
            <Label>Način plaćanja</Label>
            <div className="grid grid-cols-4 gap-1.5 mt-1">
              {(['Gotovina', 'Kartica', 'Virman', 'Ček'] as PaymentType[]).map(t => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={nacinPlacanja === t ? 'default' : 'outline'}
                  onClick={() => setNacinPlacanja(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <details className="border rounded-md px-3 py-2" open={nacinPlacanja === 'Virman'}>
            <summary className="cursor-pointer text-sm text-slate-600">Kupac (opcionalno)</summary>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><Label>ID broj</Label><Input value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} /></div>
              <div><Label>Naziv</Label><Input value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} /></div>
              <div><Label>Adresa</Label><Input value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} /></div>
              <div><Label>Grad</Label><Input value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} /></div>
              <div><Label>Poštanski broj</Label><Input value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} /></div>
            </div>
          </details>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Otkaži</Button>
          <Button onClick={handleConfirm} disabled={busy || !iznos || iznos <= 0}>
            {busy ? 'Štampam...' : `Fiskalizuj${iznos ? ` ${formatKM(iznos)}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
