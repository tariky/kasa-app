import { Text } from '@react-pdf/renderer';
import type { FirmaSettings, StavkaPonude } from '@/types';
import { formatBrojPonude } from '@/lib/ponuda';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { linijaDokumenta } from '@/lib/dokumentStavke';
import { formatKM } from '@/lib/utils';
import { formatRabat, type DokumentPostavke } from '@/lib/dokumentPostavke';
import { A4Dokument, DvaBloka, Izdavac, Kupac, MetaRed, Okvir, Ukupno } from './pdf/A4Dokument';
import { TabelaStavki, type KolonaStavke } from './pdf/TabelaStavki';
import { datumIzBaze } from './pdf/stil';

/** Dio stavke iz `ponuda:get` koji PDF čita. */
type StavkaPdf = Pick<StavkaPonude, 'id' | 'productNaziv' | 'productJm' | 'productSifra' | 'kolicina' | 'cijena' | 'rabat' | 'pdvStopa'>;

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
    stavke: StavkaPdf[];
  };
  firma: FirmaSettings;
  postavke: DokumentPostavke;
}

export function PonudaPdf({ ponuda, firma, postavke }: PonudaPdfProps) {
  const stavke = ponuda.stavke ?? [];
  const kol = postavke.kolone;
  const uslovi = postavke.ponuda.uslovi;
  const pdvIznos = ponuda.pdvIznos;
  const osnovica = ponuda.ukupno - pdvIznos;

  // Cijena je sa PDV-om; iznos reda zaokružen po redu kao na računu — kolona se zbraja u UKUPNO.
  const kolone: KolonaStavke<StavkaPdf>[] = [
    { naslov: '#', sirina: '5%', vrijednost: (_, i) => i + 1 },
    { naslov: 'Šifra', sirina: '11%', razmak: { desno: 6 }, sifra: true, vidljiva: kol.sifra, vrijednost: si => si.productSifra ?? '' },
    { naslov: 'Opis', sirina: 'ostatak', bold: true, vrijednost: si => si.productNaziv ?? '' },
    { naslov: 'JM', sirina: '7%', vidljiva: kol.jm, vrijednost: si => si.productJm ?? '' },
    { naslov: 'Kol.', sirina: '9%', desno: true, vrijednost: si => si.kolicina },
    { naslov: 'Cijena', sirina: '14%', desno: true, vrijednost: si => formatKM(si.cijena) },
    { naslov: 'Rabat', sirina: '10%', desno: true, vidljiva: stavke.some(si => si.rabat > 0), vrijednost: si => (si.rabat > 0 ? formatRabat(si.rabat) : '—') },
    { naslov: 'Iznos', sirina: '18%', desno: true, bold: true, vrijednost: si => formatKM(linijaDokumenta(si).iznos) },
  ];

  return (
    <A4Dokument
      vrsta="ponuda" firma={firma} postavke={postavke} ziro
      naslov="PONUDA" broj={`br. ${formatBrojPonude(ponuda, postavke.ponuda.broj)}`} podnaslov="Ovo nije fiskalni račun"
    >
      <DvaBloka>
        <Izdavac firma={firma} />
        <Kupac kupac={ponuda} pdv crtica={false} />
      </DvaBloka>

      <MetaRed polja={[
        ['Datum ponude', datumIzBaze(ponuda.datum)],
        ['Važi do', datumIzBaze(ponuda.vaziDo)],
        ['Ponudu sastavio', ponuda.korisnikIme || '—'],
      ]} />

      <TabelaStavki kolone={kolone} redovi={stavke} />

      <Ukupno
        redovi={[['Osnovica', formatKM(osnovica)], [`PDV (${PDV_STOPA_E_PCT}%)`, formatKM(pdvIznos)]]}
        ukupno={['UKUPNO', formatKM(ponuda.ukupno)]}
      />

      <Okvir naslov="Uslovi ponude" style={{ marginTop: 16 }}>
        <Text style={{ fontSize: 8.5, marginBottom: 2 }}>
          {`Ponuda važi do ${datumIzBaze(ponuda.vaziDo)}.${uslovi ? ` ${uslovi}` : ''}`}
        </Text>
        {ponuda.napomena ? <Text style={{ fontSize: 8.5 }}>{ponuda.napomena}</Text> : null}
      </Okvir>
    </A4Dokument>
  );
}
