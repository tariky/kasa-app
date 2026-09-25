import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Key, mod } from '@/components/ui/ledger';
import { formatKM } from '@/lib/utils';

/**
 * Potvrda prije Z izvještaja — nuliranje uređaja se ne može poništiti.
 * Pokazuje očekivanu gotovinu da kasir prebroji ladicu dok još može uporediti s X.
 */
export default function ZIzvjestajDialog({ open, ocekivano, onClose, onConfirm, onPresjek }: {
  open: boolean;
  /** Očekivano u ladici; null dok se stanje ladice ne učita. */
  ocekivano: number | null;
  onClose: () => void;
  onConfirm: () => void;
  /** Štampa X umjesto Z — za kasira koji još nije uporedio stanje. */
  onPresjek: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="sm:max-w-[440px]"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onConfirm(); } }}
      >
        <DialogHeader>
          <DialogTitle>Zatvoriti dan?</DialogTitle>
          <DialogDescription>
            Z izvještaj nulira dnevni promet na fiskalnom uređaju. Ovo se ne može poništiti.
          </DialogDescription>
        </DialogHeader>

        {ocekivano !== null && (
          <div className="rounded-xl border border-slate-200/70 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-slate-500">Očekivano u ladici</span>
              <span className="font-mono text-[16px] font-bold tabular-nums text-slate-900">{formatKM(ocekivano)}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">
              Prebroj gotovinu prije zatvaranja. Ako se iznos ne slaže,
              odštampaj presjek stanja i provjeri razliku.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button variant="ghost" className="text-slate-500" onClick={onPresjek}>Štampaj presjek (X)</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Otkaži</Button>
            <Button variant="destructive" onClick={onConfirm}>
              Zatvori dan <Key tone="danger">{mod('↵')}</Key>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
