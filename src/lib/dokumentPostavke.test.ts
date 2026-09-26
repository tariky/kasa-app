import { test, expect, describe } from 'bun:test';
import {
  ZADANE_DOKUMENT_POSTAVKE as Z, KLJUCEVI_DOKUMENATA, procitajDokumentPostavke, uKljuceve,
  formatBroja, zadanoZaKupca, primijeniRabatKupca, pecatZa, formatRabat, rokUIzbor, zadanoZaFakturu,
  nacinKupcaNaKasi, nacinBezKupca,
} from './dokumentPostavke';

describe('procitajDokumentPostavke', () => {
  test('prazna baza daje zadane vrijednosti (današnji izgled)', () => {
    const p = procitajDokumentPostavke({});
    expect(p).toEqual(Z);
    expect(p.faktura).toEqual({ rokDana: null, nacinPlacanja: 'Virman', napomena: '' });
    expect(p.ponuda.vaziDana).toBe(8);
    expect(p.ponuda.uslovi).toBe('Cijene su izražene u KM sa uračunatim PDV-om.');
    expect(p.ponuda.nacinPlacanja).toBe('Gotovina');
    expect(p.ponuda.broj).toEqual({ prefiks: '', cifara: 0 });
    expect(p.nalog.broj).toEqual({ prefiks: 'RN-', cifara: 0 });
    expect(p.potpisi.faktura).toEqual({ lijevo: 'Izdao', desno: 'Primio' });
    expect(p.potpisi.ponuda).toEqual({ lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' });
    expect(p.potpisi.racun).toEqual({ lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' });
    expect(p.potpisi.otpremnica).toEqual({ lijevo: 'Robu izdao', desno: 'Robu primio' });
    expect(p.potpisi.nalog).toEqual({ lijevo: 'Izradio', desno: 'Preuzeo' });
    expect(p.pecat).toEqual({ slika: '', velicina: 90, na: { faktura: false, ponuda: false, otpremnica: false, racun: false } });
    expect(p.kolone).toEqual({ sifra: false, jm: true });
    expect(p.podnozje).toBe('');
  });

  test('čita spremljene vrijednosti', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '30',
      'dokumenti.faktura.nacinPlacanja': 'Gotovina',
      'dokumenti.faktura.napomena': '  Poziv na broj: 123 ',
      'dokumenti.ponuda.vaziDana': '15',
      'dokumenti.ponuda.prefiks': 'P-',
      'dokumenti.ponuda.cifara': '3',
      'dokumenti.nalog.prefiks': '',
      'dokumenti.potpis.faktura.lijevo': 'Fakturisao',
      'dokumenti.pecat': 'data:image/png;base64,AAA',
      'dokumenti.pecat.faktura': 'true',
      'dokumenti.kolone.sifra': 'true',
      'dokumenti.kolone.jm': 'false',
    });
    expect(p.faktura).toEqual({ rokDana: 30, nacinPlacanja: 'Gotovina', napomena: 'Poziv na broj: 123' });
    expect(p.ponuda.vaziDana).toBe(15);
    expect(p.ponuda.broj).toEqual({ prefiks: 'P-', cifara: 3 });
    expect(p.nalog.broj).toEqual({ prefiks: '', cifara: 0 });
    expect(p.potpisi.faktura).toEqual({ lijevo: 'Fakturisao', desno: 'Primio' });
    expect(p.pecat.na.faktura).toBe(true);
    expect(p.kolone).toEqual({ sifra: true, jm: false });
  });

  test('nevažeći brojevi i izbori padaju na zadano', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '-1',
      'dokumenti.faktura.nacinPlacanja': 'Bitcoin',
      'dokumenti.ponuda.vaziDana': '0',
      'dokumenti.ponuda.cifara': '9',
      'dokumenti.pecatVelicina': '500',
      'dokumenti.kolone.jm': 'možda',
    });
    expect(p.faktura.rokDana).toBeNull();
    expect(p.faktura.nacinPlacanja).toBe('Virman');
    expect(p.ponuda.vaziDana).toBe(8);
    expect(p.ponuda.broj.cifara).toBe(0);
    expect(p.pecat.velicina).toBe(90);
    expect(p.kolone.jm).toBe(true);
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '366' }).faktura.rokDana).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '2.5' }).faktura.rokDana).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '0' }).faktura.rokDana).toBe(0);
  });

  test('prazan string: tekst ostaje prazan, naziv potpisa pada na zadano', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.ponuda.uslovi': '',
      'dokumenti.potpis.ponuda.desno': '   ',
      'dokumenti.faktura.rokDana': '',
    });
    expect(p.ponuda.uslovi).toBe('');
    expect(p.potpisi.ponuda.desno).toBe('Potpis primaoca');
    expect(p.faktura.rokDana).toBeNull();
  });

  test('tekstovi se skraćuju na limit', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.podnozje': 'x'.repeat(400),
      'dokumenti.ponuda.prefiks': 'PREDUGACKI-',
      'dokumenti.potpis.nalog.lijevo': 'y'.repeat(50),
    });
    expect(p.podnozje).toHaveLength(300);
    expect(p.ponuda.broj.prefiks).toBe('PREDUGAC');
    expect(p.potpisi.nalog.lijevo).toHaveLength(30);
  });

  test('uKljuceve i procitaj su inverzni i pokrivaju sve ključeve', () => {
    const p = procitajDokumentPostavke({
      'dokumenti.faktura.rokDana': '15', 'dokumenti.ponuda.prefiks': 'P-', 'dokumenti.pecat.racun': 'true',
    });
    const k = uKljuceve(p);
    expect(Object.keys(k).sort()).toEqual([...KLJUCEVI_DOKUMENATA].sort());
    expect(procitajDokumentPostavke(k)).toEqual(p);
    expect(uKljuceve(Z)['dokumenti.faktura.rokDana']).toBe('');
  });
});

