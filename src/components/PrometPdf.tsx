import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

export interface PrometPdfProps {
  orders: any[];
  dateFrom: string;
  dateTo: string;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
  };
}

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontFamily: F, fontSize: 8, color: '#000' },
  title: { fontSize: 12, fontFamily: FB, fontWeight: 700, textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 9, textAlign: 'center', marginBottom: 16 },
  headerGrid: { flexDirection: 'row', marginBottom: 16, gap: 20 },
  headerCol: { width: '50%' },
  fieldRow: { flexDirection: 'row', marginBottom: 3 },
  fieldLabel: { fontSize: 7, color: '#000', width: 100 },
  fieldValue: { fontSize: 8, fontFamily: FB, fontWeight: 700, flex: 1 },
  table: { marginBottom: 16 },
  tHeadRow: { flexDirection: 'row', borderTop: '1pt solid #000', borderBottom: '1pt solid #000' },
  tHeadCell: { fontSize: 6.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'center' },
  tRow: { flexDirection: 'row', borderBottom: '0.5pt solid #ccc' },
  tCell: { fontSize: 7.5, padding: 3, borderRight: '0.5pt solid #ddd', textAlign: 'right' },
  tCellLeft: { fontSize: 7.5, padding: 3, borderRight: '0.5pt solid #ddd', textAlign: 'left' },
  tTotalRow: { flexDirection: 'row', borderTop: '1pt solid #000', borderBottom: '1pt solid #000' },
  tTotalCell: { fontSize: 7.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'right' },
  cRb: { width: '5%' },
  cDatum: { width: '15%' },
  cKasir: { width: '14%' },
  cFisk: { width: '10%' },
  cPlacanje: { width: '10%' },
  cOsnovica: { width: '14%' },
  cPdv: { width: '12%' },
  cUkupno: { width: '14%' },
  cStatus: { width: '6%', borderRight: 'none' },
  summaryRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  summaryTable: { width: '45%' },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottom: '0.5pt solid #eee' },
  summaryLineBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTop: '1pt solid #000', marginTop: 2 },
  summaryLabel: { fontSize: 8 },
  summaryValue: { fontSize: 8, fontFamily: FB, fontWeight: 700, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#999' },
  refunded: { color: '#dc2626' },
});

