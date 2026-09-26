import { test, expect } from 'bun:test';
import { kanonskiNacinPlacanja, opisPlacanja, raspodjelaPlacanja, pripremiPlacanje } from './placanje';

test('opisPlacanja: stari tekstualni oblici ostaju, razbijeno plaćanje po vrstama s iznosima', () => {
  expect(opisPlacanja('Gotovina', 10)).toBe('Gotovina');
  expect(opisPlacanja('Ček', 10)).toBe('Ček');
  expect(opisPlacanja('Bitcoin', 10)).toBe('Bitcoin');
  expect(opisPlacanja('', 10)).toBe('');
  expect(opisPlacanja('{"gotovina":3,"cek":2}', 5)).toBe('Gotovina 3,00 KM + Ček 2,00 KM');
  expect(opisPlacanja(JSON.stringify({ gotovina: 5, kartica: 2.35 }), 7.35)).toBe('Gotovina 5,00 KM + Kartica 2,35 KM');
  // Jedna vrsta u JSON-u (stari zapis) = samo naziv.
  expect(opisPlacanja('{"kartica":4}', 4)).toBe('Kartica');
  expect(opisPlacanja('{"zlato":4}', 4)).toBe('{"zlato":4}');
  // Prevedeni nazivi (engleski PDF računa).
  expect(opisPlacanja('{"gotovina":3,"kartica":2}', 5, { gotovina: 'Cash', kartica: 'Card' })).toBe('Cash 3,00 KM + Card 2,00 KM');
  expect(opisPlacanja('Gotovina', 5, { gotovina: 'Cash' })).toBe('Cash');
});

test('ono što pripremiPlacanje upiše, raspodjelaPlacanja pročita kao iste iznose', () => {
  const { nacinPlacanja } = pripremiPlacanje('Gotovina', [{ oznaka: 'Gotovina', iznos: 3 }, { oznaka: 'Ček', iznos: 2 }], 5);
  expect(raspodjelaPlacanja(nacinPlacanja, 5).iznosi).toEqual({ gotovina: 3, kartica: 0, virman: 0, cek: 2 });
});

test('raspodjelaPlacanja: imena iz prototipa objekta nisu vrste plaćanja', () => {
  expect(raspodjelaPlacanja('constructor', 5).poznat).toBe(false);
  expect(raspodjelaPlacanja('__proto__', 5).poznat).toBe(false);
  expect(raspodjelaPlacanja('{"gotovina":5,"constructor":1}', 6).poznat).toBe(false);
});

test('kanonskiNacinPlacanja: tekst i JSON ključevi u kanonski oblik, iznosi nepromijenjeni', () => {
  expect(kanonskiNacinPlacanja('gotovina')).toBe('Gotovina');
  expect(kanonskiNacinPlacanja(' Gotovina ')).toBe('Gotovina');
  expect(kanonskiNacinPlacanja('KARTICA')).toBe('Kartica');
  expect(kanonskiNacinPlacanja('virman ')).toBe('Virman');
  expect(kanonskiNacinPlacanja('cek')).toBe('Ček');
  expect(kanonskiNacinPlacanja('Cek')).toBe('Ček');
  expect(kanonskiNacinPlacanja('ček')).toBe('Ček');
  expect(kanonskiNacinPlacanja('{"Gotovina":5,"Kartica":3}')).toBe('{"gotovina":5,"kartica":3}');
  expect(kanonskiNacinPlacanja(' {"KARTICA": 2.50, "Ček": 1} ')).toBe('{"kartica":2.5,"cek":1}');
  expect(kanonskiNacinPlacanja('{"gotovina":3,"cek":2}')).toBe('{"gotovina":3,"cek":2}');
  // Isti ključ dvaput: JSON.parse zadrži zadnji (kao serde_json u Rustu).
  expect(kanonskiNacinPlacanja('{"gotovina":3,"gotovina":2}')).toBe('{"gotovina":2}');
});

test('kanonskiNacinPlacanja: oblik koji parser ne razumije ostaje kakav jeste', () => {
  for (const nacin of [
    'Bitcoin', ' Bitcoin ', '', '5', 'null', '[1,2]', '"Gotovina"',
    '{"gotovina":5,"zlato":3}', '{"gotovina":"5"}', '{"Gotovina":3,"gotovina":2}', '{"constructor":1}',
  ]) {
    expect(kanonskiNacinPlacanja(nacin)).toBe(nacin);
  }
});

test('kanonskiNacinPlacanja je idempotentna i ne mijenja ono što parser pročita', () => {
  for (const nacin of ['gotovina', ' Ček ', 'cek', '{"Gotovina":5,"kartica":3}', '{"VIRMAN":1.25}', 'Bitcoin']) {
    const kanonski = kanonskiNacinPlacanja(nacin);
    expect(kanonskiNacinPlacanja(kanonski)).toBe(kanonski);
    expect(raspodjelaPlacanja(kanonski, 8)).toEqual(raspodjelaPlacanja(nacin, 8));
  }
});
