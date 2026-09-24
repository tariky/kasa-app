// src/components/skladiste/UlazDialog.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { Dobavljac, Primka, PrimkaStavka, Product } from '@/types';
import { izBazePrimke, jePloca, m2UKom } from '@/lib/ploca';
import { localDateStr } from '@/lib/novac';
import { nedostajeOpis, nivelacijaRazlike, praznaStavka, redStatus, ulazTotali, uPayload, type UlazRed, type NivelacijaRazlika } from '@/lib/ulaz';
import { kalkulacijaPrimke, nabavnaVrijednost, type KalkulacijaPrimke } from '@/lib/kalkulacija';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eyebrow, Key, mod } from '@/components/ui/ledger';
import { FullDialog, FullDialogContent, FullDialogHeader, FullDialogFooter, FullDialogNotice, FullDialogTitle, FooterBtn, Fact, HeaderBtn, LegendKey } from '@/components/ui/full-dialog';
import { UlazPdf } from '@/components/UlazPdf';
import { UlazStavkeEditor, type UlazStavkeHandle } from './UlazStavkeEditor';
import { Pencil, Trash2, Printer, Download, Save, ChevronUp, ChevronDown, Building2, AlertTriangle, X } from 'lucide-react';

export type UlazStanje = { kind: 'zatvoren' } | { kind: 'pregled'; id: number } | { kind: 'uredi'; id: number } | { kind: 'novi' };

type Notice = { type: 'success' | 'error'; text: string };
type Pending = { kind: 'close' } | { kind: 'nav'; id: number };

interface Forma {
  brojPrimke: string; datum: string; dobavljacNaziv: string; dobavljacId: string; dobavljacAdresa: string;
  brojFakture: string; napomena: string;
  /** Zavisni troškovi cijelog dokumenta (prevoz i sl.); pri spremanju se rasporede po stavkama. */
  zavisniTroskovi: string; rows: UlazRed[];
}
const praznaForma = (): Forma => ({
  brojPrimke: '', datum: localDateStr(), dobavljacNaziv: '', dobavljacId: '', dobavljacAdresa: '', brojFakture: '', napomena: '', zavisniTroskovi: '', rows: [praznaStavka()],
});
const zavisniDokumenta = (stavke: PrimkaStavka[]) => Math.round(stavke.reduce((s, x) => s + (x.zavisniTroskovi || 0), 0) * 100) / 100;
const izPrimke = (p: Primka, products: Product[]): Forma => ({
  brojPrimke: p.brojPrimke, datum: p.datum, dobavljacNaziv: p.dobavljacNaziv ?? '', dobavljacId: p.dobavljacId ?? '', dobavljacAdresa: p.dobavljacAdresa ?? '',
  brojFakture: p.brojFakture ?? '', napomena: p.napomena ?? '',
  zavisniTroskovi: zavisniDokumenta(p.stavke ?? []) > 0 ? String(zavisniDokumenta(p.stavke ?? [])) : '',
  rows: (p.stavke ?? []).map(s => {
    const prod = products.find(x => x.id === s.productId);
    const prikaz = izBazePrimke(prod, s.kolicina, s.nabavnaCijena);
    return { productId: s.productId, kolicina: prikaz.kolicina, nabavnaCijena: prikaz.nabavnaCijena, rabat: s.rabat ? String(s.rabat) : '', cijena: String(s.cijena) };
  }),
});

const TH = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 pb-2 border-b border-slate-200/80 whitespace-nowrap';
const TD = 'py-2.5 border-b border-slate-100 align-top';

function Red({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'plus' }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px] min-h-[26px]">
      <span className={strong ? 'font-semibold text-slate-700' : 'text-slate-500'}>{label}</span>
      <span className={cn('font-mono tabular-nums text-right', strong ? 'font-semibold text-slate-900' : 'text-slate-700', tone === 'plus' && 'text-emerald-600')}>{value}</span>
    </div>
  );
}

