// Ugovor za kanal izvoz:knjigovodja — vidi backend.ts.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, pozoviBezTipova, type Backend } from './backend';
import { scenarij, ADMIN } from './scenarij';

let b: Backend;
const baza = scenarij(() => b);

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { await b.close(); });

const SEP = ['2026-09-01', '2026-09-30'] as const;

function primka(broj: string, datum: string): number {
  return baza.upisi('primke', { brojPrimke: broj, datum, dobavljacNaziv: 'Dobavljač', dobavljacId: '4200000000000', brojFakture: 'F-1' });
}

function primkaStavka(primkaId: number, productId: number, kolicina: number, nabavnaCijena: number, extra: { rabat?: number; zavisni?: number; cijena?: number } = {}): void {
  baza.upisi('primka_stavke', {
    primkaId, productId, kolicina, cijena: extra.cijena ?? 0, nabavnaCijena,
    rabat: extra.rabat ?? 0, zavisniTroskovi: extra.zavisni ?? 0, pdvStopa: 'E',
  });
}

const izvoz = (od: string, doDatum: string) => b.call('izvoz:knjigovodja', od, doDatum);

describe('izvoz:knjigovodja', () => {
  test('računi po datumu prodaje, reklamacije po datumu reklamacije, granice uključive', async () => {
    baza.racun({ createdAt: '2026-08-31 23:59:59', brojFiskalnogRacuna: '1' });
    const prvi = baza.racun({ createdAt: '2026-09-01 00:00:00', brojFiskalnogRacuna: '2' });
    const zadnji = baza.racun({ createdAt: '2026-09-30 23:59:59', brojFiskalnogRacuna: '3' });
    baza.racun({ createdAt: '2026-10-01 00:00:00', brojFiskalnogRacuna: '4' });
    const stariReklamiran = baza.racun({
      createdAt: '2026-08-20 10:00:00', brojFiskalnogRacuna: '5', refundedAt: '2026-09-05 11:00:00',
      brojReklamacije: 'R-1',
    });
    const istiDan = baza.racun({
      createdAt: '2026-09-10 09:00:00', brojFiskalnogRacuna: '6', refundedAt: '2026-09-10 12:00:00',
      brojReklamacije: 'R-2',
    });

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
    const a = baza.artikal({ sifra: 'A', cijena: 11.7 });
    const k = baza.artikal({ sifra: 'K', cijena: 5, pdvStopa: 'K' });
    const van = baza.racun({ createdAt: '2026-08-01 10:00:00' });
    const obican = baza.racun({ createdAt: '2026-09-02 10:00:00' });
    const prilog = baza.racun({ createdAt: '2026-09-03 10:00:00', prilogBroj: 7 });
    const reklamiran = baza.racun({ createdAt: '2026-08-15 10:00:00', refundedAt: '2026-09-04 10:00:00' });
    baza.upisi('order_items', { orderId: van, productId: a, kolicina: 1, cijena: 1, rabat: 0, pdvStopa: 'E' });
    baza.upisi('order_items', { orderId: obican, productId: a, kolicina: 2, cijena: 11.7, rabat: 10, pdvStopa: 'E' });
    baza.upisi('order_items', { orderId: obican, productId: k, kolicina: 1, cijena: 5, rabat: null, pdvStopa: 'K' });
    baza.upisi('prilog_stavke', { orderId: prilog, productId: k, kolicina: 3, cijena: 5, pdvStopa: 'K' });
    baza.upisi('order_items', { orderId: reklamiran, productId: a, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' });

    const r = await izvoz(...SEP);
    expect(r.stavkeRacuna).toEqual([
      { orderId: obican, kolicina: 2, cijena: 11.7, rabat: 10, pdvStopa: 'E' },
      { orderId: obican, kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: prilog, kolicina: 3, cijena: 5, rabat: 0, pdvStopa: 'K' },
      { orderId: reklamiran, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' },
    ]);
  });

  test('primke, stavke primki i nivelacije po datumu dokumenta', async () => {
    const a = baza.artikal({ sifra: 'A', cijena: 10 });
    primkaStavka(primka('U-0', '2026-08-31'), a, 1, 1);
    const u1 = primka('U-1', '2026-09-30');
    primkaStavka(u1, a, 10, 5, { rabat: 10, zavisni: 5, cijena: 10 });
    const n = baza.upisi('nivelacije', { brojNivelacije: 'NIV-2026-001', datum: '2026-09-15' });
    baza.upisi('nivelacija_stavke', {
      nivelacijaId: n, productId: a, kolicina: 4, staraCijena: 10, novaCijena: 12, razlika: 2,
      ukupnaRazlika: 8, pdvStopa: 'E',
    });
    baza.upisi('nivelacije', { brojNivelacije: 'NIV-2026-002', datum: '2026-10-01' });

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
    baza.upisi('cash_movements', { tip: 'polog', iznos: 50, korisnikId: ADMIN, tringStatus: 'ok', napomena: null, createdAt: '2026-09-01 07:00:00' });
    baza.upisi('cash_movements', {
      tip: 'povrat', iznos: 20, korisnikId: ADMIN, tringStatus: 'error', napomena: 'banka',
      createdAt: '2026-09-30 20:00:00',
    });
    baza.upisi('cash_movements', { tip: 'polog', iznos: 50, korisnikId: ADMIN, tringStatus: 'ok', napomena: null, createdAt: '2026-10-01 07:00:00' });

    const r = await izvoz(...SEP);
    expect(r.kretanjaNovca).toEqual([
      { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'Admin', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-30 20:00:00', tip: 'povrat', iznos: 20, korisnikIme: 'Admin', napomena: 'banka', tringStatus: 'error' },
    ]);
  });

  test('utrošak: samo završeni nalozi u periodu; prosječna nabavna do dana završetka', async () => {
    const mat = baza.artikal({ sifra: 'M', cijena: 0, tip: 'materijal' });
    const proizvod = baza.artikal({ sifra: 'P', cijena: 100 });
    primkaStavka(primka('U-1', '2026-09-01'), mat, 10, 2);
    primkaStavka(primka('U-2', '2026-09-10'), mat, 10, 4);
    primkaStavka(primka('U-3', '2026-09-25'), mat, 10, 100);
    const nalog = (broj: number, status: string, zavrsenAt: string | null) => baza.upisi('radni_nalozi', {
      broj, godina: 2026, datum: '2026-09-01', vrsta: 'zaliha', opis: `Nalog ${broj}`, productId: proizvod,
      status, korisnikId: ADMIN, zavrsenAt,
    });
    const zamrznut = nalog(1, 'zavrsen', '2026-09-05 10:00:00');
    const bezCijene = nalog(2, 'fakturisan', '2026-09-20 10:00:00');
    const uIzradi = nalog(3, 'u_izradi', null);
    const kasni = nalog(4, 'zavrsen', '2026-10-02 10:00:00');
    for (const [n, cijena] of [[zamrznut, 7], [bezCijene, null], [uIzradi, 1], [kasni, 1]] as const) {
      baza.upisi('radni_nalog_stavke', { radniNalogId: n, materijalId: mat, kolicina: 2, nabavnaCijena: cijena });
    }

    const r = await izvoz(...SEP);
    expect(r.utrosak).toEqual([
      { nalogId: zamrznut, broj: 1, godina: 2026, zavrsenAt: '2026-09-05 10:00:00', opis: 'Nalog 1', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: 7, prosjecnaNabavna: 2 },
      { nalogId: bezCijene, broj: 2, godina: 2026, zavrsenAt: '2026-09-20 10:00:00', opis: 'Nalog 2', proizvod: 'Artikal P', sifra: 'M', naziv: 'Artikal M', jm: 'kom', kolicina: 2, nabavnaCijena: null, prosjecnaNabavna: 3 },
    ]);
  });

  test('zalihe na kraju dana "do": kretanja, prodajna cijena tog dana, nabavna iz primki do tog dana', async () => {
    const a = baza.artikal({ sifra: 'A', cijena: 15 });
    const bezPromjene = baza.artikal({ sifra: 'B', cijena: 9 });
    baza.artikal({ sifra: 'S', cijena: 1, tip: 'usluga' });
    baza.artikal({ sifra: 'F', cijena: 1, slobodan: 1 });
    baza.kretanje({ productId: a, tip: 'ulaz', kolicina: 10, createdAt: '2026-09-01 08:00:00' });
    baza.kretanje({ productId: a, tip: 'izlaz', kolicina: 3, createdAt: '2026-09-30 23:59:59' });
    baza.kretanje({ productId: a, tip: 'izlaz', kolicina: 5, createdAt: '2026-10-01 00:00:00' });
    primkaStavka(primka('U-1', '2026-09-01'), a, 10, 5, { rabat: 10, zavisni: 5 });
    primkaStavka(primka('U-2', '2026-10-01'), a, 10, 50);
    baza.upisi('cijena_historija', { productId: a, izvor: 'rucno', staraCijena: 10, novaCijena: 12, createdAt: '2026-09-10 10:00:00' });
    baza.upisi('cijena_historija', { productId: a, izvor: 'rucno', staraCijena: 12, novaCijena: 15, createdAt: '2026-10-05 10:00:00' });

    const r = await izvoz(...SEP);
    expect(r.zalihe.map((z: any) => z.sifra)).toEqual(['A', 'B']);
    expect(r.zalihe[0]).toMatchObject({ sifra: 'A', naziv: 'Artikal A', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12, nabavnaKolicina: 10 });
    expect(r.zalihe[0].nabavnaVrijednost).toBeCloseTo(50, 9);
    expect(r.zalihe[1]).toMatchObject({ sifra: 'B', kolicina: 0, cijena: 9, nabavnaVrijednost: 0, nabavnaKolicina: 0 });
    expect(bezPromjene).toBeGreaterThan(0);
  });

  test('cijena prije prve promjene je staraCijena te promjene', async () => {
    const a = baza.artikal({ sifra: 'A', cijena: 20 });
    baza.upisi('cijena_historija', { productId: a, izvor: 'rucno', staraCijena: 14, novaCijena: 20, createdAt: '2026-10-05 10:00:00' });
    const r = await izvoz(...SEP);
    expect(r.zalihe[0].cijena).toBe(14);
  });

  // Historija cijena je samo-dodavanje: brisanje ili izmjena primke danas ne
  // smije promijeniti "Zalihe na dan" za period koji je već predat knjigovođi
  // (nivelacija tog perioda i dalje stoji u izvozu).
  test('brisanje primke kasnije ne mijenja prodajnu cijenu zaliha za raniji period', async () => {
    const a = baza.artikal({ sifra: 'A', cijena: 10 });
    const { id } = await b.call('primka:create', {
      brojPrimke: 'U-1', datum: '2026-01-20', stavke: [{ productId: a, kolicina: 5, cijena: 15, nabavnaCijena: 5, rabat: 0, pdvStopa: 'E' }],
    });
    b.db.prepare("UPDATE cijena_historija SET createdAt = '2026-01-20 10:00:00'").run();
    const cijenaA = async (od: string, doDatum: string) => (await izvoz(od, doDatum)).zalihe.find((z: any) => z.sifra === 'A').cijena;
    expect(await cijenaA('2026-01-01', '2026-01-31')).toBe(15);

    expect(await b.call('primka:delete', id)).toBeNull();
    expect(await cijenaA('2026-01-01', '2026-01-31')).toBe(15);
    // Vraćena cijena važi od danas.
    expect(await cijenaA('2099-12-01', '2099-12-31')).toBe(10);
  });

  test('izmjena cijene na primci koju je poslije promijenilo nešto drugo ne mijenja raniji period', async () => {
    const a = baza.artikal({ sifra: 'A', cijena: 10 });
    const stavke = (cijena: number) => [{ productId: a, kolicina: 5, cijena, nabavnaCijena: 5, rabat: 0, pdvStopa: 'E' }];
    const { id } = await b.call('primka:create', { brojPrimke: 'U-1', datum: '2026-01-20', stavke: stavke(15) });
    b.db.prepare("UPDATE cijena_historija SET createdAt = '2026-01-20 10:00:00'").run();
    await b.call('product:update', a, { cijena: 20 });
    b.db.prepare("UPDATE cijena_historija SET createdAt = '2026-02-10 10:00:00' WHERE izvor = 'rucno'").run();
    const cijenaA = async (od: string, doDatum: string) => (await izvoz(od, doDatum)).zalihe.find((z: any) => z.sifra === 'A').cijena;

    await b.call('primka:update', { id, brojPrimke: 'U-1', datum: '2026-01-20', stavke: stavke(18) });
    expect(await cijenaA('2026-01-01', '2026-01-31')).toBe(15);
    expect(await cijenaA('2026-02-01', '2026-02-28')).toBe(20);
    // Lanac je ispravljen: bez ručne izmjene važila bi nova cijena primke.
    expect(b.db.prepare("SELECT staraCijena FROM cijena_historija WHERE izvor = 'rucno'").get()).toEqual({ staraCijena: 18 });
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
    await expect(pozoviBezTipova(b, 'izvoz:knjigovodja')).rejects.toThrow('Neispravan period');
  });
});
