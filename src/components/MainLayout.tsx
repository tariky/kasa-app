import { useState } from 'react';
import { User } from '@/types';
import {
  ShoppingCart, Package, ClipboardList, BarChart3, Settings, LogOut
} from 'lucide-react';
import appIcon from '@/assets/icon.png';
import KasaScreen from '@/screens/KasaScreen';
import SkladisteScreen from '@/screens/SkladisteScreen';
import NarudzbeScreen from '@/screens/NarudzbeScreen';
import IzvjestajiScreen from '@/screens/IzvjestajiScreen';
import PostavkeScreen from '@/screens/PostavkeScreen';

type Screen = 'kasa' | 'skladiste' | 'narudzbe' | 'izvjestaji' | 'postavke';

const NAV_ITEMS: { id: Screen; label: string; icon: typeof ShoppingCart; adminOnly?: boolean }[] = [
  { id: 'kasa', label: 'Kasa', icon: ShoppingCart },
  { id: 'skladiste', label: 'Skladište', icon: Package },
  { id: 'narudzbe', label: 'Računi', icon: ClipboardList },
  { id: 'izvjestaji', label: 'Izvještaji', icon: BarChart3 },
  { id: 'postavke', label: 'Postavke', icon: Settings, adminOnly: true },
];

interface Props {
  user: User;
  onLogout: () => void;
}

export default function MainLayout({ user, onLogout }: Props) {
  const [screen, setScreen] = useState<Screen>('kasa');

  return (
    <div className="h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 bg-[#0f1629] text-white flex flex-col no-print">
        {/* Brand */}
        <div className="p-5 pb-4">
          <div className="flex items-center gap-3">
            <img src={appIcon} alt="Pazar" className="w-9 h-9 rounded-lg shadow-sm shadow-blue-500/20" />
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">Pazar</h1>
              <p className="text-[11px] text-slate-500 mt-0.5">{user.ime}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map(item => {
            if (item.adminOnly && user.uloga !== 'admin') return null;
            const Icon = item.icon;
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                  active
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2 : 1.5} />
                {item.label}
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400" />}
              </button>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="p-3 border-t border-white/[0.06]">
          <div className="px-3 py-2 mb-2">
            <p className="text-[11px] text-slate-600 uppercase tracking-wider font-medium">Operater</p>
            <p className="text-sm text-slate-300 mt-0.5">{user.ime}</p>
            <p className="text-[11px] text-slate-500 font-mono">{user.uloga === 'admin' ? 'Administrator' : 'Kasir'}</p>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-slate-500 hover:text-red-400 hover:bg-red-500/[0.06] transition-all duration-150"
          >
            <LogOut size={16} strokeWidth={1.5} />
            Odjava
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {screen === 'kasa' && <KasaScreen user={user} />}
        {screen === 'skladiste' && <SkladisteScreen />}
        {screen === 'narudzbe' && <NarudzbeScreen korisnikId={user.id} />}
        {screen === 'izvjestaji' && <IzvjestajiScreen />}
        {screen === 'postavke' && <PostavkeScreen />}
      </main>
    </div>
  );
}
