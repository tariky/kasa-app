import { useState, useEffect, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LedgerHead } from '@/components/ui/ledger';
import { Stat } from '@/components/ui/stat';
import {
  Printer, FileText, AlertTriangle, TrendingUp, Package,
  Calendar, Loader2, ChevronRight, Moon, Clock, BarChart3, Download, Banknote, Boxes, BookOpenCheck,
} from 'lucide-react';
import { VrijednostZalihe } from '@/components/skladiste/VrijednostZalihe';
import CashMovementDialog from '@/components/CashMovementDialog';
import KnjigovodjaTab from '@/components/izvjestaji/KnjigovodjaTab';
import ZIzvjestajDialog from '@/components/izvjestaji/ZIzvjestajDialog';
import { cn, formatKM, formatDateTime, formatDate } from '@/lib/utils';
import { nabavnaVrijednost } from '@/lib/kalkulacija';
import { Order, Primka } from '@/types';
import { pdf } from '@react-pdf/renderer';
import { NivelacijaPdf } from '@/components/NivelacijaPdf';
import { PrometPdf } from '@/components/PrometPdf';
import { PrimkePdf } from '@/components/PrimkePdf';

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDisplay(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

type Tab = 'promet' | 'primke' | 'nivelacije' | 'zaliha' | 'fiskalni' | 'knjigovodja';
type FiskalniIzvjestaj = 'x' | 'z' | 'periodicni';

/** Ćelija izvještajne tabele — ista mjera kao lista artikala. */
const td = 'py-2.5 border-b border-slate-100';

/** Prazna vrijednost u ćeliji. */
function Prazno() {
  return <span className="text-slate-200">—</span>;
}

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

function PdfDugme({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled} className="h-8 gap-1.5 text-[12px]">
      <Download className="h-3.5 w-3.5" /> PDF
    </Button>
  );
}

function PraznoStanje({ ikona: Ikona }: { ikona: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Ikona size={20} className="text-slate-300" /></div>
      <p className="text-[13px] font-medium text-slate-500">Nema podataka za period</p>
      <p className="text-[12px] text-slate-400 mt-0.5">Odaberi period i klikni Generiši.</p>
    </div>
  );
}

