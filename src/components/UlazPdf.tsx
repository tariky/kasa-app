import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { Primka, PrimkaStavka } from '@/types';
import { kalkulacijaStavke, kalkulacijaPrimke, type KalkulacijaStavke } from '@/lib/kalkulacija';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { kontaktFirme } from '@/lib/firma';
import { formatDate } from '@/lib/utils';
import { IzvjestajStrana, MrezaTabela, fmt, type KolonaMreze } from './pdf/izvjestaj';

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
    web?: string;
    email?: string;
    logoVelicina?: number;
  };
}

const FB = PDF_FONT_FAMILY_BOLD;

type Red = { st: PrimkaStavka; c: KalkulacijaStavke };

/** Prodajni dio kalkulacije samo za artikle — materijal se ne prodaje. */
const prodaja = (c: KalkulacijaStavke, n: number) => (c.prodajnaSaPdv > 0 ? fmt(n) : '');

/* Kolone obrasca KCM — redni broj i 17 kolona kalkulacije. */
const KOLONE: KolonaMreze<Red>[] = [
  { kljuc: 'rb', naslov: 'Rb', sirina: '2.5%', poravnanje: 'sredina', vrijednost: (_, i) => i + 1 },
  { kljuc: 'sifra', naslov: 'Šifra', sirina: '5%', poravnanje: 'lijevo', vrijednost: ({ st }) => st.productSifra ?? '' },
  { kljuc: 'naziv', naslov: 'Trgovački naziv', sirina: '10.5%', poravnanje: 'lijevo', vrijednost: ({ st }) => st.productNaziv ?? '' },
  { kljuc: 'jm', naslov: 'Jm', sirina: '3%', poravnanje: 'sredina', vrijednost: ({ st }) => st.productJm ?? '' },
  { kljuc: 'kol', naslov: 'Količina', sirina: '5%', vrijednost: ({ st }) => fmt(st.kolicina) },
  { kljuc: 'fakCij', naslov: 'Fak.Cijena\npo jed.', sirina: '5.5%', vrijednost: ({ c }) => fmt(c.fakturnaPoJed) },
  { kljuc: 'fakVr', naslov: 'Fak.Vrijed\nbez PDV-a', sirina: '6.5%', vrijednost: ({ c }) => fmt(c.fakturnaVrijednost) },
  { kljuc: 'rab', naslov: 'Rabat\n%', sirina: '3.5%', vrijednost: ({ st }) => (st.rabat > 0 ? fmt(st.rabat) : '') },
  { kljuc: 'zav', naslov: 'Zavisni', sirina: '4.5%', vrijednost: ({ c }) => (c.zavisni > 0 ? fmt(c.zavisni) : '') },
  { kljuc: 'nabCij', naslov: 'Nab.Cijena\npo jed.', sirina: '5.5%', vrijednost: ({ c }) => fmt(c.nabavnaPoJed) },
  { kljuc: 'nabVr', naslov: 'Nab.Vrijed\nbez PDV-a', sirina: '6.5%', vrijednost: ({ c }) => fmt(c.nabavnaVrijednost) },
  { kljuc: 'stRuc', naslov: 'Stopa\nRUC-a', sirina: '5%', vrijednost: ({ c }) => prodaja(c, c.rucStopa) },
  { kljuc: 'izRuc', naslov: 'Iznos\nRUC-a', sirina: '6.5%', vrijednost: ({ c }) => prodaja(c, c.rucIznos) },
  { kljuc: 'prVr', naslov: 'Prod.vrij.\nbez PDV-a', sirina: '6.5%', vrijednost: ({ c }) => prodaja(c, c.prodajnaVrijednostBezPdv) },
  { kljuc: 'stPdv', naslov: 'Stopa\nPDV-a', sirina: '4%', poravnanje: 'sredina', vrijednost: ({ c }) => prodaja(c, c.pdvStopa) },
  { kljuc: 'izPdv', naslov: 'Iznos\nPDV-a', sirina: '6%', vrijednost: ({ c }) => prodaja(c, c.pdvIznos) },
  { kljuc: 'mpVr', naslov: 'MP vrijed.\nsa PDV-om', sirina: '7%', vrijednost: ({ c }) => prodaja(c, c.mpVrijednost) },
  { kljuc: 'mpCij', naslov: 'MP cijena\nsa PDV-om', sirina: '7%', vrijednost: ({ c }) => prodaja(c, c.prodajnaSaPdv) },
];

const s = StyleSheet.create({
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
});

