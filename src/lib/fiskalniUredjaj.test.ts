import { test, expect, beforeEach, afterEach, describe } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import * as Tring from '../services/tring';
import { pokreniLaziTring, type LaziTring } from '../ipc/ugovor/laziTring';
import {
  ishodIzOdgovora, procitajTringPostavke, uredjajIzFunkcija, uredjajIzPostavki,
} from './fiskalniUredjaj';

let db: TestnaBaza;
const uredjaji: LaziTring[] = [];

beforeEach(() => {
  db = testnaBaza();
});

afterEach(() => {
  for (const u of uredjaji.splice(0)) u.stop();
  Tring.setLoggingEnabled(false);
  Tring.clearLogs();
});

function postavka(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function laziUredjaj(): LaziTring {
  const u = pokreniLaziTring();
  uredjaji.push(u);
  return u;
}

const racun: Tring.Racun = {
  stavke: [{ artikal: { sifra: 'A1', naziv: 'Artikal', jm: 'kom', cijena: 5, stopa: 'E', plu: 1 }, kolicina: 1, rabat: 0 }],
  vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 5 }],
};

describe('ishodIzOdgovora', () => {
  test('uspjeh nosi broj sa uređaja; prazan broj je null', () => {
    expect(ishodIzOdgovora({ success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: '17' } }))
      .toEqual({ ok: true, bf: '17', odgovori: { BrojFiskalnogRacuna: '17' } });
    expect(ishodIzOdgovora({ success: true, vrstaOdgovora: 'OK', odgovori: { BrojFiskalnogRacuna: '' } }))
      .toEqual({ ok: true, bf: null, odgovori: { BrojFiskalnogRacuna: '' } });
  });

  test('greška: poruka uređaja, pa vrsta odgovora, pa "Nepoznata greška"', () => {
    expect(ishodIzOdgovora({ success: false, vrstaOdgovora: 'Greska', odgovori: {}, error: 'Nema papira [12]' }))
      .toEqual({ ok: false, greska: 'Nema papira [12]', nepoznat: false, odgovori: {} });
    expect(ishodIzOdgovora({ success: false, vrstaOdgovora: 'Greska', odgovori: { Poruka: 'x' } }))
      .toEqual({ ok: false, greska: 'Greska', nepoznat: false, odgovori: { Poruka: 'x' } });
    expect(ishodIzOdgovora(null)).toEqual({ ok: false, greska: 'Nepoznata greška', nepoznat: false });
  });

  test('nepoznat ishod samo uz oznaku klijenta', () => {
    const r = ishodIzOdgovora({ success: false, vrstaOdgovora: 'Greska', odgovori: {}, error: 'Request timed out', ishodNepoznat: true });
    expect(r).toEqual({ ok: false, greska: 'Request timed out', nepoznat: true, odgovori: {} });
  });
});

describe('procitajTringPostavke', () => {
  test('zadane vrijednosti bez postavki', () => {
    expect(procitajTringPostavke(db)).toEqual({
      host: 'localhost', port: 8085, operatorId: 0, operatorPassword: null, logovanje: false,
    });
  });

  test('čita tring.* i dev.logging', () => {
    postavka('tring.host', '10.0.0.5');
    postavka('tring.port', '9001');
    postavka('tring.operatorId', '3');
    postavka('tring.operatorPassword', 'tajna');
    postavka('dev.logging', 'true');
    expect(procitajTringPostavke(db)).toEqual({
      host: '10.0.0.5', port: 9001, operatorId: 3, operatorPassword: 'tajna', logovanje: true,
    });
  });
});

