import { opisPlacanja } from '@/lib/placanje';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { sumePrometa } from '@/lib/izvjestaji';
import { formatDateTime } from '@/lib/utils';
import { IzvjestajStrana, MrezaTabela, Sazetak, poljaFirme, brojeviFirme, fmt, type KolonaMreze } from './pdf/izvjestaj';

export interface PrometPdfProps {
  orders: any[];
  dateFrom: string;
  dateTo: string;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    web?: string;
    email?: string;
    logoVelicina?: number;
  };
}

/** Storno (reklamacija) je crven u mreži i u sažetku. */
const STORNO = { color: '#dc2626' };

const KOLONE: KolonaMreze<PrometPdfProps['orders'][number]>[] = [
  { kljuc: 'rb', naslov: 'Rb', sirina: '5%', poravnanje: 'sredina', vrijednost: (_, i) => i + 1 },
  { kljuc: 'datum', naslov: 'Datum', sirina: '15%', poravnanje: 'lijevo', vrijednost: o => (o.createdAt ? formatDateTime(o.createdAt, '') : '—') },
  { kljuc: 'kasir', naslov: 'Kasir', sirina: '14%', poravnanje: 'lijevo', vrijednost: o => o.korisnikIme || '—' },
  { kljuc: 'fisk', naslov: 'Fisk. br.', sirina: '10%', poravnanje: 'sredina', vrijednost: o => o.brojFiskalnogRacuna || '—' },
  { kljuc: 'placanje', naslov: 'Plaćanje', sirina: '10%', poravnanje: 'lijevo', vrijednost: o => (o.nacinPlacanja ? opisPlacanja(o.nacinPlacanja, o.ukupno) : '—') },
  { kljuc: 'osnovica', naslov: 'Osnovica', sirina: '14%', vrijednost: o => fmt(o.ukupno - o.pdvIznos) },
  { kljuc: 'pdv', naslov: 'PDV', sirina: '12%', vrijednost: o => fmt(o.pdvIznos) },
  { kljuc: 'ukupno', naslov: 'Ukupno', sirina: '14%', vrijednost: o => fmt(o.ukupno) },
  { kljuc: 'status', naslov: 'St.', sirina: '6%', poravnanje: 'sredina', vrijednost: o => (o.status === 'refunded' ? 'S' : 'OK') },
];

export function PrometPdf({ orders, dateFrom, dateTo, firma }: PrometPdfProps) {
  const sume = sumePrometa(orders);

  return (
    <IzvjestajStrana
      orijentacija="portrait" firma={firma}
      naslov="IZVJEŠTAJ O PROMETU" podnaslov={<>Period: {dateFrom} — {dateTo}</>}
      polja={[poljaFirme(firma), brojeviFirme(firma)]}
    >
      <MrezaTabela
        kolone={KOLONE} redovi={orders}
        stilReda={o => (o.status === 'refunded' ? STORNO : undefined)}
        zbir={{ placanje: 'UKUPNO:', osnovica: fmt(sume.bezPdv), pdv: fmt(sume.pdv), ukupno: fmt(sume.ukupno) }}
      />

      <Sazetak
        redovi={[
          ['Ukupna prodaja:', <>{fmt(sume.ukupno)} KM</>],
          ['Osnovica (bez PDV):', <>{fmt(sume.bezPdv)} KM</>],
          [`PDV (${PDV_STOPA_E_PCT}%):`, <>{fmt(sume.pdv)} KM</>],
          ['Broj računa:', sume.brojRacuna],
          sume.brojReklamacija > 0 && ['Reklamacije:', <>{fmt(sume.reklamacije)} KM ({sume.brojReklamacija})</>, STORNO],
        ]}
        ukupno={['Neto promet:', <>{fmt(sume.ukupno - sume.reklamacije)} KM</>]}
      />
    </IzvjestajStrana>
  );
}
