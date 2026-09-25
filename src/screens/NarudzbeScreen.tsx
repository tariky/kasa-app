import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Receipt, AlertTriangle, Plus, Paperclip, Search, X } from 'lucide-react';
import { Order } from '@/types';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';
import { Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import DodajRacunDialog from '@/components/DodajRacunDialog';
import { RacunDetailDialog } from '@/components/racuni/RacunDetailDialog';

type Filter = 'sve' | 'aktivni' | 'storno';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'sve', label: 'Sve' },
  { id: 'aktivni', label: 'Aktivni' },
  { id: 'storno', label: 'Storno' },
];

/** Status kao tačka + tekst — isti jezik kao stanje zalihe na listi artikala. */
function StatusDot({ refunded }: { refunded: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] font-medium leading-5 whitespace-nowrap">
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', refunded ? 'bg-rose-500' : 'bg-emerald-500')} />
      <span className={refunded ? 'text-rose-600' : 'text-slate-500'}>{refunded ? 'Storno' : 'Završen'}</span>
    </span>
  );
}


/** Pretraga računa: kupac, broj fiskalnog računa, ID, blagajnik i broj priloga. */
const poljaRacuna = (o: Order): PoljaPretrage => ({
  naziv: o.kupacNaziv ?? '',
  sifra: o.brojFiskalnogRacuna,
  dodatno: [String(o.id), o.brojFiskalnogRacuna, o.korisnikIme, o.prilogBroj].join(' '),
});