describe('uredjajIzPostavki', () => {
  test('postavke se čitaju kad se uređaj napravi: novi uređaj vidi novu adresu', async () => {
    const prvi = laziUredjaj();
    const drugi = laziUredjaj();

    postavka('tring.port', String(prvi.port));
    const uredjaj = uredjajIzPostavki(db);
    postavka('tring.port', String(drugi.port));
    expect(await uredjaj.stampajRacun(racun)).toMatchObject({ ok: true, bf: '101' });
    expect(await uredjajIzPostavki(db).unosNovca(10)).toMatchObject({ ok: true });

    expect(prvi.zahtjevi.map(z => z.putanja)).toEqual(['/sfr']);
    expect(drugi.zahtjevi.map(z => z.putanja)).toEqual(['/unosnovca']);
  });

  test('nečitljive postavke bacaju odmah, prije ikakve komande', () => {
    db.exec('DROP TABLE settings');
    expect(() => uredjajIzPostavki(db)).toThrow('no such table: settings');
  });

  test('klijent se podesi prije svake komande (drugi uređaj ga je u međuvremenu prepodesio)', async () => {
    const prvi = laziUredjaj();
    const drugi = laziUredjaj();
    postavka('tring.port', String(prvi.port));
    const uredjaj = uredjajIzPostavki(db);
    postavka('tring.port', String(drugi.port));
    await uredjajIzPostavki(db).presjekStanja();
    await uredjaj.dnevniIzvjestaj();

    expect(prvi.zahtjevi.map(z => z.putanja)).toEqual(['/sdi']);
    expect(drugi.zahtjevi.map(z => z.putanja)).toEqual(['/sps']);
  });

  test('prijava operatera šalje operatora i lozinku iz postavki (bez lozinke: "0")', async () => {
    const u = laziUredjaj();
    postavka('tring.port', String(u.port));
    postavka('tring.operatorId', '7');

    expect(await uredjajIzPostavki(db).inicijalizacija()).toMatchObject({ success: true, vrstaOdgovora: 'OK' });
    postavka('tring.operatorPassword', 'tajna');
    await uredjajIzPostavki(db).inicijalizacija();

    const lozinke = u.zahtjevi.map(z => /<Lozinka>(.*)<\/Lozinka>/.exec(z.tijelo)?.[1]);
    expect(lozinke).toEqual(['0', 'tajna']);
    expect(u.zahtjevi.every(z => z.tijelo.includes('<BrojOperatora>7</BrojOperatora>'))).toBe(true);
  });

  test('greška uređaja je ishod, izvještaj vraća odgovor uređaja kakav jeste', async () => {
    const u = laziUredjaj();
    postavka('tring.port', String(u.port));
    const uredjaj = uredjajIzPostavki(db);

    u.greskaNa('/sfr', 'Nema papira', 12);
    expect(await uredjaj.stampajRacun(racun)).toEqual({ ok: false, greska: 'Nema papira [12]', nepoznat: false, odgovori: {} });
    u.greskaNa('/sps', 'Zauzet');
    const x = await uredjaj.presjekStanja();
    expect(x).toMatchObject({ success: false, vrstaOdgovora: 'Greska' });
    expect(await uredjaj.dnevniIzvjestaj()).toMatchObject({ success: true });
    expect(await uredjaj.periodicniIzvjestaj('2026-01-01', '2026-01-31')).toMatchObject({ success: true });
    expect(u.zahtjevi.map(z => z.putanja)).toEqual(['/sfr', '/sps', '/sdi', '/spi']);
  });

  test('dnevnik (dev.logging) vodi klijent: zapis i ispis u konzolu samo kad je uključen', async () => {
    const u = laziUredjaj();
    postavka('tring.port', String(u.port));
    const ispis: unknown[][] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => { ispis.push(a); };
    try {
      await uredjajIzPostavki(db).stampajRacun(racun);
      expect(Tring.getLogs()).toEqual([]);
      expect(ispis).toEqual([]);

      postavka('dev.logging', 'true');
      await uredjajIzPostavki(db).stampajRacun(racun);
    } finally {
      console.log = log;
    }
    expect(Tring.getLogs().map(l => l.path)).toEqual(['/sfr']);
    expect(ispis).toHaveLength(1);
    expect(ispis[0].join(' ')).toContain('/sfr');
    expect(ispis[0].join(' ')).toContain('<RacunZahtjev');
  });
});

describe('uredjajIzFunkcija', () => {
  test('komanda koje nema se odbija', async () => {
    const uredjaj = uredjajIzFunkcija({ stampatiFiskalniRacun: async () => null });
    expect(await uredjaj.stampajRacun(racun)).toEqual({ ok: false, greska: 'Nepoznata greška', nepoznat: false });
    await expect(uredjaj.unosNovca(5)).rejects.toThrow('Fiskalni uređaj ne podržava komandu unosNovca');
  });
});
