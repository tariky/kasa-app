import type { ChangeEvent, KeyboardEventHandler, Ref } from 'react';
import { Input } from '@/components/ui/input';
import { KUPAC_LIMITI, type KupacRacuna } from '@/lib/kupacRacuna';
import { cn } from '@/lib/utils';

/** md: dijalog kupca na kasi i ručni račun; lg: firma na fakturi (šira polja, duži natpisi). */
const IZGLED = {
  md: { polje: 'h-9 rounded-lg text-sm', prviRed: 'grid-cols-2', postanski: 'w-24', idBroj: 'JIB (13 cifara)', postanskiBroj: 'Poš. br.' },
  lg: { polje: 'h-10 rounded-lg text-sm', prviRed: 'grid-cols-[1fr_1.4fr]', postanski: 'w-28', idBroj: 'ID broj (JIB)', postanskiBroj: 'Poš. broj' },
} as const;

/**
 * Polja kupca na računu (JIB, naziv, adresa, poštanski broj, grad) s dužinama
 * koje Tring štampa. `onKeyDown` ide na svako polje (npr. Enter potvrđuje firmu).
 */
export function KupacRacunaPolja({ value, onChange, velicina = 'md', onKeyDown, idBrojRef, className }: {
  value: KupacRacuna;
  onChange: (k: KupacRacuna) => void;
  velicina?: 'md' | 'lg';
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Fokus na JIB (npr. kad se ručni unos otvori). */
  idBrojRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const izgled = IZGLED[velicina];
  const polje = (k: keyof KupacRacuna) => ({
    value: value[k],
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value }),
    onKeyDown,
    maxLength: KUPAC_LIMITI[k],
  });
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
