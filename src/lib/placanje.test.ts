import { test, expect } from 'bun:test';
import { opisPlacanja, raspodjelaPlacanja, pripremiPlacanje } from './placanje';

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