export function PrometPdf({ orders, dateFrom, dateTo, firma }: PrometPdfProps) {
  const completed = orders.filter(o => o.status === 'completed');
  const refunded = orders.filter(o => o.status === 'refunded');
  const ukupnaProdaja = completed.reduce((sum, o) => sum + o.ukupno, 0);
  const ukupniPDV = completed.reduce((sum, o) => sum + o.pdvIznos, 0);
  const ukupnaOsnovica = ukupnaProdaja - ukupniPDV;
  const ukupneReklamacije = refunded.reduce((sum, o) => sum + o.ukupno, 0);

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

  const fmtDate = (str: string) => {
    if (!str) return '—';
    const dt = new Date(str);
    return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>IZVJEŠTAJ O PROMETU</Text>
        <Text style={s.subtitle}>Period: {dateFrom} — {dateTo}</Text>

        <View style={s.headerGrid}>
          <View style={s.headerCol}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Firma:</Text>
              <Text style={s.fieldValue}>{firma.naziv}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Adresa:</Text>
              <Text style={s.fieldValue}>{firma.adresa}, {firma.grad}</Text>
            </View>
          </View>
          <View style={s.headerCol}>
            {firma.idBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>ID broj:</Text>
                <Text style={s.fieldValue}>{firma.idBroj}</Text>
              </View>
            ) : null}
            {firma.pdvBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>PDV broj:</Text>
                <Text style={s.fieldValue}>{firma.pdvBroj}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.cRb]}>Rb</Text>
            <Text style={[s.tHeadCell, s.cDatum]}>Datum</Text>
            <Text style={[s.tHeadCell, s.cKasir]}>Kasir</Text>
            <Text style={[s.tHeadCell, s.cFisk]}>Fisk. br.</Text>
            <Text style={[s.tHeadCell, s.cPlacanje]}>Plaćanje</Text>
            <Text style={[s.tHeadCell, s.cOsnovica]}>Osnovica</Text>
            <Text style={[s.tHeadCell, s.cPdv]}>PDV</Text>
            <Text style={[s.tHeadCell, s.cUkupno]}>Ukupno</Text>
            <Text style={[s.tHeadCell, s.cStatus, { borderRight: 'none' }]}>St.</Text>
          </View>

          {orders.map((order, i) => {
            const isRefunded = order.status === 'refunded';
            return (
              <View key={order.id} style={s.tRow}>
                <Text style={[s.tCell, s.cRb, { textAlign: 'center' }, isRefunded ? s.refunded : {}]}>{i + 1}</Text>
                <Text style={[s.tCellLeft, s.cDatum, isRefunded ? s.refunded : {}]}>{fmtDate(order.createdAt)}</Text>
                <Text style={[s.tCellLeft, s.cKasir, isRefunded ? s.refunded : {}]}>{order.korisnikIme || '—'}</Text>
                <Text style={[s.tCell, s.cFisk, { textAlign: 'center' }, isRefunded ? s.refunded : {}]}>{order.brojFiskalnogRacuna || '—'}</Text>
                <Text style={[s.tCellLeft, s.cPlacanje, isRefunded ? s.refunded : {}]}>{order.nacinPlacanja || '—'}</Text>
                <Text style={[s.tCell, s.cOsnovica, isRefunded ? s.refunded : {}]}>{fmt(order.ukupno - order.pdvIznos)}</Text>
                <Text style={[s.tCell, s.cPdv, isRefunded ? s.refunded : {}]}>{fmt(order.pdvIznos)}</Text>
                <Text style={[s.tCell, s.cUkupno, isRefunded ? s.refunded : {}]}>{fmt(order.ukupno)}</Text>
                <Text style={[s.tCell, s.cStatus, { textAlign: 'center', borderRight: 'none' }, isRefunded ? s.refunded : {}]}>
                  {isRefunded ? 'S' : 'OK'}
                </Text>
              </View>
            );
          })}

          <View style={s.tTotalRow}>
            <Text style={[s.tTotalCell, s.cRb]} />
            <Text style={[s.tTotalCell, s.cDatum]} />
            <Text style={[s.tTotalCell, s.cKasir]} />
            <Text style={[s.tTotalCell, s.cFisk]} />
            <Text style={[s.tTotalCell, s.cPlacanje]}>UKUPNO:</Text>
            <Text style={[s.tTotalCell, s.cOsnovica]}>{fmt(ukupnaOsnovica)}</Text>
            <Text style={[s.tTotalCell, s.cPdv]}>{fmt(ukupniPDV)}</Text>
            <Text style={[s.tTotalCell, s.cUkupno]}>{fmt(ukupnaProdaja)}</Text>
            <Text style={[s.tTotalCell, s.cStatus, { borderRight: 'none' }]} />
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.summaryTable}>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna prodaja:</Text>
              <Text style={s.summaryValue}>{fmt(ukupnaProdaja)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Osnovica (bez PDV):</Text>
              <Text style={s.summaryValue}>{fmt(ukupnaOsnovica)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>PDV (17%):</Text>
              <Text style={s.summaryValue}>{fmt(ukupniPDV)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Broj računa:</Text>
              <Text style={s.summaryValue}>{completed.length}</Text>
            </View>
            {refunded.length > 0 && (
              <View style={s.summaryLine}>
                <Text style={[s.summaryLabel, s.refunded]}>Reklamacije:</Text>
                <Text style={[s.summaryValue, s.refunded]}>{fmt(ukupneReklamacije)} KM ({refunded.length})</Text>
              </View>
            )}
            <View style={s.summaryLineBold}>
              <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Neto promet:</Text>
              <Text style={s.summaryValue}>{fmt(ukupnaProdaja - ukupneReklamacije)} KM</Text>
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text>{firma.naziv} · Generisano: {today}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
