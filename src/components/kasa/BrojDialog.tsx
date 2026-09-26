import { Button } from '@/components/ui/button';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn, formatKolicina, parseDecimal } from '@/lib/utils';

/**
 * Mali dijalog kase za jedan broj (količina, rabat): veliko polje s fokusom,
 * ↵ potvrđuje. `korak` dodaje dugmad − i + oko polja, `sufiks` oznaku iza broja.
 * Esc, klik van dijaloga i X idu na `onZatvori`, dugme „Otkaži“ na `onOtkazi`.
 */
export default function BrojDialog({
  open, naslov, opis, vrijednost, onVrijednost, onPotvrdi, onZatvori, onOtkazi, potvrda,
  maxDecimals, inputRef, placeholder, sufiks, korak, children,
}: {
  open: boolean;
  naslov: string;
  opis: React.ReactNode;
  vrijednost: string;
  onVrijednost: (tekst: string) => void;
  onPotvrdi: () => void;
  onZatvori: () => void;
  onOtkazi: () => void;
  potvrda: string;
  maxDecimals: number;
  inputRef?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  sufiks?: string;
  /** − ne ide ispod `min`, + ne ide preko `max`. */
  korak?: { min: number; max: number };
  /** Napomene ispod polja. */
  children?: React.ReactNode;
}) {
  const polje = (
    <DecimalInput
      ref={inputRef}
      maxDecimals={maxDecimals}
      value={vrijednost}
      onValueChange={text => onVrijednost(text)}
      onKeyDown={e => { if (e.key === 'Enter') onPotvrdi(); }}
      placeholder={placeholder}
      className={cn('h-12 text-center font-mono text-2xl font-bold rounded-xl border-slate-200', korak && 'flex-1', sufiks && 'pr-10')}
      autoFocus
    />
  );
  const korakDugme = 'w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xl font-bold transition-colors';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onZatvori(); }}>
      <DialogContent className="sm:max-w-[340px] p-0 gap-0 overflow-hidden rounded-2xl">
        <div className="px-6 pt-6 pb-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">{naslov}</DialogTitle>
            <DialogDescription className="text-sm text-slate-500 truncate mt-0.5">
              {opis}
            </DialogDescription>
          </DialogHeader>
          {korak ? (
            <div className="mt-5 flex items-center gap-3">
              <button
                className={korakDugme}
                onClick={() => onVrijednost(formatKolicina(Math.max(korak.min, (parseDecimal(vrijednost) || 1) - 1)))}
              >
                −
              </button>
              {polje}
              <button
                className={korakDugme}
                onClick={() => onVrijednost(formatKolicina(Math.min(korak.max, (parseDecimal(vrijednost) || 0) + 1)))}
              >
                +
              </button>
            </div>
          ) : (
            <div className="mt-5 relative">
              {polje}
              {sufiks && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-lg">{sufiks}</span>}
            </div>
          )}
          {children}
        </div>
        <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="rounded-lg" onClick={onOtkazi}>
            Otkaži
          </Button>
          <Button size="sm" className="rounded-lg px-5" onClick={onPotvrdi}>
            {potvrda}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
