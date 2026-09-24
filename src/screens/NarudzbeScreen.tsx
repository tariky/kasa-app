import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Receipt, AlertTriangle, Undo2, Plus, Paperclip } from 'lucide-react';
import { Order } from '@/types';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import { Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import DodajRacunDialog from '@/components/DodajRacunDialog';
import { RacunDetailDialog } from '@/components/racuni/RacunDetailDialog';

type Filter = 'sve' | 'aktivni' | 'storno';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'sve', label: 'Sve' },
  { id: 'aktivni', label: 'Aktivni' },
  { id: 'storno', label: 'Storno' },
];

function StatusChip({ refunded, size = 'sm' }: { refunded: boolean; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold border',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[10px] px-2.5 py-1',
        refunded
          ? 'bg-rose-50 text-rose-600 border-rose-100'
          : 'bg-emerald-50 text-emerald-600 border-emerald-100',
      )}
    >
      {refunded && <Undo2 size={10} />}
      {refunded ? 'Storno' : 'Završen'}
    </span>
  );
}


export default function NarudzbeScreen({ korisnikId }: { korisnikId: number }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');
  const [dodajOpen, setDodajOpen] = useState(false);
  const [gaps, setGaps] = useState<number[]>([]);
  const [prefillBroj, setPrefillBroj] = useState<string | undefined>(undefined);

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const loadOrders = useCallback(async () => {
    setOrders(await window.api.getOrders());
  }, []);

  const loadGaps = async () => {
    setGaps(await window.api.getFiscalGaps());
  };

  useEffect(() => {
    loadOrders();
    loadGaps();
  }, [loadOrders]);

  const isRefunded = (status: Order['status']) => status === 'refunded';

  const visible = useMemo(() => {
    if (filter === 'aktivni') return orders.filter(o => o.status === 'completed');
    if (filter === 'storno') return orders.filter(o => o.status === 'refunded');
    return orders;
  }, [orders, filter]);
  const visibleIds = useMemo(() => visible.map(o => o.id), [visible]);

  const counts = useMemo(() => ({
    sve: orders.length,
    aktivni: orders.filter(o => o.status === 'completed').length,
    storno: orders.filter(o => o.status === 'refunded').length,
  }), [orders]);

  const selIndex = visible.findIndex(o => o.id === selectedId);

  /** Pomjera izbor u listi i drži fokus na redu — osnova za tastaturnu navigaciju. */
  const focusRow = useCallback((index: number) => {
    const o = visible[index];
    if (!o) return;
    setSelectedId(o.id);
    const el = rowRefs.current[index];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }, [visible]);

  const otvori = (id: number) => { setSelectedId(id); setOpenId(id); };

  // Po zatvaranju dijaloga fokus se vraća na red računa da ↑↓ odmah rade dalje.
  const zatvori = () => {
    setOpenId(null);
    requestAnimationFrame(() => { const i = visible.findIndex(o => o.id === selectedId); if (i >= 0) rowRefs.current[i]?.focus(); });
  };

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

  const anyDialogOpen = dodajOpen || openId != null;

  // Prečice ekrana — dijalog računa ima svoje, pa se ove gase dok je otvoren.
  useEffect(() => {
    if (anyDialogOpen) return;
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
      if (t?.closest('tbody')) return;
      if (e.key === 'Enter' && selectedId != null) { e.preventDefault(); otvori(selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyDialogOpen, filter, selectedId, selIndex, focusRow]);

  return (
    <div className="flex flex-col h-full bg-[#f4f6f9]">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200/80 px-6 py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight">Računi</h2>
            <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { loadOrders(); loadGaps(); }} className="h-8 gap-1.5 text-[12px]">
              <RefreshCw className="h-3.5 w-3.5" />
              Osvježi
            </Button>
            <Button size="sm" onClick={() => setDodajOpen(true)} className="h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Dodaj račun
            </Button>
          </div>
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="mx-5 mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <p className="text-[12px] font-semibold text-amber-800">
              Nedostaju fiskalni brojevi u nizu — mogući neupisani računi
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {gaps.map(n => (
              <div key={n} className="flex items-center rounded-lg border border-amber-300 bg-white overflow-hidden">
                <button
                  className="h-7 px-2.5 text-[11.5px] font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                  onClick={() => { setPrefillBroj(String(n)); setDodajOpen(true); }}
                >
                  Unesi <span className="font-mono">#{n}</span>
                </button>
                <div className="w-px h-4 bg-amber-200" />
                <button
                  className="h-7 w-6 text-[13px] text-amber-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                  title={`Zanemari #${n}`}
                  onClick={async () => { await window.api.dismissFiscalGap(n); loadGaps(); }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 p-5">
          <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
            {visible.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <Receipt size={20} className="text-slate-300" strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-medium text-slate-500">
                  {filter === 'sve' ? 'Još nema računa' : 'Nema računa u ovom filteru'}
                </p>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  {filter === 'sve' ? 'Naplaćeni računi se pojavljuju ovdje.' : 'Promijenite filter da vidite ostale.'}
                </p>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1">
                  <table className="w-full border-separate border-spacing-0">
                    <LedgerHead
                      columns={[
                        { label: '#', className: 'text-left pl-5 pr-2 w-[54px]' },
                        { label: 'Datum', className: 'text-left px-2' },
                        { label: 'Fiskalni br.', className: 'text-left px-2' },
                        { label: 'Kupac', className: 'text-left px-2 w-[30%] hidden lg:table-cell' },
                        { label: 'Kasir', className: 'text-left px-2 hidden md:table-cell' },
                        { label: 'Ukupno', className: 'text-right px-2' },
                        { label: 'Status', className: 'text-right pr-5 pl-2 w-[100px]' },
                      ]}
                    />
                    <tbody onKeyDown={handleListKeyDown}>
                      {visible.map((order, i) => {
                        const refunded = isRefunded(order.status);
                        const selected = selectedId === order.id;
                        return (
                          <tr
                            key={order.id}
                            ref={el => { rowRefs.current[i] = el; }}
                            tabIndex={selected || (selIndex < 0 && i === 0) ? 0 : -1}
                            aria-selected={selected}
                            className={cn(
                              'cursor-pointer transition-colors duration-100 group',
                              'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                              selected ? 'bg-blue-50/80' : refunded ? 'bg-rose-50/30 hover:bg-rose-50/60' : 'hover:bg-slate-50',
                            )}
                            onClick={() => otvori(order.id)}
                            onFocus={() => setSelectedId(order.id)}
                          >
                            <td
                              className={cn(
                                'pl-5 pr-2 py-2.5 border-b border-slate-100 font-mono text-[11.5px] tabular-nums',
                                // Šina lijevo označava isključivo izabrani red — status ide kroz čip i iznos.
                                selected ? 'text-blue-500 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-300',
                              )}
                            >
                              {order.id}
                            </td>
                            <td className={cn('px-2 py-2.5 border-b border-slate-100 text-[12px] tabular-nums', selected ? 'text-slate-700' : 'text-slate-500')}>
                              {formatDateTime(order.createdAt)}
                            </td>
                            <td className="px-2 py-2.5 border-b border-slate-100">
                              <div className="flex items-center gap-1.5">
                                <span className={cn('font-mono text-[11.5px] tabular-nums', selected ? 'text-slate-700' : 'text-slate-400')}>
                                  {order.brojFiskalnogRacuna || '—'}
                                </span>
                                {/* isManual dolazi kao INTEGER 0/1 — bez Boolean() bi se `0` ispisala u redu. */}
                                {Boolean(order.isManual) && (
                                  <span className="inline-flex h-4 items-center rounded border border-amber-300 bg-amber-50 px-1 font-mono text-[9px] font-bold text-amber-600" title="Ručno unesen">
                                    R
                                  </span>
                                )}
                                {order.prilogBroj != null && (
                                  <span className="inline-flex h-4 items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px] font-semibold text-slate-500" title={`Faktura br. ${order.prilogBroj}`}>
                                    <Paperclip size={8} />{order.prilogBroj}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="hidden lg:table-cell px-2 py-2.5 border-b border-slate-100 text-[12.5px] max-w-0">
                              <span className={cn('block truncate', order.kupacNaziv ? 'text-slate-800 font-medium' : 'text-slate-300')}>{order.kupacNaziv || '—'}</span>
                            </td>
                            <td className={cn('hidden md:table-cell px-2 py-2.5 border-b border-slate-100 text-[12px]', selected ? 'text-slate-700' : 'text-slate-500')}>
                              {order.korisnikIme || '—'}
                            </td>
                            <td className={cn(
                              'px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12.5px] font-semibold tabular-nums',
                              refunded ? 'text-rose-500' : 'text-slate-800',
                            )}>
                              {formatKM(order.ukupno)}
                            </td>
                            <td className="pr-5 pl-2 py-2.5 border-b border-slate-100 text-right">
                              <StatusChip refunded={refunded} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>

                {/* Legenda prečica — tastatura je vidljiva, ne skrivena funkcija */}
                <div className="flex-shrink-0 border-t border-slate-100 px-5 h-9 flex items-center gap-3 text-[10.5px] text-slate-400 select-none">
                  <span className="font-mono tabular-nums">{selIndex >= 0 ? `${selIndex + 1} / ${visible.length}` : `${visible.length}`}</span>
                  <span className="text-slate-300">·</span>
                  <span className="hidden sm:flex items-center gap-3">
                    <span className="flex items-center gap-1"><Key className="ml-0">↑↓</Key> odaberi</span>
                    <span className="flex items-center gap-1"><Key className="ml-0">↵</Key> otvori</span>
                    <span className="flex items-center gap-1"><Key className="ml-0">←→</Key> filter</span>
                  </span>
                </div>
              </>
            )}
          </div>
      </div>

      {/* ── Dodaj račun ručno Dialog ── */}
      <DodajRacunDialog
        open={dodajOpen}
        onOpenChange={(v) => { setDodajOpen(v); if (!v) setPrefillBroj(undefined); }}
        korisnikId={korisnikId}
        prefillBroj={prefillBroj}
        onSaved={() => { loadOrders(); loadGaps(); setPrefillBroj(undefined); }}
      />

      <RacunDetailDialog
        orderId={openId}
        redoslijed={visibleIds}
        korisnikId={korisnikId}
        onClose={zatvori}
        onNavigate={otvori}
        onChanged={loadOrders}
      />
    </div>
  );
}