/** Sume dokumenta po obrascu kalkulacije: fakturna − rabat + zavisni = nabavna; za artikle dalje RUC, PDV i MP vrijednost. */
function Kalkulacija({ k }: { k: KalkulacijaPrimke }) {
  const razlozeno = k.rabat > 0 || k.zavisni > 0;
  return (
    <>
      {razlozeno && (
        <>
          <Red label="Fakturna (bez PDV)" value={formatKM(k.fakturna)} />
          {k.rabat > 0 && <Red label="Rabat" value={`− ${formatKM(k.rabat)}`} />}
          {k.zavisni > 0 && <Red label="Zavisni troškovi" value={`+ ${formatKM(k.zavisni)}`} />}
        </>
      )}
      <Red label="Nabavna" value={formatKM(k.nabavna)} strong />
      {k.imaArtikala && (
        <div className="mt-2 pt-2 border-t border-dashed border-slate-200">
          <Red label="Prodajna bez PDV (artikli)" value={formatKM(k.prodajnaBezPdv)} />
          <Red label={`RUC · ${k.rucPct.toFixed(1)} %`} value={formatKM(k.ruc)} tone="plus" strong />
          <Red label="PDV" value={formatKM(k.pdv)} />
          <Red label="MP vrijednost sa PDV" value={formatKM(k.prodajna)} />
        </div>
      )}
    </>
  );
}

/**
 * Ulaz robe preko cijelog ekrana: pregled postojećeg dokumenta, ili forma za novi / izmjenu.
 * Tastatura u pregledu: ↑↓ susjedni ulaz, U uredi, P štampa, S PDF, D obriši, esc zatvori.
 * U formi: ↵ vodi kroz polja reda, / novi red, ⌘↵ spremi, esc otkaži (pita ako ima izmjena).
 */
