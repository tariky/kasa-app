import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, ChevronDown, User as UserIcon, Banknote, CreditCard, Building, FileCheck, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { cn, formatKM } from '@/lib/utils';
import { izracunajTotale } from '@/lib/racun';
import type { User, Product, CartItem, Kupac } from '@/types';

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

const paymentIcons: Record<PaymentType, React.ReactNode> = {
  Gotovina: <Banknote className="h-4 w-4" />,
  Kartica: <CreditCard className="h-4 w-4" />,
  Virman: <Building className="h-4 w-4" />,
  'Ček': <FileCheck className="h-4 w-4" />,
};

interface KasaScreenProps {
  user: User;
}

export default function KasaScreen({ user }: KasaScreenProps) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentType, setPaymentType] = useState<PaymentType>('Gotovina');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [qtyProduct, setQtyProduct] = useState<Product | null>(null);
  const [qtyValue, setQtyValue] = useState('1');
  const [kupacOpen, setKupacOpen] = useState(false);
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [kupacSearch, setKupacSearch] = useState('');
  const [kupacResults, setKupacResults] = useState<Kupac[]>([]);
  const [kupacSearching, setKupacSearching] = useState(false);
  const kupacDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dailyTotal, setDailyTotal] = useState<number | null>(null);
  const [allowZeroStock, setAllowZeroStock] = useState(false);
  const [racunNapomena, setRacunNapomena] = useState('');
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productListRef = useRef<HTMLDivElement>(null);

  // Kupac search
  useEffect(() => {
    if (kupacDebounceRef.current) clearTimeout(kupacDebounceRef.current);
    if (!kupacSearch.trim()) {
      setKupacResults([]);
      setKupacSearching(false);
      return;
    }
    setKupacSearching(true);
    kupacDebounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.searchKupci(kupacSearch.trim());
        setKupacResults(results);
      } catch {
        setKupacResults([]);
      }
      setKupacSearching(false);
    }, 200);
    return () => { if (kupacDebounceRef.current) clearTimeout(kupacDebounceRef.current); };
  }, [kupacSearch]);

  const selectKupac = useCallback((k: Kupac) => {
    setKupacNaziv(k.naziv);
    setKupacIdBroj(k.idBroj);
    setKupacAdresa(k.adresa ?? '');
    setKupacGrad(k.grad ?? '');
    setKupacPostanskiBroj(k.postanskiBroj ?? '');
    setKupacSearch('');
    setKupacResults([]);
  }, []);

  const clearKupac = useCallback(() => {
    setKupacNaziv('');
    setKupacIdBroj('');
    setKupacAdresa('');
    setKupacGrad('');
    setKupacPostanskiBroj('');
    setKupacSearch('');
    setKupacResults([]);
  }, []);

  // Debounced product search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setProducts([]); setFocusedIndex(-1); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await window.api.searchProducts(query.trim());
        setProducts(results);
        setFocusedIndex(-1);
      } catch { setProducts([]); setFocusedIndex(-1); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Load daily total setting + data
  const loadDailyTotal = useCallback(async () => {
    const enabled = await window.api.getSetting('kasa.showDailyTotal');
    if (enabled !== 'true') { setDailyTotal(null); return; }
    const today = new Date().toISOString().split('T')[0];
    const orders = await window.api.getReportData('dnevni', today, today);
    const completed = orders.filter((o: any) => o.status === 'completed');
    setDailyTotal(completed.reduce((s: number, o: any) => s + o.ukupno, 0));
  }, []);

  useEffect(() => { loadDailyTotal(); }, [loadDailyTotal]);

  useEffect(() => {
    window.api.getSetting('kasa.allowZeroStock').then((v) => setAllowZeroStock(v === 'true'));
    window.api.getSetting('racun.napomena').then((v) => setRacunNapomena(v || ''));
  }, []);

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
  const itemCount = cart.reduce((sum, item) => sum + item.kolicina, 0);

  // Cart actions
  const promptAddToCart = useCallback((product: Product) => {
    setQtyProduct(product);
    setQtyValue('1');
    setTimeout(() => qtyInputRef.current?.select(), 50);
  }, []);

  const confirmAddToCart = useCallback(() => {
    if (!qtyProduct) return;
    const qty = parseInt(qtyValue) || 0;
    if (qty <= 0) { setQtyProduct(null); return; }
    const isService = qtyProduct.tip === 'usluga';
    const stock = qtyProduct.stanje ?? 0;
    setCart(prev => {
      const existing = prev.find(item => item.product.id === qtyProduct.id);
      const currentQty = existing ? existing.kolicina : 0;
      const addQty = (isService || allowZeroStock) ? qty : Math.min(qty, stock - currentQty);
      if (addQty <= 0) return prev;
      if (existing) {
        return prev.map(item =>
          item.product.id === qtyProduct.id
            ? { ...item, kolicina: item.kolicina + addQty }
            : item
        );
      }
      return [...prev, { product: qtyProduct, kolicina: addQty, rabat: 0 }];
    });
    setMessage(null);
    setQtyProduct(null);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [qtyProduct, qtyValue, allowZeroStock]);

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

  const handleSearchKeyDown = useCallback(async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (products.length > 0) {
        const nextIdx = focusedIndex < products.length - 1 ? focusedIndex + 1 : 0;
        setFocusedIndex(nextIdx);
        // Scroll into view
        const el = productListRef.current?.children[nextIdx] as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (products.length > 0) {
        const nextIdx = focusedIndex > 0 ? focusedIndex - 1 : products.length - 1;
        setFocusedIndex(nextIdx);
        const el = productListRef.current?.children[nextIdx] as HTMLElement;
        el?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    if (e.key === 'Escape') {
      setQuery('');
      setProducts([]);
      setFocusedIndex(-1);
      return;
    }
    if (e.key !== 'Enter') return;

    // If an item is focused via arrows, select it
    if (focusedIndex >= 0 && focusedIndex < products.length) {
      const product = products[focusedIndex];
      const outOfStock = !allowZeroStock && product.tip !== 'usluga' && product.stanje != null && product.stanje <= 0;
      if (!outOfStock) {
        promptAddToCart(product);
        setQuery('');
        setProducts([]);
        setFocusedIndex(-1);
      }
      return;
    }

    // Default Enter behavior: exact match or single result
    const q = query.trim();
    if (!q) return;
    const results = await window.api.searchProducts(q);
    const exact = results.find((p: Product) => p.sifra === q || p.barkod === q);
    if (exact) {
      promptAddToCart(exact);
      setQuery('');
      setProducts([]);
    } else if (results.length === 1) {
      promptAddToCart(results[0]);
      setQuery('');
      setProducts([]);
    }
    setFocusedIndex(-1);
  }, [query, products, focusedIndex, promptAddToCart]);

  const removeFromCart = useCallback((productId: number) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  }, []);

  // F5 to checkout
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') { e.preventDefault(); handleFinalize(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleFinalize = async () => {
    if (cart.length === 0 || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const kupac = kupacIdBroj.trim()
        ? { idBroj: kupacIdBroj.trim(), naziv: kupacNaziv.trim(), adresa: kupacAdresa.trim(), grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim() }
        : undefined;

      const tringData = {
        items: cart.map(item => ({
          naziv: item.product.naziv, cijena: item.product.cijena, kolicina: item.kolicina,
          rabat: item.rabat, pdvStopa: item.product.pdvStopa, sifra: item.product.sifra, jm: item.product.jm,
        })),
        ukupno: total, nacinPlacanja: paymentType, kupac,
        napomena: racunNapomena || undefined,
      };

      const tringResult = await window.api.tringPrintReceipt(tringData);
      console.log('Tring printReceipt result:', tringResult);
      if (!tringResult || !tringResult.success) {
        const details = tringResult?.odgovori ? Object.entries(tringResult.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setMessage({ type: 'error', text: `Greška pri štampanju: ${tringResult?.error || tringResult?.vrstaOdgovora || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
        setLoading(false);
        return;
      }

      const brojFiskalnogRacuna = tringResult.odgovori?.BrojFiskalnogRacuna || null;
      const datumRacuna = tringResult.odgovori?.DatumFiskalnogRacuna || '';
      const vrijemeRacuna = tringResult.odgovori?.VrijemeFiskalnogRacuna || '';
      await window.api.createOrder({
        korisnikId: user.id, ukupno: total, pdvIznos: pdvAmount, nacinPlacanja: paymentType,
        brojFiskalnogRacuna, kupac,
        stavke: cart.map(item => ({ productId: item.product.id, kolicina: item.kolicina, cijena: item.product.cijena, rabat: item.rabat, pdvStopa: item.product.pdvStopa })),
      });

      setCart([]); setPaymentAmount(''); setKupacOpen(false); clearKupac();
      setQuery(''); setProducts([]);
      setMessage({ type: 'success', text: `Račun #${brojFiskalnogRacuna} uspješno kreiran${datumRacuna ? ` — ${datumRacuna} ${vrijemeRacuna}` : ''}` });
      loadDailyTotal();
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } catch (err: any) {
      setMessage({ type: 'error', text: `Greška: ${err?.message || 'Nepoznata greška'}` });
    } finally {
      setLoading(false);
    }
  };

  const change = paymentAmount ? parseFloat(paymentAmount) - total : 0;

  return (
    <div className="flex h-full">
      {/* ─── Left: Search & Products ─── */}
      <div className="flex-1 flex flex-col min-w-0 bg-[hsl(220,20%,97%)]">
        {/* Search bar */}
        <div className="p-5 pb-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Skeniraj barkod ili pretraži artikle..."
              className="pl-12 h-14 text-base bg-white border-0 shadow-sm shadow-slate-200/60 rounded-2xl focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:ring-offset-0"
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setProducts([]); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Product grid */}
        <ScrollArea className="flex-1 p-5">
          {!query.trim() && products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 select-none">
              <div className="w-20 h-20 rounded-3xl bg-slate-100 flex items-center justify-center mb-4">
                <Search className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500">Pretraži artikle</p>
              <p className="text-xs text-slate-400 mt-1">Koristite pretragu ili skenirajte barkod</p>
            </div>
          ) : query.trim() && products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <p className="text-sm">Nema rezultata za &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1" ref={productListRef}>
              {products.map((product, idx) => {
                const outOfStock = !allowZeroStock && product.tip !== 'usluga' && product.stanje != null && product.stanje <= 0;
                const isFocused = idx === focusedIndex;
                return (
                  <button
                    key={product.id}
                    onClick={() => !outOfStock && promptAddToCart(product)}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    disabled={outOfStock}
                    className={cn(
                      'group flex items-center gap-4 text-left rounded-xl bg-white px-4 py-3 transition-all duration-150',
                      'hover:bg-blue-50/50 active:bg-blue-50',
                      isFocused && !outOfStock && 'bg-blue-50 ring-2 ring-blue-500/30',
                      outOfStock && 'opacity-50 cursor-not-allowed hover:bg-white',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{product.naziv}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                        <span className="font-mono text-slate-400">{product.sifra}</span>
                        <span className="text-slate-300">·</span>
                        {product.tip === 'usluga' ? (
                          <span className="font-medium text-violet-500">Usluga</span>
                        ) : product.stanje != null ? (
                          <span className={cn(
                            'font-mono',
                            product.stanje <= 0 ? 'text-red-400' : product.stanje <= 5 ? 'text-amber-500' : 'text-slate-400'
                          )}>
                            {product.stanje} {product.jm}
                          </span>
                        ) : null}
                        <span className="text-slate-300">·</span>
                        <span className={product.pdvStopa === 'E' ? 'text-slate-400' : 'text-emerald-500'}>
                          {product.pdvStopa === 'E' ? '17%' : '0%'}
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-blue-600 flex-shrink-0">
                      {formatKM(product.cijena)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ─── Right: Cart Panel ─── */}
      <div className="w-[420px] flex-shrink-0 bg-white flex flex-col border-l border-slate-200/80">
        {/* Cart header */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <ShoppingCart className="h-4.5 w-4.5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900 text-[15px] leading-tight">Račun</h2>
              {cart.length > 0 && (
                <p className="text-[11px] text-slate-400 font-mono tabular-nums leading-tight mt-0.5">
                  {itemCount} {itemCount === 1 ? 'stavka' : itemCount < 5 ? 'stavke' : 'stavki'}
                </p>
              )}
            </div>
          </div>
          {cart.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-slate-400 hover:text-red-500 h-7 px-2"
              onClick={() => setCart([])}
            >
              Isprazni
            </Button>
          )}
        </div>
        {dailyTotal !== null && (
          <div className="px-5 pb-3 -mt-1">
            <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Danas</span>
              <span className="text-[13px] font-bold font-mono tabular-nums text-slate-700">{formatKM(dailyTotal)}</span>
            </div>
          </div>
        )}

        {/* Cart items */}
        <ScrollArea className="flex-1 min-h-0">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 select-none">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                <ShoppingCart className="h-7 w-7 text-slate-300" />
              </div>
              <p className="text-sm text-slate-400 font-medium">Prazan račun</p>
              <p className="text-xs text-slate-300 mt-1">Dodajte artikle pretragom</p>
            </div>
          ) : (
            <div className="px-3">
              {cart.map((item, idx) => {
                const lineTotal = item.product.cijena * item.kolicina * (1 - item.rabat / 100);
                return (
                  <div
                    key={item.product.id}
                    className={cn(
                      'group flex items-center gap-3 py-3 px-2 rounded-xl hover:bg-slate-50/80 transition-colors kasa-item-enter',
                      idx < cart.length - 1 && 'border-b border-slate-100'
                    )}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    {/* Index circle */}
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-semibold text-slate-500">{idx + 1}</span>
                    </div>

                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-slate-800 truncate">{item.product.naziv}</p>
                        {item.product.tip === 'usluga' && (
                          <span className="text-[9px] font-medium text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded-full flex-shrink-0">USL</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                        {item.product.sifra} · {formatKM(item.product.cijena)} × {item.kolicina}
                      </p>
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => updateQuantity(item.product.id, -1)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-xs font-semibold font-mono tabular-nums text-slate-700">
                        {item.kolicina}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.product.id, 1)}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Line total */}
                    <span className="text-sm font-semibold font-mono tabular-nums text-slate-800 w-20 text-right">
                      {formatKM(lineTotal)}
                    </span>

                    {/* Remove */}
                    <button
                      onClick={() => removeFromCart(item.product.id)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* ─── Checkout footer ─── */}
        <div className="border-t border-slate-100 bg-slate-50/50">
          {/* Totals */}
          <div className="px-5 pt-4 pb-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">PDV (17%)</span>
              <span className="font-mono tabular-nums text-slate-500">{formatKM(pdvAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xl font-bold text-slate-900">Ukupno</span>
              <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                {formatKM(total)}
              </span>
            </div>
          </div>

          <div className="px-5 pb-4 space-y-3">
            {/* Payment type chips */}
            <div className="grid grid-cols-4 gap-1.5">
              {(['Gotovina', 'Kartica', 'Virman', 'Ček'] as PaymentType[]).map(type => (
                <button
                  key={type}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2.5 rounded-xl text-[11px] font-medium transition-all duration-150',
                    paymentType === type
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'bg-white text-slate-500 border border-slate-200 hover:border-blue-200 hover:text-blue-600'
                  )}
                  onClick={() => setPaymentType(type)}
                >
                  {paymentIcons[type]}
                  {type}
                </button>
              ))}
            </div>

            {/* Payment amount + change */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  type="number"
                  placeholder="Iznos plaćanja"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  className="font-mono tabular-nums h-10 rounded-xl border-slate-200 bg-white"
                />
              </div>
              {paymentAmount && change > 0 && (
                <div className="flex items-center px-3 rounded-xl bg-emerald-50 border border-emerald-100">
                  <span className="text-xs font-mono tabular-nums text-emerald-600 font-semibold whitespace-nowrap">
                    Kusur: {formatKM(change)}
                  </span>
                </div>
              )}
            </div>

            {/* Kupac section */}
            <div className={cn(
              'rounded-xl border transition-colors',
              kupacOpen ? 'border-slate-200 bg-white' : 'border-slate-200/60'
            )}>
              <button
                type="button"
                className="flex items-center justify-between w-full px-3.5 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                onClick={() => setKupacOpen(!kupacOpen)}
              >
                <div className="flex items-center gap-2">
                  <UserIcon className="h-3.5 w-3.5" />
                  <span className="text-[13px]">
                    {kupacIdBroj.trim() ? kupacNaziv.trim() || 'Kupac odabran' : 'Dodaj kupca'}
                  </span>
                  {kupacIdBroj.trim() && (
                    <span className="text-[10px] font-mono text-slate-400">{kupacIdBroj}</span>
                  )}
                </div>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', kupacOpen && 'rotate-180')} />
              </button>
              {kupacOpen && (
                <div className="px-3.5 pb-3.5 space-y-2 border-t border-slate-100">
                  {/* Search */}
                  <div className="relative pt-2.5">
                    <Input
                      placeholder="Pretraži sačuvane kupce..."
                      value={kupacSearch}
                      onChange={e => setKupacSearch(e.target.value)}
                      className="h-9 text-sm pl-8 rounded-lg"
                    />
                    <Search className="absolute left-2.5 top-1/2 mt-1.5 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    {kupacResults.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 max-h-40 overflow-auto">
                        {kupacResults.map(k => (
                          <button
                            key={k.id}
                            type="button"
                            className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-b-0"
                            onClick={() => selectKupac(k)}
                          >
                            <span className="font-medium text-slate-800">{k.naziv}</span>
                            <span className="text-[11px] text-slate-400 ml-2 font-mono">{k.idBroj}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {kupacIdBroj.trim() && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Odabrani kupac</span>
                      <button type="button" onClick={clearKupac} className="text-[11px] text-red-400 hover:text-red-500 transition-colors">
                        Ukloni
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="JIB (13 cifara)" value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} className="h-8 text-sm rounded-lg font-mono" maxLength={13} />
                    <Input placeholder="Naziv" value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} className="h-8 text-sm rounded-lg" maxLength={32} />
                  </div>
                  <Input placeholder="Adresa" value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} className="h-8 text-sm rounded-lg" maxLength={32} />
                  <div className="flex gap-2">
                    <Input placeholder="Poš. br." value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} className="h-8 text-sm w-24 rounded-lg font-mono" maxLength={5} />
                    <Input placeholder="Grad" value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} className="h-8 text-sm flex-1 rounded-lg" maxLength={26} />
                  </div>
                </div>
              )}
            </div>

            {/* Message */}
            {message && (
              <div className={cn(
                'text-sm px-4 py-3 rounded-xl flex items-center gap-2',
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-red-50 text-red-600 border border-red-100'
              )}>
                {message.text}
              </div>
            )}

            {/* Checkout button */}
            <Button
              className={cn(
                'w-full h-14 text-base font-bold rounded-2xl transition-all duration-200',
                'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40',
                'disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none',
              )}
              disabled={cart.length === 0 || loading}
              onClick={handleFinalize}
            >
              <span className="flex items-center gap-2">
                Naplati
                {cart.length > 0 && (
                  <span className="font-mono tabular-nums opacity-80">{formatKM(total)}</span>
                )}
                <kbd className="ml-1 px-1.5 py-0.5 rounded-md bg-white/15 text-[11px] font-mono font-normal">F5</kbd>
              </span>
            </Button>
          </div>
        </div>
      </div>

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

      {/* Quantity dialog */}
      <Dialog open={!!qtyProduct} onOpenChange={(open) => { if (!open) setQtyProduct(null); }}>
        <DialogContent className="sm:max-w-[340px] p-0 gap-0 overflow-hidden rounded-2xl">
          <div className="px-6 pt-6 pb-5">
            <DialogHeader>
              <DialogTitle className="text-[15px]">Količina</DialogTitle>
              <DialogDescription className="text-sm text-slate-500 truncate mt-0.5">
                {qtyProduct?.naziv}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex items-center gap-3">
              <button
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xl font-bold transition-colors"
                onClick={() => setQtyValue(String(Math.max(1, (parseInt(qtyValue) || 1) - 1)))}
              >
                −
              </button>
              <Input
                ref={qtyInputRef}
                type="number"
                min={1}
                max={(qtyProduct?.tip === 'usluga' || allowZeroStock) ? 999 : (qtyProduct?.stanje ?? 999)}
                value={qtyValue}
                onChange={e => setQtyValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAddToCart(); }}
                className="h-12 text-center font-mono text-2xl font-bold flex-1 rounded-xl border-slate-200"
                autoFocus
              />
              <button
                className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-xl font-bold transition-colors"
                onClick={() => setQtyValue(String(Math.min((qtyProduct?.tip === 'usluga' || allowZeroStock) ? 999 : (qtyProduct?.stanje ?? 999), (parseInt(qtyValue) || 0) + 1)))}
              >
                +
              </button>
            </div>
            {qtyProduct && qtyProduct.tip !== 'usluga' && (qtyProduct.stanje ?? 0) > 0 && (
              <p className="text-[11px] text-slate-400 mt-3 text-center font-mono tabular-nums">
                Na stanju: {qtyProduct.stanje} {qtyProduct.jm || 'kom'}
              </p>
            )}
          </div>
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setQtyProduct(null)}>
              Otkaži
            </Button>
            <Button size="sm" className="rounded-lg px-5" onClick={confirmAddToCart}>
              Dodaj
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes kasa-item-enter {
          from { opacity: 0; transform: translateX(8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .kasa-item-enter {
          animation: kasa-item-enter 0.2s ease-out both;
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
