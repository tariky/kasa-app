import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  RefreshCw, Receipt, AlertTriangle, Printer, Download, Undo2, Truck,
  CreditCard, Banknote, KeyRound, Plus, Paperclip, CornerDownLeft, ChevronsUpDown, CalendarClock,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { RacunPdf, InvoiceLang } from '@/components/RacunPdf';
import { OtpremnicaPdf } from '@/components/OtpremnicaPdf';
import { PrilogPdf } from '@/components/PrilogPdf';
import { Order, OrderItem } from '@/types';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import { ActionRow, Eyebrow, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import { DatePicker } from '@/components/ui/date-picker';
import DodajRacunDialog from '@/components/DodajRacunDialog';
import CashMovementDialog from '@/components/CashMovementDialog';
import PrilogStavkeDialog from '@/components/PrilogStavkeDialog';
import { gotovinskiIznos } from '@/lib/drawer';
import { prilogKompletan, sumaPriloga } from '@/lib/prilog';
import { formatDatumValute } from '@/lib/valuta';
import { round2 } from '@/lib/novac';

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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');
  const [lang, setLang] = useState<InvoiceLang>('bs');
  const [reklamacijaOpen, setReklamacijaOpen] = useState(false);
  const [reklamacijaBroj, setReklamacijaBroj] = useState('');
  const [reklamacijaLoading, setReklamacijaLoading] = useState(false);
  const [reklamacijaMsg, setReklamacijaMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [requirePinRefund, setRequirePinRefund] = useState(false);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [dodajOpen, setDodajOpen] = useState(false);
  const [drawerWarning, setDrawerWarning] = useState<{ stanje: number; potrebno: number } | null>(null);
  const [pologOpen, setPologOpen] = useState(false);
  // Printer je odbio gotovinski storno zbog prazne ladice — operater može
  // svjesno pregaziti stanje (manjak se evidentira kao polog).
  const [overrideManjak, setOverrideManjak] = useState<number | null>(null);
  const [gaps, setGaps] = useState<number[]>([]);
  const [prefillBroj, setPrefillBroj] = useState<string | undefined>(undefined);
  const [prilogOpen, setPrilogOpen] = useState(false);
  const [valutaOpen, setValutaOpen] = useState(false);
  const [valutaDatum, setValutaDatum] = useState('');
  const [valutaError, setValutaError] = useState('');

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    loadOrders();
    loadGaps();
    window.api.getSetting('kasa.requirePinRefund').then((v) => setRequirePinRefund(v === 'true'));
  }, []);

  const loadOrders = async () => {
    const data = await window.api.getOrders();
    setOrders(data);
  };

  const loadGaps = async () => {
    setGaps(await window.api.getFiscalGaps());
  };

  const handleSelectOrder = async (order: Order) => {
    const fullOrder = await window.api.getOrder(order.id);
    setSelectedOrder(fullOrder);
  };

  // Tring zahtijeva evidentiranu gotovinu prije gotovinske reklamacije —
  // upozorenje (ne blokada) kad očekivano stanje ladice ne pokriva povrat.
  useEffect(() => {
    setDrawerWarning(null);
    setOverrideManjak(null);
    if (!reklamacijaOpen || !selectedOrder) return;
    const potrebno = gotovinskiIznos(selectedOrder.nacinPlacanja, selectedOrder.ukupno);
    if (potrebno <= 0) return;
    window.api.getDrawerState()
      .then(s => { if (s.ocekivanoStanje < potrebno) setDrawerWarning({ stanje: s.ocekivanoStanje, potrebno }); })
      .catch(() => { /* informativno */ });
  }, [reklamacijaOpen, selectedOrder, pologOpen]);

  const handleReklamacija = async (dozvoliPolog = false) => {
    if (!selectedOrder || !selectedOrder.brojFiskalnogRacuna) return;

    if (reklamacijaLoading) return;
    setReklamacijaLoading(true);
    setReklamacijaMsg(null);
    if (dozvoliPolog) setOverrideManjak(null);
    try {
      // Štampa i upis storna idu kroz jedan poziv da ne ostane odštampana
      // reklamacija bez zapisa u bazi ako nešto pukne između.
      const result = await window.api.refundAndPrintOrder({
        id: selectedOrder.id,
        brojReklamacije: reklamacijaBroj.trim() || undefined,
        dozvoliPolog,
        korisnikId,
      });

      if (!result || !result.success) {
        const details = result?.odgovori ? Object.entries(result.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setReklamacijaMsg({ type: 'error', text: `Greška: ${result?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
        // Prazna ladica nije razlog da se storno ne može napraviti — operateru
        // se ponudi override koji manjak evidentira kao polog i ponovi štampu.
        setOverrideManjak(result?.nedovoljnoSredstava ? (result.manjak ?? 0) : null);
        return;
      }

      setReklamacijaOpen(false);
      setReklamacijaBroj('');
      setOverrideManjak(null);
      setReklamacijaMsg({
        type: 'success',
        text: `Reklamacija #${result.brojReklamacije ?? ''} uspješno kreirana`
          + (result.pologIznos ? ` (evidentiran polog ${formatKM(result.pologIznos)})` : ''),
      });
      await loadOrders();

      // getOrders vraća samo zaglavlja — detalj mora ponovo učitati stavke.
      const refreshed = await window.api.getOrder(selectedOrder.id);
      if (refreshed) setSelectedOrder(refreshed);
    } catch (err: any) {
      console.error('Reklamacija error:', err);
      setReklamacijaMsg({ type: 'error', text: `Greška: ${err?.message || 'Nepoznata greška'}` });
    } finally {
      setReklamacijaLoading(false);
    }
  };

  /**
   * Datum valute nije dio fiskalnog zapisa — dogovara se s kupcem naknadno, pa
   * se smije mijenjati i uklanjati na svakom računu, uključujući stornirane.
   * Vidljiv je samo na A4 kopiji računa.
   */
  const openValuta = (order: Order) => {
    setValutaDatum(order.datumValute || '');
    setValutaError('');
    setValutaOpen(true);
  };

  const spremiValutu = async (datum: string | null) => {
    if (!selectedOrder) return;
    try {
      await window.api.setOrderDatumValute(selectedOrder.id, datum);
      setValutaOpen(false);
      setSelectedOrder({ ...selectedOrder, datumValute: datum });
      setOrders(prev => prev.map(o => (o.id === selectedOrder.id ? { ...o, datumValute: datum } : o)));
    } catch (err: any) {
      setValutaError(err?.message || 'Greška pri spremanju datuma valute');
    }
  };

  const parseNacinPlacanjaLabel = (json: string): string => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.gotovina && parsed.kartica) return `Gotovina ${formatKM(parsed.gotovina)} · Kartica ${formatKM(parsed.kartica)}`;
      if (parsed.gotovina) return `Gotovina ${formatKM(parsed.gotovina)}`;
      if (parsed.kartica) return `Kartica ${formatKM(parsed.kartica)}`;
      return json;
    } catch {
      return json;
    }
  };

  const getPaymentIcon = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.kartica && parsed.gotovina) return <><Banknote size={12} className="text-slate-400" /><CreditCard size={12} className="text-slate-400" /></>;
      if (parsed.kartica) return <CreditCard size={12} className="text-slate-400" />;
      return <Banknote size={12} className="text-slate-400" />;
    } catch {
      return <Banknote size={12} className="text-slate-400" />;
    }
  };

  const loadFirma = async () => {
    try {
      return await window.api.getFirmaSettings();
    } catch {
      return { naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', logo: '', bankAccounts: [] };
    }
  };

  const handlePrintPdf = async (order: Order, l: InvoiceLang = 'bs') => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<RacunPdf order={fullOrder} firma={firma} lang={l} />).toBlob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };

  const handleExportPdf = async (order: Order, l: InvoiceLang = 'bs') => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<RacunPdf order={fullOrder} firma={firma} lang={l} />).toBlob();
    const prefix = l === 'en' ? 'Invoice' : 'Racun';
    const fileName = `${prefix}-${order.brojFiskalnogRacuna || order.id}.pdf`;
    const savePath = await window.api.showSaveDialog({
      defaultName: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return;
    const arrayBuffer = await blob.arrayBuffer();
    await window.api.writeFile(savePath, Array.from(new Uint8Array(arrayBuffer)) as any);
  };

  /**
   * Štampa A4 priloga uz fiskalni račun. Dozvoljena samo kad se suma dodijeljenih
   * stavki poklopi sa fiskalnim iznosom — nepotpun prilog bi
   * pokazivala manji iznos od onog koji je fiskalizovan.
   */
  const handlePrintPrilog = async (order: Order) => {
    setReklamacijaMsg(null);
    try {
      const stavke = await window.api.getPrilogStavke(order.id);
      if (!prilogKompletan(order.ukupno, stavke as any)) {
        setReklamacijaMsg({
          type: 'error',
          text: `Suma stavki priloga (${formatKM(sumaPriloga(stavke as any))}) se ne poklapa sa fiskalnim iznosom ` +
            `(${formatKM(order.ukupno)}) — dopunite prilog prije štampe.`,
        });
        return;
      }
      const firma = await loadFirma();
      const blob = await pdf(<PrilogPdf order={order} firma={firma} stavke={stavke as any} />).toBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) win.onafterprint = () => URL.revokeObjectURL(url);
    } catch (err: any) {
      setReklamacijaMsg({ type: 'error', text: `Greška pri štampanju priloga: ${err?.message || 'Nepoznata greška'}` });
    }
  };

  const handlePrintOtpremnica = async (order: Order) => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<OtpremnicaPdf order={fullOrder} firma={firma} />).toBlob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };

  const handleExportOtpremnica = async (order: Order) => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<OtpremnicaPdf order={fullOrder} firma={firma} />).toBlob();
    const fileName = `Otpremnica-${order.brojFiskalnogRacuna || order.id}.pdf`;
    const savePath = await window.api.showSaveDialog({
      defaultName: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return;
    const arrayBuffer = await blob.arrayBuffer();
    await window.api.writeFile(savePath, Array.from(new Uint8Array(arrayBuffer)) as any);
  };

  const openReklamacija = useCallback(() => {
    setReklamacijaMsg(null);
    if (requirePinRefund) {
      setPinValue('');
      setPinError('');
      setPinDialogOpen(true);
    } else {
      setReklamacijaOpen(true);
    }
  }, [requirePinRefund]);

  const isRefunded = (status: Order['status']) => status === 'refunded';

  const visible = useMemo(() => {
    if (filter === 'aktivni') return orders.filter(o => o.status === 'completed');
    if (filter === 'storno') return orders.filter(o => o.status === 'refunded');
    return orders;
  }, [orders, filter]);

  const counts = useMemo(() => ({
    sve: orders.length,
    aktivni: orders.filter(o => o.status === 'completed').length,
    storno: orders.filter(o => o.status === 'refunded').length,
  }), [orders]);

  const selIndex = visible.findIndex(o => o.id === selectedOrder?.id);

  /** Pomjera izbor u listi i drži fokus na redu — osnova za tastaturnu navigaciju. */
  const focusRow = useCallback((index: number) => {
    if (index < 0 || index >= visible.length) return;
    handleSelectOrder(visible[index]);
    const el = rowRefs.current[index];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  }, [visible]);

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
      case 'Enter':
        if (selectedOrder) { e.preventDefault(); handlePrintPdf(selectedOrder, lang); }
        return;
      default:
    }
  };

  const anyDialogOpen = reklamacijaOpen || pinDialogOpen || dodajOpen || prilogOpen || pologOpen || valutaOpen;

  // Prečice za akcije desnog panela. Vrijede samo kad je račun izabran, nijedan
  // dijalog nije otvoren i fokus nije u polju za unos.
  useEffect(() => {
    if (!selectedOrder || anyDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      switch (e.key.toLowerCase()) {
        case 'p': e.preventDefault(); handlePrintPdf(selectedOrder, lang); break;
        case 's': e.preventDefault(); handleExportPdf(selectedOrder, lang); break;
        case 'o': e.preventDefault(); handlePrintOtpremnica(selectedOrder); break;
        case 'v': e.preventDefault(); openValuta(selectedOrder); break;
        case 'r':
          if (selectedOrder.status === 'completed' && selectedOrder.brojFiskalnogRacuna) {
            e.preventDefault();
            openReklamacija();
          }
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedOrder, lang, anyDialogOpen, openReklamacija]);

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
      <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">

        {/* ── Ledger ── */}
        <div className="flex-1 min-w-0">
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
                        { label: 'Kasir', className: 'text-left px-2' },
                        { label: 'Fiskalni br.', className: 'text-left px-2' },
                        { label: 'Ukupno', className: 'text-right px-2' },
                        { label: 'Status', className: 'text-right pr-5 pl-2 w-[100px]' },
                      ]}
                    />
                    <tbody onKeyDown={handleListKeyDown}>
                      {visible.map((order, i) => {
                        const refunded = isRefunded(order.status);
                        const selected = selectedOrder?.id === order.id;
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
                            onClick={() => { handleSelectOrder(order); rowRefs.current[i]?.focus(); }}
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
                            <td className={cn('px-2 py-2.5 border-b border-slate-100 text-[12px]', selected ? 'text-slate-700' : 'text-slate-500')}>
                              {order.korisnikIme || '—'}
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
                                  <span className="inline-flex h-4 items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[9px] font-semibold text-slate-500" title={`Prilog br. ${order.prilogBroj}`}>
                                    <Paperclip size={8} />{order.prilogBroj}
                                  </span>
                                )}
                              </div>
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
                <div className="flex-shrink-0 flex items-center gap-4 border-t border-slate-100 px-5 py-2 text-[10.5px] text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <ChevronsUpDown size={11} /> kretanje kroz listu
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CornerDownLeft size={11} /> štampa račun
                  </span>
                  <span className="ml-auto font-mono tabular-nums">
                    {selIndex >= 0 ? `${selIndex + 1} / ${visible.length}` : `${visible.length}`}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Detail / actions panel ── */}
        <div className="w-[380px] flex-shrink-0">
          {selectedOrder ? (
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">

              {/* Zaglavlje */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Eyebrow>{selectedOrder.prilogBroj != null ? 'Račun po prilogu' : 'Fiskalni račun'}</Eyebrow>
                    <h3 className="text-[19px] font-bold font-mono tracking-tight text-slate-900 leading-tight mt-1">
                      #{selectedOrder.brojFiskalnogRacuna || selectedOrder.id}
                    </h3>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums">
                      {formatDateTime(selectedOrder.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusChip refunded={isRefunded(selectedOrder.status)} size="md" />
                    {Boolean(selectedOrder.isManual) && (
                      <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">Ručno unesen</Badge>
                    )}
                    {selectedOrder.prilogBroj != null && (
                      <Badge variant="secondary" className="text-[10px]">Prilog br. {selectedOrder.prilogBroj}</Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta */}
              <div className="flex-shrink-0 px-5 pb-4">
                <dl className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-2 text-[12px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Kasir</dt>
                    <dd className="font-medium text-slate-700">{selectedOrder.korisnikIme || '—'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-slate-400">
                      {getPaymentIcon(selectedOrder.nacinPlacanja)} Plaćanje
                    </dt>
                    <dd className="font-medium text-slate-700 text-right">{parseNacinPlacanjaLabel(selectedOrder.nacinPlacanja)}</dd>
                  </div>
                  {selectedOrder.kupacNaziv && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-slate-400 flex-shrink-0">Kupac</dt>
                      <dd className="font-medium text-slate-700 text-right truncate">
                        {selectedOrder.kupacNaziv}
                        {selectedOrder.kupacIdBroj && (
                          <span className="ml-1.5 font-mono text-[10.5px] text-slate-400">{selectedOrder.kupacIdBroj}</span>
                        )}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-slate-400">
                      <CalendarClock size={12} className="text-slate-400" /> Valuta
                    </dt>
                    <dd>
                      <button
                        type="button"
                        onClick={() => openValuta(selectedOrder)}
                        title="Postavi datum valute (rok plaćanja) — V"
                        className={cn(
                          'rounded-md px-1.5 py-0.5 -mr-1.5 transition-colors hover:bg-slate-200/70',
                          selectedOrder.datumValute ? 'font-medium text-slate-700' : 'text-slate-400',
                        )}
                      >
                        {formatDatumValute(selectedOrder.datumValute) ?? 'Postavi'}
                      </button>
                    </dd>
                  </div>
                  {selectedOrder.brojReklamacije && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-rose-400">Reklamacija</dt>
                      <dd className="font-mono font-medium text-rose-500">{selectedOrder.brojReklamacije}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Stavke */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100">
                <div className="flex items-center justify-between px-5 py-2 bg-slate-50/40">
                  <Eyebrow>Stavke</Eyebrow>
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">
                    {(selectedOrder.stavke || []).length}
                  </span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="divide-y divide-slate-50">
                    {(selectedOrder.stavke || []).map((stavka: OrderItem, i: number) => {
                      const lineTotal = stavka.cijena * stavka.kolicina * (1 - (stavka.rabat || 0) / 100);
                      return (
                        <div key={stavka.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
                          <span className="text-[10px] text-slate-300 font-mono tabular-nums w-4 text-right flex-shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-slate-700 truncate">{stavka.productNaziv || `#${stavka.productId}`}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono tabular-nums">{stavka.kolicina} × {formatKM(stavka.cijena)}</span>
                              {(stavka.rabat || 0) > 0 && (
                                <span className="text-[9px] font-bold px-1 py-px rounded bg-blue-500/10 text-blue-600">-{stavka.rabat}%</span>
                              )}
                            </div>
                          </div>
                          <span className="text-[12.5px] font-mono font-semibold text-slate-800 tabular-nums flex-shrink-0">
                            {formatKM(lineTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Iznos */}
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-slate-400">Osnovica</span>
                  <span className="font-mono tabular-nums text-slate-600">{formatKM(selectedOrder.ukupno - selectedOrder.pdvIznos)}</span>
                </div>
                <div className="flex items-center justify-between text-[11.5px] mt-1">
                  <span className="text-slate-400">PDV (17%)</span>
                  <span className="font-mono tabular-nums text-slate-600">{formatKM(selectedOrder.pdvIznos)}</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-baseline justify-between">
                  <span className="text-[12.5px] font-semibold text-slate-800">Ukupno</span>
                  <span className="text-[22px] font-bold font-mono tabular-nums tracking-tight text-slate-900">
                    {formatKM(selectedOrder.ukupno)}
                  </span>
                </div>
              </div>

              {/* Akcije — po dokumentu koji proizvode */}
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3.5 space-y-2">
                <div className="flex items-center justify-between pb-0.5">
                  <Eyebrow>Jezik dokumenta</Eyebrow>
                  <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                    {(['bs', 'en'] as InvoiceLang[]).map(l => (
                      <button
                        key={l}
                        onClick={() => setLang(l)}
                        className={cn(
                          'rounded-[6px] px-2.5 h-6 font-mono text-[10.5px] font-semibold uppercase transition-colors duration-150',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                          lang === l ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600',
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <ActionRow
                  icon={Printer}
                  label="Štampaj račun"
                  hint="P"
                  tone="primary"
                  onClick={() => handlePrintPdf(selectedOrder, lang)}
                  trailing={{ icon: Download, onClick: () => handleExportPdf(selectedOrder, lang), title: `Spremi račun kao PDF (${lang.toUpperCase()}) — S` }}
                />

                <ActionRow
                  icon={Truck}
                  label="Otpremnica"
                  hint="O"
                  onClick={() => handlePrintOtpremnica(selectedOrder)}
                  trailing={{ icon: Download, onClick: () => handleExportOtpremnica(selectedOrder), title: 'Spremi otpremnicu kao PDF' }}
                />

                {selectedOrder.prilogBroj != null && (
                  <ActionRow
                    icon={Paperclip}
                    label="Uredi prilog"
                    onClick={() => setPrilogOpen(true)}
                    trailing={{ icon: Printer, onClick: () => handlePrintPrilog(selectedOrder), title: 'Štampaj A4 prilog uz fiskalni račun' }}
                  />
                )}

                {reklamacijaMsg && !reklamacijaOpen && (
                  <div className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] font-medium',
                    reklamacijaMsg.type === 'error'
                      ? 'bg-rose-50 border border-rose-100 text-rose-600'
                      : 'bg-emerald-50 border border-emerald-100 text-emerald-600',
                  )}>
                    {reklamacijaMsg.type === 'error'
                      ? <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                      : <Receipt size={12} className="mt-0.5 flex-shrink-0" />}
                    {reklamacijaMsg.text}
                  </div>
                )}

                {selectedOrder.status === 'completed' && selectedOrder.brojFiskalnogRacuna && (
                  <div className="pt-2 mt-1 border-t border-slate-100">
                    <ActionRow
                      icon={Undo2}
                      label="Reklamacija"
                      hint="R"
                      tone="danger"
                      onClick={openReklamacija}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col items-center justify-center px-8 text-center select-none">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <Receipt size={20} className="text-slate-300" strokeWidth={1.5} />
              </div>
              <p className="text-[13px] font-medium text-slate-500">Odaberite račun</p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Kliknite red ili se krećite strelicama — detalji i akcije se pojavljuju ovdje.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Reklamacija Dialog ── */}
      <Dialog open={reklamacijaOpen} onOpenChange={setReklamacijaOpen}>
        <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                  <Undo2 className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">Reklamacija #{selectedOrder?.id}</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Povratni fiskalni račun — nepovratan proces
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <Separator />

          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start gap-3 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-rose-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-rose-700">Pažnja: Ova akcija je nepovratna</p>
                <p className="text-[11px] text-rose-600/70 mt-0.5">
                  Povratni račun će biti automatski odštampan na Tring fiskalnom printeru. Provjerite da je printer uključen.
                </p>
              </div>
            </div>

            {drawerWarning && (
              <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
                <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-amber-700">
                    U kasi nema dovoljno evidentirane gotovine za povrat
                  </p>
                  <p className="text-[11px] text-amber-600/70 mt-0.5">
                    Očekivano stanje je {formatKM(drawerWarning.stanje)}, a povrat traži {formatKM(drawerWarning.potrebno)}.
                    Tring zahtijeva unos novca prije gotovinske reklamacije — printer može odbiti štampu.
                    Možeš unijeti polog ručno ili pregaziti stanje: manjak se tada automatski
                    evidentira kao polog i storno prolazi.
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Button
                      variant="outline" size="sm" className="h-7 text-[11px] border-amber-200 text-amber-700"
                      onClick={() => setPologOpen(true)}
                    >
                      Unesi polog
                    </Button>
                    <Button
                      variant="outline" size="sm" className="h-7 text-[11px] border-amber-300 text-amber-700"
                      disabled={reklamacijaLoading}
                      onClick={() => handleReklamacija(true)}
                    >
                      Reklamiraj uz polog {formatKM(round2(drawerWarning.potrebno - drawerWarning.stanje))}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reklamacija-broj" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Broj fiskalnog za reklamaciju (opcionalno)
              </Label>
              <Input
                id="reklamacija-broj"
                value={reklamacijaBroj}
                onChange={(e) => setReklamacijaBroj(e.target.value)}
                placeholder="Unesite broj fiskalnog računa"
                className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
              />
            </div>
          </div>

          {reklamacijaMsg && (
            <div className={cn(
              'mx-6 mb-2 flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-medium',
              reklamacijaMsg.type === 'error'
                ? 'bg-rose-50/60 border border-rose-100 text-rose-600'
                : 'bg-emerald-50/60 border border-emerald-100 text-emerald-600',
            )}>
              {reklamacijaMsg.type === 'error' ? <AlertTriangle size={14} /> : <Receipt size={14} />}
              {reklamacijaMsg.text}
            </div>
          )}

          {overrideManjak !== null && (
            <div className="mx-6 mb-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="text-[12px] font-semibold text-amber-700">
                Printer je odbio storno zbog stanja kase
              </p>
              <p className="text-[11px] text-amber-600/80 mt-0.5">
                Za povrat fali {formatKM(overrideManjak)}. Možeš pregaziti stanje kase — taj iznos
                će biti evidentiran kao polog (i na printeru i u evidenciji ladice), pa se
                reklamacija odmah ponovo štampa.
              </p>
              <Button
                variant="outline" size="sm" className="h-7 mt-2 text-[11px] border-amber-300 text-amber-700"
                disabled={reklamacijaLoading}
                onClick={() => handleReklamacija(true)}
              >
                Ipak reklamiraj (polog {formatKM(overrideManjak)})
              </Button>
            </div>
          )}

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setReklamacijaOpen(false)}>
              Otkaži
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleReklamacija()}
              disabled={reklamacijaLoading}
              className="min-w-[140px]"
            >
              {reklamacijaLoading ? 'Obrađujem...' : 'Potvrdi reklamaciju'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PIN Verification Dialog ── */}
      <Dialog open={pinDialogOpen} onOpenChange={setPinDialogOpen}>
        <DialogContent className="sm:max-w-[360px] p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <KeyRound className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">Admin autorizacija</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Unesite admin PIN za nastavak
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <Separator />
          <div className="px-6 py-5 space-y-3">
            <Input
              type="password"
              value={pinValue}
              onChange={e => { setPinValue(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              onKeyDown={async e => {
                if (e.key === 'Enter' && pinValue.length >= 4) {
                  try {
                    await window.api.verifyAdminPin(pinValue);
                    setPinDialogOpen(false);
                    setReklamacijaOpen(true);
                  } catch {
                    setPinError('Neispravan admin PIN');
                  }
                }
              }}
              placeholder="PIN"
              maxLength={8}
              inputMode="numeric"
              className="font-mono text-center text-xl h-12 tracking-[0.3em] bg-slate-50 border-slate-200"
              autoFocus
            />
            {pinError && (
              <p className="text-[12px] text-rose-500 font-medium text-center">{pinError}</p>
            )}
          </div>
          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setPinDialogOpen(false)}>
              Otkaži
            </Button>
            <Button
              onClick={async () => {
                try {
                  await window.api.verifyAdminPin(pinValue);
                  setPinDialogOpen(false);
                  setReklamacijaOpen(true);
                } catch {
                  setPinError('Neispravan admin PIN');
                }
              }}
              disabled={pinValue.length < 4}
            >
              Potvrdi
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Datum valute Dialog ── */}
      <Dialog open={valutaOpen} onOpenChange={setValutaOpen}>
        <DialogContent className="sm:max-w-[380px] p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <CalendarClock className="h-5 w-5 text-slate-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">Datum valute</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Rok plaćanja za račun #{selectedOrder?.brojFiskalnogRacuna || selectedOrder?.id}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <Separator />

          <div className="px-6 py-5 space-y-3">
            <DatePicker
              value={valutaDatum}
              onChange={(v) => { setValutaDatum(v); setValutaError(''); }}
              className="h-9 text-[13px] w-full"
            />
            <p className="text-[11px] text-slate-400">
              Prikazuje se samo na A4 kopiji računa — fiskalni zapis ostaje netaknut.
            </p>
            {valutaError && <p className="text-[11.5px] text-rose-500">{valutaError}</p>}
          </div>

          <Separator />

          <div className="px-6 py-4 flex items-center justify-between gap-2">
            <Button
              variant="ghost" size="sm"
              className="text-[12px] text-slate-500 hover:text-rose-600"
              disabled={!selectedOrder?.datumValute}
              onClick={() => spremiValutu(null)}
            >
              Ukloni
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="text-[12px]" onClick={() => setValutaOpen(false)}>
                Odustani
              </Button>
              <Button
                size="sm" className="text-[12px]"
                disabled={!valutaDatum}
                onClick={() => spremiValutu(valutaDatum)}
              >
                Spremi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dodaj račun ručno Dialog ── */}
      <DodajRacunDialog
        open={dodajOpen}
        onOpenChange={(v) => { setDodajOpen(v); if (!v) setPrefillBroj(undefined); }}
        korisnikId={korisnikId}
        prefillBroj={prefillBroj}
        onSaved={() => { loadOrders(); loadGaps(); setPrefillBroj(undefined); }}
      />

      {/* ── Stavke priloga ── */}
      {selectedOrder && selectedOrder.prilogBroj != null && (
        <PrilogStavkeDialog
          open={prilogOpen}
          onOpenChange={setPrilogOpen}
          order={selectedOrder}
          onSaved={async () => {
            await loadOrders();
            const refreshed = await window.api.getOrder(selectedOrder.id);
            if (refreshed) setSelectedOrder(refreshed);
          }}
        />
      )}

      {/* Polog prije gotovinske reklamacije kad u ladici nema dovoljno */}
      <CashMovementDialog
        open={pologOpen}
        tip="polog"
        korisnikId={korisnikId}
        suggested={drawerWarning ? round2(drawerWarning.potrebno - drawerWarning.stanje) : undefined}
        onClose={() => setPologOpen(false)}
      />
    </div>
  );
}
