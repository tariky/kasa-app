import { test, expect, describe } from 'bun:test';
import { sumePrimke, sumePrometa, sumeNivelacija, razlikePoZnaku, formatRucPct } from './izvjestaji';
import { kalkulacijaPrimke, type StavkaZaKalkulaciju } from './kalkulacija';
import { formatKM } from './utils';
import { round2 } from './novac';
import { izluciPdv } from './pdv';

const st = (p: Partial<StavkaZaKalkulaciju>): StavkaZaKalkulaciju => ({
  kolicina: 1, nabavnaCijena: 0, rabat: 0, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E', ...p,
});

/** Sume primki nisu zaokružene (isti brojevi kao kalkulacija) — poređenje na 9 decimala, ista polja. */
function blizu(dobiveno: object, ocekivano: Record<string, number>) {
  const d = dobiveno as Record<string, number>;
  expect(Object.keys(d).sort()).toEqual(Object.keys(ocekivano).sort());
  for (const [k, v] of Object.entries(ocekivano)) expect(d[k]).toBeCloseTo(v, 9);
}

// RUC kao na kalkulaciji (obrazac KCM): prodajna bez PDV-a − nabavna (fakturna − rabat + zavisni),
// samo stavke koje se prodaju; stopa RUC = RUC / nabavna tih stavki × 100.
describe('RUC primki', () => {
  test('nabavna 100, MP 117 sa PDV-om (E 17 %) → RUC 0, ne +17 %', () => {
    const p = { stavke: [st({ kolicina: 1, nabavnaCijena: 100, cijena: 117 })] };
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
  });

  test('rabat i zavisni troškovi ulaze u nabavnu, pa i u RUC', () => {
    // fakturna 100 − rabat 20 % + zavisni 5 = 85; prodajna bez PDV 11,70 / 1,17 × 10 = 100
    const p = { stavke: [st({ kolicina: 10, nabavnaCijena: 10, rabat: 20, zavisniTroskovi: 5, cijena: 11.7 })] };
    const s = sumePrimke([p]);
    expect(s.nabavna).toBe(85);
    expect(s.nabavnaArtikala).toBe(85);
    expect(s.ruc).toBe(15);
    expect(s.rucPct).toBeCloseTo(17.647, 3); // 15 / 85 × 100
    expect(formatRucPct(s.rucPct)).toBe('17,6');
  });

  test('jedna primka daje isti RUC kao kalkulacijaPrimke (UlazDialog, PDF ulaza)', () => {
    const stavke = [
      st({ kolicina: 3, nabavnaCijena: 4.37, rabat: 7.5, zavisniTroskovi: 1.23, cijena: 7.99 }),
      st({ kolicina: 2.5, nabavnaCijena: 12.1, zavisniTroskovi: 0.77, cijena: 0 }),
      st({ kolicina: 7, nabavnaCijena: 1.15, rabat: 3, cijena: 2.2, pdvStopa: 'K' }),
    ];
    const k = kalkulacijaPrimke(stavke);
    expect(sumePrimke([{ stavke }])).toEqual({
      nabavna: k.nabavna,
      nabavnaArtikala: k.nabavnaArtikala,
      prodajnaBezPdv: k.prodajnaBezPdv,
      prodajnaSaPdv: k.prodajna,
      ruc: k.ruc,
      rucPct: k.rucPct,
    });
    expect(k.ruc).not.toBe(0);
  });

  // Regresija (review A3): zaokruživanje stope prije prikaza s jednom decimalom
  // davalo je 6,8 % na Izvještajima i u PDF-u, a UlazDialog 6.7 %.
  test('prikazana stopa RUC je ista kao u UlazDialogu (bez dvostrukog zaokruživanja)', () => {
    const stavke = [
      st({ kolicina: 10, nabavnaCijena: 37, rabat: 5, zavisniTroskovi: 12, cijena: 45.4 }),
      st({ kolicina: 2, nabavnaCijena: 15, cijena: 0 }),
    ];
    const k = kalkulacijaPrimke(stavke);
    expect(k.rucPct.toFixed(1)).toBe('6.7'); // UlazDialog: `RUC · ${k.rucPct.toFixed(1)} %`
    expect(sumePrimke([{ stavke }]).rucPct).toBe(k.rucPct);
    expect(formatRucPct(sumePrimke([{ stavke }]).rucPct)).toBe('6,7');
    expect(formatRucPct(-0.04)).toBe('-0,0');
  });

  // Isto za iznose: UlazDialog prikazuje formatKM(k.nabavna) i formatKM(k.ruc) — nabavna 11,495
  // je tamo 11,49, a round2 u izvještaju davao je 11,50.
  test('prikazani iznosi primke su isti kao u UlazDialogu', () => {
    const stavke = [st({ kolicina: 1, nabavnaCijena: 12.1, rabat: 5, cijena: 23.4, pdvStopa: 'K' })];
    const k = kalkulacijaPrimke(stavke);
    const s = sumePrimke([{ stavke }]);
    expect(formatKM(s.nabavna)).toBe(formatKM(k.nabavna));
    expect(formatKM(s.ruc)).toBe(formatKM(k.ruc));
    // Primjer vrijedi samo ako nabavna ima više od dvije decimale (inače round2 ne bi ništa promijenio).
    expect(round2(k.nabavna)).not.toBe(k.nabavna);
  });

  test('više primki: zbir iznosa, a stopa RUC iz zbira (ne prosjek stopa)', () => {
    const p1 = { stavke: [st({ kolicina: 1, nabavnaCijena: 100, cijena: 175.5 })] }; // bez PDV 150 → RUC 50 (50 %)
    const p2 = { stavke: [st({ kolicina: 1, nabavnaCijena: 300, cijena: 386.1 })] }; // bez PDV 330 → RUC 30 (10 %)
    blizu(sumePrimke([p1]), { nabavna: 100, nabavnaArtikala: 100, prodajnaBezPdv: 150, prodajnaSaPdv: 175.5, ruc: 50, rucPct: 50 });
    blizu(sumePrimke([p2]), { nabavna: 300, nabavnaArtikala: 300, prodajnaBezPdv: 330, prodajnaSaPdv: 386.1, ruc: 30, rucPct: 10 });
    blizu(sumePrimke([p1, p2]), {
      nabavna: 400, nabavnaArtikala: 400, prodajnaBezPdv: 480, prodajnaSaPdv: 561.6, ruc: 80, rucPct: 20,
    });
  });

  test('bez artikala nema RUC-a; prazan period i primka bez stavki su nule', () => {
    const nule = { nabavna: 0, nabavnaArtikala: 0, prodajnaBezPdv: 0, prodajnaSaPdv: 0, ruc: 0, rucPct: 0 };
    expect(sumePrimke([])).toEqual(nule);
    expect(sumePrimke([{ stavke: [] }, {}])).toEqual(nule);
    expect(sumePrimke([{}])).toEqual(nule);
    const samoMaterijal = { stavke: [st({ kolicina: 4, nabavnaCijena: 25, cijena: 0 })] };
    expect(sumePrimke([samoMaterijal])).toEqual({ ...nule, nabavna: 100 });
  });

  test('prodaja ispod nabavne daje negativan RUC', () => {
    const p = { stavke: [st({ kolicina: 2, nabavnaCijena: 50, cijena: 46.8 })] }; // bez PDV 40 × 2 = 80, nabavna 100
    expect(sumePrimke([p])).toMatchObject({ ruc: -20, rucPct: -20 });
  });
});