export function UlazPdf({ primka, firma }: UlazPdfProps) {
  const stavke = primka.stavke ?? [];
  const rows: Red[] = stavke.map(st => ({ st, c: kalkulacijaStavke(st) }));

  /* ── Column totals: iste sume kao dijalog ulaza ── */
  const k = kalkulacijaPrimke(stavke);
  // Materijal se ne prodaje — bez artikala nema RUC-a, PDV-a ni MP dijela kalkulacije.
  const imaArtikala = rows.some(r => r.c.prodajnaSaPdv > 0);
  const kontakt = kontaktFirme(firma);

  return (
    <IzvjestajStrana
      orijentacija="landscape" firma={firma} potpis="Odgovorno lice:"
      naslov={<>KALKULACIJA CIJENA BROJ : {primka.brojPrimke}</>} podnaslov="Obrazac KCM"
      polja={[
        [
          ['Naziv i sjedište trgovca:', <>{firma.naziv}   {firma.adresa}   {firma.grad}</>],
          kontakt ? ['Web / Email:', kontakt] : null,
          ['Naziv i sjedište dobavljača:', [primka.dobavljacId, primka.dobavljacNaziv].filter(Boolean).join('   ')],
          primka.dobavljacAdresa ? ['', primka.dobavljacAdresa] : null,
          ['Naziv, broj i datum dokumenta:', <>Faktura: {primka.brojFakture || primka.brojPrimke}   {formatDate(primka.datum)}</>],
        ],
        [
          ['Naziv i sjedište prodajnog objekta:', <>{firma.skladiste || 'Glavna prodavnica'}   {firma.adresa}, {firma.grad}</>],
          ['Datum sačinjavanja kalkulacije:', formatDate(primka.datum)],
        ],
      ]}
    >
      <MrezaTabela
        gusta kolone={KOLONE} redovi={rows}
        zbir={{
          fakVr: fmt(k.fakturna),
          zav: k.zavisni > 0 ? fmt(k.zavisni) : '',
          nabVr: fmt(k.nabavna),
          izRuc: imaArtikala ? fmt(k.ruc) : '',
          prVr: imaArtikala ? fmt(k.prodajnaBezPdv) : '',
          izPdv: imaArtikala ? fmt(k.pdv) : '',
          mpVr: imaArtikala ? fmt(k.prodajna) : '',
        }}
      />

      {/* ── Bottom: PDV table (left) + Summary (right) ── */}
      <View style={s.bottomRow}>
        {/* PDV breakdown — samo kad ima artikala za prodaju */}
        {imaArtikala ? <View style={s.pdvTable}>
          <View style={s.pdvHeadRow}>
            <Text style={s.pdvHeadCell}>Tb PDV</Text>
            <Text style={s.pdvHeadCell}>Vr Bez PDV</Text>
            <Text style={s.pdvHeadCell}>Iznos PDV</Text>
            <Text style={s.pdvHeadCell}>PDV %  Vrijed. sa PDV</Text>
          </View>
          <View style={s.pdvDataRow}>
            <Text style={s.pdvDataCell}>PDV</Text>
            <Text style={s.pdvDataCell}>{fmt(k.prodajnaBezPdv)}</Text>
            <Text style={s.pdvDataCell}>{fmt(k.pdv)}</Text>
            <Text style={s.pdvDataCell}>{`${PDV_STOPA_E_PCT},00   `}{fmt(k.prodajna)}</Text>
          </View>
          <View style={s.pdvSumRow}>
            <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]} />
            <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>{fmt(k.prodajnaBezPdv)}</Text>
            <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>{fmt(k.pdv)}</Text>
            <Text style={[s.pdvDataCell, { fontFamily: FB, fontWeight: 700 }]}>          {fmt(k.prodajna)}</Text>
          </View>
        </View> : <View style={s.pdvTable} />}

        {/* Summary */}
        <View style={s.summaryTable}>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Fak. vrijednost</Text>
            <Text style={s.summaryValue}>{fmt(k.fakturna)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Rabat</Text>
            <Text style={s.summaryValue}>{fmt(k.rabat)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Zavisni</Text>
            <Text style={s.summaryValue}>{fmt(k.zavisni)}</Text>
          </View>
          <View style={imaArtikala ? s.summaryRow : s.summaryRowBold}>
            <Text style={[s.summaryLabel, imaArtikala ? {} : { fontFamily: FB, fontWeight: 700 }]}>Nab. vrijednost</Text>
            <Text style={s.summaryValue}>{fmt(k.nabavna)}</Text>
          </View>
          {imaArtikala ? (
            <>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>RUC</Text>
                <Text style={s.summaryValue}>{fmt(k.ruc)}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Iznos PDV</Text>
                <Text style={s.summaryValue}>{fmt(k.pdv)}</Text>
              </View>
              <View style={s.summaryRowBold}>
                <Text style={[s.summaryLabel, { fontFamily: FB, fontWeight: 700 }]}>Vrijed. sa PDV</Text>
                <Text style={s.summaryValue}>{fmt(k.prodajna)}</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </IzvjestajStrana>
  );
}