export default function NarudzbeScreen({ korisnikId }: { korisnikId: number }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');
  const [dodajOpen, setDodajOpen] = useState(false);
  const [gaps, setGaps] = useState<number[]>([]);
  const [prefillBroj, setPrefillBroj] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const trazeni = useMemo(() => filtriraj(orders, search, poljaRacuna), [orders, search]);

  const visible = useMemo(() => {
    if (filter === 'aktivni') return trazeni.filter(o => o.status === 'completed');
    if (filter === 'storno') return trazeni.filter(o => o.status === 'refunded');
    return trazeni;
  }, [trazeni, filter]);
  const visibleIds = useMemo(() => visible.map(o => o.id), [visible]);

  // Brojači idu po pretrazi, da se vidi ima li šta iza filtera.
  const counts = useMemo(() => ({
    sve: trazeni.length,
    aktivni: trazeni.filter(o => o.status === 'completed').length,
    storno: trazeni.filter(o => o.status === 'refunded').length,
  }), [trazeni]);

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
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (t === searchRef.current) {
          if (e.key === 'Escape') { setSearch(''); t.blur(); }
          // ↓ iz pretrage vodi pravo na prvi pronađeni račun.
          if (e.key === 'ArrowDown' && visible.length > 0) { e.preventDefault(); focusRow(0); }
        }
        return;
      }
      if (t && t.closest('[role="combobox"], [role="listbox"]')) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setDodajOpen(true); return; }

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
  }, [anyDialogOpen, filter, selectedId, selIndex, focusRow, visible.length]);

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Traka: pretraga, filter, akcije ── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight mr-1">Računi</h2>
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Broj, fiskalni broj, kupac ili kasir…"
            aria-label="Pretraga računa"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadOrders(); loadGaps(); }} className="h-8 gap-1.5 text-[12px]">
            <RefreshCw className="h-3.5 w-3.5" />
            Osvježi
          </Button>
          <Button size="sm" onClick={() => setDodajOpen(true)} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Dodaj račun <Key tone="dark">N</Key>
          </Button>
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50/70 px-6 py-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <p className="text-[12px] font-semibold text-amber-800">
              Nedostaju fiskalni brojevi u nizu — mogući neupisani računi
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
                  aria-label={`Zanemari #${n}`}
                  onClick={async () => { await window.api.dismissFiscalGap(n); loadGaps(); }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Lista ── */}
      {visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
            <Receipt size={20} className="text-slate-300" strokeWidth={1.5} />
          </div>
          <p className="text-[13px] font-medium text-slate-500">
            {search.trim() ? 'Nema rezultata pretrage' : filter === 'sve' ? 'Još nema računa' : 'Nema računa u ovom filteru'}
          </p>
          <p className="text-[12px] text-slate-400 mt-0.5">
            {search.trim()
              ? 'Pokušaj drugi broj ili naziv kupca.'
              : filter === 'sve'
                ? <>Naplaćeni računi se pojavljuju ovdje; ručno ih dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</>
                : 'Promijeni filter da vidiš ostale.'}
          </p>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead
                columns={[
                  { label: '#', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
                  { label: 'Datum', className: 'text-left px-3 w-[1%] whitespace-nowrap' },
                  { label: 'Fiskalni br.', className: 'text-left px-3 w-[1%] whitespace-nowrap' },
                  { label: 'Kupac', className: 'text-left px-3' },
                  { label: 'Kasir', className: 'text-left px-3 w-[150px] hidden lg:table-cell' },
                  { label: 'Ukupno', className: 'text-right px-3 w-[130px]' },
                  { label: 'Status', className: 'text-left pl-3 pr-6 w-[1%] whitespace-nowrap' },
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
                        'group cursor-pointer transition-colors',
                        'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                        selected ? 'bg-blue-50/80' : 'hover:bg-slate-50',
                      )}
                      onClick={() => otvori(order.id)}
                      onFocus={() => setSelectedId(order.id)}
                    >
                      <td
                        className={cn(
                          td, 'pl-6 pr-3 font-mono text-[12px] tabular-nums whitespace-nowrap',
                          // Šina lijevo označava isključivo izabrani red — status ide kroz tačku i iznos.
                          selected ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-400',
                        )}
                      >
                        {order.id}
                      </td>
                      <td className={cn(td, 'px-3 text-[12px] tabular-nums whitespace-nowrap', selected ? 'text-slate-700' : 'text-slate-500')}>
                        {formatDateTime(order.createdAt)}
                      </td>
                      <td className={cn(td, 'px-3 whitespace-nowrap')}>
                        <span className="flex items-center gap-1.5">
                          <span className={cn('font-mono text-[12px] tabular-nums', selected ? 'text-slate-700' : 'text-slate-400')}>
                            {order.brojFiskalnogRacuna || <span className="text-slate-200">—</span>}
                          </span>
                          {/* isManual dolazi kao INTEGER 0/1 — bez Boolean() bi se `0` ispisala u redu. */}
                          {Boolean(order.isManual) && (
                            <span className="rounded px-1.5 py-px font-mono text-[9.5px] font-semibold bg-amber-50 text-amber-600 border border-amber-200" title="Ručno unesen">
                              R
                            </span>
                          )}
                          {order.prilogBroj != null && (
                            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-px font-mono text-[9.5px] font-semibold bg-slate-50 text-slate-500 border border-slate-200" title={`Faktura br. ${order.prilogBroj}`}>
                              <Paperclip size={8} />{order.prilogBroj}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={cn(td, 'px-3 max-w-0')}>
                        {order.kupacNaziv
                          ? <span className="block truncate text-[12.5px] font-medium text-slate-800">{order.kupacNaziv}</span>
                          : <span className="text-slate-200">—</span>}
                        {order.korisnikIme && <span className="lg:hidden block text-[10.5px] text-slate-400 truncate">{order.korisnikIme}</span>}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell px-3 text-[12px] max-w-0', selected ? 'text-slate-700' : 'text-slate-500')}>
                        <span className="block truncate">{order.korisnikIme || <span className="text-slate-200">—</span>}</span>
                      </td>
                      <td className={cn(
                        td, 'px-3 text-right font-mono text-[12.5px] font-semibold tabular-nums whitespace-nowrap',
                        refunded ? 'text-rose-600' : 'text-slate-800',
                      )}>
                        {formatKM(order.ukupno)}
                      </td>
                      <td className={cn(td, 'pl-3 pr-6')}>
                        <StatusDot refunded={refunded} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>

          {/* Legenda prečica — tastatura je vidljiva, ne skrivena funkcija */}
          <div className="flex-shrink-0 border-t border-slate-200/80 px-6 h-9 flex items-center gap-3 text-[10.5px] text-slate-400 select-none">
            <span className="font-mono tabular-nums">{selIndex >= 0 ? `${selIndex + 1} / ${visible.length}` : `${visible.length}`}</span>
            <span className="text-slate-300">·</span>
            <span className="hidden sm:flex items-center gap-3">
              <span className="flex items-center gap-1"><Key className="ml-0">↑↓</Key> odaberi</span>
              <span className="flex items-center gap-1"><Key className="ml-0">↵</Key> otvori</span>
              <span className="flex items-center gap-1"><Key className="ml-0">←→</Key> filter</span>
              <span className="flex items-center gap-1"><Key className="ml-0">/</Key> pretraga</span>
            </span>
          </div>
        </>
      )}

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
