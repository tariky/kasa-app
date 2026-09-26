import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Zajednički dijelovi tabova Izvještaja (Promet, Ulaz robe, Nivelacije) —
 * ista kartica, prazno stanje i ćelija tabele kao na tabu Zaliha.
 */

/** Ćelija izvještajne tabele — ista mjera kao lista artikala. */
export const td = 'py-2.5 border-b border-slate-100';

/** Datum za prikaz perioda: DD.MM.YYYY. */
export function fmtDisplay(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Otvori generisani PDF u novom prozoru. */
export function openPdfInWindow(blob: Blob, title: string) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.document.title = title;
    win.onload = () => URL.revokeObjectURL(url);
  }
}

/** Prazna vrijednost u ćeliji. */
export function Prazno() {
  return <span className="text-slate-200">—</span>;
}

export function PdfDugme({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} className="h-8 gap-1.5 text-[12px]">
      <Download className="h-3.5 w-3.5" /> PDF
    </Button>
  );
}

export function PraznoStanje({ ikona: Ikona }: { ikona: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Ikona size={20} className="text-slate-300" /></div>
      <p className="text-[13px] font-medium text-slate-500">Nema podataka za period</p>
      <p className="text-[12px] text-slate-400 mt-0.5">Odaberi period i klikni Generiši.</p>
    </div>
  );
}

/** Bijela kartica izvještajne tabele — ista kao na tabu Zaliha. */
export function IzvjestajKartica({ naslov, broj, akcije, children }: {
  naslov: string;
  broj: number;
  akcije?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 px-6 pb-5">
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-700">{naslov}</span>
          {broj > 0 && <span className="font-mono text-[12px] text-slate-400 tabular-nums">{broj}</span>}
          {akcije && <div className="ml-auto flex items-center gap-2">{akcije}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
