// Ugovor za kanale user:*, settings:*, savedCarts:*, fakturaSkice:* i proizvodnja:setEnabled — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, prijavi, ADMIN_PIN, type Backend } from './backend';
import { hesirajPin, provjeriPin } from '../../lib/korisnici';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // seedovani admin; harness mu postavi ADMIN_PIN i prijavi se

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function redovi(sql: string, ...params: any[]): any[] {
  return b.db.prepare(sql).all(...params);
}

function postavka(key: string): string | null {
  return red('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

function dodajKorisnika(ime: string, pin: string, uloga: 'admin' | 'kasir' = 'kasir'): number {
  const r = b.db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, hesirajPin(pin), uloga);
  return Number(r.lastInsertRowid);
}

/** Korisnik iz baze s PIN-om zamijenjenim oznakom da li heš odgovara `pin`. */
function korisnikSaPinom(id: number, pin: string) {
  const r = red('SELECT ime, pin, uloga FROM users WHERE id = ?', id);
  return { ime: r.ime, uloga: r.uloga, pinOdgovara: provjeriPin(pin, r.pin) };
}

function dodajRacun(korisnikId: number): number {
  const r = b.db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status) VALUES (?, 10, 0, 'Gotovina', 'completed')"
  ).run(korisnikId);
  return Number(r.lastInsertRowid);
}

function dodajArtikal(sifra: string, opts: { tip?: string } = {}): number {
  const r = b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu, tip) VALUES (?, ?, 'kom', 5, 'E', 1, ?)"
  ).run(sifra, `Artikal ${sifra}`, opts.tip ?? 'artikal');
  return Number(r.lastInsertRowid);
}

function firma(extra: Record<string, unknown> = {}) {
  return {
    naziv: 'Stolarija d.o.o.', adresa: 'Titova 1', grad: 'Sarajevo',
    idBroj: '4200000000001', pdvBroj: '200000000001', skladiste: 'Glavno', logo: 'data:image/png;base64,AAA',
    ...extra,
  };
}

// ─── user:login ─────────────────────────────────────────────

describe('user:login', () => {
  test('vraća korisnika za tačan PIN — bez PIN-a, uz oznaku zadanog PIN-a', async () => {
    expect(await b.call('user:login', ADMIN_PIN)).toEqual({ id: ADMIN, ime: 'Admin', uloga: 'admin', zadaniPin: false });
    const k = dodajKorisnika('Kasir Ana', '1234');
    expect(await b.call('user:login', '1234')).toEqual({ id: k, ime: 'Kasir Ana', uloga: 'kasir', zadaniPin: false });
  });

  test('pogrešan PIN vraća null, bez greške', async () => {
    expect(await b.call('user:login', '9999')).toBeNull();
    expect(await b.call('user:login', '')).toBeNull();
  });
});

// ─── user:getAll ────────────────────────────────────────────

describe('user:getAll', () => {
  test('vraća id, ime i ulogu (nikad PIN ni heš), sortirano po imenu', async () => {
    dodajKorisnika('Zlatan', '2222');
    const berina = dodajKorisnika('Berina', '1111', 'admin');
    const svi = await b.call('user:getAll');
    expect(svi.map((u: any) => u.ime)).toEqual(['Admin', 'Berina', 'Zlatan']);
    expect(svi[0]).toEqual({ id: ADMIN, ime: 'Admin', uloga: 'admin' });
    expect(svi[1]).toEqual({ id: berina, ime: 'Berina', uloga: 'admin' });
    for (const u of svi) expect(Object.keys(u).sort()).toEqual(['id', 'ime', 'uloga']);
  });
});

// ─── user:create ────────────────────────────────────────────

