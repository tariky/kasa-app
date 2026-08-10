import { useState, useEffect, useMemo } from 'react';
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  RotateCcw, FileText, AlertTriangle, Printer, Download, Plus, Trash2, Pencil,
  User as UserIcon, Building2, ChevronRight, Receipt, Search, X, Banknote, CreditCard,
  Building, FileCheck,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { PonudaPdf } from '@/components/PonudaPdf';
import { formatBrojPonude, efektivniStatus, plusDana, danaIzmedju, DEFAULT_ROK_DANA } from '@/lib/ponuda';
import { izracunajTotale } from '@/lib/racun';
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
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
  poslana: { label: 'Poslana', cls: 'bg-blue-50 text-blue-600 border border-blue-100' },
  prihvacena: { label: 'Prihvaćena', cls: 'bg-emerald-50 text-emerald-600 border border-emerald-100' },
  odbijena: { label: 'Odbijena', cls: 'bg-red-50 text-red-500 border border-red-100' },
  istekla: { label: 'Istekla', cls: 'bg-amber-50 text-amber-600 border border-amber-100' },
  konvertovana: { label: 'Račun izdat', cls: 'bg-violet-50 text-violet-600 border border-violet-100' },
};

const FILTERS = ['sve', 'draft', 'poslana', 'prihvacena', 'odbijena', 'istekla', 'konvertovana'] as const;

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

const paymentIcons: Record<PaymentType, React.ReactNode> = {
  Gotovina: <Banknote size={14} />,
  Kartica: <CreditCard size={14} />,
  Virman: <Building size={14} />,
  'Ček': <FileCheck size={14} />,
};

