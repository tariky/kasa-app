import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PretragaStavki } from '@/components/ui/pretraga-stavki';
import { Key } from '@/components/ui/ledger';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Building2, Check, Pencil, AlertCircle, AlertTriangle, Trash2, Package, ArrowLeft, Plus,
  Banknote, CreditCard, Landmark, ReceiptText, FileClock, CalendarDays, type LucideIcon,
} from 'lucide-react';
import {
  sumaPriloga,
  PRILOG_OPIS_DEFAULT, FAKTURA_VEZA, PRILOG_OPIS_MAX, PRILOG_VEZA_MAX, FAKTURA_NAPOMENA_MAX,
} from '@/lib/prilog';
import { iznosStavke } from '@/lib/racun';
import { formatKM, cn, porukaGreske } from '@/lib/utils';
import type { Kupac, Product } from '@/types';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import SlobodnaStavkaDialog from '@/components/kasa/SlobodnaStavkaDialog';
import { localDateStr } from '@/lib/novac';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
type Mode = 'stavke' | 'iznos';
type Korak = 'firma' | 'faktura';

/** Faktura se najčešće plaća virmanom — zato je prvi i zadani. */
const PAYMENTS: Array<{ tip: PaymentType; Icon: LucideIcon }> = [
  { tip: 'Virman', Icon: Landmark },
  { tip: 'Gotovina', Icon: Banknote },
  { tip: 'Kartica', Icon: CreditCard },
  { tip: 'Ček', Icon: ReceiptText },
];

export interface Firma {
  naziv: string;
  idBroj: string;
  adresa: string;
  grad: string;
  postanskiBroj: string;
}

const PRAZNA_FIRMA: Firma = { naziv: '', idBroj: '', adresa: '', grad: '', postanskiBroj: '' };

const firmaIzKupca = (k: Kupac): Firma => ({
  naziv: k.naziv, idBroj: k.idBroj, adresa: k.adresa ?? '', grad: k.grad ?? '', postanskiBroj: k.postanskiBroj ?? '',
});

const poljaKupca = (k: Kupac) => ({ naziv: k.naziv, sifra: k.idBroj, dodatno: [k.adresa, k.grad].filter(Boolean).join(' ') });

