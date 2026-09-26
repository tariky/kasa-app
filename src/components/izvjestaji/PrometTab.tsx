import { TrendingUp } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LedgerHead } from '@/components/ui/ledger';
import { Stat } from '@/components/ui/stat';
import { PrometPdf } from '@/components/PrometPdf';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import { otvoriPdf } from '@/lib/stampa';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { sumePrometa } from '@/lib/izvjestaji';
import type { FirmaSettings, Order } from '@/types';
import { IzvjestajKartica, PdfDugme, Prazno, PraznoStanje, fmtDisplay, td } from './dijelovi';

/** Status reda: tačka + tekst, bez obojene pilule. */
function StatusTacka({ tone, children }: { tone: 'emerald' | 'amber' | 'rose'; children: React.ReactNode }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-[12px] font-medium leading-5',
      tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-600')}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full',
        tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-emerald-500')} />
      {children}
    </span>
  );
}

/** Tab Promet: sume računa za period i lista računa (izvršeni i stornirani). */
export default function PrometTab({ orders, dateFrom, dateTo, firma, onGreska }: {
  orders: Order[];
  dateFrom: Date;
  dateTo: Date;
  firma: FirmaSettings | null;
  onGreska: (poruka: string) => void;
}) {
  const sume = sumePrometa(orders);

  const exportPrometPdf = async () => {
    if (!firma || orders.length === 0) return;
    try {
      await otvoriPdf(
        <PrometPdf orders={orders} dateFrom={fmtDisplay(dateFrom)} dateTo={fmtDisplay(dateTo)} firma={firma} />,
        `Promet ${fmtDisplay(dateFrom)} - ${fmtDisplay(dateTo)}`,
      );
    } catch {
      onGreska('Greška pri generisanju PDF-a za promet');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-6 pt-5 pb-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Prodaja" value={formatKM(sume.ukupno)} note={`${sume.brojRacuna} računa`} strong />
          <Stat label="Osnovica" value={formatKM(sume.bezPdv)} note="bez PDV-a" />
          <Stat label={`PDV (${PDV_STOPA_E_PCT}%)`} value={formatKM(sume.pdv)} />
          <Stat label="Reklamacije" value={formatKM(sume.reklamacije)} note={`${sume.brojReklamacija} storniranih`}
            tone={sume.reklamacije > 0 ? 'negative' : 'default'} />
        </div>
      </div>

      <IzvjestajKartica
        naslov="Računi"
        broj={orders.length}
        akcije={<PdfDugme onClick={exportPrometPdf} disabled={orders.length === 0} />}
      >
        {orders.length === 0 ? (
          <PraznoStanje ikona={TrendingUp} />
        ) : (
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead columns={[
                { label: '#', className: 'text-left pl-5 pr-2 w-[1%] whitespace-nowrap' },
                { label: 'Datum', className: 'text-left px-2' },
                { label: 'Kasir', className: 'text-left px-2 hidden lg:table-cell' },
                { label: 'Fiskalni br.', className: 'text-left px-2 w-[1%] whitespace-nowrap' },
                { label: 'Osnovica', className: 'text-right px-2 w-[120px] hidden xl:table-cell' },
                { label: 'PDV', className: 'text-right px-2 w-[110px] hidden lg:table-cell' },
                { label: 'Ukupno', className: 'text-right px-2 w-[130px]' },
                { label: 'Status', className: 'text-left pl-2 pr-5 w-[100px]' },
              ]} />
              <tbody>
                {orders.map((order) => {
                  const isRefunded = order.status === 'refunded';
                  return (
                    <tr key={order.id} className="transition-colors hover:bg-slate-50">
                      <td className={cn(td, 'pl-5 pr-2 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{order.id}</td>
                      <td className={cn(td, 'px-2 max-w-0')}>
                        <span className="block truncate text-[12.5px] font-medium tabular-nums text-slate-800">{formatDateTime(order.createdAt)}</span>
                        {order.korisnikIme && <span className="lg:hidden block text-[11px] text-slate-400 truncate">{order.korisnikIme}</span>}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell px-2 text-[12px] text-slate-600 max-w-0 truncate')}>
                        {order.korisnikIme || <Prazno />}
                      </td>
                      <td className={cn(td, 'px-2 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>
                        {order.brojFiskalnogRacuna || <Prazno />}
                      </td>
                      <td className={cn(td, 'hidden xl:table-cell px-2 text-right font-mono text-[12px] tabular-nums text-slate-500 whitespace-nowrap')}>
                        {formatKM(order.ukupno - order.pdvIznos)}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell px-2 text-right font-mono text-[12px] tabular-nums text-slate-400 whitespace-nowrap')}>
                        {formatKM(order.pdvIznos)}
                      </td>
                      <td className={cn(td, 'px-2 text-right font-mono text-[12.5px] font-semibold tabular-nums whitespace-nowrap',
                        isRefunded ? 'text-rose-600' : 'text-slate-800')}>
                        {formatKM(order.ukupno)}
                      </td>
                      <td className={cn(td, 'pl-2 pr-5 whitespace-nowrap')}>
                        <StatusTacka tone={isRefunded ? 'rose' : 'emerald'}>{isRefunded ? 'Storno' : 'OK'}</StatusTacka>
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
