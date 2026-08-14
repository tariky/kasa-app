import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { Order, BankAccount } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';
import { iznosStavke, pdvStavke } from '@/lib/racun';
import { round2 } from '@/lib/novac';
import { prilogNaziv } from '@/lib/prilog';

/** Red iz `prilog:getStavke` (prilog_stavke + JOIN na products). */
export interface PrilogPdfStavka {
  productId: number;
  kolicina: number;
  cijena: number;
  pdvStopa: string;
  productNaziv?: string;
  productJm?: string;
  productSifra?: string;
}

export interface PrilogPdfProps {
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
  stavke: PrilogPdfStavka[];
}

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;

const formatKM = (n: number) => n.toFixed(2).replace('.', ',') + ' KM';
/** Količina bez suvišnih nula: 2 → "2", 10.5 → "10,5". */
const formatKol = (n: number) => String(n).replace('.', ',');

const s = StyleSheet.create({
  page: { padding: 50, paddingBottom: 70, fontFamily: F, fontSize: 9, color: '#000' },

  /* ── Top bar ── */
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 },
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 44, height: 44, objectFit: 'contain' as const },
  firmaNaziv: { fontSize: 14, fontFamily: FB, fontWeight: 700, letterSpacing: 0.3 },
  firmaLine: { fontSize: 8, color: '#444', marginTop: 1 },
  docLabel: { textAlign: 'right' },
  docTitle: { fontSize: 22, fontFamily: FB, fontWeight: 700, letterSpacing: 1 },
  docTitleNum: { fontSize: 22, fontFamily: F, fontWeight: 400, color: '#777', letterSpacing: 0 },
  docSubtitle: {
    fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#555', marginTop: 4,
  },

  dividerThick: { borderBottom: '2pt solid #000', marginBottom: 20 },

  /* ── Two-column info ── */
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  infoBlock: { width: '48%' },
  infoBlockLabel: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#888', marginBottom: 6,
  },
  infoBlockName: { fontSize: 11, fontFamily: FB, fontWeight: 700, marginBottom: 3 },
  infoBlockLine: { fontSize: 8.5, color: '#333', marginBottom: 1.5 },

  /* ── Meta row ── */
  metaRow: { flexDirection: 'row', marginBottom: 22, gap: 40 },
  metaItem: {},
  metaLabel: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#888', marginBottom: 3,
  },
  metaValue: { fontSize: 9 },

  /* ── Table ── */
  table: { marginBottom: 16 },
  tHeaderRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    borderBottom: '1.5pt solid #000', paddingBottom: 4, marginBottom: 2,
  },
  tHeaderCell: {
    fontSize: 6.5, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.5, color: '#555', paddingRight: 6,
  },
  tHeaderCellLast: { paddingRight: 0 },
  tRow: { flexDirection: 'row', paddingVertical: 5, borderBottom: '0.5pt solid #ddd', alignItems: 'flex-start' },
  tCell: { fontSize: 8.5, lineHeight: 1.3, paddingRight: 6 },
  tCellBold: { fontSize: 8.5, fontFamily: FB, fontWeight: 700, lineHeight: 1.3, paddingRight: 6 },
  tCellLast: { paddingRight: 0 },
  colRb: { width: '4%' },
  colSifra: { width: '12%' },
  colNaziv: { width: '31%', paddingRight: 10 },
  colJm: { width: '5%' },
  colKol: { width: '8%', textAlign: 'right' },
  colCijena: { width: '14%', textAlign: 'right' },
  colPdv: { width: '12%', textAlign: 'right' },
  colIznos: { width: '14%', textAlign: 'right' },

  /* ── Totals ── */
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  totalsBox: { width: '45%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  totalsLabel: { fontSize: 8.5, color: '#444' },
  totalsValue: { fontSize: 8.5 },
  totalsFinalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTop: '1.5pt solid #000', marginTop: 4, paddingTop: 5,
  },
  totalsFinalLabel: { fontSize: 10, fontFamily: FB, fontWeight: 700 },
  totalsFinalValue: { fontSize: 12, fontFamily: FB, fontWeight: 700 },

  /* ── Veza sa fiskalnim računom ── */
  vezaBox: {
    marginTop: 14, paddingLeft: 10,
    borderLeft: '0.5pt solid #ddd',
  },
  vezaLabel: {
    fontSize: 6.5, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.2, color: '#aaa', marginBottom: 4,
  },
  vezaRow: { flexDirection: 'row', marginBottom: 1.5 },
  vezaKey: { width: 78, fontSize: 7.5, color: '#999' },
  vezaValue: { fontSize: 7.5, color: '#444' },
  vezaNota: { fontSize: 7, color: '#999', marginTop: 4, lineHeight: 1.4 },

  /* ── Signatures ── */
  signaturesWrap: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 'auto', paddingTop: 40, paddingBottom: 20,
  },
  signatureBlock: { width: '42%' },
  signatureLine: { borderTop: '0.5pt solid #000', marginBottom: 4 },
  signatureLabel: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#555', textAlign: 'center',
  },

  /* ── Footer ── */
  footer: {
    position: 'absolute', bottom: 30, left: 50, right: 50,
    flexDirection: 'row', justifyContent: 'space-between',
    borderTop: '0.5pt solid #ccc', paddingTop: 8, fontSize: 7, color: '#999',
  },
});