describe('nastavak numeracije', () => {
  test('nastavak numeracije se čita samo kad su broj i godina ispravni', () => {
    expect(procitajDokumentPostavke({}).ponuda.nastavak).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.ponuda.nastavakBroj': '12', 'dokumenti.ponuda.nastavakGodina': '2026' }).ponuda.nastavak)
      .toEqual({ broj: 12, godina: 2026 });
    expect(procitajDokumentPostavke({ 'dokumenti.ponuda.nastavakBroj': '12' }).ponuda.nastavak).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.nalog.nastavakBroj': '0', 'dokumenti.nalog.nastavakGodina': '2026' }).nalog.nastavak).toBeNull();
    expect(procitajDokumentPostavke({ 'dokumenti.nalog.nastavakBroj': '', 'dokumenti.nalog.nastavakGodina': '' }).nalog.nastavak).toBeNull();
  });
});

describe('formatBroja', () => {
  test('bez prefiksa i nula = današnji oblik', () => {
    expect(formatBroja({ broj: 12, godina: 2026 }, { prefiks: '', cifara: 0 })).toBe('12/2026');
  });
  test('prefiks i nule', () => {
    expect(formatBroja({ broj: 3, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-003/2026');
    expect(formatBroja({ broj: 1234, godina: 2026 }, { prefiks: 'P-', cifara: 3 })).toBe('P-1234/2026');
    expect(formatBroja({ broj: 2, godina: 2026 }, { prefiks: 'RN-', cifara: 0 })).toBe('RN-2/2026');
  });
});

describe('zadanoZaKupca', () => {
  const p = procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '15' });
  test('bez kupca: globalno', () => {
    expect(zadanoZaKupca(null, p, 'faktura')).toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 });
    expect(zadanoZaKupca(undefined, p, 'ponuda')).toEqual({ rokDana: null, nacinPlacanja: 'Gotovina', rabat: 0 });
  });
  test('kupac gazi globalno, NULL polja padaju na globalno', () => {
    expect(zadanoZaKupca({ rokPlacanjaDana: 30, nacinPlacanja: 'Kartica', rabat: 5 }, p, 'faktura'))
      .toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 5 });
    expect(zadanoZaKupca({ rokPlacanjaDana: null, nacinPlacanja: null, rabat: null }, p, 'faktura'))
      .toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 });
    expect(zadanoZaKupca({ rokPlacanjaDana: 0, nacinPlacanja: 'Gotovina', rabat: 2.5 }, p, 'ponuda'))
      .toEqual({ rokDana: 0, nacinPlacanja: 'Gotovina', rabat: 2.5 });
  });
  test('nepoznat način plaćanja kupca se ignoriše', () => {
    expect(zadanoZaKupca({ nacinPlacanja: 'Bitcoin' }, p, 'faktura').nacinPlacanja).toBe('Virman');
  });
});

describe('primijeniRabatKupca', () => {
  test('dira samo stavke s rabatom 0', () => {
    const s = [{ id: 1, rabat: 0 }, { id: 2, rabat: 10 }, { id: 3, rabat: 0 }];
    expect(primijeniRabatKupca(s, 5)).toEqual([{ id: 1, rabat: 5 }, { id: 2, rabat: 10 }, { id: 3, rabat: 5 }]);
  });
  test('rabat 0 ne mijenja ništa i vraća isti niz', () => {
    const s = [{ id: 1, rabat: 0 }];
    expect(primijeniRabatKupca(s, 0)).toBe(s);
  });
});

