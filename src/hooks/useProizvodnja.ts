import { useEffect, useState } from 'react';

/** Da li je modul Proizvodnja uključen. null = još se učitava. */
export function useProizvodnja(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    window.api.getSetting('proizvodnja.enabled').then(v => setEnabled(v === 'true'));
    const onToggle = (e: Event) => setEnabled(Boolean((e as CustomEvent).detail));
    window.addEventListener('ui:proizvodnja', onToggle);
    return () => window.removeEventListener('ui:proizvodnja', onToggle);
  }, []);
  return enabled;
}