test('izluciPdv: PDV sadržan u bruto iznosu, na fening', () => {
  expect(izluciPdv(117, 17)).toBe(17);
  expect(izluciPdv(10, 17)).toBe(1.45);    // 1,4529…
  expect(izluciPdv(-23.4, 17)).toBe(-3.4);
  expect(izluciPdv(50, 0)).toBe(0);
});

describe('promet', () => {
  const racun = (ukupno: number, pdvIznos: number, status = 'completed') => ({ ukupno, pdvIznos, nacinPlacanja: 'Gotovina', status });

  test('sume samo izvršenih računa; storno ide u reklamacije; zaokruženo na fening', () => {
    const s = sumePrometa([racun(23.4, 3.4), racun(0.1, 0.01), racun(0.2, 0.03), racun(11.7, 1.7, 'refunded')]);
    expect(s).toEqual({ ukupno: 23.7, pdv: 3.44, bezPdv: 20.26, brojRacuna: 3, reklamacije: 11.7, brojReklamacija: 1 });
  });

  test('prazan period su nule', () => {
    expect(sumePrometa([])).toEqual({ ukupno: 0, pdv: 0, bezPdv: 0, brojRacuna: 0, reklamacije: 0, brojReklamacija: 0 });
  });
});

describe('nivelacije', () => {
  test('razlika = Σ količina × (nova − stara); PDV izlučen iz razlike stavki sa stopom E', () => {
    const niv = {
      stavke: [
        { kolicina: 10, staraCijena: 11.7, novaCijena: 14.04, pdvStopa: 'E' }, // +23,40 → PDV 3,40
        { kolicina: 2, staraCijena: 5, novaCijena: 4, pdvStopa: 'K' },         // −2,00, bez PDV-a
        { kolicina: 3, staraCijena: 2.34, novaCijena: 1.17, pdvStopa: 'E' },   // −3,51 → PDV −0,51
      ],
    };
    expect(sumeNivelacija([niv])).toEqual({ razlika: 17.89, pozitivna: 23.4, negativna: -5.51, pdvRazlike: 2.89 });
  });

  test('više nivelacija se sabira; bez stavki su nule', () => {
    const a = { stavke: [{ kolicina: 1, staraCijena: 10, novaCijena: 21.7, pdvStopa: 'E' }] }; // +11,70 → PDV 1,70
    const b = { stavke: [{ kolicina: 1, staraCijena: 5.85, novaCijena: 0, pdvStopa: 'E' }] };  // −5,85 → PDV −0,85
    expect(sumeNivelacija([a, b])).toEqual({ razlika: 5.85, pozitivna: 11.7, negativna: -5.85, pdvRazlike: 0.85 });
    expect(sumeNivelacija([])).toEqual({ razlika: 0, pozitivna: 0, negativna: 0, pdvRazlike: 0 });
    expect(sumeNivelacija([{ stavke: [] }, {}])).toEqual({ razlika: 0, pozitivna: 0, negativna: 0, pdvRazlike: 0 });
  });

  test('razlike po znaku (lista nivelacija na ekranu sabira ukupne razlike dokumenata)', () => {
    expect(razlikePoZnaku([0.1, -2, 0.2, 0, -0.35])).toEqual({ pozitivna: 0.3, negativna: -2.35 });
    expect(razlikePoZnaku([])).toEqual({ pozitivna: 0, negativna: 0 });
  });
});
