import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Product, Primka, Dobavljac } from '@/types';
import { cn, formatKM, formatDate, parseDecimal, porukaGreske } from '@/lib/utils';
import { useCijenaUnos } from '@/hooks/useCijenaUnos';
import { CijenaPdvPolje } from '@/components/CijenaPdvPolje';
import { useProizvodnja } from '@/hooks/useProizvodnja';
import { jePloca, m2UKom } from '@/lib/ploca';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  FullDialog, FullDialogContent, FullDialogHeader, FullDialogFooter, FullDialogNotice, FooterBtn, LegendKey,
} from '@/components/ui/full-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Eyebrow, Key, LedgerHead, SegmentedFilter, mod } from '@/components/ui/ledger';
import { UlazDialog, type UlazStanje } from '@/components/skladiste/UlazDialog';
import { DobavljacSifreEditor } from '@/components/skladiste/DobavljacSifreEditor';
import { uPayload, uRedove, type SifraRed } from '@/lib/dobavljacSifre';
import { filtriraj, poljaProizvoda, type PoljaPretrage } from '@/lib/pretraga';
import {
  Plus, Trash2, FileText, Package, Search, Pencil, X, Save,
  PackagePlus, Barcode, ChevronRight,
  Lock, RefreshCw,
} from 'lucide-react';
import { potvrdi, obavijesti } from '@/lib/dijalog';

type SkladisteTab = 'artikli' | 'primke';

// ---------------------------------------------------------------------------
// Artikal Dialog — preko cijelog ekrana, isti jezik kao ulaz robe
// ---------------------------------------------------------------------------

interface ArtikalFormData {
  sifra: string;
  barkod: string;
  naziv: string;
  jm: string;
  pdvStopa: 'E' | 'K';
  stanje: string;
}

const emptyArtikalForm: ArtikalFormData = {
  sifra: '',
  barkod: '',
  naziv: '',
  jm: 'kom',
  pdvStopa: 'E',
  stanje: '',
};

/** Tring: naziv + JM stane u 36 znakova na fiskalnom računu (Partner kase 32). */
const NAZIV_NA_RACUNU = 36;

const labela = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400';

