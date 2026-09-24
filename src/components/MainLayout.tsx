import { useState, useEffect, useRef } from 'react';
import { User } from '@/types';
import {
  ScanBarcode, Warehouse, NotebookTabs, ReceiptText, FileSignature, BarChart3, Settings, LogOut, WandSparkles, Factory,
} from 'lucide-react';
import appIcon from '@/assets/icon.png';
import KasaScreen from '@/screens/KasaScreen';
import SkladisteScreen from '@/screens/SkladisteScreen';
import SifarnikScreen from '@/screens/SifarnikScreen';
import NarudzbeScreen from '@/screens/NarudzbeScreen';
import PonudeScreen from '@/screens/PonudeScreen';
import IzvjestajiScreen from '@/screens/IzvjestajiScreen';
import PostavkeScreen from '@/screens/PostavkeScreen';
import GeneratorScreen from '@/screens/GeneratorScreen';
import ProizvodnjaScreen from '@/screens/ProizvodnjaScreen';
import PendingRacuniDialog from '@/components/PendingRacuniDialog';
import PologPrompt from '@/components/PologPrompt';
import { useProizvodnja } from '@/hooks/useProizvodnja';
import LicencaTraka from '@/components/licenca/LicencaTraka';
import type { LicencaInfo } from '@/lib/licencaTipovi';
import { cn } from '@/lib/utils';

type Screen = 'kasa' | 'skladiste' | 'sifarnik' | 'narudzbe' | 'ponude' | 'proizvodnja' | 'izvjestaji' | 'generator' | 'postavke';

const NAV_ITEMS: { id: Screen; label: string; icon: typeof ScanBarcode; adminOnly?: boolean }[] = [
  { id: 'kasa', label: 'Kasa', icon: ScanBarcode },
  { id: 'skladiste', label: 'Skladište', icon: Warehouse },
  { id: 'sifarnik', label: 'Šifarnik', icon: NotebookTabs },
  { id: 'narudzbe', label: 'Računi', icon: ReceiptText },
  { id: 'ponude', label: 'Ponude', icon: FileSignature },
  { id: 'proizvodnja', label: 'Proizvodnja', icon: Factory },
  { id: 'izvjestaji', label: 'Izvještaji', icon: BarChart3 },
  { id: 'generator', label: 'Generator', icon: WandSparkles, adminOnly: true },
  { id: 'postavke', label: 'Postavke', icon: Settings, adminOnly: true },
];

const inicijali = (ime: string) =>
  ime.trim().split(/\s+/).slice(0, 2).map(r => r[0]?.toUpperCase() ?? '').join('') || '?';

// Kratko kašnjenje: kursor koji samo prođe preko lijeve ivice ne otvara meni.
const ODGODA_OTVARANJA_MS = 150;

interface Props {
  user: User;
  licenca: LicencaInfo;
  onLogout: () => void;
}

