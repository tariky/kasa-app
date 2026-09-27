import { Nivelacija, NivelacijaStavka } from '@/types';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { sumeNivelacija } from '@/lib/izvjestaji';
import { IzvjestajStrana, MrezaTabela, Sazetak, poljaFirme, brojeviFirme, fmt, type KolonaMreze } from './pdf/izvjestaj';

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
    web?: string;
    email?: string;
    logoVelicina?: number;
  };
}

const KOLONE: KolonaMreze<NivelacijaStavka>[] = [
  { kljuc: 'rb', naslov: 'Rb', sirina: '4%', poravnanje: 'sredina', vrijednost: (_, i) => i + 1 },
  { kljuc: 'sifra', naslov: 'Šifra', sirina: '8%', poravnanje: 'lijevo', vrijednost: st => st.productSifra ?? '' },
  { kljuc: 'naziv', naslov: 'Naziv', sirina: '24%', poravnanje: 'lijevo', vrijednost: st => st.productNaziv ?? '' },
  { kljuc: 'jm', naslov: 'JM', sirina: '5%', poravnanje: 'sredina', vrijednost: st => st.productJm ?? '' },
  { kljuc: 'kolicina', naslov: 'Količina', sirina: '9%', vrijednost: st => fmt(st.kolicina) },
  { kljuc: 'stara', naslov: 'Stara cijena', sirina: '13%', vrijednost: st => fmt(st.staraCijena) },
  { kljuc: 'nova', naslov: 'Nova cijena', sirina: '13%', vrijednost: st => fmt(st.novaCijena) },
  { kljuc: 'razlikaJed', naslov: 'Razlika/jed', sirina: '12%', vrijednost: st => fmt(st.razlika) },
  { kljuc: 'razlika', naslov: 'Ukup. razlika', sirina: '12%', vrijednost: st => fmt(st.ukupnaRazlika) },
];

export function NivelacijaPdf({ nivelacija, firma }: NivelacijaPdfProps) {
  const sume = sumeNivelacija([nivelacija]);

  return (
    <IzvjestajStrana
      orijentacija="portrait" firma={firma} potpis="Potpis ovlaštenog lica:"
      naslov="ZAPISNIK O PROMJENI CIJENA (NIVELACIJA)" podnaslov={<>Broj: {nivelacija.brojNivelacije}</>}
      polja={[
        [...poljaFirme(firma), ...brojeviFirme(firma)],
        [
          ['Datum:', nivelacija.datum],
          ['Prodajni objekt:', firma.skladiste || 'Glavna prodavnica'],
          nivelacija.primkaBroj ? ['Vezana primka:', nivelacija.primkaBroj] : null,
          nivelacija.napomena ? ['Napomena:', nivelacija.napomena] : null,
        ],
      ]}
    >
      <MrezaTabela kolone={KOLONE} redovi={nivelacija.stavke ?? []} zbir={{ razlikaJed: 'UKUPNO:', razlika: fmt(sume.razlika) }} />

      <Sazetak
        redovi={[
          ['Ukupna pozitivna razlika:', <>{fmt(sume.pozitivna)} KM</>],
          ['Ukupna negativna razlika:', <>{fmt(sume.negativna)} KM</>],
          [`PDV na razliku (${PDV_STOPA_E_PCT}%):`, <>{fmt(sume.pdvRazlike)} KM</>],
        ]}
        ukupno={['Neto razlika:', <>{fmt(sume.razlika)} KM</>]}
      />
    </IzvjestajStrana>
  );
}
