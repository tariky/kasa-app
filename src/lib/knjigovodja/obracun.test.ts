import { test, expect, describe } from 'bun:test';
import { obracunaj, raspodjelaPlacanja } from './obracun';
import type { KnjigovodjaPodaci, IzvozRacun } from './tipovi';

const SVI = { skladiste: true, proizvodnja: true };

function prazno(): KnjigovodjaPodaci {
  return {
    od: '2026-09-01', do: '2026-09-30', racuni: [], reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [],
    nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
  };
}

function racun(id: number, o: Partial<IzvozRacun> = {}): IzvozRacun {
  return {
    id, createdAt: '2026-09-02 10:00:00', refundedAt: null, brojFiskalnogRacuna: String(id), brojReklamacije: null,
    status: 'completed', ukupno: 11.7, pdvIznos: 1.7, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null,
    isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'Admin', ...o,
  };
}

describe('raspodjelaPlacanja', () => {
  test('tekst nosi cijeli iznos', () => {
    expect(raspodjelaPlacanja('Kartica', 30)).toEqual({ iznosi: { gotovina: 0, kartica: 30, virman: 0, cek: 0 }, opis: 'Kartica', poznat: true });
    expect(raspodjelaPlacanja('Ček', 5).iznosi.cek).toBe(5);
  });
  test('JSON je podijeljeno plaćanje', () => {
    expect(raspodjelaPlacanja(JSON.stringify({ gotovina: 20, kartica: 30 }), 50)).toEqual({
      iznosi: { gotovina: 20, kartica: 30, virman: 0, cek: 0 }, opis: 'Gotovina 20,00 + Kartica 30,00', poznat: true,
    });
  });
  test('nepoznat oblik ide u gotovinu i nije poznat', () => {
    expect(raspodjelaPlacanja('Bitcoin', 10)).toEqual({ iznosi: { gotovina: 10, kartica: 0, virman: 0, cek: 0 }, opis: 'Bitcoin', poznat: false });
    expect(raspodjelaPlacanja('{"zlato": 10}', 10).poznat).toBe(false);
  });
});

