import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { BankAccount } from '@/types';
import { formatBrojPonude } from '@/lib/ponuda';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';

export interface PonudaPdfProps {
  ponuda: {
    id: number;
    broj: number;
    godina: number;
    datum: string;
    vaziDo: string;
    napomena?: string | null;
    ukupno: number;
    pdvIznos: number;
    korisnikIme?: string;
    kupacNaziv?: string | null;
    kupacIdBroj?: string | null;
    kupacPdvBroj?: string | null;
    kupacAdresa?: string | null;
    kupacGrad?: string | null;
    kupacPostanskiBroj?: string | null;
    stavke: Array<{
      id: number;
      productNaziv?: string;
      productJm?: string;
      kolicina: number;
      cijena: number;
      rabat: number;
    }>;
  };
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
    width: 44,
    height: 44,
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
    color: '#444',
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
    color: '#444',
    marginTop: 2,
  },
  nonFiscalNote: {
    fontSize: 7,
    color: '#888',
    marginTop: 3,
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
    color: '#888',
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
    color: '#333',
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
    color: '#888',
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
  colRb: { width: '5%' },
  colArtikal: { width: '37%' },
  colJm: { width: '7%' },
  colKol: { width: '9%', textAlign: 'right' },
  colCijena: { width: '14%', textAlign: 'right' },
  colRabat: { width: '10%', textAlign: 'right' },
  colUkupno: { width: '18%', textAlign: 'right' },

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
    color: '#444',
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

  /* ── Napomena / rok ── */
  napomenaBox: {
    border: '1pt solid #000',
    padding: 8,
    marginTop: 16,
  },
  napomenaTitle: {
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
    color: '#666',
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
    color: '#333',
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
    color: '#555',
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

export function PonudaPdf({ ponuda, firma }: PonudaPdfProps) {
  const stavke = ponuda.stavke ?? [];
  const pdvIznos = ponuda.pdvIznos;
  const osnovica = ponuda.ukupno - pdvIznos;

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateStr = (yyyyMmDd: string) => {
    const [y, m, d] = yyyyMmDd.split('-');
    return `${d}.${m}.${y}`;
  };
  const today = fmtDate(new Date());

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Top: Logo+Firma left, Ponuda title right ── */}
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={s.logo} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
            </View>
          </View>
          <View style={s.invoiceLabel}>
            <Text style={s.invoiceTitle}>PONUDA</Text>
            <Text style={s.invoiceNumber}>br. {formatBrojPonude(ponuda)}</Text>
            <Text style={s.nonFiscalNote}>Ovo nije fiskalni račun</Text>
          </View>
        </View>

        <View style={s.dividerThick} />

        {/* ── Two columns: Izdavač / Kupac ── */}
        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>Izdavač</Text>
            <Text style={s.infoBlockName}>{firma.naziv}</Text>
            <Text style={s.infoBlockLine}>{firma.adresa}</Text>
            <Text style={s.infoBlockLine}>{firma.grad}</Text>
            {firma.idBroj ? <Text style={s.infoBlockLine}>ID: {firma.idBroj}</Text> : null}
            {firma.pdvBroj ? <Text style={s.infoBlockLine}>PDV: {firma.pdvBroj}</Text> : null}
          </View>
          <View style={s.infoBlock}>
            <Text style={s.infoBlockLabel}>Kupac</Text>
            {ponuda.kupacNaziv && <Text style={s.infoBlockName}>{ponuda.kupacNaziv}</Text>}
            {ponuda.kupacAdresa && <Text style={s.infoBlockLine}>{ponuda.kupacAdresa}</Text>}
            {(ponuda.kupacPostanskiBroj || ponuda.kupacGrad) && (
              <Text style={s.infoBlockLine}>
                {[ponuda.kupacPostanskiBroj, ponuda.kupacGrad].filter(Boolean).join(' ')}
              </Text>
            )}
            {ponuda.kupacIdBroj && <Text style={s.infoBlockLine}>ID: {ponuda.kupacIdBroj}</Text>}
            {ponuda.kupacPdvBroj && <Text style={s.infoBlockLine}>PDV: {ponuda.kupacPdvBroj}</Text>}
          </View>
        </View>

        {/* ── Meta: Datum, Važi do, Ponudu sastavio ── */}
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Datum ponude</Text>
            <Text style={s.metaValue}>{fmtDateStr(ponuda.datum)}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Važi do</Text>
            <Text style={s.metaValue}>{fmtDateStr(ponuda.vaziDo)}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Ponudu sastavio</Text>
            <Text style={s.metaValue}>{ponuda.korisnikIme || '—'}</Text>
          </View>
        </View>

        {/* ── Items table ── */}
        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            <Text style={[s.tHeaderCell, s.colArtikal]}>Opis</Text>
            <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>
            <Text style={[s.tHeaderCell, s.colKol]}>Kol.</Text>
            <Text style={[s.tHeaderCell, s.colCijena]}>Cijena</Text>
            <Text style={[s.tHeaderCell, s.colRabat]}>Rabat</Text>
            <Text style={[s.tHeaderCell, s.colUkupno]}>Iznos</Text>
          </View>

          {stavke.map((si, i) => {
            const lineTotal = si.cijena * si.kolicina * (1 - si.rabat / 100);
            return (
              <View key={si.id} style={s.tRow}>
                <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
                <Text style={[s.tCellBold, s.colArtikal]}>{si.productNaziv ?? ''}</Text>
                <Text style={[s.tCell, s.colJm]}>{si.productJm ?? ''}</Text>
                <Text style={[s.tCell, s.colKol]}>{si.kolicina}</Text>
                <Text style={[s.tCell, s.colCijena]}>{formatKM(si.cijena)}</Text>
                <Text style={[s.tCell, s.colRabat]}>
                  {si.rabat > 0 ? `${si.rabat.toFixed(0)}%` : '—'}
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
              <Text style={s.totalsLabel}>Osnovica</Text>
              <Text style={s.totalsValue}>{formatKM(osnovica)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>PDV (17%)</Text>
              <Text style={s.totalsValue}>{formatKM(pdvIznos)}</Text>
            </View>
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>UKUPNO</Text>
              <Text style={s.totalsFinalValue}>{formatKM(ponuda.ukupno)}</Text>
            </View>
          </View>
        </View>

        {/* ── Rok važenja / napomena ── */}
        <View style={s.napomenaBox}>
          <Text style={s.napomenaTitle}>Uslovi ponude</Text>
          <Text style={{ fontSize: 8.5, marginBottom: 2 }}>
            Ponuda važi do {fmtDateStr(ponuda.vaziDo)}. Cijene su izražene u KM sa uračunatim PDV-om.
          </Text>
          {ponuda.napomena ? <Text style={{ fontSize: 8.5 }}>{ponuda.napomena}</Text> : null}
        </View>

        {/* ── Bank accounts ── */}
        {firma.bankAccounts.length > 0 && (
          <View style={s.bankAccountsWrap}>
            <Text style={s.bankAccountsLabel}>Žiro računi</Text>
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

        {/* ── Signatures ── */}
        <View style={s.signaturesWrap} wrap={false}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Potpis izdavaoca</Text>
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Potpis primaoca</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text>{firma.naziv} | {firma.adresa}, {firma.grad}</Text>
          <Text>Generisano: {today}</Text>
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
