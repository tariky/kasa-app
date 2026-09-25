import { test, expect } from 'bun:test';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import { PotpisBlok } from './PotpisBlok';
import { PdfPodnozje } from './PdfPodnozje';

// 1×1 PNG
export const SLIKA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function renderuj(el: React.ReactElement): Promise<Buffer> {
  const buf = await renderToBuffer(el as any);
  expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  return buf;
}

test('potpis s pečatom i podnožje s dugim tekstom se renderuju', async () => {
  await renderuj(
    <Document>
      <Page size="A4" style={{ padding: 50, paddingBottom: 94 }}>
        <PotpisBlok linije={{ lijevo: 'Izdao', desno: 'Primio' }} pecat={{ slika: SLIKA, velicina: 120 }} />
        <PdfPodnozje firmaNaziv="Firma" danas="25.09.2026" tekst={'Upisano u registar. '.repeat(15).slice(0, 300)} />
      </Page>
    </Document>,
  );
});

test('zadano: potpis bez pečata i podnožje bez teksta firme', async () => {
  await renderuj(
    <Document>
      <Page size="A4" style={{ padding: 50, paddingBottom: 70 }}>
        <PotpisBlok linije={{ lijevo: 'Potpis izdavaoca', desno: 'Potpis primaoca' }} pecat={null} />
        <PdfPodnozje firmaNaziv="Firma" danas="25.09.2026" />
      </Page>
    </Document>,
  );
});

test('podnožje s 8 redova iz \\n (maxLines ga reže na 4) i najveći pečat', async () => {
  await renderuj(
    <Document>
      <Page size="A4" style={{ padding: 50, paddingBottom: 94 }}>
        <PotpisBlok linije={{ lijevo: 'Izdao', desno: 'Primio' }} pecat={{ slika: SLIKA, velicina: 200 }} />
        <PdfPodnozje firmaNaziv="Firma" danas="25.09.2026" tekst={Array.from({ length: 8 }, (_, i) => `Red ${i + 1}`).join('\n')} />
      </Page>
    </Document>,
  );
});
