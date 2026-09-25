import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { izdajLicencu } from './licenca';
import { izracunajStanje, efektivniDanas, najnovijiDatumIzBaze, najnovijiDatumIzBazeJednom, smijeRaditi, razlikaDana, opisLicence, brojDana, razlogBlokade, kanalPodLicencom, type StanjeLicence } from './licencaStanje';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const token = izdajLicencu({ klijent: 'Pekara', vrijediDo: '2026-10-31', izdana: '2026-10-01' }, privateKey);
const stanje = (danas: string, t: string | null = token, uredjaj = 'A') =>
  izracunajStanje(t, publicKey, { danas, uredjaj });

test('bez tokena nema licence i ne smije raditi', () => {
  expect(stanje('2026-10-10', null)).toEqual({ stanje: 'nema' });
  expect(stanje('2026-10-10', '  ')).toEqual({ stanje: 'nema' });
  expect(smijeRaditi({ stanje: 'nema' })).toBe(false);
});

test('više od 7 dana do isteka je aktivna', () => {
  expect(stanje('2026-10-23')).toMatchObject({ stanje: 'aktivna', danaDoIsteka: 8 });
});

test('7 dana i manje do isteka je upozorenje, zadnji dan je 0', () => {
  expect(stanje('2026-10-24')).toMatchObject({ stanje: 'upozorenje', danaDoIsteka: 7 });
  expect(stanje('2026-10-31')).toMatchObject({ stanje: 'upozorenje', danaDoIsteka: 0 });
});

test('15 dana nakon isteka radi u periodu milosti, 16. dan je zaključana', () => {
  expect(stanje('2026-11-01')).toMatchObject({ stanje: 'milost', danaDoBlokade: 14 });
  const zadnji = stanje('2026-11-15');
  expect(zadnji).toMatchObject({ stanje: 'milost', danaDoBlokade: 0 });
  expect(smijeRaditi(zadnji)).toBe(true);
  const zakljucana = stanje('2026-11-16');
  expect(zakljucana.stanje).toBe('zakljucana');
  expect(smijeRaditi(zakljucana)).toBe(false);
});

test('lažan token ili tuđi uređaj je neispravna licenca', () => {
  const tudji = izdajLicencu({ klijent: 'X', vrijediDo: '2026-12-31', izdana: '2026-10-01' }, generateKeyPairSync('ed25519').privateKey);
  expect(stanje('2026-10-10', tudji)).toEqual({ stanje: 'neispravna', razlog: 'potpis' });
  const vezana = izdajLicencu({ klijent: 'X', vrijediDo: '2026-12-31', izdana: '2026-10-01', uredjaj: 'A' }, privateKey);
  expect(stanje('2026-10-10', vezana, 'A').stanje).toBe('aktivna');
  expect(stanje('2026-10-10', vezana, 'B')).toEqual({ stanje: 'neispravna', razlog: 'uredjaj' });
});

test('vraćen sat ne vraća datum unazad', () => {
  expect(efektivniDanas('2026-10-01', '2026-11-20')).toBe('2026-11-20');
  expect(efektivniDanas('2026-11-21', '2026-11-20')).toBe('2026-11-21');
  expect(efektivniDanas('2026-11-21', null)).toBe('2026-11-21');
});

test('efektivni datum je najveći od sistemskog, zadnjeg viđenog i datuma iz baze', () => {
  // Obrisan zadnjiDatum iz licenca.json: baza i dalje pamti najnoviji račun.
  expect(efektivniDanas('2026-10-01', undefined, '2026-11-20')).toBe('2026-11-20');
  expect(efektivniDanas('2026-10-01', '2026-11-25', '2026-11-20')).toBe('2026-11-25');
  expect(efektivniDanas('2026-12-01', '2026-11-25', '2026-11-20')).toBe('2026-12-01');
  expect(efektivniDanas('2026-12-01', null, null)).toBe('2026-12-01');
  // Smeće (ručno izmijenjen fajl) se ignoriše umjesto da zaključa ili otključa.
  expect(efektivniDanas('2026-12-01', 'zzzz', '9999')).toBe('2026-12-01');
  expect(efektivniDanas('2026-12-01', 42 as never, ['2027-01-01'] as never)).toBe('2026-12-01');
});

