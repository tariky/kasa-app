import { useEffect, useState } from 'react';
import type { Kupac } from '@/types';
import { PretragaStavki, type PretragaStavkiProps } from '@/components/ui/pretraga-stavki';
import type { PoljaPretrage } from '@/lib/pretraga';
import { cn } from '@/lib/utils';

// Zadnji učitani šifarnik kupaca — sljedeći ekran ga prikaže odmah, a osvježi u pozadini.
let zadnjiKupci: Kupac[] | null = null;
const slusaoci = new Set<(k: Kupac[]) => void>();
let ucitavanje: Promise<Kupac[] | null> | null = null;

/**
 * Učitaj kupce iz baze i javi ih svima koji ih drže; istovremeni pozivi dijele
 * jedan zahtjev. Greška ostavlja zadnju listu (ili praznu) i vraća null.
 */
export function osvjeziKupce(): Promise<Kupac[] | null> {
  ucitavanje ??= window.api.getKupci()
    .then((rows: Kupac[]) => { zadnjiKupci = rows; slusaoci.forEach(f => f(rows)); return rows; })
    .catch(() => { const k = zadnjiKupci ?? []; slusaoci.forEach(f => f(k)); return null; })
    .finally(() => { ucitavanje = null; });
  return ucitavanje;
}

/** Šifarnik kupaca: odmah zadnja učitana lista (null dok je nema), svježa iz baze pri svakom uključivanju. */
export function useKupci(ukljuceno = true): Kupac[] | null {
  const [kupci, setKupci] = useState<Kupac[] | null>(zadnjiKupci);
  useEffect(() => {
    if (!ukljuceno) return;
    slusaoci.add(setKupci);
    osvjeziKupce();
    return () => { slusaoci.delete(setKupci); };
  }, [ukljuceno]);
  return kupci;
}

const poljaKupca = (k: Kupac): PoljaPretrage => ({ naziv: k.naziv, sifra: k.idBroj, dodatno: [k.adresa, k.grad].filter(Boolean).join(' ') });

type Proslijedi = Omit<PretragaStavkiProps<Kupac>, 'stavke' | 'polja' | 'kljuc' | 'meta' | 'oznaka' | 'sifre' | 'kolicine'>;

/**
 * PretragaStavki nad šifarnikom kupaca (naziv, JIB, adresa i grad). Bez `stavke`
 * sama učitava kupce; `izabraniIdBroj` ističe JIB kupca koji je već na računu.
 */
export function PretragaKupaca({ stavke, izabraniIdBroj, naslovSvih = 'Svi kupci', ariaLabel = 'Pretraga kupaca', akcija = 'odaberi', ...props }: Proslijedi & {
  /** Kupci koje roditelj već drži (useKupci); tada se ništa ne učitava. */
  stavke?: Kupac[] | null;
  izabraniIdBroj?: string;
}) {
  const vlastiti = useKupci(stavke === undefined);
  return (
    <PretragaStavki<Kupac>
      {...props}
      stavke={stavke === undefined ? vlastiti : stavke}
      polja={poljaKupca}
      kljuc={k => k.id}
      sifre={false}
      kolicine={false}
      naslovSvih={naslovSvih}
      ariaLabel={ariaLabel}
      akcija={akcija}
      oznaka={k => (k.adresa || k.grad) ? [k.adresa, k.grad].filter(Boolean).join(', ') : null}
      meta={k => (
        <span className={cn('font-mono text-[11px] tabular-nums', izabraniIdBroj !== undefined && k.idBroj === izabraniIdBroj ? 'font-semibold text-blue-600' : 'text-slate-400')}>
          {k.idBroj}
        </span>
      )}
    />
  );
}
