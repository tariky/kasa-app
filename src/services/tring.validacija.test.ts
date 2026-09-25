// Svako polje koje ide uređaju mora proći kroz escape ili validaciju: stopa,
// cijena, količina, PLU... su ranije išli u XML sirovi, pa je vrijednost poput
// `E</Stopa><Stopa>K` mogla prepraviti račun. Nevaljan zahtjev se odbija PRIJE
// slanja — uređaj ga nikad ne vidi. Za ispravne ulaze XML mora ostati bajt po
// bajt isti kao ranije (tring.zlatni.txt; isti fajl provjerava i Rust backend).
import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Tring from '@/services/tring';
import { pokreniLaziTring, type LaziTring } from '@/ipc/ugovor/laziTring';

let uredjaj: LaziTring;

beforeAll(() => { uredjaj = pokreniLaziTring(); });
afterAll(() => { uredjaj.stop(); });
// Tring klijent je modul s globalnom konfiguracijom — drugi testovi je mijenjaju.
beforeEach(() => {
  Tring.configure({ host: 'localhost', port: uredjaj.port });
  uredjaj.zahtjevi.length = 0;
});

const stavka = (artikal: Record<string, unknown> = {}, ostalo: Record<string, unknown> = {}): any => ({
  artikal: { sifra: 'A1', naziv: 'Kafa', jm: 'kom', cijena: 2.5, stopa: 'E', plu: 7, ...artikal },
  kolicina: 1, rabat: 0, ...ostalo,
});
const racun = (ostalo: Record<string, unknown> = {}): any => ({
  stavke: [stavka()], vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 2.5 }], ...ostalo,
});

const bezBrojaZahtjeva = (xml: string) =>
  xml.replace(/<BrojZahtjeva>\d+<\/BrojZahtjeva>/, '<BrojZahtjeva>1</BrojZahtjeva>');

/** Tijelo jedinog poslanog zahtjeva. */
function poslano(): string {
  expect(uredjaj.zahtjevi).toHaveLength(1);
  return uredjaj.zahtjevi[0].tijelo;
}

/** Odbijeno bez kontakta s uređajem, s porukom na bosanskom. */
function odbijeno(r: Tring.TringResponse, poruka: string) {
  expect(r).toEqual({
    success: false, vrstaOdgovora: 'Greska', odgovori: {}, statusCode: null,
    error: `Zahtjev nije poslan fiskalnom uređaju: ${poruka}`,
  });
  expect(uredjaj.zahtjevi).toHaveLength(0);
}

describe('ispravni ulazi daju isti XML kao ranije', () => {
  test('bajt po bajt kao tring.zlatni.txt', async () => {
    const zlatni = readFileSync(path.join(__dirname, 'tring.zlatni.txt'), 'utf-8');
    const pun: any = {
      stavke: [
        stavka({ sifra: 'A&1', naziv: 'Kafa <dupla>', cijena: 2.5, stopa: 'E', grupa: 3, plu: 7 }, { kolicina: 2, rabat: 0 }),
        { artikal: { sifra: 'B2', naziv: "Sok 'o\"", jm: 'l', cijena: 10, stopa: 'K' }, kolicina: 0.1 + 0.2, rabat: 12.5 },
        { artikal: { sifra: 'C3', naziv: 'Mali', jm: 'g', cijena: 0.000001, stopa: 'E', plu: 999999 }, kolicina: 1.5e-7, rabat: -1 },
      ],
      vrstePlacanja: [{ oznaka: 'Ček', iznos: 20.3 }, { oznaka: 'Gotovina', iznos: 0 }],
      kupac: { idBroj: '4200000000001', naziv: 'Firma & sin', adresa: 'Ulica 1', postanskiBroj: '71000', grad: 'Sarajevo' },
      napomena: 'Hvala <3',
      brojRacuna: 12,
    };
    await Tring.stampatiFiskalniRacun(pun);
    await Tring.stampatiReklamiraniRacun({ ...pun, vrstePlacanja: [], brojRacuna: 101 });
    await Tring.stampatiFiskalniRacun({ stavke: [pun.stavke[0]], vrstePlacanja: [{ oznaka: 'Kartica', iznos: 5 }] });
    await Tring.upisiArtikal({ sifra: 'S<1>', naziv: 'Sok', jm: 'l', cijena: 1.2, stopa: 'K', plu: 12 });
    await Tring.inicijalizacija(5, 'tajna');
    await Tring.stampatiPeriodicniIzvjestaj('2026-01-05', '2026-02-10');
    await Tring.unosNovca(120.33);

    const dobiveno = uredjaj.zahtjevi.map(z => `${z.putanja}\n${bezBrojaZahtjeva(z.tijelo)}\n`).join('');
    expect(dobiveno).toBe(zlatni);
  });

  test('broj zapisan kao string se šalje kao broj', async () => {
    await Tring.stampatiFiskalniRacun(racun({
      stavke: [stavka({ cijena: ' 2.50 ', plu: '7', grupa: '3' }, { kolicina: '2', rabat: '0' })],
      vrstePlacanja: [{ oznaka: 'Gotovina', iznos: '5.00' }],
      brojRacuna: '12',
    }));
    const xml = poslano();
    expect(xml).toContain('<Cijena>2.5</Cijena><Stopa>E</Stopa><Grupa>3</Grupa><PLU>7</PLU>');
    expect(xml).toContain('<Kolicina>2</Kolicina><Rabat>0</Rabat>');
    expect(xml).toContain('<Iznos>5</Iznos>');
    expect(xml).toContain('<BrojRacuna>12</BrojRacuna>');
  });
});

