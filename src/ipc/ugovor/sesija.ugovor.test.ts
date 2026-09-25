// Ugovor za sesiju, uloge i PIN-ove: ko smije zvati koji kanal, odakle dolazi
// korisnikId, heš PIN-a, seed i migracija, ograničenje pokušaja, zadani PIN i
// PIN za storno. Pravila su u src/ipc/sesija.ts — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach, setSystemTime } from 'bun:test';
import { pbkdf2Sync } from 'node:crypto';
import { otvoriBackend, prijavi, ADMIN_PIN, type Backend } from './backend';
import { hesirajPin, provjeriPin } from '../../lib/korisnici';

let b: Backend;

afterEach(async () => {
  setSystemTime();
  await b.close();
});

const ADMIN = 1; // seedovani admin (Admin/0000); adminPin() mu postavi ADMIN_PIN
const NISTE_PRIJAVLJENI = 'Niste prijavljeni';
const SAMO_ADMIN = 'Ovu radnju može izvršiti samo administrator';
const ZADANI_PIN = 'Prije rada promijenite zadani PIN 0000';
const BLOKADA = 'Previše pogrešnih pokušaja. Pokušajte ponovo za';

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function broj(sql: string, ...params: any[]): number {
  return red(sql, ...params).n;
}

function dodajKorisnika(ime: string, pin: string, uloga: 'admin' | 'kasir' = 'kasir'): number {
  return Number(b.db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, hesirajPin(pin), uloga).lastInsertRowid);
}

/** Seedovani admin dobije ADMIN_PIN (inače bi njegova sesija smjela samo promijeniti PIN). */
function adminPin() {
  b.db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hesirajPin(ADMIN_PIN), ADMIN);
}

function postavka(kljuc: string, vrijednost: string) {
  b.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(kljuc, vrijednost);
}

function dodajArtikal(sifra: string, cijena = 5): number {
  return Number(b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu) VALUES (?, ?, 'kom', ?, 'E', 1)"
  ).run(sifra, `Artikal ${sifra}`, cijena).lastInsertRowid);
}

function dodajKupca(): number {
  return Number(b.db.prepare("INSERT INTO kupci (naziv, idBroj) VALUES ('K', ?)").run(`42${Math.floor(Math.random() * 1e11)}`).lastInsertRowid);
}

function datum(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const sada = () => datum(new Date());

async function greska(p: Promise<unknown>): Promise<string> {
  try { await p; return '(prošao)'; } catch (e: any) { return e.message; }
}

/** Svi kanali backenda. Provjera ispod drži listu tačnom. */
const SVI_KANALI = [
  'licenca:stanje', 'licenca:aktiviraj',
  'user:login', 'user:logout', 'user:promijeniSvojPin', 'user:getAll', 'user:create', 'user:update', 'user:delete',
  'product:getAll', 'product:get', 'product:create', 'product:update', 'product:delete', 'product:adjustStock', 'product:search',
  'product:getDobavljacSifre', 'product:setDobavljacSifre', 'product:findByDobavljacSifra', 'dobavljac:getSifre', 'product:slobodan',
  'materijal:search', 'dobavljac:getAll', 'dobavljac:create', 'dobavljac:update', 'dobavljac:delete',
  'kupac:getAll', 'kupac:search', 'kupac:create', 'kupac:update', 'kupac:delete',
  'primka:getAll', 'primka:get', 'primka:nextBroj', 'primka:create', 'primka:update', 'primka:delete',
  'primka:pregledUnosa', 'primka:pregledIzmjene', 'primka:pregledBrisanja', 'nivelacija:getAll', 'nivelacija:get',
  'order:getAll', 'order:get', 'order:createManual', 'order:finalize', 'order:finalizePrilog',
  'fiscal:getNumeracija', 'fiscal:setZadnjiBroj', 'prilog:getStavke', 'prilog:saveStavke', 'order:setDatumValute', 'order:refundAndPrint',
  'pending:list', 'pending:resolve', 'pending:discard', 'order:getFiscalGaps', 'order:dismissFiscalGap',
  'ponuda:getAll', 'ponuda:get', 'ponuda:nextBroj', 'ponuda:create', 'ponuda:update', 'ponuda:setStatus', 'ponuda:delete', 'ponuda:konvertuj',
  'nalog:getAll', 'nalog:get', 'nalog:nextBroj', 'nalog:create', 'nalog:createIzPonude', 'nalog:zaPonudu', 'nalog:update',
  'nalog:replaceStavke', 'nalog:setStatus', 'nalog:delete', 'nalog:kalkulacija', 'nalog:izdajRacun',
  'normativ:get', 'normativ:save', 'proizvodnja:setEnabled',
  'settings:getTring', 'settings:saveTring', 'settings:getFirma', 'settings:get', 'settings:set', 'settings:saveFirma',
  'savedCarts:list', 'savedCarts:save', 'savedCarts:delete', 'fakturaSkice:list', 'fakturaSkice:save', 'fakturaSkice:delete',
  'report:getData', 'izvoz:knjigovodja',
  'tring:init', 'tring:xReport', 'tring:zReport', 'tring:periodicReport', 'tring:getLogs', 'tring:clearLogs',
  'cash:add', 'cash:retry', 'cash:getToday', 'cash:lastPolog', 'cash:drawerState',
  'dialog:saveFile', 'fs:writeFile', 'db:backup', 'db:restore',
];

/** Kanali bez prijave (licenca:* se ovdje ne zove — harness je zamjenjuje). */
const BEZ_PRIJAVE = ['licenca:stanje', 'licenca:aktiviraj', 'user:login', 'user:logout', 'settings:getFirma', 'settings:get'];

const ADMIN_KANALI = [
  'user:create', 'user:update', 'user:delete', 'settings:saveFirma', 'settings:saveTring', 'proizvodnja:setEnabled',
  'fiscal:setZadnjiBroj', 'order:dismissFiscalGap', 'pending:discard', 'db:backup', 'db:restore', 'izvoz:knjigovodja',
  'tring:init', 'tring:getLogs', 'tring:clearLogs',
];

/** Zove svaki kanal iz `kanali` bez argumenata; vraća one koji nisu odbijeni porukom `poruka`. */
async function neodbijeni(kanali: string[], poruka: string): Promise<string[]> {
  const prosli: string[] = [];
  for (const kanal of kanali) {
    const g = await greska(b.call(kanal));
    if (g !== poruka) prosli.push(`${kanal}: ${g}`);
  }
  return prosli;
}

// ─── Lista kanala ───────────────────────────────────────────

describe('lista kanala', () => {
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });

  // TODO(Task 6): Rust adapter još nema kanali() — pod KASA_BACKEND=rust ovaj test pada dok se ne doda.
  test('SVI_KANALI su tačno kanali koje backend registruje', async () => {
    expect([...SVI_KANALI].sort()).toEqual(await b.kanali());
  });
});

