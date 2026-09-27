import { test, expect, beforeEach, describe } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import { fiskalizuj, porukaNakonStampe, uToku, type FiskalizacijaDeps } from './fiskalizacija';
import { vecEvidentiranStorno } from './pendingRacun';
import type { IshodUredjaja } from './fiskalniUredjaj';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza({ kasir: true });
});

const deps = (): FiskalizacijaDeps => ({ db, transaction: fn => db.transaction(fn) });

const OK: IshodUredjaja = { ok: true, bf: '101', odgovori: { BrojFiskalnogRacuna: '101' } };
const snapshot = { korisnikId: 1, ukupno: 5, nacinPlacanja: 'Gotovina' };

function pending(): Array<{ id: number; korisnikId: number; snapshot: string }> {
  return db.prepare('SELECT id, korisnikId, snapshot FROM pending_receipts').all() as Array<{ id: number; korisnikId: number; snapshot: string }>;
}

/** Upis koji zabilježi račun (orders) i vrati njegov id. */
function upisiRacun(bf: string | null): number {
  return Number(db.prepare(
    "INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status) VALUES (1, 5, 0.73, 'Gotovina', ?, 'completed')"
  ).run(bf).lastInsertRowid);
}

const brojRacuna = () => (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;

describe('fiskalizuj', () => {
  test('write-ahead prije štampe; uspjeh upisuje s brojem sa uređaja i briše red', async () => {
    let redTokomStampe: unknown[] = [];
    const r = await fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => { redTokomStampe = pending(); return OK; },
      upisi: upisiRacun,
    });

    expect(redTokomStampe).toEqual([{ id: expect.any(Number), korisnikId: 1, snapshot: JSON.stringify(snapshot) }]);
    expect(r).toEqual({ success: true, id: 1, brojFiskalnogRacuna: '101', odgovori: { BrojFiskalnogRacuna: '101' } });
    expect((db.prepare('SELECT brojFiskalnogRacuna FROM orders').get() as { brojFiskalnogRacuna: string }).brojFiskalnogRacuna).toBe('101');
    expect(pending()).toEqual([]);
  });

  test('siguran neuspjeh briše red i ništa ne upisuje', async () => {
    let upisano = false;
    const r = await fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => ({ ok: false, greska: 'Nema papira [12]', nepoznat: false, odgovori: {} }),
      upisi: () => { upisano = true; return 0; },
    });
    expect(r).toEqual({ success: false, error: 'Nema papira [12]', odgovori: {} });
    expect(upisano).toBe(false);
    expect(pending()).toEqual([]);
  });

  test('nepoznat ishod ostavlja red za dijalog nezavršenih računa', async () => {
    const r = await fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => ({ ok: false, greska: 'Request timed out', nepoznat: true }),
      upisi: upisiRacun,
    });
    expect(r).toMatchObject({ success: false, ishodNepoznat: true, odgovori: {} });
    expect((r as { error: string }).error).toContain('Request timed out');
    expect(pending()).toHaveLength(1);
    expect(brojRacuna()).toBe(0);
  });

  test('izuzetak iz štampe: ništa nije odštampano — red se briše, greška ide dalje', async () => {
    await expect(fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => { throw new Error('mreža nedostupna'); },
      upisi: upisiRacun,
    })).rejects.toThrow('mreža nedostupna');
    expect(pending()).toEqual([]);
  });

  test('red riješen iz dijaloga dok je štampa trajala: bez drugog zapisa', async () => {
    let upisano = false;
    const r = await fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => { db.prepare('DELETE FROM pending_receipts').run(); return OK; },
      upisi: () => { upisano = true; return 0; },
    });
    expect(r).toMatchObject({ success: false, vecEvidentiran: true, brojFiskalnogRacuna: '101' });
    expect((r as { error: string }).error).toContain('Fiskalni račun BF 101 JE odštampan');
    expect(upisano).toBe(false);

    const storno = await fiskalizuj(deps(), {
      snapshot,
      stampaj: async () => { db.prepare('DELETE FROM pending_receipts').run(); return { ok: true, bf: 'R-1', odgovori: {} }; },
      upisi: () => 0,
      vecEvidentiran: vecEvidentiranStorno,
    });
    expect((storno as { error: string }).error).toContain('Reklamacija #R-1 JE odštampana');
  });

  test('upis pao nakon štampe: transakcija se poništi, red ostaje, poruka kaže da je odštampan', async () => {
    db.exec("CREATE TRIGGER blokiraj BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT, 'upis blokiran'); END");
    const upisi = (bf: string | null) => {
      const id = upisiRacun(bf);
      db.prepare("INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, 1, 1, 5, 0, 'E')").run(id);
      return id;
    };

    await expect(fiskalizuj(deps(), { snapshot, stampaj: async () => OK, upisi })).rejects.toThrow(
      'Račun 101 JE odštampan, ali nije zabilježen u bazi: upis blokiran. Riješite ga kroz nezavršene račune.',
    );
    expect(brojRacuna()).toBe(0);
    expect(pending()).toHaveLength(1);

    // Vlastiti naziv dokumenta (i ženski rod za reklamaciju) — ista poruka.
    await expect(fiskalizuj(deps(), {
      snapshot, stampaj: async () => OK, upisi, dokument: bf => `Reklamacija #${bf}`, rod: 'ž',
    })).rejects.toThrow('Reklamacija #101 JE odštampana, ali nije zabilježena u bazi: upis blokiran. Riješite je kroz nezavršene račune.');
    expect(pending()).toHaveLength(2);
    expect(porukaNakonStampe('Fiskalni račun po prilogu br. 7 (BF 7)', 'x'))
      .toBe('Fiskalni račun po prilogu br. 7 (BF 7) JE odštampan, ali nije zabilježen u bazi: x. Riješite ga kroz nezavršene račune.');
  });

  test('uređaj bez broja: "?" u poruci, null u odgovoru', async () => {
    const bezBroja: IshodUredjaja = { ok: true, bf: null, odgovori: {} };
    expect(await fiskalizuj(deps(), { snapshot, stampaj: async () => bezBroja, upisi: upisiRacun }))
      .toMatchObject({ success: true, brojFiskalnogRacuna: null });
    await expect(fiskalizuj(deps(), {
      snapshot, stampaj: async () => bezBroja, upisi: () => { throw new Error(''); },
    })).rejects.toThrow('Račun ? JE odštampan, ali nije zabilježen u bazi: nepoznata greška.');
  });
});

describe('uToku', () => {
  test('drugi poziv za isti ključ se odbija dok prvi traje; drugi ključ prolazi; ključ se oslobodi i uz grešku', async () => {
    let pusti!: () => void;
    const prvi = uToku('ponuda:1', 'Konverzija ove ponude je već u toku', () => new Promise<string>(r => { pusti = () => r('prvi'); }));

    await expect(uToku('ponuda:1', 'Konverzija ove ponude je već u toku', async () => 'drugi'))
      .rejects.toThrow('Konverzija ove ponude je već u toku');
    expect(await uToku('ponuda:2', 'x', async () => 'druga ponuda')).toBe('druga ponuda');

    pusti();
    expect(await prvi).toBe('prvi');
    expect(await uToku('ponuda:1', 'x', async () => 'ponovo')).toBe('ponovo');

    await expect(uToku('nalog:1', 'x', () => { throw new Error('provjera pala'); })).rejects.toThrow('provjera pala');
    expect(await uToku('nalog:1', 'x', async () => 'slobodan')).toBe('slobodan');
  });
});
