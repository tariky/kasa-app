import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import { ActionRow, Eyebrow, Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import {
  RefreshCw, FileText, AlertTriangle, Printer, Download, Plus, Trash2, Pencil,
  Receipt, Search, X, Banknote, CreditCard, Building, FileCheck,
  Send, Check, Ban, CornerDownLeft, ChevronsUpDown, ChevronsLeftRight,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { PonudaPdf } from '@/components/PonudaPdf';
import { formatBrojPonude, efektivniStatus, plusDana, danaIzmedju, DEFAULT_ROK_DANA } from '@/lib/ponuda';
import { izracunajTotale, pdvStavke } from '@/lib/racun';
import { localDateStr } from '@/lib/novac';
import { cn, formatKM, formatDate } from '@/lib/utils';

/** "8 dana od datuma ponude" — bosanska množina: 1/21/31 dan, ostalo dana. */
function opisRoka(dana: number): string {
  if (dana <= 0) return 'Važi samo na dan ponude';
  const jednina = dana % 10 === 1 && dana % 100 !== 11;
  return `${dana} ${jednina ? 'dan' : 'dana'} od datuma ponude`;
}

interface PonudaRow {
  id: number;
  broj: number;
  godina: number;
  kupacId: number;
  datum: string;
  vaziDo: string;
  status: string;
  napomena?: string | null;
  ukupno: number;
  pdvIznos: number;
  racunId?: number | null;
  racunBroj?: string | null;
  kupacNaziv?: string;
  korisnikIme?: string;
  stavke?: any[];
}

interface FormStavka {
  productId: number;
  naziv: string;
  jm: string;
  kolicina: number;
  cijena: number;
  rabat: number;
  pdvStopa: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  poslana: { label: 'Poslana', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  prihvacena: { label: 'Prihvaćena', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  odbijena: { label: 'Odbijena', cls: 'bg-rose-50 text-rose-600 border-rose-100' },
  istekla: { label: 'Istekla', cls: 'bg-amber-50 text-amber-600 border-amber-100' },
  konvertovana: { label: 'Račun izdat', cls: 'bg-violet-50 text-violet-600 border-violet-100' },
};

type Filter = 'sve' | 'draft' | 'poslana' | 'prihvacena' | 'odbijena' | 'istekla' | 'konvertovana';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'sve', label: 'Sve' },
  { id: 'draft', label: 'Draft' },
  { id: 'poslana', label: 'Poslana' },
  { id: 'prihvacena', label: 'Prihvaćena' },
  { id: 'odbijena', label: 'Odbijena' },
  { id: 'istekla', label: 'Istekla' },
  { id: 'konvertovana', label: 'Račun izdat' },
];

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

const PAYMENTS: { type: PaymentType; icon: React.ReactNode }[] = [
  { type: 'Gotovina', icon: <Banknote size={14} /> },
  { type: 'Kartica', icon: <CreditCard size={14} /> },
  { type: 'Virman', icon: <Building size={14} /> },
  { type: 'Ček', icon: <FileCheck size={14} /> },
];

function StatusChip({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold border text-[10px]',
        size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1',
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * Ponuda je obećanje sa rokom — koliko je roka ostalo je informacija koju
 * lista mora nositi. Prikazuje se samo kad je blizu ili prošlo; inače bi
 * odbrojavanje uz svaki red bilo šum.
 */
function rokOznaka(p: PonudaRow, danas: string): { text: string; cls: string } | null {
  const st = efektivniStatus(p, danas);
  if (st !== 'draft' && st !== 'poslana' && st !== 'istekla') return null;
  const dana = danaIzmedju(danas, p.vaziDo);
  if (dana < 0) return { text: 'isteklo', cls: 'text-rose-400' };
  if (dana === 0) return { text: 'danas', cls: 'text-amber-600' };
  if (dana <= 3) return { text: `${dana} ${dana === 1 ? 'dan' : 'dana'}`, cls: 'text-amber-600' };
  return null;
}

export default function PonudeScreen({ korisnikId }: { korisnikId: number }) {
  const [ponude, setPonude] = useState<PonudaRow[]>([]);
  const [selected, setSelected] = useState<PonudaRow | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Forma (nova / uredi)
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [kupci, setKupci] = useState<any[]>([]);
  const [kupacId, setKupacId] = useState<string>('');
  const [datum, setDatum] = useState('');
  const [vaziDo, setVaziDo] = useState('');
  const [napomena, setNapomena] = useState('');
  const [stavke, setStavke] = useState<FormStavka[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [productIndex, setProductIndex] = useState(0);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Konverzija — iste opcije plaćanja kao na kasi
  const [konvertujOpen, setKonvertujOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [converting, setConverting] = useState(false);
  const [konvertujMsg, setKonvertujMsg] = useState<string | null>(null);

  // Brisanje — vlastiti dijalog umjesto nativnog confirm-a
  const [brisiOpen, setBrisiOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const danas = localDateStr();

  useEffect(() => { loadPonude(); }, []);

  const loadPonude = async () => {
    setPonude(await window.api.getPonude());
  };

  const selectPonuda = async (p: PonudaRow) => {
    setMsg(null);
    setSelected(await window.api.getPonuda(p.id));
  };

  const visible = useMemo(() => {
    if (filter === 'sve') return ponude;
    return ponude.filter(p => efektivniStatus(p, danas) === filter);
  }, [ponude, filter, danas]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: ponude.length };
    for (const f of FILTERS) if (f.id !== 'sve') c[f.id] = 0;
    for (const p of ponude) {
      const st = efektivniStatus(p, danas);
      if (st in c) c[st] += 1;
    }
    return c;
  }, [ponude, danas]);

  const formTotali = useMemo(
    () => izracunajTotale(stavke.map(s => ({ cijena: s.cijena || 0, kolicina: s.kolicina || 0, rabat: s.rabat || 0, pdvStopa: s.pdvStopa }))),
    [stavke]
  );

  // ── Forma ──────────────────────────────────────────────────

  /** Rok važenja u danima — izveden iz para datuma, ne drži se posebno. */
  const rokDana = datum && vaziDo ? danaIzmedju(datum, vaziDo) : DEFAULT_ROK_DANA;

  /**
   * Pomjeranje datuma ponude nosi i rok sa sobom: dogovoreno je "8 dana",
   * a ne "do 18.08." — pa ostaje 8 dana i kad se ponuda datira unaprijed.
   */
  const promijeniDatum = (novi: string) => {
    setDatum(novi);
    setVaziDo(plusDana(novi, rokDana));
  };

  const openNova = useCallback(async () => {
    setEditId(null);
    setKupacId('');
    const danasnji = localDateStr();
    setDatum(danasnji);
    setVaziDo(plusDana(danasnji, DEFAULT_ROK_DANA));
    setNapomena('');
    setStavke([]);
    setProductQuery('');
    setProductResults([]);
    setFormError('');
    setKupci(await window.api.getKupci());
    setFormOpen(true);
  }, []);

  const openUredi = useCallback(async (p: PonudaRow) => {
    const full = p.stavke ? p : await window.api.getPonuda(p.id);
    setEditId(full.id);
    setKupacId(String(full.kupacId));
    setDatum(full.datum);
    setVaziDo(full.vaziDo);
    setNapomena(full.napomena || '');
    setStavke((full.stavke || []).map((s: any) => ({
      productId: s.productId,
      naziv: s.productNaziv || `#${s.productId}`,
      jm: s.productJm || 'kom',
      kolicina: s.kolicina,
      cijena: s.cijena,
      rabat: s.rabat || 0,
      pdvStopa: s.pdvStopa,
    })));
    setProductQuery('');
    setProductResults([]);
    setFormError('');
    setKupci(await window.api.getKupci());
    setFormOpen(true);
  }, []);

  const searchProducts = async (q: string) => {
    setProductQuery(q);
    setProductIndex(0);
    if (q.trim().length < 2) { setProductResults([]); return; }
    setProductResults(await window.api.searchProducts(q.trim()));
  };

  const addStavka = (p: any) => {
    setStavke(prev => {
      const existing = prev.find(s => s.productId === p.id);
      if (existing) {
        return prev.map(s => s.productId === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      }
      return [...prev, {
        productId: p.id, naziv: p.naziv, jm: p.jm || 'kom',
        kolicina: 1, cijena: p.cijena, rabat: 0, pdvStopa: p.pdvStopa,
      }];
    });
    setProductQuery('');
    setProductResults([]);
    setProductIndex(0);
  };

  /** Strelice biraju artikal, Enter ga dodaje — pretraga radi bez miša. */
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (productResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setProductIndex(i => Math.min(productResults.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setProductIndex(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addStavka(productResults[productIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setProductResults([]);
    }
  };

  const savePonuda = async () => {
    setFormError('');
    if (!kupacId) { setFormError('Odaberite kupca'); return; }
    if (stavke.length === 0) { setFormError('Dodajte najmanje jednu stavku'); return; }
    if (stavke.some(s => !s.kolicina || s.kolicina <= 0 || isNaN(s.cijena) || s.cijena < 0)) {
      setFormError('Provjerite količine i cijene stavki'); return;
    }
    setSaving(true);
    try {
      const payload = {
        kupacId: Number(kupacId),
        korisnikId,
        datum,
        vaziDo,
        napomena: napomena.trim() || undefined,
        stavke: stavke.map(s => ({
          productId: s.productId, kolicina: s.kolicina, cijena: s.cijena,
          rabat: s.rabat || 0, pdvStopa: s.pdvStopa,
        })),
      };
      if (editId != null) {
        await window.api.updatePonuda(editId, payload);
        setMsg({ type: 'success', text: 'Ponuda izmijenjena' });
      } else {
        const res = await window.api.createPonuda(payload);
        setMsg({ type: 'success', text: `Ponuda ${res.broj}/${res.godina} kreirana` });
      }
      setFormOpen(false);
      await loadPonude();
      if (editId != null) setSelected(await window.api.getPonuda(editId));
    } catch (err: any) {
      setFormError(err?.message || 'Nepoznata greška');
    } finally {
      setSaving(false);
    }
  };

  // ── Akcije nad ponudom ─────────────────────────────────────

  const changeStatus = async (id: number, status: string) => {
    try {
      await window.api.setPonudaStatus(id, status);
      await loadPonude();
      setSelected(await window.api.getPonuda(id));
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' });
    }
  };

  const deletePonuda = async () => {
    if (!selected || deleting) return;
    setDeleting(true);
    try {
      await window.api.deletePonuda(selected.id);
      setBrisiOpen(false);
      setMsg({ type: 'success', text: `Ponuda ${formatBrojPonude(selected)} obrisana` });
      setSelected(null);
      await loadPonude();
    } catch (err: any) {
      setBrisiOpen(false);
      setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' });
    } finally {
      setDeleting(false);
    }
  };

  const konvertuj = async () => {
    if (!selected || converting) return;
    setConverting(true);
    setKonvertujMsg(null);
    try {
      // Štampa i upis idu kroz jedan poziv — kao refundAndPrint — da ne
      // ostane odštampan račun bez zapisa u bazi.
      const result = await window.api.konvertujPonudu({
        id: selected.id, korisnikId, nacinPlacanja: paymentType,
      });
      if (!result || !result.success) {
        const details = result?.odgovori ? Object.entries(result.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setKonvertujMsg(`Greška: ${result?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}`);
        return;
      }
      setKonvertujOpen(false);
      setMsg({ type: 'success', text: `Račun #${result.brojFiskalnogRacuna ?? ''} izdat po ponudi ${formatBrojPonude(selected)}` });
      await loadPonude();
      setSelected(await window.api.getPonuda(selected.id));
    } catch (err: any) {
      setKonvertujMsg(`Greška: ${err?.message || 'Nepoznata greška'}`);
    } finally {
      setConverting(false);
    }
  };

  // ── PDF ────────────────────────────────────────────────────

  const loadFirma = async () => {
    try {
      return await window.api.getFirmaSettings();
    } catch {
      return { naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', logo: '', bankAccounts: [] };
    }
  };

  const buildPdfBlob = async (p: PonudaRow) => {
    const full = p.stavke ? p : await window.api.getPonuda(p.id);
    const firma = await loadFirma();
    return pdf(<PonudaPdf ponuda={full as any} firma={firma} />).toBlob();
  };

  const handlePrintPdf = async (p: PonudaRow) => {
    const blob = await buildPdfBlob(p);
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };

  const handleExportPdf = async (p: PonudaRow) => {
    const blob = await buildPdfBlob(p);
    const savePath = await window.api.showSaveDialog({
      defaultName: `Ponuda-${p.broj}-${p.godina}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!savePath) return;
    const arrayBuffer = await blob.arrayBuffer();
    await window.api.writeFile(savePath, Array.from(new Uint8Array(arrayBuffer)) as any);
  };

  const selStatus = selected ? efektivniStatus(selected, danas) : '';
  const selEditable = Boolean(selected && selected.status !== 'konvertovana');

  // ── Tastatura ──────────────────────────────────────────────

  const selIndex = visible.findIndex(p => p.id === selected?.id);

  /** Pomjera izbor u listi i drži fokus na redu — osnova za tastaturnu navigaciju. */
  const focusRow = useCallback((index: number) => {
    if (index < 0 || index >= visible.length) return;
    selectPonuda(visible[index]);
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
        if (selected) { e.preventDefault(); handlePrintPdf(selected); }
        return;
      default:
    }
  };

  const anyDialogOpen = formOpen || konvertujOpen || brisiOpen;

  /**
   * Prečice ekrana. Filteri idu na zagrade jer su cifre rezervisane za promjenu
   * statusa — status je srž toka ponude i zaslužuje najkraći potez. Konverzija i
   * brisanje nikad ne djeluju odmah: otvaraju dijalog s potvrdom.
   */
  useEffect(() => {
    if (anyDialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const cycleFilter = (step: number) => {
        e.preventDefault();
        const i = FILTERS.findIndex(f => f.id === filter);
        setFilter(FILTERS[(i + step + FILTERS.length) % FILTERS.length].id);
      };

      // Strelice lijevo/desno rade na svakom rasporedu tastature; zagrade su
      // alias jer na bosanskom rasporedu traže AltGr, a Alt gasi prečice.
      if (e.key === 'ArrowLeft' || e.key === '[') return cycleFilter(-1);
      if (e.key === 'ArrowRight' || e.key === ']') return cycleFilter(1);
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); openNova(); return; }
      if (e.key === 'Escape' && selected) { e.preventDefault(); setSelected(null); return; }

      if (!selected) return;

      switch (e.key.toLowerCase()) {
        case 'p': e.preventDefault(); handlePrintPdf(selected); break;
        case 's': e.preventDefault(); handleExportPdf(selected); break;
        case 'u':
          if (selEditable) { e.preventDefault(); openUredi(selected); }
          break;
        case 'k':
          if (selEditable) {
            e.preventDefault();
            setKonvertujMsg(null);
            setPaymentType('Gotovina');
            setKonvertujOpen(true);
          }
          break;
        case 'd':
          if (selEditable) { e.preventDefault(); setBrisiOpen(true); }
          break;
        case '1': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'poslana'); } break;
        case '2': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'prihvacena'); } break;
        case '3': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'odbijena'); } break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selEditable, filter, anyDialogOpen, openNova, openUredi]);

  /** ⌘↵ potvrđuje dijalog s bilo kojeg polja. */
  const submitOnMeta = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f6f9]">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200/80 px-6 py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight">Ponude</h2>
            <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadPonude} className="h-8 gap-1.5 text-[12px]">
              <RefreshCw className="h-3.5 w-3.5" />
              Osvježi
            </Button>
            <Button size="sm" onClick={openNova} className="h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Nova ponuda
            </Button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={cn(
          'mx-5 mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-medium',
          msg.type === 'error'
            ? 'bg-rose-50/70 border-rose-200 text-rose-700'
            : 'bg-emerald-50/70 border-emerald-200 text-emerald-700',
        )}>
          {msg.type === 'error' ? <AlertTriangle size={14} /> : <Receipt size={14} />}
          {msg.text}
          <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setMsg(null)} aria-label="Zatvori poruku">
            <X size={13} />
          </button>
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
                  <FileText size={20} className="text-slate-300" strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-medium text-slate-500">
                  {filter === 'sve' ? 'Još nema ponuda' : 'Nema ponuda u ovom filteru'}
                </p>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  {filter === 'sve' ? 'Kreirajte ponudu za kupca.' : 'Promijenite filter da vidite ostale.'}
                </p>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1">
                  <table className="w-full border-separate border-spacing-0">
                    <LedgerHead
                      columns={[
                        { label: 'Broj', className: 'text-left pl-5 pr-2 w-[80px]' },
                        { label: 'Datum', className: 'text-left px-2' },
                        { label: 'Kupac', className: 'text-left px-2' },
                        { label: 'Ukupno', className: 'text-right px-2' },
                        { label: 'Važi do', className: 'text-left px-2' },
                        { label: 'Status', className: 'text-right pr-5 pl-2 w-[110px]' },
                      ]}
                    />
                    <tbody onKeyDown={handleListKeyDown}>
                      {visible.map((p, i) => {
                        const st = efektivniStatus(p, danas);
                        const isSel = selected?.id === p.id;
                        const rok = rokOznaka(p, danas);
                        return (
                          <tr
                            key={p.id}
                            ref={el => { rowRefs.current[i] = el; }}
                            tabIndex={isSel || (selIndex < 0 && i === 0) ? 0 : -1}
                            aria-selected={isSel}
                            className={cn(
                              'cursor-pointer transition-colors duration-100 group',
                              'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                              isSel
                                ? 'bg-blue-50/80'
                                : st === 'istekla'
                                  ? 'bg-amber-50/30 hover:bg-amber-50/60'
                                  : 'hover:bg-slate-50',
                            )}
                            onClick={() => { selectPonuda(p); rowRefs.current[i]?.focus(); }}
                          >
                            <td
                              className={cn(
                                'pl-5 pr-2 py-2.5 border-b border-slate-100 font-mono text-[11.5px] font-semibold tabular-nums',
                                // Šina lijevo označava isključivo izabrani red — status ide kroz čip.
                                isSel ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-500',
                              )}
                            >
                              {formatBrojPonude(p)}
                            </td>
                            <td className={cn('px-2 py-2.5 border-b border-slate-100 text-[12px] tabular-nums', isSel ? 'text-slate-700' : 'text-slate-500')}>
                              {formatDate(p.datum)}
                            </td>
                            <td className={cn('px-2 py-2.5 border-b border-slate-100 text-[12px] truncate max-w-[220px]', isSel ? 'text-slate-700' : 'text-slate-500')}>
                              {p.kupacNaziv || '—'}
                            </td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">
                              {formatKM(p.ukupno)}
                            </td>
                            <td className="px-2 py-2.5 border-b border-slate-100">
                              <span className={cn('text-[12px] tabular-nums', isSel ? 'text-slate-600' : 'text-slate-400')}>
                                {formatDate(p.vaziDo)}
                              </span>
                              {rok && (
                                <span className={cn('ml-1.5 text-[11px] font-medium', rok.cls)}>· {rok.text}</span>
                              )}
                            </td>
                            <td className="pr-5 pl-2 py-2.5 border-b border-slate-100 text-right">
                              <StatusChip status={st} />
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
                    <CornerDownLeft size={11} /> štampa ponudu
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ChevronsLeftRight size={11} /> filteri
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
          {selected ? (
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">

              {/* Zaglavlje */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Eyebrow>{selStatus === 'konvertovana' ? 'Ponuda po kojoj je izdat račun' : 'Ponuda kupcu'}</Eyebrow>
                    <h3 className="text-[19px] font-bold font-mono tracking-tight text-slate-900 leading-tight mt-1">
                      {formatBrojPonude(selected)}
                    </h3>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums">
                      {formatDate(selected.datum)} · važi do {formatDate(selected.vaziDo)}
                    </p>
                  </div>
                  <StatusChip status={selStatus} size="md" />
                </div>
              </div>

              {/* Meta */}
              <div className="flex-shrink-0 px-5 pb-4">
                <dl className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-2 text-[12px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400 flex-shrink-0">Kupac</dt>
                    <dd className="font-medium text-slate-700 text-right truncate">{selected.kupacNaziv || '—'}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-400">Sastavio</dt>
                    <dd className="font-medium text-slate-700">{selected.korisnikIme || '—'}</dd>
                  </div>
                  {selected.racunBroj && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-violet-400">Fiskalni račun</dt>
                      <dd className="font-mono font-medium text-violet-600">#{selected.racunBroj}</dd>
                    </div>
                  )}
                  {selected.napomena && (
                    <div className="pt-2 border-t border-slate-200/70">
                      <p className="text-[11.5px] text-slate-500 leading-relaxed">{selected.napomena}</p>
                    </div>
                  )}
                </dl>
              </div>

              {/* Stavke */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100">
                <div className="flex items-center justify-between px-5 py-2 bg-slate-50/40">
                  <Eyebrow>Stavke</Eyebrow>
                  <span className="font-mono text-[10px] tabular-nums text-slate-400">
                    {(selected.stavke || []).length}
                  </span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="divide-y divide-slate-50">
                    {(selected.stavke || []).map((s: any, i: number) => {
                      const lineTotal = s.cijena * s.kolicina * (1 - (s.rabat || 0) / 100);
                      const linePdv = pdvStavke({
                        cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat || 0, pdvStopa: s.pdvStopa,
                      });
                      return (
                        <div key={s.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
                          <span className="text-[10px] text-slate-300 font-mono tabular-nums w-4 text-right flex-shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-slate-700 truncate">{s.productNaziv || `#${s.productId}`}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono tabular-nums">{s.kolicina} × {formatKM(s.cijena)}</span>
                              {(s.rabat || 0) > 0 && (
                                <span className="text-[9px] font-bold px-1 py-px rounded bg-blue-500/10 text-blue-600">-{s.rabat}%</span>
                              )}
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="text-[12.5px] font-mono font-semibold text-slate-800 tabular-nums">
                              {formatKM(lineTotal)}
                            </p>
                            <p className="text-[10px] font-mono text-slate-400 tabular-nums mt-0.5">
                              {s.pdvStopa === 'E' ? `PDV ${formatKM(linePdv)}` : 'bez PDV-a'}
                            </p>
                          </div>
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
                  <span className="font-mono tabular-nums text-slate-600">{formatKM(selected.ukupno - selected.pdvIznos)}</span>
                </div>
                <div className="flex items-center justify-between text-[11.5px] mt-1">
                  <span className="text-slate-400">PDV (17%)</span>
                  <span className="font-mono tabular-nums text-slate-600">{formatKM(selected.pdvIznos)}</span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-baseline justify-between">
                  <span className="text-[12.5px] font-semibold text-slate-800">Ukupno</span>
                  <span className="text-[22px] font-bold font-mono tabular-nums tracking-tight text-slate-900">
                    {formatKM(selected.ukupno)}
                  </span>
                </div>
              </div>

              {/* Akcije */}
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3.5 space-y-2">
                <ActionRow
                  icon={Printer}
                  label="Štampaj ponudu"
                  hint="P"
                  tone={selEditable ? 'default' : 'primary'}
                  onClick={() => handlePrintPdf(selected)}
                  trailing={{ icon: Download, onClick: () => handleExportPdf(selected), title: 'Spremi ponudu kao PDF — S' }}
                />

                {selEditable && (
                  <>
                    <ActionRow
                      icon={Pencil}
                      label="Uredi ponudu"
                      hint="U"
                      onClick={() => openUredi(selected)}
                      trailing={{ icon: Trash2, onClick: () => setBrisiOpen(true), title: 'Obriši ponudu — D' }}
                    />

                    {/* Status je tok, ne skup dugmadi — tri koraka, tri cifre. */}
                    <div className="pt-1.5">
                      <Eyebrow className="block pb-1.5">Status ponude</Eyebrow>
                      <div className="grid grid-cols-3 gap-1.5">
                        {([
                          { st: 'poslana', label: 'Poslana', hint: '1', icon: Send, cls: 'text-blue-600 border-blue-100 bg-blue-50/60 hover:bg-blue-50', on: 'bg-blue-500 text-white border-blue-500' },
                          { st: 'prihvacena', label: 'Prihvaćena', hint: '2', icon: Check, cls: 'text-emerald-600 border-emerald-100 bg-emerald-50/60 hover:bg-emerald-50', on: 'bg-emerald-500 text-white border-emerald-500' },
                          { st: 'odbijena', label: 'Odbijena', hint: '3', icon: Ban, cls: 'text-rose-600 border-rose-100 bg-rose-50/60 hover:bg-rose-50', on: 'bg-rose-500 text-white border-rose-500' },
                        ] as const).map(s => {
                          const active = selected.status === s.st;
                          return (
                            <button
                              key={s.st}
                              onClick={() => changeStatus(selected.id, s.st)}
                              aria-pressed={active}
                              className={cn(
                                'h-9 flex flex-col items-center justify-center gap-0.5 rounded-lg border text-[10.5px] font-medium',
                                'transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                                active ? s.on : s.cls,
                              )}
                            >
                              <span className="flex items-center gap-1">
                                <s.icon size={11} />
                                {s.label}
                              </span>
                              <span className={cn('font-mono text-[9px]', active ? 'text-white/60' : 'text-slate-400')}>
                                {s.hint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2 mt-1 border-t border-slate-100">
                      <ActionRow
                        icon={Receipt}
                        label={selStatus === 'istekla' ? 'Konvertuj (istekla)' : 'Konvertuj u račun'}
                        hint="K"
                        tone="primary"
                        onClick={() => { setKonvertujMsg(null); setPaymentType('Gotovina'); setKonvertujOpen(true); }}
                      />
                    </div>
                  </>
                )}

                {!selEditable && (
                  <p className="text-[11px] text-slate-400 pt-1">
                    Račun je izdat po ovoj ponudi — ponuda se više ne mijenja.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col items-center justify-center px-8 text-center select-none">
              <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <FileText size={20} className="text-slate-300" strokeWidth={1.5} />
              </div>
              <p className="text-[13px] font-medium text-slate-500">Odaberite ponudu</p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                Kliknite red ili se krećite strelicama — detalji i akcije se pojavljuju ovdje.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Nova / Uredi ponuda ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent
          className="sm:max-w-[640px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col"
          onKeyDown={submitOnMeta(savePonuda)}
        >
          <div className="px-6 pt-6 pb-4 flex-shrink-0">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">
                    {editId != null ? 'Uredi ponudu' : 'Nova ponuda'}
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Nefiskalni predračun — cijene se zamrzavaju u trenutku snimanja
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <Separator />

          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Kupac + datumi */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Eyebrow className="block">Kupac</Eyebrow>
                <Select value={kupacId} onValueChange={setKupacId}>
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Odaberite kupca" />
                  </SelectTrigger>
                  <SelectContent>
                    {kupci.map(k => (
                      <SelectItem key={k.id} value={String(k.id)}>
                        {k.naziv} <span className="text-slate-400 font-mono text-[11px]">({k.idBroj})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {kupci.length === 0 && (
                  <p className="text-[11px] text-amber-600">
                    Nema kupaca u šifarniku — dodajte kupca u Postavkama.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Eyebrow className="block">Datum</Eyebrow>
                <DatePicker value={datum} onChange={promijeniDatum} className="h-9 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Eyebrow className="block">Važi do</Eyebrow>
                <DatePicker
                  value={vaziDo} onChange={setVaziDo} minDate={datum}
                  className="h-9 text-[13px]"
                />
                <p className="text-[10px] text-slate-400">{opisRoka(rokDana)}</p>
              </div>
            </div>

            {/* Stavke */}
            <div className="space-y-2">
              <Eyebrow className="block">Stavke</Eyebrow>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={productQuery}
                  onChange={e => searchProducts(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Pretraži artikle (naziv, šifra, barkod) — ↑↓ bira, ↵ dodaje"
                  className="h-9 pl-9 text-[13px]"
                />
                {productResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {productResults.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => addStavka(p)}
                        onMouseEnter={() => setProductIndex(i)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                          i === productIndex ? 'bg-blue-50/80' : 'hover:bg-slate-50',
                        )}
                      >
                        <div>
                          <p className="text-[12px] font-medium text-slate-700">{p.naziv}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{p.sifra} · stanje: {p.stanje}</p>
                        </div>
                        <span className="text-[12px] font-mono font-semibold text-slate-700">{formatKM(p.cijena)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {stavke.length > 0 && (
                <div className="border border-slate-100 rounded-lg divide-y divide-slate-50">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/70 text-[10px] font-semibold text-slate-400 uppercase tracking-[0.14em]">
                    <span className="w-4 flex-shrink-0" />
                    <span className="flex-1 min-w-0">Artikal</span>
                    <span className="w-16 text-right">Kol.</span>
                    <span className="w-20 text-right">Cijena</span>
                    <span className="w-14 text-right">Rabat %</span>
                    <span className="w-20 text-right">PDV</span>
                    <span className="w-[14px] flex-shrink-0" />
                  </div>
                  {stavke.map((s, i) => (
                    <div key={s.productId} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-[10px] text-slate-300 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                      <p className="flex-1 min-w-0 text-[12px] font-medium text-slate-700 truncate">{s.naziv}</p>
                      <div className="w-16">
                        <DecimalInput
                          value={s.kolicina}
                          onValueChange={(_, v) => setStavke(prev => prev.map((x, xi) => xi === i ? { ...x, kolicina: isNaN(v) ? 0 : v } : x))}
                          maxDecimals={3}
                          className="h-7 text-[12px] text-right font-mono"
                          title="Količina"
                        />
                      </div>
                      <div className="w-20">
                        <DecimalInput
                          value={s.cijena}
                          onValueChange={(_, v) => setStavke(prev => prev.map((x, xi) => xi === i ? { ...x, cijena: isNaN(v) ? NaN : v } : x))}
                          className="h-7 text-[12px] text-right font-mono"
                          title="Cijena"
                        />
                      </div>
                      <div className="w-14">
                        <DecimalInput
                          value={s.rabat}
                          onValueChange={(_, v) => setStavke(prev => prev.map((x, xi) => xi === i ? { ...x, rabat: isNaN(v) ? 0 : Math.min(100, v) } : x))}
                          className="h-7 text-[12px] text-right font-mono"
                          title="Rabat %"
                        />
                      </div>
                      <span className="w-20 text-right text-[12px] font-mono tabular-nums text-slate-500">
                        {s.pdvStopa === 'E'
                          ? formatKM(pdvStavke({
                              cijena: s.cijena || 0, kolicina: s.kolicina || 0,
                              rabat: s.rabat || 0, pdvStopa: s.pdvStopa,
                            }) || 0)
                          : '—'}
                      </span>
                      <button
                        onClick={() => setStavke(prev => prev.filter((_, xi) => xi !== i))}
                        title={`Ukloni ${s.naziv}`}
                        aria-label={`Ukloni ${s.naziv}`}
                        className="text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50/50">
                    <span className="text-[11px] text-slate-400">Ukupno</span>
                    <span className="text-[13px] font-mono font-bold text-slate-800 tabular-nums">
                      {formatKM(isNaN(formTotali.ukupno) ? 0 : formTotali.ukupno)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Napomena */}
            <div className="space-y-1.5">
              <Eyebrow className="block">Napomena</Eyebrow>
              <Input
                value={napomena} onChange={e => setNapomena(e.target.value)}
                placeholder="Napomena na ponudi (opcionalno)" className="h-9 text-[13px]"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600">
                <AlertTriangle size={13} />
                {formError}
              </div>
            )}
          </div>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0">
            <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Key className="ml-0">⌘↵</Key> snimi · <Key className="ml-0">esc</Key> otkaži
            </span>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Otkaži</Button>
              <Button onClick={savePonuda} disabled={saving} className="min-w-[140px]">
                {saving ? 'Snimam…' : editId != null ? 'Snimi izmjene' : 'Kreiraj ponudu'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Konvertuj u račun ── */}
      <Dialog open={konvertujOpen} onOpenChange={setKonvertujOpen}>
        <DialogContent
          className="sm:max-w-[440px] p-0 gap-0 overflow-hidden"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); konvertuj(); return; }
            const i = Number(e.key);
            if (i >= 1 && i <= PAYMENTS.length) { e.preventDefault(); setPaymentType(PAYMENTS[i - 1].type); }
          }}
        >
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                  <Receipt className="h-5 w-5 text-violet-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">
                    Konvertuj ponudu {selected ? formatBrojPonude(selected) : ''}
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Izdaje fiskalni račun po cijenama sa ponude
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <Separator />

          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-amber-700">Fiskalni račun će biti odštampan</p>
                <p className="text-[11px] text-amber-600/70 mt-0.5">
                  Račun se štampa na Tring fiskalnom printeru i razdužuje skladište.
                  Cijene idu sa ponude, ne iz cjenovnika. Provjerite da je printer uključen.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Eyebrow className="block">Način plaćanja</Eyebrow>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENTS.map((p, i) => (
                  <button
                    key={p.type}
                    onClick={() => setPaymentType(p.type)}
                    aria-pressed={paymentType === p.type}
                    className={cn(
                      'h-10 flex items-center gap-2 rounded-lg border px-3 text-[12px] font-medium transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                      paymentType === p.type
                        ? 'bg-[#0f1629] text-white border-[#0f1629]'
                        : 'text-slate-600 border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    {p.icon}
                    {p.type}
                    <Key tone={paymentType === p.type ? 'dark' : 'light'}>{i + 1}</Key>
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <span className="text-[12px] text-slate-500">Za naplatu</span>
                <span className="text-[18px] font-bold font-mono tabular-nums text-slate-900">{formatKM(selected.ukupno)}</span>
              </div>
            )}

            {konvertujMsg && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600">
                <AlertTriangle size={13} />
                {konvertujMsg}
              </div>
            )}
          </div>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Key className="ml-0">⌘↵</Key> izdaj
            </span>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setKonvertujOpen(false)}>Otkaži</Button>
              <Button onClick={konvertuj} disabled={converting} className="min-w-[160px]">
                {converting ? 'Štampam…' : 'Izdaj fiskalni račun'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Obriši ponudu ── */}
      <Dialog open={brisiOpen} onOpenChange={setBrisiOpen}>
        <DialogContent
          className="sm:max-w-[420px] p-0 gap-0 overflow-hidden"
          onKeyDown={submitOnMeta(deletePonuda)}
        >
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <DialogTitle className="text-lg">
                    Obriši ponudu {selected ? formatBrojPonude(selected) : ''}
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Ponuda i njene stavke se brišu trajno
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <Separator />
          <div className="px-6 py-5">
            <div className="flex items-start gap-3 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-rose-500 mt-0.5 flex-shrink-0" />
              <p className="text-[11.5px] text-rose-600/80">
                Broj ponude se ne dodjeljuje ponovo — u nizu ostaje praznina.
                Ako je ponuda samo otpala, radije je označite kao odbijenu.
              </p>
            </div>
          </div>
          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Key className="ml-0">⌘↵</Key> obriši
            </span>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setBrisiOpen(false)}>Otkaži</Button>
              <Button variant="destructive" onClick={deletePonuda} disabled={deleting} className="min-w-[120px]">
                {deleting ? 'Brišem…' : 'Obriši ponudu'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
