import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Printer, FileText, AlertTriangle, TrendingUp, Package,
  Calendar, Loader2, ChevronRight, BarChart3, Boxes, BookOpenCheck,
} from 'lucide-react';
import { VrijednostZalihe } from '@/components/skladiste/VrijednostZalihe';
import KnjigovodjaTab from '@/components/izvjestaji/KnjigovodjaTab';
import PrometTab from '@/components/izvjestaji/PrometTab';
import PrimkeTab from '@/components/izvjestaji/PrimkeTab';
import NivelacijeTab from '@/components/izvjestaji/NivelacijeTab';
import FiskalniTab from '@/components/izvjestaji/FiskalniTab';
import { fmtDisplay } from '@/components/izvjestaji/dijelovi';
import { cn } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import type { FirmaSettings, Nivelacija, Order, Primka } from '@/types';

type Tab = 'promet' | 'primke' | 'nivelacije' | 'zaliha' | 'fiskalni' | 'knjigovodja';

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

  const [nivelacijeData, setNivelacijeData] = useState<Nivelacija[]>([]);
  const [nivelacijeLoading, setNivelacijeLoading] = useState(false);

  const [firma, setFirma] = useState<FirmaSettings | null>(null);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    window.api.getFirmaSettings().then(setFirma);
  }, []);

  // Auto-load data when tab or date range changes (Fiskalni osvježava ladicu sam)
  useEffect(() => {
    if (activeTab === 'promet') loadPromet();
    else if (activeTab === 'primke') loadPrimke();
    else if (activeTab === 'nivelacije') loadNivelacije();
  }, [activeTab, dateFrom, dateTo]);

  const loadPromet = async () => {
    setPrometLoading(true);
    try {
      const data = await window.api.getReportData('dnevni', localDateStr(dateFrom), localDateStr(dateTo));
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
      const data = await window.api.getReportData('primke', localDateStr(dateFrom), localDateStr(dateTo));
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
      const data = await window.api.getNivelacije(localDateStr(dateFrom), localDateStr(dateTo));
      setNivelacijeData(data);
      setReportError('');
    } catch (err: any) {
      setReportError(err?.message || 'Greška pri učitavanju nivelacija');
    } finally {
      setNivelacijeLoading(false);
    }
  };

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
        {activeTab === 'promet' && (
          <PrometTab orders={prometData} dateFrom={dateFrom} dateTo={dateTo} firma={firma} onGreska={setReportError} />
        )}
        {activeTab === 'primke' && (
          <PrimkeTab primke={primkeData} dateFrom={dateFrom} dateTo={dateTo} firma={firma} onGreska={setReportError} />
        )}
        {activeTab === 'nivelacije' && (
          <NivelacijeTab nivelacije={nivelacijeData} firma={firma} onGreska={setReportError} />
        )}
        {/* Montiran i kad nije otvoren — štampa na uređaju ne smije izgubiti zaključavanje pri promjeni taba */}
        <FiskalniTab aktivan={activeTab === 'fiskalni'} dateFrom={dateFrom} dateTo={dateTo} />
        {activeTab === 'knjigovodja' && <KnjigovodjaTab />}
      </div>
    </div>
  );
}
