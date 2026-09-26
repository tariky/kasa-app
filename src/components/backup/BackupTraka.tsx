import { Cloud, CloudOff, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PrikazTrake } from '@/lib/backupTraka';

const BOJA_LINIJE = { rad: 'bg-sky-500', uspjeh: 'bg-emerald-500', greska: 'bg-amber-400' } as const;
const BOJA_PILULE = {
  rad: 'bg-white/95 text-slate-600 border-slate-200',
  uspjeh: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  greska: 'bg-amber-50 text-amber-800 border-amber-200',
} as const;

/**
 * Napredak automatskog backup-a: 2 px linija na vrhu prozora i pilula gore
 * desno. `fixed` — ne pomjera sadržaj, kasa se ne trese usred prodaje; klikovi
 * prolaze kroz nju. Trajnu grešku (`uPostavke`) prikazuje sidebar, ne traka.
 */
export default function BackupTraka({ prikaz }: { prikaz: PrikazTrake | null }) {
  if (!prikaz || prikaz.uPostavke) return null;
  const Ikona = prikaz.ton === 'uspjeh' ? Check : prikaz.ton === 'greska' ? CloudOff : Cloud;

  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-50">
      {prikaz.sirina > 0 && (
        <div className="h-0.5 w-full">
          <div className={cn('h-full transition-[width] duration-300', BOJA_LINIJE[prikaz.ton])} style={{ width: `${prikaz.sirina}%` }} />
        </div>
      )}
      <div
        role="status"
        className={cn(
          'absolute right-3 top-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm',
          BOJA_PILULE[prikaz.ton],
        )}
      >
        <Ikona size={12} className="shrink-0" />
        {prikaz.tekst}
      </div>
    </div>
  );
}
