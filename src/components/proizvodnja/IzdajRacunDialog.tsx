import { useEffect, useState } from 'react';
import type { RadniNalog } from '@/types';
import { formatBrojNaloga, PRODAJNA_USLUGA } from '@/lib/proizvodnja';
import { cn, formatKM } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, Key } from '@/components/ui/ledger';
import { Receipt, AlertTriangle, Banknote, CreditCard, Building, FileCheck } from 'lucide-react';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
const PAYMENTS: { type: PaymentType; icon: React.ReactNode }[] = [
  { type: 'Gotovina', icon: <Banknote size={14} /> },
  { type: 'Kartica', icon: <CreditCard size={14} /> },
  { type: 'Virman', icon: <Building size={14} /> },
  { type: 'Ček', icon: <FileCheck size={14} /> },
];

export function IzdajRacunDialog({ open, onOpenChange, nalog, korisnikId, onIzdat }: {
  open: boolean; onOpenChange: (v: boolean) => void; nalog: RadniNalog; korisnikId: number;
  onIzdat: (brojFiskalnog: string | null) => void;
}) {
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const izPonude = !!nalog.ponudaId;

  useEffect(() => {
    if (open) { setErr(null); setPaymentType('Gotovina'); setBusy(false); }
  }, [open, nalog.id]);

  const izdaj = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await window.api.izdajRacunZaNalog({ id: nalog.id, korisnikId, nacinPlacanja: paymentType });
      if (!r || !r.success) {
        const det = r?.odgovori ? Object.entries(r.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setErr(`Greška: ${r?.error || 'Nepoznata greška'}${det ? ` (${det})` : ''}`);
        return;
      }
      onOpenChange(false);
      onIzdat(r.brojFiskalnogRacuna ?? null);
    } catch (e: any) { setErr(`Greška: ${e?.message || 'Nepoznata greška'}`); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); izdaj(); return; }
          const i = Number(e.key);
          if (i >= 1 && i <= PAYMENTS.length) { e.preventDefault(); setPaymentType(PAYMENTS[i - 1].type); }
        }}>
        <div className="px-6 pt-6 pb-4">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center"><Receipt className="h-5 w-5 text-violet-500" /></div>
              <div>
                <DialogTitle className="text-lg">Izdaj račun za {formatBrojNaloga(nalog)}</DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  {izPonude ? `Račun po stavkama ponude ${nalog.ponudaBroj}/${nalog.ponudaGodina}` : `Jedna stavka: „${PRODAJNA_USLUGA.naziv}“ po dogovorenoj cijeni`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        <Separator />
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-amber-600/80">Fiskalni račun se štampa na Tring printeru. Provjerite da je printer uključen.</p>
          </div>
          <div className="space-y-1.5">
            <Eyebrow className="block">Način plaćanja</Eyebrow>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENTS.map((p, i) => (
                <button key={p.type} onClick={() => setPaymentType(p.type)} aria-pressed={paymentType === p.type}
                  className={cn('h-10 flex items-center gap-2 rounded-lg border px-3 text-[12px] font-medium',
                    paymentType === p.type ? 'bg-[#0f1629] text-white border-[#0f1629]' : 'text-slate-600 border-slate-200 hover:bg-slate-50')}>
                  {p.icon}{p.type}<Key tone={paymentType === p.type ? 'dark' : 'light'}>{i + 1}</Key>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <span className="text-[12px] text-slate-500">Za naplatu</span>
            <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{formatKM(nalog.dogovorenaCijena ?? 0)}</span>
          </div>
          {!(nalog.dogovorenaCijena! > 0) && (
            <p className="text-[11px] text-amber-600">Upišite dogovorenu cijenu (Uredi zaglavlje)</p>
          )}
          {err && <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600"><AlertTriangle size={13} /> {err}</div>}
        </div>
        <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400"><Key className="ml-0">⌘↵</Key> izdaj</span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Otkaži</Button>
            <Button onClick={izdaj} disabled={busy || !(nalog.dogovorenaCijena! > 0)} className="min-w-[160px]">{busy ? 'Štampam…' : 'Izdaj fiskalni račun'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
