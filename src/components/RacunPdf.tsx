import { Text } from '@react-pdf/renderer';
import type { FirmaSettings, Order, OrderItem } from '@/types';
import { linijaDokumenta, type LinijaDokumenta } from '@/lib/dokumentStavke';
import { opisPlacanja } from '@/lib/placanje';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { formatDatumValute } from '@/lib/valuta';
import { formatKM } from '@/lib/utils';
import { formatRabat, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { A4Dokument, DvaBloka, Izdavac, Kupac, MetaRed, Okvir, Ukupno } from './pdf/A4Dokument';
import { TabelaStavki, type KolonaStavke } from './pdf/TabelaStavki';
import { datumVrijemePdf } from './pdf/stil';

export type InvoiceLang = 'bs' | 'en';

export interface RacunPdfProps {
  order: Order;
  firma: FirmaSettings;
  lang?: InvoiceLang;
  postavke: DokumentPostavke;
}

const translations = {
  bs: {
    invoiceTitle: 'RAČUN',
    refundTitle: 'STORNO',
    seller: 'Izdavač',
    buyer: 'Kupac',
    date: 'Datum',
    dueDate: 'Datum valute',
    cashier: 'Kasir',
    payment: 'Plaćanje',
    colCode: 'Šifra',
    colDescription: 'Opis',
    colUnit: 'JM',
    colQty: 'Kol.',
    colPrice: 'Cijena bez PDV-a',
    colDiscount: 'Rabat',
    colVat: 'PDV',
    colAmount: 'Iznos sa PDV-om',
    subtotal: 'Osnovica',
    vat: `PDV (${PDV_STOPA_E_PCT}%)`,
    total: 'UKUPNO',
    refund: 'Reklamacija',
    refundNumber: 'Broj',
    dateTimeSep: 'u',
    paymentCash: 'Gotovina',
    paymentCard: 'Kartica',
  },
  en: {
    invoiceTitle: 'INVOICE',
    refundTitle: 'CREDIT NOTE',
    seller: 'From',
    buyer: 'Bill to',
    date: 'Date',
    dueDate: 'Due date',
    cashier: 'Cashier',
    payment: 'Payment',
    colCode: 'Code',
    colDescription: 'Description',
    colUnit: 'Unit',
    colQty: 'Qty',
    colPrice: 'Price excl. VAT',
    colDiscount: 'Disc.',
    colVat: 'VAT',
    colAmount: 'Amount incl. VAT',
    subtotal: 'Subtotal',
    vat: `VAT (${PDV_STOPA_E_PCT}%)`,
    total: 'TOTAL',
    refund: 'Refund',
    refundNumber: 'Number',
    dateTimeSep: 'at',
    paymentCash: 'Cash',
    paymentCard: 'Card',
  },
} as const;

type Red = OrderItem & LinijaDokumenta;

export function RacunPdf({ order, firma, lang = 'bs', postavke }: RacunPdfProps) {
  const t = translations[lang];
  const kol = postavke.kolone;
  // Jedinična cijena se prikazuje bez PDV-a (u bazi je bruto), a iznos stavke sa PDV-om —
  // tako se kolona Iznos zbraja u UKUPNO.
  const redovi: Red[] = (order.stavke ?? []).map(si => ({ ...si, ...linijaDokumenta(si) }));

  // Use stored pdvIznos as single source of truth
  const pdvIznos = order.pdvIznos;
  const osnovica = order.ukupno - pdvIznos;
  const datumValute = formatDatumValute(order.datumValute);
  // Tekst ('Kartica') ili razbijeno plaćanje (JSON) — zajednički parser, nazivi po jeziku.
  const placanje = opisPlacanja(order.nacinPlacanja, order.ukupno, { gotovina: t.paymentCash, kartica: t.paymentCard });

  // Širine u pt (A4 minus margine = 495pt); Opis uzima ostatak (~173pt).
  const kolone: KolonaStavke<Red>[] = [
    { naslov: '#', sirina: 18, vrijednost: (_, i) => i + 1 },
    { naslov: t.colCode, sirina: 44, razmak: { desno: 6 }, sifra: true, vidljiva: kol.sifra, vrijednost: r => r.productSifra ?? '' },
    { naslov: t.colDescription, sirina: 'ostatak', razmak: { desno: 8 }, bold: true, vrijednost: r => r.productNaziv ?? '' },
    { naslov: t.colUnit, sirina: 26, vidljiva: kol.jm, vrijednost: r => r.productJm ?? '' },
    { naslov: t.colQty, sirina: 38, desno: true, vrijednost: r => r.kolicina },
    { naslov: t.colPrice, sirina: 72, razmak: { lijevo: 6 }, desno: true, vrijednost: r => formatKM(r.cijenaBezPdv) },
    { naslov: t.colDiscount, sirina: 36, razmak: { lijevo: 6 }, desno: true, vidljiva: redovi.some(r => r.rabat > 0), vrijednost: r => (r.rabat > 0 ? formatRabat(r.rabat) : '—') },
    { naslov: t.colVat, sirina: 60, razmak: { lijevo: 6 }, desno: true, vrijednost: r => (r.pdvStopa === 'E' ? formatKM(r.pdv) : '—') },
    { naslov: t.colAmount, sirina: 72, razmak: { lijevo: 6 }, desno: true, bold: true, vrijednost: r => formatKM(r.iznos) },
  ];

  return (
    <A4Dokument
      vrsta="racun" firma={firma} postavke={postavke} lang={lang} ziro
      naslov={order.status === 'refunded' ? t.refundTitle : t.invoiceTitle}
      broj={`#${order.brojFiskalnogRacuna || order.id}`}
    >
      <DvaBloka>
        <Izdavac firma={firma} naslov={t.seller} />
        <Kupac kupac={order} naslov={t.buyer} />
      </DvaBloka>

      <MetaRed polja={[
        [t.date, datumVrijemePdf(new Date(order.createdAt), t.dateTimeSep)],
        [t.cashier, order.korisnikIme || '—'],
        [t.payment, placanje],
        datumValute ? [t.dueDate, datumValute] : null,
      ]} />

      <TabelaStavki kolone={kolone} redovi={redovi} />

      <Ukupno
        redovi={[[t.subtotal, formatKM(osnovica)], [t.vat, formatKM(pdvIznos)]]}
        ukupno={[t.total, formatKM(order.ukupno)]}
      />

      {order.brojReklamacije && (
        <Okvir naslov={t.refund} style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 8.5 }}>{t.refundNumber}: {order.brojReklamacije}</Text>
        </Okvir>
      )}
    </A4Dokument>
  );
}
