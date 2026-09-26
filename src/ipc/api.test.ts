import { describe, expect, test } from 'bun:test';
import { napraviApi, ocistiGreske, ocistiPorukuIpc, type NaDogadjaj } from './api';
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

// Electron: handle() u main procesu baca `new Error(poruka)`, a ipcRenderer.invoke
// je umota u "Error invoking remote method '<kanal>': " + err.toString().
const electronOmot = (kanal: string, poruka: string) =>
  `Error invoking remote method '${kanal}': ${String(new Error(poruka))}`;

describe('ocistiPorukuIpc', () => {
  test('skida Electron omot — ostaje poruka backenda, kao pod Tauri-jem', () => {
    expect(ocistiPorukuIpc(electronOmot('order:finalize', 'Račun ne postoji'))).toBe('Račun ne postoji');
    expect(ocistiPorukuIpc(electronOmot('user:login', 'Pogrešan PIN: pokušajte ponovo'))).toBe('Pogrešan PIN: pokušajte ponovo');
  });

  test('omot bez "Error:" (bačen tekst) se skida', () => {
    expect(ocistiPorukuIpc("Error invoking remote method 'x:y': nešto nije u redu")).toBe('nešto nije u redu');
  });

  test('poruka bez omota ostaje ista', () => {
    for (const p of ['Račun ne postoji', 'Error: ostaje jer nije omot', '', "Kanal 'a:b' ne postoji"]) {
      expect(ocistiPorukuIpc(p)).toBe(p);
    }
  });
});

describe('ocistiGreske — omot oko pozovi (Electron preload)', () => {
  test('odbijen poziv baca Error s porukom bez Electron omota', async () => {
    const pozovi = ocistiGreske(async (kanal) => { throw new Error(electronOmot(kanal, 'Nema dovoljno na stanju')); });
    const e = await pozovi('order:finalize', {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe('Nema dovoljno na stanju');
  });

  test('uspješan poziv prolazi nepromijenjen, s istim kanalom i argumentima', async () => {
    const pozivi: unknown[][] = [];
    const pozovi = ocistiGreske(async (kanal, ...args) => { pozivi.push([kanal, ...args]); return { ok: 1 }; });
    expect(await pozovi('product:get', 5, 'a')).toEqual({ ok: 1 });
    expect(pozivi).toEqual([['product:get', 5, 'a']]);
  });

  test('api nad očišćenim pozovi: UI dobije poruku bez omota', async () => {
    const api = napraviApi(
      ocistiGreske(async (kanal) => { throw new Error(electronOmot(kanal, 'Samo administrator')); }),
      () => () => undefined,
    );
    await expect(api.deleteUser(3)).rejects.toThrow(/^Samo administrator$/);
  });
});
