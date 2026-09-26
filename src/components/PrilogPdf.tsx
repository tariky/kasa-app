import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { Order, BankAccount } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';
import { formatRabat, pecatZa, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { PotpisBlok } from './pdf/PotpisBlok';
import { PdfPodnozje, PodnozjeTekst, DODATAK_PODNOZJA } from './pdf/PdfPodnozje';
import { iznosStavke, pdvStavke } from '@/lib/racun';
import { round2 } from '@/lib/novac';
import { PDV_FAKTOR_E, PDV_STOPA_E_PCT } from '@/lib/pdv';
import { prilogNaziv } from '@/lib/prilog';
import { formatDatumValute } from '@/lib/valuta';
import { logoVelicina, kontaktFirme, ziroRacuniPozicija } from '@/lib/firma';
import { SifraTekst } from './pdf/SifraTekst';

/** Red iz `prilog:getStavke` (prilog_stavke + JOIN na products). */
export interface PrilogPdfStavka {
  productId: number;
  kolicina: number;
  cijena: number;
  /** Postotak; stari zapisi ga nemaju. */
  rabat?: number | null;
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
    web?: string;
    email?: string;
    logoVelicina?: number;
    ziroRacuniPozicija?: string;
  };
  stavke: PrilogPdfStavka[];
  postavke: DokumentPostavke;
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
  logo: { width: 100, height: 100, objectFit: 'contain' as const },
  firmaNaziv: { fontSize: 14, fontFamily: FB, fontWeight: 700, letterSpacing: 0.3 },
  firmaLine: { fontSize: 8, color: '#000', marginTop: 1 },
  docLabel: { textAlign: 'right' },
  docTitle: { fontSize: 22, fontFamily: FB, fontWeight: 700, letterSpacing: 1 },
  docTitleNum: { fontSize: 22, fontFamily: F, fontWeight: 400, color: '#000', letterSpacing: 0 },
  docSubtitle: {
    fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#000', marginTop: 4,
  },

  dividerThick: { borderBottom: '2pt solid #000', marginBottom: 20 },

  /* ── Žiro računi: sporedan podatak uz firmu, ne zaslužuje vlastiti blok ── */
  bankLine: { fontSize: 7.5, color: '#555', marginTop: 1 },

  /* ── Two-column info ── */
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  infoBlock: { width: '48%' },
  infoBlockLabel: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#000', marginBottom: 6,
  },
  infoBlockName: { fontSize: 11, fontFamily: FB, fontWeight: 700, marginBottom: 3 },
  infoBlockLine: { fontSize: 8.5, color: '#000', marginBottom: 1.5 },

  /* ── Meta row ── */
  metaRow: { flexDirection: 'row', marginBottom: 22, gap: 40 },
  metaItem: {},
  metaLabel: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#000', marginBottom: 3,
  },
  metaValue: { fontSize: 9 },

  /* ── Table ── */
  table: { marginBottom: 16 },
  tHeaderRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    borderBottom: '1.5pt solid #000', paddingBottom: 4, marginBottom: 2,
  },
  tHeaderCell: {
    fontSize: 7.5, fontFamily: FB, fontWeight: 700, color: '#555', paddingRight: 6,
  },
  tHeaderCellLast: { paddingRight: 0 },
  tRow: { flexDirection: 'row', paddingVertical: 5, borderBottom: '0.5pt solid #ddd', alignItems: 'flex-start' },
  tCell: { fontSize: 8.5, lineHeight: 1.3, paddingRight: 6 },
  tCellBold: { fontSize: 8.5, fontFamily: FB, fontWeight: 700, lineHeight: 1.3, paddingRight: 6 },
  tCellLast: { paddingRight: 0 },
  colRb: { width: '4%' },
  colSifra: { width: '12%', paddingRight: 6 },
  /** Naziv uzima širinu svih skrivenih kolona (JM, rabat). */
  colNaziv: { flex: 1, paddingRight: 10 },
  colJm: { width: '5%' },
  colKol: { width: '8%', textAlign: 'right' },
  colCijena: { width: '14%', textAlign: 'right' },
  colPdv: { width: '12%', textAlign: 'right' },
  colIznos: { width: '14%', textAlign: 'right' },
  /** Kolona rabata postoji samo kad ga ima. */
  colRabat: { width: '6%', textAlign: 'right' },

  /* ── Napomena ── */
  napomenaBox: { marginTop: 14 },
  napomenaLabel: { fontSize: 7.5, fontFamily: FB, fontWeight: 700, color: '#000', marginBottom: 3 },
  napomenaText: { fontSize: 8.5, color: '#000', lineHeight: 1.4 },

  /* ── Totals ── */
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  totalsBox: { width: '45%' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  totalsLabel: { fontSize: 8.5, color: '#000' },
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
    letterSpacing: 1.2, color: '#000', marginBottom: 4,
  },
  vezaRow: { flexDirection: 'row', marginBottom: 1.5 },
  vezaKey: { width: 78, fontSize: 7.5, color: '#000' },
  vezaValue: { fontSize: 7.5, color: '#000' },
  vezaNota: { fontSize: 7, color: '#000', marginTop: 4, lineHeight: 1.4 },

  /* ── Žiro računi u podnožju: zrcali debelu liniju zaglavlja i nosi se na svakoj
     stranici, pa kupac broj za uplatu nađe na istom mjestu kao na memorandumu. ── */
  pagePodnozje: { paddingBottom: 118 },
  podnozje: { position: 'absolute', bottom: 30, left: 50, right: 50 },
  bankaTraka: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderTop: '1pt solid #000', paddingTop: 7, marginBottom: 10,
  },
  bankaNaslov: { width: 78, fontSize: 7.5, fontFamily: FB, fontWeight: 700, paddingTop: 0.5 },
  bankaKolona: { flex: 1, paddingLeft: 9, borderLeft: '0.5pt solid #ccc' },
  bankaNaziv: { fontSize: 7, color: '#555', marginBottom: 2 },
  bankaBroj: { fontSize: 9.5, fontFamily: FB, fontWeight: 700, letterSpacing: 0.4 },
  podnozjeMeta: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#999' },
});

