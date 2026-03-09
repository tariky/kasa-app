import { useState } from 'react';
import { User } from '@/types';
import LoginScreen from '@/screens/LoginScreen';
import MainLayout from '@/components/MainLayout';

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  if (!user) return <LoginScreen onLogin={setUser} />;
  return <MainLayout user={user} onLogout={() => setUser(null)} />;
}