/**
 * A4 prilog uz fiskalni račun — stvarne stavke iza zbirne stavke. Veza sa fiskalnim
 * računom (BF broj) je zakonski obavezna — bez nje je ovo samo papir.
 */
export function PrilogPdf({ order, firma, stavke }: PrilogPdfProps) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateTime = (d: Date) => `${fmtDate(d)} u ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const orderDate = fmtDateTime(new Date(order.createdAt));
  const today = fmtDate(new Date());
  const hasKupac = order.kupacNaziv || order.kupacIdBroj;

  // Cijene u sistemu su sa uračunatim PDV-om; za fakturni prikaz se jedinična
  // cijena bez PDV-a izlučuje iz bruto cijene po stopi stavke.
  const linije = stavke.map(si => ({
    ...si,
    cijenaBezPdv: si.pdvStopa === 'E' ? round2(si.cijena / 1.17) : round2(si.cijena),
    iznos: iznosStavke({ cijena: si.cijena, kolicina: si.kolicina, rabat: 0, pdvStopa: si.pdvStopa }),
    pdv: pdvStavke({ cijena: si.cijena, kolicina: si.kolicina, rabat: 0, pdvStopa: si.pdvStopa }),
  }));
  const ukupno = round2(linije.reduce((sum, l) => sum + l.iznos, 0));
  const pdvIznos = round2(linije.reduce((sum, l) => sum + l.pdv, 0));
  const osnovica = round2(ukupno - pdvIznos);

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
            <Text style={s.docTitle}>
              PRILOG <Text style={s.docTitleNum}>br. {order.prilogBroj}</Text>
            </Text>
            <Text style={s.docSubtitle}>
              uz fiskalni račun BF {order.brojFiskalnogRacuna || '—'}
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

        {/* ── Meta: datum računa, kasir, plaćanje ── */}
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Datum računa</Text>
            <Text style={s.metaValue}>{orderDate}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Kasir</Text>
            <Text style={s.metaValue}>{order.korisnikIme || '—'}</Text>
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Plaćanje</Text>
            <Text style={s.metaValue}>{order.nacinPlacanja}</Text>
          </View>
        </View>

        {/* ── Items table ── */}
        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            <Text style={[s.tHeaderCell, s.colSifra]}>Šifra</Text>
            <Text style={[s.tHeaderCell, s.colNaziv]}>Naziv</Text>
            <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>
            <Text style={[s.tHeaderCell, s.colKol]}>Kol.</Text>
            <Text style={[s.tHeaderCell, s.colCijena]}>Cijena bez PDV</Text>
            <Text style={[s.tHeaderCell, s.colPdv]}>PDV</Text>
            <Text style={[s.tHeaderCell, s.tHeaderCellLast, s.colIznos]}>Ukupno</Text>
          </View>

          {linije.map((l, i) => (
            <View key={`${l.productId}-${i}`} style={s.tRow}>
              <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
              <Text style={[s.tCell, s.colSifra]}>{l.productSifra ?? ''}</Text>
              <Text style={[s.tCellBold, s.colNaziv]}>{l.productNaziv ?? `#${l.productId}`}</Text>
              <Text style={[s.tCell, s.colJm]}>{l.productJm ?? ''}</Text>
              <Text style={[s.tCell, s.colKol]}>{formatKol(l.kolicina)}</Text>
              <Text style={[s.tCell, s.colCijena]}>{formatKM(l.cijenaBezPdv)}</Text>
              <Text style={[s.tCell, s.colPdv]}>{formatKM(round2(l.pdv))}</Text>
              <Text style={[s.tCellBold, s.tCellLast, s.colIznos]}>{formatKM(l.iznos)}</Text>
            </View>
          ))}
        </View>

        {/* ── Rekapitulacija ── */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Osnovica (bez PDV)</Text>
              <Text style={s.totalsValue}>{formatKM(osnovica)}</Text>
            </View>
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>PDV 17%</Text>
              <Text style={s.totalsValue}>{formatKM(pdvIznos)}</Text>
            </View>
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>UKUPNO SA PDV</Text>
              <Text style={s.totalsFinalValue}>{formatKM(ukupno)}</Text>
            </View>
          </View>
        </View>

        {/* ── Veza sa fiskalnim računom — bez nje je ovo samo papir ── */}
        <View style={s.vezaBox} wrap={false}>
          <Text style={s.vezaLabel}>Veza sa fiskalnim računom</Text>
          <View style={s.vezaRow}>
            <Text style={s.vezaKey}>Fiskalni račun</Text>
            <Text style={s.vezaValue}>BF {order.brojFiskalnogRacuna || '—'} &middot; {orderDate}</Text>
          </View>
          <View style={s.vezaRow}>
            <Text style={s.vezaKey}>Zbirna stavka</Text>
            <Text style={s.vezaValue}>&bdquo;{prilogNaziv(order.prilogBroj ?? 0)}&ldquo; &middot; {formatKM(ukupno)}</Text>
          </View>
          <Text style={s.vezaNota}>
            Ovaj prilog razrađuje tu zbirnu stavku i vrijedi samo uz navedeni fiskalni račun.
          </Text>
        </View>

        {/* ── Signatures ── */}
        <View style={s.signaturesWrap} wrap={false}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Izdao</Text>
          </View>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine} />
            <Text style={s.signatureLabel}>Primio</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text>{firma.naziv} · Generisano: {today}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
