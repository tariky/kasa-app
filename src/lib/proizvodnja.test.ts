// Čiste funkcije proizvodnje koje koriste ekrani (broj naloga, stavke iz
// normativa, kalkulacija) i rubni slučajevi koje ugovor ne pokriva. Kanali
// nalog:* i normativ:* su u ugovoru oba backenda (ugovor/proizvodnja.ugovor.test.ts).
import { test, expect, beforeEach } from 'bun:test';
import { testnaBaza, type TestnaBaza } from './testnaBaza';
import {
  formatBrojNaloga, createNalog, replaceStavke, getNalog, kalkulacija, zavrsiNalog, vratiUIzradu, stavkeIzNormativa,
} from './proizvodnja';

let db: TestnaBaza;

beforeEach(() => {
  db = testnaBaza();
  db.prepare("INSERT INTO users (id, ime, pin, uloga) VALUES (1, 'Admin', '0000', 'admin')").run();
});

function dodajMaterijal(sifra: string): number {
  return Number(db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', 0, 'E', 'materijal')"
  ).run(sifra, `Materijal ${sifra}`).lastInsertRowid);
}
function dodajArtikal(sifra: string): number {
  return Number(db.prepare(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip) VALUES (?, ?, 'kom', 100, 'E', 'artikal')"
  ).run(sifra, `Proizvod ${sifra}`).lastInsertRowid);
}

test('formatBrojNaloga: zadani format RN-broj/godina, prefiks i cifre iz postavki', () => {
  expect(formatBrojNaloga({ broj: 2, godina: 2026 })).toBe('RN-2/2026');
  expect(formatBrojNaloga({ broj: 2, godina: 2026 }, { prefiks: 'NAL ', cifara: 0 })).toBe('NAL 2/2026');
  expect(formatBrojNaloga({ broj: 2, godina: 2026 }, { prefiks: '', cifara: 0 })).toBe('2/2026');
});

test('stavkeIzNormativa: normativ × količina na 4 decimale, s napomenom', () => {
  expect(stavkeIzNormativa([
    { materijalId: 3, kolicina: 1.25, napomena: 'korpus' },
    { materijalId: 4, kolicina: 0.33333 },
  ], 3)).toEqual([
    { materijalId: 3, kolicina: 3.75, napomena: 'korpus' },
    { materijalId: 4, kolicina: 1, napomena: null },
  ]);
});

// ── kalkulacija ──────────────────────────────────────────

test('kalkulacija za narudžbu: marža prema neto dogovorene cijene', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 1170, trosakRada: 100, status: 'otvoren' },
    [
      { id: 1, radniNalogId: 1, materijalId: 1, kolicina: 10, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 13, stanje: 20 } as any,
      { id: 2, radniNalogId: 1, materijalId: 2, kolicina: 4, nabavnaCijena: null, naziv: 'Kant', trenutnaCijena: 0.5, stanje: 1 } as any,
    ]
  );
  expect(k.materijal).toBe(132);
  expect(k.rad).toBe(100);
  expect(k.ukupno).toBe(232);
  expect(k.neto).toBe(1000);
  expect(k.marza).toBe(768);
  expect(k.marzaPct).toBe(76.8);
  expect(k.upozorenja).toEqual(['Kant: utrošak 4 prelazi stanje 1']);
  expect(k.stavke[0].zamrznuto).toBe(false);
});

test('kalkulacija: materijal bez primke daje upozorenje', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 117, trosakRada: 0, status: 'otvoren' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 2, nabavnaCijena: null, naziv: 'Staklo', trenutnaCijena: 0, stanje: 5 } as any]
  );
  expect(k.materijal).toBe(0);
  expect(k.upozorenja).toEqual(['Staklo: nema nabavne cijene (nema primke)']);
});

test('kalkulacija za zalihu: trošak po komadu; zamrznuta cijena ima prednost', () => {
  const k = kalkulacija(
    { vrsta: 'zaliha', kolicina: 4, dogovorenaCijena: null, trosakRada: 40, status: 'zavrsen' },
    [{ id: 1, radniNalogId: 1, materijalId: 1, kolicina: 8, nabavnaCijena: 12, naziv: 'IV', trenutnaCijena: 99, stanje: 0 } as any]
  );
  expect(k.materijal).toBe(96);
  expect(k.ukupno).toBe(136);
  expect(k.poKomadu).toBe(34);
  expect(k.neto).toBeUndefined();
  expect(k.stavke[0].zamrznuto).toBe(true);
  expect(k.upozorenja).toEqual([]); // završen nalog ne upozorava na stanje
});

test('kalkulacija: upozorenje o stanju sabira isti materijal na više stavki', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 117, trosakRada: 0, status: 'u_izradi' },
    [
      { id: 1, radniNalogId: 1, materijalId: 1, kolicina: 3, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 0, stanje: 5 } as any,
      { id: 2, radniNalogId: 1, materijalId: 2, kolicina: 1, nabavnaCijena: null, naziv: 'Kant', trenutnaCijena: 1, stanje: 5 } as any,
      { id: 3, radniNalogId: 1, materijalId: 1, kolicina: 3, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 0, stanje: 5 } as any,
    ]
  );
  expect(k.upozorenja).toEqual(['IV: nema nabavne cijene (nema primke)', 'IV: utrošak 6 prelazi stanje 5']);
  expect(k.stavke.map(s => s.kolicina)).toEqual([3, 1, 3]);
});

test('kalkulacija: zbir koji tačno pokriva stanje ne upozorava (bez greške zaokruživanja)', () => {
  const k = kalkulacija(
    { vrsta: 'narudzba', kolicina: 1, dogovorenaCijena: 117, trosakRada: 0, status: 'otvoren' },
    [
      { id: 1, radniNalogId: 1, materijalId: 1, kolicina: 0.1, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 1, stanje: 0.3 } as any,
      { id: 2, radniNalogId: 1, materijalId: 1, kolicina: 0.2, nabavnaCijena: null, naziv: 'IV', trenutnaCijena: 1, stanje: 0.3 } as any,
    ]
  );
  expect(k.upozorenja).toEqual([]);
});

// ── vraćanje u izradu ────────────────────────────────────

test('vraćanje u izradu je dozvoljeno kad na stanju ima bar koliko je nalog uveo (i uz toleranciju)', () => {
  const art = dodajArtikal('LINA');
  const iv = dodajMaterijal('IV');
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 0.1, 'test', 0)").run(art);
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'ulaz', 0.2, 'test', 0)").run(art);
  const r = createNalog(db, { vrsta: 'zaliha', korisnikId: 1, productId: art, kolicina: 2 });
  replaceStavke(db, r.id, [{ materijalId: iv, kolicina: 1 }]);
  zavrsiNalog(db, r.id);
  // prodano 0,3 (ono što je bilo i prije naloga) — ostaje tačno onoliko koliko je nalog uveo
  db.prepare("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId) VALUES (?, 'izlaz', 0.3, 'order', 1)").run(art);
  vratiUIzradu(db, r.id);
  expect(getNalog(db, r.id).status).toBe('u_izradi');
});
