import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { Order, BankAccount } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA, POTPIS_AUTORA_EN } from '@/lib/brend';
import { pdvStavke, iznosStavke } from '@/lib/racun';
import { opisPlacanja } from '@/lib/placanje';
import { uNetto } from '@/lib/pdvUnos';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { formatDatumValute } from '@/lib/valuta';
import { logoVelicina, kontaktFirme } from '@/lib/firma';
import { formatRabat, pecatZa, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { PotpisBlok } from './pdf/PotpisBlok';
import { PdfPodnozje, DODATAK_PODNOZJA } from './pdf/PdfPodnozje';
import { SifraTekst } from './pdf/SifraTekst';

export type InvoiceLang = 'bs' | 'en';

export interface RacunPdfProps {
  order: Order;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    skladiste: string;
    logo: string;
    bankAccounts: BankAccount[];
    web?: string;
    email?: string;
    logoVelicina?: number;
  };
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
    status: 'Status',
    statusCompleted: 'Završeno',
    statusRefunded: 'Reklamirano',
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
    generated: 'Generisano',
    dateTimeSep: 'u',
    paymentCash: 'Gotovina',
    paymentCard: 'Kartica',
    bankAccounts: 'Žiro računi',
    signatureIssuer: 'Potpis izdavaoca',
    signatureRecipient: 'Potpis primaoca',
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
    status: 'Status',
    statusCompleted: 'Completed',
    statusRefunded: 'Refunded',
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
    generated: 'Generated',
    dateTimeSep: 'at',
    paymentCash: 'Cash',
    paymentCard: 'Card',
    bankAccounts: 'Bank accounts',
    signatureIssuer: 'Issuer signature',
    signatureRecipient: 'Recipient signature',
  },
} as const;

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
const formatKM = (n: number) => n.toFixed(2).replace('.', ',') + ' KM';

const s = StyleSheet.create({
  page: {
    padding: 50,
    paddingBottom: 70,
    fontFamily: F,
    fontSize: 9,
    color: '#000',
  },

  /* ── Top bar ── */
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 30,
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    width: 100,
    height: 100,
    objectFit: 'contain' as const,
  },
  firmaNaziv: {
    fontSize: 14,
    fontFamily: FB,
    fontWeight: 700,
    letterSpacing: 0.3,
  },
  firmaLine: {
    fontSize: 8,
    color: '#000',
    marginTop: 1,
  },
  invoiceLabel: {
    textAlign: 'right',
  },
  invoiceTitle: {
    fontSize: 22,
    fontFamily: FB,
    fontWeight: 700,
    letterSpacing: 1,
  },
  invoiceNumber: {
    fontSize: 10,
    color: '#000',
    marginTop: 2,
  },

  /* ── Divider ── */
  dividerThick: {
    borderBottom: '2pt solid #000',
    marginBottom: 20,
  },
  dividerThin: {
    borderBottom: '0.5pt solid #bbb',
    marginTop: 12,
    marginBottom: 12,
  },

  /* ── Two-column info ── */
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  infoBlock: {
    width: '48%',
  },
  infoBlockLabel: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: '#000',
    marginBottom: 6,
  },
  infoBlockName: {
    fontSize: 11,
    fontFamily: FB,
    fontWeight: 700,
    marginBottom: 3,
  },
  infoBlockLine: {
    fontSize: 8.5,
    color: '#000',
    marginBottom: 1.5,
  },

  /* ── Meta row ── */
  metaRow: {
    flexDirection: 'row',
    marginBottom: 22,
    gap: 40,
  },
  metaItem: {},
  metaLabel: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#000',
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 9,
  },

  /* ── Table ── */
  table: {
    marginBottom: 20,
  },
  tHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottom: '1.5pt solid #000',
    paddingBottom: 5,
    marginBottom: 2,
  },
  // Zaglavlje u jednom redu: obična slova bez razmaka (velika + letterSpacing
  // su ~20% šira), a brojčane kolone imaju fiksnu širinu po najdužem naslovu.
  tHeaderCell: {
    fontSize: 7.5,
    fontFamily: FB,
    fontWeight: 700,
    color: '#555',
  },
  tRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottom: '0.5pt solid #ddd',
    alignItems: 'flex-start',
  },
  tCell: {
    fontSize: 8.5,
    lineHeight: 1.3,
  },
  tCellBold: {
    fontSize: 8.5,
    fontFamily: FB,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  // Širine u pt (A4 minus margine = 495pt); Opis uzima ostatak (~173pt).
  colRb: { width: 18 },
  colSifra: { width: 44, paddingRight: 6 },
  colArtikal: { flex: 1, paddingRight: 8 },
  colJm: { width: 26 },
  colKol: { width: 38, textAlign: 'right' },
  colCijena: { width: 72, paddingLeft: 6, textAlign: 'right' },
  colRabat: { width: 36, paddingLeft: 6, textAlign: 'right' },
  colPdv: { width: 60, paddingLeft: 6, textAlign: 'right' },
  colUkupno: { width: 72, paddingLeft: 6, textAlign: 'right' },

  /* ── Totals ── */
  totalsWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  totalsBox: {
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 8.5,
    color: '#000',
  },
  totalsValue: {
    fontSize: 8.5,
    textAlign: 'right',
  },
  totalsFinalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTop: '1.5pt solid #000',
    marginTop: 4,
  },
  totalsFinalLabel: {
    fontSize: 11,
    fontFamily: FB,
    fontWeight: 700,
  },
  totalsFinalValue: {
    fontSize: 11,
    fontFamily: FB,
    fontWeight: 700,
    textAlign: 'right',
  },

  /* ── Reklamacija ── */
  reklamacijaBox: {
    border: '1pt solid #000',
    padding: 8,
    marginTop: 16,
  },
  reklamacijaTitle: {
    fontSize: 8,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 3,
  },

  /* ── Bank accounts ── */
  bankAccountsWrap: {
    marginTop: 18,
    backgroundColor: '#f5f5f5',
    borderLeft: '2pt solid #000',
    padding: 10,
  },
  bankAccountsLabel: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#000',
    marginBottom: 6,
  },
  bankAccountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  bankAccountRowPrimary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottom: '0.5pt solid #ccc',
    marginBottom: 2,
  },
  bankName: {
    fontSize: 8.5,
    color: '#000',
  },
  bankNumber: {
    fontSize: 8.5,
    fontFamily: FB,
    fontWeight: 700,
    color: '#000',
  },
  bankNamePrimary: {
    fontSize: 9.5,
    fontFamily: FB,
    fontWeight: 700,
    color: '#000',
  },
  bankNumberPrimary: {
    fontSize: 9.5,
    fontFamily: FB,
    fontWeight: 700,
    color: '#000',
    letterSpacing: 0.3,
  },
});

