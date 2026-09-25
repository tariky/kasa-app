// Ugovor za audit log: koje radnje ostavljaju trag u tabeli audit_log, s
// kojim korisnikom (iz sesije) i kojim detaljima. Log je samo za upis — nema
// kanala za čitanje, izmjenu ni brisanje. Detalji nikad ne sadrže PIN ni heš.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import path from 'node:path';
import { otvoriBackend, prijavi, ADMIN_PIN, type Backend } from './backend';
import { hesirajPin } from '../../lib/korisnici';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1;

interface Zapis { korisnikId: number | null; akcija: string; detalji: any }

function audit(db: Database = b.db): Zapis[] {
  return (db.prepare('SELECT korisnikId, akcija, detalji, createdAt FROM audit_log ORDER BY id').all() as any[])
    .map(r => {
      expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      return { korisnikId: r.korisnikId, akcija: r.akcija, detalji: JSON.parse(r.detalji) };
    });
}

function red(sql: string, ...params: any[]): any {
  return b.db.prepare(sql).get(...params);
}

function dodajArtikal(sifra: string, cijena: number): number {
  return Number(b.db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, plu) VALUES (?, ?, 'kom', ?, 'E', 1)"
  ).run(sifra, `Artikal ${sifra}`, cijena).lastInsertRowid);
}

function dodajKorisnika(ime: string, pin: string, uloga: 'admin' | 'kasir' = 'kasir'): number {
  return Number(b.db.prepare('INSERT INTO users (ime, pin, uloga) VALUES (?, ?, ?)').run(ime, hesirajPin(pin), uloga).lastInsertRowid);
}

