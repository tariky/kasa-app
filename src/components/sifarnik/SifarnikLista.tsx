import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Key } from '@/components/ui/ledger';
import { GreskaUcitavanja } from '@/components/GreskaUcitavanja';
import { potvrdi, obavijesti } from '@/lib/dijalog';
import { porukaGreske } from '@/lib/utils';
import { Plus, Search, X, type LucideIcon } from 'lucide-react';

interface Props {
  /** Natpis dugmeta za novi unos, npr. „Novi kupac“. */
  naslov: string;
  placeholder: string;
  pretraga: string;
  onPretraga: (s: string) => void;
  /** Redova u listi poslije pretrage i filtera; 0 → `prazno`. */
  broj: number;
  ukupno: number;
  onNovi: () => void;
  /** Sadržaj kad lista nema redova (obično `PraznaLista`). */
  prazno: React.ReactNode;
  /** Tabela. */
  children: React.ReactNode;
  /** aria-label polja pretrage; zadano je placeholder. */
  oznakaPretrage?: string;
  /** Kontrole u traci između pretrage i brojača (sortiranje, filter stanja). */
  alati?: React.ReactNode;
  /** false: bez „Ukupno N“ (kad filter u `alati` već nosi brojače). */
  brojac?: boolean;
  /** false dok je otvoren dijalog forme — tada „/“ i „N“ ne rade. */
  precice?: boolean;
  /** Stanje iz `useIpcPodaci`: dok lista nije učitana nema poruke „prazno“, a greška se vidi. */
  ucitavanje?: { podaci: unknown; greska: string | null; osvjezi: () => Promise<void> };
}

/**
 * Ljuska liste u Šifarniku: pretraga, brojač, dugme za novi unos, prečice
 * („/“ pretraga, „N“ novi, esc briše upit) i prazno stanje. Forme i kolone su
 * u tabovima.
 */
export function SifarnikLista({
  naslov, placeholder, pretraga, onPretraga, broj, ukupno, onNovi, prazno, children,
  oznakaPretrage, alati, brojac = true, precice = true, ucitavanje,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" pretraga, "N" novi unos — isto kao na listi artikala.
  useEffect(() => {
    if (!precice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (t === searchRef.current && e.key === 'Escape') { onPretraga(''); t.blur(); }
        return;
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); onNovi(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [precice, onPretraga, onNovi]);

  const ucitano = !ucitavanje || ucitavanje.podaci !== undefined;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 border-b border-slate-200/80">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px] sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <Input
            ref={searchRef}
            value={pretraga}
            onChange={e => onPretraga(e.target.value)}
            placeholder={placeholder}
            aria-label={oznakaPretrage ?? placeholder}
            className="pl-9 pr-9 h-8 text-[12.5px] bg-slate-50 border-slate-200"
          />
          {pretraga
            ? <button onClick={() => onPretraga('')} aria-label="Obriši pretragu" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            : <Key className="absolute right-2.5 top-1/2 -translate-y-1/2 ml-0">/</Key>}
        </div>

        {alati}

        {brojac && (
          <span className="text-[11.5px] text-slate-400 whitespace-nowrap">
            {pretraga ? <><span className="font-mono tabular-nums text-slate-600">{broj}</span> od </> : 'Ukupno '}
            <span className="font-mono tabular-nums text-slate-600">{ukupno}</span>
          </span>
        )}

        <Button size="sm" onClick={onNovi} className="ml-auto h-8 gap-1.5 pl-3 pr-2 text-[12px]">
          <Plus className="h-3.5 w-3.5" /> {naslov} <Key tone="dark">N</Key>
        </Button>
      </div>

      {ucitavanje && <GreskaUcitavanja greska={ucitavanje.greska} onPonovo={ucitavanje.osvjezi} />}

      {broj > 0
        ? <ScrollArea className="flex-1">{children}</ScrollArea>
        : ucitano && prazno}
    </div>
  );
}

/** Prazna lista: ikona, poruka i (opciono) kako se dodaje prvi unos tipkom N. */
export function PraznaLista({ ikona: Ikona, poruka, kakoDodati }: {
  ikona: LucideIcon;
  poruka: string;
  /** Npr. „Prvog kupca dodaješ“ — dopisuje se „tipkom N.“; false/prazno = bez reda. */
  kakoDodati?: string | false;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
      <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Ikona size={20} className="text-slate-300" /></div>
      <p className="text-[13px] font-medium text-slate-500">{poruka}</p>
      {kakoDodati && <p className="text-[12px] text-slate-400 mt-0.5">{kakoDodati} tipkom <Key className="ml-0 mx-0.5">N</Key>.</p>}
    </div>
  );
}

/**
 * Brisanje reda iz liste: potvrda s tekstom `opis(red)`, pa `fn(red)` (brisanje
 * i osvježavanje liste). Greška ide kroz `obavijesti` — isto u svim tabovima.
 */
export function useObrisi<T>(opis: (red: T) => string, fn: (red: T) => Promise<unknown>): (red: T) => Promise<void> {
  return useCallback(async (red: T) => {
    if (!(await potvrdi(opis(red)))) return;
    try { await fn(red); }
    catch (e) { await obavijesti(porukaGreske(e)); }
  }, [opis, fn]);
}
