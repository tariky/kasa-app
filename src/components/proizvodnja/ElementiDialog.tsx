// src/components/proizvodnja/ElementiDialog.tsx
import { useEffect, useState } from 'react';
import { elementiUM2, elementiUNapomenu, type Element as PlocaElement } from '@/lib/ploca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, X } from 'lucide-react';

type Red = { sirina: string; visina: string; kom: string };
const prazan = (): Red => ({ sirina: '', visina: '', kom: '1' });

/** Kalkulator elemenata: stolar kroji po elementima (600×720 ×2), a nalog vodi m². */
export function ElementiDialog({ open, onOpenChange, initial, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; initial: PlocaElement[];
  onConfirm: (m2: number, napomena: string) => void;
}) {
  const [redovi, setRedovi] = useState<Red[]>([prazan()]);

  useEffect(() => {
    if (!open) return;
    setRedovi(initial.length > 0
      ? initial.map(e => ({ sirina: String(e.sirina), visina: String(e.visina), kom: String(e.kom) }))
      : [prazan(), prazan(), prazan()]);
  }, [open, initial]);

  const elementi: PlocaElement[] = redovi.map(r => ({ sirina: Number(r.sirina) || 0, visina: Number(r.visina) || 0, kom: Number(r.kom) || 0 }));
  const m2 = elementiUM2(elementi);
  const set = (i: number, patch: Partial<Red>) => setRedovi(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const samoCifre = (s: string) => s.replace(/\D/g, '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Elementi</DialogTitle>
          <DialogDescription>Širina × visina u mm i broj komada. Zbir ide u količinu, lista u napomenu.</DialogDescription>
        </DialogHeader>
        {/* Redovi skrolaju iznad zbira; zaglavlje kolona je u istom skrolu (sticky) da prati širinu redova
            i kad se pojavi traka za skrol, a -mx-1 px-1 drži prsten fokusa unutar skrola. */}
        <div className="flex min-h-0 flex-col py-1">
          <DialogBody className="-mx-1 space-y-1.5 px-1 pb-1">
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_16px_1fr_16px_64px_28px] items-center gap-1 bg-background text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
              <span>Širina</span><span /><span>Visina</span><span /><span>Kom</span><span />
            </div>
            {redovi.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_16px_1fr_16px_64px_28px] items-center gap-1">
                <Input value={r.sirina} onChange={e => set(i, { sirina: samoCifre(e.target.value) })} placeholder="600" className="h-8 font-mono text-sm" autoFocus={i === 0} />
                <span className="text-slate-400 text-center">×</span>
                <Input value={r.visina} onChange={e => set(i, { visina: samoCifre(e.target.value) })} placeholder="720" className="h-8 font-mono text-sm" />
                <span className="text-slate-400 text-center">×</span>
                <Input value={r.kom} onChange={e => set(i, { kom: samoCifre(e.target.value) })} placeholder="1" className="h-8 font-mono text-sm" />
                <button onClick={() => setRedovi(rs => rs.filter((_, j) => j !== i))} disabled={redovi.length === 1}
                  className="h-8 w-7 flex items-center justify-center text-slate-400 hover:text-rose-500 disabled:opacity-30"><X size={14} /></button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs mt-1" onClick={() => setRedovi(rs => [...rs, prazan()])}><Plus className="h-3.5 w-3.5 mr-1" /> Red</Button>
          </DialogBody>
          <div className="mt-0.5 shrink-0 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex items-center justify-between">
            <span className="text-[12px] text-slate-500">Ukupno</span>
            <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{m2.toFixed(4)} m²</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button disabled={m2 <= 0} onClick={() => { onConfirm(m2, elementiUNapomenu(elementi)); onOpenChange(false); }}>Preuzmi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
