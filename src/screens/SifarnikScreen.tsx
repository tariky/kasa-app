import { useState, useEffect, useCallback } from 'react';
import { Product, Dobavljac, Kupac } from '@/types';
import { cn } from '@/lib/utils';
import { KupciTab } from '@/components/sifarnik/KupciTab';
import { DobavljaciTab } from '@/components/sifarnik/DobavljaciTab';
import { UslugeTab } from '@/components/sifarnik/UslugeTab';
import { Users, Building2, Wrench } from 'lucide-react';

type SifarnikTab = 'kupci' | 'dobavljaci' | 'usluge';

export default function SifarnikScreen() {
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [usluge, setUsluge] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<SifarnikTab>('kupci');

  const loadKupci = useCallback(async () => {
    const data = await window.api.getKupci();
    setKupci(data);
  }, []);

  const loadDobavljaci = useCallback(async () => {
    const data = await window.api.getDobavljaci();
    setDobavljaci(data);
  }, []);

  const loadUsluge = useCallback(async () => {
    const data = await window.api.getProducts('usluga');
    setUsluge(data);
  }, []);

  useEffect(() => {
    loadKupci();
    loadDobavljaci();
    loadUsluge();
  }, [loadKupci, loadDobavljaci, loadUsluge]);

  const tabs: { id: SifarnikTab; label: string; icon: typeof Users }[] = [
    { id: 'kupci', label: 'Kupci', icon: Users },
    { id: 'dobavljaci', label: 'Dobavljači', icon: Building2 },
    { id: 'usluge', label: 'Usluge', icon: Wrench },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* Top bar with tabs */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'kupci' && <KupciTab kupci={kupci} onReload={loadKupci} />}
        {activeTab === 'dobavljaci' && <DobavljaciTab dobavljaci={dobavljaci} onReload={loadDobavljaci} />}
        {activeTab === 'usluge' && <UslugeTab usluge={usluge} onReload={loadUsluge} />}
      </div>
    </div>
  );
}
