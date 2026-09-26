// Neuspjeh štampe nije uvijek "nije odštampano": kad je zahtjev stigao do
// uređaja, a odgovor izostane (timeout, prekid veze, neparsiran odgovor),
// račun je možda odštampan. Tada odgovor nosi `ishodNepoznat: true` i
// write-ahead red se ne smije brisati. Sigurno neodštampano: veza odbijena,
// nepoznat host, zahtjev odbijen prije slanja, uređaj odgovorio greškom.
// Rust: testovi `ishod_*` u src-tauri/backend/src/tring.rs.
import { test, expect, describe, afterEach, afterAll } from 'bun:test';
import * as Tring from '@/services/tring';
import { pokreniLaziTring, pokreniPokvareniTring, slobodanPort, type Kvar } from '@/ipc/ugovor/laziTring';

const racun = (): Tring.Racun => ({
  stavke: [{ artikal: { sifra: 'A1', naziv: 'Kafa', jm: 'kom', cijena: 2.5, stopa: 'E', plu: 7 }, kolicina: 1, rabat: 0 }],
  vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 2.5 }],
});

let zaustavi: Array<() => void> = [];
afterEach(() => { for (const z of zaustavi) z(); zaustavi = []; });
// Tring klijent je modul s globalnom konfiguracijom — ne ostavljati kratak timeout drugima.
afterAll(() => { Tring.configure({}); });

describe('sigurno nije odštampano — bez oznake nepoznatog ishoda', () => {
  test('veza odbijena (uređaj ugašen)', async () => {
    Tring.configure({ host: '127.0.0.1', port: await slobodanPort() });
    const r = await Tring.stampatiFiskalniRacun(racun());
    expect(r.success).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
    expect(r.ishodNepoznat).toBeUndefined();
    expect(Tring.ishodNepoznat(r)).toBe(false);
  });

  test('nepoznat host', async () => {
    Tring.configure({ host: 'nema-ovog-uredjaja.invalid', port: 8085 });
    const r = await Tring.stampatiFiskalniRacun(racun());
    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
  });

  test('uređaj odgovorio greškom', async () => {
    const uredjaj = pokreniLaziTring();
    zaustavi.push(uredjaj.stop);
    Tring.configure({ host: 'localhost', port: uredjaj.port });
    uredjaj.greskaNa('/sfr', 'Nema papira', 12);
    const r = await Tring.stampatiFiskalniRacun(racun());
    expect(r.success).toBe(false);
    expect(r.error).toBe('Nema papira [12]');
    expect(r.ishodNepoznat).toBeUndefined();
  });

  test('zahtjev odbijen prije slanja', async () => {
    Tring.configure({ host: '127.0.0.1', port: await slobodanPort() });
    const r = await Tring.stampatiFiskalniRacun({ ...racun(), brojRacuna: -1 });
    expect(r.error).toStartWith('Zahtjev nije poslan fiskalnom uređaju');
    expect(Tring.ishodNepoznat(r)).toBe(false);
  });

  test('uspjeh nema oznaku', async () => {
    const uredjaj = pokreniLaziTring();
    zaustavi.push(uredjaj.stop);
    Tring.configure({ host: 'localhost', port: uredjaj.port });
    const r = await Tring.stampatiFiskalniRacun(racun());
    expect(r.success).toBe(true);
    expect(Tring.ishodNepoznat(r)).toBe(false);
  });

  // Uređaj na LAN-u ugašen: SYN ostaje bez odgovora (nema RST-a). Veza se ne
  // uspostavi, pa zahtjev sigurno nije poslan — ne smije otvoriti dijalog
  // nezavršenih računa. (Gdje mreža odmah javi "unreachable", ishod je isti.)
  test('veza se ne uspostavi (uređaj ugašen na mreži)', async () => {
    Tring.configure({ host: '10.255.255.1', port: 8085, connectTimeoutMs: 200, timeoutMs: 3000 });
    const pocetak = Date.now();
    const r = await Tring.stampatiFiskalniRacun(racun());
    expect(r.success).toBe(false);
    expect(r.ishodNepoznat).toBeUndefined();
    expect(Date.now() - pocetak).toBeLessThan(2000);
  });
});

describe('zahtjev je stigao, a odgovora nema — ishod nepoznat', () => {
  const slucajevi: Array<[Kvar, string]> = [
    ['prekid', 'veza prekinuta nakon slanja zahtjeva'],
    ['smece', 'odgovor koji nije odgovor uređaja'],
    ['pola', 'veza prekinuta usred odgovora'],
    ['visi', 'uređaj ne odgovara (timeout)'],
  ];
  for (const [kvar, opis] of slucajevi) {
    test(opis, async () => {
      const uredjaj = await pokreniPokvareniTring(kvar);
      zaustavi.push(uredjaj.stop);
      Tring.configure({ host: '127.0.0.1', port: uredjaj.port, timeoutMs: 300, connectTimeoutMs: 100 });

      const r = await Tring.stampatiFiskalniRacun(racun());

      expect(uredjaj.primljeno()).toBe(1);
      expect(r.success).toBe(false);
      expect(r.ishodNepoznat).toBe(true);
      expect(Tring.ishodNepoznat(r)).toBe(true);
      expect(typeof r.error).toBe('string');
      expect(r.error!.length).toBeGreaterThan(0);
    }, 5000);
  }

  test('dnevnik ima tačno jedan zapis i kad se veza prekine nakon timeouta', async () => {
    const uredjaj = await pokreniPokvareniTring('visi');
    zaustavi.push(uredjaj.stop);
    Tring.configure({ host: '127.0.0.1', port: uredjaj.port, timeoutMs: 200, connectTimeoutMs: 100 });
    Tring.setLoggingEnabled(true);
    Tring.clearLogs();
    try {
      const r = await Tring.stampatiFiskalniRacun(racun());
      await new Promise(res => setTimeout(res, 100));
      expect(r.error).toBe('Request timed out');
      expect(Tring.getLogs()).toHaveLength(1);
    } finally {
      Tring.setLoggingEnabled(false);
      Tring.clearLogs();
    }
  });
});
