import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { FirmaSettings, Order } from '@/types';
import { PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { formatRabat, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { izracunajTotale } from '@/lib/racun';
import { linijaDokumenta, type LinijaDokumenta } from '@/lib/dokumentStavke';
import { round2 } from '@/lib/novac';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { prilogNaziv } from '@/lib/prilog';
import { formatDatumValute } from '@/lib/valuta';
import { formatKM } from '@/lib/utils';
import { A4Dokument, DvaBloka, Izdavac, Kupac, MetaRed } from './pdf/A4Dokument';
import { TabelaStavki, type KolonaStavke } from './pdf/TabelaStavki';
import { datumVrijemePdf } from './pdf/stil';

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
  firma: FirmaSettings;
  stavke: PrilogPdfStavka[];
  postavke: DokumentPostavke;
}

const FB = PDF_FONT_FAMILY_BOLD;

/** Količina bez suvišnih nula: 2 → "2", 10.5 → "10,5". */
const formatKol = (n: number) => String(n).replace('.', ',');

const s = StyleSheet.create({
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
});

type Linija = PrilogPdfStavka & LinijaDokumenta & { rabat: number };

/**
 * A4 faktura uz fiskalni račun — stvarne stavke iza zbirne stavke. Veza sa fiskalnim
 * računom (BF broj) je zakonski obavezna — bez nje je ovo samo papir.
 */
export function PrilogPdf({ order, firma, stavke, postavke }: PrilogPdfProps) {
  const orderDate = datumVrijemePdf(new Date(order.createdAt));
  const datumValute = formatDatumValute(order.datumValute);
  const kol = postavke.kolone;

  // Cijene u sistemu su sa uračunatim PDV-om; za fakturni prikaz se jedinična
  // cijena bez PDV-a izlučuje iz bruto cijene po stopi stavke.
  const linije: Linija[] = stavke.map(si => ({ ...si, rabat: si.rabat ?? 0, ...linijaDokumenta(si) }));
  const { ukupno, pdvIznos } = izracunajTotale(linije);
  const osnovica = round2(ukupno - pdvIznos);

  // Faktura je zbijenija od računa: razmak 6pt iza svake kolone osim zadnje.
  const kolone: KolonaStavke<Linija>[] = [
    { naslov: '#', sirina: '4%', razmak: { desno: 6 }, vrijednost: (_, i) => i + 1 },
    // Šifra na fakturi nije pod `kolone.sifra` — faktura je oduvijek ima (prekidač važi za račun, ponudu i otpremnicu).
    { naslov: 'Šifra', sirina: '12%', razmak: { desno: 6 }, sifra: true, vrijednost: l => l.productSifra ?? '' },
    // Naziv uzima širinu svih skrivenih kolona (JM, rabat).
    { naslov: 'Naziv', sirina: 'ostatak', razmak: { desno: 10 }, bold: true, vrijednost: l => l.productNaziv ?? `#${l.productId}` },
    { naslov: 'JM', sirina: '5%', razmak: { desno: 6 }, vidljiva: kol.jm, vrijednost: l => l.productJm ?? '' },
    { naslov: 'Kol.', sirina: '8%', razmak: { desno: 6 }, desno: true, vrijednost: l => formatKol(l.kolicina) },
    { naslov: 'Cijena bez PDV', sirina: '14%', razmak: { desno: 6 }, desno: true, vrijednost: l => formatKM(l.cijenaBezPdv) },
    // Kolona rabata postoji samo kad ga ima.
    { naslov: 'Rabat', sirina: '6%', razmak: { desno: 6 }, desno: true, vidljiva: linije.some(l => l.rabat > 0), vrijednost: l => (l.rabat > 0 ? formatRabat(l.rabat) : '—') },
    { naslov: 'PDV', sirina: '12%', razmak: { desno: 6 }, desno: true, vrijednost: l => formatKM(round2(l.pdv)) },
    { naslov: 'Ukupno', sirina: '14%', desno: true, bold: true, vrijednost: l => formatKM(l.iznos) },
  ];

  return (
    <A4Dokument
      vrsta="prilog" firma={firma} postavke={postavke} ziro
      naslov="FAKTURA" broj={`br. ${order.prilogBroj ?? ''}`}
      podnaslov={`uz fiskalni račun BF ${order.brojFiskalnogRacuna || '—'}`}
    >
      <DvaBloka>
        <Izdavac firma={firma} />
        <Kupac kupac={order} pdv />
      </DvaBloka>

      <MetaRed polja={[
        ['Datum računa', orderDate],
        ['Kasir', order.korisnikIme || '—'],
        ['Plaćanje', order.nacinPlacanja],
        datumValute ? ['Datum valute', datumValute] : null,
      ]} />

      <TabelaStavki kolone={kolone} redovi={linije} style={{ marginBottom: 16 }} zaglavlje={{ paddingBottom: 4 }} />

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
    </A4Dokument>
  );
}
