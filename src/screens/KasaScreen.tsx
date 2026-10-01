import { useState, useEffect, useRef, useCallback } from 'react';
import { User as UserIcon, Printer, Percent, Paperclip, PencilLine, ScanBarcode, Eraser, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Key, jePoljeZaUnos } from '@/components/ui/ledger';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { PretragaKupaca } from '@/components/PretragaKupaca';
import { KupacRacunaPolja } from '@/components/KupacRacunaPolja';
import { cn, formatKM, formatKolicina, mnozina, parseDecimal } from '@/lib/utils';
import { localDateStr, round2 } from '@/lib/novac';
import { izracunajTotale } from '@/lib/racun';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { nemaNaStanju } from '@/lib/izborArtikala';
import { PRAZAN_KUPAC, izKupca, zaSlanje, type KupacRacuna } from '@/lib/kupacRacuna';
import {
  dodaj, dodajSlobodnuStavku, restoreCart, postaviRabat, postaviRabatNaSve, postaviKolicinu, pomjeriKolicinu, stavkeTekst,
  type SavedCartItem,
} from '@/lib/kosarica';
import { OtpremnicaPdf } from '@/components/OtpremnicaPdf';
import { otvoriFakturuZaStampu } from '@/components/stampaFakture';
import { otvoriPdf, ucitajZaStampu } from '@/lib/stampa';
import FakturaDialog, { type SkicaFakture } from '@/components/FakturaDialog';
import SlobodnaStavkaDialog from '@/components/kasa/SlobodnaStavkaDialog';
import StavkeRacuna from '@/components/kasa/StavkeRacuna';
import SpremljeneKosarice, { type SavedCartRow } from '@/components/kasa/SpremljeneKosarice';
import KusurDialog from '@/components/kasa/KusurDialog';
import BrojDialog from '@/components/kasa/BrojDialog';
import { useKasaPostavke } from '@/hooks/useKasaPostavke';
import type { Product, CartItem, Kupac } from '@/types';
import { potvrdi } from '@/lib/dijalog';
import { otvoriNezavrseneRacune } from '@/lib/nezavrseniRacuni';
import { izvrsiFiskalno } from '@/lib/fiskalniIshod';
import type { NacinPlacanja } from '@/lib/placanje';
import { NacinPlacanjaBirac } from '@/components/NacinPlacanjaBirac';
import { zadanoZaKupca, primijeniRabatKupca, formatRabat, nacinKupcaNaKasi, nacinBezKupca } from '@/lib/dokumentPostavke';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';

const NAPLATI: Record<NacinPlacanja, string> = { Gotovina: 'gotovinom', Kartica: 'karticom', Virman: 'virmanom', 'Ček': 'čekom' };

const ARTIKLI_I_USLUGE: Product['tip'][] = ['artikal', 'usluga'];

/** Bosanski plural za "artikal": 1 artikal, 2–4 artikla, 5+ artikala. */
const formatArtikliCount = (n: number) => `${n} ${mnozina(n, ['artikal', 'artikla', 'artikala'])}`;