// ─── Bez prijave ────────────────────────────────────────────

describe('bez prijave', () => {
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });

  test('svaki kanal osim prijave, odjave i onoga što LoginScreen čita traži prijavu', async () => {
    expect(await neodbijeni(SVI_KANALI.filter(k => !BEZ_PRIJAVE.includes(k)), NISTE_PRIJAVLJENI)).toEqual([]);
    expect(b.tring.zahtjevi).toEqual([]);
    expect(b.otvoreniDijalozi).toEqual([]);
  });

  test('LoginScreen: firma i postavke modula/skale se čitaju bez prijave, ostale postavke ne', async () => {
    expect((await b.call('settings:getFirma')).naziv).toBe('');
    postavka('proizvodnja.enabled', 'true');
    expect(await b.call('settings:get', 'proizvodnja.enabled')).toBe('true');
    expect(await b.call('settings:get', 'ui.showGenerator')).toBeNull();
    expect(await b.call('settings:get', 'ui.skala')).toBeNull();
    for (const k of ['tring.host', 'kasa.requirePinRefund', 'tring.operatorPassword', 'fiscal.dismissedGaps']) {
      await expect(b.call('settings:get', k)).rejects.toThrow(NISTE_PRIJAVLJENI);
    }
    await expect(b.call('settings:set', 'ui.skala', '1')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });

  test('odjava bez prijave je tih uspjeh', async () => {
    expect(await b.call('user:logout')).toEqual({ success: true });
  });
});

// ─── Zadani PIN ─────────────────────────────────────────────

describe('sesija sa zadanim PIN-om 0000', () => {
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });

  test('smije samo promijeniti PIN, odjaviti se i ono što smije neprijavljen', async () => {
    expect(await prijavi(b, '0000')).toEqual({ id: ADMIN, ime: 'Admin', uloga: 'admin', zadaniPin: true });
    const zabranjeni = SVI_KANALI.filter(k => !BEZ_PRIJAVE.includes(k) && k !== 'user:promijeniSvojPin');
    expect(await neodbijeni(zabranjeni, ZADANI_PIN)).toEqual([]);
    expect(b.tring.zahtjevi).toEqual([]);
    expect(b.otvoreniDijalozi).toEqual([]);
    // Pred-prijavna čitanja rade kao i bez prijave; ostale postavke ne.
    expect((await b.call('settings:getFirma')).naziv).toBe('');
    expect(await b.call('settings:get', 'ui.skala')).toBeNull();
    await expect(b.call('settings:get', 'tring.host')).rejects.toThrow(ZADANI_PIN);
  });

  test('nakon promjene PIN-a sesija radi normalno; odjava gasi ograničenu sesiju', async () => {
    await prijavi(b, '0000');
    expect(await b.call('user:promijeniSvojPin', '0000', '2468')).toEqual({ success: true });
    expect(await b.call('product:getAll')).toEqual([]);

    b.db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(hesirajPin('0000'), ADMIN);
    await prijavi(b, '0000');
    expect(await b.call('user:logout')).toEqual({ success: true });
    await expect(b.call('product:getAll')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });

  test('i kasir kome je admin postavio 0000 mora ga promijeniti', async () => {
    adminPin();
    const kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, ADMIN_PIN);
    await b.call('user:update', kasir, { pin: '0000' });
    expect(await prijavi(b, '0000')).toMatchObject({ id: kasir, zadaniPin: true });
    await expect(b.call('cash:getToday')).rejects.toThrow(ZADANI_PIN);
  });
});

// ─── Prijava i odjava ───────────────────────────────────────

