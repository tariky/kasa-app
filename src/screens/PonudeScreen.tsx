import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { ActionRow, Eyebrow, FilterSelect, Key, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import {
  RefreshCw, FileText, AlertTriangle, Printer, Download, Plus, Trash2, Pencil,
  Receipt, X, Hammer,
  Send, Check, Ban, Search, Paperclip,
} from 'lucide-react';
import { PonudaPdf } from '@/components/PonudaPdf';
import { filtriraj, type PoljaPretrage } from '@/lib/pretraga';
import { formatBrojPonude, efektivniStatus, danaIzmedju } from '@/lib/ponuda';
import type { NacinPlacanja } from '@/lib/placanje';
import FiskalnaNaplataDialog from '@/components/FiskalnaNaplataDialog';
import { pdvStavke } from '@/lib/racun';
import { izReda } from '@/lib/stavkeDokumenta';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { localDateStr } from '@/lib/novac';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { useModuli } from '@/hooks/useModuli';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { zadaniIzbor, proizvodiIzIzbora } from '@/lib/nalogPrikaz';
import { ProizvodiNaloga } from '@/components/proizvodnja/ProizvodiNaloga';
import { zadanoZaKupca, type FormatBroja } from '@/lib/dokumentPostavke';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import { otvoriPdf, spremiPdf, ucitajZaStampu } from '@/lib/stampa';
import { useKupci } from '@/components/PretragaKupaca';
import type { ProizvodPonude } from '@/types';
import FakturaDialog, { type FakturaPocetno } from '@/components/FakturaDialog';
import { otvoriFakturuZaStampu } from '@/components/stampaFakture';
import { PonudaFormaDialog, type ZahtjevForme } from '@/components/ponude/PonudaFormaDialog';
import { useLedgerLista } from '@/hooks/useLedgerLista';
import { usePreciceListe } from '@/hooks/usePreciceListe';

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

const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  draft: { label: 'Draft', dot: 'bg-slate-300', text: 'text-slate-500' },
  poslana: { label: 'Poslana', dot: 'bg-blue-500', text: 'text-blue-600' },
  prihvacena: { label: 'Prihvaćena', dot: 'bg-emerald-500', text: 'text-emerald-600' },
  odbijena: { label: 'Odbijena', dot: 'bg-rose-500', text: 'text-rose-600' },
  istekla: { label: 'Istekla', dot: 'bg-amber-400', text: 'text-amber-600' },
  konvertovana: { label: 'Račun izdat', dot: 'bg-violet-500', text: 'text-violet-600' },
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

/**
 * Status kao tačka + tekst — isti jezik kao stanje zalihe na listi artikala.
 * `compact` ostavlja samo tačku (uska lista pored panela); labela ide u title.
 */
function StatusDot({ status, size = 'sm', compact = false }: { status: string; size?: 'sm' | 'md'; compact?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      title={meta.label}
      className={cn('flex items-center gap-1.5 font-medium leading-5 whitespace-nowrap', size === 'sm' ? 'text-[11.5px]' : 'text-[12px]')}
    >
      <span aria-hidden className={cn('rounded-full', size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2', meta.dot)} />
      <span className={cn(meta.text, compact && 'sr-only lg:not-sr-only lg:whitespace-nowrap')}>{meta.label}</span>
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

/** Pretraga ponuda: kupac, broj ponude u formatu iz postavki ("P-0012/2026") i ko je izdao. */
const poljaPonude = (f: FormatBroja) => (p: PonudaRow): PoljaPretrage => ({
  naziv: p.kupacNaziv ?? '',
  sifra: formatBrojPonude(p, f),
  dodatno: [formatBrojPonude(p, f), p.korisnikIme].join(' '),
});

export default function PonudeScreen({ uloga }: { uloga: 'admin' | 'kasir' }) {
  const { postavke } = useDokumentPostavke();
  const [ponude, setPonude] = useState<PonudaRow[]>([]);
  const [selected, setSelected] = useState<PonudaRow | null>(null);
  const [filter, setFilter] = useState<Filter>('sve');
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Forma (nova / uredi): null = zatvorena
  const [forma, setForma] = useState<ZahtjevForme>(null);
  // Konverzija treba način plaćanja kupca i prije nego što se forma otvori.
  const sifarnikKupaca = useKupci();
  const kupci = sifarnikKupaca ?? [];

  // Konverzija — iste opcije plaćanja kao na kasi
  const [konvertujOpen, setKonvertujOpen] = useState(false);
  const [konvertujNacin, setKonvertujNacin] = useState<NacinPlacanja>('Gotovina');

  // Faktura po ponudi — isti dijalog kao na kasi, s popunjenom firmom i stavkama
  const [faktura, setFaktura] = useState<FakturaPocetno | null>(null);
  const [fakturaOpen, setFakturaOpen] = useState(false);

  // Brisanje — vlastiti dijalog umjesto nativnog confirm-a
  const [brisiOpen, setBrisiOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Radni nalog iz ponude — samo kad su uključene i Ponude i Proizvodnja.
  // Bez veze nalog se ne dohvata, pa "Konvertuj u račun" ostaje dostupno i za
  // ponudu koja već ima nalog (proizvodnja.ts povezuje račun ako se modul vrati).
  const veza = useModuli()?.vezaPonudaNalog ?? false;
  const [nalogZaPonudu, setNalogZaPonudu] = useState<{ id: number; broj: number; godina: number } | null>(null);
  // Otvaranje naloga: izbor stavki ponude koje nalog izrađuje (null = dijalog zatvoren).
  const [nalogIzbor, setNalogIzbor] = useState<{ linije: ProizvodPonude[]; oznacene: Set<number> } | null>(null);
  const [otvaramNalog, setOtvaramNalog] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const danas = localDateStr();

  useEffect(() => { loadPonude(); }, []);

  useEffect(() => {
    setNalogZaPonudu(null);
    if (!selected || !veza) return;
    let cancelled = false;
    window.api.getNalogZaPonudu(selected.id)
      .then(r => { if (!cancelled) setNalogZaPonudu(r); })
      .catch(() => { if (!cancelled) setNalogZaPonudu(null); });
    return () => { cancelled = true; };
  }, [selected, veza]);

  const loadPonude = async () => {
    setPonude(await window.api.getPonude());
  };

  const selectPonuda = async (p: PonudaRow) => {
    setMsg(null);
    setSelected(await window.api.getPonuda(p.id));
  };

  const trazene = useMemo(
    () => filtriraj(ponude, search, poljaPonude(postavke.ponuda.broj)),
    [ponude, search, postavke.ponuda.broj],
  );

  const visible = useMemo(() => {
    if (filter === 'sve') return trazene;
    return trazene.filter(p => efektivniStatus(p, danas) === filter);
  }, [trazene, filter, danas]);

  // Brojači idu po pretrazi, da se vidi ima li šta iza filtera.
  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: trazene.length };
    for (const f of FILTERS) if (f.id !== 'sve') c[f.id] = 0;
    for (const p of trazene) {
      const st = efektivniStatus(p, danas);
      if (st in c) c[st] += 1;
    }
    return c;
  }, [trazene, danas]);

  // ── Forma ──────────────────────────────────────────────────

  const openNova = useCallback(() => setForma({ ponuda: null }), []);

  const openUredi = useCallback(async (p: PonudaRow) => {
    const full = p.stavke ? p : await window.api.getPonuda(p.id);
    setForma({ ponuda: full });
  }, []);

  const poslijeSnimanja = async (poruka: string, izmijenjenaId: number | null) => {
    setMsg({ type: 'success', text: poruka });
    setForma(null);
    await loadPonude();
    if (izmijenjenaId != null) setSelected(await window.api.getPonuda(izmijenjenaId));
  };

  /** Konverzija u račun kreće od načina plaćanja kupca ponude, pa od postavke ponuda. */
  const otvoriKonverziju = useCallback(() => {
    const kupac = selected ? kupci.find(k => k.id === selected.kupacId) : undefined;
    setKonvertujNacin(zadanoZaKupca(kupac, postavke, 'ponuda').nacinPlacanja);
    setKonvertujOpen(true);
  }, [selected, kupci, postavke]);

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
      setMsg({ type: 'success', text: `Ponuda ${formatBrojPonude(selected, postavke.ponuda.broj)} obrisana` });
      setSelected(null);
      await loadPonude();
    } catch (err: any) {
      setBrisiOpen(false);
      setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' });
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Poslije izdavanja (ili nepoznatog ishoda) lista i izabrana ponuda se čitaju
   * svježe — ponuda je možda konvertovana ili čeka u nezavršenim računima.
   */
  const poslijeKonverzije = async (ponudaId: number, poruka: { type: 'success' | 'error'; text: string }) => {
    setMsg(poruka);
    await loadPonude();
    setSelected(await window.api.getPonuda(ponudaId));
  };

  /** Ponuda se čita svježa — firma i stavke idu u dijalog fakture kakve su sada u bazi. */
  const otvoriFakturu = async () => {
    if (!selected) return;
    try {
      const p = await window.api.getPonuda(selected.id);
      setFaktura({
        ponudaId: p.id,
        ponudaOznaka: formatBrojPonude(p, postavke.ponuda.broj),
        firma: {
          naziv: p.kupacNaziv ?? '', idBroj: p.kupacIdBroj ?? '', adresa: p.kupacAdresa ?? '',
          grad: p.kupacGrad ?? '', postanskiBroj: p.kupacPostanskiBroj ?? '',
        },
        stavke: (p.stavke ?? []).map(izReda),
      });
      setFakturaOpen(true);
    } catch (err: any) {
      setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' });
    }
  };

  // ── PDF ────────────────────────────────────────────────────

  const ponudaPdf = async (p: PonudaRow) => {
    const full = p.stavke ? p : await window.api.getPonuda(p.id);
    const { firma, postavke } = await ucitajZaStampu();
    return <PonudaPdf ponuda={full as any} firma={firma} postavke={postavke} />;
  };

  const handlePrintPdf = async (p: PonudaRow) => {
    await otvoriPdf(await ponudaPdf(p));
  };

  const handleExportPdf = async (p: PonudaRow) => {
    await spremiPdf(await ponudaPdf(p), `Ponuda-${p.broj}-${p.godina}.pdf`);
  };

  const selStatus = selected ? efektivniStatus(selected, danas) : '';
  const selEditable = Boolean(selected && selected.status !== 'konvertovana');
  // Odbijena ponuda se ne pretvara u račun (backend to odbija) — prvo vratiti status.
  const selKonvertibilna = selEditable && selected?.status !== 'odbijena';

  const otvoriNalog = (id: number) => window.dispatchEvent(new CustomEvent('ui:openNalog', { detail: id }));

  /** Nalog iz ponude: prvo izbor stavki koje se izrađuju; bez artikala na ponudi odmah se otvara. */
  const napraviNalog = async () => {
    if (!selected) return;
    try {
      const linije = await window.api.getProizvodiPonude(selected.id);
      if (linije.length === 0) await otvoriNalogIzPonude([]);
      else setNalogIzbor({ linije, oznacene: zadaniIzbor(linije) });
    } catch (err: any) { setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' }); }
  };

  const otvoriNalogIzPonude = async (proizvodi: Array<{ productId: number; kolicina: number }>) => {
    if (!selected || otvaramNalog) return;
    setOtvaramNalog(true);
    try {
      const r = await window.api.createNalogIzPonude(selected.id, proizvodi);
      setNalogIzbor(null);
      setMsg({ type: 'success', text: `Radni nalog ${formatBrojNaloga(r, postavke.nalog.broj)} otvoren po ponudi ${formatBrojPonude(selected, postavke.ponuda.broj)}` });
      otvoriNalog(r.id);
    } catch (err: any) { setNalogIzbor(null); setMsg({ type: 'error', text: err?.message || 'Nepoznata greška' }); }
    finally { setOtvaramNalog(false); }
  };

  // ── Tastatura ──────────────────────────────────────────────

  // Izbor drži ekran: izabrana ponuda puni panel detalja, ↵ na redu je štampa.
  const lista = useLedgerLista(visible, {
    izabranId: selected?.id ?? null,
    onIzaberi: selectPonuda,
    onOtvori: () => { if (selected) handlePrintPdf(selected); },
    razmakOtvara: false,
    izborNaFokus: false,
  });
  const selIndex = lista.izabraniIndeks;

  const anyDialogOpen = forma != null || konvertujOpen || brisiOpen || fakturaOpen || nalogIzbor != null;

  /**
   * Prečice ekrana. Filteri idu na zagrade jer su cifre rezervisane za promjenu
   * statusa — status je srž toka ponude i zaslužuje najkraći potez. Konverzija i
   * brisanje nikad ne djeluju odmah: otvaraju dijalog s potvrdom.
   */
  usePreciceListe({
    aktivno: !anyDialogOpen,
    lista, searchRef, onPretraga: setSearch,
    onNovi: openNova,
    filteri: { opcije: FILTERS, vrijednost: filter, postavi: setFilter },
    // Ponuda nema ↑↓ ni ↵ van liste, a prečice rade i s fokusom na filteru statusa.
    strelicomUListu: false, enterOtvara: false, preskociIzbornike: false,
    dodatne: e => {
      if (e.key === 'Escape' && selected) { e.preventDefault(); setSelected(null); return; }

      if (!selected) return;

      switch (e.key.toLowerCase()) {
        case 'p': e.preventDefault(); handlePrintPdf(selected); break;
        case 's': e.preventDefault(); handleExportPdf(selected); break;
        case 'u':
          if (selEditable) { e.preventDefault(); openUredi(selected); }
          break;
        case 'k':
          if (selKonvertibilna && !nalogZaPonudu) {
            e.preventDefault();
            otvoriKonverziju();
          }
          break;
        case 'f':
          if (selKonvertibilna && !nalogZaPonudu) { e.preventDefault(); otvoriFakturu(); }
          break;
        case 'd':
          if (selEditable) { e.preventDefault(); setBrisiOpen(true); }
          break;
        case '1': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'poslana'); } break;
        case '2': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'prihvacena'); } break;
        case '3': if (selEditable) { e.preventDefault(); changeStatus(selected.id, 'odbijena'); } break;
        default:
      }
    },
  });

  /** ⌘↵ potvrđuje dijalog s bilo kojeg polja. */
  const submitOnMeta = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fn(); }
  };

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Traka: pretraga, filter, akcije ── */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight mr-1">Ponude</h2>
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Broj ponude, kupac ili sastavio…"
            aria-label="Pretraga ponuda"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        {/* Sedam statusa ne stane u traku na užem ekranu — tamo isti filter ide u padajući meni. */}
        <div className="hidden xl:block">
          <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
        </div>
        <div className="xl:hidden">
          <FilterSelect options={FILTERS} value={filter} onChange={setFilter} counts={counts} label="Status ponude" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadPonude} className="h-8 gap-1.5 text-[12px]">
            <RefreshCw className="h-3.5 w-3.5" />
            Osvježi
          </Button>
          <Button size="sm" onClick={openNova} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Nova ponuda <Key tone="dark">N</Key>
          </Button>
        </div>
      </div>

      {msg && (
        <div className={cn(
          'flex-shrink-0 flex items-center gap-2 border-b px-6 py-2.5 text-[12px] font-medium',
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

      {/* ── Sadržaj: lista lijevo, detalj desno ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Ledger ── */}
        <div className="flex-1 min-w-0 flex flex-col">
            {visible.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                  <FileText size={20} className="text-slate-300" strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-medium text-slate-500">
                  {search.trim() ? 'Nema rezultata pretrage' : filter === 'sve' ? 'Još nema ponuda' : 'Nema ponuda u ovom filteru'}
                </p>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  {search.trim()
                    ? 'Pokušaj drugi broj ili naziv kupca.'
                    : filter === 'sve'
                      ? <>Prvu ponudu dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</>
                      : 'Promijeni filter da vidiš ostale.'}
                </p>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1">
                  <table className="w-full border-separate border-spacing-0">
                    <LedgerHead
                      columns={[
                        { label: 'Broj', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
                        { label: 'Datum', className: 'text-left px-3 w-[1%] whitespace-nowrap hidden xl:table-cell' },
                        { label: 'Kupac', className: 'text-left px-3' },
                        { label: 'Ukupno', className: 'text-right px-3 w-[1%] whitespace-nowrap' },
                        { label: 'Važi do', className: 'text-left px-3 w-[1%] whitespace-nowrap hidden xl:table-cell' },
                        { label: 'Status', className: 'text-left pl-3 pr-6 w-[1%] whitespace-nowrap' },
                      ]}
                    />
                    <tbody onKeyDown={lista.onTbodyKeyDown}>
                      {visible.map((p, i) => {
                        const st = efektivniStatus(p, danas);
                        const isSel = selected?.id === p.id;
                        const rok = rokOznaka(p, danas);
                        return (
                          <tr
                            key={p.id}
                            {...lista.rowProps(i)}
                            className={cn(
                              'group cursor-pointer transition-colors',
                              'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                              isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50',
                            )}
                            onClick={() => lista.fokusRed(i, { skrol: false })}
                          >
                            <td
                              className={cn(
                                td, 'pl-6 pr-3 font-mono text-[12px] tabular-nums whitespace-nowrap',
                                // Šina lijevo označava isključivo izabrani red — status ide kroz tačku.
                                isSel ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-400',
                              )}
                            >
                              {formatBrojPonude(p, postavke.ponuda.broj)}
                            </td>
                            <td className={cn(td, 'hidden xl:table-cell px-3 text-[12px] tabular-nums whitespace-nowrap', isSel ? 'text-slate-700' : 'text-slate-500')}>
                              {formatDate(p.datum)}
                            </td>
                            <td className={cn(td, 'px-3 max-w-0')}>
                              {p.kupacNaziv
                                ? <span className="block truncate text-[12.5px] font-medium text-slate-800">{p.kupacNaziv}</span>
                                : <span className="text-slate-200">—</span>}
                              {/* Uža lista: datum i rok idu ispod kupca umjesto u svoje kolone. */}
                              <span className="xl:hidden block truncate text-[10.5px] tabular-nums text-slate-400">
                                {rok && <span className={cn('font-medium', rok.cls)}>{rok.text} · </span>}
                                važi do {formatDate(p.vaziDo)} · {formatDate(p.datum)}
                              </span>
                            </td>
                            <td className={cn(td, 'px-3 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                              {formatKM(p.ukupno)}
                            </td>
                            <td className={cn(td, 'hidden xl:table-cell px-3 whitespace-nowrap')}>
                              <span className="flex items-baseline leading-5">
                                <span className={cn('text-[12px] tabular-nums', isSel ? 'text-slate-600' : 'text-slate-400')}>
                                  {formatDate(p.vaziDo)}
                                </span>
                                {rok && (
                                  <span className={cn('ml-1.5 text-[11px] font-medium', rok.cls)}>· {rok.text}</span>
                                )}
                              </span>
                            </td>
                            <td className={cn(td, 'pl-3 pr-6')}>
                              <StatusDot status={st} compact />
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
                  <span className="hidden sm:flex items-center gap-3 min-w-0 overflow-hidden">
                    <span className="flex items-center gap-1"><Key className="ml-0">↑↓</Key> odaberi</span>
                    <span className="flex items-center gap-1"><Key className="ml-0">↵</Key> štampa</span>
                    <span className="flex items-center gap-1"><Key className="ml-0">←→</Key> filter</span>
                    <span className="hidden lg:flex items-center gap-1"><Key className="ml-0">/</Key> pretraga</span>
                  </span>
                </div>
              </>
            )}
        </div>

        {/* ── Detail / actions panel ── */}
        <div className="w-[340px] xl:w-[380px] flex-shrink-0 border-l border-slate-200/80 bg-white">
          {selected ? (
            <div className="h-full flex flex-col overflow-hidden">

              {/* Zaglavlje */}
              <div className="flex-shrink-0 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Eyebrow>{selStatus === 'konvertovana' ? 'Ponuda po kojoj je izdat račun' : 'Ponuda kupcu'}</Eyebrow>
                    <h3 className="text-[19px] font-bold font-mono tracking-tight text-slate-900 leading-tight mt-1">
                      {formatBrojPonude(selected, postavke.ponuda.broj)}
                    </h3>
                    <p className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums">
                      {formatDate(selected.datum)} · važi do {formatDate(selected.vaziDo)}
                    </p>
                  </div>
                  <StatusDot status={selStatus} size="md" />
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
                  <span className="text-slate-400">PDV ({PDV_STOPA_E_PCT}%)</span>
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

                {veza && selStatus === 'prihvacena' && !nalogZaPonudu && (
                  <ActionRow icon={Hammer} label="Radni nalog" onClick={napraviNalog} />
                )}
                {veza && nalogZaPonudu && (
                  <>
                    <ActionRow icon={Hammer} label={`Otvori nalog ${formatBrojNaloga(nalogZaPonudu, postavke.nalog.broj)}`} onClick={() => otvoriNalog(nalogZaPonudu.id)} />
                    <p className="text-[11px] text-slate-400 px-0.5">Račun se izdaje iz radnog naloga</p>
                  </>
                )}

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

                    {!nalogZaPonudu && selKonvertibilna && (
                      <div className="pt-2 mt-1 border-t border-slate-100">
                        <ActionRow
                          icon={Receipt}
                          label={selStatus === 'istekla' ? 'Konvertuj (istekla)' : 'Konvertuj u račun'}
                          hint="K"
                          tone="primary"
                          onClick={otvoriKonverziju}
                        />
                        <div className="mt-1.5">
                          <ActionRow icon={Paperclip} label="Faktura po ponudi" hint="F" onClick={otvoriFakturu} />
                        </div>
                      </div>
                    )}
                    {!selKonvertibilna && (
                      <p className="text-[11px] text-slate-400 pt-2 mt-1 border-t border-slate-100">
                        Odbijena ponuda se ne pretvara u račun — ako kupac ipak prihvata, prvo promijenite status.
                      </p>
                    )}
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
            <div className="h-full flex flex-col items-center justify-center px-8 text-center select-none">
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
      <PonudaFormaDialog zahtjev={forma} kupci={sifarnikKupaca} onZatvori={() => setForma(null)} onSpremljena={poslijeSnimanja} />

      <FakturaDialog
        open={fakturaOpen}
        onOpenChange={setFakturaOpen}
        uloga={uloga}
        pocetno={faktura}
        onSkicePromijenjene={(spremljena) => {
          if (spremljena) setMsg({ type: 'success', text: `Faktura po ponudi ${faktura?.ponudaOznaka ?? ''} spremljena kao skica — nastavite je na Kasi, u Spremljenim.` });
        }}
        onSuccess={async (res) => {
          const ponudaId = faktura?.ponudaId;
          setMsg(res.upozorenje
            ? { type: 'error', text: res.upozorenje }
            : { type: 'success', text: `Faktura br. ${res.prilogBroj} (BF ${res.brojFiskalnogRacuna ?? '?'}) izdana po ponudi ${faktura?.ponudaOznaka ?? ''}` });
          await loadPonude();
          if (ponudaId) setSelected(await window.api.getPonuda(ponudaId));
          if (res.brojStavki > 0) {
            otvoriFakturuZaStampu(res.id).catch((err: any) => setMsg({
              type: 'error',
              text: `Faktura je fiskalizovana, ali se nije otvorila za štampu: ${err?.message || 'Nepoznata greška'}. Štampajte je u sekciji Računi.`,
            }));
          }
        }}
      />

      {/* ── Konvertuj u račun ── */}
      {/* Štampa i upis idu kroz jedan poziv — kao refundAndPrint — da ne ostane odštampan račun bez zapisa u bazi. */}
      {selected && (
        <FiskalnaNaplataDialog
          open={konvertujOpen}
          onOpenChange={setKonvertujOpen}
          naslov={`Konvertuj ponudu ${formatBrojPonude(selected, postavke.ponuda.broj)}`}
          opis="Izdaje fiskalni račun po cijenama sa ponude"
          napomena="Račun se štampa na Tring fiskalnom printeru i razdužuje skladište. Cijene idu sa ponude, ne iz cjenovnika. Provjerite da je printer uključen."
          iznos={selected.ukupno}
          zadaniNacin={konvertujNacin}
          onIzdaj={nacin => window.api.konvertujPonudu({ id: selected.id, nacinPlacanja: nacin })}
          onUspjeh={res => poslijeKonverzije(selected.id, {
            type: 'success',
            text: `Račun #${res.brojFiskalnogRacuna ?? ''} izdat po ponudi ${formatBrojPonude(selected, postavke.ponuda.broj)}`,
          })}
          onNezavrseno={poruka => poslijeKonverzije(selected.id, { type: 'error', text: poruka })}
        />
      )}

      {/* ── Obriši ponudu ── */}
      <Dialog open={nalogIzbor != null} onOpenChange={v => { if (!v) setNalogIzbor(null); }}>
        <DialogContent
          className="sm:max-w-[560px] p-0 gap-0 overflow-hidden"
          onKeyDown={submitOnMeta(() => { if (nalogIzbor) otvoriNalogIzPonude(proizvodiIzIzbora(nalogIzbor.linije, nalogIzbor.oznacene)); })}
        >
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                  <Hammer className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <DialogTitle className="text-lg">
                    Radni nalog po ponudi {selected ? formatBrojPonude(selected, postavke.ponuda.broj) : ''}
                  </DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Označite šta se izrađuje; robu koja je već na zalihi ostavite neoznačenu
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>
          <Separator />
          <div className="px-6 py-5">
            {nalogIzbor && (
              <ProizvodiNaloga
                linije={nalogIzbor.linije}
                oznacene={nalogIzbor.oznacene}
                onToggle={id => setNalogIzbor(s => {
                  if (!s) return s;
                  const oznacene = new Set(s.oznacene);
                  if (oznacene.has(id)) oznacene.delete(id); else oznacene.add(id);
                  return { ...s, oznacene };
                })}
              />
            )}
          </div>
          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <Key className="ml-0">⌘↵</Key> otvori nalog
            </span>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setNalogIzbor(null)}>Otkaži</Button>
              <Button disabled={otvaramNalog} className="min-w-[120px]"
                onClick={() => { if (nalogIzbor) otvoriNalogIzPonude(proizvodiIzIzbora(nalogIzbor.linije, nalogIzbor.oznacene)); }}>
                {otvaramNalog ? 'Otvaram…' : 'Otvori nalog'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                    Obriši ponudu {selected ? formatBrojPonude(selected, postavke.ponuda.broj) : ''}
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