export default function PonudeScreen({ korisnikId }: { korisnikId: number }) {
  const [ponude, setPonude] = useState<PonudaRow[]>([]);
  const [selected, setSelected] = useState<PonudaRow | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('sve');
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
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Konverzija — iste opcije plaćanja kao na kasi
  const [konvertujOpen, setKonvertujOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [converting, setConverting] = useState(false);
  const [konvertujMsg, setKonvertujMsg] = useState<string | null>(null);

  useEffect(() => { loadPonude(); }, []);

  const loadPonude = async () => {
    setPonude(await window.api.getPonude());
  };

  const selectPonuda = async (p: PonudaRow) => {
    setMsg(null);
    setSelected(await window.api.getPonuda(p.id));
  };

  const filtered = useMemo(() => {
    if (filter === 'sve') return ponude;
    return ponude.filter(p => efektivniStatus(p) === filter);
  }, [ponude, filter]);

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

  const openNova = async () => {
    setEditId(null);
    setKupacId('');
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const danas = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    setDatum(danas);
    setVaziDo(plusDana(danas, DEFAULT_ROK_DANA));
    setNapomena('');
    setStavke([]);
    setProductQuery('');
    setProductResults([]);
    setFormError('');
    setKupci(await window.api.getKupci());
    setFormOpen(true);
  };

  const openUredi = async (p: PonudaRow) => {
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
  };

  const searchProducts = async (q: string) => {
    setProductQuery(q);
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

  const deletePonuda = async (p: PonudaRow) => {
    if (!window.confirm(`Obrisati ponudu ${formatBrojPonude(p)}?`)) return;
    try {
      await window.api.deletePonuda(p.id);
      setSelected(null);
      await loadPonude();
      setMsg({ type: 'success', text: `Ponuda ${formatBrojPonude(p)} obrisana` });
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' });
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

  const selStatus = selected ? efektivniStatus(selected) : '';
  const selEditable = selected && selected.status !== 'konvertovana';

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold text-slate-800">Ponude</span>
            {ponude.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                {ponude.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadPonude} className="h-8 gap-1.5 text-[12px]">
              <RotateCcw className="h-3.5 w-3.5" />
              Osvježi
            </Button>
            <Button size="sm" onClick={openNova} className="h-8 gap-1.5 text-[12px]">
              <Plus className="h-3.5 w-3.5" />
              Nova ponuda
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">

        {/* ── Left: list ── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
            {/* Filter */}
            <div className="flex-shrink-0 flex items-center gap-1 px-4 pt-3 pb-2 flex-wrap">
              {FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors',
                    filter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  {f === 'sve' ? 'Sve' : STATUS_META[f]?.label ?? f}
                </button>
              ))}
            </div>

            {msg && (
              <div className={cn(
                'mx-4 mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium',
                msg.type === 'error'
                  ? 'bg-red-50 border border-red-100 text-red-600'
                  : 'bg-emerald-50 border border-emerald-100 text-emerald-600',
              )}>
                {msg.type === 'error' ? <AlertTriangle size={12} /> : <Receipt size={12} />}
                {msg.text}
                <button className="ml-auto" onClick={() => setMsg(null)}><X size={12} /></button>
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <FileText size={24} className="text-slate-300" />
                </div>
                <p className="text-[13px] font-medium text-slate-500">Nema ponuda</p>
                <p className="text-[12px] text-slate-400 mt-0.5">Kreirajte novu ponudu za kupca</p>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                    <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      <th className="text-left pl-5 pr-2 py-2.5 w-[80px]">Broj</th>
                      <th className="text-left px-2 py-2.5">Datum</th>
                      <th className="text-left px-2 py-2.5">Kupac</th>
                      <th className="text-right px-2 py-2.5">Ukupno</th>
                      <th className="text-left px-2 py-2.5">Važi do</th>
                      <th className="text-center pr-5 pl-2 py-2.5 w-[110px]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => {
                      const st = efektivniStatus(p);
                      const meta = STATUS_META[st] ?? STATUS_META.draft;
                      const isSel = selected?.id === p.id;
                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            'border-t border-slate-50 transition-colors cursor-pointer',
                            isSel ? 'bg-slate-900 text-white' : 'hover:bg-slate-50/50',
                          )}
                          onClick={() => selectPonuda(p)}
                        >
                          <td className={cn('pl-5 pr-2 py-2.5 text-[12px] font-mono font-semibold', isSel ? 'text-white' : 'text-slate-700')}>
                            {formatBrojPonude(p)}
                          </td>
                          <td className={cn('px-2 py-2.5 text-[12px] tabular-nums', isSel ? 'text-white/80' : 'text-slate-600')}>
                            {formatDate(p.datum)}
                          </td>
                          <td className={cn('px-2 py-2.5 text-[12px]', isSel ? 'text-white/80' : 'text-slate-600')}>
                            {p.kupacNaziv || '—'}
                          </td>
                          <td className={cn('px-2 py-2.5 text-[13px] font-mono font-semibold text-right tabular-nums', isSel ? 'text-white' : 'text-slate-800')}>
                            {formatKM(p.ukupno)}
                          </td>
                          <td className={cn('px-2 py-2.5 text-[12px] tabular-nums', isSel ? 'text-white/60' : 'text-slate-400')}>
                            {formatDate(p.vaziDo)}
                          </td>
                          <td className="pr-5 pl-2 py-2.5 text-center">
                            <span className={cn(
                              'inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5',
                              isSel ? 'bg-white/10 text-white/90' : meta.cls,
                            )}>
                              {meta.label}
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

        {/* ── Right: detail ── */}
        <div className="w-[400px] flex-shrink-0">
          {selected ? (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
              {/* Header */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                      <FileText size={18} className="text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-[16px] font-bold text-slate-800 leading-tight">
                        Ponuda {formatBrojPonude(selected)}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                        {formatDate(selected.datum)} · važi do {formatDate(selected.vaziDo)}
                      </p>
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex items-center text-[10px] font-semibold rounded-full px-2.5 py-1',
                    (STATUS_META[selStatus] ?? STATUS_META.draft).cls,
                  )}>
                    {(STATUS_META[selStatus] ?? STATUS_META.draft).label}
                  </span>
                </div>
              </div>

              {/* Meta */}
              <div className="flex-shrink-0 px-5 pb-4">
                <div className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 size={13} className="text-slate-400" />
                      <span className="text-[11px] text-slate-400">Kupac</span>
                    </div>
                    <span className="text-[12px] font-medium text-slate-700">{selected.kupacNaziv || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <UserIcon size={13} className="text-slate-400" />
                      <span className="text-[11px] text-slate-400">Sastavio</span>
                    </div>
                    <span className="text-[12px] font-medium text-slate-700">{selected.korisnikIme || '—'}</span>
                  </div>
                  {selected.racunBroj && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Receipt size={13} className="text-violet-400" />
                        <span className="text-[11px] text-violet-400">Fiskalni račun</span>
                      </div>
                      <span className="text-[12px] font-mono font-medium text-violet-600">#{selected.racunBroj}</span>
                    </div>
                  )}
                  {selected.napomena && (
                    <div className="pt-1 border-t border-slate-100">
                      <p className="text-[11px] text-slate-500">{selected.napomena}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Stavke */}
              <div className="flex-1 min-h-0 flex flex-col border-t border-slate-100">
                <div className="px-5 py-2 bg-slate-50/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Stavke</span>
                    <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-4">
                      {(selected.stavke || []).length}
                    </Badge>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="divide-y divide-slate-50">
                    {(selected.stavke || []).map((s: any, i: number) => {
                      const lineTotal = s.cijena * s.kolicina * (1 - (s.rabat || 0) / 100);
                      return (
                        <div key={s.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
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
                          <span className="text-[13px] font-mono font-semibold text-slate-800 tabular-nums flex-shrink-0">
                            {formatKM(lineTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 border-t border-slate-100">
                <div className="px-5 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Osnovica</span>
                    <span className="text-[12px] font-mono tabular-nums text-slate-600">{formatKM(selected.ukupno - selected.pdvIznos)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">PDV (17%)</span>
                    <span className="text-[12px] font-mono tabular-nums text-slate-600">{formatKM(selected.pdvIznos)}</span>
                  </div>
                </div>
                <div className="mx-5 border-t border-slate-100" />
                <div className="px-5 py-3 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-800">Ukupno</span>
                  <span className="text-[18px] font-bold font-mono tabular-nums tracking-tight text-slate-900">{formatKM(selected.ukupno)}</span>
                </div>

                {/* Actions */}
                <div className="px-5 pb-4 pt-1 flex flex-col gap-2">
                  {/* PDF row */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePrintPdf(selected)}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                    >
                      <Printer size={13} />
                      Štampaj
                    </button>
                    <button
                      onClick={() => handleExportPdf(selected)}
                      className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                    >
                      <Download size={13} />
                      PDF
                    </button>
                  </div>

                  {/* Status row */}
                  {selEditable && (
                    <div className="flex items-center gap-2">
                      {selected.status !== 'poslana' && (
                        <button
                          onClick={() => changeStatus(selected.id, 'poslana')}
                          className="flex-1 h-8 text-[11px] font-medium text-blue-600 bg-blue-50 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"
                        >
                          Poslana
                        </button>
                      )}
                      {selected.status !== 'prihvacena' && (
                        <button
                          onClick={() => changeStatus(selected.id, 'prihvacena')}
                          className="flex-1 h-8 text-[11px] font-medium text-emerald-600 bg-emerald-50 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors"
                        >
                          Prihvaćena
                        </button>
                      )}
                      {selected.status !== 'odbijena' && (
                        <button
                          onClick={() => changeStatus(selected.id, 'odbijena')}
                          className="flex-1 h-8 text-[11px] font-medium text-red-500 bg-red-50 rounded-lg border border-red-100 hover:bg-red-100 transition-colors"
                        >
                          Odbijena
                        </button>
                      )}
                    </div>
                  )}

                  {/* Edit / Delete row */}
                  {selEditable && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openUredi(selected)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-100 hover:bg-slate-100 transition-colors"
                      >
                        <Pencil size={13} />
                        Uredi
                      </button>
                      <button
                        onClick={() => deletePonuda(selected)}
                        className="flex-1 flex items-center justify-center gap-1.5 h-8 text-[11px] font-medium text-red-500 bg-red-50/50 rounded-lg border border-red-100 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                        Obriši
                      </button>
                    </div>
                  )}

                  {/* Konvertuj */}
                  {selEditable && (
                    <button
                      onClick={() => { setKonvertujMsg(null); setPaymentType('Gotovina'); setKonvertujOpen(true); }}
                      className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-slate-900 text-[12px] font-medium text-white hover:bg-slate-800 transition-all"
                    >
                      <Receipt size={13} />
                      Konvertuj u račun
                      {selStatus === 'istekla' && <span className="text-amber-300 text-[10px]">(istekla)</span>}
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
              <p className="text-[13px] font-medium text-slate-500">Odaberite ponudu</p>
              <p className="text-[12px] text-slate-400 mt-0.5">iz liste za prikaz detalja</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Nova / Uredi ponuda ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
          <div className="px-6 pt-6 pb-4 flex-shrink-0">
            <DialogHeader>
              <DialogTitle className="text-lg">
                {editId != null ? 'Uredi ponudu' : 'Nova ponuda'}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Nefiskalni predračun — cijene se zamrzavaju u trenutku snimanja
              </DialogDescription>
            </DialogHeader>
          </div>
          <Separator />

          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Kupac + datumi */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Kupac</Label>
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
                <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Datum</Label>
                <DatePicker value={datum} onChange={promijeniDatum} className="h-9 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Važi do</Label>
                <DatePicker
                  value={vaziDo} onChange={setVaziDo} minDate={datum}
                  className="h-9 text-[13px]"
                />
                <p className="text-[10px] text-slate-400">{opisRoka(rokDana)}</p>
              </div>
            </div>

            {/* Stavke */}
            <div className="space-y-2">
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Stavke</Label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={productQuery}
                  onChange={e => searchProducts(e.target.value)}
                  placeholder="Pretraži artikle (naziv, šifra, barkod)…"
                  className="h-9 pl-9 text-[13px]"
                />
                {productResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {productResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addStavka(p)}
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition-colors"
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
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/70 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    <span className="w-4 flex-shrink-0" />
                    <span className="flex-1 min-w-0">Artikal</span>
                    <span className="w-16 text-right">Kol.</span>
                    <span className="w-20 text-right">Cijena</span>
                    <span className="w-14 text-right">Rabat %</span>
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
                      <button
                        onClick={() => setStavke(prev => prev.filter((_, xi) => xi !== i))}
                        className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50/50">
                    <span className="text-[11px] text-slate-400">Ukupno</span>
                    <span className="text-[13px] font-mono font-bold text-slate-800">
                      {formatKM(isNaN(formTotali.ukupno) ? 0 : formTotali.ukupno)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Napomena */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Napomena</Label>
              <Input
                value={napomena} onChange={e => setNapomena(e.target.value)}
                placeholder="Napomena na ponudi (opcionalno)" className="h-9 text-[13px]"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[12px] font-medium text-red-600">
                <AlertTriangle size={13} />
                {formError}
              </div>
            )}
          </div>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3 flex-shrink-0">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Otkaži</Button>
            <Button onClick={savePonuda} disabled={saving} className="min-w-[140px]">
              {saving ? 'Snimam…' : editId != null ? 'Snimi izmjene' : 'Kreiraj ponudu'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Konvertuj u račun ── */}
      <Dialog open={konvertujOpen} onOpenChange={setKonvertujOpen}>
        <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
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
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Način plaćanja</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['Gotovina', 'Kartica', 'Virman', 'Ček'] as PaymentType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setPaymentType(type)}
                    className={cn(
                      'h-10 flex items-center justify-center gap-2 rounded-lg border text-[12px] font-medium transition-colors',
                      paymentType === type
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'text-slate-600 border-slate-200 hover:bg-slate-50',
                    )}
                  >
                    {paymentIcons[type]}
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {selected && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
                <span className="text-[12px] text-slate-500">Za naplatu</span>
                <span className="text-[16px] font-bold font-mono text-slate-900">{formatKM(selected.ukupno)}</span>
              </div>
            )}

            {konvertujMsg && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[12px] font-medium text-red-600">
                <AlertTriangle size={13} />
                {konvertujMsg}
              </div>
            )}
          </div>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setKonvertujOpen(false)}>Otkaži</Button>
            <Button onClick={konvertuj} disabled={converting} className="min-w-[160px]">
              {converting ? 'Štampam…' : 'Izdaj fiskalni račun'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
