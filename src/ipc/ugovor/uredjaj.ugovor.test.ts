// Ugovor za kanale tring:*, cash:*, dialog:saveFile, fs:writeFile, db:backup i
// db:restore — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { otvoriBackend, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina s PIN-om 0000

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function postavka(kljuc: string, vrijednost: string) {
  b.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(kljuc, vrijednost);
}

/** Vrijednost prvog XML taga u tijelu zahtjeva. */
function tag(xml: string, naziv: string): string | undefined {
  return xml.match(new RegExp(`<${naziv}>([\\s\\S]*?)</${naziv}>`))?.[1];
}

function zadnji() {
  const z = b.tring.zahtjevi.at(-1);
  if (!z) throw new Error('Nijedan zahtjev nije poslan uređaju');
  return z;
}

function dodajRacun(ukupno: number, nacinPlacanja: string, opts: { createdAt?: string; refundedAt?: string } = {}) {
  b.db.prepare(`
    INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, refundedAt, createdAt)
    VALUES (?, ?, 0, ?, ?, ?, COALESCE(?, datetime('now','localtime')))
  `).run(ADMIN, ukupno, nacinPlacanja, opts.refundedAt ? 'refunded' : 'completed', opts.refundedAt ?? null, opts.createdAt ?? null);
}

/** Otvara aktivnu bazu posebnom konekcijom — nakon uvoza `b.db` gleda stari fajl. */
function aktivnaBaza(): Database {
  return new Database(path.join(path.dirname(b.radniFolder), 'kasa.db'), { readonly: true });
}

const OK = { success: true, vrstaOdgovora: 'OK', odgovori: {}, statusCode: 200 };

const kasaStavka = { sifra: 'A1', naziv: 'Kafa & mlijeko', jm: 'kom', cijena: 2.5, kolicina: 2, rabat: 0, pdvStopa: 'E', plu: 7 };

/** Artikal iz kasaStavka u šifarniku — račun (order:finalize) ga upisuje u stavke. */
function kasaArtikal() {
  const productId = Number(b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu) VALUES ('A1', 'Kafa & mlijeko', 'kom', 2.5, 'E', 7)"
  ).run().lastInsertRowid);
  return { ...kasaStavka, productId };
}

