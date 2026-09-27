import { Package } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LedgerHead } from '@/components/ui/ledger';
import { Stat } from '@/components/ui/stat';
import { PrimkePdf } from '@/components/PrimkePdf';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { otvoriPdf } from '@/lib/stampa';
import { formatRucPct, sumePrimke } from '@/lib/izvjestaji';
import type { FirmaSettings, Primka } from '@/types';
import { IzvjestajKartica, PdfDugme, Prazno, PraznoStanje, fmtDisplay, td } from './dijelovi';

/** Prikazana stopa je veća od nule (ne „0,0“ ni negativna) — tada dobija „+“ i zelenu boju. */
function rucRaste(rucPct: number): boolean {
  return Number(rucPct.toFixed(1)) > 0;
}

/** Stopa RUC-a za prikaz: „+12,5%“, „0,0%“, „-3,2%“ — isti broj kao u UlazDialogu. */
function rucTekst(rucPct: number): string {
  return `${rucRaste(rucPct) ? '+' : ''}${formatRucPct(rucPct)}%`;
}

/**
 * Tab Ulaz robe: primke za period s nabavnom, prodajnom (sa PDV-om) i RUC-om
 * kao na kalkulaciji — bez PDV-a, samo nad stavkama koje se prodaju.
 */
export default function PrimkeTab({ primke, dateFrom, dateTo, firma, onGreska }: {
  primke: Primka[];
  dateFrom: Date;
  dateTo: Date;
  firma: FirmaSettings | null;
  onGreska: (poruka: string) => void;
}) {
  const sume = sumePrimke(primke);

  const exportPrimkePdf = async () => {
    if (!firma || primke.length === 0) return;
    try {
      await otvoriPdf(
        <PrimkePdf primke={primke} dateFrom={fmtDisplay(dateFrom)} dateTo={fmtDisplay(dateTo)} firma={firma} />,
        `Primke ${fmtDisplay(dateFrom)} - ${fmtDisplay(dateTo)}`,
      );
    } catch {
      onGreska('Greška pri generisanju PDF-a za primke');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-6 pt-5 pb-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Broj primki" value={String(primke.length)} />
          <Stat label="Nabavna vrijednost" value={formatKM(sume.nabavna)} />
          <Stat label="Prodajna vrijednost" value={formatKM(sume.prodajnaSaPdv)} strong
            note={sume.nabavnaArtikala > 0 ? `${rucTekst(sume.rucPct)} RUC` : undefined} />
        </div>
      </div>

      <IzvjestajKartica
        naslov="Primke"
        broj={primke.length}
        akcije={<PdfDugme onClick={exportPrimkePdf} disabled={primke.length === 0} />}
      >
        {primke.length === 0 ? (
          <PraznoStanje ikona={Package} />
        ) : (
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead columns={[
                { label: 'Broj primke', className: 'text-left pl-5 pr-2 w-[1%] whitespace-nowrap' },
                { label: 'Datum', className: 'text-left px-2 w-[1%] whitespace-nowrap' },
                { label: 'Dobavljač', className: 'text-left px-2' },
                { label: 'Faktura', className: 'text-left px-2 w-[140px] hidden lg:table-cell' },
                { label: 'Stavki', className: 'text-right px-2 w-[70px] hidden xl:table-cell' },
                { label: 'Nabavna', className: 'text-right px-2 w-[120px]' },
                { label: 'Prodajna', className: 'text-right px-2 w-[120px]' },
                { label: 'RUC', className: 'text-right pl-2 pr-5 w-[80px]' },
              ]} />
              <tbody>
                {primke.map((primka) => {
                  const red = sumePrimke([primka]);
                  return (
                    <tr key={primka.id} className="transition-colors hover:bg-slate-50">
                      <td className={cn(td, 'pl-5 pr-2 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{primka.brojPrimke}</td>
                      <td className={cn(td, 'px-2 text-[12px] tabular-nums text-slate-600 whitespace-nowrap')}>
                        {formatDate(primka.datum || primka.createdAt)}
                      </td>
                      <td className={cn(td, 'px-2 max-w-0')}>
                        <span className="block truncate text-[12.5px] font-medium text-slate-800">
                          {primka.dobavljacNaziv || <Prazno />}
                        </span>
                        {primka.brojFakture && <span className="lg:hidden block font-mono text-[10.5px] text-slate-400 truncate">{primka.brojFakture}</span>}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell px-2 font-mono text-[12px] text-slate-400 max-w-0 truncate')}>
                        {primka.brojFakture || <Prazno />}
                      </td>
                      <td className={cn(td, 'hidden xl:table-cell px-2 text-right font-mono text-[12px] tabular-nums text-slate-400')}>
                        {primka.stavke?.length ?? 0}
                      </td>
                      <td className={cn(td, 'px-2 text-right font-mono text-[12px] tabular-nums text-slate-500 whitespace-nowrap')}>
                        {formatKM(red.nabavna)}
                      </td>
                      <td className={cn(td, 'px-2 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                        {formatKM(red.prodajnaSaPdv)}
                      </td>
                      <td className={cn(td, 'pl-2 pr-5 text-right font-mono text-[12px] font-medium tabular-nums whitespace-nowrap',
                        rucRaste(red.rucPct) ? 'text-emerald-600' : 'text-slate-400')}>
                        {rucTekst(red.rucPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </IzvjestajKartica>
    </div>
  );
}