describe('user:create', () => {
  test('upisuje korisnika s trimovanim imenom i vraća id', async () => {
    const r = await b.call('user:create', { ime: '  Ana  ', pin: '1234', uloga: 'kasir' });
    expect(Object.keys(r)).toEqual(['id']);
    expect(typeof r.id).toBe('number');
    expect(korisnikSaPinom(r.id, '1234')).toEqual({ ime: 'Ana', uloga: 'kasir', pinOdgovara: true });
    expect(red('SELECT pin FROM users WHERE id = ?', r.id).pin).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  });

  test('validira ime i PIN', async () => {
    await expect(b.call('user:create', { ime: '  ', pin: '1234', uloga: 'kasir' })).rejects.toThrow('Ime korisnika je obavezno');
    await expect(b.call('user:create', { pin: '1234', uloga: 'kasir' })).rejects.toThrow('Ime korisnika je obavezno');
    await expect(b.call('user:create', { ime: 'Ana', pin: '   ', uloga: 'kasir' })).rejects.toThrow('PIN je obavezan');
    await expect(b.call('user:create', { ime: 'Ana', uloga: 'kasir' })).rejects.toThrow('PIN je obavezan');
    await expect(b.call('user:create', { ime: 'Ana', pin: '123', uloga: 'kasir' })).rejects.toThrow('PIN mora imati najmanje 4 cifre');
    expect(red('SELECT COUNT(*) AS n FROM users').n).toBe(1);
  });

  test('odbija PIN koji već postoji', async () => {
    await expect(b.call('user:create', { ime: 'Ana', pin: ADMIN_PIN, uloga: 'kasir' }))
      .rejects.toThrow(`Korisnik sa PIN-om "${ADMIN_PIN}" već postoji`);
    expect(red('SELECT COUNT(*) AS n FROM users').n).toBe(1);
  });

  test('nepoznata ili izostavljena uloga daje jasnu poruku, ne SQLite CHECK', async () => {
    await expect(b.call('user:create', { ime: 'Ana', pin: '1234', uloga: 'menadzer' }))
      .rejects.toThrow('Uloga mora biti "admin" ili "kasir"');
    await expect(b.call('user:create', { ime: 'Ana', pin: '1234' }))
      .rejects.toThrow('Uloga mora biti "admin" ili "kasir"');
    expect(red('SELECT COUNT(*) AS n FROM users').n).toBe(1);
  });

  test('PIN smije sadržavati samo cifre', async () => {
    for (const pin of ['12 4', 'abcd', '12345a', ' 1234', '12.34']) {
      await expect(b.call('user:create', { ime: 'Ana', pin, uloga: 'kasir' }))
        .rejects.toThrow('PIN smije sadržavati samo cifre');
    }
    expect(red('SELECT COUNT(*) AS n FROM users').n).toBe(1);
  });
});

// ─── user:update ────────────────────────────────────────────