const adresaFirme = (f: Firma) =>
  [f.adresa, [f.postanskiBroj, f.grad].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export interface StavkaRed {
  productId: number;
  naziv: string;
  jm: string;
  sifra: string;
  tip: string;
  kolicina: number;
  cijena: number;
  /** Postotak 0–100. */
  rabat: number;
  pdvStopa: string;
  /** Stanje u trenutku dodavanja; null = nepoznato ili usluga. */
  stanje: number | null;
}

/** Faktura po ponudi: firma i stavke dolaze popunjeni, ponuda se na kraju označi konvertovanom. */
export interface FakturaPocetno {
  ponudaId: number;
  /** „12/2026“ — za naslov i napomenu. */
  ponudaOznaka: string;
  firma: Firma;
  stavke: StavkaRed[];
}

/** Ponuda po kojoj se faktura izdaje — na kraju se označi konvertovanom. */
interface PonudaVeza { id: number; oznaka: string }

/** Nedovršena faktura: sve što je operater unio, da je nastavi kasnije. */
export interface FakturaSkica {
  firma: Firma | null;
  mode: Mode;
  stavke: StavkaRed[];
  rucniIznos: number | null;
  opis: string;
  veza: string;
  nacinPlacanja: PaymentType;
  rok: Rok;
  rokDatum: string;
  napomena: string;
  ponuda: PonudaVeza | null;
}

export interface SkicaFakture {
  id: number;
  naziv: string;
  /** JSON: FakturaSkica */
  podaci: string;
  ukupno: number;
  spremljeno: string;
}

/** Zbirna stavka se fiskalizuje sa stopom E, pa samo takve stavke smiju na fakturu. */
const nijeE = (pdvStopa: string) => (pdvStopa === 'E' ? null : `stopa ${pdvStopa}`);

const fmtKol = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** Rokovi plaćanja koji se nude jednim klikom; „datum“ otvara izbor tačnog dana. */
const ROKOVI = [8, 15, 30, 60] as const;
type Rok = null | (typeof ROKOVI)[number] | 'datum';

const plusDana = (dana: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dana);
  return localDateStr(d);
};
const fmtDatum = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}.`; };
/** "YYYY-MM-DD" ↔ lokalni Date, bez pomaka vremenske zone. */
const izIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };

interface FakturaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Faktura po ponudi — preskače izbor firme. */
  pocetno?: FakturaPocetno | null;
  /** Nastavak spremljene skice; ima prednost pred `pocetno`. */
  skica?: SkicaFakture | null;
  /** Skica je spremljena (dijalog se zatvara) ili je iskorištena fiskalizacijom. */
  onSkicePromijenjene?: (spremljena?: { naziv: string }) => void;
  onSuccess: (res: {
    id: number; prilogBroj: number; brojFiskalnogRacuna: string | null;
    /** Broj stavki unesenih odmah na kasi (0 = dodjeljuju se kasnije). */
    brojStavki: number;
    /** Stvarni BF se razišao sa brojem odštampanim u nazivu stavke. */
    upozorenje?: string | null;
  }) => void;
}

/**
 * Faktura: fiskalni račun sa jednom zbirnom stavkom „Stavke po fakturi br. N", a
 * stvarne stavke idu na fakturu koja nosi isti broj. Tok ima dva koraka — prvo
 * firma (uvijek obavezna), pa stavke ili ručni iznos i način plaćanja.
 */
export default function FakturaDialog({ open, onOpenChange, pocetno, skica, onSkicePromijenjene, onSuccess }: FakturaDialogProps) {
  const [korak, setKorak] = useState<Korak>('firma');
  const [firma, setFirma] = useState<Firma | null>(null);
  /** Ručni unos / uređivanje firme; null = pretraga šifarnika. */
  const [uredjivanje, setUredjivanje] = useState<Firma | null>(null);
  const [allKupci, setAllKupci] = useState<Kupac[] | null>(null);

  const [mode, setMode] = useState<Mode>('stavke');
  const [stavke, setStavke] = useState<StavkaRed[]>([]);
  const [rucniIznos, setRucniIznos] = useState<number | null>(null);
  const [opis, setOpis] = useState(PRILOG_OPIS_DEFAULT);
  const [veza, setVeza] = useState(FAKTURA_VEZA);
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Virman');
  const [rok, setRok] = useState<Rok>(null);
  const [rokDatum, setRokDatum] = useState('');
  const [napomena, setNapomena] = useState('');
  const [rabatSve, setRabatSve] = useState('');
  /** Kratka poruka iznad stavki (npr. zašto artikal nije dodan); nestaje sa sljedećim dodavanjem. */
  const [obavijest, setObavijest] = useState<string | null>(null);
  const [slobodnaOpen, setSlobodnaOpen] = useState(false);
  const [kalendarOpen, setKalendarOpen] = useState(false);
  const [ponuda, setPonuda] = useState<PonudaVeza | null>(null);
  /** Skica iz koje je faktura nastavljena — ponovno spremanje je prepisuje. */
  const [skicaId, setSkicaId] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Broj koji će isječak po svoj prilici nositi — kuca se u naziv zbirne stavke. */
  const [predvidjeniBroj, setPredvidjeniBroj] = useState<number | null>(null);
  const [zadnjiBrojUnos, setZadnjiBrojUnos] = useState('');
  const [zadnjiBrojGreska, setZadnjiBrojGreska] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const iznosRef = useRef<HTMLInputElement>(null);
  const firmaIdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let s: FakturaSkica | null = null;
    try { s = skica ? JSON.parse(skica.podaci) : null; } catch { s = null; }
    const pocetnaFirma = s ? s.firma : pocetno?.firma ?? null;
    const pocetneStavke = s ? s.stavke ?? [] : pocetno?.stavke ?? [];
    const pocetniMode: Mode = s?.mode ?? 'stavke';
    setKorak(pocetnaFirma ? 'faktura' : 'firma'); setFirma(pocetnaFirma); setUredjivanje(null);
    setMode(pocetniMode); setStavke(pocetneStavke); setRucniIznos(s?.rucniIznos ?? null);
    setNacinPlacanja(s?.nacinPlacanja ?? 'Virman');
    setOpis(s?.opis ?? PRILOG_OPIS_DEFAULT); setVeza(s?.veza ?? FAKTURA_VEZA);
    setRok(s?.rok ?? null); setRokDatum(s?.rokDatum ?? ''); setKalendarOpen(false); setRabatSve(''); setObavijest(null); setSlobodnaOpen(false);
    setNapomena(s ? s.napomena ?? '' : pocetno ? `Po ponudi br. ${pocetno.ponudaOznaka}` : '');
    setPonuda(s ? s.ponuda ?? null : pocetno ? { id: pocetno.ponudaId, oznaka: pocetno.ponudaOznaka } : null);
    setSkicaId(skica?.id ?? null);
    setError(null); setBusy(false);
    setPredvidjeniBroj(null); setZadnjiBrojUnos(''); setZadnjiBrojGreska(null);
    window.api.getFiskalnaNumeracija()
      .then(n => setPredvidjeniBroj(n.predvidjeni))
      .catch(() => setPredvidjeniBroj(null));
    window.api.getKupci().then(setAllKupci).catch(() => setAllKupci([]));
    // Stavke iz ponude ne nose stanje, a u skici je zastarjelo — dopuni ga iz kataloga za upozorenje.
    if (pocetneStavke.length) {
      window.api.getProducts().then((rows: Product[]) => {
        const poId = new Map(rows.map(p => [p.id, p]));
        setStavke(prev => prev.map(s => {
          const p = poId.get(s.productId);
          if (!p) return s;
          return { ...s, tip: p.tip, stanje: p.tip === 'usluga' || p.slobodan ? null : p.stanje ?? null };
        }));
      }).catch(() => { /* bez upozorenja o stanju */ });
    }
    if (pocetnaFirma) fokusirajRad(pocetniMode);
    // pocetno i skica se čitaju samo pri otvaranju
  }, [open]);

  const sumaStavki = useMemo(() => sumaPriloga(stavke), [stavke]);
  const zabranjene = useMemo(() => stavke.filter(s => nijeE(s.pdvStopa)), [stavke]);
  const datumValute = rok === null ? null : rok === 'datum' ? (rokDatum || null) : plusDana(rok);
  const iznos = mode === 'stavke' ? sumaStavki : (rucniIznos ?? 0);
  // Prazna veza bi na uređaju pala na „računu" — dijalog fakture drži „fakturi".
  const vezaZaSlanje = veza.trim() || FAKTURA_VEZA;

  const fokusirajRad = useCallback((m: Mode) => {
    requestAnimationFrame(() => (m === 'stavke' ? searchRef : iznosRef).current?.focus());
  }, []);

  const potvrdiFirmu = useCallback((f: Firma) => {
    setFirma(f); setUredjivanje(null); setError(null);
    setKorak('faktura');
    fokusirajRad(mode);
  }, [mode, fokusirajRad]);

  const pocniRucniUnos = (tekst: string) => {
    const cifre = /^\d+$/.test(tekst.trim());
    setUredjivanje({ ...PRAZNA_FIRMA, ...(cifre ? { idBroj: tekst.trim() } : { naziv: tekst.trim() }) });
    requestAnimationFrame(() => firmaIdRef.current?.focus());
  };

  const promijeniFirmu = () => {
    setKorak('firma'); setUredjivanje(null); setError(null);
  };

  const spremiZadnjiBroj = useCallback(async () => {
    setZadnjiBrojGreska(null);
    try {
      const res = await window.api.setZadnjiFiskalniBroj(parseInt(zadnjiBrojUnos, 10));
      setPredvidjeniBroj(res.predvidjeni);
    } catch (err: any) {
      setZadnjiBrojGreska(porukaGreske(err));
    }
  }, [zadnjiBrojUnos]);

  const addProduct = useCallback((p: Product, kol: number | null) => {
    if (nijeE(p.pdvStopa)) {
      setObavijest(`„${p.naziv}“ ima PDV stopu ${p.pdvStopa}. Na fakturu idu samo stavke sa stopom E, jer se zbirna stavka fiskalizuje sa E. Izdajte ga na običnom računu.`);
      searchRef.current?.focus();
      return;
    }
    setObavijest(null);
    const k = kol ?? 1;
    setStavke(prev => {
      const existing = prev.find(s => s.productId === p.id);
      if (existing) return prev.map(s => s.productId === p.id ? { ...s, kolicina: Math.round((s.kolicina + k) * 1000) / 1000 } : s);
      return [...prev, {
        productId: p.id, naziv: p.naziv, jm: p.jm || 'kom', sifra: p.sifra, tip: p.tip,
        kolicina: k, cijena: p.cijena, rabat: 0, pdvStopa: p.pdvStopa,
        stanje: p.tip === 'usluga' || p.slobodan ? null : p.stanje ?? null,
      }];
    });
    searchRef.current?.focus();
  }, []);

  /** Isti rabat na sve stavke; prazno ili 0 skida rabat. */
  const primijeniRabatSve = () => {
    const n = parseFloat(rabatSve.replace(',', '.'));
    const rabat = isNaN(n) ? 0 : n;
    if (!(rabat >= 0 && rabat < 100)) { setObavijest('Rabat mora biti između 0 i 100 %.'); return; }
    setObavijest(null);
    setStavke(prev => prev.map(s => ({ ...s, rabat })));
    setRabatSve('');
    searchRef.current?.focus();
  };

  const updateStavka = (productId: number, patch: Partial<StavkaRed>) =>
    setStavke(prev => prev.map(s => s.productId === productId ? { ...s, ...patch } : s));
  /** Strelice u polju količine: ±1, sa Shiftom ±10. Ne ide ispod 1. */
  const nudgeKolicina = (s: StavkaRed, delta: number) =>
    updateStavka(s.productId, { kolicina: Math.max(1, Math.round((s.kolicina + delta) * 1000) / 1000) });
  const removeStavka = (productId: number) => {
    setStavke(prev => prev.filter(s => s.productId !== productId));
    searchRef.current?.focus();
  };

  const rokNeispravan = rok === 'datum' && !rokDatum;
  const spreman = korak === 'faktura' && !!firma && iznos > 0 && !busy && predvidjeniBroj != null
    && !(mode === 'stavke' && zabranjene.length > 0) && !rokNeispravan;

  const switchMode = useCallback((next: Mode) => {
    setMode(next); setError(null);
    fokusirajRad(next);
  }, [fokusirajRad]);

  const handleConfirm = useCallback(async () => {
    setError(null);
    if (!firma?.idBroj.trim()) {
      setError('Faktura mora imati firmu sa ID brojem.');
      setKorak('firma');
      return;
    }
    if (!(iznos > 0)) {
      setError(mode === 'stavke' ? 'Dodajte najmanje jednu stavku.' : 'Unesite iznos veći od 0.');
      return;
    }
    if (mode === 'stavke' && stavke.some(s => !(s.kolicina > 0))) {
      setError('Svaka stavka mora imati količinu veću od 0.');
      return;
    }
    if (mode === 'stavke' && stavke.some(s => !(s.rabat >= 0 && s.rabat < 100))) {
      setError('Rabat mora biti između 0 i 100 %.');
      return;
    }
    if (mode === 'stavke' && zabranjene.length > 0) {
      setError(`Uklonite stavke koje nisu na stopi E: ${zabranjene.map(s => s.naziv).join(', ')}.`);
      return;
    }
    if (rokNeispravan) {
      setError('Izaberite datum valute ili rok u danima.');
      return;
    }

    setBusy(true);
    try {
      const res = await window.api.finalizePrilogOrder({
        nacinPlacanja,
        ...(mode === 'stavke'
          ? { stavke: stavke.map(s => ({ productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.pdvStopa })) }
          : { iznos }),
        prilogOpis: opis.trim(),
        prilogVeza: vezaZaSlanje,
        datumValute,
        napomena: napomena.trim() || null,
        ponudaId: ponuda?.id ?? null,
        kupac: {
          naziv: firma.naziv.trim(), idBroj: firma.idBroj.trim(), adresa: firma.adresa.trim(),
          grad: firma.grad.trim(), postanskiBroj: firma.postanskiBroj.trim(),
        },
      });

      if (res?.success) {
        // Fiskalizovana skica više nije nedovršena.
        if (skicaId != null) {
          window.api.obrisiSkicuFakture(skicaId).catch(() => {}).finally(() => onSkicePromijenjene?.());
        }
        onSuccess({
          id: res.id!,
          prilogBroj: res.prilogBroj!,
          brojFiskalnogRacuna: res.brojFiskalnogRacuna ?? null,
          brojStavki: mode === 'stavke' ? stavke.length : 0,
          upozorenje: res.upozorenje ?? null,
        });
        onOpenChange(false);
      } else {
        const details = res?.odgovori ? Object.entries(res.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setError(`${res?.error || 'Štampa nije uspjela'}${details ? ` (${details})` : ''}`);
      }
    } catch (err: any) {
      setError(porukaGreske(err));
    } finally {
      setBusy(false);
    }
  }, [firma, iznos, mode, stavke, zabranjene, rokNeispravan, datumValute, napomena, ponuda, skicaId, nacinPlacanja, opis, vezaZaSlanje, onSuccess, onOpenChange, onSkicePromijenjene]);

  const imaSadrzaja = !!firma || stavke.length > 0 || (rucniIznos ?? 0) > 0;

  /** Skloni fakturu u stranu (npr. dok se kuca obični račun) i zatvori dijalog. */
  const spremiSkicu = useCallback(async () => {
    if (!imaSadrzaja || busy) return;
    const podaci: FakturaSkica = {
      firma, mode, stavke, rucniIznos, opis, veza, nacinPlacanja, rok, rokDatum, napomena, ponuda,
    };
    const naziv = firma?.naziv.trim() || firma?.idBroj.trim() || 'Faktura bez firme';
    setError(null);
    try {
      await window.api.spremiSkicuFakture(skicaId, naziv, podaci, iznos);
      onSkicePromijenjene?.({ naziv });
      onOpenChange(false);
    } catch (err: any) {
      setError(`Skica nije spremljena: ${porukaGreske(err)}`);
    }
  }, [imaSadrzaja, busy, firma, mode, stavke, rucniIznos, opis, veza, nacinPlacanja, rok, rokDatum, napomena, ponuda, skicaId, iznos, onSkicePromijenjene, onOpenChange]);

  // F2 mijenja izvor iznosa, F5 fiskalizuje — isti raspored kao na kasi.
  useEffect(() => {
    if (!open || korak !== 'faktura' || slobodnaOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); switchMode(mode === 'stavke' ? 'iznos' : 'stavke'); }
      if (e.key === 'F5') { e.preventDefault(); if (spreman) handleConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, korak, slobodnaOpen, mode, spreman, switchMode, handleConfirm]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1180px] flex-col gap-0 overflow-hidden rounded-2xl p-0">
        {/* ── Zaglavlje: naslov i koraci ── */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-slate-100 py-4 pl-6 pr-14">
          <div className="min-w-0">
            <DialogTitle className="text-[15px] font-semibold tracking-tight text-slate-900">
              {ponuda ? `Faktura po ponudi ${ponuda.oznaka}` : 'Faktura'}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12.5px] text-slate-500">
              Fiskalni račun sa jednom zbirnom stavkom; faktura nosi njegov broj.
            </DialogDescription>
          </div>
          <ol className="ml-auto flex items-center gap-2 text-[12.5px]" aria-label="Koraci">
            <KorakOznaka
              broj={1} naslov={firma && korak === 'faktura' ? firma.naziv || firma.idBroj : 'Firma'}
              stanje={korak === 'firma' ? 'aktivan' : 'gotov'}
              onClick={korak === 'faktura' ? promijeniFirmu : undefined}
            />
            <li aria-hidden className="h-px w-6 bg-slate-200" />
            <KorakOznaka broj={2} naslov="Stavke i plaćanje" stanje={korak === 'faktura' ? 'aktivan' : 'ceka'} />
          </ol>
        </div>

        {korak === 'firma' ? (
          <KorakFirma
            kupci={allKupci}
            firma={firma}
            uredjivanje={uredjivanje}
            setUredjivanje={setUredjivanje}
            firmaIdRef={firmaIdRef}
            onIzaberi={potvrdiFirmu}
            onRucno={pocniRucniUnos}
            error={error}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* ── Radna površina ── */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1 px-6 pt-4" role="tablist" aria-label="Izvor iznosa">
                {([['stavke', 'Stavke odmah'], ['iznos', 'Samo iznos']] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => switchMode(m)}
                    className={cn(
                      'h-8 rounded-lg px-3 text-[12.5px] transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                      mode === m ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    {label}
                  </button>
                ))}
                <Key className="ml-2">F2</Key>
              </div>

              {mode === 'stavke' ? (
                <>
                  <div className="flex items-center gap-2 px-6 pb-2 pt-3">
                    <PretragaProizvoda
                      className="flex-1"
                      tipovi={['artikal', 'usluga']} nedostupno={p => nijeE(p.pdvStopa)} onIzaberi={addProduct}
                      inputRef={searchRef} autoFocus otvoriNaFokus={false} nedavnoKljuc="prilog" velicina="lg"
                      placeholder="Šifra, barkod ili naziv artikla" ariaLabel="Pretraga artikala za fakturu"
                    />
                    <Button
                      type="button" variant="outline" onClick={() => setSlobodnaOpen(true)}
                      className="h-12 shrink-0 gap-1.5 rounded-xl px-4 text-[13px] text-slate-600"
                    >
                      <Plus className="h-4 w-4" /> Slobodna stavka
                    </Button>
                  </div>

                  {obavijest && (
                    <div role="status" className="mx-6 mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">{obavijest}</span>
                      <button type="button" onClick={() => setObavijest(null)} className="text-[12px] text-amber-700 hover:text-amber-900">Zatvori</button>
                    </div>
                  )}

                  <div className="min-h-0 flex-1 px-6 pb-4">
                    {stavke.length === 0 ? (
                      <div className="flex h-full select-none flex-col items-center justify-center text-center">
                        <Package className="mb-3 h-7 w-7 text-slate-200" />
                        <p className="text-[13px] text-slate-500">Dodajte stavke fakture pretragom iznad.</p>
                        <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-slate-400">
                          Ako stavke još ne znate, pređite na „Samo iznos" i dodijelite ih kasnije u Računima.
                        </p>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80">
                        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[11px] font-medium text-slate-500">
                          <span className="flex-1">Artikal</span>
                          <span className="w-20 text-center">Količina</span>
                          <span className="w-24 text-center">Cijena</span>
                          <span className="w-[72px] text-center">Rabat %</span>
                          <span className="w-28 text-right">Iznos</span>
                          <span className="w-8" />
                        </div>
                        <ScrollArea className="flex-1">
                          {stavke.map(s => {
                            const stopa = nijeE(s.pdvStopa);
                            const fali = s.stanje != null && s.kolicina > s.stanje;
                            const enterNaPretragu = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); } };
                            return (
                              <div key={s.productId} className={cn(
                                'flex items-center gap-3 border-b border-slate-100/70 px-4 py-2 last:border-b-0',
                                stopa && 'bg-rose-50/60',
                              )}>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-medium text-slate-800">{s.naziv}</p>
                                  <p className="truncate text-[11px] text-slate-400">
                                    <span className="font-mono">{s.sifra} / {s.jm}</span>
                                    {stopa && <span className="ml-2 font-medium text-rose-600">PDV {stopa}: ne može na fakturu</span>}
                                    {!stopa && fali && (
                                      <span className="ml-2 font-medium text-amber-700">
                                        {s.stanje! <= 0 ? 'nema na stanju' : `na stanju samo ${fmtKol(s.stanje!)} ${s.jm}`}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <DecimalInput
                                  value={s.kolicina}
                                  maxDecimals={3}
                                  selectOnFocus
                                  aria-label={`Količina, ${s.naziv}`}
                                  onValueChange={(_, n) => updateStavka(s.productId, { kolicina: isNaN(n) ? 0 : n })}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); return; }
                                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      const step = e.shiftKey ? 10 : 1;
                                      nudgeKolicina(s, e.key === 'ArrowUp' ? step : -step);
                                    }
                                  }}
                                  className={cn(
                                    'h-9 w-20 rounded-lg text-center font-mono text-sm tabular-nums',
                                    (!(s.kolicina > 0) || fali) && 'border-amber-300 bg-amber-50',
                                  )}
                                />
                                <DecimalInput
                                  value={s.cijena}
                                  selectOnFocus
                                  aria-label={`Cijena, ${s.naziv}`}
                                  onValueChange={(_, n) => updateStavka(s.productId, { cijena: isNaN(n) ? 0 : n })}
                                  onKeyDown={enterNaPretragu}
                                  className="h-9 w-24 rounded-lg text-right font-mono text-sm tabular-nums"
                                />
                                <DecimalInput
                                  value={s.rabat}
                                  maxDecimals={2}
                                  selectOnFocus
                                  placeholder="0"
                                  aria-label={`Rabat u postotku, ${s.naziv}`}
                                  onValueChange={(_, n) => updateStavka(s.productId, { rabat: isNaN(n) ? 0 : n })}
                                  onKeyDown={enterNaPretragu}
                                  className={cn(
                                    'h-9 w-[72px] rounded-lg text-center font-mono text-sm tabular-nums',
                                    s.rabat === 0 && 'text-slate-400',
                                    !(s.rabat >= 0 && s.rabat < 100) && 'border-rose-300 bg-rose-50',
                                  )}
                                />
                                <span className="w-28 text-right font-mono tabular-nums">
                                  <span className="block text-[13px] font-semibold text-slate-800">
                                    {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.pdvStopa }))}
                                  </span>
                                  {s.rabat > 0 && (
                                    <span className="block text-[11px] text-slate-400 line-through">
                                      {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: 0, pdvStopa: s.pdvStopa }))}
                                    </span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeStavka(s.productId)}
                                  aria-label={`Ukloni ${s.naziv}`}
                                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </ScrollArea>
                        {/* Rabat na sve — ista radnja kao na kasi */}
                        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[12px] text-slate-500">
                          <span>{stavke.length} {stavke.length === 1 ? 'stavka' : stavke.length < 5 ? 'stavke' : 'stavki'}</span>
                          <label className="ml-auto flex items-center gap-2">
                            Rabat na sve stavke
                            <DecimalInput
                              value={rabatSve}
                              maxDecimals={2}
                              placeholder="%"
                              aria-label="Rabat u postotku na sve stavke"
                              onValueChange={t => setRabatSve(t)}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); primijeniRabatSve(); } }}
                              className="h-8 w-16 rounded-lg bg-white text-center font-mono text-[13px] tabular-nums"
                            />
                          </label>
                          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg bg-white text-[12px]" onClick={primijeniRabatSve}>
                            Primijeni
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col justify-center px-10 pb-10">
                  <label className="mx-auto w-full max-w-md">
                    <span className="text-[13px] font-medium text-slate-700">Iznos fakture</span>
                    <div className="mt-2 flex items-baseline gap-3 border-b-2 border-slate-200 pb-2 transition-colors focus-within:border-blue-500">
                      <DecimalInput
                        ref={iznosRef}
                        value={rucniIznos ?? ''}
                        onValueChange={(_, n) => setRucniIznos(isNaN(n) ? null : n)}
                        placeholder="0,00"
                        aria-label="Iznos fakture u KM"
                        className={cn(
                          'h-auto flex-1 rounded-none border-0 bg-transparent px-0 py-0 shadow-none',
                          'outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                          'text-right font-mono text-[52px] md:text-[52px] font-semibold leading-none tabular-nums text-slate-900 placeholder:text-slate-200',
                        )}
                      />
                      <span className="font-mono text-[18px] font-medium text-slate-400">KM</span>
                    </div>
                    <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
                      Stavke dodijelite kasnije u sekciji Računi. Faktura se štampa tek kad njihova suma
                      bude tačno jednaka ovom iznosu.
                    </p>
                  </label>
                </div>
              )}
            </div>

            {/* ── Isječak: tačno ono što ide na fiskalni uređaj ── */}
            <div className="flex w-[380px] shrink-0 flex-col border-l border-slate-100 bg-slate-100/60">
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
                <Isjecak
                  firma={firma!}
                  onPromijeniFirmu={promijeniFirmu}
                  opis={opis} setOpis={setOpis}
                  veza={veza} setVeza={setVeza}
                  broj={predvidjeniBroj}
                  iznos={iznos}
                  nacinPlacanja={nacinPlacanja}
                  brojStavki={mode === 'stavke' ? stavke.length : null}
                />

                {/* Broj isječka se kuca u naziv stavke — bez njega nema štampe. */}
                {predvidjeniBroj === null && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-[12px] font-medium text-amber-800">Nepoznat broj sljedećeg isječka</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-amber-700">
                      U bazi nema fiskalizovanih računa. Upišite posljednji broj sa uređaja.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        value={zadnjiBrojUnos}
                        onChange={e => setZadnjiBrojUnos(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); spremiZadnjiBroj(); } }}
                        inputMode="numeric"
                        maxLength={9}
                        placeholder="npr. 127"
                        aria-label="Posljednji izdati fiskalni broj"
                        className="h-8 w-28 rounded-lg border-amber-200 bg-white px-2 font-mono text-[13px] tabular-nums"
                      />
                      <Button size="sm" variant="outline" className="h-8 text-[12px]" disabled={!zadnjiBrojUnos} onClick={spremiZadnjiBroj}>
                        Sačuvaj broj
                      </Button>
                    </div>
                    {zadnjiBrojGreska && <p className="mt-1.5 text-[11px] text-red-600">{zadnjiBrojGreska}</p>}
                  </div>
                )}

                {/* Način plaćanja */}
                <div className="pb-5 pt-5">
                  <p className="text-[12px] font-medium text-slate-600">Način plaćanja</p>
                  <div
                    className="mt-2 grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1"
                    role="radiogroup"
                    aria-label="Način plaćanja"
                    onKeyDown={e => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      const i = PAYMENTS.findIndex(p => p.tip === nacinPlacanja);
                      const next = e.key === 'ArrowRight' ? (i + 1) % PAYMENTS.length : (i - 1 + PAYMENTS.length) % PAYMENTS.length;
                      setNacinPlacanja(PAYMENTS[next].tip);
                      (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
                    }}
                  >
                    {PAYMENTS.map(({ tip, Icon }) => {
                      const aktivan = nacinPlacanja === tip;
                      return (
                        <button
                          key={tip}
                          type="button"
                          role="radio"
                          aria-checked={aktivan}
                          tabIndex={aktivan ? 0 : -1}
                          onClick={() => setNacinPlacanja(tip)}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-lg py-2 text-[11.5px] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                            aktivan ? 'bg-slate-900 font-medium text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
                          )}
                        >
                          <Icon className={cn('h-4 w-4', aktivan ? 'text-white' : 'text-slate-400')} />
                          {tip}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Rok plaćanja — datum valute na fakturi */}
                <div className="pb-5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[12px] font-medium text-slate-600">Rok plaćanja</p>
                    {datumValute && <span className="font-mono text-[11.5px] tabular-nums text-slate-500">valuta {fmtDatum(datumValute)}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Rok plaćanja">
                    {([null, ...ROKOVI] as Rok[]).map(r => {
                      const aktivan = rok === r;
                      return (
                        <button
                          key={String(r)}
                          type="button"
                          role="radio"
                          aria-checked={aktivan}
                          onClick={() => setRok(r)}
                          className={cn(
                            'h-8 rounded-lg border px-2.5 text-[12px] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                            aktivan ? 'border-slate-900 bg-slate-900 font-medium text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          )}
                        >
                          {r === null ? 'Bez roka' : `${r} dana`}
                        </button>
                      );
                    })}
                    {/* Tačan dan valute: rok postaje „datum“ tek kad se dan izabere. */}
                    <Popover open={kalendarOpen} onOpenChange={setKalendarOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={rok === 'datum'}
                          aria-label="Datum valute"
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                            rok === 'datum' ? 'border-slate-900 bg-slate-900 font-medium text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          )}
                        >
                          <CalendarDays className="h-3.5 w-3.5" />
                          {rok === 'datum' && rokDatum ? <span className="font-mono tabular-nums">{fmtDatum(rokDatum)}</span> : 'Datum…'}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                          mode="single"
                          selected={rokDatum ? izIso(rokDatum) : undefined}
                          defaultMonth={rokDatum ? izIso(rokDatum) : undefined}
                          startMonth={izIso(localDateStr())}
                          disabled={{ before: izIso(localDateStr()) }}
                          onSelect={day => {
                            if (!day) return;
                            setRokDatum(localDateStr(day));
                            setRok('datum');
                            setKalendarOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Napomena ispod stavki fakture */}
                <label className="block pb-5">
                  <span className="flex items-baseline justify-between text-[12px] font-medium text-slate-600">
                    Napomena na fakturi
                    {napomena.length > FAKTURA_NAPOMENA_MAX - 50 && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-400">{napomena.length}/{FAKTURA_NAPOMENA_MAX}</span>
                    )}
                  </span>
                  <textarea
                    value={napomena}
                    onChange={e => setNapomena(e.target.value)}
                    maxLength={FAKTURA_NAPOMENA_MAX}
                    rows={3}
                    placeholder="npr. broj narudžbe kupca ili mjesto isporuke"
                    className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                  />
                </label>

                {error && (
                  <div className="mb-5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200/70 bg-white px-5 py-4">
                <Button className="h-11 w-full rounded-xl text-[14px]" onClick={handleConfirm} disabled={!spreman}>
                  <span className="flex w-full items-center gap-3 px-1">
                    <span>{busy ? 'Štampam…' : `Fiskalizuj${iznos > 0 ? ` ${formatKM(iznos)}` : ''}`}</span>
                    <Key tone="dark">F5</Key>
                  </span>
                </Button>
                {mode === 'stavke' && zabranjene.length > 0 && (
                  <p className="mt-2 text-[12px] text-rose-600">
                    Uklonite {zabranjene.length === 1 ? 'stavku' : 'stavke'} sa stopom različitom od E da biste fiskalizovali.
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={promijeniFirmu}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 transition-colors hover:text-slate-800 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Nazad na izbor firme
                  </button>
                  <button
                    type="button"
                    onClick={spremiSkicu}
                    disabled={busy || !imaSadrzaja}
                    title="Skloni fakturu i nastavi je kasnije iz Spremljenih na kasi"
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700 transition-colors hover:text-amber-900 disabled:opacity-50"
                  >
                    <FileClock className="h-3.5 w-3.5" /> {skicaId != null ? 'Ažuriraj skicu' : 'Spremi kao skicu'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <SlobodnaStavkaDialog
          open={slobodnaOpen}
          stope={['E']}
          onClose={() => { setSlobodnaOpen(false); fokusirajRad('stavke'); }}
          onDodaj={(p, k) => { addProduct(p, k); setSlobodnaOpen(false); return undefined; }}
        />
      </DialogContent>
    </Dialog>
  );
}

function KorakOznaka({ broj, naslov, stanje, onClick }: {
  broj: number;
  naslov: string;
  stanje: 'aktivan' | 'gotov' | 'ceka';
  onClick?: () => void;
}) {
  const sadrzaj = (
    <>
      <span className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
        stanje === 'aktivan' && 'bg-slate-900 text-white',
        stanje === 'gotov' && 'bg-emerald-100 text-emerald-700',
        stanje === 'ceka' && 'border border-slate-200 text-slate-400',
      )}>
        {stanje === 'gotov' ? <Check className="h-3 w-3" strokeWidth={3} /> : broj}
      </span>
      <span className={cn('max-w-[220px] truncate', stanje === 'ceka' ? 'text-slate-400' : 'font-medium text-slate-800')}>
        {naslov}
      </span>
    </>
  );
  return (
    <li aria-current={stanje === 'aktivan' ? 'step' : undefined}>
      {onClick ? (
        <button
          type="button" onClick={onClick} title="Promijeni firmu"
          className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {sadrzaj}
          <Pencil className="h-3 w-3 text-slate-400" />
        </button>
      ) : (
        <span className="flex items-center gap-2 px-1 py-0.5">{sadrzaj}</span>
      )}
    </li>
  );
}

function KorakFirma({ kupci, firma, uredjivanje, setUredjivanje, firmaIdRef, onIzaberi, onRucno, error }: {
  kupci: Kupac[] | null;
  firma: Firma | null;
  uredjivanje: Firma | null;
  setUredjivanje: (f: Firma | null) => void;
  firmaIdRef: RefObject<HTMLInputElement | null>;
  onIzaberi: (f: Firma) => void;
  onRucno: (tekst: string) => void;
  error: string | null;
}) {
  const polje = (k: keyof Firma) => ({
    value: uredjivanje?.[k] ?? '',
    onChange: (e: ChangeEvent<HTMLInputElement>) => uredjivanje && setUredjivanje({ ...uredjivanje, [k]: e.target.value }),
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && uredjivanje?.idBroj.trim()) { e.preventDefault(); onIzaberi(uredjivanje); } },
  });

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-6">
      <div className="w-full max-w-[560px] pb-10 pt-[9vh]">
        <h3 className="text-[22px] font-semibold tracking-tight text-slate-900">Za koju firmu je faktura?</h3>
        <p className="mt-1 text-[13px] text-slate-500">
          Firma se štampa na fiskalnom računu i na fakturi.
        </p>

        {uredjivanje ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[13px] font-medium text-slate-800">Podaci firme</p>
            <div className="mt-3 grid grid-cols-[1fr_1.4fr] gap-2">
              <Input ref={firmaIdRef} placeholder="ID broj (JIB)" aria-label="ID broj firme" {...polje('idBroj')}
                inputMode="numeric" maxLength={13} className="h-10 rounded-lg font-mono text-sm" />
              <Input placeholder="Naziv" aria-label="Naziv firme" {...polje('naziv')} maxLength={32} className="h-10 rounded-lg text-sm" />
            </div>
            <Input placeholder="Adresa" aria-label="Adresa firme" {...polje('adresa')} maxLength={32} className="mt-2 h-10 rounded-lg text-sm" />
            <div className="mt-2 flex gap-2">
              <Input placeholder="Poš. broj" aria-label="Poštanski broj" {...polje('postanskiBroj')} maxLength={5} className="h-10 w-28 rounded-lg font-mono text-sm" />
              <Input placeholder="Grad" aria-label="Grad" {...polje('grad')} maxLength={26} className="h-10 flex-1 rounded-lg text-sm" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button className="h-9 rounded-lg" disabled={!uredjivanje.idBroj.trim()} onClick={() => onIzaberi(uredjivanje)}>
                Nastavi na stavke
              </Button>
              <Button variant="ghost" className="h-9 rounded-lg text-slate-500" onClick={() => setUredjivanje(null)}>
                Nazad na pretragu
              </Button>
              {!uredjivanje.idBroj.trim() && <span className="ml-auto text-[11.5px] text-slate-400">ID broj je obavezan</span>}
            </div>
          </div>
        ) : (
          <>
            <PretragaStavki<Kupac>
              className="mt-6"
              stavke={kupci}
              polja={poljaKupca}
              kljuc={k => k.id}
              onIzaberi={k => onIzaberi(firmaIzKupca(k))}
              onNova={onRucno}
              novaLabel="Unesi firmu"
              sifre={false}
              kolicine={false}
              velicina="lg"
              nedavnoKljuc="kupci-faktura"
              naslovSvih="Sve firme"
              oznaka={k => (k.adresa || k.grad) ? [k.adresa, k.grad].filter(Boolean).join(', ') : null}
              meta={k => <span className="font-mono text-[11px] tabular-nums text-slate-400">{k.idBroj}</span>}
              placeholder="Naziv, ID broj ili grad firme"
              ariaLabel="Pretraga firmi"
              akcija="odaberi"
              autoFocus
            />

            {firma && (
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <Building2 className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-800">{firma.naziv || 'Bez naziva'}</p>
                  <p className="truncate font-mono text-[11px] text-slate-500">{firma.idBroj}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setUredjivanje(firma)}>Uredi</Button>
                <Button size="sm" className="h-8 text-[12px]" onClick={() => onIzaberi(firma)}>Zadrži</Button>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRucno('')}
              className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 rounded"
            >
              <Pencil className="h-3.5 w-3.5" /> Firma nije u šifarniku? Unesite podatke ručno
            </button>
          </>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Zupčasti donji rub termo papira. */
const ZUBCI = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='6'%3E%3Cpath d='M0 0h12L6 6z' fill='white'/%3E%3C/svg%3E") repeat-x`;

