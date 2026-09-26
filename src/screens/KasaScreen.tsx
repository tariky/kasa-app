import { useState, useEffect, useRef, useCallback } from 'react';
import { User as UserIcon, Banknote, CreditCard, Building, FileCheck, Printer, Percent, Paperclip, PencilLine, ScanBarcode, Eraser, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Key } from '@/components/ui/ledger';
import { PretragaStavki } from '@/components/ui/pretraga-stavki';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { localDateStr, prijedloziApoena, round2 } from '@/lib/novac';
import { izracunajTotale } from '@/lib/racun';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { nemaNaStanju } from '@/lib/izborArtikala';
import {
  dodajUKosaricu, dodajSlobodnuStavku, restoreCart, postaviRabat, postaviRabatNaSve, postaviKolicinu, stavkeTekst,
  type SavedCartItem,
} from '@/lib/kosarica';
import { pdf } from '@react-pdf/renderer';
import { OtpremnicaPdf } from '@/components/OtpremnicaPdf';
import { otvoriFakturuZaStampu } from '@/components/stampaFakture';
import { ucitajZaStampu } from '@/lib/stampa';
import FakturaDialog, { type SkicaFakture } from '@/components/FakturaDialog';
import SlobodnaStavkaDialog from '@/components/kasa/SlobodnaStavkaDialog';
import StavkeRacuna from '@/components/kasa/StavkeRacuna';
import SpremljeneKosarice, { type SavedCartRow } from '@/components/kasa/SpremljeneKosarice';
import type { Product, CartItem, Kupac } from '@/types';
import { potvrdi } from '@/lib/dijalog';
import { zadanoZaKupca, primijeniRabatKupca, formatRabat, nacinKupcaNaKasi, nacinBezKupca } from '@/lib/dokumentPostavke';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';
const NACINI: PaymentType[] = ['Gotovina', 'Kartica', 'Virman', 'Ček'];
const NAPLATI: Record<PaymentType, string> = { Gotovina: 'gotovinom', Kartica: 'karticom', Virman: 'virmanom', 'Ček': 'čekom' };

const paymentIcons: Record<PaymentType, React.ReactNode> = {
  Gotovina: <Banknote className="h-4 w-4" />,
  Kartica: <CreditCard className="h-4 w-4" />,
  Virman: <Building className="h-4 w-4" />,
  'Ček': <FileCheck className="h-4 w-4" />,
};

const ARTIKLI_I_USLUGE: Product['tip'][] = ['artikal', 'usluga'];

/** Broj → tekst za polje količine (zarez kao separator, bez suvišnih nula). */
function formatQty(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/** Bosanski plural za "artikal": 1 artikal, 2–4 artikla, 5+ artikala. */
function formatArtikliCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} artikal`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} artikla`;
  return `${n} artikala`;
}

