import { useState } from 'react';
import { User } from '@/types';
import LoginScreen from '@/screens/LoginScreen';
import AktivacijaScreen from '@/screens/AktivacijaScreen';
import MainLayout from '@/components/MainLayout';
import LicencaDialog from '@/components/licenca/LicencaDialog';
import { OProgramuDialog } from '@/components/OProgramu';
import { useLicenca } from '@/hooks/useLicenca';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const licenca = useLicenca();
  // Bez licence se i dalje može ući samo za pregled (podaci pripadaju klijentu).
  const [samoPregled, setSamoPregled] = useState(false);

  // Sesija živi u main procesu — odjava je briše i tamo, ne samo u Reactu.
  const odjavi = () => {
    setUser(null);
    window.api.logout().catch(() => { /* sljedeća prijava ionako zamijeni sesiju */ });
  };

  let ekran;
  if (!licenca) ekran = null;
  else if ((licenca.stanje === 'nema' || licenca.stanje === 'neispravna') && !samoPregled && !user) {
    ekran = <AktivacijaScreen info={licenca} onNastavi={() => setSamoPregled(true)} />;
  } else if (!user) ekran = <LoginScreen licenca={licenca} onLogin={setUser} />;
  else ekran = <MainLayout user={user} licenca={licenca} onLogout={odjavi} />;

  return (
    <>
      {ekran}
      <LicencaDialog info={licenca} />
      <OProgramuDialog />
    </>
  );
}
