import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  RotateCcw, Receipt, AlertTriangle, Printer, Download,
  User, Hash, CreditCard, Banknote, Building2, ChevronRight, KeyRound, Plus,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { RacunPdf, InvoiceLang } from '@/components/RacunPdf';
import { OtpremnicaPdf } from '@/components/OtpremnicaPdf';
import { Order, OrderItem } from '@/types';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import DodajRacunDialog from '@/components/DodajRacunDialog';
import CashMovementDialog from '@/components/CashMovementDialog';
import { gotovinskiIznos } from '@/lib/drawer';
import { round2 } from '@/lib/novac';

export default function NarudzbeScreen({ korisnikId }: { korisnikId: number }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
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
  const [gaps, setGaps] = useState<number[]>([]);
  const [prefillBroj, setPrefillBroj] = useState<string | undefined>(undefined);

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
    if (!reklamacijaOpen || !selectedOrder) return;
    const potrebno = gotovinskiIznos(selectedOrder.nacinPlacanja, selectedOrder.ukupno);
    if (potrebno <= 0) return;
    window.api.getDrawerState()
      .then(s => { if (s.ocekivanoStanje < potrebno) setDrawerWarning({ stanje: s.ocekivanoStanje, potrebno }); })
      .catch(() => { /* informativno */ });
  }, [reklamacijaOpen, selectedOrder, pologOpen]);

  const handleReklamacija = async () => {
    if (!selectedOrder || !selectedOrder.brojFiskalnogRacuna) return;

    if (reklamacijaLoading) return;
    setReklamacijaLoading(true);
    setReklamacijaMsg(null);
    try {
      // Štampa i upis storna idu kroz jedan poziv da ne ostane odštampana
      // reklamacija bez zapisa u bazi ako nešto pukne između.
      const result = await window.api.refundAndPrintOrder({
        id: selectedOrder.id,
        brojReklamacije: reklamacijaBroj.trim() || undefined,
      });

      if (!result || !result.success) {
        const details = result?.odgovori ? Object.entries(result.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setReklamacijaMsg({ type: 'error', text: `Greška: ${result?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
        return;
      }

      setReklamacijaOpen(false);
      setReklamacijaBroj('');
      setReklamacijaMsg({ type: 'success', text: `Reklamacija #${result.brojReklamacije ?? ''} uspješno kreirana` });
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

  const parseNacinPlacanja = (json: string): { gotovina?: number; kartica?: number; virman?: boolean; raw?: string } => {
    try {
      const parsed = JSON.parse(json);
      return parsed;
    } catch {
      return { raw: json };
    }
  };

  const parseNacinPlacanjaLabel = (json: string): string => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.gotovina && parsed.kartica) return `Gotovina: ${formatKM(parsed.gotovina)}, Kartica: ${formatKM(parsed.kartica)}`;
      if (parsed.gotovina) return `Gotovina: ${formatKM(parsed.gotovina)}`;
      if (parsed.kartica) return `Kartica: ${formatKM(parsed.kartica)}`;
      return json;
    } catch {
      return json;
    }
  };

  const getPaymentIcon = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed.kartica && parsed.gotovina) return <><Banknote size={13} className="text-slate-400" /><CreditCard size={13} className="text-slate-400" /></>;
      if (parsed.kartica) return <CreditCard size={13} className="text-slate-400" />;
      return <Banknote size={13} className="text-slate-400" />;
    } catch {
      return <Banknote size={13} className="text-slate-400" />;
    }
  };

  const loadFirma = async () => {
    try {
      return await window.api.getFirmaSettings();
    } catch {
      return { naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', logo: '', bankAccounts: [] };
    }
  };

  const handlePrintPdf = async (order: Order, lang: InvoiceLang = 'bs') => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<RacunPdf order={fullOrder} firma={firma} lang={lang} />).toBlob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };

  const handleExportPdf = async (order: Order, lang: InvoiceLang = 'bs') => {
    const fullOrder = order.stavke ? order : await window.api.getOrder(order.id);
    const firma = await loadFirma();
    const blob = await pdf(<RacunPdf order={fullOrder} firma={firma} lang={lang} />).toBlob();
    const prefix = lang === 'en' ? 'Invoice' : 'Racun';
    const fileName = `${prefix}-${order.brojFiskalnogRacuna || order.id}.pdf`;
    const savePath = await window.api.showSaveDialog({
      defaultName: fileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return;
    const arrayBuffer = await blob.arrayBuffer();
    await window.api.writeFile(savePath, Array.from(new Uint8Array(arrayBuffer)) as any);
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

  const isRefunded = (status: Order['status']) => status === 'refunded';

  const completedOrders = orders.filter(o => o.status === 'completed');
  const refundedOrders = orders.filter(o => o.status === 'refunded');

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold text-slate-800">Računi</span>
            {orders.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                {orders.length}
              </Badge>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadOrders} className="h-8 gap-1.5 text-[12px]">
            <RotateCcw className="h-3.5 w-3.5" />
            Osvježi
          </Button>
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="mx-4 mb-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            Nedostaju fiskalni brojevi u nizu — mogući neupisani računi:
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {gaps.map(n => (
              <div key={n} className="flex items-center gap-1">
                <Button
                  variant="outline" size="sm"
                  className="h-7 text-amber-700 border-amber-400"
                  onClick={() => { setPrefillBroj(String(n)); setDodajOpen(true); }}
                >
                  Unesi #{n}
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-7 text-slate-400"
                  onClick={async () => { await window.api.dismissFiscalGap(n); loadGaps(); }}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">

        {/* ── Left: Orders table ── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
            <div className="flex-shrink-0 flex justify-end px-4 pt-3 pb-1">
              <Button size="sm" onClick={() => setDodajOpen(true)} className="h-8 gap-1.5 text-[12px]">
                <Plus className="h-3.5 w-3.5" />
                Dodaj račun ručno
              </Button>
            </div>
            {orders.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <Receipt size={24} className="text-slate-300" />
                </div>
                <p className="text-[13px] font-medium text-slate-500">Nema računa</p>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                    <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="text-left pl-5 pr-2 py-2.5 w-[50px]">#</th>
                      <th className="text-left px-2 py-2.5">Datum</th>
                      <th className="text-left px-2 py-2.5">Kasir</th>
                      <th className="text-right px-2 py-2.5">Ukupno</th>
                      <th className="text-left px-2 py-2.5">Fiskalni br.</th>
                      <th className="text-center pr-5 pl-2 py-2.5 w-[90px]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const refunded = isRefunded(order.status);
                      const selected = selectedOrder?.id === order.id;
                      return (
                        <tr
                          key={order.id}
                          className={cn(
                            'border-t border-slate-50 transition-colors cursor-pointer',
                            selected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50/50',
                            refunded && !selected && 'bg-red-50/30',
                          )}
                          onClick={() => handleSelectOrder(order)}
                        >
                          <td className={cn('pl-5 pr-2 py-2.5 text-[12px] font-mono', selected ? 'text-white/60' : 'text-slate-400')}>{order.id}</td>
                          <td className={cn('px-2 py-2.5 text-[12px] tabular-nums', selected ? 'text-white/80' : 'text-slate-600')}>{formatDateTime(order.createdAt)}</td>
                          <td className={cn('px-2 py-2.5 text-[12px]', selected ? 'text-white/80' : 'text-slate-600')}>{order.korisnikIme || '—'}</td>
                          <td className={cn('px-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums', selected ? 'text-white' : 'text-slate-800')}>
                            {formatKM(order.ukupno)}
                          </td>
                          <td className={cn('px-2 py-2.5 text-[12px] font-mono', selected ? 'text-white/60' : 'text-slate-400')}>
                            {order.brojFiskalnogRacuna || '—'}
                            {order.isManual ? <Badge variant="outline" className="ml-1 text-amber-600 border-amber-400">R</Badge> : null}
                          </td>
                          <td className="pr-5 pl-2 py-2.5 text-center">
                            {refunded ? (
                              <span className={cn(
                                'inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5',
                                selected ? 'bg-white/10 text-red-300' : 'bg-red-50 text-red-500 border border-red-100'
                              )}>
                                <RotateCcw size={10} />
                                Storno
                              </span>
                            ) : (
                              <span className={cn(
                                'inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5',
                                selected ? 'bg-white/10 text-emerald-300' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                              )}>
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

        {/* ── Right: Detail panel ── */}
        <div className="w-[400px] flex-shrink-0">
          {selectedOrder ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">

              {/* ── Header: number + status ── */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center',
                        isRefunded(selectedOrder.status) ? 'bg-red-50' : 'bg-emerald-50'
                      )}>
                        <Receipt size={18} className={isRefunded(selectedOrder.status) ? 'text-red-500' : 'text-emerald-500'} />
                      </div>
                      <div>
                        <h3 className="text-[16px] font-bold text-slate-800 leading-tight">
                          Račun #{selectedOrder.brojFiskalnogRacuna || selectedOrder.id}
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {formatDateTime(selectedOrder.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedOrder?.isManual ? (
                      <Badge variant="outline" className="border-amber-400 text-amber-600">Ručno unesen</Badge>
                    ) : null}
                    {isRefunded(selectedOrder.status) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-500 border border-red-100 rounded-full px-2.5 py-1">
                        <RotateCcw size={10} />
                        Storno
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full px-2.5 py-1">
                        Završeno
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Meta info ── */}
              <div className="flex-shrink-0 px-5 pb-4">
                <div className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User size={13} className="text-slate-400" />
                      <span className="text-[11px] text-slate-400">Kasir</span>
                    </div>
                    <span className="text-[12px] font-medium text-slate-700">{selectedOrder.korisnikIme || '—'}</span>
                  </div>
                  {selectedOrder.brojFiskalnogRacuna && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Hash size={13} className="text-slate-400" />
                        <span className="text-[11px] text-slate-400">Fiskalni br.</span>
                      </div>
                      <span className="text-[12px] font-mono font-medium text-slate-700">{selectedOrder.brojFiskalnogRacuna}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getPaymentIcon(selectedOrder.nacinPlacanja)}
                      <span className="text-[11px] text-slate-400">Plaćanje</span>
                    </div>
                    <span className="text-[12px] font-medium text-slate-700">{parseNacinPlacanjaLabel(selectedOrder.nacinPlacanja)}</span>
                  </div>
                  {selectedOrder.kupacNaziv && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 size={13} className="text-slate-400" />
                        <span className="text-[11px] text-slate-400">Kupac</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[12px] font-medium text-slate-700">{selectedOrder.kupacNaziv}</span>
                        {selectedOrder.kupacIdBroj && (
                          <span className="text-[10px] text-slate-400 font-mono ml-1.5">({selectedOrder.kupacIdBroj})</span>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedOrder.brojReklamacije && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={13} className="text-red-400" />
                        <span className="text-[11px] text-red-400">Reklamacija</span>
                      </div>
                      <span className="text-[12px] font-mono font-medium text-red-500">{selectedOrder.brojReklamacije}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Items table ── */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100">
                <div className="px-5 py-2 bg-slate-50/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Stavke</span>
                    <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-4">
                      {(selectedOrder.stavke || []).length}
                    </Badge>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="divide-y divide-slate-50">
                    {(selectedOrder.stavke || []).map((stavka: OrderItem, i: number) => {
                      const lineTotal = stavka.cijena * stavka.kolicina * (1 - (stavka.rabat || 0) / 100);
                      return (
                        <div key={stavka.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
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
                          <span className="text-[13px] font-mono font-semibold text-slate-800 tabular-nums flex-shrink-0">
                            {formatKM(lineTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* ── Summary footer ── */}
              <div className="flex-shrink-0 border-t border-slate-100">
                {/* Subtotal + PDV */}
                <div className="px-5 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Osnovica</span>
                    <span className="text-[12px] font-mono tabular-nums text-slate-600">{formatKM(selectedOrder.ukupno - selectedOrder.pdvIznos)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">PDV (17%)</span>
                    <span className="text-[12px] font-mono tabular-nums text-slate-600">{formatKM(selectedOrder.pdvIznos)}</span>
                  </div>
                </div>

                {/* Total */}
                <div className="mx-5 border-t border-slate-100" />
                <div className="px-5 py-3 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-800">Ukupno</span>
                  <span className="text-[18px] font-bold font-mono tabular-nums tracking-tight text-slate-900">{formatKM(selectedOrder.ukupno)}</span>
                </div>

                {/* Actions */}
                <div className="px-5 pb-4 pt-1 flex flex-col gap-2">
                  {/* Print / Export row */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center flex-1 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
                      <button
                        onClick={() => handlePrintPdf(selectedOrder, 'bs')}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Štampaj (BS)"
                      >
                        <Printer size={13} />
                        <span>BS</span>
                      </button>
                      <div className="w-px h-4 bg-slate-200" />
                      <button
                        onClick={() => handlePrintPdf(selectedOrder, 'en')}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Print (EN)"
                      >
                        <Printer size={13} />
                        <span>EN</span>
                      </button>
                    </div>
                    <div className="flex items-center flex-1 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
                      <button
                        onClick={() => handleExportPdf(selectedOrder, 'bs')}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Eksportuj PDF (BS)"
                      >
                        <Download size={13} />
                        <span>BS</span>
                      </button>
                      <div className="w-px h-4 bg-slate-200" />
                      <button
                        onClick={() => handleExportPdf(selectedOrder, 'en')}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Export PDF (EN)"
                      >
                        <Download size={13} />
                        <span>EN</span>
                      </button>
                    </div>
                  </div>

                  {/* Otpremnica */}
                  <div className="flex items-center flex-1 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden">
                    <button
                      onClick={() => handlePrintOtpremnica(selectedOrder)}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Štampaj otpremnicu"
                    >
                      <Printer size={13} />
                      <span>Otpremnica</span>
                    </button>
                    <div className="w-px h-4 bg-slate-200" />
                    <button
                      onClick={() => handleExportOtpremnica(selectedOrder)}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Eksportuj otpremnicu (PDF)"
                    >
                      <Download size={13} />
                      <span>Otpremnica</span>
                    </button>
                  </div>

                  {/* Reklamacija result */}
                  {reklamacijaMsg && !reklamacijaOpen && (
                    <div className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium',
                      reklamacijaMsg.type === 'error'
                        ? 'bg-red-50 border border-red-100 text-red-600'
                        : 'bg-emerald-50 border border-emerald-100 text-emerald-600',
                    )}>
                      {reklamacijaMsg.type === 'error' ? <AlertTriangle size={12} /> : <Receipt size={12} />}
                      {reklamacijaMsg.text}
                    </div>
                  )}

                  {/* Reklamacija */}
                  {selectedOrder.status === 'completed' && selectedOrder.brojFiskalnogRacuna && (
                    <button
                      onClick={() => {
                        setReklamacijaMsg(null);
                        if (requirePinRefund) {
                          setPinValue('');
                          setPinError('');
                          setPinDialogOpen(true);
                        } else {
                          setReklamacijaOpen(true);
                        }
                      }}
                      className="w-full h-9 flex items-center justify-center gap-2 rounded-lg border border-red-200 text-[12px] font-medium text-red-500 hover:bg-red-50 hover:border-red-300 transition-all"
                    >
                      <RotateCcw size={13} />
                      Reklamacija
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col items-center justify-center text-slate-400 select-none">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <ChevronRight size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">Odaberite račun</p>
              <p className="text-[12px] text-slate-400 mt-0.5">iz liste za prikaz detalja</p>
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
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
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
            <div className="flex items-start gap-3 bg-red-50/60 border border-red-100 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-red-700">Pažnja: Ova akcija je nepovratna</p>
                <p className="text-[11px] text-red-600/70 mt-0.5">
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
                  </p>
                  <Button
                    variant="outline" size="sm" className="h-7 mt-2 text-[11px] border-amber-200 text-amber-700"
                    onClick={() => setPologOpen(true)}
                  >
                    Unesi polog
                  </Button>
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
                ? 'bg-red-50/60 border border-red-100 text-red-600'
                : 'bg-emerald-50/60 border border-emerald-100 text-emerald-600',
            )}>
              {reklamacijaMsg.type === 'error' ? <AlertTriangle size={14} /> : <Receipt size={14} />}
              {reklamacijaMsg.text}
            </div>
          )}

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setReklamacijaOpen(false)}>
              Otkaži
            </Button>
            <Button
              variant="destructive"
              onClick={handleReklamacija}
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
              <p className="text-[12px] text-red-500 font-medium text-center">{pinError}</p>
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

      {/* ── Dodaj račun ručno Dialog ── */}
      <DodajRacunDialog
        open={dodajOpen}
        onOpenChange={(v) => { setDodajOpen(v); if (!v) setPrefillBroj(undefined); }}
        korisnikId={korisnikId}
        prefillBroj={prefillBroj}
        onSaved={() => { loadOrders(); loadGaps(); setPrefillBroj(undefined); }}
      />

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