/** Bijela kartica izvještajne tabele — ista kao na tabu Zaliha. */
function IzvjestajKartica({ naslov, broj, akcije, children }: {
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

/** Red fiskalnog izvještaja: šta radi lijevo, dugme desno, ishod zadnje štampe ispod opisa. */
function FiskalniRed({ ikona: Ikona, naslov, oznaka, opis, akcija, opasno, zauzet, zakljucano, ishod, onClick }: {
  ikona: typeof Clock;
  naslov: string;
  oznaka: string;
  opis: string;
  akcija: string;
  opasno?: boolean;
  zauzet: boolean;
  zakljucano: boolean;
  ishod?: { ok: boolean; tekst: string };
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
      <Ikona size={18} strokeWidth={1.75} className={cn('flex-shrink-0', opasno ? 'text-rose-500' : 'text-slate-400')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-slate-800">{naslov}</span>
          <span className="font-mono text-[11px] tabular-nums text-slate-400">{oznaka}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500">{opis}</p>
        {ishod && (
          <p role="status" className={cn('mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium', ishod.ok ? 'text-emerald-600' : 'text-rose-600')}>
            <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', ishod.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
            {ishod.tekst}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={zakljucano}
        className={cn('h-8 min-w-[124px] gap-1.5 text-[12px]', opasno && 'border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300')}
      >
        {zauzet ? <><Loader2 size={13} className="animate-spin" />Štampam…</> : akcija}
      </Button>
    </div>
  );
}

export default function IzvjestajiScreen({ uloga }: { uloga: string }) {
  const [dateFrom, setDateFrom] = useState(new Date());
  const [dateTo, setDateTo] = useState(new Date());
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('promet');

  const [prometData, setPrometData] = useState<Order[]>([]);
  const [prometLoading, setPrometLoading] = useState(false);

  const [primkeData, setPrimkeData] = useState<Primka[]>([]);
  const [primkeLoading, setPrimkeLoading] = useState(false);

  const [nivelacijeData, setNivelacijeData] = useState<any[]>([]);
  const [nivelacijeLoading, setNivelacijeLoading] = useState(false);
  const [expandedNivId, setExpandedNivId] = useState<number | null>(null);
  const [expandedNivStavke, setExpandedNivStavke] = useState<any[]>([]);

  const [firma, setFirma] = useState<any>(null);
  const [reportError, setReportError] = useState('');

  const [stampa, setStampa] = useState<FiskalniIzvjestaj | null>(null);
  const [ishod, setIshod] = useState<Partial<Record<FiskalniIzvjestaj, { ok: boolean; tekst: string }>>>({});
  const [zPotvrda, setZPotvrda] = useState(false);

  const [ladica, setLadica] = useState<Awaited<ReturnType<typeof window.api.getDrawerState>> | null>(null);
  const [kretanja, setKretanja] = useState<Awaited<ReturnType<typeof window.api.getTodayCashMovements>>>([]);
  const [cashDialogTip, setCashDialogTip] = useState<'polog' | 'povrat' | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const loadLadica = async () => {
    try {
      setLadica(await window.api.getDrawerState());
      setKretanja(await window.api.getTodayCashMovements());
    } catch { /* prikaz ladice je informativan — greška ne ruši tab */ }
  };

  const retryCash = async (id: number) => {
    setRetryingId(id);
    try {
      await window.api.retryCashMovement(id);
    } finally {
      setRetryingId(null);
      loadLadica();
    }
  };

  useEffect(() => {
    window.api.getFirmaSettings().then(setFirma);
  }, []);

  // Auto-load data when tab or date range changes
  useEffect(() => {
    if (activeTab === 'promet') loadPromet();
    else if (activeTab === 'primke') loadPrimke();
    else if (activeTab === 'nivelacije') loadNivelacije();
    else if (activeTab === 'fiskalni') loadLadica();
  }, [activeTab, dateFrom, dateTo]);

  const loadPromet = async () => {
    setPrometLoading(true);
    try {
      const data = await window.api.getReportData('dnevni', toDateStr(dateFrom), toDateStr(dateTo));
      setPrometData(data);
      setReportError('');
    } catch (err: any) {
      setReportError(err?.message || 'Greška pri učitavanju prometa');
    } finally {
      setPrometLoading(false);
    }
  };

  const loadPrimke = async () => {
    setPrimkeLoading(true);
    try {
      const data = await window.api.getReportData('primke', toDateStr(dateFrom), toDateStr(dateTo));
      setPrimkeData(data);
      setReportError('');
    } catch (err: any) {
      setReportError(err?.message || 'Greška pri učitavanju primki');
    } finally {
      setPrimkeLoading(false);
    }
  };

  const loadNivelacije = async () => {
    setNivelacijeLoading(true);
    try {
      const data = await window.api.getNivelacije(toDateStr(dateFrom), toDateStr(dateTo));
      setNivelacijeData(data);
      setReportError('');
    } catch (err: any) {
      setReportError(err?.message || 'Greška pri učitavanju nivelacija');
    } finally {
      setNivelacijeLoading(false);
    }
  };

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
      setReportError(err?.message || 'Greška pri učitavanju detalja nivelacije');
    }
  };

  const exportNivelacijaPdf = async (nivId: number) => {
    if (!firma) return;
    try {
      const niv = await window.api.getNivelacija(nivId);
      const blob = await pdf(<NivelacijaPdf nivelacija={niv} firma={firma} />).toBlob();
      openPdfInWindow(blob, `Nivelacija ${niv.brojNivelacije}`);
    } catch {
      setReportError('Greška pri generisanju PDF-a za nivelaciju');
    }
  };

  const openPdfInWindow = (blob: Blob, title: string) => {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.document.title = title;
      win.onload = () => URL.revokeObjectURL(url);
    }
  };

  const exportPrometPdf = async () => {
    if (!firma || prometData.length === 0) return;
    try {
      const blob = await pdf(
        <PrometPdf orders={prometData} dateFrom={fmtDisplay(dateFrom)} dateTo={fmtDisplay(dateTo)} firma={firma} />
      ).toBlob();
      openPdfInWindow(blob, `Promet ${fmtDisplay(dateFrom)} - ${fmtDisplay(dateTo)}`);
    } catch {
      setReportError('Greška pri generisanju PDF-a za promet');
    }
  };

  const exportPrimkePdf = async () => {
    if (!firma || primkeData.length === 0) return;
    try {
      const blob = await pdf(
        <PrimkePdf primke={primkeData} dateFrom={fmtDisplay(dateFrom)} dateTo={fmtDisplay(dateTo)} firma={firma} />
      ).toBlob();
      openPdfInWindow(blob, `Primke ${fmtDisplay(dateFrom)} - ${fmtDisplay(dateTo)}`);
    } catch {
      setReportError('Greška pri generisanju PDF-a za primke');
    }
  };

  const completedOrders = prometData.filter((o) => o.status === 'completed');
  const refundedOrders = prometData.filter((o) => o.status === 'refunded');
  const ukupnaProdaja = completedOrders.reduce((sum, o) => sum + o.ukupno, 0);
  const ukupniPDV = completedOrders.reduce((sum, o) => sum + o.pdvIznos, 0);
  const ukupnaOsnovica = ukupnaProdaja - ukupniPDV;
  const ukupneReklamacije = refundedOrders.reduce((sum, o) => sum + o.ukupno, 0);
  const brojRacuna = completedOrders.length;

  const primkeNabavna = primkeData.reduce(
    (sum, p) => sum + (p.stavke || []).reduce((s, st) => s + nabavnaVrijednost(st), 0), 0
  );
  const primkeProdajna = primkeData.reduce(
    (sum, p) => sum + (p.stavke || []).reduce((s, st) => s + st.cijena * st.kolicina, 0), 0
  );

  /** Uređaj štampa jedan po jedan — dok radi, sva tri dugmeta su zaključana. */
  const stampaj = async (vrsta: FiskalniIzvjestaj, poziv: () => Promise<any>) => {
    setStampa(vrsta);
    setIshod(p => ({ ...p, [vrsta]: undefined }));
    try {
      const result = await poziv();
      console.log(`Tring ${vrsta} result:`, result);
      const vrijeme = new Date().toTimeString().slice(0, 5);
      setIshod(p => ({
        ...p,
        [vrsta]: result?.success
          ? { ok: true, tekst: vrsta === 'z' ? `Dan zatvoren u ${vrijeme}` : `Odštampano u ${vrijeme}` }
          : { ok: false, tekst: result?.error || (result ? `Uređaj je odgovorio: ${result.vrstaOdgovora}` : 'Fiskalni uređaj nije odgovorio') },
      }));
    } catch (err: any) {
      setIshod(p => ({ ...p, [vrsta]: { ok: false, tekst: err?.message || 'Veza s fiskalnim uređajem nije uspjela' } }));
    } finally {
      setStampa(null);
      if (vrsta === 'z') loadLadica();
    }
  };

  const handleXReport = () => stampaj('x', () => window.api.tringXReport());
  const handleZReport = () => { setZPotvrda(false); stampaj('z', () => window.api.tringZReport()); };
  const handlePeriodicReport = () =>
    stampaj('periodicni', () => window.api.tringPeriodicReport(toDateStr(dateFrom), toDateStr(dateTo)));

  const tabs: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
    { id: 'promet', label: 'Promet', icon: TrendingUp },
    { id: 'primke', label: 'Ulaz robe', icon: Package },
    { id: 'nivelacije', label: 'Nivelacije', icon: FileText },
    { id: 'zaliha', label: 'Zaliha', icon: Boxes },
    { id: 'fiskalni', label: 'Fiskalni', icon: Printer },
    ...(uloga === 'admin' ? [{ id: 'knjigovodja' as Tab, label: 'Knjigovođa', icon: BookOpenCheck }] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">

      {/* ── Top bar: date range + tabs ── */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium whitespace-nowrap transition-all duration-150',
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Date range — zaliha je stanje na danas, Knjigovođa ima svoj izbor perioda */}
          {activeTab !== 'zaliha' && activeTab !== 'knjigovodja' && <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-[13px] text-slate-500">
              <Calendar size={14} />
              <span>Period:</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Popover open={fromOpen} onOpenChange={setFromOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[140px] h-9 text-[13px] font-mono bg-slate-50 border-slate-200 justify-start"
                  >
                    <Calendar size={13} className="mr-2 text-slate-400" />
                    {fmtDisplay(dateFrom)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateFrom}
                    onSelect={(day) => {
                      if (day) {
                        setDateFrom(day);
                        setFromOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
              <ChevronRight size={14} className="text-slate-300" />
              <Popover open={toOpen} onOpenChange={setToOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-[140px] h-9 text-[13px] font-mono bg-slate-50 border-slate-200 justify-start"
                  >
                    <Calendar size={13} className="mr-2 text-slate-400" />
                    {fmtDisplay(dateTo)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={dateTo}
                    onSelect={(day) => {
                      if (day) {
                        setDateTo(day);
                        setToOpen(false);
                      }
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            {(activeTab === 'promet' || activeTab === 'primke' || activeTab === 'nivelacije') && (
              <Button
                size="sm"
                className="h-9 gap-2"
                onClick={activeTab === 'promet' ? loadPromet : activeTab === 'primke' ? loadPrimke : loadNivelacije}
                disabled={activeTab === 'promet' ? prometLoading : activeTab === 'primke' ? primkeLoading : nivelacijeLoading}
              >
                {(activeTab === 'promet' ? prometLoading : activeTab === 'primke' ? primkeLoading : nivelacijeLoading) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <BarChart3 size={14} />
                )}
                Generiši
              </Button>
            )}
          </div>}
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {reportError && activeTab !== 'knjigovodja' && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-medium bg-red-50/60 border border-red-100 text-red-600">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {reportError}
          </div>
        )}

        {activeTab === 'zaliha' && <VrijednostZalihe />}

        {/* ═══ PROMET TAB ═══ */}
        {activeTab === 'promet' && (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Prodaja" value={formatKM(ukupnaProdaja)} note={`${brojRacuna} računa`} strong />
                <Stat label="Osnovica" value={formatKM(ukupnaOsnovica)} note="bez PDV-a" />
                <Stat label="PDV (17%)" value={formatKM(ukupniPDV)} />
                <Stat label="Reklamacije" value={formatKM(ukupneReklamacije)} note={`${refundedOrders.length} storniranih`}
                  tone={ukupneReklamacije > 0 ? 'negative' : 'default'} />
              </div>
            </div>

            <IzvjestajKartica
              naslov="Računi"
              broj={prometData.length}
              akcije={<PdfDugme onClick={exportPrometPdf} disabled={prometData.length === 0} />}
            >
              {prometData.length === 0 ? (
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
                      {prometData.map((order) => {
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
        )}

        {/* ═══ PRIMKE TAB ═══ */}
        {activeTab === 'primke' && (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Broj primki" value={String(primkeData.length)} />
                <Stat label="Nabavna vrijednost" value={formatKM(primkeNabavna)} />
                <Stat label="Prodajna vrijednost" value={formatKM(primkeProdajna)} strong
                  note={primkeNabavna > 0
                    ? `+${((primkeProdajna - primkeNabavna) / primkeNabavna * 100).toFixed(1).replace('.', ',')}% marža`
                    : undefined} />
              </div>
            </div>

            <IzvjestajKartica
              naslov="Primke"
              broj={primkeData.length}
              akcije={<PdfDugme onClick={exportPrimkePdf} disabled={primkeData.length === 0} />}
            >
              {primkeData.length === 0 ? (
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
                      { label: 'Marža', className: 'text-right pl-2 pr-5 w-[80px]' },
                    ]} />
                    <tbody>
                      {primkeData.map((primka) => {
                        const nab = (primka.stavke || []).reduce((s, st) => s + nabavnaVrijednost(st), 0);
                        const prod = (primka.stavke || []).reduce((s, st) => s + st.cijena * st.kolicina, 0);
                        const marzaPct = nab > 0 ? ((prod - nab) / nab * 100) : 0;
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
                              {formatKM(nab)}
                            </td>
                            <td className={cn(td, 'px-2 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                              {formatKM(prod)}
                            </td>
                            <td className={cn(td, 'pl-2 pr-5 text-right font-mono text-[12px] font-medium tabular-nums whitespace-nowrap',
                              marzaPct > 0 ? 'text-emerald-600' : 'text-slate-400')}>
                              {marzaPct > 0 ? '+' : ''}{marzaPct.toFixed(1).replace('.', ',')}%
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
        )}

        {/* ═══ NIVELACIJE TAB ═══ */}
        {activeTab === 'nivelacije' && (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Broj nivelacija" value={String(nivelacijeData.length)} />
                <Stat label="Pozitivna razlika" tone="positive"
                  value={formatKM(nivelacijeData.filter(n => (n.ukupnaRazlika ?? 0) > 0).reduce((s, n) => s + (n.ukupnaRazlika ?? 0), 0))} />
                <Stat label="Negativna razlika" tone="negative"
                  value={formatKM(nivelacijeData.filter(n => (n.ukupnaRazlika ?? 0) < 0).reduce((s, n) => s + (n.ukupnaRazlika ?? 0), 0))} />
              </div>
            </div>

            <IzvjestajKartica
              naslov="Nivelacije"
              broj={nivelacijeData.length}
              akcije={nivelacijeData.length > 0 && expandedNivId
                ? <PdfDugme onClick={() => exportNivelacijaPdf(expandedNivId)} />
                : undefined}
            >
              {nivelacijeData.length === 0 ? (
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
                      {nivelacijeData.map((niv) => {
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
                                      {expandedNivStavke.map((s: any) => (
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
        )}

        {/* ═══ FISKALNI TAB ═══ */}
        {activeTab === 'fiskalni' && (
          <div className="h-full overflow-y-auto px-6 pt-5 pb-5 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-700">Fiskalni izvještaji</span>
              </div>
              <FiskalniRed
                ikona={Clock}
                naslov="Presjek stanja"
                oznaka="X"
                opis="Trenutni promet dana. Ništa se ne nulira, može se štampati koliko god puta."
                akcija="Štampaj"
                zauzet={stampa === 'x'}
                zakljucano={stampa !== null}
                ishod={ishod.x}
                onClick={handleXReport}
              />
              <FiskalniRed
                ikona={Moon}
                naslov="Dnevni izvještaj"
                oznaka="Z"
                opis="Zatvara dan i nulira promet na uređaju. Štampa se jednom, na kraju radnog dana."
                akcija="Zatvori dan…"
                opasno
                zauzet={stampa === 'z'}
                zakljucano={stampa !== null}
                ishod={ishod.z}
                onClick={() => setZPotvrda(true)}
              />
              <FiskalniRed
                ikona={Calendar}
                naslov="Periodični izvještaj"
                oznaka={`${fmtDisplay(dateFrom)} — ${fmtDisplay(dateTo)}`}
                opis="Zbir zatvorenih dana za period odabran u zaglavlju."
                akcija="Štampaj"
                zauzet={stampa === 'periodicni'}
                zakljucano={stampa !== null}
                ishod={ishod.periodicni}
                onClick={handlePeriodicReport}
              />
            </div>

            {/* Stanje ladice — lokalna evidencija pologa/povrata za danas */}
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
                <span className="text-[13px] font-semibold text-slate-700">Stanje ladice danas</span>
                <span className="hidden md:inline text-[12px] text-slate-400">Uporedi s presjekom stanja prije zatvaranja dana</span>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setCashDialogTip('polog')}>
                    Polog
                  </Button>
                  <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setCashDialogTip('povrat')}>
                    Povrat novca
                  </Button>
                </div>
              </div>

              {ladica && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-5">
                  <Stat label="Polozi" value={formatKM(ladica.polozi)} />
                  <Stat label="Gotovinski promet" value={formatKM(ladica.gotovinskiPromet)} />
                  <Stat label="Povrati" value={formatKM(-ladica.povrati)} />
                  <Stat label="Reklamacije" value={formatKM(-ladica.gotovinskeReklamacije)} />
                  <Stat label="Očekivano u ladici" value={formatKM(ladica.ocekivanoStanje)} strong
                    className="col-span-2 lg:col-span-1 border-emerald-200 bg-emerald-50/50" />
                </div>
              )}

              {kretanja.length > 0 && (
                <div className="border-t border-slate-100 px-5">
                  {kretanja.map(k => (
                    <div key={k.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-b-0 text-[12px]">
                      <span className="font-mono text-[12px] text-slate-400 tabular-nums">{k.createdAt.slice(11, 16)}</span>
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', k.tip === 'polog' ? 'bg-emerald-500' : 'bg-rose-500')} />
                        {k.tip === 'polog' ? 'Polog' : 'Povrat'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-500">
                        {k.korisnikIme}{k.napomena ? <span className="text-slate-400"> · {k.napomena}</span> : null}
                      </span>
                      {k.tringStatus === 'error' && (
                        <Button
                          variant="outline" size="sm" className="h-7 px-2 text-[11px] text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                          disabled={retryingId === k.id}
                          onClick={() => retryCash(k.id)}
                        >
                          {retryingId === k.id ? 'Slanje…' : 'Nije poslano — ponovi'}
                        </Button>
                      )}
                      <span className={cn('font-mono text-[12.5px] font-semibold tabular-nums whitespace-nowrap', k.tip === 'polog' ? 'text-emerald-600' : 'text-rose-600')}>
                        {k.tip === 'polog' ? '+' : '−'}{formatKM(k.iznos)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <CashMovementDialog
              open={cashDialogTip !== null}
              tip={cashDialogTip ?? 'polog'}
              onClose={() => setCashDialogTip(null)}
              onSaved={loadLadica}
            />
            <ZIzvjestajDialog
              open={zPotvrda}
              ocekivano={ladica?.ocekivanoStanje ?? null}
              onClose={() => setZPotvrda(false)}
              onConfirm={handleZReport}
              onPresjek={() => { setZPotvrda(false); handleXReport(); }}
            />
          </div>
        )}

        {/* ═══ KNJIGOVOĐA TAB ═══ */}
        {activeTab === 'knjigovodja' && <KnjigovodjaTab />}
      </div>
    </div>
  );
}
