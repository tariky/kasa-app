import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Printer, FileText, AlertTriangle, TrendingUp, Package,
  ArrowUpRight, ArrowDownRight, RotateCcw, Calendar, Loader2,
  ChevronRight, Zap, Clock, BarChart3,
} from 'lucide-react';
import { cn, formatKM, formatDateTime, formatDate } from '@/lib/utils';
import { Order, Primka } from '@/types';

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDisplay(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

type Tab = 'promet' | 'primke' | 'fiskalni';

export default function IzvjestajiScreen() {
  const [dateFrom, setDateFrom] = useState(new Date());
  const [dateTo, setDateTo] = useState(new Date());
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('promet');

  const [prometData, setPrometData] = useState<Order[]>([]);
  const [prometLoading, setPrometLoading] = useState(false);

  const [primkeData, setPrimkeData] = useState<Primka[]>([]);
  const [primkeLoading, setPrimkeLoading] = useState(false);

  const [fiskalniStatus, setFiskalniStatus] = useState('');
  const [fiskalniError, setFiskalniError] = useState(false);

  const loadPromet = async () => {
    setPrometLoading(true);
    try {
      const data = await window.api.getReportData('dnevni', toDateStr(dateFrom), toDateStr(dateTo));
      setPrometData(data);
    } catch (err) {
      console.error('Promet load error:', err);
    } finally {
      setPrometLoading(false);
    }
  };

  const loadPrimke = async () => {
    setPrimkeLoading(true);
    try {
      const data = await window.api.getReportData('primke', toDateStr(dateFrom), toDateStr(dateTo));
      setPrimkeData(data);
    } catch (err) {
      console.error('Primke load error:', err);
    } finally {
      setPrimkeLoading(false);
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
    (sum, p) => sum + (p.stavke || []).reduce((s, st) => s + (st.nabavnaCijena || 0) * st.kolicina, 0), 0
  );
  const primkeProdajna = primkeData.reduce(
    (sum, p) => sum + (p.stavke || []).reduce((s, st) => s + st.cijena * st.kolicina, 0), 0
  );

  const setFiskalniMsg = (msg: string, isError = false) => {
    setFiskalniStatus(msg);
    setFiskalniError(isError);
  };

  const handleXReport = async () => {
    setFiskalniMsg('Štampam X izvještaj...');
    try {
      await window.api.tringXReport();
      setFiskalniMsg('X izvještaj uspješno odštampan.');
    } catch { setFiskalniMsg('Greška pri štampanju X izvještaja.', true); }
  };

  const handleZReport = async () => {
    setFiskalniMsg('Štampam Z izvještaj...');
    try {
      await window.api.tringZReport();
      setFiskalniMsg('Z izvještaj uspješno odštampan.');
    } catch { setFiskalniMsg('Greška pri štampanju Z izvještaja.', true); }
  };

  const handlePeriodicReport = async () => {
    setFiskalniMsg('Štampam periodični izvještaj...');
    try {
      await window.api.tringPeriodicReport(toDateStr(dateFrom), toDateStr(dateTo));
      setFiskalniMsg('Periodični izvještaj uspješno odštampan.');
    } catch { setFiskalniMsg('Greška pri štampanju periodičnog izvještaja.', true); }
  };

  const tabs: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
    { id: 'promet', label: 'Promet', icon: TrendingUp },
    { id: 'primke', label: 'Ulaz robe', icon: Package },
    { id: 'fiskalni', label: 'Fiskalni', icon: Printer },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">

      {/* ── Top bar: date range + tabs ── */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
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
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
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

          {/* Date range */}
          <div className="flex items-center gap-3">
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
            {activeTab !== 'fiskalni' && (
              <Button
                size="sm"
                className="h-9 gap-2"
                onClick={activeTab === 'promet' ? loadPromet : loadPrimke}
                disabled={activeTab === 'promet' ? prometLoading : primkeLoading}
              >
                {(activeTab === 'promet' ? prometLoading : primkeLoading) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <BarChart3 size={14} />
                )}
                Generiši
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ═══ PROMET TAB ═══ */}
        {activeTab === 'promet' && (
          <div className="flex flex-col h-full">
            {/* Metric cards */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-4 gap-4">
                {/* Prodaja */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Prodaja</span>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <ArrowUpRight size={16} className="text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {formatKM(ukupnaProdaja)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2 font-mono">{brojRacuna} računa</p>
                </div>

                {/* Osnovica */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Osnovica</span>
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <FileText size={16} className="text-blue-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {formatKM(ukupnaOsnovica)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">Bez PDV-a</p>
                </div>

                {/* PDV */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">PDV (17%)</span>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <BarChart3 size={16} className="text-amber-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {formatKM(ukupniPDV)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">Obračunati porez</p>
                </div>

                {/* Reklamacije */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Reklamacije</span>
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                      <ArrowDownRight size={16} className="text-red-500" />
                    </div>
                  </div>
                  <p className={cn(
                    'text-[22px] font-bold font-mono tracking-tight leading-none',
                    ukupneReklamacije > 0 ? 'text-red-500' : 'text-slate-900'
                  )}>
                    {formatKM(ukupneReklamacije)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2 font-mono">{refundedOrders.length} storniranih</p>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 px-6 pb-5">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
                {/* Table header bar */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">Računi</span>
                    {prometData.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                        {prometData.length}
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[12px] text-slate-500" onClick={() => window.print()}>
                    <Printer size={13} />
                    Štampaj
                  </Button>
                </div>

                {prometData.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                      <TrendingUp size={24} className="text-slate-300" />
                    </div>
                    <p className="text-[13px] font-medium text-slate-500">Nema podataka</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">Odaberite period i kliknite Generiši</p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                        <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="text-left pl-5 pr-2 py-2.5 w-[50px]">#</th>
                          <th className="text-left px-2 py-2.5">Datum</th>
                          <th className="text-left px-2 py-2.5">Kasir</th>
                          <th className="text-left px-2 py-2.5">Fiskalni br.</th>
                          <th className="text-right px-2 py-2.5">Osnovica</th>
                          <th className="text-right px-2 py-2.5">PDV</th>
                          <th className="text-right px-2 py-2.5">Ukupno</th>
                          <th className="text-center pr-5 pl-2 py-2.5 w-[100px]">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prometData.map((order) => {
                          const isRefunded = order.status === 'refunded';
                          return (
                            <tr
                              key={order.id}
                              className={cn(
                                'border-t border-slate-50 transition-colors hover:bg-slate-50/50',
                                isRefunded && 'bg-red-50/30',
                              )}
                            >
                              <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono text-slate-400">{order.id}</td>
                              <td className="px-2 py-2.5 text-[12px] text-slate-600 tabular-nums">{formatDateTime(order.createdAt)}</td>
                              <td className="px-2 py-2.5 text-[12px] text-slate-600">{order.korisnikIme || '—'}</td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-slate-500">{order.brojFiskalnogRacuna || '—'}</td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-right tabular-nums text-slate-600">
                                {formatKM(order.ukupno - order.pdvIznos)}
                              </td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-right tabular-nums text-slate-400">
                                {formatKM(order.pdvIznos)}
                              </td>
                              <td className="px-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums text-slate-800">
                                {formatKM(order.ukupno)}
                              </td>
                              <td className="pr-5 pl-2 py-2.5 text-center">
                                {isRefunded ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">
                                    <RotateCcw size={10} />
                                    Storno
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                                    OK
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollArea>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ PRIMKE TAB ═══ */}
        {activeTab === 'primke' && (
          <div className="flex flex-col h-full">
            {/* Summary strip */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Broj primki</span>
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Package size={16} className="text-blue-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {primkeData.length}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Nabavna vrijed.</span>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <ArrowDownRight size={16} className="text-amber-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {formatKM(primkeNabavna)}
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Prodajna vrijed.</span>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <ArrowUpRight size={16} className="text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {formatKM(primkeProdajna)}
                  </p>
                  {primkeNabavna > 0 && (
                    <p className="text-[11px] text-emerald-500 mt-2 font-mono font-medium">
                      +{((primkeProdajna - primkeNabavna) / primkeNabavna * 100).toFixed(1).replace('.', ',')}% marža
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 px-6 pb-5">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">Primke</span>
                    {primkeData.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                        {primkeData.length}
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[12px] text-slate-500" onClick={() => window.print()}>
                    <Printer size={13} />
                    Štampaj
                  </Button>
                </div>

                {primkeData.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                      <Package size={24} className="text-slate-300" />
                    </div>
                    <p className="text-[13px] font-medium text-slate-500">Nema podataka</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">Odaberite period i kliknite Generiši</p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                        <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="text-left pl-5 pr-2 py-2.5">Broj primke</th>
                          <th className="text-left px-2 py-2.5">Datum</th>
                          <th className="text-left px-2 py-2.5">Dobavljač</th>
                          <th className="text-left px-2 py-2.5">Faktura</th>
                          <th className="text-right px-2 py-2.5">Stavki</th>
                          <th className="text-right px-2 py-2.5">Nabavna</th>
                          <th className="text-right px-2 py-2.5">Prodajna</th>
                          <th className="text-right pr-5 pl-2 py-2.5">Marža</th>
                        </tr>
                      </thead>
                      <tbody>
                        {primkeData.map((primka) => {
                          const nab = (primka.stavke || []).reduce((s, st) => s + (st.nabavnaCijena || 0) * st.kolicina, 0);
                          const prod = (primka.stavke || []).reduce((s, st) => s + st.cijena * st.kolicina, 0);
                          const marzaPct = nab > 0 ? ((prod - nab) / nab * 100) : 0;
                          return (
                            <tr key={primka.id} className="border-t border-slate-50 transition-colors hover:bg-slate-50/50">
                              <td className="pl-5 pr-2 py-2.5 text-[12px] font-mono font-semibold text-slate-700">{primka.brojPrimke}</td>
                              <td className="px-2 py-2.5 text-[12px] tabular-nums text-slate-600">
                                {formatDate(primka.datum || primka.createdAt)}
                              </td>
                              <td className="px-2 py-2.5 text-[12px] text-slate-600">{primka.dobavljacNaziv || '—'}</td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-slate-500">{primka.brojFakture || '—'}</td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-right tabular-nums text-slate-500">
                                {primka.stavke?.length ?? 0}
                              </td>
                              <td className="px-2 py-2.5 text-[12px] font-mono text-right tabular-nums text-slate-600">
                                {formatKM(nab)}
                              </td>
                              <td className="px-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums text-slate-800">
                                {formatKM(prod)}
                              </td>
                              <td className="pr-5 pl-2 py-2.5 text-[12px] font-mono text-right tabular-nums">
                                <span className={cn(
                                  'font-medium',
                                  marzaPct > 0 ? 'text-emerald-500' : 'text-slate-400',
                                )}>
                                  {marzaPct > 0 ? '+' : ''}{marzaPct.toFixed(1).replace('.', ',')}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollArea>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ FISKALNI TAB ═══ */}
        {activeTab === 'fiskalni' && (
          <div className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-3 gap-4">
                {/* X Report */}
                <button
                  onClick={handleXReport}
                  className="group bg-white rounded-2xl p-6 border border-slate-100 shadow-sm shadow-slate-200/50 text-left transition-all hover:border-blue-200 hover:shadow-blue-100/50 active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                      <Clock size={20} className="text-blue-500" />
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-slate-800 mb-1">Presjek stanja</h3>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    X izvještaj — trenutno stanje prometa bez nuliranja
                  </p>
                </button>

                {/* Z Report */}
                <button
                  onClick={handleZReport}
                  className="group bg-white rounded-2xl p-6 border border-red-100 shadow-sm shadow-slate-200/50 text-left transition-all hover:border-red-200 hover:shadow-red-100/50 active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center group-hover:bg-red-100 transition-colors">
                      <Zap size={20} className="text-red-500" />
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-red-400 transition-colors" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-slate-800 mb-1">Dnevni izvještaj</h3>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    Z izvještaj — zatvara dan i nulira promet
                  </p>
                </button>

                {/* Periodic */}
                <button
                  onClick={handlePeriodicReport}
                  className="group bg-white rounded-2xl p-6 border border-slate-100 shadow-sm shadow-slate-200/50 text-left transition-all hover:border-amber-200 hover:shadow-amber-100/50 active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                      <Calendar size={20} className="text-amber-500" />
                    </div>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-400 transition-colors" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-slate-800 mb-1">Periodični izvještaj</h3>
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    Za odabrani period ({fmtDisplay(dateFrom)} — {fmtDisplay(dateTo)})
                  </p>
                </button>
              </div>
            </div>

            {/* Warning + Status */}
            <div className="px-6 space-y-3">
              <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-amber-700">Pažnja: Z izvještaj je nepovratna operacija</p>
                  <p className="text-[11px] text-amber-600/70 mt-0.5">Nulira sve vrijednosti na fiskalnom uređaju. Koristiti isključivo na kraju radnog dana.</p>
                </div>
              </div>

              {fiskalniStatus && (
                <div className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-medium',
                  fiskalniError
                    ? 'bg-red-50/60 border border-red-100 text-red-600'
                    : 'bg-emerald-50/60 border border-emerald-100 text-emerald-600',
                )}>
                  {fiskalniError ? <AlertTriangle size={14} /> : <Printer size={14} />}
                  {fiskalniStatus}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