/**
 * A4 faktura uz fiskalni račun — stvarne stavke iza zbirne stavke. Veza sa fiskalnim
 * računom (BF broj) je zakonski obavezna — bez nje je ovo samo papir.
 */
export function PrilogPdf({ order, firma, stavke, postavke }: PrilogPdfProps) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateTime = (d: Date) => `${fmtDate(d)} u ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const orderDate = fmtDateTime(new Date(order.createdAt));
  const today = fmtDate(new Date());
  const datumValute = formatDatumValute(order.datumValute);
  const hasKupac = order.kupacNaziv || order.kupacIdBroj;
  const racuniDolje = ziroRacuniPozicija(firma) === 'podnozje' && firma.bankAccounts.length > 0;
  const kol = postavke.kolone;
  const dodatak = postavke.podnozje ? { paddingBottom: (racuniDolje ? 118 : 70) + DODATAK_PODNOZJA } : {};

  // Cijene u sistemu su sa uračunatim PDV-om; za fakturni prikaz se jedinična
  // cijena bez PDV-a izlučuje iz bruto cijene po stopi stavke.
  const linije = stavke.map(si => ({
    ...si,
    rabat: si.rabat ?? 0,
    cijenaBezPdv: si.pdvStopa === 'E' ? round2(si.cijena / PDV_FAKTOR_E) : round2(si.cijena),
    iznos: iznosStavke({ cijena: si.cijena, kolicina: si.kolicina, rabat: si.rabat ?? 0, pdvStopa: si.pdvStopa }),
    pdv: pdvStavke({ cijena: si.cijena, kolicina: si.kolicina, rabat: si.rabat ?? 0, pdvStopa: si.pdvStopa }),
  }));
  const imaRabat = linije.some(l => l.rabat > 0);
  const ukupno = round2(linije.reduce((sum, l) => sum + l.iznos, 0));
  const pdvIznos = round2(linije.reduce((sum, l) => sum + l.pdv, 0));
  const osnovica = round2(ukupno - pdvIznos);

  return (
    <Document>
      <Page size="A4" style={[s.page, racuniDolje ? s.pagePodnozje : {}, dodatak]}>

        {/* ── Top: Logo+Firma left, title right ── */}
        <View style={s.topBar}>
          <View style={s.logoWrap}>
            {firma.logo && <Image src={firma.logo} style={[s.logo, { width: logoVelicina(firma), height: logoVelicina(firma) }]} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaLine}>{firma.adresa}, {firma.grad}</Text>
              {kontaktFirme(firma) ? <Text style={s.firmaLine}>{kontaktFirme(firma)}</Text> : null}
              {!racuniDolje && firma.bankAccounts.map((b, i) => (
                <Text key={i} style={s.bankLine}>{b.bankName}: {b.accountNumber}</Text>
              ))}
            </View>
          </View>
          <View style={s.docLabel}>
            <Text style={s.docTitle}>
              FAKTURA <Text style={s.docTitleNum}>br. {order.prilogBroj}</Text>
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
                {order.kupacPdvBroj && <Text style={s.infoBlockLine}>PDV: {order.kupacPdvBroj}</Text>}
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
          {datumValute && (
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>Datum valute</Text>
              <Text style={s.metaValue}>{datumValute}</Text>
            </View>
          )}
        </View>

        {/* ── Items table ── */}
        <View style={s.table}>
          <View style={s.tHeaderRow}>
            <Text style={[s.tHeaderCell, s.colRb]}>#</Text>
            {/* Šifra na fakturi nije pod `kolone.sifra` — faktura je oduvijek ima (prekidač važi za račun, ponudu i otpremnicu). */}
            <Text style={[s.tHeaderCell, s.colSifra]}>Šifra</Text>
            <Text style={[s.tHeaderCell, s.colNaziv]}>Naziv</Text>
            {kol.jm && <Text style={[s.tHeaderCell, s.colJm]}>JM</Text>}
            <Text style={[s.tHeaderCell, s.colKol]}>Kol.</Text>
            <Text style={[s.tHeaderCell, s.colCijena]}>Cijena bez PDV</Text>
            {imaRabat && <Text style={[s.tHeaderCell, s.colRabat]}>Rabat</Text>}
            <Text style={[s.tHeaderCell, s.colPdv]}>PDV</Text>
            <Text style={[s.tHeaderCell, s.tHeaderCellLast, s.colIznos]}>Ukupno</Text>
          </View>

          {linije.map((l, i) => (
            <View key={`${l.productId}-${i}`} style={s.tRow}>
              <Text style={[s.tCell, s.colRb]}>{i + 1}</Text>
              <SifraTekst style={[s.tCell, s.colSifra]}>{l.productSifra ?? ''}</SifraTekst>
              <Text style={[s.tCellBold, s.colNaziv]}>{l.productNaziv ?? `#${l.productId}`}</Text>
              {kol.jm && <Text style={[s.tCell, s.colJm]}>{l.productJm ?? ''}</Text>}
              <Text style={[s.tCell, s.colKol]}>{formatKol(l.kolicina)}</Text>
              <Text style={[s.tCell, s.colCijena]}>{formatKM(l.cijenaBezPdv)}</Text>
              {imaRabat && <Text style={[s.tCell, s.colRabat]}>{l.rabat > 0 ? formatRabat(l.rabat) : '—'}</Text>}
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
              <Text style={s.totalsLabel}>{`PDV ${PDV_STOPA_E_PCT}%`}</Text>
              <Text style={s.totalsValue}>{formatKM(pdvIznos)}</Text>
            </View>
            <View style={s.totalsFinalRow}>
              <Text style={s.totalsFinalLabel}>UKUPNO SA PDV</Text>
              <Text style={s.totalsFinalValue}>{formatKM(ukupno)}</Text>
            </View>
          </View>
        </View>

        {order.napomena ? (
          <View style={s.napomenaBox} wrap={false}>
            <Text style={s.napomenaLabel}>Napomena</Text>
            <Text style={s.napomenaText}>{order.napomena}</Text>
          </View>
        ) : null}

        {/* ── Veza sa fiskalnim računom — bez nje je ovo samo papir ── */}
        <View style={s.vezaBox} wrap={false}>
          <Text style={s.vezaLabel}>Veza sa fiskalnim računom</Text>
          <View style={s.vezaRow}>
            <Text style={s.vezaKey}>Fiskalni račun</Text>
            <Text style={s.vezaValue}>BF {order.brojFiskalnogRacuna || '—'} &middot; {orderDate}</Text>
          </View>
          <View style={s.vezaRow}>
            <Text style={s.vezaKey}>Zbirna stavka</Text>
            <Text style={s.vezaValue}>&bdquo;{order.prilogNaziv || prilogNaziv(order.prilogBroj ?? null)}&ldquo; &middot; {formatKM(ukupno)}</Text>
          </View>
          <Text style={s.vezaNota}>
            Ovaj prilog razrađuje tu zbirnu stavku i vrijedi samo uz navedeni fiskalni račun.
          </Text>
        </View>

        <PotpisBlok linije={postavke.potpisi.faktura} pecat={pecatZa(postavke, 'faktura')} />

        {/* ── Footer ── */}
        {racuniDolje ? (
          <View style={s.podnozje} fixed>
            <View style={s.bankaTraka}>
              <Text style={s.bankaNaslov}>Žiro računi</Text>
              {firma.bankAccounts.map((b, i) => (
                <View key={i} style={s.bankaKolona}>
                  <Text style={s.bankaNaziv}>{b.bankName || '—'}</Text>
                  <Text style={s.bankaBroj}>{b.accountNumber || '—'}</Text>
                </View>
              ))}
            </View>
            <PodnozjeTekst tekst={postavke.podnozje} />
            <View style={s.podnozjeMeta}>
              <Text>{POTPIS_AUTORA}</Text>
              <Text>{firma.naziv} · Generisano: {today}</Text>
              <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
            </View>
          </View>
        ) : (
          <PdfPodnozje firmaNaziv={firma.naziv} danas={today} tekst={postavke.podnozje} />
        )}
      </Page>
    </Document>
  );
}
