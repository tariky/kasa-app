// src/screens/ProizvodnjaScreen.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RadniNalog, NalogStatus } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { rokOznaka } from '@/lib/nalogPrikaz';
import { localDateStr } from '@/lib/novac';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import { NalogDialog } from '@/components/proizvodnja/NalogDialog';
import { NalogDetailDialog } from '@/components/proizvodnja/NalogDetailDialog';
import { NormativiTab } from '@/components/proizvodnja/NormativiTab';
import { RefreshCw, Plus, Hammer, ClipboardList, AlertTriangle, X, Factory, User, Package } from 'lucide-react';

export const STATUS_META: Record<NalogStatus, { label: string; cls: string; dot: string }> = {
  otvoren: { label: 'Otvoren', cls: 'bg-slate-50 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
  u_izradi: { label: 'U izradi', cls: 'bg-blue-50 text-blue-600 border-blue-100', dot: 'bg-blue-500' },
  zavrsen: { label: 'Završen', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100', dot: 'bg-emerald-500' },
  fakturisan: { label: 'Fakturisan', cls: 'bg-violet-50 text-violet-600 border-violet-100', dot: 'bg-violet-500' },
};

export function StatusChip({ status, size = 'sm' }: { status: NalogStatus; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center rounded-full font-semibold border text-[10px]', size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1', m.cls)}>
      {m.label}
    </span>
  );
}

/** Status u listi — tačka + tekst, kao stanje zalihe u listi artikala. */
function StatusTacka({ status }: { status: NalogStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="flex items-center gap-1.5 text-[12px] leading-5 text-slate-600">
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

type Filter = 'aktivni' | 'otvoren' | 'u_izradi' | 'zavrsen' | 'fakturisan' | 'sve';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'aktivni', label: 'Aktivni' },
  { id: 'otvoren', label: 'Otvoreni' },
  { id: 'u_izradi', label: 'U izradi' },
  { id: 'zavrsen', label: 'Završeni' },
  { id: 'fakturisan', label: 'Fakturisani' },
  { id: 'sve', label: 'Svi' },
];

type Tab = 'nalozi' | 'normativi';

const ROK_CLS = { ok: 'text-slate-400', warn: 'text-amber-600', late: 'text-rose-600 font-medium' } as const;

/**
 * Proizvodnja: lista naloga preko cijelog ekrana, nalog se otvara u dijalogu preko svega.
 * Tastatura na listi: ↑↓ kreću selekciju, ↵ otvara, N novi, ←→ ili [ ] mijenjaju filter.
 */