export default function KasaScreen({ uloga }: { uloga: 'admin' | 'kasir' }) {
  const { postavke } = useDokumentPostavke();
  const { allowZeroStock, kusurEnabled, racunNapomena, scanMode, prikaziDnevniPromet, postaviScanMode } = useKasaPostavke();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [zadnje, setZadnje] = useState<{ id: number; n: number } | null>(null);
  const [paymentType, setPaymentType] = useState<NacinPlacanja>('Gotovina');
  const [kusurTotal, setKusurTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastOrderId, setLastOrderId] = useState<number | null>(null);
  // Dijalog količine: 'dodaj' dodaje na postojeću stavku, 'postavi' ispravlja količinu reda na računu.
  const [qtyProduct, setQtyProduct] = useState<Product | null>(null);
  const [qtyMode, setQtyMode] = useState<'dodaj' | 'postavi'>('dodaj');
  const [slobodnaOpen, setSlobodnaOpen] = useState(false);
  const [qtyValue, setQtyValue] = useState('1');
  const [kupacOpen, setKupacOpen] = useState(false);
  const [kupac, setKupac] = useState<KupacRacuna>(PRAZAN_KUPAC);
  /** Rabat kupca izabranog iz šifarnika — dobijaju ga stavke dodane poslije izbora. */
  const [kupacRabat, setKupacRabat] = useState(0);
  const [dailyTotal, setDailyTotal] = useState<number | null>(null);
  const [savedCarts, setSavedCarts] = useState<SavedCartRow[]>([]);
  const [prilogOpen, setPrilogOpen] = useState(false);
  const [skiceFaktura, setSkiceFaktura] = useState<SkicaFakture[]>([]);
  /** Skica koju dijalog fakture nastavlja; null = nova faktura. */
  const [otvorenaSkica, setOtvorenaSkica] = useState<SkicaFakture | null>(null);
  // productId za rabat po stavci, 'sve' za rabat na cijelu košaricu, null = zatvoren.
  const [rabatTarget, setRabatTarget] = useState<number | 'sve' | null>(null);
  const [rabatValue, setRabatValue] = useState('');
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Način koji je postavio izabrani kupac — kad kupac ode, vraća se na Gotovinu.
  const nacinOdKupcaRef = useRef<NacinPlacanja | null>(null);

  const fokusPretraga = useCallback(() => { setTimeout(() => searchInputRef.current?.focus(), 50); }, []);

  const selectKupac = useCallback((k: Kupac) => {
    setKupac(izKupca(k));
    // Na kasi važi samo kupčev način plaćanja — globalni način fakture ne mijenja Gotovinu.
    const nacinKupca = nacinKupcaNaKasi(k);
    const odPrethodnog = nacinOdKupcaRef.current;
    nacinOdKupcaRef.current = nacinKupca;
    setPaymentType(prev => nacinKupca ?? nacinBezKupca(prev, odPrethodnog));
    const z = zadanoZaKupca(k, postavke, 'faktura');
    setKupacRabat(z.rabat);
    if (z.rabat > 0) {
      setCart(prev => primijeniRabatKupca(prev, z.rabat));
      setMessage({ type: 'success', text: `Primijenjen rabat kupca ${formatRabat(z.rabat)}` });
    } else {
      setMessage(m => (m?.text.startsWith('Primijenjen rabat kupca') ? null : m));
    }
    setKupacOpen(false);
    fokusPretraga();
  }, [fokusPretraga, postavke]);

  const clearKupac = useCallback(() => {
    setKupac(PRAZAN_KUPAC);
    // Rabat ostaje na stavkama; samo nove stavke više ne dobijaju rabat kupca.
    setKupacRabat(0);
    const odKupca = nacinOdKupcaRef.current;
    nacinOdKupcaRef.current = null;
    setPaymentType(prev => nacinBezKupca(prev, odKupca));
  }, []);

  // Promet današnjih završenih računa (kad je uključen u postavkama kase)
  const loadDailyTotal = useCallback(async () => {
    if (!prikaziDnevniPromet) { setDailyTotal(null); return; }
    const today = localDateStr();
    const orders = await window.api.getReportData('dnevni', today, today);
    const completed = orders.filter((o: any) => o.status === 'completed');
    setDailyTotal(completed.reduce((s: number, o: any) => s + o.ukupno, 0));
  }, [prikaziDnevniPromet]);

  useEffect(() => { loadDailyTotal(); }, [loadDailyTotal]);

  const toggleScanMode = useCallback((on: boolean) => {
    postaviScanMode(on);
    fokusPretraga();
  }, [postaviScanMode, fokusPretraga]);

  const loadSavedCarts = useCallback(async () => {
    try {
      setSavedCarts(await window.api.listSavedCarts());
    } catch {
      setSavedCarts([]);
    }
  }, []);

  useEffect(() => { loadSavedCarts(); }, [loadSavedCarts]);

  const loadSkiceFaktura = useCallback(async () => {
    try {
      setSkiceFaktura(await window.api.listSkiceFaktura());
    } catch {
      setSkiceFaktura([]);
    }
  }, []);

  useEffect(() => { loadSkiceFaktura(); }, [loadSkiceFaktura]);

  // Dok je bilo koji dijalog otvoren, prečice kase (F2, F3, F5, kucanje u pretragu) miruju.
  const anyDialogOpen = !!qtyProduct || slobodnaOpen || kupacOpen || prilogOpen || rabatTarget !== null || kusurTotal !== null;

  const closeKusur = useCallback(() => {
    setKusurTotal(null);
    fokusPretraga();
  }, [fokusPretraga]);

  // Cart calculations
  const { ukupno: subtotal, pdvIznos: pdvAmount } = izracunajTotale(
    cart.map(item => ({
      cijena: item.product.cijena,
      kolicina: item.kolicina,
      rabat: item.rabat,
      pdvStopa: item.product.pdvStopa,
    }))
  );
  const total = subtotal;
  const bezRabata = round2(cart.reduce((s, i) => s + i.product.cijena * i.kolicina, 0));
  const ustedaRabat = round2(bezRabata - total);

  // Cart actions
  const addToCart = useCallback((product: Product, qty: number) => {
    const r = dodaj(cart, product, qty, { allowZeroStock, rabatKupca: kupacRabat });
    setCart(r.cart);
    setQtyProduct(null);
    if (r.dodano > 0) setZadnje(z => ({ id: product.id, n: (z?.n ?? 0) + 1 }));
    // Stanje je ograničilo dodavanje — kasir mora znati da nije ušlo sve što je tražio.
    setMessage(r.upozorenje ? { type: 'error', text: r.upozorenje } : null);
    fokusPretraga();
  }, [cart, allowZeroStock, kupacRabat, fokusPretraga]);

  // Izbor iz pretrage: "3*" daje količinu odmah; brzi sken dodaje 1; inače se pita za količinu.
  const izaberiArtikal = useCallback((product: Product, kolicina: number | null) => {
    if (nemaNaStanju(product, allowZeroStock)) {
      setMessage({ type: 'error', text: `„${product.naziv}“ nema na stanju.` });
      fokusPretraga();
      return;
    }
    if (kolicina != null) { addToCart(product, kolicina); return; }
    if (scanMode) { addToCart(product, 1); return; }
    setQtyMode('dodaj');
    setQtyProduct(product);
    setQtyValue('1');
    setTimeout(() => qtyInputRef.current?.select(), 50);
  }, [allowZeroStock, scanMode, addToCart, fokusPretraga]);

  const urediKolicinu = useCallback((item: CartItem) => {
    setQtyMode('postavi');
    setQtyProduct(item.product);
    setQtyValue(formatKolicina(item.kolicina));
    setTimeout(() => qtyInputRef.current?.select(), 50);
  }, []);

  const zatvoriSlobodnu = useCallback(() => {
    setSlobodnaOpen(false);
    fokusPretraga();
  }, [fokusPretraga]);

  // Vraća poruku greške koju dijalog prikaže; bez greške se dijalog zatvara.
  const dodajSlobodnu = useCallback((product: Product, qty: number): string | undefined => {
    const r = dodajSlobodnuStavku(cart, product, qty, kupacRabat);
    if (r.greska) return r.greska;
    setCart(r.cart);
    setZadnje(z => ({ id: product.id, n: (z?.n ?? 0) + 1 }));
    setMessage(null);
    zatvoriSlobodnu();
  }, [cart, kupacRabat, zatvoriSlobodnu]);

  const closeQty = useCallback(() => {
    setQtyProduct(null);
    fokusPretraga();
  }, [fokusPretraga]);

  const confirmQty = useCallback(() => {
    if (!qtyProduct) return;
    // Količina može biti decimalna (npr. 2,5 kg) — kolone u bazi su REAL.
    const qty = parseDecimal(qtyValue) || 0;
    if (qtyMode === 'postavi') {
      setCart(prev => postaviKolicinu(prev, qtyProduct.id, qty, allowZeroStock));
      closeQty();
      return;
    }
    if (qty <= 0) { closeQty(); return; }
    addToCart(qtyProduct, qty);
  }, [qtyProduct, qtyValue, qtyMode, allowZeroStock, addToCart, closeQty]);

  const updateQuantity = useCallback((productId: number, delta: number) => {
    setCart(prev => pomjeriKolicinu(prev, productId, delta, allowZeroStock));
  }, [allowZeroStock]);

  const removeFromCart = useCallback((productId: number) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  }, []);

  const isprazni = useCallback(async () => {
    if (cart.length > 1 && !(await potvrdi(`Ukloniti svih ${stavkeTekst(cart.length)} s računa?`))) return;
    setCart([]);
    setMessage(null);
    fokusPretraga();
  }, [cart.length, fokusPretraga]);

  // ─── Spremljene košarice ───
  const handleSaveCart = useCallback(async () => {
    if (cart.length === 0) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const naziv = `${hhmm} — ${formatArtikliCount(cart.length)}`;
    const items: SavedCartItem[] = cart.map(i => ({ productId: i.product.id, kolicina: i.kolicina, rabat: i.rabat }));
    try {
      await window.api.saveCart(naziv, items, total);
      setCart([]);
      setMessage({ type: 'success', text: `Košarica spremljena (${naziv}).` });
      loadSavedCarts();
      fokusPretraga();
    } catch (err: any) {
      setMessage({ type: 'error', text: `Greška pri spremanju košarice: ${err?.message || 'Nepoznata greška'}` });
    }
  }, [cart, total, loadSavedCarts, fokusPretraga]);

  const handleRestoreCart = useCallback(async (saved: SavedCartRow) => {
    if (cart.length > 0 && !(await potvrdi('Trenutna košarica nije prazna i bit će zamijenjena. Nastaviti?'))) return;
    try {
      // Svježi podaci iz šifarnika — cijene i stanje se provjeravaju sada.
      const fresh: Product[] = await window.api.getProducts();
      const items: SavedCartItem[] = JSON.parse(saved.items);
      // Slobodne stavke nisu u šifarniku — dohvate se pojedinačno.
      const slobodne: Product[] = [];
      for (const item of items) {
        if (fresh.some(p => p.id === item.productId)) continue;
        const p: Product | null = await window.api.getProduct(item.productId);
        if (p?.slobodan) slobodne.push({ ...p, stanje: 0 });
      }
      const { cart: restored, upozorenja } = restoreCart(
        items, (id) => fresh.find(p => p.id === id) ?? slobodne.find(p => p.id === id), allowZeroStock
      );
      setCart(restored);
      setZadnje(null);
      await window.api.deleteSavedCart(saved.id);
      loadSavedCarts();
      if (upozorenja.length > 0) {
        setMessage({ type: 'error', text: `Košarica vraćena uz upozorenja: ${upozorenja.join(' ')}` });
      } else {
        setMessage({ type: 'success', text: `Košarica "${saved.naziv}" vraćena.` });
      }
      fokusPretraga();
    } catch (err: any) {
      setMessage({ type: 'error', text: `Greška pri vraćanju košarice: ${err?.message || 'Nepoznata greška'}` });
    }
  }, [cart.length, allowZeroStock, loadSavedCarts, fokusPretraga]);

  const handleDeleteSavedCart = useCallback(async (id: number) => {
    if (!(await potvrdi('Obrisati spremljenu košaricu? Ovo se ne može vratiti.'))) return;
    try {
      await window.api.deleteSavedCart(id);
      loadSavedCarts();
    } catch {
      // lista se svakako osvježava
    }
  }, [loadSavedCarts]);

  // ─── Skice faktura ───
  const otvoriFakturu = useCallback((skica: SkicaFakture | null) => {
    setOtvorenaSkica(skica);
    setPrilogOpen(true);
  }, []);

  const handleDeleteSkica = useCallback(async (id: number) => {
    if (!(await potvrdi('Obrisati skicu fakture? Ovo se ne može vratiti.'))) return;
    try {
      await window.api.obrisiSkicuFakture(id);
    } catch {
      // lista se svakako osvježava
    }
    loadSkiceFaktura();
  }, [loadSkiceFaktura]);

  // ─── Rabat ───
  const openRabatDialog = useCallback((target: number | 'sve') => {
    const current = target === 'sve' ? 0 : (cart.find(i => i.product.id === target)?.rabat ?? 0);
    setRabatValue(current > 0 ? formatKolicina(current) : '');
    setRabatTarget(target);
  }, [cart]);

  const confirmRabat = useCallback(() => {
    if (rabatTarget === null) return;
    const rabat = parseDecimal(rabatValue) || 0;
    setCart(prev => rabatTarget === 'sve' ? postaviRabatNaSve(prev, rabat) : postaviRabat(prev, rabatTarget, rabat));
    setRabatTarget(null);
    fokusPretraga();
  }, [rabatTarget, rabatValue, fokusPretraga]);

  // Prečice na cijelom ekranu kase — ne dok je otvoren dijalog (količina, rabat, kupac…) ili štampa u toku.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        if (!anyDialogOpen && !loading) handleFinalize();
        return;
      }
      if (anyDialogOpen || loading) return;
      if (e.key === 'F2') { e.preventDefault(); toggleScanMode(!scanMode); return; }
      if (e.key === 'F3') { e.preventDefault(); setSlobodnaOpen(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || jePoljeZaUnos(e.target)) return;
      // Kucanje van polja za unos ide u pretragu — skener radi i kad fokus pobjegne na dugme.
      // Znak ili Backspace van polja: fokus u pretragu prije nego znak stigne, pa završi u njoj.
      if (e.key.length === 1 || e.key === 'Backspace') searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleFinalize = async () => {
    if (cart.length === 0 || loading) return;
    // Virman ide na žiro račun — bez kupca na računu nema ko da uplati.
    if (paymentType === 'Virman' && !kupac.idBroj.trim()) {
      setKupacOpen(true);
      setMessage({ type: 'error', text: 'Za virman je obavezan kupac — odaberite ili unesite kupca.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    setLastOrderId(null);
    try {
      const stavke = cart.map(item => ({
        productId: item.product.id,
        sifra: item.product.sifra,
        naziv: item.product.naziv,
        jm: item.product.jm,
        plu: item.product.plu,
        cijena: item.product.cijena,
        kolicina: item.kolicina,
        rabat: item.rabat,
        pdvStopa: item.product.pdvStopa,
      }));

      const { ishod, res } = await izvrsiFiskalno(() => window.api.finalizeOrder({
        ukupno: total, pdvIznos: pdvAmount, nacinPlacanja: paymentType,
        kupac: zaSlanje(kupac), napomena: racunNapomena || undefined, stavke,
      }));

      // Odštampan i već upisan iz dijaloga nezavršenih računa: prodaja je
      // završena (bez novog id-a) — korpa se prazni da se ne pošalje ponovo.
      if (ishod.vrsta === 'vecEvidentiran') {
        setCart([]); setZadnje(null); setKupacOpen(false); clearKupac();
        setMessage({ type: 'error', text: ishod.poruka });
        loadDailyTotal();
        return;
      }

      if (ishod.vrsta === 'nepoznat') {
        // Račun je možda odštampan: sad ga vodi dijalog nezavršenih računa,
        // pa se korpa prazni — ponovno slanje bi moglo dati dupli račun.
        setCart([]); setZadnje(null); setKupacOpen(false); clearKupac();
        setMessage({ type: 'error', text: ishod.poruka });
        otvoriNezavrseneRacune();
        return;
      }

      // Siguran neuspjeh (uređaj odbio) ili odbijen poziv prije štampe — korpa ostaje za novi pokušaj.
      // (`!res.success` je ovdje isto što i 'greska' — samo suzi tip odgovora na uspjeh.)
      if (ishod.vrsta === 'greska' || !res || !res.success) {
        setMessage({ type: 'error', text: `${res ? 'Greška pri štampanju' : 'Greška'}: ${ishod.poruka}` });
        return;
      }

      const brojFiskalnogRacuna = res.brojFiskalnogRacuna || null;
      const datumRacuna = res.odgovori?.DatumFiskalnogRacuna || '';
      const vrijemeRacuna = res.odgovori?.VrijemeFiskalnogRacuna || '';

      setCart([]); setZadnje(null); setKupacOpen(false); clearKupac();
      setMessage({ type: 'success', text: `Račun #${brojFiskalnogRacuna} uspješno kreiran${datumRacuna ? ` — ${datumRacuna} ${vrijemeRacuna}` : ''}` });
      setLastOrderId(res.id ?? null);
      loadDailyTotal();
      if (kusurEnabled && paymentType === 'Gotovina') {
        // Kusur mod — mušterija tek sad predaje novac, modal preuzima fokus.
        setKusurTotal(total);
      } else {
        fokusPretraga();
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePrintOtpremnica = async (orderId: number) => {
    try {
      const fullOrder = await window.api.getOrder(orderId);
      if (!fullOrder) return;
      const { firma, postavke } = await ucitajZaStampu();
      await otvoriPdf(<OtpremnicaPdf order={fullOrder} firma={firma} postavke={postavke} />);
    } catch (err: any) {
      setMessage({ type: 'error', text: `Greška pri štampanju otpremnice: ${err?.message || 'Nepoznata greška'}` });
    }
  };

  /**
   * Otvara A4 fakturu odmah nakon fiskalizacije sa stavkama —
   * operater je već uz štampač, pa faktura ide uz fiskalni račun bez
   * odlaska u sekciju Računi.
   */
  const handlePrintPrilog = async (orderId: number) => {
    try {
      await otvoriFakturuZaStampu(orderId);
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: `Račun je fiskalizovan, ali faktura se nije otvorila: ${err?.message || 'Nepoznata greška'}. Štampajte je u sekciji Računi.`,
      });
    }
  };

  const qtyMax = (qtyProduct?.tip === 'usluga' || allowZeroStock) ? 999 : (qtyProduct?.stanje ?? 999);

  return (
    <div className="flex h-full">
      {/* ─── Lijevo: pretraga i stavke računa ─── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 bg-[hsl(220,20%,97%)] p-5">
        <div className="flex items-center gap-2">
          <PretragaProizvoda
            className="flex-1 bg-white shadow-sm shadow-slate-200/50"
            velicina="lg"
            tipovi={ARTIKLI_I_USLUGE}
            inputRef={searchInputRef}
            onIzaberi={izaberiArtikal}
            bonus={p => (nemaNaStanju(p, allowZeroStock) ? -40 : 0)}
            nedavnoKljuc="kasa"
            otvoriNaFokus={false}
            placeholder="Skeniraj barkod ili traži po nazivu i šifri…"
            ariaLabel="Pretraga artikala"
            akcija={scanMode ? 'dodaj 1 kom' : 'dodaj'}
            debounceMs={80}
            autoFocus
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setSlobodnaOpen(true)}
            title="Slobodna stavka: upišite naziv, cijenu i PDV stopu za stavku koja nema šifru."
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3.5 pr-3 text-[12.5px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
          >
            <PencilLine className="h-4 w-4 text-slate-400" />
            Slobodna stavka
            <Key className="ml-1">F3</Key>
          </button>
          <button
            type="button"
            aria-pressed={scanMode}
            onClick={() => toggleScanMode(!scanMode)}
            title="Brzi sken: artikal odmah ide u račun s količinom 1, bez pitanja za količinu. Ponovni sken dodaje još 1."
            className={cn(
              'inline-flex h-12 items-center gap-2 rounded-xl border pl-3.5 pr-3 text-[12.5px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
              scanMode
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
            )}
          >
            <ScanBarcode className={cn('h-4 w-4', scanMode ? 'text-blue-600' : 'text-slate-400')} />
            Brzi sken
            <Key className={cn('ml-1', scanMode && 'border-blue-200 bg-white text-blue-400')}>F2</Key>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
          <StavkeRacuna
            cart={cart}
            zadnje={zadnje}
            allowZeroStock={allowZeroStock}
            onKolicina={updateQuantity}
            onUrediKolicinu={urediKolicinu}
            onRabat={openRabatDialog}
            onUkloni={removeFromCart}
          />
          <div className="flex h-11 flex-shrink-0 items-center gap-4 border-t border-slate-100 bg-slate-50/70 pl-5 pr-2 text-[11px] text-slate-400 select-none">
            <span className="flex items-center gap-1.5"><Key className="ml-0">↵</Key> {scanMode ? 'dodaj 1 kom' : 'dodaj'}</span>
            <span className="flex items-center gap-1.5"><Key className="ml-0">3*</Key> količina</span>
            <span className="hidden items-center gap-1.5 xl:flex"><Key className="ml-0">F2</Key> brzi sken</span>
            <span className="hidden items-center gap-1.5 xl:flex"><Key className="ml-0">F3</Key> slobodna stavka</span>
            <span className="flex items-center gap-1.5"><Key className="ml-0">F5</Key> naplati</span>
            {cart.length > 0 && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button" onClick={() => openRabatDialog('sve')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  <Percent className="h-3.5 w-3.5" /> Rabat na sve
                </button>
                <button
                  type="button" onClick={isprazni}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                >
                  <Eraser className="h-3.5 w-3.5" /> Isprazni račun
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Desno: kupac, spremljene košarice, naplata ─── */}
      <aside className="flex w-[400px] flex-shrink-0 flex-col border-l border-slate-200/80 bg-white">
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-slate-900">Račun</h2>
            <p className="mt-0.5 font-mono text-[11px] tabular-nums leading-tight text-slate-400">
              {cart.length > 0 ? stavkeTekst(cart.length) : 'prazan'}
            </p>
          </div>
          {dailyTotal !== null && (
            <div className="text-right" title="Promet današnjih završenih računa">
              <p className="text-[11px] leading-none text-slate-400">Danas</p>
              <p className="mt-1 font-mono text-[12.5px] font-semibold tabular-nums leading-none text-slate-600">{formatKM(dailyTotal)}</p>
            </div>
          )}
        </div>

        {/* Kupac */}
        <div className="px-5 pb-4">
          {kupac.idBroj.trim() ? (
            <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-2.5">
              <UserIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-slate-800">
                    {kupac.naziv.trim() || 'Kupac odabran'}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-slate-500">{kupac.idBroj}</span>
                </div>
                <div className="mt-1 flex gap-3">
                  <button type="button" onClick={() => setKupacOpen(true)} className="text-[11px] text-slate-500 transition-colors hover:text-slate-800">
                    Promijeni
                  </button>
                  <button type="button" onClick={clearKupac} className="inline-flex items-center gap-1 text-[11px] text-slate-400 transition-colors hover:text-rose-500">
                    <X className="h-3 w-3" /> Ukloni
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setKupacOpen(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-[13px] text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
            >
              <UserIcon className="h-3.5 w-3.5 flex-shrink-0" />
              Dodaj kupca
              <span className={cn('ml-auto text-[11px]', paymentType === 'Virman' ? 'font-medium text-amber-600' : 'text-slate-400')}>
                {paymentType === 'Virman' ? 'obavezno za virman' : 'opcionalno'}
              </span>
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-3.5">
          <SpremljeneKosarice
            kosarice={savedCarts}
            skice={skiceFaktura}
            mozeSpremiti={cart.length > 0}
            onSpremi={handleSaveCart}
            onVrati={handleRestoreCart}
            onObrisi={handleDeleteSavedCart}
            onNastaviSkicu={otvoriFakturu}
            onObrisiSkicu={handleDeleteSkica}
          />
        </div>

        {/* ─── Naplata ─── */}
        <div className="space-y-2.5 border-t border-slate-100 bg-slate-50/60 px-5 pb-4 pt-4">
          {/* Displej ukupnog iznosa — isti jezik kao dijalog fakture */}
          <div className="rounded-xl bg-[#0f1629] px-5 pb-3 pt-3.5">
            <div className="flex items-baseline justify-between text-[11.5px] text-slate-400">
              <span>Za naplatu</span>
              <span className="text-slate-500">KM</span>
            </div>
            <p
              key={total}
              className={cn(
                'kasa-iznos text-right font-mono text-[40px] font-semibold leading-tight tabular-nums',
                total > 0 ? 'text-white' : 'text-slate-600',
              )}
              aria-live="polite"
            >
              {total.toFixed(2).replace('.', ',')}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-dashed border-slate-700 pt-2.5 text-[11.5px] text-slate-400">
              <span>Osnovica</span>
              <span className="text-right font-mono tabular-nums text-slate-300">{formatKM(total - pdvAmount)}</span>
              <span>PDV {PDV_STOPA_E_PCT}%</span>
              <span className="text-right font-mono tabular-nums text-slate-300">{formatKM(pdvAmount)}</span>
              {ustedaRabat > 0 && (
                <>
                  <span className="text-emerald-400/90">Rabat</span>
                  <span className="text-right font-mono tabular-nums text-emerald-300">−{formatKM(ustedaRabat)}</span>
                </>
              )}
            </div>
          </div>

          {/* Način plaćanja */}
          <NacinPlacanjaBirac
            value={paymentType}
            onChange={nacin => {
              setPaymentType(nacin);
              // Virman zahtijeva kupca — odmah otvori dialog za odabir
              if (nacin === 'Virman' && !kupac.idBroj.trim()) setKupacOpen(true);
            }}
          />

          {message && (
            <div
              role={message.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-snug',
                message.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700',
              )}
            >
              <span className="min-w-0 flex-1">{message.text}</span>
              {message.type === 'success' && lastOrderId !== null && (
                <button
                  onClick={() => handlePrintOtpremnica(lastOrderId)}
                  className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  title="Štampaj otpremnicu"
                >
                  <Printer size={12} />
                  Otpremnica
                </button>
              )}
              <button
                type="button" onClick={() => setMessage(null)} aria-label="Zatvori poruku"
                className="grid h-5 w-5 flex-shrink-0 place-items-center rounded opacity-50 transition-opacity hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          <Button
            className={cn(
              'h-14 w-full rounded-xl text-[15px] font-semibold transition-all duration-200',
              'bg-blue-600 shadow-lg shadow-blue-600/20 hover:bg-blue-700 hover:shadow-blue-600/30',
              'disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none',
            )}
            disabled={cart.length === 0 || loading}
            onClick={handleFinalize}
          >
            <span className="flex w-full items-center gap-3 px-1">
              <span>Naplati {NAPLATI[paymentType]}</span>
              <Key tone="dark" className="ml-auto">F5</Key>
            </span>
          </Button>

          {/* Sekundarna akcija: fiskalni račun sa zbirnom stavkom */}
          <button
            type="button"
            onClick={() => otvoriFakturu(null)}
            disabled={loading}
            className="flex w-full items-center justify-center gap-1.5 py-1 text-[11.5px] font-medium text-slate-400 transition-colors hover:text-blue-600 disabled:opacity-50"
            title="Fiskalni račun sa jednom zbirnom stavkom i faktura sa stavkama"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Faktura
          </button>
        </div>
      </aside>

      {/* Printing overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm printing-overlay-enter">
          <div className="bg-white rounded-3xl shadow-2xl shadow-slate-900/20 p-10 flex flex-col items-center gap-6 printing-card-enter">
            {/* Printer animation */}
            <div className="relative w-24 h-24">
              {/* Glow ring */}
              <div className="absolute inset-0 rounded-full bg-blue-500/10 printing-pulse" />
              {/* Icon container */}
              <div className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30 flex items-center justify-center">
                <Printer className="h-9 w-9 text-white printing-icon" />
              </div>
              {/* Receipt paper coming out */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 printing-receipt">
                <div className="w-full bg-white border border-slate-200 rounded-b-sm shadow-sm">
                  <div className="px-1 py-0.5 space-y-0.5">
                    <div className="h-[2px] bg-slate-200 rounded-full w-full" />
                    <div className="h-[2px] bg-slate-200 rounded-full w-3/4" />
                    <div className="h-[2px] bg-slate-200 rounded-full w-full" />
                    <div className="h-[2px] bg-slate-100 rounded-full w-1/2" />
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">Štampanje računa</p>
              <p className="text-sm text-slate-400 mt-1">Molimo sačekajte...</p>
            </div>

            {/* Animated dots */}
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-blue-500 printing-dot" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-blue-500 printing-dot" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-blue-500 printing-dot" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}

      <SlobodnaStavkaDialog open={slobodnaOpen} onClose={zatvoriSlobodnu} onDodaj={dodajSlobodnu} />

      {/* Količina: 'dodaj' dodaje na stavku, 'postavi' ispravlja red na računu */}
      <BrojDialog
        open={!!qtyProduct}
        naslov={qtyMode === 'postavi' ? 'Promijeni količinu' : 'Količina'}
        opis={qtyProduct?.naziv}
        vrijednost={qtyValue}
        onVrijednost={setQtyValue}
        onPotvrdi={confirmQty}
        onZatvori={closeQty}
        onOtkazi={closeQty}
        potvrda={qtyMode === 'postavi' ? 'Sačuvaj' : 'Dodaj'}
        maxDecimals={3}
        inputRef={qtyInputRef}
        korak={{ min: qtyMode === 'postavi' ? 0 : 1, max: qtyMax }}
      >
        {qtyProduct && qtyProduct.tip !== 'usluga' && !qtyProduct.slobodan && (qtyProduct.stanje ?? 0) > 0 && (
          <p className="text-[11px] text-slate-400 mt-3 text-center font-mono tabular-nums">
            Na stanju: {formatKolicina(qtyProduct.stanje ?? 0)} {qtyProduct.jm || 'kom'}
          </p>
        )}
        {qtyMode === 'postavi' && (
          <p className="text-[11px] text-slate-400 mt-2 text-center">0 uklanja stavku s računa</p>
        )}
      </BrojDialog>

      {/* Rabat na stavku ili na cijelu košaricu; „Otkaži“ ne vraća fokus u pretragu (kao i do sada) */}
      <BrojDialog
        open={rabatTarget !== null}
        naslov={rabatTarget === 'sve' ? 'Rabat na cijelu košaricu' : 'Rabat na stavku'}
        opis={rabatTarget === 'sve'
          ? 'Postotak se primjenjuje na sve stavke.'
          : cart.find(i => i.product.id === rabatTarget)?.product.naziv}
        vrijednost={rabatValue}
        onVrijednost={setRabatValue}
        onPotvrdi={confirmRabat}
        onZatvori={() => { setRabatTarget(null); fokusPretraga(); }}
        onOtkazi={() => setRabatTarget(null)}
        potvrda="Primijeni"
        maxDecimals={2}
        placeholder="0"
        sufiks="%"
      >
        <p className="text-[11px] text-slate-400 mt-3 text-center">0–100% · 0 uklanja rabat</p>
      </BrojDialog>

      {/* Kusur — otvara se poslije štampe gotovinskog računa */}
      <KusurDialog iznos={kusurTotal} onZatvori={closeKusur} />

      {/* Kupac dialog */}
      <Dialog open={kupacOpen} onOpenChange={(open) => { if (!open) { setKupacOpen(false); fokusPretraga(); } }}>
        <DialogContent className="sm:max-w-[520px] p-0 gap-0 rounded-2xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="text-[15px]">Kupac</DialogTitle>
            <DialogDescription className="text-sm text-slate-500 mt-0.5">
              Odaberite sačuvanog kupca ili upišite podatke novog.
            </DialogDescription>
          </DialogHeader>

          {/* Razmak ispod naslova je u tijelu da prsten fokusa pretrage ne bude odsječen. */}
          <DialogBody className="pt-4">
            <div className="px-6 pb-5">
              <PretragaKupaca
                onIzaberi={selectKupac}
                nedavnoKljuc="kupci-kasa"
                izabraniIdBroj={kupac.idBroj.trim()}
                placeholder="Traži kupca po nazivu, JIB-u ili gradu…"
                autoFocus
              />
            </div>

            {/* Novi / uređivanje kupca */}
            <div className="border-t border-slate-100 px-6 pb-5 pt-4 space-y-2">
              <p className="text-[12px] font-medium text-slate-500">Podaci kupca na računu</p>
              <KupacRacunaPolja value={kupac} onChange={setKupac} />
            </div>
          </DialogBody>

          <div className="shrink-0 border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex items-center justify-between">
            <div>
              {kupac.idBroj.trim() && (
                <button
                  type="button"
                  onClick={clearKupac}
                  className="text-[12px] text-rose-500 hover:text-rose-600 transition-colors"
                >
                  Ukloni kupca
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => { setKupacOpen(false); fokusPretraga(); }}>
                Otkaži
              </Button>
              <Button
                size="sm"
                className="rounded-lg px-5"
                disabled={!kupac.idBroj.trim() || !kupac.naziv.trim()}
                onClick={() => { setKupacOpen(false); fokusPretraga(); }}
              >
                Potvrdi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Faktura */}
      <FakturaDialog
        open={prilogOpen}
        onOpenChange={setPrilogOpen}
        uloga={uloga}
        skica={otvorenaSkica}
        onSkicePromijenjene={(spremljena) => {
          loadSkiceFaktura();
          if (spremljena) {
            setMessage({ type: 'success', text: `Faktura za „${spremljena.naziv}“ spremljena kao skica — nastavite je iz Spremljenih.` });
            fokusPretraga();
          }
        }}
        onSuccess={(res) => {
          setLastOrderId(null);
          // Razlika predviđenog i stvarnog BF-a znači da isječak nosi pogrešan
          // broj u nazivu stavke — to operater mora vidjeti, ne uspješnu poruku.
          setMessage(res.upozorenje
            ? { type: 'error', text: res.upozorenje }
            : {
              type: 'success',
              text: res.brojStavki > 0
                ? `Fiskalizovana faktura br. ${res.prilogBroj} (BF ${res.brojFiskalnogRacuna ?? '?'}) sa ${formatArtikliCount(res.brojStavki)}. Faktura se otvara za štampu.`
                : `Fiskalizovana faktura br. ${res.prilogBroj} (BF ${res.brojFiskalnogRacuna ?? '?'}). Stavke dodijelite u sekciji Računi.`,
            });
          loadDailyTotal();
          // Stavke unesene na kasi → prilog je kompletan i ide odmah.
          if (res.brojStavki > 0) handlePrintPrilog(res.id);
        }}
      />

      <style>{`
        /* Upravo dodana stavka zasvijetli pa izblijedi — pokazuje gdje je završio sken. */
        @keyframes kasa-red-bljesak {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        .kasa-red-bljesak {
          animation: kasa-red-bljesak 1.1s cubic-bezier(0.4, 0, 0.2, 1) 0.15s both;
        }

        /* Nova suma na displeju kratko uđe odozdo — oko uhvati da se iznos promijenio. */
        @keyframes kasa-iznos {
          from { opacity: 0.35; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .kasa-iznos {
          animation: kasa-iznos 0.22s ease-out both;
        }

        @media (prefers-reduced-motion: reduce) {
          .kasa-red-bljesak, .kasa-iznos { animation: none; }
          .kasa-red-bljesak { opacity: 0; }
        }

        @keyframes printing-overlay-enter {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .printing-overlay-enter {
          animation: printing-overlay-enter 0.25s ease-out both;
        }

        @keyframes printing-card-enter {
          from { opacity: 0; transform: scale(0.9) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .printing-card-enter {
          animation: printing-card-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes printing-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.15); opacity: 0.8; }
        }
        .printing-pulse {
          animation: printing-pulse 1.8s ease-in-out infinite;
        }

        @keyframes printing-icon {
          0%, 100% { transform: translateY(0); }
          25% { transform: translateY(-1px); }
          75% { transform: translateY(1px); }
        }
        .printing-icon {
          animation: printing-icon 0.6s ease-in-out infinite;
        }

        @keyframes printing-receipt {
          0% { height: 0; opacity: 0; }
          30% { opacity: 1; }
          100% { height: 28px; opacity: 1; }
        }
        .printing-receipt {
          animation: printing-receipt 1.5s ease-out forwards;
          overflow: hidden;
          height: 0;
        }

        @keyframes printing-dot {
          0%, 60%, 100% { transform: scale(0.6); opacity: 0.3; }
          30% { transform: scale(1); opacity: 1; }
        }
        .printing-dot {
          animation: printing-dot 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