describe('sesija', () => {
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
  });

  test('prijava otvara sesiju, odjava je zatvara', async () => {
    expect(await prijavi(b, ADMIN_PIN)).toEqual({ id: ADMIN, ime: 'Admin', uloga: 'admin', zadaniPin: false });
    expect(await b.call('product:getAll')).toEqual([]);
    expect(await b.call('user:logout')).toEqual({ success: true });
    await expect(b.call('product:getAll')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });

  test('neuspjela prijava zatvara i dotadašnju sesiju', async () => {
    await prijavi(b, ADMIN_PIN);
    expect(await b.call('user:login', '9999')).toBeNull();
    await expect(b.call('product:getAll')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });

  test('nova prijava zamjenjuje korisnika sesije', async () => {
    const kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, ADMIN_PIN);
    await prijavi(b, '1234');
    const p = dodajArtikal('A1');
    const { id } = await b.call('order:createManual', {
      ukupno: 5, pdvIznos: 0, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '1', createdAt: sada(),
      stavke: [{ productId: p, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'E' }],
    });
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', id).korisnikId).toBe(kasir);
  });

  test('restart backenda gasi sesiju', async () => {
    await prijavi(b, ADMIN_PIN);
    await b.ponovoPokreni();
    await expect(b.call('product:getAll')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });
});

// ─── PIN-ovi u bazi ─────────────────────────────────────────

describe('PIN heš, seed i migracija', () => {
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });

  test('nova baza ima samo Admin/0000, s PIN-om kao PBKDF2 hešom', async () => {
    const svi = b.db.prepare('SELECT id, ime, uloga, pin FROM users').all() as any[];
    expect(svi.map(u => [u.id, u.ime, u.uloga])).toEqual([[ADMIN, 'Admin', 'admin']]);
    expect(svi[0].pin).toMatch(/^pbkdf2\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(provjeriPin('0000', svi[0].pin)).toBe(true);
  });

  test('zadani admin se ne vraća dok u bazi postoji ijedan korisnik', async () => {
    dodajKorisnika('Berina', '1111', 'admin');
    b.db.prepare('DELETE FROM users WHERE id = ?').run(ADMIN);
    await b.ponovoPokreni();
    expect(b.db.prepare('SELECT ime FROM users').all()).toEqual([{ ime: 'Berina' }]);
    expect(await b.call('user:login', '0000')).toBeNull();

    // Ni izmijenjen PIN admina ne vraća drugog Admin/0000.
    b.db.prepare("UPDATE users SET ime = 'Admin', pin = ? WHERE ime = 'Berina'").run(hesirajPin('4444'));
    await b.ponovoPokreni();
    expect(broj('SELECT COUNT(*) AS n FROM users')).toBe(1);
  });

  test('prazna tabela korisnika ponovo dobije Admin/0000', async () => {
    b.db.prepare('DELETE FROM users').run();
    await b.ponovoPokreni();
    expect(await prijavi(b, '0000')).toMatchObject({ ime: 'Admin', uloga: 'admin', zadaniPin: true });
  });

  test('PIN u čistom tekstu (starija verzija, backup) se hešira pri otvaranju baze', async () => {
    const hesAdmina = red('SELECT pin FROM users WHERE id = ?', ADMIN).pin;
    const stari = Number(b.db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Stari', '4321', 'kasir')").run().lastInsertRowid);
    // Prije migracije se čist tekst ne prihvata kao PIN.
    expect(await b.call('user:login', '4321')).toBeNull();

    await b.ponovoPokreni();
    const pin = red('SELECT pin FROM users WHERE id = ?', stari).pin;
    expect(pin).toMatch(/^pbkdf2\$100000\$/);
    expect(provjeriPin('4321', pin)).toBe(true);
    expect(red('SELECT pin FROM users WHERE id = ?', ADMIN).pin).toBe(hesAdmina);
    expect(await prijavi(b, '4321')).toMatchObject({ id: stari, uloga: 'kasir', zadaniPin: false });
  });

  test('heš s manje od 100000 iteracija ili neispravan zapis se ne prihvata', async () => {
    const so = Buffer.alloc(16, 7);
    const slab = `pbkdf2$1000$${so.toString('hex')}$${pbkdf2Sync('5555', so, 1000, 32, 'sha256').toString('hex')}`;
    b.db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Slab', ?, 'admin')").run(slab);
    b.db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Los', 'pbkdf2$100000$zz$zz', 'admin')").run();
    expect(await b.call('user:login', '5555')).toBeNull();
    expect(await b.call('user:login', 'pbkdf2$100000$zz$zz')).toBeNull();
  });

  test('heš s poznatom soli: format je pbkdf2$100000$<so>$<PBKDF2-SHA256(pin, so, 100000, 32)>', async () => {
    const so = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const zapis = `pbkdf2$100000$${so.toString('hex')}$${pbkdf2Sync('7777', so, 100000, 32, 'sha256').toString('hex')}`;
    const k = Number(b.db.prepare("INSERT INTO users (ime, pin, uloga) VALUES ('Ruka', ?, 'kasir')").run(zapis).lastInsertRowid);
    expect(await prijavi(b, '7777')).toMatchObject({ id: k, ime: 'Ruka' });
  });

  test('jedinstvenost PIN-a se provjerava nad hešovima', async () => {
    adminPin();
    await prijavi(b, ADMIN_PIN);
    dodajKorisnika('Ana', '1234');
    await expect(b.call('user:create', { ime: 'Druga', pin: '1234', uloga: 'kasir' }))
      .rejects.toThrow('Korisnik sa PIN-om "1234" već postoji');
    await expect(b.call('user:create', { ime: 'Treća', pin: ADMIN_PIN, uloga: 'kasir' }))
      .rejects.toThrow(`Korisnik sa PIN-om "${ADMIN_PIN}" već postoji`);
  });

  test('nijedan kanal ne vraća PIN', async () => {
    adminPin();
    const k = dodajKorisnika('Ana', '1234');
    const odgovori = [await b.call('user:login', '1234'), await b.call('user:getAll')];
    await prijavi(b, ADMIN_PIN);
    odgovori.push(await b.call('user:getAll'));
    const json = JSON.stringify(odgovori);
    expect(json).not.toContain('pbkdf2');
    expect(json).not.toContain('"pin"');
    expect(json).toContain(`"id":${k}`);
  });
});

