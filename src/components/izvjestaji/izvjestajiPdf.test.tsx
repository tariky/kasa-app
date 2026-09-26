// PDF-ovi ekrana Izvještaja: brojevi i oznake dolaze iz sume u lib/izvjestaji.
import { test, expect } from 'bun:test';
import { isValidElement, type ReactNode } from 'react';
import { Text, renderToBuffer } from '@react-pdf/renderer';
import { PrimkePdf } from '../PrimkePdf';

const FIRMA = { naziv: 'Firma d.o.o.', adresa: 'Ulica 1', grad: 'Sarajevo', idBroj: '4200000000001', pdvBroj: '200000000001' };

/** Tekst svakog `<Text>` u stablu dokumenta, redom — bez renderovanja PDF-a. */
function tekstovi(el: ReactNode): string[] {
  const out: string[] = [];
  const spoji = (n: ReactNode): string =>
    n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(spoji).join('') : isValidElement(n) ? '' : String(n);
  const obidji = (n: ReactNode): void => {
    if (Array.isArray(n)) { n.forEach(obidji); return; }
    if (!isValidElement(n)) return;
    const props = n.props as { children?: ReactNode };
    if (n.type === Text) out.push(spoji(props.children));
    else if (typeof n.type === 'function') obidji((n.type as (p: unknown) => ReactNode)(props));
    else obidji(props.children);
  };
  obidji(el);
  return out;
}

const stavka = (p: Record<string, unknown>) => ({ kolicina: 1, nabavnaCijena: 0, rabat: 0, zavisniTroskovi: 0, cijena: 0, pdvStopa: 'E', ...p });

test('primke: RUC bez PDV-a i samo nad artiklima, oznaka „RUC“', async () => {
  const primke = [
    { id: 1, brojPrimke: 'U-1', datum: '2026-02-10', stavke: [
      stavka({ kolicina: 10, nabavnaCijena: 10, rabat: 20, zavisniTroskovi: 5, cijena: 23.4 }), // nabavna 85, bez PDV 200
      stavka({ kolicina: 4, nabavnaCijena: 25, zavisniTroskovi: 8 }),                          // materijal, nabavna 108
    ] },
    { id: 2, brojPrimke: 'U-2', datum: '2026-02-11', stavke: [stavka({ nabavnaCijena: 100, cijena: 117 })] }, // RUC 0
  ];
  const el = <PrimkePdf primke={primke} dateFrom="01.02.2026" dateTo="28.02.2026" firma={FIRMA} />;
  const t = tekstovi(el);
  expect(t).not.toContain('Marža:');
  expect(t).toContain('RUC:');
  // RUC 115 / nabavna artikala 185 → 62,2 %; nabavna svih stavki 293, MP sa PDV-om 351
  expect(t).toContain('115,00 KM (62,2%)');
  expect(t).toContain('293,00 KM');
  expect(t).toContain('351,00 KM');
  expect((await renderToBuffer(el)).subarray(0, 4).toString()).toBe('%PDF');
});
