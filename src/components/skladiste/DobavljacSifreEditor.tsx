import type { Dobavljac } from '@/types';
import type { SifraRed } from '@/lib/dobavljacSifre';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';

/**
 * Šifre pod kojima dobavljači vode artikal: red = dobavljač + (opciona) šifra.
 * Dobavljač izabran u jednom redu ne nudi se u ostalima.
 */
export function DobavljacSifreEditor({ redovi, onChange, dobavljaci }: {
  redovi: SifraRed[];
  onChange: (redovi: SifraRed[]) => void;
  dobavljaci: Dobavljac[];
}) {
  const izmijeni = (i: number, izmjena: Partial<SifraRed>) =>
    onChange(redovi.map((r, j) => (j === i ? { ...r, ...izmjena } : r)));
  const zauzeti = new Set(redovi.map(r => r.dobavljacId));
  const imaSlobodnih = dobavljaci.some(d => !zauzeti.has(d.id));

  if (dobavljaci.length === 0) {
    return <p className="text-xs text-slate-400">Nema dobavljača u šifarniku. Dodaj ih u Šifarnik → Dobavljači.</p>;
  }

  return (
    <div className="space-y-2">
      {redovi.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_9rem_2rem] gap-2 items-center">
          <Select value={r.dobavljacId?.toString() ?? ''} onValueChange={v => izmijeni(i, { dobavljacId: Number(v) })}>
            <SelectTrigger className="h-9" aria-label="Dobavljač"><SelectValue placeholder="Odaberi dobavljača…" /></SelectTrigger>
            <SelectContent>
              {dobavljaci.filter(d => d.id === r.dobavljacId || !zauzeti.has(d.id)).map(d => (
                <SelectItem key={d.id} value={String(d.id)}>{d.naziv}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-9 font-mono"
            aria-label="Šifra dobavljača"
            placeholder="Šifra"
            value={r.sifra}
            onChange={e => izmijeni(i, { sifra: e.target.value })}
          />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-8 text-slate-400 hover:text-red-600"
            aria-label="Ukloni" onClick={() => onChange(redovi.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {imaSlobodnih && (
        <Button type="button" variant="outline" size="sm" className="h-8"
          onClick={() => onChange([...redovi, { dobavljacId: null, sifra: '' }])}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Dodaj dobavljača
        </Button>
      )}
    </div>
  );
}