// ─── Uloge ──────────────────────────────────────────────────

describe('uloge', () => {
  let kasir: number;
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
    kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
  });

  test('kasir ne može zvati nijedan administratorski kanal', async () => {
    expect(await neodbijeni(ADMIN_KANALI, SAMO_ADMIN)).toEqual([]);
    expect(b.tring.zahtjevi).toEqual([]);
    expect(b.otvoreniDijalozi).toEqual([]);
  });

  test('odbijeni administratorski pozivi ništa ne mijenjaju', async () => {
    await expect(b.call('user:create', { ime: 'Novi', pin: '5555', uloga: 'admin' })).rejects.toThrow(SAMO_ADMIN);
    await expect(b.call('user:update', kasir, { uloga: 'admin' })).rejects.toThrow(SAMO_ADMIN);
    await expect(b.call('user:delete', ADMIN)).rejects.toThrow(SAMO_ADMIN);
    await expect(b.call('fiscal:setZadnjiBroj', 500)).rejects.toThrow(SAMO_ADMIN);
    await expect(b.call('order:dismissFiscalGap', 7)).rejects.toThrow(SAMO_ADMIN);
    const pending = Number(b.db.prepare("INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, '{}')").run(kasir).lastInsertRowid);
    await expect(b.call('pending:discard', pending)).rejects.toThrow(SAMO_ADMIN);
    await expect(b.call('settings:saveTring', { host: 'zlo', port: 1, operatorId: 0, operatorPassword: 'x' })).rejects.toThrow(SAMO_ADMIN);

    expect(broj('SELECT COUNT(*) AS n FROM users')).toBe(2);
    expect(red('SELECT uloga FROM users WHERE id = ?', kasir).uloga).toBe('kasir');
    expect(broj("SELECT COUNT(*) AS n FROM settings WHERE key IN ('fiscal.zadnjiBroj', 'fiscal.dismissedGaps')")).toBe(0);
    expect(broj('SELECT COUNT(*) AS n FROM pending_receipts')).toBe(1);
    expect(red("SELECT value FROM settings WHERE key = 'tring.host'").value).toBe('localhost');
  });

  test('kasir čita što treba za kasu i štampa, i radi Z izvještaj', async () => {
    expect(await b.call('user:getAll')).toHaveLength(2);
    expect(await b.call('settings:getTring')).toMatchObject({ host: 'localhost', imaLozinku: true });
    expect(await b.call('fiscal:getNumeracija')).toMatchObject({ predvidjeni: null });
    expect(await b.call('pending:list')).toEqual([]);
    expect(await b.call('order:getFiscalGaps')).toEqual([]);
    expect((await b.call('tring:zReport')).success).toBe(true);
    expect((await b.call('tring:xReport')).success).toBe(true);
  });

  test('admin zove administratorske kanale', async () => {
    await prijavi(b, ADMIN_PIN);
    expect(await b.call('fiscal:setZadnjiBroj', 100)).toMatchObject({ success: true, predvidjeni: 101 });
    expect(await b.call('order:dismissFiscalGap', 7)).toEqual({ success: true });
    expect(Array.isArray(await b.call('tring:getLogs'))).toBe(true);
  });

  test('nalog: kasir radi sve osim vraćanja u izradu', async () => {
    const { id } = await b.call('nalog:create', { vrsta: 'narudzba', kupacId: dodajKupca(), opis: 'Ormar', korisnikId: ADMIN });
    const mat = Number(b.db.prepare(
      "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES ('M1', 'Iverica', 'm2', 10, 'E', 'materijal')"
    ).run().lastInsertRowid);
    await b.call('nalog:replaceStavke', id, [{ materijalId: mat, kolicina: 1 }]);
    await b.call('nalog:setStatus', { id, status: 'zavrsen' });
    await expect(b.call('nalog:setStatus', { id, status: 'vrati', korisnikId: ADMIN }))
      .rejects.toThrow('Vraćanje naloga u izradu može samo administrator');
    await prijavi(b, ADMIN_PIN);
    expect(await b.call('nalog:setStatus', { id, status: 'vrati' })).toEqual({ success: true });
  });
});

// ─── settings:set allowlista ────────────────────────────────