export function UlazDialog({ stanje, products, dobavljaci, redoslijed, onClose, onNavigate, onSaved, onDeleted }: {
  stanje: UlazStanje; products: Product[]; dobavljaci: Dobavljac[]; redoslijed: number[];
  onClose: () => void; onNavigate: (id: number) => void; onSaved: (id: number) => void; onDeleted: (p: Primka) => void;
}) {
  const open = stanje.kind !== 'zatvoren';
  const id = stanje.kind === 'pregled' || stanje.kind === 'uredi' ? stanje.id : null;
  const [primka, setPrimka] = useState<Primka | null>(null);
  const [edit, setEdit] = useState(false);
  const [forma, setForma] = useState<Forma>(praznaForma());
  const [pocetna, setPocetna] = useState<string>('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [brisiOpen, setBrisiOpen] = useState(false);
  const [nivelacija, setNivelacija] = useState<NivelacijaRazlika[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<UlazStavkeHandle>(null);
  // Nakon spremanja roditelj prebaci dijalog na pregled istog dokumenta — poruka o uspjehu mora preživjeti tu promjenu.
  const zadrziPoruku = useRef(false);

  const greska = (e: any) => setNotice({ type: 'error', text: e?.message || 'Greška' });

  // Artikli se osvježe nakon svakog spremanja; učitavanje dokumenta ne smije zbog toga krenuti ispočetka.
  const productsRef = useRef(products);
  productsRef.current = products;
  const pocniUredjivanje = useCallback((p: Primka | null) => {
    const f = p ? izPrimke(p, productsRef.current) : praznaForma();
    if (f.rows.length === 0) f.rows = [praznaStavka()];
    setForma(f); setPocetna(JSON.stringify(f)); setEdit(true);
  }, []);

  // Učitaj dokument; za novi ulaz odmah otvori formu s idućim brojem.
  useEffect(() => {
    if (!open) { setPrimka(null); setEdit(false); setNotice(null); return; }
    if (zadrziPoruku.current) zadrziPoruku.current = false; else setNotice(null);
    if (stanje.kind === 'novi') {
      setPrimka(null);
      pocniUredjivanje(null);
      // Broj dolazi asinhrono i ne smije brojati kao izmjena korisnika — zato ide i u početno stanje.
      window.api.getNextBrojUlaza().then(b => {
        setForma(f => { const nf = { ...f, brojPrimke: b }; setPocetna(JSON.stringify(nf)); return nf; });
      }).catch(() => undefined);
      return;
    }
    let ziv = true;
    window.api.getPrimka(stanje.id).then(p => {
      if (!ziv) return;
      setPrimka(p);
      if (stanje.kind === 'uredi') pocniUredjivanje(p); else setEdit(false);
    }).catch(greska);
    return () => { ziv = false; };
  }, [open, stanje, pocniUredjivanje]);

  const dirty = edit && JSON.stringify(forma) !== pocetna;

  // Novi ulaz: kursor odmah u pretragu prvog reda — to je prvo što se kuca.
  useEffect(() => {
    if (stanje.kind === 'novi' && edit) requestAnimationFrame(() => editorRef.current?.noviRed());
  }, [stanje.kind, edit]);

  const idx = id != null ? redoslijed.indexOf(id) : -1;
  const prevId = idx > 0 ? redoslijed[idx - 1] : null;
  const nextId = idx >= 0 && idx < redoslijed.length - 1 ? redoslijed[idx + 1] : null;

  const guarded = (p: Pending) => {
    if (dirty) { setPending(p); return; }
    if (p.kind === 'close') onClose(); else onNavigate(p.id);
  };
  const izvrsiPending = () => {
    const p = pending; setPending(null);
    if (!p) return;
    if (p.kind === 'close') onClose(); else onNavigate(p.id);
  };
  const otkazi = () => {
    if (stanje.kind === 'novi' || !primka) return guarded({ kind: 'close' });
    if (dirty) { setPending({ kind: 'close' }); return; }
    setEdit(false);
  };
  // Otkaži iz uređivanja postojećeg ulaza vraća na pregled, ne zatvara.
  const odbaci = () => {
    const p = pending; setPending(null);
    if (p?.kind === 'close' && primka && stanje.kind !== 'uredi') { setEdit(false); return; }
    izvrsiPending();
  };

  // ── akcije ────────────────────────────────────────────
  const fali = useMemo(() => nedostajeOpis(forma.rows, products), [forma.rows, products]);
  const totali = useMemo(() => ulazTotali(forma.rows, products, forma.zavisniTroskovi), [forma.rows, products, forma.zavisniTroskovi]);
  const razlike = useMemo(() => (edit ? nivelacijaRazlike(forma.rows, products) : []), [edit, forma.rows, products]);

  const spremi = async () => {
    if (!edit || fali || !forma.brojPrimke.trim() || saving) return;
    if (razlike.length > 0 && !nivelacija) { setNivelacija(razlike); return; }
    setSaving(true);
    try {
      const payload = {
        ...(primka ? { id: primka.id } : {}),
        brojPrimke: forma.brojPrimke.trim(), datum: forma.datum || undefined,
        dobavljacNaziv: forma.dobavljacNaziv || undefined, dobavljacId: forma.dobavljacId || undefined, dobavljacAdresa: forma.dobavljacAdresa || undefined,
        brojFakture: forma.brojFakture || undefined, napomena: forma.napomena || undefined,
        stavke: uPayload(forma.rows, products, forma.zavisniTroskovi),
      };
      let savedId: number;
      if (primka) { await window.api.updatePrimka(payload); savedId = primka.id; }
      else { const r = await window.api.createPrimka(payload); savedId = Number(r?.id ?? 0); }
      setNivelacija(null); setEdit(false);
      zadrziPoruku.current = true;
      setNotice({ type: 'success', text: primka ? 'Ulaz izmijenjen' : `Ulaz ${forma.brojPrimke} spremljen` });
      onSaved(savedId);
    } catch (e) { setNivelacija(null); greska(e); }
    finally { setSaving(false); }
  };

  const obrisi = async () => {
    if (!primka) return;
    try { await window.api.deletePrimka(primka.id); setBrisiOpen(false); onDeleted(primka); }
    catch (e) { greska(e); setBrisiOpen(false); }
  };

  const buildPdf = async () => pdf(<UlazPdf primka={primka!} firma={await window.api.getFirmaSettings()} />).toBlob();
  const printPdf = async () => {
    if (!primka || edit) return;
    const url = URL.createObjectURL(await buildPdf());
    const win = window.open(url, '_blank');
    if (win) win.onafterprint = () => URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    if (!primka || edit) return;
    const blob = await buildPdf();
    const path = await window.api.showSaveDialog({ defaultName: `${primka.brojPrimke}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) return;
    await window.api.writeFile(path, Array.from(new Uint8Array(await blob.arrayBuffer())) as any);
  };

  const anySub = brisiOpen || nivelacija != null || pending != null;

  // ── tastatura ─────────────────────────────────────────
  useEffect(() => {
    if (!open || anySub) return;
    const onKey = (e: KeyboardEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      const modKey = e.metaKey || e.ctrlKey;
      if (modKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'Enter' && edit) { e.preventDefault(); spremi(); }
        return;
      }
      if (e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t && t.closest('[role="combobox"], [role="listbox"]')) return;
      if (edit) {
        if (e.key === '/') { e.preventDefault(); editorRef.current?.noviRed(); }
        return;
      }
      switch (e.key) {
        case 'ArrowUp': if (prevId != null) { e.preventDefault(); guarded({ kind: 'nav', id: prevId }); } return;
        case 'ArrowDown': if (nextId != null) { e.preventDefault(); guarded({ kind: 'nav', id: nextId }); } return;
        default:
      }
      switch (e.key.toLowerCase()) {
        case 'u': if (primka) { e.preventDefault(); pocniUredjivanje(primka); } break;
        case 'p': e.preventDefault(); printPdf(); break;
        case 's': e.preventDefault(); exportPdf(); break;
        case 'd': if (primka) { e.preventDefault(); setBrisiOpen(true); } break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── pregled: sume dokumenta ───────────────────────────
  const stavke: PrimkaStavka[] = primka?.stavke ?? [];
  const pregled = useMemo(() => kalkulacijaPrimke(stavke), [stavke]);

  const naslov = edit ? (primka ? forma.brojPrimke || primka.brojPrimke : forma.brojPrimke || 'Novi ulaz') : primka?.brojPrimke ?? '';
  const dob = edit ? forma.dobavljacNaziv : primka?.dobavljacNaziv;
  const datum = edit ? forma.datum : primka?.datum;

  return (
    <FullDialog open={open} onRequestClose={() => (edit ? otkazi() : guarded({ kind: 'close' }))}>
      <FullDialogContent ref={contentRef} onRequestClose={() => (edit ? otkazi() : guarded({ kind: 'close' }))}>
        {!primka && !edit && <FullDialogTitle className="sr-only">Ulaz robe</FullDialogTitle>}
        {(primka || edit) && (
          <>
            <FullDialogHeader
              eyebrow={edit ? (primka ? 'Izmjena ulaza robe' : 'Novi ulaz robe') : 'Ulaz robe'}
              title={naslov}
              description={<>{dob || <span className="text-white/40">bez dobavljača</span>}{datum && <span className="text-white/45"> · {formatDate(datum)}</span>}</>}
              actions={!edit && primka && <HeaderBtn icon={Pencil} label="Uredi" hint="U" onClick={() => pocniUredjivanje(primka)} />}
            />

            {notice && <FullDialogNotice type={notice.type} text={notice.text} onClose={() => setNotice(null)} />}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-6 px-6 py-5">
                <div className="min-w-0 space-y-6">
                  {edit ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Broj ulaza</Label>
                        <Input value={forma.brojPrimke} onChange={e => setForma(f => ({ ...f, brojPrimke: e.target.value }))} readOnly={!primka}
                          className={cn('h-9 font-mono text-[13px]', !primka && 'bg-slate-50 text-slate-500')} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Datum prijema</Label>
                        <DatePicker value={forma.datum} onChange={v => setForma(f => ({ ...f, datum: v }))} />
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Dobavljač</Label>
                        <Select value={dobavljaci.find(d => d.naziv === forma.dobavljacNaziv)?.id?.toString() ?? ''}
                          onValueChange={v => { const d = dobavljaci.find(x => x.id === Number(v)); if (d) setForma(f => ({ ...f, dobavljacNaziv: d.naziv, dobavljacId: d.idBroj || d.pdvBroj || '', dobavljacAdresa: d.adresa || '' })); }}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Odaberi dobavljača…" /></SelectTrigger>
                          <SelectContent>
                            {dobavljaci.map(d => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                <span className="font-medium">{d.naziv}</span>
                                {d.idBroj && <span className="text-slate-400 text-xs ml-2 font-mono">{d.idBroj}</span>}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Faktura dobavljača</Label>
                        <Input value={forma.brojFakture} onChange={e => setForma(f => ({ ...f, brojFakture: e.target.value }))} placeholder="npr. 208/26" className="h-9 text-[13px]" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400" title="Prevoz, špedicija i slično — bez PDV-a. Raspoređuje se po stavkama srazmjerno vrijednosti.">Zavisni troškovi</Label>
                        <DecimalInput value={forma.zavisniTroskovi} onValueChange={t => setForma(f => ({ ...f, zavisniTroskovi: t }))} placeholder="0,00 (prevoz…)" aria-label="Zavisni troškovi"
                          className="h-9 font-mono text-[13px] text-right" />
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Napomena</Label>
                        <Input value={forma.napomena} onChange={e => setForma(f => ({ ...f, napomena: e.target.value }))} placeholder="Opcionalno" className="h-9 text-[13px]" />
                      </div>
                    </div>
                  ) : primka && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
                      <Fact label="Dobavljač" className="col-span-2">
                        <span className="flex items-start gap-2"><Building2 size={14} className="text-slate-400 mt-[2px] flex-shrink-0" />
                          <span><span className="font-medium">{primka.dobavljacNaziv || <span className="text-slate-300 font-normal">—</span>}</span>
                            {(primka.dobavljacId || primka.dobavljacAdresa) && <span className="block text-[11.5px] text-slate-400">{[primka.dobavljacId && `ID ${primka.dobavljacId}`, primka.dobavljacAdresa].filter(Boolean).join(' · ')}</span>}
                          </span>
                        </span>
                      </Fact>
                      <Fact label="Datum prijema"><span className="font-mono tabular-nums">{formatDate(primka.datum)}</span></Fact>
                      <Fact label="Faktura dobavljača">{primka.brojFakture ? <span className="font-mono">{primka.brojFakture}</span> : <span className="text-slate-300">—</span>}</Fact>
                      {pregled.zavisni > 0 && <Fact label="Zavisni troškovi"><span className="font-mono tabular-nums">{formatKM(pregled.zavisni)}</span></Fact>}
                      {primka.napomena && <Fact label="Napomena" className="col-span-2 md:col-span-4"><span className="text-slate-600">{primka.napomena}</span></Fact>}
                    </div>
                  )}

                  <section aria-label="Stavke">
                    <div className="flex items-center gap-2.5 h-9">
                      <Eyebrow>Stavke</Eyebrow>
                      <span className="font-mono text-[10.5px] tabular-nums text-slate-400">{edit ? forma.rows.filter(r => redStatus(r, products).stanje !== 'prazan').length : stavke.length}</span>
                    </div>
                    {edit ? (
                      <UlazStavkeEditor ref={editorRef} rows={forma.rows} onChange={rows => setForma(f => ({ ...f, rows }))} products={products} />
                    ) : stavke.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 px-5 py-8 text-center text-[12.5px] text-slate-500">Ulaz nema stavki.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-1 px-1">
                        <table className="w-full border-separate border-spacing-0 min-w-[640px]">
                          <thead>
                            <tr>
                              <th className={cn(TH, 'text-right w-6 pr-2')}>#</th>
                              <th className={cn(TH, 'text-left px-2')}>Artikal</th>
                              <th className={cn(TH, 'text-right px-2 w-[110px]')}>Količina</th>
                              <th className={cn(TH, 'text-right px-2 w-[100px]')} title="Fakturna cijena bez PDV-a, prije rabata">Fakturna</th>
                              <th className={cn(TH, 'text-right px-2 w-[70px]')}>Rabat</th>
                              <th className={cn(TH, 'text-right px-2 w-[100px]')}>Prodajna</th>
                              <th className={cn(TH, 'text-right pl-2 w-[110px]')} title="Fakturna − rabat + zavisni troškovi">Nabavna</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stavke.map((s, i) => {
                              const prod = products.find(x => x.id === s.productId);
                              const mat = prod?.tip === 'materijal' || (!prod && s.cijena === 0);
                              return (
                                <tr key={s.id}>
                                  <td className={cn(TD, 'text-right pr-2 font-mono text-[10.5px] tabular-nums text-slate-300 pt-[13px]')}>{i + 1}</td>
                                  <td className={cn(TD, 'px-2')}>
                                    <p className="text-[12.5px] font-medium text-slate-800 leading-snug">{s.productNaziv ?? `#${s.productId}`}</p>
                                    <p className="text-[10.5px] font-mono text-slate-400">
                                      {s.productSifra}
                                      {mat && <span className="ml-1.5 font-sans font-semibold text-violet-500">materijal</span>}
                                      <span className={cn('ml-1.5 font-sans font-semibold', s.pdvStopa === 'E' ? 'text-amber-600' : 'text-slate-400')}>PDV {s.pdvStopa}</span>
                                    </p>
                                  </td>
                                  <td className={cn(TD, 'px-2 text-right font-mono text-[12.5px] tabular-nums text-slate-800 whitespace-nowrap pt-[11px]')}>
                                    {s.kolicina} <span className="text-[11px] text-slate-400">{s.productJm || 'kom'}</span>
                                    {prod && jePloca(prod) && <span className="block text-[10px] text-slate-400">≈ {m2UKom(s.kolicina, prod.plocaSirina!, prod.plocaVisina!)} ploča</span>}
                                  </td>
                                  <td className={cn(TD, 'px-2 text-right font-mono text-[12px] tabular-nums text-slate-600 pt-[11px]')}>{formatKM(s.nabavnaCijena || 0)}</td>
                                  <td className={cn(TD, 'px-2 text-right font-mono text-[12px] tabular-nums pt-[11px]', s.rabat > 0 ? 'text-blue-600' : 'text-slate-300')}>{s.rabat > 0 ? `${s.rabat} %` : '—'}</td>
                                  <td className={cn(TD, 'px-2 text-right font-mono text-[12px] tabular-nums pt-[11px]', mat ? 'text-slate-300' : 'text-slate-600')}>{mat ? '—' : formatKM(s.cijena)}</td>
                                  <td className={cn(TD, 'pl-2 text-right font-mono text-[13px] font-semibold tabular-nums text-slate-900 pt-[11px]')}>
                                    {formatKM(nabavnaVrijednost(s))}
                                    {(s.rabat > 0 || s.zavisniTroskovi > 0) && s.kolicina > 0 && (
                                      <span className="block text-[10px] font-normal text-slate-400">{formatKM(nabavnaVrijednost(s) / s.kolicina)} / {s.productJm || 'kom'}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>

                <aside className="lg:sticky lg:top-0 self-start space-y-4">
                  <section className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 pt-3 pb-4" aria-label="Vrijednost ulaza">
                    <Eyebrow className="block mb-1">Kalkulacija</Eyebrow>
                    <Kalkulacija k={edit ? totali : pregled} />
                  </section>
                  {edit && razlike.length > 0 && (
                    <section className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3" aria-label="Nivelacija">
                      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700"><AlertTriangle size={12} /> Spremanje mijenja prodajne cijene</p>
                      <ul className="mt-1.5 space-y-0.5">
                        {razlike.map(r => (
                          <li key={r.productId} className="flex items-center justify-between gap-2 text-[11px] text-amber-700">
                            <span className="truncate">{r.productNaziv}</span>
                            <span className="font-mono tabular-nums whitespace-nowrap">{formatKM(r.staraCijena)} → {formatKM(r.novaCijena)}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-[10.5px] text-amber-600/80">Zaliha se niveliše automatski uz ulaz.</p>
                    </section>
                  )}
                </aside>
              </div>
            </div>

            {edit ? (
              <FullDialogFooter legend={<>
                <LegendKey k="↵">sljedeće polje</LegendKey>
                <LegendKey k="/">novi red</LegendKey>
                <LegendKey k="esc">otkaži</LegendKey>
              </>}>
                {fali && <span className="flex items-center gap-1.5 text-[11.5px] text-amber-600 mr-1"><AlertTriangle size={12} /> {fali}</span>}
                <FooterBtn icon={X} label="Otkaži" onClick={otkazi} />
                <FooterBtn icon={Save} label={saving ? 'Spremam…' : primka ? 'Spremi izmjene' : 'Spremi ulaz'} tone="primary" onClick={spremi}
                  disabled={!!fali || !forma.brojPrimke.trim() || saving} hint={mod('↵')} />
              </FullDialogFooter>
            ) : (
              <FullDialogFooter legend={<>
                <span className="flex items-center gap-1">
                  <button onClick={() => prevId != null && guarded({ kind: 'nav', id: prevId })} disabled={prevId == null} aria-label="Prethodni ulaz"
                    className="h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><ChevronUp size={14} /></button>
                  <button onClick={() => nextId != null && guarded({ kind: 'nav', id: nextId })} disabled={nextId == null} aria-label="Sljedeći ulaz"
                    className="h-6 w-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><ChevronDown size={14} /></button>
                  <span className="font-mono tabular-nums ml-1">{idx >= 0 ? `${idx + 1} / ${redoslijed.length}` : ''}</span>
                </span>
                <span className="text-slate-300">·</span>
                <LegendKey k="↑↓">ulaz</LegendKey>
                <LegendKey k="esc">zatvori</LegendKey>
              </>}>
                <FooterBtn icon={Trash2} label="Obriši" hint="D" tone="danger" onClick={() => setBrisiOpen(true)} />
                <div className="flex items-center gap-1.5">
                  <FooterBtn icon={Printer} label="Štampaj" hint="P" onClick={printPdf} />
                  <FooterBtn icon={Download} title="Sačuvaj PDF (S)" onClick={exportPdf} />
                </div>
                <FooterBtn icon={Pencil} label="Uredi" hint="U" tone="primary" onClick={() => primka && pocniUredjivanje(primka)} />
              </FullDialogFooter>
            )}
          </>
        )}
      </FullDialogContent>

      <Dialog open={pending != null} onOpenChange={v => { if (!v) setPending(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Nespremljene izmjene</DialogTitle>
            <DialogDescription>Ulaz ima izmjene koje nisu spremljene.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-between items-center gap-2 pt-2">
            <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={odbaci}>Odbaci izmjene</Button>
            <Button variant="ghost" onClick={() => setPending(null)}>Ostani</Button>
          </div>
        </DialogContent>
      </Dialog>

      {primka && (
        <Dialog open={brisiOpen} onOpenChange={setBrisiOpen}>
          <DialogContent className="sm:max-w-[420px]" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); obrisi(); } }}>
            <DialogHeader>
              <DialogTitle>Obrisati ulaz {primka.brojPrimke}?</DialogTitle>
              <DialogDescription>Stanje robe sa ovog ulaza se skida sa skladišta, a nivelacija uz njega se poništava. Brisanje se ne može poništiti.</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setBrisiOpen(false)}>Otkaži</Button>
              <Button variant="destructive" onClick={obrisi}>Obriši <Key tone="danger">{mod('↵')}</Key></Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={nivelacija != null} onOpenChange={v => { if (!v) setNivelacija(null); }}>
        <DialogContent className="sm:max-w-lg" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); spremi(); } }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" /> Nivelacija cijena</DialogTitle>
            <DialogDescription>Ovi artikli imaju zalihu po staroj prodajnoj cijeni. Spremanje ulaza automatski kreira nivelaciju i ažurira cijene.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-400 border-b">
                  <th className="text-left py-2 font-semibold">Artikal</th>
                  <th className="text-right py-2 font-semibold">Zaliha</th>
                  <th className="text-right py-2 font-semibold">Stara</th>
                  <th className="text-right py-2 font-semibold">Nova</th>
                  <th className="text-right py-2 font-semibold">Razlika</th>
                </tr>
              </thead>
              <tbody>
                {(nivelacija ?? []).map(r => (
                  <tr key={r.productId} className="border-b border-slate-50">
                    <td className="py-2 text-slate-800">{r.productNaziv}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-500">{r.kolicina}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-500">{formatKM(r.staraCijena)}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-800">{formatKM(r.novaCijena)}</td>
                    <td className={cn('py-2 text-right font-mono tabular-nums font-semibold', r.ukupnaRazlika >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{formatKM(r.ukupnaRazlika)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setNivelacija(null)}>Otkaži</Button>
            <Button onClick={spremi} disabled={saving}>{saving ? 'Spremam…' : 'Spremi i niveliši'} <Key tone="dark">{mod('↵')}</Key></Button>
          </div>
        </DialogContent>
      </Dialog>
    </FullDialog>
  );
}