describe('lozinka operatora', () => {
  test('ide kroz escape', async () => {
    await Tring.inicijalizacija(5, `a<b>&"'</Lozinka>`);
    expect(poslano()).toContain('<Lozinka>a&lt;b&gt;&amp;&quot;&apos;&lt;/Lozinka&gt;</Lozinka></Operator>');
  });
});

describe('stopa', () => {
  test.each([
    ['E</Stopa><Stopa>K'], ['e'], ['A'], [''], [null], [1],
  ])('%p se odbija', async (stopa) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ stavke: [stavka({ stopa })] })),
      'neispravna PDV stopa (dozvoljeno E ili K)');
  });

  test('i kod upisa artikla', async () => {
    odbijeno(await Tring.upisiArtikal({ sifra: 'S', naziv: 'N', jm: 'l', cijena: 1, stopa: 'K</Stopa>' as any }),
      'neispravna PDV stopa (dozvoljeno E ili K)');
  });
});

describe('numerička polja', () => {
  const nevaljani = [['1</Cijena><Cijena>0'], [NaN], [Infinity], [-Infinity], [''], ['  '], [null], [undefined],
    ['1,5'], ['0x10'], ['Infinity'], ['NaN'], ['١'], [true], [{}], [[]]] as const;

  test.each(nevaljani)('cijena %p se odbija', async (cijena) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ stavke: [stavka({ cijena })] })),
      'neispravna vrijednost polja Cijena (mora biti broj)');
  });

  test.each(nevaljani)('količina %p se odbija', async (kolicina) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ stavke: [stavka({}, { kolicina })] })),
      'neispravna vrijednost polja Kolicina (mora biti broj)');
  });

  test.each(nevaljani)('rabat %p se odbija', async (rabat) => {
    odbijeno(await Tring.stampatiReklamiraniRacun({ ...racun({ stavke: [stavka({}, { rabat })] }), brojRacuna: 3 }),
      'neispravna vrijednost polja Rabat (mora biti broj)');
  });

  test.each(nevaljani)('iznos plaćanja %p se odbija', async (iznos) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ vrstePlacanja: [{ oznaka: 'Gotovina', iznos }] })),
      'neispravna vrijednost polja Iznos (mora biti broj)');
  });

  test.each([[NaN], [Infinity]])('unos/povrat novca %p se odbija', async (iznos) => {
    odbijeno(await Tring.unosNovca(iznos), 'neispravna vrijednost polja Iznos (mora biti broj)');
    odbijeno(await Tring.povratNovca(iznos), 'neispravna vrijednost polja Iznos (mora biti broj)');
  });
});