export default function ProizvodnjaScreen({ korisnikId, uloga, initialNalogId }: {
  korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  const [tab, setTab] = useState<Tab>('nalozi');
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('aktivni');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const load = useCallback(async () => {
    setNalozi(await window.api.getNalozi());
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (initialNalogId) { setTab('nalozi'); setSelectedId(initialNalogId); setOpenId(initialNalogId); }
  }, [initialNalogId]);

  const visible = useMemo(() => nalozi.filter(n =>
    filter === 'sve' ? true : filter === 'aktivni' ? n.status !== 'fakturisan' : n.status === filter
  ), [nalozi, filter]);
  const visibleIds = useMemo(() => visible.map(n => n.id), [visible]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: nalozi.length, aktivni: 0 };
    for (const n of nalozi) { c[n.status] = (c[n.status] ?? 0) + 1; if (n.status !== 'fakturisan') c.aktivni++; }
    return c;
  }, [nalozi]);

  const selIndex = visible.findIndex(n => n.id === selectedId);
  const danas = localDateStr();

  const focusRow = useCallback((index: number) => {
    const n = visible[index];
    if (!n) return;
    setSelectedId(n.id);
    const el = rowRefs.current[index];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }, [visible]);

  const otvori = (id: number) => { setSelectedId(id); setOpenId(id); };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const current = selIndex < 0 ? -1 : selIndex;
    const last = visible.length - 1;
    const go = (i: number) => { e.preventDefault(); focusRow(Math.max(0, Math.min(last, i))); };
    switch (e.key) {
      case 'ArrowDown': return go(current + 1);
      case 'ArrowUp': return go(current < 0 ? 0 : current - 1);
      case 'PageDown': return go(current + 10);
      case 'PageUp': return go(current < 0 ? 0 : current - 10);
      case 'Home': return go(0);
      case 'End': return go(last);
      case 'Enter': case ' ':
        if (selectedId != null) { e.preventDefault(); otvori(selectedId); }
        return;
      default:
    }
  };

  const anyDialogOpen = formOpen || openId != null;

  // Prečice ekrana — dijalog naloga ima svoje, pa se ove gase dok je otvoren.
  useEffect(() => {
    if (anyDialogOpen || tab !== 'nalozi') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t && t.closest('[role="combobox"], [role="listbox"]')) return;

      const cycleFilter = (step: number) => {
        e.preventDefault();
        const i = FILTERS.findIndex(f => f.id === filter);
        setFilter(FILTERS[(i + step + FILTERS.length) % FILTERS.length].id);
      };
      // Strelice rade na svakom rasporedu; zagrade su alias jer na bosanskom traže AltGr.
      if (e.key === 'ArrowLeft' || e.key === '[') return cycleFilter(-1);
      if (e.key === 'ArrowRight' || e.key === ']') return cycleFilter(1);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Fokus nije na listi — uvedi ga na selektovani ili prvi red.
        if (!t?.closest('tbody')) { e.preventDefault(); focusRow(selIndex < 0 ? 0 : selIndex); }
        return;
      }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setFormOpen(true); return; }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); load(); return; }
      if (e.key === 'Enter' && selectedId != null) { e.preventDefault(); otvori(selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyDialogOpen, tab, filter, selectedId, selIndex, focusRow, load]);

  // Po zatvaranju dijaloga fokus se vraća na red naloga da ↑↓ odmah rade dalje.
  const zatvori = () => {
    setOpenId(null);
    requestAnimationFrame(() => { const i = visible.findIndex(n => n.id === selectedId); if (i >= 0) rowRefs.current[i]?.focus(); });
  };

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className={cn('flex flex-col h-full', tab === 'nalozi' ? 'bg-white' : 'bg-[#f4f6f9]')}>
      <div className="flex-shrink-0 bg-white border-b border-slate-200/80 px-6 py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight">Proizvodnja</h2>
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {([['nalozi', 'Radni nalozi', Hammer], ['normativi', 'Normativi', ClipboardList]] as const).map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50', tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'nalozi' && (
        <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
          <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
              <RefreshCw className="h-3.5 w-3.5" /> Osvježi <Key>R</Key>
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Novi nalog <Key tone="dark">N</Key>
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <div className={cn('flex-shrink-0 flex items-center gap-2 px-6 py-2 border-b text-[12px] font-medium',
          msg.type === 'error' ? 'bg-rose-50/60 border-rose-100 text-rose-700' : 'bg-emerald-50/60 border-emerald-100 text-emerald-700')}>
          {msg.type === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Factory className="h-3.5 w-3.5" />}
          {msg.text}
          <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setMsg(null)} aria-label="Sakrij poruku"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {tab === 'normativi' ? (
        <NormativiTab />
      ) : visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Hammer size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">{nalozi.length > 0 ? 'Nema naloga u ovom filteru' : 'Nema radnih naloga'}</p>
          <p className="text-[12px] text-slate-400 mt-0.5">Prvi nalog, za kupca ili za zalihu, otvaraš tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead columns={[
                { label: 'Broj', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
                { label: 'Datum', className: 'text-left px-3 w-[1%] whitespace-nowrap hidden lg:table-cell' },
                { label: 'Kupac / proizvod', className: 'text-left px-3' },
                { label: 'Opis', className: 'text-left px-3 w-[30%] hidden xl:table-cell' },
                { label: 'Rok', className: 'text-left px-3 w-[170px] hidden md:table-cell' },
                { label: 'Cijena', className: 'text-right px-3 w-[120px]' },
                { label: 'Status', className: 'text-left pl-3 pr-6 w-[120px]' },
              ]} />
              <tbody onKeyDown={handleListKeyDown}>
                {visible.map((n, i) => {
                  const isSel = selectedId === n.id;
                  const zatvoren = n.status === 'zavrsen' || n.status === 'fakturisan';
                  const rok = rokOznaka(n.rok, danas, zatvoren);
                  const Icon = n.vrsta === 'narudzba' ? User : Package;
                  const naziv = n.vrsta === 'narudzba' ? n.kupacNaziv : n.productNaziv;
                  return (
                    <tr key={n.id}
                      ref={el => { rowRefs.current[i] = el; }}
                      tabIndex={isSel || (selIndex < 0 && i === 0) ? 0 : -1}
                      aria-selected={isSel}
                      onClick={() => otvori(n.id)}
                      onFocus={() => setSelectedId(n.id)}
                      className={cn('group cursor-pointer transition-colors',
                        'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                        isSel ? 'bg-blue-50/70' : 'hover:bg-slate-50')}>
                      <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] tabular-nums whitespace-nowrap',
                        isSel ? 'font-semibold text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-400')}>{formatBrojNaloga(n)}</td>
                      <td className={cn(td, 'hidden lg:table-cell px-3 text-[12px] text-slate-500 tabular-nums whitespace-nowrap')}>{formatDate(n.datum)}</td>
                      <td className={cn(td, 'px-3 max-w-0')}>
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                          {naziv
                            ? <span className="truncate text-[12.5px] font-medium text-slate-800">{naziv}</span>
                            : <span className="text-[12.5px] text-slate-200">—</span>}
                          {n.vrsta === 'zaliha' && <span className="flex-shrink-0 font-mono text-[11.5px] tabular-nums text-slate-400">× {n.kolicina}</span>}
                        </span>
                        {n.opis && <span className="xl:hidden block pl-[22px] text-[10.5px] text-slate-400 truncate">{n.opis}</span>}
                      </td>
                      <td className={cn(td, 'hidden xl:table-cell px-3 text-[12px] text-slate-400 truncate max-w-0')}>
                        {n.opis || <span className="text-slate-200">—</span>}
                      </td>
                      <td className={cn(td, 'hidden md:table-cell px-3 text-[12px] tabular-nums whitespace-nowrap')}>
                        {n.rok ? (
                          <span className="flex items-baseline gap-2">
                            <span className="text-slate-600">{formatDate(n.rok)}</span>
                            {rok && <span className={cn('text-[10.5px]', ROK_CLS[rok.tone])}>{rok.label}</span>}
                          </span>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      <td className={cn(td, 'px-3 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                        {n.dogovorenaCijena != null ? formatKM(n.dogovorenaCijena) : <span className="text-slate-200 font-normal">—</span>}
                      </td>
                      <td className={cn(td, 'pl-3 pr-6 whitespace-nowrap')}><StatusTacka status={n.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
          <div className="flex-shrink-0 border-t border-slate-200/80 px-6 h-9 flex items-center gap-3 text-[10.5px] text-slate-400 select-none">
            <span className="font-mono tabular-nums">{selIndex >= 0 ? `${selIndex + 1} / ${visible.length}` : `${visible.length}`}</span>
            <span className="text-slate-300">·</span>
            <span className="hidden sm:flex items-center gap-3">
              <span className="flex items-center gap-1"><Key className="ml-0">↑↓</Key> odaberi</span>
              <span className="flex items-center gap-1"><Key className="ml-0">↵</Key> otvori</span>
              <span className="flex items-center gap-1"><Key className="ml-0">←→</Key> filter</span>
              <span className="flex items-center gap-1"><Key className="ml-0">N</Key> novi</span>
              <span className="flex items-center gap-1"><Key className="ml-0">R</Key> osvježi</span>
            </span>
          </div>
        </>
      )}

      <NalogDialog open={formOpen} onOpenChange={setFormOpen} korisnikId={korisnikId} nalog={null}
        onSaved={async (id) => { await load(); setMsg({ type: 'success', text: 'Nalog otvoren' }); otvori(id); }} />

      <NalogDetailDialog
        nalogId={openId}
        redoslijed={visibleIds}
        korisnikId={korisnikId}
        uloga={uloga}
        onClose={zatvori}
        onNavigate={otvori}
        onChanged={load}
        onDeleted={async (n) => { setOpenId(null); setSelectedId(null); await load(); setMsg({ type: 'success', text: `Nalog ${formatBrojNaloga(n)} obrisan` }); }}
      />
    </div>
  );
}
