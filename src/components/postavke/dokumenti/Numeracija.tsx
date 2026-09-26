import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LIMITI, formatBroja, type FormatBroja, type NastavakNumeracije } from '@/lib/dokumentPostavke';
import { cn } from '@/lib/utils';
import { POLJE, Polje } from '../dijelovi';

const CIFARA = [0, 1, 2, 3, 4, 5, 6];

export interface Sljedeci {
  naziv: string;
  tekst: string;
  /** U bazi već postoji broj veći od upisanog nastavka — numeracija ide od njega. */
  preskocen: boolean;
}

/** Sljedeći broj u bazi je iza nastavka iz starog programa, pa nastavak ne odlučuje. */
export function jePreskocen(sljedeci: { broj: number; godina: number }, nastavak: NastavakNumeracije | null): boolean {
  return nastavak != null && nastavak.godina === sljedeci.godina && sljedeci.broj > nastavak.broj + 1;
}

/** Format broja dokumenta i nastavak numeracije iz starog programa (ponuda, radni nalog). */
export function Numeracija({ id, format, onFormat, saCiframa, nastavak, onNastavak, sljedeci }: {
  id: string;
  format: FormatBroja;
  onFormat: (f: FormatBroja) => void;
  /** Radni nalog nema dopunu nulama. */
  saCiframa: boolean;
  nastavak: NastavakNumeracije | null;
  onNastavak: (n: NastavakNumeracije | null) => void;
  /** null kad kanal nije dostupan (modul isključen) — red se ne prikazuje. */
  sljedeci: Sljedeci | null;
}) {
  const godina = new Date().getFullYear();
  const stariNastavak = nastavak != null && nastavak.godina !== godina;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Polje label="Prefiks broja" htmlFor={`${id}-prefiks`}
        napomena={<>Primjer: <span className="font-mono tabular-nums text-slate-600">{formatBroja({ broj: 3, godina }, format)}</span></>}>
        <Input id={`${id}-prefiks`} value={format.prefiks} maxLength={LIMITI.prefiks}
          onChange={e => onFormat({ ...format, prefiks: e.target.value })}
          placeholder="Bez prefiksa" className={cn(POLJE, 'font-mono')} />
      </Polje>
      {saCiframa ? (
        <Polje label="Broj cifara" napomena="Broj se dopunjava nulama sprijeda.">
          <Select value={String(format.cifara)} onValueChange={v => onFormat({ ...format, cifara: Number(v) })}>
            <SelectTrigger aria-label="Broj cifara" className={POLJE}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CIFARA.map(c => (
                <SelectItem key={c} value={String(c)} className="text-[13px]">{c === 0 ? 'Bez nula' : c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Polje>
      ) : <div />}

      <Polje label="Posljednji broj iz starog programa" htmlFor={`${id}-nastavak`}
        napomena={stariNastavak
          ? `Upisan za ${nastavak.godina}. godinu — ove godine se ne primjenjuje.`
          : `Za firme koje prelaze s drugog programa. Važi samo za ${godina}.`}>
        <Input id={`${id}-nastavak`} value={nastavak?.broj ?? ''} inputMode="numeric" maxLength={6}
          onChange={(e) => {
            const broj = Number(e.target.value.replace(/\D/g, ''));
            onNastavak(broj ? { broj, godina } : null);
          }}
          placeholder="Nema" className={cn(POLJE, 'font-mono tabular-nums')} />
      </Polje>
      {sljedeci && (
        <Polje label={sljedeci.naziv}
          napomena={sljedeci.preskocen ? 'U programu već postoji veći broj — nastavlja se od njega.' : undefined}>
          <div className="flex h-9 items-center rounded-md border border-dashed border-slate-200 px-3 font-mono text-[13px] tabular-nums text-slate-700">
            {sljedeci.tekst}
          </div>
        </Polje>
      )}
    </div>
  );
}