describe('settings:set', () => {
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
  });

  test('kasir smije samo kasa.scanMode', async () => {
    dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    expect(await b.call('settings:set', 'kasa.scanMode', 'true')).toEqual({ success: true });
    for (const k of ['kasa.requirePinRefund', 'kasa.allowZeroStock', 'racun.napomena', 'dev.logging', 'ui.skala', 'ui.showGenerator', 'cijene.unosBezPdv']) {
      await expect(b.call('settings:set', k, 'false')).rejects.toThrow(SAMO_ADMIN);
    }
    expect(broj("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'kasa.%' OR key LIKE 'ui.%' OR key IN ('racun.napomena', 'dev.logging', 'cijene.unosBezPdv')")).toBe(1);
  });

  test('admin postavlja ključeve iz Postavki', async () => {
    await prijavi(b, ADMIN_PIN);
    const kljucevi = [
      'kasa.pologPrompt', 'kasa.allowZeroStock', 'kasa.kusurKalkulacija', 'kasa.requirePinRefund', 'kasa.showDailyTotal',
      'kasa.scanMode', 'cijene.unosBezPdv', 'racun.napomena', 'dev.logging', 'ui.skala', 'ui.showGenerator',
    ];
    for (const k of kljucevi) expect(await b.call('settings:set', k, 'true')).toEqual({ success: true });
    expect(broj("SELECT COUNT(*) AS n FROM settings WHERE value = 'true'")).toBe(kljucevi.length);
  });

  test('sve ostalo se odbija i adminu (tajne, interni ključevi, firma, tring)', async () => {
    await prijavi(b, ADMIN_PIN);
    for (const k of ['tring.operatorPassword', 'tring.host', 'fiscal.dismissedGaps', 'firma.naziv', 'proizvodnja.enabled', 'kasa.nesto', '']) {
      await expect(b.call('settings:set', k, 'x')).rejects.toThrow(`Postavka "${k}" se ne može mijenjati`);
    }
    expect(red("SELECT value FROM settings WHERE key = 'tring.operatorPassword'").value).toBe('0');
    expect(red("SELECT value FROM settings WHERE key = 'tring.host'").value).toBe('localhost');
  });

  test('vrijednost mora biti tekst', async () => {
    await prijavi(b, ADMIN_PIN);
    for (const v of [true, 1, null, { a: 1 }]) {
      await expect(b.call('settings:set', 'kasa.scanMode', v)).rejects.toThrow('Vrijednost postavke mora biti tekst');
    }
  });
});

// ─── Ograničenje pokušaja ───────────────────────────────────
// Neuspjesi se broje u kliznom prozoru od 15 min; uspjeh ih ne briše. Nakon
// prve blokade svaki neuspjeh blokira duplo duže (do 15 min) dok ne prođe
// 60 min bez neuspjeha. Stanje je u bazi i preživi restart.

describe('ograničenje pokušaja', () => {
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
  });

  async function pogresno(n: number) {
    for (let i = 0; i < n; i++) expect(await b.call('user:login', '9999')).toBeNull();
  }

  test('nakon 5 grešaka blokada 30 s — i za tačan PIN', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    await pogresno(5);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 30 s.`);
    setSystemTime(t0 + 12_500);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 18 s.`);
    // Blokirana prijava ne otvara sesiju.
    await expect(b.call('product:getAll')).rejects.toThrow(NISTE_PRIJAVLJENI);
    setSystemTime(t0 + 30_000);
    expect(await b.call('user:login', ADMIN_PIN)).toMatchObject({ id: ADMIN });
  });

  test('svaki sljedeći neuspjeh udvostručuje blokadu do 15 min, i kad stari neuspjesi isteknu iz prozora', async () => {
    let t = Date.now();
    setSystemTime(t);
    await pogresno(5);
    let blokada = 30;
    for (const sljedeca of [60, 120, 240, 480, 900, 900]) {
      t += blokada * 1000;
      setSystemTime(t);
      await pogresno(1);
      await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} ${sljedeca} s.`);
      blokada = sljedeca;
    }
    // Uporan napad: jedan pokušaj po isteku blokade, a svaki donese novih 15 min.
    t += blokada * 1000;
    setSystemTime(t);
    expect(await b.call('user:login', ADMIN_PIN)).toMatchObject({ id: ADMIN });
  });

  test('eskalacija se poništi tek nakon 60 min bez ijednog neuspjeha', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    await pogresno(5);
    // 59 min kasnije: prozor od 15 min je prazan, ali eskalacija traje.
    setSystemTime(t0 + 59 * 60_000);
    await pogresno(1);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 60 s.`);
    // 60 min od zadnjeg neuspjeha: kreće se ispočetka (4 bez blokade, peti 30 s).
    setSystemTime(t0 + 119 * 60_000);
    await pogresno(4);
    expect(await b.call('user:login', ADMIN_PIN)).toMatchObject({ id: ADMIN });
    await pogresno(1);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 30 s.`);
  });

  test('uspjeh ne poništava brojač', async () => {
    setSystemTime(Date.now());
    await pogresno(4);
    await prijavi(b, ADMIN_PIN);
    await pogresno(1);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 30 s.`);
  });

  test('ciklus "4 pogrešna + prijava svojim PIN-om" završava blokadom', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    dodajKorisnika('Kasir', '1234');
    let blokiran = false;
    for (let krug = 0; krug < 3 && !blokiran; krug++) {
      for (let i = 0; i < 4; i++) {
        const r = await greska(b.call('user:login', `${5000 + krug * 10 + i}`));
        if (r.startsWith(BLOKADA)) blokiran = true;
      }
      const r = await greska(b.call('user:login', '1234'));
      if (r.startsWith(BLOKADA)) blokiran = true;
      else expect(r).toBe('(prošao)');
    }
    expect(blokiran).toBe(true);
  });

  test('neuspjesi stariji od 15 min ne ulaze u prag', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    await pogresno(4);
    setSystemTime(t0 + 15 * 60_000);
    await pogresno(4);
    expect(await b.call('user:login', ADMIN_PIN)).toMatchObject({ id: ADMIN });
  });

  test('brojač je zajednički za prijavu, admin PIN u stornu i PIN pri promjeni svog PIN-a', async () => {
    setSystemTime(Date.now());
    dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    postavka('kasa.requirePinRefund', 'true');
    await expect(b.call('order:refundAndPrint', { id: 1, adminPin: '1234' })).rejects.toThrow('Neispravan admin PIN');
    await expect(b.call('order:refundAndPrint', { id: 1, adminPin: '5555' })).rejects.toThrow('Neispravan admin PIN');
    await expect(b.call('user:promijeniSvojPin', '9999', '4321')).rejects.toThrow('Trenutni PIN nije tačan');
    await pogresno(2);
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(BLOKADA);
  });

  test('blokada, neuspjesi i eskalacija prežive restart backenda (stanje je u bazi)', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    await pogresno(5);
    await b.ponovoPokreni();
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 30 s.`);
    setSystemTime(t0 + 30_000);
    await pogresno(1);
    await b.ponovoPokreni();
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 60 s.`);
  });

  test('stanje blokade se ne može pročitati ni promijeniti kroz settings:get/set', async () => {
    setSystemTime(Date.now());
    await pogresno(2);
    await prijavi(b, ADMIN_PIN);
    expect(red("SELECT value FROM settings WHERE key = 'sigurnost.pinBlokada'")).toBeTruthy();
    expect(await b.call('settings:get', 'sigurnost.pinBlokada')).toBeNull();
    await expect(b.call('settings:set', 'sigurnost.pinBlokada', '{}'))
      .rejects.toThrow('Postavka "sigurnost.pinBlokada" se ne može mijenjati');
    await b.call('user:logout');
    await expect(b.call('settings:get', 'sigurnost.pinBlokada')).rejects.toThrow(NISTE_PRIJAVLJENI);
  });
});