export function RacunPdf({ order, firma, lang = 'bs', postavke }: RacunPdfProps) {
  const t = translations[lang];
  const stavke = order.stavke ?? [];
  const kol = postavke.kolone;
  const imaRabat = stavke.some(si => si.rabat > 0);
  const dodatak = postavke.podnozje ? { paddingBottom: 70 + DODATAK_PODNOZJA } : {};
  // Engleski potpisi ostaju fiksni prijevodi — nazivi iz postavki su na bosanskom.
  const potpisi = lang === 'en' ? { lijevo: t.signatureIssuer, desno: t.signatureRecipient } : postavke.potpisi.racun;

  // Use stored pdvIznos as single source of truth
  const pdvIznos = order.pdvIznos;
  const osnovica = order.ukupno - pdvIznos;

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateTime = (d: Date) => `${fmtDate(d)} ${t.dateTimeSep} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const orderDate = fmtDateTime(new Date(order.createdAt));
  const today = fmtDate(new Date());

  const datumValute = formatDatumValute(order.datumValute);

  // Tekst ('Kartica') ili razbijeno plaćanje (JSON) — zajednički parser, nazivi po jeziku.
  const parseNacinPlacanja = (nacin: string): string =>
    opisPlacanja(nacin, order.ukupno, { gotovina: t.paymentCash, kartica: t.paymentCard });

  const hasKupac = order.kupacNaziv || order.kupacIdBroj;
  const isRefunded = order.status === 'refunded';

  return (
    <Document>
      <Page size="A4" style={[s.page, dodatak]}>

        {/* ── Top: Logo+Firma left, Invoice title right ── */}
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={[s.logo, { width: logoVelicina(firma), height: logoVelicina(firma) }]} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
              {kontaktFirme(firma) ? <Text style={s.firmaLine}>{kontaktFirme(firma)}</Text> : null}
            </View>
          </View>
          <View style={s.invoiceLabel}>
            <Text style={s.invoiceTitle}>
              {isRefunded ? t.refundTitle : t.invoiceTitle}
            </Text>
            <Text style={s.invoiceNumber}>
              #{order.brojFiskalnogRacuna || order.id}
            </Text>
          </View>
        </View>

        <View style={s.dividerThick} />

        {/* ── Two columns: Seller / Buyer ── */}
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>{t.seller}</Text>
            <Text style={s.infoBlockName}>{firma.naziv}</Text>
            <Text style={s.infoBlockLine}>{firma.adresa}</Text>
            <Text style={s.infoBlockLine}>{firma.grad}</Text>
            {firma.idBroj ? <Text style={s.infoBlockLine}>ID: {firma.idBroj}</Text> : null}
            {firma.pdvBroj ? <Text style={s.infoBlockLine}>PDV: {firma.pdvBroj}</Text> : null}
          </View>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>{t.buyer}</Text>
            {hasKupac ? (
              <>
                {order.kupacNaziv && <Text style={s.infoBlockName}>{order.kupacNaziv}</Text>}
                {order.kupacAdresa && <Text style={s.infoBlockLine}>{order.kupacAdresa}</Text>}
                {(order.kupacPostanskiBroj || order.kupacGrad) && (
                  <Text style={s.infoBlockLine}>
                    {[order.kupacPostanskiBroj, order.kupacGrad].filter(Boolean).join(' ')}
                  </Text>
                )}
                {order.kupacIdBroj && <Text style={s.infoBlockLine}>ID: {order.kupacIdBroj}</Text>}
              </>
            ) : (
              <Text style={s.infoBlockLine}>—</Text>
            )}
          </View>
        </View>

        {/* ── Meta: Date, Cashier, Payment ── */}
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>{t.date}</Text>
            <Text style={s.metaValue}>{orderDate}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>{t.cashier}</Text>
            <Text style={s.metaValue}>{order.korisnikIme || '—'}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>{t.payment}</Text>
            <Text style={s.metaValue}>{parseNacinPlacanja(order.nacinPlacanja)}</Text>
          </View>
          {datumValute && (
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>{t.dueDate}</Text>
              <Text style={s.metaValue}>{datumValute}</Text>
            </View>
          )}
        </View>

        {/* ── Items table ── */}
        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            {kol.sifra && <Text style={[s.tHeaderCell, s.colSifra]}>{t.colCode}</Text>}
            <Text style={[s.tHeaderCell, s.colArtikal]}>{t.colDescription}</Text>
            {kol.jm && <Text style={[s.tHeaderCell, s.colJm]}>{t.colUnit}</Text>}
            <Text style={[s.tHeaderCell, s.colKol]}>{t.colQty}</Text>
            <Text style={[s.tHeaderCell, s.colCijena]}>{t.colPrice}</Text>
            {imaRabat && <Text style={[s.tHeaderCell, s.colRabat]}>{t.colDiscount}</Text>}
            <Text style={[s.tHeaderCell, s.colPdv]}>{t.colVat}</Text>
            <Text style={[s.tHeaderCell, s.colUkupno]}>{t.colAmount}</Text>
          </View>

          {stavke.map((si, i) => {
            // Jedinična cijena se prikazuje bez PDV-a (u bazi je bruto), a
            // iznos stavke sa PDV-om — tako se kolona Iznos zbraja u UKUPNO.
            const stopa = si.pdvStopa === 'E' ? 'E' : 'K';
            const cijenaBezPdv = uNetto(si.cijena, stopa);
            const linePdv = pdvStavke(si);
            const lineTotal = iznosStavke(si);
            return (
              <View key={si.id} style={s.tRow}>
                <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
                {kol.sifra && <SifraTekst style={[s.tCell, s.colSifra]}>{si.productSifra ?? ''}</SifraTekst>}
                <Text style={[s.tCellBold, s.colArtikal]}>{si.productNaziv ?? ''}</Text>
                {kol.jm && <Text style={[s.tCell, s.colJm]}>{si.productJm ?? ''}</Text>}
                <Text style={[s.tCell, s.colKol]}>{si.kolicina}</Text>
                <Text style={[s.tCell, s.colCijena]}>{formatKM(cijenaBezPdv)}</Text>
                {imaRabat && (
                  <Text style={[s.tCell, s.colRabat]}>
                    {si.rabat > 0 ? formatRabat(si.rabat) : '—'}
                  </Text>
                )}
                <Text style={[s.tCell, s.colPdv]}>
                  {si.pdvStopa === 'E' ? formatKM(linePdv) : '—'}
                </Text>
                <Text style={[s.tCellBold, s.colUkupno]}>{formatKM(lineTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{t.subtotal}</Text>
              <Text style={s.totalsValue}>{formatKM(osnovica)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>{t.vat}</Text>
              <Text style={s.totalsValue}>{formatKM(pdvIznos)}</Text>
            </View>
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>{t.total}</Text>
              <Text style={s.totalsFinalValue}>{formatKM(order.ukupno)}</Text>
            </View>
          </View>
        </View>

        {/* ── Bank accounts ── */}
        {firma.bankAccounts.length > 0 && (
          <View style={s.bankAccountsWrap}>
            <Text style={s.bankAccountsLabel}>{t.bankAccounts}</Text>
            {firma.bankAccounts.map((b, i) => {
              const isPrimary = i === 0;
              return (
                <View
                  key={i}
                  style={isPrimary ? s.bankAccountRowPrimary : s.bankAccountRow}
                >
                  <Text style={isPrimary ? s.bankNamePrimary : s.bankName}>
                    {b.bankName}
                  </Text>
                  <Text style={isPrimary ? s.bankNumberPrimary : s.bankNumber}>
                    {b.accountNumber}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Reklamacija ── */}
        {order.brojReklamacije && (
          <View style={s.reklamacijaBox}>
            <Text style={s.reklamacijaTitle}>{t.refund}</Text>
            <Text style={{ fontSize: 8.5 }}>{t.refundNumber}: {order.brojReklamacije}</Text>
          </View>
        )}

        <PotpisBlok linije={potpisi} pecat={pecatZa(postavke, 'racun')} />

        <PdfPodnozje
          firmaNaziv={firma.naziv}
          danas={today}
          tekst={postavke.podnozje}
          potpisAutora={lang === 'en' ? POTPIS_AUTORA_EN : POTPIS_AUTORA}
          generisano={t.generated}
        />
      </Page>
    </Document>
  );
}