function sada(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function rucniRacun(broj: string, cijena = 3): Promise<number> {
  const p = dodajArtikal(`R${broj}`, cijena);
  return (await b.call('order:createManual', {
    nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: broj, createdAt: '2026-09-01 10:00:00',
    stavke: [{ productId: p, kolicina: 1, cijena, rabat: 0, pdvStopa: 'E' }],
  })).id;
}

describe('audit_log', () => {
  test('nova baza ima praznu tabelu audit_log(id, createdAt, korisnikId, akcija, detalji)', async () => {
    const kolone = (b.db.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[]).map(k => k.name);
    expect(kolone).toEqual(['id', 'createdAt', 'korisnikId', 'akcija', 'detalji']);
    expect(audit()).toEqual([]);
  });

  test('nema kanala za čitanje, izmjenu ni brisanje loga', async () => {
    expect((await b.kanali()).filter(k => /audit/i.test(k))).toEqual([]);
  });

  test('order:createManual → racun:rucni', async () => {
    const id = await rucniRacun('77');
    expect(audit()).toEqual([{ korisnikId: ADMIN, akcija: 'racun:rucni', detalji: { orderId: id, brojFiskalnogRacuna: '77', ukupno: 3, createdAt: '2026-09-01 10:00:00' } }]);
  });

  test('storno → storno, s adminom koji je odobrio PIN-om', async () => {
    const id = await rucniRacun('55');
    const kasir = dodajKorisnika('Kasir', '1234');
    const berina = dodajKorisnika('Berina', '1111', 'admin');
    b.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('kasa.requirePinRefund', 'true')").run();
    await prijavi(b, '1234');
    await expect(b.call('order:refundAndPrint', { id, adminPin: '9999' })).rejects.toThrow('Neispravan admin PIN');
    const r = await b.call('order:refundAndPrint', { id, adminPin: '1111' });
    expect(r.success).toBe(true);
    expect(audit().slice(1)).toEqual([{
      korisnikId: kasir, akcija: 'storno',
      detalji: { orderId: id, brojFiskalnogRacuna: '55', brojReklamacije: r.brojReklamacije, ukupno: 3, odobrioAdminId: berina, pologIznos: 0 },
    }]);
  });

  test('neuspjela štampa storna ne ostavlja trag', async () => {
    const id = await rucniRacun('56');
    b.tring.greskaNa('/srr', 'Nema papira');
    expect((await b.call('order:refundAndPrint', { id })).success).toBe(false);
    expect(audit().map(z => z.akcija)).toEqual(['racun:rucni']);
  });

  test('product:adjustStock → zaliha:korekcija; bez promjene nema zapisa', async () => {
    const p = dodajArtikal('Z1', 2);
    await b.call('product:adjustStock', p, 7);
    await b.call('product:adjustStock', p, 7);
    await b.call('product:adjustStock', p, 4.5);
    for (const lose of ['9', null]) await expect(b.call('product:adjustStock', p, lose)).rejects.toThrow('Stanje mora biti broj');
    expect(audit()).toEqual([
      { korisnikId: ADMIN, akcija: 'zaliha:korekcija', detalji: { productId: p, staroStanje: 0, novoStanje: 7 } },
      { korisnikId: ADMIN, akcija: 'zaliha:korekcija', detalji: { productId: p, staroStanje: 7, novoStanje: 4.5 } },
    ]);
  });

  test('promjena cijene artikla (product:update) → artikal:cijena; ostale izmjene ne', async () => {
    const p = dodajArtikal('C1', 10);
    await b.call('product:update', p, { naziv: 'Novi naziv' });
    await b.call('product:update', p, { cijena: 10 });
    await b.call('product:update', p, { cijena: 12.5 });
    expect(audit()).toEqual([{ korisnikId: ADMIN, akcija: 'artikal:cijena', detalji: { productId: p, staraCijena: 10, novaCijena: 12.5 } }]);
  });

  test('settings:set i proizvodnja:setEnabled → postavke:set sa starom i novom vrijednošću', async () => {
    await b.call('settings:set', 'racun.napomena', 'Hvala');
    await b.call('settings:set', 'racun.napomena', 'Hvala!');
    await b.call('proizvodnja:setEnabled', true);
    await expect(b.call('settings:set', 'tring.host', 'x')).rejects.toThrow('se ne može mijenjati');
    expect(audit()).toEqual([
      { korisnikId: ADMIN, akcija: 'postavke:set', detalji: { kljuc: 'racun.napomena', staraVrijednost: null, novaVrijednost: 'Hvala' } },
      { korisnikId: ADMIN, akcija: 'postavke:set', detalji: { kljuc: 'racun.napomena', staraVrijednost: 'Hvala', novaVrijednost: 'Hvala!' } },
      { korisnikId: ADMIN, akcija: 'postavke:set', detalji: { kljuc: 'proizvodnja.enabled', staraVrijednost: null, novaVrijednost: 'true' } },
    ]);
  });

  test('settings:saveFirma → postavke:firma s promijenjenim ključevima (logo bez sadržaja)', async () => {
    const firma = {
      naziv: 'Firma', adresa: 'Titova 1', grad: 'Sarajevo', idBroj: '4200000000001', pdvBroj: '', skladiste: '', logo: 'data:image/png;base64,AAAA',
      bankAccounts: [{ bankName: 'Banka', accountNumber: '1234' }],
    };
    await b.call('settings:saveFirma', firma);
    await b.call('settings:saveFirma', { ...firma, bankAccounts: [{ bankName: 'Banka', accountNumber: '9999' }], logo: 'data:image/png;base64,BBBB' });
    const [, druga] = audit();
    expect(druga).toEqual({
      korisnikId: ADMIN, akcija: 'postavke:firma',
      detalji: { promjene: [
        { kljuc: 'firma.logo', promijenjena: true },
        { kljuc: 'firma.bank1.number', staraVrijednost: '1234', novaVrijednost: '9999' },
      ] },
    });
    expect(audit()[0].detalji.promjene).toContainEqual({ kljuc: 'firma.naziv', staraVrijednost: null, novaVrijednost: 'Firma' });
  });

  test('settings:saveTring → postavke:tring; lozinka samo kao "promijenjena"', async () => {
    await b.call('settings:saveTring', { host: '10.0.0.5', port: 8085, operatorId: 3, operatorPassword: 'tajna123' });
    const [z] = audit();
    expect(z.akcija).toBe('postavke:tring');
    expect(z.detalji.promjene).toContainEqual({ kljuc: 'tring.host', staraVrijednost: 'localhost', novaVrijednost: '10.0.0.5' });
    expect(z.detalji.promjene).toContainEqual({ kljuc: 'tring.operatorId', staraVrijednost: '0', novaVrijednost: '3' });
    expect(z.detalji.promjene).toContainEqual({ kljuc: 'tring.operatorPassword', promijenjena: true });
    expect(JSON.stringify(z.detalji)).not.toContain('tajna123');
  });

  test('fiscal:setZadnjiBroj, order:dismissFiscalGap, pending:discard', async () => {
    await b.call('fiscal:setZadnjiBroj', 100);
    await b.call('fiscal:setZadnjiBroj', 120);
    await b.call('order:dismissFiscalGap', 7);
    const snapshot = { korisnikId: ADMIN, ukupno: 5, nacinPlacanja: 'Gotovina', stavke: [] };
    const pid = Number(b.db.prepare('INSERT INTO pending_receipts (korisnikId, snapshot) VALUES (?, ?)').run(ADMIN, JSON.stringify(snapshot)).lastInsertRowid);
    await b.call('pending:discard', pid);
    await b.call('pending:discard', pid);
    expect(audit()).toEqual([
      { korisnikId: ADMIN, akcija: 'fiskalni:zadnjiBroj', detalji: { stariBroj: null, noviBroj: 100 } },
      { korisnikId: ADMIN, akcija: 'fiskalni:zadnjiBroj', detalji: { stariBroj: 100, noviBroj: 120 } },
      { korisnikId: ADMIN, akcija: 'fiskalni:odbaciPrazninu', detalji: { broj: 7 } },
      { korisnikId: ADMIN, akcija: 'pending:odbaci', detalji: { pendingId: pid, snapshot } },
    ]);
  });

  test('user:create/update/delete i promjena svog PIN-a — bez PIN-a i heša u detaljima', async () => {
    const { id } = await b.call('user:create', { ime: 'Kasir', pin: '4321', uloga: 'kasir' });
    await b.call('user:update', id, { pin: '5678' });
    await b.call('user:update', id, { ime: 'Kasir 2', uloga: 'admin', pin: '' });
    await b.call('user:update', id, {});
    await expect(b.call('user:create', { ime: 'Dupli', pin: '5678', uloga: 'kasir' })).rejects.toThrow('već postoji');
    await prijavi(b, '5678');
    await b.call('user:promijeniSvojPin', '5678', '8765');
    await prijavi(b, ADMIN_PIN);
    await b.call('user:delete', id);

    const zapisi = audit();
    expect(zapisi).toEqual([
      { korisnikId: ADMIN, akcija: 'korisnik:create', detalji: { id, ime: 'Kasir', uloga: 'kasir' } },
      { korisnikId: ADMIN, akcija: 'korisnik:update', detalji: { id, pinPromijenjen: true } },
      { korisnikId: ADMIN, akcija: 'korisnik:update', detalji: { id, ime: 'Kasir 2', uloga: 'admin', pinPromijenjen: false } },
      { korisnikId: id, akcija: 'korisnik:promjenaPina', detalji: { id } },
      { korisnikId: ADMIN, akcija: 'korisnik:delete', detalji: { id, ime: 'Kasir 2', uloga: 'admin' } },
    ]);
    const tekst = JSON.stringify(b.db.prepare('SELECT * FROM audit_log').all());
    for (const tajna of ['4321', '5678', '8765', ADMIN_PIN, 'pbkdf2$']) expect(tekst).not.toContain(tajna);
  });

  test('db:restore → baza:restore, upisano u uvezenu bazu', async () => {
    const backup = path.join(b.radniFolder, 'backup.db');
    b.dijalog.sacuvaj = backup;
    await b.call('db:backup');
    b.dijalog.otvori = backup;
    b.dijalog.potvrda = 1;
    const r = await b.call('db:restore');
    const aktivna = new Database(path.join(path.dirname(b.radniFolder), 'kasa.db'), { readonly: true });
    try {
      expect(audit(aktivna)).toEqual([{ korisnikId: ADMIN, akcija: 'baza:restore', detalji: { izvor: backup, sigurnosnaKopija: r.safetyPath } }]);
    } finally {
      aktivna.close();
    }
    await Bun.sleep(700);
  });
});
