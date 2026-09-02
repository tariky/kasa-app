import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { Nivelacija, NivelacijaStavka } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

export interface NivelacijaPdfProps {
  nivelacija: Nivelacija;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    skladiste: string;
    logo: string;
  };
}

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

const s = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 60,
    fontFamily: F,
    fontSize: 8,
    color: '#000',
  },
  title: {
    fontSize: 12,
    fontFamily: FB,
    fontWeight: 700,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    textAlign: 'center',
    marginBottom: 16,
  },
  headerGrid: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 20,
  },
  headerCol: {
    width: '50%',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  fieldLabel: {
    fontSize: 7,
    color: '#000',
    width: 100,
  },
  fieldValue: {
    fontSize: 8,
    fontFamily: FB,
    fontWeight: 700,
    flex: 1,
  },
  table: {
    marginBottom: 16,
  },
  tHeadRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tHeadCell: {
    fontSize: 6.5,
    fontFamily: FB,
    fontWeight: 700,
    padding: 3,
    borderRight: '0.5pt solid #999',
    textAlign: 'center',
  },
  tRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #ccc',
  },
  tCell: {
    fontSize: 7.5,
    padding: 3,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'right',
  },
  tCellLeft: {
    fontSize: 7.5,
    padding: 3,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'left',
  },
  tTotalRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tTotalCell: {
    fontSize: 7.5,
    fontFamily: FB,
    fontWeight: 700,
    padding: 3,
    borderRight: '0.5pt solid #999',
    textAlign: 'right',
  },
  cRb:     { width: '4%' },
  cSifra:  { width: '8%' },
  cNaziv:  { width: '24%' },
  cJm:     { width: '5%' },
  cKol:    { width: '9%' },
  cStara:  { width: '13%' },
  cNova:   { width: '13%' },
  cRazJed: { width: '12%' },
  cRazUk:  { width: '12%', borderRight: 'none' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  summaryTable: {
    width: '45%',
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottom: '0.5pt solid #eee',
  },
  summaryLineBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    borderTop: '1pt solid #000',
    marginTop: 2,
  },
  summaryLabel: { fontSize: 8 },
  summaryValue: { fontSize: 8, fontFamily: FB, fontWeight: 700, textAlign: 'right' },
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 40,
  },
  signatureBlock: {
    width: 180,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 8,
    marginBottom: 24,
  },
  signatureLine: {
    borderTop: '0.5pt solid #000',
    width: '100%',
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 6.5,
    color: '#999',
  },
});

export function NivelacijaPdf({ nivelacija, firma }: NivelacijaPdfProps) {
  const stavke = nivelacija.stavke ?? [];

  const totPozitivna = stavke.filter(s => s.ukupnaRazlika > 0).reduce((a, s) => a + s.ukupnaRazlika, 0);
  const totNegativna = stavke.filter(s => s.ukupnaRazlika < 0).reduce((a, s) => a + s.ukupnaRazlika, 0);
  const totRazlika = stavke.reduce((a, s) => a + s.ukupnaRazlika, 0);

  const pdvNaRazliku = stavke
    .filter(st => st.pdvStopa === 'E')
    .reduce((a, st) => a + st.ukupnaRazlika, 0) * 17 / 117;

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

  return (
    <Document>
      <Page size="A4" style={s.page}>

        <Text style={s.title}>ZAPISNIK O PROMJENI CIJENA (NIVELACIJA)</Text>
        <Text style={s.subtitle}>Broj: {nivelacija.brojNivelacije}</Text>

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
          <View style={s.headerCol}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Datum:</Text>
              <Text style={s.fieldValue}>{nivelacija.datum}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Prodajni objekt:</Text>
              <Text style={s.fieldValue}>{firma.skladiste || 'Glavna prodavnica'}</Text>
            </View>
            {nivelacija.primkaBroj ? (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel}>Vezana primka:</Text>
                <Text style={s.fieldValue}>{nivelacija.primkaBroj}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.cRb]}>Rb</Text>
            <Text style={[s.tHeadCell, s.cSifra]}>Šifra</Text>
            <Text style={[s.tHeadCell, s.cNaziv]}>Naziv</Text>
            <Text style={[s.tHeadCell, s.cJm]}>JM</Text>
            <Text style={[s.tHeadCell, s.cKol]}>Količina</Text>
            <Text style={[s.tHeadCell, s.cStara]}>Stara cijena</Text>
            <Text style={[s.tHeadCell, s.cNova]}>Nova cijena</Text>
            <Text style={[s.tHeadCell, s.cRazJed]}>Razlika/jed</Text>
            <Text style={[s.tHeadCell, s.cRazUk, { borderRight: 'none' }]}>Ukup. razlika</Text>
          </View>

          {stavke.map((st, i) => (
            <View key={st.id} style={s.tRow}>
              <Text style={[s.tCell, s.cRb, { textAlign: 'center' }]}>{i + 1}</Text>
              <Text style={[s.tCellLeft, s.cSifra]}>{st.productSifra ?? ''}</Text>
              <Text style={[s.tCellLeft, s.cNaziv]}>{st.productNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.cJm, { textAlign: 'center' }]}>{st.productJm ?? ''}</Text>
              <Text style={[s.tCell, s.cKol]}>{fmt(st.kolicina)}</Text>
              <Text style={[s.tCell, s.cStara]}>{fmt(st.staraCijena)}</Text>
              <Text style={[s.tCell, s.cNova]}>{fmt(st.novaCijena)}</Text>
              <Text style={[s.tCell, s.cRazJed]}>{fmt(st.razlika)}</Text>
              <Text style={[s.tCell, s.cRazUk, { borderRight: 'none' }]}>{fmt(st.ukupnaRazlika)}</Text>
            </View>
          ))}

          <View style={s.tTotalRow}>
            <Text style={[s.tTotalCell, s.cRb]} />
            <Text style={[s.tTotalCell, s.cSifra]} />
            <Text style={[s.tTotalCell, s.cNaziv]} />
            <Text style={[s.tTotalCell, s.cJm]} />
            <Text style={[s.tTotalCell, s.cKol]} />
            <Text style={[s.tTotalCell, s.cStara]} />
            <Text style={[s.tTotalCell, s.cNova]} />
            <Text style={[s.tTotalCell, s.cRazJed]}>UKUPNO:</Text>
            <Text style={[s.tTotalCell, s.cRazUk, { borderRight: 'none' }]}>{fmt(totRazlika)}</Text>
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.summaryTable}>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna pozitivna razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totPozitivna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>Ukupna negativna razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totNegativna)} KM</Text>
            </View>
            <View style={s.summaryLine}>
              <Text style={s.summaryLabel}>PDV na razliku (17%):</Text>
              <Text style={s.summaryValue}>{fmt(pdvNaRazliku)} KM</Text>
            </View>
            <View style={s.summaryLineBold}>
              <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Neto razlika:</Text>
              <Text style={s.summaryValue}>{fmt(totRazlika)} KM</Text>
            </View>
          </View>
        </View>

        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Potpis ovlaštenog lica:</Text>
            <View style={s.signatureLine} />
          </View>
        </View>

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
