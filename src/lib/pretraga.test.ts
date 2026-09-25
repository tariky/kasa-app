import { describe, test, expect } from 'bun:test';
import { filtriraj, normalizuj, parsirajUpit, pretrazi, uvecajKolicinu, type PoljaPretrage } from './pretraga';

interface S { id: number; naziv: string; sifra: string; barkod?: string; dodatno?: string }
const polja = (s: S): PoljaPretrage => ({ naziv: s.naziv, sifra: s.sifra, barkod: s.barkod, dodatno: s.dodatno });

const KATALOG: S[] = [
  { id: 1, naziv: 'Šarka Blum Clip top 110° s amortizerom', sifra: 'M-140' },
  { id: 2, naziv: 'Šarka Blum Clip top 155° ugaona', sifra: 'M-141' },
  { id: 3, naziv: 'Iverica Kronospan hrast sonoma 18 mm', sifra: 'M-104' },
  { id: 4, naziv: 'Ladičar 3 ladice hrast sonoma', sifra: 'A-1020' },
  { id: 5, naziv: 'Mlijeko za poliranje namještaja 250 ml', sifra: 'A-1110' },
  { id: 6, naziv: 'Kuhinjski element donji 60 cm bijeli', sifra: 'A-1010' },
  { id: 7, naziv: 'Ručka aluminij 128 mm inox izgled', sifra: 'A-1001', barkod: '3870001001283' },
  { id: 8, naziv: 'Kant traka ABS bijela 22×2 mm', sifra: 'M-130', dodatno: 'KT-22-2W 88104' },
  { id: 9, naziv: 'Vijak konfirmat 7×50', sifra: 'M-160' },
];
const ids = (upit: string, opts?: Parameters<typeof pretrazi<S>>[3]) => pretrazi(KATALOG, upit, polja, opts).map(p => p.stavka.id);

describe('normalizuj', () => {
  test('skida kvačice i mala slova, znak po znak', () => {
    expect(normalizuj('Šarka ČĆŽĐ')).toBe('sarka cczd');
    expect(normalizuj('Ladičar').length).toBe('Ladičar'.length);
  });
});

describe('parsirajUpit', () => {
  test('prefiks količine', () => {
    expect(parsirajUpit('3*kant bijela')).toEqual({ upit: 'kant bijela', kolicina: 3 });
    expect(parsirajUpit(' 2,5 * iverica')).toEqual({ upit: 'iverica', kolicina: 2.5 });
    expect(parsirajUpit('7×50')).toEqual({ upit: '7×50', kolicina: null });
  });
  test('bez prefiksa', () => {
    expect(parsirajUpit('  hrast ')).toEqual({ upit: 'hrast', kolicina: null });
  });
});

describe('pretrazi', () => {
  test('prazan upit ne vraća ništa', () => {
    expect(ids('   ')).toEqual([]);
  });

  test('bez kvačica i bez obzira na redoslijed riječi', () => {
    expect(ids('sarka blum 110')[0]).toBe(1);
    expect(ids('blum sarka')).toEqual(expect.arrayContaining([1, 2]));
    expect(ids('ladicar')).toEqual([4]);
  });

  test('izostavljena slova', () => {
    expect(ids('hrst sonom')).toEqual(expect.arrayContaining([3, 4]));
    expect(ids('hrst sonom')).toHaveLength(2);
  });

  test('jedna greška u kucanju u dužim riječima', () => {
    expect(ids('mljeko')).toEqual([5]);
    expect(ids('kuhinski')).toEqual([6]);
    expect(ids('sraka')).toEqual(expect.arrayContaining([1, 2])); // transpozicija
  });

  test('svaka riječ mora pogoditi', () => {
    expect(ids('sarka hrast')).toEqual([]);
  });

  test('ne pogađa razbacana slova', () => {
    expect(ids('xyz')).toEqual([]);
    expect(ids('qqq')).toEqual([]);
  });

  test('šifra ima prednost i označava se', () => {
    const r = pretrazi(KATALOG, 'm-14', polja);
    expect(r.map(p => p.stavka.id).slice(0, 2).sort()).toEqual([1, 2]);
    expect(r[0].sifraPogodak).toBe(true);
    expect(ids('m141')[0]).toBe(2);
  });

  test('tačan barkod vraća samo taj artikal', () => {
    const r = pretrazi(KATALOG, '3870001001283', polja);
    expect(r.map(p => p.stavka.id)).toEqual([7]);
    expect(r[0].barkodPogodak).toBe(true);
  });

  test('dodatno polje (šifre dobavljača) se pretražuje', () => {
    expect(ids('kt-22-2w')).toEqual([8]);
    expect(ids('88104')).toEqual([8]);
  });

  test('indeksi pogodaka u nazivu pokazuju na original', () => {
    const [p] = pretrazi(KATALOG, 'ladicar', polja);
    expect(p.nazivIdx).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const [q] = pretrazi(KATALOG, 'konfirmat', polja);
    expect(KATALOG[8].naziv.slice(q.nazivIdx[0], q.nazivIdx[q.nazivIdx.length - 1] + 1)).toBe('konfirmat');
  });

  test('početak riječi ide ispred sredine riječi', () => {
    const lista: S[] = [
      { id: 1, naziv: 'Silikon sanitarni', sifra: 'X1' },
      { id: 2, naziv: 'Sanitarni silikon', sifra: 'X2' },
      { id: 3, naziv: 'Presanitarni', sifra: 'X3' },
    ];
    expect(pretrazi(lista, 'sanit', polja).map(p => p.stavka.id)).toEqual([2, 1, 3]);
  });

  test('bonus pomjera stavku naprijed', () => {
    const bez = ids('blum');
    const sa = ids('blum', { bonus: s => (s.id === 1 ? 500 : 0) });
    expect(bez[0]).toBe(2); // kraći naziv
    expect(sa[0]).toBe(1);
  });

  test('max ograničava broj rezultata', () => {
    expect(ids('a', { max: 3 })).toHaveLength(3);
  });
});

describe('uvecajKolicinu', () => {
  test('dodaje na upisanu količinu', () => {
    expect(uvecajKolicinu('2,5', 3)).toBe('5,5');
    expect(uvecajKolicinu('', 2)).toBe('2');
    expect(uvecajKolicinu('0,1', 0.2)).toBe('0,3');
  });
});

describe('filtriraj', () => {
  const fIds = (upit: string) => filtriraj(KATALOG, upit, polja).map(s => s.id);

  test('prazan upit vraća sve, novi niz', () => {
    const sve = filtriraj(KATALOG, '  ', polja);
    expect(sve.map(s => s.id)).toEqual(KATALOG.map(s => s.id));
    expect(sve).not.toBe(KATALOG);
  });

  test('zadržava originalni redoslijed, ne skor', () => {
    // pretrazi stavlja kraći naziv (2) prvi; filter ostaje redom liste
    expect(ids('sarka')).toEqual([2, 1]);
    expect(fIds('sarka')).toEqual([1, 2]);
    expect(fIds('hrast sonoma')).toEqual([3, 4]);
  });

  test('bez kvačica, s greškom u kucanju i po dodatnom polju', () => {
    expect(fIds('ladicar')).toEqual([4]);
    expect(fIds('mljeko')).toEqual([5]);
    expect(fIds('88104')).toEqual([8]);
  });
});
