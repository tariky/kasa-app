import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Product, ProductTip } from '@/types';
import { PretragaStavki, type PretragaStavkiProps } from '@/components/ui/pretraga-stavki';
import { jePloca } from '@/lib/ploca';
import { poljaProizvoda } from '@/lib/pretraga';
import { cn, formatKM } from '@/lib/utils';

const TIP_GRUPA: Record<ProductTip, string> = { artikal: 'Artikli', usluga: 'Usluge', materijal: 'Materijali' };
const TIP_RED: Record<ProductTip, number> = { artikal: 0, usluga: 1, materijal: 2 };

// Zadnji učitani katalog — sljedeća pretraga ga prikaže odmah, a osvježi u pozadini.
let zadnjiKatalog: Product[] | null = null;
const slusaoci = new Set<(p: Product[]) => void>();
let ucitavanje: Promise<void> | null = null;

function osvjeziKatalog(): Promise<void> {
  ucitavanje ??= window.api.getProducts()
    .then((rows: Product[]) => { zadnjiKatalog = rows; slusaoci.forEach(f => f(rows)); })
    .catch(() => { /* ostaje zadnji katalog */ })
    .finally(() => { ucitavanje = null; });
  return ucitavanje;
}

/** Svi proizvodi (bez slobodnih stavki) iz baze; osvježava se na zahtjev. */
function useKatalog(ukljuceno: boolean) {
  const [katalog, setKatalog] = useState<Product[] | null>(zadnjiKatalog);
  useEffect(() => {
    if (!ukljuceno) return;
    slusaoci.add(setKatalog);
    if (!zadnjiKatalog) osvjeziKatalog();
    return () => { slusaoci.delete(setKatalog); };
  }, [ukljuceno]);
  return katalog;
}

const fmtKol = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

type Proslijedi = Omit<PretragaStavkiProps<Product>, 'stavke' | 'polja' | 'kljuc' | 'meta' | 'oznaka' | 'grupa'>;

/**
 * PretragaStavki nad katalogom proizvoda. Bez `stavke` sama učitava katalog i osvježava ga
 * (stanje!) pri svakom otvaranju liste; `tipovi` i `filter` sužavaju šta se nudi.
 */
export function PretragaProizvoda({ stavke, tipovi, filter, onOtvori, ...props }: Proslijedi & {
  /** Katalog koji roditelj već ima; tada se ništa ne učitava. */
  stavke?: Product[];
  tipovi?: ProductTip[];
  filter?: (p: Product) => boolean;
}) {
  const vlastiti = useKatalog(!stavke);
  const izvor = stavke ?? vlastiti;
  const tipKljuc = tipovi?.join(',') ?? '';

  const lista = useMemo(() => {
    if (!izvor) return null;
    return izvor
      .filter(p => !p.slobodan && (!tipovi || tipovi.includes(p.tip)) && (!filter || filter(p)))
      .sort((a, b) => TIP_RED[a.tip] - TIP_RED[b.tip] || a.naziv.localeCompare(b.naziv, 'bs'));
    // filter je obično inline funkcija, pa nije u zavisnostima; mijenja se s izvorom ili tipovima
  }, [izvor, tipKljuc]);

  const mijesano = useMemo(() => new Set(lista?.map(p => p.tip)).size > 1, [lista]);

  const otvori = useCallback(() => { if (!stavke) osvjeziKatalog(); onOtvori?.(); }, [stavke, onOtvori]);

  return (
    <PretragaStavki<Product>
      {...props}
      stavke={lista}
      onOtvori={otvori}
      kljuc={p => p.id}
      polja={poljaProizvoda}
      grupa={mijesano ? p => TIP_GRUPA[p.tip] : undefined}
      oznaka={p => (mijesano || jePloca(p)) ? (
        <>
          {mijesano && <span className="rounded bg-slate-100 px-1.5 text-[10.5px] font-medium text-slate-500">{p.tip}</span>}
          {jePloca(p) && <span>ploča {p.plocaSirina}×{p.plocaVisina}</span>}
        </>
      ) : null}
      meta={p => (
        <>
          {p.tip !== 'usluga' && p.stanje != null && (
            <span className={cn('min-w-[64px] text-right font-mono tabular-nums',
              p.stanje <= 0 ? 'text-rose-500' : p.stanje <= 3 ? 'text-amber-600' : 'text-slate-400')}>
              {p.stanje <= 0 ? 'nema' : `${fmtKol(p.stanje)} ${p.jm}`}
            </span>
          )}
          {p.cijena > 0 && (
            <span className="min-w-[76px] text-right font-mono tabular-nums text-slate-700">
              {formatKM(p.cijena).replace(' KM', '')} <span className="text-[10.5px] text-slate-400">KM/{p.jm}</span>
            </span>
          )}
        </>
      )}
    />
  );
}
