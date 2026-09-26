import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { ImagePlus, X } from 'lucide-react';

/** Kvadratić s pregledom slike, dugme Dodaj/Zamijeni i Ukloni — logo firme, pečat. Slika ide kao data URL. */
export function SlikaBirac({ slika, onChange, alt, dodajTekst, zamijeniTekst, napomena, accept = 'image/*' }: {
  slika: string;
  onChange: (v: string) => void;
  alt: string;
  dodajTekst: string;
  zamijeniTekst: string;
  napomena: string;
  accept?: string;
}) {
  const ucitaj = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-4">
      <div className={cn(
        'w-16 h-16 flex-shrink-0 rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden',
        slika ? 'border border-slate-200' : 'border border-dashed border-slate-300',
      )}>
        {slika
          ? <img src={slika} alt={alt} className="max-w-full max-h-full object-contain" />
          : <ImagePlus size={20} className="text-slate-300" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200 cursor-pointer">
            <label>
              <ImagePlus className="h-3.5 w-3.5" />
              {slika ? zamijeniTekst : dodajTekst}
              <input type="file" accept={accept} onChange={ucitaj} className="sr-only" />
            </label>
          </Button>
          {slika && (
            <Button variant="ghost" size="sm" onClick={() => onChange('')}
              className="h-8 gap-1.5 text-[12px] text-slate-500 hover:text-rose-600 hover:bg-rose-50">
              <X className="h-3.5 w-3.5" />
              Ukloni
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[11.5px] text-slate-400">{napomena}</p>
      </div>
    </div>
  );
}

/** Klizač veličine slike u pt, s „Vrati zadano“ kad je pomjeren. */
export function VelicinaSlike({ naslov, vrijednost, onChange, min, max, zadano }: {
  naslov: string;
  vrijednost: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  zadano: number;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{naslov}</span>
        <div className="flex items-center gap-2">
          {vrijednost !== zadano && (
            <button type="button" onClick={() => onChange(zadano)}
              className="text-[11px] text-slate-400 hover:text-slate-700 underline-offset-2 hover:underline">
              Vrati zadano
            </button>
          )}
          <span className="font-mono text-[12px] text-slate-600 tabular-nums">{vrijednost} pt</span>
        </div>
      </div>
      <Slider aria-label={naslov} value={[vrijednost]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={2} />
    </div>
  );
}
