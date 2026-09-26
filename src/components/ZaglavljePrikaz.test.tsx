import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ZaglavljePrikaz } from './ZaglavljePrikaz';

test('prikaz zaglavlja ima razmake PDF-a: 30pt do debele linije, 20pt ispod nje', () => {
  const html = renderToStaticMarkup(
    <ZaglavljePrikaz naziv="Firma" adresa="Ulica 1" grad="Sarajevo" kontakt="" logo="" logoVelicina={100} />,
  );
  expect(html).toContain('justify-between items-start" style="margin-bottom:30px"');
  expect(html).toContain('border-bottom:2px solid #000;margin-bottom:20px');
});
