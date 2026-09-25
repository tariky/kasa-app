import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import type { FirmaSettings, RadniNalog } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { logoVelicina, kontaktFirme } from '@/lib/firma';
import type { DokumentPostavke } from '@/lib/dokumentPostavke';
import { PotpisBlok } from './pdf/PotpisBlok';
import { PdfPodnozje, DODATAK_PODNOZJA } from './pdf/PdfPodnozje';
import { SifraTekst } from './pdf/SifraTekst';

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;

const s = StyleSheet.create({
  page: { padding: 50, paddingBottom: 70, fontFamily: F, fontSize: 9, color: '#000' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 100, height: 100, objectFit: 'contain' as const },
  firmaNaziv: { fontSize: 14, fontFamily: FB, fontWeight: 700, letterSpacing: 0.3 },
  firmaLine: { fontSize: 8, marginTop: 1 },
  title: { fontSize: 22, fontFamily: FB, fontWeight: 700, letterSpacing: 1, textAlign: 'right' },
  number: { fontSize: 10, marginTop: 2, textAlign: 'right' },
  note: { fontSize: 7, marginTop: 3, textAlign: 'right' },
  dividerThick: { borderBottom: '2pt solid #000', marginBottom: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  infoBlock: { width: '48%' },
  infoLabel: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 },
  infoName: { fontSize: 11, fontFamily: FB, fontWeight: 700, marginBottom: 3 },
  infoLine: { fontSize: 8.5, marginBottom: 1.5 },
  metaRow: { flexDirection: 'row', marginBottom: 18, gap: 40 },
  metaLabel: { fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 9 },
  opisBox: { border: '1pt solid #000', padding: 8, marginBottom: 18 },
  opisTitle: { fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  opisText: { fontSize: 10, lineHeight: 1.4 },
  table: { marginBottom: 20 },
  tHeaderRow: { flexDirection: 'row', borderBottom: '1.5pt solid #000', paddingBottom: 5, marginBottom: 2 },
  tHeaderCell: { fontSize: 7.5, fontFamily: FB, fontWeight: 700, color: '#555' },
  tRow: { flexDirection: 'row', paddingVertical: 5, borderBottom: '0.5pt solid #ddd', alignItems: 'flex-start' },
  tCell: { fontSize: 8.5, lineHeight: 1.3 },
  tCellBold: { fontSize: 8.5, fontFamily: FB, fontWeight: 700, lineHeight: 1.3 },
  colRb: { width: '5%' },
  colSifra: { width: '14%', paddingRight: 6 },
  colMat: { width: '36%' },
  colJm: { width: '8%' },
  colKol: { width: '12%', textAlign: 'right' },
  colNap: { width: '25%', paddingLeft: 8 },
});

const fmtDateStr = (d?: string | null) => (d ? d.split('-').reverse().join('.') : '—');
const fmtKol = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');

export function RadniNalogPdf({ nalog, firma, postavke }: { nalog: RadniNalog; firma: FirmaSettings; postavke: DokumentPostavke }) {
  const stavke = nalog.stavke ?? [];
  const dodatak = postavke.podnozje ? { paddingBottom: 70 + DODATAK_PODNOZJA } : {};
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

  return (
    <Document>
      <Page size="A4" style={[s.page, dodatak]}>
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={[s.logo, { width: logoVelicina(firma), height: logoVelicina(firma) }]} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
              {kontaktFirme(firma) ? <Text style={s.firmaLine}>{kontaktFirme(firma)}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={s.title}>RADNI NALOG</Text>
            <Text style={s.number}>br. {formatBrojNaloga(nalog, postavke.nalog.broj)}</Text>
            <Text style={s.note}>{nalog.vrsta === 'narudzba' ? 'Izrada po narudžbi' : 'Izrada za zalihu'}</Text>
          </View>
        </View>
        <View style={s.dividerThick} />

        <View style={s.infoRow}>
          <View style={s.infoBlock}>
            <Text style={s.infoLabel}>Izvođač</Text>
            <Text style={s.infoName}>{firma.naziv}</Text>
            <Text style={s.infoLine}>{firma.adresa}</Text>
            <Text style={s.infoLine}>{firma.grad}</Text>
          </View>
          <View style={s.infoBlock}>
            {nalog.vrsta === 'narudzba' ? (
              <>
                <Text style={s.infoLabel}>Kupac</Text>
                <Text style={s.infoName}>{nalog.kupacNaziv ?? ''}</Text>
                {nalog.kupacAdresa ? <Text style={s.infoLine}>{nalog.kupacAdresa}</Text> : null}
                {(nalog.kupacPostanskiBroj || nalog.kupacGrad) ? <Text style={s.infoLine}>{[nalog.kupacPostanskiBroj, nalog.kupacGrad].filter(Boolean).join(' ')}</Text> : null}
              </>
            ) : (
              <>
                <Text style={s.infoLabel}>Proizvod</Text>
                <Text style={s.infoName}>{nalog.productNaziv ?? ''}</Text>
                <Text style={s.infoLine}>Količina: {fmtKol(nalog.kolicina)} kom</Text>
              </>
            )}
          </View>
        </View>

        <View style={s.metaRow}>
          <View><Text style={s.metaLabel}>Datum naloga</Text><Text style={s.metaValue}>{fmtDateStr(nalog.datum)}</Text></View>
          <View><Text style={s.metaLabel}>Rok isporuke</Text><Text style={s.metaValue}>{fmtDateStr(nalog.rok)}</Text></View>
          <View><Text style={s.metaLabel}>Nalog otvorio</Text><Text style={s.metaValue}>{nalog.korisnikIme || '—'}</Text></View>
          {nalog.ponudaBroj ? <View><Text style={s.metaLabel}>Po ponudi</Text><Text style={s.metaValue}>{nalog.ponudaBroj}/{nalog.ponudaGodina}</Text></View> : null}
        </View>

        <View style={s.opisBox}>
          <Text style={s.opisTitle}>Opis posla</Text>
          <Text style={s.opisText}>{nalog.opis}</Text>
          {nalog.napomena ? <Text style={{ fontSize: 8.5, marginTop: 4 }}>{nalog.napomena}</Text> : null}
        </View>

        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            <Text style={[s.tHeaderCell, s.colSifra]}>Šifra</Text>
            <Text style={[s.tHeaderCell, s.colMat]}>Materijal</Text>
            <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>
            <Text style={[s.tHeaderCell, s.colKol]}>Količina</Text>
            <Text style={[s.tHeaderCell, s.colNap]}>Napomena</Text>
          </View>
          {stavke.map((st, i) => (
            <View key={st.id} style={s.tRow}>
              <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
              <SifraTekst style={[s.tCell, s.colSifra]}>{st.materijalSifra ?? ''}</SifraTekst>
              <Text style={[s.tCellBold, s.colMat]}>{st.materijalNaziv ?? ''}</Text>
              <Text style={[s.tCell, s.colJm]}>{st.materijalJm ?? ''}</Text>
              <Text style={[s.tCellBold, s.colKol]}>{fmtKol(st.kolicina)}</Text>
              <Text style={[s.tCell, s.colNap]}>{st.napomena ?? ''}</Text>
            </View>
          ))}
          {stavke.length === 0 && <Text style={{ fontSize: 8.5, paddingVertical: 6 }}>Utrošak materijala nije unesen.</Text>}
        </View>

        <PotpisBlok linije={postavke.potpisi.nalog} />

        <PdfPodnozje firmaNaziv={firma.naziv} danas={today} tekst={postavke.podnozje} />
      </Page>
    </Document>
  );
}
