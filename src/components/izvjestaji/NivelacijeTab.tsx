import { useState, Fragment } from 'react';
import { ChevronRight, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LedgerHead } from '@/components/ui/ledger';
import { Stat } from '@/components/ui/stat';
import { NivelacijaPdf } from '@/components/NivelacijaPdf';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { otvoriPdf } from '@/lib/stampa';
import { razlikePoZnaku } from '@/lib/izvjestaji';
import type { FirmaSettings, Nivelacija, NivelacijaStavka } from '@/types';
import { IzvjestajKartica, PdfDugme, Prazno, PraznoStanje, td } from './dijelovi';

/** Tab Nivelacije: nivelacije za period; klik na red otvara stavke i PDF zapisnika. */
export default function NivelacijeTab({ nivelacije, firma, onGreska }: {
  nivelacije: Nivelacija[];
  firma: FirmaSettings | null;
  onGreska: (poruka: string) => void;
}) {
  const [expandedNivId, setExpandedNivId] = useState<number | null>(null);
  const [expandedNivStavke, setExpandedNivStavke] = useState<NivelacijaStavka[]>([]);

  // Lista nosi ukupnu razliku svakog dokumenta; pozitivne i negativne se sabiraju odvojeno.
  const razlike = razlikePoZnaku(nivelacije.map(n => n.ukupnaRazlika ?? 0));

  const loadNivelacijaDetail = async (id: number) => {
    if (expandedNivId === id) {
      setExpandedNivId(null);
      return;
    }
    try {
      const niv = await window.api.getNivelacija(id);
      setExpandedNivStavke(niv.stavke || []);
      setExpandedNivId(id);
    } catch (err: any) {
      onGreska(err?.message || 'Greška pri učitavanju detalja nivelacije');
    }
  };

  const exportNivelacijaPdf = async (nivId: number) => {
    if (!firma) return;
    try {
      const niv = await window.api.getNivelacija(nivId);
      await otvoriPdf(<NivelacijaPdf nivelacija={niv} firma={firma} />, `Nivelacija ${niv.brojNivelacije}`);
    } catch {
      onGreska('Greška pri generisanju PDF-a za nivelaciju');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-6 pt-5 pb-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Broj nivelacija" value={String(nivelacije.length)} />
          <Stat label="Pozitivna razlika" tone="positive" value={formatKM(razlike.pozitivna)} />
          <Stat label="Negativna razlika" tone="negative" value={formatKM(razlike.negativna)} />
        </div>
      </div>

      <IzvjestajKartica
        naslov="Nivelacije"
        broj={nivelacije.length}
        akcije={nivelacije.length > 0 && expandedNivId
          ? <PdfDugme onClick={() => exportNivelacijaPdf(expandedNivId)} />
          : undefined}
      >
        {nivelacije.length === 0 ? (
          <PraznoStanje ikona={FileText} />
        ) : (
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead columns={[
                { label: 'Broj', className: 'text-left pl-5 pr-2 w-[1%] whitespace-nowrap' },
                { label: 'Datum', className: 'text-left px-2 w-[1%] whitespace-nowrap' },
                { label: 'Primka / napomena', className: 'text-left px-2' },
                { label: 'Stavki', className: 'text-right px-2 w-[70px] hidden lg:table-cell' },
                { label: 'Ukupna razlika', className: 'text-right px-2 w-[150px]' },
                { label: '', className: 'pl-1 pr-5 w-[1%]' },
              ]} />
              <tbody>
                {nivelacije.map((niv) => {
                  const otvorena = expandedNivId === niv.id;
                  const razlika = niv.ukupnaRazlika ?? 0;
                  return (
                    <Fragment key={niv.id}>
                      <tr
                        className={cn('group transition-colors hover:bg-slate-50 cursor-pointer', otvorena && 'bg-slate-50')}
                        onClick={() => loadNivelacijaDetail(niv.id)}
                        aria-expanded={otvorena}
                      >
                        <td className={cn(td, 'pl-5 pr-2 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{niv.brojNivelacije}</td>
                        <td className={cn(td, 'px-2 text-[12px] tabular-nums text-slate-600 whitespace-nowrap')}>{formatDate(niv.datum)}</td>
                        <td className={cn(td, 'px-2 max-w-0')}>
                          {niv.primkaBroj
                            ? <span className="block truncate font-mono text-[12px] font-medium text-slate-800">{niv.primkaBroj}</span>
                            : !niv.napomena && <Prazno />}
                          {niv.napomena && (
                            <span className={cn('block truncate', niv.primkaBroj ? 'text-[11px] text-slate-400' : 'text-[12.5px] font-medium text-slate-800')}>
                              {niv.napomena}
                            </span>
                          )}
                        </td>
                        <td className={cn(td, 'hidden lg:table-cell px-2 text-right font-mono text-[12px] tabular-nums text-slate-400')}>
                          {niv.stavkiCount ?? 0}
                        </td>
                        <td className={cn(td, 'px-2 text-right font-mono text-[12.5px] font-semibold tabular-nums whitespace-nowrap',
                          razlika >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {razlika >= 0 ? '+' : ''}{formatKM(razlika)}
                        </td>
                        <td className={cn(td, 'pl-1 pr-5 text-right')}>
                          <ChevronRight aria-hidden
                            className={cn('inline h-3.5 w-3.5 text-slate-400 transition-transform group-hover:text-slate-600', otvorena && 'rotate-90')} />
                        </td>
                      </tr>
                      {otvorena && (
                        <tr>
                          <td colSpan={6} className="pl-5 pr-5 pt-1 pb-3 bg-slate-50 border-b border-slate-200/80">
                            <table className="w-full border-separate border-spacing-0">
                              <thead>
                                <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  <th className="text-left py-2 pr-2 border-b border-slate-200/80">Artikal</th>
                                  <th className="text-right py-2 px-2 w-[90px] border-b border-slate-200/80">Količina</th>
                                  <th className="text-right py-2 px-2 w-[110px] border-b border-slate-200/80 hidden lg:table-cell">Stara cijena</th>
                                  <th className="text-right py-2 px-2 w-[110px] border-b border-slate-200/80">Nova cijena</th>
                                  <th className="text-right py-2 px-2 w-[110px] border-b border-slate-200/80 hidden xl:table-cell">Razlika/jed</th>
                                  <th className="text-right py-2 pl-2 w-[130px] border-b border-slate-200/80">Ukupna razlika</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedNivStavke.map((s) => (
                                  <tr key={s.id}>
                                    <td className="py-1.5 pr-2 border-b border-slate-200/50 text-[12px] font-medium text-slate-700 max-w-0 truncate">{s.productNaziv}</td>
                                    <td className="py-1.5 px-2 border-b border-slate-200/50 text-right font-mono text-[12px] tabular-nums text-slate-500">{s.kolicina}</td>
                                    <td className="py-1.5 px-2 border-b border-slate-200/50 text-right font-mono text-[12px] tabular-nums text-slate-400 whitespace-nowrap hidden lg:table-cell">{formatKM(s.staraCijena)}</td>
                                    <td className="py-1.5 px-2 border-b border-slate-200/50 text-right font-mono text-[12px] tabular-nums text-slate-700 whitespace-nowrap">{formatKM(s.novaCijena)}</td>
                                    <td className={cn('py-1.5 px-2 border-b border-slate-200/50 text-right font-mono text-[12px] tabular-nums whitespace-nowrap hidden xl:table-cell',
                                      s.razlika >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                      {s.razlika >= 0 ? '+' : ''}{formatKM(s.razlika)}
                                    </td>
                                    <td className={cn('py-1.5 pl-2 border-b border-slate-200/50 text-right font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap',
                                      s.ukupnaRazlika >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                      {s.ukupnaRazlika >= 0 ? '+' : ''}{formatKM(s.ukupnaRazlika)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="flex justify-end mt-2.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 text-[12px] bg-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportNivelacijaPdf(niv.id);
                                }}
                              >
                                <Download className="h-3.5 w-3.5" />
                                Exportuj PDF
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
