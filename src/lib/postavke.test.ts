// lib/postavke.ts nad pravom SQLite bazom s produkcijskom šemom. Kanali
// (settings:*, proizvodnja:setEnabled) su u ugovoru oba backenda
// (src/ipc/ugovor/korisnici-postavke.ugovor.test.ts, audit.ugovor.test.ts).
import { test, expect, beforeEach, describe } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { procitajPostavku, procitajGrupu, upisiPostavke } from './postavke';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
});

function postavi(kljuc: string, vrijednost: string | null) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(kljuc, vrijednost);
}

describe('procitajPostavku', () => {
  test('vrijednost ključa; nepostojeći ključ i NULL daju null, prazan tekst ostaje prazan', () => {
    postavi('racun.napomena', 'Hvala');
    postavi('kasa.prazno', '');
    postavi('kasa.null', null);
    expect(procitajPostavku(db, 'racun.napomena')).toBe('Hvala');
    expect(procitajPostavku(db, 'kasa.prazno')).toBe('');
    expect(procitajPostavku(db, 'kasa.null')).toBeNull();
    expect(procitajPostavku(db, 'nema.ga')).toBeNull();
  });
});

describe('procitajGrupu', () => {
  test('ključevi grupe bez prefiksa; druge grupe se ne vide', () => {
    postavi('firma.naziv', 'Firma d.o.o.');
    postavi('firma.bank1.name', 'Banka');
    postavi('firmaX.naziv', 'ne');
    postavi('tring.host', 'localhost');
    expect(procitajGrupu(db, 'firma')).toEqual({ naziv: 'Firma d.o.o.', 'bank1.name': 'Banka' });
    expect(procitajGrupu(db, 'nema')).toEqual({});
  });

  test('ključ drugačijih velikih slova (SQLite LIKE ih ne razlikuje) ne prepisuje pravi ključ', () => {
    postavi('firma.naziv', 'Prava');
    postavi('FIRMA.naziv', 'Lažna');
    expect(procitajGrupu(db, 'firma').naziv).toBe('Prava');
  });
});

describe('upisiPostavke', () => {
  const trag: Array<[string, Record<string, unknown>]> = [];
  const audit = (akcija: string, detalji: Record<string, unknown>) => { trag.push([akcija, detalji]); };
  beforeEach(() => { trag.length = 0; });

  test('upisuje nove i prepisuje postojeće ključeve; vraća samo promijenjene', () => {
    postavi('tring.host', 'localhost');
    postavi('tring.port', '8085');
    const promjene = upisiPostavke(db, [['tring.host', '10.0.0.5'], ['tring.port', '8085'], ['tring.operatorId', '3']]);
    expect(promjene).toEqual([
      { kljuc: 'tring.host', staraVrijednost: 'localhost', novaVrijednost: '10.0.0.5' },
      { kljuc: 'tring.operatorId', staraVrijednost: null, novaVrijednost: '3' },
    ]);
    expect(procitajGrupu(db, 'tring')).toEqual({ host: '10.0.0.5', port: '8085', operatorId: '3' });
  });

  test('trag: jedan zapis s listom promjena; ključevi bez vrijednosti samo kao "promijenjena"', () => {
    postavi('tring.operatorPassword', 'stara');
    upisiPostavke(db, [['tring.host', 'h'], ['tring.operatorPassword', 'tajna']], {
      audit, akcija: 'postavke:tring', bezVrijednosti: new Set(['tring.operatorPassword']),
    });
    expect(trag).toEqual([['postavke:tring', { promjene: [
      { kljuc: 'tring.host', staraVrijednost: null, novaVrijednost: 'h' },
      { kljuc: 'tring.operatorPassword', promijenjena: true },
    ] }]]);
  });

  test('bez promjene nema traga, a upis je ipak tu', () => {
    postavi('firma.naziv', 'Ista');
    expect(upisiPostavke(db, [['firma.naziv', 'Ista']], { audit, akcija: 'postavke:firma' })).toEqual([]);
    expect(trag).toEqual([]);
    expect(procitajPostavku(db, 'firma.naziv')).toBe('Ista');
  });

  test('stare vrijednosti se čitaju prije upisa (i kad trag traži samo prvu promjenu)', () => {
    const [promjena] = upisiPostavke(db, [['racun.napomena', 'Hvala']]);
    expect(promjena).toEqual({ kljuc: 'racun.napomena', staraVrijednost: null, novaVrijednost: 'Hvala' });
    expect(upisiPostavke(db, [['racun.napomena', 'Hvala!']])).toEqual([
      { kljuc: 'racun.napomena', staraVrijednost: 'Hvala', novaVrijednost: 'Hvala!' },
    ]);
  });
});
