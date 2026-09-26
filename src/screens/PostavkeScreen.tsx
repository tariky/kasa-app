import { useEffect, useRef, useState } from 'react';
import FirmaGrupa from '@/components/postavke/FirmaGrupa';
import KasaGrupa from '@/components/postavke/KasaGrupa';
import FiskalniGrupa from '@/components/postavke/FiskalniGrupa';
import DokumentiGrupa from '@/components/postavke/DokumentiGrupa';
import KorisniciGrupa from '@/components/postavke/KorisniciGrupa';
import LicencaGrupa from '@/components/postavke/LicencaGrupa';
import SistemGrupa from '@/components/postavke/SistemGrupa';
import { useLicenca } from '@/hooks/useLicenca';
import { opisLicence } from '@/lib/licencaTipovi';
import { cn, mnozina } from '@/lib/utils';
import { version } from '../../package.json';
import {
  Building2, ScanBarcode, Printer, FileText, Users, ShieldCheck, Settings2,
} from 'lucide-react';

type Grupa = 'firma' | 'kasa' | 'fiskalni' | 'dokumenti' | 'korisnici' | 'licenca' | 'sistem';

type Ton = 'ok' | 'upozorenje' | 'greska' | null;

interface Sazetak {
  firma: string | null;
  tring: string | null;
  korisnika: number | null;
}

const GRUPE: { id: Grupa; naziv: string; ikona: typeof Building2 }[] = [
  { id: 'firma', naziv: 'Firma', ikona: Building2 },
  { id: 'kasa', naziv: 'Kasa', ikona: ScanBarcode },
  { id: 'fiskalni', naziv: 'Fiskalni uređaj', ikona: Printer },
  { id: 'dokumenti', naziv: 'Dokumenti', ikona: FileText },
  { id: 'korisnici', naziv: 'Korisnici', ikona: Users },
  { id: 'licenca', naziv: 'Licenca i moduli', ikona: ShieldCheck },
  { id: 'sistem', naziv: 'Sistem', ikona: Settings2 },
];

// Ekran se odmontira pri promjeni ekrana u navigaciji; povratak otvara zadnju grupu.
let zadnjaGrupa: Grupa = 'firma';