function ArtikalDialog({
  open,
  onOpenChange,
  product,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: Product | null;
  onSave: () => void;
}) {
  const [form, setFormState] = useState<ArtikalFormData>(emptyArtikalForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [odbaciOpen, setOdbaciOpen] = useState(false);
  const cijena = useCijenaUnos(open, product, form.pdvStopa);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [sifreRedovi, setSifreRedovi] = useState<SifraRed[]>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const nazivRef = useRef<HTMLInputElement | null>(null);
  // Artikal kreiran u ovom otvaranju dijaloga: ako padnu šifre dobavljača, ponovno
  // spremanje ga ažurira umjesto da pravi duplikat.
  const kreiranId = useRef<number | null>(null);

  const setForm = (izmjena: Partial<ArtikalFormData>) => {
    setFormState(f => ({ ...f, ...izmjena }));
    setDirty(true);
  };

  useEffect(() => {
    if (!open) return;
    kreiranId.current = null;
    setSifreRedovi([]);
    let aktivno = true;
    window.api.getDobavljaci().then(d => { if (aktivno) setDobavljaci(d); }).catch(() => {});
    if (product) {
      window.api.getDobavljacSifre(product.id)
        .then(l => { if (aktivno) setSifreRedovi(uRedove(l)); })
        .catch(err => { if (aktivno) setError(porukaGreske(err)); });
    }
    return () => { aktivno = false; };
  }, [open, product]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setDirty(false);
    setOdbaciOpen(false);
    if (product) {
      setFormState({
        sifra: product.sifra,
        barkod: product.barkod ?? '',
        naziv: product.naziv,
        jm: product.jm,
        pdvStopa: product.pdvStopa,
        stanje: String(product.stanje ?? 0),
      });
    } else {
      setFormState(emptyArtikalForm);
    }
    // Fokus na naziv tek kad se sadržaj montira (FullDialog fokusira sebe na otvaranju).
    requestAnimationFrame(() => nazivRef.current?.focus());
  }, [open, product]);

  const cijenaOk = cijena.spremno && cijena.unos !== '' && !isNaN(cijena.bruto);
  const mozeSpremiti = !saving && !!form.sifra && !!form.naziv && cijenaOk;

  const handleSave = async () => {
    if (!mozeSpremiti) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        sifra: form.sifra,
        barkod: form.barkod || null,
        naziv: form.naziv,
        jm: form.jm,
        cijena: cijena.bruto,
        pdvStopa: form.pdvStopa,
      };
      if (product) {
        await window.api.updateProduct(product.id, payload);
        const newStanje = parseDecimal(form.stanje);
        if (!isNaN(newStanje) && newStanje !== (product.stanje ?? 0)) {
          await window.api.adjustStock(product.id, newStanje);
        }
        await window.api.setDobavljacSifre(product.id, uPayload(sifreRedovi));
      } else if (kreiranId.current !== null) {
        await window.api.updateProduct(kreiranId.current, payload);
        await window.api.setDobavljacSifre(kreiranId.current, uPayload(sifreRedovi));
      } else {
        const result = await window.api.createProduct(payload);
        kreiranId.current = Number(result.id);
        const initialStock = parseDecimal(form.stanje);
        if (!isNaN(initialStock) && initialStock > 0 && result?.id) {
          await window.api.adjustStock(Number(result.id), initialStock);
        }
        await window.api.setDobavljacSifre(kreiranId.current, uPayload(sifreRedovi));
      }
      onSave();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Greška pri spremanju');
      // Novi artikal je upisan i kad padnu šifre dobavljača — neka se vidi u listi.
      if (!product && kreiranId.current !== null) onSave();
    } finally {
      setSaving(false);
    }
  };

  const zatvori = () => {
    if (saving) return;
    if (dirty) { setOdbaciOpen(true); return; }
    onOpenChange(false);
  };

  // ⌘↵ sprema iz bilo kojeg polja.
  useEffect(() => {
    if (!open || odbaciOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isEdit = !!product;
  const stanjeBroj = parseDecimal(form.stanje);
  const promjenaStanja = isEdit && !isNaN(stanjeBroj) && stanjeBroj !== (product.stanje ?? 0)
    ? stanjeBroj - (product.stanje ?? 0) : 0;

  return (
    <FullDialog open={open} onRequestClose={zatvori}>
      <FullDialogContent ref={contentRef} onRequestClose={zatvori}>
        <FullDialogHeader
          eyebrow={isEdit ? 'Izmjena artikla' : 'Novi artikal'}
          title={form.sifra || <span className="text-white/30">—</span>}
          description={form.naziv || <span className="text-white/40">bez naziva</span>}
        />

        {error && <FullDialogNotice type="error" text={error} onClose={() => setError('')} />}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-10 gap-y-8 px-6 py-6 mx-auto w-full max-w-[1320px]">
            <div className="min-w-0 space-y-8">
              <section aria-label="Artikal" className="space-y-5">
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="naziv" className={labela}>Naziv artikla</Label>
                    <NazivBrojac naziv={form.naziv} jm={form.jm} />
                  </div>
                  <Input
                    id="naziv"
                    ref={nazivRef}
                    value={form.naziv}
                    onChange={e => setForm({ naziv: e.target.value })}
                    placeholder="npr. Coca-Cola 0,5 L"
                    className="h-12 text-lg font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sifra" className={labela}>Šifra</Label>
                    <Input id="sifra" value={form.sifra} onChange={e => setForm({ sifra: e.target.value })}
                      placeholder="001" className="h-10 font-mono text-[13px]" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="barkod" className={labela}>Barkod</Label>
                    <div className="relative">
                      <Barcode className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" aria-hidden />
                      <Input id="barkod" value={form.barkod} onChange={e => setForm({ barkod: e.target.value })}
                        placeholder="Skeniraj ili upiši — opcionalno" className="h-10 pl-9 font-mono text-[13px] placeholder:font-sans" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="jm" className={labela}>Jedinica mjere</Label>
                    <Input id="jm" value={form.jm} onChange={e => setForm({ jm: e.target.value })}
                      placeholder="kom" className="h-10 text-[13px]" />
                  </div>
                </div>
              </section>

              <Separator className="bg-slate-100" />

              <section aria-label="Zaliha" className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-8 gap-y-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-800">Zaliha</h3>
                  <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                    {isEdit
                      ? 'Promjena stanja upisuje korekciju zalihe. Redovan prijem ide kroz ulaz robe.'
                      : 'Početno stanje na skladištu. Kasnije robu primaš kroz ulaz robe.'}
                  </p>
                </div>
                <div className="space-y-1.5 max-w-[260px]">
                  <Label htmlFor="stanje" className={labela}>Stanje na skladištu</Label>
                  <div className="relative">
                    <DecimalInput
                      id="stanje"
                      maxDecimals={3}
                      className="h-10 pr-12 text-right font-mono text-[13px]"
                      placeholder="0"
                      value={form.stanje}
                      onValueChange={text => setForm({ stanje: text })}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" aria-hidden>
                      {form.jm || 'kom'}
                    </span>
                  </div>
                  {promjenaStanja !== 0 && (
                    <p className={cn('text-[11px] font-mono tabular-nums', promjenaStanja > 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      korekcija {promjenaStanja > 0 ? '+' : '−'}{Math.abs(Math.round(promjenaStanja * 1000) / 1000).toLocaleString('bs-BA')} {form.jm}
                    </p>
                  )}
                </div>
              </section>

              <Separator className="bg-slate-100" />

              <section aria-label="Šifre dobavljača" className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-8 gap-y-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-slate-800">
                    Šifre dobavljača <span className="font-normal text-slate-400">· opcionalno</span>
                  </h3>
                  <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                    Šifra pod kojom dobavljač vodi ovaj artikal — po njoj se stavke s njegove fakture same prepoznaju na ulazu robe.
                  </p>
                </div>
                <div className="min-w-0">
                  <DobavljacSifreEditor redovi={sifreRedovi} dobavljaci={dobavljaci}
                    onChange={r => { setSifreRedovi(r); setDirty(true); }} />
                </div>
              </section>
            </div>

            <aside className="lg:sticky lg:top-0 self-start space-y-4">
              <section className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 pt-3 pb-4 space-y-4" aria-label="Cijena">
                <div className="space-y-1.5">
                  <Eyebrow className="block">PDV stopa</Eyebrow>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/60 p-0.5" role="radiogroup" aria-label="PDV stopa">
                    {([['E', `${PDV_STOPA_E_PCT} %`], ['K', '0 %']] as const).map(([s, pct]) => (
                      <button key={s} type="button" role="radio" aria-checked={form.pdvStopa === s}
                        onClick={() => setForm({ pdvStopa: s })}
                        className={cn(
                          'h-8 rounded-md text-[12.5px] font-medium transition-colors duration-150',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                          form.pdvStopa === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                        )}>
                        <span className="font-mono font-semibold">{s}</span> <span className="text-slate-400">·</span> {pct}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cijena" className={cn(labela, 'block')}>Prodajna cijena (KM)</Label>
                  <CijenaPdvPolje
                    id="cijena"
                    unos={cijena.unos}
                    onUnos={t => { cijena.setUnos(t); setDirty(true); }}
                    bezPdv={cijena.bezPdv}
                    onRezim={cijena.setRezim}
                    stopa={form.pdvStopa}
                    bruto={cijena.bruto}
                  />
                </div>
              </section>

              <RedNaRacunu naziv={form.naziv} jm={form.jm} stopa={form.pdvStopa} bruto={cijenaOk ? cijena.bruto : NaN} />
            </aside>
          </div>
        </div>

        <FullDialogFooter legend={<>
          <LegendKey k={mod('↵')}>spremi</LegendKey>
          <LegendKey k="esc">otkaži</LegendKey>
        </>}>
          <FooterBtn icon={X} label="Otkaži" onClick={zatvori} />
          <FooterBtn icon={Save} tone="primary" disabled={!mozeSpremiti} onClick={handleSave}
            label={saving ? 'Spremam…' : isEdit ? 'Spremi izmjene' : 'Dodaj artikal'} hint={mod('↵')}
            title={!form.naziv ? 'Upiši naziv' : !form.sifra ? 'Upiši šifru' : !cijenaOk ? 'Upiši cijenu' : undefined} />
        </FullDialogFooter>
      </FullDialogContent>

      <Dialog open={odbaciOpen} onOpenChange={setOdbaciOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Nespremljene izmjene</DialogTitle>
            <DialogDescription>
              {isEdit ? 'Artikal ima izmjene koje nisu spremljene.' : 'Novi artikal nije spremljen.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-between items-center gap-2 pt-2">
            <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              onClick={() => { setOdbaciOpen(false); onOpenChange(false); }}>
              Odbaci izmjene
            </Button>
            <Button variant="ghost" autoFocus onClick={() => setOdbaciOpen(false)}>Ostani</Button>
          </div>
        </DialogContent>
      </Dialog>
    </FullDialog>
  );
}

/** Koliko znakova naziv + JM troši od reda na fiskalnom računu. */
function NazivBrojac({ naziv, jm }: { naziv: string; jm: string }) {
  const n = naziv.trim().length + (jm.trim() ? jm.trim().length + 1 : 0);
  const preko = n > NAZIV_NA_RACUNU;
  return (
    <span className={cn('font-mono text-[10.5px] tabular-nums', preko ? 'text-amber-600' : 'text-slate-400')}
      title="Naziv i jedinica mjere na fiskalnom računu staju u 36 znakova; duži naziv kasa skraćuje.">
      {n}/{NAZIV_NA_RACUNU}
    </span>
  );
}

/** Pregled reda kako ga štampa fiskalna kasa — naziv se reže na širinu trake. */
function RedNaRacunu({ naziv, jm, stopa, bruto }: { naziv: string; jm: string; stopa: 'E' | 'K'; bruto: number }) {
  const puni = [naziv.trim() || 'Naziv artikla', jm.trim()].filter(Boolean).join(' ');
  const odrezan = puni.length > NAZIV_NA_RACUNU;
  const prikaz = odrezan ? puni.slice(0, NAZIV_NA_RACUNU) : puni;
  const iznos = isNaN(bruto) ? '—' : formatKM(bruto).replace(/\s*KM$/, '');
  return (
    <section aria-label="Na fiskalnom računu" className="px-1">
      <Eyebrow className="block mb-2">Na fiskalnom računu</Eyebrow>
      <div className="rounded-lg bg-white border border-slate-200 px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-slate-700 shadow-sm">
        <div className={cn('break-all', !naziv.trim() && 'text-slate-300')}>
          {prikaz}{odrezan && <span className="text-amber-500 line-through decoration-amber-400/70">{puni.slice(NAZIV_NA_RACUNU)}</span>}
        </div>
        <div className="flex justify-between gap-3 tabular-nums">
          <span className="text-slate-500">1 × {iznos}</span>
          <span>{iznos} <span className="font-semibold">{stopa}</span></span>
        </div>
      </div>
      {odrezan && (
        <p className="mt-2 text-[11px] text-amber-700 leading-snug">
          Kasa odreže precrtani dio naziva. Skrati naziv da kupac vidi cijeli.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Artikli Tab — refined data table with search & summary
// ---------------------------------------------------------------------------

type ZalihaFilter = 'svi' | 'malo' | 'nema';

const ZALIHA_FILTERI: { id: ZalihaFilter; label: string }[] = [
  { id: 'svi', label: 'Svi' },
  { id: 'malo', label: 'Malo na stanju' },
  { id: 'nema', label: 'Nema na stanju' },
];

/** Ispod ovoga artikal je "malo na stanju" — isti prag koji je lista i ranije bojila. */
const MALO_NA_STANJU = 10;

function razinaZalihe(p: Product): ZalihaFilter {
  const s = p.stanje ?? 0;
  return s <= 0 ? 'nema' : s <= MALO_NA_STANJU ? 'malo' : 'svi';
}

function ArtikliTab({
  products,
  onReload,
}: {
  products: Product[];
  onReload: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'naziv' | 'stanje' | 'cijena'>('naziv');
  const [filter, setFilter] = useState<ZalihaFilter>('svi');
  const searchRef = useRef<HTMLInputElement>(null);

  const handleNew = () => {
    setEditProduct(null);
    setDialogOpen(true);
  };

  const handleEdit = (p: Product) => {
    setEditProduct(p);
    setDialogOpen(true);
  };

  const handleDialogOpenChange = (v: boolean) => {
    setDialogOpen(v);
    if (!v) setEditProduct(null);
  };

  const handleDelete = async (p: Product) => {
    if (!(await potvrdi(`Obrisati artikal "${p.naziv}"?`))) return;
    try { await window.api.deleteProduct(p.id); onReload(); }
    catch (e) { await obavijesti(porukaGreske(e)); }
  };

  const trazeni = filtriraj(products, search, poljaProizvoda);
  // Brojači idu po pretrazi, da se vidi ima li šta iza filtera.
  const counts: Record<ZalihaFilter, number> = { svi: trazeni.length, malo: 0, nema: 0 };
  for (const p of trazeni) counts[razinaZalihe(p)] += razinaZalihe(p) === 'svi' ? 0 : 1;

  const filtered = trazeni
    .filter(p => filter === 'svi' || razinaZalihe(p) === filter)
    .sort((a, b) => {
      if (sortBy === 'stanje') return (b.stanje ?? 0) - (a.stanje ?? 0);
      if (sortBy === 'cijena') return b.cijena - a.cijena;
      return a.naziv.localeCompare(b.naziv, 'bs');
    });

  // "/" pretraga, "N" novi artikal — isto kao na ulazu robe.
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (t === searchRef.current && e.key === 'Escape') { setSearch(''); t.blur(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); handleNew(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen]);

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Naziv, šifra, barkod ili šifra dobavljača…"
            aria-label="Pretraga artikala"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <SegmentedFilter options={ZALIHA_FILTERI} value={filter} onChange={setFilter} counts={counts} />

        <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
          <span className="hidden md:inline">Poredaj</span>
          <SegmentedFilter
            options={[{ id: 'naziv', label: 'A–Z' }, { id: 'cijena', label: 'Cijena' }, { id: 'stanje', label: 'Stanje' }]}
            value={sortBy} onChange={setSortBy} />
        </div>

        <Button size="sm" onClick={handleNew} className="ml-auto h-8 gap-1.5 pl-3 pr-2 text-[12px]">
          <Plus className="h-3.5 w-3.5" /> Novi artikal <Key tone="dark">N</Key>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Package size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">
            {search ? 'Nema rezultata pretrage' : filter !== 'svi' ? 'Nema artikala u ovom filteru' : 'Nema artikala'}
          </p>
          {!search && filter === 'svi' && <p className="text-[12px] text-slate-400 mt-0.5">Prvi artikal dodaješ tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <table className="w-full border-separate border-spacing-0">
            <LedgerHead columns={[
              { label: 'Šifra', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
              { label: 'Naziv', className: 'text-left px-3' },
              { label: 'Barkod', className: 'text-left px-3 w-[160px] hidden xl:table-cell' },
              { label: 'PDV', className: 'text-center px-3 w-[70px] hidden lg:table-cell' },
              { label: 'Cijena', className: 'text-right px-3 w-[120px]' },
              { label: 'Stanje', className: 'text-right px-3 w-[130px]' },
              { label: '', className: 'pr-6 pl-2 w-[1%]' },
            ]} />
            <tbody>
              {filtered.map((p) => {
                const stock = p.stanje ?? 0;
                const razina = razinaZalihe(p);
                const materijal = p.tip === 'materijal';
                return (
                  <tr
                    key={p.id}
                    className={cn('group transition-colors hover:bg-slate-50', materijal ? 'cursor-default' : 'cursor-pointer')}
                    onClick={() => { if (!materijal) handleEdit(p); }}
                  >
                    <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{p.sifra}</td>
                    <td className={cn(td, 'px-3 max-w-0')}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-[12.5px] font-medium text-slate-800">{p.naziv}</span>
                        {materijal && (
                          <span className="flex-shrink-0 rounded px-1.5 py-px text-[9.5px] font-semibold bg-violet-50 text-violet-600 border border-violet-100">materijal</span>
                        )}
                      </span>
                      {p.barkod && <span className="xl:hidden block font-mono text-[10.5px] text-slate-400 truncate">{p.barkod}</span>}
                    </td>
                    <td className={cn(td, 'hidden xl:table-cell px-3 font-mono text-[11.5px] text-slate-400 whitespace-nowrap')}>
                      {p.barkod || <span className="text-slate-200">—</span>}
                    </td>
                    <td className={cn(td, 'hidden lg:table-cell px-3 text-center font-mono text-[11px] whitespace-nowrap')}>
                      <span className="font-semibold text-slate-600">{p.pdvStopa}</span>
                      <span className="text-slate-400"> {p.pdvStopa === 'E' ? `${PDV_STOPA_E_PCT}%` : '0%'}</span>
                    </td>
                    <td className={cn(td, 'px-3 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800 whitespace-nowrap')}>
                      {formatKM(p.cijena)}
                    </td>
                    <td className={cn(td, 'px-3 text-right whitespace-nowrap')}>
                      <span className="flex items-baseline justify-end gap-1.5 font-mono text-[12.5px] tabular-nums leading-5">
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full self-center',
                          razina === 'nema' ? 'bg-rose-500' : razina === 'malo' ? 'bg-amber-400' : 'bg-emerald-500')} />
                        <span className={cn('font-semibold', razina === 'nema' ? 'text-rose-600' : 'text-slate-800')}>
                          {jePloca(p) ? stock.toFixed(2).replace('.', ',') : stock}
                        </span>
                        <span className="text-[11px] text-slate-400">{p.jm}</span>
                      </span>
                      {jePloca(p) && (
                        <span className="block font-mono text-[10px] tabular-nums text-slate-400">
                          ≈ {m2UKom(stock, p.plocaSirina!, p.plocaVisina!)} ploča
                        </span>
                      )}
                    </td>
                    <td className={cn(td, 'pr-6 pl-2 text-right')}>
                      {materijal ? (
                        <span title="Materijal se uređuje u Šifarniku, na kartici Materijal"
                          className="inline-flex h-7 items-center gap-1 px-2 whitespace-nowrap text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Lock className="h-3 w-3" /> Šifarnik
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700" title="Uredi" aria-label={`Uredi ${p.naziv}`}
                            onClick={(e) => { e.stopPropagation(); handleEdit(p); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50" title="Obriši" aria-label={`Obriši ${p.naziv}`}
                            onClick={(e) => { e.stopPropagation(); handleDelete(p); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      )}

      <ArtikalDialog
        key={editProduct?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        product={editProduct}
        onSave={onReload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ulaz robe Tab — lista preko cijele širine, dokument u dijalogu preko svega
// ---------------------------------------------------------------------------

/** Pretraga ulaza: dobavljač, broj primke, broj fakture i napomena. */
const poljaPrimke = (p: Primka): PoljaPretrage => ({
  naziv: p.dobavljacNaziv ?? '',
  sifra: p.brojPrimke,
  dodatno: [p.brojPrimke, p.brojFakture, p.napomena].join(' '),
});

function PrimkeTab({ products, dobavljaci, onReloadProducts }: { products: Product[]; dobavljaci: Dobavljac[]; onReloadProducts: () => void }) {
  const [primke, setPrimke] = useState<Primka[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stanje, setStanje] = useState<UlazStanje>({ kind: 'zatvoren' });
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadPrimke = useCallback(async () => { setPrimke(await window.api.getPrimke()); }, []);
  useEffect(() => { loadPrimke(); }, [loadPrimke]);

  const visible = useMemo(() => {
    return filtriraj(primke, search, poljaPrimke);
  }, [primke, search]);
  const visibleIds = useMemo(() => visible.map(p => p.id), [visible]);
  const selIndex = visible.findIndex(p => p.id === selectedId);

  const focusRow = useCallback((index: number) => {
    const p = visible[index];
    if (!p) return;
    setSelectedId(p.id);
    const el = rowRefs.current[index];
    el?.focus(); el?.scrollIntoView({ block: 'nearest' });
  }, [visible]);

  const otvori = (id: number) => { setSelectedId(id); setStanje({ kind: 'pregled', id }); };
  const novi = () => setStanje({ kind: 'novi' });

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

  const dialogOpen = stanje.kind !== 'zatvoren';
  useEffect(() => {
    if (dialogOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const uPolju = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (uPolju) {
        // Iz pretrage ↓ vodi na listu, esc briše upit.
        if (t === searchRef.current && e.key === 'ArrowDown') { e.preventDefault(); focusRow(selIndex < 0 ? 0 : selIndex); }
        if (t === searchRef.current && e.key === 'Escape') { setSearch(''); (t as HTMLInputElement).blur(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!t?.closest('tbody')) { e.preventDefault(); focusRow(selIndex < 0 ? 0 : selIndex); } return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); novi(); return; }
      if (e.key.toLowerCase() === 'r') { e.preventDefault(); loadPrimke(); return; }
      if (e.key === 'Enter' && selectedId != null) { e.preventDefault(); otvori(selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, selectedId, selIndex, focusRow, loadPrimke]);

  const zatvori = () => {
    setStanje({ kind: 'zatvoren' });
    requestAnimationFrame(() => { const i = visible.findIndex(p => p.id === selectedId); if (i >= 0) rowRefs.current[i]?.focus(); });
  };

  const td = 'py-2.5 border-b border-slate-100';

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Broj, dobavljač, faktura ili napomena…"
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200" aria-label="Pretraga ulaza" />
          {search
            ? <button onClick={() => setSearch('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        <span className="text-[11.5px] text-slate-400">
          <span className="font-mono tabular-nums text-slate-600">{search ? `${visible.length} / ${primke.length}` : primke.length}</span> ulaza
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadPrimke} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
            <RefreshCw className="h-3.5 w-3.5" /> Osvježi <Key>R</Key>
          </Button>
          <Button size="sm" onClick={novi} className="h-8 gap-1.5 pl-3 pr-2 text-[12px]">
            <Plus className="h-3.5 w-3.5" /> Novi ulaz <Key tone="dark">N</Key>
          </Button>
        </div>
      </div>

      {msg && (
        <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2 border-b border-emerald-100 bg-emerald-50/60 text-[12px] font-medium text-emerald-700">
          <PackagePlus className="h-3.5 w-3.5" /> {msg}
          <button className="ml-auto text-emerald-600/70 hover:text-emerald-800" onClick={() => setMsg(null)} aria-label="Sakrij poruku"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><FileText size={20} className="text-slate-300" /></div>
          <p className="text-[13px] font-medium text-slate-500">{search ? 'Nema rezultata pretrage' : 'Nema ulaza robe'}</p>
          {!search && <p className="text-[12px] text-slate-400 mt-0.5">Prvi ulaz otvaraš tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1">
            <table className="w-full border-separate border-spacing-0">
              <LedgerHead columns={[
                { label: 'Broj', className: 'text-left pl-6 pr-3 w-[1%] whitespace-nowrap' },
                { label: 'Datum', className: 'text-left px-3 w-[1%] whitespace-nowrap' },
                { label: 'Dobavljač', className: 'text-left px-3' },
                { label: 'Faktura', className: 'text-left px-3 w-[160px] hidden lg:table-cell' },
                { label: 'Napomena', className: 'text-left px-3 w-[32%] hidden xl:table-cell' },
                { label: '', className: 'pr-6 pl-2 w-[1%]' },
              ]} />
              <tbody onKeyDown={handleListKeyDown}>
                {visible.map((p, i) => {
                  const isSel = selectedId === p.id;
                  return (
                    <tr key={p.id}
                      ref={el => { rowRefs.current[i] = el; }}
                      tabIndex={isSel || (selIndex < 0 && i === 0) ? 0 : -1}
                      aria-selected={isSel}
                      onClick={() => otvori(p.id)}
                      onFocus={() => setSelectedId(p.id)}
                      className={cn('group cursor-pointer transition-colors',
                        'focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-500',
                        isSel ? 'bg-blue-50/70' : 'hover:bg-slate-50')}>
                      <td className={cn(td, 'pl-6 pr-3 font-mono text-[12px] tabular-nums whitespace-nowrap',
                        isSel ? 'font-semibold text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-400')}>{p.brojPrimke}</td>
                      <td className={cn(td, 'px-3 text-[12px] text-slate-500 tabular-nums whitespace-nowrap')}>{formatDate(p.datum)}</td>
                      <td className={cn(td, 'px-3 max-w-0')}>
                        {p.dobavljacNaziv
                          ? <span className="block truncate text-[12.5px] font-medium text-slate-800">{p.dobavljacNaziv}</span>
                          : <span className="block truncate text-[12.5px] text-slate-400">bez dobavljača</span>}
                        {p.brojFakture && <span className="lg:hidden block font-mono text-[10.5px] text-slate-400 truncate">{p.brojFakture}</span>}
                      </td>
                      <td className={cn(td, 'hidden lg:table-cell px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap truncate max-w-0')}>
                        {p.brojFakture || <span className="text-slate-200">—</span>}
                      </td>
                      <td className={cn(td, 'hidden xl:table-cell px-3 text-[12px] text-slate-400 truncate max-w-0')}>
                        {p.napomena || <span className="text-slate-200">—</span>}
                      </td>
                      <td className={cn(td, 'pr-6 pl-2 text-right')}>
                        <ChevronRight className={cn('inline h-3.5 w-3.5 transition-colors', isSel ? 'text-blue-500' : 'text-slate-300 group-hover:text-slate-500')} />
                      </td>
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
              <span className="flex items-center gap-1"><Key className="ml-0">/</Key> pretraga</span>
              <span className="flex items-center gap-1"><Key className="ml-0">N</Key> novi</span>
              <span className="flex items-center gap-1"><Key className="ml-0">R</Key> osvježi</span>
            </span>
          </div>
        </>
      )}

      <UlazDialog
        stanje={stanje}
        products={products}
        dobavljaci={dobavljaci}
        redoslijed={visibleIds}
        onClose={zatvori}
        onNavigate={otvori}
        onSaved={async (id) => { await loadPrimke(); onReloadProducts(); if (id) { setSelectedId(id); setStanje({ kind: 'pregled', id }); } else setStanje({ kind: 'zatvoren' }); }}
        onDeleted={async (p) => { setStanje({ kind: 'zatvoren' }); setSelectedId(null); await loadPrimke(); onReloadProducts(); setMsg(`Ulaz ${p.brojPrimke} obrisan`); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function SkladisteScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [activeTab, setActiveTab] = useState<SkladisteTab>('artikli');
  const proizvodnja = useProizvodnja();

  const loadProducts = useCallback(async () => {
    const artikli = await window.api.getProducts('artikal');
    const materijal = proizvodnja ? await window.api.getProducts('materijal') : [];
    setProducts([...artikli, ...materijal]);
  }, [proizvodnja]);

  const loadDobavljaci = useCallback(async () => {
    const data = await window.api.getDobavljaci();
    setDobavljaci(data);
  }, []);

  useEffect(() => {
    loadProducts();
    loadDobavljaci();
  }, [loadProducts, loadDobavljaci]);

  const tabs: { id: SkladisteTab; label: string; icon: typeof Package }[] = [
    { id: 'artikli', label: 'Artikli', icon: Package },
    { id: 'primke', label: 'Ulaz robe', icon: FileText },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar with tabs */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'artikli' && <ArtikliTab products={products} onReload={loadProducts} />}
        {activeTab === 'primke' && <PrimkeTab products={products} dobavljaci={dobavljaci} onReloadProducts={loadProducts} />}
      </div>
    </div>
  );
}
