import { describe, expect, test } from 'bun:test';
import { akcijaListe, indeksZaTipku, sljedeciFilter, susjedni, type MjestoTipke, type MogucnostiListe } from './ledgerLista';

describe('indeksZaTipku', () => {
  test('↓ i ↑ pomjeraju za jedan, a bez izbora ↓ ide na prvi i ↑ ostaje na prvom', () => {
    expect(indeksZaTipku('ArrowDown', 2, 10)).toBe(3);
    expect(indeksZaTipku('ArrowUp', 2, 10)).toBe(1);
    expect(indeksZaTipku('ArrowDown', -1, 10)).toBe(0);
    expect(indeksZaTipku('ArrowUp', -1, 10)).toBe(0);
  });

  test('PageDown/PageUp skaču za deset, Home/End na krajeve', () => {
    expect(indeksZaTipku('PageDown', 2, 30)).toBe(12);
    expect(indeksZaTipku('PageUp', 15, 30)).toBe(5);
    expect(indeksZaTipku('PageUp', -1, 30)).toBe(0);
    expect(indeksZaTipku('PageDown', -1, 30)).toBe(9);
    expect(indeksZaTipku('Home', 7, 30)).toBe(0);
    expect(indeksZaTipku('End', 7, 30)).toBe(29);
  });

  test('izbor ne izlazi iz liste', () => {
    expect(indeksZaTipku('ArrowDown', 9, 10)).toBe(9);
    expect(indeksZaTipku('PageDown', 5, 10)).toBe(9);
    expect(indeksZaTipku('ArrowUp', 0, 10)).toBe(0);
    expect(indeksZaTipku('PageUp', 3, 10)).toBe(0);
  });

  test('prazna lista daje 0 (red ne postoji, pa se ništa ne fokusira)', () => {
    expect(indeksZaTipku('ArrowDown', -1, 0)).toBe(0);
    expect(indeksZaTipku('End', -1, 0)).toBe(0);
  });

  test('ostale tipke ne pomjeraju izbor', () => {
    for (const k of ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'n', 'Escape', 'Tab']) expect(indeksZaTipku(k, 3, 10)).toBeNull();
  });
});

describe('sljedeciFilter', () => {
  const f = [{ id: 'sve' }, { id: 'aktivni' }, { id: 'storno' }] as const;
  test('korak naprijed i nazad, u krug', () => {
    expect(sljedeciFilter(f, 'sve', 1)).toBe('aktivni');
    expect(sljedeciFilter(f, 'storno', 1)).toBe('sve');
    expect(sljedeciFilter(f, 'sve', -1)).toBe('storno');
    expect(sljedeciFilter(f, 'aktivni', -1)).toBe('sve');
  });
});

const tipka = (key: string, mod: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mod });
const van: MjestoTipke = { uPolju: false, uPretrazi: false, uListi: false, uIzborniku: false };
const uPretrazi: MjestoTipke = { ...van, uPolju: true, uPretrazi: true };
const uPolju: MjestoTipke = { ...van, uPolju: true };
const naRedu: MjestoTipke = { ...van, uListi: true };
const uIzborniku: MjestoTipke = { ...van, uIzborniku: true };

/** Mogućnosti ekrana onako kako ih ekrani prosljeđuju hooku usePreciceListe. */
const racuni: MogucnostiListe = { pretraga: true, novi: true, filteri: true, lista: true, izPretrage: 'prvi' };
const nalozi: MogucnostiListe = { novi: true, osvjezi: true, filteri: true, lista: true };
const ulazi: MogucnostiListe = { pretraga: true, novi: true, osvjezi: true, lista: true, izPretrage: 'izabrani', preskociIzbornike: false };
const artikli: MogucnostiListe = { pretraga: true, novi: true, preskociIzbornike: false };
const ponude: MogucnostiListe = { pretraga: true, novi: true, filteri: true, lista: true, izPretrage: 'prvi', strelicomUListu: false, enterOtvara: false, preskociIzbornike: false };

