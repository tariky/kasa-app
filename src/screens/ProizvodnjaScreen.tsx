// src/screens/ProizvodnjaScreen.tsx
import { useEffect, useMemo, useState } from 'react';
import type { RadniNalog, NalogStatus } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
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
import { useIpcPodaci } from '@/hooks/useIpcPodaci';
import { GreskaUcitavanja } from '@/components/GreskaUcitavanja';
import { useLedgerLista } from '@/hooks/useLedgerLista';
import { usePreciceListe } from '@/hooks/usePreciceListe';

const STATUS_META: Record<NalogStatus, { label: string; dot: string }> = {
  otvoren: { label: 'Otvoren', dot: 'bg-slate-400' },
  u_izradi: { label: 'U izradi', dot: 'bg-blue-500' },
  zavrsen: { label: 'Završen', dot: 'bg-emerald-500' },
  fakturisan: { label: 'Fakturisan', dot: 'bg-violet-500' },
};

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
export default function ProizvodnjaScreen({ uloga, initialNalogId }: {
  uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  const { postavke } = useDokumentPostavke();
  const [tab, setTab] = useState<Tab>('nalozi');
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('aktivni');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const { podaci, greska, osvjezi: load } = useIpcPodaci(() => window.api.getNalozi(), []);
  const nalozi = useMemo<RadniNalog[]>(() => podaci ?? [], [podaci]);

  const visible = useMemo(() => nalozi.filter(n =>
    filter === 'sve' ? true : filter === 'aktivni' ? n.status !== 'fakturisan' : n.status === filter
  ), [nalozi, filter]);
  const visibleIds = useMemo(() => visible.map(n => n.id), [visible]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: nalozi.length, aktivni: 0 };
    for (const n of nalozi) { c[n.status] = (c[n.status] ?? 0) + 1; if (n.status !== 'fakturisan') c.aktivni++; }
    return c;
  }, [nalozi]);

  const lista = useLedgerLista(visible, { onOtvori: setOpenId });
  const selIndex = lista.izabraniIndeks;
  const danas = localDateStr();

  useEffect(() => {
    if (initialNalogId) { setTab('nalozi'); lista.otvori(initialNalogId); }
  }, [initialNalogId]);

  // Prečice ekrana — dijalog naloga ima svoje, pa se ove gase dok je otvoren.
  usePreciceListe({
    aktivno: !formOpen && openId == null && tab === 'nalozi',
    lista,
    onNovi: () => setFormOpen(true),
    onOsvjezi: load,
    filteri: { opcije: FILTERS, vrijednost: filter, postavi: setFilter },
  });

  // Po zatvaranju dijaloga fokus se vraća na red naloga da ↑↓ odmah rade dalje.
  const zatvori = () => {
    setOpenId(null);
    lista.vratiFokus();
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

      {tab === 'nalozi' && <GreskaUcitavanja greska={greska} onPonovo={load} />}

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
      ) : visible.length === 0 ? podaci && (
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
              <tbody onKeyDown={lista.onTbodyKeyDown}>
                {visible.map((n, i) => {
                  const isSel = lista.izabranId === n.id;
                  const zatvoren = n.status === 'zavrsen' || n.status === 'fakturisan';
                  const rok = rokOznaka(n.rok, danas, zatvoren);
                  const Icon = n.vrsta === 'narudzba' ? User : Package;
                  const naziv = n.vrsta === 'narudzba' ? n.kupacNaziv : n.productNaziv;
                  return (
                    <tr key={n.id}
                      {...lista.rowProps(i)}
                      onClick={() => lista.otvori(n.id)}
                      className={cn('group cursor-pointer transition-colors',
                        'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                        isSel ? 'bg-blue-50/70' : 'hover:bg-slate-50')}>
                      <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] tabular-nums whitespace-nowrap',
                        isSel ? 'font-semibold text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-400')}>{formatBrojNaloga(n, postavke.nalog.broj)}</td>
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

      <NalogDialog open={formOpen} onOpenChange={setFormOpen} nalog={null}
        onSaved={async (id) => { await load(); setMsg({ type: 'success', text: 'Nalog otvoren' }); lista.otvori(id); }} />

      <NalogDetailDialog
        nalogId={openId}
        redoslijed={visibleIds}
        uloga={uloga}
        onClose={zatvori}
        onNavigate={lista.otvori}
        onChanged={load}
        onDeleted={async (n) => { setOpenId(null); lista.postaviIzabran(null); await load(); setMsg({ type: 'success', text: `Nalog ${formatBrojNaloga(n, postavke.nalog.broj)} obrisan` }); }}
      />
    </div>
  );
}
