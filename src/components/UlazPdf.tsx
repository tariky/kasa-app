import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { Primka, PrimkaStavka } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';

export interface UlazPdfProps {
  primka: Primka;
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

/* ── Per-item calculations ── */
function calcRow(s: PrimkaStavka) {
  const fakCijenaPoJed = s.nabavnaCijena;
  const fakVrijednostBezPdv = s.kolicina * fakCijenaPoJed;
  const rabatIznos = fakVrijednostBezPdv * (s.rabat / 100);
  const zavisni = 0;
  const nabCijenaPoJed = fakCijenaPoJed * (1 - s.rabat / 100) + zavisni / (s.kolicina || 1);
  const nabVrijednostBezPdv = fakVrijednostBezPdv - rabatIznos + zavisni;
  const prodCijenaSaPdv = s.cijena;
  const pdvRate = s.pdvStopa === 'E' ? 17 : 0;
  const prodCijenaBezPdv = pdvRate > 0 ? prodCijenaSaPdv / (1 + pdvRate / 100) : prodCijenaSaPdv;
  const prodVrijednostBezPdv = prodCijenaBezPdv * s.kolicina;
  const stopaRuc = nabVrijednostBezPdv > 0 ? ((prodVrijednostBezPdv - nabVrijednostBezPdv) / nabVrijednostBezPdv) * 100 : 0;
  const iznosRuc = prodVrijednostBezPdv - nabVrijednostBezPdv;
  const iznosPdv = prodVrijednostBezPdv * (pdvRate / 100);
  const mpVrijednostSaPdv = prodVrijednostBezPdv + iznosPdv;

  return {
    fakCijenaPoJed, fakVrijednostBezPdv, rabatIznos, zavisni,
    nabCijenaPoJed, nabVrijednostBezPdv,
    stopaRuc, iznosRuc,
    prodVrijednostBezPdv, pdvRate, iznosPdv,
    mpVrijednostSaPdv, prodCijenaSaPdv,
  };
}

const s = StyleSheet.create({
  page: {
    padding: 25,
    paddingBottom: 50,
    fontFamily: F,
    fontSize: 7,
    color: '#000',
  },

  /* ── Title ── */
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: {
    fontSize: 11,
    fontFamily: FB,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  obrazac: {
    fontSize: 8,
    fontFamily: FB,
    fontWeight: 700,
  },

  /* ── Header info grid ── */
  headerGrid: {
    flexDirection: 'row',
    marginBottom: 14,
    gap: 20,
  },
  headerLeft: {
    width: '50%',
  },
  headerRight: {
    width: '50%',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  fieldLabel: {
    fontSize: 6.5,
    color: '#000',
    width: 120,
  },
  fieldValue: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    flex: 1,
  },

  /* ── Table ── */
  table: {
    marginBottom: 10,
  },
  tHeadRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tHeadCell: {
    fontSize: 5.5,
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
    fontSize: 6.5,
    padding: 2.5,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'right',
  },
  tCellLeft: {
    fontSize: 6.5,
    padding: 2.5,
    borderRight: '0.5pt solid #ddd',
    textAlign: 'left',
  },
  tTotalRow: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
  },
  tTotalCell: {
    fontSize: 6.5,
    fontFamily: FB,
    fontWeight: 700,
    padding: 3,
    borderRight: '0.5pt solid #999',
    textAlign: 'right',
  },

  /* Column widths — 17 columns */
  cRb:     { width: '2.5%' },
  cSifra:  { width: '5%' },
  cNaziv:  { width: '12%' },
  cJm:     { width: '3%' },
  cKol:    { width: '5%' },
  cFakCij: { width: '5.5%' },
  cFakVr:  { width: '6.5%' },
  cZav:    { width: '4.5%' },
  cNabCij: { width: '5.5%' },
  cNabVr:  { width: '6.5%' },
  cStRuc:  { width: '5%' },
  cIzRuc:  { width: '6.5%' },
  cPrVr:   { width: '7%' },
  cStPdv:  { width: '4%' },
  cIzPdv:  { width: '6%' },
  cMpVr:   { width: '7.5%' },
  cMpCij:  { width: '8%', borderRight: 'none' },

  /* ── Bottom section ── */
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  pdvTable: {
    width: '45%',
  },
  pdvHeadRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #000',
    paddingBottom: 2,
    marginBottom: 2,
  },
  pdvHeadCell: {
    fontSize: 6,
    fontFamily: FB,
    fontWeight: 700,
    width: '25%',
  },
  pdvDataRow: {
    flexDirection: 'row',
    paddingVertical: 1.5,
  },
  pdvDataCell: {
    fontSize: 6.5,
    width: '25%',
  },
  pdvSumRow: {
    flexDirection: 'row',
    borderTop: '0.5pt dashed #000',
    paddingTop: 2,
    marginTop: 2,
  },

  summaryTable: {
    width: '38%',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottom: '0.5pt solid #eee',
  },
  summaryLabel: {
    fontSize: 7,
  },
  summaryValue: {
    fontSize: 7,
    fontFamily: FB,
    fontWeight: 700,
    textAlign: 'right',
  },
  summaryRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderTop: '1pt solid #000',
    marginTop: 2,
  },