describe('akcijaListe', () => {
  test('modifikatori gase sve prečice liste', () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      expect(akcijaListe(tipka('n', mod), van, racuni)).toBeNull();
      expect(akcijaListe(tipka('Enter', mod), van, racuni)).toBeNull();
      expect(akcijaListe(tipka('p', mod), van, ponude)).toBeNull();
    }
  });

  test('u pretrazi: esc briše upit, ↓ vodi u listu (prvi ili izabrani red), ostalo ide u polje', () => {
    expect(akcijaListe(tipka('Escape'), uPretrazi, racuni)).toEqual({ vrsta: 'ocistiPretragu' });
    expect(akcijaListe(tipka('ArrowDown'), uPretrazi, racuni)).toEqual({ vrsta: 'izPretrage', na: 'prvi' });
    expect(akcijaListe(tipka('ArrowDown'), uPretrazi, ulazi)).toEqual({ vrsta: 'izPretrage', na: 'izabrani' });
    expect(akcijaListe(tipka('ArrowDown'), uPretrazi, artikli)).toBeNull();
    expect(akcijaListe(tipka('Escape'), uPretrazi, artikli)).toEqual({ vrsta: 'ocistiPretragu' });
    for (const k of ['n', '/', 'ArrowUp', 'Enter', 'ArrowLeft', 'p']) expect(akcijaListe(tipka(k), uPretrazi, ponude)).toBeNull();
  });

  test('u drugom polju za unos nema prečica liste — ni esc ni ↓', () => {
    for (const k of ['Escape', 'ArrowDown', 'n', '/', 'r', 'p', '1']) {
      expect(akcijaListe(tipka(k), uPolju, racuni)).toBeNull();
      expect(akcijaListe(tipka(k), uPolju, ponude)).toBeNull();
    }
  });

  test('„/“ fokusira pretragu, N novi dokument (i veliko N), R osvježava gdje ga ima', () => {
    expect(akcijaListe(tipka('/'), van, racuni)).toEqual({ vrsta: 'pretraga' });
    expect(akcijaListe(tipka('n'), van, racuni)).toEqual({ vrsta: 'novi' });
    expect(akcijaListe(tipka('N'), naRedu, racuni)).toEqual({ vrsta: 'novi' });
    expect(akcijaListe(tipka('r'), van, nalozi)).toEqual({ vrsta: 'osvjezi' });
    expect(akcijaListe(tipka('R'), van, ulazi)).toEqual({ vrsta: 'osvjezi' });
    expect(akcijaListe(tipka('r'), van, racuni)).toBe('dalje');
    expect(akcijaListe(tipka('/'), van, nalozi)).toBe('dalje');
  });

  test('←→ i [ ] mijenjaju filter i s reda liste', () => {
    for (const m of [racuni, nalozi, ponude]) {
      expect(akcijaListe(tipka('ArrowLeft'), naRedu, m)).toEqual({ vrsta: 'filter', korak: -1 });
      expect(akcijaListe(tipka('['), van, m)).toEqual({ vrsta: 'filter', korak: -1 });
      expect(akcijaListe(tipka('ArrowRight'), van, m)).toEqual({ vrsta: 'filter', korak: 1 });
      expect(akcijaListe(tipka(']'), naRedu, m)).toEqual({ vrsta: 'filter', korak: 1 });
    }
    expect(akcijaListe(tipka('ArrowLeft'), van, ulazi)).toBe('dalje');
    expect(akcijaListe(tipka(']'), van, artikli)).toBe('dalje');
  });

  test('↑↓ van liste uvode fokus u listu; na redu ih vodi sama lista', () => {
    expect(akcijaListe(tipka('ArrowDown'), van, racuni)).toEqual({ vrsta: 'uListu' });
    expect(akcijaListe(tipka('ArrowUp'), van, nalozi)).toEqual({ vrsta: 'uListu' });
    expect(akcijaListe(tipka('ArrowDown'), naRedu, racuni)).toBeNull();
    expect(akcijaListe(tipka('ArrowDown'), van, ponude)).toBe('dalje');
    expect(akcijaListe(tipka('ArrowDown'), van, artikli)).toBe('dalje');
  });

  test('↵ van liste otvara izabrani dokument; na redu ga otvara sama lista', () => {
    expect(akcijaListe(tipka('Enter'), van, racuni)).toEqual({ vrsta: 'otvori' });
    expect(akcijaListe(tipka('Enter'), van, ulazi)).toEqual({ vrsta: 'otvori' });
    expect(akcijaListe(tipka('Enter'), naRedu, racuni)).toBeNull();
    expect(akcijaListe(tipka('Enter'), van, ponude)).toBe('dalje');
    expect(akcijaListe(tipka('Enter'), van, artikli)).toBe('dalje');
  });

  test('u padajućem izborniku (combobox/listbox) prečice liste miruju — osim gdje ih ekran i tada pušta', () => {
    for (const k of ['n', '/', 'ArrowLeft', 'ArrowDown', 'Enter', 'r']) {
      expect(akcijaListe(tipka(k), uIzborniku, racuni)).toBeNull();
      expect(akcijaListe(tipka(k), uIzborniku, nalozi)).toBeNull();
    }
    expect(akcijaListe(tipka('ArrowRight'), uIzborniku, ponude)).toEqual({ vrsta: 'filter', korak: 1 });
    expect(akcijaListe(tipka('n'), uIzborniku, ponude)).toEqual({ vrsta: 'novi' });
    expect(akcijaListe(tipka('p'), uIzborniku, ponude)).toBe('dalje');
  });

  test('ostale tipke idu dalje (dodatne prečice ekrana), i s reda liste', () => {
    for (const k of ['p', 's', 'u', 'k', 'f', 'd', '1', 'Escape', ' ']) {
      expect(akcijaListe(tipka(k), van, ponude)).toBe('dalje');
      expect(akcijaListe(tipka(k), naRedu, ponude)).toBe('dalje');
    }
  });
});

describe('susjedni', () => {
  test('prethodni i sljedeći dokument po redoslijedu liste, s pozicijom', () => {
    expect(susjedni([7, 3, 9], 3)).toEqual({ prev: 7, next: 9, pozicija: '2 / 3' });
  });

  test('prvi nema prethodnog, zadnji nema sljedećeg', () => {
    expect(susjedni([7, 3, 9], 7)).toEqual({ prev: null, next: 3, pozicija: '1 / 3' });
    expect(susjedni([7, 3, 9], 9)).toEqual({ prev: 3, next: null, pozicija: '3 / 3' });
    expect(susjedni([5], 5)).toEqual({ prev: null, next: null, pozicija: '1 / 1' });
  });

  test('dokument van liste (filter ga skriva) ili bez id-a: bez susjeda i bez pozicije', () => {
    expect(susjedni([7, 3, 9], 4)).toEqual({ prev: null, next: null, pozicija: '' });
    expect(susjedni([7, 3, 9], null)).toEqual({ prev: null, next: null, pozicija: '' });
    expect(susjedni([], 4)).toEqual({ prev: null, next: null, pozicija: '' });
  });
});
