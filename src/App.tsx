import { useState } from 'react';
import { User } from '@/types';
import LoginScreen from '@/screens/LoginScreen';
import AktivacijaScreen from '@/screens/AktivacijaScreen';
import MainLayout from '@/components/MainLayout';
import LicencaDialog from '@/components/licenca/LicencaDialog';
import { useLicenca } from '@/hooks/useLicenca';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const licenca = useLicenca();
  // Bez licence se i dalje može ući samo za pregled (podaci pripadaju klijentu).
  const [samoPregled, setSamoPregled] = useState(false);

  let ekran;
  if (!licenca) ekran = null;
  else if ((licenca.stanje === 'nema' || licenca.stanje === 'neispravna') && !samoPregled && !user) {
    ekran = <AktivacijaScreen info={licenca} onNastavi={() => setSamoPregled(true)} />;
  } else if (!user) ekran = <LoginScreen onLogin={setUser} />;
  else ekran = <MainLayout user={user} licenca={licenca} onLogout={() => setUser(null)} />;

  return (
    <>
      {ekran}
      <LicencaDialog info={licenca} />
    </>
  );
}
