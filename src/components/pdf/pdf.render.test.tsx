import { test, expect } from 'bun:test';
import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import { PotpisBlok } from './PotpisBlok';
import { PdfPodnozje } from './PdfPodnozje';
import { PrilogPdf } from '../PrilogPdf';
import { RacunPdf } from '../RacunPdf';
import { OtpremnicaPdf } from '../OtpremnicaPdf';
import { PonudaPdf } from '../PonudaPdf';
import { RadniNalogPdf } from '../RadniNalogPdf';
import { ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke } from '@/lib/dokumentPostavke';

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

const FIRMA = {
  naziv: 'Firma d.o.o.', adresa: 'Ulica 1', grad: 'Sarajevo', idBroj: '4200000000001', pdvBroj: '200000000001',
  skladiste: 'Glavno', web: '', email: '', logo: '', logoVelicina: 100, ziroRacuniPozicija: 'zaglavlje' as const,
  bankAccounts: [{ bankName: 'Banka', accountNumber: '1234567890123456' }],
};
export const SVE_UKLJUCENO = procitajDokumentPostavke({
  'dokumenti.pecat': SLIKA, 'dokumenti.pecat.faktura': 'true', 'dokumenti.pecat.ponuda': 'true',
  'dokumenti.pecat.otpremnica': 'true', 'dokumenti.pecat.racun': 'true',
  'dokumenti.podnozje': 'Upisano u sudski registar Općinskog suda u Sarajevu. '.repeat(6),
  'dokumenti.kolone.sifra': 'true', 'dokumenti.kolone.jm': 'false',
  'dokumenti.potpis.faktura.lijevo': 'Fakturisao',
});
const ORDER: any = {
  id: 1, korisnikId: 1, ukupno: 23.4, pdvIznos: 3.4, nacinPlacanja: 'Virman', status: 'completed',
  brojFiskalnogRacuna: '15', prilogBroj: 15, createdAt: '2026-09-25 10:00:00', korisnikIme: 'Admin',
  kupacNaziv: 'Kupac', kupacIdBroj: '4200000000002',
  stavke: [
    { id: 1, orderId: 1, productId: 1, kolicina: 2, cijena: 11.7, rabat: 2.5, pdvStopa: 'E', productNaziv: 'Artikal', productJm: 'kom', productSifra: 'A1' },
  ],
};

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`faktura (${ime})`, async () => {
    await renderuj(<PrilogPdf order={ORDER} firma={FIRMA} stavke={ORDER.stavke} postavke={postavke} />);
    await renderuj(<PrilogPdf order={ORDER} firma={{ ...FIRMA, ziroRacuniPozicija: 'podnozje' }} stavke={ORDER.stavke} postavke={postavke} />);
  });
}

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`račun bs/en i otpremnica (${ime})`, async () => {
    await renderuj(<RacunPdf order={ORDER} firma={FIRMA} postavke={postavke} />);
    await renderuj(<RacunPdf order={ORDER} firma={FIRMA} postavke={postavke} lang="en" />);
    await renderuj(<RacunPdf order={{ ...ORDER, stavke: ORDER.stavke.map((s: any) => ({ ...s, rabat: 0 })) }} firma={FIRMA} postavke={postavke} />);
    await renderuj(<OtpremnicaPdf order={ORDER} firma={FIRMA} postavke={postavke} />);
  });
}

const PONUDA: any = {
  id: 1, broj: 3, godina: 2026, datum: '2026-09-25', vaziDo: '2026-10-03', napomena: 'Isporuka 5 dana',
  ukupno: 22.82, pdvIznos: 3.32, korisnikIme: 'Admin', kupacNaziv: 'Kupac',
  stavke: [{ id: 1, productNaziv: 'Artikal', productJm: 'kom', productSifra: 'A1', kolicina: 2, cijena: 11.7, rabat: 2.5 }],
};
const NALOG: any = {
  id: 1, broj: 2, godina: 2026, datum: '2026-09-25', vrsta: 'narudzba', status: 'otvoren', opis: 'Izrada',
  stavke: [{ id: 1, materijalSifra: 'M1', materijalNaziv: 'Ploča', materijalJm: 'm2', kolicina: 1.5, napomena: '' }],
};

for (const [ime, postavke] of [['zadano', ZADANE_DOKUMENT_POSTAVKE], ['sve uključeno', SVE_UKLJUCENO]] as const) {
  test(`ponuda i nalog (${ime})`, async () => {
    await renderuj(<PonudaPdf ponuda={PONUDA} firma={FIRMA} postavke={postavke} />);
    await renderuj(<PonudaPdf ponuda={{ ...PONUDA, stavke: [{ ...PONUDA.stavke[0], rabat: 0 }] }} firma={FIRMA} postavke={{ ...postavke, ponuda: { ...postavke.ponuda, uslovi: '' } }} />);
    await renderuj(<RadniNalogPdf nalog={NALOG} firma={FIRMA} postavke={postavke} />);
  });
}