/** Kucanje van polja za unos ide u pretragu — skener radi i kad fokus pobjegne na dugme. */
function uPoljuZaUnos(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const poljaKupca = (k: Kupac) => ({ naziv: k.naziv, sifra: k.idBroj, dodatno: [k.adresa, k.grad].filter(Boolean).join(' ') });

export default function KasaScreen({ uloga }: { uloga: 'admin' | 'kasir' }) {
  const { postavke } = useDokumentPostavke();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [zadnje, setZadnje] = useState<{ id: number; n: number } | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [kusurTotal, setKusurTotal] = useState<number | null>(null);
  const [kusurValue, setKusurValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastOrderId, setLastOrderId] = useState<number | null>(null);
  // Dijalog količine: 'dodaj' dodaje na postojeću stavku, 'postavi' ispravlja količinu reda na računu.
  const [qtyProduct, setQtyProduct] = useState<Product | null>(null);
  const [qtyMode, setQtyMode] = useState<'dodaj' | 'postavi'>('dodaj');
  const [slobodnaOpen, setSlobodnaOpen] = useState(false);
  const [qtyValue, setQtyValue] = useState('1');
  const [kupacOpen, setKupacOpen] = useState(false);
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [allKupci, setAllKupci] = useState<Kupac[] | null>(null);
  /** Rabat kupca izabranog iz šifarnika — dobijaju ga stavke dodane poslije izbora. */
  const [kupacRabat, setKupacRabat] = useState(0);
  const [dailyTotal, setDailyTotal] = useState<number | null>(null);
  const [allowZeroStock, setAllowZeroStock] = useState(false);
  const [kusurEnabled, setKusurEnabled] = useState(true);
  const [racunNapomena, setRacunNapomena] = useState('');
  const [scanMode, setScanMode] = useState(false);
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
  const nacinOdKupcaRef = useRef<PaymentType | null>(null);

  const fokusPretraga = useCallback(() => { setTimeout(() => searchInputRef.current?.focus(), 50); }, []);

  // Učitaj sve kupce kad se dialog otvori — pretraga je lokalna.
  useEffect(() => {
    if (!kupacOpen) return;
    window.api.getKupci().then(setAllKupci).catch(() => setAllKupci([]));
  }, [kupacOpen]);

  const selectKupac = useCallback((k: Kupac) => {
    setKupacNaziv(k.naziv);
    setKupacIdBroj(k.idBroj);
    setKupacAdresa(k.adresa ?? '');
    setKupacGrad(k.grad ?? '');
    setKupacPostanskiBroj(k.postanskiBroj ?? '');
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
    setKupacNaziv('');
    setKupacIdBroj('');
    setKupacAdresa('');
    setKupacGrad('');
    setKupacPostanskiBroj('');
    // Rabat ostaje na stavkama; samo nove stavke više ne dobijaju rabat kupca.
    setKupacRabat(0);
    const odKupca = nacinOdKupcaRef.current;
    nacinOdKupcaRef.current = null;
    setPaymentType(prev => nacinBezKupca(prev, odKupca));
  }, []);

  // Load daily total setting + data
  const loadDailyTotal = useCallback(async () => {
    const enabled = await window.api.getSetting('kasa.showDailyTotal');
    if (enabled !== 'true') { setDailyTotal(null); return; }
    const today = localDateStr();
    const orders = await window.api.getReportData('dnevni', today, today);
    const completed = orders.filter((o: any) => o.status === 'completed');
    setDailyTotal(completed.reduce((s: number, o: any) => s + o.ukupno, 0));
  }, []);

  useEffect(() => { loadDailyTotal(); }, [loadDailyTotal]);

  useEffect(() => {
    window.api.getSetting('kasa.allowZeroStock').then((v) => setAllowZeroStock(v === 'true'));
    window.api.getSetting('kasa.kusurKalkulacija').then((v) => setKusurEnabled(v !== 'false'));
    window.api.getSetting('racun.napomena').then((v) => setRacunNapomena(v || ''));
    window.api.getSetting('kasa.scanMode').then((v) => setScanMode(v === 'true'));
  }, []);

  const toggleScanMode = useCallback((on: boolean) => {
    setScanMode(on);
    window.api.setSetting('kasa.scanMode', on ? 'true' : 'false');
    fokusPretraga();
  }, [fokusPretraga]);

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
    setKusurValue('');
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
    const prije = cart.find(i => i.product.id === product.id)?.kolicina ?? 0;
    const next = dodajUKosaricu(cart, product, qty, allowZeroStock);
    const saRabatom = prije === 0 && kupacRabat > 0 ? postaviRabat(next, product.id, kupacRabat) : next;
    const poslije = saRabatom.find(i => i.product.id === product.id)?.kolicina ?? 0;
    setCart(saRabatom);
    setQtyProduct(null);
    if (poslije > prije) setZadnje(z => ({ id: product.id, n: (z?.n ?? 0) + 1 }));
    // Stanje je ograničilo dodavanje — kasir mora znati da nije ušlo sve što je tražio.
    setMessage(poslije - prije < qty
      ? { type: 'error', text: poslije === prije
          ? `„${product.naziv}“: nema više na stanju.`
          : `„${product.naziv}“: na stanju je ${formatQty(product.stanje ?? 0)} ${product.jm || 'kom'}, dodano ${formatQty(poslije - prije)}.` }
      : null);
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
    setQtyValue(formatQty(item.kolicina));
    setTimeout(() => qtyInputRef.current?.select(), 50);
  }, []);

  const zatvoriSlobodnu = useCallback(() => {
    setSlobodnaOpen(false);
    fokusPretraga();
  }, [fokusPretraga]);

  // Vraća poruku greške koju dijalog prikaže; bez greške se dijalog zatvara.
  const dodajSlobodnu = useCallback((product: Product, qty: number): string | undefined => {
    const r = dodajSlobodnuStavku(cart, product, qty);
    if (r.greska) return r.greska;
    const nova = !cart.some(i => i.product.id === product.id);
    setCart(nova && kupacRabat > 0 ? postaviRabat(r.cart, product.id, kupacRabat) : r.cart);
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
    setCart(prev =>
      prev
        .map(item => {
          if (item.product.id !== productId) return item;
          const newQty = item.kolicina + delta;
          if (delta > 0 && !allowZeroStock && item.product.tip !== 'usluga' && newQty > (item.product.stanje ?? 0)) return item;
          return { ...item, kolicina: Math.max(0, newQty) };
        })
        .filter(item => item.kolicina > 0)
    );
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
    setRabatValue(current > 0 ? formatQty(current) : '');
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
      if (e.metaKey || e.ctrlKey || e.altKey || uPoljuZaUnos(e.target)) return;
      // Znak ili Backspace van polja: fokus u pretragu prije nego znak stigne, pa završi u njoj.
      if (e.key.length === 1 || e.key === 'Backspace') searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleFinalize = async () => {
    if (cart.length === 0 || loading) return;
    // Virman ide na žiro račun — bez kupca na računu nema ko da uplati.
    if (paymentType === 'Virman' && !kupacIdBroj.trim()) {
      setKupacOpen(true);
      setMessage({ type: 'error', text: 'Za virman je obavezan kupac — odaberite ili unesite kupca.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    setLastOrderId(null);
    try {
      const kupac = kupacIdBroj.trim()
        ? { idBroj: kupacIdBroj.trim(), naziv: kupacNaziv.trim(), adresa: kupacAdresa.trim(), grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim() }
        : undefined;

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

      const res = await window.api.finalizeOrder({
        ukupno: total, pdvIznos: pdvAmount, nacinPlacanja: paymentType,
        kupac, napomena: racunNapomena || undefined, stavke,
      });

      if (!res || !res.success) {
        const details = res?.odgovori ? Object.entries(res.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setMessage({ type: 'error', text: `Greška pri štampanju: ${res?.error || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
        setLoading(false);
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
        setKusurValue('');
        setKusurTotal(total);
      } else {
        fokusPretraga();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `Greška: ${err?.message || 'Nepoznata greška'}` });
    } finally {
      setLoading(false);
    }
  };

  const handlePrintOtpremnica = async (orderId: number) => {
    try {
      const fullOrder = await window.api.getOrder(orderId);
      if (!fullOrder) return;
      const { firma, postavke } = await ucitajZaStampu();
      const blob = await pdf(<OtpremnicaPdf order={fullOrder} firma={firma} postavke={postavke} />).toBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) win.onafterprint = () => URL.revokeObjectURL(url);
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
          {kupacIdBroj.trim() ? (
            <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-2.5">
              <UserIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-slate-800">
                    {kupacNaziv.trim() || 'Kupac odabran'}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-slate-500">{kupacIdBroj}</span>
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
          <div
            className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
            role="radiogroup"
            aria-label="Način plaćanja"
            onKeyDown={e => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const i = NACINI.indexOf(paymentType);
              const next = e.key === 'ArrowRight' ? (i + 1) % NACINI.length : (i - 1 + NACINI.length) % NACINI.length;
              setPaymentType(NACINI[next]);
              if (NACINI[next] === 'Virman' && !kupacIdBroj.trim()) setKupacOpen(true);
              (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
            }}
          >
            {NACINI.map(type => {
              const aktivan = paymentType === type;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={aktivan}
                  tabIndex={aktivan ? 0 : -1}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                    aktivan ? 'bg-[#0f1629] font-medium text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                  )}
                  onClick={() => {
                    setPaymentType(type);
                    // Virman zahtijeva kupca — odmah otvori dialog za odabir
                    if (type === 'Virman' && !kupacIdBroj.trim()) setKupacOpen(true);
                  }}
                >
                  <span className={aktivan ? 'text-white' : 'text-slate-400'}>{paymentIcons[type]}</span>
                  {type}
                </button>
              );
            })}
          </div>

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

      {/* Quantity dialog */}
      <Dialog open={!!qtyProduct} onOpenChange={(open) => { if (!open) closeQty(); }}>
        <DialogContent className="sm:max-w-[340px] p-0 gap-0 overflow-hidden rounded-2xl">
          <div className="px-6 pt-6 pb-5">
            <DialogHeader>
              <DialogTitle className="text-[15px]">{qtyMode === 'postavi' ? 'Promijeni količinu' : 'Količina'}</DialogTitle>
              <DialogDescription className="text-sm text-slate-500 truncate mt-0.5">
                {qtyProduct?.naziv}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex items-center gap-3">
              <button
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xl font-bold transition-colors"
                onClick={() => setQtyValue(formatQty(Math.max(qtyMode === 'postavi' ? 0 : 1, (parseDecimal(qtyValue) || 1) - 1)))}
              >
                −
              </button>
              <DecimalInput
                ref={qtyInputRef}
                maxDecimals={3}
                value={qtyValue}
                onValueChange={text => setQtyValue(text)}
                onKeyDown={e => { if (e.key === 'Enter') confirmQty(); }}
                className="h-12 text-center font-mono text-2xl font-bold flex-1 rounded-xl border-slate-200"
                autoFocus
              />
              <button
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xl font-bold transition-colors"
                onClick={() => setQtyValue(formatQty(Math.min(qtyMax, (parseDecimal(qtyValue) || 0) + 1)))}
              >
                +
              </button>
            </div>
            {qtyProduct && qtyProduct.tip !== 'usluga' && !qtyProduct.slobodan && (qtyProduct.stanje ?? 0) > 0 && (
              <p className="text-[11px] text-slate-400 mt-3 text-center font-mono tabular-nums">
                Na stanju: {formatQty(qtyProduct.stanje ?? 0)} {qtyProduct.jm || 'kom'}
              </p>
            )}
            {qtyMode === 'postavi' && (
              <p className="text-[11px] text-slate-400 mt-2 text-center">0 uklanja stavku s računa</p>
            )}
          </div>
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={closeQty}>
              Otkaži
            </Button>
            <Button size="sm" className="rounded-lg px-5" onClick={confirmQty}>
              {qtyMode === 'postavi' ? 'Sačuvaj' : 'Dodaj'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rabat dialog */}
      <Dialog open={rabatTarget !== null} onOpenChange={(open) => { if (!open) { setRabatTarget(null); fokusPretraga(); } }}>
        <DialogContent className="sm:max-w-[340px] p-0 gap-0 overflow-hidden rounded-2xl">
          <div className="px-6 pt-6 pb-5">
            <DialogHeader>
              <DialogTitle className="text-[15px]">
                {rabatTarget === 'sve' ? 'Rabat na cijelu košaricu' : 'Rabat na stavku'}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 truncate mt-0.5">
                {rabatTarget === 'sve'
                  ? 'Postotak se primjenjuje na sve stavke.'
                  : cart.find(i => i.product.id === rabatTarget)?.product.naziv}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 relative">
              <DecimalInput
                maxDecimals={2}
                value={rabatValue}
                onValueChange={setRabatValue}
                onKeyDown={e => { if (e.key === 'Enter') confirmRabat(); }}
                placeholder="0"
                className="h-12 text-center font-mono text-2xl font-bold rounded-xl border-slate-200 pr-10"
                autoFocus
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-lg">%</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 text-center">0–100% · 0 uklanja rabat</p>
          </div>
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setRabatTarget(null)}>
              Otkaži
            </Button>
            <Button size="sm" className="rounded-lg px-5" onClick={confirmRabat}>
              Primijeni
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Kusur modal — otvara se poslije štampe gotovinskog računa */}
      <Dialog open={kusurTotal !== null} onOpenChange={(open) => { if (!open) closeKusur(); }}>
        <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden rounded-2xl">
          {kusurTotal !== null && (() => {
            const apoeni = prijedloziApoena(kusurTotal);
            const dato = kusurValue ? parseDecimal(kusurValue) : null;
            const kusur = dato !== null ? round2(dato - kusurTotal) : null;
            const cycleApoen = (dir: 1 | -1) => {
              if (apoeni.length === 0) return;
              const current = apoeni.indexOf(dato ?? NaN);
              const next = current === -1
                ? (dir === 1 ? 0 : apoeni.length - 1)
                : (current + dir + apoeni.length) % apoeni.length;
              setKusurValue(formatQty(apoeni[next]));
            };
            return (
              <>
                <div className="px-6 pt-6 pb-5">
                  <DialogHeader>
                    <DialogTitle className="text-[15px]">Kalkulacija kusura</DialogTitle>
                    <DialogDescription className="text-[12px] text-slate-500 mt-0.5">
                      Upišite koliko je mušterija dala — kusur se računa automatski
                    </DialogDescription>
                  </DialogHeader>

                  {/* Ukupno */}
                  <div className="mt-4 flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ukupno</span>
                    <span className="text-[24px] font-bold font-mono tabular-nums text-slate-900 leading-none">
                      {formatKM(kusurTotal)}
                    </span>
                  </div>

                  {/* Mušterija dala */}
                  <DecimalInput
                    placeholder="Mušterija dala..."
                    value={kusurValue}
                    onValueChange={text => setKusurValue(text)}
                    onKeyDown={e => {
                      // Enter u prazno polje zatvara — s upisanim iznosom kusur
                      // ostaje na ekranu dok kasir ne pritisne Esc.
                      if (e.key === 'Enter') { e.preventDefault(); if (!kusurValue.trim()) closeKusur(); }
                      else if (e.key === 'ArrowDown') { e.preventDefault(); cycleApoen(1); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); cycleApoen(-1); }
                    }}
                    className="mt-4 h-12 text-center font-mono text-xl font-bold rounded-xl border-slate-200"
                    autoFocus
                  />

                  {/* Apoeni — klik ili ↑/↓ */}
                  <div className="flex gap-1.5 mt-2.5">
                    {apoeni.map(iznos => (
                      <button
                        key={iznos}
                        type="button"
                        onClick={() => setKusurValue(formatQty(iznos))}
                        className={cn(
                          'flex-1 h-9 rounded-lg text-[12px] font-semibold font-mono tabular-nums transition-all duration-150',
                          dato === iznos
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-400',
                        )}
                      >
                        {iznos === round2(kusurTotal) ? formatKM(iznos) : iznos}
                      </button>
                    ))}
                  </div>

                  {/* Kusur — ogromno, vidi ga i mušterija */}
                  {kusur !== null && kusur >= 0 && (
                    <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-100 px-5 py-4 text-center">
                      <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Kusur</p>
                      <p className="text-[40px] font-bold font-mono tabular-nums text-emerald-600 leading-tight">
                        {formatKM(kusur)}
                      </p>
                    </div>
                  )}
                  {kusur !== null && kusur < 0 && (
                    <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-5 py-3 text-center">
                      <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Nedostaje</p>
                      <p className="text-[26px] font-bold font-mono tabular-nums text-amber-600 leading-tight">
                        {formatKM(-kusur)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100 px-6 py-3 bg-slate-50/50 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    Esc za zatvaranje
                  </span>
                  <Button size="sm" className="rounded-lg px-5" onClick={closeKusur}>
                    Gotovo
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Kupac dialog */}
      <Dialog open={kupacOpen} onOpenChange={(open) => { if (!open) { setKupacOpen(false); fokusPretraga(); } }}>
        <DialogContent className="sm:max-w-[520px] p-0 gap-0 overflow-hidden rounded-2xl">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <DialogTitle className="text-[15px]">Kupac</DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-0.5">
                Odaberite sačuvanog kupca ili upišite podatke novog.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 pb-5">
            <PretragaStavki<Kupac>
              stavke={allKupci}
              polja={poljaKupca}
              kljuc={k => k.id}
              onIzaberi={selectKupac}
              sifre={false}
              kolicine={false}
              nedavnoKljuc="kupci-kasa"
              naslovSvih="Svi kupci"
              oznaka={k => (k.adresa || k.grad) ? [k.adresa, k.grad].filter(Boolean).join(', ') : null}
              meta={k => <span className={cn('font-mono text-[11px] tabular-nums', k.idBroj === kupacIdBroj.trim() ? 'font-semibold text-blue-600' : 'text-slate-400')}>{k.idBroj}</span>}
              placeholder="Traži kupca po nazivu, JIB-u ili gradu…"
              ariaLabel="Pretraga kupaca"
              akcija="odaberi"
              autoFocus
            />
          </div>

          {/* Novi / uređivanje kupca */}
          <div className="border-t border-slate-100 px-6 pb-5 pt-4 space-y-2">
            <p className="text-[12px] font-medium text-slate-500">Podaci kupca na računu</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="JIB (13 cifara)" value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} className="h-9 text-sm rounded-lg font-mono" maxLength={13} />
              <Input placeholder="Naziv" value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} className="h-9 text-sm rounded-lg" maxLength={32} />
            </div>
            <Input placeholder="Adresa" value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} className="h-9 text-sm rounded-lg" maxLength={32} />
            <div className="flex gap-2">
              <Input placeholder="Poš. br." value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} className="h-9 text-sm w-24 rounded-lg font-mono" maxLength={5} />
              <Input placeholder="Grad" value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} className="h-9 text-sm flex-1 rounded-lg" maxLength={26} />
            </div>
          </div>

          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex items-center justify-between">
            <div>
              {kupacIdBroj.trim() && (
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
                disabled={!kupacIdBroj.trim() || !kupacNaziv.trim()}
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
