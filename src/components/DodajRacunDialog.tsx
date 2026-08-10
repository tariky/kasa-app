import { useState, useMemo, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Search } from 'lucide-react';
import { Product } from '@/types';
import { izracunajTotale, iznosStavke } from '@/lib/racun';
import { formatKM } from '@/lib/utils';

interface StavkaUnos {
  product: Product;
  kolicina: number;
  rabat: number;
  cijena: number;
}

type PaymentType = 'Gotovina' | 'Kartica' | 'Virman' | 'Ček';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  korisnikId: number;
  onSaved: () => void;
  prefillBroj?: string;
}

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DodajRacunDialog({ open, onOpenChange, korisnikId, onSaved, prefillBroj }: Props) {
  const [brojFiskalnog, setBrojFiskalnog] = useState('');
  const [datum, setDatum] = useState(nowLocalInput());
  const [nacinPlacanja, setNacinPlacanja] = useState<PaymentType>('Gotovina');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [stavke, setStavke] = useState<StavkaUnos[]>([]);
  const [kupacNaziv, setKupacNaziv] = useState('');
  const [kupacIdBroj, setKupacIdBroj] = useState('');
  const [kupacAdresa, setKupacAdresa] = useState('');
  const [kupacGrad, setKupacGrad] = useState('');
  const [kupacPostanskiBroj, setKupacPostanskiBroj] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && prefillBroj) setBrojFiskalnog(prefillBroj);
  }, [open, prefillBroj]);

  const { ukupno, pdvIznos } = useMemo(
    () => izracunajTotale(stavke.map(s => ({
      cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
    }))),
    [stavke]
  );

  const search = async (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const found = await window.api.searchProducts(q);
    setResults(found);
  };

  const addProduct = (p: Product) => {
    setStavke(prev => {
      const existing = prev.find(s => s.product.id === p.id);
      if (existing) return prev.map(s => s.product.id === p.id ? { ...s, kolicina: s.kolicina + 1 } : s);
      return [...prev, { product: p, kolicina: 1, rabat: 0, cijena: p.cijena }];
    });
    setQuery(''); setResults([]);
  };

  const updateStavka = (id: number, patch: Partial<StavkaUnos>) => {
    setStavke(prev => prev.map(s => s.product.id === id ? { ...s, ...patch } : s));
  };
  const removeStavka = (id: number) => setStavke(prev => prev.filter(s => s.product.id !== id));

  const reset = () => {
    setBrojFiskalnog(''); setDatum(nowLocalInput()); setNacinPlacanja('Gotovina');
    setQuery(''); setResults([]); setStavke([]);
    setKupacNaziv(''); setKupacIdBroj(''); setKupacAdresa(''); setKupacGrad(''); setKupacPostanskiBroj('');
    setError('');
  };

  const handleSave = async () => {
    setError('');
    if (!brojFiskalnog.trim()) { setError('Unesi fiskalni broj računa'); return; }
    if (stavke.length === 0) { setError('Dodaj bar jednu stavku'); return; }
    if (!datum) { setError('Unesi datum i vrijeme računa'); return; }

    const createdAt = datum.replace('T', ' ') + ':00';
    const kupac = kupacIdBroj.trim()
      ? { idBroj: kupacIdBroj.trim(), naziv: kupacNaziv.trim(), adresa: kupacAdresa.trim(), grad: kupacGrad.trim(), postanskiBroj: kupacPostanskiBroj.trim() }
      : undefined;

    setLoading(true);
    try {
      await window.api.createManualOrder({
        korisnikId, ukupno, pdvIznos, nacinPlacanja,
        brojFiskalnogRacuna: brojFiskalnog.trim(), createdAt, kupac,
        stavke: stavke.map(s => ({
          productId: s.product.id, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.product.pdvStopa,
        })),
      });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Ručni unos fiskalnog računa</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fiskalni broj računa *</Label>
                <Input value={brojFiskalnog} onChange={e => setBrojFiskalnog(e.target.value)} placeholder="npr. 1234" />
              </div>
              <div>
                <Label>Datum i vrijeme *</Label>
                <Input type="datetime-local" value={datum} onChange={e => setDatum(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Način plaćanja</Label>
              <div className="flex gap-2 mt-1">
                {(['Gotovina', 'Kartica', 'Virman', 'Ček'] as PaymentType[]).map(t => (
                  <Button key={t} type="button" variant={nacinPlacanja === t ? 'default' : 'outline'} size="sm" onClick={() => setNacinPlacanja(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label>Dodaj artikal</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={query} onChange={e => search(e.target.value)} placeholder="Pretraži šifru, barkod ili naziv..." />
              </div>
              {results.length > 0 && (
                <div className="border rounded-md mt-1 max-h-40 overflow-auto">
                  {results.map(p => (
                    <button key={p.id} type="button" onClick={() => addProduct(p)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-100 flex justify-between text-sm">
                      <span>{p.naziv} <span className="text-slate-400">({p.sifra})</span></span>
                      <span className="font-mono">{formatKM(p.cijena)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {stavke.length > 0 && (
              <div className="border rounded-md divide-y">
                {stavke.map(s => (
                  <div key={s.product.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0 truncate">{s.product.naziv}</div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-400">Kol</Label>
                      <DecimalInput value={s.kolicina} maxDecimals={3} className="w-16 h-8"
                        onValueChange={(_, n) => updateStavka(s.product.id, { kolicina: n || 0 })} />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-400">Cijena</Label>
                      <DecimalInput value={s.cijena} className="w-20 h-8"
                        onValueChange={(_, n) => updateStavka(s.product.id, { cijena: n || 0 })} />
                    </div>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-400">Rabat %</Label>
                      <DecimalInput value={s.rabat} className="w-16 h-8"
                        onValueChange={(_, n) => updateStavka(s.product.id, { rabat: Math.min(100, n || 0) })} />
                    </div>
                    <div className="w-24 text-right font-mono">
                      {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.product.pdvStopa }))}
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStavka(s.product.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <details className="border rounded-md px-3 py-2">
              <summary className="cursor-pointer text-sm text-slate-600">Kupac (opciono)</summary>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><Label>ID broj</Label><Input value={kupacIdBroj} onChange={e => setKupacIdBroj(e.target.value)} /></div>
                <div><Label>Naziv</Label><Input value={kupacNaziv} onChange={e => setKupacNaziv(e.target.value)} /></div>
                <div><Label>Adresa</Label><Input value={kupacAdresa} onChange={e => setKupacAdresa(e.target.value)} /></div>
                <div><Label>Grad</Label><Input value={kupacGrad} onChange={e => setKupacGrad(e.target.value)} /></div>
                <div><Label>Poštanski broj</Label><Input value={kupacPostanskiBroj} onChange={e => setKupacPostanskiBroj(e.target.value)} /></div>
              </div>
            </details>

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm text-slate-500">PDV (17%): {formatKM(pdvIznos)}</span>
              <span className="text-lg font-bold">Ukupno: {formatKM(ukupno)}</span>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={loading}>Otkaži</Button>
          <Button onClick={handleSave} disabled={loading}>
            <Plus className="h-4 w-4 mr-1" /> {loading ? 'Spremam...' : 'Spremi račun'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