/**
 * Pregled fiskalnog isječka. Naziv zbirne stavke se uređuje ovdje, na mjestu
 * gdje će biti odštampan — ono što se vidi je ono što uređaj dobije.
 */
function Isjecak({ firma, onPromijeniFirmu, opis, setOpis, veza, setVeza, broj, iznos, nacinPlacanja, brojStavki }: {
  firma: Firma;
  onPromijeniFirmu: () => void;
  opis: string; setOpis: (v: string) => void;
  veza: string; setVeza: (v: string) => void;
  broj: number | null;
  iznos: number;
  nacinPlacanja: PaymentType;
  /** null = iznos ukucan ručno. */
  brojStavki: number | null;
}) {
  const iznosTekst = iznos.toFixed(2).replace('.', ',');
  const urediPolje = 'rounded-sm border-b border-dashed border-slate-400 bg-transparent px-0.5 text-slate-900 outline-none transition-colors hover:bg-amber-50 focus:border-solid focus:border-blue-500 focus:bg-blue-50/60';
  return (
    <div className="[filter:drop-shadow(0_1px_1px_rgba(15,23,42,0.08))_drop-shadow(0_8px_16px_rgba(15,23,42,0.06))]">
      <div className="rounded-t-md bg-white px-5 pb-4 pt-5 font-mono text-[12px] leading-relaxed text-slate-700">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{firma.naziv || 'Bez naziva'}</p>
            <p className="text-slate-500">ID {firma.idBroj}</p>
            {adresaFirme(firma) && <p className="truncate text-slate-500">{adresaFirme(firma)}</p>}
          </div>
          <button
            type="button" onClick={onPromijeniFirmu}
            className="shrink-0 rounded font-sans text-[11.5px] text-blue-600 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
          >
            Promijeni
          </button>
        </div>

        <div aria-hidden className="my-3 border-t border-dashed border-slate-300" />

        {/* Zbirna stavka — polja se kucaju u isti red koji uređaj štampa */}
        <p className="break-words text-slate-900">
          <input
            value={opis}
            onChange={e => setOpis(e.target.value)}
            placeholder={PRILOG_OPIS_DEFAULT}
            maxLength={PRILOG_OPIS_MAX}
            style={{ width: `${Math.max(3, (opis || PRILOG_OPIS_DEFAULT).length) + 0.4}ch` }}
            aria-label="Uvodni dio naziva stavke"
            className={urediPolje}
          />
          {' po '}
          <input
            value={veza}
            onChange={e => setVeza(e.target.value)}
            placeholder={FAKTURA_VEZA}
            maxLength={PRILOG_VEZA_MAX}
            style={{ width: `${Math.max(3, (veza || FAKTURA_VEZA).length) + 0.4}ch` }}
            aria-label="Veza u nazivu stavke"
            className={urediPolje}
          />
          {' br. '}
          <span className={broj == null ? 'text-amber-600' : ''}>{broj ?? '?'}</span>
        </p>
        <div className="mt-0.5 flex justify-between text-slate-500">
          <span>1 x {iznosTekst}</span>
          <span>{iznosTekst} E</span>
        </div>

        <div aria-hidden className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-slate-900">UKUPNO</span>
          <span className={cn('text-[26px] font-semibold tabular-nums leading-none', iznos > 0 ? 'text-slate-900' : 'text-slate-300')}>
            {iznosTekst}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-slate-500">
          <span>{nacinPlacanja}</span>
          <span>KM</span>
        </div>

        <p className="mt-4 font-sans text-[11.5px] leading-snug text-slate-400">
          {brojStavki == null
            ? 'Stavke fakture dodjeljujete kasnije.'
            : brojStavki === 0
              ? 'Iznos je suma stavki fakture.'
              : `Faktura br. ${broj ?? '?'} štampa se odmah nakon isječka.`}
        </p>
      </div>
      <div aria-hidden className="h-[6px]" style={{ background: ZUBCI }} />
    </div>
  );
}