describe('obracunaj', () => {
  test('prazan period: nule i bez upozorenja', () => {
    const r = obracunaj(prazno(), { moduli: SVI });
    expect(r.kif).toEqual([]);
    expect(r.dani).toEqual([]);
    expect(r.zbir.promet).toEqual({ osnovicaE: 0, pdvE: 0, iznosK: 0, ukupno: 0, gotovina: 0, kartica: 0, virman: 0, cek: 0, brojRacuna: 0 });
    expect(r.zbir.neto).toBe(0);
    expect(r.upozorenja).toEqual([]);
  });

  test('KIF: ukupno i PDV iz računa, iznos K iz stavki, osnovica E ostatak', () => {
    const p = prazno();
    p.racuni = [racun(1, { ukupno: 26.7, pdvIznos: 1.7, nacinPlacanja: JSON.stringify({ gotovina: 6.7, kartica: 20 }), kupacNaziv: 'Kupac', kupacIdBroj: '4200000000001', isManual: 1 })];
    p.stavkeRacuna = [
      { orderId: 1, kolicina: 1, cijena: 11.7, rabat: 0, pdvStopa: 'E' },
      { orderId: 1, kolicina: 3, cijena: 5, rabat: 0, pdvStopa: 'K' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif).toEqual([{
      id: 1, datum: '2026-09-02 10:00:00', fiskalniBroj: '1', kupac: 'Kupac', jib: '4200000000001',
      osnovicaE: 10, pdvE: 1.7, iznosK: 15, ukupno: 26.7,
      placanje: 'Gotovina 6,70 + Kartica 20,00', datumValute: null, oznaka: 'ručni',
    }]);
    expect(r.dani).toEqual([{
      datum: '2026-09-02', brojRacuna: 1, osnovicaE: 10, pdvE: 1.7, iznosK: 15, ukupno: 26.7,
      gotovina: 6.7, kartica: 20, virman: 0, cek: 0, reklamacije: 0, neto: 26.7,
    }]);
    expect(r.upozorenja).toEqual([]);
  });

  test('račun po prilogu bez stavki je sav na stopi E', () => {
    const p = prazno();
    p.racuni = [racun(1, { prilogBroj: 7 })];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif[0]).toMatchObject({ osnovicaE: 10, pdvE: 1.7, iznosK: 0, ukupno: 11.7, oznaka: 'prilog 7' });
  });

  test('odstupanje stavki od ukupnog i nepoznato plaćanje idu u Kontrolu', () => {
    const p = prazno();
    p.racuni = [racun(1, { nacinPlacanja: 'Bitcoin' })];
    p.stavkeRacuna = [{ orderId: 1, kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E' }];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.kif[0].ukupno).toBe(11.7);
    expect(r.upozorenja.map(u => u.vrsta)).toEqual(['odstupanje', 'placanje']);
  });

  test('reklamacije su negativne, u danu reklamacije, i umanjuju neto', () => {
    const p = prazno();
    p.racuni = [racun(1)];
    p.reklamacije = [racun(9, { createdAt: '2026-08-20 10:00:00', refundedAt: '2026-09-02 12:00:00', brojReklamacije: 'R-1', status: 'refunded', brojFiskalnogRacuna: '9' })];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.reklamacije).toEqual([{
      id: 9, datum: '2026-09-02 12:00:00', brojReklamacije: 'R-1', fiskalniBroj: '9', datumOriginala: '2026-08-20 10:00:00',
      kupac: '', osnovicaE: -10, pdvE: -1.7, iznosK: 0, ukupno: -11.7, placanje: 'Gotovina',
    }]);
    expect(r.dani[0]).toMatchObject({ datum: '2026-09-02', ukupno: 11.7, reklamacije: -11.7, neto: 0 });
    expect(r.zbir.reklamacije).toMatchObject({ broj: 1, ukupno: -11.7 });
    expect(r.zbir.neto).toBe(0);
  });

  test('rupe u fiskalnoj numeraciji (bez odbačenih) i računi bez broja', () => {
    const p = prazno();
    p.racuni = [racun(1, { brojFiskalnogRacuna: '10' }), racun(2, { brojFiskalnogRacuna: '14' }), racun(3, { brojFiskalnogRacuna: null })];
    const r = obracunaj(p, { moduli: SVI, odbacenePraznine: [12] });
    expect(r.upozorenja.filter(u => u.vrsta === 'praznina').map(u => u.opis)).toEqual([
      'Nedostaje fiskalni račun br. 11', 'Nedostaje fiskalni račun br. 13',
    ]);
    expect(r.upozorenja.filter(u => u.vrsta === 'bezBroja')).toHaveLength(1);
  });

  test('KUF i stavke ulaza preko kalkulacije', () => {
    const p = prazno();
    p.primke = [{ id: 1, brojPrimke: 'U-1', datum: '2026-09-05', dobavljacNaziv: 'Dob', dobavljacId: '42', brojFakture: 'F-1' }];
    p.primkaStavke = [
      { primkaId: 1, sifra: 'A', naziv: 'Art', jm: 'kom', kolicina: 10, cijena: 11.7, nabavnaCijena: 5, rabat: 10, zavisniTroskovi: 5, pdvStopa: 'E' },
      { primkaId: 1, sifra: null, naziv: null, jm: null, kolicina: 2, cijena: 0, nabavnaCijena: 10, rabat: 0, zavisniTroskovi: 0, pdvStopa: 'E' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    // fakturna 50+20; rabat 5; zavisni 5; nabavna 50+20; PDV 17% na (fakturna − rabat) = 65 × 0,17
    // prodajna 117; RUC samo za stavke s prodajnom: 117/1,17 − 50 = 50
    expect(r.kuf).toEqual([{
      datum: '2026-09-05', brojPrimke: 'U-1', dobavljac: 'Dob', dobavljacId: '42', brojFakture: 'F-1',
      fakturna: 70, rabat: 5, zavisni: 5, nabavna: 70, pdv: 11.05, prodajna: 117, ruc: 50,
    }]);
    expect(r.ulazStavke[0]).toMatchObject({ brojPrimke: 'U-1', sifra: 'A', nabavnaCijena: 5, prodajnaCijena: 11.7 });
    expect(r.ulazStavke[1]).toMatchObject({ sifra: '—', naziv: '—', jm: '' });
    expect(r.zbir.ulaz).toEqual({ brojPrimki: 1, nabavna: 70, pdv: 11.05, prodajna: 117 });
  });

  test('utrošak: zamrznuta cijena ili prosječna; zbir po materijalu', () => {
    const p = prazno();
    const u = { broj: 1, godina: 2026, zavrsenAt: '2026-09-05 10:00:00', opis: 'N', proizvod: 'P', sifra: 'M', naziv: 'Mat', jm: 'm', kolicina: 2 };
    p.utrosak = [
      { nalogId: 1, ...u, nabavnaCijena: 7, prosjecnaNabavna: 2 },
      { nalogId: 2, ...u, broj: 2, nabavnaCijena: null, prosjecnaNabavna: 3 },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.utrosak.map(x => [x.nalog, x.nabavnaCijena, x.vrijednost])).toEqual([['1/2026', 7, 14], ['2/2026', 3, 6]]);
    expect(r.utrosakZbir).toEqual([{ sifra: 'M', naziv: 'Mat', jm: 'm', kolicina: 4, vrijednost: 20 }]);
    expect(r.zbir.utrosak).toEqual({ brojNaloga: 2, vrijednost: 20 });
  });

  test('zalihe: bez nula, minus u Kontroli i van zbira, materijal samo s proizvodnjom', () => {
    const p = prazno();
    p.zalihe = [
      { sifra: 'A', naziv: 'Art', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12, nabavnaVrijednost: 50, nabavnaKolicina: 10 },
      { sifra: 'B', naziv: 'Nula', jm: 'kom', tip: 'artikal', kolicina: 0, cijena: 9, nabavnaVrijednost: 0, nabavnaKolicina: 0 },
      { sifra: 'C', naziv: 'Minus', jm: 'kom', tip: 'artikal', kolicina: -2, cijena: 5, nabavnaVrijednost: 0, nabavnaKolicina: 0 },
      { sifra: 'M', naziv: 'Mat', jm: 'm', tip: 'materijal', kolicina: 3, cijena: 0, nabavnaVrijednost: 6, nabavnaKolicina: 3 },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect(r.zalihe.map(z => z.sifra)).toEqual(['A', 'C', 'M']);
    expect(r.zalihe[0]).toEqual({ sifra: 'A', naziv: 'Art', jm: 'kom', tip: 'artikal', kolicina: 7, prosjecnaNabavna: 5, nabavnaVrijednost: 35, prodajnaCijena: 12, prodajnaVrijednost: 84 });
    expect(r.zbir.zalihe).toEqual({ nabavna: 41, prodajna: 84 });
    expect(r.upozorenja.map(u => u.vrsta)).toEqual(['minus']);

    const bezProizvodnje = obracunaj(p, { moduli: { skladiste: true, proizvodnja: false } });
    expect(bezProizvodnje.zalihe.map(z => z.sifra)).toEqual(['A', 'C']);
  });

  test('isključeni moduli daju prazne listove i nule', () => {
    const p = prazno();
    p.primke = [{ id: 1, brojPrimke: 'U-1', datum: '2026-09-05', dobavljacNaziv: null, dobavljacId: null, brojFakture: null }];
    p.nivelacije = [{ brojNivelacije: 'N', datum: '2026-09-05', sifra: 'A', naziv: 'A', kolicina: 1, staraCijena: 1, novaCijena: 2, razlika: 1, ukupnaRazlika: 1, pdvStopa: 'E' }];
    p.utrosak = [{ nalogId: 1, broj: 1, godina: 2026, zavrsenAt: '2026-09-05', opis: '', proizvod: null, sifra: 'M', naziv: 'M', jm: 'm', kolicina: 1, nabavnaCijena: 1, prosjecnaNabavna: 1 }];
    p.zalihe = [{ sifra: 'A', naziv: 'A', jm: 'kom', tip: 'artikal', kolicina: -1, cijena: 1, nabavnaVrijednost: 0, nabavnaKolicina: 0 }];
    const r = obracunaj(p, { moduli: { skladiste: false, proizvodnja: false } });
    expect([r.kuf, r.ulazStavke, r.nivelacije, r.zalihe, r.utrosak, r.utrosakZbir]).toEqual([[], [], [], [], [], []]);
    expect(r.zbir.ulaz.brojPrimki).toBe(0);
    expect(r.zbir.nivelacijeRazlika).toBe(0);
    expect(r.upozorenja).toEqual([]);
  });

  test('polog i povrat se sabiraju odvojeno', () => {
    const p = prazno();
    p.kretanjaNovca = [
      { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-01 20:00:00', tip: 'povrat', iznos: 20.1, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
      { createdAt: '2026-09-02 07:00:00', tip: 'polog', iznos: 50.2, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
    ];
    const r = obracunaj(p, { moduli: SVI });
    expect([r.zbir.polozi, r.zbir.povrati]).toEqual([100.2, 20.1]);
  });

  test('period koji još traje: upozorenje „nezavrsen“ je prvo', () => {
    const p = prazno();
    p.racuni = [racun(1, { nacinPlacanja: 'Bitcoin' })];
    const r = obracunaj(p, { moduli: SVI, danas: '2026-09-25' });
    expect(r.upozorenja[0]).toEqual({
      vrsta: 'nezavrsen',
      opis: 'Period još traje — podaci su do 25.09.2026., a zalihe i promet nisu konačni',
    });
    expect(r.upozorenja.map(u => u.vrsta)).toEqual(['nezavrsen', 'placanje']);
  });

  test('završen period ili bez danas: nema upozorenja „nezavrsen“', () => {
    for (const danas of ['2026-09-30', '2026-10-01', undefined]) {
      const r = obracunaj(prazno(), { moduli: SVI, danas });
      expect(r.upozorenja).toEqual([]);
    }
  });
});
