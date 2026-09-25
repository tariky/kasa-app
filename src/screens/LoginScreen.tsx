import { useState, useCallback, useEffect } from 'react';
import {
  ScanBarcode, Warehouse, NotebookTabs, ReceiptText, FileSignature, BarChart3, Factory, Delete, ArrowRight,
} from 'lucide-react';
import { User } from '@/types';
import appIcon from '@/assets/icon.png';
import { PROGRAM } from '@/lib/brend';
import { opisLicence, type LicencaInfo, type TonLicence } from '@/lib/licencaTipovi';
import { useModuli } from '@/hooks/useModuli';
import type { Modul } from '@/lib/moduli';
import { cn, porukaGreske } from '@/lib/utils';
import PromjenaZadanogPina from '@/components/PromjenaZadanogPina';

interface LoginScreenProps {
  licenca: LicencaInfo;
  onLogin: (user: User) => void;
}

const MIN_PIN = 4;
const MAX_PIN = 6;

// Isti redoslijed i ikone kao u sidebaru, da korisnik odmah prepozna ekrane.
const MODULI: { naziv: string; icon: typeof ScanBarcode; modul?: Modul }[] = [
  { naziv: 'Kasa', icon: ScanBarcode },
  { naziv: 'Skladište', icon: Warehouse, modul: 'skladiste' },
  { naziv: 'Šifarnik', icon: NotebookTabs },
  { naziv: 'Računi', icon: ReceiptText },
  { naziv: 'Ponude', icon: FileSignature, modul: 'ponude' },
  { naziv: 'Proizvodnja', icon: Factory, modul: 'proizvodnja' },
  { naziv: 'Izvještaji', icon: BarChart3 },
];

const TON_TACKA: Record<TonLicence, string> = {
  ok: 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.15)]',
  upozorenje: 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.15)]',
  greska: 'bg-red-400 shadow-[0_0_0_4px_rgba(248,113,113,0.15)]',
};

/** Žičani globus (meridijani i paralele) — pozadina panela, "atlas" doslovno. */
function Globus({ className }: { className?: string }) {
  const R = 300;
  const meridijani = [15, 35, 55, 75].map(ug => R * Math.cos((ug * Math.PI) / 180));
  const paralele = [-60, -40, -20, 0, 20, 40, 60].map(ug => {
    const rad = (ug * Math.PI) / 180;
    return { y: R * Math.sin(rad), rx: R * Math.cos(rad) };
  });
  return (
    <svg viewBox="-310 -310 620 620" className={className} aria-hidden fill="none" stroke="currentColor">
      <g transform="rotate(-18)" strokeWidth="1">
        <circle r={R} strokeWidth="1.25" />
        <line x1="0" y1={-R} x2="0" y2={R} />
        {meridijani.map(rx => <ellipse key={rx} rx={rx} ry={R} />)}
        {paralele.map(p => <ellipse key={p.y} cy={p.y} rx={p.rx} ry={p.rx * 0.16} />)}
      </g>
    </svg>
  );
}