// ─── Zadani PIN i promjena svog PIN-a ───────────────────────

describe('user:promijeniSvojPin', () => {
  beforeEach(async () => { b = await otvoriBackend({ prijava: null }); });

  test('zadani admin mijenja PIN; stari 0000 više ne vrijedi', async () => {
    expect((await prijavi(b, '0000')).zadaniPin).toBe(true);
    expect(await b.call('user:promijeniSvojPin', '0000', '2468')).toEqual({ success: true });
    expect(provjeriPin('2468', red('SELECT pin FROM users WHERE id = ?', ADMIN).pin)).toBe(true);
    // Sesija ostaje otvorena.
    expect(await b.call('product:getAll')).toEqual([]);
    expect(await b.call('user:login', '0000')).toBeNull();
    expect(await prijavi(b, '2468')).toEqual({ id: ADMIN, ime: 'Admin', uloga: 'admin', zadaniPin: false });
  });

  test('radi samo za prijavljenog korisnika i samo nad njegovim PIN-om', async () => {
    await expect(b.call('user:promijeniSvojPin', '0000', '2468')).rejects.toThrow(NISTE_PRIJAVLJENI);
    const kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    // Tuđi PIN (admina) nije "trenutni PIN" kasira.
    await expect(b.call('user:promijeniSvojPin', '0000', '2468')).rejects.toThrow('Trenutni PIN nije tačan');
    expect(await b.call('user:promijeniSvojPin', '1234', '2468')).toEqual({ success: true });
    expect(provjeriPin('2468', red('SELECT pin FROM users WHERE id = ?', kasir).pin)).toBe(true);
    expect(provjeriPin('0000', red('SELECT pin FROM users WHERE id = ?', ADMIN).pin)).toBe(true);
  });

  test('validira novi PIN: cifre, dužina, ne 0000, ne tuđi', async () => {
    dodajKorisnika('Kasir', '1234');
    await prijavi(b, '0000');
    await expect(b.call('user:promijeniSvojPin', '0000', 'ab12')).rejects.toThrow('PIN smije sadržavati samo cifre');
    await expect(b.call('user:promijeniSvojPin', '0000', '12')).rejects.toThrow('PIN mora imati najmanje 4 cifre');
    await expect(b.call('user:promijeniSvojPin', '0000', '')).rejects.toThrow('PIN je obavezan');
    await expect(b.call('user:promijeniSvojPin', '0000', '0000')).rejects.toThrow('Novi PIN ne smije biti 0000');
    await expect(b.call('user:promijeniSvojPin', '0000', '1234')).rejects.toThrow('Taj PIN je zauzet, odaberite drugi');
    expect(provjeriPin('0000', red('SELECT pin FROM users WHERE id = ?', ADMIN).pin)).toBe(true);
  });

  test('pogađanje tuđih PIN-ova kroz promjenu svog PIN-a udara u blokadu', async () => {
    setSystemTime(Date.now());
    adminPin();
    const tudji = ['1111', '2222', '3333', '4444', '5555'];
    tudji.forEach((pin, i) => dodajKorisnika(`K${i}`, pin));
    const kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    for (const pin of tudji) {
      await expect(b.call('user:promijeniSvojPin', '1234', pin)).rejects.toThrow('Taj PIN je zauzet, odaberite drugi');
    }
    // Sljedeći pokušaj, i sa slobodnim PIN-om, ne otkriva ništa.
    await expect(b.call('user:promijeniSvojPin', '1234', ADMIN_PIN)).rejects.toThrow(`${BLOKADA} 30 s.`);
    await expect(b.call('user:promijeniSvojPin', '1234', '7777')).rejects.toThrow(BLOKADA);
    expect(provjeriPin('1234', red('SELECT pin FROM users WHERE id = ?', kasir).pin)).toBe(true);
    // Blokada važi i za prijavu admina.
    await expect(b.call('user:login', ADMIN_PIN)).rejects.toThrow(BLOKADA);
  });

  test('uspješna promjena ne briše neuspjehe', async () => {
    setSystemTime(Date.now());
    adminPin();
    ['1111', '2222', '3333', '4444'].forEach((pin, i) => dodajKorisnika(`K${i}`, pin));
    dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    for (const pin of ['1111', '2222', '3333', '4444']) {
      await expect(b.call('user:promijeniSvojPin', '1234', pin)).rejects.toThrow('Taj PIN je zauzet');
    }
    expect(await b.call('user:promijeniSvojPin', '1234', '7777')).toEqual({ success: true });
    await expect(b.call('user:promijeniSvojPin', '7777', ADMIN_PIN)).rejects.toThrow('Taj PIN je zauzet');
    await expect(b.call('user:promijeniSvojPin', '7777', '8888')).rejects.toThrow(`${BLOKADA} 30 s.`);
  });

  test('najviše 3 uspješne promjene u 10 min po korisniku, i preko nove prijave', async () => {
    const t0 = Date.now();
    setSystemTime(t0);
    const kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
    expect(await b.call('user:promijeniSvojPin', '1234', '1235')).toEqual({ success: true });
    expect(await b.call('user:promijeniSvojPin', '1235', '1236')).toEqual({ success: true });
    await prijavi(b, '1236');
    expect(await b.call('user:promijeniSvojPin', '1236', '1237')).toEqual({ success: true });
    await expect(b.call('user:promijeniSvojPin', '1237', '1238')).rejects.toThrow('Previše promjena PIN-a. Pokušajte ponovo za 600 s.');
    // Budžet ne troši pokušaje i ne otkriva da li je PIN zauzet.
    await expect(b.call('user:promijeniSvojPin', '1237', ADMIN_PIN)).rejects.toThrow('Previše promjena PIN-a');
    expect(provjeriPin('1237', red('SELECT pin FROM users WHERE id = ?', kasir).pin)).toBe(true);
    setSystemTime(t0 + 10 * 60_000);
    expect(await b.call('user:promijeniSvojPin', '1237', '1238')).toEqual({ success: true });
  });
});

