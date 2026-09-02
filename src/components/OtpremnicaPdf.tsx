import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { Order, BankAccount } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

export interface OtpremnicaPdfProps {
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
  };
}

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;

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
  docLabel: {
    textAlign: 'right',
  },
  docTitle: {
    fontSize: 22,
    fontFamily: FB,
    fontWeight: 700,
    letterSpacing: 1,
  },
  docNumber: {
    fontSize: 10,
    color: '#000',
    marginTop: 2,
  },

  /* ── Divider ── */
  dividerThick: {
    borderBottom: '2pt solid #000',
    marginBottom: 20,
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
    borderBottom: '1.5pt solid #000',
    paddingBottom: 5,
    marginBottom: 2,
  },
  tHeaderCell: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#000',
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
  colRb: { width: '7%' },
  colArtikal: { width: '63%' },
  colJm: { width: '12%' },
  colKol: { width: '18%', textAlign: 'right' },

  /* ── Signatures ── */
  signaturesWrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: 40,
    paddingBottom: 20,
  },
  signatureBlock: {
    width: '42%',
  },
  signatureLine: {
    borderTop: '0.5pt solid #000',
    marginBottom: 4,
  },
  signatureLabel: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#000',
    textAlign: 'center',
  },

  /* ── Footer ── */
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '0.5pt solid #ccc',
    paddingTop: 8,
    fontSize: 7,
    color: '#999',
  },
});

export function OtpremnicaPdf({ order, firma }: OtpremnicaPdfProps) {
  const stavke = order.stavke ?? [];

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateTime = (d: Date) => `${fmtDate(d)} u ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const orderDate = fmtDateTime(new Date(order.createdAt));
  const today = fmtDate(new Date());

  const hasKupac = order.kupacNaziv || order.kupacIdBroj;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Top: Logo+Firma left, title right ── */}
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={s.logo} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
            </View>
          </View>
          <View style={s.docLabel}>
            <Text style={s.docTitle}>OTPREMNICA</Text>
            <Text style={s.docNumber}>
              uz račun #{order.brojFiskalnogRacuna || order.id}
            </Text>
          </View>
        </View>

        <View style={s.dividerThick} />

        {/* ── Two columns: Seller / Buyer ── */}
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>Izdavač</Text>
            <Text style={s.infoBlockName}>{firma.naziv}</Text>
            <Text style={s.infoBlockLine}>{firma.adresa}</Text>
            <Text style={s.infoBlockLine}>{firma.grad}</Text>
            {firma.idBroj ? <Text style={s.infoBlockLine}>ID: {firma.idBroj}</Text> : null}
            {firma.pdvBroj ? <Text style={s.infoBlockLine}>PDV: {firma.pdvBroj}</Text> : null}
            {firma.skladiste ? <Text style={s.infoBlockLine}>Skladište: {firma.skladiste}</Text> : null}
          </View>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>Kupac</Text>
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

        {/* ── Meta: Date, Cashier ── */}
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Datum</Text>
            <Text style={s.metaValue}>{orderDate}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Kasir</Text>
            <Text style={s.metaValue}>{order.korisnikIme || '—'}</Text>
          </View>
        </View>

        {/* ── Items table (bez cijena) ── */}
        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            <Text style={[s.tHeaderCell, s.colArtikal]}>Opis</Text>
            <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>
            <Text style={[s.tHeaderCell, s.colKol]}>Količina</Text>
          </View>

          {stavke.map((si, i) => (
            <View key={si.id} style={s.tRow}>
              <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
              <Text style={[s.tCellBold, s.colArtikal]}>{si.productNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.colJm]}>{si.productJm ?? ''}</Text>
              <Text style={[s.tCell, s.colKol]}>{si.kolicina}</Text>
            </View>
          ))}
        </View>

        {/* ── Signatures ── */}
        <View style={s.signaturesWrap} wrap={false}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Robu izdao</Text>
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Robu primio</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text>{firma.naziv} · Generisano: {today}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
