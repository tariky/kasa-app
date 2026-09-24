import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { opisLicence, type LicencaInfo } from '@/lib/licencaTipovi';
import LicencaForma from './LicencaForma';
import { ShieldCheck, ShieldAlert, CheckCircle2 } from 'lucide-react';

/**
 * Dialog za unos novog koda. Otvara ga `otvoriLicencaDialog()` ili main
 * proces kad blokira radnju zbog istekle licence.
 */
export default function LicencaDialog({ info }: { info: LicencaInfo | null }) {
  const [open, setOpen] = useState(false);
  const [uspjeh, setUspjeh] = useState<LicencaInfo | null>(null);

  useEffect(() => {
    const otvori = () => { setUspjeh(null); setOpen(true); };
    window.addEventListener('ui:licencaDialog', otvori);
    const odjavi = window.api.onLicencaBlokirano(otvori);
    return () => { window.removeEventListener('ui:licencaDialog', otvori); odjavi(); };
  }, []);

  if (!info) return null;
  const opis = opisLicence(uspjeh ?? info);
  const ok = opis.ton === 'ok';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              ok ? 'bg-emerald-50 text-emerald-600' : opis.ton === 'upozorenje' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600',
            )}>
              {ok ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
            </div>
            <div className="text-left">
              <DialogTitle className="text-lg">{opis.naslov}</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">{opis.tekst}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {uspjeh ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 size={36} className="text-emerald-500" />
            <p className="text-[15px] font-semibold text-slate-800">Licenca je aktivirana</p>
            <p className="text-[13px] text-slate-500">Hvala! Program radi normalno.</p>
          </div>
        ) : (
          <LicencaForma uredjaj={info.uredjaj} onAktivirano={(i) => { setUspjeh(i); setTimeout(() => setOpen(false), 1500); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
