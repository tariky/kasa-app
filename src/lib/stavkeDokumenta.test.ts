import { test, expect, describe } from 'bun:test';
import { dodajProizvod, izmijeni, ukloni, izReda, uPayload, totaliStavki, type StavkaDokumenta } from './stavkeDokumenta';
import { izracunajTotale } from './racun';
import { sumaPriloga } from './prilog';
import type { Product } from '@/types';

function artikal(overrides: Partial<Product> = {}): Product {
  return {
    id: 1, sifra: '001', naziv: 'Vijak', jm: 'kom', cijena: 10,
    pdvStopa: 'E', tip: 'artikal', createdAt: '', updatedAt: '', stanje: 5,
    ...overrides,
  };
}

function stavka(overrides: Partial<StavkaDokumenta> = {}): StavkaDokumenta {
  return {
    productId: 1, naziv: 'Vijak', jm: 'kom', sifra: '001', tip: 'artikal',
    kolicina: 1, cijena: 10, rabat: 0, pdvStopa: 'E', stanje: 5,
    ...overrides,
  };
}

describe('dodajProizvod', () => {
  test('nova stavka nosi podatke proizvoda, količinu i stanje u trenutku dodavanja', () => {
    expect(dodajProizvod([], artikal(), 2)).toEqual([stavka({ kolicina: 2 })]);
  });

  test('bez količine (null) dodaje 1', () => {
    expect(dodajProizvod([], artikal(), null)[0].kolicina).toBe(1);
  });

  test('rabat kupca ide na novu stavku; bez njega rabat je 0', () => {
    expect(dodajProizvod([], artikal(), 1, { rabat: 7.5 })[0].rabat).toBe(7.5);
    expect(dodajProizvod([], artikal(), 1, {})[0].rabat).toBe(0);
  });

  test('isti proizvod se spaja: količina se sabira i zaokružuje na 3 decimale, rabat postojeće ostaje', () => {
    const prije = [stavka({ kolicina: 0.1, rabat: 3 })];
    const poslije = dodajProizvod(prije, artikal(), 0.2, { rabat: 10 });
    expect(poslije).toEqual([stavka({ kolicina: 0.3, rabat: 3 })]);
  });

  test('drugi proizvod ide na kraj, postojeći redovi se ne diraju', () => {
    const prije = [stavka()];
    const poslije = dodajProizvod(prije, artikal({ id: 2, sifra: '002', naziv: 'Matica' }), 1);
    expect(poslije).toHaveLength(2);
    expect(poslije[0]).toBe(prije[0]);
    expect(poslije[1]).toMatchObject({ productId: 2, naziv: 'Matica', sifra: '002' });
  });

  test('ne mijenja ulaznu listu', () => {
    const prije = [stavka()];
    dodajProizvod(prije, artikal(), 5);
    expect(prije).toEqual([stavka()]);
  });

  test('prazna jedinica mjere postaje „kom“', () => {
    expect(dodajProizvod([], artikal({ jm: '' }), 1)[0].jm).toBe('kom');
  });

  test('usluga i slobodna stavka nemaju stanje; nepoznato stanje je null', () => {
    expect(dodajProizvod([], artikal({ tip: 'usluga', stanje: 3 }), 1)[0].stanje).toBeNull();
    expect(dodajProizvod([], artikal({ slobodan: 1, stanje: 3 }), 1)[0].stanje).toBeNull();
    expect(dodajProizvod([], artikal({ stanje: undefined }), 1)[0].stanje).toBeNull();
  });
});

describe('izmijeni i ukloni', () => {
  const lista = [stavka(), stavka({ productId: 2, naziv: 'Matica' })];

  test('izmijeni mijenja samo stavku tog proizvoda', () => {
    const poslije = izmijeni(lista, 2, { kolicina: 4, rabat: 5 });
    expect(poslije[0]).toBe(lista[0]);
    expect(poslije[1]).toEqual(stavka({ productId: 2, naziv: 'Matica', kolicina: 4, rabat: 5 }));
  });

  test('ukloni izbacuje stavku tog proizvoda', () => {
    expect(ukloni(lista, 1)).toEqual([lista[1]]);
  });
});

describe('izReda', () => {
  test('red iz baze (ponuda, prilog) → stavka; naziv i jedinica iz artikla', () => {
    expect(izReda({
      productId: 7, productNaziv: 'Daska', productJm: 'm', productSifra: 'D1', productTip: 'usluga',
      kolicina: 2.5, cijena: 12, rabat: 10, pdvStopa: 'E',
    })).toEqual({
      productId: 7, naziv: 'Daska', jm: 'm', sifra: 'D1', tip: 'usluga',
      kolicina: 2.5, cijena: 12, rabat: 10, pdvStopa: 'E', stanje: null,
    });
  });

  test('obrisan artikal: naziv „#id“, jedinica „kom“, prazna šifra, tip artikal; rabat null je 0', () => {
    expect(izReda({ productId: 9, kolicina: 1, cijena: 5, rabat: null, pdvStopa: 'K' })).toEqual({
      productId: 9, naziv: '#9', jm: 'kom', sifra: '', tip: 'artikal',
      kolicina: 1, cijena: 5, rabat: 0, pdvStopa: 'K', stanje: null,
    });
  });
});

test('uPayload šalje samo polja ugovora', () => {
  expect(uPayload([stavka({ kolicina: 2, rabat: 5 })])).toEqual([
    { productId: 1, kolicina: 2, cijena: 10, rabat: 5, pdvStopa: 'E' },
  ]);
});

describe('totaliStavki', () => {
  const stavke = [
    stavka({ cijena: 11.7, kolicina: 2, rabat: 2.5 }),
    stavka({ productId: 2, cijena: 5.35, kolicina: 1, rabat: 50 }),
    stavka({ productId: 3, cijena: 20, kolicina: 1.5, pdvStopa: 'K' }),
  ];

  test('isto kao izracunajTotale i suma priloga', () => {
    const t = totaliStavki(stavke);
    expect(t).toEqual(izracunajTotale(stavke));
    expect(t.ukupno).toBe(sumaPriloga(stavke));
  });

  test('neispravna cijena ili količina (NaN) se broji kao 0 dok se ne ispravi', () => {
    expect(totaliStavki([...stavke, stavka({ productId: 4, cijena: NaN })])).toEqual(izracunajTotale(stavke));
    expect(totaliStavki([stavka({ kolicina: NaN })])).toEqual({ ukupno: 0, pdvIznos: 0 });
  });
});