export default function PostavkeScreen() {
  const [grupa, setGrupaState] = useState<Grupa>(zadnjaGrupa);
  const [sazetak, setSazetak] = useState<Sazetak>({ firma: null, tring: null, korisnika: null });
  // Grupa ostaje montirana kad se jednom otvori — nespremljen unos firme preživi prelazak na drugu grupu.
  const [posjecene, setPosjecene] = useState<Set<Grupa>>(() => new Set([zadnjaGrupa]));
  const [firmaIzmijenjena, setFirmaIzmijenjena] = useState(false);
  const [dokumentiIzmijenjeno, setDokumentiIzmijenjeno] = useState(false);
  const licenca = useLicenca();
  const sadrzaj = useRef<HTMLDivElement>(null);
  const dugmad = useRef<Record<string, HTMLButtonElement | null>>({});

  const setGrupa = (g: Grupa) => {
    zadnjaGrupa = g;
    setGrupaState(g);
    setPosjecene(p => (p.has(g) ? p : new Set(p).add(g)));
    sadrzaj.current?.scrollTo({ top: 0 });
  };

  const ucitajFirmu = () => window.api.getFirmaSettings()
    .then(s => setSazetak(z => ({ ...z, firma: s.naziv.trim() }))).catch(() => { /* sažetak u listi nije kritičan */ });
  const ucitajTring = () => window.api.getTringSettings()
    .then(s => setSazetak(z => ({ ...z, tring: s ? `${s.host || 'localhost'}:${s.port ?? 8085}` : null }))).catch(() => { /* sažetak u listi nije kritičan */ });
  const ucitajKorisnike = () => window.api.getUsers()
    .then(u => setSazetak(z => ({ ...z, korisnika: u.length }))).catch(() => { /* sažetak u listi nije kritičan */ });

  useEffect(() => {
    ucitajFirmu();
    ucitajTring();
    ucitajKorisnike();
  }, []);

  const opisLic = licenca ? opisLicence(licenca) : null;

  const podnaslov = (g: Grupa): { tekst: string; mono?: boolean; ton?: Ton } | null => {
    switch (g) {
      case 'firma':
        if (firmaIzmijenjena) return { tekst: 'Nespremljene izmjene', ton: 'upozorenje' };
        if (sazetak.firma == null) return null;
        return sazetak.firma ? { tekst: sazetak.firma } : { tekst: 'Naziv firme nije upisan', ton: 'upozorenje' };
      case 'kasa':
        return { tekst: 'Prodaja i unos cijena' };
      case 'fiskalni':
        return sazetak.tring ? { tekst: sazetak.tring, mono: true } : null;
      case 'dokumenti':
        return dokumentiIzmijenjeno ? { tekst: 'Nespremljene izmjene', ton: 'upozorenje' } : { tekst: 'Fakture, ponude, štampa' };
      case 'korisnici':
        return sazetak.korisnika == null ? null
          : { tekst: `${sazetak.korisnika} ${mnozina(sazetak.korisnika, ['korisnik', 'korisnika', 'korisnika'])}` };
      case 'licenca':
        return opisLic ? { tekst: opisLic.naslov, ton: opisLic.ton } : null;
      case 'sistem':
        return { tekst: `Verzija ${version}` };
    }
  };

  const onRailKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = GRUPE.findIndex(g => g.id === grupa);
    const sljedeca = GRUPE[(i + (e.key === 'ArrowDown' ? 1 : GRUPE.length - 1)) % GRUPE.length].id;
    setGrupa(sljedeca);
    dugmad.current[sljedeca]?.focus();
  };

  return (
    <div className="flex h-full bg-[hsl(220,20%,97%)]">
      {/* ── Grupe postavki: lista lijevo, kao na ledger ekranima ── */}
      <nav aria-label="Grupe postavki" className="w-[248px] flex-shrink-0 flex flex-col bg-white border-r border-slate-200/80">
        <div className="px-5 pt-5 pb-3">
          <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">Postavke</h1>
        </div>
        <div className="flex-1 overflow-y-auto pb-4" onKeyDown={onRailKey}>
          {GRUPE.map(g => {
            const aktivna = g.id === grupa;
            const Ikona = g.ikona;
            const pod = podnaslov(g.id);
            return (
              <button
                key={g.id}
                ref={el => { dugmad.current[g.id] = el; }}
                onClick={() => setGrupa(g.id)}
                aria-current={aktivna ? 'page' : undefined}
                tabIndex={aktivna ? 0 : -1}
                className={cn(
                  'w-full flex items-start gap-3 px-5 py-2.5 text-left transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50',
                  aktivna ? 'bg-blue-50/80 shadow-[inset_3px_0_0_0_#2563eb]' : 'hover:bg-slate-50',
                )}
              >
                <Ikona size={16} strokeWidth={aktivna ? 2 : 1.6}
                  className={cn('mt-[2px] flex-shrink-0', aktivna ? 'text-blue-600' : 'text-slate-400')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] font-medium leading-5', aktivna ? 'text-slate-900' : 'text-slate-700')}>
                    {g.naziv}
                  </span>
                  <span className={cn(
                    'flex items-center gap-1.5 min-h-[16px] text-[11.5px] leading-4',
                    pod?.ton === 'upozorenje' ? 'text-amber-700' : pod?.ton === 'greska' ? 'text-rose-600' : 'text-slate-400',
                  )}>
                    {pod?.ton && pod.ton !== 'ok' && (
                      <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', pod.ton === 'upozorenje' ? 'bg-amber-400' : 'bg-rose-500')} />
                    )}
                    <span className={cn('truncate', pod?.mono && 'font-mono text-[11px] tabular-nums')}>{pod?.tekst}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Sadržaj odabrane grupe ── */}
      <div ref={sadrzaj} className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[720px] px-8 pt-7">
          {GRUPE.filter(g => posjecene.has(g.id)).map(g => (
            <div key={g.id} hidden={g.id !== grupa}>
              {g.id === 'firma' && <FirmaGrupa onSpremljeno={ucitajFirmu} onIzmijenjeno={setFirmaIzmijenjena} />}
              {g.id === 'kasa' && <KasaGrupa />}
              {g.id === 'fiskalni' && <FiskalniGrupa onSpremljeno={ucitajTring} />}
              {g.id === 'dokumenti' && <DokumentiGrupa onIzmijenjeno={setDokumentiIzmijenjeno} />}
              {g.id === 'korisnici' && <KorisniciGrupa onPromjena={ucitajKorisnike} />}
              {g.id === 'licenca' && <LicencaGrupa />}
              {g.id === 'sistem' && <SistemGrupa />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