describe('user:update', () => {
  test('mijenja samo proslijeđena polja i vraća broj izmjena', async () => {
    const k = dodajKorisnika('Ana', '1234');
    expect(await b.call('user:update', k, { ime: '  Ana B.  ' })).toEqual({ changes: 1 });
    expect(korisnikSaPinom(k, '1234')).toEqual({ ime: 'Ana B.', uloga: 'kasir', pinOdgovara: true });

    expect(await b.call('user:update', k, { pin: '5678', uloga: 'admin' })).toEqual({ changes: 1 });
    expect(korisnikSaPinom(k, '5678')).toEqual({ ime: 'Ana B.', uloga: 'admin', pinOdgovara: true });
  });

  test('prazan ili izostavljen PIN ostavlja stari PIN', async () => {
    const k = dodajKorisnika('Ana', '1234');
    const hes = red('SELECT pin FROM users WHERE id = ?', k).pin;
    expect(await b.call('user:update', k, { ime: 'Ana', pin: '', uloga: 'kasir' })).toEqual({ changes: 1 });
    expect(await b.call('user:update', k, { ime: 'Ana', pin: null })).toEqual({ changes: 1 });
    expect(await b.call('user:update', k, { pin: '' })).toEqual({ changes: 0 });
    expect(red('SELECT pin FROM users WHERE id = ?', k).pin).toBe(hes);
  });

  test('prazan objekat ne dira bazu', async () => {
    expect(await b.call('user:update', ADMIN, {})).toEqual({ changes: 0 });
  });

  test('nepostojeći korisnik daje changes 0, bez greške', async () => {
    expect(await b.call('user:update', 999, { ime: 'Niko' })).toEqual({ changes: 0 });
  });

  test('korisnik može zadržati svoj PIN', async () => {
    expect(await b.call('user:update', ADMIN, { pin: ADMIN_PIN })).toEqual({ changes: 1 });
  });

  test('validira ime, dužinu PIN-a i jedinstvenost PIN-a', async () => {
    const k = dodajKorisnika('Ana', '1234');
    await expect(b.call('user:update', k, { ime: ' ' })).rejects.toThrow('Ime korisnika je obavezno');
    await expect(b.call('user:update', k, { pin: '12' })).rejects.toThrow('PIN mora imati najmanje 4 cifre');
    await expect(b.call('user:update', k, { pin: ADMIN_PIN })).rejects.toThrow(`Korisnik sa PIN-om "${ADMIN_PIN}" već postoji`);
    // Greška u jednom polju poništava i ostala.
    await expect(b.call('user:update', k, { ime: 'Novo', pin: '1' })).rejects.toThrow('PIN mora imati najmanje 4 cifre');
    expect(korisnikSaPinom(k, '1234')).toEqual({ ime: 'Ana', uloga: 'kasir', pinOdgovara: true });
  });

  test('PIN i uloga se validiraju isto kao pri kreiranju', async () => {
    const k = dodajKorisnika('Ana', '1234');
    await expect(b.call('user:update', k, { pin: '    ' })).rejects.toThrow('PIN je obavezan');
    await expect(b.call('user:update', k, { pin: '12 4' })).rejects.toThrow('PIN smije sadržavati samo cifre');
    await expect(b.call('user:update', k, { pin: 'abcd' })).rejects.toThrow('PIN smije sadržavati samo cifre');
    await expect(b.call('user:update', k, { uloga: 'menadzer' })).rejects.toThrow('Uloga mora biti "admin" ili "kasir"');
    expect(korisnikSaPinom(k, '1234')).toEqual({ ime: 'Ana', uloga: 'kasir', pinOdgovara: true });
  });

  test('posljednji admin ne može postati kasir', async () => {
    await expect(b.call('user:update', ADMIN, { uloga: 'kasir' }))
      .rejects.toThrow('Posljednji administrator ne može postati kasir');
    expect(red('SELECT uloga FROM users WHERE id = ?', ADMIN).uloga).toBe('admin');
    // Admin koji zadržava ulogu (UI uvijek šalje ulogu) prolazi.
    expect(await b.call('user:update', ADMIN, { ime: 'Admin', uloga: 'admin' })).toEqual({ changes: 1 });
    expect(await b.call('user:login', ADMIN_PIN)).toMatchObject({ id: ADMIN, uloga: 'admin' });
  });

  test('admin može postati kasir kad postoji drugi admin', async () => {
    const drugi = dodajKorisnika('Berina', '1111', 'admin');
    expect(await b.call('user:update', ADMIN, { uloga: 'kasir' })).toEqual({ changes: 1 });
    // Uloga se čita iz baze pri svakom pozivu: degradirani admin odmah gubi pravo.
    await expect(b.call('user:update', drugi, { uloga: 'kasir' })).rejects.toThrow('Ovu radnju može izvršiti samo administrator');
    await prijavi(b, '1111');
    await expect(b.call('user:update', drugi, { uloga: 'kasir' }))
      .rejects.toThrow('Posljednji administrator ne može postati kasir');
  });
});

// ─── user:delete ────────────────────────────────────────────