  /* ── Signature ── */
  signatureRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 30,
  },
  signatureBlock: {
    width: 160,
    alignItems: 'center',
  },
  signatureLabel: {
    fontSize: 7,
    marginBottom: 20,
  },
  signatureLine: {
    borderTop: '0.5pt solid #000',
    width: '100%',
  },

  /* ── Footer ── */
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 25,
    right: 25,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 6,
    color: '#999',
  },
});

export function UlazPdf({ primka, firma }: UlazPdfProps) {
  const stavke = primka.stavke ?? [];
  const rows = stavke.map(st => ({ st, c: calcRow(st) }));

  /* ── Column totals ── */
  const totFakVr = rows.reduce((a, r) => a + r.c.fakVrijednostBezPdv, 0);
  const totZav = rows.reduce((a, r) => a + r.c.zavisni, 0);
  const totNabVr = rows.reduce((a, r) => a + r.c.nabVrijednostBezPdv, 0);
  const totIzRuc = rows.reduce((a, r) => a + r.c.iznosRuc, 0);
  const totPrVr = rows.reduce((a, r) => a + r.c.prodVrijednostBezPdv, 0);
  const totIzPdv = rows.reduce((a, r) => a + r.c.iznosPdv, 0);
  const totMpVr = rows.reduce((a, r) => a + r.c.mpVrijednostSaPdv, 0);
  const totRabat = rows.reduce((a, r) => a + r.c.rabatIznos, 0);
  const totMarza = totIzRuc;

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>

        {/* ── Title ── */}
        <View style={s.titleRow}>
          <Text style={s.title}>KALKULACIJA CIJENA BROJ : {primka.brojPrimke}</Text>
          <Text style={s.obrazac}>Obrazac KCM</Text>
        </View>

        {/* ── Header info ── */}
        <View style={s.headerGrid}>
          <View style={s.headerLeft}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Naziv i sjedište trgovca:</Text>
              <Text style={s.fieldValue}>{firma.naziv}   {firma.adresa}   {firma.grad}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Naziv i sjedište dobavljača:</Text>
              <Text style={s.fieldValue}>
                {[primka.dobavljacId, primka.dobavljacNaziv].filter(Boolean).join('   ')}
              </Text>
            </View>
            {primka.dobavljacAdresa && (
              <View style={s.fieldRow}>
                <Text style={s.fieldLabel} />
                <Text style={s.fieldValue}>{primka.dobavljacAdresa}</Text>
              </View>
            )}
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Naziv, broj i datum dokumenta:</Text>
              <Text style={s.fieldValue}>Faktura: {primka.brojFakture || primka.brojPrimke}   {primka.datum}</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Naziv i sjedište prodajnog objekta:</Text>
              <Text style={s.fieldValue}>{firma.skladiste || 'Glavna prodavnica'}   {firma.adresa}, {firma.grad}</Text>
            </View>
            <View style={s.fieldRow}>
              <Text style={s.fieldLabel}>Datum sacinjavanja kalkulacije:</Text>
              <Text style={s.fieldValue}>{primka.datum}</Text>
            </View>
          </View>
        </View>

        {/* ── Main table ── */}
        <View style={s.table}>
          {/* Header */}
          <View style={s.tHeadRow}>
            <Text style={[s.tHeadCell, s.cRb]}>Rb</Text>
            <Text style={[s.tHeadCell, s.cSifra]}>Šifra</Text>
            <Text style={[s.tHeadCell, s.cNaziv]}>Trgovački naziv</Text>
            <Text style={[s.tHeadCell, s.cJm]}>Jm</Text>
            <Text style={[s.tHeadCell, s.cKol]}>Količina</Text>
            <Text style={[s.tHeadCell, s.cFakCij]}>Fak.Cijena{'\n'}po jed.</Text>
            <Text style={[s.tHeadCell, s.cFakVr]}>Fak.Vrijed{'\n'}bez PDV-a</Text>
            <Text style={[s.tHeadCell, s.cZav]}>Zavisni</Text>
            <Text style={[s.tHeadCell, s.cNabCij]}>Nab.Cijena{'\n'}po jed.</Text>
            <Text style={[s.tHeadCell, s.cNabVr]}>Nab.Vrijed{'\n'}bez PDV-a</Text>
            <Text style={[s.tHeadCell, s.cStRuc]}>Stopa{'\n'}RUC-a</Text>
            <Text style={[s.tHeadCell, s.cIzRuc]}>Iznos{'\n'}RUC-a</Text>
            <Text style={[s.tHeadCell, s.cPrVr]}>Prod.vrij.{'\n'}bez PDV-a</Text>
            <Text style={[s.tHeadCell, s.cStPdv]}>Stopa{'\n'}PDV-a</Text>
            <Text style={[s.tHeadCell, s.cIzPdv]}>Iznos{'\n'}PDV-a</Text>
            <Text style={[s.tHeadCell, s.cMpVr]}>MP vrijed.{'\n'}sa PDV-om</Text>
            <Text style={[s.tHeadCell, s.cMpCij, { borderRight: 'none' }]}>MP cijena{'\n'}sa PDV-om</Text>
          </View>

          {/* Data rows */}
          {rows.map(({ st, c }, i) => (
            <View key={st.id} style={s.tRow}>
              <Text style={[s.tCell, s.cRb, { textAlign: 'center' }]}>{i + 1}</Text>
              <Text style={[s.tCellLeft, s.cSifra]}>{st.productSifra ?? ''}</Text>
              <Text style={[s.tCellLeft, s.cNaziv]}>{st.productNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.cJm, { textAlign: 'center' }]}>{st.productJm ?? ''}</Text>
              <Text style={[s.tCell, s.cKol]}>{fmt(st.kolicina)}</Text>
              <Text style={[s.tCell, s.cFakCij]}>{fmt(c.fakCijenaPoJed)}</Text>
              <Text style={[s.tCell, s.cFakVr]}>{fmt(c.fakVrijednostBezPdv)}</Text>
              <Text style={[s.tCell, s.cZav]}>{fmt(c.zavisni)}</Text>
              <Text style={[s.tCell, s.cNabCij]}>{fmt(c.nabCijenaPoJed)}</Text>
              <Text style={[s.tCell, s.cNabVr]}>{fmt(c.nabVrijednostBezPdv)}</Text>
              <Text style={[s.tCell, s.cStRuc]}>{fmt(c.stopaRuc)}</Text>
              <Text style={[s.tCell, s.cIzRuc]}>{fmt(c.iznosRuc)}</Text>
              <Text style={[s.tCell, s.cPrVr]}>{fmt(c.prodVrijednostBezPdv)}</Text>
              <Text style={[s.tCell, s.cStPdv, { textAlign: 'center' }]}>{fmt(c.pdvRate)}</Text>
              <Text style={[s.tCell, s.cIzPdv]}>{fmt(c.iznosPdv)}</Text>
              <Text style={[s.tCell, s.cMpVr]}>{fmt(c.mpVrijednostSaPdv)}</Text>
              <Text style={[s.tCell, s.cMpCij, { borderRight: 'none' }]}>{fmt(c.prodCijenaSaPdv)}</Text>
            </View>
          ))}

          {/* Totals row */}
          <View style={s.tTotalRow}>
            <Text style={[s.tTotalCell, s.cRb]} />
            <Text style={[s.tTotalCell, s.cSifra]} />
            <Text style={[s.tTotalCell, s.cNaziv]} />
            <Text style={[s.tTotalCell, s.cJm]} />
            <Text style={[s.tTotalCell, s.cKol]} />
            <Text style={[s.tTotalCell, s.cFakCij]} />
            <Text style={[s.tTotalCell, s.cFakVr]}>{fmt(totFakVr)}</Text>
            <Text style={[s.tTotalCell, s.cZav]}>{fmt(totZav)}</Text>
            <Text style={[s.tTotalCell, s.cNabCij]} />
            <Text style={[s.tTotalCell, s.cNabVr]}>{fmt(totNabVr)}</Text>
            <Text style={[s.tTotalCell, s.cStRuc]} />
            <Text style={[s.tTotalCell, s.cIzRuc]}>{fmt(totIzRuc)}</Text>
            <Text style={[s.tTotalCell, s.cPrVr]}>{fmt(totPrVr)}</Text>
            <Text style={[s.tTotalCell, s.cStPdv]} />
            <Text style={[s.tTotalCell, s.cIzPdv]}>{fmt(totIzPdv)}</Text>
            <Text style={[s.tTotalCell, s.cMpVr]}>{fmt(totMpVr)}</Text>
            <Text style={[s.tTotalCell, s.cMpCij, { borderRight: 'none' }]} />
          </View>
        </View>

        {/* ── Bottom: PDV table (left) + Summary (right) ── */}
        <View style={s.bottomRow}>
          {/* PDV breakdown */}
          <View style={s.pdvTable}>
            <View style={s.pdvHeadRow}>
              <Text style={s.pdvHeadCell}>Tb PDV</Text>
              <Text style={s.pdvHeadCell}>Vr Bez PDV</Text>
              <Text style={s.pdvHeadCell}>Iznos PDV</Text>
              <Text style={s.pdvHeadCell}>PDV %  Vrijed. sa PDV</Text>
            </View>
            <View style={s.pdvDataRow}>
              <Text style={s.pdvDataCell}>PDV</Text>
              <Text style={s.pdvDataCell}>{fmt(totPrVr)}</Text>
              <Text style={s.pdvDataCell}>{fmt(totIzPdv)}</Text>
              <Text style={s.pdvDataCell}>17,00   {fmt(totMpVr)}</Text>
            </View>
            <View style={s.pdvSumRow}>
              <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]} />
              <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>{fmt(totPrVr)}</Text>
              <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>{fmt(totIzPdv)}</Text>
              <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>          {fmt(totMpVr)}</Text>
            </View>
          </View>

          {/* Summary */}
          <View style={s.summaryTable}>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Fak. vrijednost</Text>
              <Text style={s.summaryValue}>{fmt(totFakVr)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Rabat</Text>
              <Text style={s.summaryValue}>{fmt(totRabat)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Zavisni</Text>
              <Text style={s.summaryValue}>{fmt(totZav)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Nab. vrijednost</Text>
              <Text style={s.summaryValue}>{fmt(totNabVr)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Marža</Text>
              <Text style={s.summaryValue}>{fmt(totMarza)}</Text>
            </View>
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Iznos PDV</Text>
              <Text style={s.summaryValue}>{fmt(totIzPdv)}</Text>
            </View>
            <View style={s.summaryRowBold}>
              <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Vrijed. sa PDV</Text>
              <Text style={s.summaryValue}>{fmt(totMpVr)}</Text>
            </View>
          </View>
        </View>

        {/* ── Signature ── */}
        <View style={s.signatureRow}>
          <View style={s.signatureBlock}>
            <Text style={s.signatureLabel}>Odgovorno lice:</Text>
            <View style={s.signatureLine} />
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