describe('cijeli brojevi', () => {
  test.each([[-1], [1.5], [1_000_000], ['7</PLU><PLU>8'], [NaN], ['']])('PLU %p se odbija', async (plu) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ stavke: [stavka({ plu })] })),
      'neispravan PLU (mora biti cijeli broj od 0 do 999999)');
  });

  test('PLU bez vrijednosti je 0', async () => {
    await Tring.stampatiFiskalniRacun(racun({ stavke: [stavka({ plu: undefined })] }));
    expect(poslano()).toContain('<PLU>0</PLU>');
  });

  test.each([[-1], [2.5], ['3</Grupa>']])('grupa %p se odbija', async (grupa) => {
    odbijeno(await Tring.upisiArtikal({ sifra: 'S', naziv: 'N', jm: 'l', cijena: 1, stopa: 'E', grupa: grupa as any }),
      'neispravna Grupa (mora biti cijeli broj od 0 do 999999)');
  });

  test.each([[-1], [1.5], ['12</BrojRacuna>'], [1_000_000_000]])('broj računa %p se odbija', async (brojRacuna) => {
    odbijeno(await Tring.stampatiFiskalniRacun(racun({ brojRacuna })),
      'neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)');
    odbijeno(await Tring.stampatiReklamiraniRacun({ ...racun(), brojRacuna: brojRacuna as any }),
      'neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)');
  });

  test('reklamacija bez broja računa se odbija', async () => {
    odbijeno(await Tring.stampatiReklamiraniRacun({ ...racun(), brojRacuna: undefined as any }),
      'neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)');
  });
});

describe('periodični izvještaj', () => {
  test.each([
    ['2026</Vrijednost><X>-01-05'], ['26-01-05'], ['2026-01'], ['2026-01-05T00:00'], [''], [20260105],
  ])('datum %p se odbija', async (od) => {
    odbijeno(await Tring.stampatiPeriodicniIzvjestaj(od as any, '2026-02-10'),
      'neispravan datum (očekuje se GGGG-MM-DD)');
    odbijeno(await Tring.stampatiPeriodicniIzvjestaj('2026-01-05', od as any),
      'neispravan datum (očekuje se GGGG-MM-DD)');
  });
});

describe('provjeriReklamaciju (storno je zove prije unosa novca)', () => {
  test('ispravna reklamacija: null, bez slanja i bez trošenja broja zahtjeva', async () => {
    const reklamacija = racun({ brojRacuna: 55 });
    expect(Tring.provjeriReklamaciju(reklamacija)).toBeNull();
    expect(uredjaj.zahtjevi).toHaveLength(0);
    // Sljedeći pravi zahtjev dobija broj kao da provjere nije ni bilo.
    await Tring.stampatiReklamiraniRacun(reklamacija);
    const prvi = Number(/<BrojZahtjeva>(\d+)</.exec(poslano())![1]);
    uredjaj.zahtjevi.length = 0;
    expect(Tring.provjeriReklamaciju(reklamacija)).toBeNull();
    await Tring.stampatiReklamiraniRacun(reklamacija);
    expect(Number(/<BrojZahtjeva>(\d+)</.exec(poslano())![1])).toBe(prvi + 1);
  });

  test('nevaljana: ista poruka kao neuspjeh štampe, ništa ne ide uređaju', async () => {
    const lose = racun({ brojRacuna: 55, stavke: [stavka({ plu: 1_000_000 })] });
    const poruka = 'Zahtjev nije poslan fiskalnom uređaju: neispravan PLU (mora biti cijeli broj od 0 do 999999)';
    expect(Tring.provjeriReklamaciju(lose)).toBe(poruka);
    expect(Tring.provjeriReklamaciju(racun({ brojRacuna: -1 })))
      .toBe('Zahtjev nije poslan fiskalnom uređaju: neispravan BrojRacuna (mora biti cijeli broj od 0 do 999999999)');
    expect(uredjaj.zahtjevi).toHaveLength(0);
    expect((await Tring.stampatiReklamiraniRacun(lose)).error).toBe(poruka);
  });
});