export default function MainLayout({ user, licenca, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>('kasa');
  const [showGenerator, setShowGenerator] = useState(false);
  const proizvodnja = useProizvodnja();
  const [openNalogId, setOpenNalogId] = useState<number | null>(null);
  const [otvoren, setOtvoren] = useState(false);
  const tajmer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sidebar = useRef<HTMLDivElement>(null);

  const zakaziOtvaranje = () => {
    clearTimeout(tajmer.current);
    tajmer.current = setTimeout(() => setOtvoren(true), ODGODA_OTVARANJA_MS);
  };
  const zatvori = () => {
    clearTimeout(tajmer.current);
    setOtvoren(false);
  };

  useEffect(() => () => clearTimeout(tajmer.current), []);

  // Otvoren dodirom (bez miša nema pointerleave-a): dodir bilo gdje van menija ga zatvara.
  useEffect(() => {
    if (!otvoren) return;
    const van = (e: PointerEvent) => {
      if (!sidebar.current?.contains(e.target as Node)) zatvori();
    };
    document.addEventListener('pointerdown', van);
    return () => document.removeEventListener('pointerdown', van);
  }, [otvoren]);

  useEffect(() => {
    window.api.getSetting('ui.showGenerator').then((v) => setShowGenerator(v === 'true'));
    // Postavke javljaju promjenu odmah, bez ponovnog ulaska u aplikaciju
    const onToggle = (e: Event) => {
      const enabled = Boolean((e as CustomEvent).detail);
      setShowGenerator(enabled);
      if (!enabled) setScreen(s => (s === 'generator' ? 'kasa' : s));
    };
    window.addEventListener('ui:showGenerator', onToggle);
    return () => window.removeEventListener('ui:showGenerator', onToggle);
  }, []);

  useEffect(() => {
    if (proizvodnja === false) setScreen(s => (s === 'proizvodnja' ? 'kasa' : s));
  }, [proizvodnja]);

  useEffect(() => {
    // Ponude otvaraju nalog na ekranu Proizvodnja — ekrani se ne poznaju međusobno.
    const onOpen = (e: Event) => {
      setOpenNalogId(Number((e as CustomEvent).detail));
      setScreen('proizvodnja');
    };
    window.addEventListener('ui:openNalog', onOpen);
    return () => window.removeEventListener('ui:openNalog', onOpen);
  }, []);

  // Nalog se otvara samo jednom, na dolasku sa drugog ekrana — inače bi svaki
  // ručni povratak na Proizvodnju ponovo selektovao stari nalog (ekran se
  // odmontira/montira pri promjeni `screen`, pa initialNalogId mora biti
  // "potrošen" čim korisnik ode sa ekrana).
  useEffect(() => {
    if (screen !== 'proizvodnja') setOpenNalogId(null);
  }, [screen]);

  return (
    <div className="h-screen flex bg-slate-50">
      {/* Sidebar: u toku zauzima samo traku s ikonama; na prelazak mišem se
          širi preko sadržaja, a izbor ekrana ga odmah zatvara. */}
      <div ref={sidebar} className="relative z-40 w-16 shrink-0 no-print">
        <aside
          onPointerEnter={(e) => { if (e.pointerType !== 'touch') zakaziOtvaranje(); }}
          onPointerLeave={(e) => { if (e.pointerType !== 'touch') zatvori(); }}
          className={cn(
            // transform-gpu: WebKit (Tauri) inače crta sticky zaglavlja tabela s
            // backdrop-blur preko otvorenog sidebara, bez obzira na z-index.
            'absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden bg-[#0f1629] text-white transform-gpu',
            'transition-[width,box-shadow] duration-200 ease-out',
            otvoren ? 'w-56 shadow-2xl shadow-black/40' : 'w-16',
          )}
        >
          {/* Brand — na dodir (touch) otvara/zatvara meni, jer tamo nema prelaska mišem */}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setOtvoren(o => !o)}
            className="flex items-center gap-3 px-[14px] pt-5 pb-4 text-left"
          >
            <img src={appIcon} alt="Atlas" className="w-9 h-9 shrink-0 rounded-lg shadow-sm shadow-blue-500/20" />
            <div className={cn('whitespace-nowrap transition-opacity duration-150', otvoren ? 'opacity-100' : 'opacity-0')}>
              <h1 className="text-base font-bold tracking-tight leading-none">Atlas</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">{user.ime}</p>
            </div>
          </button>

          {/* Nav */}
          <nav className="flex-1 px-2 space-y-0.5">
            {NAV_ITEMS.map(item => {
              if (item.adminOnly && user.uloga !== 'admin') return null;
              if (item.id === 'generator' && !showGenerator) return null;
              if (item.id === 'proizvodnja' && !proizvodnja) return null;
              const Icon = item.icon;
              const active = screen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setScreen(item.id); zatvori(); }}
                  aria-label={item.label}
                  className={`w-full flex items-center gap-3 px-[15px] py-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                    active
                      ? 'bg-blue-600/15 text-blue-400'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon size={18} strokeWidth={active ? 2 : 1.5} className="shrink-0" />
                  <span className={cn('transition-opacity duration-150', otvoren ? 'opacity-100' : 'opacity-0')}>{item.label}</span>
                  {active && otvoren && <div className="ml-auto w-1.5 h-1.5 shrink-0 rounded-full bg-blue-400" />}
                </button>
              );
            })}
          </nav>

          {/* User & Logout */}
          <div className="px-2 py-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 px-2 py-2 mb-1 whitespace-nowrap" title={otvoren ? undefined : user.ime}>
              <div className="w-8 h-8 shrink-0 rounded-full bg-white/[0.06] flex items-center justify-center text-[12px] font-semibold text-slate-300">
                {inicijali(user.ime)}
              </div>
              <div className={cn('min-w-0 transition-opacity duration-150', otvoren ? 'opacity-100' : 'opacity-0')}>
                <p className="text-sm text-slate-300 truncate">{user.ime}</p>
                <p className="text-[11px] text-slate-500 font-mono">{user.uloga === 'admin' ? 'Administrator' : 'Kasir'}</p>
              </div>
            </div>
            <button
              onClick={() => { zatvori(); onLogout(); }}
              aria-label="Odjava"
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-[13px] text-slate-500 whitespace-nowrap hover:text-red-400 hover:bg-red-500/[0.06] transition-colors duration-150"
            >
              <LogOut size={16} strokeWidth={1.5} className="shrink-0" />
              <span className={cn('transition-opacity duration-150', otvoren ? 'opacity-100' : 'opacity-0')}>Odjava</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Main content */}
      <main className="relative z-0 isolate flex-1 overflow-hidden flex flex-col">
        <LicencaTraka info={licenca} />
        <div className="flex-1 min-h-0 overflow-hidden">
          {screen === 'kasa' && <KasaScreen user={user} />}
          {screen === 'skladiste' && <SkladisteScreen />}
          {screen === 'sifarnik' && <SifarnikScreen />}
          {screen === 'narudzbe' && <NarudzbeScreen korisnikId={user.id} />}
          {screen === 'ponude' && <PonudeScreen korisnikId={user.id} />}
          {screen === 'proizvodnja' && <ProizvodnjaScreen korisnikId={user.id} uloga={user.uloga} initialNalogId={openNalogId} />}
          {screen === 'izvjestaji' && <IzvjestajiScreen korisnikId={user.id} />}
          {screen === 'generator' && <GeneratorScreen korisnikId={user.id} />}
          {screen === 'postavke' && <PostavkeScreen />}
        </div>
      </main>

      <PendingRacuniDialog korisnikId={user.id} />
      <PologPrompt korisnikId={user.id} />
    </div>
  );
}
