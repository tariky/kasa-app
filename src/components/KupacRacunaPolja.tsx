import type { ChangeEvent, KeyboardEventHandler, Ref } from 'react';
import { Input } from '@/components/ui/input';
import { Eyebrow } from '@/components/ui/ledger';
import { KUPAC_LIMITI, type KupacRacuna } from '@/lib/kupacRacuna';
import { cn } from '@/lib/utils';

/** md: dijalog kupca na kasi; lg: firma na fakturi (šira polja, duži natpisi u poljima). */
const IZGLED = {
  md: { polje: 'h-9 rounded-lg text-sm', prviRed: 'grid-cols-2', postanski: 'w-24', idBroj: 'JIB (13 cifara)', postanskiBroj: 'Poš. br.' },
  lg: { polje: 'h-10 rounded-lg text-sm', prviRed: 'grid-cols-[1fr_1.4fr]', postanski: 'w-28', idBroj: 'ID broj (JIB)', postanskiBroj: 'Poš. broj' },
} as const;

/** Varijanta `oznake` (ručni račun): natpis iznad svakog polja, mreža u dvije kolone. */
const OZNAKE: [keyof KupacRacuna, string, boolean][] = [
  ['idBroj', 'ID broj', true],
  ['naziv', 'Naziv', false],
  ['adresa', 'Adresa', false],
  ['grad', 'Grad', false],
  ['postanskiBroj', 'Poštanski broj', true],
];

/**
 * Polja kupca na računu (JIB, naziv, adresa, poštanski broj, grad) s dužinama
 * koje Tring štampa. `onKeyDown` ide na svako polje (npr. Enter potvrđuje firmu).
 */
export function KupacRacunaPolja({ value, onChange, varijanta = 'md', onKeyDown, idBrojRef, className }: {
  value: KupacRacuna;
  onChange: (k: KupacRacuna) => void;
  varijanta?: 'md' | 'lg' | 'oznake';
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Fokus na JIB (npr. kad se ručni unos otvori). */
  idBrojRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const polje = (k: keyof KupacRacuna) => ({
    value: value[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value }),
    onKeyDown,
    maxLength: KUPAC_LIMITI[k],
  });

  if (varijanta === 'oznake') {
    return (
      <div className={cn('grid grid-cols-2 gap-3', className)}>
        {OZNAKE.map(([k, natpis, mono]) => (
          <div key={k} className="space-y-1">
            <Eyebrow>{natpis}</Eyebrow>
            <Input
              ref={k === 'idBroj' ? idBrojRef : undefined}
              aria-label={natpis}
              inputMode={k === 'idBroj' ? 'numeric' : undefined}
              {...polje(k)}
              className={cn('h-9 text-[12.5px]', mono && 'font-mono tabular-nums')}
            />
          </div>
        ))}
      </div>
    );
  }

  const izgled = IZGLED[varijanta];
  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn('grid gap-2', izgled.prviRed)}>
        <Input ref={idBrojRef} placeholder={izgled.idBroj} aria-label="ID broj (JIB)" inputMode="numeric"
          {...polje('idBroj')} className={cn(izgled.polje, 'font-mono')} />
        <Input placeholder="Naziv" aria-label="Naziv" {...polje('naziv')} className={izgled.polje} />
      </div>
      <Input placeholder="Adresa" aria-label="Adresa" {...polje('adresa')} className={izgled.polje} />
      <div className="flex gap-2">
        <Input placeholder={izgled.postanskiBroj} aria-label="Poštanski broj" {...polje('postanskiBroj')}
          className={cn(izgled.polje, izgled.postanski, 'font-mono')} />
        <Input placeholder="Grad" aria-label="Grad" {...polje('grad')} className={cn(izgled.polje, 'flex-1')} />
      </div>
    </div>
  );
}
