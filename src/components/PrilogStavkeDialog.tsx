import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Trash2, Check, AlertTriangle } from 'lucide-react';
import { sumaPriloga, prilogKompletan } from '@/lib/prilog';
import { iznosStavke } from '@/lib/racun';
import { round2 } from '@/lib/novac';
import { cn, formatKM } from '@/lib/utils';
import type { Order, Product } from '@/types';

interface StavkaRed {
  productId: number;
  naziv: string;
  jm: string;
  sifra: string;
  tip: string;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
}

interface PrilogStavkeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  onSaved: () => void;
}

/**
 * Dodjela stvarnih stavki fiskalizovanom računu po prilogu. Suma stavki mora
 * na kraju pasti tačno na fiskalni iznos, ali se smije spremati i nekompletna
 * (rad u više navrata) — print specifikacije je ono što je zaključano.
 */
export default function PrilogStavkeDialog({ open, onOpenChange, order, onSaved }: PrilogStavkeDialogProps) {
  const [stavke, setStavke] = useState<StavkaRed[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readOnly = order.status !== 'completed';

  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults([]); setError(null); setBusy(false);
    window.api.getPrilogStavke(order.id)
      .then(rows => setStavke(rows.map((r: any) => ({
        productId: r.productId,
        naziv: r.productNaziv || `#${r.productId}`,
        jm: r.productJm || 'kom',
        sifra: r.productSifra || '',
        tip: r.productTip || 'artikal',
        kolicina: r.kolicina,
        cijena: r.cijena,
        pdvStopa: r.pdvStopa,
      }))))
      .catch((err: any) => { setStavke([]); setError(err?.message || 'Greška pri čitanju stavki'); });
  }, [open, order.id]);

  // Pretraga proizvoda — isti debounce obrazac kao na kasi.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await window.api.searchProducts(query.trim());
        // Zbirna stavka je fiskalizovana sa stopom E — samo takvi proizvodi smiju u prilog.
        setResults(found.filter((p: Product) => p.pdvStopa === 'E'));
      } catch { setResults([]); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const suma = useMemo(() => sumaPriloga(stavke), [stavke]);
  const kompletan = useMemo(() => prilogKompletan(order.ukupno, stavke), [order.ukupno, stavke]);
  const razlika = round2(suma - order.ukupno);

  const addProduct = (p: Product) => {
    setStavke(prev => {
      const existing = prev.find(s => s.productId === p.id);
      if (existing) return prev.map(s => s.productId === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      return [...prev, {
        productId: p.id, naziv: p.naziv, jm: p.jm || 'kom', sifra: p.sifra, tip: p.tip,
        kolicina: 1, cijena: p.cijena, pdvStopa: p.pdvStopa,
      }];
    });
    setQuery(''); setResults([]);
  };

  const updateStavka = (productId: number, patch: Partial<StavkaRed>) =>
    setStavke(prev => prev.map(s => s.productId === productId ? { ...s, ...patch } : s));
  const removeStavka = (productId: number) =>
    setStavke(prev => prev.filter(s => s.productId !== productId));

  const handleSave = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.api.savePrilogStavke(order.id, stavke.map(s => ({
        productId: s.productId, kolicina: s.kolicina, cijena: s.cijena, pdvStopa: s.pdvStopa,
      })));
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || 'Greška pri spremanju');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Prilog br. {order.prilogBroj} — račun #{order.brojFiskalnogRacuna || order.id}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            {readOnly
              ? 'Račun je storniran — prilog se ne može mijenjati.'
              : 'Dodajte stavke tako da njihova suma bude jednaka fiskalnom iznosu računa.'}
          </DialogDescription>
        </DialogHeader>

        {!readOnly && (
          <div>
            <Label>Dodaj stavku</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Pretraži šifru, barkod ili naziv (samo PDV stopa E)..."
              />
            </div>
            {results.length > 0 && (
              <div className="border rounded-md mt-1 max-h-40 overflow-auto">
                {results.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100 flex justify-between text-sm"
                  >
                    <span>{p.naziv} <span className="text-slate-400">({p.sifra})</span></span>
                    <span className="font-mono">{formatKM(p.cijena)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1 min-h-[120px] pr-3">
          {stavke.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Nema dodijeljenih stavki.</p>
          ) : (
            <div className="border rounded-md divide-y">
              {stavke.map(s => (
                <div key={s.productId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{s.naziv}</p>
                    <p className="text-[11px] text-slate-400 font-mono">{s.sifra} · {s.jm}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-slate-400">Kol</Label>
                    <DecimalInput
                      value={s.kolicina} maxDecimals={3} className="w-16 h-8" disabled={readOnly}
                      onValueChange={(_, n) => updateStavka(s.productId, { kolicina: isNaN(n) ? 0 : n })}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-slate-400">Cijena</Label>
                    <DecimalInput
                      value={s.cijena} className="w-20 h-8" disabled={readOnly}
                      onValueChange={(_, n) => updateStavka(s.productId, { cijena: isNaN(n) ? 0 : n })}
                    />
                  </div>
                  <div className="w-24 text-right font-mono tabular-nums">
                    {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: 0, pdvStopa: s.pdvStopa }))}
                  </div>
                  {!readOnly && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStavka(s.productId)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className={cn(
          'rounded-xl px-4 py-3 flex items-center justify-between border',
          kompletan ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
        )}>
          <div className="text-[12px] space-y-0.5">
            <p className="text-slate-500">
              Suma stavki: <span className="font-mono font-semibold text-slate-700">{formatKM(suma)}</span>
            </p>
            <p className="text-slate-500">
              Fiskalni iznos: <span className="font-mono font-semibold text-slate-700">{formatKM(order.ukupno)}</span>
            </p>
          </div>
          {kompletan ? (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-600">
              <Check size={14} /> Prilog je kompletan
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700">
              <AlertTriangle size={14} />
              Razlika: <span className="font-mono">{razlika > 0 ? '+' : ''}{formatKM(razlika)}</span>
            </span>
          )}
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {readOnly ? 'Zatvori' : 'Otkaži'}
          </Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={busy}>
              {busy ? 'Spremam...' : 'Sačuvaj'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