// ─── Storno uz admin PIN ────────────────────────────────────

describe('order:refundAndPrint uz kasa.requirePinRefund', () => {
  let racun: number;
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
    dodajKorisnika('Kasir', '1234');
    dodajKorisnika('Berina', '1111', 'admin');
    await prijavi(b, '1234');
    const p = dodajArtikal('S1', 3);
    racun = (await b.call('order:createManual', {
      ukupno: 3, pdvIznos: 0, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '55', createdAt: sada(),
      stavke: [{ productId: p, kolicina: 1, cijena: 3, rabat: 0, pdvStopa: 'E' }],
    })).id;
  });

  const status = () => red('SELECT status FROM orders WHERE id = ?', racun).status;

  test('kasir bez admin PIN-a ili s pogrešnim se odbija prije štampe', async () => {
    postavka('kasa.requirePinRefund', 'true');
    await expect(b.call('order:refundAndPrint', { id: racun })).rejects.toThrow('Reklamacija traži PIN administratora');
    await expect(b.call('order:refundAndPrint', { id: racun, adminPin: '' })).rejects.toThrow('Reklamacija traži PIN administratora');
    await expect(b.call('order:refundAndPrint', { id: racun, adminPin: '1234' })).rejects.toThrow('Neispravan admin PIN');
    await expect(b.call('order:refundAndPrint', { id: racun, adminPin: '9999' })).rejects.toThrow('Neispravan admin PIN');
    expect(b.tring.zahtjevi).toEqual([]);
    expect(status()).toBe('completed');
  });

  test('kasir s PIN-om bilo kojeg admina stornira', async () => {
    postavka('kasa.requirePinRefund', 'true');
    expect(await b.call('order:refundAndPrint', { id: racun, adminPin: '1111' })).toMatchObject({ success: true });
    expect(status()).toBe('refunded');
  });

  test('admin ne treba PIN; bez postavke ni kasir', async () => {
    postavka('kasa.requirePinRefund', 'true');
    await prijavi(b, ADMIN_PIN);
    expect(await b.call('order:refundAndPrint', { id: racun })).toMatchObject({ success: true });

    await prijavi(b, '1234');
    postavka('kasa.requirePinRefund', 'false');
    const p = dodajArtikal('S2', 3);
    const drugi = (await b.call('order:createManual', {
      ukupno: 3, pdvIznos: 0, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '56', createdAt: sada(),
      stavke: [{ productId: p, kolicina: 1, cijena: 3, rabat: 0, pdvStopa: 'E' }],
    })).id;
    expect(await b.call('order:refundAndPrint', { id: drugi })).toMatchObject({ success: true });
  });

  test('pogrešan admin PIN ulazi u ograničenje pokušaja, a tačan ne briše ranije neuspjehe', async () => {
    setSystemTime(Date.now());
    postavka('kasa.requirePinRefund', 'true');
    for (let i = 0; i < 4; i++) {
      await expect(b.call('order:refundAndPrint', { id: racun, adminPin: '9999' })).rejects.toThrow('Neispravan admin PIN');
    }
    expect(await b.call('order:refundAndPrint', { id: racun, adminPin: '1111' })).toMatchObject({ success: true });
    expect(await b.call('user:login', '9999')).toBeNull();
    await expect(b.call('user:login', '1234')).rejects.toThrow(`${BLOKADA} 30 s.`);
  });
});

// ─── korisnikId iz sesije ───────────────────────────────────

