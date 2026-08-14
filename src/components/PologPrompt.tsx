import { useState, useEffect } from 'react';
import CashMovementDialog from '@/components/CashMovementDialog';
import { localDateStr } from '@/lib/novac';

// Modul-level da preskakanje preživi odjavu/prijavu unutar iste sesije —
// prompt se ne vraća do sljedećeg dana ili ponovnog pokretanja aplikacije.
let skippedForDate: string | null = null;

/**
 * Jutarnji prompt za početni polog: otvara se nakon prijave ako danas još
 * nije unesen nijedan polog. Predlaže zadnji uneseni iznos.
 */
export default function PologPrompt({ korisnikId }: { korisnikId: number }) {
  const [open, setOpen] = useState(false);
  const [suggested, setSuggested] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (skippedForDate === localDateStr()) return;
    (async () => {
      try {
        // Postavka je podrazumijevano uključena — gasi je samo eksplicitno 'false'.
        const enabled = await window.api.getSetting('kasa.pologPrompt');
        if (enabled === 'false') return;
      } catch {
        return;
      }
      try {
        const today = await window.api.getTodayCashMovements();
        if (today.some(m => m.tip === 'polog')) return;
      } catch {
        return;
      }
      try {
        const last = await window.api.getLastPolog();
        setSuggested(last ?? undefined);
      } catch { /* prijedlog je opcionalan */ }
      setOpen(true);
    })();
  }, []);

  const close = () => {
    skippedForDate = localDateStr();
    setOpen(false);
  };

  return (
    <CashMovementDialog
      open={open}
      tip="polog"
      korisnikId={korisnikId}
      suggested={suggested}
      intro="Danas još nije unesen početni polog. Unesi iznos gotovine koju si stavio u ladicu, da se stanje kase slaže s fiskalnim printerom."
      onClose={close}
      onSaved={close}
    />
  );
}
