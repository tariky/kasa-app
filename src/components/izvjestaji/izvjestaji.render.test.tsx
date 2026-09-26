// Tab Ulaz robe i PDF-ovi ekrana Izvještaja: brojevi i oznake dolaze iz suma u lib/izvjestaji.
import { test, expect } from 'bun:test';
import { Fragment, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Text, renderToBuffer } from '@react-pdf/renderer';
import { PrimkePdf } from '../PrimkePdf';
import PrimkeTab from './PrimkeTab';
import type { Primka } from '@/types';
import { PrometPdf } from '../PrometPdf';
import { NivelacijaPdf } from '../NivelacijaPdf';

const FIRMA = { naziv: 'Firma d.o.o.', adresa: 'Ulica 1', grad: 'Sarajevo', idBroj: '4200000000001', pdvBroj: '200000000001' };

/** Tekst svakog `<Text>` u stablu dokumenta, redom — bez renderovanja PDF-a. */
function tekstovi(el: ReactNode): string[] {
  const out: string[] = [];
  const spoji = (n: ReactNode): string =>
    n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(spoji).join('')
      // Fragment (`<>{iznos} KM</>`) je tekst po dijelovima; drugi elementi nisu tekst.
      : isValidElement(n) ? (n.type === Fragment ? spoji((n.props as { children?: ReactNode }).children) : '') : String(n);
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

// Regresija (review A3): artikal 10 × 37 KM, rabat 5 %, zavisni 12 KM, MP 45,40 + materijal 2 × 15 KM —
// UlazDialog kaže „RUC · 6.7 %“; Izvještaji i PDF su zbog zaokruživanja stope pisali 6,8 %.
const RUC_67 = [{ id: 7, brojPrimke: 'U-7', datum: '2026-02-12', createdAt: '2026-02-12', stavke: [
  stavka({ kolicina: 10, nabavnaCijena: 37, rabat: 5, zavisniTroskovi: 12, cijena: 45.4 }),
  stavka({ kolicina: 2, nabavnaCijena: 15 }),
] }];

test('primke: stopa RUC u PDF-u i na tabu Ulaz robe je ista kao u UlazDialogu', () => {
  const t = tekstovi(<PrimkePdf primke={RUC_67} dateFrom="01.02.2026" dateTo="28.02.2026" firma={FIRMA} />);
  expect(t).toContain('24,53 KM (6,7%)');
  const html = renderToStaticMarkup(
    <PrimkeTab primke={RUC_67 as unknown as Primka[]} dateFrom={new Date(2026, 1, 1)} dateTo={new Date(2026, 1, 28)} firma={null} onGreska={() => undefined} />,
  );
  expect(html).toContain('+6,7%</td>');
  expect(html).toContain('+6,7% RUC');
  expect(html).not.toContain('6,8%');
});

test('primke: iznosi u PDF-u su isti kao u UlazDialogu (nabavna 11,495 → 11,49)', () => {
  const primke = [{ id: 8, brojPrimke: 'U-8', datum: '2026-02-12', stavke: [stavka({ nabavnaCijena: 12.1, rabat: 5, cijena: 23.4, pdvStopa: 'K' })] }];
  const t = tekstovi(<PrimkePdf primke={primke} dateFrom="01.02.2026" dateTo="28.02.2026" firma={FIRMA} />);
  expect(t).toContain('11,49 KM');
  expect(t).not.toContain('11,50 KM');
});

test('promet: sume izvršenih računa, storno odvojeno, neto promet', async () => {
  const racun = (id: number, ukupno: number, pdvIznos: number, status = 'completed') =>
    ({ id, ukupno, pdvIznos, status, nacinPlacanja: 'Gotovina', createdAt: '2026-02-10 10:00:00', korisnikIme: 'Admin' });
  const orders = [racun(1, 23.4, 3.4), racun(2, 0.1, 0.01), racun(3, 0.2, 0.03), racun(4, 11.7, 1.7, 'refunded')];
  const el = <PrometPdf orders={orders} dateFrom="01.02.2026" dateTo="28.02.2026" firma={FIRMA} />;
  const t = tekstovi(el);
  expect(t).toContain('23,70 KM');       // ukupna prodaja
  expect(t).toContain('20,26 KM');       // osnovica
  expect(t).toContain('3,44 KM');        // PDV
  expect(t).toContain('11,70 KM (1)');   // reklamacije
  expect(t).toContain('12,00 KM');       // neto promet
  expect(t[t.indexOf('Broj računa:') + 1]).toBe('3');
  expect((await renderToBuffer(el)).subarray(0, 4).toString()).toBe('%PDF');
});

test('nivelacija: razlike po znaku i PDV izlučen iz razlike stavki sa stopom E', async () => {
  const stavka = (id: number, kolicina: number, staraCijena: number, novaCijena: number, pdvStopa: string) => ({
    id, nivelacijaId: 1, productId: id, kolicina, staraCijena, novaCijena, pdvStopa,
    razlika: novaCijena - staraCijena, ukupnaRazlika: (novaCijena - staraCijena) * kolicina,
  });
  const nivelacija = {
    id: 1, brojNivelacije: 'NIV-2026-001', datum: '2026-02-10', primkaId: null, napomena: null, createdAt: '2026-02-10 10:00:00',
    stavke: [stavka(1, 10, 11.7, 14.04, 'E'), stavka(2, 2, 5, 4, 'K'), stavka(3, 3, 2.34, 1.17, 'E')],
  };
  const el = <NivelacijaPdf nivelacija={nivelacija} firma={{ ...FIRMA, skladiste: '', logo: '' }} />;
  const t = tekstovi(el);
  expect(t).toContain('23,40 KM');   // pozitivna
  expect(t).toContain('-5,51 KM');   // negativna
  expect(t).toContain('2,89 KM');    // PDV na razliku: (23,40 − 3,51) × 17 / 117
  expect(t).toContain('17,89 KM');   // neto razlika
  expect((await renderToBuffer(el)).subarray(0, 4).toString()).toBe('%PDF');
});
