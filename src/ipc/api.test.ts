import { describe, expect, test } from 'bun:test';
import { napraviApi, type NaDogadjaj } from './api';
import type { BackupDogadjaj } from '../lib/backupRaspored';

// Lažni backend: bilježi pozive i pretplate, pa test može "poslati" događaj.
function lazniBackend() {
  const pozivi: { kanal: string; args: unknown[] }[] = [];
  const slusaoci = new Map<string, Set<(p: unknown) => void>>();
  const naDogadjaj: NaDogadjaj = (ime, cb) => {
    if (!slusaoci.has(ime)) slusaoci.set(ime, new Set());
    slusaoci.get(ime)!.add(cb);
    return () => { slusaoci.get(ime)!.delete(cb); };
  };
  const posalji = (ime: string, podaci?: unknown) => slusaoci.get(ime)?.forEach(cb => cb(podaci));
  const api = napraviApi(async (kanal, ...args) => { pozivi.push({ kanal, args }); return null; }, naDogadjaj);
  return { api, pozivi, slusaoci, posalji };
}

describe('napraviApi — događaji', () => {
  test('onLicencaBlokirano: pretplata na licenca:blokirano, callback bez argumenata, odjava', () => {
    const { api, posalji, slusaoci } = lazniBackend();
    const primljeno: unknown[][] = [];
    const odjavi = api.onLicencaBlokirano((...a: unknown[]) => { primljeno.push(a); });
    posalji('licenca:blokirano', { nesto: 1 });
    posalji('backup:stanje', { faza: 'slanje' });
    expect(primljeno).toEqual([[]]);
    odjavi();
    expect(slusaoci.get('licenca:blokirano')!.size).toBe(0);
    posalji('licenca:blokirano');
    expect(primljeno).toHaveLength(1);
  });

  test('onBackupStanje: pretplata na backup:stanje, podaci prolaze nepromijenjeni, odjava', () => {
    const { api, posalji, slusaoci } = lazniBackend();
    const primljeno: BackupDogadjaj[] = [];
    const odjavi = api.onBackupStanje(d => { primljeno.push(d); });
    const d: BackupDogadjaj = { faza: 'slanje', procenat: 40 };
    posalji('backup:stanje', d);
    posalji('licenca:blokirano');
    expect(primljeno).toHaveLength(1);
    expect(primljeno[0]).toBe(d);
    odjavi();
    expect(slusaoci.get('backup:stanje')!.size).toBe(0);
  });

  test('getBackupInfo i backupSada idu na backup:info / backup:sada bez argumenata', async () => {
    const { api, pozivi } = lazniBackend();
    await api.getBackupInfo();
    await api.backupSada();
    expect(pozivi).toEqual([{ kanal: 'backup:info', args: [] }, { kanal: 'backup:sada', args: [] }]);
  });
});
