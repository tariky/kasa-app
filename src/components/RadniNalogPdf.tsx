import { Text } from '@react-pdf/renderer';
import type { FirmaSettings, RadniNalog, RadniNalogStavka } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { formatBrojPonude } from '@/lib/ponuda';
import type { DokumentPostavke } from '@/lib/dokumentPostavke';
import { A4Dokument, Blok, BlokNaziv, BlokRed, DvaBloka, Izdavac, MetaRed, Okvir } from './pdf/A4Dokument';
import { TabelaStavki, type KolonaStavke } from './pdf/TabelaStavki';
import { datumIzBaze } from './pdf/stil';

const fmtKol = (n: number) => String(Math.round(n * 10000) / 10000).replace('.', ',');

const KOLONE: KolonaStavke<RadniNalogStavka>[] = [
  { naslov: '#', sirina: '5%', vrijednost: (_, i) => i + 1 },
  { naslov: 'Šifra', sirina: '14%', razmak: { desno: 6 }, sifra: true, vrijednost: st => st.materijalSifra ?? '' },
  { naslov: 'Materijal', sirina: '36%', bold: true, vrijednost: st => st.materijalNaziv ?? '' },
  { naslov: 'JM', sirina: '8%', vrijednost: st => st.materijalJm ?? '' },
  { naslov: 'Količina', sirina: '12%', desno: true, bold: true, vrijednost: st => fmtKol(st.kolicina) },
  { naslov: 'Napomena', sirina: '25%', razmak: { lijevo: 8 }, vrijednost: st => st.napomena ?? '' },
];

/** Interni dokument radionice — bez žiro računa i pečata. */
export function RadniNalogPdf({ nalog, firma, postavke }: { nalog: RadniNalog; firma: FirmaSettings; postavke: DokumentPostavke }) {
  return (
    <A4Dokument
      vrsta="nalog" firma={firma} postavke={postavke} ziro={false}
      naslov="RADNI NALOG" broj={`br. ${formatBrojNaloga(nalog, postavke.nalog.broj)}`}
      podnaslov={nalog.vrsta === 'narudzba' ? 'Izrada po narudžbi' : 'Izrada za zalihu'}
    >
      <DvaBloka razmak={20}>
        <Izdavac firma={firma} naslov="Izvođač" brojevi={false} />
        {nalog.vrsta === 'narudzba' ? (
          <Blok naslov="Kupac">
            <BlokNaziv>{nalog.kupacNaziv ?? ''}</BlokNaziv>
            {nalog.kupacAdresa ? <BlokRed>{nalog.kupacAdresa}</BlokRed> : null}
            {(nalog.kupacPostanskiBroj || nalog.kupacGrad) ? <BlokRed>{[nalog.kupacPostanskiBroj, nalog.kupacGrad].filter(Boolean).join(' ')}</BlokRed> : null}
          </Blok>
        ) : (
          <Blok naslov="Proizvod">
            <BlokNaziv>{nalog.productNaziv ?? ''}</BlokNaziv>
            <BlokRed>Količina: {fmtKol(nalog.kolicina)} kom</BlokRed>
          </Blok>
        )}
      </DvaBloka>

      <MetaRed razmak={18} polja={[
        ['Datum naloga', datumIzBaze(nalog.datum)],
        ['Rok isporuke', datumIzBaze(nalog.rok)],
        ['Nalog otvorio', nalog.korisnikIme || '—'],
        nalog.ponudaBroj ? ['Po ponudi', formatBrojPonude({ broj: nalog.ponudaBroj, godina: nalog.ponudaGodina ?? 0 }, postavke.ponuda.broj)] : null,
      ]} />

      <Okvir naslov="Opis posla" style={{ marginBottom: 18 }}>
        <Text style={{ fontSize: 10, lineHeight: 1.4 }}>{nalog.opis}</Text>
        {nalog.napomena ? <Text style={{ fontSize: 8.5, marginTop: 4 }}>{nalog.napomena}</Text> : null}
      </Okvir>

      <TabelaStavki kolone={KOLONE} redovi={nalog.stavke ?? []} prazno="Utrošak materijala nije unesen." />
    </A4Dokument>
  );
}
