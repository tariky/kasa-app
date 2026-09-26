import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo } from '@/lib/backupRaspored';

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