function baza() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, isManual INTEGER NOT NULL DEFAULT 0, createdAt TEXT);
           CREATE TABLE cash_movements (id INTEGER PRIMARY KEY, createdAt TEXT);`);
  return db;
}

test('najnoviji datum iz baze: računi (bez ručno unesenih) i polozi/povrati', () => {
  const db = baza();
  expect(najnovijiDatumIzBaze(db)).toBeNull();
  db.exec("INSERT INTO orders (createdAt) VALUES ('2026-11-02 08:00:00'), ('2026-11-20 23:59:59'), ('2026-11-03 10:00:00')");
  expect(najnovijiDatumIzBaze(db)).toBe('2026-11-20');
  db.exec("INSERT INTO cash_movements (createdAt) VALUES ('2026-11-21 07:00:00')");
  expect(najnovijiDatumIzBaze(db)).toBe('2026-11-21');
  // Ručni račun nosi datum koji je korisnik upisao — greška u kucanju ne smije zaključati licencu.
  db.exec("INSERT INTO orders (isManual, createdAt) VALUES (1, '2099-01-01 00:00:00')");
  expect(najnovijiDatumIzBaze(db)).toBe('2026-11-21');
  // Datum koji nije YYYY-MM-DD se ignoriše.
  db.exec("INSERT INTO cash_movements (createdAt) VALUES ('smeće')");
  expect(najnovijiDatumIzBaze(db)).toBe('2026-11-21');
});

test('najnoviji datum iz baze: nedostupna baza nije greška', () => {
  expect(najnovijiDatumIzBaze(new Database(':memory:'))).toBeNull();
  const zatvorena = baza();
  zatvorena.close();
  expect(najnovijiDatumIzBaze(zatvorena)).toBeNull();
});

test('najnoviji datum iz baze se čita jednom po konekciji', () => {
  const db = baza();
  db.exec("INSERT INTO orders (createdAt) VALUES ('2026-11-20 10:00:00')");
  let upita = 0;
  const brojac = { prepare: (sql: string) => { upita++; return db.prepare(sql); } };
  expect(najnovijiDatumIzBazeJednom(brojac)).toBe('2026-11-20');
  db.exec("INSERT INTO orders (createdAt) VALUES ('2026-11-25 10:00:00')");
  expect(najnovijiDatumIzBazeJednom(brojac)).toBe('2026-11-20');
  expect(najnovijiDatumIzBazeJednom(brojac)).toBe('2026-11-20');
  expect(upita).toBe(1);

  // Nova konekcija (closeDb → getDb, restore) čita ponovo.
  const nova = { prepare: (sql: string) => { upita++; return db.prepare(sql); } };
  expect(najnovijiDatumIzBazeJednom(nova)).toBe('2026-11-25');
  expect(upita).toBe(2);

  // Prazna baza se pamti; neuspjelo čitanje ne.
  const prazna = { prepare: (sql: string) => { upita++; return baza().prepare(sql); } };
  expect(najnovijiDatumIzBazeJednom(prazna)).toBeNull();
  expect(najnovijiDatumIzBazeJednom(prazna)).toBeNull();
  expect(upita).toBe(3);
  const zatvorena = baza();
  zatvorena.close();
  const nedostupna = { prepare: (sql: string) => { upita++; return zatvorena.prepare(sql); } };
  expect(najnovijiDatumIzBazeJednom(nedostupna)).toBeNull();
  expect(najnovijiDatumIzBazeJednom(nedostupna)).toBeNull();
  expect(upita).toBe(5);
});

test('razlika dana preko promjene ljetnog računanja vremena', () => {
  expect(razlikaDana('2026-10-24', '2026-10-26')).toBe(2);
  expect(razlikaDana('2026-03-28', '2026-03-30')).toBe(2);
});

test('opis stanja za prikaz', () => {
  expect(opisLicence(stanje('2026-10-28')).naslov).toBe('Licenca ističe za 3 dana');
  expect(opisLicence(stanje('2026-10-30')).naslov).toBe('Licenca ističe za 1 dan');
  expect(opisLicence(stanje('2026-10-31')).naslov).toBe('Licenca ističe danas');
  expect(opisLicence(stanje('2026-11-01')).tekst).toBe('Program radi još 14 dana, nakon toga samo za pregled.');
  expect(opisLicence(stanje('2026-11-15')).tekst).toContain('Danas je zadnji dan');
  expect(opisLicence(stanje('2026-11-16')).tekst).toContain('Istekla 31.10.2026.');
  expect(brojDana(21)).toBe('21 dan');
  expect(brojDana(11)).toBe('11 dana');
});

test('razlog blokade: istekla licenca ima prednost nad modulom', () => {
  const lic = { klijent: 'F', vrijediDo: '2026-01-01', izdana: '2025-01-01', moduli: [] as never[] };
  expect(razlogBlokade({ stanje: 'zakljucana', licenca: lic }, 'ponuda:create')?.razlog).toBe('istekla');
  expect(razlogBlokade({ stanje: 'aktivna', licenca: lic, danaDoIsteka: 9 }, 'ponuda:create'))
    .toEqual({ razlog: 'modul', poruka: 'Modul Ponude nije uključen u licencu.' });
  expect(razlogBlokade({ stanje: 'aktivna', licenca: lic, danaDoIsteka: 9 }, 'order:create')).toBeNull();
  expect(razlogBlokade({ stanje: 'zakljucana', licenca: lic }, 'product:getAll')).toBeNull();
});

test('kanali samo modula: bez važeće licence nisu "sve licencirano"', () => {
  const samoModul = ['primka:delete', 'ponuda:delete', 'ponuda:setStatus', 'nalog:delete', 'normativ:save', 'proizvodnja:setEnabled'];
  const stari = { klijent: 'F', vrijediDo: '2026-01-01', izdana: '2025-01-01' };
  const bezPrava = [
    { stanje: 'nema' },
    { stanje: 'neispravna', razlog: 'potpis' },
    { stanje: 'neispravna', razlog: 'uredjaj' },
    // Stari token bez liste modula, istekao: samo pregled.
    { stanje: 'zakljucana', licenca: stari },
  ] as const;
  for (const s of bezPrava) {
    for (const kanal of samoModul) expect(razlogBlokade(s, kanal)?.razlog).toBe('istekla');
    // Čitanje ostaje u "samo pregled" modu.
    for (const kanal of ['ponuda:getAll', 'nalog:getAll', 'primka:getAll', 'normativ:get', 'product:getAll']) {
      expect(razlogBlokade(s, kanal)).toBeNull();
    }
  }
  // Važeća licenca bez liste (stari token) i dalje daje sve module.
  for (const kanal of samoModul) expect(razlogBlokade({ stanje: 'milost', licenca: stari, danaDoBlokade: 3 }, kanal)).toBeNull();
  // Važeća licenca s listom blokira modul koji nema.
  const bezPonuda: StanjeLicence = { stanje: 'aktivna', licenca: { ...stari, moduli: ['proizvodnja'] }, danaDoIsteka: 9 };
  expect(razlogBlokade(bezPonuda, 'ponuda:delete')).toEqual({ razlog: 'modul', poruka: 'Modul Ponude nije uključen u licencu.' });
  expect(razlogBlokade(bezPonuda, 'normativ:save')).toBeNull();
});

test('kanalPodLicencom: pisanje dokumenata i kanali modula, ne čitanje', () => {
  expect(kanalPodLicencom('order:create')).toBe(true);
  expect(kanalPodLicencom('normativ:save')).toBe(true);
  expect(kanalPodLicencom('primka:delete')).toBe(true);
  expect(kanalPodLicencom('product:getAll')).toBe(false);
  expect(kanalPodLicencom('toString')).toBe(false);
});
