import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { cn, parseDecimal } from '@/lib/utils';
import type { Product } from '@/types';
import { useCijenaUnos } from '@/hooks/useCijenaUnos';
import { CijenaPdvPolje } from '@/components/CijenaPdvPolje';

/** Tring: naziv zajedno s JM ima 32–36 znakova, zavisno od uređaja (isto provjerava product:slobodan). */
const NAZIV_MAX = 32;

const STOPE: { value: 'E' | 'K'; label: string }[] = [
  { value: 'E', label: 'E · 17%' },
  { value: 'K', label: 'K · 0%' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Artikal je već upisan (ili pronađen) u bazi; roditelj ga stavlja u košaricu ili vrati razlog odbijanja. */
  onDodaj: (product: Product, kolicina: number) => string | undefined;
}

/**
 * Stavka bez šifre: kasir upiše naziv, cijenu i stopu, a backend napravi
 * (ili ponovo iskoristi) skriveni artikal s automatskom šifrom.
 */
export default function SlobodnaStavkaDialog({ open, onClose, onDodaj }: Props) {
  const [naziv, setNaziv] = useState('');
  const [kolicina, setKolicina] = useState('1');
  const [stopa, setStopa] = useState<'E' | 'K'>('E');
  // Režim "sa/bez PDV-a" svako otvaranje kreće od postavke cijene.unosBezPdv.
  const cijena = useCijenaUnos(open, null, stopa);
  const [jm, setJm] = useState('kom');
  const [greska, setGreska] = useState<string | null>(null);
  const [radi, setRadi] = useState(false);
  const nazivRef = useRef<HTMLInputElement>(null);

  // Svako otvaranje kreće od praznog obrasca; stopa ostaje kakva je bila zadnji put.
  useEffect(() => {
    if (!open) return;
    setNaziv(''); setKolicina('1'); setJm('kom'); setGreska(null); setRadi(false);
    setTimeout(() => nazivRef.current?.focus(), 50);
  }, [open]);

  const potvrdi = async () => {
    if (radi || !cijena.spremno) return;
    const c = cijena.bruto;
    const k = parseDecimal(kolicina);
    if (!naziv.trim()) { setGreska('Upišite naziv stavke.'); return; }
    if (!(c > 0)) { setGreska('Upišite cijenu.'); return; }
    if (!(k > 0)) { setGreska('Količina mora biti veća od nule.'); return; }
    setRadi(true);
    setGreska(null);
    try {
      const product: Product = await window.api.createSlobodanProduct({ naziv, cijena: c, pdvStopa: stopa, jm });
      const odbijeno = onDodaj(product, k);
      if (odbijeno) { setGreska(odbijeno); setRadi(false); }
    } catch (err: any) {
      setGreska(err?.message || 'Stavka nije dodana.');
      setRadi(false);
    }
  };

  const naEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); potvrdi(); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[420px] p-0 gap-0 overflow-hidden rounded-2xl">
        <div className="px-6 pt-6 pb-5">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Slobodna stavka</DialogTitle>
            <DialogDescription className="text-sm text-slate-500 mt-0.5">
              Stavka bez šifre. Ne ulazi u šifarnik i nema zalihu.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="flex justify-between text-[12px] font-medium text-slate-600 mb-1.5">
                Naziv
                <span className={cn('font-mono tabular-nums', naziv.length >= NAZIV_MAX ? 'text-amber-600' : 'text-slate-400')}>
                  {naziv.length}/{NAZIV_MAX}
                </span>
              </span>
              <Input
                ref={nazivRef}
                value={naziv}
                maxLength={NAZIV_MAX}
                onChange={e => setNaziv(e.target.value)}
                onKeyDown={naEnter}
                placeholder="npr. Popravak rajsferšlusa"
                className="h-11 rounded-xl"
                autoComplete="off"
              />
            </label>

            <div className="grid grid-cols-[1fr_6rem_5rem] gap-3 items-start">
              <div>
                <span className="block text-[12px] font-medium text-slate-600 mb-1.5">Cijena (KM)</span>
                <CijenaPdvPolje
                  unos={cijena.unos}
                  onUnos={cijena.setUnos}
                  bezPdv={cijena.bezPdv}
                  onRezim={cijena.setRezim}
                  stopa={stopa}
                  bruto={cijena.bruto}
                  onKeyDown={naEnter}
                />
              </div>
              <label className="block">
                <span className="block text-[12px] font-medium text-slate-600 mb-1.5">Količina</span>
                <DecimalInput
                  maxDecimals={3}
                  value={kolicina}
                  onValueChange={text => setKolicina(text)}
                  onKeyDown={naEnter}
                  className="h-11 rounded-xl font-mono text-right"
                />
              </label>
              <label className="block">
                <span className="block text-[12px] font-medium text-slate-600 mb-1.5">JM</span>
                <Input
                  value={jm}
                  maxLength={3}
                  onChange={e => setJm(e.target.value)}
                  onKeyDown={naEnter}
                  className="h-11 rounded-xl"
                  autoComplete="off"
                />
              </label>
            </div>

            <div>
              <span className="block text-[12px] font-medium text-slate-600 mb-1.5">PDV stopa</span>
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="PDV stopa">
                {STOPE.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={stopa === s.value}
                    onClick={() => setStopa(s.value)}
                    className={cn(
                      'h-8 px-3.5 rounded-[10px] text-[12.5px] font-medium font-mono transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                      stopa === s.value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {greska && (
              <p role="alert" className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {greska}
              </p>
            )}
          </div>
        </div>
        <div className="border-t border-slate-100 px-6 py-4 bg-slate-50/50 flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="rounded-lg" onClick={onClose}>
            Otkaži
          </Button>
          <Button size="sm" className="rounded-lg px-5" onClick={potvrdi} disabled={radi || !cijena.spremno}>
            Dodaj
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
