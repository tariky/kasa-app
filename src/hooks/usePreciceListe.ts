import { useEffect, useRef, type RefObject } from 'react';
import { jePoljeZaUnos } from '@/components/ui/ledger';
import { akcijaListe, sljedeciFilter, type MogucnostiListe } from '@/lib/ledgerLista';
import type { LedgerLista } from './useLedgerLista';

export interface OpcijePreciceListe<F extends string> extends Pick<MogucnostiListe, 'izPretrage' | 'strelicomUListu' | 'enterOtvara' | 'preskociIzbornike'> {
  /** Prečice rade samo dok nijedan dijalog ekrana nije otvoren (dijalozi imaju svoje). */
  aktivno: boolean;
  /** Lista ekrana: ↓ iz pretrage i ↑↓ van liste vode u nju, ↵ van liste otvara izabrani dokument. */
  lista?: LedgerLista<{ id: number }>;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Esc u pretrazi: upit se briše (i polje pušta fokus). */
  onPretraga?: (upit: string) => void;
  onNovi?: () => void;
  onOsvjezi?: () => void;
  filteri?: { opcije: readonly { id: F }[]; vrijednost: F; postavi: (id: F) => void };
  /** Tipke koje nisu tipke liste (Ponude: P, S, U, K, F, D, 1–3, esc). */
  dodatne?: (e: KeyboardEvent) => void;
}

/**
 * Prečice ledger ekrana na cijelom prozoru: „/“ pretraga, esc briše upit, ↓ iz
 * pretrage u listu, N novi, R osvježi, ←→ i [ ] filter, ↑↓ i ↵ van liste.
 * Pravila su u `lib/ledgerLista.ts`; ovdje se samo izvršavaju.
 */
export function usePreciceListe<F extends string>(opcije: OpcijePreciceListe<F>) {
  const zadnje = useRef(opcije);
  zadnje.current = opcije;

  useEffect(() => {
    if (!opcije.aktivno) return;
    const onKey = (e: KeyboardEvent) => {
      const o = zadnje.current;
      const t = e.target as HTMLElement | null;
      const akcija = akcijaListe(e, {
        uPolju: jePoljeZaUnos(t),
        uPretrazi: !!t && t === o.searchRef?.current,
        uListi: !!t?.closest?.('tbody'),
        uIzborniku: !!t?.closest?.('[role="combobox"], [role="listbox"]'),
      }, {
        pretraga: !!o.searchRef,
        novi: !!o.onNovi,
        osvjezi: !!o.onOsvjezi,
        filteri: !!o.filteri,
        lista: !!o.lista,
        izPretrage: o.lista ? o.izPretrage ?? 'prvi' : undefined,
        strelicomUListu: o.strelicomUListu,
        enterOtvara: o.enterOtvara,
        preskociIzbornike: o.preskociIzbornike,
      });
      if (akcija === null) return;
      if (akcija === 'dalje') { o.dodatne?.(e); return; }
      const lista = o.lista;
      switch (akcija.vrsta) {
        case 'ocistiPretragu': o.onPretraga?.(''); t?.blur(); return;
        case 'izPretrage':
          if (!lista) return;
          if (akcija.na === 'prvi') { if (lista.stavke.length > 0) { e.preventDefault(); lista.fokusRed(0); } return; }
          e.preventDefault(); lista.fokusRed(lista.izabraniIndeks < 0 ? 0 : lista.izabraniIndeks);
          return;
        case 'pretraga': e.preventDefault(); o.searchRef?.current?.focus(); return;
        case 'novi': e.preventDefault(); o.onNovi?.(); return;
        case 'osvjezi': e.preventDefault(); o.onOsvjezi?.(); return;
        case 'filter': {
          const f = o.filteri;
          if (!f) return;
          e.preventDefault();
          f.postavi(sljedeciFilter(f.opcije, f.vrijednost, akcija.korak));
          return;
        }
        case 'uListu':
          if (!lista) return;
          e.preventDefault(); lista.fokusRed(lista.izabraniIndeks < 0 ? 0 : lista.izabraniIndeks);
          return;
        case 'otvori':
          if (lista?.izabranId != null) { e.preventDefault(); lista.otvori(lista.izabranId); }
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opcije.aktivno]);
}