describe('user:delete', () => {
  test('briše korisnika bez računa', async () => {
    const k = dodajKorisnika('Ana', '1234');
    expect(await b.call('user:delete', k)).toEqual({ changes: 1 });
    expect(red('SELECT COUNT(*) AS n FROM users WHERE id = ?', k).n).toBe(0);
  });

  test('nepostojeći korisnik daje changes 0', async () => {
    expect(await b.call('user:delete', 999)).toEqual({ changes: 0 });
  });

  test('odbija korisnika koji ima račune', async () => {
    const k = dodajKorisnika('Ana', '1234');
    dodajRacun(k);
    await expect(b.call('user:delete', k)).rejects.toThrow('Korisnik ima račune i ne može biti obrisan');
    expect(red('SELECT COUNT(*) AS n FROM users WHERE id = ?', k).n).toBe(1);
  });

  test('odbija korisnika s pologom/povratom, ponudom, radnim nalogom ili računom u obradi', async () => {
    const kupac = Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('Kupac', '4200000000002')").run().lastInsertRowid);
    const slucajevi: [string, (k: number) => void][] = [
      ['Korisnik ima pologe/povrate gotovine i ne može biti obrisan', (k) => b.db.prepare(
        "INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus) VALUES ('polog', 50, ?, 'ok')").run(k)],
      ['Korisnik ima ponude i ne može biti obrisan', (k) => b.db.prepare(
        "INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos) VALUES (?, 2026, ?, ?, '2026-01-01', '2026-01-31', 10, 0)").run(k, kupac, k)],
      ['Korisnik ima radne naloge i ne može biti obrisan', (k) => b.db.prepare(
        "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, opis, korisnikId) VALUES (?, 2026, '2026-01-01', 'zaliha', 'Ormar', ?)").run(k, k)],
      ['Korisnik ima račun u obradi i ne može biti obrisan', (k) => b.db.prepare(
        "INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, '{}')").run(k)],
    ];
    for (const [poruka, veza] of slucajevi) {
      const k = dodajKorisnika(`Kasir ${poruka.length}`, `${1000 + poruka.length}`);
      veza(k);
      await expect(b.call('user:delete', k)).rejects.toThrow(poruka);
      expect(red('SELECT COUNT(*) AS n FROM users WHERE id = ?', k).n).toBe(1);
    }
  });

  test('posljednji admin ne može biti obrisan', async () => {
    await expect(b.call('user:delete', ADMIN)).rejects.toThrow('Posljednji administrator ne može biti obrisan');
    expect(red('SELECT COUNT(*) AS n FROM users WHERE id = ?', ADMIN).n).toBe(1);
    const drugi = dodajKorisnika('Berina', '1111', 'admin');
    expect(await b.call('user:delete', ADMIN)).toEqual({ changes: 1 });
    // Obrisani korisnik više nije prijavljen.
    await expect(b.call('user:getAll')).rejects.toThrow('Niste prijavljeni');
    await prijavi(b, '1111');
    await expect(b.call('user:delete', drugi)).rejects.toThrow('Posljednji administrator ne može biti obrisan');
  });
});

// ─── settings:getTring / settings:saveTring ─────────────────

describe('settings:getTring', () => {
  test('vraća postavke s brojevima kao brojevima; lozinku ne vraća, samo da li postoji', async () => {
    const t = await b.call('settings:getTring');
    expect(t).toEqual({ host: 'localhost', port: b.tring.port, operatorId: 0, imaLozinku: true });
  });

  test('bez redova u bazi vraća podrazumijevane vrijednosti', async () => {
    b.db.prepare("DELETE FROM settings WHERE key LIKE 'tring.%'").run();
    expect(await b.call('settings:getTring')).toEqual({ host: 'localhost', port: 8085, operatorId: 0, imaLozinku: false });
  });
});

describe('settings:saveTring', () => {
  test('upisuje sve četiri postavke kao tekst', async () => {
    const r = await b.call('settings:saveTring', { host: '192.168.1.50', port: 9000, operatorId: 3, operatorPassword: 'tajna' });
    expect(r).toEqual({ success: true });
    expect(redovi("SELECT key, value FROM settings WHERE key LIKE 'tring.%' ORDER BY key")).toEqual([
      { key: 'tring.host', value: '192.168.1.50' },
      { key: 'tring.operatorId', value: '3' },
      { key: 'tring.operatorPassword', value: 'tajna' },
      { key: 'tring.port', value: '9000' },
    ]);
    expect(await b.call('settings:getTring')).toEqual({ host: '192.168.1.50', port: 9000, operatorId: 3, imaLozinku: true });
    expect(b.tring.zahtjevi).toEqual([]);
  });

  test('prazna ili izostavljena lozinka zadržava staru', async () => {
    await b.call('settings:saveTring', { host: 'h', port: 9000, operatorId: 1, operatorPassword: 'tajna' });
    await b.call('settings:saveTring', { host: 'h2', port: 9001, operatorId: 2, operatorPassword: '' });
    expect(postavka('tring.operatorPassword')).toBe('tajna');
    await b.call('settings:saveTring', { host: 'h3', port: 9002, operatorId: 3 });
    expect(postavka('tring.operatorPassword')).toBe('tajna');
    expect(postavka('tring.host')).toBe('h3');
  });

  test('validira host, port i operator ID', async () => {
    const ok = { host: 'localhost', port: 8085, operatorId: 0, operatorPassword: '0' };
    await expect(b.call('settings:saveTring', { ...ok, host: '  ' })).rejects.toThrow('Host je obavezan');
    for (const port of [0, 65536, 80.5, '8085']) {
      await expect(b.call('settings:saveTring', { ...ok, port })).rejects.toThrow('Port mora biti cijeli broj između 1 i 65535');
    }
    for (const operatorId of [-1, 1.5, '1']) {
      await expect(b.call('settings:saveTring', { ...ok, operatorId })).rejects.toThrow('Operator ID mora biti nenegativan cijeli broj');
    }
    expect(postavka('tring.host')).toBe('localhost');
    expect(postavka('tring.port')).toBe(String(b.tring.port));
  });

  test('granične vrijednosti porta su dozvoljene', async () => {
    await b.call('settings:saveTring', { host: 'h', port: 1, operatorId: 0, operatorPassword: '' });
    expect(postavka('tring.port')).toBe('1');
    await b.call('settings:saveTring', { host: 'h', port: 65535, operatorId: 0, operatorPassword: '' });
    expect(postavka('tring.port')).toBe('65535');
    expect(postavka('tring.operatorPassword')).toBe('0');
  });
});

