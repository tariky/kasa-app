// src/components/racuni/RacunDetailDialog.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { Order } from '@/types';
import { cn, formatKM, formatDateTime } from '@/lib/utils';
import { iznosStavke } from '@/lib/racun';
import { prilogKompletan, sumaPriloga } from '@/lib/prilog';
import { formatDatumValute } from '@/lib/valuta';
import { gotovinskiIznos } from '@/lib/drawer';
import { round2 } from '@/lib/novac';
import { LOGO_VELICINA } from '@/lib/firma';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, Key, mod } from '@/components/ui/ledger';
import { FullDialog, FullDialogContent, FullDialogHeader, FullDialogFooter, FullDialogNotice, FullDialogTitle, FooterBtn, Fact, LegendKey } from '@/components/ui/full-dialog';
import { RacunPdf, type InvoiceLang } from '@/components/RacunPdf';
import { OtpremnicaPdf } from '@/components/OtpremnicaPdf';
import { PrilogPdf } from '@/components/PrilogPdf';
import PrilogStavkeDialog from '@/components/PrilogStavkeDialog';
import CashMovementDialog from '@/components/CashMovementDialog';
import {
  Printer, Download, Truck, Paperclip, Undo2, AlertTriangle, KeyRound, CalendarClock,
  ChevronUp, ChevronDown, User, Banknote, CreditCard,
} from 'lucide-react';

type Notice = { type: 'success' | 'error'; text: string };

const TH = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 pb-2 border-b border-slate-200/80 whitespace-nowrap';
const TD = 'py-2.5 border-b border-slate-100 align-top';

function placanje(json: string): { label: string; kartica: boolean; gotovina: boolean } {
  try {
    const p = JSON.parse(json);
    if (p.gotovina && p.kartica) return { label: `Gotovina ${formatKM(p.gotovina)}, kartica ${formatKM(p.kartica)}`, kartica: true, gotovina: true };
    if (p.kartica) return { label: `Kartica ${formatKM(p.kartica)}`, kartica: true, gotovina: false };
    if (p.gotovina) return { label: `Gotovina ${formatKM(p.gotovina)}`, kartica: false, gotovina: true };
    return { label: json, kartica: false, gotovina: true };
  } catch {
    return { label: json, kartica: false, gotovina: true };
  }
}

/** Oznaka na tamnom zaglavlju — status i porijeklo računa. */
function HeaderChip({ tone, children }: { tone: 'ok' | 'storno' | 'muted' | 'warn'; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 h-6 text-[11px] font-medium',
      tone === 'ok' && 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
      tone === 'storno' && 'border-rose-400/35 bg-rose-400/10 text-rose-300',
      tone === 'warn' && 'border-amber-300/30 bg-amber-300/10 text-amber-200',
      tone === 'muted' && 'border-white/15 bg-white/5 text-white/70')}>
      {children}
    </span>
  );
}

/**
 * Fiskalni račun preko cijelog ekrana — isti okvir kao radni nalog. Zaglavlje nosi broj
 * i status, tijelo stavke i iznos, podnožje dokumente koji iz računa nastaju. Tastatura:
 * ↑↓ susjedni račun, P štampa, S PDF, O otpremnica, F faktura, V valuta, R reklamacija, esc zatvori.
 */
