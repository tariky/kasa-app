import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

export interface PrimkePdfProps {
  primke: any[];
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
  fieldLabel: { fontSize: 7, color: '#555', width: 100 },
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
  cBroj: { width: '12%' },
  cDatum: { width: '12%' },
  cDobavljac: { width: '18%' },
  cFaktura: { width: '13%' },
  cStavki: { width: '8%' },
  cNabavna: { width: '16%' },
  cProdajna: { width: '16%', borderRight: 'none' },
  summaryRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  summaryTable: { width: '45%' },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottom: '0.5pt solid #eee' },
  summaryLineBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTop: '1pt solid #000', marginTop: 2 },
  summaryLabel: { fontSize: 8 },
  summaryValue: { fontSize: 8, fontFamily: FB, fontWeight: 700, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#999' },
});

export function PrimkePdf({ primke, dateFrom, dateTo, firma }: PrimkePdfProps) {
  const totalNabavna = primke.reduce(
    (sum, p) => sum + (p.stavke || []).reduce((s: number, st: any) => s + (st.nabavnaCijena || 0) * st.kolicina, 0), 0
  );
  const totalProdajna = primke.reduce(
    (sum, p) => sum + (p.stavke || []).reduce((s: number, st: any) => s + st.cijena * st.kolicina, 0), 0
  );
  const marza = totalNabavna > 0 ? ((totalProdajna - totalNabavna) / totalNabavna * 100) : 0;

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

  const fmtDate = (str: string) => {
    if (!str) return '—';
    const dt = new Date(str);
    return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>IZVJEŠTAJ O ULAZU ROBE (PRIMKE)</Text>
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
            <Text style={[s.tHeadCell, s.cBroj]}>Br. primke</Text>
            <Text style={[s.tHeadCell, s.cDatum]}>Datum</Text>
            <Text style={[s.tHeadCell, s.cDobavljac]}>Dobavljač</Text>
            <Text style={[s.tHeadCell, s.cFaktura]}>Br. fakture</Text>
            <Text style={[s.tHeadCell, s.cStavki]}>Stavki</Text>
            <Text style={[s.tHeadCell, s.cNabavna]}>Nabavna</Text>
            <Text style={[s.tHeadCell, s.cProdajna, { borderRight: 'none' }]}>Prodajna</Text>
          </View>

          {primke.map((primka, i) => {
            const nab = (primka.stavke || []).reduce((s: number, st: any) => s + (st.nabavnaCijena || 0) * st.kolicina, 0);
            const prod = (primka.stavke || []).reduce((s: number, st: any) => s + st.cijena * st.kolicina, 0);
            return (
              <View key={primka.id} style={s.tRow}>
                <Text style={[s.tCell, s.cRb, { textAlign: 'center' }]}>{i + 1}</Text>
                <Text style={[s.tCellLeft, s.cBroj]}>{primka.brojPrimke}</Text>
                <Text style={[s.tCellLeft, s.cDatum]}>{fmtDate(primka.datum || primka.createdAt)}</Text>
                <Text style={[s.tCellLeft, s.cDobavljac]}>{primka.dobavljacNaziv || '—'}</Text>
                <Text style={[s.tCellLeft, s.cFaktura]}>{primka.brojFakture || '—'}</Text>
                <Text style={[s.tCell, s.cStavki, { textAlign: 'center' }]}>{primka.stavke?.length ?? 0}</Text>
                <Text style={[s.tCell, s.cNabavna]}>{fmt(nab)}</Text>
                <Text style={[s.tCell, s.cProdajna, { borderRight: 'none' }]}>{fmt(prod)}</Text>
              </View>
            );
          })}

          <View style={s.tTotalRow}>
            <Text style={[s.tTotalCell, s.cRb]} />
            <Text style={[s.tTotalCell, s.cBroj]} />
            <Text style={[s.tTotalCell, s.cDatum]} />
            <Text style={[s.tTotalCell, s.cDobavljac]} />
            <Text style={[s.tTotalCell, s.cFaktura]} />
            <Text style={[s.tTotalCell, s.cStavki]}>UKUPNO:</Text>
            <Text style={[s.tTotalCell, s.cNabavna]}>{fmt(totalNabavna)}</Text>
            <Text style={[s.tTotalCell, s.cProdajna, { borderRight: 'none' }]}>{fmt(totalProdajna)}</Text>
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.summaryTable}>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna nabavna vrijednost:</Text>
              <Text style={s.summaryValue}>{fmt(totalNabavna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna prodajna vrijednost:</Text>
              <Text style={s.summaryValue}>{fmt(totalProdajna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Broj primki:</Text>
              <Text style={s.summaryValue}>{primke.length}</Text>
            </View>
            <View style={s.summaryLineBold}>
              <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Marža:</Text>
              <Text style={s.summaryValue}>{fmt(totalProdajna - totalNabavna)} KM ({marza.toFixed(1).replace('.', ',')}%)</Text>
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