// ─── settings:getFirma / settings:saveFirma ─────────────────

describe('settings:getFirma', () => {
  test('prazna baza daje prazna polja, logo 100 i bez računa', async () => {
    expect(await b.call('settings:getFirma')).toEqual({
      naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '',
      web: '', email: '', logo: '', logoVelicina: 100, ziroRacuniPozicija: 'zaglavlje', bankAccounts: [],
    });
  });

  test('položaj žiro računa: samo "podnozje" mijenja zadano zaglavlje', async () => {
    const set = (v: string) => b.db.prepare(
      "INSERT INTO settings (key, value) VALUES ('firma.ziroRacuniPozicija', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(v);
    set('podnozje'); expect((await b.call('settings:getFirma')).ziroRacuniPozicija).toBe('podnozje');
    set('zaglavlje'); expect((await b.call('settings:getFirma')).ziroRacuniPozicija).toBe('zaglavlje');
    set('lijevo'); expect((await b.call('settings:getFirma')).ziroRacuniPozicija).toBe('zaglavlje');
  });

  test('izostavlja potpuno prazne bankovne račune, zadržava djelimično popunjene', async () => {
    const set = b.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    set.run('firma.bank1.name', '  ');
    set.run('firma.bank1.number', '');
    set.run('firma.bank2.name', '');
    set.run('firma.bank2.number', '1610000000000000');
    set.run('firma.bank3.name', 'Raiffeisen');
    const f = await b.call('settings:getFirma');
    expect(f.bankAccounts).toEqual([
      { bankName: '', accountNumber: '1610000000000000' },
      { bankName: 'Raiffeisen', accountNumber: '' },
    ]);
  });

  test('veličina loga se ograničava na 40–200 i zaokružuje', async () => {
    const set = (v: string) => b.db.prepare(
      "INSERT INTO settings (key, value) VALUES ('firma.logoVelicina', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(v);
    set('500'); expect((await b.call('settings:getFirma')).logoVelicina).toBe(200);
    set('10'); expect((await b.call('settings:getFirma')).logoVelicina).toBe(40);
    set('77.6'); expect((await b.call('settings:getFirma')).logoVelicina).toBe(78);
    set('abc'); expect((await b.call('settings:getFirma')).logoVelicina).toBe(100);
  });
});

describe('settings:saveFirma', () => {
  test('upisuje sva polja i uvijek sva tri bankovna računa', async () => {
    const r = await b.call('settings:saveFirma', firma({
      web: 'stolarija.ba', email: 'info@stolarija.ba', logoVelicina: 150, ziroRacuniPozicija: 'podnozje',
      bankAccounts: [{ bankName: 'UniCredit', accountNumber: '3380000000000000' }],
    }));
    expect(r).toEqual({ success: true });
    const sve = Object.fromEntries(
      redovi("SELECT key, value FROM settings WHERE key LIKE 'firma.%'").map((x: any) => [x.key, x.value])
    );
    expect(sve).toEqual({
      'firma.naziv': 'Stolarija d.o.o.', 'firma.adresa': 'Titova 1', 'firma.grad': 'Sarajevo',
      'firma.idBroj': '4200000000001', 'firma.pdvBroj': '200000000001', 'firma.skladiste': 'Glavno',
      'firma.logo': 'data:image/png;base64,AAA', 'firma.web': 'stolarija.ba', 'firma.email': 'info@stolarija.ba',
      'firma.logoVelicina': '150', 'firma.ziroRacuniPozicija': 'podnozje',
      'firma.bank1.name': 'UniCredit', 'firma.bank1.number': '3380000000000000',
      'firma.bank2.name': '', 'firma.bank2.number': '',
      'firma.bank3.name': '', 'firma.bank3.number': '',
    });
    expect(await b.call('settings:getFirma')).toEqual({
      ...firma(), web: 'stolarija.ba', email: 'info@stolarija.ba', logoVelicina: 150, ziroRacuniPozicija: 'podnozje',
      bankAccounts: [{ bankName: 'UniCredit', accountNumber: '3380000000000000' }],
    });
  });

  test('bez web/email/logoVelicina/bankAccounts upisuje prazno i logo 100', async () => {
    await b.call('settings:saveFirma', firma());
    expect(postavka('firma.web')).toBe('');
    expect(postavka('firma.email')).toBe('');
    expect(postavka('firma.logoVelicina')).toBe('100');
    expect(postavka('firma.ziroRacuniPozicija')).toBe('zaglavlje');
    expect(postavka('firma.bank1.name')).toBe('');
  });

  test('veličina loga se ograničava i pri spremanju', async () => {
    await b.call('settings:saveFirma', firma({ logoVelicina: 1000 }));
    expect(postavka('firma.logoVelicina')).toBe('200');
    await b.call('settings:saveFirma', firma({ logoVelicina: 5 }));
    expect(postavka('firma.logoVelicina')).toBe('40');
  });

  test('ponovno spremanje briše ranije bankovne račune koji više nisu poslani', async () => {
    await b.call('settings:saveFirma', firma({ bankAccounts: [
      { bankName: 'A', accountNumber: '1' }, { bankName: 'B', accountNumber: '2' },
    ] }));
    await b.call('settings:saveFirma', firma({ bankAccounts: [{ bankName: 'C', accountNumber: '3' }] }));
    expect((await b.call('settings:getFirma')).bankAccounts).toEqual([{ bankName: 'C', accountNumber: '3' }]);
    expect(postavka('firma.bank2.name')).toBe('');
  });

  test('četvrti bankovni račun se ignoriše', async () => {
    await b.call('settings:saveFirma', firma({ bankAccounts: [
      { bankName: 'A', accountNumber: '1' }, { bankName: 'B', accountNumber: '2' },
      { bankName: 'C', accountNumber: '3' }, { bankName: 'D', accountNumber: '4' },
    ] }));
    expect((await b.call('settings:getFirma')).bankAccounts.map((x: any) => x.bankName)).toEqual(['A', 'B', 'C']);
    expect(red("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'firma.bank4%'").n).toBe(0);
  });
});

// ─── settings:get / settings:set ────────────────────────────

describe('settings:get / settings:set', () => {
  test('set upisuje i prepisuje vrijednost, get je čita', async () => {
    expect(await b.call('settings:set', 'kasa.showDailyTotal', 'true')).toEqual({ success: true });
    expect(await b.call('settings:get', 'kasa.showDailyTotal')).toBe('true');
    await b.call('settings:set', 'kasa.showDailyTotal', 'false');
    expect(await b.call('settings:get', 'kasa.showDailyTotal')).toBe('false');
    expect(red("SELECT COUNT(*) AS n FROM settings WHERE key = 'kasa.showDailyTotal'").n).toBe(1);
  });

  test('get ne vraća lozinku Tring operatera', async () => {
    expect(postavka('tring.operatorPassword')).toBe('0');
    expect(await b.call('settings:get', 'tring.operatorPassword')).toBeNull();
  });

  test('nepostojeći ključ daje null', async () => {
    expect(await b.call('settings:get', 'ne.postoji')).toBeNull();
  });

  test('get čita i seedovane tring postavke', async () => {
    expect(await b.call('settings:get', 'tring.host')).toBe('localhost');
  });

  test('prazan string se čuva kao prazan string, ne null', async () => {
    await b.call('settings:set', 'racun.napomena', '');
    expect(await b.call('settings:get', 'racun.napomena')).toBe('');
  });
});

// ─── savedCarts:* ───────────────────────────────────────────

describe('savedCarts:save', () => {
  test('sprema košaricu kao JSON i vraća goli id', async () => {
    const p = dodajArtikal('A1');
    const items = [{ productId: p, kolicina: 2, rabat: 10 }];
    const id = await b.call('savedCarts:save', 'Sto za Hasu', items, 9);
    expect(typeof id).toBe('number');
    const r = red('SELECT naziv, items, ukupno, createdAt FROM saved_carts WHERE id = ?', id);
    expect(r.naziv).toBe('Sto za Hasu');
    expect(JSON.parse(r.items)).toEqual(items);
    expect(r.ukupno).toBe(9);
    expect(typeof r.createdAt).toBe('string');
  });

  test('odbija praznu košaricu', async () => {
    await expect(b.call('savedCarts:save', 'X', [], 0)).rejects.toThrow('Košarica je prazna');
    await expect(b.call('savedCarts:save', 'X', null, 0)).rejects.toThrow('Košarica je prazna');
    expect(red('SELECT COUNT(*) AS n FROM saved_carts').n).toBe(0);
  });

  test('ne provjerava postojanje artikala ni zalihu', async () => {
    const id = await b.call('savedCarts:save', 'Stara', [{ productId: 999, kolicina: 50, rabat: 0 }], 0);
    expect(typeof id).toBe('number');
  });
});

describe('savedCarts:list', () => {
  test('prazna lista bez košarica', async () => {
    expect(await b.call('savedCarts:list')).toEqual([]);
  });

  test('vraća redove najnovije prvo, items kao JSON string', async () => {
    const p = dodajArtikal('A1');
    const prvi = await b.call('savedCarts:save', 'Prva', [{ productId: p, kolicina: 1, rabat: 0 }], 5);
    const drugi = await b.call('savedCarts:save', 'Druga', [{ productId: p, kolicina: 3, rabat: 0 }], 15);
    const lista = await b.call('savedCarts:list');
    expect(lista.map((c: any) => c.id)).toEqual([drugi, prvi]);
    expect(Object.keys(lista[0]).sort()).toEqual(['createdAt', 'id', 'items', 'naziv', 'ukupno']);
    expect(lista[0]).toMatchObject({ naziv: 'Druga', ukupno: 15 });
    expect(typeof lista[0].items).toBe('string');
    expect(JSON.parse(lista[0].items)).toEqual([{ productId: p, kolicina: 3, rabat: 0 }]);
  });
});

describe('savedCarts:delete', () => {
  test('briše košaricu; nepostojeći id je tih uspjeh', async () => {
    const p = dodajArtikal('A1');
    const id = await b.call('savedCarts:save', 'Prva', [{ productId: p, kolicina: 1, rabat: 0 }], 5);
    expect(await b.call('savedCarts:delete', id)).toEqual({ success: true });
    expect(red('SELECT COUNT(*) AS n FROM saved_carts').n).toBe(0);
    expect(await b.call('savedCarts:delete', 999)).toEqual({ success: true });
  });
});

// ─── fakturaSkice:* ─────────────────────────────────────────

const SKICA = { firma: { naziv: 'Firma d.o.o.', idBroj: '4200000000001' }, stavke: [{ productId: 1, kolicina: 2, cijena: 5 }] };

describe('fakturaSkice:save', () => {
  test('bez id-a sprema novu skicu kao JSON i vraća goli id', async () => {
    const id = await b.call('fakturaSkice:save', null, 'Firma d.o.o.', SKICA, 10);
    expect(typeof id).toBe('number');
    const r = red('SELECT naziv, podaci, ukupno, spremljeno FROM faktura_skice WHERE id = ?', id);
    expect(r.naziv).toBe('Firma d.o.o.');
    expect(JSON.parse(r.podaci)).toEqual(SKICA);
    expect(r.ukupno).toBe(10);
    expect(typeof r.spremljeno).toBe('string');
  });

  test('sa id-em prepisuje postojeću skicu umjesto nove', async () => {
    const id = await b.call('fakturaSkice:save', null, 'Prva', SKICA, 10);
    b.db.prepare("UPDATE faktura_skice SET spremljeno = '2020-01-01 00:00:00' WHERE id = ?").run(id);
    const izmjena = { ...SKICA, napomena: 'hitno' };
    expect(await b.call('fakturaSkice:save', id, 'Druga', izmjena, 25)).toBe(id);
    expect(red('SELECT COUNT(*) AS n FROM faktura_skice').n).toBe(1);
    const r = red('SELECT naziv, podaci, ukupno, spremljeno FROM faktura_skice WHERE id = ?', id);
    expect(r).toMatchObject({ naziv: 'Druga', ukupno: 25 });
    expect(JSON.parse(r.podaci)).toEqual(izmjena);
    expect(r.spremljeno).not.toBe('2020-01-01 00:00:00');
  });

  test('id obrisane skice sprema novu', async () => {
    const id = await b.call('fakturaSkice:save', 999, 'Prva', SKICA, 10);
    expect(id).not.toBe(999);
    expect(red('SELECT COUNT(*) AS n FROM faktura_skice').n).toBe(1);
  });

  test('odbija skicu bez podataka', async () => {
    await expect(b.call('fakturaSkice:save', null, 'X', null, 0)).rejects.toThrow('Skica je prazna');
    await expect(b.call('fakturaSkice:save', null, 'X', [], 0)).rejects.toThrow('Skica je prazna');
    expect(red('SELECT COUNT(*) AS n FROM faktura_skice').n).toBe(0);
  });
});

describe('fakturaSkice:list', () => {
  test('prazna lista bez skica', async () => {
    expect(await b.call('fakturaSkice:list')).toEqual([]);
  });

  test('vraća redove zadnje spremljene prvo, podaci kao JSON string', async () => {
    const prva = await b.call('fakturaSkice:save', null, 'Prva', SKICA, 5);
    const druga = await b.call('fakturaSkice:save', null, 'Druga', SKICA, 15);
    b.db.prepare("UPDATE faktura_skice SET spremljeno = '2020-01-01 00:00:00' WHERE id = ?").run(druga);
    const lista = await b.call('fakturaSkice:list');
    expect(lista.map((s: any) => s.id)).toEqual([prva, druga]);
    expect(Object.keys(lista[0]).sort()).toEqual(['id', 'naziv', 'podaci', 'spremljeno', 'ukupno']);
    expect(lista[0]).toMatchObject({ naziv: 'Prva', ukupno: 5 });
    expect(JSON.parse(lista[0].podaci)).toEqual(SKICA);
  });
});

describe('fakturaSkice:delete', () => {
  test('briše skicu; nepostojeći id je tih uspjeh', async () => {
    const id = await b.call('fakturaSkice:save', null, 'Prva', SKICA, 5);
    expect(await b.call('fakturaSkice:delete', id)).toEqual({ success: true });
    expect(red('SELECT COUNT(*) AS n FROM faktura_skice').n).toBe(0);
    expect(await b.call('fakturaSkice:delete', 999)).toEqual({ success: true });
  });
});

// ─── proizvodnja:setEnabled ─────────────────────────────────

describe('proizvodnja:setEnabled', () => {
  test('uključivanje upisuje "true" i kreira prodajnu uslugu NAMJ', async () => {
    expect(await b.call('proizvodnja:setEnabled', true)).toEqual({ success: true });
    expect(postavka('proizvodnja.enabled')).toBe('true');
    expect(red("SELECT naziv, jm, cijena, pdvStopa, tip FROM products WHERE sifra = 'NAMJ'")).toEqual({
      naziv: 'Namještaj po mjeri', jm: 'kom', cijena: 0, pdvStopa: 'E', tip: 'usluga',
    });
  });

  test('ponovno uključivanje ne pravi duplikat usluge', async () => {
    await b.call('proizvodnja:setEnabled', true);
    await b.call('proizvodnja:setEnabled', true);
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(1);
  });

  test('postojeći artikal sa šifrom NAMJ se ne dira', async () => {
    const p = dodajArtikal('NAMJ');
    await b.call('proizvodnja:setEnabled', true);
    expect(redovi("SELECT id, tip FROM products WHERE sifra = 'NAMJ'")).toEqual([{ id: p, tip: 'artikal' }]);
  });

  test('isključivanje upisuje "false" i ne briše uslugu', async () => {
    await b.call('proizvodnja:setEnabled', true);
    expect(await b.call('proizvodnja:setEnabled', false)).toEqual({ success: true });
    expect(postavka('proizvodnja.enabled')).toBe('false');
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(1);
  });

  test('isključivanje bez ranijeg uključivanja ne kreira uslugu', async () => {
    await b.call('proizvodnja:setEnabled', false);
    expect(postavka('proizvodnja.enabled')).toBe('false');
    expect(red("SELECT COUNT(*) AS n FROM products WHERE sifra = 'NAMJ'").n).toBe(0);
  });
});