export default function LoginScreen({ licenca, onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);
  const [firma, setFirma] = useState('');
  // Prijava zadanim PIN-om: korisnik ulazi tek kad postavi svoj PIN.
  const [zadani, setZadani] = useState<{ user: User; pin: string } | null>(null);
  const moduli = useModuli();

  useEffect(() => {
    window.api.getFirmaSettings().then(f => setFirma(f.naziv?.trim() ?? '')).catch(() => {});
  }, []);

  const handleDigit = (d: string) => {
    if (pin.length < MAX_PIN) {
      setPin(prev => prev + d);
      setError('');
    }
  };

  const handleDelete = () => setPin(prev => prev.slice(0, -1));

  const odbij = (poruka: string) => {
    setError(poruka);
    setShaking(true);
    setTimeout(() => { setShaking(false); setPin(''); }, 450);
  };

  const handleSubmit = useCallback(async () => {
    if (pin.length < MIN_PIN) return;
    try {
      const user = await window.api.login(pin);
      if (user) {
        setError('');
        const { zadaniPin, ...korisnik } = user;
        if (zadaniPin) setZadani({ user: korisnik, pin });
        else onLogin(korisnik);
      } else odbij('Pogrešan PIN. Pokušajte ponovo.');
    } catch (err) {
      // Npr. blokada nakon previše pogrešnih pokušaja — poruka kaže koliko čekati.
      odbij(porukaGreske(err) || 'Prijava nije uspjela. Pokušajte ponovo.');
    }
  }, [pin, onLogin]);

  const odustaniOdZadanog = () => {
    setZadani(null);
    setPin('');
    window.api.logout().catch(() => { /* sesija se ionako gasi pri sljedećoj prijavi */ });
  };

  useEffect(() => {
    if (zadani) return; // dijalog za novi PIN ima svoja polja
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
      else if (e.key === 'Backspace') handleDelete();
      else if (e.key === 'Enter') handleSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pin, handleSubmit, zadani]);

  const opis = opisLicence(licenca);
  const klijent = 'licenca' in licenca ? licenca.licenca.klijent : '';
  const nazivFirme = firma || klijent;
  const spreman = pin.length >= MIN_PIN;
  const mjesta = Math.max(MIN_PIN, Math.min(MAX_PIN, pin.length + 1));

  const tipka = cn(
    'h-16 w-16 rounded-full grid place-items-center select-none transition-[background-color,transform] duration-150',
    'outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0f1c]',
    'active:scale-90 motion-reduce:active:scale-100',
  );

  return (
    <div className="h-screen flex bg-[#0a0f1c] text-slate-100">
      {/* O programu — boja i ikone kao sidebar koji se pojavi nakon prijave */}
      <aside className="relative hidden md:flex w-[44%] max-w-[560px] flex-col justify-between overflow-hidden bg-[#0f1629] px-12 py-12">
        <Globus className="pointer-events-none absolute -left-40 -bottom-48 w-[620px] text-blue-400/[0.07]" />

        <div className="relative flex items-center gap-3.5">
          <img src={appIcon} alt="" className="w-11 h-11 rounded-xl shadow-lg shadow-blue-500/20" />
          <div>
            <h1 className="text-[22px] font-bold tracking-tight leading-none">{PROGRAM.naziv}</h1>
            <p className="text-[13px] text-slate-400 mt-1">{PROGRAM.opis}</p>
          </div>
        </div>

        <div className="relative space-y-9">
          {nazivFirme && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Firma</p>
              <p className="mt-1.5 text-[26px] font-bold tracking-tight leading-tight text-white">{nazivFirme}</p>
            </div>
          )}

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Moduli</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
              {MODULI.map(({ naziv, icon: Icon, modul }) => {
                const ukljucen = !modul || moduli?.ukljuceni[modul] === true;
                const napomena = ukljucen || !modul || !moduli ? null : moduli.licencirani[modul] ? 'isključen' : 'nije u licenci';
                return (
                  <li key={naziv} className={cn('flex items-center gap-2.5 text-sm', ukljucen ? 'text-slate-200' : 'text-slate-600')}>
                    <Icon className={cn('w-4 h-4 shrink-0', ukljucen ? 'text-blue-400' : 'text-slate-600')} strokeWidth={1.75} />
                    <span>{naziv}</span>
                    {napomena && <span className="text-[11px] text-slate-600">· {napomena}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-start gap-3 border-t border-white/[0.06] pt-5">
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TON_TACKA[opis.ton])} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200">{opis.naslov}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{opis.tekst}</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-slate-600">
          Podrška: {PROGRAM.telefon} ({PROGRAM.telefonNapomena})
        </p>
      </aside>

      {/* PIN */}
      <main className="flex-1 grid place-items-center px-6">
        <div className="w-[248px] flex flex-col items-center">
          <div className="md:hidden flex flex-col items-center mb-8">
            <img src={appIcon} alt="" className="w-12 h-12 rounded-xl shadow-lg shadow-blue-500/20" />
            <p className="mt-3 text-lg font-bold tracking-tight">{PROGRAM.naziv}</p>
            {nazivFirme && <p className="text-sm text-slate-400">{nazivFirme}</p>}
          </div>

          <h2 className="text-lg font-semibold tracking-tight">Prijava</h2>
          <p role="status" aria-live="polite" className={cn('mt-1 h-5 text-sm', error ? 'text-red-400' : 'text-slate-500')}>
            {error || 'Unesite svoj PIN'}
          </p>

          <div
            className="mt-7 mb-10 flex h-3 items-center gap-3.5"
            style={shaking ? { animation: 'pin-shake 0.4s ease-in-out' } : undefined}
            aria-label={`Uneseno ${pin.length} cifara`}
          >
            {Array.from({ length: mjesta }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-3 w-3 rounded-full transition-all duration-150',
                  i < pin.length
                    ? error ? 'bg-red-400' : 'bg-blue-400'
                    : 'ring-[1.5px] ring-inset ring-slate-600',
                )}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-x-5 gap-y-4">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} onClick={() => handleDigit(d)} className={cn(tipka, 'bg-white/[0.04] hover:bg-white/[0.09] text-[26px] font-normal tabular-nums')}>
                {d}
              </button>
            ))}
            <button onClick={handleDelete} aria-label="Obriši zadnju cifru" disabled={!pin} className={cn(tipka, 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent')}>
              <Delete className="w-6 h-6" strokeWidth={1.5} />
            </button>
            <button onClick={() => handleDigit('0')} className={cn(tipka, 'bg-white/[0.04] hover:bg-white/[0.09] text-[26px] font-normal tabular-nums')}>
              0
            </button>
            <button
              onClick={handleSubmit}
              aria-label="Prijavi se"
              disabled={!spreman}
              className={cn(
                tipka,
                spreman
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/25'
                  : 'bg-white/[0.02] text-slate-600',
              )}
            >
              <ArrowRight className="w-6 h-6" strokeWidth={2} />
            </button>
          </div>
        </div>
      </main>

      <PromjenaZadanogPina
        open={zadani !== null}
        stariPin={zadani?.pin ?? ''}
        onPromijenjen={() => { if (zadani) onLogin(zadani.user); }}
        onOdustani={odustaniOdZadanog}
      />

      <style>{`
        @keyframes pin-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          50% { transform: translateX(8px); }
          75% { transform: translateX(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pin-shake { from, to { transform: none; } }
        }
      `}</style>
    </div>
  );
}