describe('pecatZa', () => {
  const slika = 'data:image/png;base64,AAA';
  test('slika + uključen dokument', () => {
    const p = procitajDokumentPostavke({ 'dokumenti.pecat': slika, 'dokumenti.pecat.faktura': 'true', 'dokumenti.pecatVelicina': '120' });
    expect(pecatZa(p, 'faktura')).toEqual({ slika, velicina: 120 });
    expect(pecatZa(p, 'ponuda')).toBeNull();
  });
  test('uključen bez slike ili sa smećem → null', () => {
    expect(pecatZa(procitajDokumentPostavke({ 'dokumenti.pecat.faktura': 'true' }), 'faktura')).toBeNull();
    expect(pecatZa(procitajDokumentPostavke({ 'dokumenti.pecat': 'nije-slika', 'dokumenti.pecat.faktura': 'true' }), 'faktura')).toBeNull();
  });
});

describe('način plaćanja kupca na kasi', () => {
  test('samo ispravan kupčev način, bez globalnog fakturnog', () => {
    expect(nacinKupcaNaKasi({ nacinPlacanja: 'Kartica' })).toBe('Kartica');
    expect(nacinKupcaNaKasi({ nacinPlacanja: 'Ček' })).toBe('Ček');
    expect(nacinKupcaNaKasi({ nacinPlacanja: null })).toBeNull();
    expect(nacinKupcaNaKasi({})).toBeNull();
    expect(nacinKupcaNaKasi({ nacinPlacanja: 'Bitcoin' })).toBeNull();
    expect(nacinKupcaNaKasi({ nacinPlacanja: '' })).toBeNull();
  });
  test('bez kupca: kupčev način se vraća na Gotovinu, ručni izbor ostaje', () => {
    expect(nacinBezKupca('Kartica', 'Kartica')).toBe('Gotovina');
    expect(nacinBezKupca('Virman', 'Kartica')).toBe('Virman');
    expect(nacinBezKupca('Kartica', null)).toBe('Kartica');
    expect(nacinBezKupca('Gotovina', null)).toBe('Gotovina');
  });
});

describe('formatRabat', () => {
  test('do 2 decimale, zarez, bez suvišnih nula', () => {
    expect(formatRabat(5)).toBe('5%');
    expect(formatRabat(2.5)).toBe('2,5%');
    expect(formatRabat(12.75)).toBe('12,75%');
    expect(formatRabat(3.333)).toBe('3,33%');
  });

  test('zaokružuje kao round2 (1.005 → 1,01%)', () => {
    expect(formatRabat(1.005)).toBe('1,01%');
  });
});

describe('rokUIzbor', () => {
  const BRZI = [8, 15, 30, 60] as const;
  test('bez roka', () => expect(rokUIzbor(null, BRZI)).toEqual({ rok: null, dana: null }));
  test('brzi izbor', () => expect(rokUIzbor(30, BRZI)).toEqual({ rok: 30, dana: 30 }));
  test('ostali dani idu na datum', () => expect(rokUIzbor(45, BRZI)).toEqual({ rok: 'datum', dana: 45 }));
  test('0 dana = danas, kao datum', () => expect(rokUIzbor(0, BRZI)).toEqual({ rok: 'datum', dana: 0 }));
});

describe('zadanoZaFakturu', () => {
  const p = procitajDokumentPostavke({ 'dokumenti.faktura.rokDana': '15' });
  const kupac = { rokPlacanjaDana: 30, nacinPlacanja: 'Kartica', rabat: 5 };
  test('nova faktura: sve od kupca', () =>
    expect(zadanoZaFakturu(kupac, p, 'nova')).toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 5 }));
  test('iz ponude: rok i način od kupca, rabat ne', () =>
    expect(zadanoZaFakturu(kupac, p, 'ponuda')).toEqual({ rokDana: 30, nacinPlacanja: 'Kartica', rabat: 0 }));
  test('skica: ništa', () => expect(zadanoZaFakturu(kupac, p, 'skica')).toBeNull());
  test('ručno upisana firma (nema u šifarniku): globalno', () =>
    expect(zadanoZaFakturu(undefined, p, 'nova')).toEqual({ rokDana: 15, nacinPlacanja: 'Virman', rabat: 0 }));
});