describe('korisnikId se uzima iz sesije, ne iz payload-a', () => {
  let kasir: number;
  beforeEach(async () => {
    b = await otvoriBackend({ prijava: null });
    adminPin();
    kasir = dodajKorisnika('Kasir', '1234');
    await prijavi(b, '1234');
  });

  test('order:finalize, order:createManual, cash:add', async () => {
    const p = dodajArtikal('A1');
    const stavka = { productId: p, sifra: 'A1', naziv: 'Artikal A1', jm: 'kom', plu: 1, cijena: 5, kolicina: 1, rabat: 0, pdvStopa: 'E' };
    const f = await b.call('order:finalize', { korisnikId: ADMIN, ukupno: 5, pdvIznos: 0, nacinPlacanja: 'Gotovina', stavke: [stavka] });
    const m = await b.call('order:createManual', {
      korisnikId: ADMIN, ukupno: 5, pdvIznos: 0, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '900', createdAt: sada(), stavke: [stavka],
    });
    const c = await b.call('cash:add', { tip: 'polog', iznos: 20, korisnikId: ADMIN });
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', f.id).korisnikId).toBe(kasir);
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', m.id).korisnikId).toBe(kasir);
    expect(red('SELECT korisnikId FROM cash_movements WHERE id = ?', c.id).korisnikId).toBe(kasir);
  });

  test('ponuda:create i ponuda:konvertuj', async () => {
    const p = dodajArtikal('P1', 10);
    const { id } = await b.call('ponuda:create', {
      kupacId: dodajKupca(), korisnikId: ADMIN, stavke: [{ productId: p, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }],
    });
    expect(red('SELECT korisnikId FROM ponude WHERE id = ?', id).korisnikId).toBe(kasir);
    const r = await b.call('ponuda:konvertuj', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r.success).toBe(true);
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', r.racunId).korisnikId).toBe(kasir);
  });

  test('nalog:create i nalog:izdajRacun', async () => {
    const { id } = await b.call('nalog:create', {
      vrsta: 'narudzba', kupacId: dodajKupca(), opis: 'Ormar', dogovorenaCijena: 50, korisnikId: ADMIN,
    });
    expect(red('SELECT korisnikId FROM radni_nalozi WHERE id = ?', id).korisnikId).toBe(kasir);
    const mat = Number(b.db.prepare(
      "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES ('M1', 'Iverica', 'm2', 10, 'E', 'materijal')"
    ).run().lastInsertRowid);
    await b.call('nalog:replaceStavke', id, [{ materijalId: mat, kolicina: 1 }]);
    await b.call('nalog:setStatus', { id, status: 'zavrsen' });
    const r = await b.call('nalog:izdajRacun', { id, korisnikId: ADMIN, nacinPlacanja: 'Gotovina' });
    expect(r.success).toBe(true);
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', r.racunId).korisnikId).toBe(kasir);
  });

  test('order:finalizePrilog i nalog:createIzPonude', async () => {
    await prijavi(b, ADMIN_PIN);
    await b.call('fiscal:setZadnjiBroj', 100);
    await prijavi(b, '1234');
    const r = await b.call('order:finalizePrilog', { korisnikId: ADMIN, iznos: 10, nacinPlacanja: 'Virman' });
    expect(red('SELECT korisnikId FROM orders WHERE id = ?', r.id).korisnikId).toBe(kasir);

    const ponuda = Number(b.db.prepare(`
      INSERT INTO ponude (broj, godina, kupacId, korisnikId, datum, vaziDo, ukupno, pdvIznos, status)
      VALUES (1, 2026, ?, ?, '2026-09-01', '2026-09-30', 10, 0, 'prihvacena')
    `).run(dodajKupca(), ADMIN).lastInsertRowid);
    const n = await b.call('nalog:createIzPonude', ponuda, ADMIN);
    expect(red('SELECT korisnikId FROM radni_nalozi WHERE id = ?', n.id).korisnikId).toBe(kasir);
  });

  test('order:refundAndPrint: automatski polog za manjak u ladici nosi korisnika sesije', async () => {
    const p = dodajArtikal('S1', 3);
    const juce = new Date(Date.now() - 24 * 3600_000);
    // Jučerašnji gotovinski račun: današnja ladica ga ne pokriva, pa storno uz override traži polog.
    const { id } = await b.call('order:createManual', {
      ukupno: 3, pdvIznos: 0, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '77', createdAt: datum(juce),
      stavke: [{ productId: p, kolicina: 1, cijena: 3, rabat: 0, pdvStopa: 'E' }],
    });
    const r = await b.call('order:refundAndPrint', { id, dozvoliPolog: true, korisnikId: ADMIN });
    expect(r).toMatchObject({ success: true, pologIznos: 3 });
    expect(b.db.prepare("SELECT korisnikId, iznos FROM cash_movements WHERE tip = 'polog'").all()).toEqual([{ korisnikId: kasir, iznos: 3 }]);
  });
});

// ─── Uklonjeni kanali ───────────────────────────────────────

describe('uklonjeni kanali', () => {
  beforeEach(async () => { b = await otvoriBackend(); });

  test('nema sirovih kanala za račun, storno, reklamaciju, upis artikla ni zasebne provjere admin PIN-a', async () => {
    for (const kanal of [
      'order:create', 'order:refund', 'order:updateReklamacija', 'tring:printReceipt', 'tring:printRefund', 'tring:writeArticle',
      'user:verifyAdminPin',
    ]) {
      await expect(b.call(kanal, {})).rejects.toThrow();
    }
    expect(b.tring.zahtjevi).toEqual([]);
  });
});