/** Sada kao lokalni "YYYY-MM-DD HH:MM:SS". */
function sada(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ─── tring:init ─────────────────────────────────────────────

describe('tring:init', () => {
  test('šalje operatora i lozinku iz postavki na /inicijalizacija', async () => {
    postavka('tring.operatorId', '5');
    postavka('tring.operatorPassword', 'tajna');
    const r = await b.call('tring:init');

    expect(r).toEqual(OK);
    expect(zadnji().putanja).toBe('/inicijalizacija');
    expect(tag(zadnji().tijelo, 'BrojOperatora')).toBe('5');
    expect(tag(zadnji().tijelo, 'Lozinka')).toBe('tajna');
  });

  test('bez veze s uređajem vraća neuspjeh, ne baca grešku', async () => {
    postavka('tring.port', '1'); // niko ne sluša
    const r = await b.call('tring:init');

    expect(r.success).toBe(false);
    expect(r.vrstaOdgovora).toBe('Greska');
    expect(r.odgovori).toEqual({});
    expect(r.statusCode).toBeNull();
    expect(typeof r.error).toBe('string');
    expect(r.error.length).toBeGreaterThan(0);
  });
});

// ─── Fiskalni račun i reklamacija (XML prema uređaju) ────────
// Uređaju se računi šalju samo kroz order:finalize i order:refundAndPrint
// (sirovi tring:printReceipt/printRefund kanali su uklonjeni).

describe('order:finalize → /sfr', () => {
  test('štampa račun i vraća broj fiskalnog računa', async () => {
    const r = await b.call('order:finalize', { stavke: [kasaArtikal()], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Gotovina' });

    expect(r).toMatchObject({ success: true, brojFiskalnogRacuna: '101', odgovori: { BrojFiskalnogRacuna: '101' } });
    const { putanja, tijelo } = zadnji();
    expect(putanja).toBe('/sfr');
    expect(tag(tijelo, 'VrstaZahtjeva')).toBe('0');
    expect(tag(tijelo, 'Sifra')).toBe('A1');
    expect(tag(tijelo, 'Naziv')).toBe('Kafa &amp; mlijeko');
    expect(tag(tijelo, 'Cijena')).toBe('2.5');
    expect(tag(tijelo, 'Stopa')).toBe('E');
    expect(tag(tijelo, 'PLU')).toBe('7');
    expect(tag(tijelo, 'Kolicina')).toBe('2');
    expect(tag(tijelo, 'Oznaka')).toBe('Gotovina');
    expect(tag(tijelo, 'Iznos')).toBe('5');
    expect(tag(tijelo, 'BrojRacuna')).toBe('0');
    expect(tijelo).not.toContain('<Kupac>');
  });

  test('"Ček" ide uređaju kao Cek, razbijeno plaćanje ide po stavkama, kupac se šalje', async () => {
    const stavka = kasaArtikal();
    await b.call('order:finalize', { stavke: [stavka], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Ček' });
    expect(tag(zadnji().tijelo, 'Oznaka')).toBe('Cek');

    await b.call('order:finalize', {
      stavke: [stavka], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Gotovina',
      vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 3 }, { oznaka: 'Kartica', iznos: 2 }],
      kupac: { naziv: 'Firma d.o.o.', idBroj: '4200000000001', grad: 'Sarajevo' },
    });
    const tijelo = zadnji().tijelo;
    const placanja = [...tijelo.matchAll(/<VrstaPlacanja><Oznaka>(\w+)<\/Oznaka><Iznos>([\d.]+)<\/Iznos>/g)].map(m => [m[1], m[2]]);
    expect(placanja).toEqual([['Gotovina', '3'], ['Kartica', '2']]);
    expect(tag(tijelo, 'IDbroj')).toBe('4200000000001');
    expect(tag(tijelo, 'Grad')).toBe('Sarajevo');
    expect(tag(tijelo, 'Adresa')).toBe('');
  });

  test('greška uređaja se vraća kao rezultat, ne baca', async () => {
    b.tring.greskaNa('/sfr', 'Suma plaćanja', 524);
    const r = await b.call('order:finalize', { stavke: [kasaArtikal()], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Gotovina' });
    expect(r).toEqual({ success: false, odgovori: {}, error: 'Ukupna suma plaćanja veća od sume računa (Suma plaćanja) [524]' });
  });

  test('nepoznat TFS kod: poruka uređaja i kod', async () => {
    b.tring.greskaNa('/sfr', 'Nema papira', 901);
    const r = await b.call('order:finalize', { stavke: [kasaArtikal()], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Gotovina' });
    expect(r.error).toBe('Nema papira [901]');
  });
});

describe('order:refundAndPrint → /srr', () => {
  test('šalje reklamaciju s brojem originalnog računa i Gotovina/0', async () => {
    const stavka = kasaArtikal();
    const { id } = await b.call('order:createManual', {
      stavke: [stavka], ukupno: 5, pdvIznos: 0.73, nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: '101', createdAt: sada(),
    });
    const r = await b.call('order:refundAndPrint', { id });

    expect(r).toMatchObject({ success: true, brojReklamacije: 'R-1' });
    const { putanja, tijelo } = zadnji();
    expect(putanja).toBe('/srr');
    expect(tag(tijelo, 'VrstaZahtjeva')).toBe('2');
    expect(tag(tijelo, 'BrojRacuna')).toBe('101');
    expect(tag(tijelo, 'Oznaka')).toBe('Gotovina');
    expect(tag(tijelo, 'Iznos')).toBe('0');
    expect(tag(tijelo, 'Sifra')).toBe('A1');
  });
});

// ─── Izvještaji ─────────────────────────────────────────────

describe('tring:xReport / tring:zReport', () => {
  test('presjek stanja ide na /sps, dnevni izvještaj na /sdi', async () => {
    expect(await b.call('tring:xReport')).toEqual(OK);
    expect(zadnji().putanja).toBe('/sps');
    expect(tag(zadnji().tijelo, 'VrstaZahtjeva')).toBe('3');

    expect(await b.call('tring:zReport')).toEqual(OK);
    expect(zadnji().putanja).toBe('/sdi');
    expect(tag(zadnji().tijelo, 'VrstaZahtjeva')).toBe('4');
  });

  test('greška uređaja se vraća kao rezultat', async () => {
    b.tring.greskaNa('/sdi', 'Z već urađen', 900);
    const r = await b.call('tring:zReport');
    expect(r.success).toBe(false);
    expect(r.error).toBe('Z već urađen [900]');
  });
});

describe('tring:periodicReport', () => {
  test('datume YYYY-MM-DD šalje kao d.M.yyyy od ponoći do 23:59:59', async () => {
    expect(await b.call('tring:periodicReport', '2026-01-05', '2026-02-10')).toEqual(OK);
    const { putanja, tijelo } = zadnji();
    expect(putanja).toBe('/spi');
    expect(tag(tijelo, 'VrstaZahtjeva')).toBe('5');
    const parametri = [...tijelo.matchAll(/<Parametar><Naziv>(\w+)<\/Naziv><Vrijednost>([^<]*)<\/Vrijednost>/g)].map(m => [m[1], m[2]]);
    expect(parametri).toEqual([['odDatuma', '5.1.2026 00:00:00'], ['doDatuma', '10.2.2026 23:59:59']]);
  });
});

// ─── tring:getLogs / tring:clearLogs ────────────────────────

describe('tring:getLogs / tring:clearLogs', () => {
  test('uz dev.logging bilježi zahtjev i odgovor; clearLogs prazni log', async () => {
    postavka('dev.logging', 'true');
    const log = console.log;
    console.log = () => undefined; // handler uz dev.logging ispisuje svaki odgovor
    try {
      await provjeriLogove();
    } finally {
      console.log = log;
    }
  });

  async function provjeriLogove() {
    expect(await b.call('tring:clearLogs')).toEqual({ success: true });
    expect(await b.call('tring:getLogs')).toEqual([]);

    await b.call('tring:xReport');
    const logovi = await b.call('tring:getLogs');
    expect(logovi).toHaveLength(1);
    const l = logovi[0];
    expect(Object.keys(l).sort()).toEqual(
      ['durationMs', 'id', 'method', 'parsed', 'path', 'requestXml', 'responseXml', 'statusCode', 'timestamp'].sort()
    );
    expect(l.method).toBe('POST');
    expect(l.path).toBe('/sps');
    expect(l.statusCode).toBe(200);
    expect(l.requestXml).toBe(zadnji().tijelo);
    expect(l.responseXml).toContain('<VrstaOdgovora>OK</VrstaOdgovora>');
    expect(l.parsed).toEqual(OK);
    expect(typeof l.id).toBe('number');
    expect(typeof l.timestamp).toBe('string');

    expect(await b.call('tring:clearLogs')).toEqual({ success: true });
    expect(await b.call('tring:getLogs')).toEqual([]);
  }

  test('bez dev.logging ništa se ne bilježi', async () => {
    await b.call('tring:clearLogs');
    await b.call('tring:xReport');
    expect(await b.call('tring:getLogs')).toEqual([]);
  });
});

// ─── cash:add ───────────────────────────────────────────────

describe('cash:add', () => {
  test('polog šalje UnosNovca (7) na /unosnovca i upisuje zapis sa statusom ok', async () => {
    const r = await b.call('cash:add', { tip: 'polog', iznos: 50.555, korisnikId: ADMIN, napomena: 'jutro' });

    expect(Object.keys(r).sort()).toEqual(['id', 'tringStatus']);
    expect(r.tringStatus).toBe('ok');
    const { putanja, tijelo } = zadnji();
    expect(putanja).toBe('/unosnovca');
    expect(tag(tijelo, 'VrstaZahtjeva')).toBe('7');
    expect(tag(tijelo, 'Oznaka')).toBe('Gotovina');
    expect(tag(tijelo, 'Iznos')).toBe('50.56');
    expect(red('SELECT tip, iznos, korisnikId, tringStatus, napomena FROM cash_movements WHERE id = ?', r.id))
      .toEqual({ tip: 'polog', iznos: 50.56, korisnikId: ADMIN, tringStatus: 'ok', napomena: 'jutro' });
  });

  test('uređaj bez punog naziva komande (404): isti zahtjev ide na kratku putanju', async () => {
    b.tring.bez('/unosnovca');
    b.tring.bez('/povratnovca');

    expect((await b.call('cash:add', { tip: 'polog', iznos: 10, korisnikId: ADMIN })).tringStatus).toBe('ok');
    expect((await b.call('cash:add', { tip: 'povrat', iznos: 5, korisnikId: ADMIN })).tringStatus).toBe('ok');

    expect(b.tring.zahtjevi.map(z => z.putanja)).toEqual(['/unosnovca', '/un', '/povratnovca', '/pn']);
    expect(b.tring.zahtjevi[1].tijelo).toBe(b.tring.zahtjevi[0].tijelo);
  });

  test('povrat šalje PovratNovca (8) na /povratnovca', async () => {
    const r = await b.call('cash:add', { tip: 'povrat', iznos: 20, korisnikId: ADMIN });

    expect(r.tringStatus).toBe('ok');
    expect(zadnji().putanja).toBe('/povratnovca');
    expect(tag(zadnji().tijelo, 'VrstaZahtjeva')).toBe('8');
    expect(tag(zadnji().tijelo, 'Iznos')).toBe('20');
    expect(red('SELECT tip, napomena FROM cash_movements WHERE id = ?', r.id)).toEqual({ tip: 'povrat', napomena: null });
  });

  test('greška uređaja ne sprečava upis — zapis dobije status error', async () => {
    b.tring.greskaNa('/unosnovca', 'Nema papira');
    const r = await b.call('cash:add', { tip: 'polog', iznos: 100, korisnikId: ADMIN });

    // Lažni uređaj šalje poruku u <Odgovor>, ne u <Greska><Broj/>, pa error
    // padne na vrstaOdgovora.
    expect(r).toEqual({ id: r.id, tringStatus: 'error', error: 'Greska' });
    expect(red('SELECT tringStatus FROM cash_movements WHERE id = ?', r.id).tringStatus).toBe('error');
  });

  test('odbija iznos nula ili manji i ništa ne šalje', async () => {
    await expect(b.call('cash:add', { tip: 'polog', iznos: 0, korisnikId: ADMIN })).rejects.toThrow('Iznos mora biti veći od nule');
    await expect(b.call('cash:add', { tip: 'povrat', iznos: -5, korisnikId: ADMIN })).rejects.toThrow('Iznos mora biti veći od nule');
    await expect(b.call('cash:add', { tip: 'polog', iznos: 0.001, korisnikId: ADMIN })).rejects.toThrow('Iznos mora biti veći od nule');
    expect(b.tring.zahtjevi).toHaveLength(0);
    expect(red('SELECT COUNT(*) AS n FROM cash_movements').n).toBe(0);
  });

  test('nepoznat tip se odbija prije slanja uređaju', async () => {
    await expect(b.call('cash:add', { tip: 'xyz', iznos: 10, korisnikId: ADMIN })).rejects.toThrow('Nepoznata vrsta unosa gotovine: xyz');
    expect(b.tring.zahtjevi).toHaveLength(0);
    expect(red('SELECT COUNT(*) AS n FROM cash_movements').n).toBe(0);
  });

  test('korisnikId iz payload-a se ignoriše; bez prijave se odbija prije slanja uređaju', async () => {
    const { id } = await b.call('cash:add', { tip: 'polog', iznos: 10, korisnikId: 999 });
    expect(red('SELECT korisnikId FROM cash_movements WHERE id = ?', id).korisnikId).toBe(ADMIN);
    expect(b.tring.zahtjevi).toHaveLength(1);

    await b.call('user:logout');
    await expect(b.call('cash:add', { tip: 'polog', iznos: 10 })).rejects.toThrow('Niste prijavljeni');
    expect(b.tring.zahtjevi).toHaveLength(1);
    expect(red('SELECT COUNT(*) AS n FROM cash_movements').n).toBe(1);
  });
});

// ─── cash:retry ─────────────────────────────────────────────

describe('cash:retry', () => {
  test('ponovo šalje isti tip i iznos i ažurira status', async () => {
    b.tring.greskaNa('/povratnovca', 'Nema papira');
    const { id } = await b.call('cash:add', { tip: 'povrat', iznos: 12.3, korisnikId: ADMIN });

    // Prvi pokušaj ponovo padne — status ostaje error.
    b.tring.greskaNa('/povratnovca', 'Nema papira');
    expect(await b.call('cash:retry', id)).toEqual({ id, tringStatus: 'error', error: 'Greska' });
    expect(red('SELECT tringStatus FROM cash_movements WHERE id = ?', id).tringStatus).toBe('error');

    const prije = b.tring.zahtjevi.length;
    expect(await b.call('cash:retry', id)).toEqual({ id, tringStatus: 'ok' });
    expect(b.tring.zahtjevi.length).toBe(prije + 1);
    expect(zadnji().putanja).toBe('/povratnovca');
    expect(tag(zadnji().tijelo, 'Iznos')).toBe('12.3');
    expect(red('SELECT tringStatus FROM cash_movements WHERE id = ?', id).tringStatus).toBe('ok');
    expect(red('SELECT COUNT(*) AS n FROM cash_movements').n).toBe(1);
  });

  test('odbija nepostojeći zapis i zapis koji nije pao', async () => {
    await expect(b.call('cash:retry', 999)).rejects.toThrow('Zapis ne postoji');
    const { id } = await b.call('cash:add', { tip: 'polog', iznos: 10, korisnikId: ADMIN });
    const prije = b.tring.zahtjevi.length;
    await expect(b.call('cash:retry', id)).rejects.toThrow('Samo neuspjela slanja se mogu ponoviti');
    expect(b.tring.zahtjevi.length).toBe(prije);
  });
});

// ─── cash:getToday / cash:lastPolog ─────────────────────────

describe('cash:getToday', () => {
  test('vraća današnje zapise po redu, s imenom korisnika', async () => {
    b.db.prepare("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 999, ?, 'ok', '2020-01-01 08:00:00')").run(ADMIN);
    const a = await b.call('cash:add', { tip: 'polog', iznos: 100, korisnikId: ADMIN, napomena: 'jutro' });
    const c = await b.call('cash:add', { tip: 'povrat', iznos: 40, korisnikId: ADMIN });

    const r = await b.call('cash:getToday');
    expect(r.map((x: any) => x.id)).toEqual([a.id, c.id]);
    expect(Object.keys(r[0]).sort()).toEqual(['createdAt', 'id', 'iznos', 'korisnikId', 'korisnikIme', 'napomena', 'tip', 'tringStatus']);
    expect(r[0]).toMatchObject({ tip: 'polog', iznos: 100, korisnikId: ADMIN, korisnikIme: 'Admin', tringStatus: 'ok', napomena: 'jutro' });
    expect(r[1]).toMatchObject({ tip: 'povrat', iznos: 40, napomena: null });
    expect(r[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('bez zapisa vraća praznu listu', async () => {
    expect(await b.call('cash:getToday')).toEqual([]);
  });
});

describe('cash:lastPolog', () => {
  test('null bez pologa, inače iznos zadnjeg pologa bilo kojeg dana', async () => {
    expect(await b.call('cash:lastPolog')).toBeNull();
    b.db.prepare("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 150, ?, 'ok', '2020-01-01 08:00:00')").run(ADMIN);
    expect(await b.call('cash:lastPolog')).toBe(150);

    await b.call('cash:add', { tip: 'povrat', iznos: 30, korisnikId: ADMIN });
    expect(await b.call('cash:lastPolog')).toBe(150);

    b.tring.greskaNa('/unosnovca', 'x'); // i neuspjelo slanje se računa
    await b.call('cash:add', { tip: 'polog', iznos: 80, korisnikId: ADMIN });
    expect(await b.call('cash:lastPolog')).toBe(80);
  });
});

// ─── cash:drawerState ───────────────────────────────────────

describe('cash:drawerState', () => {
  test('prazna ladica', async () => {
    expect(await b.call('cash:drawerState')).toEqual({
      polozi: 0, gotovinskiPromet: 0, povrati: 0, gotovinskeReklamacije: 0, ocekivanoStanje: 0,
    });
  });

  test('polozi + gotovinska prodaja − povrati − gotovinske reklamacije, samo danas', async () => {
    await b.call('cash:add', { tip: 'polog', iznos: 100, korisnikId: ADMIN });
    b.tring.greskaNa('/povratnovca', 'x'); // status error se svejedno računa
    await b.call('cash:add', { tip: 'povrat', iznos: 30, korisnikId: ADMIN });
    b.db.prepare("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, createdAt) VALUES ('polog', 999, ?, 'ok', '2020-01-01 08:00:00')").run(ADMIN);

    dodajRacun(50, 'Gotovina');
    dodajRacun(20, 'Kartica');
    dodajRacun(20, JSON.stringify({ gotovina: 15, kartica: 5 }));
    dodajRacun(10, 'Gotovina', { refundedAt: '2099-01-01 00:00:00' }); // prodan danas; storno nije danas
    dodajRacun(500, 'Gotovina', { createdAt: '2020-01-01 10:00:00' });
    // Prodan ranije, storniran danas — ulazi samo u reklamacije.
    b.db.prepare(`
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, refundedAt, createdAt)
      VALUES (?, 7, 0, 'Gotovina', 'refunded', datetime('now','localtime'), '2020-01-01 10:00:00')
    `).run(ADMIN);
    // Prodan i storniran danas — poništi se.
    b.db.prepare(`
      INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, status, refundedAt)
      VALUES (?, 4, 0, 'Gotovina', 'refunded', datetime('now','localtime'))
    `).run(ADMIN);

    expect(await b.call('cash:drawerState')).toEqual({
      polozi: 100,
      gotovinskiPromet: 79, // 50 + 15 + 10 + 4
      povrati: 30,
      gotovinskeReklamacije: 11, // 7 + 4
      ocekivanoStanje: 138,
    });
  });
});

// ─── dialog:saveFile / fs:writeFile ─────────────────────────

describe('dialog:saveFile / fs:writeFile', () => {
  const filteri = [{ name: 'PDF', extensions: ['pdf'] }];

  test('otkazan dijalog vraća null', async () => {
    b.dijalog.sacuvaj = null;
    expect(await b.call('dialog:saveFile', { defaultName: 'racun.pdf', filters: filteri })).toBeNull();
  });

  test('upis samo na odobrenu putanju i samo jednom', async () => {
    const cilj = path.join(b.radniFolder, 'racun.pdf');
    b.dijalog.sacuvaj = cilj;
    expect(await b.call('dialog:saveFile', { defaultName: 'racun.pdf', filters: filteri })).toBe(cilj);

    const drugi = path.join(b.radniFolder, 'drugi.pdf');
    await expect(b.call('fs:writeFile', { path: drugi, buffer: [1, 2] })).rejects.toThrow('Write path not approved by save dialog');
    expect(existsSync(drugi)).toBe(false);

    expect(await b.call('fs:writeFile', { path: cilj, buffer: [37, 80, 68, 70] })).toEqual({ success: true });
    expect(readFileSync(cilj).toString()).toBe('%PDF');

    await expect(b.call('fs:writeFile', { path: cilj, buffer: [1] })).rejects.toThrow('Write path not approved by save dialog');
    expect(readFileSync(cilj).toString()).toBe('%PDF');
  });

  test('bez dijaloga nema upisa; novo odobrenje poništava staro', async () => {
    const a = path.join(b.radniFolder, 'a.pdf');
    const c = path.join(b.radniFolder, 'c.pdf');
    await expect(b.call('fs:writeFile', { path: a, buffer: [1] })).rejects.toThrow('Write path not approved by save dialog');

    b.dijalog.sacuvaj = a;
    await b.call('dialog:saveFile', { defaultName: 'a.pdf', filters: filteri });
    b.dijalog.sacuvaj = c;
    await b.call('dialog:saveFile', { defaultName: 'c.pdf', filters: filteri });

    await expect(b.call('fs:writeFile', { path: a, buffer: [1] })).rejects.toThrow('Write path not approved by save dialog');
    expect(await b.call('fs:writeFile', { path: c, buffer: [1] })).toEqual({ success: true });
    expect(existsSync(a)).toBe(false);
  });

  test('otkazan dijalog poništava ranije odobrenje', async () => {
    const a = path.join(b.radniFolder, 'a.pdf');
    b.dijalog.sacuvaj = a;
    await b.call('dialog:saveFile', { defaultName: 'a.pdf', filters: filteri });
    b.dijalog.sacuvaj = null;
    expect(await b.call('dialog:saveFile', { defaultName: 'a.pdf', filters: filteri })).toBeNull();

    await expect(b.call('fs:writeFile', { path: a, buffer: [1] })).rejects.toThrow('Write path not approved by save dialog');
    expect(existsSync(a)).toBe(false);
  });
});

// ─── db:backup ──────────────────────────────────────────────

describe('db:backup', () => {
  test('otkazan dijalog vraća null i ne pravi fajl', async () => {
    b.dijalog.sacuvaj = null;
    expect(await b.call('db:backup')).toBeNull();
    expect(readdirSync(b.radniFolder)).toEqual([]);
  });

  test('kopira bazu, sa svježim podacima, na odabranu putanju', async () => {
    b.db.prepare("INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa) VALUES ('B1', 'Backup artikal', 'kom', 3, 'E')").run();
    const cilj = path.join(b.radniFolder, 'kopija.db');
    b.dijalog.sacuvaj = cilj;

    expect(await b.call('db:backup')).toBe(cilj);
    const kopija = new Database(cilj, { readonly: true });
    try {
      expect(kopija.prepare("SELECT naziv FROM products WHERE sifra = 'B1'").get()).toEqual({ naziv: 'Backup artikal' });
      expect(kopija.prepare('SELECT ime FROM users WHERE id = 1').get()).toEqual({ ime: 'Admin' });
    } finally {
      kopija.close();
    }
  });

  test('kopija je samostalan fajl: DELETE journal mode, bez -wal/-shm, otvara se read-only', async () => {
    const cilj = path.join(b.radniFolder, 'kopija.db');
    // Ostaci ranijeg fajla na istoj putanji ne smiju se primijeniti na novu kopiju.
    writeFileSync(`${cilj}-wal`, 'stari wal');
    b.dijalog.sacuvaj = cilj;

    await b.call('db:backup');

    expect([...readFileSync(cilj).subarray(18, 20)]).toEqual([1, 1]); // 2, 2 = WAL
    expect(readdirSync(b.radniFolder)).toEqual(['kopija.db']);
    const kopija = new Database(cilj, { readonly: true });
    try {
      expect(kopija.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
      expect(kopija.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    } finally {
      kopija.close();
    }
  });

  test('dijalog predlaže datirani naziv i filter za .db', async () => {
    b.dijalog.sacuvaj = null;
    await b.call('db:backup');
    expect(b.otvoreniDijalozi).toHaveLength(1);
    expect(b.otvoreniDijalozi[0].vrsta).toBe('sacuvaj');
    expect(b.otvoreniDijalozi[0].opcije.defaultPath).toMatch(/^kasa-backup-\d{4}-\d{2}-\d{2}\.db$/);
    expect(b.otvoreniDijalozi[0].opcije.filters).toEqual([{ name: 'SQLite Database', extensions: ['db'] }]);
  });

  test('backup ne odobrava fs:writeFile na istu putanju', async () => {
    const cilj = path.join(b.radniFolder, 'kopija.db');
    b.dijalog.sacuvaj = cilj;
    await b.call('db:backup');
    await expect(b.call('fs:writeFile', { path: cilj, buffer: [1] })).rejects.toThrow('Write path not approved by save dialog');
  });
});

// ─── db:restore ─────────────────────────────────────────────

describe('db:restore', () => {
  async function napraviBackup(): Promise<string> {
    const cilj = path.join(b.radniFolder, 'backup.db');
    b.dijalog.sacuvaj = cilj;
    await b.call('db:backup');
    return cilj;
  }

  function brojArtikala(): number {
    return red('SELECT COUNT(*) AS n FROM products').n;
  }

  function sigurnosneKopije(): string[] {
    return readdirSync(path.dirname(b.radniFolder)).filter(f => f.startsWith('kasa-prije-uvoza-'));
  }

  test('uvoz fajla napravljenog kroz db:backup vrati podatke iz backup-a', async () => {
    b.db.prepare("INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa) VALUES ('B1', 'Iz backup-a', 'kom', 3, 'E')").run();
    const backup = await napraviBackup();
    b.db.prepare("DELETE FROM products WHERE sifra = 'B1'").run();
    b.dijalog.otvori = backup;
    b.dijalog.potvrda = 1;

    expect((await b.call('db:restore')).source).toBe(backup);

    const aktivna = aktivnaBaza();
    try {
      expect(aktivna.prepare("SELECT naziv FROM products WHERE sifra = 'B1'").get()).toEqual({ naziv: 'Iz backup-a' });
    } finally {
      aktivna.close();
    }
    // Restart ide s odgodom — sačekaj ga da ne padne u sljedeći test.
    await Bun.sleep(700);
    expect(b.restartovan()).toBe(true);
  });

  test('prihvata stari backup u WAL modu (goli copyFileSync aktivne baze) i ne ostavlja -wal/-shm pored njega', async () => {
    const backup = path.join(b.radniFolder, 'stari-backup.db');
    b.db.prepare("INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa) VALUES ('S1', 'Stari', 'kom', 1, 'E')").run();
    b.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    copyFileSync(path.join(path.dirname(b.radniFolder), 'kasa.db'), backup);
    expect([...readFileSync(backup).subarray(18, 20)]).toEqual([2, 2]);
    const prije = readFileSync(backup);
    b.db.prepare("DELETE FROM products WHERE sifra = 'S1'").run();
    b.dijalog.otvori = backup;
    b.dijalog.potvrda = 1;

    expect((await b.call('db:restore')).source).toBe(backup);

    expect(readdirSync(b.radniFolder)).toEqual(['stari-backup.db']);
    expect(readFileSync(backup).equals(prije)).toBe(true);
    const aktivna = aktivnaBaza();
    try {
      expect(aktivna.prepare("SELECT naziv FROM products WHERE sifra = 'S1'").get()).toEqual({ naziv: 'Stari' });
    } finally {
      aktivna.close();
    }
    // Restart ide s odgodom — sačekaj ga da ne padne u sljedeći test.
    await Bun.sleep(700);
    expect(b.restartovan()).toBe(true);
  });

  test('otkazan izbor fajla vraća null', async () => {
    b.dijalog.otvori = null;
    b.dijalog.potvrda = 1;
    expect(await b.call('db:restore')).toBeNull();
    expect(sigurnosneKopije()).toEqual([]);
    expect(b.restartovan()).toBe(false);
  });

  test('odbija fajl koji nije SQLite baza', async () => {
    const los = path.join(b.radniFolder, 'nije-baza.db');
    writeFileSync(los, 'ovo nije baza '.repeat(100));
    b.dijalog.otvori = los;
    b.dijalog.potvrda = 1;
    await expect(b.call('db:restore')).rejects.toThrow('Neispravan backup fajl:');
    expect(sigurnosneKopije()).toEqual([]);
    expect(b.restartovan()).toBe(false);
  });

  test('odbija SQLite bazu koja nije Kasa baza i navodi tabele koje fale', async () => {
    const tudja = path.join(b.radniFolder, 'tudja.db');
    const t = new Database(tudja);
    t.exec('CREATE TABLE users (id INTEGER)');
    t.close();
    b.dijalog.otvori = tudja;
    b.dijalog.potvrda = 1;
    await expect(b.call('db:restore'))
      .rejects.toThrow('Neispravan backup fajl: Fajl nije backup Kasa baze (nedostaje: products, orders).');
    expect(sigurnosneKopije()).toEqual([]);
  });

  test('odbija backup s triggerom, view-om ili tabelom koje nema u shemi — prije potvrde', async () => {
    for (const [dodatak, poruka] of [
      ['CREATE TRIGGER t AFTER INSERT ON orders BEGIN DELETE FROM orders; END;', 'Fajl sadrži trigger ili view (trigger t), a Kasa baza ih nema.'],
      ['CREATE VIEW v AS SELECT 1;', 'Fajl sadrži trigger ili view (view v), a Kasa baza ih nema.'],
      ['CREATE TABLE tajna (x);', 'Fajl sadrži tabele kojih nema u Kasa bazi: tajna.'],
    ]) {
      const backup = await napraviBackup();
      const t = new Database(backup);
      t.exec(dodatak);
      t.close();
      b.dijalog.otvori = backup;
      b.dijalog.potvrda = 1;
      b.otvoreniDijalozi.length = 0;
      await expect(b.call('db:restore')).rejects.toThrow(`Neispravan backup fajl: ${poruka}`);
      expect(b.otvoreniDijalozi.map(d => d.vrsta)).toEqual(['otvori']);
    }
    expect(sigurnosneKopije()).toEqual([]);
    expect(b.restartovan()).toBe(false);
  });

  test('odbija nepostojeći fajl', async () => {
    b.dijalog.otvori = path.join(b.radniFolder, 'nema.db');
    b.dijalog.potvrda = 1;
    await expect(b.call('db:restore')).rejects.toThrow('Neispravan backup fajl:');
  });

  test('"Otkaži" u potvrdi vraća null i ne dira bazu', async () => {
    const backup = await napraviBackup();
    b.db.prepare("INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa) VALUES ('N1', 'Novi', 'kom', 1, 'E')").run();
    b.dijalog.otvori = backup;
    b.dijalog.potvrda = 0;

    expect(await b.call('db:restore')).toBeNull();
    expect(brojArtikala()).toBe(1);
    expect(sigurnosneKopije()).toEqual([]);
    expect(b.restartovan()).toBe(false);
  });

  test('odbija uvoz trenutno aktivne baze', async () => {
    b.dijalog.otvori = path.join(path.dirname(b.radniFolder), 'kasa.db');
    b.dijalog.potvrda = 1;
    await expect(b.call('db:restore')).rejects.toThrow('Odabrana je trenutno aktivna baza, ne backup fajl.');
    expect(sigurnosneKopije()).toEqual([]);
    await Bun.sleep(700);
    expect(b.restartovan()).toBe(false);
  });

  test('"Uvezi i restartuj" zamijeni bazu, sačuva sigurnosnu kopiju i restartuje', async () => {
    const backup = await napraviBackup();
    b.db.prepare("INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa) VALUES ('N1', 'Novi', 'kom', 1, 'E')").run();
    b.dijalog.otvori = backup;
    b.dijalog.potvrda = 1;

    const r = await b.call('db:restore');
    expect(Object.keys(r).sort()).toEqual(['safetyPath', 'source']);
    expect(r.source).toBe(backup);
    expect(path.dirname(r.safetyPath)).toBe(path.dirname(b.radniFolder));
    expect(path.basename(r.safetyPath)).toMatch(/^kasa-prije-uvoza-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/);

    // Sigurnosna kopija ima stanje prije uvoza, aktivna baza stanje iz backup-a.
    // Sigurnosna kopija je samostalan fajl kao i backup — otvara se read-only.
    expect([...readFileSync(r.safetyPath).subarray(18, 20)]).toEqual([1, 1]);
    const kopija = new Database(r.safetyPath, { readonly: true });
    const aktivna = aktivnaBaza();
    try {
      expect(kopija.prepare("SELECT COUNT(*) AS n FROM products WHERE sifra = 'N1'").get()).toEqual({ n: 1 });
      expect(aktivna.prepare("SELECT COUNT(*) AS n FROM products WHERE sifra = 'N1'").get()).toEqual({ n: 0 });
      expect(aktivna.prepare('SELECT ime FROM users WHERE id = 1').get()).toEqual({ ime: 'Admin' });
    } finally {
      kopija.close();
      aktivna.close();
    }

    // Restart ide s odgodom, da renderer stigne dobiti odgovor.
    expect(b.restartovan()).toBe(false);
    await Bun.sleep(700);
    expect(b.restartovan()).toBe(true);
  });
});