export function RacunDetailDialog({ orderId, redoslijed, korisnikId, onClose, onNavigate, onChanged }: {
  orderId: number | null; redoslijed: number[]; korisnikId: number;
  onClose: () => void; onNavigate: (id: number) => void; onChanged: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lang, setLang] = useState<InvoiceLang>('bs');
  const [requirePinRefund, setRequirePinRefund] = useState(false);

  const [reklamacijaOpen, setReklamacijaOpen] = useState(false);
  const [reklamacijaBroj, setReklamacijaBroj] = useState('');
  const [reklamacijaLoading, setReklamacijaLoading] = useState(false);
  const [reklamacijaGreska, setReklamacijaGreska] = useState<string | null>(null);
  const [drawerWarning, setDrawerWarning] = useState<{ stanje: number; potrebno: number } | null>(null);
  // Printer je odbio gotovinski storno zbog prazne ladice — operater može
  // svjesno pregaziti stanje (manjak se evidentira kao polog).
  const [overrideManjak, setOverrideManjak] = useState<number | null>(null);
  const [pologOpen, setPologOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [valutaOpen, setValutaOpen] = useState(false);
  const [valutaDatum, setValutaDatum] = useState('');
  const [valutaError, setValutaError] = useState('');
  const [prilogOpen, setPrilogOpen] = useState(false);
  /** Dodijeljene stavke fakture; null = nije faktura ili se još čita. */
  const [fakturaStavke, setFakturaStavke] = useState<any[] | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const open = orderId != null;
  const greska = (e: any, prefiks = 'Greška') => setNotice({ type: 'error', text: `${prefiks}: ${e?.message || 'Nepoznata greška'}` });

  useEffect(() => {
    window.api.getSetting('kasa.requirePinRefund').then(v => setRequirePinRefund(v === 'true'));
  }, []);

  const load = useCallback(async (id: number) => {
    try {
      const o: Order = await window.api.getOrder(id);
      setOrder(o);
      setFakturaStavke(o.prilogBroj != null ? await window.api.getPrilogStavke(id) : null);
    }
    catch (e) { greska(e); }
  }, []);

  useEffect(() => {
    setFakturaStavke(null);
    if (orderId == null) { setOrder(null); return; }
    setNotice(null);
    load(orderId);
  }, [orderId, load]);

  const reload = async () => {
    if (orderId != null) await load(orderId);
    onChanged();
  };

  const idx = orderId != null ? redoslijed.indexOf(orderId) : -1;
  const prevId = idx > 0 ? redoslijed[idx - 1] : null;
  const nextId = idx >= 0 && idx < redoslijed.length - 1 ? redoslijed[idx + 1] : null;

  const refunded = order?.status === 'refunded';
  const mozeReklamaciju = order?.status === 'completed' && !!order.brojFiskalnogRacuna;
  const imaFakturu = order?.prilogBroj != null;
  // Kompletna faktura je završena: stavke se više ne mijenjaju, samo štampaju.
  const fakturaZavrsena = !!order && imaFakturu && !!fakturaStavke?.length && prilogKompletan(order.ukupno, fakturaStavke);
  const mozeUreditiFakturu = imaFakturu && !fakturaZavrsena && !refunded;

  // ── dokumenti ─────────────────────────────────────────
  const loadFirma = async () => {
    try { return await window.api.getFirmaSettings(); }
    catch { return { naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', web: '', email: '', logo: '', logoVelicina: LOGO_VELICINA.zadano, ziroRacuniPozicija: 'zaglavlje' as const, bankAccounts: [] }; }
  };
  const otvoriZaStampu = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };
  const spremi = async (blob: Blob, defaultName: string) => {
    const savePath = await window.api.showSaveDialog({ defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!savePath) return;
    await window.api.writeFile(savePath, Array.from(new Uint8Array(await blob.arrayBuffer())) as any);
  };
  const racunBlob = async (o: Order) => pdf(<RacunPdf order={o} firma={await loadFirma()} lang={lang} />).toBlob();
  const otpremnicaBlob = async (o: Order) => pdf(<OtpremnicaPdf order={o} firma={await loadFirma()} />).toBlob();

  const stampajRacun = async () => { if (order) try { otvoriZaStampu(await racunBlob(order)); } catch (e) { greska(e, 'Štampa računa'); } };
  const spremiRacun = async () => {
    if (!order) return;
    try { await spremi(await racunBlob(order), `${lang === 'en' ? 'Invoice' : 'Racun'}-${order.brojFiskalnogRacuna || order.id}.pdf`); }
    catch (e) { greska(e, 'Spremanje računa'); }
  };
  const stampajOtpremnicu = async () => { if (order) try { otvoriZaStampu(await otpremnicaBlob(order)); } catch (e) { greska(e, 'Štampa otpremnice'); } };
  const spremiOtpremnicu = async () => {
    if (!order) return;
    try { await spremi(await otpremnicaBlob(order), `Otpremnica-${order.brojFiskalnogRacuna || order.id}.pdf`); }
    catch (e) { greska(e, 'Spremanje otpremnice'); }
  };

  /**
   * Štampa A4 fakture uz fiskalni račun. Dozvoljena samo kad se suma dodijeljenih
   * stavki poklopi sa fiskalnim iznosom — nepotpuna faktura bi
   * pokazivala manji iznos od onog koji je fiskalizovan.
   */
  const stampajFakturu = async () => {
    if (!order) return;
    setNotice(null);
    try {
      const stavke = await window.api.getPrilogStavke(order.id);
      if (!prilogKompletan(order.ukupno, stavke as any)) {
        setNotice({
          type: 'error',
          text: `Suma stavki fakture (${formatKM(sumaPriloga(stavke as any))}) se ne poklapa sa fiskalnim iznosom ` +
            `(${formatKM(order.ukupno)}) — dopunite fakturu prije štampe.`,
        });
        return;
      }
      otvoriZaStampu(await pdf(<PrilogPdf order={order} firma={await loadFirma()} stavke={stavke as any} />).toBlob());
    } catch (e) { greska(e, 'Štampa fakture'); }
  };

  // ── reklamacija ───────────────────────────────────────
  const otvoriReklamaciju = () => {
    setNotice(null);
    if (requirePinRefund) { setPinValue(''); setPinError(''); setPinOpen(true); }
    else setReklamacijaOpen(true);
  };
  const potvrdiPin = async () => {
    try { await window.api.verifyAdminPin(pinValue); setPinOpen(false); setReklamacijaOpen(true); }
    catch { setPinError('Neispravan admin PIN'); }
  };

  // Tring zahtijeva evidentiranu gotovinu prije gotovinske reklamacije —
  // upozorenje (ne blokada) kad očekivano stanje ladice ne pokriva povrat.
  useEffect(() => {
    setDrawerWarning(null);
    setOverrideManjak(null);
    setReklamacijaGreska(null);
    if (!reklamacijaOpen || !order) return;
    // Upozorava se samo na stvarnu gotovinu koja izlazi iz ladice. Nenovčani
    // dio (virman, kartica) uređaj također traži, ali ga app pokrije sama.
    const potrebno = gotovinskiIznos(order.nacinPlacanja, order.ukupno);
    if (potrebno <= 0) return;
    window.api.getDrawerState()
      .then(s => { if (s.ocekivanoStanje < potrebno) setDrawerWarning({ stanje: s.ocekivanoStanje, potrebno }); })
      .catch(() => { /* informativno */ });
  }, [reklamacijaOpen, order, pologOpen]);

  const reklamiraj = async (dozvoliPolog = false) => {
    if (!order || !order.brojFiskalnogRacuna || reklamacijaLoading) return;
    setReklamacijaLoading(true);
    setReklamacijaGreska(null);
    if (dozvoliPolog) setOverrideManjak(null);
    try {
      // Štampa i upis storna idu kroz jedan poziv da ne ostane odštampana
      // reklamacija bez zapisa u bazi ako nešto pukne između.
      const result = await window.api.refundAndPrintOrder({
        id: order.id,
        brojReklamacije: reklamacijaBroj.trim() || undefined,
        dozvoliPolog,
        korisnikId,
      });
      if (!result || !result.success) {
        const details = result?.odgovori ? Object.entries(result.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setReklamacijaGreska(`${result?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}`);
        // Prazna ladica nije razlog da se storno ne može napraviti — operateru
        // se ponudi override koji manjak evidentira kao polog i ponovi štampu.
        setOverrideManjak(result?.nedovoljnoSredstava ? (result.manjak ?? 0) : null);
        return;
      }
      setReklamacijaOpen(false);
      setReklamacijaBroj('');
      setNotice({
        type: 'success',
        text: `Reklamacija #${result.brojReklamacije ?? ''} uspješno kreirana`
          + (result.pologIznos ? ` (evidentiran polog ${formatKM(result.pologIznos)})` : ''),
      });
      await reload();
    } catch (err: any) {
      console.error('Reklamacija error:', err);
      setReklamacijaGreska(err?.message || 'Nepoznata greška');
    } finally {
      setReklamacijaLoading(false);
    }
  };

  // ── valuta ────────────────────────────────────────────
  /**
   * Datum valute nije dio fiskalnog zapisa — dogovara se s kupcem naknadno, pa
   * se smije mijenjati i uklanjati na svakom računu, uključujući stornirane.
   * Vidljiv je samo na A4 kopiji računa.
   */
  const otvoriValutu = () => {
    if (!order) return;
    setValutaDatum(order.datumValute || '');
    setValutaError('');
    setValutaOpen(true);
  };
  const spremiValutu = async (datum: string | null) => {
    if (!order) return;
    try {
      await window.api.setOrderDatumValute(order.id, datum);
      setValutaOpen(false);
      setOrder({ ...order, datumValute: datum });
      onChanged();
    } catch (err: any) {
      setValutaError(err?.message || 'Greška pri spremanju datuma valute');
    }
  };

  const anySub = reklamacijaOpen || pinOpen || valutaOpen || prilogOpen || pologOpen;

  // ── tastatura ─────────────────────────────────────────
  // Sluša samo događaje iz ovog dijaloga: ugniježdeni dijalozi su portali izvan njega
  // pa ih sami preskaču, a stanje pod-dijaloga gasi i ostatak.
  useEffect(() => {
    if (!open || anySub || !order) return;
    const onKey = (e: KeyboardEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

      switch (e.key) {
        case 'ArrowUp': if (prevId != null) { e.preventDefault(); onNavigate(prevId); } return;
        case 'ArrowDown': if (nextId != null) { e.preventDefault(); onNavigate(nextId); } return;
        default:
      }
      switch (e.key.toLowerCase()) {
        case 'p': if (!imaFakturu) { e.preventDefault(); stampajRacun(); } break;
        case 's': if (!imaFakturu) { e.preventDefault(); spremiRacun(); } break;
        case 'o': e.preventDefault(); stampajOtpremnicu(); break;
        case 'v': e.preventDefault(); otvoriValutu(); break;
        case 'f':
          if (fakturaZavrsena) { e.preventDefault(); stampajFakturu(); }
          else if (mozeUreditiFakturu) { e.preventDefault(); setPrilogOpen(true); }
          break;
        case 'r': if (mozeReklamaciju) { e.preventDefault(); otvoriReklamaciju(); } break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Faktura sa dodijeljenim stavkama pokazuje njih; zbirna stavka je samo ono što je otišlo na uređaj.
  const stavkeFakture = imaFakturu && !!fakturaStavke?.length;
  const stavke: any[] = stavkeFakture ? fakturaStavke! : order?.stavke ?? [];
  const nacin = order ? placanje(order.nacinPlacanja) : null;
  const imaRabat = stavke.some(s => (s.rabat || 0) > 0);
  const kupacAdresa = order ? [order.kupacAdresa, [order.kupacPostanskiBroj, order.kupacGrad].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

  return (
    <FullDialog open={open} onRequestClose={onClose}>
      <FullDialogContent ref={contentRef} onRequestClose={onClose}>
        {!order && <FullDialogTitle className="sr-only">Račun</FullDialogTitle>}
        {order && nacin && (
          <>
            <FullDialogHeader
              eyebrow={imaFakturu ? 'Račun uz fakturu' : 'Fiskalni račun'}
              title={`#${order.brojFiskalnogRacuna || order.id}`}
              description={<>
                {order.kupacNaziv || 'Krajnji kupac'}
                <span className="text-white/45"> · {formatDateTime(order.createdAt)}</span>
              </>}
            >
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {refunded
                  ? <HeaderChip tone="storno"><Undo2 size={11} /> Stornirano</HeaderChip>
                  : <HeaderChip tone="ok">Fiskalizovan</HeaderChip>}
                {imaFakturu && <HeaderChip tone="muted"><Paperclip size={11} /> Faktura <span className="font-mono">{order.prilogBroj}</span></HeaderChip>}
                {Boolean(order.isManual) && <HeaderChip tone="warn">Ručno unesen</HeaderChip>}
              </div>
            </FullDialogHeader>

            {notice && <FullDialogNotice type={notice.type} text={notice.text} onClose={() => setNotice(null)} />}

            {/* ── Tijelo ── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8 gap-y-6 px-6 py-5">
                <div className="min-w-0 space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
                    <Fact label="Kupac" className="col-span-2">
                      <span className="flex items-start gap-2"><User size={14} className="text-slate-400 mt-[2px] flex-shrink-0" />
                        {order.kupacNaziv ? (
                          <span>
                            <span className="font-medium">{order.kupacNaziv}</span>
                            {order.kupacIdBroj && <span className="ml-2 font-mono text-[11px] text-slate-400">ID {order.kupacIdBroj}</span>}
                            {kupacAdresa && <span className="block text-[11.5px] text-slate-400">{kupacAdresa}</span>}
                          </span>
                        ) : <span className="text-slate-400">Krajnji kupac, bez identifikacije</span>}
                      </span>
                    </Fact>
                    <Fact label="Izdat"><span className="font-mono tabular-nums">{formatDateTime(order.createdAt)}</span></Fact>
                    <Fact label="Kasir"><span className="text-slate-600">{order.korisnikIme || '—'}</span></Fact>
                    <Fact label="Plaćanje" className="col-span-2">
                      <span className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-slate-400">
                          {nacin.gotovina && <Banknote size={14} />}{nacin.kartica && <CreditCard size={14} />}
                        </span>
                        {nacin.label}
                      </span>
                    </Fact>
                    <Fact label="Valuta">
                      <button type="button" onClick={otvoriValutu} title="Postavi datum valute (rok plaćanja)"
                        className={cn('group -ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                          order.datumValute ? 'font-mono tabular-nums text-slate-800' : 'text-slate-400')}>
                        <CalendarClock size={13} className="text-slate-400" />
                        {formatDatumValute(order.datumValute) ?? 'Postavi'}
                        <Key className="ml-1">V</Key>
                      </button>
                    </Fact>
                    {order.brojReklamacije && (
                      <Fact label="Reklamacija"><span className="font-mono font-medium text-rose-600">{order.brojReklamacije}</span></Fact>
                    )}
                  </div>

                  {imaFakturu && fakturaStavke && (
                    <section aria-label="Faktura" className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/70 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800">Faktura br. {order.prilogBroj}</p>
                        <p className="mt-0.5 text-[12px] text-slate-500">
                          {fakturaZavrsena
                            ? `${fakturaStavke.length} ${fakturaStavke.length === 1 ? 'stavka' : fakturaStavke.length < 5 ? 'stavke' : 'stavki'} · završena, ne može se mijenjati`
                            : refunded
                              ? 'Račun je storniran — faktura se ne može mijenjati.'
                              : `Dodijeljeno ${formatKM(sumaPriloga(fakturaStavke))} od ${formatKM(order.ukupno)} — dopunite stavke prije štampe.`}
                        </p>
                      </div>
                    </section>
                  )}

                  <section aria-label="Stavke računa">
                    <div className="flex items-center gap-2.5 h-9">
                      <Eyebrow>{stavkeFakture ? 'Stavke fakture' : 'Stavke'}</Eyebrow>
                      <span className="font-mono text-[10.5px] tabular-nums text-slate-400">{stavke.length}</span>
                    </div>
                    {stavke.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center">
                        <p className="text-[12.5px] text-slate-500">Račun nema zapisanih stavki.</p>
                        {mozeUreditiFakturu && <p className="text-[11.5px] text-slate-400 mt-0.5">Stavke fakture dodjeljujete kroz „Dodijeli stavke“ — tipka <Key className="ml-0 mx-0.5">F</Key>.</p>}
                      </div>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full border-separate border-spacing-0 min-w-[560px]">
                          <thead>
                            <tr>
                              <th className={cn(TH, 'text-right w-6 pr-2')}>#</th>
                              <th className={cn(TH, 'text-left px-2')}>Artikal</th>
                              <th className={cn(TH, 'text-right px-2 w-[110px]')}>Količina</th>
                              <th className={cn(TH, 'text-right px-2 w-[110px]')}>Cijena</th>
                              {imaRabat && <th className={cn(TH, 'text-right px-2 w-[70px]')}>Rabat</th>}
                              <th className={cn(TH, 'text-right pl-2 w-[120px]')}>Iznos</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stavke.map((s, i) => (
                              <tr key={s.id}>
                                <td className={cn(TD, 'text-right pr-2 pt-[13px] font-mono text-[10.5px] tabular-nums text-slate-300')}>{i + 1}</td>
                                <td className={cn(TD, 'px-2')}>
                                  <p className="text-[12.5px] font-medium text-slate-800 leading-snug">{s.productNaziv || `#${s.productId}`}</p>
                                </td>
                                <td className={cn(TD, 'px-2 text-right font-mono text-[12px] tabular-nums text-slate-600 whitespace-nowrap')}>
                                  {s.kolicina} <span className="text-[11px] text-slate-400">{s.productJm || 'kom'}</span>
                                </td>
                                <td className={cn(TD, 'px-2 text-right font-mono text-[12px] tabular-nums text-slate-500 whitespace-nowrap')}>{formatKM(s.cijena)}</td>
                                {imaRabat && (
                                  <td className={cn(TD, 'px-2 text-right font-mono text-[11.5px] tabular-nums whitespace-nowrap', (s.rabat || 0) > 0 ? 'text-blue-600' : 'text-slate-300')}>
                                    {(s.rabat || 0) > 0 ? `−${s.rabat}%` : '—'}
                                  </td>
                                )}
                                <td className={cn(TD, 'pl-2 text-right font-mono text-[13px] font-semibold tabular-nums whitespace-nowrap', refunded ? 'text-rose-500 line-through decoration-rose-300' : 'text-slate-900')}>
                                  {formatKM(iznosStavke(s))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>

                <aside className="lg:sticky lg:top-0 self-start space-y-4">
                  <section className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 pt-3 pb-4" aria-label="Iznos računa">
                    <Eyebrow className="block mb-1">Iznos</Eyebrow>
                    <div className="flex items-center justify-between gap-3 text-[12px] min-h-[26px]">
                      <span className="text-slate-500">Osnovica</span>
                      <span className="font-mono tabular-nums text-slate-700">{formatKM(order.ukupno - order.pdvIznos)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-[12px] min-h-[26px]">
                      <span className="text-slate-500">PDV 17 %</span>
                      <span className="font-mono tabular-nums text-slate-700">{formatKM(order.pdvIznos)}</span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] font-semibold text-slate-800">{refunded ? 'Stornirano' : 'Ukupno'}</span>
                      <span className={cn('text-[24px] font-bold font-mono tabular-nums tracking-tight leading-none', refunded ? 'text-rose-600' : 'text-slate-900')}>
                        {formatKM(order.ukupno)}
                      </span>
                    </div>
                  </section>

                  {!imaFakturu && <section className="rounded-xl border border-slate-200/70 px-4 py-3" aria-label="Jezik dokumenta">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-slate-500">Jezik računa za štampu</span>
                      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                        {(['bs', 'en'] as InvoiceLang[]).map(l => (
                          <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
                            className={cn('rounded-[6px] px-2.5 h-6 font-mono text-[10.5px] font-semibold uppercase transition-colors duration-150',
                              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                              lang === l ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600')}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>}
                </aside>
              </div>
            </div>

            {/* ── Podnožje: dokumenti desno, tastatura lijevo ── */}
            <FullDialogFooter legend={<>
                <span className="flex items-center gap-1">
                  <button onClick={() => prevId != null && onNavigate(prevId)} disabled={prevId == null} aria-label="Prethodni račun"
                    className="h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><ChevronUp size={14} /></button>
                  <button onClick={() => nextId != null && onNavigate(nextId)} disabled={nextId == null} aria-label="Sljedeći račun"
                    className="h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><ChevronDown size={14} /></button>
                  <span className="font-mono tabular-nums ml-1">{idx >= 0 ? `${idx + 1} / ${redoslijed.length}` : ''}</span>
                </span>
                <span className="text-slate-300">·</span>
                <LegendKey k="↑↓">račun</LegendKey>
                <LegendKey k="esc">zatvori</LegendKey>
              </>}>
                {mozeReklamaciju && <FooterBtn icon={Undo2} label="Reklamacija" hint="R" tone="danger" onClick={otvoriReklamaciju} />}
                <div className="flex items-center gap-1.5">
                  <FooterBtn icon={Truck} label="Otpremnica" hint="O" onClick={stampajOtpremnicu} />
                  <FooterBtn icon={Download} title="Sačuvaj otpremnicu kao PDF" onClick={spremiOtpremnicu} />
                </div>
                {/* Račun uz fakturu se ne štampa zasebno — njegovo mjesto preuzima faktura. */}
                {imaFakturu ? (fakturaZavrsena || mozeUreditiFakturu) && <>
                  <span className="w-px h-5 bg-slate-200" aria-hidden />
                  {fakturaZavrsena
                    ? <FooterBtn icon={Printer} label="Štampaj fakturu" hint="F" tone="primary" onClick={stampajFakturu} />
                    : <FooterBtn icon={Paperclip} label="Dodijeli stavke" hint="F" tone="primary" onClick={() => setPrilogOpen(true)} />}
                </> : <>
                  <span className="w-px h-5 bg-slate-200" aria-hidden />
                  <div className="flex items-center gap-1.5">
                    <FooterBtn icon={Download} title={`Sačuvaj račun kao PDF (${lang.toUpperCase()}) — S`} onClick={spremiRacun} />
                    <FooterBtn icon={Printer} label="Štampaj račun" hint="P" tone="primary" onClick={stampajRacun} />
                  </div>
                </>}
            </FullDialogFooter>
          </>
        )}
      </FullDialogContent>

      {order && (
        <>
          {/* ── Reklamacija ── */}
          <Dialog open={reklamacijaOpen} onOpenChange={setReklamacijaOpen}>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>Reklamacija računa #{order.brojFiskalnogRacuna}</DialogTitle>
                <DialogDescription>
                  Povratni račun se odmah štampa na fiskalnom printeru i ne može se poništiti. Provjerite da je printer uključen.
                </DialogDescription>
              </DialogHeader>

              {drawerWarning && (
                <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-amber-800">U kasi nema dovoljno evidentirane gotovine za povrat</p>
                  <p className="text-[11.5px] text-amber-700/80 mt-0.5">
                    Očekivano stanje je {formatKM(drawerWarning.stanje)}, a povrat traži {formatKM(drawerWarning.potrebno)}.
                    Tring povrat po reklamaciji ide gotovinom, pa printer bez pokrića odbija
                    štampu. Možeš unijeti polog ručno ili pregaziti stanje: manjak se tada
                    evidentira kao polog i storno prolazi.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Button variant="outline" size="sm" className="h-7 text-[11px] border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800" onClick={() => setPologOpen(true)}>
                      Unesi polog
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800" disabled={reklamacijaLoading} onClick={() => reklamiraj(true)}>
                      Reklamiraj uz polog {formatKM(round2(drawerWarning.potrebno - drawerWarning.stanje))}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reklamacija-broj" className="text-[12px] text-slate-600">Broj fiskalnog za reklamaciju (opcionalno)</Label>
                <Input id="reklamacija-broj" value={reklamacijaBroj} onChange={e => setReklamacijaBroj(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reklamiraj(); } }}
                  placeholder="Unesite broj fiskalnog računa" className="font-mono text-[13px] h-9" />
              </div>

              {reklamacijaGreska && (
                <p className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[11.5px] font-medium text-rose-700">
                  <AlertTriangle size={13} className="mt-[1px] flex-shrink-0" /> {reklamacijaGreska}
                </p>
              )}

              {overrideManjak !== null && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                  <p className="text-[12px] font-semibold text-amber-800">Printer je odbio storno zbog stanja kase</p>
                  <p className="text-[11.5px] text-amber-700/80 mt-0.5">
                    Za povrat fali {formatKM(overrideManjak)}. Možeš pregaziti stanje kase — taj iznos
                    će biti evidentiran kao polog (i na printeru i u evidenciji ladice), pa se
                    reklamacija odmah ponovo štampa.
                  </p>
                  <Button variant="outline" size="sm" className="h-7 mt-2 text-[11px] border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800" disabled={reklamacijaLoading} onClick={() => reklamiraj(true)}>
                    Ipak reklamiraj (polog {formatKM(overrideManjak)})
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setReklamacijaOpen(false)}>Otkaži</Button>
                <Button variant="destructive" onClick={() => reklamiraj()} disabled={reklamacijaLoading} className="min-w-[160px]">
                  {reklamacijaLoading ? 'Štampam povrat…' : <>Potvrdi reklamaciju <Key tone="danger">{mod('↵')}</Key></>}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── PIN prije reklamacije ── */}
          <Dialog open={pinOpen} onOpenChange={setPinOpen}>
            <DialogContent className="sm:max-w-[360px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><KeyRound size={16} className="text-amber-500" /> Admin PIN</DialogTitle>
                <DialogDescription>Reklamacija traži potvrdu administratora.</DialogDescription>
              </DialogHeader>
              <Input type="password" value={pinValue} autoFocus maxLength={8} inputMode="numeric" placeholder="PIN" aria-label="Admin PIN"
                onChange={e => { setPinValue(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && pinValue.length >= 4) potvrdiPin(); }}
                className="font-mono text-center text-xl h-12 tracking-[0.3em]" />
              {pinError && <p className="text-[12px] text-rose-600 font-medium text-center">{pinError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setPinOpen(false)}>Otkaži</Button>
                <Button onClick={potvrdiPin} disabled={pinValue.length < 4}>Potvrdi <Key tone="dark">↵</Key></Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* ── Datum valute ── */}
          <Dialog open={valutaOpen} onOpenChange={setValutaOpen}>
            <DialogContent className="sm:max-w-[380px]">
              <DialogHeader>
                <DialogTitle>Datum valute</DialogTitle>
                <DialogDescription>
                  Rok plaćanja za račun #{order.brojFiskalnogRacuna || order.id}. Vidi se samo na A4 kopiji i fakturi — fiskalni zapis ostaje isti.
                </DialogDescription>
              </DialogHeader>
              <DatePicker value={valutaDatum} onChange={v => { setValutaDatum(v); setValutaError(''); }} className="h-9 text-[13px] w-full" />
              {valutaError && <p className="text-[11.5px] text-rose-600">{valutaError}</p>}
              <div className="flex justify-between items-center gap-2 pt-2">
                <Button variant="ghost" className="text-slate-500 hover:text-rose-600 hover:bg-rose-50" disabled={!order.datumValute} onClick={() => spremiValutu(null)}>Ukloni</Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setValutaOpen(false)}>Otkaži</Button>
                  <Button disabled={!valutaDatum} onClick={() => spremiValutu(valutaDatum)}>Spremi</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {mozeUreditiFakturu && (
            <PrilogStavkeDialog open={prilogOpen} onOpenChange={setPrilogOpen} order={order} onSaved={reload} />
          )}

          {/* Polog prije gotovinske reklamacije kad u ladici nema dovoljno */}
          <CashMovementDialog
            open={pologOpen}
            tip="polog"
            korisnikId={korisnikId}
            suggested={drawerWarning ? round2(drawerWarning.potrebno - drawerWarning.stanje) : undefined}
            onClose={() => setPologOpen(false)}
          />
        </>
      )}
    </FullDialog>
  );
}
