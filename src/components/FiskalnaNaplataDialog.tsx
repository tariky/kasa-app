import { useEffect, useState } from 'react';
import { AlertTriangle, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, Key, mod } from '@/components/ui/ledger';
import { NacinPlacanjaBirac } from '@/components/NacinPlacanjaBirac';
import { formatKM } from '@/lib/utils';
import { NACINI_PLACANJA, type NacinPlacanja } from '@/lib/placanje';
import { izvrsiFiskalno, type FiskalniOdgovor } from '@/lib/fiskalniIshod';
import { otvoriNezavrseneRacune } from '@/lib/nezavrseniRacuni';

/**
 * Izdavanje fiskalnog računa za gotov dokument (ponuda, radni nalog): izbor
 * načina plaćanja, jedan poziv koji štampa i upisuje, ishod kroz
 * `izvrsiFiskalno`. Samo `greska` ostavlja dijalog otvoren za novi pokušaj;
 * nepoznat ishod i već evidentiran račun ga zatvaraju (`onNezavrseno`) da se
 * dokument ne pošalje uređaju ponovo — nepoznat otvara i nezavršene račune.
 */
export default function FiskalnaNaplataDialog<R extends FiskalniOdgovor>({
  open, onOpenChange, naslov, opis, napomena, iznos, zadaniNacin, blokada, onIzdaj, onUspjeh, onNezavrseno,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  naslov: string;
  opis: string;
  /** Tekst ispod upozorenja o štampi. */
  napomena: string;
  iznos: number;
  zadaniNacin: NacinPlacanja;
  /** Razlog zbog kojeg se račun još ne može izdati (npr. nema cijene); null = može. */
  blokada?: string | null;
  /** Poziv backenda koji štampa i upisuje račun. */
  onIzdaj: (nacin: NacinPlacanja) => Promise<R>;
  onUspjeh: (res: R) => void;
  /** Ishod štampe nije poznat ili je račun već upisan iz dijaloga nezavršenih računa. */
  onNezavrseno: (poruka: string) => void;
}) {
  const [nacin, setNacin] = useState<NacinPlacanja>(zadaniNacin);
  const [busy, setBusy] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setNacin(zadaniNacin); setGreska(null); }
  }, [open, zadaniNacin]);

  const zatvori = (v: boolean) => { if (!busy) onOpenChange(v); };

  const izdaj = async () => {
    if (busy || blokada) return;
    setBusy(true);
    setGreska(null);
    try {
      const { ishod, res } = await izvrsiFiskalno(() => onIzdaj(nacin));
      switch (ishod.vrsta) {
        case 'uspjeh':
          onOpenChange(false);
          onUspjeh(res as R);
          return;
        case 'nepoznat':
          onOpenChange(false);
          otvoriNezavrseneRacune();
          onNezavrseno(ishod.poruka);
          return;
        case 'vecEvidentiran':
          onOpenChange(false);
          onNezavrseno(ishod.poruka);
          return;
        case 'greska':
          setGreska(`Greška: ${ishod.poruka}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={zatvori}>
      <DialogContent
        className="sm:max-w-[440px] p-0 gap-0 overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); izdaj(); return; }
          const i = Number(e.key);
          if (i >= 1 && i <= NACINI_PLACANJA.length) { e.preventDefault(); setNacin(NACINI_PLACANJA[i - 1]); }
        }}
      >
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                <Receipt className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <DialogTitle className="text-lg">{naslov}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">{opis}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        <Separator />

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-amber-700">Fiskalni račun će biti odštampan</p>
              <p className="text-[11px] text-amber-600/70 mt-0.5">{napomena}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Eyebrow className="block">Način plaćanja</Eyebrow>
            <NacinPlacanjaBirac varijanta="mreza" value={nacin} onChange={setNacin} />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <span className="text-[12px] text-slate-500">Za naplatu</span>
            <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{formatKM(iznos)}</span>
          </div>
          {blokada && <p className="text-[11px] text-amber-600">{blokada}</p>}

          {greska && (
            <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {greska}
            </div>
          )}
        </div>

        <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <Key className="ml-0">{mod('↵')}</Key> izdaj
          </span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => zatvori(false)} disabled={busy}>Otkaži</Button>
            <Button onClick={izdaj} disabled={busy || !!blokada} className="min-w-[160px]">
              {busy ? 'Štampam…' : 'Izdaj fiskalni račun'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
