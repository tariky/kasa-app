// Ugovor za kanal izvoz:knjigovodja — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';

let b: Backend;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const ADMIN = 1; // getDb seeduje admina 'Admin'
const SEP = ['2026-09-01', '2026-09-30'] as const;

function ins(sql: string, ...params: any[]): number {
  return Number(b.db.prepare(sql).run(...params).lastInsertRowid);
}

function artikal(sifra: string, cijena: number, opts: { pdvStopa?: string; tip?: string; slobodan?: number } = {}): number {
  return ins(
    "INSERT INTO products (sifra, naziv, jm, cijena, pdvStopa, tip, slobodan) VALUES (?, ?, 'kom', ?, ?, ?, ?)",
    sifra, `Artikal ${sifra}`, cijena, opts.pdvStopa ?? 'E', opts.tip ?? 'artikal', opts.slobodan ?? 0,
  );
}

function racun(o: {
  createdAt: string; ukupno?: number; pdvIznos?: number; broj?: string | null; nacin?: string;
  refundedAt?: string | null; brojReklamacije?: string | null; prilogBroj?: number | null;
}): number {
  return ins(
    `INSERT INTO orders (korisnikId, ukupno, pdvIznos, nacinPlacanja, brojFiskalnogRacuna, status, refundedAt, brojReklamacije, prilogBroj, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ADMIN, o.ukupno ?? 10, o.pdvIznos ?? 0, o.nacin ?? 'Gotovina', o.broj ?? null,
    o.refundedAt ? 'refunded' : 'completed', o.refundedAt ?? null, o.brojReklamacije ?? null, o.prilogBroj ?? null, o.createdAt,
  );
}

function primka(broj: string, datum: string): number {
  return ins("INSERT INTO primke (brojPrimke, datum, dobavljacNaziv, dobavljacId, brojFakture) VALUES (?, ?, 'Dobavljač', '4200000000000', 'F-1')", broj, datum);
}

function primkaStavka(primkaId: number, productId: number, kolicina: number, nabavnaCijena: number, extra: { rabat?: number; zavisni?: number; cijena?: number } = {}): void {
  ins(
    "INSERT INTO primka_stavke (primkaId, productId, kolicina, cijena, nabavnaCijena, rabat, zavisniTroskovi, pdvStopa) VALUES (?, ?, ?, ?, ?, ?, ?, 'E')",
    primkaId, productId, kolicina, extra.cijena ?? 0, nabavnaCijena, extra.rabat ?? 0, extra.zavisni ?? 0,
  );
}

function kretanje(productId: number, tip: 'ulaz' | 'izlaz', kolicina: number, createdAt: string): void {
  ins("INSERT INTO stock_movements (productId, tip, kolicina, referenceType, referenceId, createdAt) VALUES (?, ?, ?, 'test', 0, ?)", productId, tip, kolicina, createdAt);
}

const izvoz = (od: string, doDatum: string) => b.call('izvoz:knjigovodja', od, doDatum);

describe('izvoz:knjigovodja', () => {
  test('računi po datumu prodaje, reklamacije po datumu reklamacije, granice uključive', async () => {
    racun({ createdAt: '2026-08-31 23:59:59', broj: '1' });
    const prvi = racun({ createdAt: '2026-09-01 00:00:00', broj: '2' });
    const zadnji = racun({ createdAt: '2026-09-30 23:59:59', broj: '3' });
    racun({ createdAt: '2026-10-01 00:00:00', broj: '4' });
    const stariReklamiran = racun({ createdAt: '2026-08-20 10:00:00', broj: '5', refundedAt: '2026-09-05 11:00:00', brojReklamacije: 'R-1' });
    const istiDan = racun({ createdAt: '2026-09-10 09:00:00', broj: '6', refundedAt: '2026-09-10 12:00:00', brojReklamacije: 'R-2' });

    const r = await izvoz(...SEP);
    expect(r.od).toBe('2026-09-01');
    expect(r.do).toBe('2026-09-30');
    expect(r.racuni.map((x: any) => x.id)).toEqual([prvi, istiDan, zadnji]);
    expect(r.reklamacije.map((x: any) => x.id)).toEqual([stariReklamiran, istiDan]);
    expect(r.racuni[0]).toEqual({
      id: prvi, createdAt: '2026-09-01 00:00:00', refundedAt: null, brojFiskalnogRacuna: '2', brojReklamacije: null,
      status: 'completed', ukupno: 10, pdvIznos: 0, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null,
      isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'Admin',
    });
  });

  test('stavke računa i priloga za prodane i reklamirane račune; rabat NULL je 0', async () => {
    const a = artikal('A', 11.7);
    const k = artikal('K', 5, { pdvStopa: 'K' });
    const van = racun({ createdAt: '2026-08-01 10:00:00' });
    const obican = racun({ createdAt: '2026-09-02 10:00:00' });
    const prilog = racun({ createdAt: '2026-09-03 10:00:00', prilogBroj: 7 });
    const reklamiran = racun({ createdAt: '2026-08-15 10:00:00', refundedAt: '2026-09-04 10:00:00' });
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 1, 0, ?)', van, a, 'E');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 2, 11.7, 10, ?)', obican, a, 'E');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 5, NULL, ?)', obican, k, 'K');
    ins('INSERT INTO prilog_stavke (orderId, productId, kolicina, cijena, pdvStopa) VALUES (?, ?, 3, 5, ?)', prilog, k, 'K');
    ins('INSERT INTO order_items (orderId, productId, kolicina, cijena, rabat, pdvStopa) VALUES (?, ?, 1, 11.7, 0, ?)', reklamiran, a, 'E');

    const r = await izvoz(...SEP);
    expect(r.stavkeRacuna).toEqual([
      { orderId: obican, kolicina: 2, cijena: 11.7, rabat: 10, pdvStopa: 'E' },
      { orderId: obican, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: prilog, kolicina: 3, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: reklamiran, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' },
    ]);
  });

  test('primke, stavke primki i nivelacije po datumu dokumenta', async () => {
    const a = artikal('A', 10);
    primkaStavka(primka('U-0', '2026-08-31'), a, 1, 1);
    const u1 = primka('U-1', '2026-09-30');
    primkaStavka(u1, a, 10, 5, { rabat: 10, zavisni: 5, cijena: 10 });
    const n = ins("INSERT INTO nivelacije (brojNivelacije, datum) VALUES ('NIV-2026-001', '2026-09-15')");
    ins("INSERT INTO nivelacija_stavke (nivelacijaId, productId, kolicina, staraCijena, novaCijena, razlika, ukupnaRazlika, pdvStopa) VALUES (?, ?, 4, 10, 12, 2, 8, 'E')", n, a);
    ins("INSERT INTO nivelacije (brojNivelacije, datum) VALUES ('NIV-2026-002', '2026-10-01')");

    const r = await izvoz(...SEP);
    expect(r.primke).toEqual([{ id: u1, brojPrimke: 'U-1', datum: '2026-09-30', dobavljacNaziv: 'Dobavljač', dobavljacId: '4200000000000', brojFakture: 'F-1' }]);
    expect(r.primkaStavke).toEqual([{
      primkaId: u1, sifra: 'A', naziv: 'Artikal A', jm: 'kom', kolicina: 10, cijena: 10, nabavnaCijena: 5, rabat: 10, zavisniTroskovi: 5, pdvStopa: 'E',
    }]);
    expect(r.nivelacije).toEqual([{
      brojNivelacije: 'NIV-2026-001', datum: '2026-09-15', sifra: 'A', naziv: 'Artikal A', kolicina: 4, staraCijena: 10, novaCijena: 12, razlika: 2, ukupnaRazlika: 8, pdvStopa: 'E',
    }]);
  });

  test('polog i povrat s imenom korisnika', async () => {
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('polog', 50, ?, 'ok', NULL, '2026-09-01 07:00:00')", ADMIN);
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('povrat', 20, ?, 'error', 'banka', '2026-09-30 20:00:00')", ADMIN);
    ins("INSERT INTO cash_movements (tip, iznos, korisnikId, tringStatus, napomena, createdAt) VALUES ('polog', 50, ?, 'ok', NULL, '2026-10-01 07:00:00')", ADMIN);

    const r = await izvoz(...SEP);
    expect(r.kretanjaNovca).toEqual([
      { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'Admin', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-30 20:00:00', tip: 'povrat', iznos: 20, korisnikIme: 'Admin', napomena: 'banka', tringStatus: 'error' },
    ]);
  });

  test('utrošak: samo završeni nalozi u periodu; prosječna nabavna do dana završetka', async () => {
    const mat = artikal('M', 0, { tip: 'materijal' });
    const proizvod = artikal('P', 100);
    primkaStavka(primka('U-1', '2026-09-01'), mat, 10, 2);
    primkaStavka(primka('U-2', '2026-09-10'), mat, 10, 4);
    primkaStavka(primka('U-3', '2026-09-25'), mat, 10, 100);
    const nalog = (broj: number, status: string, zavrsenAt: string | null) => ins(
      "INSERT INTO radni_nalozi (broj, godina, datum, vrsta, opis, productId, status, korisnikId, zavrsenAt) VALUES (?, 2026, '2026-09-01', 'zaliha', ?, ?, ?, ?, ?)",
      broj, `Nalog ${broj}`, proizvod, status, ADMIN, zavrsenAt,
    );
    const zamrznut = nalog(1, 'zavrsen', '2026-09-05 10:00:00');
    const bezCijene = nalog(2, 'fakturisan', '2026-09-20 10:00:00');
    const uIzradi = nalog(3, 'u_izradi', null);
    const kasni = nalog(4, 'zavrsen', '2026-10-02 10:00:00');
    for (const [n, cijena] of [[zamrznut, 7], [bezCijene, null], [uIzradi, 1], [kasni, 1]] as const) {
      ins('INSERT INTO radni_nalog_stavke (radniNalogId, materijalId, kolicina, nabavnaCijena) VALUES (?, ?, 2, ?)', n, mat, cijena);
    }

    const r = await izvoz(...SEP);
    expect(r.utrosak).toEqual([
      { nalogId: zamrznut, broj: 1, godina: 2026, zavrsenAt: '2026-09-05 10:00:00', opis: 'Nalog 1', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: 7, prosjecnaNabavna: 2 },
      { nalogId: bezCijene, broj: 2, godina: 2026, zavrsenAt: '2026-09-20 10:00:00', opis: 'Nalog 2', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: null, prosjecnaNabavna: 3 },
    ]);
  });

  test('zalihe na kraju dana "do": kretanja, prodajna cijena tog dana, nabavna iz primki do tog dana', async () => {
    const a = artikal('A', 15);
    const bezPromjene = artikal('B', 9);
    artikal('S', 1, { tip: 'usluga' });
    artikal('F', 1, { slobodan: 1 });
    kretanje(a, 'ulaz', 10, '2026-09-01 08:00:00');
    kretanje(a, 'izlaz', 3, '2026-09-30 23:59:59');
    kretanje(a, 'izlaz', 5, '2026-10-01 00:00:00');
    primkaStavka(primka('U-1', '2026-09-01'), a, 10, 5, { rabat: 10, zavisni: 5 });
    primkaStavka(primka('U-2', '2026-10-01'), a, 10, 50);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 10, 12, '2026-09-10 10:00:00')", a);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 12, 15, '2026-10-05 10:00:00')", a);

    const r = await izvoz(...SEP);
    expect(r.zalihe.map((z: any) => z.sifra)).toEqual(['A', 'B']);
    expect(r.zalihe[0]).toMatchObject({ sifra: 'A', naziv: 'Artikal A', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12, nabavnaKolicina: 10 });
    expect(r.zalihe[0].nabavnaVrijednost).toBeCloseTo(50, 9);
    expect(r.zalihe[1]).toMatchObject({ sifra: 'B', kolicina: 0, cijena: 9, nabavnaVrijednost: 0, nabavnaKolicina: 0 });
    expect(bezPromjene).toBeGreaterThan(0);
  });

  test('cijena prije prve promjene je staraCijena te promjene', async () => {
    const a = artikal('A', 20);
    ins("INSERT INTO cijena_historija (productId, izvor, staraCijena, novaCijena, createdAt) VALUES (?, 'rucno', 14, 20, '2026-10-05 10:00:00')", a);
    const r = await izvoz(...SEP);
    expect(r.zalihe[0].cijena).toBe(14);
  });

  test('prazan period vraća prazne liste', async () => {
    expect(await izvoz(...SEP)).toEqual({
      od: '2026-09-01', do: '2026-09-30', racuni: [], reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [],
      nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
    });
  });

  test('neispravan period je greška', async () => {
    await expect(izvoz('2026-09-30', '2026-09-01')).rejects.toThrow('Neispravan period');
    await expect(izvoz('2026-9-1', '2026-09-30')).rejects.toThrow('Neispravan period');
    await expect(b.call('izvoz:knjigovodja', null, '2026-09-30')).rejects.toThrow('Neispravan period');
    await expect(b.call('izvoz:knjigovodja')).rejects.toThrow('Neispravan period');
  });
});
