// DIJAGNOSTIKA (privremeno): da li na Windowsu zaglavi čitanje stdout-a kad se
// sljedeći zahtjev upiše u istom tick-u u kojem je stigao spor odgovor.
import { test } from 'bun:test';
import { otvoriBackend, ADMIN_PIN } from '../src/ipc/ugovor/backend';

const pauze: Record<string, () => Promise<unknown>> = {
  bezpauze: async () => undefined,
  timeout0: () => new Promise(r => setTimeout(r, 0)),
  mikro: () => Promise.resolve(),
};

for (const [ime, pauza] of Object.entries(pauze)) {
  test(`redom ${ime}`, async () => {
    const b = await otvoriBackend();
    try {
      for (let i = 0; i < 15; i++) {
        await b.call('user:login', ADMIN_PIN);
        console.error(`[redom ${ime}] ${i}`);
        await pauza();
      }
    } finally {
      await b.close();
    }
  }, 20000);
}
