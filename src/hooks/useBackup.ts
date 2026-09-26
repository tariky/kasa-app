import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackupInfo } from '@/lib/backupRaspored';
import { prikazIzDogadjaja, prikazIzInfo, type PrikazTrake } from '@/lib/backupTraka';

/** Stanje automatskog backup-a; osvježava se kad backup završi ili padne. */
export function useBackupInfo(): { info: BackupInfo | null; osvjezi: () => void } {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const osvjezi = useCallback(() => { window.api.getBackupInfo().then(setInfo).catch(() => { /* bez prijave ili IPC-a — stanje ostaje null */ }); }, []);
  useEffect(() => {
    osvjezi();
    return window.api.onBackupStanje(d => { if (!('faza' in d)) osvjezi(); });
  }, [osvjezi]);
  return { info, osvjezi };
}

/**
 * Šta traka backup-a trenutno prikazuje: stanje pri pokretanju, pa svaki
 * `backup:stanje` događaj; prolazna stanja nestaju sama. Jedna pretplata za
 * cijeli `MainLayout` (traka gore i stavka trajne greške u sidebaru).
 */
export function useBackupPrikaz(): PrikazTrake | null {
  const [prikaz, setPrikaz] = useState<PrikazTrake | null>(null);
  const skrivanje = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    window.api.getBackupInfo().then(i => setPrikaz(p => p ?? prikazIzInfo(i, new Date()))).catch(() => { /* traka nije kritična */ });
    const odjavi = window.api.onBackupStanje(d => {
      clearTimeout(skrivanje.current);
      const p = prikazIzDogadjaja(d);
      setPrikaz(p);
      if (p.nestajeZaMs) skrivanje.current = setTimeout(() => setPrikaz(null), p.nestajeZaMs);
    });
    return () => { odjavi(); clearTimeout(skrivanje.current); };
  }, []);

  return prikaz;
}
