import { test, expect, describe } from 'bun:test';
import { sumePrimke, rucPrimke } from './izvjestaji';
import { kalkulacijaPrimke, type StavkaZaKalkulaciju } from './kalkulacija';
import { round2 } from './novac';

const st = (p: Partial<StavkaZaKalkulaciju>): StavkaZaKalkulaciju => ({
  kolicina: 1, nabavnaCijena: 0, rabat: 0, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E', ...p,
});

// RUC kao na kalkulaciji (obrazac KCM): prodajna bez PDV-a − nabavna (fakturna − rabat + zavisni),
// samo stavke koje se prodaju; stopa RUC = RUC / nabavna tih stavki × 100.
describe('RUC primki', () => {
  test('nabavna 100, MP 117 sa PDV-om (E 17 %) → RUC 0, ne +17 %', () => {
    const p = { stavke: [st({ kolicina: 1, nabavnaCijena: 100, cijena: 117 })] };
    expect(rucPrimke(p)).toEqual({ ruc: 0, rucPct: 0 });
    expect(sumePrimke([p])).toEqual({
      nabavna: 100, nabavnaArtikala: 100, prodajnaBezPdv: 100, prodajnaSaPdv: 117, ruc: 0, rucPct: 0,
    });
  });

  test('materijal (bez prodajne) je u nabavnoj, ali ne u RUC-u ni u nabavnoj artikala', () => {
    const p = {
      stavke: [
        st({ kolicina: 10, nabavnaCijena: 10, cijena: 23.4 }),                 // artikal: nabavna 100, bez PDV 200
        st({ kolicina: 4, nabavnaCijena: 25, zavisniTroskovi: 8, cijena: 0 }), // materijal: nabavna 108
      ],
    };
    const s = sumePrimke([p]);
    expect(s.nabavna).toBe(208);
    expect(s.nabavnaArtikala).toBe(100);
    expect(s.prodajnaBezPdv).toBe(200);
    expect(s.prodajnaSaPdv).toBe(234);
    expect(s.ruc).toBe(100);
    expect(s.rucPct).toBe(100); // a ne 100 / 208
    expect(rucPrimke(p)).toEqual({ ruc: 100, rucPct: 100 });
  });

  test('rabat i zavisni troškovi ulaze u nabavnu, pa i u RUC', () => {
    // fakturna 100 − rabat 20 % + zavisni 5 = 85; prodajna bez PDV 11,70 / 1,17 × 10 = 100
    const p = { stavke: [st({ kolicina: 10, nabavnaCijena: 10, rabat: 20, zavisniTroskovi: 5, cijena: 11.7 })] };
    const s = sumePrimke([p]);
    expect(s.nabavna).toBe(85);
    expect(s.nabavnaArtikala).toBe(85);
    expect(s.ruc).toBe(15);
    expect(s.rucPct).toBe(17.65); // 15 / 85 × 100 = 17,647…
  });

  test('jedna primka daje isti RUC kao kalkulacijaPrimke (UlazDialog, PDF ulaza)', () => {
    const stavke = [
      st({ kolicina: 3, nabavnaCijena: 4.37, rabat: 7.5, zavisniTroskovi: 1.23, cijena: 7.99 }),
      st({ kolicina: 2.5, nabavnaCijena: 12.1, zavisniTroskovi: 0.77, cijena: 0 }),
      st({ kolicina: 7, nabavnaCijena: 1.15, rabat: 3, cijena: 2.2, pdvStopa: 'K' }),
    ];
    const k = kalkulacijaPrimke(stavke);
    expect(sumePrimke([{ stavke }])).toEqual({
      nabavna: round2(k.nabavna),
      nabavnaArtikala: round2(k.nabavnaArtikala),
      prodajnaBezPdv: round2(k.prodajnaBezPdv),
      prodajnaSaPdv: round2(k.prodajna),
      ruc: round2(k.ruc),
      rucPct: round2(k.rucPct),
    });
    expect(rucPrimke({ stavke })).toEqual({ ruc: round2(k.ruc), rucPct: round2(k.rucPct) });
    expect(k.ruc).not.toBe(0);
  });

  test('više primki: zbir iznosa, a stopa RUC iz zbira (ne prosjek stopa)', () => {
    const p1 = { stavke: [st({ kolicina: 1, nabavnaCijena: 100, cijena: 175.5 })] }; // bez PDV 150 → RUC 50 (50 %)
    const p2 = { stavke: [st({ kolicina: 1, nabavnaCijena: 300, cijena: 386.1 })] }; // bez PDV 330 → RUC 30 (10 %)
    expect(rucPrimke(p1)).toEqual({ ruc: 50, rucPct: 50 });
    expect(rucPrimke(p2)).toEqual({ ruc: 30, rucPct: 10 });
    expect(sumePrimke([p1, p2])).toEqual({
      nabavna: 400, nabavnaArtikala: 400, prodajnaBezPdv: 480, prodajnaSaPdv: 561.6, ruc: 80, rucPct: 20,
    });
  });

  test('bez artikala nema RUC-a; prazan period i primka bez stavki su nule', () => {
    const nule = { nabavna: 0, nabavnaArtikala: 0, prodajnaBezPdv: 0, prodajnaSaPdv: 0, ruc: 0, rucPct: 0 };
    expect(sumePrimke([])).toEqual(nule);
    expect(sumePrimke([{ stavke: [] }, {}])).toEqual(nule);
    expect(rucPrimke({})).toEqual({ ruc: 0, rucPct: 0 });
    const samoMaterijal = { stavke: [st({ kolicina: 4, nabavnaCijena: 25, cijena: 0 })] };
    expect(sumePrimke([samoMaterijal])).toEqual({ ...nule, nabavna: 100 });
    expect(rucPrimke(samoMaterijal)).toEqual({ ruc: 0, rucPct: 0 });
  });

  test('prodaja ispod nabavne daje negativan RUC', () => {
    const p = { stavke: [st({ kolicina: 2, nabavnaCijena: 50, cijena: 46.8 })] }; // bez PDV 40 × 2 = 80, nabavna 100
    expect(rucPrimke(p)).toEqual({ ruc: -20, rucPct: -20 });
  });
});
